#!/usr/bin/env python3
"""
header_def_mapper.py — 두 header.xml 간 paraPr/charPr/borderFill 정의 매핑

사용:
  python3 tools/header_def_mapper.py <our_header.xml> <user_header.xml> > mapping.json

출력 (JSON):
{
  "paraPr": {
    "user_idx_to_our_idx": {"1": 2, "4": ..., ...},
    "unmapped_user": [N, ...]   # 우리에게 없는 사용자 정의
  },
  "charPr": {...},
  "borderFill": {...}
}
"""

import sys
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

# ─── 네임스페이스 상수 ────────────────────────────────────────────────────
HH = "http://www.hancom.co.kr/hwpml/2011/head"
HC = "http://www.hancom.co.kr/hwpml/2011/core"
HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"

def p(tag: str) -> str:
    return f"{{{HH}}}{tag}"

def c(tag: str) -> str:
    return f"{{{HC}}}{tag}"

def hp(tag: str) -> str:
    return f"{{{HP}}}{tag}"


# ─── 헤더 파싱 헬퍼 ───────────────────────────────────────────────────────

def _get_margin_linespacing(elem: ET.Element) -> tuple[str, str, str, str, str, str, str]:
    """
    paraPr 요소에서 margin (intent/left/right/prev/next) + lineSpacing (type/value) 추출.
    switch/case 또는 switch/default 패턴 처리.
    """
    intent_val = "0"
    left_val = "0"
    right_val = "0"
    prev_val = "0"
    next_val = "0"
    ls_type = "PERCENT"
    ls_value = "160"

    # switch 구조가 있으면 case(HwpUnitChar) 우선, 없으면 default
    margin_elem: Optional[ET.Element] = None
    ls_elem: Optional[ET.Element] = None

    switch_elems = elem.findall(hp("switch"))
    for sw in switch_elems:
        for child in sw:
            m = child.find(p("margin"))
            ls = child.find(p("lineSpacing"))
            if m is not None and margin_elem is None:
                margin_elem = m
            if ls is not None and ls_elem is None:
                ls_elem = ls
        if margin_elem is not None or ls_elem is not None:
            break  # 첫 번째 switch에서 찾으면 충분

    # switch 없이 직접 자식으로 있는 경우
    if margin_elem is None:
        margin_elem = elem.find(p("margin"))
    if ls_elem is None:
        ls_elem = elem.find(p("lineSpacing"))

    if margin_elem is not None:
        intent_e = margin_elem.find(c("intent"))
        left_e = margin_elem.find(c("left"))
        right_e = margin_elem.find(c("right"))
        prev_e = margin_elem.find(c("prev"))
        next_e = margin_elem.find(c("next"))
        if intent_e is not None:
            intent_val = intent_e.get("value", "0")
        if left_e is not None:
            left_val = left_e.get("value", "0")
        if right_e is not None:
            right_val = right_e.get("value", "0")
        if prev_e is not None:
            prev_val = prev_e.get("value", "0")
        if next_e is not None:
            next_val = next_e.get("value", "0")

    if ls_elem is not None:
        ls_type = ls_elem.get("type", "PERCENT")
        ls_value = ls_elem.get("value", "160")

    return intent_val, left_val, right_val, prev_val, next_val, ls_type, ls_value


def _tab_signature(tab_elem: ET.Element) -> tuple:
    """
    tabPr 요소의 signature를 반환.
    탭 아이템의 pos 목록 (첫 3개) + autoTabLeft 값으로 구성.
    """
    auto_left = tab_elem.get("autoTabLeft", "1")
    tab_items = []

    # switch/case 패턴에서 탭 아이템 추출
    for sw in tab_elem.findall(hp("switch")):
        for child in sw:
            ti = child.find(p("tabItem"))
            if ti is not None:
                tab_items.append(ti.get("pos", "0"))
                break
        if len(tab_items) >= 3:
            break

    # 직접 자식으로 있는 경우
    if not tab_items:
        for ti in tab_elem.findall(p("tabItem")):
            tab_items.append(ti.get("pos", "0"))
            if len(tab_items) >= 3:
                break

    return (auto_left, tuple(tab_items[:3]))


# ─── 핑거프린트 함수들 ─────────────────────────────────────────────────────

