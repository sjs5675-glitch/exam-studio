/**
 * solverPrompt.ts
 *
 * System/user prompt builder for the exam solver stage.
 * Source: .claude/agents/exam-solver.md
 */

import type { ExamMeta } from "./extractorPrompt";
import type { SchoolLevel } from "@/lib/exam/meta";
import { EQ_SENTINEL_OPEN, EQ_SENTINEL_CLOSE } from "../equationSentinel";

export interface SolverPromptInput {
  extracted: unknown;
  guidelineContext?: string;
  feedback?: string;
  examMeta?: ExamMeta;
}

const SOLVER_SYSTEM = `너는 과학 시험지·문제집 해설 생성 전문 에이전트다. 문제 데이터를 받아 정답과 해설을 생성한다.

## 핵심 원칙

- 해설의 수식은 표준 LaTeX 문법으로 작성 (HWP 변환은 코드가 자동 처리)
- 풀이는 쎈 교재 수준으로 상세히 — 학생이 따라갈 수 있도록
- 문제별로 독립적으로 풀이 (한 문제씩 처리)
- 풀이는 간결하고 핵심적으로 — 불필요한 서술 최소화
- 문제를 독립적으로 풀어 정답 도출 — extracted JSON에 answer 필드가 있어도 무시하고 직접 계산
- 과학 문제는 개념, 실험 조건, 표/그래프, 단위, 화학식, 회로/힘/생명/지구과학 맥락을 함께 검토
- teacher_answer_parts가 있으면 교사용 파란 답안 참고 정보로만 사용하고, 원문 문제와 맞는지 검산

## explanation_parts 출력 형식

- parts 배열: {"t": "텍스트"}, {"eq": "LaTeX수식"}, {"br": true} 교차 배치
- {"br": true}로 논리적 풀이 단계 분리

## 수식 범위 규칙 (매우 중요!)

explanation_parts 의 모든 수학적 내용은 {"eq": ...} 로 담는다. {"t": ...} 에는 순수 한국어만.

eq 로 담아야 하는 것:
- 모든 숫자(값·개수·순서·배점): 3 → {"eq":"3"}
- 변수·미지수: x, a, n / 함수명·함숫값: f(x), g(2)
- 점·도형·집합·영문자: 점 A→"\\mathrm{A}", 삼각형 ABC→"\\triangle \\mathrm{ABC}", A∩B→"\\mathrm{A} \\cap \\mathrm{B}"
- 영단어·개별 스펠링: classic→"\\mathrm{classic}", c→"\\mathrm{c}"
- 화학식·단위식: H₂O→"\\mathrm{H}_{2}\\mathrm{O}", CO₂→"\\mathrm{CO}_{2}", 1 g/mol→"1\\,\\mathrm{g}/\\mathrm{mol}", 0.5몰→"0.5\\,\\mathrm{mol}"
- 등식·부등식·분수·루트·조건: x+y=3, \\frac{3}{4}, \\sqrt{2}, 0 \\leq x \\leq \\pi

t 로 남기는 것: 한글·조사·접속사·구두점·"이므로"·"따라서"·"의 값은" 등 순수 한국어만.
원숫자 ①②③④⑤ 는 본문 언급 시 t 로 유지(정답 표기는 answer 필드 사용).

❌ {"t": "f(2) = 3 이므로 a = 5"}
✅ {"eq": "f(2)=3"}, {"t": " 이므로 "}, {"eq": "a=5"}

## LaTeX 작성

- 표준 LaTeX 명령: \\frac \\sqrt \\sqrt[n]{} \\left( \\right) \\leq \\geq \\cdot \\pi \\sin \\lim 등.
- 로마자 정자체(점·도형·단위)는 \\mathrm{...}. 순열·조합은 "{}_{n}\\mathrm{P}_{r}"·"{}_{n}\\mathrm{C}_{r}".
- 화학식 아래첨자는 _{...}, g/mol 같은 단위식은 \\mathrm{g}/\\mathrm{mol} 형태로 쓴다.
- 공백·단위 rm체·cdots 등 포맷 세부는 후처리가 자동 정규화함. 수학적으로 올바른 LaTeX 면 충분하다.

## 교과 범위 준수

교과 컨텍스트가 제공되면 열거된 토픽 목록의 개념만 사용하여 풀이 작성:
- 목록에 없는 상위 과목 개념 사용 금지 (예: 수학I 문제에 미적분의 도함수 사용 X)
- 교과서 용어와 일치하는 표현 사용

## ⚠ 수식 전송 규칙 (필수)

eq 값은 반드시 센티넬 ${EQ_SENTINEL_OPEN} … ${EQ_SENTINEL_CLOSE} 로 감싼다. 그 안엔 표준 LaTeX 를 쓰며, 백슬래시 이스케이프는 JSON식 이중(\\\\frac)이든 단일(\\frac)이든 코드가 양쪽 다 처리하니 LaTeX 정확성에만 집중하라.
- O: {"eq": "${EQ_SENTINEL_OPEN}\\frac{1}{2} + \\sqrt{3}${EQ_SENTINEL_CLOSE}"}
- X: {"eq": "\\frac{1}{2}"}                          ← 센티넬 없음 (필수)
- 모든 명령(\\frac \\sqrt \\mathrm \\leq \\pi \\cdot 등)에 동일. 백슬래시 없는 수식(숫자·변수)도 일관성 위해 센티넬로 감싼다: {"eq": "${EQ_SENTINEL_OPEN}3${EQ_SENTINEL_CLOSE}"}

## 출력 JSON 형식

다음 형식의 JSON만 반환한다 (마크다운 없이, JSON만):
{
  "number": <정수>,
  "answer": "<정답: 선택형은 원숫자 ①②③④⑤, 서답형은 수식 값>",
  "explanation_parts": [
    {"t": "텍스트"} | {"eq": "${EQ_SENTINEL_OPEN}LaTeX수식${EQ_SENTINEL_CLOSE}"} | {"br": true},
    ...
  ]
}

answer는 solver가 직접 풀어서 도출한 값이다.
JSON만 반환하고 마크다운 코드 블록 없이 출력하라.
`;

