#!/usr/bin/env python3
"""
crop_results.json을 읽어 PDF에서 다시 크롭한다.
- 동일 번호가 두 번 등장하면 두 번째 배치는 서답형으로 간주하여 q_s{n}.png로 저장.
- 첫 배치는 q{n:02d}.png로 저장.
"""
import fitz
from PIL import Image
import json
import sys
import os

DPI = 200


def pdf_page_to_pil(page, dpi=DPI):
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def main():
    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    json_path = os.path.join(output_dir, "crop_results.json")

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    doc = fitz.open(pdf_path)
    page_pils = {}

    seen_numbers = set()
    in_subjective = False
    new_entries = []

    for q in data["questions"]:
        page_num = q["page"]
        if page_num not in page_pils:
            page_pils[page_num] = pdf_page_to_pil(doc[page_num - 1])
        pil_img = page_pils[page_num]

        num = q["number"]
        box = q["box_2d"]

        # 섹션 리셋 감지: 이미 본 번호가 다시 나오면 서답형 시작
        if isinstance(num, int) and num in seen_numbers:
            in_subjective = True

        if in_subjective:
            fname = f"q_s{num}.png"
        else:
            fname = f"q{num:02d}.png" if isinstance(num, int) else f"q_s{num}.png"
            if isinstance(num, int):
                seen_numbers.add(num)

        y_min, x_min, y_max, x_max = box
        w, h = pil_img.size
        x1 = max(0, int(x_min / 1000 * w))
        y1 = max(0, int(y_min / 1000 * h))
        x2 = min(w, int(x_max / 1000 * w))
        y2 = min(h, int(y_max / 1000 * h))
        cropped = pil_img.crop((x1, y1, x2, y2))

        fpath = os.path.join(output_dir, fname)
        cropped.save(fpath)

        entry = dict(q)
        entry["image"] = fname
        entry["section"] = "서답형" if in_subjective else "객관식"
        new_entries.append(entry)
        print(f"  {entry['section']} {num}번: {fname} ({cropped.width}x{cropped.height}px) [p{page_num}]")

    doc.close()

    data["questions"] = new_entries
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n총 {len(new_entries)}개 크롭 완료")
    print(f"결과: {json_path}")


if __name__ == "__main__":
    main()
