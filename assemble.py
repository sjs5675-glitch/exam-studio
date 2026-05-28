#!/usr/bin/env python3
"""
HWPX Builder — Paragraph/endnote/choices assembly + ZIP packaging (main entry)

Import direction: ids → equation → shapes → tables → assemble → build_hwpx
"""

import json
import os
import re
import sys
import zipfile
from datetime import datetime

import ids as _ids
from equation import (
    xml_escape, make_equation_xml, lineseg_params_for_eq, make_lineseg,
    _is_hwp_eq_string, estimate_eq_width,
)
from shapes import make_condition_rect, make_ganada_table, make_empty_box, make_pic_xml, png_to_bmp_bytes
from tables import (
    make_data_table_xml, make_increase_decrease_table,
    make_synthetic_division_table, make_syn_div_table, make_pascal_table,
    make_choice_table, make_bogi_table, make_proof_table_wrapped,
)

# === Paths ===
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_BASE = os.path.join(SCRIPT_DIR, "resources", "hwpx_base")


# === Choice number symbols ===
CHOICE_SYMBOLS = ["①", "②", "③", "④", "⑤"]

DEFAULT_LINE_PARAMS = (1000, 1000, 850, 600)
PROBLEM_LINE_MAX_UNITS = 26000
CHOICE_LINE_MAX_UNITS = 25000
PROBLEM_NUMBER_UNITS = 1900
TAB_UNITS = 2000


def estimate_text_units(text):
    total = 0
    for ch in str(text or ""):
        code = ord(ch)
        if ch.isspace():
            total += 260
        elif (
            0xAC00 <= code <= 0xD7AF or
            0x3130 <= code <= 0x318F or
            0x4E00 <= code <= 0x9FFF or
            0x3040 <= code <= 0x30FF
        ):
            total += 620
        elif ch in ",.;:!?()[]{}<>/\\-+*=~'\"":
            total += 260
        else:
            total += 360
    return total


def make_multiline_lineseg(line_starts, vertsize=1000, textheight=1000,
                           baseline=850, spacing=600, horzsize=30188):
    starts = line_starts or [0]
    entries = []
    line_step = vertsize + spacing
    for idx, textpos in enumerate(starts):
        entries.append(
            f'<hp:lineseg textpos="{max(0, int(textpos))}" vertpos="{idx * line_step}" '
            f'vertsize="{vertsize}" textheight="{textheight}" baseline="{baseline}" '
            f'spacing="{spacing}" horzpos="0" horzsize="{horzsize}" flags="393216"/>'
        )
    return f'<hp:linesegarray>{"".join(entries)}</hp:linesegarray>'


def flow_parts_to_content_and_lines(parts, first_prefix_units=0, max_units=PROBLEM_LINE_MAX_UNITS):
    content = ""
    max_eq_params = DEFAULT_LINE_PARAMS
    line_starts = [0]
    line_units = first_prefix_units
    textpos = 0
    last_text_char = ""
    has_body = False

    def start_new_line():
        nonlocal line_units
        if line_starts[-1] != textpos:
            line_starts.append(textpos)
        line_units = 0

    def account_text(text):
        nonlocal line_units, textpos, last_text_char, has_body
        for ch in text:
            unit = estimate_text_units(ch)
            if has_body and line_units + unit > max_units:
                start_new_line()
            line_units += unit
            textpos += 1
            if not ch.isspace():
                last_text_char = ch
                has_body = True

    for part in parts or []:
        if "eq" in part:
            eq_script = part["eq"]
            unit_width = estimate_eq_width(eq_script)
            if part.get("indent"):
                if has_body and line_units + TAB_UNITS > max_units:
                    start_new_line()
                content += '<hp:tab width="2000" leader="0" type="1"/>'
                line_units += TAB_UNITS
                textpos += 1
            if has_body and line_units + unit_width > max_units:
                start_new_line()
            content += make_equation_xml(eq_script)
            line_units += unit_width
            textpos += 1
            has_body = True
            params = lineseg_params_for_eq(eq_script)
            if params[0] > max_eq_params[0]:
                max_eq_params = params
        elif "t" in part:
            text = part["t"].replace("\n", " ")
            if has_body and last_text_char in ".?!" and text and not text[0].isspace():
                text = " " + text
            if not text:
                continue
            content += f'<hp:t>{xml_escape(text)}</hp:t>'
            account_text(text)

    return content, max_eq_params, line_starts


