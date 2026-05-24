import { describe, expect, it } from "vitest";
import {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  AI_STAGE_KEYS,
  allModelStagesUseDeepSeek,
  createDeepSeekStageOverrides,
  isAIStageKey,
  isImageProviderId,
  isSelectableProviderId,
  isStageProviderId,
  normalizeStageOverrides,
  normalizeStageSkip,
  readAISettings,
  readDefaultProvider,
  readStageOverrides,
  writeAISettings,
} from "../ai/settings";

function createStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(AI_SETTINGS_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("AI settings storage", () => {
  it("defaults to auto when storage is missing or empty", () => {
    expect(readAISettings(undefined)).toEqual(DEFAULT_AI_SETTINGS);
    expect(readDefaultProvider(createStorage())).toBe("auto");
    expect(readStageOverrides(createStorage())).toEqual({});
  });

  it("reads a stored selectable default provider (new IDs)", () => {
    expect(readDefaultProvider(createStorage(JSON.stringify({ defaultProvider: "codex-cli" })))).toBe("codex-cli");
    expect(readDefaultProvider(createStorage(JSON.stringify({ defaultProvider: "claude-sdk" })))).toBe("claude-sdk");
    expect(readDefaultProvider(createStorage(JSON.stringify({ defaultProvider: "openai-sdk" })))).toBe("openai-sdk");
  });

  it("migrates legacy 'codex' → 'codex-cli' and 'claude' → 'claude-cli' from storage", () => {
    expect(readDefaultProvider(createStorage(JSON.stringify({ defaultProvider: "codex" })))).toBe("codex-cli");
    expect(readDefaultProvider(createStorage(JSON.stringify({ defaultProvider: "claude" })))).toBe("claude-cli");
  });

  it("falls back to auto for hidden or invalid providers", () => {
    expect(readDefaultProvider(createStorage(JSON.stringify({ defaultProvider: "deepseek-v4" })))).toBe("auto");
    expect(readDefaultProvider(createStorage("{bad json"))).toBe("auto");
  });

  it("writes normalized settings", () => {
    const storage = createStorage();
    expect(writeAISettings({ defaultProvider: "claude-cli", stageOverrides: {}, imageProvider: "codex-cli", figureRegen: true, imageCleaningEnabled: true, checkerMaxAttempts: 2, verifierMaxAttempts: 3, stageSkip: {} }, storage)).toEqual({
      defaultProvider: "claude-cli",
      stageOverrides: {},
      imageProvider: "codex-cli",
      figureRegen: true,
      imageCleaningEnabled: true,
      checkerMaxAttempts: 2,
      verifierMaxAttempts: 3,
      stageSkip: {},
    });
    expect(readDefaultProvider(storage)).toBe("claude-cli");
  });

  it("exposes image providers and defaults invalid values to gemini", () => {
    expect(isImageProviderId("gemini")).toBe(true);
    expect(isImageProviderId("codex-cli")).toBe(true);
    expect(isImageProviderId("openai-sdk")).toBe(false);

    const valid = createStorage(JSON.stringify({ imageProvider: "codex-cli" }));
    expect(readAISettings(valid).imageProvider).toBe("codex-cli");

    const invalid = createStorage(JSON.stringify({ imageProvider: "unknown" }));
    expect(readAISettings(invalid).imageProvider).toBe("gemini");
  });

  it("exposes auto, claude-cli, claude-sdk, codex-cli, openai-sdk as selectable providers", () => {
    expect(isSelectableProviderId("auto")).toBe(true);
    expect(isSelectableProviderId("claude-cli")).toBe(true);
    expect(isSelectableProviderId("claude-sdk")).toBe(true);
    expect(isSelectableProviderId("codex-cli")).toBe(true);
    expect(isSelectableProviderId("openai-sdk")).toBe(true);
    expect(isSelectableProviderId("deepseek-v4")).toBe(false);
  });

  it("accepts legacy 'claude' and 'codex' as selectable (backward-compat)", () => {
    expect(isSelectableProviderId("claude")).toBe(true);
    expect(isSelectableProviderId("codex")).toBe(true);
  });

  it("normalizes stage override keys and providers", () => {
    expect(AI_STAGE_KEYS).toEqual(["create.extractor", "create.solver", "create.verifier"]);
    expect(isAIStageKey("create.extractor")).toBe(true);
    expect(isAIStageKey("create.writer")).toBe(false);
    expect(isStageProviderId("deepseek-v4")).toBe(true);
    expect(normalizeStageOverrides({
      "create.extractor": "deepseek-v4",
      "create.writer": "deepseek-v4",
      "create.unknown": "unknown",
      "create.verifier": "codex-cli",
    })).toEqual({
      "create.extractor": "deepseek-v4",
      "create.verifier": "codex-cli",
    });
  });

  it("migrates legacy stage overrides from 'codex' → 'codex-cli'", () => {
    expect(normalizeStageOverrides({
      "create.extractor": "deepseek-v4",
      "create.writer": "deepseek-v4",
      "create.unknown": "unknown",
      "create.verifier": "codex",
    })).toEqual({
      "create.extractor": "deepseek-v4",
      "create.verifier": "codex-cli",
    });
  });

  it("creates DeepSeek overrides only for text-only model-call stages", () => {
    // DeepSeek V4 (preview)는 이미지 입력 미지원 → create.extractor 제외
    expect(createDeepSeekStageOverrides()).toEqual({
      "create.solver": "deepseek-v4",
      "create.verifier": "deepseek-v4",
    });
    expect(allModelStagesUseDeepSeek(createDeepSeekStageOverrides())).toBe(true);
    expect(normalizeStageOverrides({
      ...createDeepSeekStageOverrides(),
      builder: "deepseek-v4",
      checker: "deepseek-v4",
      cropper: "deepseek-v4",
    })).toEqual(createDeepSeekStageOverrides());
  });

  it("reads and writes stage overrides with the same payload", () => {
    const storage = createStorage();
    writeAISettings({
      defaultProvider: "auto",
      stageOverrides: {
        "create.verifier": "deepseek-v4",
      },
      imageProvider: "gemini",
      figureRegen: true,
      imageCleaningEnabled: true,
      checkerMaxAttempts: 2,
      verifierMaxAttempts: 3,
      stageSkip: {},
    }, storage);

    expect(readAISettings(storage)).toEqual({
      defaultProvider: "auto",
      stageOverrides: {
        "create.verifier": "deepseek-v4",
      },
      imageProvider: "gemini",
      figureRegen: true,
      imageCleaningEnabled: true,
      checkerMaxAttempts: 2,
      verifierMaxAttempts: 3,
      stageSkip: {},
    });
  });

  it("normalizes verifierMaxAttempts to 0~5 range (default 3)", () => {
    expect(writeAISettings({ ...DEFAULT_AI_SETTINGS, verifierMaxAttempts: -1 }).verifierMaxAttempts).toBe(0);
    expect(writeAISettings({ ...DEFAULT_AI_SETTINGS, verifierMaxAttempts: 10 }).verifierMaxAttempts).toBe(5);
    expect(writeAISettings({ ...DEFAULT_AI_SETTINGS, verifierMaxAttempts: 2 }).verifierMaxAttempts).toBe(2);
  });

  it("syncs stageSkip['create.verifier'] with verifierMaxAttempts === 0", () => {
    const offResult = writeAISettings({ ...DEFAULT_AI_SETTINGS, verifierMaxAttempts: 0 });
    expect(offResult.stageSkip["create.verifier"]).toBe(true);
    const onResult = writeAISettings({ ...DEFAULT_AI_SETTINGS, verifierMaxAttempts: 3, stageSkip: { "create.verifier": true } });
    expect(onResult.stageSkip["create.verifier"]).toBeUndefined();
  });

  it("migrates legacy stageSkip['create.verifier'] = true → verifierMaxAttempts = 0", () => {
    const storage = createStorage(JSON.stringify({ stageSkip: { "create.verifier": true } }));
    expect(readAISettings(storage).verifierMaxAttempts).toBe(0);
  });

  it("normalizes checkerMaxAttempts to 0~5 range", () => {
    // Test clamping
    expect(writeAISettings({ ...DEFAULT_AI_SETTINGS, checkerMaxAttempts: -1 })).toEqual({
      ...DEFAULT_AI_SETTINGS,
      checkerMaxAttempts: 0,
    });
    expect(writeAISettings({ ...DEFAULT_AI_SETTINGS, checkerMaxAttempts: 10 })).toEqual({
      ...DEFAULT_AI_SETTINGS,
      checkerMaxAttempts: 5,
    });
    // Test valid range
    expect(writeAISettings({ ...DEFAULT_AI_SETTINGS, checkerMaxAttempts: 3 })).toEqual({
      ...DEFAULT_AI_SETTINGS,
      checkerMaxAttempts: 3,
    });
  });

  it("applies default checkerMaxAttempts when legacy settings lack the field", () => {
    const storage = createStorage(JSON.stringify({
      defaultProvider: "auto",
      stageOverrides: {},
      imageProvider: "gemini",
      figureRegen: true,
      // checkerMaxAttempts missing
    }));
    expect(readAISettings(storage)).toEqual({
      defaultProvider: "auto",
      stageOverrides: {},
      imageProvider: "gemini",
      figureRegen: true,
      imageCleaningEnabled: true,
      checkerMaxAttempts: 2,
      verifierMaxAttempts: 3,
      stageSkip: {},
    });
  });

  it("rounds checkerMaxAttempts to nearest integer", () => {
    expect(writeAISettings({ ...DEFAULT_AI_SETTINGS, checkerMaxAttempts: 2.7 })).toEqual({
      ...DEFAULT_AI_SETTINGS,
      checkerMaxAttempts: 3,
    });
    expect(writeAISettings({ ...DEFAULT_AI_SETTINGS, checkerMaxAttempts: 2.3 })).toEqual({
      ...DEFAULT_AI_SETTINGS,
      checkerMaxAttempts: 2,
    });
  });

  it("stageSkip defaults to {} and round-trips through read/write (synced with verifierMaxAttempts)", () => {
    // Default stageSkip is empty
    expect(DEFAULT_AI_SETTINGS.stageSkip).toEqual({});
    // 직접 stageSkip["create.verifier"]=true 를 쓰더라도 verifierMaxAttempts=0 이 아니면 sync 로 제거된다.
    const storage = createStorage();
    writeAISettings({ ...DEFAULT_AI_SETTINGS, stageSkip: { "create.verifier": true } }, storage);
    expect(readAISettings(storage)).toEqual({
      ...DEFAULT_AI_SETTINGS,
      stageSkip: {},
    });
    // verifierMaxAttempts=0 으로 쓰면 stageSkip["create.verifier"]=true 가 동기화된다.
    writeAISettings({ ...DEFAULT_AI_SETTINGS, verifierMaxAttempts: 0 }, storage);
    expect(readAISettings(storage)).toEqual({
      ...DEFAULT_AI_SETTINGS,
      verifierMaxAttempts: 0,
      stageSkip: { "create.verifier": true },
    });
  });

  it("normalizeStageSkip filters unknown stageKeys and coerces values to boolean", () => {
    expect(normalizeStageSkip({
      "create.verifier": true,
      "create.solver": false,
      "unknown.stage": true,
      "create.extractor": 1,
    })).toEqual({
      "create.verifier": true,
      "create.solver": false,
      "create.extractor": true,
    });
  });

  it("normalizeStageSkip returns {} for non-object inputs", () => {
    expect(normalizeStageSkip(null)).toEqual({});
    expect(normalizeStageSkip(undefined)).toEqual({});
    expect(normalizeStageSkip("string")).toEqual({});
    expect(normalizeStageSkip([])).toEqual({});
  });

  it("legacy settings without stageSkip field migrate to default {}", () => {
    const storage = createStorage(JSON.stringify({
      defaultProvider: "auto",
      stageOverrides: {},
      imageProvider: "gemini",
      figureRegen: true,
      checkerMaxAttempts: 2,
      // stageSkip missing — legacy
    }));
    expect(readAISettings(storage)).toEqual({
      ...DEFAULT_AI_SETTINGS,
      stageSkip: {},
    });
  });
});