def fingerprint_borderFill(elem: ET.Element) -> tuple:
    """borderFill 요소에서 매칭 키 추출.

    4-side border (type/width/color) + diagonal (type/width/color) + fillBrush (presence + hatchColor).
    diagonal width 가 0.1mm vs 0.12mm 처럼 미세하게 다른 경우에도 collision 없이 구분.
    """
    def border_info(side: str) -> tuple[str, str, str]:
        b = elem.find(p(f"{side}Border"))
        if b is None:
            return ("NONE", "0.1 mm", "#000000")
        return (
            b.get("type", "NONE"),
            b.get("width", "0.1 mm"),
            b.get("color", "#000000"),
        )

    left = border_info("left")
    right = border_info("right")
    top = border_info("top")
    bottom = border_info("bottom")

    # diagonal — 이 요소의 width 차이가 user[1/3/11] 충돌 원인이었음
    diag_elem = elem.find(p("diagonal"))
    if diag_elem is not None:
        diag_type = diag_elem.get("type", "NONE")
        diag_width = diag_elem.get("width", "0.1 mm")
        diag_color = diag_elem.get("color", "#000000")
    else:
        diag_type = "NONE"
        diag_width = "0.1 mm"
        diag_color = "#000000"
    diag = (diag_type, diag_width, diag_color)

    # fillBrush — presence flag + hatchColor (faceColor 은 보통 "none" 으로 동일)
    fill_present = False
    fill_face = "none"
    fill_hatch = "#000000"
    fill_brush = elem.find(c("fillBrush"))
    if fill_brush is not None:
        wb = fill_brush.find(c("winBrush"))
        if wb is not None:
            fill_present = True
            fill_face = wb.get("faceColor", "none")
            fill_hatch = wb.get("hatchColor", "#000000")

    return (*left, *right, *top, *bottom, *diag, fill_present, fill_face, fill_hatch)


def fingerprint_paraPr(
    elem: ET.Element,
    border_map: Optional[dict[int, int]] = None,
    tab_map: Optional[dict[int, int]] = None,
) -> tuple:
    """
    paraPr 매칭 키 생성.
    border_map/tab_map 이 제공되면 IDRef를 normalize.
    """
    align_elem = elem.find(p("align"))
    h_align = "LEFT"
    v_align = "BASELINE"
    if align_elem is not None:
        h_align = align_elem.get("horizontal", "LEFT")
        v_align = align_elem.get("vertical", "BASELINE")

    intent, left, right, prev, next_, ls_type, ls_value = _get_margin_linespacing(elem)

    border_fill_ref = elem.find(p("border"))
    bf_ref_raw = int(border_fill_ref.get("borderFillIDRef", "1")) if border_fill_ref is not None else 1

    tab_ref_raw = int(elem.get("tabPrIDRef", "0"))

    # normalize refs
    bf_ref = border_map.get(bf_ref_raw, bf_ref_raw) if border_map else bf_ref_raw
    tab_ref = tab_map.get(tab_ref_raw, tab_ref_raw) if tab_map else tab_ref_raw

    return (
        h_align,
        v_align,
        intent,
        left,
        right,
        prev,
        next_,
        ls_type,
        ls_value,
        bf_ref,
        tab_ref,
    )


def fingerprint_charPr(
    elem: ET.Element,
    border_map: Optional[dict[int, int]] = None,
) -> tuple:
    """charPr 매칭 키 생성."""
    height = elem.get("height", "1000")
    text_color = elem.get("textColor", "#000000")

    bold = elem.find(p("bold")) is not None
    italic = elem.find(p("italic")) is not None

    underline_elem = elem.find(p("underline"))
    underline_type = "NONE"
    if underline_elem is not None:
        underline_type = underline_elem.get("type", "NONE")

    strikeout_elem = elem.find(p("strikeout"))
    strikeout_shape = "NONE"
    if strikeout_elem is not None:
        strikeout_shape = strikeout_elem.get("shape", "NONE")

    font_ref = elem.find(p("fontRef"))
    font_hangul = "0"
    font_latin = "0"
    if font_ref is not None:
        font_hangul = font_ref.get("hangul", "0")
        font_latin = font_ref.get("latin", "0")

    bf_ref_raw = int(elem.get("borderFillIDRef", "1"))
    bf_ref = border_map.get(bf_ref_raw, bf_ref_raw) if border_map else bf_ref_raw

    return (
        height,
        text_color,
        bold,
        italic,
        underline_type,
        strikeout_shape,
        font_hangul,
        font_latin,
        bf_ref,
    )