def make_flow_part_paragraphs(
    parts,
    first_prefix="",
    first_prefix_units=0,
    para_id="2147483648",
    paraPrIDRef="0",
    charPrIDRef="1",
    max_units=PROBLEM_LINE_MAX_UNITS,
):
    content, max_eq, line_starts = flow_parts_to_content_and_lines(
        parts,
        first_prefix_units=first_prefix_units,
        max_units=max_units,
    )
    content = first_prefix + content
    lineseg_xml = make_multiline_lineseg(
        line_starts,
        vertsize=max_eq[0],
        textheight=max_eq[1],
        baseline=max_eq[2],
        spacing=max_eq[3],
    )
    return [make_paragraph(
        content=content,
        para_id=para_id,
        paraPrIDRef=paraPrIDRef,
        charPrIDRef=charPrIDRef,
        vertsize=max_eq[0],
        textheight=max_eq[1],
        baseline=max_eq[2],
        spacing=max_eq[3],
        lineseg_xml=lineseg_xml,
    )]


def make_paragraph(content="", para_id="2147483648", paraPrIDRef="0", charPrIDRef="1",
                   pageBreak="0", columnBreak="0", vertpos=0,
                   vertsize=1000, textheight=1000, baseline=850, spacing=600,
                   horzsize=30188, lineseg_xml=None):
    lineseg = lineseg_xml or make_lineseg(vertpos, vertsize, textheight, baseline, spacing, horzsize)
    if content:
        return (f'<hp:p id="{para_id}" paraPrIDRef="{paraPrIDRef}" styleIDRef="0" '
                f'pageBreak="{pageBreak}" columnBreak="{columnBreak}" merged="0">'
                f'<hp:run charPrIDRef="{charPrIDRef}">{content}</hp:run>'
                f'{lineseg}'
                f'</hp:p>')
    else:
        return (f'<hp:p id="{para_id}" paraPrIDRef="{paraPrIDRef}" styleIDRef="0" '
                f'pageBreak="{pageBreak}" columnBreak="{columnBreak}" merged="0">'
                f'<hp:run charPrIDRef="{charPrIDRef}"/>'
                f'{lineseg}'
                f'</hp:p>')


def make_empty_para(para_id="0"):
    return make_paragraph(content="", para_id=para_id, charPrIDRef="1",
                         vertsize=1000, textheight=1000, baseline=850, spacing=600)


def make_colbreak():
    return make_paragraph(content="", para_id="2147483648", paraPrIDRef="1", charPrIDRef="7",
                         columnBreak="1", vertsize=1000, textheight=1000, baseline=850, spacing=600)


def make_pagebreak():
    return make_paragraph(content="", para_id="2147483648", paraPrIDRef="1", charPrIDRef="7",
                         pageBreak="1", vertsize=1000, textheight=1000, baseline=850, spacing=600)


def make_tab3():
    return ('<hp:tab width="4000" leader="0" type="1"/>'
            '<hp:tab width="4000" leader="0" type="1"/>'
            '<hp:tab width="4000" leader="0" type="1"/>')


def make_bogi_choice_gap():
    """Compact gap for ㄱㄴㄷ answer-combination choices."""
    return '<hp:t>        </hp:t>'


def is_short_choice(choices):
    """Check if choices are short (equation only, no text)"""
    if choices is None:
        return False
    for c in choices:
        for part in c:
            if "t" in part:
                return False
    return True


