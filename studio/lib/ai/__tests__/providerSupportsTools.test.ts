import { describe, expect, it } from "vitest";
import { claudeCliProvider } from "../providers/claudeCli";
import { codexCliProvider } from "../providers/codexCli";
import { claudeSdkProvider } from "../providers/claudeSdk";
import { openaiSdkProvider } from "../providers/openaiSdk";
import { deepseekV4Provider } from "../providers/deepseekV4";
import type { AIProviderAdapter } from "../types";

describe("AIProviderAdapter.supportsTools capability flag", () => {
  it("claude-cli has supportsTools=true (native Read/Write/Bash agent loop)", () => {
    expect(claudeCliProvider.supportsTools).toBe(true);
  });

  it("codex-cli has supportsTools=true (native tool use via --image / exec)", () => {
    expect(codexCliProvider.supportsTools).toBe(true);
  });

  it("claude-sdk has supportsTools=true (agentic loop with Read/Grep/Glob host tools)", () => {
    expect(claudeSdkProvider.supportsTools).toBe(true);
  });

  it("openai-sdk has supportsTools=true (agentic loop with Read/Grep/Glob host tools)", () => {
    expect(openaiSdkProvider.supportsTools).toBe(true);
  });

  it("deepseek-v4 has supportsTools=false (vision not supported, no tool loop)", () => {
    expect(deepseekV4Provider.supportsTools).toBe(false);
  });

  it("all providers satisfy the AIProviderAdapter interface (supportsTools is boolean)", () => {
    const providers: AIProviderAdapter[] = [
      claudeCliProvider,
      codexCliProvider,
      claudeSdkProvider,
      openaiSdkProvider,
      deepseekV4Provider,
    ];
    for (const p of providers) {
      expect(typeof p.supportsTools).toBe("boolean");
    }
  });
});
