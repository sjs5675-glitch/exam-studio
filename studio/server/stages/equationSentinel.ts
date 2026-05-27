/**
 * 수식 센티넬 전송 — LLM 이 JSON 안에 LaTeX 를 내보낼 때 백슬래시 이스케이프가 깨지는 문제 대응.
 *
 * 두 부류의 모델 행동이 모두 관측된다:
 *   (A) JSON 습관대로 **이중 백슬래시**(유효 JSON)를 냄: `"<<EQ>>\\frac{1}{2}<</EQ>>"`
 *       — codex-cli 등. 이 경우 센티넬 토큰만 제거하면 그대로 유효 JSON 이라 정상 파싱된다.
 *   (B) 지시대로 **단일 백슬래시** raw LaTeX 를 냄: `"<<EQ>>\frac{1}{2}<</EQ>>"`
 *       — claude-cli 등. 이 경우 JSON 으로는 무효라, 센티넬 구간을 코드가 이스케이프해야 한다.
 *
 * 과거엔 (B)만 가정해 무조건 `JSON.stringify` 로 이스케이프했는데, (A) 입력에는 **이미 이스케이프된
 * 걸 한 번 더** 이스케이프해 `\\frac`(백슬래시 2개)가 되고, 다운스트림 LaTeX 변환기가 `\\`를
 * 줄바꿈으로 오해해 수식이 빈값/잘림으로 조용히 손상됐다. (codex = 기본 provider 라 실제 작업이 깨짐.)
 *
 * 해법: 두 변환(strip / escape)을 모두 후보로 만들고, 센티넬 구간의 `\\`(이중 백슬래시) 유무로
 * **어느 쪽을 먼저 시도할지**만 정한다. 먼저 시도한 변환의 JSON 파싱이 실패하면 다른 쪽으로 폴백한다.
 *
 * 단일 source of truth: 프롬프트 빌더와 파서가 같은 토큰 상수를 import 한다.
 */

export const EQ_SENTINEL_OPEN = "<<EQ>>";
export const EQ_SENTINEL_CLOSE = "<</EQ>>";

// `<<EQ>>` … `<</EQ>>` (non-greedy). 수식엔 절대 안 나오는 토큰.
const EQ_SPAN = /<<EQ>>([\s\S]*?)<<\/EQ>>/g;
// 센티넬 토큰 자체 (열기/닫기 모두).
const EQ_TOKEN = /<<EQ>>|<<\/EQ>>/g;

/**
 * (A) 센티넬 토큰만 제거하고 JSON 구조는 그대로 둔다. 모델이 유효 JSON(이중 백슬래시)을 낸 경우
 * 이 결과가 정상 파싱된다. 예: `"<<EQ>>\\frac{1}{2}<</EQ>>"` → `"\\frac{1}{2}"` (유효 JSON).
 */
export function stripEquationSentinels(raw: string): string {
  return raw.replace(EQ_TOKEN, "");
}

/**
 * (B) 센티넬 구간 안의 내용을 `JSON.stringify` 로 결정론적으로 이스케이프하고 토큰을 제거한다.
 * 모델이 단일 백슬래시 raw LaTeX 를 낸 경우용. 센티넬이 없으면 무변경(no-op).
 * 예: `"<<EQ>>\frac{1}{2}<</EQ>>"` → `"\\frac{1}{2}"` (유효 JSON).
 */
export function escapeEquationSentinels(raw: string): string {
  return raw.replace(EQ_SPAN, (_match, inner: string) => {
    // JSON.stringify 가 백슬래시·따옴표·제어문자를 정확히 이스케이프. 바깥 따옴표만 제거.
    const escaped = JSON.stringify(inner);
    return escaped.slice(1, -1);
  });
}

/**
 * 후방호환 별칭 — 예전 (B) 전용 함수. 신규 코드는 {@link buildSentinelCandidates} 를 쓴다.
 */
export const unwrapEquationSentinels = escapeEquationSentinels;

/**
 * 파싱 시도 순서가 정해진 변환 후보들을 반환한다.
 * 센티넬 구간에 `\\`(이중 백슬래시)가 하나라도 있으면 모델이 JSON 이스케이프를 한 것으로 보고
 * strip 을 먼저(=정답), 아니면 단일 백슬래시 raw 로 보고 escape 를 먼저 시도한다.
 * 나머지 하나는 첫 변환의 파싱 실패 시 폴백.
 */
export function buildSentinelCandidates(raw: string): string[] {
  let doubled = false;
  raw.replace(EQ_SPAN, (match, inner: string) => {
    if (inner.includes("\\\\")) doubled = true;
    return match;
  });
  const stripped = stripEquationSentinels(raw);
  const escaped = escapeEquationSentinels(raw);
  return doubled ? [stripped, escaped] : [escaped, stripped];
}
