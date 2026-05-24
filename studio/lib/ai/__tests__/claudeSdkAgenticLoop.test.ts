/**
 * Unit tests for claudeSdk agentic loop.
 *
 * Uses a mock Anthropic client to simulate API responses without making real calls.
 * Tests: (a) tool_use sequence, (b) allowedTools filtering,
 *        (c) maxTurns exceeded error, (d) supportsTools=true.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClaudeEvent } from "../../claude";

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sdk before importing the provider
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    })),
  };
});

// Mock getRuntimeEnvValue to return a fake API key
vi.mock("../../server/runtimeEnv", () => ({
  getRuntimeEnvValue: (key: string) => {
    if (key === "ANTHROPIC_API_KEY") return "sk-test-fake-key";
    if (key === "ANTHROPIC_MODEL") return "claude-sonnet-4-6";
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
import { claudeSdkProvider } from "../providers/claudeSdk";
import { executeHostTool } from "../tools/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all events from the provider run result into an array */
async function collectEvents(
  prompt: string,
  options?: Parameters<typeof claudeSdkProvider.run>[1]
): Promise<ClaudeEvent[]> {
  const result = claudeSdkProvider.run(prompt, options);
  const events: ClaudeEvent[] = [];
  for await (const event of result.events) {
    events.push(event);
  }
  return events;
}

/** Build a mock Anthropic messages.create response with a final text answer */
function mockTextResponse(text: string) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
    content: [{ type: "text", text }],
  };
}

/** Build a mock response that asks for a tool_use, then a follow-up text response */
function mockToolUseResponse(toolName: string, toolInput: Record<string, unknown>, toolUseId: string) {
  return {
    id: "msg_tool",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 30 },
    content: [
      { type: "tool_use", id: toolUseId, name: toolName, input: toolInput },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("claudeSdkProvider — supportsTools flag", () => {
  it("(d) supportsTools is true after Phase 2 implementation", () => {
    expect(claudeSdkProvider.supportsTools).toBe(true);
  });
});

describe("claudeSdkProvider — agentic loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(a) tool_use sequence: model calls Read tool, then returns final answer", async () => {
    // Turn 1: model requests tool_use
    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse("Read", { path: "docs/extractor-reference/bogi.md" }, "tool_use_1")
      )
      // Turn 2: model provides final text after seeing tool result
      .mockResolvedValueOnce(mockTextResponse("Final extracted JSON result"));

    const events = await collectEvents("Extract question", {
      allowedTools: ["Read", "Grep", "Glob"],
      maxTurns: 5,
    });

    // Verify executeHostTool was called with Read tool
    expect(executeHostTool).toHaveBeenCalledWith(
      "Read",
      { path: "docs/extractor-reference/bogi.md" },
      expect.objectContaining({ allowedRoot: expect.any(String) })
    );

    // Verify event sequence: tool_use → tool_result → assistant text → result success
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

    // Verify messages.create was called exactly 2 times (1 initial + 1 after tool result)
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("(b) allowedTools filtering: disallowed tool gets error tool_result, loop continues", async () => {
    // Turn 1: model requests a tool NOT in allowedTools
    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse("Bash", { command: "ls ." }, "tool_use_bash")
      )
      // Turn 2: model gets the error and returns final text
      .mockResolvedValueOnce(mockTextResponse("Understood, Bash is not allowed."));

    const events = await collectEvents("Do something", {
      allowedTools: ["Read"], // Only Read is allowed, not Bash
      maxTurns: 5,
    });

    // executeHostTool should NOT be called for the disallowed tool
    expect(executeHostTool).not.toHaveBeenCalled();

    // Should have a tool_result event with an error message
    const toolResultEvents = events.filter(
      (e) => e.type === "assistant" && e.message?.content?.[0]?.type === "tool_result"
    );
    expect(toolResultEvents).toHaveLength(1);
    expect(toolResultEvents[0]?.message?.content?.[0]?.text).toContain("not in allowedTools");

    // Final result should still be success (loop continued after error tool_result)
    const successEvent = events.find((e) => e.type === "result" && e.subtype === "success");
    expect(successEvent).toBeDefined();
  });

  it("(b2) no allowedTools → no tools passed to API → 1-shot fallback", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("Simple text answer"));

    const events = await collectEvents("Simple question");
    // No allowedTools: filteredSchemas should be empty, no tools passed to API
    const apiCall = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(apiCall.tools).toBeUndefined();

    const successEvent = events.find((e) => e.type === "result" && e.subtype === "success");
    expect(successEvent).toBeDefined();
    expect(successEvent?.result).toBe("Simple text answer");
  });

  it("(c) maxTurns exceeded returns error result", async () => {
    // Every turn, model keeps requesting a tool_use (never ends)
    const infiniteToolUse = mockToolUseResponse("Read", { path: "a.md" }, "tu_inf");
    mockCreate.mockResolvedValue({
      ...infiniteToolUse,
      content: [{ ...infiniteToolUse.content[0] }],
    });

    // mock executeHostTool to always succeed
    vi.mocked(executeHostTool).mockResolvedValue({ ok: true, output: "some content" });

    const events = await collectEvents("Keep using tools", {
      allowedTools: ["Read"],
      maxTurns: 3, // Small maxTurns to test the limit
    });

    const errorEvent = events.find((e) => e.type === "result" && e.subtype === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.result).toContain("maxTurns");
    // Should have called create exactly maxTurns times
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("(a2) tool_use then text in same response — handles mixed content", async () => {
    // Turn 1: model sends both text + tool_use in same response (text before tool)
    mockCreate
      .mockResolvedValueOnce({
        id: "msg_mixed",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 30 },
        content: [
          { type: "text", text: "Let me read the reference doc." },
          { type: "tool_use", id: "tu_mix", name: "Read", input: { path: "docs/extractor-reference/bogi.md" } },
        ],
      })
      // Turn 2: final answer
      .mockResolvedValueOnce(mockTextResponse("JSON output here"));

    const events = await collectEvents("Extract", { allowedTools: ["Read"], maxTurns: 5 });

    // Should have emitted the partial text from turn 1
    const textEvents = events.filter(
      (e) => e.type === "assistant" && e.message?.content?.[0]?.type === "text"
    );
    expect(textEvents.length).toBeGreaterThanOrEqual(1);

    const successEvent = events.find((e) => e.type === "result" && e.subtype === "success");
    expect(successEvent?.result).toBe("JSON output here");
  });
});
