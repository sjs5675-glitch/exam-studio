# bogi extractor reference

## 목적

extractor stage 가 PDF / 이미지에서 보기 박스 (< 보 기 > 스타일, ㄱ/ㄴ/ㄷ 라벨) 를 감지했을 때 emit 해야 할 dict 형식 명세. 이 문서는 generator (`tables.py` `make_bogi_table`) 가 기대하는 입력과 1:1 align. 이 문서를 갱신할 때는 generator 도 함께 갱신할 것 (single source of truth).

---

## bogi (보기 박스)

### 입력 dict 스키마

```json
{
  "type": "bogi",
  "items": [
    {"parts": [{"t": "첫 번째 항목 텍스트"}, {"eq": "f(x) > 0"}]},
    {"parts": [{"eq": "x^2 + 1"}]},
    {"parts": [{"t": "세 번째 항목"}]}
  ]
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"bogi"` | 고정값 |
| `items` | 배열 | ㄱ./ㄴ./ㄷ. 순서의 항목들. 3개 이하 → 3items 템플릿, 4개 → 4items, 5~6개 → 6items |
| `items[i].parts` | 배열 | 각 항목의 구성 요소. `{"t": "..."}` (텍스트) 또는 `{"eq": "..."}` (수식) 혼합 가능 |

### 셀 규칙

**항목 내 텍스트/수식 혼합**: `parts` 배열 안에서 `t` 키는 텍스트, `eq` 키는 HWP 수식 문자열.

| 상황 | 출력 형식 |
|------|-----------|
| 일반 한글/영문 텍스트 | `{"t": "텍스트 내용"}` |
| 수식, 부등식, 함수식 등 | `{"eq": "HWP 수식 문자열"}` |
| 텍스트 + 수식 혼합 | parts 배열에 t/eq 혼합: `[{"t": "단, "}, {"eq": "x > 0"}]` |

### selector 조건

| `n_items` | fixture | 라벨 |
|-----------|---------|------|
| `<= 3` | `bogi_box_3items.xml` (4행 5열) | ㄱ. ㄴ. ㄷ. |
| `== 4` | `bogi_box_4items.xml` (4행 5열) | ㄱ. ㄴ. ㄷ. ㄹ. |
| `>= 5` | `bogi_box_6items.xml` (7행 7열) | ㄱ. ㄴ. ㄷ. ㄹ. ㅁ. ㅂ. (2열 3행 레이아웃) |

### 예시 1 — 3항목 (ㄱ/ㄴ/ㄷ)

```json
{
  "type": "bogi",
  "items": [
    {"parts": [{"t": "ㄱ은 단순 텍스트 항목이다."}]},
    {"parts": [{"eq": "f(x) = x^2 - 3x + 2"}]},
    {"parts": [{"t": "단, "}, {"eq": "x geq 0"}]}
  ]
}
```

### 예시 2 — 4항목 (ㄱ/ㄴ/ㄷ/ㄹ)

```json
{
  "type": "bogi",
  "items": [
    {"parts": [{"t": "집합 A는 유한집합이다."}]},
    {"parts": [{"eq": "A cup B = A"}]},
    {"parts": [{"eq": "A cap B = B"}]},
    {"parts": [{"t": "A와 B는 서로소이다."}]}
  ]
}
```

---

## generator 연결 (tables.py)

`make_bogi_table(condition_box, base_path)` 는 위 스키마 형식의 `condition_box` dict 를 직접 수신한다.

- `items` 의 각 항목에서 `parts` 를 순서대로 처리:
  - `{"eq": "..."}` → `make_equation_xml(part["eq"])` 로 수식 XML 생성
  - `{"t": "..."}` → `<hp:t>{xml_escape(...)}</hp:t>` 로 텍스트 삽입
- 생성된 내용은 fixture 의 각 라벨(ㄱ./ㄴ./...) 뒤에 주입됨

**이 reference 문서가 extractor 출력과 generator 입력 사이의 계약을 정의한다.**