def make_choices_xml(choices, force_compact=False):
    """Generate choice paragraphs"""
    if not choices:
        return ""

    paragraphs = []
    compact_gap = make_bogi_choice_gap() if force_compact else f'<hp:t>{make_tab3()}</hp:t>'

    if force_compact or is_short_choice(choices):
        # 3+2 pattern with tabs
        # Line 1: ①②③
        line1_content = ""
        max_eq_params1 = (1000, 1000, 850, 600)
        for i in range(min(3, len(choices))):
            if i > 0:
                line1_content += compact_gap
            sym = CHOICE_SYMBOLS[i]
            line1_content += f'<hp:t>{sym} </hp:t>'
            for part in choices[i]:
                if "eq" in part:
                    line1_content += make_equation_xml(part["eq"])
                    params = lineseg_params_for_eq(part["eq"])
                    if params[0] > max_eq_params1[0]:
                        max_eq_params1 = params
                elif "t" in part:
                    line1_content += f'<hp:t>{xml_escape(part["t"])}</hp:t>'

        p1 = (f'<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
              f'<hp:run charPrIDRef="1">{line1_content}</hp:run>'
              f'{make_lineseg(0, max_eq_params1[0], max_eq_params1[1], max_eq_params1[2], max_eq_params1[3])}'
              f'</hp:p>')
        paragraphs.append(p1)

        # Line 2: ④⑤
        if len(choices) > 3:
            line2_content = ""
            max_eq_params2 = (1000, 1000, 850, 600)
            for i in range(3, len(choices)):
                if i > 3:
                    line2_content += compact_gap
                sym = CHOICE_SYMBOLS[i]
                line2_content += f'<hp:t>{sym} </hp:t>'
                for part in choices[i]:
                    if "eq" in part:
                        line2_content += make_equation_xml(part["eq"])
                        params = lineseg_params_for_eq(part["eq"])
                        if params[0] > max_eq_params2[0]:
                            max_eq_params2 = params
                    elif "t" in part:
                        line2_content += f'<hp:t>{xml_escape(part["t"])}</hp:t>'

            p2 = (f'<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                  f'<hp:run charPrIDRef="1">{line2_content}</hp:run>'
                  f'{make_lineseg(0, max_eq_params2[0], max_eq_params2[1], max_eq_params2[2], max_eq_params2[3])}'
                  f'</hp:p>')
            paragraphs.append(p2)
    else:
        # Individual lines for each choice
        for i, choice_parts in enumerate(choices):
            first_prefix_text = f"{CHOICE_SYMBOLS[i]} "
            paragraphs.extend(make_flow_part_paragraphs(
                choice_parts,
                first_prefix=f'<hp:t>{first_prefix_text}</hp:t>',
                first_prefix_units=estimate_text_units(first_prefix_text),
                max_units=CHOICE_LINE_MAX_UNITS,
            ))

    return "".join(paragraphs)


