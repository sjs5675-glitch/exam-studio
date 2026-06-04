#!/usr/bin/env python3
"""
Build an editable concept-book HWPX from a PDF.

The output prioritizes editable text over exact visual duplication. Text lines
are extracted from the PDF and rebuilt as HWPX paragraphs. Raster image blocks
that are large enough to be useful are inserted as cropped reference figures.
"""

from __future__ import annotations

import argparse
import io
import re
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

import fitz
from PIL import Image


BASE = Path("resources/hwpx_base")
DEFAULT_OUTPUT_DIR = Path("outputs")


CONTROL_CHARS = {
    "\x00": "",
    "\x03": "",
    "\x07": "",
    "\u200c": "",
    "\ufeff": "",
}


@dataclass
class TextLine:
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    text: str
    region: str


@dataclass
class FigureCrop:
    page: int
    rect: fitz.Rect
    label: str


def xml_escape(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def clean_text(value: str) -> str:
    for src, dst in CONTROL_CHARS.items():
        value = value.replace(src, dst)
    value = "".join(ch for ch in value if ch == "\t" or ch == "\n" or ord(ch) >= 32)
    value = value.replace("\u2009", " ")
    value = re.sub(r"[ \t]+", " ", value)
    return value.strip()


def estimate_text_units(text: str) -> int:
    total = 0
    for ch in text or "":
        code = ord(ch)
        if ch.isspace():
            total += 260
        elif (
            0xAC00 <= code <= 0xD7AF
            or 0x3130 <= code <= 0x318F
            or 0x4E00 <= code <= 0x9FFF
            or 0x3040 <= code <= 0x30FF
        ):
            total += 620
        elif ch in ",.;:!?()[]{}<>/\\-+*=~'\"":
            total += 260
        else:
            total += 360
    return total


def split_by_units(text: str, max_units: int = 26000) -> list[str]:
    words = text.split(" ")
    chunks: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if current and estimate_text_units(candidate) > max_units:
            chunks.append(current)
            current = word
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks or [text]


def find_latest_download_pdf() -> Path:
    downloads = Path.home() / "Downloads"
    candidates = sorted(downloads.glob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise FileNotFoundError("No PDF files found in Downloads.")
    return candidates[0]


def join_spans(spans: list[dict]) -> str:
    pieces: list[str] = []
    last_x1: float | None = None
    for span in sorted(spans, key=lambda s: s["bbox"][0]):
        text = clean_text(span.get("text", ""))
        if not text:
            continue
        x0 = float(span["bbox"][0])
        size = float(span.get("size", 8))
        if last_x1 is not None:
            gap = x0 - last_x1
            if gap > max(2.5, size * 0.35) and pieces and not pieces[-1].endswith(" "):
                pieces.append(" ")
        pieces.append(text)
        last_x1 = float(span["bbox"][2])
    return clean_text("".join(pieces))


def classify_region(x0: float, y0: float, page_width: float) -> str:
    if y0 < 120:
        return "header"
    if x0 > page_width * 0.66:
        return "side"
    return "main"


def extract_text_lines(doc: fitz.Document) -> list[list[TextLine]]:
    pages: list[list[TextLine]] = []
    for page_index, page in enumerate(doc, start=1):
        page_lines: list[TextLine] = []
        page_width = float(page.rect.width)
        data = page.get_text("dict")
        for block in data.get("blocks", []):
            if block.get("type") != 0:
                continue
            for raw_line in block.get("lines", []):
                spans = [s for s in raw_line.get("spans", []) if clean_text(s.get("text", ""))]
                if not spans:
                    continue
                text = join_spans(spans)
                if not text:
                    continue
                x0 = min(float(s["bbox"][0]) for s in spans)
                y0 = min(float(s["bbox"][1]) for s in spans)
                x1 = max(float(s["bbox"][2]) for s in spans)
                y1 = max(float(s["bbox"][3]) for s in spans)
                size = max(float(s.get("size", 8)) for s in spans)
                line = TextLine(
                    page=page_index,
                    x0=x0,
                    y0=y0,
                    x1=x1,
                    y1=y1,
                    size=size,
                    text=text,
                    region=classify_region(x0, y0, page_width),
                )
                if not is_noise_line(line):
                    page_lines.append(line)
        pages.append(order_page_lines(page_lines))
    return pages


def extract_text_blocks(doc: fitz.Document) -> list[list[TextLine]]:
    pages: list[list[TextLine]] = []
    for page_index, page in enumerate(doc, start=1):
        page_lines: list[TextLine] = []
        page_width = float(page.rect.width)
        data = page.get_text("dict")
        for block in data.get("blocks", []):
            if block.get("type") != 0:
                continue
            raw_lines: list[str] = []
            sizes: list[float] = []
            for raw_line in block.get("lines", []):
                spans = [s for s in raw_line.get("spans", []) if clean_text(s.get("text", ""))]
                if not spans:
                    continue
                raw_lines.append(join_spans(spans))
                sizes.extend(float(s.get("size", 8)) for s in spans)
            text = clean_text(" ".join(raw_lines))
            if not text:
                continue
            x0, y0, x1, y1 = [float(v) for v in block["bbox"]]
            for chunk_index, chunk in enumerate(split_by_units(text)):
                line = TextLine(
                    page=page_index,
                    x0=x0,
                    y0=y0 + chunk_index * 0.1,
                    x1=x1,
                    y1=y1,
                    size=max(sizes) if sizes else 8,
                    text=chunk,
                    region=classify_region(x0, y0, page_width),
                )
                if not is_noise_line(line):
                    page_lines.append(line)
        pages.append(order_page_lines(page_lines))
    return pages


def is_noise_line(line: TextLine) -> bool:
    text = line.text.strip()
    if not text:
        return True
    if line.y0 < 70 and len(text) <= 3 and not any(ch.isdigit() for ch in text) and line.size < 15:
        return True
    if line.y0 < 95 and line.x0 < 130 and len(text) <= 2 and line.size < 13:
        return True
    if re.fullmatch(r"[-_.,:;`'\"()\[\]{}]+", text):
        return True
    return False


def order_page_lines(lines: list[TextLine]) -> list[TextLine]:
    headers = [line for line in lines if line.region == "header"]
    main = [line for line in lines if line.region == "main"]
    side = [line for line in lines if line.region == "side"]
    headers.sort(key=lambda line: (line.y0, line.x0))
    main.sort(key=lambda line: (line.y0, line.x0))
    side.sort(key=lambda line: (line.y0, line.x0))
    return headers + main + side


def rect_area(rect: fitz.Rect) -> float:
    return max(0.0, rect.width) * max(0.0, rect.height)


def overlap_ratio(a: fitz.Rect, b: fitz.Rect) -> float:
    inter = a & b
    if inter.is_empty:
        return 0.0
    denom = min(rect_area(a), rect_area(b))
    return rect_area(inter) / denom if denom else 0.0


def merge_rects(rects: Iterable[fitz.Rect]) -> list[fitz.Rect]:
    merged: list[fitz.Rect] = []
    for rect in sorted(rects, key=lambda r: (r.y0, r.x0)):
        if rect.is_empty or rect.width <= 0 or rect.height <= 0:
            continue
        found = False
        for idx, existing in enumerate(merged):
            expanded = fitz.Rect(existing.x0 - 4, existing.y0 - 4, existing.x1 + 4, existing.y1 + 4)
            if overlap_ratio(expanded, rect) > 0.15 or expanded.intersects(rect):
                merged[idx] = existing | rect
                found = True
                break
        if not found:
            merged.append(rect)
    return merged


def extract_figure_crops(doc: fitz.Document) -> list[list[FigureCrop]]:
    result: list[list[FigureCrop]] = []
    for page_index, page in enumerate(doc, start=1):
        raw_rects: list[fitz.Rect] = []
        data = page.get_text("dict")
        for block in data.get("blocks", []):
            if block.get("type") != 1:
                continue
            rect = fitz.Rect(block["bbox"])
            if rect.width < 30 or rect.height < 18:
                continue
            if rect_area(rect) < 2200:
                continue
            raw_rects.append(rect)
        crops: list[FigureCrop] = []
        for idx, rect in enumerate(merge_rects(raw_rects), start=1):
            rect = rect + (-2, -2, 2, 2)
            rect = rect & page.rect
            if rect.width < 30 or rect.height < 18:
                continue
            crops.append(FigureCrop(page=page_index, rect=rect, label=f"figure {idx}"))
        result.append(crops[:6])
    return result


def base_section_parts(doc: fitz.Document) -> tuple[str, str]:
    header_template = (BASE / "header_area_template.xml").read_text(encoding="utf-8")
    ns_open = header_template.split(">", 1)[0] + ">"
    secpr_match = re.search(r"<hp:secPr\b.*?</hp:secPr>", header_template, flags=re.S)
    if not secpr_match:
        raise ValueError("Could not find hp:secPr in header_area_template.xml")
    secpr = secpr_match.group(0)
    first_rect = doc[0].rect
    page_w = int(round(first_rect.width * 100))
    page_h = int(round(first_rect.height * 100))
    margin = 1800
    pagepr = (
        f'<hp:pagePr landscape="WIDELY" width="{page_w}" height="{page_h}" gutterType="LEFT_ONLY">'
        f'<hp:margin header="0" footer="0" gutter="0" left="{margin}" right="{margin}" '
        f'top="2600" bottom="2600"/>'
        "</hp:pagePr>"
    )
    secpr = re.sub(r"<hp:pagePr\b.*?</hp:pagePr>", pagepr, secpr, flags=re.S)
    colctrl = '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="2" sameSz="1" sameGap="1200"/></hp:ctrl>'
    first_para = (
        '<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="7">{secpr}{colctrl}<hp:t/></hp:run>'
        f"{lineseg(0, 800, 800, 680, 300, 24000)}"
        "</hp:p>"
    )
    return ns_open, first_para


def lineseg(
    vertpos: int = 0,
    vertsize: int = 1000,
    textheight: int = 1000,
    baseline: int = 850,
    spacing: int = 600,
    horzsize: int = 24000,
) -> str:
    return (
        "<hp:linesegarray>"
        f'<hp:lineseg textpos="0" vertpos="{vertpos}" vertsize="{vertsize}" textheight="{textheight}" '
        f'baseline="{baseline}" spacing="{spacing}" horzpos="0" horzsize="{horzsize}" flags="393216"/>'
        "</hp:linesegarray>"
    )


def make_paragraph(
    content: str,
    *,
    char_pr: str = "1",
    para_pr: str = "0",
    page_break: bool = False,
    height: int = 1000,
    horzsize: int = 24000,
) -> str:
    return (
        f'<hp:p id="2147483648" paraPrIDRef="{para_pr}" styleIDRef="0" '
        f'pageBreak="{1 if page_break else 0}" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="{char_pr}">{content}</hp:run>'
        f"{lineseg(0, height, height, max(500, int(height * 0.85)), 300, horzsize)}"
        "</hp:p>"
    )


def make_text_paragraph(text: str, *, char_pr: str = "1", page_break: bool = False, height: int = 1000) -> str:
    return make_paragraph(f"<hp:t>{xml_escape(text)}</hp:t>", char_pr=char_pr, page_break=page_break, height=height)


def make_blank(height: int = 700, *, page_break: bool = False) -> str:
    return make_paragraph("<hp:t/>", char_pr="1", page_break=page_break, height=height)


def style_for_line(line: TextLine) -> tuple[str, int, str]:
    if line.size >= 18:
        return "42", 1400, ""
    if line.region == "header" and len(line.text) <= 40:
        return "2", 650, ""
    if line.region == "side":
        return "1", 620, "[side] "
    if line.size <= 7.2:
        return "1", 580, ""
    return "1", 720, ""


def crop_to_bmp(page: fitz.Page, rect: fitz.Rect) -> bytes:
    pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), clip=rect, alpha=False)
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    buf = io.BytesIO()
    image.save(buf, format="BMP")
    return buf.getvalue()


