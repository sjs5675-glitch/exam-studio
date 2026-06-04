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
import warnings

with warnings.catch_warnings():
    warnings.simplefilter("ignore", FutureWarning)
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


def parse_page_indices(value, total_pages):
    """Parse a comma-separated zero-based page index list."""
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


def pil_to_bytes(img, fmt="PNG"):
    """PIL Image를 bytes로 변환."""
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _coerce_page_results(value):
    if isinstance(value, dict) and isinstance(value.get("pages"), list):
        return value["pages"]
    if isinstance(value, list):
        return value
    return None


def _parse_gemini_json(text):
    text = text.strip()
    text = re.sub(r'^```json\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    return json.loads(text)


def detect_questions_gemini(page_images, page_offset=0, total_pages=None, announce=True, page_numbers=None):
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

    total_pages = total_pages or len(page_images)
    if page_numbers:
        page_numbers = [int(page) for page in page_numbers]
    else:
        page_numbers = list(range(page_offset + 1, page_offset + len(page_images) + 1))
    first_page = page_numbers[0]
    last_page = page_numbers[-1]
    if len(page_numbers) == 1:
        page_scope_instruction = (
            f'- 입력 이미지는 PDF 전체 {total_pages}페이지 중 원본 {first_page}페이지입니다. '
            f'"page" 값은 반드시 {first_page}만 사용합니다.'
        )
    else:
        page_list = ", ".join(str(page) for page in page_numbers)
        page_scope_instruction = (
            f'- 입력 이미지는 PDF 전체 {total_pages}페이지 중 원본 페이지 [{page_list}]입니다. '
            f'이미지 순서는 이 목록과 같습니다. "page" 값은 반드시 이 목록의 원본 PDF 페이지 번호 중 하나만 사용합니다.'
        )
    prompt = f"""이 이미지들은 수학/과학 시험지 또는 문제집 PDF의 각 페이지입니다.

각 페이지에서 **개별 문제**의 영역을 bounding box로 반환해주세요.

규칙:
{page_scope_instruction}
- 레이아웃은 1단, 2단(좌/우), 문제집형 혼합 배치가 모두 가능합니다. 실제 지면 흐름에 맞춰 위→아래, 좌단→우단 순서로 읽습니다.
- 문제 번호(1., 2., 3... 또는 [서술형 1] 등)를 기준으로 영역을 구분합니다.
- 각 문제 영역에는 문제 텍스트, 보기, <보기>, ㄱㄴㄷ 보기, 그림, 표, 그래프, 실험 장치, 자료 박스가 모두 포함되어야 합니다.
- 서로 다른 큰 문제 번호가 새로 보이면 반드시 새 문제 영역으로 분리합니다. 13번 바로 아래에 14번이 이어지는 경우처럼 두 문제가 같은 큰 테두리/같은 배경 안에 있어도 하나로 병합하지 않습니다.
- "중요해!", "<중요>", 난이도, 쪽수, 파란 페이지 번호 같은 장식/관리 라벨은 문제 번호가 아닙니다. 실제 큰 문제 번호만 분할 기준으로 사용합니다.
- "[08~09]", "[8~9]", "[8-9]"처럼 여러 문제에 공통으로 쓰이는 자료/그림/지문이 있으면 첫 번째 문제 영역에 공통 자료와 첫 번째 문항을 포함하고, 두 번째 문제는 자기 번호가 시작되는 곳부터 별도 영역으로 분리합니다. 예: [08~09] 자료 + 08번 + 09번이 보이면 08번 bbox와 09번 bbox를 따로 반환합니다.
- 공통 자료 범위 표시는 별도 문제로 만들지 않습니다. 자료가 연관된 첫 번째 문제의 일부로만 포함합니다.
- 과학 문제집의 고유 문제 번호, 중요/대표/기출/난이도 같은 작은 라벨은 문제 영역 구분의 보조 단서일 뿐 별도 문제로 분리하지 않습니다.
- 학생 필기는 무시하고 인쇄된 내용만 기준으로 합니다.
- 해설/정답만 있는 페이지는 "answer_page": true로 표시하고 문제를 추출하지 않습니다.
- 교사용 문제집처럼 파란 답이 학생용 문제 위에 적힌 페이지는 answer_page로 보지 말고 문제 영역을 추출합니다.
- bounding box는 [y_min, x_min, y_max, x_max] 형식 (0-1000 정규화)으로 반환합니다.
- 각 문제에는 선택적으로 "regions" 배열을 넣습니다. regions는 사용자가 나중에 수정할 수 있는 세부 영역입니다.
  - 일반 선택지, 동그라미 번호 선택지, 짧은 <보기>, ㄱ/ㄴ/ㄷ 보기 목록은 세부 regions로 만들지 말고 문제 영역 안에만 포함합니다.
  - "figure": 그림, 사진, 도해, 그래프, 지도, 실험 장치처럼 시각 자료 자체인 영역
  - "table": 실제 표, 데이터 표, 행렬형 선택지, 박스형 수치 자료
  - "passage": 긴 공통 지문, 긴 자료 설명, 박스 안에 들어간 여러 줄의 읽기 지문, 실험 과정, 장치 구성 설명, 관찰 결과 설명, 실험 자료 전체 블록. 짧은 <보기>나 ㄱ/ㄴ/ㄷ 보기는 passage가 아닙니다.
  - "exclude": 장식, 중요 표시, 페이지 번호, 문제 풀이에 필요 없는 출판사 표식
- "experiment" 타입은 반환하지 않습니다. 실험 과정/장치 구성/관찰 설명은 passage로 넣고, 단순 실험 장치 그림만 있으면 figure로 둡니다.
- regions의 box_2d도 [y_min, x_min, y_max, x_max] 0~1000 정규화 좌표입니다.
- [08~09]처럼 공통 긴 지문/자료/실험 설명이 있으면 첫 관련 문제의 regions에 figure/passage로 넣고, 다음 문제는 별도 문제 bbox로 유지합니다.
- 각 문제에 "kind" 필드를 반드시 포함합니다:
  - 객관식 또는 단답형이면 "regular"
  - 서술형(예: "[서술형 N]", "서술형 1")이면 "essay"
- "number" 필드는 **kind별로 1부터** 매깁니다. 객관식과 서술형은 각각 독립적으로 번호를 부여합니다.
  예: 같은 페이지에 객관식 1, 2번 + 서술형 1번이 있으면 number는 각각 1, 2, 1입니다.

JSON 형식으로 반환:
```json
[
  {{
    "page": 1,
    "answer_page": false,
    "questions": [
      {{"number": 1, "kind": "regular", "box_2d": [y_min, x_min, y_max, x_max], "regions": [
        {{"type": "figure", "box_2d": [y_min, x_min, y_max, x_max], "label": "diagram"}},
        {{"type": "table", "box_2d": [y_min, x_min, y_max, x_max], "label": "data table"}}
      ]}},
      {{"number": 2, "kind": "regular", "box_2d": [y_min, x_min, y_max, x_max]}},
      {{"number": 1, "kind": "essay",   "box_2d": [y_min, x_min, y_max, x_max]}}
    ]
  }},
  {{
    "page": 2,
    "answer_page": true,
    "questions": []
  }}
]
```

JSON만 반환하세요. 다른 텍스트는 포함하지 마세요."""

    # 이미지를 Gemini에 전달
    contents = [prompt]
    contents.extend(page_images)

    if announce:
        if len(page_images) == 1:
            print(f"Gemini API page {first_page}/{total_pages}...", file=sys.stderr)
        else:
            print(f"Gemini API pages {first_page}-{last_page}/{total_pages}...", file=sys.stderr)
    response = model.generate_content(contents)

    try:
        return _parse_gemini_json(response.text)
    except json.JSONDecodeError:
        print(f"Gemini 응답 파싱 실패:", file=sys.stderr)
        print(response.text[:1000], file=sys.stderr)
        sys.exit(1)


def refine_questions_gemini(page_image, page_data, page_index, total_pages):
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("오류: GEMINI_API_KEY 환경변수가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.5-flash")
    page_num = page_index + 1
    current_json = json.dumps(page_data, ensure_ascii=False)
    prompt = f"""이 이미지는 과학 시험지/문제집 PDF의 원본 {page_num}페이지입니다.

아래는 1차 자동분할 결과입니다. 원본 이미지를 다시 보고, 문제 영역 bbox가 정확한지 검수한 뒤 수정된 JSON만 반환하세요.

1차 결과:
```json
{current_json}
```

검수 기준:
- 이 페이지의 모든 실제 큰 문제 번호를 빠짐없이 찾아야 합니다.
- 서로 다른 큰 문제 번호는 반드시 서로 다른 bbox여야 합니다.
- 13번과 14번처럼 위아래로 붙어 있어도 하나로 합치지 않습니다.
- [16~17], [08~09]처럼 공통 자료가 있으면 공통 자료와 첫 번째 문항은 첫 번째 문제 bbox에 포함하고, 다음 문제는 자기 번호부터 별도 bbox로 나눕니다.
- "중요해!", 난이도, 쪽수, 파란 해설/정답, 작은 관리 번호는 문제 번호가 아닙니다.
- bbox는 [y_min, x_min, y_max, x_max] 0~1000 정규화 좌표입니다.
- 가능하면 각 문제 안의 regions도 유지하거나 보정합니다. type은 figure, table, passage, exclude 중 하나입니다.
- 일반 선택지, 동그라미 번호 선택지, 짧은 <보기>, ㄱ/ㄴ/ㄷ 보기 목록은 regions로 만들지 않습니다.
- 실험 과정/장치 구성/관찰 설명은 experiment가 아니라 passage로 둡니다.
- 공통 긴 지문/자료/그림/실험 설명 블록은 첫 관련 문제의 regions에 넣고 다음 문제 bbox와 합치지 않습니다.
- 페이지 번호는 반드시 {page_num}입니다.

반환 형식은 아래처럼 이 페이지 객체 1개만 담은 JSON 배열입니다. 설명 문장은 쓰지 마세요.
```json
[
  {{
    "page": {page_num},
    "answer_page": false,
    "questions": [
      {{"number": 1, "kind": "regular", "box_2d": [y_min, x_min, y_max, x_max], "regions": [
        {{"type": "figure", "box_2d": [y_min, x_min, y_max, x_max], "label": "diagram"}}
      ]}}
    ]
  }}
]
```"""

    response = model.generate_content([prompt, page_image])
    try:
        parsed = _parse_gemini_json(response.text)
    except json.JSONDecodeError:
        print(f"경고: Gemini 검수 응답 파싱 실패 page {page_num}", file=sys.stderr)
        print(response.text[:1000], file=sys.stderr)
        return page_data

    page_results = _coerce_page_results(parsed)
    if not page_results:
        print(f"경고: Gemini 검수 응답이 비어 있음 page {page_num}", file=sys.stderr)
        return page_data
    refined = page_results[0]
    if not isinstance(refined, dict):
        print(f"경고: Gemini 검수 응답 형식 오류 page {page_num}", file=sys.stderr)
        return page_data
    refined["_source_page_index"] = page_index
    return refined


def detect_questions_gemini_all(page_images, batch_size=1, verify_pass=True, source_page_indices=None, original_total_pages=None):
    """
    Gemini는 많은 페이지를 한 번에 넣으면 인접 문제 경계를 뭉개는 경우가 있어
    작은 묶음으로 나누어 호출한다.
    """
    total_pages = original_total_pages or len(page_images)
    if source_page_indices is None:
        source_page_indices = list(range(len(page_images)))
    all_results = []
    batch_size = max(1, int(batch_size or 1))

    for start in range(0, len(page_images), batch_size):
        end = min(start + batch_size, len(page_images))
        batch = page_images[start:end]
        batch_source_indices = source_page_indices[start:end]
        batch_page_numbers = [idx + 1 for idx in batch_source_indices]
        if len(batch) == 1:
            print(f"Gemini API page {start + 1}/{len(page_images)}...", file=sys.stderr)
        else:
            print(f"Gemini API pages {start + 1}-{end}/{len(page_images)}...", file=sys.stderr)

        raw = detect_questions_gemini(
            batch,
            page_offset=batch_source_indices[0] if batch_source_indices else start,
            total_pages=total_pages,
            page_numbers=batch_page_numbers,
            announce=False,
        )
        page_results = _coerce_page_results(raw)
        if page_results is None:
            print(f"경고: Gemini 응답이 페이지 배열 형식이 아니어서 {start + 1}쪽 묶음을 건너뜀", file=sys.stderr)
            continue

        normalized_results = []
        for local_idx, page_data in enumerate(page_results):
            if not isinstance(page_data, dict):
                normalized_results.append(page_data)
                continue
            resolved = _resolve_page_index(page_data, total_pages)
            if (
                len(batch) == 1
                or resolved is None
                or resolved not in batch_source_indices
            ) and local_idx < len(batch):
                page_data["_source_page_index"] = batch_source_indices[local_idx]

            if verify_pass and local_idx < len(batch):
                source_idx = _resolve_page_index(page_data, total_pages)
                if source_idx is None:
                    source_idx = batch_source_indices[local_idx]
                print(f"Gemini verify page {start + local_idx + 1}/{len(page_images)}...", file=sys.stderr)
                page_data = refine_questions_gemini(
                    batch[local_idx],
                    page_data,
                    source_idx,
                    total_pages,
                )
            normalized_results.append(page_data)
        all_results.extend(normalized_results)

    return all_results


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


def _parse_int(value):
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        match = re.search(r'\d+', value)
        if match:
            return int(match.group())
    return None


def _resolve_page_index(page_data: dict, total_pages: int):
    """
    Gemini가 page/pageIndex를 가끔 섞거나 범위를 벗어난 값을 반환하므로 안전하게 보정한다.
    - pageIndex는 0-indexed로 우선 해석
    - page는 프롬프트 기준 1-indexed로 해석
    - page=0 같은 레거시/오류 응답만 0-indexed로 허용
    """
    if "_source_page_index" in page_data:
        source_page_index = _parse_int(page_data.get("_source_page_index"))
        if source_page_index is not None and 0 <= source_page_index < total_pages:
            return source_page_index

    if "pageIndex" in page_data:
        page_index = _parse_int(page_data.get("pageIndex"))
        if page_index is not None and 0 <= page_index < total_pages:
            return page_index

    page_num = _parse_int(page_data.get("page"))
    if page_num is None:
        return None
    if 1 <= page_num <= total_pages:
        return page_num - 1
    if page_num == 0 and total_pages > 0:
        return 0
    return None


def _normalize_box(box):
    if not isinstance(box, list) or len(box) != 4:
        return None
    try:
        y_min, x_min, y_max, x_max = [float(v) for v in box]
    except (TypeError, ValueError):
        return None

    y_min = max(0, min(1000, y_min))
    x_min = max(0, min(1000, x_min))
    y_max = max(0, min(1000, y_max))
    x_max = max(0, min(1000, x_max))
    if y_max <= y_min or x_max <= x_min:
        return None
    return [y_min, x_min, y_max, x_max]


def _normalize_region_type(value):
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


def _normalize_region(region, owner_number=None):
    if not isinstance(region, dict):
        return None
    region_type = _normalize_region_type(region.get("type") or region.get("regionType"))
    box = _normalize_box(region.get("box_2d") or region.get("bbox"))
    if not region_type or box is None:
        return None
    out = {
        "type": region_type,
        "bbox": box,
    }
    if owner_number is not None:
        out["ownerNumber"] = owner_number
    label = region.get("label")
    if isinstance(label, str) and label.strip():
        out["label"] = label.strip()[:80]
    instruction = region.get("instruction")
    if isinstance(instruction, str) and instruction.strip():
        out["instruction"] = instruction.strip()[:300]
    return out


def _expand_box_for_reading_area(box):
    """
    Gemini tends to trim workbook problems too tightly, especially around the
    left problem number/title column. Expand conservatively to the page/column
    reading margin so the crop keeps the whole problem.
    """
    y_min, x_min, y_max, x_max = box
    center_x = (x_min + x_max) / 2

    y_min = max(0, y_min - 10)
    y_max = min(1000, y_max + 14)
    x_max = min(1000, x_max + 12)

    if center_x >= 575 and x_min >= 360:
        x_min = min(x_min, 500)
    else:
        x_min = min(x_min, 35)

    return [y_min, x_min, y_max, x_max]


def _bbox_area(box):
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def _bbox_overlap_ratio(a, b):
    y1 = max(a[0], b[0])
    x1 = max(a[1], b[1])
    y2 = min(a[2], b[2])
    x2 = min(a[3], b[3])
    overlap = _bbox_area([y1, x1, y2, x2])
    smaller = min(_bbox_area(a), _bbox_area(b))
    if smaller <= 0:
        return 0
    return overlap / smaller


def _geometry_warnings(page_num, questions):
    warnings_out = []
    for i, q in enumerate(questions):
        box = q["bbox"]
        area = _bbox_area(box)
        if area > 520000:
            warnings_out.append({
                "page": page_num,
                "message": f"문제 {q['number']}번 bbox가 페이지의 절반 이상을 차지합니다. 병합 여부를 확인하세요.",
            })
        for other in questions[i + 1:]:
            ratio = _bbox_overlap_ratio(box, other["bbox"])
            if ratio > 0.18:
                warnings_out.append({
                    "page": page_num,
                    "message": f"문제 {q['number']}번과 {other['number']}번 bbox가 크게 겹칩니다. 분할 여부를 확인하세요.",
                })
    return warnings_out


def _reading_order_key_from_bbox(box):
    center_x = (box[1] + box[3]) / 2
    column = 1 if center_x >= 575 and box[1] >= 360 else 0
    return (column, box[0], box[1])


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
    parser.add_argument(
        "--pages",
        default=None,
        help="Comma-separated zero-based PDF page indexes to process. Omit to process every page.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1,
        help="Gemini에 한 번에 보낼 페이지 수. 기본값 1은 정확도 우선입니다.",
    )
    parser.add_argument(
        "--no-verify-pass",
        action="store_true",
        default=False,
        help="2차 Gemini 검수 패스를 끕니다. 기본값은 정확도 우선으로 검수 패스를 실행합니다.",
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
    try:
        selected_page_indices = parse_page_indices(args.pages, total_pages)
    except ValueError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        sys.exit(1)
    if not json_only:
        print(f"페이지: {total_pages}장")

    page_pils = []
    page_pil_by_index = {}
    for render_idx, page_index in enumerate(selected_page_indices):
        print(f"Rendering page {render_idx+1}/{len(selected_page_indices)}...", file=sys.stderr)
        pil_img = pdf_page_to_pil(doc[page_index], rotation=rotation, flip=flip)
        page_pils.append(pil_img)
        page_pil_by_index[page_index] = pil_img
        if not json_only:
            print(f"  Page {page_index+1}: {pil_img.width}x{pil_img.height}px")
    doc.close()

    # Step 2: Gemini로 문제 영역 감지
    result = detect_questions_gemini_all(
        page_pils,
        batch_size=args.batch_size,
        verify_pass=not args.no_verify_pass,
        source_page_indices=selected_page_indices,
        original_total_pages=total_pages,
    )
    if not isinstance(result, list):
        print("오류: Gemini 응답이 페이지 배열 형식이 아닙니다.", file=sys.stderr)
        sys.exit(1)

    # --json-only 모드: 좌표만 반환, 디스크 쓰기 없음
    if json_only:
        pages_out = []
        warnings = []
        for page_data in result:
            if not isinstance(page_data, dict):
                warnings.append({"message": "Gemini가 페이지 객체가 아닌 항목을 반환했습니다."})
                continue
            page_idx = _resolve_page_index(page_data, total_pages)
            if page_idx is None:
                warnings.append({
                    "page": page_data.get("page"),
                    "message": f"페이지 번호가 PDF 범위를 벗어나 건너뜀: {page_data.get('page')}",
                })
                continue
            pil_img = page_pil_by_index.get(page_idx)
            if pil_img is None:
                warnings.append({
                    "page": page_idx + 1,
                    "message": f"선택하지 않은 페이지 결과를 건너뜀: {page_idx + 1}",
                })
                continue
            answer_page = page_data.get("answer_page", False)

            questions_out = []
            if not answer_page:
                for q in page_data.get("questions", []):
                    if not isinstance(q, dict):
                        warnings.append({
                            "page": page_idx + 1,
                            "message": "문제 항목이 객체 형식이 아니어서 건너뜀",
                        })
                        continue
                    box = _normalize_box(q.get("box_2d"))
                    if box is None:
                        warnings.append({
                            "page": page_idx + 1,
                            "message": f"잘못된 bbox를 건너뜀: {q.get('box_2d')}",
                        })
                        continue
                    box = _expand_box_for_reading_area(box)
                    try:
                        num, kind = _resolve_num_kind(q)
                    except Exception:
                        warnings.append({
                            "page": page_idx + 1,
                            "message": f"문제 번호를 해석하지 못해 건너뜀: {q.get('number')}",
                        })
                        continue
                    regions_out = []
                    for raw_region in q.get("regions", []):
                        region = _normalize_region(raw_region, owner_number=num)
                        if region:
                            regions_out.append(region)
                    item = {
                        "number": num,
                        "kind": kind,
                        "bbox": box,
                    }
                    if regions_out:
                        item["regions"] = regions_out
                    questions_out.append(item)

            questions_out.sort(key=lambda item: _reading_order_key_from_bbox(item["bbox"]))
            warnings.extend(_geometry_warnings(page_idx + 1, questions_out))

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
        if warnings:
            output["warnings"] = warnings
        print("Gemini JSON 정리 완료", file=sys.stderr)
        print(json.dumps(output, ensure_ascii=False))
        return

    # 기존 PNG + JSON 저장 모드
    output_dir = args.output_dir
    saved = []
    problem_pages = 0
    answer_pages = 0

    for page_data in result:
        if not isinstance(page_data, dict):
            print("  경고: Gemini가 페이지 객체가 아닌 항목을 반환해 건너뜀", file=sys.stderr)
            continue
        page_idx = _resolve_page_index(page_data, total_pages)
        if page_idx is None:
            print(f"  경고: 페이지 번호가 PDF 범위를 벗어나 건너뜀: {page_data.get('page')}", file=sys.stderr)
            continue
        page_num = page_idx + 1
        if page_data.get("answer_page", False):
            answer_pages += 1
            print(f"  Page {page_num}: 해설/정답 페이지 (건너뜀)")
            continue

        problem_pages += 1
        pil_img = page_pil_by_index.get(page_idx)
        if pil_img is None:
            print(f"  경고: 선택하지 않은 Page {page_num} 결과를 건너뜀", file=sys.stderr)
            continue

        for q in page_data.get("questions", []):
            if not isinstance(q, dict):
                print(f"  경고: Page {page_num} 문제 항목이 객체 형식이 아니어서 건너뜀", file=sys.stderr)
                continue
            box = _normalize_box(q.get("box_2d"))
            if box is None:
                print(f"  경고: Page {page_num} 잘못된 bbox를 건너뜀: {q.get('box_2d')}", file=sys.stderr)
                continue
            box = _expand_box_for_reading_area(box)
            cropped = crop_from_bbox(pil_img, box)
            try:
                num, kind = _resolve_num_kind(q)
            except Exception:
                print(f"  경고: Page {page_num} 문제 번호를 해석하지 못해 건너뜀: {q.get('number')}", file=sys.stderr)
                continue

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
