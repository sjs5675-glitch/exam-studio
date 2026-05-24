---
name: exam-create
description: "시험지 제작 오케스트레이터. 문제별 이미지 기반으로 extractor→solver→verifier 병렬 처리 후 figure→builder→checker 순차 처리. '시험지 제작', '작업' 키워드에 사용."
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
argument-hint: "[이미지 폴더 경로 또는 메타 정보]"
---

> **⚠ 폐기 후보 (2026-05-17)**
> 이 skill은 legacy `/create` + `auto` provider 경로에서만 사용됩니다.
> 신규 코드 기반 orchestrator(`stage-runner-rewrite`)가 동일 기능을 제공합니다.
> `/create` 페이지 폐기 후 본 skill도 삭제 예정.

# 시험지 제작 오케스트레이터

이 스킬은 직접 시험지를 만들지 않고, **에이전트들을 병렬/순차 조합**하여 완성된 시험지를 생성한다.

## 서브 에이전트 구조

```
exam-create (이 스킬 = 오케스트레이터)
│
├─ Phase 1-A: Extractor 전체 (8개씩 배치, 병렬)
│   └─ [1] exam-extractor : 이미지 → 문제 JSON
│
├─ [프론트엔드 편집] 사용자가 추출 결과를 직접 수정
│
├─ Phase 1-B: Solver + Verifier (8개씩 배치, 병렬)
│   ├─ [2] exam-solver    : 문제 JSON → 해설 생성
│   └─ [3] exam-verifier  : 해설 검증 (↔ solver 최대 3회)
│
└─ Phase 2: 순차 처리
    ├─ [4] exam-figure    : 그림 처리 (nano-banana)
    ├─ [5] exam-builder   : JSON + 이미지 → HWPX
    └─ [6] exam-checker   : HWPX 품질 검수
```

## 작업 절차

### Step 0: 입력 확인 및 작업 디렉토리 준비

#### 0-1. 실행 모드 판별

프롬프트를 파싱하여 **신규 실행** vs **부분 재실행(resume)** 을 판별한다.

### Resume 명령 파싱

resume 입력 처리는 코드(`studio/server/stages/resumeCommand.ts`)가 담당한다.
지원 명령은 코드의 unit test fixture (`server/stages/__tests__/fixtures/resume-commands.json`)에 정의되어 있다.
agent는 prompt를 그대로 코드로 전달하면 된다.

**프론트엔드 버튼 매핑**: 각 버튼이 전송하는 구조화 명령은 `server/stages/__tests__/fixtures/resume-commands.json` fixture에 정의되어 있다. 버튼별 매핑은 해당 fixture를 참조한다.

#### 0-2. Resume 로직

resume 모드일 때, 지정된 문제/단계 **이후의 파일을 삭제**하고 해당 지점부터 재실행한다.

cleanup 로직은 `studio/server/stages/cleanup.ts` (`cleanupFromStage`)가 담당한다.
상태 감지 로직은 `studio/server/stages/resumeState.ts` (`detectQuestionStates`)가 담당한다.

**자동 resume** (문제/단계 미지정):
1. `detectQuestionStates()`로 각 문제 상태 확인
2. 모든 문제가 `extracted`이고 `solved`가 하나도 없으면 → **Step 3.5(프론트엔드 편집) 단계로**
3. `verified` → 스킵, `solved` → verifier부터, `extracted` → solver부터, `none` → extractor부터
4. 모든 문제가 `verified`이면 Phase 2로 직접 진행
5. `exam_data.json`이 있고 모든 verified가 있으면 → Phase 2(figure)부터 재실행

**전체 resume with stage** (stage 지정, 문제 번호 미지정):
1. `cleanupFromStage(전체 문제, stage)` 실행 — 전체 문제에 적용
2. 전체 문제를 해당 단계부터 배치 병렬 실행 (Phase 1-A/1-B와 동일 방식)
3. 완료 후 처리:
   - extractor stage: 전체 `[EXTRACTION_REVIEW]` 블록 출력 → Step 3.5
   - solver stage: solver → verifier 배치 처리 (Step 4로 진행)
   - verifier stage: verifier 배치 처리 후 Step 5로 진행

