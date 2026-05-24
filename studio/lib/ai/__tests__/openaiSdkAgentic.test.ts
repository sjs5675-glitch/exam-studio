/**
 * Unit tests for openaiSdk.ts — Chat Completions agentic loop (Phase 3)
 *
 * Uses a mock OpenAI client to simulate API responses without making real calls.
 * Tests:
 *   (a) tool_calls sequence — model calls Read, host executes, model returns final text
 *   (b) allowedTools filtering — tool NOT in allowedTools → error tool_result, loop continues
 *   (c) maxTurns exceeded — model keeps calling tools → result.error
 *   (d) supportsTools=true verification
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClaudeEvent } from "../../claude";

// ---------------------------------------------------------------------------
// Mock openai before importing the provider (hoisted by vitest)
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

// Mock getRuntimeEnvValue to return a fake API key
vi.mock("../../server/runtimeEnv", () => ({
  getRuntimeEnvValue: (key: string) => {
    if (key === "OPENAI_API_KEY") return "sk-test-fake-key";
    if (key === "OPENAI_MODEL") return "gpt-4o";
    return undefined;
  },
}));

// Mock executeHostTool so we don't need a real filesystem sandbox
vi.mock("../tools/index", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tools/index")>();
  return {
    ...original,
    executeHostTool: vi.fn().mockResolvedValue({ ok: true, output: "mocked tool output" }),
  };
});

// Import after mocks are set up
import { openaiSdkProvider } from "../providers/openaiSdk";
import { executeHostTool } from "../tools/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collectEvents(
  prompt: string,
  options?: Parameters<typeof openaiSdkProvider.run>[1]
): Promise<ClaudeEvent[]> {
  const result = openaiSdkProvider.run(prompt, options);
  const events: ClaudeEvent[] = [];
  for await (const event of result.events) {
    events.push(event);
  }
  return events;
}

/** Build a mock OpenAI chat completion response with final text */
function mockTextCompletion(text: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
          tool_calls: undefined,
          refusal: null,
        },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

/** Build a mock OpenAI response that includes a function tool_call */
function mockToolCallCompletion(
  toolName: string,
  toolArgs: Record<string, unknown>,
  callId: string
) {
  return {
    id: "chatcmpl-tool",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: callId,
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify(toolArgs),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("openaiSdkProvider — supportsTools flag", () => {
  it("(d) supportsTools is true after Phase 3 implementation", () => {
    expect(openaiSdkProvider.supportsTools).toBe(true);
  });
});

describe("openaiSdkProvider — agentic loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(a) tool_calls sequence: model calls Read, host executes, model returns final answer", async () => {
    mockCreate
      .mockResolvedValueOnce(
        mockToolCallCompletion("Read", { path: "docs/extractor-reference/bogi.md" }, "call_1")
      )
      .mockResolvedValueOnce(mockTextCompletion("Final extracted JSON result"));

    const events = await collectEvents("Extract question", {
      allowedTools: ["Read", "Grep", "Glob"],
      maxTurns: 5,
    });

    // executeHostTool should have been called with Read
    expect(executeHostTool).toHaveBeenCalledWith(
      "Read",
      { path: "docs/extractor-reference/bogi.md" },
      expect.objectContaining({ allowedRoot: expect.any(String) })
    );

    // Verify event sequence: tool_use → tool_result → result success
    const toolUseEvents = events.filter(
      (e) => e.type === "assistant" && e.message?.content?.[0]?.type === "tool_use"
    );
    const toolResultEvents = events.filter(
      (e) => e.type === "assistant" && e.message?.content?.[0]?.type === "tool_result"
    );
    const successEvent = events.find((e) => e.type === "result" && e.subtype === "success");

    expect(toolUseEvents).toHaveLength(1);
    expect(toolResultEvents).toHaveLength(1);
    expect(successEvent).toBeDefined();
    expect(successEvent?.result).toBe("Final extracted JSON result");

    // mockCreate should have been called exactly 2 times
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("(b) allowedTools filtering: disallowed tool gets error tool_result, loop continues", async () => {
    mockCreate
      .mockResolvedValueOnce(
        mockToolCallCompletion("Bash", { command: "ls ." }, "call_bash")
      )
      .mockResolvedValueOnce(mockTextCompletion("Understood, Bash is not allowed."));

    const events = await collectEvents("Do something", {
      allowedTools: ["Read"], // Bash is NOT allowed
      maxTurns: 5,
    });

    // executeHostTool should NOT have been called
    expect(executeHostTool).not.toHaveBeenCalled();

    // Should have a tool_result event with "not in allowedTools" message
    const toolResultEvents = events.filter(
      (e) => e.type === "assistant" && e.message?.content?.[0]?.type === "tool_result"
    );
    expect(toolResultEvents).toHaveLength(1);
    expect(toolResultEvents[0]?.message?.content?.[0]?.text).toContain("not in allowedTools");

    // Final result should be success (loop continued after the error tool_result)
    const successEvent = events.find((e) => e.type === "result" && e.subtype === "success");
    expect(successEvent).toBeDefined();
  });

  it("(b2) no allowedTools → no tools key passed to API → 1-shot compatible", async () => {
    mockCreate.mockResolvedValueOnce(mockTextCompletion("Simple 1-shot answer"));

    const events = await collectEvents("Simple question"); // no options → no allowedTools

    // The API call should NOT have a tools key
    const apiCall = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(apiCall.tools).toBeUndefined();

    const successEvent = events.find((e) => e.type === "result" && e.subtype === "success");
    expect(successEvent).toBeDefined();
    expect(successEvent?.result).toBe("Simple 1-shot answer");
  });

  it("(c) maxTurns exceeded returns error result", async () => {
    // Every turn: model requests Read tool (never stops)
    mockCreate.mockResolvedValue(
      mockToolCallCompletion("Read", { path: "a.md" }, "call_inf")
    );
    vi.mocked(executeHostTool).mockResolvedValue({ ok: true, output: "content" });

    const events = await collectEvents("Keep using tools", {
      allowedTools: ["Read"],
      maxTurns: 3,
    });

    const errorEvent = events.find((e) => e.type === "result" && e.subtype === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.result).toContain("maxTurns");

    // Should have called create exactly maxTurns=3 times
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});
