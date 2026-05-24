# 시험지 제작 시스템 개선 계획

> 작성일: 2026-03-08
> 기반: 샘플 3개(광명고/운유고/치동고) HWPX 분석 + 치동고 테스트 생성 결과

---

## 1. 현황 요약

치동고 확통 PDF로 전체 워크플로우(reader → figure → builder) 테스트 완료.
샘플 HWPX와 비교하여 **8개 개선 항목** 확인.

---

## 2. 발견된 이슈 목록

### A. Reader 이슈 (4건)

| ID | 이슈 | 심각도 | 설명 |
|----|------|--------|------|
| R1 | 영단어/스펠링 수식 누락 | 높음 | `classic`, `c,l,a,s,s,i,c` 등 영단어/개별 알파벳이 텍스트로 남음. "모든 영문자"가 수학 맥락에만 적용되고 일반 영단어를 커버하지 못함 |
| R2 | 난이도 기준 오류 | 중간 | 학습 초기 난이도로 평가. 시험 준비를 하고 쳤을 때 기준이어야 함 |
| R3 | 난이도 종류 오류 | 중간 | "최상" 사용됨. 올바른 4단계: **하/중/상/킬** |
| R4 | 수식 연산자 띄어쓰기 | 높음 | `4^3=64`, `5-r=2`, `x+y+z+w=10` 등 기본 연산자(+, -, =) 앞뒤에 공백 없음 (51건). HWP 수식에서 공백은 구분자 역할이므로 렌더링 불안정 유발 |

### B. Builder 이슈 (3건)

| ID | 이슈 | 심각도 | 설명 |
|----|------|--------|------|
| B1 | 점수 수식 삽입 버그 | 높음 | `[<hp:equation>4.1</hp:equation>점]` 형태여야 하나, 수식 XML이 `<hp:t>` 안에 raw 텍스트로 삽입됨. 수식이 렌더링되지 않고 XML 코드가 그대로 출력 |
| B2 | 조건 (가)(나)(다) rectangle 없음 | 높음 | 조건이 테두리 박스 없이 본문에 나열됨. 양식지의 rectangle 서식(테두리 있는 사각형)을 이용해야 함. 현재 builder는 bogi 타입(ㄱ/ㄴ/ㄷ)만 지원하고 condition 타입((가)/(나)/(다)) 미지원 |
| B3 | 머릿말 테이블 텍스트 | 낮음 | 학교명 띄어쓰기("치동 고등학교" vs "치동고등학교"), 범위 띄어쓰기("여러가지순열~확률의뜻과활용" vs "여러가지순열 ~ 확률의 뜻과 활용"). cellAddr도 Row1에서 col=0(오류) vs col=2(정상) |

### C. 워크플로우 이슈 (1건)

| ID | 이슈 | 심각도 | 설명 |
|----|------|--------|------|
| W1 | 해설 미생성 | 높음 | 원본 PDF에 해설이 없을 때, reader는 추출만 하므로 해설이 비어있음. 20문제 중 6문제 해설 부실(11,16,17,18: 답만, 19,20: 빈 해설). 해설을 AI가 생성해야 함 |

---

## 3. 해결 방안

### 3.1 Reader 규칙 보강

**파일**: `.claude/agents/ngd-exam-reader.md`

#### R1: 영단어/스펠링 수식 처리
- 현재 규칙: "모든 영어 알파벳 (변수, 점, 함수명, 도형명)" → 수학 맥락만 커버
- **추가 규칙**: 문제/해설에 등장하는 **모든 영문자/영단어**는 수식으로 처리
  - 영단어: `classic` → `{"eq": "rm classic"}`
  - 개별 스펠링: `c,l,a,s,s,i,c` → 각각 `{"eq": "rm c"}`, `{"eq": "rm l"}` ...
  - 수식 범위 규칙 테이블에 "영단어" 행 추가

#### R2, R3: 난이도 규칙
- **4단계 정의**: 하 / 중 / 상 / 킬
- **평가 기준**: 해당 단원을 학습하고 시험 준비를 한 학생 기준
  - 하: 기본 개념 문제, 시험 준비한 학생이면 대부분 맞힘
  - 중: 약간의 응용, 70% 정도 맞힘
  - 상: 심화 응용, 상위권만 맞힘
  - 킬: 최고난도, 상위 5% 이내만 맞힘
- "최상" 은 사용하지 않음

#### R4: 수식 연산자 띄어쓰기
- **추가 규칙**: HWP 수식에서 다음 연산자 앞뒤에 반드시 공백
  - 산술: `+`, `-`, `=`, `!=`
  - 비교: `<`, `>`, `leq`, `geq`
  - 키워드: `over`, `times`, `cdot`
