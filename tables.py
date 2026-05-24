#!/usr/bin/env python3
"""
HWPX Builder — Table template XML generation

Import direction: ids → equation → shapes → tables → assemble → build_hwpx

=== Generator 함수 셀 라우팅 컨벤션 (V4 후속) ===

새 가변 표 generator 추가 시, 각 셀 주입(`_inject_cell_value`) 시점에 다음 중 하나를
명시 결정하고 인자 또는 주석(`# heuristic` / `# force_equation` / `# force_text`)으로 표기:

1. force_equation=True  → 셀이 항상 수식 (양식지가 HYhwpEQ 폰트로 렌더링하는 경우).
                          예: syn_div(조립제법), pascal(이항계수)
2. force_text=True      → 셀이 항상 일반 텍스트 (라벨, 한글 단어 등 수식 폰트 불필요).
3. (둘 다 명시 안 함) → heuristic 분기 (변수/특수문자 있으면 equation, 없으면 text).
                         예: inc_dec 부호·x값, choice_table 선지, normal_dist/probability 수치

[주의] heuristic 의존은 "정수 셀이 자동 text 됨" 같은 시각 회귀의 직접 원인이 된 적 있음
(ngd-create-v4-coherence Phase 5 3회차 참조). 정책이 모호한 경우 force_equation/force_text를
명시하는 것이 안전.
"""

import re
from ids import next_eq_id, next_zorder
from equation import xml_escape, make_equation_xml, lineseg_params_for_eq, make_lineseg
from shapes import make_proof_table as _make_proof_table_base


def _replace_table_ids(xml):
    """테이블 XML의 id/zOrder를 새 값으로 교체"""
    xml = re.sub(r'(<hp:tbl\b[^>]* id=)"[^"]*"', lambda m: f'{m.group(1)}"{next_eq_id()}"', xml, count=1)
    xml = re.sub(r'(<hp:equation\b[^>]* id=)"[^"]*"', lambda m: f'{m.group(1)}"{next_eq_id()}"', xml)
    xml = re.sub(r'(zOrder=)"[^"]*"', lambda m: f'{m.group(1)}"{next_zorder()}"', xml)
    return xml


def _inject_cell_value(cell_xml, value, force_equation=False, *, force_text=False):
    """셀(빈 셀 또는 이미 채워진 셀)에 값(텍스트 or 수식)을 삽입.

    기존: self-closing run(<hp:run charPrIDRef="N"/>)만 매칭 → 채워진 셀 덮어쓰기 불가.
    개선: self-closing run 없으면 내용 있는 run(<hp:run ...>...</hp:run>)도 교체.

    routing 정책 (mutually exclusive):
      force_equation=True  → 항상 equation (HYhwpEQ 폰트; 단순 정수도 수식 폰트 렌더링).
      force_text=True      → 항상 일반 텍스트 (xml_escape 후 <hp:t> 삽입).
      둘 다 False          → heuristic (변수/특수문자 있으면 equation, 없으면 text).

    주의: force_equation 과 force_text 동시 True 는 오류.
    """
    if force_equation and force_text:
        raise ValueError("force_equation 과 force_text 동시 True 불가")

    if not value:
        return cell_xml

    arrow_map = {"NEARROW": "NEARROW", "SEARROW": "SEARROW"}
    if value in arrow_map:
        # 화살표는 항상 equation (특수 수식 심볼)
        eq_xml = make_equation_xml(arrow_map[value])
        params = lineseg_params_for_eq(arrow_map[value])
        run = f'<hp:run charPrIDRef="1">{eq_xml}<hp:t/></hp:run>'
        ls = make_lineseg(0, params[0], params[1], params[2], params[3])
    elif force_text:
        # force_text: 항상 일반 텍스트
        run = f'<hp:run charPrIDRef="1"><hp:t>{xml_escape(value)}</hp:t></hp:run>'
        ls = make_lineseg(0, 1000, 1000, 850, 600)
    elif force_equation or re.search(r'[a-zA-Z_{}^\\`]', value):
        # force_equation 또는 heuristic → equation
        eq_xml = make_equation_xml(value)
        params = lineseg_params_for_eq(value)
        run = f'<hp:run charPrIDRef="1">{eq_xml}<hp:t/></hp:run>'
        ls = make_lineseg(0, params[0], params[1], params[2], params[3])
    else:
        # heuristic → text (특수문자 없는 순수 숫자/기호)
        run = f'<hp:run charPrIDRef="1"><hp:t>{xml_escape(value)}</hp:t></hp:run>'
        ls = make_lineseg(0, 1000, 1000, 850, 600)

    # 1) self-closing run (빈 셀) 우선 시도
    if re.search(r'<hp:run charPrIDRef="\d+"/>', cell_xml):
        cell_xml = re.sub(r'<hp:run charPrIDRef="\d+"/>', run, cell_xml, count=1)
    else:
        # 2) 이미 텍스트/수식이 있는 run도 덮어쓰기 — 첫 번째 run 전체 교체
        cell_xml = re.sub(r'<hp:run charPrIDRef="\d+">.*?</hp:run>', run, cell_xml, count=1, flags=re.DOTALL)

    cell_xml = re.sub(r'<hp:linesegarray>.*?</hp:linesegarray>', ls, cell_xml, count=1, flags=re.DOTALL)
    return cell_xml


