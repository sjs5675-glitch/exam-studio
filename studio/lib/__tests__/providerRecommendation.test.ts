import { describe, expect, it } from "vitest";
import { recommendStageProvider } from "../ai/recommendation";
import type { ProviderTelemetryEntry } from "../ai";

const telemetry: ProviderTelemetryEntry[] = [
  { stageKey: "create.verifier", requestedProvider: "claude-cli", resolvedProvider: "claude-cli", attempt: 1, status: "success", elapsedMs: 3000, retry: false },
  { stageKey: "create.verifier", requestedProvider: "claude-cli", resolvedProvider: "claude-cli", attempt: 1, status: "success", elapsedMs: 3200, retry: false },
  { stageKey: "create.verifier", requestedProvider: "claude-cli", resolvedProvider: "claude-cli", attempt: 1, status: "success", elapsedMs: 3100, retry: false },
  { stageKey: "create.verifier", requestedProvider: "deepseek-v4", resolvedProvider: "deepseek-v4", attempt: 1, status: "success", elapsedMs: 900, retry: false, externalCostUsd: 0.01 },
  { stageKey: "create.verifier", requestedProvider: "deepseek-v4", resolvedProvider: "deepseek-v4", attempt: 1, status: "success", elapsedMs: 950, retry: false, externalCostUsd: 0.01 },
  { stageKey: "create.verifier", requestedProvider: "deepseek-v4", resolvedProvider: "deepseek-v4", attempt: 1, status: "success", elapsedMs: 1000, retry: false, externalCostUsd: 0.01 },
];

describe("stage provider recommendation", () => {
  it("keeps explicit stage overrides ahead of recommendations", () => {
    expect(recommendStageProvider({
      stageKey: "create.verifier",
      stageOverrides: { "create.verifier": "codex-cli" },
      telemetry,
    })).toEqual({ provider: "codex-cli", reason: "explicit-override", observations: 0 });
  });

  it("falls back to claude-cli when observations are insufficient", () => {
    expect(recommendStageProvider({
      stageKey: "create.extractor",
      telemetry,
    })).toEqual({ provider: "claude-cli", reason: "insufficient-data", observations: 0 });
  });

  it("recommends the best telemetry provider for a stage", () => {
    expect(recommendStageProvider({
      stageKey: "create.verifier",
      telemetry,
    })).toEqual({ provider: "deepseek-v4", reason: "best-telemetry", observations: 3 });
  });

  it("blocks external recommendations by policy", () => {
    expect(recommendStageProvider({
      stageKey: "create.verifier",
      telemetry,
      externalApiAllowed: false,
    })).toEqual({ provider: "claude-cli", reason: "best-telemetry", observations: 3 });
  });

  it("rejects high failure rate and high cost candidates", () => {
    const failed: ProviderTelemetryEntry[] = [
      ...telemetry,
      { stageKey: "create.verifier", requestedProvider: "codex-cli", resolvedProvider: "codex-cli", attempt: 1, status: "failed", elapsedMs: 10, retry: true },
      { stageKey: "create.verifier", requestedProvider: "codex-cli", resolvedProvider: "codex-cli", attempt: 2, status: "failed", elapsedMs: 10, retry: true },
      { stageKey: "create.verifier", requestedProvider: "codex-cli", resolvedProvider: "codex-cli", attempt: 3, status: "success", elapsedMs: 10, retry: false },
    ];

    expect(recommendStageProvider({
      stageKey: "create.verifier",
      telemetry: failed,
      maxAverageCostUsd: 0.001,
    })).toEqual({ provider: "claude-cli", reason: "best-telemetry", observations: 3 });
  });
});
