import type { AIProviderId, AIStageKey, ResolvedAIProviderId } from "@/lib/ai/types";
import type { ProviderTelemetryEntry } from "@/lib/ai/retry";
import type { StageError, StageStatus, ValidationResult, WorkflowStageKey } from "./types";

export type StageAttemptOutcome = Extract<StageStatus, "completed" | "failed" | "skipped"> | "cancelled";
export type StageFailureKind = "provider" | "validation" | "fallback" | "downstream" | "unknown";

export interface StageAttemptTelemetryEntry {
  workflowStageKey: WorkflowStageKey;
  modelStageKey?: AIStageKey;
  requestedProvider?: AIProviderId;
  resolvedProvider?: ResolvedAIProviderId;
  attempt: number;
  status: StageAttemptOutcome;
  elapsedMs: number;
  retry: boolean;
  fallbackFrom?: ResolvedAIProviderId;
  fallbackTo?: ResolvedAIProviderId;
  validation?: ValidationResult;
  failureKind?: StageFailureKind;
  errorSummary?: string;
  downstreamCorrection?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CreateStageAttemptTelemetryInput
  extends Omit<StageAttemptTelemetryEntry, "elapsedMs" | "errorSummary"> {
  elapsedMs: number;
  error?: StageError | Error | string;
  errorSummary?: string;
}

export function createStageAttemptTelemetryEntry(
  input: CreateStageAttemptTelemetryInput
): StageAttemptTelemetryEntry {
  return {
    ...input,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
    errorSummary: summarizeStageError(input.errorSummary ?? input.error),
    failureKind: input.failureKind ?? inferFailureKind(input),
  };
}

export function toProviderTelemetryEntry(
  entry: StageAttemptTelemetryEntry
): ProviderTelemetryEntry | undefined {
  if (!entry.modelStageKey || !entry.requestedProvider || !entry.resolvedProvider) {
    return undefined;
  }

  return {
    stageKey: entry.modelStageKey,
    workflowStageKey: entry.workflowStageKey,
    requestedProvider: entry.requestedProvider,
    resolvedProvider: entry.resolvedProvider,
    attempt: entry.attempt,
    status: entry.status === "completed" ? "success" : entry.status === "cancelled" ? "cancelled" : "failed",
    elapsedMs: entry.elapsedMs,
    retry: entry.retry,
    errorSummary: entry.errorSummary,
    fallbackFrom: entry.fallbackFrom,
    fallbackTo: entry.fallbackTo,
    validationOk: entry.validation?.ok,
    validationFailureReason: entry.validation?.ok === false ? entry.validation.message : undefined,
    failureKind: entry.failureKind,
    downstreamCorrection: entry.downstreamCorrection,
  };
}

function summarizeStageError(error?: StageError | Error | string): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return error.slice(0, 300);
  return error.message.slice(0, 300);
}

function inferFailureKind(input: CreateStageAttemptTelemetryInput): StageFailureKind | undefined {
  if (input.status === "completed" || input.status === "skipped") return undefined;
  if (input.validation && !input.validation.ok) return "validation";
  if (input.fallbackFrom || input.fallbackTo) return "fallback";
  if (input.downstreamCorrection) return "downstream";
  if (input.requestedProvider || input.resolvedProvider) return "provider";
  return "unknown";
}
