import type { AIProviderId, AIStageKey } from "./types";

export type ImageProviderId = "gemini" | "codex-cli";
export type SelectableProviderId = Extract<
  AIProviderId,
  "auto" | "claude-cli" | "claude-sdk" | "codex-cli" | "openai-sdk"
>;
export type StageProviderId = AIProviderId;
export type StageOverrideMap = Partial<Record<AIStageKey, StageProviderId>>;
export type StageSkipMap = Partial<Record<AIStageKey, boolean>>;

export const AI_SETTINGS_STORAGE_KEY = "exam-studio.ai-settings";
export const AI_STAGE_KEYS: AIStageKey[] = [
  "create.extractor",
  "create.solver",
  "create.verifier",
];
// DeepSeek V4 (preview)는 이미지 입력 미지원이라 extractor는 제외한다.
// vision 출시 후 AI_STAGE_KEYS로 되돌릴 것.
export const DEEPSEEK_MODEL_STAGE_KEYS: AIStageKey[] = [
  "create.solver",
  "create.verifier",
];
export const DEFAULT_AI_SETTINGS: AISettings = {
  defaultProvider: "codex-cli",
  stageOverrides: {},
  imageProvider: "codex-cli",
  figureRegen: true,
  imageCleaningEnabled: true,
  checkerMaxAttempts: 2,
  verifierMaxAttempts: 3,
  stageSkip: {},
};

export interface AISettings {
  defaultProvider: SelectableProviderId;
  stageOverrides: StageOverrideMap;
  /** 그림/이미지 정리 단계에서 사용할 이미지 생성 provider. */
  imageProvider: ImageProviderId;
  /** Gemini(nano-banana)로 그림을 재생성할지 여부. false면 crop만. */
  figureRegen: boolean;
  /** nano-banana로 문제 이미지의 손글씨/필기 흔적을 정리할지 여부. false면 원본 그대로 사용. */
  imageCleaningEnabled: boolean;
  /** checker auto-fix 시도 최대 횟수. 0 = 검사만, 기본 2. 범위 0~5. */
  checkerMaxAttempts: number;
  /** verifier 재시도 최대 횟수. 0 = verifier 단계 스킵, 기본 3. 범위 0~5. */
  verifierMaxAttempts: number;
  /** stage별 스킵 플래그. 현재는 create.verifier만 의미 있음 (legacy — verifierMaxAttempts === 0 와 동등). */
  stageSkip: StageSkipMap;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** backward-compat: legacy stored provider strings → new IDs */
const legacySelectableAliases: Partial<Record<string, SelectableProviderId>> = {
  claude: "claude-cli",
  codex: "codex-cli",
};

const legacyStageAliases: Partial<Record<string, StageProviderId>> = {
  claude: "claude-cli",
  codex: "codex-cli",
};

const selectableProviders = new Set<SelectableProviderId>([
  "auto",
  "claude-cli",
  "claude-sdk",
  "codex-cli",
  "openai-sdk",
]);

const stageProviders = new Set<StageProviderId>([
  "auto",
  "claude-cli",
  "claude-sdk",
  "codex-cli",
  "openai-sdk",
  "deepseek-v4",
]);

const stageKeys = new Set<AIStageKey>(AI_STAGE_KEYS);
const imageProviders = new Set<ImageProviderId>(["gemini", "codex-cli"]);

export function isSelectableProviderId(value: unknown): value is SelectableProviderId {
  if (typeof value !== "string") return false;
  // Accept legacy aliases
  if (legacySelectableAliases[value]) return true;
  return selectableProviders.has(value as SelectableProviderId);
}

export function isStageProviderId(value: unknown): value is StageProviderId {
  if (typeof value !== "string") return false;
  if (legacyStageAliases[value]) return true;
  return stageProviders.has(value as StageProviderId);
}

export function isAIStageKey(value: unknown): value is AIStageKey {
  return typeof value === "string" && stageKeys.has(value as AIStageKey);
}

/** Normalize a SelectableProviderId, migrating legacy values */
function normalizeSelectableProviderId(value: unknown): SelectableProviderId {
  if (typeof value !== "string") return DEFAULT_AI_SETTINGS.defaultProvider;
  const migrated = legacySelectableAliases[value];
  if (migrated) return migrated;
  if (selectableProviders.has(value as SelectableProviderId)) {
    return value as SelectableProviderId;
  }
  return DEFAULT_AI_SETTINGS.defaultProvider;
}

/** Normalize a StageProviderId, migrating legacy values */
function normalizeStageProviderId(value: unknown): StageProviderId | undefined {
  if (typeof value !== "string") return undefined;
  const migrated = legacyStageAliases[value];
  if (migrated) return migrated;
  if (stageProviders.has(value as StageProviderId)) {
    return value as StageProviderId;
  }
  return undefined;
}

export function isImageProviderId(value: unknown): value is ImageProviderId {
  return typeof value === "string" && imageProviders.has(value as ImageProviderId);
}

function normalizeImageProviderId(value: unknown): ImageProviderId {
  if (isImageProviderId(value)) return value;
  return DEFAULT_AI_SETTINGS.imageProvider;
}

export function normalizeStageOverrides(value: unknown): StageOverrideMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: StageOverrideMap = {};
  for (const [stageKey, provider] of Object.entries(value)) {
    if (!isAIStageKey(stageKey)) continue;
    const normalizedProvider = normalizeStageProviderId(provider);
    if (normalizedProvider) {
      normalized[stageKey] = normalizedProvider;
    }
  }
  return normalized;
}

