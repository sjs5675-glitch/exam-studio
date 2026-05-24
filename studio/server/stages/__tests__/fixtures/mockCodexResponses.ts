/**
 * mockCodexResponses.ts
 *
 * exam-rich mock response fixtures that mirror the shape of real codex/claude
 * responses to extractor, solver, and verifier prompts.
 *
 * These fixtures are used by orchestrator.pipeline.test.ts to verify that
 * Phase 2-4 schema integration actually matches the response shape.
 */

// ────────────────────────────────────────────────────────────────────────────
// Extractor responses (extractor prompt schema: parts 배열, choices 배열)
// ────────────────────────────────────────────────────────────────────────────

/** Q1 extractor response — 객관식, 그림 없음 */
export const MOCK_EXTRACTOR_RESPONSE_Q1 = {
  number: 1,
  type: "choice",
  score: "4",
  difficulty: "중",
  subtopic: "삼각함수",
  has_figure: false,
  figure_info: null,
  parts: [{ t: "다음 중 옳은 것은?" }],
  choices: [
    [{ eq: "\\sin 0 = 0" }],
    [{ eq: "\\cos 0 = 0" }],
    [{ eq: "\\tan 0 = 1" }],
    [{ eq: "\\sin {pi over 2} = 0" }],
    [{ eq: "\\cos {pi over 2} = 1" }],
  ],
  condition_box: null,
  bogi_box: null,
  data_table: null,
  // answer 및 question 필드 없음 (extractor 프롬프트 지시에 따라 solver 책임)
};

/** Q2 extractor response — 객관식, 그림 있음 */
export const MOCK_EXTRACTOR_RESPONSE_Q2 = {
  number: 2,
  type: "choice",
  score: "4",
  difficulty: "상",
  subtopic: "수열",
  has_figure: true,
  figure_info: {
    description_en: "A coordinate plane with a parabola opening upward, vertex at origin.",
    position: "right",
    crop_ratio: [0.5, 0.1, 1.0, 0.9],
  },
  parts: [{ t: "그림과 같이 좌표평면에서 포물선이 주어질 때," }, { t: "다음 중 옳은 것을 고르시오." }],
  choices: [
    [{ t: "꼭짓점은 원점이다." }],
    [{ t: "축은 y축과 평행하다." }],
    [{ t: "위로 볼록하다." }],
    [{ t: "x절편이 2개이다." }],
    [{ t: "y절편이 음수이다." }],
  ],
  condition_box: null,
  bogi_box: null,
  data_table: null,
};

/** Q3 extractor response — 서술형, 그림 없음 */
export const MOCK_EXTRACTOR_RESPONSE_Q3 = {
  number: 3,
  type: "short",
  score: "5",
  difficulty: "하",
  subtopic: "함수",
  has_figure: false,
  figure_info: null,
  parts: [
    { t: "다음 식을 계산하시오." },
    { br: true },
    { eq: "left( 2 + 3 right) times 4 - 10" },
  ],
  choices: null,
  condition_box: null,
  bogi_box: null,
  data_table: null,
};

// ────────────────────────────────────────────────────────────────────────────
// Solver responses
// ────────────────────────────────────────────────────────────────────────────

/** Q1 solver response */
export const MOCK_SOLVER_RESPONSE_Q1 = {
  number: 1,
  answer: "①",
  explanation_parts: [
    { t: "삼각함수의 기본값을 확인한다." },
    { br: true },
    { eq: "\\sin 0 = 0" },
    { t: "이므로 ①이 옳다." },
  ],
};

/** Q2 solver response */
export const MOCK_SOLVER_RESPONSE_Q2 = {
  number: 2,
  answer: "①",
  explanation_parts: [
    { t: "위로 볼록하지 않고 아래로 볼록한 포물선이므로" },
    { br: true },
    { t: "꼭짓점은 원점이다." },
  ],
};

/** Q3 solver response */
export const MOCK_SOLVER_RESPONSE_Q3 = {
  number: 3,
  answer: "10",
  explanation_parts: [
    { t: "순서대로 계산한다." },
    { br: true },
    { eq: "left( 2 + 3 right) times 4 - 10 = 5 times 4 - 10 = 20 - 10 = 10" },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Verifier responses — pass 케이스
// ────────────────────────────────────────────────────────────────────────────

/** Q1 verifier response — pass */
export const MOCK_VERIFIER_RESPONSE_Q1_PASS = {
  number: 1,
  status: "pass" as const,
  issues: [],
  feedback: null,
};

/** Q2 verifier response — pass */
export const MOCK_VERIFIER_RESPONSE_Q2_PASS = {
  number: 2,
  status: "pass" as const,
  issues: [],
  feedback: null,
};

/** Q3 verifier response — pass */
export const MOCK_VERIFIER_RESPONSE_Q3_PASS = {
  number: 3,
  status: "pass" as const,
  issues: [],
  feedback: null,
};

// ────────────────────────────────────────────────────────────────────────────
// Verifier responses — fail 케이스 (피드백 루프 테스트용)
// ────────────────────────────────────────────────────────────────────────────

/** Q1 verifier response — fail (첫 번째 시도에서 실패) */
export const MOCK_VERIFIER_RESPONSE_Q1_FAIL = {
  number: 1,
  status: "fail" as const,
  issues: [
    {
      category: "math_accuracy" as const,
      description: "sin 0의 값이 맞지만 다른 보기 검증 필요",
      location: "explanation_parts[2]",
    },
  ],
  feedback: "다른 보기가 왜 틀렸는지 더 상세히 설명하세요.",
};