- 예시: `4^3=64` → `4^3 = 64`, `x+y=3` → `x + y = 3`
- **예외**: 괄호 안의 음수 부호(`(-3)`)와 지수/첨자 안의 연산(`5-r`)은 공백 생략 가능 여부 검토 필요

### 3.2 Solver 에이전트 신설

**파일**: `.claude/agents/ngd-exam-solver.md` (신규)

- **역할**: `/tmp/exam_data.json`에서 해설이 없거나 부실한 문제를 찾아 풀이 생성
- **입력**: exam_data.json
- **출력**: exam_data.json 업데이트 (explanation_parts 채움)
- **방식**: 문제별로 독립 풀이 (컨텍스트 윈도우 문제 해결)
- **위치**: reader → **solver** → figure → builder

### 3.3 Builder 수정

**파일**: `.claude/agents/ngd-exam-builder.md`

#### B1: 점수 수식 삽입 버그
- 현재: 점수 수식 XML이 `<hp:t>` 내부에 문자열로 삽입됨
- **수정**: `<hp:t>[</hp:t><hp:equation>...</hp:equation><hp:t>점]</hp:t>` 구조로 분리
- builder의 "배점 규칙" 섹션에 올바른 XML 구조 명시

#### B2: 조건 (가)(나)(다) rectangle
- condition 타입 조건박스용 rectangle 템플릿 추가 필요
- 또는 borderFill이 있는 단순 테이블/그룹 박스 사용
- bogi 템플릿과 별개의 `condition_box_template.xml` 생성 검토

#### B3: 머릿말 테이블 텍스트
- 학교명: "고등학교" 앞에 불필요한 공백 제거 로직
- 범위: `~` 앞뒤에 공백 추가 (예: "여러가지순열 ~ 확률의 뜻과 활용")
- cellAddr: Row1의 병합 셀 뒤 colAddr를 올바르게 계산 (validate.py가 자동 수정 가능하나 원본 생성이 정확해야 함)

### 3.4 제작 검수 에이전트 신설

**파일**: `.claude/agents/ngd-exam-checker.md` (신규)

**역할**: AI 생성 HWPX의 품질을 검수하고, 문제 발견 시 수정 지시를 생성

**체크리스트 (AI 특유 실수)**:

| # | 검수 항목 | 검증 방법 |
|---|----------|----------|
| 1 | 점수 수식 분리 | `<hp:t>` 안에 `<hp:equation` 문자열 없는지 확인 |
| 2 | 영단어 수식 처리 | `<hp:t>` 안에 영문자([a-zA-Z]) 포함 여부 (조사/구두점 제외) |
| 3 | 수식 연산자 띄어쓰기 | `<hp:script>` 안에서 `[변수]=`, `[숫자]+` 등 공백 없는 패턴 |
| 4 | 난이도 4단계 | `[난이도]` 뒤 텍스트가 하/중/상/킬 중 하나인지 |
| 5 | 조건 rectangle | condition_box가 있는 문제의 (가)(나)(다)가 bordered 요소 안에 있는지 |
| 6 | 해설 완성도 | endNote 내 수식 수가 2개 이상인지 (답만 있는 빈 해설 탐지) |
| 7 | 순열/조합 패턴 | `{it`_N}{rm C}` 패턴 사용 여부, LSUB 미사용 확인 |
| 8 | 머릿말 테이블 | 학교명/범위 띄어쓰기, cellAddr 정합성 |
| 9 | endNote 구조 | suffixChar=46, autoNum 존재, 정답 텍스트 존재 |
| 10 | XML 유효성 | `<hp:t>` 안에 XML 태그가 없는지, 이스케이프 처리 |

**피드백 루프**:
```
checker 검수 결과 → 수정 사항 JSON 생성
  → 수식 문제: reader에 재추출 지시
  → XML 구조 문제: builder에 재조립 지시
  → 해설 부실: solver에 재생성 지시
  → 수정 후 재검수 (최대 2회)