def make_pic_xml(binary_id: str, rect: fitz.Rect, pic_id: int, z_order: int, inst_id: int) -> str:
    max_width = 22000
    width = int(round(rect.width * 100))
    height = int(round(rect.height * 100))
    if width > max_width:
        scale = max_width / width
        width = max_width
        height = int(round(height * scale))
    return (
        f'<hp:pic id="{pic_id}" zOrder="{z_order}" numberingType="PICTURE" '
        'textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" '
        f'href="" groupLevel="0" instid="{inst_id}" reverse="0">'
        '<hp:offset x="0" y="0"/>'
        f'<hp:orgSz width="{width}" height="{height}"/><hp:curSz width="{width}" height="{height}"/>'
        '<hp:flip horizontal="0" vertical="0"/>'
        f'<hp:rotationInfo angle="0" centerX="{width // 2}" centerY="{height // 2}" rotateimage="1"/>'
        '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
        '<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
        '<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>'
        f'<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="{width}" y="0"/>'
        f'<hc:pt2 x="{width}" y="{height}"/><hc:pt3 x="0" y="{height}"/></hp:imgRect>'
        f'<hp:imgClip left="0" right="{width}" top="0" bottom="{height}"/>'
        '<hp:inMargin left="0" right="0" top="0" bottom="0"/>'
        f'<hp:imgDim dimwidth="{width}" dimheight="{height}"/>'
        f'<hc:img binaryItemIDRef="{binary_id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>'
        '<hp:effects/>'
        f'<hp:sz width="{width}" widthRelTo="ABSOLUTE" height="{height}" heightRelTo="ABSOLUTE" protect="0"/>'
        '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
        'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" '
        'vertOffset="0" horzOffset="0"/>'
        '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
        '<hp:shapeComment>source figure crop</hp:shapeComment>'
        "</hp:pic>"
    )


