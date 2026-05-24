#!/usr/bin/env python3
"""
HWPX XML 검증 + 자동수정 스크립트

검증 항목:
  1. XML 파싱 (well-formed)
  2. 수식 <hp:script> 내 이스케이프 누락
  3. 테이블 cellAddr rowAddr 정합성
  4. zOrder 중복
  5. 태그 균형 (XML 파싱 실패 시 보조 진단)
  6. content.hpf 매니페스트 일치

사용법:
  python validate.py <file.hwpx> [--fix]
"""

import zipfile, re, sys, os


def validate_hwpx(hwpx_path):
    errors = []
    if not os.path.exists(hwpx_path):
        return [f"파일 없음: {hwpx_path}"]
    try:
        zf = zipfile.ZipFile(hwpx_path, 'r')
    except zipfile.BadZipFile:
        return [f"유효하지 않은 ZIP: {hwpx_path}"]

    names = zf.namelist()

    required = ['mimetype', 'Contents/section0.xml', 'Contents/header.xml',
                'Contents/content.hpf', 'META-INF/container.xml']
    for r in required:
        if r not in names:
            errors.append(f"필수 파일 누락: {r}")

    try:
        from lxml import etree
        parse_xml = etree.fromstring
        xml_error = etree.XMLSyntaxError
    except ModuleNotFoundError:
        import xml.etree.ElementTree as etree
        parse_xml = etree.fromstring
        xml_error = etree.ParseError
    xml_files = [n for n in names if n.endswith('.xml') or n.endswith('.hpf')]
    for fname in xml_files:
        try:
            parse_xml(zf.read(fname))
        except xml_error as e:
            errors.append(f"XML 파싱 오류 [{fname}]: {e}")

    if 'Contents/section0.xml' in names:
        section = zf.read('Contents/section0.xml').decode('utf-8')

        # 수식 이스케이프
        raw_lt = re.findall(r'<hp:script>[^<]*<(?!/hp:script>)', section)
        for match in raw_lt:
            errors.append(f"수식 이스케이프 누락 (<): ...{match[-60:]}")

        # 테이블 cellAddr
        for tbl_m in re.finditer(r'<hp:tbl [^>]*>.*?</hp:tbl>', section, re.DOTALL):
            tbl_text = tbl_m.group(0)
            tbl_id = re.search(r'id="([^"]+)"', tbl_text)
            label = tbl_id.group(1) if tbl_id else '?'
            rows = list(re.finditer(r'<hp:tr>', tbl_text))
            for row_idx, row_m in enumerate(rows):
                row_start = row_m.start()
                row_end = tbl_text.index('</hp:tr>', row_start)
                row_text = tbl_text[row_start:row_end]
                for addr_m in re.finditer(r'<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"', row_text):
                    if int(addr_m.group(2)) != row_idx:
                        errors.append(f"테이블 cellAddr 오류 [tbl id={label}]: row[{row_idx}]의 rowAddr={addr_m.group(2)}")
                        break

        # zOrder 중복
        zorders = re.findall(r'zOrder="(\d+)"', section)
        seen, dupes = set(), set()
        for zo in zorders:
            if zo in seen: dupes.add(zo)
            seen.add(zo)
        if dupes:
            errors.append(f"zOrder 중복: {sorted(dupes, key=int)}")

        # 태그 균형 (XML 실패 시만)
        if any('section0.xml' in e for e in errors):
            for tag in ['hp:subList', 'hp:endNote', 'hp:p', 'hp:tbl', 'hp:tr', 'hp:tc', 'hs:sec']:
                opens = len(re.findall(rf'<{tag}[\s>]', section))
                sc = len(re.findall(rf'<{tag}\s[^>]*/>', section))
                closes = len(re.findall(rf'</{tag}>', section))
                if opens - sc != closes:
                    errors.append(f"태그 불일치 [{tag}]: 열림={opens-sc} 닫힘={closes}")

    bindata = [n for n in names if n.startswith('BinData/')]
    if 'Contents/content.hpf' in names:
        hpf = zf.read('Contents/content.hpf').decode('utf-8')
        for bf in bindata:
            if bf.split('/')[-1] not in hpf:
                errors.append(f"매니페스트 누락: {bf}")

    zf.close()
    return errors


