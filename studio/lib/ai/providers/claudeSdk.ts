import { EventEmitter } from "events";
import { readFileSync } from "fs";
import path from "path";
import type { ChildProcess } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { ClaudeEvent } from "../../claude";
import { getRuntimeEnvValue } from "../../server/runtimeEnv";
import type { AIProviderAdapter, ProviderRunOptions, ProviderRunResult } from "../types";
import { TOOL_SCHEMAS_ANTHROPIC } from "../tools/schema";
import { executeHostTool } from "../tools/index";
import type { HostToolName } from "../tools/index";

const DEFAULT_MODEL = "claude-sonnet-4-6";
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

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
        data: string;
      };
    };

function buildContentBlocks(prompt: string, imagePaths?: string[]): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];

  for (const imgPath of imagePaths ?? []) {
    try {
      const data = readFileSync(imgPath).toString("base64");
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data,
        },
      });
    } catch {
      // 이미지 파일 읽기 실패 시 무시 (텍스트만으로 진행)
    }
  }

  blocks.push({ type: "text", text: prompt });
  return blocks;
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

async function* runClaudeSdk(
  prompt: string,
  options: ProviderRunOptions | undefined,
  close: (code: number) => void
): AsyncIterable<ClaudeEvent> {
  const apiKey = getRuntimeEnvValue("ANTHROPIC_API_KEY");
  if (!apiKey) {
    yield resultEvent("error", "ANTHROPIC_API_KEY is not configured.");
    close(1);
    return;
  }

  const model = getRuntimeEnvValue("ANTHROPIC_MODEL") || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

  // Filter tool schemas to only allowed tools (or none if allowedTools is empty/undefined)
  const allowedTools = options?.allowedTools;
  const filteredSchemas =
    allowedTools && allowedTools.length > 0
      ? TOOL_SCHEMAS_ANTHROPIC.filter((s) => allowedTools.includes(s.name))
      : [];

  const maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS;

  try {
    const content = buildContentBlocks(prompt, options?.imagePaths);
    const messages: MessageParam[] = [{ role: "user", content }];

    let turns = 0;
    let finalText = "";

    while (turns < maxTurns) {
      turns++;

      if (options?.signal?.aborted) {
        yield resultEvent("error", "Claude SDK request was aborted.");
        close(1);
        return;
      }

      const response = await client.messages.create(
        {
          model,
          max_tokens: DEFAULT_MAX_TOKENS,
          messages,
          ...(filteredSchemas.length > 0 ? { tools: filteredSchemas } : {}),
        },
        { signal: options?.signal }
      );

      // Collect text blocks from this turn
      const textBlocks = response.content.filter((b) => b.type === "text");
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

      // Emit text blocks as assistant events
      for (const block of textBlocks) {
        if (block.type === "text" && block.text.trim()) {
          finalText = block.text.trim();
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: finalText }],
            },
          };
        }
      }

      // Append the assistant message to the conversation
      messages.push({ role: "assistant", content: response.content });

      // If there are tool_use blocks, execute them and continue the loop
      if (toolUseBlocks.length > 0) {
        const toolResults: ToolResultBlockParam[] = [];

        for (const block of toolUseBlocks) {
          if (block.type !== "tool_use") continue;

          const toolName = block.name as HostToolName;
          const toolInput = block.input as Record<string, unknown>;
          const toolUseId = block.id;

          // Emit tool_use event
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
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUseId,
              content: errorContent,
              is_error: true,
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

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            content: toolResultContent,
            is_error: !result.ok,
          });
        }

        // Append tool results as a user message and continue the loop
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // No tool_use blocks — check stop reason
      if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
        if (finalText) {
          yield resultEvent("success", finalText);
          close(0);
          return;
        } else {
          yield resultEvent(
            "error",
            `Claude SDK returned empty content (stop_reason=${response.stop_reason ?? "unknown"}).`
          );
          close(1);
          return;
        }
      }

      // Other stop reasons (e.g. max_tokens)
      yield resultEvent(
        "error",
        `Claude SDK stopped unexpectedly (stop_reason=${response.stop_reason ?? "unknown"}).`
      );
      close(1);
      return;
    }

    // maxTurns exceeded
    yield resultEvent(
      "error",
      `Claude SDK agentic loop exceeded maxTurns (${maxTurns}).`
    );
    close(1);
  } catch (err) {
    if (options?.signal?.aborted) {
      yield resultEvent("error", "Claude SDK request was aborted.");
    } else {
      yield resultEvent("error", err instanceof Error ? err.message : "Claude SDK request failed.");
    }
    close(1);
  }
}

export const claudeSdkProvider: AIProviderAdapter = {
  id: "claude-sdk",
  label: "Claude SDK",
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
      events: runClaudeSdk(prompt, options, close),
      exitCode,
      metadata: {
        requestedProvider: "claude-sdk",
        provider: "claude-sdk",
        label: "Claude SDK",
      },
    };
  },
};
