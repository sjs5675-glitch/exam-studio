# 시험지 제작 시스템 — 변경 이력

## 2026-03-09 세션: Exam Studio CLI 연결 버그 수정

### 배경

- Exam Studio 웹 UI에서 Claude CLI를 spawn하여 시험지 제작/오검을 실행하는 구조
- "API 연결 대기중..." 메시지에서 무한 멈춤 발생

### 근본 원인

Node.js `child_process.spawn()`의 기본 stdio 설정이 `['pipe', 'pipe', 'pipe']`이며,
stdin이 열린 파이프로 남아 있으면 Claude CLI가 추가 입력을 대기하며 영원히 멈춤.
터미널에서 직접 실행하면 stdin이 TTY이므로 문제가 없지만,
프로그래밍 방식으로 spawn하면 stdin이 파이프가 되어 발생하는 문제.

### 해결

```typescript
spawn("claude", args, {
  stdio: ["ignore", "pipe", "pipe"],  // stdin을 ignore로 설정
});
```

### 추가 필수 플래그

| 플래그 | 이유 |
|--------|------|
| `--verbose` | `-p` + `--output-format stream-json` 조합에 필수 (CLI 요구사항) |
| `--dangerously-skip-permissions` | 자동화 서버에서 tool 권한 프롬프트 방지 |

### 디버깅 과정

1. 환경변수 문제로 추정 → CLAUDECODE, CLAUDE_CODE_ENTRYPOINT 제거 → 효과 없음
2. 화이트리스트 env 방식 시도 → 효과 없음
3. 최소 테스트 스크립트로 4가지 env 조합 비교 → **모두 실패** (env 문제 아님 확인)
4. 동일 명령어 터미널 직접 실행 → **성공** → spawn 자체의 문제로 범위 축소
5. stdin 처리 방식 3가지 비교 테스트:
   - stdin=pipe, 방치 → 실패
   - stdin=pipe, 즉시 end() → 성공
   - stdin=ignore → 성공
6. skill/agent 연결 테스트 → init 이벤트에 skills, agents, Skill/Agent tool 모두 정상 확인

### 제거한 불필요 우회책

- 환경변수 블랙리스트 (CLAUDECODE, CLAUDE_CODE_ENTRYPOINT 제거 로직)
- 환경변수 화이트리스트 (PATH, HOME 등만 전달하는 buildCleanEnv)
- start.sh의 `env -u CLAUDECODE`

### 변경 파일

| 파일 | 변경 |
|------|------|
| `studio/lib/claude.ts` | stdio: ['ignore',...] 추가, --verbose/--dangerously-skip-permissions 추가, env 조작 코드 제거 |
| `studio/lib/prompts.ts` | Skill 도구 호출 지시 프롬프트로 변경 |
| `studio/scripts/start.sh` | env -u CLAUDECODE 제거 (불필요) |

## 2026-03-07 세션: HWPX 빌더 디버깅 + 검증 파이프라인 구축

### 배경

- `ngd-exam-creator` 오케스트레이터 → `ngd-exam-reader` → `ngd-exam-figure` → `ngd-exam-builder` 3단계 에이전트 구조로 시험지 제작 파이프라인 구현 완료
- 첫 테스트 파일 `[04039]명일여고 확통` 생성 후 **한컴오피스에서 열리지 않는 문제** 발생
- 이전 단일 에이전트 버전(`그림0-0-0-0`)은 열렸으나 분리된 빌더가 만든 파일(`그림1-0-0-0`)은 안 열림

### 발견된 버그 3건

#### 1. 수식 XML 이스케이프 누락 (치명적)

- **증상**: `Contents/section0.xml` XML 파싱 실패 → 파일 열리지 않음
- **원인**: `<hp:script>` 안의 부등호 `<`, `>`가 `&lt;`, `&gt;`로 이스케이프되지 않음
- **예시**: `<hp:script>x_1 <x_2</hp:script>` → XML이 `<x_2`를 태그로 해석하여 파싱 에러
- **수정**: 수식 텍스트를 XML에 삽입할 때 `html.escape()` 또는 수동 치환 필수
- **영향 범위**: 부등호가 포함된 모든 수식 (6건 발견)

#### 2. 테이블 cellAddr rowAddr 오류 (치명적)

- **증상**: 파일이 한컴오피스에서 아예 열리지 않음 (에러 메시지 없이 실패)
- **원인**: 빌더가 생성한 테이블의 모든 `<hp:cellAddr>`에서 `rowAddr="0"`으로 설정
- **정상**: 각 행(row)마다 rowAddr가 0, 1, 2... 로 증가해야 함
- **디버깅 과정**: section0.xml 문단을 이진탐색으로 좁혀서 88번째 문단(테이블 포함 문제 12번)에서 크래시 위치 특정
- **수정**: `<hp:cellAddr colAddr="{col}" rowAddr="{row_index}"/>`로 행 인덱스 반영

#### 3. zOrder 중복 (경미)

