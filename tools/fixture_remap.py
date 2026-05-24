"""
fixture_remap.py — 사용자 fixture 의 ref 인덱스를 우리 header 기준으로 변환

사용:
  python3 tools/fixture_remap.py \\
      --mapping /tmp/mapping.json \\
      --src /tmp/showcase_extracted/<name>.xml \\
      --dst resources/hwpx_base/<name>.xml \\
      [--dry-run]

  python3 tools/fixture_remap.py --batch \\
      --mapping /tmp/mapping.json \\
      --src-dir /tmp/showcase_extracted \\
      --dst-dir resources/hwpx_base \\
      [--dry-run]

동작:
  1. src XML 읽기
  2. mapping.json 의 user→ours 매핑 적용
  3. Unmapped ref → fallback 정책표에 따라 처리 + unmapped_fallback.log 기록
  4. dry-run: 변환 결과만 stdout, 파일 안 씀
  5. 정상 실행: dst 에 atomic write
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import tempfile
from pathlib import Path

LOG_PATH = Path("/tmp/unmapped_fallback.log")

# ---------------------------------------------------------------------------
# Fallback tables (결정된 Unmapped 처리 — spec 정책표 기반)
# ---------------------------------------------------------------------------

# paraPr unmapped (개선된 fingerprint 기준):
# user[3,4,8,9] 는 이제 fingerprint 가 직접 매핑됨 — 방어 fallback 만 유지
PARA_FALLBACK: dict[str, str] = {
    # 현재 매핑 결과: user[3]→our[6], user[4]→our[5], user[8]→our[12], user[9]→our[13]
    # (모두 매핑 성공 — 아래는 추후 회귀 방지 방어 fallback)
}

# charPr unmapped (개선된 fingerprint 기준):
# user[7] → font=2, height=1400, bold → no exact our match → our[26] (font=2, #000000)
# (구 unmapped user[3,9,10,11]은 이제 fingerprint 가 직접 매핑됨 — fallback 불필요)
CHAR_FALLBACK: dict[str, str] = {
    "7":  "26",  # font=2, bold, height=1400 → our[26] (nearest: font=2, #000000)
}

# borderFill unmapped: user[5,21,34,35,36,40]
# 패턴 매칭 결과 (border pattern + fill 무시 후 재매칭):
# user[5]  → NONE/SOLID/top-thick/SOLID + gray → our[37]
# user[21] → SOLID/SOLID/top-thick/SOLID no fill → our[27]
# user[34] → NONE/SOLID/SOLID/SOLID + gray → our[38]
# user[35] → no clear match → our[1] (spec fallback)
# user[36] → NONE/SOLID/SOLID/bottom-thick + gray → our[39]
# user[40] → SOLID/SOLID/SOLID/bottom-thick no fill → our[29]
BORDER_FALLBACK: dict[str, str] = {
    "5":  "37",
    "21": "27",
    "34": "38",
    "35": "1",
    "36": "39",
    "40": "29",
}


def _load_mapping(mapping_path: Path) -> dict:
    with open(mapping_path, encoding="utf-8") as f:
        return json.load(f)


def _make_replacer(
    category: str,
    attr_name: str,
    user_to_our: dict[str, str | None],
    fallback_table: dict[str, str],
    fixture_name: str,
) -> tuple[re.Pattern, callable]:
    """attr_name="paraPrIDRef" 등의 re.sub 교체 함수 생성."""

    pattern = re.compile(rf'({re.escape(attr_name)}=")(\d+)(")')

    def replacer(m: re.Match) -> str:
        prefix, val, suffix = m.group(1), m.group(2), m.group(3)
        mapped = user_to_our.get(val)

        if mapped is not None:
            return f"{prefix}{mapped}{suffix}"

        # Unmapped → fallback
        fallback = fallback_table.get(val)
        if fallback is None:
            # 완전 미등록 → spec: our[0] or our[1]
            fallback = "1" if category == "borderFill" else "0"
            reason = f"fallback: 매핑 없음 → {category}[{fallback}] (최종 기본값)"
        else:
            reason = f"fallback table → our[{fallback}]"

        # 로그 기록
        _log_unmapped(
            fixture_name,
            attr_name,
            val,
            fallback,
            reason,
        )
        return f"{prefix}{fallback}{suffix}"

    return pattern, replacer


def _log_unmapped(fixture: str, attr: str, user_val: str, our_val: str, reason: str) -> None:
    line = f"{fixture} {attr} user[{user_val}] → our[{our_val}] ({reason})\n"
    logging.warning("Unmapped fallback: %s", line.rstrip())
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line)


def remap(src: Path, dst: Path, mapping_path: Path, dry_run: bool = False) -> str:
    """src XML 을 mapping 기반으로 변환, dst 에 쓰거나 dry_run 이면 변환 텍스트 반환."""
    mapping = _load_mapping(mapping_path)
    fixture_name = Path(src).name

    para_map: dict[str, str | None] = {
        str(k): str(v) if v is not None else None
        for k, v in mapping["paraPr"]["user_idx_to_our_idx"].items()
    }
    char_map: dict[str, str | None] = {
        str(k): str(v) if v is not None else None
        for k, v in mapping["charPr"]["user_idx_to_our_idx"].items()
    }
    border_map: dict[str, str | None] = {
        str(k): str(v) if v is not None else None
        for k, v in mapping["borderFill"]["user_idx_to_our_idx"].items()
    }

    with open(src, encoding="utf-8") as f:
        content = f.read()

    para_pat, para_rep = _make_replacer("paraPr", "paraPrIDRef", para_map, PARA_FALLBACK, fixture_name)
    char_pat, char_rep = _make_replacer("charPr", "charPrIDRef", char_map, CHAR_FALLBACK, fixture_name)
    border_pat, border_rep = _make_replacer("borderFill", "borderFillIDRef", border_map, BORDER_FALLBACK, fixture_name)

    # 변환 전 ref 분포 출력
    def count_refs(text: str, attr: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for v in re.findall(rf'{re.escape(attr)}="(\d+)"', text):
            counts[v] = counts.get(v, 0) + 1
        return dict(sorted(counts.items(), key=lambda x: int(x[0])))

    before_para = count_refs(content, "paraPrIDRef")
    before_char = count_refs(content, "charPrIDRef")
    before_border = count_refs(content, "borderFillIDRef")

    # 순차 치환
    content = para_pat.sub(para_rep, content)
    content = char_pat.sub(char_rep, content)
    content = border_pat.sub(border_rep, content)

    after_para = count_refs(content, "paraPrIDRef")
    after_char = count_refs(content, "charPrIDRef")
    after_border = count_refs(content, "borderFillIDRef")

    summary_lines = [
        f"=== {fixture_name} ===",
        f"  paraPrIDRef:    before={before_para} → after={after_para}",
        f"  charPrIDRef:    before={before_char} → after={after_char}",
        f"  borderFillIDRef before={before_border} → after={after_border}",
    ]
    summary = "\n".join(summary_lines)
    print(summary)

    if dry_run:
        return content

    # Atomic write
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(dir=dst.parent, suffix=".tmp")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, dst)
    except Exception:
        os.unlink(tmp_path)
        raise

    return content


# ---------------------------------------------------------------------------
# placeholder 재주입 — empty_box_template.xml 전용
# ---------------------------------------------------------------------------

EMPTY_BOX_PLACEHOLDERS = {
    # 정수 ID 자리
    r'<hp:rect id="\d+"':         '<hp:rect id="{{RECT_ID}}"',
    r'instid="\d+"':               'instid="{{INST_ID}}"',
    r'zOrder="\d+"':               'zOrder="{{ZORDER}}"',
    # 동적 크기 자리
    r'height="(\d{5,})"':          None,   # 특별 처리
    r'centerY="\d+"':              'centerY="{{CENTER_Y}}"',
    r'e6="\d+\.\d+"':              'e6="{{SCA_Y}}"',
    # hp:sz height
    r'(<hp:sz[^>]*height=)"\d+"':  None,   # 특별 처리
}

# empty_box_template placeholder 재주입 (remap 후 호출)
def _reinject_empty_box_placeholders(content: str) -> str:
    """remap 된 empty_box_template 내용에 placeholder 를 재주입.

    builder(shapes.py make_empty_box) 가 치환하는 6가지 placeholder 만 재주입:
    RECT_ID, ZORDER, INST_ID, HEIGHT, CENTER_Y, SCA_Y.

    ITEMS_CONTENT 는 empty_box 에서 사용 안 함 (condition_rect 전용).
    """

    # RECT_ID: <hp:rect id="N"
    content = re.sub(r'<hp:rect id="\d+"', '<hp:rect id="{{RECT_ID}}"', content)

    # INST_ID
    content = re.sub(r'instid="\d+"', 'instid="{{INST_ID}}"', content)

    # ZORDER
    content = re.sub(r'zOrder="\d+"', 'zOrder="{{ZORDER}}"', content)

    # HEIGHT — <hp:curSz ... height="NNNNN"> 와 <hp:sz ... height="NNNNN">
    content = re.sub(r'(<hp:curSz[^>]*height=)"\d+"', r'\1"{{HEIGHT}}"', content)
    content = re.sub(r'(<hp:sz[^>]*height=)"\d+"', r'\1"{{HEIGHT}}"', content)

    # CENTER_Y — rotationInfo centerY
    content = re.sub(r'(centerY=)"\d+"', r'\1"{{CENTER_Y}}"', content)

    # SCA_Y — scaMatrix e6 (값이 "0" 또는 "0.476682" 등 정수/소수 모두 허용)
    content = re.sub(r'(<hc:scaMatrix[^>]*e6=)"[\d.]+"', r'\1"{{SCA_Y}}"', content)

    return content


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="fixture ref 재매핑 도구")
    parser.add_argument("--mapping", required=True, help="Phase 2 산출 mapping.json 경로")
    parser.add_argument("--src", help="단일 변환: 원본 fixture XML 경로 (/tmp/showcase_extracted/<name>.xml)")
    parser.add_argument("--dst", help="단일 변환: 출력 fixture XML 경로 (resources/hwpx_base/<name>.xml)")
    parser.add_argument("--batch", action="store_true", help="18개 일괄 변환 모드")
    parser.add_argument("--src-dir", default="/tmp/showcase_extracted", help="batch 원본 디렉토리")
    parser.add_argument("--dst-dir", default="resources/hwpx_base", help="batch 출력 디렉토리")
    parser.add_argument("--dry-run", action="store_true", help="변환 결과만 stdout, 파일 미작성")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    FIXTURES_18 = [
        # Phase 4 이후 잔존 fixture (syn_div/Pascal/ganada 삭제됨)
        "bogi_box_4items.xml",
        "inc_dec_3x.xml",
        "inc_dec_4x.xml",
        # 기존 7개 (이름 갱신 2026-05-19)
        "pq_proposition_table_5x5.xml",
        "choice_image_5options.xml",
        "empty_box_template.xml",
        "prob_dist_5cols.xml",
        "prob_dist_6cols.xml",
        "prob_dist_7cols.xml",
        "proof_table_template.xml",
    ]

    if args.batch:
        src_dir = Path(args.src_dir)
        dst_dir = Path(args.dst_dir)
        for name in FIXTURES_18:
            src_path = src_dir / name
            dst_path = dst_dir / name
            if not src_path.exists():
                print(f"WARNING: {src_path} 없음 — 건너뜀", file=sys.stderr)
                continue
            content = remap(src_path, dst_path, Path(args.mapping), dry_run=args.dry_run)
            # empty_box_template placeholder 재주입
            if name == "empty_box_template.xml" and not args.dry_run:
                injected = _reinject_empty_box_placeholders(content)
                tmp_fd, tmp_path = tempfile.mkstemp(dir=dst_path.parent, suffix=".tmp")
                try:
                    with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                        f.write(injected)
                    os.replace(tmp_path, dst_path)
                except Exception:
                    os.unlink(tmp_path)
                    raise
                print(f"  → placeholder 재주입 완료: {dst_path}")
            elif not args.dry_run:
                print(f"  → 저장 완료: {dst_path}")
    else:
        if not args.src:
            parser.error("--batch 없이 사용 시 --src 필수")
        if not args.dst and not args.dry_run:
            parser.error("--dry-run 없이 단일 변환 시 --dst 필수")
        dst_path = Path(args.dst) if args.dst else Path(args.src)  # dry-run 시 dst 미사용
        content = remap(Path(args.src), dst_path, Path(args.mapping), dry_run=args.dry_run)
        if args.dry_run:
            # 단일 dry-run 은 stdout 에 일부만 출력
            lines = content.split("\n")
            for line in lines[:60]:
                print(line)
            if len(lines) > 60:
                print(f"... ({len(lines) - 60}줄 생략)")
        else:
            name = Path(args.src).name
            if name == "empty_box_template.xml":
                injected = _reinject_empty_box_placeholders(content)
                dst_path = Path(args.dst)
                tmp_fd, tmp_path = tempfile.mkstemp(dir=dst_path.parent, suffix=".tmp")
                try:
                    with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                        f.write(injected)
                    os.replace(tmp_path, dst_path)
                except Exception:
                    os.unlink(tmp_path)
                    raise
                print(f"  → placeholder 재주입 완료: {args.dst}")
            else:
                print(f"  → 저장 완료: {args.dst}")


if __name__ == "__main__":
    main()