def fix_hwpx(hwpx_path):
    tmp_path = hwpx_path + '.fix_tmp'
    fixes = {'escape': 0, 'celladdr': 0, 'zorder': 0}

    with zipfile.ZipFile(hwpx_path, 'r') as zin, \
         zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'Contents/section0.xml':
                text = data.decode('utf-8')

                def esc(m):
                    c = m.group(1)
                    t = c.replace('&amp;','&').replace('&lt;','<').replace('&gt;','>')
                    e = t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
                    if e != c: fixes['escape'] += 1
                    return f'<hp:script>{e}</hp:script>'
                text = re.sub(r'<hp:script>(.*?)</hp:script>', esc, text, flags=re.DOTALL)

                def fix_tbl(m):
                    tbl = m.group(0)
                    # Parse colCnt from table tag
                    col_cnt_m = re.search(r'colCnt="(\d+)"', tbl)
                    col_cnt = int(col_cnt_m.group(1)) if col_cnt_m else 0
                    res, ri, i, changed = [], 0, 0, False
                    # Track remaining rowSpan per column
                    span_remaining = [0] * max(col_cnt, 20)
                    while i < len(tbl):
                        if tbl[i:i+6] == '<hp:tr':
                            te = tbl.index('</hp:tr>', i) + 8
                            tc = tbl[i:te]
                            # Determine actual colAddr for each cell in this row
                            # by skipping columns still occupied by rowSpan from prior rows
                            ci = 0
                            def fa(m2):
                                nonlocal ci, changed
                                # Skip columns occupied by rowSpan from previous rows
                                while ci < len(span_remaining) and span_remaining[ci] > 0:
                                    ci += 1
                                actual_col = ci
                                if int(m2.group(1)) != actual_col or int(m2.group(2)) != ri:
                                    changed = True
                                r = f'<hp:cellAddr colAddr="{actual_col}" rowAddr="{ri}"'
                                # 현재 cellAddr 뒤의 cellSpan 에서 colSpan 추출 → ci 를 colSpan 만큼 증가.
                                # cellSpan 은 같은 cell 안의 cellAddr 직후에 위치.
                                rest = m2.string[m2.end():]
                                next_span_m = re.search(r'<hp:cellSpan colSpan="(\d+)" rowSpan="\d+"', rest)
                                col_span = int(next_span_m.group(1)) if next_span_m else 1
                                ci += col_span
                                return r
                            # First pass: fix cellAddr, then extract spans
                            fixed_tc = re.sub(r'<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"', fa, tc)
                            # Now extract colSpan/rowSpan from each cell to update span_remaining
                            cells = list(re.finditer(r'<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"', fixed_tc))
                            spans = list(re.finditer(r'<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"', fixed_tc))
                            # Decrement span_remaining for this row
                            for c in range(len(span_remaining)):
                                if span_remaining[c] > 0:
                                    span_remaining[c] -= 1
                            # Set span_remaining for cells in this row
                            for cell_m, span_m in zip(cells, spans):
                                col = int(cell_m.group(1))
                                col_span = int(span_m.group(1))
                                row_span = int(span_m.group(2))
                                if row_span > 1:
                                    for c in range(col, col + col_span):
                                        if c < len(span_remaining):
                                            span_remaining[c] = row_span - 1
                            res.append(fixed_tc)
                            ri += 1; i = te
                        else:
                            res.append(tbl[i]); i += 1
                    if changed: fixes['celladdr'] += 1
                    return ''.join(res)
                text = re.sub(r'<hp:tbl [^>]*>.*?</hp:tbl>', fix_tbl, text, flags=re.DOTALL)

                zo_seen = set()
                def fz(m):
                    z = int(m.group(1)); o = z
                    while z in zo_seen: z += 1
                    zo_seen.add(z)
                    if z != o: fixes['zorder'] += 1
                    return f'zOrder="{z}"'
                text = re.sub(r'zOrder="(\d+)"', fz, text)

                data = text.encode('utf-8')
            zout.writestr(item, data)

    os.replace(tmp_path, hwpx_path)
    return fixes


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python validate.py <file.hwpx> [--fix]")
        sys.exit(1)
    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"Error: 파일 없음: {path}"); sys.exit(1)
    if '--fix' in sys.argv:
        f = fix_hwpx(path)
        msgs = []
        if f['escape']: msgs.append(f"수식 이스케이프 {f['escape']}건")
        if f['celladdr']: msgs.append(f"테이블 cellAddr {f['celladdr']}건")
        if f['zorder']: msgs.append(f"zOrder 중복 {f['zorder']}건")
        if msgs: print(f"[FIX] {', '.join(msgs)} 수정")
    errors = validate_hwpx(path)
    if errors:
        print(f"\n=== HWPX 검증 실패: {len(errors)}건 ===")
        for i, e in enumerate(errors, 1): print(f"  {i}. {e}")
        sys.exit(1)
    else:
        print(f"HWPX 검증 통과: {path}")
        sys.exit(0)
