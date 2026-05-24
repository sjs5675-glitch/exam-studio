#!/usr/bin/env python3
"""
Template Showcase HWPX Builder — 디버깅용 (확장판)

빌드 파이프라인의 "요소"를 네 단계로 펼쳐 시각 확인할 수 있는 HWPX 생성.

  A. SCAFFOLD          — header_area / content.hpf 등 컨테이너성 fixture (설명 노트)
  B. STATIC FIXTURES   — resources/hwpx_base/*.xml 18개 원형 (placeholder 보존)
  C. FIXTURE × 코드    — make_bogi_table / make_choice_table / make_data_table 등
                          maker 함수를 실제 데이터로 호출한 결과
  D. 순수 코드 생성    — make_equation_xml / make_pic_xml / make_endnote /
                          make_choices_xml / make_arrow / page break 등

사용:
    python3 tools/build_template_showcase.py [output_dir]

기본 출력: outputs/_TEMPLATE_SHOWCASE.hwpx
"""

import os
import re
import sys
import zipfile
from datetime import datetime

# 같은 디렉터리의 build modules 사용
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ids  # noqa: E402
from assemble import (  # noqa: E402
    make_paragraph, make_empty_para, make_pagebreak, make_colbreak,
    make_choices_xml, make_endnote, make_tab3,
)
from equation import (  # noqa: E402
    make_lineseg, make_equation_xml, lineseg_params_for_eq,
)
from shapes import (  # noqa: E402
    make_condition_rect, make_empty_box, make_pic_xml,
)
from tables import (  # noqa: E402
    make_bogi_table, make_choice_table, make_data_table_xml,
    make_increase_decrease_table, make_synthetic_division_table,
    make_syn_div_table, make_pascal_table,
    make_proof_table_wrapped, _replace_table_ids,
)

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get(
    "EXAM_HWPX_BASE", os.path.join(SCRIPT_DIR, "resources", "hwpx_base")
)

SCAFFOLD_FILES = {
    "content_hpf_template.xml",
    "header_area_template.xml",
    "root_element.xml",
    "settings.xml",
    "version.xml",
}


# === Section / label helpers =================================================

def section_header(label: str) -> str:
    return make_paragraph(
        content=f'<hp:t>════════ {label} ════════</hp:t>',
        paraPrIDRef="0", charPrIDRef="1",
        vertsize=1600, textheight=1600, baseline=1360, spacing=800,
    )


def item_label(text: str) -> str:
    return make_paragraph(
        content=f'<hp:t>━━ {text} ━━</hp:t>',
        paraPrIDRef="0", charPrIDRef="1",
        vertsize=1200, textheight=1200, baseline=1020, spacing=720,
    )


def note_para(text: str) -> str:
    return make_paragraph(
        content=f'<hp:t>{text}</hp:t>',
        paraPrIDRef="0", charPrIDRef="1",
        vertsize=1000, textheight=1000, baseline=850, spacing=600,
    )


def wrap_in_para(snippet_xml: str) -> str:
    return (
        '<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" '
        'pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="1">{snippet_xml}<hp:t/></hp:run>'
        f'{make_lineseg(0, 1000, 1000, 850, 600)}'
        '</hp:p>'
    )


def wrap_pic_in_para(pic_xml: str) -> str:
    """그림(hp:pic)을 paragraph로 감쌈 — 본 빌더의 그림 삽입 패턴."""
    return (
        '<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" '
        'pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="1">{pic_xml}<hp:t/></hp:run>'
        f'{make_lineseg(0, 6000, 6000, 5100, 600)}'
        '</hp:p>'
    )


# === A: SCAFFOLD =============================================================

def section_a_scaffold():
    paras = [section_header("A. SCAFFOLD (컨테이너성 fixture 안내)")]
    notes = [
        "header_area_template.xml — 이 문서 상단 머릿말이 그 결과입니다.",
        "content_hpf_template.xml — content.hpf 매니페스트 (본문에 렌더링 불가).",
        "root_element.xml — section 루트 (header_area 안에 흡수).",
        "settings.xml — HWPX 메타 (본문 렌더링 불가).",
        "version.xml — HWPX 버전 메타 (본문 렌더링 불가).",
    ]
    for n in notes:
        paras.append(note_para(n))
    paras.append(make_empty_para())
    return paras


# === B: STATIC FIXTURES ======================================================