> stage만 지정하고 문제 번호가 없으면 항상 이 분기. 문제 번호도 있으면 아래 "지정 resume"으로.

**지정 resume** (문제 번호 + stage 지정):
1. `cleanupFromStage([N], stage)` 실행
2. **전체 상태 스캔(`detectQuestionStates`) 건너뜀** — 타겟 문제/단계가 명시되었으므로
3. 해당 문제만 지정 단계부터 재실행
4. 완료 후 처리 (단계에 따라 다름):
   - extractor stage (Step 3.5 중 재추출): 해당 문제의 `[EXTRACTION_REVIEW]` 블록만 단독 출력 후 종료 — exam_data.json 재취합 불필요, 다른 문제 JSON 읽기 불필요
   - solver / verifier stage: 해당 문제의 `_verified.json`만 읽어서 기존 `exam_data.json`의 해당 문제 항목만 교체 (전체 재읽기 불필요)
   - builder stage 이후: Phase 2 해당 단계부터 재실행

**과목 정보 조달** (문제 번호 지정 resume 시): `exam_data.json`이 있으면 그것에서, 없으면 임의의 기존 `_extracted.json` 1개에서 읽는다. 전체 JSON을 순회하지 않는다.

#### 0-3. 캐시 초기화 (신규 실행 시만)

신규 실행(`작업해줘`)이면 이전 캐시를 `_prev`로 백업 후 새로 시작한다.

```bash
# 신규 실행 시: 직전 캐시 1개 보존 후 초기화
rm -rf "inputs/시험지 제작/.v3cache_prev"
mv "inputs/시험지 제작/.v3cache" "inputs/시험지 제작/.v3cache_prev" 2>/dev/null || true
mkdir -p "inputs/시험지 제작/.v3cache"
# question_images/cleaned도 삭제 (이전 작업 정리본 제거)
rm -rf "inputs/시험지 제작/question_images/cleaned"
rm -f "inputs/시험지 제작/question_images/q"*.png
```

**resume 모드에서는 삭제하지 않는다** — 기존 파일을 활용하는 것이 목적이므로.

> 실수로 신규 작업을 눌렀을 때 `.v3cache_prev/`에서 이전 작업 JSON을 복구할 수 있다.

#### 0-4. 기본 확인 (신규/resume 공통)

1. 문제 이미지 확인
   - 프론트엔드에서 업로드된 이미지: `inputs/시험지 제작/question_images/q{N}.png`
   - 또는 프롬프트에서 지정한 경로
2. 이미지 개수 = 문제 수 확인
3. 메타 정보 확인 (학교, 학년, 과목, 범위 — 프롬프트에서 제공 또는 기존 exam_data.json에서 로드)
4. 양식지 존재 확인: `studio/inputs/시험지 제작/기출작업양식지.hwpx`
5. GEMINI_API_KEY 환경변수 확인

```bash
mkdir -p "inputs/시험지 제작/.v3cache"
ls "inputs/시험지 제작/question_images/"
# --q=N 지정 resume: 해당 문제 파일만 확인 (전체 스캔 불필요)
#   ls "inputs/시험지 제작/.v3cache/q{N}"*.json 2>/dev/null
# 자동 resume (--q 미지정): 전체 스캔으로 상태 파악
#   ls "inputs/시험지 제작/.v3cache/q"*_*.json 2>/dev/null
```

### Step 1: 교과 컨텍스트 준비

`.claude/data/unit_classification.json`을 Read 도구로 읽는다. 이 JSON에는 과목별 단원 목록이 **교과 순서대로** 정렬되어 있다.

**교과 컨텍스트 생성 방법** (extractor 완료 후, solver 호출 전에 수행):