```

### 3.5 오케스트레이터 스킬 업데이트

**파일**: `.claude/skills/ngd-exam-create/SKILL.md`

현재:
```
reader → figure → builder → 리포트
```

변경:
```
reader → solver → figure → builder → checker → (피드백 루프) → 리포트
```

Step 추가:
- Step 2.5: solver 에이전트 호출 (해설이 없는/부실한 문제 풀이 생성)
- Step 5: checker 에이전트 호출 (AI 실수 검수)
- Step 6: 피드백 반영 (문제 있으면 해당 에이전트 재호출, 최대 2회)
- Step 7: 최종 리포트

---

## 4. 구현 우선순위

| 순서 | 작업 | 파일 | 난이도 |
|------|------|------|--------|
| 1 | Reader 규칙 보강 (R1~R4) | ngd-exam-reader.md | 낮음 |
| 2 | Builder 점수 버그 수정 (B1) | ngd-exam-builder.md | 중간 |
| 3 | Builder 머릿말 텍스트 (B3) | ngd-exam-builder.md | 낮음 |
| 4 | Solver 에이전트 신설 (W1) | ngd-exam-solver.md (신규) | 중간 |
| 5 | Builder 조건 rectangle (B2) | ngd-exam-builder.md + 템플릿 | 높음 |
| 6 | Checker 에이전트 신설 | ngd-exam-checker.md (신규) | 높음 |
| 7 | 오케스트레이터 업데이트 | SKILL.md | 중간 |

---

## 5. 변경 영향 범위

| 파일 | 변경 유형 |
|------|----------|
| `.claude/agents/ngd-exam-reader.md` | 규칙 추가 (R1~R4) |
| `.claude/agents/ngd-exam-builder.md` | 버그 수정 (B1) + 규칙 추가 (B2, B3) |
| `.claude/agents/ngd-exam-solver.md` | **신규 생성** |
| `.claude/agents/ngd-exam-checker.md` | **신규 생성** |
| `.claude/skills/ngd-exam-create/SKILL.md` | 워크플로우 확장 |
| `.claude/skills/ngd-exam-create/base_hwpx/` | condition_box 템플릿 추가 가능 |
| `.claude/skills/hwp-equation/SKILL.md` | 띄어쓰기 규칙 보강 (R4 연동) |
| `CLAUDE.md` | 에이전트 목록 업데이트 |

---

## 6. 테스트 계획

1. Reader 규칙 수정 후 → 치동고 PDF 재추출 → JSON에서 영단어/난이도/띄어쓰기 확인
2. Solver 에이전트 → 해설 없는 문제 6개 풀이 생성 확인
3. Builder 수정 후 → HWPX 재생성 → 점수/rectangle/머릿말 확인
4. Checker 에이전트 → 생성 HWPX에서 10개 체크리스트 자동 검수
5. 전체 워크플로우 → 치동고 PDF 처음부터 끝까지 → 샘플 HWPX와 최종 비교

---

## 7. 구현 완료 및 검증 (2026-03-08)

### 7.1 구현 완료 항목

| ID | 상태 | 파일 |
|----|------|------|
| R1 | ✅ 완료 | ngd-exam-reader.md — 영단어/스펠링 수식 규칙 추가 |
| R2/R3 | ✅ 완료 | ngd-exam-reader.md — 난이도 4단계(하/중/상/킬) 추가 |
| R4 | ✅ 완료 | ngd-exam-reader.md + hwp-equation SKILL.md — 연산자 띄어쓰기 |
| B1 | ✅ 완료 | ngd-exam-builder.md — 점수 수식 XML 구조 명시 |
| B2 | ✅ 완료 | ngd-exam-builder.md — condition 타입 조건박스 (bordered 테이블) |
| B3 | ✅ 완료 | ngd-exam-builder.md — 학교명/범위 띄어쓰기 규칙 |
| W1 | ✅ 완료 | ngd-exam-solver.md 신규 생성 |
| Checker | ✅ 완료 | ngd-exam-checker.md 신규 생성 (10개 체크리스트) |
| 오케스트레이터 | ✅ 완료 | SKILL.md 5단계 + 피드백 루프 |

### 7.2 운유고 PDF 검증 결과

운유고 PDF(그림없음, 22문제)로 reader 테스트 → 기존 완성 HWPX와 비교.

**정답**: 22/22 일치 ✅
**해설**: 22/22 모두 생성 ✅ (기존 HWPX와 내용 일치)
**난이도**: 하5/중11/상3/킬3 (4단계 정확 적용) ✅

**발견된 추가 이슈 (검증에서 확인)**:

| 이슈 | 설명 | 조치 |
|------|------|------|
| DEG 공백 | `60 DEG` (X) → `60DEG` (O) — 숫자에 붙여쓰기 | ✅ reader에 규칙 추가 |
| LEFT/RIGHT 대소문자 | `left(` → `LEFT (` — 대문자+공백이 관례 | ✅ reader, hwp-equation에 규칙 추가 |
| sqrt vs root | 세제곱근에 `sqrt 3` 대신 `root 3 of` 사용 필요 | ✅ reader에 규칙 추가 |
| 수식 분리 차이 | Reader와 HWPX의 등호 단위 끊기 방식이 다름 | 허용 범위 (builder가 조립 시 처리) |
