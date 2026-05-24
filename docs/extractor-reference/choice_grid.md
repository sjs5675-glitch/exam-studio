# choice_grid extractor reference

## 목적

extractor stage 가 PDF / 이미지에서 (가)/(나) 또는 (가)/(나)/(다) 형태의 열 헤더 + ①~⑤ 번호 그리드 선지 테이블을 감지했을 때 emit 해야 할 dict 형식 명세. 이 문서는 generator (`tables.py` `make_choice_table`) 가 기대하는 입력과 1:1 align.

---

## choice_grid_2cols ((가)(나) 2열 선지)

### 입력 dict 스키마

```json
{
  "type": "choice_table",
  "table_type": "choice_grid_2cols",
  "rows": [
    ["", "(가)", "(나)"],
    ["①", "val1", "val2"],
    ["②", "val3", "val4"],
    ["③", "val5", "val6"],
    ["④", "val7", "val8"],
    ["⑤", "val9", "val10"]
  ]
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"choice_table"` | 고정값 |
| `table_type` | `"choice_grid_2cols"` | fixture 선택 키. 옛 키 `"6x3"` 도 호환 허용 |
| `rows` | 2D 배열 | 6행 3열. row0 = 헤더, row1~5 = ①~⑤ 선지 |
| `rows[0]` | `["", "(가)", "(나)"]` | 헤더 행. 빈 번호 셀 + 열 이름 (fixture 박힘과 동일, 덮어써도 됨) |
| `rows[1..5][0]` | `①`~`⑤` | 번호 (fixture 박힘과 동일, 생략하거나 `""` 가능) |
| `rows[1..5][1]` | 문자열 | (가) 열 각 선지 내용 |
| `rows[1..5][2]` | 문자열 | (나) 열 각 선지 내용 |

### 셀 규칙

| 상황 | 권장 형식 |
|------|-----------|
| 순수 숫자/한글 | 그대로 문자열: `"3"`, `"증가"` |
| 수식 포함 | HWP 수식 문자열: `"2 pi"`, `"sqrt{3} over 2"` |
| 빈 셀 | `""` (fixture 원본 셀 유지) |

---

## choice_grid_3cols ((가)(나)(다) 3열 선지)

### 입력 dict 스키마

```json
{
  "type": "choice_table",
  "table_type": "choice_grid_3cols",
  "rows": [
    ["", "(가)", "(나)", "(다)"],
    ["①", "v1", "v2", "v3"],
    ["②", "v4", "v5", "v6"],
    ["③", "v7", "v8", "v9"],
    ["④", "v10", "v11", "v12"],
    ["⑤", "v13", "v14", "v15"]
  ]
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"choice_table"` | 고정값 |
| `table_type` | `"choice_grid_3cols"` | fixture 선택 키. 옛 키 `"6x4"` 도 호환 허용 |
| `rows` | 2D 배열 | 6행 4열. row0 = 헤더, row1~5 = ①~⑤ 선지 |
| `rows[1..5][1]` | 문자열 | (가) 열 선지 내용 |
| `rows[1..5][2]` | 문자열 | (나) 열 선지 내용 |
| `rows[1..5][3]` | 문자열 | (다) 열 선지 내용 |

---

## 예시 1 — 2cols: 확률값 그리드

```json
{
  "type": "choice_table",
  "table_type": "choice_grid_2cols",
  "rows": [
    ["", "(가)", "(나)"],
    ["①", "1 over 6", "1 over 3"],
    ["②", "1 over 4", "1 over 2"],
    ["③", "1 over 3", "2 over 3"],
    ["④", "1 over 2", "1 over 4"],
    ["⑤", "2 over 3", "1 over 6"]
  ]
}
```

## 예시 2 — 3cols: 함수값 그리드

```json
{
  "type": "choice_table",
  "table_type": "choice_grid_3cols",
  "rows": [
    ["", "(가)", "(나)", "(다)"],
    ["①", "1", "2", "3"],
    ["②", "2", "3", "4"],
    ["③", "3", "4", "5"],
    ["④", "4", "5", "6"],
    ["⑤", "5", "6", "7"]
  ]
}
```

---

## generator 연결 (tables.py)

`make_choice_table(condition_box, base_path)`:

- `table_type="choice_grid_2cols"` → `choice_grid_2cols.xml` (6행 3열)
- `table_type="choice_grid_3cols"` → `choice_grid_3cols.xml` (6행 4열)

cellAddr 기반 in-place 치환:
- 2cols: `colAddr=1 rowAddr=1~5` (가 내용), `colAddr=2 rowAddr=1~5` (나 내용)
- 3cols: `colAddr=1~3 rowAddr=1~5` 각 내용

fixture 박힘 `(가)`/`(나)`/`(다)` 헤더, `①~⑤` 번호는 `rows` 값이 제공되면 덮어써지고, 빈 문자열이면 fixture 원본 유지.

**이 reference 문서가 extractor 출력과 generator 입력 사이의 계약을 정의한다.**
