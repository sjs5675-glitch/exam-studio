/**
 * 수식 센티넬 전송 — LLM 이 JSON 안에 LaTeX 단일 백슬래시(`\frac`)를 그대로 내보내면
 * JSON 문자열 이스케이프 규칙 위반으로 `JSON.parse` 가 확률적으로 실패한다.
 * 프롬프트로 "백슬래시 두 개"를 강제하는 건 LLM 의 근본적 한계상 보장되지 않는다.
 *
 * 해법: LLM 이 eq/script 값을 센티넬로 감싸고 **자연스러운 단일 백슬래시 LaTeX** 를 쓰게 하고,
 * 파싱 직전 코드가 센티넬 구간을 찾아 `JSON.stringify` 로 **결정론적으로** 이스케이프한다.
 * 센티넬이 구간을 명확히 구분해주므로, 안에 어떤 문자(백슬래시·따옴표·줄바꿈)가 와도 안전하다.
 *
 * 단일 source of truth: 프롬프트 빌더와 파서가 같은 토큰 상수를 import 한다.
 */

export const EQ_SENTINEL_OPEN = "<<EQ>>";
export const EQ_SENTINEL_CLOSE = "<</EQ>>";

// `<<EQ>>` … `<</EQ>>` (non-greedy). 수식엔 절대 안 나오는 토큰.
const EQ_SPAN = /<<EQ>>([\s\S]*?)<<\/EQ>>/g;

/**
 * raw 모델 출력에서 센티넬 구간을 찾아 그 안의 내용을 JSON 문자열 이스케이프로 치환하고
 * 센티넬 토큰 자체는 제거한다. 센티넬이 없으면 무변경(no-op) — 센티넬을 안 쓰는 stage 에 무해.
 *
 * 예: `"eq": "<<EQ>>\frac{1}{2}<</EQ>>"`  →  `"eq": "\\frac{1}{2}"`  (유효 JSON)
 */
export function unwrapEquationSentinels(raw: string): string {
  return raw.replace(EQ_SPAN, (_match, inner: string) => {
    // JSON.stringify 가 백슬래시·따옴표·제어문자를 정확히 이스케이프. 바깥 따옴표만 제거.
    const escaped = JSON.stringify(inner);
    return escaped.slice(1, -1);
  });
}
