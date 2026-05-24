import type {
  AIProviderAdapter,
  AIProviderId,
  AIStageKey,
  ProviderRunOptions,
  ProviderRunResult,
  ResolvedAIProviderId,
} from "@/lib/ai/types";
import type { StageError, StageFile, StageResult, ValidationResult, WorkflowStageKey } from "./types";

export type ModelStageOutputKind = "json" | "text";

export interface ModelStageInput<Payload = unknown> {
  stageKey: AIStageKey;
  workflowStageKey?: WorkflowStageKey;
  prompt: string;
  payload?: Payload;
  outputKind?: ModelStageOutputKind;
  requestedProvider?: AIProviderId;
  metadata?: Record<string, unknown>;
}

export interface ModelStageProviderResult<RawOutput = string> {
  provider: ResolvedAIProviderId;
  label: string;
  rawOutput: RawOutput;
  elapsedMs: number;
  externalCostUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface StageModelProvider<RawOutput = string> {
  id: ResolvedAIProviderId;
  label: string;
  runModel(input: ModelStageInput, options?: ProviderRunOptions): Promise<ModelStageProviderResult<RawOutput>>;
}

export interface ModelStageValidation<Output = unknown> extends ValidationResult {
  output?: Output;
}

export interface ModelStageResult<Output = unknown> extends StageResult<Output> {
  provider?: StageResult["provider"] & {
    modelStageKey: AIStageKey;
  };
  validation?: ModelStageValidation<Output>;
  rawOutput?: string;
}

export interface ModelStageRunContext {
  jobId: string;
  workflowStageKey: WorkflowStageKey;
  modelStageKey: AIStageKey;
  cacheDir?: string;
  requestedProvider?: AIProviderId;
  metadata?: Record<string, unknown>;
}

export interface ModelStageRunner<Input = unknown, Output = unknown> {
  key: AIStageKey;
  run(input: Input, context: ModelStageRunContext): Promise<ModelStageResult<Output>>;
}

export interface ModelStageCacheWrite<Output = unknown> {
  path: string;
  output: Output;
  files?: StageFile[];
}

export interface ModelStageFailure {
  error: StageError;
  validation?: ValidationResult;
  rawOutput?: string;
}

export function toProviderRunOptions(input: ModelStageInput, options: ProviderRunOptions = {}): ProviderRunOptions {
  return {
    ...options,
    stageKey: input.stageKey,
  };
}

export function createStageModelProvider(adapter: AIProviderAdapter): StageModelProvider<ProviderRunResult> {
  return {
    id: adapter.id,
    label: adapter.label,
    async runModel(input, options) {
      const startedAt = Date.now();
      const result = adapter.run(input.prompt, toProviderRunOptions(input, options));

      return {
        provider: result.metadata.provider,
        label: result.metadata.label,
        rawOutput: result,
        elapsedMs: Date.now() - startedAt,
        externalCostUsd: result.metadata.externalCostUsd,
        metadata: {
          requestedProvider: result.metadata.requestedProvider,
        },
      };
    },
  };
}