1. extractor 출력의 `subtopic` 값을 확인한다 (예: `"지수함수"`)
2. `unit_classification.json`에서 해당 과목(`subject` 코드)을 찾는다
3. 해당 과목의 모든 `units[].topics[]`를 **순서대로** 나열한다
4. `subtopic`이 나타나는 지점까지의 토픽 목록 = **선수 학습 범위**
5. 이 목록을 solver에게 전달한다

**구체적 예시**: 과목 `수1`(수학 I), subtopic `"삼각함수의 그래프"` 인 경우

```
unit_classification.json에서 수1의 topics 순서:
  지수 → 로그 → 상용로그 → 지수함수 → 로그함수 → 지수함수와 로그함수의 활용
  → 삼각함수 → [삼각함수의 그래프] ← 여기까지

선수 학습 범위:
- 지수
- 로그
- 상용로그
- 지수함수
- 로그함수
- 지수함수와 로그함수의 활용
- 삼각함수
- 삼각함수의 그래프 (현재 단원 포함)
```

**구현 코드** (Bash로 실행):

```python
import json

with open('.claude/data/unit_classification.json') as f:
    curriculum = json.load(f)

def get_prerequisite_topics(subject_code, subtopic):
    """주어진 과목/중단원에 대해 선수 학습 토픽 목록을 반환한다."""
    for subject in curriculum['subjects']:
        if subject['code'] == subject_code:
            all_topics = []
            for unit in subject['units']:
                for topic in unit['topics']:
                    all_topics.append(topic)
                    if topic == subtopic:
                        return {
                            'subject_name': subject['name'],
                            'unit_name': unit['name'],
                            'subtopic': subtopic,
                            'prerequisite_topics': all_topics,  # 현재 단원 포함
                        }
            # subtopic을 못 찾으면 전체 반환
            return {
                'subject_name': subject['name'],
                'unit_name': '(매칭 실패)',
                'subtopic': subtopic,
                'prerequisite_topics': all_topics,
            }
    return None

def format_curriculum_context(ctx):
    """solver/verifier에게 전달할 텍스트 형식으로 변환한다."""
    if not ctx:
        return "(교과 컨텍스트 없음)"
    lines = [
        f"이 문제는 {ctx['subject_name']} 과목, '{ctx['subtopic']}' 단원({ctx['unit_name']})입니다.",
        f"학생은 다음 단원까지 학습한 상태입니다:",
    ]
    for t in ctx['prerequisite_topics']:
        lines.append(f"- {t}")
    lines.append("")
    lines.append("이 범위의 개념만 사용하여 풀이를 작성하세요.")
    lines.append(f"{ctx['subject_name']} 이후 과목(미적분, 기하 등)의 개념은 사용하지 마세요.")
    return '\n'.join(lines)
```

**주의**: extractor가 subtopic을 `[UNCLEAR]`로 출력한 경우, 오케스트레이터가 문제 내용을 보고 수동으로 판단하거나, 교과 컨텍스트 없이 solver를 호출한다.

**과목 코드와 과목명 매핑**:
| 코드 | 과목명 |
|------|--------|
| `수상` | 고등수학 |
| `수1` | 수학 I |
| `수2` | 수학 II |
| `확통` | 확률과 통계 |
| `미적` | 미적분 |
| `기하` | 기하 |

---

### Step 2: 이미지 정리 (nano-banana)

extractor의 정확도를 높이기 위해, 원본 이미지를 nano-banana로 정리한다.
**원본 이미지는 보존**하고, 정리본을 별도 폴더에 저장한다.

```
inputs/시험지 제작/question_images/
├── q01.png          # 원본 (삭제 금지)
├── q02.png
├── ...
└── cleaned/         # nano-banana 정리본
    ├── q01.png
    └── ...
```

#### 2-0. 정리 배치 호출

8문제씩 배치로 nano-banana를 **동시에** 호출한다:

