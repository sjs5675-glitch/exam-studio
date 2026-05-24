# syn_div + Pascal extractor reference

## 목적

extractor stage 가 PDF / 이미지에서 조립제법 (synthetic division, syn_div) 또는 파스칼 삼각형 (Pascal triangle) 을 감지했을 때 emit 해야 할 dict 형식 명세. 이 문서는 generator (`tables.py` `make_syn_div_table`, `make_pascal_table`) 가 기대하는 입력과 1:1 align. 이 문서를 갱신할 때는 generator 도 함께 갱신할 것 (single source of truth).

---

## syn_div (조립제법)

### 입력 dict 스키마

```json
{
  "type": "synthetic_division",
  "degree": 3,
  "n_rows": 4,
  "n_cols": 5,
  "rows": [
    [
      {"type": "equation", "script": "2"},
      {"type": "equation", "script": "1"},
      {"type": "equation", "script": "-3"},
      {"type": "equation", "script": "0"},
      {"type": "equation", "script": "4"}
    ],
    [
      {"type": "equation", "script": ""},
      {"type": "equation", "script": "2"},
      {"type": "equation", "script": "-2"},
      {"type": "equation", "script": "-4"},
      {"type": "equation", "script": ""}
    ],
    [
      {"type": "equation", "script": ""},
      {"type": "equation", "script": ""},
      {"type": "equation", "script": ""},
      {"type": "equation", "script": ""},
      {"type": "equation", "script": ""}
    ],
    [
      {"type": "equation", "script": ""},
      {"type": "equation", "script": "1"},
      {"type": "equation", "script": "-1"},
      {"type": "equation", "script": "-2"},
      {"type": "equation", "script": "0"}
    ]
  ]
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"synthetic_division"` | 고정값 |
| `degree` | int | 나눠지는 다항식의 최고차수 (예: 3차 → 3) |
| `n_rows` | int | 표 행 수 (보통 degree + 1: 계수행 + 곱셈행 + 구분선행 + 결과행) |
| `n_cols` | int | 표 열 수 (보통 degree + 2: 나눗수 열 + 계수 수) |
| `rows` | 2D 배열 | 각 행의 셀 배열. **모든 셀은 항상 equation** (아래 규칙 참조) |

### 셀 규칙 (중요)

**syn_div 표의 모든 데이터 셀은 항상 equation 으로 렌더링된다.** 셀 값이 단순 정수 (`2`, `-3`)이든 변수식 (`k+1`, `x^2`)이든 빈 셀이든 무관하게 `{"type": "equation", "script": "..."}` 형식으로 출력. 이유: 양식지 원본이 모든 셀을 HWP 수식 폰트(HYhwpEQ)로 렌더링하므로, text 모드로 들어가면 폰트/크기/정렬이 어긋남.

generator (`tables.py:make_syn_div_table`) 는 입력 dict 의 type/script 와 무관하게 모든 셀을 equation 경로 (`_inject_cell_value(..., force_equation=True)`) 로 라우팅한다. 따라서 reference 형식은 일관성 차원에서 equation 으로 통일.

| 상황 | 출력 형식 |
|------|-----------|
| 단순 정수, 변수식, 분수 등 모든 비어있지 않은 셀 | `{"type": "equation", "script": "<HWP 수식 문법>"}` |
| 빈 셀 | `{"type": "equation", "script": ""}` (generator 가 자연스럽게 빈 셀로 처리) |

### 예시 1 — `x^3 - 2x^2 + 3x - 4` 를 `(x - 1)` 로 나누기

```json
{
  "type": "synthetic_division",
  "degree": 3,
  "n_rows": 4,
  "n_cols": 5,
  "rows": [
    [{"type":"text","value":"1"},  {"type":"text","value":"1"}, {"type":"text","value":"-2"}, {"type":"text","value":"3"},  {"type":"text","value":"-4"}],
    [{"type":"text","value":""},   {"type":"text","value":"1"}, {"type":"text","value":"-1"}, {"type":"text","value":"2"},  {"type":"text","value":""}],
    [{"type":"text","value":""},   {"type":"text","value":""},  {"type":"text","value":""},   {"type":"text","value":""},   {"type":"text","value":""}],
    [{"type":"text","value":""},   {"type":"text","value":"1"}, {"type":"text","value":"-1"}, {"type":"text","value":"2"},  {"type":"text","value":"-2"}]
  ]
}
```

