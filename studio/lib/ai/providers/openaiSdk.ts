import { EventEmitter } from "events";
import { readFileSync } from "fs";
import path from "path";
import type { ChildProcess } from "child_process";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import type { ClaudeEvent } from "../../claude";
import { getRuntimeEnvValue } from "../../server/runtimeEnv";
import type { AIProviderAdapter, ProviderRunOptions, ProviderRunResult } from "../types";
import { TOOL_SCHEMAS_OPENAI } from "../tools/schema";
import { executeHostTool } from "../tools/index";
import type { HostToolName } from "../tools/index";

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MAX_TURNS = 5;

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
  return { type: "result", subtype: status, result };
}

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildContentParts(prompt: string, imagePaths?: string[]): OpenAIContentPart[] {
  const parts: OpenAIContentPart[] = [];

  for (const imgPath of imagePaths ?? []) {
    try {
      const data = readFileSync(imgPath).toString("base64");
      parts.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${data}` },
      });
    } catch {
      // 이미지 파일 읽기 실패 시 무시 (텍스트만으로 진행)
    }
  }

  parts.push({ type: "text", text: prompt });
  return parts;
}

/**
 * Resolve the sandbox root for host tool execution.
 * Defaults to the docs/extractor-reference directory relative to the repo root.
 */
function resolveToolContext(options?: ProviderRunOptions): { allowedRoot: string; repoRoot: string } {
  // Use cwd as repo root if provided, otherwise fall back to process.cwd()
  const repoRoot = options?.cwd ?? process.cwd();
  const allowedRoot = path.join(repoRoot, "docs", "extractor-reference");
  return { allowedRoot, repoRoot };
}

async function* runOpenaiSdk(
  prompt: string,
  options: ProviderRunOptions | undefined,
  close: (code: number) => void
): AsyncIterable<ClaudeEvent> {
  const apiKey = getRuntimeEnvValue("OPENAI_API_KEY");
  if (!apiKey) {
    yield resultEvent("error", "OPENAI_API_KEY is not configured.");
    close(1);
    return;
  }

  const model = getRuntimeEnvValue("OPENAI_MODEL") || DEFAULT_MODEL;
  const client = new OpenAI({ apiKey });

  // Filter tool schemas to only allowed tools (or none if allowedTools is empty/undefined)
  const allowedTools = options?.allowedTools;
  const filteredSchemas =
    allowedTools && allowedTools.length > 0
      ? TOOL_SCHEMAS_OPENAI.filter((s) => allowedTools.includes(s.function.name))
      : [];

  const maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS;

  try {
    const content = buildContentParts(prompt, options?.imagePaths);
    const messages: ChatCompletionMessageParam[] = [{ role: "user", content }];

    let turns = 0;

    while (turns < maxTurns) {
      turns++;

      if (options?.signal?.aborted) {
        yield resultEvent("error", "OpenAI SDK request was aborted.");
        close(1);
        return;
      }

      const response = await client.chat.completions.create(
        {
          model,
          max_tokens: DEFAULT_MAX_TOKENS,
          messages,
          ...(filteredSchemas.length > 0 ? { tools: filteredSchemas } : {}),
        },
        { signal: options?.signal }
      );

      const choice = response.choices[0];
      const msg = choice?.message;

      if (!msg) {
        yield resultEvent("error", "OpenAI SDK returned empty choice.");
        close(1);
        return;
      }

      // Append the assistant message to the conversation
      messages.push(msg as ChatCompletionMessageParam);

      // Handle tool_calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          // Only handle standard function tool calls (not custom tool calls)
          if (toolCall.type !== "function") continue;
          const fnToolCall = toolCall as ChatCompletionMessageFunctionToolCall;
          const toolName = fnToolCall.function.name as HostToolName;
          const toolCallId = fnToolCall.id;

          // Emit tool_use event
          let toolInput: Record<string, unknown>;
          try {
            toolInput = JSON.parse(fnToolCall.function.arguments) as Record<string, unknown>;
          } catch {
            toolInput = {};
          }

          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  name: toolName,
                  input: toolInput,
                },
              ],
            },
          };

          // Check if allowedTools permits this tool
          if (allowedTools && !allowedTools.includes(toolName)) {
            const errorContent = `Tool '${toolName}' is not in allowedTools.`;
            yield {
              type: "assistant",
              message: {
                role: "assistant",
                content: [{ type: "tool_result", text: errorContent }],
              },
            };
            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: errorContent,
            });
            continue;
          }

          // Execute the host tool
          const toolCtx = resolveToolContext(options);
          const result = await executeHostTool(toolName, toolInput as never, toolCtx);
          const toolResultContent = result.ok ? result.output : result.error;

          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "tool_result", text: toolResultContent }],
            },
          };

          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: toolResultContent,
          });
        }

        // Continue the loop to get the next model response
        continue;
      }

      // No tool_calls — check finish_reason
      const finishReason = choice.finish_reason;
      const text = msg.content?.trim() ?? "";

      if (finishReason === "stop" || !msg.tool_calls) {
        if (text) {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text }],
            },
          };
          yield resultEvent("success", text);
          close(0);
          return;
        } else {
          yield resultEvent(
            "error",
            `OpenAI SDK returned empty content (finish_reason=${finishReason}).`
          );
          close(1);
          return;
        }
      }
    }

    // maxTurns exceeded
    yield resultEvent(
      "error",
      `OpenAI SDK agentic loop exceeded maxTurns (${maxTurns}).`
    );
    close(1);
  } catch (err) {
    if (options?.signal?.aborted) {
      yield resultEvent("error", "OpenAI SDK request was aborted.");
    } else {
      yield resultEvent("error", err instanceof Error ? err.message : "OpenAI SDK request failed.");
    }
    close(1);
  }
}

export const openaiSdkProvider: AIProviderAdapter = {
  id: "openai-sdk",
  label: "OpenAI SDK",
  supportsTools: true,
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

    options?.signal?.addEventListener("abort", () => close(1));

    return {
      process: proc,
      events: runOpenaiSdk(prompt, options, close),
      exitCode,
      metadata: {
        requestedProvider: "openai-sdk",
        provider: "openai-sdk",
        label: "OpenAI SDK",
      },
    };
  },
};