```
Agent(prompt="""
nano-banana 스킬로 이미지를 정리해줘.

입력: inputs/시험지 제작/question_images/q{N:02d}.png
출력: inputs/시험지 제작/question_images/cleaned/q{N:02d}.png

이 이미지는 수학 시험지 문제 사진이지만, **출력은 시험지 위에 임베드될 digital figure** (종이 스캔 아님). 다음을 수행:
- 손글씨·필기·연필·종이 노이즈 제거
- 인쇄된 텍스트, 수식, 테이블, 도형/figure 는 원본 그대로 유지
- 원본과 동일한 내용 유지 (숫자, 수식, 기호 추가·삭제·변경 금지)
- **배경은 순백(#FFFFFF) — 회색·베이지·종이 텍스처·그림자 금지**

프롬프트: "This image will be used as a figure embedded in a typeset Korean math exam document. The output is a digital figure, NOT a scan of paper. Output a pure white background (#FFFFFF) with no paper texture, no gray tint, no beige, no shadow. Remove all handwriting, pen marks, pencil strokes, and paper noise. Keep all printed text, numbers, equations, tables, circle markers, and printed figures/diagrams exactly as in the source. Crisp black ink on pure white. No anti-aliasing artifacts at borders. Do not change, add, or remove any numbers, symbols, or mathematical expressions."
""")
```

모든 정리본이 생성되었는지 확인한다.
정리 실패 시 해당 문제는 원본 이미지로 fallback한다.

---

### Step 3: Phase 1-A — Extractor 전체 완료

문제를 **8개씩 배치**로 묶어 extractor를 실행한다. **Solver는 아직 시작하지 않는다.**

#### 3-1. Extractor 배치 호출

한 배치(8문제)의 extractor를 **동시에** Agent 도구로 호출.
**정리본 이미지**를 입력으로 사용한다:

```
Agent(subagent_type="exam-extractor", prompt="""
문제 {N}번 이미지에서 문제를 추출해줘.
이미지 경로: inputs/시험지 제작/question_images/cleaned/q{N:02d}.png
문제 번호: {N}
과목: {subject}
출력 경로: inputs/시험지 제작/.v3cache/q{N}_extracted.json
""")
```

8개를 **한 메시지에서** 동시 호출한다.

**확인**: 모든 extractor JSON이 생성되었는지, 필수 필드가 있는지 검증.

#### 3-2. 배치 반복

배치 1(Q1~Q8) → 배치 2(Q9~Q16) → ... → 마지막 배치까지 **extractor만** 실행.

**배치 내 모든 문제 실패 시**: 전체 작업 중단, 에러 리포트 출력.

---

### Step 3.5: 추출 결과 프론트엔드 편집 대기

**모든 extractor가 완료된 후, solver를 시작하기 전에** Claude는 추출 데이터를 출력하고 프론트엔드 편집을 기다린다.

#### Claude의 역할: 추출 데이터 출력

각 `q{N}_extracted.json`을 Read 도구로 읽어 아래 형식으로 출력한다. 프론트엔드가 이 출력을 파싱하여 편집 UI를 렌더링한다.

```
[EXTRACTION_REVIEW]
total: N
---
[Q1]
type: choice
score: 4.2
subtopic: 지수함수
difficulty: 중
parts: [{"t":"함수 "},{"eq":"f(x) = 2^x"},{"t":"의 그래프와 직선 "},{"eq":"y = 4"},{"t":"가 만나는 점의 "},{"eq":"x"},{"t":"좌표를 구하시오."}]
choices: [[{"eq":"1"}],[{"eq":"2"}],[{"eq":"3"}],[{"eq":"4"}],[{"eq":"5"}]]
answer: ②
has_figure: true
figure_position: right
figure_crop_ratio: [0.55, 0.1, 0.95, 0.7]
condition_box: null
---
[Q2]
...
[/EXTRACTION_REVIEW]
```

#### 프론트엔드의 역할

