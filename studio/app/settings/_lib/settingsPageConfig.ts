import { AI_STAGE_KEYS, type ImageProviderId, type SelectableProviderId } from "@/lib/ai/settings";
import type { AIProviderId } from "@/lib/ai";

export interface ProviderOption {
  id: SelectableProviderId;
  label: string;
  detail: string;
  resolved: string;
  vision: "supported" | "pending" | "none";
  visionNote: string;
  authNote: string;
  requiredEnvKeys: string[];
  cliKey?: "cli" | "codexCli";
}

export const providerOptions: ProviderOption[] = [
  {
    id: "auto",
    label: "자동 (Codex CLI)",
    detail: "Stage override 미지정 시 권장 기본 엔진인 Codex CLI로 실행합니다.",
    resolved: "Codex CLI",
    vision: "pending",
    visionNote: "vision 지원 (Codex v0.115+)",
    authNote: "codex 설치 및 인증 필요",
    requiredEnvKeys: [],
    cliKey: "codexCli",
  },
  {
    id: "claude-cli",
    label: "Claude CLI",
    detail: "기존 stream-json 기반 workflow를 그대로 사용합니다.",
    resolved: "Claude CLI",
    vision: "supported",
    visionNote: "추출 단계 사용 가능",
    authNote: "claude auth login 또는 ANTHROPIC_API_KEY",
    requiredEnvKeys: [],
    cliKey: "cli",
  },
  {
    id: "claude-sdk",
    label: "Claude SDK",
    detail: "Anthropic SDK를 직접 호출합니다. ANTHROPIC_API_KEY가 필요합니다.",
    resolved: "Claude SDK",
    vision: "supported",
    visionNote: "추출 단계 사용 가능",
    authNote: "ANTHROPIC_API_KEY 필요",
    requiredEnvKeys: ["ANTHROPIC_API_KEY"],
  },
  {
    id: "codex-cli",
    label: "Codex CLI (기본)",
    detail: "로컬 Codex CLI provider를 사용합니다. 새 작업의 기본 엔진입니다.",
    resolved: "Codex CLI",
    vision: "pending",
    visionNote: "vision 지원 (Codex v0.115+)",
    authNote: "codex 설치 및 인증 필요",
    requiredEnvKeys: [],
    cliKey: "codexCli",
  },
  {
    id: "openai-sdk",
    label: "OpenAI SDK",
    detail: "OpenAI SDK를 직접 호출합니다. OPENAI_API_KEY가 필요합니다.",
    resolved: "OpenAI SDK",
    vision: "supported",
    visionNote: "추출 단계 사용 가능",
    authNote: "OPENAI_API_KEY 필요",
    requiredEnvKeys: ["OPENAI_API_KEY"],
  },
];

export const stageLabels: Record<(typeof AI_STAGE_KEYS)[number], string> = {
  "create.extractor": "제작 추출",
  "create.solver": "제작 풀이",
  "create.verifier": "제작 검증",
};

export const PROVIDER_LABEL: Record<AIProviderId, string> = {
  auto: "자동",
  "claude-cli": "Claude CLI",
  "claude-sdk": "Claude SDK",
  "codex-cli": "Codex CLI",
  "openai-sdk": "OpenAI SDK",
  "deepseek-v4": "DeepSeek V4",
};

export const IMAGE_PROVIDER_LABEL: Record<ImageProviderId, string> = {
  gemini: "Nano Banana / Gemini",
  "codex-cli": "Codex CLI ImageGen",
};

export const imageProviderOptions: Array<{
  id: ImageProviderId;
  label: string;
  detail: string;
  authNote: string;
  experimental?: boolean;
}> = [
  {
    id: "gemini",
    label: "Nano Banana / Gemini",
    detail: "기존 Gemini 이미지 모델로 손글씨 제거와 figure 재생성을 수행합니다.",
    authNote: "GEMINI_API_KEY 필요",
  },
  {
    id: "codex-cli",
    label: "Codex CLI ImageGen",
    detail: "로컬 Codex CLI의 built-in image generation/editing tool을 실험적으로 사용합니다.",
    authNote: "codex 설치 및 로그인 필요",
    experimental: true,
  },
];

export type SettingsTab = "engine" | "keys";

export interface EnvKeyStatus {
  configured: boolean;
  value?: string;
}

export interface CliStatus {
  available: boolean;
  authenticated?: boolean;
  version: string;
}

export interface StatusResponse {
  cli?: CliStatus;
  codexCli?: CliStatus;
}

export type ApiTestProvider = "deepseek" | "gemini" | "claude" | "openai";

export interface ApiTestState {
  status: "idle" | "running" | "success" | "error";
  message?: string;
}

export const apiKeyFields = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    placeholder: "sk-ant-...",
  },
  {
    key: "ANTHROPIC_MODEL",
    label: "Anthropic Model",
    placeholder: "claude-sonnet-4-6",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    placeholder: "sk-...",
  },
  {
    key: "OPENAI_MODEL",
    label: "OpenAI Model",
    placeholder: "gpt-4o",
  },
  {
    key: "DEEPSEEK_API_KEY",
    label: "DeepSeek API Key",
    placeholder: "sk-...",
  },
  {
    key: "GEMINI_API_KEY",
    label: "Nano Banana / Gemini API Key",
    placeholder: "AIza...",
  },
  {
    key: "DEEPSEEK_API_BASE_URL",
    label: "DeepSeek API Base URL",
    placeholder: "https://api.deepseek.com",
  },
  {
    key: "DEEPSEEK_MODEL",
    label: "DeepSeek Model",
    placeholder: "deepseek-v4-pro",
  },
] as const;