# ─── 파싱 함수들 ──────────────────────────────────────────────────────────

def parse_header(header_path: Path) -> dict:
    """header.xml을 파싱해서 각 정의 딕셔너리 반환."""
    tree = ET.parse(str(header_path), parser=ET.XMLParser(encoding="utf-8"))
    root = tree.getroot()
    ref_list = root.find(p("refList"))

    # borderFills
    border_fills_elem = ref_list.find(p("borderFills"))
    border_fills = {}
    if border_fills_elem is not None:
        for bf in border_fills_elem:
            bid = int(bf.get("id", "0"))
            border_fills[bid] = bf

    # tabProperties
    tab_props_elem = ref_list.find(p("tabProperties"))
    tab_props = {}
    if tab_props_elem is not None:
        for tp in tab_props_elem:
            tid = int(tp.get("id", "0"))
            tab_props[tid] = tp

    # charProperties
    char_props_elem = ref_list.find(p("charProperties"))
    char_props = {}
    if char_props_elem is not None:
        for cp in char_props_elem:
            cid = int(cp.get("id", "0"))
            char_props[cid] = cp

    # paraProperties
    para_props_elem = ref_list.find(p("paraProperties"))
    para_props = {}
    if para_props_elem is not None:
        for pp in para_props_elem:
            pid = int(pp.get("id", "0"))
            para_props[pid] = pp

    return {
        "borderFills": border_fills,
        "tabProps": tab_props,
        "charProps": char_props,
        "paraProps": para_props,
    }


# ─── 매핑 빌더 ───────────────────────────────────────────────────────────

def build_border_map(
    our_borders: dict[int, ET.Element],
    user_borders: dict[int, ET.Element],
) -> dict[int, Optional[int]]:
    """
    user_id → our_id 매핑.
    fingerprint 일치 기준으로 매핑; 없으면 None.
    """
    # 우리 fingerprint → id
    our_fp_to_id: dict[tuple, int] = {}
    for oid, elem in our_borders.items():
        fp = fingerprint_borderFill(elem)
        # 첫 번째 것만 저장 (동일 fingerprint 여러 개면 가장 낮은 id)
        if fp not in our_fp_to_id:
            our_fp_to_id[fp] = oid

    result: dict[int, Optional[int]] = {}
    for uid, elem in user_borders.items():
        fp = fingerprint_borderFill(elem)
        result[uid] = our_fp_to_id.get(fp)

    return result


def build_tab_map(
    our_tabs: dict[int, ET.Element],
    user_tabs: dict[int, ET.Element],
) -> dict[int, Optional[int]]:
    """
    user tabPr_id → our tabPr_id 매핑.
    탭 signature 일치 기준.
    """
    our_sig_to_id: dict[tuple, int] = {}
    for oid, elem in our_tabs.items():
        sig = _tab_signature(elem)
        if sig not in our_sig_to_id:
            our_sig_to_id[sig] = oid

    result: dict[int, Optional[int]] = {}
    for uid, elem in user_tabs.items():
        sig = _tab_signature(elem)
        result[uid] = our_sig_to_id.get(sig)

    return result


def build_char_map(
    our_chars: dict[int, ET.Element],
    user_chars: dict[int, ET.Element],
    border_map: dict[int, Optional[int]],
) -> tuple[dict[int, Optional[int]], list[int]]:
    """
    user charPr_id → our charPr_id 매핑.
    Returns: (user_to_our, unmapped_user_ids)
    """
    # border_map: user_border_id → our_border_id
    # charPr borderFillIDRef는 각 header 내 id이므로
    # user charPr의 borderFillIDRef를 "our border id 공간"으로 normalize해야 함
    # user_border_id → our_border_id 매핑이 border_map

    def _normalize_char_fp(elem: ET.Element, is_user: bool) -> tuple:
        """is_user=True이면 borderFillIDRef를 our 공간으로 normalize."""
        if is_user:
            # user borderFillIDRef → our borderFillIDRef
            bf_raw = int(elem.get("borderFillIDRef", "1"))
            our_bf = border_map.get(bf_raw, bf_raw)
            # 임시 border_map: {bf_raw: our_bf} 로 fingerprint 생성
            return fingerprint_charPr(elem, {bf_raw: our_bf} if our_bf is not None else None)
        else:
            return fingerprint_charPr(elem, None)

    our_fp_to_id: dict[tuple, int] = {}
    for oid, elem in our_chars.items():
        fp = _normalize_char_fp(elem, is_user=False)
        if fp not in our_fp_to_id:
            our_fp_to_id[fp] = oid

    result: dict[int, Optional[int]] = {}
    unmapped: list[int] = []
    for uid, elem in user_chars.items():
        fp = _normalize_char_fp(elem, is_user=True)
        our_id = our_fp_to_id.get(fp)
        result[uid] = our_id
        if our_id is None:
            unmapped.append(uid)

    return result, unmapped