프론트엔드는 위 출력을 파싱하여 각 문제별 편집 UI를 표시한다:
- 원본 이미지 + 정리본 이미지 나란히 표시
- `parts` → 편집 가능한 텍스트/수식 필드
- `choices` → 편집 가능한 선지 필드 (5개)
- `answer` → 정답 선택 드롭다운
- `subtopic`, `difficulty` → 드롭다운
- `figure_crop_ratio` → 수치 입력 필드 (그림이 있는 경우)

사용자가 필드를 수정하면 **프론트엔드가 직접 `q{N}_extracted.json`을 저장**한다. Claude는 이 단계에서 JSON을 수정하지 않는다.

#### 진행 / 재추출 / 이미지 교체

| 사용자 액션 | 동작 |
|-----------|------|
| [진행] 클릭 | solver stage resume → Step 4 시작 |
| [문제N 재추출] 클릭 | 해당 문제 extractor stage resume → 재추출 후 Step 3.5로 복귀 (복수 선택 지원) |
| [문제N 이미지 교체] 클릭 | 프론트엔드가 새 이미지를 `q{N:02d}.png`로 저장 → image_replace stage resume |

각 버튼이 전송하는 구조화 명령 포맷은 `server/stages/__tests__/fixtures/resume-commands.json` 참조.

**재추출 후 복귀**: 단수 또는 복수 문제 번호 지정 모두 지원한다.

- 복수 지정 시 Phase 1-A와 동일하게 **모든 대상 문제를 한 메시지에서 동시에** Agent 호출
- cleanup → 병렬 extractor 완료 후 재추출된 문제들의 `[EXTRACTION_REVIEW]` 블록을 단독 출력
- 프론트엔드가 이를 파싱하여 해당 문제들의 편집 UI만 업데이트

```
[EXTRACTION_REVIEW]
total: K  ← 재추출된 문제 수
---
[QN]
...업데이트된 내용...
---
[QM]
...업데이트된 내용...
[/EXTRACTION_REVIEW]
```

**이미지 교체 플로우** (image_replace stage):

프론트엔드가 먼저 새 이미지를 `inputs/시험지 제작/question_images/q{N:02d}.png`에 저장한 뒤 Claude를 호출한다. Claude는 다음 순서로 처리한다:

1. `cleanupFromStage([N], 'image_replace')` 실행 (`studio/server/stages/cleanup.ts`)
   - `cleaned/q{N:02d}.png` 삭제
   - `q{N}_extracted.json`, `q{N}_solved.json`, `q{N}_verified.json` 삭제
2. 교체된 원본 이미지를 Read 도구로 표시 (교체 확인용)
3. 해당 문제만 nano-banana 정리 (Step 2와 동일한 방식):
   ```
   Agent(prompt="nano-banana 스킬로 inputs/시험지 제작/question_images/q{N:02d}.png를 정리해서
   inputs/시험지 제작/question_images/cleaned/q{N:02d}.png로 저장해줘 ...")
   ```
4. 해당 문제만 extractor 재실행 (Step 3과 동일한 방식)
5. 완료 후 해당 문제의 `[EXTRACTION_REVIEW]` 블록을 단독 출력 → Step 3.5로 복귀

---

### Step 4: Phase 1-B — Solver + Verifier 전체 완료

추출 검증이 완료된 후 solver와 verifier를 실행한다.

#### 4-1. Solver 배치 호출

전체 문제를 **8개씩 배치**로 묶어 처리. 각 배치 내에서는 **동시에** 호출한다.

1. 각 문제의 `q{N}_extracted.json`을 Read 도구로 읽어 `subtopic` 값을 확인한다
2. Step 1의 `get_prerequisite_topics(subject_code, subtopic)`로 교과 컨텍스트를 생성한다
3. `format_curriculum_context(ctx)`로 텍스트로 변환한다
4. 같은 배치의 solver를 **동시에** 호출:

