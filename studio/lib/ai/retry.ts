import type { AIProviderId, AIStageKey, ResolvedAIProviderId } from "./types";

export const MAX_PROVIDER_ATTEMPTS = 3;

export interface ProviderAttemptState {
  attempt: number;
  maxAttempts?: number;
  exitCode?: number;
  providerFailed?: boolean;
  validationFailed?: boolean;
  aborted?: boolean;
  spawnError?: boolean;
}

export interface ProviderRetryResult<T> {
  ok: boolean;
  attempts: number;
  value?: T;
  error?: unknown;
  aborted?: boolean;
}

export interface ProviderTelemetryEntry {
  stageKey?: AIStageKey;
  workflowStageKey?: string;
  requestedProvider: AIProviderId;
  resolvedProvider: ResolvedAIProviderId;
  attempt: number;
  status: "success" | "failed" | "cancelled";
  elapsedMs: number;
  retry: boolean;
  errorSummary?: string;
  externalCostUsd?: number;
  fallbackFrom?: ResolvedAIProviderId;
  fallbackTo?: ResolvedAIProviderId;
  validationOk?: boolean;
  validationFailureReason?: string;
  failureKind?: "provider" | "validation" | "fallback" | "downstream" | "unknown";
  downstreamCorrection?: boolean;
}

export function shouldRetryProviderAttempt({
  attempt,
  maxAttempts = MAX_PROVIDER_ATTEMPTS,
  exitCode = 0,
  providerFailed = false,
  validationFailed = false,
  aborted = false,
  spawnError = false,
}: ProviderAttemptState): boolean {
  if (aborted) return false;
  if (attempt >= maxAttempts) return false;
  return spawnError || providerFailed || validationFailed || exitCode !== 0;
}

export function createProviderAttemptLog(provider: string, attempt: number, maxAttempts = MAX_PROVIDER_ATTEMPTS): string {
  return `AI provider attempt ${attempt}/${maxAttempts} 시작 (${provider})`;
}

export function createProviderRetryLog(provider: string, attempt: number, maxAttempts = MAX_PROVIDER_ATTEMPTS): string {
  return `AI provider attempt ${attempt}/${maxAttempts} 실패, 같은 provider(${provider})로 재시도합니다.`;
}

export function createProviderTelemetryEntry(entry: ProviderTelemetryEntry): ProviderTelemetryEntry {
  return {
    ...entry,
    elapsedMs: Math.max(0, Math.round(entry.elapsedMs)),
    errorSummary: entry.errorSummary?.slice(0, 300),
    validationFailureReason: entry.validationFailureReason?.slice(0, 300),
  };
}

export async function runProviderWithRetry<T>(
  runAttempt: (attempt: number) => Promise<{ ok: boolean; value?: T; error?: unknown; aborted?: boolean }>,
  maxAttempts = MAX_PROVIDER_ATTEMPTS
): Promise<ProviderRetryResult<T>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runAttempt(attempt);
    if (result.ok) {
      return { ok: true, attempts: attempt, value: result.value };
    }
    if (result.aborted) {
      return { ok: false, attempts: attempt, error: result.error, aborted: true };
    }
    lastError = result.error;
  }

  return { ok: false, attempts: maxAttempts, error: lastError };
}