def build_section_xml(
    doc: fitz.Document,
    lines_by_page: list[list[TextLine]],
    crops_by_page: list[list[FigureCrop]],
    *,
    page_breaks: bool = True,
) -> tuple[str, list[tuple[str, bytes]], str]:
    ns_open, first_para = base_section_parts(doc)
    paras = [first_para]
    images: list[tuple[str, bytes]] = []
    image_idx = 9
    preview: list[str] = []

    for page_index, page_lines in enumerate(lines_by_page, start=1):
        if page_index > 1 and page_breaks:
            paras.append(make_blank(page_break=True))
        paras.append(make_text_paragraph(f"Source page {page_index}", char_pr="2", height=650))
        last_y: float | None = None
        for line in page_lines:
            if last_y is not None and line.y0 - last_y > 18:
                paras.append(make_blank(250))
            char_pr, height, prefix = style_for_line(line)
            paras.append(make_text_paragraph(prefix + line.text, char_pr=char_pr, height=height))
            preview.append(line.text)
            last_y = line.y0

        crops = crops_by_page[page_index - 1] if page_index - 1 < len(crops_by_page) else []
        if crops:
            paras.append(make_blank(250))
            paras.append(make_text_paragraph("Figure crops", char_pr="2", height=650))
            page = doc[page_index - 1]
            for crop in crops:
                image_name = f"image{image_idx}.bmp"
                binary_id = image_name[:-4]
                images.append((image_name, crop_to_bmp(page, crop.rect)))
                pic = make_pic_xml(binary_id, crop.rect, 210000000 + image_idx, image_idx, 310000000 + image_idx)
                paras.append(make_paragraph(f"{pic}<hp:t/>", para_pr="2", height=max(1000, int(crop.rect.height * 100))))
                image_idx += 1

    section_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + ns_open + "".join(paras) + "</hs:sec>"
    return section_xml, images, "\n".join(preview[:80])


