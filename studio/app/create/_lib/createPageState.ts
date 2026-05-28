import type { MetaValue } from "@/components/upload/MetaForm";
import { DEFAULT_EXAM_META } from "@/lib/exam/meta";
import { useJobStore } from "@/lib/store";
import type { AIProviderId, AIStageKey } from "@/lib/ai";
import type { ImageProviderId } from "@/lib/ai/settings";

export type QuestionFigureCacheState = {
  status: "ok" | "failed" | "boundary_uncertain";
  image?: string;
};

export type QuestionCacheStateMap = Record<number, {
  extracted: boolean;
  solved: boolean;
  verified: boolean;
  figure?: QuestionFigureCacheState;
}>;

export type ExistingImages = {
  count: number;
  hasClean: boolean;
  numbers: number[];
  essayNumbers: number[];
  cacheState?: QuestionCacheStateMap;
};

export type BuildStatus = {
  pending: boolean;
  status?: "running" | "retrying" | "fallback" | "success" | "completed" | "failed";
  hwpx_path?: string;
  error?: string;
  retried?: { problem: number; agent: string }[];
  fallback?: boolean;
};

export const AUTO_SPLIT_LS_KEY = "cropper.auto-split-on-upload";
export const AUTO_SPLIT_PROVIDER_LS_KEY = "cropper.auto-split-provider";
export const META_LS_KEY = "create-v4.meta-form";

export function createDefaultMeta(currentYear: number): MetaValue {
  return {
    ...DEFAULT_EXAM_META,
    year: currentYear,
  };
}

export function createYearOptions(currentYear: number): number[] {
  return Array.from({ length: 6 }, (_, i) => currentYear - i);
}

export const PROVIDER_LABEL: Record<AIProviderId, string> = {
  auto: "auto",
  "claude-cli": "Claude CLI",
  "claude-sdk": "Claude SDK",
  "codex-cli": "Codex CLI",
  "openai-sdk": "OpenAI SDK",
  "deepseek-v4": "DeepSeek V4",
};

export const STAGE_LABEL: Record<AIStageKey, string> = {
  "create.extractor": "추출",
  "create.solver": "해설",
  "create.verifier": "검증",
};

export function loadStoredAutoSplitEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(AUTO_SPLIT_LS_KEY) === "true";
  } catch {
    return false;
  }
}

export function loadStoredAutoSplitProvider(): ImageProviderId {
  if (typeof window === "undefined") return "gemini";
  try {
    return localStorage.getItem(AUTO_SPLIT_PROVIDER_LS_KEY) === "codex-cli"
      ? "codex-cli"
      : "gemini";
  } catch {
    return "gemini";
  }
}

export function loadStoredMeta(defaultMeta: MetaValue): MetaValue {
  if (typeof window === "undefined") return defaultMeta;
  try {
    const raw = sessionStorage.getItem(META_LS_KEY);
    return raw ? { ...defaultMeta, ...JSON.parse(raw) } : defaultMeta;
  } catch {
    return defaultMeta;
  }
}

/**
 * 디스크 캐시 상태를 store에 미리 채운다.
 *
 * 1. 모든 qNum에 대해 빈 stub entry를 seed → Navigator가 추출되지 않은 문제도 표시.
 * 2. cacheState가 있으면 그걸 기준으로 존재하는 phase만 fetch.
 *    (없으면 backward-compat: 3 phase 모두 시도)
 * 3. figure는 fetch 없이 cacheState 값을 그대로 사용.
 */
export async function preloadQuestionResultsFromCache(
  qNums: number[],
  cacheState: QuestionCacheStateMap | undefined,
): Promise<void> {
  const store = useJobStore.getState();
  store.seedQuestionResults(qNums);

  const phaseKeys = ["extracted", "solved", "verified"] as const;
  for (const num of qNums) {
    const state = cacheState?.[num];
    for (const phase of phaseKeys) {
      if (state && !state[phase]) continue;
      try {
        const res = await fetch(`/api/v3cache-data?q=${num}&phase=${phase}`);
        if (res.ok) {
          const data = await res.json();
          store.updateQuestionResult(num, phase, data);
        }
      } catch { /* ignore */ }
    }
    if (state?.figure) {
      store.updateQuestionResult(num, "figure", state.figure as unknown as Record<string, unknown>);
    }
  }
}
