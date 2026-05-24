import type { AIProviderId, AIStageKey } from "./types";

/**
 * 각 stage별로 사용 가능한 provider 집합.
 * DeepSeek V4는 vision 미지원이므로 create.extractor는 제외.
 */
export const STAGE_PROVIDER_CAPABILITY: Record<AIStageKey, AIProviderId[]> = {
  "create.extractor": ["auto", "claude-cli", "claude-sdk", "codex-cli", "openai-sdk"],
  "create.solver":    ["auto", "claude-cli", "claude-sdk", "codex-cli", "openai-sdk", "deepseek-v4"],
  "create.verifier":  ["auto", "claude-cli", "claude-sdk", "codex-cli", "openai-sdk", "deepseek-v4"],
};

/** provider가 해당 stage에서 사용 가능한지 확인 */
export function isProviderAllowedForStage(
  stageKey: AIStageKey,
  provider: AIProviderId
): boolean {
  return STAGE_PROVIDER_CAPABILITY[stageKey].includes(provider);
}