def make_endnote(number, answer, explanation_parts, prob_type="choice", explanation_table=None, base_path=None):
    """Generate endNote XML"""
    inst_id = _ids.next_inst_id()

    ans_str = str(answer)
    if prob_type == "essay" and _is_hwp_eq_string(ans_str):
        answer_content = f'<hp:t> [정답] </hp:t>' + make_equation_xml(ans_str)
    else:
        answer_text = f' [정답] {ans_str}'
        answer_content = f'<hp:t>{xml_escape(answer_text)}</hp:t>'

    answer_run = (f'<hp:run charPrIDRef="11">'
                  f'<hp:ctrl><hp:autoNum num="{number}" numType="ENDNOTE">'
                  f'<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="." supscript="0"/>'
                  f'</hp:autoNum></hp:ctrl></hp:run>'
                  f'<hp:run charPrIDRef="1">{answer_content}</hp:run>')

    answer_p = (f'<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                f'{answer_run}'
                f'{make_lineseg(0, 1200, 1200, 1020, 720)}'
                f'</hp:p>')

    # Split explanation_parts by {"br": true}
    explanation_paragraphs = []
    current_parts = []
    for part in explanation_parts:
        if "br" in part and part.get("br") is True:
            if current_parts:
                explanation_paragraphs.append(current_parts)
                current_parts = []
        else:
            current_parts.append(part)
    if current_parts:
        explanation_paragraphs.append(current_parts)

    expl_xml = ""
    for parts_group in explanation_paragraphs:
        expl_xml += "".join(make_flow_part_paragraphs(
            parts_group,
            para_id="0",
            paraPrIDRef="0",
            charPrIDRef="1",
            max_units=PROBLEM_LINE_MAX_UNITS,
        ))

    # explanation_table (증감표, 조립제법 등) — explanation_parts 뒤에 삽입
    if explanation_table and base_path:
        et_type = explanation_table.get("type")
        tbl_xml = ""
        if et_type == "increase_decrease":
            tbl_xml = make_increase_decrease_table(explanation_table, base_path)
        elif et_type == "synthetic_division":
            tbl_xml = make_syn_div_table(explanation_table, base_path)
        elif et_type == "pascal":
            tbl_xml = make_pascal_table(explanation_table, base_path)
        if tbl_xml:
            expl_xml += (f'<hp:p id="0" paraPrIDRef="3" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                        f'<hp:run charPrIDRef="1">{tbl_xml}<hp:t/></hp:run>'
                        f'{make_lineseg(0, 1000, 1000, 850, 600)}'
                        f'</hp:p>')

    endnote = (f'<hp:ctrl><hp:endNote number="{number}" suffixChar="46" instId="{inst_id}">'
               f'<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" '
               f'linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" '
               f'hasTextRef="0" hasNumRef="0">'
               f'{answer_p}'
               f'{expl_xml}'
               f'</hp:subList></hp:endNote></hp:ctrl>')

    return endnote


def get_subtopic_name(subtopic):
    """Map subtopic to official unit_classification topic name"""
    mapping = {
        "확률분포": "확률분포",
        "이항분포": "이항분포",
        "정규분포": "정규분포",
        "통계적 추정": "통계적 추정",
        "조건부 확률": "조건부 확률",
        "조건부확률": "조건부 확률",
    }
    return mapping.get(subtopic, subtopic)


def _load_final_images(exam_data_path: str) -> dict:
    """Read figure_status.json (sibling of exam_data.json) and return {question_number: finalImage}."""
    cache_dir = os.path.dirname(os.path.abspath(exam_data_path))
    fs_path = os.path.join(cache_dir, "figure_status.json")
    if not os.path.exists(fs_path):
        return {}
    with open(fs_path, "r", encoding="utf-8") as f:
        status = json.load(f)
    result = {}
    for key, q in (status.get("questions") or {}).items():
        try:
            n = int(key)
        except ValueError:
            continue
        # 정본 finalImage, 폴백으로 legacy image (P3 호환)
        img = q.get("finalImage") or q.get("image")
        if img:
            result[n] = img
    return result


