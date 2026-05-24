#!/usr/bin/env python3
"""
HWPX Builder — Shapes and picture XML generation

Import direction: ids → equation → shapes → tables → assemble → build_hwpx
"""

import re
import io
from PIL import Image
from ids import next_eq_id, next_zorder, next_inst_id
from equation import xml_escape, make_equation_xml, lineseg_params_for_eq, make_lineseg


def make_condition_rect(condition_box, base_path):
    """Generate condition box (hp:rect) for (가)/(나)/(다) items"""
    items = condition_box["items"]
    n_items = len(items)
    height = n_items * 1600 + 2000
    center_y = height // 2
    sca_y = round(height / 12587, 6)
    rect_id = next_eq_id()
    zorder = next_zorder()
    iid = next_inst_id()

    items_content = ""
    for idx, item in enumerate(items):
        label = item["label"]
        vpos = idx * 1600

        # Build content for this item
        item_run_content = f'<hp:t>{xml_escape(label)} </hp:t>'
        max_eq = (1000, 1000, 850, 600)
        for part in item["parts"]:
            if "eq" in part:
                item_run_content += make_equation_xml(part["eq"])
                params = lineseg_params_for_eq(part["eq"])
                if params[0] > max_eq[0]:
                    max_eq = params
            elif "t" in part:
                item_run_content += f'<hp:t>{xml_escape(part["t"])}</hp:t>'

        items_content += (f'<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                         f'<hp:run charPrIDRef="1">{item_run_content}</hp:run>'
                         f'<hp:linesegarray><hp:lineseg textpos="0" vertpos="{vpos}" '
                         f'vertsize="{max_eq[0]}" textheight="{max_eq[1]}" baseline="{max_eq[2]}" '
                         f'spacing="{max_eq[3]}" horzpos="0" horzsize="27736" flags="393216"/>'
                         f'</hp:linesegarray></hp:p>')

    # Read condition_rect_template.xml
    with open(f"{base_path}/condition_rect_template.xml", "r", encoding="utf-8") as f:
        template = f.read()

    rect_xml = template.replace("{{RECT_ID}}", str(rect_id))
    rect_xml = rect_xml.replace("{{ZORDER}}", str(zorder))
    rect_xml = rect_xml.replace("{{INST_ID}}", str(iid))
    rect_xml = rect_xml.replace("{{HEIGHT}}", str(height))
    rect_xml = rect_xml.replace("{{CENTER_Y}}", str(center_y))
    rect_xml = rect_xml.replace("{{SCA_Y}}", str(sca_y))
    rect_xml = rect_xml.replace("{{ITEMS_CONTENT}}", items_content)

    return rect_xml


def make_ganada_table(condition_box, base_path):
    """Generate condition box for (가)/(나)/(다) labeled items using ganada fixture style.
    Uses condition_rect_template.xml with paraPrIDRef=11 for interior items,
    matching the styling of ganada_table.xml.
    """
    items = condition_box["items"]
    n_items = len(items)
    height = n_items * 1600 + 2000
    center_y = height // 2
    sca_y = round(height / 12587, 6)
    rect_id = next_eq_id()
    zorder = next_zorder()
    iid = next_inst_id()

    items_content = ""
    for idx, item in enumerate(items):
        label = item["label"]
        vpos = idx * 1600
        # Interior items (not first and not last) use paraPrIDRef="11"
        if 0 < idx < n_items - 1:
            para_pr = "11"
        else:
            para_pr = "0"

        # Build content for this item
        item_run_content = f'<hp:t>{xml_escape(label)} </hp:t>'
        max_eq = (1000, 1000, 850, 600)
        for part in item["parts"]:
            if "eq" in part:
                item_run_content += make_equation_xml(part["eq"])
                params = lineseg_params_for_eq(part["eq"])
                if params[0] > max_eq[0]:
                    max_eq = params
            elif "t" in part:
                item_run_content += f'<hp:t>{xml_escape(part["t"])}</hp:t>'

        items_content += (f'<hp:p id="2147483648" paraPrIDRef="{para_pr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                         f'<hp:run charPrIDRef="3">{item_run_content}</hp:run>'
                         f'<hp:linesegarray><hp:lineseg textpos="0" vertpos="{vpos}" '
                         f'vertsize="{max_eq[0]}" textheight="{max_eq[1]}" baseline="{max_eq[2]}" '
                         f'spacing="{max_eq[3]}" horzpos="0" horzsize="27736" flags="393216"/>'
                         f'</hp:linesegarray></hp:p>')

    # Use condition_rect_template.xml as the structural base
    with open(f"{base_path}/condition_rect_template.xml", "r", encoding="utf-8") as f:
        template = f.read()

    rect_xml = template.replace("{{RECT_ID}}", str(rect_id))
    rect_xml = rect_xml.replace("{{ZORDER}}", str(zorder))
    rect_xml = rect_xml.replace("{{INST_ID}}", str(iid))
    rect_xml = rect_xml.replace("{{HEIGHT}}", str(height))
    rect_xml = rect_xml.replace("{{CENTER_Y}}", str(center_y))
    rect_xml = rect_xml.replace("{{SCA_Y}}", str(sca_y))
    rect_xml = rect_xml.replace("{{ITEMS_CONTENT}}", items_content)

    return rect_xml


