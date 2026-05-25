import { describe, expect, it } from "vitest";
import {
  claudeCliProvider,
  claudeSdkProvider,
  codexCliProvider,
  openaiSdkProvider,
  deepseekV4Provider,
  getProviderAdapter,
  listProviderAdapters,
  normalizeProviderId,
  resolveProviderId,
} from "../ai";

describe("AI provider registry", () => {
  it("resolves auto to codex-cli (recommended default engine)", () => {
    expect(resolveProviderId()).toBe("codex-cli");
    expect(resolveProviderId("auto")).toBe("codex-cli");
  });

  it("normalizes missing provider requests to auto", () => {
    expect(normalizeProviderId(undefined)).toBe("auto");
    expect(normalizeProviderId(null)).toBe("auto");
    expect(normalizeProviderId("")).toBe("auto");
  });

  it("rejects invalid provider request values", () => {
    expect(() => normalizeProviderId("unknown-provider")).toThrow("Invalid AI provider: unknown-provider");
    expect(() => normalizeProviderId(1)).toThrow("Invalid AI provider: 1");
  });

  it("normalizes legacy 'claude' and 'codex' to new IDs (backward-compat)", () => {
    expect(normalizeProviderId("claude")).toBe("claude-cli");
    expect(normalizeProviderId("codex")).toBe("codex-cli");
  });

  it("returns the Codex CLI adapter for auto, and Claude CLI for claude-cli", () => {
    expect(getProviderAdapter("auto")).toBe(codexCliProvider);
    expect(getProviderAdapter("claude-cli")).toBe(claudeCliProvider);
  });

  it("returns the Claude SDK adapter when claude-sdk is requested", () => {
    expect(resolveProviderId("claude-sdk")).toBe("claude-sdk");
    expect(getProviderAdapter("claude-sdk")).toBe(claudeSdkProvider);
  });

  it("returns the Codex CLI adapter when codex-cli is requested", () => {
    expect(resolveProviderId("codex-cli")).toBe("codex-cli");
    expect(getProviderAdapter("codex-cli")).toBe(codexCliProvider);
  });

  it("returns the OpenAI SDK adapter when openai-sdk is requested", () => {
    expect(resolveProviderId("openai-sdk")).toBe("openai-sdk");
    expect(getProviderAdapter("openai-sdk")).toBe(openaiSdkProvider);
  });

  it("registers DeepSeek V4 without changing auto resolution", () => {
    expect(resolveProviderId("deepseek-v4")).toBe("deepseek-v4");
    expect(getProviderAdapter("deepseek-v4")).toBe(deepseekV4Provider);
    expect(resolveProviderId("auto")).toBe("codex-cli");
  });

  it("lists all currently registered provider adapters", () => {
    expect(listProviderAdapters().map((provider) => provider.id)).toEqual([
      "claude-cli",
      "claude-sdk",
      "codex-cli",
      "openai-sdk",
      "deepseek-v4",
    ]);
  });
});
