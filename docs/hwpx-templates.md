# HWPX 특수 템플릿 참조 가이드

양식지(`studio/inputs/시험지 제작/기출작업양식지.hwpx`)에는
특수 문제 유형에 필요한 **XML 테이블 템플릿**이 포함되어 있다.

builder가 해당 유형의 문제를 만날 때, 양식지에서 XML을 추출하여 사용해야 한다.

## 템플릿 목록

### 1. 함수 증감표 (Function Increase/Decrease Table)

**용도**: f'(x), f(x)의 부호 변화와 증감을 표로 보여줌
**위치**: section0.xml 내 "함수 증감표양식" 텍스트 이후의 `<hp:tbl>` 요소들

**변형 종류**:
| 변형 | 열 수 | 행 | 용도 |
|------|-------|-----|------|
| 기본 (2열) | x, ..., 값, ... | f'(x), f(x) | 극값 1개 |
| 3열 | x, ..., 값, ..., 값, ... | f'(x), f(x) | 극값 2개 |
| 4열 (y', y'', y) | x + 여러 열 | y', y'', y | 2차 도함수 포함 |
| 6열 (f', f, F', F) | x + 6열 | f'(x), f(x), F'(x), F(x) | 원시함수 포함 |

**셀 내용 패턴**:
- 첫 행(x): 수식 `{x}` + 값 위치에 수식 또는 `{CDOTS}`
- f'(x) 행: `+`, `-`, `0` 값
- f(x) 행: `NEARROW`(↗), `SEARROW`(↘), 극값

**추출 방법**:
```python
import zipfile, re
with zipfile.ZipFile(양식지_경로, 'r') as z:
    xml = z.read('Contents/section0.xml').decode('utf-8')
# "함수 증감표양식" 텍스트 이후의 <hp:tbl> 요소들을 찾아 추출
```

### 2. 확률분포표 (Probability Distribution Table)

**용도**: 이산확률변수 X의 확률분포를 표로 표시
**위치**: "확률분포표 양식" 텍스트 이후의 `<hp:tbl>` 요소들

**구조**: 2행 N열 테이블
- 1행: X 값들 + "계"
- 2행: P(X=x) 값들 + "1"

**변형**:
- 3열 (X값 2개 + 계)
- 4열 (X값 3개 + 계)
- 5열 (X값 4개 + 계)

**수식 패턴**:
- 헤더: `{RM P IT (X=it x)}` 또는 `rmP LEFT ( it 0 le Z le z RIGHT )`
- "계" 셀: 일반 텍스트

### 3. 표준 정규분포표 (Standard Normal Distribution Table)

**용도**: P(0≤Z≤z) 값을 표로 제공 (확률/통계 문제)
**위치**: "표준 정규분포표" 또는 "<표준정규분포표>" 텍스트 이후의 `<hp:tbl>` 요소들

**구조**: 2열 테이블, N+1행
- 헤더: `z` | `P(0≤Z≤z)`
- 데이터행: z값 | 확률값

**변형 (약 20가지)**: z값 조합이 다름
- 기본 4행: 0.5, 1.0, 1.5, 2.0
- 5행: 0.5, 1.0, 1.5, 2.0, 2.5
- 소수점 2자리: 1.64, 1.96, 2.33, 2.58
- 기타 다양한 조합

**주의**: 양식지에 `글자취급` 상태로 되어있으므로, 본문에 사용 시 `어울림`(AROUND)으로 변경 필요

**수식 패턴**:
- z 헤더: `z\``
- P 헤더: `rmP LEFT ( it 0 le Z le z RIGHT )\``

### 4. 조립제법 틀 (Synthetic Division Template)

**용도**: 다항식 나눗셈(조립제법) 과정을 표로 보여줌
**위치**: "<조립제법 틀>" 텍스트 이후의 `<hp:tbl>` 요소

**구조**: 복잡한 테이블 (셀 병합, 밑줄 등)
- 상단: 나누는 수 | 피제식 계수들
- 중단: 중간 계산 결과
- 하단: 몫의 계수들 | 나머지

**참고**: 이 템플릿은 구조가 복잡하므로, 양식지에서 `<hp:tbl>` 전체를 추출하여 값만 치환하는 방식 권장

### 5. 파스칼삼각형 (Pascal's Triangle Template)

**용도**: 이항계수 삼각형을 시각적으로 표현
**위치**: "<파스칼삼각형그리기>" 텍스트 이후의 `<hp:tbl>` 요소들

**변형**:
- 수식 표기: `{}_n{rmC}_r` (조합 기호)
- 숫자 표기: 실제 값 (1, 1, 1, 2, 1, ...)

**구조**: 삼각형 모양의 테이블 (상위 셀 병합으로 정렬)
- 0행: ₀C₀
- 1행: ₁C₀, ₁C₁
- ...
- n행: ₙC₀ ~ ₙCₙ

## 사전 추출된 템플릿 (resources/hwpx_base/)

양식지에서 추출하여 플레이스홀더가 적용된 XML 템플릿 파일들이 `resources/hwpx_base/`에 준비되어 있다.
**양식지에서 실시간 추출하지 말고, 반드시 아래 템플릿 파일을 사용하라.**

### 표준정규분포표

| 템플릿 파일 | 데이터 행 수 | 플레이스홀더 |
|------------|-----------|-------------|
| `normal_dist_3rows.xml` | 3행 (title+header+3data = 5행) | `{{Z_1}}~{{Z_3}}`, `{{P_1}}~{{P_3}}` |
| `normal_dist_4rows.xml` | 4행 (title+header+4data = 6행) | `{{Z_1}}~{{Z_4}}`, `{{P_1}}~{{P_4}}` |
| `normal_dist_5rows.xml` | 5행 (title+header+5data = 7행) | `{{Z_1}}~{{Z_5}}`, `{{P_1}}~{{P_5}}` |

**사용법**: `data_table.type == "normal_dist"`일 때, `row_parts` 개수에 맞는 템플릿 선택.
- `{{TABLE_ID}}`, `{{ZORDER}}` → next_eq_id(), next_zorder()
- `{{EQ_ID_N}}`, `{{EQ_ZO_N}}` → 수식별 고유 ID
- `{{Z_N}}` → z값 수식 (예: `1.0`)
- `{{P_N}}` → 확률값 수식 (예: `0.3413`)

### 확률분포표

| 템플릿 파일 | 열 수 | 구조 |
|------------|------|------|
| `prob_dist_5cols.xml` | 5열 | X값 4개 + 계 |
| `prob_dist_6cols.xml` | 6열 | X값 5개 + 계 |
| `prob_dist_7cols.xml` | 7열 | X값 6개 + 계 |

**사용법**: `data_table.type == "probability"`일 때, 열 수에 맞는 템플릿 선택.
셀 내용은 수식(`<hp:equation>`) 또는 텍스트(`<hp:t>`)로 직접 삽입.

### 선지 테이블 (①②③④⑤)

| 템플릿 파일 | type tag | 용도 |
|------------|---------|------|
| `pq_proposition_table_5x5.xml` | `proposition` (5x5) | p:/가정/q:/결론 5명제 |
| `choice_image_5options.xml` | `choice_image` (9x4) | 그림 5선지 + 이미지 placeholder |
| `choice_grid_2cols.xml` | `choice_grid_2cols` (6x3) | (가)(나) 2열 선지 |
| `choice_grid_3cols.xml` | `choice_grid_3cols` (6x4) | (가)(나)(다) 3열 선지 |

**사용법**: 선지 유형에 따라 적절한 템플릿 선택. type tag 별 셀 명세는 `docs/extractor-reference/` 참조.

### 보기 테이블 (ㄱ,ㄴ,ㄷ)

| 템플릿 파일 | 항목 수 |
|------------|--------|
| `bogi_box_3items.xml` | 3항 (ㄱ,ㄴ,ㄷ) |
| `bogi_box_4items.xml` | 4항 (ㄱ,ㄴ,ㄷ,ㄹ) |
| `bogi_box_6items.xml` | 6항 (ㄱ~ㅂ) |

### 증명 테이블

| 템플릿 파일 | 용도 |
|------------|------|
| `proof_table_template.xml` | [증명] 영역 |

### 공통 플레이스홀더

모든 템플릿에 공통:
- `{{TABLE_ID}}` → 테이블 고유 ID
- `{{ZORDER}}` → z-order 값
- `{{EQ_ID_N}}` → N번째 수식의 ID
- `{{EQ_ZO_N}}` → N번째 수식의 z-order

### 사용 코드 패턴

```python
BASE = "resources/hwpx_base"  # 또는 env(EXAM_HWPX_BASE) override

# 1. 템플릿 읽기
with open(f"{BASE}/normal_dist_4rows.xml", "r") as f:
    tbl_xml = f.read()

# 2. 플레이스홀더 치환
tbl_xml = tbl_xml.replace("{{TABLE_ID}}", str(next_eq_id()))
tbl_xml = tbl_xml.replace("{{ZORDER}}", str(next_zorder()))
for i in range(1, 5):
    tbl_xml = tbl_xml.replace(f"{{{{EQ_ID_{i}}}}}", str(next_eq_id()))
    tbl_xml = tbl_xml.replace(f"{{{{EQ_ZO_{i}}}}}", str(next_zorder()))
tbl_xml = tbl_xml.replace("{{Z_1}}", "1.0")
tbl_xml = tbl_xml.replace("{{P_1}}", "0.3413")
# ...

# 3. section0.xml에 삽입
```