def fill_placeholders(xml: str) -> str:
    """{{KEY}} 형식 placeholder 를 안전한 값으로 채운다.
    raw 표시 전용 — content placeholder 는 `[KEY]` literal 로 노출.
    """

    def repl(match):
        key = match.group(1)
        if key in {"RECT_ID", "INST_ID"}:
            return str(ids.next_eq_id())
        if key == "ZORDER":
            return str(ids.next_zorder())
        if key in {"HEIGHT", "CENTER_Y"}:
            return "6000"
        if key == "SCA_Y":
            return "1.0"
        if key == "ITEMS_CONTENT":
            return (
                '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" '
                'pageBreak="0" columnBreak="0" merged="0">'
                '<hp:run charPrIDRef="1"/>'
                '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" '
                'vertsize="1000" textheight="1000" baseline="850" spacing="600" '
                'horzpos="0" horzsize="28000" flags="393216"/></hp:linesegarray>'
                '</hp:p>'
            )
        return f"[{key}]"

    return re.sub(r"\{\{([A-Z_0-9]+)\}\}", repl, xml)


def section_b_static():
    paras = [section_header("B. STATIC FIXTURES (placeholder 보존)")]
    snippets = sorted(
        f for f in os.listdir(BASE)
        if f.endswith(".xml") and f not in SCAFFOLD_FILES
    )
    for name in snippets:
        path = os.path.join(BASE, name)
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
        filled = fill_placeholders(raw)
        if filled.lstrip().startswith("<hp:tbl"):
            filled = _replace_table_ids(filled)
        paras.append(item_label(name))
        paras.append(wrap_in_para(filled))
        paras.append(make_empty_para())
    return paras


# === C: FIXTURE × CODE =======================================================

