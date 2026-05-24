import { readFileSync, writeFileSync } from "fs";
import path from "path";

export const RUNTIME_ENV_PATH = path.join(process.cwd(), ".env.local");

export const RUNTIME_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_API_BASE_URL",
  "DEEPSEEK_MODEL",
  "GEMINI_API_KEY",
] as const;

export type RuntimeEnvKey = (typeof RUNTIME_ENV_KEYS)[number];
export type RuntimeEnvMap = Partial<Record<RuntimeEnvKey, string>>;

const DEFAULT_RUNTIME_ENV: RuntimeEnvMap = {
  ANTHROPIC_MODEL: "claude-sonnet-4-6",
  OPENAI_MODEL: "gpt-4o",
  DEEPSEEK_API_BASE_URL: "https://api.deepseek.com",
  DEEPSEEK_MODEL: "deepseek-v4-pro",
};

export function readRuntimeEnv(): RuntimeEnvMap {
  return {
    ...DEFAULT_RUNTIME_ENV,
    ...pickProcessEnv(),
    ...parseEnvFile(readRuntimeEnvFile()),
  };
}

export function getRuntimeEnvValue(key: RuntimeEnvKey): string | undefined {
  return readRuntimeEnv()[key];
}

export function runtimeEnvStatus(): Record<RuntimeEnvKey, { configured: boolean; value?: string }> {
  const env = readRuntimeEnv();
  return Object.fromEntries(
    RUNTIME_ENV_KEYS.map((key) => [
      key,
      {
        configured: Boolean(env[key]),
        value: key.endsWith("_API_KEY") ? undefined : env[key],
      },
    ])
  ) as Record<RuntimeEnvKey, { configured: boolean; value?: string }>;
}

export function writeRuntimeEnv(updates: RuntimeEnvMap): RuntimeEnvMap {
  const content = readRuntimeEnvFile();
  const current = parseEnvFile(content);
  const next = { ...current };

  for (const key of RUNTIME_ENV_KEYS) {
    if (updates[key] !== undefined) {
      next[key] = updates[key] ?? "";
    }
  }

  writeFileSync(RUNTIME_ENV_PATH, serializeEnvFile(content, next), "utf8");
  return readRuntimeEnv();
}

function pickProcessEnv(): RuntimeEnvMap {
  const picked: RuntimeEnvMap = {};
  for (const key of RUNTIME_ENV_KEYS) {
    if (process.env[key]) picked[key] = process.env[key];
  }
  return picked;
}

function readRuntimeEnvFile(): string {
  if (process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV === "1") return "";
  try {
    return readFileSync(RUNTIME_ENV_PATH, "utf8");
  } catch {
    return "";
  }
}

function parseEnvFile(content: string): RuntimeEnvMap {
  const parsed: RuntimeEnvMap = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1] as RuntimeEnvKey;
    if (!RUNTIME_ENV_KEYS.includes(key)) continue;
    parsed[key] = unquoteEnvValue(match[2] ?? "");
  }

  return parsed;
}

function serializeEnvFile(existingContent: string, values: RuntimeEnvMap): string {
  const seen = new Set<RuntimeEnvKey>();
  const lines = existingContent
    ? existingContent.split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line !== "")
    : ["# Exam Studio local runtime settings. Do not commit real API keys."];

  const updated = lines.map((line) => {
    const match = line.trim().match(/^([A-Z0-9_]+)\s*=/);
    const key = match?.[1] as RuntimeEnvKey | undefined;
    if (!key || !RUNTIME_ENV_KEYS.includes(key)) return line;
    seen.add(key);
    return `${key}=${quoteEnvValue(values[key] ?? DEFAULT_RUNTIME_ENV[key] ?? "")}`;
  });

  for (const key of RUNTIME_ENV_KEYS) {
    if (!seen.has(key)) {
      updated.push(`${key}=${quoteEnvValue(values[key] ?? DEFAULT_RUNTIME_ENV[key] ?? "")}`);
    }
  }

  return `${updated.join("\n")}\n`;
}

function quoteEnvValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  return trimmed;
}