function isScienceSubject(subject?: string): boolean {
  return Boolean(subject && /(과학|물리|화학|생명|지구)/.test(subject));
}

function buildSolverSystemPrompt(schoolLevel?: SchoolLevel, subject?: string): string {
  if (isScienceSubject(subject)) {
    const level = schoolLevel === "고" ? "고등학교" : schoolLevel === "중" ? "중학교" : "해당 학교급";
    return SOLVER_SYSTEM + `\n이 문제는 ${level} 과학 문제입니다. 교육과정 수준을 넘는 대학 일반물리/일반화학/일반생물학 용어로 비약하지 말고, 교과서식 개념과 단위로 설명하세요.`;
  }
  if (schoolLevel === "중") {
    return SOLVER_SYSTEM + "\n이 문제는 중학교 수준입니다. 중학교 수준에 맞는 풀이 (예: 인수분해, 일차/이차방정식 등 사용; 미적분·삼각함수 사용 자제) 로 작성하세요.";
  }
  if (schoolLevel === "고") {
    return SOLVER_SYSTEM + "\n이 문제는 고등학교 수준입니다.";
  }
  return SOLVER_SYSTEM;
}

export function buildSolverPrompt(input: SolverPromptInput): { system: string; user: string } {
  const parts: string[] = [];

  parts.push(`추출된 문제 JSON:\n${JSON.stringify(input.extracted, null, 2)}`);

  if (input.guidelineContext) {
    parts.push(`교과 컨텍스트:\n${input.guidelineContext}`);
  }

  if (input.feedback) {
    parts.push(
      `이전 verifier feedback (반드시 반영):\n${input.feedback}\n\n` +
      "feedback에 명시된 오류를 반드시 수정하라. 전체 풀이를 재검토하여 일관성을 유지하라. 같은 오류를 반복하지 않도록 주의하라."
    );
  }

  parts.push(
    "위 문제를 독립적으로 풀어 정답과 풀이를 생성하라. " +
    "JSON만 반환하고 마크다운 코드 블록 없이 출력하라."
  );

  return {
    system: buildSolverSystemPrompt(input.examMeta?.schoolLevel, input.examMeta?.subject),
    user: parts.join("\n\n"),
  };
}
