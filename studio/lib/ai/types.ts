import type { ChildProcess } from "child_process";
import type { ClaudeEvent } from "../claude";

export type AIProviderId =
  | "auto"
  | "claude-cli"   // 기존 claude → 이름 변경
  | "claude-sdk"   // 신규
  | "codex-cli"    // 기존 codex → 이름 변경
  | "openai-sdk"   // 신규
  | "deepseek-v4"; // 기존
export type ResolvedAIProviderId = Exclude<AIProviderId, "auto">;
// Provider/model-call stage keys. Broader workflow stages are defined in server/stages/types.ts.
// Model-stage contracts live in server/stages/model.ts so provider adapters do not own file mutation.
export type AIStageKey = "create.extractor" | "create.solver" | "create.verifier";

export interface ProviderRunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  maxTurns?: number;
  /** Restrict which tools the provider CLI may use. Only respected by tool-capable providers (claude-cli). */
  allowedTools?: string[];
  mode?: "create" | "resume" | "crop" | string;
  jobId?: string;
  stageKey?: AIStageKey;
  imagePaths?: string[];
  signal?: AbortSignal;
}

export interface ProviderSelectionRunOptions extends ProviderRunOptions {
  provider?: AIProviderId;
}

export interface ProviderRunMetadata {
  requestedProvider: AIProviderId;
  provider: ResolvedAIProviderId;
  label: string;
  externalCostUsd?: number;
}

export interface ProviderRunResult {
  process: ChildProcess;
  events: AsyncIterable<ClaudeEvent>;
  exitCode: Promise<number>;
  metadata: ProviderRunMetadata;
}

export interface AIProviderAdapter {
  id: ResolvedAIProviderId;
  label: string;
  /** true if this provider can run an agentic tool-use loop (Read/Grep/Glob) for extractor flows.
   * claude-cli / codex-cli: native CLI agent loop.
   * claude-sdk / openai-sdk: host-side tool execution loop (sandbox: docs/extractor-reference/).
   * deepseek-v4: single-turn API call — no tool use. */
  supportsTools: boolean;
  run(prompt: string, options?: ProviderRunOptions): ProviderRunResult;
}