def build_para_map(
    our_paras: dict[int, ET.Element],
    user_paras: dict[int, ET.Element],
    border_map: dict[int, Optional[int]],
    tab_map: dict[int, Optional[int]],
) -> tuple[dict[int, Optional[int]], list[int]]:
    """
    user paraPr_id → our paraPr_id 매핑.
    Returns: (user_to_our, unmapped_user_ids)
    """

    def _our_fp(elem: ET.Element) -> tuple:
        return fingerprint_paraPr(elem, border_map=None, tab_map=None)

    def _user_fp(elem: ET.Element) -> tuple:
        # user의 borderFillIDRef, tabPrIDRef를 our 공간으로 normalize
        bf_raw = int(elem.find(p("border")).get("borderFillIDRef", "1")) if elem.find(p("border")) is not None else 1
        tab_raw = int(elem.get("tabPrIDRef", "0"))

        our_bf = border_map.get(bf_raw) or bf_raw
        our_tab = tab_map.get(tab_raw) or tab_raw

        return fingerprint_paraPr(
            elem,
            border_map={bf_raw: our_bf},
            tab_map={tab_raw: our_tab},
        )

    our_fp_to_id: dict[tuple, int] = {}
    for oid, elem in our_paras.items():
        fp = _our_fp(elem)
        if fp not in our_fp_to_id:
            our_fp_to_id[fp] = oid

    result: dict[int, Optional[int]] = {}
    unmapped: list[int] = []
    for uid, elem in user_paras.items():
        fp = _user_fp(elem)
        our_id = our_fp_to_id.get(fp)
        result[uid] = our_id
        if our_id is None:
            unmapped.append(uid)

    return result, unmapped


# ─── 메인 ───────────────────────────────────────────────────────────────

def run(our_header_path: Path, user_header_path: Path) -> dict:
    our = parse_header(our_header_path)
    user = parse_header(user_header_path)

    # 1. borderFill 매핑 (paraPr/charPr 보다 먼저)
    # border_map: user_border_id → our_border_id
    user_border_to_our = build_border_map(our["borderFills"], user["borderFills"])

    # 2. tabPr 매핑
    user_tab_to_our = build_tab_map(our["tabProps"], user["tabProps"])

    # 3. charPr 매핑
    user_char_to_our, unmapped_chars = build_char_map(
        our["charProps"], user["charProps"], user_border_to_our
    )

    # 4. paraPr 매핑
    user_para_to_our, unmapped_paras = build_para_map(
        our["paraProps"], user["paraProps"], user_border_to_our, user_tab_to_our
    )

    # borderFill unmapped
    unmapped_borders = [uid for uid, oid in user_border_to_our.items() if oid is None]

    return {
        "paraPr": {
            "user_idx_to_our_idx": {str(k): v for k, v in user_para_to_our.items()},
            "unmapped_user": unmapped_paras,
        },
        "charPr": {
            "user_idx_to_our_idx": {str(k): v for k, v in user_char_to_our.items()},
            "unmapped_user": unmapped_chars,
        },
        "borderFill": {
            "user_idx_to_our_idx": {str(k): v for k, v in user_border_to_our.items()},
            "unmapped_user": unmapped_borders,
        },
        "tabPr": {
            "user_idx_to_our_idx": {str(k): v for k, v in user_tab_to_our.items()},
        },
    }


# ─── 자가 검증 (--selftest) ──────────────────────────────────────────────