def make_empty_box(condition_box, base_path):
    """서술형 빈 답안 박스 (empty_box_template.xml)"""
    height = condition_box.get("height", 5059)
    center_y = height // 2
    sca_y = round(height / 12587, 6)
    rect_id = next_eq_id()
    zorder = next_zorder()
    iid = next_inst_id()

    with open(f"{base_path}/empty_box_template.xml", encoding="utf-8") as f:
        tmpl = f.read()

    xml = tmpl.replace("{{RECT_ID}}", str(rect_id))
    xml = xml.replace("{{ZORDER}}", str(zorder))
    xml = xml.replace("{{INST_ID}}", str(iid))
    xml = xml.replace("{{HEIGHT}}", str(height))
    xml = xml.replace("{{CENTER_Y}}", str(center_y))
    xml = xml.replace("{{SCA_Y}}", str(sca_y))
    return xml


def make_proof_table(condition_box, base_path, replace_table_ids_fn):
    """[ 증 명 ] 테이블 (proof_table_template.xml)"""
    items = condition_box.get("items", [])

    with open(f"{base_path}/proof_table_template.xml", encoding="utf-8") as f:
        tbl_xml = f.read()

    tbl_xml = replace_table_ids_fn(tbl_xml)

    # 내용 문단 생성
    items_content = ""
    for idx, item in enumerate(items):
        content = ""
        max_eq = (1000, 1000, 850, 600)
        for part in item.get("parts", []):
            if "eq" in part:
                content += make_equation_xml(part["eq"])
                params = lineseg_params_for_eq(part["eq"])
                if params[0] > max_eq[0]:
                    max_eq = params
            elif "t" in part:
                content += f'<hp:t>{xml_escape(part["t"])}</hp:t>'
        vpos = idx * max_eq[0]
        items_content += (f'<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                         f'<hp:run charPrIDRef="1">{content}</hp:run>'
                         f'{make_lineseg(vpos, max_eq[0], max_eq[1], max_eq[2], max_eq[3])}'
                         f'</hp:p>')

    # 셀 [6] (colAddr=1, rowAddr=2) — 내용 영역에 주입
    cells = re.findall(r'<hp:tc .*?</hp:tc>', tbl_xml, re.DOTALL)
    content_height = max(len(items) * 1600 + 500, 2383)
    old_cell = cells[6]
    new_cell = re.sub(r'<hp:run charPrIDRef="\d+"/>',
                      f'<hp:run charPrIDRef="1">{items_content}</hp:run>',
                      old_cell, count=1)
    new_cell = re.sub(r'<hp:cellSz width="\d+" height="\d+"',
                      f'<hp:cellSz width="28096" height="{content_height}"',
                      new_cell, count=1)
    tbl_xml = tbl_xml.replace(old_cell, new_cell, 1)

    table_height = 963 + 963 + content_height + 580
    tbl_xml = re.sub(r'(heightRelTo="ABSOLUTE" protect="0"/>.*?<hp:sz[^>]+height=)"\d+"',
                     lambda m: m.group(0),  # 내부 sz는 유지
                     tbl_xml)
    tbl_xml = re.sub(r'(<hp:tbl\b.*?height=)"\d+"', lambda m: f'{m.group(1)}"{table_height}"',
                     tbl_xml, count=1)

    return tbl_xml


def png_to_bmp_bytes(png_path):
    """Convert PNG image to BMP bytes for HWPX"""
    img = Image.open(png_path)
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="BMP")
    return buf.getvalue()


def make_pic_xml(img_name, img_path):
    """Generate hp:pic for an image"""
    pic_id = next_eq_id()
    zorder = next_zorder()
    iid = next_inst_id()

    img = Image.open(img_path)
    w, h = img.size
    # Convert pixels to HWPUNIT (approx 75.59 per mm, 1 pixel ~ 7559/dpi ~ 75.59/dpi * 100)
    # For 200dpi: 1 pixel ~ 37.8 HWPUNIT. For simplicity use width relative to column
    hw_w = min(int(w * 37.8), 28000)
    hw_h = int(h * 37.8 * hw_w / (w * 37.8))

    binaryItemIDRef = img_name.replace(".bmp", "").replace(".png", "")

    return (f'<hp:pic id="{pic_id}" zOrder="{zorder}" numberingType="PICTURE" '
            f'textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" '
            f'href="" groupLevel="0" instid="{iid}" reverse="0">'
            f'<hp:offset x="0" y="0"/>'
            f'<hp:orgSz width="{hw_w}" height="{hw_h}"/>'
            f'<hp:curSz width="{hw_w}" height="{hw_h}"/>'
            f'<hp:flip horizontal="0" vertical="0"/>'
            f'<hp:rotationInfo angle="0" centerX="{hw_w // 2}" centerY="{hw_h // 2}" rotateimage="1"/>'
            f'<hp:renderingInfo>'
            f'<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            f'<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            f'<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            f'</hp:renderingInfo>'
            f'<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="{hw_w}" y="0"/>'
            f'<hc:pt2 x="{hw_w}" y="{hw_h}"/><hc:pt3 x="0" y="{hw_h}"/></hp:imgRect>'
            f'<hp:imgClip left="0" right="{hw_w}" top="0" bottom="{hw_h}"/>'
            f'<hp:inMargin left="0" right="0" top="0" bottom="0"/>'
            f'<hp:imgDim dimwidth="{hw_w}" dimheight="{hw_h}"/>'
            f'<hc:img binaryItemIDRef="{binaryItemIDRef}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>'
            f'<hp:effects/>'
            f'<hp:sz width="{hw_w}" widthRelTo="ABSOLUTE" height="{hw_h}" heightRelTo="ABSOLUTE" protect="0"/>'
            f'<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
            f'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" '
            f'vertOffset="0" horzOffset="0"/>'
            f'<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
            f'<hp:shapeComment>그림입니다.</hp:shapeComment>'
            f'</hp:pic>')