export function normalizeStageSkip(value: unknown): StageSkipMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: StageSkipMap = {};
  for (const [key, val] of Object.entries(value)) {
    if (!isAIStageKey(key)) continue;
    normalized[key] = Boolean(val);
  }
  return normalized;
}

/** Normalize checkerMaxAttempts to 0~5 range, default to 2 if invalid */
function normalizeCheckerMaxAttempts(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_AI_SETTINGS.checkerMaxAttempts;
  return Math.max(0, Math.min(5, Math.round(n)));
}

/** Normalize verifierMaxAttempts to 0~5 range, default to 3 if invalid. 0 = skip verifier. */
function normalizeVerifierMaxAttempts(value: unknown, fallback?: boolean): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    // legacy 마이그레이션: stageSkip["create.verifier"] === true 였던 사용자는 0 으로 이관
    return fallback ? 0 : DEFAULT_AI_SETTINGS.verifierMaxAttempts;
  }
  return Math.max(0, Math.min(5, Math.round(n)));
}

export function createDeepSeekStageOverrides(): StageOverrideMap {
  return Object.fromEntries(
    DEEPSEEK_MODEL_STAGE_KEYS.map((stageKey) => [stageKey, "deepseek-v4"])
  ) as StageOverrideMap;
}

export function allModelStagesUseDeepSeek(stageOverrides: StageOverrideMap): boolean {
  return DEEPSEEK_MODEL_STAGE_KEYS.every((stageKey) => stageOverrides[stageKey] === "deepseek-v4");
}

export function readAISettings(storage = getBrowserStorage()): AISettings {
  if (!storage) return DEFAULT_AI_SETTINGS;

  try {
    const raw = storage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AISettings>;
    const stageSkip = normalizeStageSkip(parsed.stageSkip);
    return {
      defaultProvider: normalizeSelectableProviderId(parsed.defaultProvider),
      stageOverrides: normalizeStageOverrides(parsed.stageOverrides),
      imageProvider: normalizeImageProviderId(parsed.imageProvider),
      figureRegen: parsed.figureRegen !== false,
      imageCleaningEnabled: parsed.imageCleaningEnabled !== false,
      checkerMaxAttempts: normalizeCheckerMaxAttempts(parsed.checkerMaxAttempts),
      verifierMaxAttempts: normalizeVerifierMaxAttempts(
        parsed.verifierMaxAttempts,
        stageSkip["create.verifier"] === true,
      ),
      stageSkip,
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function writeAISettings(settings: AISettings, storage = getBrowserStorage()): AISettings {
  const verifierMaxAttempts = normalizeVerifierMaxAttempts(settings.verifierMaxAttempts);
  const stageSkip = normalizeStageSkip(settings.stageSkip);
  // verifierMaxAttempts === 0 일 때 stageSkip 도 동기화 (legacy 호환 + orchestrator 양방향 일관성)
  if (verifierMaxAttempts === 0) stageSkip["create.verifier"] = true;
  else delete stageSkip["create.verifier"];

  const normalized: AISettings = {
    defaultProvider: normalizeSelectableProviderId(settings.defaultProvider),
    stageOverrides: normalizeStageOverrides(settings.stageOverrides),
    imageProvider: normalizeImageProviderId(settings.imageProvider),
    figureRegen: settings.figureRegen !== false,
    imageCleaningEnabled: settings.imageCleaningEnabled !== false,
    checkerMaxAttempts: normalizeCheckerMaxAttempts(settings.checkerMaxAttempts),
    verifierMaxAttempts,
    stageSkip,
  };

  storage?.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function readDefaultProvider(storage = getBrowserStorage()): SelectableProviderId {
  return readAISettings(storage).defaultProvider;
}

export function readStageOverrides(storage = getBrowserStorage()): StageOverrideMap {
  return readAISettings(storage).stageOverrides;
}

function getBrowserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