- **증상**: 렌더링 문제 가능성
- **원인**: shape 객체(equation, tbl, pic)의 zOrder 값이 일부 중복 (85, 86 중복)
- **정상**: 샘플 파일에서는 모든 zOrder가 고유
- **수정**: 중복 발견 시 자동으로 다음 가용 값으로 변경

### 추가 발견: 렌더링 품질 문제 (미해결)

- 빌더가 만든 파일이 열리긴 하나 **글꼴 크기, 정렬 등 서식이 엉망**
- **원인 분석**: 양식지(template)의 `header.xml`과 샘플의 `header.xml`에서 charPrIDRef 매핑이 다름
  - 양식지: charPr 31개 (charPrIDRef=7이 height=300 → 3pt)
  - 샘플: charPr 10개 (charPrIDRef=7이 height=1000 → 10pt)
- 빌더가 샘플의 charPrIDRef 값을 참조하여 XML을 생성하지만, 실제로는 양식지의 header.xml이 사용되므로 ID 매핑이 불일치
- **다음 세션에서 해결 필요**: 양식지의 charPr/paraPr 정의에 맞는 올바른 IDRef 매핑 테이블 작성

### 생성된 파일

#### 스크립트

| 파일 | 용도 |
|------|------|
| `.claude/skills/ngd-exam-create/scripts/fix_namespaces.py` | (기존) HWPX 네임스페이스 프리픽스 교정 |
| `.claude/skills/ngd-exam-create/scripts/validate.py` | **(신규)** HWPX XML 검증 + 자동수정 |

#### `validate.py` 검증 항목

1. XML well-formed 파싱 (lxml)
2. `<hp:script>` 내 이스케이프 누락 탐지
3. 테이블 `cellAddr` rowAddr 정합성
4. `zOrder` 중복
5. 태그 균형 (XML 파싱 실패 시 보조 진단)
6. BinData ↔ content.hpf 매니페스트 일치

`--fix` 옵션: 수식 이스케이프 + cellAddr + zOrder 자동 수정 후 검증

### 변경된 에이전트 문서

#### `ngd-exam-builder.md` 추가사항

1. **수식 XML 이스케이프 규칙** + Python 코드 예시
2. **테이블 cellAddr 규칙** + XML 예시
3. **zOrder 고유값 규칙**
4. **페이지 레이아웃 규칙** (2단 구성, Break 패턴)
   - 2문제마다 COLBREAK, 4문제마다 PAGEBREAK
   - 같은 컬럼 내 문제 사이 빈줄 ~15개
   - 서답형 전환: PAGEBREAK + 안내문 + [서술형 N]
   - 해설 분리: COLBREAK + PAGEBREAK
5. **빌드 후처리 파이프라인**: fix_namespaces.py → validate.py --fix

### 샘플 분석 결과

`sample/시험지 제작/` 폴더의 2개 완성본 분석:

#### 레이아웃 패턴 (2단 구성)

```
좌단: 문제1 → 빈줄~15개 → 문제2
COLBREAK (빈 문단)
우단: 문제3 → 빈줄~15개 → 문제4
PAGEBREAK (빈 문단)
(반복)
```

#### 서답형 전환

```
[객관식 마지막 문제]
PAGEBREAK
※ 여기서 부터는 서답형 문제입니다.   (별도 문단, ENDNOTE 없음)
[서술형 1]                            (별도 문단, ENDNOTE 없음)
(ENDNOTE + 문제 본문)
[서술형 2]
(ENDNOTE + 문제 본문)
COLBREAK → PAGEBREAK                  (해설 분리)
```

#### 문제 사이 빈줄 통계

- 같은 컬럼 내 객관식 문제 사이: 12~20줄 (평균 ~15줄)
- 서술형 문제 사이: 0줄 (빈줄 없이 이어짐)
- COLBREAK/PAGEBREAK 후: 빈 문단 1개 (break 문단 자체)

### 디버깅 방법론 기록

**파일이 안 열릴 때 이진탐색 접근법:**

1. section0.xml에서 top-level `<hp:p>` 문단을 raw string으로 분리 (lxml 재직렬화 하지 않음)
2. 문단 N개씩 잘라서 테스트 HWPX 생성 (양식지 ZIP + 잘린 section0.xml)
3. 이진탐색으로 크래시 유발 문단 특정 (184 → 92 → 88 → 정확한 위치)
4. 해당 문단의 구조를 샘플과 비교하여 원인 파악

**주의**: lxml `etree.tostring()`으로 재직렬화하면 속성 순서/인용부호가 바뀌어 한컴 호환 문제가 발생할 수 있음. 항상 raw string 조작 사용.

### 미해결 과제

1. **charPrIDRef/paraPrIDRef 매핑 문제**: 양식지 header.xml의 ID 정의와 빌더가 사용하는 ID가 불일치 → 글꼴 크기/정렬 엉망
2. **양식지 vs 샘플 header.xml 통일**: 빌더가 양식지 기반으로 작업하므로 양식지의 charPr 매핑 테이블을 문서화해야 함
3. **WSL 파일시스템 좀비 문제**: `.claude/skills/` 폴더에서 Write 도구로 파일 생성 시 간헐적으로 좀비 파일 발생 → Python `open()` 직접 사용으로 우회
