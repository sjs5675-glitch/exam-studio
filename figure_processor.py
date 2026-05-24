#!/usr/bin/env python3
"""Figure Processor - V4: crop → Gemini regenerate → trim

Note: outputs/images/ 디렉터리는 /api/create/start 가 신규 작업 시점에
      클리어한다. 본 스크립트는 prob{N}_final.png 를 idempotent 하게 작성만 한다.

CLI usage:
  python3 figure_processor.py \
    --exam-data outputs/<sample>/exam_data.json \
    --output-dir outputs/<sample>/images/ \
    --status-out outputs/<sample>/figure_status.json \
    [--no-regen]      # crop only (Gemini skip)
    [--question N]    # reprocess single question only
"""

import argparse
import io
import json
import sys
from pathlib import Path

from PIL import Image
from image_provider_adapter import IMAGE_PROVIDERS, ImageProviderError, create_image_provider

PROMPT_TEMPLATE = (
    "You are extracting a math diagram from a scanned Korean math exam "
    "question. The reference image is a crop region that may also contain "
    "extraneous content around the figure (parts of problem text, answer "
    "choice markers, page edges, handwriting). Identify the geometric figure "
    "within the crop and output ONLY that figure on a clean white background. "
    "\n\n"
    "Remove handwriting, pen marks, smudges, scan artifacts, and any "
    "non-figure content (surrounding Korean text, choice markers like ①②③④⑤, "
    "page margins, problem numbers). "
    "Keep all geometric elements (lines, curves, axes, shapes), labels "
    "(letters, numbers, point names like A B C P), angle markers, length "
    "markers, and printed annotations that belong to the figure exactly as "
    "they appear in the reference. "
    "{desc}"
    "Maintain the exact composition, proportions, and label positions of the "
    "figure itself. "
    "Output crisp black lines on a white background, textbook print quality. "
    "Do not redraw, restructure, or simplify — only clean and extract the "
    "figure."
)


def aspect_ratio_str(w: int, h: int) -> str:
    r = w / h
    if r > 1.5:
        return "16:9"
    elif r > 1.1:
        return "4:3"
    elif r > 0.9:
        return "1:1"
    elif r > 0.6:
        return "3:4"
    else:
        return "9:16"


def _is_boundary_uncertain(box: tuple[int, int, int, int], img_w: int, img_h: int,
                            gen_data: bytes | None) -> bool:
    """Heuristic: flag crop boundary as uncertain when any of:
    - extreme aspect ratio (>5:1 or <1:5)
    - crop bbox touches page boundary
    - Gemini output dimensions differ by >50% from cropped input
    """
    x0, y0, x1, y1 = box
    cw, ch = x1 - x0, y1 - y0
    if cw <= 0 or ch <= 0:
        return True

    # extreme aspect ratio
    ratio = cw / ch
    if ratio > 5.0 or ratio < 0.2:
        return True

    # bbox touches page boundary
    EDGE_MARGIN = 2
    if (x0 <= EDGE_MARGIN or y0 <= EDGE_MARGIN
            or x1 >= img_w - EDGE_MARGIN or y1 >= img_h - EDGE_MARGIN):
        return True

    # Gemini output size diverges significantly
    if gen_data is not None:
        try:
            gen_img = Image.open(io.BytesIO(gen_data))
            gw, gh = gen_img.size
            # check if generated image dimensions differ >50% from cropped input
            if abs(gw - cw) / max(cw, 1) > 0.5 or abs(gh - ch) / max(ch, 1) > 0.5:
                return True
        except Exception:
            pass

    return False


def trim_image(img_path: str, output_path: str) -> None:
    img = Image.open(img_path).convert("RGBA")
    pixels = img.load()
    w, h = img.size

    def is_white(px, t=240):
        return px[0] > t and px[1] > t and px[2] > t

    top = next((y for y in range(h) if any(not is_white(pixels[x, y]) for x in range(w))), 0)
    bottom = next(
        (y for y in range(h - 1, -1, -1) if any(not is_white(pixels[x, y]) for x in range(w))),
        h - 1,
    )

    pad = 15
    cropped = img.crop((0, max(0, top - pad), w, min(h, bottom + pad)))

    cropped.convert("RGB").save(output_path)


