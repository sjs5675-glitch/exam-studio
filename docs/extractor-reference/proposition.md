# proposition extractor reference

## 목적

extractor stage 가 PDF / 이미지에서 p:/q: 형태의 명제 선지 테이블 (①~⑤ 번호 × p:조건/q:결론 구조) 을 감지했을 때 emit 해야 할 dict 형식 명세. 이 문서는 generator (`tables.py` `make_choice_table`) 가 기대하는 입력과 1:1 align.

---

## pq_proposition (명제 p:/q: 5선지)

### 입력 dict 스키마

```json
{
  "type": "choice_table",
  "table_type": "proposition",
  "rows": [
    ["h1", "c1"],
    ["h2", "c2"],
    ["h3", "c3"],
    ["h4", "c4"],
    ["h5", "c5"]
  ]
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"choice_table"` | 고정값. `make_choice_table` 디스패치 키 |
| `table_type` | `"proposition"` | fixture 선택 키. 옛 키 `"5x5"` 도 호환 허용 |
| `rows` | 2D 배열 | 5행 × 2열. `rows[i][0]` = p: 내용, `rows[i][1]` = q: 내용 (①~⑤ 순서) |

### 셀 규칙

- `rows[i][0]` → col2 (p 내용 셀), `rows[i][1]` → col4 (q 내용 셀) 에 주입
- fixture 박힘 col0 (①~⑤), col1 (`p:`), col3 (`q:`) 은 보존 — 덮어쓰기 불가
- 셀 값이 수식 문자열이면 자동으로 equation 경로 (`make_equation_xml`) 를 거침 (`_inject_cell_value` 내부 로직)
- 셀 값에 알파벳·특수문자 (`[a-zA-Z_{}^\\]`) 가 없으면 텍스트 경로로 렌더링됨

| 상황 | 권장 형식 |
|------|-----------|
| 순수 한글 텍스트 | 그대로 문자열: `"f 는 연속함수이다."` |
| 수식 포함 | HWP 수식 문자열: `"f(x) > 0"`, `"lim_{x to 0} f(x) = 1"` |

### 예시 1 — 명제 선지 5개

```json
{
  "type": "choice_table",
  "table_type": "proposition",
  "rows": [
    ["f 는 실수 전체에서 연속이다.", "f(0) = 0"],
    ["f 는 x=0 에서 미분가능하다.", "f prime(0) = 1"],
    ["lim_{x to 0^{+}} f(x) = f(0)", "f 는 단조증가이다."],
    ["f(1) > f(-1)", "f 의 최솟값이 존재한다."],
    ["f 의 역함수가 존재한다.", "f prime(x) > 0 for all x"]
  ]
}
```

### 예시 2 — 부등식 형태 명제

```json
{
  "type": "choice_table",
  "table_type": "proposition",
  "rows": [
    ["a > 0", "b > 0"],
    ["a + b > 0", "ab > 0"],
    ["a^2 > b^2", "a > b"],
    ["a > b", "a^2 > ab"],
    ["|a| > |b|", "a > b"]
  ]
}
```

---

## generator 연결 (tables.py)

`make_choice_table(condition_box, base_path)` → `CHOICE_TABLE_MAP["proposition"]` = `pq_proposition_table_5x5.xml` 로드.

- fixture 의 셀 구조: 5행 5열 (colSpan=1, rowSpan=1 전체)
  - col0: ①~⑤ 번호 (fixture 박힘)
  - col1: `p:` 수식 라벨 (fixture 박힘)
  - col2: p 내용 → extractor 입력 `rows[i][0]` 주입
  - col3: `q:` 수식 라벨 (fixture 박힘)
  - col4: q 내용 → extractor 입력 `rows[i][1]` 주입
- cellAddr 기반 in-place 치환: `colAddr=2 rowAddr=i` 및 `colAddr=4 rowAddr=i`

**이 reference 문서가 extractor 출력과 generator 입력 사이의 계약을 정의한다.**
