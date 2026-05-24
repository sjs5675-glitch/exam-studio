# inc_dec extractor reference

## 목적

extractor stage 가 PDF / 이미지에서 증감표 (x 값 경계, f'(x) 부호, f(x) 증감) 를 감지했을 때 emit 해야 할 dict 형식 명세. 이 문서는 generator (`tables.py` `make_increase_decrease_table`) 가 기대하는 입력과 1:1 align.

---

## increase_decrease (증감표)

### 입력 dict 스키마

```json
{
  "type": "increase_decrease",
  "x_values": ["a", "b"],
  "rows": [
    {"label": "f prime(x)", "values": ["+", "0", "-", "0", "+"]},
    {"label": "f(x)", "values": ["NEARROW", "극대", "SEARROW", "극소", "NEARROW"]}
  ]
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"increase_decrease"` | 고정값 |
| `x_values` | 배열 | 경계값 목록. 개수(`n_x`)로 fixture 선택. 수식 문자열 또는 숫자 문자열 |
| `rows` | 배열 | 데이터 행 목록. 각 행은 `label` + `values` |
| `rows[i].label` | 문자열 | 행 라벨. HWP 수식 문자열 (예: `"f prime(x)"`, `"f(x)"`) |
| `rows[i].values` | 배열 | `n_x * 2 + 1` 개 값. `+`/`-`/`0` 또는 `NEARROW`/`SEARROW` 또는 텍스트 |

### selector 조건 (n_x = len(x_values))

| `n_x` | fixture | 표 구조 |
|-------|---------|---------|
| `1` | `inc_dec_1x.xml` | 3행 4열 (x + ··· 1구간 + ···) |
| `2` | `inc_dec_2x.xml` | 3행 6열 |
| `3` | `inc_dec_3x.xml` | 4행 8열 (y', y'', y 3행) |
| `4` 또는 `5` | `inc_dec_4x.xml` | 5행 12열 (슬롯 5개) |
| `>= 6` | 프로그래매틱 생성 | borderFill 패턴 |

### values 배열 구조 (n_x=k 기준)

`values` 배열 길이는 `2*n_x + 1` 이 표준:

```
[구간1, 경계1, 구간2, 경계2, ..., 경계n_x, 구간(n_x+1)]
```

| 값 | 의미 |
|----|------|
| `"+"` | 양수 (증가/양의 부호) |
| `"-"` | 음수 (감소/음의 부호) |
| `"0"` | 0 (극값 위치) |
| `"NEARROW"` | ↗ 화살표 (증가) |
| `"SEARROW"` | ↘ 화살표 (감소) |
| `"극대"`, `"극소"` | 텍스트 |
| 수식 값 | HWP 수식 문자열 (예: `"2 sqrt{3}"`) |
| `""` | 빈 셀 |

### 예시 1 — n_x=1 (경계값 1개)

```json
{
  "type": "increase_decrease",
  "x_values": ["0"],
  "rows": [
    {"label": "f prime(x)", "values": ["+", "0", "-"]},
    {"label": "f(x)", "values": ["NEARROW", "극대", "SEARROW"]}
  ]
}
```

### 예시 2 — n_x=2 (경계값 2개)

```json
{
  "type": "increase_decrease",
  "x_values": ["-1", "1"],
  "rows": [
    {"label": "f prime(x)", "values": ["-", "0", "+", "0", "-"]},
    {"label": "f(x)", "values": ["SEARROW", "극소", "NEARROW", "극대", "SEARROW"]}
  ]
}
```

### 예시 3 — n_x=2, 수식 값 포함

```json
{
  "type": "increase_decrease",
  "x_values": ["alpha", "beta"],
  "rows": [
    {"label": "f prime(x)", "values": ["+", "0", "-", "0", "+"]},
    {"label": "f(x)", "values": ["NEARROW", "2 sqrt{3}", "SEARROW", "-2 sqrt{3}", "NEARROW"]}
  ]
}
```

### 예시 4 — n_x=3 (y', y'' 포함)

```json
{
  "type": "increase_decrease",
  "x_values": ["a", "b", "c"],
  "rows": [
    {"label": "y prime", "values": ["+", "0", "-", "0", "+", "0", "-"]},
    {"label": "y prime prime", "values": ["+", "+", "+", "0", "-", "-", "-"]},
    {"label": "y", "values": ["NEARROW", "극대", "SEARROW", "변곡", "SEARROW", "극소", "SEARROW"]}
  ]
}
```

---

## generator 연결 (tables.py)

`make_increase_decrease_table(explanation_table, base_path)` 는 위 스키마 형식의 `explanation_table` dict 를 직접 수신한다.

- `x_values` 의 각 값 → 헤더 행의 홀수 인덱스 셀 (col 2, 4, 6, ...) 에 주입
- `rows[i].values[j]` → 데이터 행의 값 셀에 주입
  - `NEARROW`/`SEARROW` → `make_equation_xml` + `make_lineseg` (화살표 수식)
  - 수식 문자열 감지 시 → equation 경로
  - 나머지 → text 경로
- `rows[i].label` → fixture 박힘 셀 보존 (label 은 injection 대상이 아님, fixture 원본 `f prime(x)` 등 유지)
- n_x >= 6: 프로그래매틱 생성 (borderFill ID 패턴으로 표 구조 생성)

**이 reference 문서가 extractor 출력과 generator 입력 사이의 계약을 정의한다.**