def _empty_cell(cell_xml):
    """셀 안의 <hp:run> 내용(예시 수식·텍스트)을 비워 자기닫힘 형식으로 만든다.
    이후 _inject_cell_value()로 다시 채울 수 있도록."""
    m = re.search(r'<hp:run charPrIDRef="(\d+)">.*?</hp:run>', cell_xml, re.DOTALL)
    if m:
        cell_xml = cell_xml.replace(m.group(0), f'<hp:run charPrIDRef="{m.group(1)}"/>', 1)
    return cell_xml


def make_data_table_xml(data_table, base_path):
    """Generate data table using pre-extracted templates from 양식지"""
    dt_type = data_table["type"]
    row_parts = data_table.get("row_parts", [])

    if dt_type == "normal_dist":
        # Select template by data row count (3, 4, or 5)
        n_data_rows = len(row_parts)
        if n_data_rows <= 3:
            tpl_name = "normal_dist_3rows.xml"
        elif n_data_rows <= 4:
            tpl_name = "normal_dist_4rows.xml"
        else:
            tpl_name = "normal_dist_5rows.xml"

        with open(f"{base_path}/{tpl_name}", "r", encoding="utf-8") as f:
            tbl_xml = f.read()

        tbl_xml = _replace_table_ids(tbl_xml)

        template_rows = int(re.search(r'normal_dist_(\d+)rows', tpl_name).group(1))
        cells = re.findall(r'<hp:tc .*?</hp:tc>', tbl_xml, re.DOTALL)

        # 셀 [0]=제목, [1..2]=헤더(z, P), [3..]=데이터 셀 (Z, P 쌍)
        for i in range(3, 3 + template_rows * 2):
            if i < len(cells):
                cells[i] = _empty_cell(cells[i])

        for ri, row in enumerate(row_parts[:template_rows]):
            z_idx = 3 + ri * 2
            p_idx = 4 + ri * 2
            if p_idx >= len(cells):
                break
            z_val = "".join(part.get("eq", part.get("t", "")) for part in row[0]) if len(row) >= 1 else ""
            p_val = "".join(part.get("eq", part.get("t", "")) for part in row[1]) if len(row) >= 2 else ""
            if z_val:
                # normal_dist: z값·P값 모두 heuristic — 순수 숫자는 text, 변수 포함 시 equation
                cells[z_idx] = _inject_cell_value(cells[z_idx], z_val)  # heuristic
            if p_val:
                cells[p_idx] = _inject_cell_value(cells[p_idx], p_val)  # heuristic

        # 재조립: 제목 1셀 + 헤더 2셀 + 데이터 행(Z, P) × template_rows
        header_tag = re.match(r'^(.*?)<hp:tr>', tbl_xml, re.DOTALL).group(1)
        trs = f'<hp:tr>{cells[0]}</hp:tr>'
        trs += f'<hp:tr>{cells[1]}{cells[2]}</hp:tr>'
        for ri in range(template_rows):
            z_idx = 3 + ri * 2
            trs += f'<hp:tr>{cells[z_idx]}{cells[z_idx + 1]}</hp:tr>'
        return header_tag + trs + '</hp:tbl>'

    elif dt_type == "probability":
        # header_parts: x값 목록 [[{"eq":"0"}], [{"eq":"1"}], ...]
        # row_parts: P값 목록 [[{"eq":"0.2"}], [{"eq":"0.5"}], ...]
        header_parts = data_table.get("header_parts", [])
        prob_row = data_table.get("row_parts", [])
        n_data = len(header_parts)  # 데이터 열 수 (X, 계 제외)

        if n_data <= 3:
            tpl_name = "prob_dist_5cols.xml"
            n_total = 5
        elif n_data <= 4:
            tpl_name = "prob_dist_6cols.xml"
            n_total = 6
        else:
            tpl_name = "prob_dist_7cols.xml"
            n_total = 7

        with open(f"{base_path}/{tpl_name}", "r", encoding="utf-8") as f:
            tbl_xml = f.read()

        tbl_xml = _replace_table_ids(tbl_xml)

        # 셀 분리 후 데이터 주입
        cells = re.findall(r'<hp:tc .*?</hp:tc>', tbl_xml, re.DOTALL)
        # row 0: [0]=X헤더, [1..n_data]=x값, [n_data+1]=계
        # row 1: [n_total]=P헤더, [n_total+1..n_total+n_data]=P값, [n_total+n_data+1]=1
        def extract_val(parts_list):
            return "".join(p.get("eq", p.get("t", "")) for p in parts_list)

        for i, hp in enumerate(header_parts[:n_data]):
            val = extract_val(hp) if isinstance(hp, list) else str(hp)
            # probability: x헤더 값 — 숫자 또는 변수, heuristic 분기 적절
            cells[1 + i] = _inject_cell_value(cells[1 + i], val)  # heuristic

        for i, pp in enumerate(prob_row[:n_data]):
            val = extract_val(pp) if isinstance(pp, list) else str(pp)
            # probability: P값 — 분수/소수, 변수 포함 가능, heuristic 분기 적절
            cells[n_total + 1 + i] = _inject_cell_value(cells[n_total + 1 + i], val)  # heuristic

        # 재조립 (2행)
        header_tag = re.match(r'^(.*?)<hp:tr>', tbl_xml, re.DOTALL).group(1)
        tr0 = f'<hp:tr>{"".join(cells[:n_total])}</hp:tr>'
        tr1 = f'<hp:tr>{"".join(cells[n_total:])}</hp:tr>'
        return header_tag + tr0 + tr1 + '</hp:tbl>'

    return ""