def main(exam_json=None, output_dir=None, base_path=None):
    """Main entry point: build HWPX from exam_data.json"""
    # Reset counters for clean per-build isolation
    _ids.reset_counters()

    if exam_json is None:
        exam_json = sys.argv[1] if len(sys.argv) > 1 else "/tmp/exam_data.json"
    if output_dir is None:
        output_dir = sys.argv[2] if len(sys.argv) > 2 else "outputs"
    if base_path is None:
        base_path = os.environ.get("EXAM_HWPX_BASE", DEFAULT_BASE)

    # === Load exam data ===
    with open(exam_json, "r", encoding="utf-8") as f:
        exam = json.load(f)

    info = exam["info"]
    problems = exam["problems"]

    # === Load figure_status.json (camelCase finalImage) ===
    final_images = _load_final_images(exam_json)

    # === Info substitutions ===
    YEAR_SEMESTER = f"{info['year']}년 {info['semester']} {info['examType']}"
    SCHOOL_NAME = info["school"]
    school_level = info["schoolLevel"]
    if school_level == "중":
        GRADE_SUBJECT = f"{info['grade']}학년"
    else:
        GRADE_SUBJECT = f"{info['grade']}학년 {info['subject']}"
    RANGE_STR = info.get("range", "")
    CREATED_DATE = datetime.now().strftime("%Y년 %m월 %d일")
    MODIFIED_DATE = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")

    # === Build section0.xml ===
    print("Building section0.xml...")

    with open(os.path.join(base_path, "header_area_template.xml"), "r", encoding="utf-8") as f:
        header_template = f.read()

    header_xml = header_template.replace("{{YEAR_SEMESTER}}", xml_escape(YEAR_SEMESTER))
    header_xml = header_xml.replace("{{SCHOOL_NAME}}", xml_escape(SCHOOL_NAME))
    header_xml = header_xml.replace("{{GRADE_SUBJECT}}", xml_escape(GRADE_SUBJECT))
    header_xml = header_xml.replace("{{RANGE}}", xml_escape(RANGE_STR))
    header_xml = header_xml.replace("{{CREATED_DATE}}", xml_escape(CREATED_DATE))

    problem_paras = []
    endnote_num = 1
    problem_count = 0
    essay_count = 0

    extra_images = []
    extra_image_counter = 9

    for prob in problems:
        num = prob["number"]
        ptype = prob["type"]
        score = prob["score"]
        parts = prob["parts"]
        choices = prob.get("choices")
        answer = prob["answer"]
        explanation = prob.get("explanation_parts", [])
        explanation_table = prob.get("explanation_table")
        condition_box = prob.get("condition_box")
        data_table = prob.get("data_table")
        has_figure = prob.get("has_figure", False)
        figure_info = prob.get("figure_info")

        # Determine if we need column/page breaks before this problem
        if problem_count > 0:
            if problem_count % 4 == 0:
                problem_paras.append(make_pagebreak())
            elif problem_count % 2 == 0:
                problem_paras.append(make_colbreak())

            if problem_count % 2 == 1:
                for _ in range(15):
                    problem_paras.append(make_empty_para())

        # --- Build problem paragraph ---
        if ptype == "essay":
            essay_count += 1

        # Generate endNote
        endnote_xml = make_endnote(endnote_num, answer, explanation, ptype, explanation_table, base_path)
        endnote_num += 1

        parts_has_marker = bool(parts) and parts[0].get("t", "").startswith("[서술형")
        prefix = f'<hp:t>[서술형 {essay_count}] </hp:t>' if ptype == "essay" and not parts_has_marker else ""

        problem_paras.extend(make_flow_part_paragraphs(
            parts,
            first_prefix=endnote_xml + prefix,
            first_prefix_units=PROBLEM_NUMBER_UNITS + (estimate_text_units("[essay 00] ") if prefix else 0),
            max_units=PROBLEM_LINE_MAX_UNITS,
        ))
        problem_paras.append(make_empty_para())

        # Figure — figure_status.json에서 finalImage 읽기 (figure_info["final_image"] 참조 폐기)
        img_path = final_images.get(num)
        if has_figure and img_path:
            if os.path.exists(img_path):
                img_name = f"image{extra_image_counter}"
                extra_image_counter += 1
                bmp_data = png_to_bmp_bytes(img_path)
                extra_images.append((f"{img_name}.bmp", bmp_data))

                pic_xml = make_pic_xml(f"{img_name}.bmp", img_path)
                pic_p = (f'<hp:p id="2147483648" paraPrIDRef="2" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                         f'<hp:run charPrIDRef="1">{pic_xml}<hp:t/></hp:run>'
                         f'{make_lineseg(0, 1000, 1000, 850, 600)}'
                         f'</hp:p>')
                problem_paras.append(pic_p)
                problem_paras.append(make_empty_para())

        # Condition box
        if condition_box:
            cond_type = condition_box.get("type", "condition")
            box_xml = None
            box_para_pr = "0"

            if cond_type == "condition":
                # (가)(나)(다) 라벨 패턴이면 ganada_table 사용, 그 외는 programmatic rect
                labels = [it.get("label", "") for it in condition_box.get("items", [])]
                is_ganada = bool(labels) and all(re.match(r'^\([가-힣]\)$', lbl) for lbl in labels)
                if is_ganada:
                    box_xml = make_ganada_table(condition_box, base_path)
                else:
                    box_xml = make_condition_rect(condition_box, base_path)
            elif cond_type == "image_choice":
                box_xml = make_condition_rect(condition_box, base_path)
            elif cond_type == "bogi":
                box_xml = make_bogi_table(condition_box, base_path)
                box_para_pr = "3"
            elif cond_type == "empty_box":
                box_xml = make_empty_box(condition_box, base_path)
            elif cond_type == "proof":
                box_xml = make_proof_table_wrapped(condition_box, base_path)
                box_para_pr = "3"
            elif cond_type == "choice_table":
                box_xml = make_choice_table(condition_box, base_path)
                box_para_pr = "3"

            if box_xml:
                box_p = (f'<hp:p id="2147483648" paraPrIDRef="{box_para_pr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                         f'<hp:run charPrIDRef="1">{box_xml}<hp:t/></hp:run>'
                         f'{make_lineseg(0, 1000, 1000, 850, 600)}'
                         f'</hp:p>')
                problem_paras.append(box_p)
                problem_paras.append(make_empty_para())

        # Data table
        if data_table:
            dt_label = ""
            if data_table["type"] == "normal_dist":
                dt_label = "<표준정규분포표>"

            if dt_label:
                label_p = make_paragraph(
                    content=f'<hp:t>{xml_escape(dt_label)}</hp:t>',
                    paraPrIDRef="3", charPrIDRef="1",
                    vertsize=1000, textheight=1000, baseline=850, spacing=600
                )
                problem_paras.append(label_p)

            tbl_xml = make_data_table_xml(data_table, base_path)
            tbl_p = (f'<hp:p id="2147483648" paraPrIDRef="3" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                     f'<hp:run charPrIDRef="1">{tbl_xml}<hp:t/></hp:run>'
                     f'{make_lineseg(0, 1000, 1000, 850, 600)}'
                     f'</hp:p>')
            problem_paras.append(tbl_p)
            problem_paras.append(make_empty_para())

        # Choices
        if ptype == "choice" and choices:
            force_compact_choices = bool(condition_box and condition_box.get("type") == "bogi")
            choices_xml = make_choices_xml(choices, force_compact=force_compact_choices)
            problem_paras.append(choices_xml)

        # Meta tags
        if info.get("showProblemMetadata", True):
            topic_name = get_subtopic_name(prob.get("subtopic", ""))
            meta_topic = make_paragraph(
                content=f'<hp:t>[중단원] {xml_escape(topic_name)}</hp:t>',
                charPrIDRef="2",
                vertsize=1000, textheight=1000, baseline=850, spacing=600
            )
            problem_paras.append(meta_topic)

            difficulty = prob.get("difficulty", "중")
            meta_diff = make_paragraph(
                content=f'<hp:t>[난이도] {xml_escape(difficulty)}</hp:t>',
                charPrIDRef="2",
                vertsize=1000, textheight=1000, baseline=850, spacing=600
            )
            problem_paras.append(meta_diff)

        problem_count += 1

    # Final breaks after last problem
    problem_paras.append(make_colbreak())
    problem_paras.append(make_pagebreak())

    # === Assemble section0.xml ===
    root_open = ('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>')
    section_xml = root_open + header_xml + "".join(problem_paras) + "</hs:sec>"

    # === Build content.hpf ===
    with open(os.path.join(base_path, "content_hpf_template.xml"), "r", encoding="utf-8") as f:
        hpf_template = f.read()

    extra_img_items = ""
    if extra_images:
        for img_name, _ in extra_images:
            item_id = img_name.replace(".bmp", "")
            extra_img_items += f'<opf:item id="{item_id}" href="BinData/{img_name}" media-type="image/bmp" isEmbeded="1"/>'

    hpf_xml = hpf_template.replace("{{MODIFIED_DATE}}", MODIFIED_DATE)
    hpf_xml = hpf_xml.replace("{{EXTRA_IMAGES}}", extra_img_items)

    # === Build PrvText.txt ===
    prv_lines = []
    for prob in problems:
        line = ""
        for part in prob["parts"]:
            if "t" in part:
                line += part["t"]
            elif "eq" in part:
                line += part["eq"]
        prv_lines.append(line[:80])
    prv_text = "\n".join(prv_lines[:20])

    # === Output filename (with _ver{YYYYMMDD-HHMMSS} suffix) ===
    ver_suffix = datetime.now().strftime("_ver%Y%m%d-%H%M%S")
    filename = info["filenameBase"] + ver_suffix + ".hwpx"  # required (P2 assertCompleteMeta 보장)

    output_path = os.path.join(output_dir, filename)
    os.makedirs(output_dir, exist_ok=True)

    # === Write HWPX (ZIP) ===
    print(f"Writing HWPX to {output_path}...")

    with zipfile.ZipFile(output_path, 'w') as zout:
        zout.write(os.path.join(base_path, 'mimetype'), 'mimetype', compress_type=zipfile.ZIP_STORED)
        zout.write(os.path.join(base_path, 'version.xml'), 'version.xml', compress_type=zipfile.ZIP_STORED)

        zout.write(os.path.join(base_path, 'Contents', 'header.xml'), 'Contents/header.xml', compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(base_path, 'BinData', 'image1.bmp'), 'BinData/image1.bmp', compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(base_path, 'Contents', 'masterpage0.xml'), 'Contents/masterpage0.xml', compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(base_path, 'BinData', 'image2.bmp'), 'BinData/image2.bmp', compress_type=zipfile.ZIP_DEFLATED)
        for img_idx in range(3, 9):
            img_path = os.path.join(base_path, 'BinData', f'image{img_idx}.bmp')
            if os.path.exists(img_path):
                zout.write(img_path, f'BinData/image{img_idx}.bmp', compress_type=zipfile.ZIP_DEFLATED)

        for img_name, img_data in extra_images:
            zout.writestr(f'BinData/{img_name}', img_data, compress_type=zipfile.ZIP_DEFLATED)

        zout.writestr('Contents/section0.xml', section_xml, compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr('Preview/PrvText.txt', prv_text.encode('utf-8'), compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(base_path, 'settings.xml'), 'settings.xml', compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(base_path, 'Preview', 'PrvImage.png'), 'Preview/PrvImage.png', compress_type=zipfile.ZIP_STORED)
        zout.write(os.path.join(base_path, 'META-INF', 'container.rdf'), 'META-INF/container.rdf', compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr('Contents/content.hpf', hpf_xml, compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(base_path, 'META-INF', 'container.xml'), 'META-INF/container.xml', compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(base_path, 'META-INF', 'manifest.xml'), 'META-INF/manifest.xml', compress_type=zipfile.ZIP_DEFLATED)

    print(f"HWPX written: {output_path}")
    print(f"Total problems: {problem_count} (choice: {problem_count - essay_count}, essay: {essay_count})")
    print(f"Extra images: {len(extra_images)}")
    return output_path


if __name__ == "__main__":
    main()