```
Agent(subagent_type="exam-solver", prompt="""
문제 {N}번 해설을 생성해줘.
문제 JSON: inputs/시험지 제작/.v3cache/q{N}_extracted.json
출력 경로: inputs/시험지 제작/.v3cache/q{N}_solved.json

교과 컨텍스트:
{format_curriculum_context(ctx) 결과 — 아래와 같은 형식}

이 문제는 수학 I 과목, '삼각함수의 그래프' 단원(삼각함수)입니다.
학생은 다음 단원까지 학습한 상태입니다:
- 지수
- 로그
- 상용로그
- 지수함수
- 로그함수
- 지수함수와 로그함수의 활용
- 삼각함수
- 삼각함수의 그래프

이 범위의 개념만 사용하여 풀이를 작성하세요.
수학 I 이후 과목(미적분, 기하 등)의 개념은 사용하지 마세요.
""")
```

**핵심**: solver에게 **구체적인 토픽 목록**을 전달해야 한다. "수학 I 범위 내에서" 같은 모호한 지시 대신, 어떤 단원까지 배웠는지 **열거**한다.

#### 4-2. Verifier 배치 호출 + 재시도 루프

solver 완료 후, 같은 배치의 verifier를 **동시에** 호출:

```
Agent(subagent_type="exam-verifier", prompt="""
문제 {N}번 해설을 검증해줘.
문제 이미지: inputs/시험지 제작/question_images/q{N}.png
extractor JSON: inputs/시험지 제작/.v3cache/q{N}_extracted.json
solver JSON: inputs/시험지 제작/.v3cache/q{N}_solved.json
출력 경로: inputs/시험지 제작/.v3cache/q{N}_verified.json

교과 컨텍스트:
{curriculum_context}
""")
```

**재시도 루프** (문제별, 최대 3회): `studio/server/stages/stagePlan.ts` (`applyVerifierRetry`) 참조.

fail된 문제만 개별로 solver→verifier 재시도. pass된 문제는 대기.

#### 4-3. 배치 반복

배치 1(Q1~Q8) → 배치 2(Q9~Q16) → ... → 마지막 배치

**배치 내 모든 문제 실패 시**: 전체 작업 중단, 에러 리포트 출력.

---

### Step 5: Phase 1 완료 — JSON 취합 + 최종 검증 + Figure 병렬 처리

#### 5-1. JSON 취합

모든 문제의 verified JSON을 하나의 `exam_data.json`으로 합친다.

취합 로직은 `studio/server/stages/examData.ts` (`aggregateVerifiedProblems`) 참조.
우선순위: `q{N}_verified.json` > `q{N}_solved.json` > `q{N}.json`.
누락 문제는 `skippedQuestions`에 기록하고, 전체 누락 시 AggregateError 발생.

메타 정보(`info`)는 프롬프트에서 제공된 값으로 채운다.

#### 5-2. Figure 처리

### Figure 처리
`figureRunner`(`studio/server/stages/figureRunner.ts`)가 `figure_processor.py`를 호출한다.
crop boundary 불확실 케이스(`boundary_uncertain=true`)만 `exam-figure` agent에 위임한다.

그림이 없는 시험지는 이 단계를 건너뛰고 바로 `.v3cache/figure_status.json`에 완료 상태를 기록한다.

**job 종료**: figure 처리 후 Claude는 job을 종료한다(status="done"). 프론트엔드가 `figure_status.json`을 polling하여 완료 시 `outputs/images/prob{N}_final.png` 이미지를 표시한다. 사용자가 이미지를 확인하고 [확인] 버튼을 누르면 confirm stage resume이 전송된다.

#### 5-3. confirm stage 처리

confirm stage resume 수신 시:
1. figure 완료 여부 확인 (`.v3cache/figure_status.json` 존재 확인)
2. 미완료면 완료까지 대기
3. 완료 후 바로 Step 6(Builder)로 진행

---

### Step 6: Phase 2 — HWPX 조립

