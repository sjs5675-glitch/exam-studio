import { claudeCliProvider } from "./providers/claudeCli";
import { claudeSdkProvider } from "./providers/claudeSdk";
import { codexCliProvider } from "./providers/codexCli";
import { openaiSdkProvider } from "./providers/openaiSdk";
import { deepseekV4Provider } from "./providers/deepseekV4";
import type {
  AIProviderAdapter,
  AIProviderId,
  ProviderRunResult,
  ProviderSelectionRunOptions,
  ResolvedAIProviderId,
} from "./types";

const providers = new Map<ResolvedAIProviderId, AIProviderAdapter>([
  [claudeCliProvider.id, claudeCliProvider],
  [claudeSdkProvider.id, claudeSdkProvider],
  [codexCliProvider.id, codexCliProvider],
  [openaiSdkProvider.id, openaiSdkProvider],
  [deepseekV4Provider.id, deepseekV4Provider],
]);

const providerIds = new Set<AIProviderId>([
  "auto",
  "claude-cli",
  "claude-sdk",
  "codex-cli",
  "openai-sdk",
  "deepseek-v4",
  // Backward-compat aliases (old storage values)
  "claude" as AIProviderId,
  "codex" as AIProviderId,
]);

/** backward-compat: "claude" → "claude-cli", "codex" → "codex-cli" */
const legacyAliases: Partial<Record<string, ResolvedAIProviderId>> = {
  claude: "claude-cli",
  codex: "codex-cli",
};

export function normalizeProviderId(provider: unknown): AIProviderId {
  if (provider === undefined || provider === null || provider === "") return "auto";
  if (typeof provider === "string") {
    // Migrate legacy stored values
    if (legacyAliases[provider]) {
      return legacyAliases[provider] as AIProviderId;
    }
    if (providerIds.has(provider as AIProviderId)) {
      return provider as AIProviderId;
    }
  }
  throw new Error(`Invalid AI provider: ${String(provider)}`);
}

export function resolveProviderId(provider: AIProviderId = "auto"): ResolvedAIProviderId {
  if (provider === "auto") return "claude-cli";
  if (providers.has(provider as ResolvedAIProviderId)) return provider as ResolvedAIProviderId;
  throw new Error(`AI provider is not registered yet: ${provider}`);
}

export function getProviderAdapter(provider: AIProviderId = "auto"): AIProviderAdapter {
  return providers.get(resolveProviderId(provider)) ?? claudeCliProvider;
}

export function listProviderAdapters(): AIProviderAdapter[] {
  return Array.from(providers.values());
}

export function runAIProvider(prompt: string, options?: ProviderSelectionRunOptions): ProviderRunResult {
  const requestedProvider = normalizeProviderId(options?.provider);
  const adapter = getProviderAdapter(requestedProvider);
  const result = adapter.run(prompt, options);

  return {
    ...result,
    metadata: {
      ...result.metadata,
      requestedProvider,
      provider: adapter.id,
    },
  };
}

export { claudeCliProvider, claudeSdkProvider, codexCliProvider, openaiSdkProvider, deepseekV4Provider };