def selftest(our_header_path: Path, user_header_path: Path) -> None:
    """
    fingerprint 함수 단위 + 알려진 케이스 검증.
    """
    print("[selftest] 시작", file=sys.stderr)

    our = parse_header(our_header_path)
    user = parse_header(user_header_path)

    # test 1: borderFill fingerprint — id=1 (NONE all sides) 는 양쪽 동일해야 함
    our_bf1 = our["borderFills"].get(1)
    user_bf1 = user["borderFills"].get(1)
    assert our_bf1 is not None, "우리 borderFill id=1 없음"
    assert user_bf1 is not None, "사용자 borderFill id=1 없음"
    fp_our_1 = fingerprint_borderFill(our_bf1)
    fp_user_1 = fingerprint_borderFill(user_bf1)
    assert fp_our_1 == fp_user_1, f"borderFill id=1 fingerprint 불일치: {fp_our_1} vs {fp_user_1}"
    print(f"[selftest] PASS: borderFill id=1 fingerprint 일치 {fp_our_1}", file=sys.stderr)

    # test 2: border_map[1] == 1
    bmap = build_border_map(our["borderFills"], user["borderFills"])
    assert bmap.get(1) == 1, f"border_map[1]={bmap.get(1)} (expected 1)"
    print(f"[selftest] PASS: border_map[1] = 1", file=sys.stderr)

    # test 3: paraPr user[11] → our CENTER align 항목으로 매핑
    tmap = build_tab_map(our["tabProps"], user["tabProps"])
    para_map, unmapped = build_para_map(our["paraProps"], user["paraProps"], bmap, tmap)
    our_id_for_user11 = para_map.get(11)
    if our_id_for_user11 is not None:
        our_pp = our["paraProps"][our_id_for_user11]
        align_elem = our_pp.find(p("align"))
        h_align = align_elem.get("horizontal") if align_elem is not None else "N/A"
        print(
            f"[selftest] INFO: user paraPr[11] → our paraPr[{our_id_for_user11}] (align={h_align})",
            file=sys.stderr,
        )
        # user paraPr[11]은 CENTER align (04-mapping-strategy.md 에서 알려진 케이스)
        # 우리 paraPr[10]이나 [29]가 CENTER + borderFillRef에 따라 달라짐
        assert h_align == "CENTER", f"user paraPr[11] 매핑된 our 항목이 CENTER가 아님: {h_align}"
        print(f"[selftest] PASS: user paraPr[11] → our paraPr[{our_id_for_user11}] (CENTER)", file=sys.stderr)
    else:
        print(f"[selftest] WARN: user paraPr[11] → unmapped (our에 동일 fingerprint 없음)", file=sys.stderr)

    print(f"[selftest] unmapped paraPr: {unmapped}", file=sys.stderr)
    print("[selftest] 완료", file=sys.stderr)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="두 header.xml 간 IDRef 매핑 테이블 생성")
    parser.add_argument("our_header", type=Path, help="우리 header.xml 경로")
    parser.add_argument("user_header", type=Path, help="사용자/대상 header.xml 경로")
    parser.add_argument("--selftest", action="store_true", help="단위 테스트 실행")
    parser.add_argument(
        "--markdown",
        action="store_true",
        help="JSON 대신 Markdown 표 출력 (stdout)",
    )
    args = parser.parse_args()

    if args.selftest:
        selftest(args.our_header, args.user_header)
        return

    result = run(args.our_header, args.user_header)

    if args.markdown:
        _print_markdown(result, args.our_header, args.user_header)
    else:
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        print()


