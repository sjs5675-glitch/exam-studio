import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readRuntimeEnv, type RuntimeEnvMap } from "@/lib/server/runtimeEnv";

type TestProvider = "deepseek" | "gemini" | "claude" | "openai";

interface TestBody {
  provider?: TestProvider;
  values?: Record<string, unknown>;
}

interface DeepSeekModelsResponse {
  data?: Array<{ id?: string }>;
  error?: { message?: string };
}

interface GeminiModelsResponse {
  models?: Array<{ name?: string }>;
  error?: { message?: string };
}

const TEST_TIMEOUT_MS = 15_000;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => undefined) as TestBody | undefined;
  const provider = body?.provider;

  if (provider !== "deepseek" && provider !== "gemini" && provider !== "claude" && provider !== "openai") {
    return NextResponse.json({ ok: false, message: "provider is required" }, { status: 400 });
  }

  const env = mergeRuntimeEnv(body?.values);
  const result =
    provider === "deepseek" ? await testDeepSeek(env) :
    provider === "gemini" ? await testGemini(env) :
    provider === "claude" ? await testClaude(env) :
    await testOpenAI(env);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

const MERGEABLE_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_API_BASE_URL",
  "DEEPSEEK_MODEL",
  "GEMINI_API_KEY",
]);

function mergeRuntimeEnv(values: TestBody["values"]): RuntimeEnvMap {
  const env = { ...readRuntimeEnv() };
  if (!values) return env;

  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed && key.endsWith("_API_KEY")) continue;
    if (MERGEABLE_ENV_KEYS.has(key)) {
      env[key as keyof RuntimeEnvMap] = trimmed;
    }
  }

  return env;
}

async function testDeepSeek(env: RuntimeEnvMap): Promise<{ ok: boolean; message: string; detail?: string }> {
  const apiKey = env.DEEPSEEK_API_KEY;
  const baseUrl = env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com";
  const model = env.DEEPSEEK_MODEL || "deepseek-v4-pro";

  if (!apiKey) {
    return { ok: false, message: "DeepSeek API key가 없습니다." };
  }

  const response = await fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await readJsonSafely<DeepSeekModelsResponse>(response);

  if (!response.ok) {
    return {
      ok: false,
      message: "DeepSeek 연결 실패",
      detail: formatProviderError(response.status, body?.error?.message),
    };
  }

  const modelIds = body?.data?.map((item) => item.id).filter(Boolean) ?? [];
  if (modelIds.length > 0 && !modelIds.includes(model)) {
    return {
      ok: false,
      message: "DeepSeek 키는 유효하지만 모델명을 확인해야 합니다.",
      detail: `${model} 모델이 목록에 없습니다.`,
    };
  }

  return { ok: true, message: "DeepSeek 연결 성공" };
}

async function testGemini(env: RuntimeEnvMap): Promise<{ ok: boolean; message: string; detail?: string }> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "Gemini API key가 없습니다." };
  }

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  const body = await readJsonSafely<GeminiModelsResponse>(response);

  if (!response.ok) {
    return {
      ok: false,
      message: "Gemini 연결 실패",
      detail: formatProviderError(response.status, body?.error?.message),
    };
  }

  return { ok: true, message: "Gemini 연결 성공" };
}

async function testClaude(env: RuntimeEnvMap): Promise<{ ok: boolean; message: string; detail?: string }> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "ANTHROPIC_API_KEY가 없습니다." };
  }

  try {
    const client = new Anthropic({ apiKey, timeout: TEST_TIMEOUT_MS });
    await client.messages.create({
      model: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, message: "Claude SDK 연결 성공" };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
    return { ok: false, message: "Claude SDK 연결 실패", detail: message };
  }
}

async function testOpenAI(env: RuntimeEnvMap): Promise<{ ok: boolean; message: string; detail?: string }> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "OPENAI_API_KEY가 없습니다." };
  }

  try {
    const client = new OpenAI({ apiKey, timeout: TEST_TIMEOUT_MS });
    await client.chat.completions.create({
      model: env.OPENAI_MODEL ?? "gpt-4o-mini",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, message: "OpenAI SDK 연결 성공" };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
    return { ok: false, message: "OpenAI SDK 연결 실패", detail: message };
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonSafely<T>(response: Response): Promise<T | undefined> {
  try {
    return await response.json() as T;
  } catch {
    return undefined;
  }
}

function formatProviderError(status: number, message?: string): string {
  return [`HTTP ${status}`, message?.slice(0, 200)].filter(Boolean).join(" · ");
}
