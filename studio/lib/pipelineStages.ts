import type { AIStageKey } from "@/lib/ai/types";

export const PIPELINE_STAGES = [
  "extractor",
  "solver",
  "verifier",
  "figure",
  "builder",
  "checker",
] as const;

export type PipelineStageName = (typeof PIPELINE_STAGES)[number];

/**
 * AI provider 선택용 stage key("create.extractor" 등)를 pipeline UI stage 이름으로
 * 매핑한다. Phase 1(stage-runner-rewrite)에서 도입된 AIStageKey와 PipelineView가
 * 사용하는 stage 식별자를 명시적으로 연결.
 *
 * - "create.extractor" → "extractor"
 * - "create.solver"    → "solver"
 * - "create.verifier"  → "verifier"
 */
export function aiStageToPipeline(key: AIStageKey): PipelineStageName | null {
  if (key === "create.extractor") return "extractor";
  if (key === "create.solver") return "solver";
  if (key === "create.verifier") return "verifier";
  return null;
}

/**
 * 임의 stage 이름 문자열을 canonical pipeline name으로 정규화.
 * SSE event name이 legacy 형태("create.extractor")로 들어와도 매칭되도록 한다.
 * matching 실패 시 입력 그대로 반환(통과).
 */
export function normalizePipelineStage(name: string): string {
  if (name.startsWith("create.")) {
    const tail = name.slice("create.".length);
    if ((PIPELINE_STAGES as readonly string[]).includes(tail)) return tail;
  }
  return name;
}
