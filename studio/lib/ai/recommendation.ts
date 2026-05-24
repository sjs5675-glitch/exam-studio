import type { AIStageKey, ResolvedAIProviderId } from "./types";
import type { ProviderTelemetryEntry } from "./retry";
import type { StageOverrideMap } from "./settings";

export interface StageRecommendationOptions {
  stageKey: AIStageKey;
  stageOverrides?: StageOverrideMap;
  telemetry: ProviderTelemetryEntry[];
  minObservations?: number;
  maxFailureRate?: number;
  maxAverageCostUsd?: number;
  externalApiAllowed?: boolean;
}

export interface StageRecommendationResult {
  provider: ResolvedAIProviderId;
  reason: "explicit-override" | "insufficient-data" | "policy-blocked" | "best-telemetry" | "fallback";
  observations: number;
}

interface ProviderStats {
  provider: ResolvedAIProviderId;
  observations: number;
  failures: number;
  retries: number;
  elapsedTotal: number;
  costTotal: number;
  costCount: number;
}

export function recommendStageProvider({
  stageKey,
  stageOverrides = {},
  telemetry,
  minObservations = 3,
  maxFailureRate = 0.25,
  maxAverageCostUsd = Number.POSITIVE_INFINITY,
  externalApiAllowed = true,
}: StageRecommendationOptions): StageRecommendationResult {
  const override = stageOverrides[stageKey];
  if (override && override !== "auto") {
    if (override === "deepseek-v4" && !externalApiAllowed) {
      return { provider: "claude-cli", reason: "policy-blocked", observations: 0 };
    }
    return { provider: override, reason: "explicit-override", observations: 0 };
  }

  const stats = summarizeTelemetry(stageKey, telemetry).filter((item) => {
    if (item.observations < minObservations) return false;
    if (item.provider === "deepseek-v4" && !externalApiAllowed) return false;
    const failureRate = item.failures / item.observations;
    if (failureRate > maxFailureRate) return false;
    const averageCost = item.costCount > 0 ? item.costTotal / item.costCount : 0;
    return averageCost <= maxAverageCostUsd;
  });

  if (stats.length === 0) {
    return { provider: "claude-cli", reason: "insufficient-data", observations: 0 };
  }

  const [best] = stats.sort((a, b) => scoreProvider(a) - scoreProvider(b));
  if (!best) return { provider: "claude-cli", reason: "fallback", observations: 0 };
  return { provider: best.provider, reason: "best-telemetry", observations: best.observations };
}

export function summarizeTelemetry(stageKey: AIStageKey, telemetry: ProviderTelemetryEntry[]): ProviderStats[] {
  const grouped = new Map<ResolvedAIProviderId, ProviderStats>();

  for (const entry of telemetry) {
    if (entry.stageKey !== stageKey) continue;
    const stats = grouped.get(entry.resolvedProvider) ?? {
      provider: entry.resolvedProvider,
      observations: 0,
      failures: 0,
      retries: 0,
      elapsedTotal: 0,
      costTotal: 0,
      costCount: 0,
    };

    stats.observations += 1;
    if (entry.status !== "success") stats.failures += 1;
    if (entry.retry) stats.retries += 1;
    stats.elapsedTotal += entry.elapsedMs;
    if (entry.externalCostUsd !== undefined) {
      stats.costTotal += entry.externalCostUsd;
      stats.costCount += 1;
    }
    grouped.set(entry.resolvedProvider, stats);
  }

  return Array.from(grouped.values());
}

function scoreProvider(stats: ProviderStats): number {
  const averageElapsed = stats.elapsedTotal / stats.observations;
  const failureRate = stats.failures / stats.observations;
  const retryRate = stats.retries / stats.observations;
  const averageCost = stats.costCount > 0 ? stats.costTotal / stats.costCount : 0;
  return averageElapsed + failureRate * 100_000 + retryRate * 10_000 + averageCost * 100_000;
}
