import { describe, expect, it, vi, afterEach } from "vitest";
import { transformToSSE } from "../claude";
import {
  buildCodexExecArgs,
  buildCodexPrompt,
  parseCodexJsonLine,
  getCodexBin,
} from "../ai/providers/codexCli";

describe("Codex CLI provider", () => {
  it("builds codex exec args with the expected sandbox policy (prompt via stdin `-`)", () => {
    expect(buildCodexExecArgs("/repo")).toEqual([
      "exec",
      "--json",
      "--cd",
      "/repo",
      "--sandbox",
      "danger-full-access",
      "-",
    ]);
  });

  it("inserts a `--` separator before the stdin marker `-` when images are attached", () => {
    expect(buildCodexExecArgs("/repo", ["/tmp/q01.png"])).toEqual([
      "exec",
      "--json",
      "--cd",
      "/repo",
      "--sandbox",
      "danger-full-access",
      "--image",
      "/tmp/q01.png",
      "--",
      "-",
    ]);
  });

  it("adds workflow reuse guidance to the provider prompt", () => {
    const prompt = buildCodexPrompt("시험지를 제작해줘.");
    expect(prompt).toContain(".claude/skills");
    expect(prompt).toContain(".claude/agents");
    expect(prompt).toContain("시험지를 제작해줘.");
  });

  it("parses Codex JSONL text messages into Claude-compatible events", () => {
    const events = parseCodexJsonLine(JSON.stringify({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "exam-builder HWPX 조립 시작" }],
    }));

    expect(events).toEqual([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "exam-builder HWPX 조립 시작" }],
        },
      },
    ]);
  });

  it("lets existing SSE transform detect stages from parsed Codex text events", () => {
    const [event] = parseCodexJsonLine(JSON.stringify({
      type: "message",
      message: "exam-solver 에이전트 실행",
    }));

    const currentStage = { name: "" };
    const sseEvents = transformToSSE(event, currentStage);

    expect(currentStage.name).toBe("solver");
    expect(sseEvents[0]).toEqual({ event: "stage", data: { name: "solver", status: "running" } });
  });

  it("maps Codex command events to Bash tool events for output file detection", () => {
    const [event] = parseCodexJsonLine(JSON.stringify({
      type: "exec_command",
      command: "zip -r outputs/final.hwpx Contents",
    }));

    const sseEvents = transformToSSE(event, { name: "" });
    expect(sseEvents).toContainEqual({
      event: "file",
      data: { type: "hwpx", name: "final.hwpx", path: "outputs/final.hwpx" },
    });
  });

  it("maps Codex failure results to failed SSE result events", () => {
    const [event] = parseCodexJsonLine(JSON.stringify({
      type: "result",
      success: false,
      error: "exit code 1",
    }));

    expect(transformToSSE(event, { name: "" })).toEqual([
      { event: "result", data: { status: "failed", result: "exit code 1" } },
    ]);
  });

  it("ignores malformed JSONL lines", () => {
    expect(parseCodexJsonLine("{not json")).toEqual([]);
  });

  // codex 0.42.x `--json` emits the final answer as an `item.completed` event
  // whose `item` is an `agent_message` carrying the text in `.text`.
  it("extracts agent_message text from an item.completed event (real --json success shape)", () => {
    const events = parseCodexJsonLine(JSON.stringify({
      type: "item.completed",
      item: { id: "item_0", type: "agent_message", text: '{"ok":true,"n":7}' },
    }));
    expect(events).toEqual([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: '{"ok":true,"n":7}' }],
        },
      },
    ]);
  });

  // `codex exec --json` (0.42.x) also emits lifecycle/error events as { id, msg: { type, ... } }.
  describe("--json (msg-wrapped) event format", () => {
    it("extracts agent_message as assistant text", () => {
      const events = parseCodexJsonLine(JSON.stringify({
        id: "0",
        msg: { type: "agent_message", message: '{"number":1,"answer":"①"}' },
      }));
      expect(events).toEqual([
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: '{"number":1,"answer":"①"}' }],
          },
        },
      ]);
    });

    it("surfaces a msg error (e.g. token refresh 401) as a failed result", () => {
      const [event] = parseCodexJsonLine(JSON.stringify({
        id: "0",
        msg: { type: "error", message: "Failed to refresh token: 401 Unauthorized" },
      }));
      expect(event).toEqual({
        type: "result",
        subtype: "error",
        result: "Failed to refresh token: 401 Unauthorized",
      });
    });

    it("maps exec_command_begin to a Bash tool_use for output-file detection", () => {
      const [event] = parseCodexJsonLine(JSON.stringify({
        id: "0",
        msg: { type: "exec_command_begin", command: "zip -r outputs/final.hwpx Contents" },
      }));
      const sseEvents = transformToSSE(event, { name: "" });
      expect(sseEvents).toContainEqual({
        event: "file",
        data: { type: "hwpx", name: "final.hwpx", path: "outputs/final.hwpx" },
      });
    });

    it("drops lifecycle / delta events (task_started, token_count, deltas)", () => {
      expect(parseCodexJsonLine(JSON.stringify({ id: "0", msg: { type: "task_started" } }))).toEqual([]);
      expect(parseCodexJsonLine(JSON.stringify({ id: "0", msg: { type: "token_count", info: {} } }))).toEqual([]);
      expect(parseCodexJsonLine(JSON.stringify({ id: "0", msg: { type: "agent_message_delta", delta: "x" } }))).toEqual([]);
    });
  });

  it("appends --output-last-message when a file path is given", () => {
    expect(buildCodexExecArgs("/repo", undefined, "/tmp/last.txt")).toEqual([
      "exec",
      "--json",
      "--cd",
      "/repo",
      "--sandbox",
      "danger-full-access",
      "--output-last-message",
      "/tmp/last.txt",
      "-",
    ]);
  });

  describe("getCodexBin — platform 분기", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("macOS/Linux에서는 'codex'를 반환한다", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
      expect(getCodexBin()).toBe("codex");
    });

    it("Windows에서는 'codex.cmd'를 반환한다", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      expect(getCodexBin()).toBe("codex.cmd");
    });
  });
});
