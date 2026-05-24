#!/usr/bin/env python3
"""
Gemini Vision 기반 PDF 시험지 자동 크롭.
Gemini의 native bounding box 기능으로 문제 영역을 감지하고 크롭한다.

사용법:
    python3 gemini_crop.py <pdf_path> <output_dir>          # PNG + JSON 저장 (기존 동작)
    python3 gemini_crop.py <pdf_path> --json-only            # 좌표만 stdout JSON 출력 (디스크 쓰기 없음)

환경변수:
    GEMINI_API_KEY 또는 GOOGLE_API_KEY
"""
import argparse
import fitz  # PyMuPDF
import google.generativeai as genai
from PIL import Image, ImageOps
import json
import sys
import os
import io
import re
import math

DPI = 200

def normalize_rotation(rotation):
    """외부 입력 회전값을 0/90/180/270으로 정규화."""
    return (math.floor(rotation / 90 + 0.5) * 90) % 360


def apply_rotation(img, rotation):
    """PIL 이미지를 preview API와 같은 전체 페이지 회전 기준으로 변환."""
    normalized = normalize_rotation(rotation)
    if normalized == 0:
        return img
    return img.rotate(normalized, expand=True)


def pdf_page_to_pil(page, dpi=DPI, rotation=0, flip=False):
    """PyMuPDF 페이지를 PIL Image로 변환."""
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    img = apply_rotation(img, rotation)
    if flip:
        img = ImageOps.mirror(img)
    return img


def pil_to_bytes(img, fmt="PNG"):
    """PIL Image를 bytes로 변환."""
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def detect_questions_gemini(page_images):
    """
    Gemini에 모든 페이지 이미지를 보내고 문제별 bbox를 받는다.
    Gemini bbox는 1000x1000 정규화 좌표: [y_min, x_min, y_max, x_max]
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("오류: GEMINI_API_KEY 환경변수가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.5-flash")

    prompt = """이 이미지들은 수학 시험지 PDF의 각 페이지입니다.

각 페이지에서 **개별 문제**의 영역을 bounding box로 반환해주세요.

규칙:
- 2단 레이아웃(좌/우)입니다. 좌단 문제들이 먼저, 우단 문제들이 그 다음입니다.
- 문제 번호(1., 2., 3... 또는 [서술형 1] 등)를 기준으로 영역을 구분합니다.
- 각 문제 영역에는 문제 텍스트, 보기, 그림, 표가 모두 포함되어야 합니다.
- 학생 필기는 무시하고 인쇄된 내용만 기준으로 합니다.
- 해설/정답 페이지는 "answer_page": true로 표시하고 문제를 추출하지 않습니다.
- bounding box는 [y_min, x_min, y_max, x_max] 형식 (0-1000 정규화)으로 반환합니다.
- 각 문제에 "kind" 필드를 반드시 포함합니다:
  - 객관식 또는 단답형이면 "regular"
  - 서술형(예: "[서술형 N]", "서술형 1")이면 "essay"
- "number" 필드는 **kind별로 1부터** 매깁니다. 객관식과 서술형은 각각 독립적으로 번호를 부여합니다.
  예: 같은 페이지에 객관식 1, 2번 + 서술형 1번이 있으면 number는 각각 1, 2, 1입니다.

JSON 형식으로 반환:
```json
[
  {
    "page": 1,
    "answer_page": false,
    "questions": [
      {"number": 1, "kind": "regular", "box_2d": [y_min, x_min, y_max, x_max]},
      {"number": 2, "kind": "regular", "box_2d": [y_min, x_min, y_max, x_max]},
      {"number": 1, "kind": "essay",   "box_2d": [y_min, x_min, y_max, x_max]}
    ]
  },
  {
    "page": 2,
    "answer_page": true,
    "questions": []
  }
]
```