def process_figure(
    provider,
    prob: dict,
    cache_dir: Path,
    question_images_dir: Path,
    output_dir: Path,
    no_regen: bool,
) -> dict:
    """Process a single figure problem.

    Returns a per-question status dict conforming to the figure_status.json schema.
    """
    n = prob["number"]
    info = prob["figure_info"]
    crop_ratio = info.get("crop_ratio")
    desc = info.get("description_en", "")

    # cleaned/q{N}.png가 존재하면 우선 사용 (손글씨 제거된 ref가 figure 품질에 유리)
    cleaned_src = question_images_dir / "cleaned" / f"q{n:02d}.png"
    raw_src = question_images_dir / f"q{n:02d}.png"
    if cleaned_src.exists():
        src = cleaned_src
    elif raw_src.exists():
        src = raw_src
    else:
        print(f"  [Q{n}] 소스 이미지 없음: {raw_src}")
        return {"status": "failed", "error": f"source image missing: {raw_src}"}

    img = Image.open(str(src))
    iw, ih = img.size

    if crop_ratio:
        cr = crop_ratio
        box = (
            int(cr[0] * iw),
            int(cr[1] * ih),
            int(cr[2] * iw),
            int(cr[3] * ih),
        )
    else:
        box = (0, 0, iw, ih)

    cropped = img.crop(box).convert("RGB")
    ref_path = cache_dir / f"prob{n}_ref.jpg"
    cropped.save(str(ref_path), quality=95)

    cw, ch = cropped.size
    ar = aspect_ratio_str(cw, ch)
    final_path = output_dir / f"prob{n}_final.png"

    def _make_q_status(uncertain: bool) -> dict:
        s: dict = {
            "status": "boundary_uncertain" if uncertain else "ok",
            "finalImage": str(final_path),
            "boundaryUncertain": uncertain,
        }
        if uncertain:
            s["cropAttempts"] = 1
            s["needsAgentReview"] = True
        return s

    if no_regen:
        print(f"  [Q{n}] crop만 적용 (--no-regen, crop={box})")
        trim_image(str(ref_path), str(final_path))
        print(f"  [Q{n}] 완료 → {final_path}")
        return _make_q_status(_is_boundary_uncertain(box, iw, ih, None))

    provider_label = getattr(provider, "label", "image provider")
    print(f"  [Q{n}] {provider_label} 생성 중... (crop={box}, aspect={ar})")

    gen_data, gen_error = provider.regenerate_figure(ref_path, desc, ar, PROMPT_TEMPLATE)
    if gen_data is None:
        err_msg = f"{provider_label} generation failed: {gen_error}" if gen_error else f"{provider_label} generation failed"
        print(f"  [Q{n}] 생성 실패: {gen_error}")
        return {"status": "failed", "error": err_msg}

    gen_path = cache_dir / f"prob{n}_generated.png"
    gen_path.write_bytes(gen_data)

    trim_image(str(gen_path), str(final_path))
    print(f"  [Q{n}] 완료 → {final_path}")
    return _make_q_status(_is_boundary_uncertain(box, iw, ih, gen_data))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Figure Processor — crop+Gemini+trim pipeline"
    )
    parser.add_argument(
        "--exam-data",
        default="inputs/시험지 제작/.v3cache/exam_data.json",
        help="Path to exam_data.json",
    )
    parser.add_argument(
        "--output-dir",
        default="outputs/images",
        help="Directory to write final images",
    )
    parser.add_argument(
        "--status-out",
        default=None,
        help="Path to write figure_status.json (default: <exam-data-dir>/figure_status.json)",
    )
    parser.add_argument(
        "--no-regen",
        action="store_true",
        help="Skip image provider regeneration — crop only",
    )
    parser.add_argument(
        "--image-provider",
        choices=IMAGE_PROVIDERS,
        default="gemini",
        help="Image regeneration provider (default: gemini)",
    )
    parser.add_argument(
        "--question",
        type=int,
        default=None,
        metavar="N",
        help="Reprocess only question N",
    )
    args = parser.parse_args()

    exam_data_path = Path(args.exam_data)
    output_dir = Path(args.output_dir)
    cache_dir = exam_data_path.parent
    question_images_dir = cache_dir.parent / "question_images"

    if args.status_out:
        status_out_path = Path(args.status_out)
    else:
        status_out_path = cache_dir / "figure_status.json"

    if not args.no_regen:
        try:
            provider = create_image_provider(args.image_provider)
        except ImageProviderError as e:
            print(f"ERROR: {e}")
            sys.exit(1)
    else:
        provider = None

    with open(str(exam_data_path), encoding="utf-8") as f:
        exam_data = json.load(f)

    output_dir.mkdir(parents=True, exist_ok=True)

    figures = [
        p for p in exam_data["problems"]
        if p.get("has_figure") and p.get("figure_info")
    ]

    if args.question is not None:
        figures = [p for p in figures if p["number"] == args.question]

    if not figures:
        print("그림 있는 문제 없음, 종료")
        status_data: dict = {
            "status": "done",
            "questions": {},
        }
        status_out_path.write_text(
            json.dumps(status_data, ensure_ascii=False), encoding="utf-8"
        )
        return

    print(f"그림 처리 시작: {len(figures)}개 (provider={args.image_provider}, no_regen={args.no_regen})")
    questions_status: dict[str, dict] = {}

    for prob in figures:
        n = prob["number"]
        q_result = process_figure(
            provider, prob, cache_dir, question_images_dir, output_dir, args.no_regen
        )
        questions_status[str(n)] = q_result

    # Derive top-level status
    statuses = {v["status"] for v in questions_status.values()}
    if "failed" not in statuses and "boundary_uncertain" not in statuses:
        top_status = "done"
    elif "failed" in statuses and all(s == "failed" for s in statuses):
        top_status = "failed"
    else:
        top_status = "partial"

    status_data = {
        "status": top_status,
        "questions": questions_status,
    }

    status_out_path.write_text(
        json.dumps(status_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n완료: status={top_status}")
    failed_qs = [k for k, v in questions_status.items() if v["status"] == "failed"]
    if failed_qs:
        print(f"실패: {failed_qs}")
        sys.exit(1)


if __name__ == "__main__":
    main()
