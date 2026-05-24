import { describe, expect, it } from "vitest";
import {
  MAX_PROVIDER_ATTEMPTS,
  createProviderAttemptLog,
  createProviderRetryLog,
  createProviderTelemetryEntry,
  runProviderWithRetry,
  shouldRetryProviderAttempt,
} from "../ai/retry";
import {
  createValidationTelemetry,
  parseModelJsonOutput,
  validateModelOutput,
} from "../../server/stages/modelHarness";

describe("provider retry policy", () => {
  it("retries after one failure and returns the second successful result", async () => {
    const attempts: number[] = [];
    const result = await runProviderWithRetry(async (attempt) => {
      attempts.push(attempt);
      return attempt === 1
        ? { ok: false, error: new Error("exit 1") }
        : { ok: true, value: "done" };
    });

    expect(result).toEqual({ ok: true, attempts: 2, value: "done" });
    expect(attempts).toEqual([1, 2]);
  });

  it("stops after three failed attempts", async () => {
    const attempts: number[] = [];
    const result = await runProviderWithRetry(async (attempt) => {
      attempts.push(attempt);
      return { ok: false, error: `failed ${attempt}` };
    });

    expect(result).toEqual({ ok: false, attempts: MAX_PROVIDER_ATTEMPTS, error: "failed 3" });
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("does not retry aborted attempts", async () => {
    const attempts: number[] = [];
    const result = await runProviderWithRetry(async (attempt) => {
      attempts.push(attempt);
      return { ok: false, aborted: true, error: "client disconnected" };
    });

    expect(result).toEqual({ ok: false, attempts: 1, error: "client disconnected", aborted: true });
    expect(attempts).toEqual([1]);
  });

  it("retries only provider process failures and spawn errors before max attempts", () => {
    expect(shouldRetryProviderAttempt({ attempt: 1, exitCode: 1 })).toBe(true);
    expect(shouldRetryProviderAttempt({ attempt: 1, providerFailed: true })).toBe(true);
    expect(shouldRetryProviderAttempt({ attempt: 1, validationFailed: true })).toBe(true);
    expect(shouldRetryProviderAttempt({ attempt: 1, spawnError: true })).toBe(true);
    expect(shouldRetryProviderAttempt({ attempt: 1, exitCode: 0, providerFailed: false })).toBe(false);
    expect(shouldRetryProviderAttempt({ attempt: 1, exitCode: 1, aborted: true })).toBe(false);
    expect(shouldRetryProviderAttempt({ attempt: 3, exitCode: 1 })).toBe(false);
  });

  it("formats attempt SSE log messages", () => {
    expect(createProviderAttemptLog("codex", 1)).toBe("AI provider attempt 1/3 시작 (codex)");
    expect(createProviderRetryLog("claude", 2)).toBe("AI provider attempt 2/3 실패, 같은 provider(claude)로 재시도합니다.");
  });

  it("normalizes provider telemetry entries without storing payloads", () => {
    expect(createProviderTelemetryEntry({
      stageKey: "create.verifier",
      workflowStageKey: "create.verifier",
      requestedProvider: "deepseek-v4",
      resolvedProvider: "deepseek-v4",
      attempt: 2,
      status: "failed",
      elapsedMs: 10.4,
      retry: true,
      errorSummary: "x".repeat(400),
      fallbackFrom: "deepseek-v4",
      fallbackTo: "claude-cli",
      validationOk: false,
      validationFailureReason: "missing status",
      failureKind: "validation",
      downstreamCorrection: true,
    })).toEqual({
      stageKey: "create.verifier",
      workflowStageKey: "create.verifier",
      requestedProvider: "deepseek-v4",
      resolvedProvider: "deepseek-v4",
      attempt: 2,
      status: "failed",
      elapsedMs: 10,
      retry: true,
      errorSummary: "x".repeat(300),
      fallbackFrom: "deepseek-v4",
      fallbackTo: "claude-cli",
      validationOk: false,
      validationFailureReason: "missing status",
      failureKind: "validation",
      downstreamCorrection: true,
    });
  });

  it("extracts and validates structured model JSON without storing raw payloads", () => {
    const parsed = parseModelJsonOutput("Verifier result:\n```json\n{\"status\":\"pass\",\"issues\":[]}\n```");

    expect(parsed).toMatchObject({
      ok: true,
      value: { status: "pass", issues: [] },
      source: "fenced",
    });

    const validation = validateModelOutput(parsed.ok ? parsed.value : undefined, (value) => {
      if (
        value &&
        typeof value === "object" &&
        "status" in value &&
        ((value as { status: unknown }).status === "pass" || (value as { status: unknown }).status === "fail")
      ) {
        return { ok: true, output: value as { status: "pass" | "fail"; issues?: unknown[] } };
      }
      return { ok: false, message: "missing status" };
    });

    expect(validation).toEqual({
      ok: true,
      output: { status: "pass", issues: [] },
    });

    expect(parseModelJsonOutput("not json")).toMatchObject({
      ok: false,
      validation: { ok: false, message: "Model output did not contain valid JSON" },
      error: { code: "model_json_parse_failed", retryable: true },
    });
  });

  it("converts validation failures to retry telemetry without raw provider payloads", () => {
    expect(createValidationTelemetry(
      { ok: false, message: "missing feedback" },
      {
        stageKey: "create.verifier",
        workflowStageKey: "create.verifier",
        requestedProvider: "deepseek-v4",
        resolvedProvider: "deepseek-v4",
        attempt: 1,
        elapsedMs: 1.2,
        retry: true,
      }
    )).toEqual({
      stageKey: "create.verifier",
      workflowStageKey: "create.verifier",
      requestedProvider: "deepseek-v4",
      resolvedProvider: "deepseek-v4",
      attempt: 1,
      status: "failed",
      elapsedMs: 1.2,
      retry: true,
      validationOk: false,
      failureKind: "validation",
      errorSummary: "missing feedback",
    });
  });
});
