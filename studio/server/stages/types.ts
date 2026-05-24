import type { AIStageKey, AIProviderId, ResolvedAIProviderId } from "@/lib/ai/types";

export type WorkflowStageKey =
  | "cropper"
  | "create.cleaned"
  | "create.extractor"
  | "create.review_extract"
  | "create.solver"
  | "create.verifier"
  | "create.aggregate"
  | "figure"
  | "builder"
  | "checker";

export type ModelWorkflowStageKey = Extract<WorkflowStageKey, AIStageKey>;

export type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type StageFileKind =
  | "input"
  | "output"
  | "cache"
  | "artifact"
  | "log"
  | "metadata";

export interface StageFile {
  path: string;
  kind: StageFileKind;
  label?: string;
  mimeType?: string;
  bytes?: number;
}

export interface StageRunContext {
  jobId: string;
  stageKey: WorkflowStageKey;
  mode?: string;
  workspaceDir?: string;
  cacheDir?: string;
  inputFiles?: StageFile[];
  provider?: AIProviderId;
  modelStageKey?: AIStageKey;
  metadata?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

export interface StageError {
  code: string;
  message: string;
  cause?: unknown;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface StageProviderMetadata {
  requestedProvider?: AIProviderId;
  provider?: ResolvedAIProviderId;
  modelStageKey?: AIStageKey;
  label?: string;
  externalCostUsd?: number;
}

export interface StageResult<Output = unknown> {
  status: StageStatus;
  output?: Output;
  files?: StageFile[];
  validation?: ValidationResult;
  error?: StageError;
  provider?: StageProviderMetadata;
  startedAt?: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface StageRunner<Input = unknown, Output = unknown> {
  key: WorkflowStageKey;
  run(input: Input, context: StageRunContext): Promise<StageResult<Output>>;
}