이 단계는 **호스트 시스템(sse.ts)이 deterministic builder runner를 자동 실행**한다. Claude는 직접 build/fix/validate를 호출하지 않는다. exam_data.json 작성 완료 후 종료하면, 호스트가 다음을 순차 실행한다:

1. `python3 build_hwpx.py <exam_data.json> outputs/`
2. `python3 resources/hwpx_scripts/fix_namespaces.py <hwpx>`
3. `python3 resources/hwpx_scripts/validate.py --fix <hwpx>`

**실패 시**: 호스트가 status=failed를 보고하고 작업을 중단한다. Claude가 재시도하지 않는다.

### Step 7: Phase 2 — Checker 호출

Agent 도구로 `exam-checker` 에이전트를 호출:

```
Agent(subagent_type="exam-checker", prompt="""
[HWPX 파일 경로]를 검수해줘
- 10가지 체크리스트로 AI 실수 검증
- 수정 지시 JSON 생성
""")
```

### Step 8: Checker 피드백 반영 (최대 2회)

checker FAIL 시:
- XML 구조 오류 / 수식 오류 → 에러 내용 리포트 (스크립트 재실행 불가, 수동 확인 필요)
- 내용 누락 / 순서 오류 → exam_data.json 수정 후 종료. 호스트가 deterministic builder를 자동 재실행한다.
- 수정 후 checker 재호출 (최대 2회)

---

### Step 9: 최종 결과 리포트

```
=== V3 시험지 제작 결과 ===
파일: [출력 파일명]
학교: [학교명]
시험: [학년/학기/차수]
과목: [과목] (범위: [범위])

[문제] 총 N문제
  성공: N개 (문제 1,2,3,4,5,6,7,8,9,10,11,12,14,15,16,17)
  주의: N개 (문제 13 — verifier 3회 실패, 수동 검토 필요)
  실패: N개 (문제 18 — extractor 추출 실패)

[Phase 1] extractor (전체) → 사용자 편집 → solver→verifier
  배치: N개 (8문제×M + 나머지)
  추출 단계 사용자 수정: N건
  verifier 재시도: N건

[Phase 2] figure→builder→checker
  그림: N개 생성 (워터마크 포함)
  HWPX: 생성 완료
  검수: checker PASS (N/10)

[후처리] fix_namespaces.py 완료, validate.py 통과
```

---

## 에러 처리

### 문제 레벨 실패
- extractor 실패 → 해당 문제 skip, 로그에 경고
- solver 실패 → 해당 문제 skip
- verifier 재시도 초과 → `manual_review` (코드: `stagePlan.ts:applyVerifierRetry`)

### 배치 레벨 실패
- 배치 내 **모든 문제**가 실패하면 전체 작업 중단

### 전체 레벨 실패
- builder/checker 실패 → 기존과 동일하게 처리

## 파일명 규칙

```
[코드][고][년도][학기-차수][지역][학교][과목][범위][코드][작업자][검수자][그림코드]
```

## 서식 규칙

- 서체: 나눔고딕 10, 수식크기 11, 수식서체 HYhwpEQ
- 스타일: F6 → 바탕글 1개만
- 미주-문제: 붙여쓰기
- 문제-선지: Enter 한 줄
- shift+enter: 정답 라인 2줄 때만
- 서술형: `[서술형 N]`
- 그림: 모든 생성 그림에 워터마크 필수

## 작업 디렉토리

```
inputs/시험지 제작/question_images/
├── q01.png                  # 원본 문제 이미지 (프론트엔드 업로드, 삭제 금지)
├── q02.png
├── ...
└── cleaned/                 # nano-banana 정리본 (extractor 입력으로 사용)
    ├── q01.png
    └── ...

inputs/시험지 제작/.v3cache/
├── q1_extracted.json        # extractor 출력
├── q1_solved.json           # solver 출력
├── q1_verified.json         # verifier 출력 (최종)
└── exam_data.json           # 취합 JSON (builder 입력)
```