### 예시 2 — 계수에 변수 포함 (`k+1`)

```json
{
  "type": "synthetic_division",
  "degree": 2,
  "n_rows": 4,
  "n_cols": 4,
  "rows": [
    [{"type":"text","value":"2"},  {"type":"equation","script":"k + 1"}, {"type":"text","value":"-3"}, {"type":"text","value":"2"}],
    [{"type":"text","value":""},   {"type":"text","value":"4"},          {"type":"equation","script":"2k + 6"}, {"type":"text","value":""}],
    [{"type":"text","value":""},   {"type":"text","value":""},           {"type":"text","value":""},            {"type":"text","value":""}],
    [{"type":"text","value":""},   {"type":"equation","script":"k + 5"}, {"type":"equation","script":"2k + 3"}, {"type":"text","value":"2"}]
  ]
}
```

---

## Pascal (파스칼 삼각형)

### 입력 dict 스키마

```json
{
  "type": "pascal",
  "n_rows": 5,
  "cells": [
    [{"type": "equation", "script": "{} _{0} rm C _{0}"}],
    [{"type": "equation", "script": "{} _{1} rm C _{0}"}, {"type": "equation", "script": "{} _{1} rm C _{1}"}],
    [{"type": "equation", "script": "{} _{2} rm C _{0}"}, {"type": "equation", "script": "{} _{2} rm C _{1}"}, {"type": "equation", "script": "{} _{2} rm C _{2}"}],
    [{"type": "equation", "script": "{} _{3} rm C _{0}"}, {"type": "equation", "script": "{} _{3} rm C _{1}"}, {"type": "equation", "script": "{} _{3} rm C _{2}"}, {"type": "equation", "script": "{} _{3} rm C _{3}"}],
    [{"type": "equation", "script": "{} _{4} rm C _{0}"}, {"type": "equation", "script": "{} _{4} rm C _{1}"}, {"type": "equation", "script": "{} _{4} rm C _{2}"}, {"type": "equation", "script": "{} _{4} rm C _{3}"}, {"type": "equation", "script": "{} _{4} rm C _{4}"}]
  ]
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"pascal"` | 고정값 |
| `n_rows` | int | 행 수 (0행 포함). n_rows=5 이면 0행~4행, 총 5행 |
| `cells` | 2D 배열 | 행 r 에 r+1 개 셀. 셀은 항상 equation dict |

### 셀 규칙

- **모든 Pascal 셀은 항상 `equation` 타입** — `text` 모드 금지.
- 표기법: `{} _{n} rm C _{k}` (HWP 수식 문법). 여기서 `n` 은 행 번호(0-based), `k` 는 열 번호(0-based).
- 값 계산(이항계수 숫자)은 generator 또는 후속 stage 에서 처리 — extractor 는 binomial 표기만 출력.

### 예시 — n_rows=3 (0행~2행)

```json
{
  "type": "pascal",
  "n_rows": 3,
  "cells": [
    [{"type":"equation","script":"{} _{0} rm C _{0}"}],
    [{"type":"equation","script":"{} _{1} rm C _{0}"}, {"type":"equation","script":"{} _{1} rm C _{1}"}],
    [{"type":"equation","script":"{} _{2} rm C _{0}"}, {"type":"equation","script":"{} _{2} rm C _{1}"}, {"type":"equation","script":"{} _{2} rm C _{2}"}]
  ]
}
```

---

## generator 연결 (tables.py)

`make_syn_div_table(data, base_path)` 와 `make_pascal_table(data, base_path)` 는 위 스키마 형식의 `data` dict 를 직접 수신한다. 셀 값이 `{"type":"equation","script":"..."}` 이면 generator 의 `_inject_cell_value` 가 equation 경로(`<hp:equation>`)로 라우팅하고, `{"type":"text","value":"..."}` 이면 텍스트 경로로 라우팅한다.

**단, extractor 가 출력하는 형식이 generator 입력과 직접 매핑되려면 extractor output 의 셀이 위 dict 형식이어야 한다. 이 reference 문서가 그 계약을 정의한다.**