def make_increase_decrease_table(explanation_table, base_path):
    """증감표 생성
    x값 1개: 양식지 1-x 템플릿 (3행 4열) 사용
    x값 2개: 양식지 2-x 템플릿 (3행 6열) 사용
    x값 3개: 양식지 3x 템플릿 (4행 8열) 사용
    x값 4~5개: 양식지 4x 템플릿 (5행 12열, x슬롯 5개) 사용
    x값 6개 이상: 양식지 borderFill 패턴으로 프로그래매틱 생성
    """
    x_values = explanation_table.get("x_values", [])
    rows = explanation_table.get("rows", [])
    n_x = len(x_values)

    # 양식지 템플릿이 있는 케이스 (n_x = 1, 2, 3, 4/5)
    # n_x=3: inc_dec_3x.xml (4행 8열, 데이터 행 3개)
    # n_x=4 or n_x=5: inc_dec_4x.xml (5행 12열, 데이터 행 4개, x슬롯 5개)
    if n_x in (1, 2):
        tpl_name = ("inc_dec_1x.xml" if n_x == 1
                    else "inc_dec_2x.xml")
        tpl_n_data_rows = 2      # 데이터 행 수 (헤더 제외)
        tpl_n_cols = 2 * n_x + 2  # 1-x→4, 2-x→6
    elif n_x == 3:
        tpl_name = "inc_dec_3x.xml"
        tpl_n_data_rows = 3      # y', y'', y 3행
        tpl_n_cols = 8           # 2*3+2=8
    elif n_x in (4, 5):
        tpl_name = "inc_dec_4x.xml"
        tpl_n_data_rows = 4      # f'(x), f(x), F''(x), F'(x) 4행
        tpl_n_cols = 12          # x슬롯 5개 포함
    else:
        tpl_name = None

    if tpl_name is not None:
        with open(f"{base_path}/{tpl_name}", encoding="utf-8") as f:
            tbl_xml = f.read()
        tbl_xml = _replace_table_ids(tbl_xml)
        cells = re.findall(r'<hp:tc .*?</hp:tc>', tbl_xml, re.DOTALL)
        n_cols = tpl_n_cols
        # 헤더 row의 x값 셀: cells[2], cells[4], ... (짝수 col idx 2부터)
        # routing: heuristic — x값은 변수/수식 문자열 포함 가능 (예: "a", "x", "1")
        for vi, xv in enumerate(x_values):
            cell_idx = 2 + vi * 2
            if cell_idx < n_cols:
                cells[cell_idx] = _inject_cell_value(cells[cell_idx], str(xv))  # heuristic
        # 데이터 행: row i → cells[(i+1)*n_cols .. (i+2)*n_cols-1]
        # cells[base+0]=label(보존), cells[base+1..n_cols-1]=values
        # routing: heuristic — 부호(+, -, 0)는 text, 변수(f'(x) 등)는 equation으로 자동 분기
        for ri, row_data in enumerate(rows[:tpl_n_data_rows]):
            base = (ri + 1) * n_cols
            n_val_slots = n_cols - 1
            values = row_data.get("values", [])
            for vi in range(n_val_slots):
                if vi < len(values):
                    cells[base + 1 + vi] = _inject_cell_value(cells[base + 1 + vi], str(values[vi]))  # heuristic
        hdr = re.match(r'^(.*?)<hp:tr>', tbl_xml, re.DOTALL).group(1)
        out = hdr
        for ri in range(tpl_n_data_rows + 1):
            out += f'<hp:tr>{"".join(cells[ri * n_cols:(ri + 1) * n_cols])}</hp:tr>'
        return out + '</hp:tbl>'

    # x값 6개 이상 — 양식지 borderFill 패턴으로 프로그래매틱 생성
    n_val_cols = 2 * n_x + 1  # 값 열 수
    n_cols = 1 + n_val_cols
    n_rows = 1 + len(rows)

    LABEL_W = 3805
    val_w = min(4937, (29000 - LABEL_W) // n_val_cols)
    total_w = LABEL_W + val_w * n_val_cols
    H_HDR, H_DATA = 1690, 1973

    BFR_LABEL = ["37", "38", "39"]
    BFR_FIRST = ["31", "32", "33"]
    BFR_MID   = ["27", "4",  "29"]
    BFR_LAST  = ["28", "22", "30"]

    def get_bfr(col, row):
        r = min(row, 2)
        if col == 0:           return BFR_LABEL[r]
        if col == 1:           return BFR_FIRST[r]
        if col == n_cols - 1:  return BFR_LAST[r]
        return BFR_MID[r]

    def tc(content_xml, col, row, w, h, bfr=None):
        if bfr is None:
            bfr = get_bfr(col, row)
        return (f'<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="{bfr}">'
                f'<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" '
                f'linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
                f'{content_xml}</hp:subList>'
                f'<hp:cellAddr colAddr="{col}" rowAddr="{row}"/>'
                f'<hp:cellSpan colSpan="1" rowSpan="1"/>'
                f'<hp:cellSz width="{w}" height="{h}"/>'
                f'<hp:cellMargin left="510" right="510" top="141" bottom="141"/>'
                f'</hp:tc>')

    def eq_p(script, h):
        eq_xml = make_equation_xml(script)
        p = lineseg_params_for_eq(script)
        return (f'<hp:p id="2147483648" paraPrIDRef="3" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                f'<hp:run charPrIDRef="1">{eq_xml}<hp:t/></hp:run>'
                f'{make_lineseg(0, p[0], p[1], p[2], p[3])}</hp:p>')

    def txt_p(t, h):
        return (f'<hp:p id="2147483648" paraPrIDRef="3" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                f'<hp:run charPrIDRef="1"><hp:t>{xml_escape(t)}</hp:t></hp:run>'
                f'{make_lineseg(0, h, h, int(h*0.85), int(h*0.6))}</hp:p>')

    def val_p(v, h):
        if not v:
            return txt_p("", h)
        if v in ("NEARROW", "SEARROW"):
            return eq_p(v, h)
        if re.search(r'[a-zA-Z_{}^\\`]', v):
            return eq_p(v, h)
        return txt_p(v, h)

    tbl_id = next_eq_id()
    zo = next_zorder()
    total_h = H_HDR + H_DATA * len(rows)

    trs = []
    # 헤더 행
    hdr_cells = tc(eq_p("{x}", H_HDR), 0, 0, LABEL_W, H_HDR)
    for vi in range(n_val_cols):
        if vi % 2 == 0:
            content = eq_p("{CDOTS }", H_HDR)
        else:
            content = eq_p(x_values[vi // 2], H_HDR)
        hdr_cells += tc(content, vi + 1, 0, val_w, H_HDR)
    trs.append(f'<hp:tr>{hdr_cells}</hp:tr>')

    # 데이터 행
    for ri, row_data in enumerate(rows):
        label = row_data.get("label", "")
        values = list(row_data.get("values", []))
        values += [""] * max(0, n_val_cols - len(values))
        row_cells = tc(eq_p(label, H_DATA) if re.search(r'[a-zA-Z_{}^\\`\']', label) else txt_p(label, H_DATA),
                       0, ri + 1, LABEL_W, H_DATA)
        for vi in range(n_val_cols):
            row_cells += tc(val_p(str(values[vi]), H_DATA), vi + 1, ri + 1, val_w, H_DATA)
        trs.append(f'<hp:tr>{row_cells}</hp:tr>')

    return (f'<hp:tbl id="{tbl_id}" zOrder="{zo}" numberingType="TABLE" '
            f'textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" '
            f'pageBreak="CELL" repeatHeader="1" rowCnt="{n_rows}" colCnt="{n_cols}" '
            f'cellSpacing="0" borderFillIDRef="4" noAdjust="0">'
            f'<hp:sz width="{total_w}" widthRelTo="ABSOLUTE" height="{total_h}" heightRelTo="ABSOLUTE" protect="0"/>'
            f'<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
            f'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" '
            f'vertOffset="0" horzOffset="0"/>'
            f'<hp:outMargin left="0" right="0" top="284" bottom="284"/>'
            f'<hp:inMargin left="140" right="140" top="140" bottom="140"/>'
            f'{"".join(trs)}</hp:tbl>')


def make_synthetic_division_table(explanation_table, base_path):
    """조립제법 표 생성 — 레거시 alias. make_syn_div_table으로 위임."""
    return make_syn_div_table(explanation_table, base_path)


def make_syn_div_table(data, base_path):
    """조립제법 가변 생성기.

    data 형식:
      {
        "type": "synthetic_division",
        "degree": <int>,          # 최고차 (선택; 없으면 rows 크기로 결정)
        "n_rows": <int>,          # 행 수 (선택; 없으면 len(rows))
        "n_cols": <int>,          # 열 수 (선택; 없으면 len(rows[0]))
        "rows": [["v00","v01",...], ...]  # 2D 배열 (각 셀 값, 수식 문자열)
      }

    rows가 없거나 비어있으면 "divisor"/"coefficients"/"result" 필드(레거시)를 이용해
    자동으로 rows를 구성한다.
    """
    rows_2d = data.get("rows")

    # --- 레거시 필드 폴백 ---
    if not rows_2d:
        divisor = data.get("divisor", "")
        coefficients = data.get("coefficients", [])
        result = data.get("result", [])

        try:
            d = float(divisor)
            multiplied = [""] + [str(d * float(r)) for r in result[:-1]]
            multiplied = [m.rstrip("0").rstrip(".") if "." in m else m for m in multiplied]
        except (ValueError, TypeError):
            multiplied = [""] * len(coefficients)

        n_cols = max(len(coefficients) + 1, 5)
        row0 = [divisor] + list(coefficients[:n_cols - 1])
        row1 = multiplied[:n_cols]
        row2 = [""] * n_cols          # thin separator 행
        row3 = [""] + list(result[:n_cols - 1])
        # row0/row1/row2/row3 각 n_cols 맞추기
        def _pad(r, n):
            return list(r) + [""] * max(0, n - len(r))
        rows_2d = [_pad(row0, n_cols), _pad(row1, n_cols), _pad(row2, n_cols), _pad(row3, n_cols)]

    if not rows_2d:
        return ""

    n_rows = data.get("n_rows") or len(rows_2d)
    n_cols = data.get("n_cols") or (len(rows_2d[0]) if rows_2d else 5)

    # 표 전체 너비 계산 (양식지 기준: 총 18350, 각 셀 3670)
    CELL_W = 3670
    CELL_H_NORMAL = 1849     # 일반 데이터 행 높이
    CELL_H_SEP = 383         # 구분선 행 높이 (3번째 행 etc.)
    total_w = CELL_W * n_cols
    total_h = 0

    # borderFillIDRef 패턴 (synthetic_division_template_1.xml 기반)
    # row 0: col0→55, col1→56, col2+→18
    # row 1: col0→55, col1→57, col2+→58
    # row 2 (sep): col0→18, col1+→59
    # row 3+: col0→18, rest→18
    def _bfr(ri, ci, n_r, n_c):
        if ri == 0:
            if ci == 0: return "55"
            if ci == 1: return "56"
            return "18"
        if ri == 1:
            if ci == 0: return "55"
            if ci == 1: return "57"
            return "58"
        if ri == 2:
            if ci == 0: return "18"
            return "59"
        # row 3+
        if ci == 0: return "18"
        if ri == n_r - 1 and ci == n_c - 2: return "55"
        if ri == n_r - 1 and ci == n_c - 1: return "57"
        return "18"

    trs = []
    for ri in range(n_rows):
        row_vals = rows_2d[ri] if ri < len(rows_2d) else []
        # 구분선 행 높이: row 2 (index 2)
        is_sep = (ri == 2) and all(not v for v in row_vals)
        cell_h = CELL_H_SEP if is_sep else CELL_H_NORMAL
        total_h += cell_h

        cells_xml = ""
        for ci in range(n_cols):
            val = row_vals[ci] if ci < len(row_vals) else ""
            bfr = _bfr(ri, ci, n_rows, n_cols)
            cell = (
                f'<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0"'
                f' borderFillIDRef="{bfr}">'
                f'<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER"'
                f' linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0"'
                f' hasTextRef="0" hasNumRef="0">'
                f'<hp:p id="2147483648" paraPrIDRef="10" styleIDRef="0"'
                f' pageBreak="0" columnBreak="0" merged="0">'
                f'<hp:run charPrIDRef="3"/>'
                f'<hp:linesegarray><hp:lineseg textpos="0" vertpos="0"'
                f' vertsize="1000" textheight="1000" baseline="850" spacing="600"'
                f' horzpos="0" horzsize="{CELL_W - 2}" flags="393216"/></hp:linesegarray>'
                f'</hp:p></hp:subList>'
                f'<hp:cellAddr colAddr="{ci}" rowAddr="{ri}"/>'
                f'<hp:cellSpan colSpan="1" rowSpan="1"/>'
                f'<hp:cellSz width="{CELL_W}" height="{cell_h}"/>'
                f'<hp:cellMargin left="510" right="510" top="141" bottom="141"/>'
                f'</hp:tc>'
            )
            if val:
                # syn_div 의 모든 셀은 항상 equation 으로 렌더링 (단순 정수도 수식 폰트)
                cell = _inject_cell_value(cell, str(val), force_equation=True)
            cells_xml += cell
        trs.append(f'<hp:tr>{cells_xml}</hp:tr>')

    tbl_id = next_eq_id()
    zo = next_zorder()
    return (
        f'<hp:tbl id="{tbl_id}" zOrder="{zo}" numberingType="TABLE"'
        f' textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None"'
        f' pageBreak="CELL" repeatHeader="1" rowCnt="{n_rows}" colCnt="{n_cols}"'
        f' cellSpacing="0" borderFillIDRef="4" noAdjust="0">'
        f'<hp:sz width="{total_w}" widthRelTo="ABSOLUTE" height="{total_h}" heightRelTo="ABSOLUTE" protect="0"/>'
        f'<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0"'
        f' holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT"'
        f' vertOffset="0" horzOffset="0"/>'
        f'<hp:outMargin left="0" right="0" top="284" bottom="284"/>'
        f'<hp:inMargin left="140" right="140" top="140" bottom="140"/>'
        f'{"".join(trs)}</hp:tbl>'
    )


def make_pascal_table(data, base_path):
    """파스칼 삼각형 가변 생성기.

    data 형식:
      {
        "type": "pascal",
        "n_rows": <int>,                          # 행 수 (0행 포함)
        "cells": [["1"], ["1","1"], ...]           # 각 행의 셀 값 list
      }

    각 행은 r+1개 셀 (0행=1셀, 1행=2셀, ...).
    가운데 정렬: 최대 n_rows개 열을 기준으로, 각 행 좌우에 빈 셀(colSpan)을 패딩.

    colCnt = n_rows (짝수 맞춤: n_rows가 홀수면 +1)
    각 데이터 셀은 colSpan=1, 빈 패딩 셀은 colSpan을 필요에 따라 조정.
    """
    n_rows = data.get("n_rows", 0)
    cells_data = data.get("cells", [])

    if n_rows == 0 or not cells_data:
        return ""

    # 홀수 colCnt로 만들기 위해 최대 데이터 셀 수 = n_rows 셀 (마지막 행)
    # 단순 레이아웃: colCnt = n_rows * 2 - 1 (각 데이터 셀 2슬롯, 사이 1슬롯)
    # 더 간단한 방법: colCnt = n_rows (각 행에서 빈 공간을 colSpan으로)
    # Pascal_triangle_1.xml 분석: 5행 기준 colCnt=18=2*(n-1)+2? → 5행: 2*4+2+8빈=18
    # 실제로는 매우 복잡한 span 구조. 대신 균일 그리드 사용.
    # 균일 그리드: colCnt = n_rows, 각 행 r에서 (n_rows - (r+1))//2 빈 셀 좌우로

    # colCnt = n_rows (최대 행의 셀 수와 동일)
    col_cnt = n_rows

    CELL_W = 2374
    CELL_H = 2131
    total_w = CELL_W * col_cnt
    total_h = CELL_H * n_rows

    def _pascal_cell(col, ri, val=""):
        cell = (
            f'<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0"'
            f' borderFillIDRef="1">'
            f'<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER"'
            f' linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0"'
            f' hasTextRef="0" hasNumRef="0">'
            f'<hp:p id="2147483648" paraPrIDRef="3" styleIDRef="0"'
            f' pageBreak="0" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="1"/>'
            f'<hp:linesegarray><hp:lineseg textpos="0" vertpos="0"'
            f' vertsize="1000" textheight="1000" baseline="850" spacing="600"'
            f' horzpos="0" horzsize="{CELL_W - 2}" flags="393216"/></hp:linesegarray>'
            f'</hp:p></hp:subList>'
            f'<hp:cellAddr colAddr="{col}" rowAddr="{ri}"/>'
            f'<hp:cellSpan colSpan="1" rowSpan="1"/>'
            f'<hp:cellSz width="{CELL_W}" height="{CELL_H}"/>'
            f'<hp:cellMargin left="510" right="510" top="141" bottom="141"/>'
            f'</hp:tc>'
        )
        if val:
            # pascal: 이항계수는 항상 equation (HYhwpEQ 폰트 렌더링 필요)
            cell = _inject_cell_value(cell, str(val), force_equation=True)
        return cell

    trs = []
    for ri in range(n_rows):
        row_vals = cells_data[ri] if ri < len(cells_data) else []
        n_data = ri + 1  # 이 행의 데이터 셀 수

        # 빈 패딩 슬롯 수
        n_left_pad = (col_cnt - n_data) // 2
        n_right_pad = col_cnt - n_data - n_left_pad

        col = 0
        cells_xml = ""
        for _ in range(n_left_pad):
            cells_xml += _pascal_cell(col, ri)
            col += 1
        for di in range(n_data):
            val = row_vals[di] if di < len(row_vals) else ""
            cells_xml += _pascal_cell(col, ri, val)
            col += 1
        for _ in range(n_right_pad):
            cells_xml += _pascal_cell(col, ri)
            col += 1

        trs.append(f'<hp:tr>{cells_xml}</hp:tr>')

    tbl_id = next_eq_id()
    zo = next_zorder()
    return (
        f'<hp:tbl id="{tbl_id}" zOrder="{zo}" numberingType="TABLE"'
        f' textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None"'
        f' pageBreak="CELL" repeatHeader="1" rowCnt="{n_rows}" colCnt="{col_cnt}"'
        f' cellSpacing="0" borderFillIDRef="4" noAdjust="0">'
        f'<hp:sz width="{total_w}" widthRelTo="ABSOLUTE" height="{total_h}" heightRelTo="ABSOLUTE" protect="0"/>'
        f'<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0"'
        f' holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT"'
        f' vertOffset="0" horzOffset="0"/>'
        f'<hp:outMargin left="0" right="0" top="284" bottom="284"/>'
        f'<hp:inMargin left="140" right="140" top="140" bottom="140"/>'
        f'{"".join(trs)}</hp:tbl>'
    )


CHOICE_TABLE_MAP = {
    # 신규 type tag (schema.md 명세 기준)
    "proposition": "pq_proposition_table_5x5.xml",
    "choice_image": "choice_image_5options.xml",
    "choice_grid_2cols": "choice_grid_2cols.xml",
    "choice_grid_3cols": "choice_grid_3cols.xml",
    # 호환 (옛 키 — deprecated, Phase 5 이후 제거 예정)
    "5x5": "pq_proposition_table_5x5.xml",
    "9x4": "choice_image_5options.xml",
    "6x3": "choice_grid_2cols.xml",
    "6x4": "choice_grid_3cols.xml",
}


def make_choice_table(condition_box, base_path):
    """그리드형 선지 테이블.

    cellAddr(rowAddr, colAddr) 기반 in-place 치환.
    - rowSpan 병합 셀을 보존하기 위해 <hp:tr> 재구성을 하지 않음.
    - rows_data[ri][ci] → rowAddr=ri, colAddr=ci 인 셀에 주입.
    - 채워진 셀(헤더 등)도 _inject_cell_value 가 덮어씀.
    - 데이터 길이 부족 시 fixture 원본 셀 유지.
    """
    table_type = condition_box.get("table_type", "6x3")
    if table_type not in CHOICE_TABLE_MAP:
        raise KeyError(f"Unknown choice table_type: {table_type!r}")
    tpl_name = CHOICE_TABLE_MAP[table_type]
    rows_data = condition_box.get("rows", [])  # [[v0,v1,...], ...]

    with open(f"{base_path}/{tpl_name}", encoding="utf-8") as f:
        tbl_xml = f.read()

    tbl_xml = _replace_table_ids(tbl_xml)

    if not rows_data:
        return tbl_xml

    # cellAddr 기반 in-place 치환 — <hp:tr> 재구성 없이 fixture 원본 구조 유지
    def _sub_cell(m):
        cell = m.group(0)
        addr_match = re.search(r'colAddr="(\d+)"\s+rowAddr="(\d+)"', cell)
        if not addr_match:
            return cell
        col, row = int(addr_match.group(1)), int(addr_match.group(2))
        if row < len(rows_data) and col < len(rows_data[row]):
            val = rows_data[row][col]
            if val:
                # choice_table: 셀 내용이 선지 텍스트 또는 수식 혼합 — heuristic 분기 적절
                return _inject_cell_value(cell, str(val))  # heuristic
        return cell

    return re.sub(r'<hp:tc\b.*?</hp:tc>', _sub_cell, tbl_xml, flags=re.DOTALL)


def make_bogi_table(condition_box, base_path):
    """Generate < 보 기 > table using template"""
    items = condition_box["items"]
    n_items = len(items)

    if n_items <= 3:
        tpl_name = "bogi_box_3items.xml"
    elif n_items == 4:
        tpl_name = "bogi_box_4items.xml"
    else:
        tpl_name = "bogi_box_6items.xml"
    with open(f"{base_path}/{tpl_name}", "r", encoding="utf-8") as f:
        tbl_xml = f.read()

    tbl_xml = _replace_table_ids(tbl_xml)

    # Inject item content after each label (ㄱ. / ㄴ. / ...)
    labels = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ"]
    for idx, item in enumerate(items):
        if idx >= len(labels):
            break
        label = labels[idx]
        item_content = ""
        for part in item.get("parts", []):
            if "eq" in part:
                item_content += make_equation_xml(part["eq"])
            elif "t" in part:
                item_content += f'<hp:t>{xml_escape(part["t"])}</hp:t>'
        if item_content:
            tbl_xml = re.sub(
                rf'<hp:t>{label}\.(\s?)</hp:t></hp:run>',
                lambda m: f'<hp:t>{label}.{m.group(1)}</hp:t>{item_content}</hp:run>',
                tbl_xml, count=1
            )

    return tbl_xml


def make_proof_table_wrapped(condition_box, base_path):
    """Wrapper: make_proof_table with _replace_table_ids injected"""
    return _make_proof_table_base(condition_box, base_path, _replace_table_ids)