def _print_markdown(result: dict, our_path: Path, user_path: Path) -> None:
    """사람이 읽을 수 있는 Markdown 표 출력."""
    our = parse_header(our_path)
    user = parse_header(user_path)

    bmap = {int(k): v for k, v in result["borderFill"]["user_idx_to_our_idx"].items()}
    tmap = {int(k): v for k, v in result["tabPr"]["user_idx_to_our_idx"].items()}

    print("# Header 정의 매핑 — user → ours\n")

    # paraPr
    n_user_para = len(user["paraProps"])
    n_our_para = len(our["paraProps"])
    print(f"## paraPr (사용자 {n_user_para}개 → 우리 {n_our_para}개)\n")
    print("| user_idx | our_idx | user_align | user_intent | user_borderFillRef→our | user_tabRef→our | 비고 |")
    print("|----------|---------|-----------|-------------|------------------------|----------------|------|")
    para_map = {int(k): v for k, v in result["paraPr"]["user_idx_to_our_idx"].items()}
    for uid in sorted(para_map.keys()):
        oid = para_map[uid]
        user_pp = user["paraProps"][uid]
        align_elem = user_pp.find(p("align"))
        ha = align_elem.get("horizontal") if align_elem is not None else "N/A"
        intent, *_ = _get_margin_linespacing(user_pp)
        border_elem = user_pp.find(p("border"))
        ubf = int(border_elem.get("borderFillIDRef", "1")) if border_elem is not None else 1
        utab = int(user_pp.get("tabPrIDRef", "0"))
        our_bf_str = str(bmap.get(ubf, "?"))
        our_tab_str = str(tmap.get(utab, "?"))
        our_idx_str = str(oid) if oid is not None else "?"
        note = "unmapped" if oid is None else ""
        print(
            f"| {uid} | {our_idx_str} | {ha} | {intent} | {ubf}→{our_bf_str} | {utab}→{our_tab_str} | {note} |"
        )

    unmapped_para = result["paraPr"]["unmapped_user"]
    if unmapped_para:
        print(f"\n**Unmapped paraPr (user idx)**: {unmapped_para}\n")

    # charPr
    n_user_char = len(user["charProps"])
    n_our_char = len(our["charProps"])
    print(f"\n## charPr (사용자 {n_user_char}개 → 우리 {n_our_char}개)\n")
    print("| user_idx | our_idx | height | textColor | bold | borderFillRef→our | 비고 |")
    print("|----------|---------|--------|-----------|------|-------------------|------|")
    char_map = {int(k): v for k, v in result["charPr"]["user_idx_to_our_idx"].items()}
    for uid in sorted(char_map.keys()):
        oid = char_map[uid]
        user_cp = user["charProps"][uid]
        height = user_cp.get("height", "1000")
        text_color = user_cp.get("textColor", "#000000")
        bold_flag = "Y" if user_cp.find(p("bold")) is not None else "N"
        ubf = int(user_cp.get("borderFillIDRef", "1"))
        our_bf_str = str(bmap.get(ubf, "?"))
        our_idx_str = str(oid) if oid is not None else "?"
        note = "unmapped" if oid is None else ""
        print(
            f"| {uid} | {our_idx_str} | {height} | {text_color} | {bold_flag} | {ubf}→{our_bf_str} | {note} |"
        )

    unmapped_char = result["charPr"]["unmapped_user"]
    if unmapped_char:
        print(f"\n**Unmapped charPr (user idx)**: {unmapped_char}\n")

    # borderFill
    n_user_bf = len(user["borderFills"])
    n_our_bf = len(our["borderFills"])
    print(f"\n## borderFill (사용자 {n_user_bf}개 → 우리 {n_our_bf}개)\n")
    print("| user_idx | our_idx | L-type | R-type | T-type | B-type | fill_face | 비고 |")
    print("|----------|---------|--------|--------|--------|--------|-----------|------|")
    for uid in sorted(bmap.keys()):
        oid = bmap[uid]
        user_bf = user["borderFills"][uid]
        fp = fingerprint_borderFill(user_bf)
        # fp: (L-type, L-width, L-color, R-..., T-..., B-..., fill_face, fill_hatch)
        l_type = fp[0]
        r_type = fp[3]
        t_type = fp[6]
        b_type = fp[9]
        fill_face = fp[12]
        our_idx_str = str(oid) if oid is not None else "?"
        note = "unmapped" if oid is None else ""
        print(
            f"| {uid} | {our_idx_str} | {l_type} | {r_type} | {t_type} | {b_type} | {fill_face} | {note} |"
        )

    unmapped_bf = result["borderFill"]["unmapped_user"]
    if unmapped_bf:
        print(f"\n**Unmapped borderFill (user idx)**: {unmapped_bf}\n")

    print("\n## Unmapped 상세\n")
    total_unmapped = len(unmapped_para) + len(unmapped_char) + len(unmapped_bf)
    if total_unmapped == 0:
        print("없음 — 모든 user 정의가 our header에 대응됨.\n")
    else:
        if unmapped_para:
            print(f"- paraPr user{unmapped_para}: our header에 동일 fingerprint 없음 → Phase 3에서 fallback 처리 필요\n")
        if unmapped_char:
            print(f"- charPr user{unmapped_char}: our header에 동일 fingerprint 없음 → Phase 3에서 fallback 처리 필요\n")
        if unmapped_bf:
            print(f"- borderFill user{unmapped_bf}: our header에 동일 fingerprint 없음 → Phase 3에서 fallback 처리 필요\n")


if __name__ == "__main__":
    main()