def section_c_substituted():
    paras = [section_header("C. FIXTURE × 코드 치환 (실제 빌드 모습)")]

    # bogi_table 3 items
    bogi3 = {
        "items": [
            {"parts": [{"t": "샘플 ㄱ 텍스트"}]},
            {"parts": [{"eq": "x^2+1"}]},
            {"parts": [{"t": "샘플 ㄷ + "}, {"eq": "y=2x"}]},
        ]
    }
    paras.append(item_label("make_bogi_table — 3 items"))
    paras.append(wrap_in_para(make_bogi_table(bogi3, BASE)))
    paras.append(make_empty_para())

    # bogi_box 4 items (bogi_box_4items.xml)
    bogi4 = {
        "items": [
            {"parts": [{"t": "샘플 ㄱ 텍스트"}]},
            {"parts": [{"eq": "x^2+1"}]},
            {"parts": [{"t": "샘플 ㄷ + "}, {"eq": "y=2x"}]},
            {"parts": [{"t": "샘플 ㄹ"}, {"eq": "a+b=c"}]},
        ]
    }
    paras.append(item_label("make_bogi_table — 4 items (bogi_box_4items.xml)"))
    paras.append(wrap_in_para(make_bogi_table(bogi4, BASE)))
    paras.append(make_empty_para())

    # bogi_table 6 items
    bogi6 = {
        "items": [
            {"parts": [{"t": f"항목 {i+1}"}]} for i in range(6)
        ]
    }
    paras.append(item_label("make_bogi_table — 6 items"))
    paras.append(wrap_in_para(make_bogi_table(bogi6, BASE)))
    paras.append(make_empty_para())

    # choice_table — 5x5
    # 명제 템플릿 — col=0 의 ①~⑤ 라벨 + col=1 의 'p:' 수식 + col=3 의 'q:' 수식 fixture 보존.
    # col=2 (가정 내용) 와 col=4 (결론 내용) 만 명제별로 주입.
    ct5x5 = {
        "table_type": "5x5",
        "rows": [
            ["", "", "x > 0",          "", "x^2 > 0"],
            ["", "", "n 이 짝수",      "", "n^2 이 짝수"],
            ["", "", "ab = 0",         "", "a = 0 또는 b = 0"],
            ["", "", "x > 1",          "", "x > 0"],
            ["", "", "유리수",         "", "분수로 표현 가능"],
        ],
    }
    paras.append(item_label("make_choice_table — 5x5"))
    paras.append(wrap_in_para(make_choice_table(ct5x5, BASE)))
    paras.append(make_empty_para())

    # choice_table — 6x3
    # 헤더 1행 + 1열 라벨 fixture 보존. row=1~5, col=1~2 만 채움.
    ct6x3 = {
        "table_type": "6x3",
        "rows": [
            ["", "", ""],                                     # row 0: 헤더 보존 (모두 빈 값으로 skip)
            ["", "데이터 1-1", "데이터 1-2"],
            ["", "데이터 2-1", "데이터 2-2"],
            ["", "데이터 3-1", "데이터 3-2"],
            ["", "데이터 4-1", "데이터 4-2"],
            ["", "데이터 5-1", "데이터 5-2"],
        ],
    }
    paras.append(item_label("make_choice_table — 6x3"))
    paras.append(wrap_in_para(make_choice_table(ct6x3, BASE)))
    paras.append(make_empty_para())

    # choice_table — 6x4
    # 헤더 1행 + 1열 라벨 보존. row=1~5, col=1~3 만 채움.
    ct6x4 = {
        "table_type": "6x4",
        "rows": [
            ["", "", "", ""],
            ["", "데이터 1-A", "데이터 1-B", "데이터 1-C"],
            ["", "데이터 2-A", "데이터 2-B", "데이터 2-C"],
            ["", "데이터 3-A", "데이터 3-B", "데이터 3-C"],
            ["", "데이터 4-A", "데이터 4-B", "데이터 4-C"],
            ["", "데이터 5-A", "데이터 5-B", "데이터 5-C"],
        ],
    }
    paras.append(item_label("make_choice_table — 6x4"))
    paras.append(wrap_in_para(make_choice_table(ct6x4, BASE)))
    paras.append(make_empty_para())

    # choice_table — 9x4
    # col=0/col=2 의 원문자 fixture 보존. col=1/col=3 (rowSpan=3 이미지 placeholder) 에만 텍스트.
    # 보기 5개 — ① col=1 row=0, ② col=3 row=0, ③ col=1 row=3, ④ col=3 row=3, ⑤ col=1 row=6 (⑤ 짝 없음).
    ct9x4 = {
        "table_type": "9x4",
        "rows": [
            ["", "그림①", "", "그림②"],
            ["", "", "", ""],
            ["", "", "", ""],
            ["", "그림③", "", "그림④"],
            ["", "", "", ""],
            ["", "", "", ""],
            ["", "그림⑤", "", ""],
            ["", "", "", ""],
            ["", "", "", ""],
        ],
    }
    paras.append(item_label("make_choice_table — 9x4"))
    paras.append(wrap_in_para(make_choice_table(ct9x4, BASE)))
    paras.append(make_empty_para())

    # condition_rect — (가)/(나)/(다)
    cond_rect = {
        "items": [
            {"label": "(가)", "parts": [{"t": "f(x) = "}, {"eq": "x^2+1"}]},
            {"label": "(나)", "parts": [{"t": "g(x) = "}, {"eq": "2x-3"}]},
            {"label": "(다)", "parts": [{"t": "h(x) = f(g(x))"}]},
        ],
    }
    paras.append(item_label("make_condition_rect — (가)(나)(다)"))
    paras.append(wrap_in_para(make_condition_rect(cond_rect, BASE)))
    paras.append(make_empty_para())

    # empty_box — 서술형 빈 답안
    paras.append(item_label("make_empty_box — 서술형 빈 답란"))
    paras.append(wrap_in_para(make_empty_box({"height": 5059}, BASE)))
    paras.append(make_empty_para())

    # proof_table_wrapped — [증명]
    proof_box = {
        "items": [
            {"parts": [{"t": "1단계: 양변에 "}, {"eq": "x"}, {"t": "을 곱한다."}]},
            {"parts": [{"t": "2단계: 인수분해하면 "}, {"eq": "(x-1)(x+2)=0"}]},
            {"parts": [{"t": "3단계: 따라서 "}, {"eq": "x=1"}, {"t": " 또는 "}, {"eq": "x=-2"}]},
        ],
    }
    paras.append(item_label("make_proof_table_wrapped — [증명]"))
    paras.append(wrap_in_para(make_proof_table_wrapped(proof_box, BASE)))
    paras.append(make_empty_para())

    # data_table — normal_dist (3 rows)
    dt_normal = {
        "type": "normal_dist",
        "row_parts": [
            [[{"eq": "0.5"}], [{"eq": "0.1915"}]],
            [[{"eq": "1.0"}], [{"eq": "0.3413"}]],
            [[{"eq": "1.5"}], [{"eq": "0.4332"}]],
        ],
    }
    paras.append(item_label("make_data_table_xml — normal_dist (3 rows)"))
    paras.append(wrap_in_para(make_data_table_xml(dt_normal, BASE)))
    paras.append(make_empty_para())

    # data_table — probability (5 cols)
    dt_prob = {
        "type": "probability",
        "header_parts": [[{"eq": "0"}], [{"eq": "1"}], [{"eq": "2"}]],
        "row_parts": [[{"eq": "{1 over 4}"}], [{"eq": "{1 over 2}"}], [{"eq": "{1 over 4}"}]],
    }
    paras.append(item_label("make_data_table_xml — probability (5 cols)"))
    paras.append(wrap_in_para(make_data_table_xml(dt_prob, BASE)))
    paras.append(make_empty_para())

    # increase_decrease (1-x: 4 cols)
    inc_dec_1x = {
        "x_values": ["1"],
        "rows": [
            {"values": ["+", "0", "-"]},
            {"values": ["↗", "극대", "↘"]},
        ],
    }
    paras.append(item_label("make_increase_decrease_table — 1-x"))
    paras.append(wrap_in_para(make_increase_decrease_table(inc_dec_1x, BASE)))
    paras.append(make_empty_para())

    # increase_decrease (2-x: 6 cols)
    inc_dec_2x = {
        "x_values": ["-1", "3"],
        "rows": [
            {"values": ["+", "0", "-", "0", "+"]},
            {"values": ["↗", "극대", "↘", "극소", "↗"]},
        ],
    }
    paras.append(item_label("make_increase_decrease_table — 2-x"))
    paras.append(wrap_in_para(make_increase_decrease_table(inc_dec_2x, BASE)))
    paras.append(make_empty_para())

    # increase_decrease (3-x: 8 cols — inc_dec_3x.xml)
    inc_dec_3x = {
        "x_values": ["-1", "1", "3"],
        "rows": [
            {"values": ["+", "0", "-", "0", "+", "0", "-"]},
            {"values": ["↗", "극대", "↘", "극소", "↗", "극대", "↘"]},
            {"values": ["+", "0", "-", "0", "+", "0", "-"]},
        ],
    }
    paras.append(item_label("make_increase_decrease_table — 3-x (inc_dec_3x.xml)"))
    paras.append(wrap_in_para(make_increase_decrease_table(inc_dec_3x, BASE)))
    paras.append(make_empty_para())

    # increase_decrease (4-x: 12 cols — inc_dec_4x.xml)
    inc_dec_4x = {
        "x_values": ["-2", "-1", "1", "3"],
        "rows": [
            {"values": ["+", "0", "-", "0", "+", "0", "-", "0", "+"]},
            {"values": ["↗", "극대", "↘", "극소", "↗", "극대", "↘", "극소", "↗"]},
            {"values": ["-", "0", "+", "0", "-", "0", "+", "0", "-"]},
            {"values": ["↘", "극소", "↗", "극대", "↘", "극소", "↗", "극대", "↘"]},
        ],
    }
    paras.append(item_label("make_increase_decrease_table — 4-x (inc_dec_4x.xml)"))
    paras.append(wrap_in_para(make_increase_decrease_table(inc_dec_4x, BASE)))
    paras.append(make_empty_para())

    # synthetic_division (레거시 alias)
    syn_div_legacy = {
        "divisor": "2",
        "coefficients": ["1", "-3", "0", "4"],
        "result": ["1", "-1", "-2", "0"],
    }
    paras.append(item_label("make_synthetic_division_table — 조립제법 (레거시)"))
    paras.append(wrap_in_para(make_synthetic_division_table(syn_div_legacy, BASE)))
    paras.append(make_empty_para())

    # ── 신규 type tag 기반 make_choice_table 호출 ──────────────────────────

    # proposition (pq_proposition_table_5x5.xml) — 명제 가정/결론 5행
    ct_proposition = {
        "table_type": "proposition",
        "rows": [
            ["", "", "x > 0",          "", "x^2 > 0"],
            ["", "", "n 이 짝수",      "", "n^2 이 짝수"],
            ["", "", "ab = 0",         "", "a = 0 또는 b = 0"],
            ["", "", "x > 1",          "", "x > 0"],
            ["", "", "유리수",         "", "분수로 표현 가능"],
        ],
    }
    paras.append(item_label("make_choice_table — proposition (pq_proposition_table_5x5.xml)"))
    paras.append(wrap_in_para(make_choice_table(ct_proposition, BASE)))
    paras.append(make_empty_para())

    # choice_image (choice_image_5options.xml) — 그림 선지 5개
    ct_choice_image = {
        "table_type": "choice_image",
        "rows": [
            ["", "그림①", "", "그림②"],
            ["", "", "", ""],
            ["", "", "", ""],
            ["", "그림③", "", "그림④"],
            ["", "", "", ""],
            ["", "", "", ""],
            ["", "그림⑤", "", ""],
            ["", "", "", ""],
            ["", "", "", ""],
        ],
    }
    paras.append(item_label("make_choice_table — choice_image (choice_image_5options.xml)"))
    paras.append(wrap_in_para(make_choice_table(ct_choice_image, BASE)))
    paras.append(make_empty_para())

    # choice_grid_2cols (choice_grid_2cols.xml) — 2열 그리드
    ct_grid_2cols = {
        "table_type": "choice_grid_2cols",
        "rows": [
            ["", "", ""],
            ["", "그리드2-1-A", "그리드2-1-B"],
            ["", "그리드2-2-A", "그리드2-2-B"],
            ["", "그리드2-3-A", "그리드2-3-B"],
            ["", "그리드2-4-A", "그리드2-4-B"],
            ["", "그리드2-5-A", "그리드2-5-B"],
        ],
    }
    paras.append(item_label("make_choice_table — choice_grid_2cols (choice_grid_2cols.xml)"))
    paras.append(wrap_in_para(make_choice_table(ct_grid_2cols, BASE)))
    paras.append(make_empty_para())

    # choice_grid_3cols (choice_grid_3cols.xml) — 3열 그리드
    ct_grid_3cols = {
        "table_type": "choice_grid_3cols",
        "rows": [
            ["", "", "", ""],
            ["", "그리드3-1-A", "그리드3-1-B", "그리드3-1-C"],
            ["", "그리드3-2-A", "그리드3-2-B", "그리드3-2-C"],
            ["", "그리드3-3-A", "그리드3-3-B", "그리드3-3-C"],
            ["", "그리드3-4-A", "그리드3-4-B", "그리드3-4-C"],
            ["", "그리드3-5-A", "그리드3-5-B", "그리드3-5-C"],
        ],
    }
    paras.append(item_label("make_choice_table — choice_grid_3cols (choice_grid_3cols.xml)"))
    paras.append(wrap_in_para(make_choice_table(ct_grid_3cols, BASE)))
    paras.append(make_empty_para())

    # ── make_syn_div_table — 신규 가변 조립제법 (equation dict 형식 입력) ──────

    def _resolve_cell(cell):
        """reference doc 명세 형식의 셀 dict 를 generator 가 기대하는 문자열로 변환.

        {"type":"equation","script":"x^2"} → "x^2"   (equation 경로)
        {"type":"text","value":"-3"}       → "-3"     (text 경로)
        str/int 등 기존 형식              → str(cell)  (하위 호환)
        """
        if isinstance(cell, dict):
            if cell.get("type") == "equation":
                return cell.get("script", "")
            if cell.get("type") == "text":
                return cell.get("value", "")
        return str(cell)

    # deg=3: x^3 - 2x^2 + 3x - 4 를 (x-1) 로 나누기 — equation dict 혼합
    syn_deg3_cells = [
        # row 0: 나눗수 + 계수 (나눗수 "1" 은 text, 계수는 부호 있는 정수 → text)
        [{"type":"text","value":"1"}, {"type":"text","value":"1"}, {"type":"text","value":"-2"}, {"type":"text","value":"3"}, {"type":"text","value":"-4"}],
        # row 1: 곱셈 행
        [{"type":"text","value":""}, {"type":"text","value":"1"}, {"type":"text","value":"-1"}, {"type":"text","value":"2"}, {"type":"text","value":""}],
        # row 2: 구분선 (빈 행)
        [{"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}],
        # row 3: 결과 행
        [{"type":"text","value":""}, {"type":"text","value":"1"}, {"type":"text","value":"-1"}, {"type":"text","value":"2"}, {"type":"text","value":"-2"}],
    ]

    # deg=4: 계수 일부에 equation 포함 (k+1 등)
    syn_deg4_cells = [
        [{"type":"text","value":"2"}, {"type":"equation","script":"k + 1"}, {"type":"text","value":"-3"}, {"type":"text","value":"0"}, {"type":"text","value":"4"}, {"type":"text","value":"-2"}],
        [{"type":"text","value":""}, {"type":"text","value":"2"}, {"type":"equation","script":"2k + 6"}, {"type":"text","value":"-6"}, {"type":"text","value":"4"}, {"type":"text","value":""}],
        [{"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}],
        [{"type":"text","value":""}, {"type":"equation","script":"k + 3"}, {"type":"text","value":"3"}, {"type":"text","value":"-6"}, {"type":"text","value":"2"}, {"type":"text","value":"-2"}],
        [{"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}, {"type":"text","value":""}],
    ]

    # deg=5: 순수 정수 계수
    syn_deg5_cells = [
        [{"type":"text","value":"3"}] + [{"type":"text","value":str(v)} for v in [1, -2, 0, 3, -1, 6]],
        [{"type":"text","value":""}] + [{"type":"text","value":str(v)} for v in [3, 3, 9, 27, 78]],
        [{"type":"text","value":""}] * 7,
        [{"type":"text","value":""}] + [{"type":"text","value":str(v)} for v in [1, 1, 3, 9, 26, 84]],
        [{"type":"text","value":""}] * 7,
        [{"type":"text","value":""}] * 7,
    ]

    # deg=6: 순수 정수 계수
    syn_deg6_cells = [
        [{"type":"text","value":"-1"}] + [{"type":"text","value":str(v)} for v in [1, 0, -3, 2, 0, -1, 4]],
        [{"type":"text","value":""}] + [{"type":"text","value":str(v)} for v in [-1, 1, 2, -4, 4, -3]],
        [{"type":"text","value":""}] * 8,
        [{"type":"text","value":""}] + [{"type":"text","value":str(v)} for v in [1, -1, -2, 4, -4, 3]],
        [{"type":"text","value":""}] * 8,
        [{"type":"text","value":""}] * 8,
        [{"type":"text","value":""}] * 8,
    ]

    for deg, raw_cells in [(3, syn_deg3_cells), (4, syn_deg4_cells), (5, syn_deg5_cells), (6, syn_deg6_cells)]:
        n_rows_d = len(raw_cells)
        n_cols_d = max(len(r) for r in raw_cells)
        # 셀 dict → 문자열 변환 (generator 가 기대하는 형식)
        rows_2d = [[_resolve_cell(c) for c in row] for row in raw_cells]
        syn_data = {
            "type": "synthetic_division",
            "degree": deg,
            "n_rows": n_rows_d,
            "n_cols": n_cols_d,
            "rows": rows_2d,
        }
        paras.append(item_label(f"make_syn_div_table — deg={deg} (equation dict 입력, {n_rows_d}행×{n_cols_d}열)"))
        paras.append(wrap_in_para(make_syn_div_table(syn_data, BASE)))
        paras.append(make_empty_para())

    # ── make_pascal_table — 신규 파스칼 삼각형 (equation dict 형식 입력) ─────

    for n_rows in [5, 7, 9]:
        # reference doc 명세 형식: 각 셀을 equation dict 로 구성 ({} _{r} rm C _{c})
        cells_dicts = [
            [{"type": "equation", "script": f"{{}} _{{r}} rm C _{{c}}".replace("{r}", str(r)).replace("{c}", str(c))}
             for c in range(r + 1)]
            for r in range(n_rows)
        ]
        # dict → 스크립트 문자열 변환
        cells_resolved = [[_resolve_cell(cell) for cell in row] for row in cells_dicts]
        pascal_data = {
            "type": "pascal",
            "n_rows": n_rows,
            "cells": cells_resolved,
        }
        paras.append(item_label(f"make_pascal_table — n_rows={n_rows} (equation dict 입력, binomial 표기)"))
        paras.append(wrap_in_para(make_pascal_table(pascal_data, BASE)))
        paras.append(make_empty_para())

    return paras


# === D: PURE CODE ============================================================

def section_d_code():
    paras = [section_header("D. 순수 코드 생성 (fixture 없음)")]

    # Equations
    eq_samples = [
        ("단순 다항식: x^2 + 1", "x^2+1"),
        ("분수: 1/2", "{1 over 2}"),
        ("제곱근: sqrt{x}", "sqrt{x}"),
        ("정적분: int_0^1 x dx", "int_0^1 x dx"),
        ("이항계수: nCr", "{rmC}_{r} LSUB {n}"),
    ]
    for label, script in eq_samples:
        paras.append(item_label(f"make_equation_xml — {label}"))
        eq_xml = make_equation_xml(script)
        p = lineseg_params_for_eq(script)
        para = (
            '<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" '
            'pageBreak="0" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="1">{eq_xml}<hp:t/></hp:run>'
            f'{make_lineseg(0, p[0], p[1], p[2], p[3])}'
            '</hp:p>'
        )
        paras.append(para)
        paras.append(make_empty_para())

    # make_pic_xml — BinData/image3.bmp (3번 이상은 안전하게 비어있을 수 있어 확인)
    sample_imgs = [f"image{i}.bmp" for i in range(3, 9)]
    pic_path = None
    pic_name = None
    for img_name in sample_imgs:
        candidate = os.path.join(BASE, "BinData", img_name)
        if os.path.exists(candidate):
            pic_path = candidate
            pic_name = img_name
            break
    if pic_path:
        paras.append(item_label(f"make_pic_xml — {pic_name}"))
        try:
            pic_xml = make_pic_xml(pic_name, pic_path)
            paras.append(wrap_pic_in_para(pic_xml))
        except Exception as e:  # noqa: BLE001
            paras.append(note_para(f"  (실패: {e})"))
        paras.append(make_empty_para())

    # make_choices_xml — short
    short_choices = [[{"eq": "x"}], [{"eq": "y"}], [{"eq": "z"}], [{"eq": "w"}], [{"eq": "v"}]]
    paras.append(item_label("make_choices_xml — short (3+2 with tab3)"))
    paras.append(make_choices_xml(short_choices))
    paras.append(make_empty_para())

    # make_choices_xml — long
    long_choices = [
        [{"t": "첫 번째 선지의 긴 설명"}],
        [{"t": "두 번째 선지 텍스트"}],
        [{"t": "세 번째 + "}, {"eq": "x^2"}],
        [{"t": "네 번째 선지"}],
        [{"t": "다섯 번째 선지"}],
    ]
    paras.append(item_label("make_choices_xml — long (5 separate lines)"))
    paras.append(make_choices_xml(long_choices))
    paras.append(make_empty_para())

    # make_endnote — choice 정답
    paras.append(item_label("make_endnote — choice (정답 ③)"))
    endnote_choice = make_endnote(
        number=1, answer="③",
        explanation_parts=[{"t": "주어진 식을 정리하면 "}, {"eq": "x=3"}, {"t": ", 따라서 정답은 ③이다."}],
        prob_type="choice", base_path=BASE,
    )
    paras.append(wrap_in_para(endnote_choice))
    paras.append(make_empty_para())

    # make_endnote — essay 정답 + 증감표
    paras.append(item_label("make_endnote — essay + increase_decrease 설명표"))
    endnote_essay = make_endnote(
        number=2, answer="12",
        explanation_parts=[{"t": "f'(x) = 0 을 풀면 x = -1, 3 이다."}],
        prob_type="essay",
        explanation_table={
            "type": "increase_decrease",
            "x_values": ["-1", "3"],
            "rows": [
                {"values": ["+", "0", "-", "0", "+"]},
                {"values": ["↗", "극대", "↘", "극소", "↗"]},
            ],
        },
        base_path=BASE,
    )
    paras.append(wrap_in_para(endnote_essay))
    paras.append(make_empty_para())

    # Arrow equations (NEARROW / SEARROW)
    for arrow in ["NEARROW", "SEARROW"]:
        paras.append(item_label(f"make_equation_xml — {arrow}"))
        eq_xml = make_equation_xml(arrow)
        para = (
            '<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" '
            'pageBreak="0" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="1">{eq_xml}<hp:t/></hp:run>'
            f'{make_lineseg(0, 1000, 1000, 850, 600)}'
            '</hp:p>'
        )
        paras.append(para)
        paras.append(make_empty_para())

    # make_tab3 — paragraph 안 탭 시연
    paras.append(item_label("make_tab3 — 3-tab 간격 (선지 정렬용)"))
    tab_para = (
        '<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" '
        'pageBreak="0" columnBreak="0" merged="0">'
        '<hp:run charPrIDRef="1">'
        '<hp:t>A</hp:t>'
        f'<hp:t>{make_tab3()}</hp:t>'
        '<hp:t>B</hp:t>'
        f'<hp:t>{make_tab3()}</hp:t>'
        '<hp:t>C</hp:t>'
        '</hp:run>'
        f'{make_lineseg(0, 1000, 1000, 850, 600)}'
        '</hp:p>'
    )
    paras.append(tab_para)
    paras.append(make_empty_para())

    # column / page break — 직전에 라벨, break 직후 라벨로 효과 확인
    paras.append(item_label("make_colbreak — 다음 줄에 컬럼 break"))
    paras.append(make_colbreak())
    paras.append(note_para("(컬럼 break 후 첫 paragraph)"))
    paras.append(make_empty_para())

    paras.append(item_label("make_pagebreak — 다음 줄에 페이지 break"))
    paras.append(make_pagebreak())
    paras.append(note_para("(페이지 break 후 첫 paragraph — 새 페이지 상단에 위치해야 함)"))
    paras.append(make_empty_para())

    return paras


# === Assembly ================================================================

def build_section() -> str:
    header_path = os.path.join(BASE, "header_area_template.xml")
    with open(header_path, "r", encoding="utf-8") as f:
        header_template = f.read()
    header_xml = header_template
    for placeholder in ["YEAR_SEMESTER", "SCHOOL_NAME", "GRADE_SUBJECT", "RANGE", "CREATED_DATE"]:
        header_xml = header_xml.replace(f"{{{{{placeholder}}}}}", "[TEMPLATE SHOWCASE]")

    paras = []
    paras.extend(section_a_scaffold())
    paras.extend(section_b_static())
    paras.extend(section_c_substituted())
    paras.extend(section_d_code())

    root_open = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'
    return root_open + header_xml + "".join(paras) + "</hs:sec>"


def build_hpf() -> str:
    hpf_path = os.path.join(BASE, "content_hpf_template.xml")
    with open(hpf_path, "r", encoding="utf-8") as f:
        template = f.read()
    hpf = template.replace("{{MODIFIED_DATE}}", "2026-05-18T00:00:00Z")
    hpf = hpf.replace("{{EXTRA_IMAGES}}", "")
    return hpf


def zip_hwpx(output_path: str, section_xml: str, hpf_xml: str) -> None:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with zipfile.ZipFile(output_path, "w") as zout:
        zout.write(os.path.join(BASE, "mimetype"), "mimetype", compress_type=zipfile.ZIP_STORED)
        zout.write(os.path.join(BASE, "version.xml"), "version.xml", compress_type=zipfile.ZIP_STORED)

        zout.write(os.path.join(BASE, "Contents", "header.xml"), "Contents/header.xml", compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(BASE, "BinData", "image1.bmp"), "BinData/image1.bmp", compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(BASE, "Contents", "masterpage0.xml"), "Contents/masterpage0.xml", compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(BASE, "BinData", "image2.bmp"), "BinData/image2.bmp", compress_type=zipfile.ZIP_DEFLATED)
        for img_idx in range(3, 9):
            img_path = os.path.join(BASE, "BinData", f"image{img_idx}.bmp")
            if os.path.exists(img_path):
                zout.write(img_path, f"BinData/image{img_idx}.bmp", compress_type=zipfile.ZIP_DEFLATED)

        zout.writestr("Contents/section0.xml", section_xml, compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr("Preview/PrvText.txt", b"TEMPLATE SHOWCASE", compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(BASE, "settings.xml"), "settings.xml", compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(BASE, "Preview", "PrvImage.png"), "Preview/PrvImage.png", compress_type=zipfile.ZIP_STORED)
        zout.write(os.path.join(BASE, "META-INF", "container.rdf"), "META-INF/container.rdf", compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr("Contents/content.hpf", hpf_xml, compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(BASE, "META-INF", "container.xml"), "META-INF/container.xml", compress_type=zipfile.ZIP_DEFLATED)
        zout.write(os.path.join(BASE, "META-INF", "manifest.xml"), "META-INF/manifest.xml", compress_type=zipfile.ZIP_DEFLATED)


def main():
    ids.reset_counters()
    output_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SCRIPT_DIR, "outputs")
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_path = os.path.join(output_dir, f"_TEMPLATE_SHOWCASE_ver{ts}.hwpx")
    section_xml = build_section()
    hpf_xml = build_hpf()
    zip_hwpx(output_path, section_xml, hpf_xml)
    print(f"HWPX written: {output_path}")


if __name__ == "__main__":
    main()
