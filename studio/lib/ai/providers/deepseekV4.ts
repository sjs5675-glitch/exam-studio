import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import type { ClaudeEvent } from "../../claude";
import { getRuntimeEnvValue } from "../../server/runtimeEnv";
import type { AIProviderAdapter, AIStageKey, ProviderRunOptions, ProviderRunResult } from "../types";

// DeepSeek V4 (Pro/Flash) public preview는 이미지 입력을 지원하지 않으므로
// 이미지 기반 extractor는 제외한다. 멀티모달 출시되면 다시 추가.
export const DEEPSEEK_ALLOWED_STAGES: AIStageKey[] = [
  "create.solver",
  "create.verifier",
];

interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    total_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

const DEFAULT_MAX_TOKENS = 8192;

export const DEEPSEEK_STAGE_TIMEOUTS_MS: Record<AIStageKey, number> = {
  "create.extractor": 180_000,
  "create.solver": 300_000,
  "create.verifier": 120_000,
};
// 위 맵은 vision 출시 후 extractor가 재허용될 때를 대비해 유지한다.

const FALLBACK_TIMEOUT_MS = 300_000;

export function resolveDeepSeekTimeoutMs(stageKey: AIStageKey | undefined): number {
  if (stageKey && stageKey in DEEPSEEK_STAGE_TIMEOUTS_MS) {
    return DEEPSEEK_STAGE_TIMEOUTS_MS[stageKey];
  }
  return FALLBACK_TIMEOUT_MS;
}

export function isDeepSeekStageAllowed(stageKey: unknown): stageKey is AIStageKey {
  return typeof stageKey === "string" && DEEPSEEK_ALLOWED_STAGES.includes(stageKey as AIStageKey);
}

export function buildDeepSeekMessages(prompt: string, options?: ProviderRunOptions): DeepSeekMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are running as the DeepSeek V4 external API provider for Exam Studio.",
        "Follow the existing stage instructions exactly and return concise, structured output.",
        `Stage: ${options?.stageKey ?? "unspecified"}`,
      ].join("\n"),
    },
    {
      role: "user",
      content: prompt,
    },
  ];
}

function createVirtualProcess(resolveExitCode: (code: number) => void): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;

  proc.kill = (() => {
    resolveExitCode(1);
    proc.emit("close", 1, null);
    proc.emit("exit", 1, null);
    return true;
  }) as ChildProcess["kill"];
  proc.stderr = null;
  proc.stdout = null;
  proc.stdin = null;
  return proc;
}

function resultEvent(status: "success" | "error", result: string): ClaudeEvent {
  return {
    type: "result",
    subtype: status,
    result,
  };
}

async function* runDeepSeek(prompt: string, options: ProviderRunOptions | undefined, close: (code: number) => void): AsyncIterable<ClaudeEvent> {
  if (!isDeepSeekStageAllowed(options?.stageKey)) {
    const stage = options?.stageKey ?? "unspecified";
    yield resultEvent("error", `DeepSeek V4 is not enabled for stage: ${stage}`);
    close(1);
    return;
  }

  const apiKey = getRuntimeEnvValue("DEEPSEEK_API_KEY");
  const baseUrl = getRuntimeEnvValue("DEEPSEEK_API_BASE_URL") || "https://api.deepseek.com";
  const model = getRuntimeEnvValue("DEEPSEEK_MODEL") || "deepseek-v4-pro";
  if (!apiKey) {
    yield resultEvent("error", "DEEPSEEK_API_KEY is not configured.");
    close(1);
    return;
  }

  const timeoutMs = resolveDeepSeekTimeoutMs(options?.stageKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: buildDeepSeekMessages(prompt, options),
          max_tokens: DEFAULT_MAX_TOKENS,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        yield resultEvent(
          "error",
          `DeepSeek V4 request timed out after ${Math.round(timeoutMs / 1000)}s (stage=${options?.stageKey ?? "unspecified"}).`,
        );
        close(1);
        return;
      }
      throw err;
    }

    if (!response.ok) {
      yield resultEvent("error", `DeepSeek API request failed: ${response.status}`);
      close(1);
      return;
    }

    const json = await response.json() as DeepSeekChatResponse;
    const choice = json.choices?.[0];
    const text = choice?.message?.content?.trim();
    const finishReason = choice?.finish_reason;
    const reasoningTokens = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

    if (text) {
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
        },
      };
    }

    if (!text) {
      const detail = finishReason === "length"
        ? `DeepSeek V4 output truncated by max_tokens (reasoning_tokens=${reasoningTokens}). Increase max_tokens or simplify the prompt.`
        : `DeepSeek V4 returned empty content (finish_reason=${finishReason ?? "unknown"}).`;
      yield resultEvent("error", detail);
      close(1);
      return;
    }

    if (finishReason && finishReason !== "stop") {
      yield resultEvent("error", `DeepSeek V4 finished with reason="${finishReason}". Output may be incomplete.`);
      close(1);
      return;
    }

    yield resultEvent("success", text);
    close(0);
  } catch (err) {
    yield resultEvent("error", err instanceof Error ? err.message : "DeepSeek API request failed.");
    close(1);
  } finally {
    clearTimeout(timer);
  }
}

export const deepseekV4Provider: AIProviderAdapter = {
  id: "deepseek-v4",
  label: "DeepSeek V4 API",
  supportsTools: false,
  run(prompt: string, options?: ProviderRunOptions): ProviderRunResult {
    let resolveExitCode: (code: number) => void = () => undefined;
    let closed = false;
    const exitCode = new Promise<number>((resolve) => {
      resolveExitCode = resolve;
    });
    const proc = createVirtualProcess(resolveExitCode);
    const close = (code: number) => {
      if (closed) return;
      closed = true;
      resolveExitCode(code);
      proc.emit("close", code, null);
      proc.emit("exit", code, null);
    };

    return {
      process: proc,
      events: runDeepSeek(prompt, options, close),
      exitCode,
      metadata: {
        requestedProvider: "deepseek-v4",
        provider: "deepseek-v4",
        label: "DeepSeek V4 API",
      },
    };
  },
};
