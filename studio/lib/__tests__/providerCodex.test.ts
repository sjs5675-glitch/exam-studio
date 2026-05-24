import { describe, expect, it } from "vitest";
import { transformToSSE } from "../claude";
import {
  buildCodexExecArgs,
  buildCodexPrompt,
  parseCodexJsonLine,
} from "../ai/providers/codexCli";

describe("Codex CLI provider", () => {
  it("builds codex exec args with the expected sandbox policy", () => {
    expect(buildCodexExecArgs("do work", "/repo")).toEqual([
      "exec",
      "--json",
      "--cd",
      "/repo",
      "--sandbox",
      "danger-full-access",
      buildCodexPrompt("do work"),
    ]);
  });

  it("inserts a `--` separator before the prompt when images are attached", () => {
    expect(buildCodexExecArgs("describe", "/repo", ["/tmp/q01.png"])).toEqual([
      "exec",
      "--json",
      "--cd",
      "/repo",
      "--sandbox",
      "danger-full-access",
      "--image",
      "/tmp/q01.png",
      "--",
      buildCodexPrompt("describe"),
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
});
