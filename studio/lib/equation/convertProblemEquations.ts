/**
 * convertProblemEquations — extractor/solver 결과의 수식을 LaTeX → HWP 로 일괄 변환.
 *
 * 프롬프트가 수식을 LaTeX 로 출력하므로, 캐시(_extracted/_solved.json)에 쓰기 전
 * stage 단계에서 HWP 수식 스크립트로 변환한다. (CLAUDE.md: 캐시·프론트는 HWP 유지)
 *
 * 변환 대상:
 *   - `{eq: latex}` part 객체  — parts·choices·condition_box.items.parts·
 *                                data_table.row_parts/header_parts·explanation_parts
 *   - `{type:"equation", script: latex}` 셀 — explanation_table(조립제법)
 *   (pascal 이항계수·증감표 x_values 등 단순값은 LaTeX==HWP 라 변환 불필요)
 *
 * HWP 고유 후처리(R-01~R-10)는 별도 normalizeParts / equation.py 가 담당. 여기선
 * 구조 변환만 한다.
 */
import { latexToHwp } from "./latexToHwp";

/** 임의 객체/배열을 깊이 순회하며 eq·script 수식 필드를 LaTeX→HWP 변환 (불변). */
export function convertProblemEquations<T>(node: T): T {
  if (Array.isArray(node)) {
    return node.map((x) => convertProblemEquations(x)) as unknown as T;
  }
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "eq" && typeof v === "string") {
        out[k] = latexToHwp(v);
      } else if (k === "script" && typeof v === "string" && obj["type"] === "equation") {
        out[k] = latexToHwp(v);
      } else {
        out[k] = convertProblemEquations(v);
      }
    }
    return out as T;
  }
  return node;
}