JSON만 반환하세요. 다른 텍스트는 포함하지 마세요."""

    # 이미지를 Gemini에 전달
    contents = [prompt]
    contents.extend(page_images)

    print(f"Gemini API 호출 중... ({len(page_images)} 페이지)", file=sys.stderr)
    response = model.generate_content(contents)

    # JSON 파싱
    text = response.text.strip()
    # markdown 코드블록 제거
    text = re.sub(r'^```json\s*', '', text)
    text = re.sub(r'\s*```$', '', text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        print(f"Gemini 응답 파싱 실패:", file=sys.stderr)
        print(text[:1000], file=sys.stderr)
        sys.exit(1)


def crop_from_bbox(img, box_2d):
    """
    Gemini 1000x1000 정규화 bbox를 실제 픽셀로 변환하여 크롭.
    box_2d: [y_min, x_min, y_max, x_max] (0-1000)
    """
    w, h = img.size
    y_min, x_min, y_max, x_max = box_2d

    x1 = int(x_min / 1000 * w)
    y1 = int(y_min / 1000 * h)
    x2 = int(x_max / 1000 * w)
    y2 = int(y_max / 1000 * h)

    # 클램핑
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(w, x2)
    y2 = min(h, y2)

    return img.crop((x1, y1, x2, y2))


def _infer_kind(num) -> str:
    """문제 번호 타입으로 kind를 추론. 정수 → regular, 문자열에 '서술형' → essay."""
    if isinstance(num, int):
        return "regular"
    return "essay" if "서술형" in str(num) else "regular"


def _resolve_num_kind(q: dict) -> tuple[int, str]:
    """
    Gemini 문제 dict에서 (number: int, kind: str) 정규화.
    - 명시적 kind 우선, 없으면 number 패턴으로 추론 (레거시 fallback).
    - number가 정수가 아닌 경우(레거시) 숫자를 추출하고 kind를 보강.
    """
    raw_num = q["number"]
    kind = q.get("kind") or _infer_kind(raw_num)
    if not isinstance(raw_num, int):
        snum = re.search(r'\d+', str(raw_num))
        num = int(snum.group()) if snum else 0
        if not q.get("kind") and "서술형" in str(raw_num):
            kind = "essay"
    else:
        num = raw_num
    return num, kind


def main():
    parser = argparse.ArgumentParser(
        description="Gemini Vision 기반 PDF 시험지 자동 크롭"
    )
    parser.add_argument("pdf_path", help="입력 PDF 경로")
    parser.add_argument(
        "output_dir",
        nargs="?",
        help="출력 디렉터리 (--json-only 미지정 시 필수)",
    )
    parser.add_argument(
        "--json-only",
        action="store_true",
        help="좌표 JSON만 stdout 출력. 디스크 쓰기 없음.",
    )
    parser.add_argument(
        "--rotation",
        type=float,
        default=0,
        help="PDF 전체 페이지 회전값. 0/90/180/270으로 정규화됨.",
    )
    parser.add_argument(
        "--flip",
        action="store_true",
        default=False,
        help="좌우 반전(horizontal mirror). rotation 적용 후 PIL.ImageOps.mirror를 실행.",
    )
    args = parser.parse_args()

    pdf_path = args.pdf_path
    json_only = args.json_only
    rotation = normalize_rotation(args.rotation)
    flip = args.flip

    if not json_only and not args.output_dir:
        parser.error("--json-only 없이 실행하려면 output_dir 인수가 필요합니다.")

    if not os.path.exists(pdf_path):
        print(f"오류: PDF 파일을 찾을 수 없습니다: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    if not json_only:
        os.makedirs(args.output_dir, exist_ok=True)
        print(f"=== Gemini 기반 PDF 자동 크롭 ===")
        print(f"PDF: {os.path.basename(pdf_path)}")
        print(f"회전: {rotation}도, 좌우 반전: {'ON' if flip else 'OFF'}")

    # Step 1: PDF → 페이지 이미지
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    if not json_only:
        print(f"페이지: {total_pages}장")

    page_pils = []
    for i in range(total_pages):
        pil_img = pdf_page_to_pil(doc[i], rotation=rotation, flip=flip)
        page_pils.append(pil_img)
        if not json_only:
            print(f"  Page {i+1}: {pil_img.width}x{pil_img.height}px")
    doc.close()

    # Step 2: Gemini로 문제 영역 감지
    result = detect_questions_gemini(page_pils)

    # --json-only 모드: 좌표만 반환, 디스크 쓰기 없음
    if json_only:
        pages_out = []
        for page_data in result:
            page_num = page_data["page"]          # 1-indexed (Gemini 원본)
            page_idx = page_num - 1               # 0-indexed (cropper 일관성)
            pil_img = page_pils[page_idx]
            answer_page = page_data.get("answer_page", False)

            questions_out = []
            if not answer_page:
                for q in page_data.get("questions", []):
                    num, kind = _resolve_num_kind(q)
                    questions_out.append({
                        "number": num,
                        "kind": kind,
                        "bbox": q["box_2d"],   # Gemini 원본 정규화 좌표 보존
                    })

            pages_out.append({
                "pageIndex": page_idx,
                "imageWidth": pil_img.width,
                "imageHeight": pil_img.height,
                "answerPage": answer_page,
                "questions": questions_out,
            })

        output = {
            "pdf": os.path.basename(pdf_path),
            "totalPages": total_pages,
            "rotation": rotation,
            "flip": flip,
            "pages": pages_out,
        }
        print(json.dumps(output, ensure_ascii=False))
        return

    # 기존 PNG + JSON 저장 모드
    output_dir = args.output_dir
    saved = []
    problem_pages = 0
    answer_pages = 0

    for page_data in result:
        page_num = page_data["page"]
        if page_data.get("answer_page", False):
            answer_pages += 1
            print(f"  Page {page_num}: 해설/정답 페이지 (건너뜀)")
            continue

        problem_pages += 1
        pil_img = page_pils[page_num - 1]

        for q in page_data.get("questions", []):
            box = q["box_2d"]
            cropped = crop_from_bbox(pil_img, box)
            num, kind = _resolve_num_kind(q)

            # kind별 파일명 분기 — zero-pad
            if kind == "essay":
                fname = f"q_s{num:02d}.png"
            else:
                fname = f"q{num:02d}.png"

            fpath = os.path.join(output_dir, fname)
            cropped.save(fpath)

            saved.append({
                "number": num,
                "kind": kind,
                "image": fname,
                "page": page_num,
                "box_2d": box,
                "crop_box": {
                    "x": int(box[1] / 1000 * pil_img.width),
                    "y": int(box[0] / 1000 * pil_img.height),
                    "width": cropped.width,
                    "height": cropped.height,
                },
            })
            print(f"  문제 {num}번 [{kind}]: {fname} ({cropped.width}x{cropped.height}px) [p{page_num}]")

    # Step 4: 결과 JSON 저장
    crop_result = {
        "pdf": os.path.basename(pdf_path),
        "total_pages": total_pages,
        "rotation": rotation,
        "flip": flip,
        "problem_pages": problem_pages,
        "answer_pages": answer_pages,
        "questions": saved,
    }

    result_path = os.path.join(output_dir, "crop_results.json")
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(crop_result, f, ensure_ascii=False, indent=2)

    print(f"\n=== 완료 ===")
    print(f"문제 페이지: {problem_pages}장, 해설 페이지: {answer_pages}장")
    print(f"총 {len(saved)}개 문제 크롭")
    print(f"결과: {result_path}")


if __name__ == "__main__":
    main()