def build_hpf(images: list[tuple[str, bytes]]) -> str:
    template = (BASE / "content_hpf_template.xml").read_text(encoding="utf-8")
    modified = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    extra = "".join(
        f'<opf:item id="{name[:-4]}" href="BinData/{name}" media-type="image/bmp" isEmbeded="1"/>'
        for name, _ in images
    )
    return template.replace("{{MODIFIED_DATE}}", modified).replace("{{EXTRA_IMAGES}}", extra)


def write_hwpx(output_path: Path, section_xml: str, hpf_xml: str, preview_text: str, images: list[tuple[str, bytes]]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w") as zout:
        zout.write(BASE / "mimetype", "mimetype", compress_type=zipfile.ZIP_STORED)
        zout.write(BASE / "version.xml", "version.xml", compress_type=zipfile.ZIP_STORED)
        zout.write(BASE / "Contents" / "header.xml", "Contents/header.xml", compress_type=zipfile.ZIP_DEFLATED)
        zout.write(BASE / "Contents" / "masterpage0.xml", "Contents/masterpage0.xml", compress_type=zipfile.ZIP_DEFLATED)
        for base_img in sorted((BASE / "BinData").glob("image*.bmp")):
            zout.write(base_img, f"BinData/{base_img.name}", compress_type=zipfile.ZIP_DEFLATED)
        for name, data in images:
            zout.writestr(f"BinData/{name}", data, compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr("Contents/section0.xml", section_xml.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr("Contents/content.hpf", hpf_xml.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr("Preview/PrvText.txt", preview_text.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
        zout.write(BASE / "settings.xml", "settings.xml", compress_type=zipfile.ZIP_DEFLATED)
        zout.write(BASE / "Preview" / "PrvImage.png", "Preview/PrvImage.png", compress_type=zipfile.ZIP_STORED)
        zout.write(BASE / "META-INF" / "container.rdf", "META-INF/container.rdf", compress_type=zipfile.ZIP_DEFLATED)
        zout.write(BASE / "META-INF" / "container.xml", "META-INF/container.xml", compress_type=zipfile.ZIP_DEFLATED)
        zout.write(BASE / "META-INF" / "manifest.xml", "META-INF/manifest.xml", compress_type=zipfile.ZIP_DEFLATED)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", nargs="?", type=Path, help="Source PDF. Defaults to the latest PDF in Downloads.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--no-figures", action="store_true", help="Skip cropped source figures.")
    parser.add_argument("--continuous", action="store_true", help="Do not force a page break between source PDF pages.")
    parser.add_argument("--blocks", action="store_true", help="Use compact PDF text blocks instead of individual text lines.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pdf_path = args.pdf or find_latest_download_pdf()
    doc = fitz.open(pdf_path)
    lines_by_page = extract_text_blocks(doc) if args.blocks else extract_text_lines(doc)
    crops_by_page = [[] for _ in range(doc.page_count)] if args.no_figures else extract_figure_crops(doc)
    section_xml, images, preview_text = build_section_xml(
        doc,
        lines_by_page,
        crops_by_page,
        page_breaks=not args.continuous,
    )
    hpf_xml = build_hpf(images)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_path = args.output_dir / f"concept_editable_top-tier_unit1_ver{stamp}.hwpx"
    write_hwpx(output_path, section_xml, hpf_xml, preview_text, images)
    print(f"PDF: {pdf_path}")
    print(f"Pages: {doc.page_count}")
    print(f"Editable lines: {sum(len(page) for page in lines_by_page)}")
    print(f"Figure crops: {sum(len(page) for page in crops_by_page)}")
    print(f"HWPX: {output_path.resolve()}")


if __name__ == "__main__":
    main()
