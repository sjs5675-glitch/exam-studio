#!/usr/bin/env python3
"""
Codex CLI based PDF auto-crop detector.

This script mirrors gemini_crop.py's --json-only output shape, but asks Codex
to inspect rendered PDF page images and return normalized question boxes.
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image, ImageOps

DPI = 200
DEFAULT_PAGE_TIMEOUT_SEC = 120


def normalize_rotation(rotation):
    return (math.floor(rotation / 90 + 0.5) * 90) % 360


def apply_rotation(img, rotation):
    normalized = normalize_rotation(rotation)
    if normalized == 0:
        return img
    return img.rotate(normalized, expand=True)


def pdf_page_to_pil(page, dpi=DPI, rotation=0, flip=False):
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    img = apply_rotation(img, rotation)
    if flip:
        img = ImageOps.mirror(img)
    return img


def parse_page_indices(value, total_pages):
    if not value:
        return list(range(total_pages))
    selected = []
    seen = set()
    for raw in value.split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            page_index = int(raw)
        except ValueError:
            raise ValueError(f"invalid page index: {raw}") from None
        if page_index < 0 or page_index >= total_pages:
            raise ValueError(f"page index out of range: {page_index}")
        if page_index not in seen:
            seen.add(page_index)
            selected.append(page_index)
    if not selected:
        raise ValueError("--pages must include at least one page")
    return selected


def find_codex_bin():
    explicit = os.environ.get("CODEX_BIN")
    if explicit:
        return explicit

    candidates = ["codex.cmd", "codex"] if os.name == "nt" else ["codex"]
    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found
    return None


def strip_json_fences(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def json_from_text(text):
    text = strip_json_fences(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    object_start = text.find("{")
    object_end = text.rfind("}")
    if object_start >= 0 and object_end > object_start:
        candidate = text[object_start : object_end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    array_start = text.find("[")
    array_end = text.rfind("]")
    if array_start >= 0 and array_end > array_start:
        candidate = text[array_start : array_end + 1]
        return json.loads(candidate)

    raise ValueError("Codex response did not contain parseable JSON")


def extract_final_text_from_stdout(stdout):
    last_text = ""
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        msg = event.get("msg") if isinstance(event, dict) else None
        if isinstance(msg, dict) and msg.get("type") == "agent_message":
            text = msg.get("message")
            if isinstance(text, str) and text.strip():
                last_text = text
                continue

        item = event.get("item") if isinstance(event, dict) else None
        if isinstance(item, dict):
            text = item.get("text") or item.get("message") or item.get("output")
            if isinstance(text, str) and text.strip():
                last_text = text

    return last_text


def build_prompt(page_num, total_pages):
    return textwrap.dedent(
        f"""
        You are detecting crop boxes for a Korean science exam/workbook page.
        The attached image is page {page_num} of {total_pages}.

        Return JSON only. Do not use markdown fences. Do not create, edit, or save images.

        Task:
        Find each individual problem region on this page and return normalized bounding boxes.
        Also estimate important sub-regions inside each problem so the user can correct them later:
        figure, table, passage, and exclude.

        Rules:
        - Layouts may be single-column, two-column, mixed workbook layouts, or dense Korean science worksheets.
        - Read in the printed page flow: top to bottom, then left column to right column when columns are present.
        - Split by real problem numbers such as 1., 2., 3., circled numbers, or "[서술형 1]".
        - Include all content belonging to the problem: prompt text, choices, <보기>, ㄱㄴㄷ lists, tables, graphs, diagrams, figures, experiment setup images, and data boxes.
        - If a new large printed problem number appears, start a new box. Do not merge adjacent problems even when they share the same background, border, page panel, or workbook decoration.
        - Labels such as "중요해!", "<중요>", difficulty badges, page numbers, and publisher/workbook IDs are not problem numbers.
        - For shared stems marked like "[08~09]", "[8~9]", or "[8-9]", include the shared material/figure/stem in the first problem's box and split the following problem at its own large printed number. Do not return one combined box for the entire range.
        - Do not create a separate box for the shared range label itself.
        - Do not create separate boxes for workbook metadata such as unit labels, difficulty, important/대표/기출 badges, page IDs, or small source labels.
        - Ignore student handwriting and pen marks. Use printed content as the box boundary.
        - If the page is only answers/solutions/explanations with no student-facing problem bodies, set "answer_page": true and return no questions.
        - If blue teacher answers are written over a normal student problem page, do not mark it as an answer page; still return the problem boxes.
        - Coordinates must be [y_min, x_min, y_max, x_max] on a 0-1000 normalized image coordinate system.
        - For each question, include an optional "regions" array. Each region must stay inside or near its owning problem box.
        - Do not create sub-region boxes for normal answer choices, circled choice numbers, <보기> choice lists, or ㄱ/ㄴ/ㄷ option lists. Keep those inside the main problem box only.
        - Region "type" values:
          - "figure": visual materials such as diagrams, photos, graphs, charts, maps, or apparatus pictures.
          - "table": true tables, data grids, boxed numerical data, or answer matrices.
          - "passage": long reading passages, shared long text/data descriptions, experiment procedure text, apparatus setup descriptions, observation/result descriptions, or full experiment-material blocks. Do not use this for short <보기>, ㄱ/ㄴ/ㄷ lists, or circled answer choices.
          - "exclude": decorations, workbook badges, page UI, irrelevant labels that should not drive typing.
        - Do not return an "experiment" region type. Experimental text/material belongs to "passage"; a standalone apparatus picture belongs to "figure".
        - If a shared long stem such as [08~09] belongs to multiple problems, attach the shared figure/passage regions to the first related problem and keep the next problem separate.
        - Every question must include "kind":
          - "regular" for multiple choice, short answer, or normal numbered problems.
          - "essay" for explicit 서술형 problems.
        - The "number" field starts from 1 within each kind on the whole document style. On this single page, use the printed number if clear; otherwise number in reading order.

        Required JSON shape:
        {{
          "answer_page": false,
          "questions": [
            {{
              "number": 1,
              "kind": "regular",
              "box_2d": [y_min, x_min, y_max, x_max],
              "regions": [
                {{"type": "figure", "box_2d": [y_min, x_min, y_max, x_max], "label": "diagram"}},
                {{"type": "table", "box_2d": [y_min, x_min, y_max, x_max], "label": "data table"}}
              ]
            }}
          ]
        }}
        """
    ).strip()


def run_codex_for_page(codex_bin, tmpdir, image_path, page_num, total_pages, timeout_sec):
    last_message_path = tmpdir / f"codex_page_{page_num:03d}_last.txt"
    cmd = [
        codex_bin,
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "danger-full-access",
        "--cd",
        str(tmpdir),
        "--output-last-message",
        str(last_message_path),
        "--image",
        str(image_path),
        "--",
        "-",
    ]

    prompt = build_prompt(page_num, total_pages)
    try:
        proc = subprocess.run(
            cmd,
            input=prompt,
            text=True,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_sec,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Codex page {page_num} timed out after {timeout_sec}s") from exc

    final_text = ""
    if last_message_path.exists():
        final_text = last_message_path.read_text(encoding="utf-8", errors="replace").strip()
    if not final_text:
        final_text = extract_final_text_from_stdout(proc.stdout)

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"Codex exited with {proc.returncode} on page {page_num}: {detail[:1200]}")
    if not final_text:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"Codex returned no final answer on page {page_num}: {detail[:1200]}")

    try:
        return json_from_text(final_text)
    except Exception as exc:
        raise RuntimeError(f"Codex JSON parse failed on page {page_num}: {final_text[:1200]}") from exc


def as_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    return bool(value)


def infer_kind(raw_number):
    if isinstance(raw_number, str) and "서술형" in raw_number:
        return "essay"
    return "regular"


def resolve_num_kind(question):
    raw_num = question.get("number", 0)
    raw_kind = question.get("kind")
    kind = raw_kind if raw_kind in {"regular", "essay"} else infer_kind(raw_num)

    if isinstance(raw_num, int):
        num = raw_num
    else:
        match = re.search(r"\d+", str(raw_num))
        num = int(match.group()) if match else 0
    return num, kind


def normalize_box(raw_box):
    if not isinstance(raw_box, list) or len(raw_box) != 4:
        return None
    try:
        vals = [float(v) for v in raw_box]
    except (TypeError, ValueError):
        return None

    y_min, x_min, y_max, x_max = vals
    if y_max < y_min:
        y_min, y_max = y_max, y_min
    if x_max < x_min:
        x_min, x_max = x_max, x_min

    y_min = max(0, min(1000, y_min))
    x_min = max(0, min(1000, x_min))
    y_max = max(0, min(1000, y_max))
    x_max = max(0, min(1000, x_max))

    if y_max - y_min < 5 or x_max - x_min < 5:
        return None
    return [round(y_min), round(x_min), round(y_max), round(x_max)]


def normalize_region_type(value):
    raw = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "image": "figure",
        "diagram": "figure",
        "graph": "figure",
        "chart": "figure",
        "data_table": "table",
        "data_box": "table",
        "stem": "passage",
        "stimulus": "passage",
        "source": "passage",
        "text": "passage",
        "experiment": "passage",
        "lab": "passage",
        "apparatus": "passage",
        "setup": "passage",
        "ignore": "exclude",
        "decoration": "exclude",
    }
    raw = aliases.get(raw, raw)
    return raw if raw in {"figure", "table", "passage", "exclude"} else None


def normalize_region(raw_region, owner_number=None):
    if not isinstance(raw_region, dict):
        return None
    region_type = normalize_region_type(raw_region.get("type", raw_region.get("regionType")))
    box = normalize_box(raw_region.get("box_2d", raw_region.get("bbox")))
    if not region_type or box is None:
        return None
    region = {
        "type": region_type,
        "bbox": box,
    }
    if owner_number is not None:
        region["ownerNumber"] = owner_number
    label = raw_region.get("label")
    if isinstance(label, str) and label.strip():
        region["label"] = label.strip()[:80]
    instruction = raw_region.get("instruction")
    if isinstance(instruction, str) and instruction.strip():
        region["instruction"] = instruction.strip()[:300]
    return region


def normalize_page_result(raw):
    if isinstance(raw, dict) and isinstance(raw.get("pages"), list) and raw["pages"]:
        raw = raw["pages"][0]
    if isinstance(raw, list):
        raw = raw[0] if raw else {}
    if not isinstance(raw, dict):
        raise ValueError("page result must be an object")

    answer_page = as_bool(raw.get("answer_page", raw.get("answerPage", False)))
    questions = []
    if not answer_page:
        for q in raw.get("questions", []):
            if not isinstance(q, dict):
                continue
            box = normalize_box(q.get("box_2d", q.get("bbox")))
            if box is None:
                continue
            num, kind = resolve_num_kind(q)
            regions = []
            for raw_region in q.get("regions", []):
                region = normalize_region(raw_region, owner_number=num)
                if region:
                    regions.append(region)
            item = {
                "number": num,
                "kind": kind,
                "bbox": box,
            }
            if regions:
                item["regions"] = regions
            questions.append(item)

    return {
        "answerPage": answer_page,
        "questions": questions,
    }


def main():
    parser = argparse.ArgumentParser(description="Codex CLI based PDF auto crop")
    parser.add_argument("pdf_path", help="Input PDF path")
    parser.add_argument("output_dir", nargs="?", help="Unused. Kept for CLI parity.")
    parser.add_argument("--json-only", action="store_true", help="Print crop coordinates as JSON")
    parser.add_argument("--rotation", type=float, default=0, help="Page rotation. Normalized to 0/90/180/270.")
    parser.add_argument("--flip", action="store_true", default=False, help="Mirror page horizontally after rotation.")
    parser.add_argument("--pages", default=None, help="Comma-separated zero-based PDF page indexes to process.")
    parser.add_argument("--page-timeout-sec", type=int, default=DEFAULT_PAGE_TIMEOUT_SEC)
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        default=False,
        help="Stop on the first page failure. By default failed pages are reported as warnings.",
    )
    args = parser.parse_args()

    if not args.json_only:
        parser.error("codex_crop.py currently supports --json-only only.")

    pdf_path = args.pdf_path
    if not os.path.exists(pdf_path):
        print(f"오류: PDF 파일을 찾을 수 없습니다: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    codex_bin = find_codex_bin()
    if not codex_bin:
        print("오류: Codex CLI를 PATH에서 찾을 수 없습니다. `npm install -g @openai/codex` 후 `codex login`을 실행하세요.", file=sys.stderr)
        sys.exit(1)

    rotation = normalize_rotation(args.rotation)
    flip = args.flip

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    try:
        selected_page_indices = parse_page_indices(args.pages, total_pages)
    except ValueError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        sys.exit(1)
    page_pils = []
    for page_index in selected_page_indices:
        page_pils.append((page_index, pdf_page_to_pil(doc[page_index], rotation=rotation, flip=flip)))
    doc.close()

    pages_out = []
    warnings = []
    with tempfile.TemporaryDirectory(prefix="exam-codex-crop-") as tmp:
        tmpdir = Path(tmp)
        for processed_idx, (source_page_index, pil_img) in enumerate(page_pils):
            page_num = source_page_index + 1
            image_path = tmpdir / f"page_{page_num:03d}.png"
            pil_img.save(image_path)
            print(f"Codex auto-crop page {processed_idx + 1}/{len(page_pils)}...", file=sys.stderr)

            try:
                raw_result = run_codex_for_page(
                    codex_bin=codex_bin,
                    tmpdir=tmpdir,
                    image_path=image_path,
                    page_num=page_num,
                    total_pages=total_pages,
                    timeout_sec=args.page_timeout_sec,
                )
                page_result = normalize_page_result(raw_result)
            except Exception as exc:
                message = str(exc)
                if args.fail_fast:
                    raise
                print(f"경고: page {page_num} 자동분할 실패 — {message}", file=sys.stderr)
                warnings.append({
                    "pageIndex": source_page_index,
                    "page": page_num,
                    "message": message[:1200],
                })
                page_result = {
                    "answerPage": False,
                    "questions": [],
                }

            pages_out.append({
                "pageIndex": source_page_index,
                "imageWidth": pil_img.width,
                "imageHeight": pil_img.height,
                "answerPage": page_result["answerPage"],
                "questions": page_result["questions"],
            })

    output = {
        "pdf": os.path.basename(pdf_path),
        "totalPages": total_pages,
        "rotation": rotation,
        "flip": flip,
        "provider": "codex-cli",
        "pages": pages_out,
    }
    if warnings:
        output["warnings"] = warnings
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
