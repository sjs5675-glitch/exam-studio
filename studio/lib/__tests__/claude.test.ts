import { describe, it, expect } from "vitest";
import {
  detectStageFromTool,
  extractReviewEvents,
  transformToSSE,
  type ClaudeEvent,
} from "../claude";

describe("detectStageFromTool", () => {
  it("Skill exam-create → extractor (V3 flow is now standard)", () => {
    expect(detectStageFromTool("Skill", { skill: "exam-create" })).toBe("extractor");
  });

  it("Skill exam-crop → cropper", () => {
    expect(detectStageFromTool("Skill", { skill: "exam-crop" })).toBe("cropper");
  });

  it("Skill nano-banana → figure", () => {
    expect(detectStageFromTool("Skill", { skill: "nano-banana" })).toBe("figure");
  });

  it("Agent subagent_type exam-extractor → extractor", () => {
    expect(detectStageFromTool("Agent", { subagent_type: "exam-extractor" })).toBe("extractor");
  });

  it("Agent subagent_type exam-solver → solver", () => {
    expect(detectStageFromTool("Agent", { subagent_type: "exam-solver" })).toBe("solver");
  });

  it("Agent subagent_type exam-builder → builder", () => {
    expect(detectStageFromTool("Agent", { subagent_type: "exam-builder" })).toBe("builder");
  });

  it("Read file_path x.pdf → extractor (V3 entry stage)", () => {
    expect(detectStageFromTool("Read", { file_path: "x.pdf" })).toBe("extractor");
  });

  it("Write q01_extracted.json → extractor (V3 per-question artifact)", () => {
    expect(detectStageFromTool("Write", { file_path: "q01_extracted.json" })).toBe("extractor");
  });

  it("Write file_path section0.xml → builder", () => {
    expect(detectStageFromTool("Write", { file_path: "section0.xml" })).toBe("builder");
  });

  it("Agent description fallback maps known stage names", () => {
    expect(detectStageFromTool("Agent", { description: "Run verifier pass" })).toBe("verifier");
  });

  it("Agent prompt fallback maps exact exam agent names", () => {
    expect(detectStageFromTool("Agent", { prompt: "Use exam-figure for diagrams" })).toBe("figure");
    expect(detectStageFromTool("Agent", { prompt: "Dispatch exam-checker" })).toBe("checker");
  });
});

describe("extractReviewEvents", () => {
  it("parses [EXTRACTION_REVIEW] blocks into extraction_review SSE events", () => {
    const events = extractReviewEvents(`
before
[EXTRACTION_REVIEW]
total: 2
---
[Q1]
id: q1
points: 4
parts: [{"t":"문제"},{"eq":"x^2"}]
needs_fix: true
---
[Q2]
id: q2
note: 확인 완료
[/EXTRACTION_REVIEW]
after
`);

    expect(events).toEqual([
      {
        event: "extraction_review",
        data: {
          items: [
            {
              number: 1,
              data: {
                id: "q1",
                points: 4,
                parts: [{ t: "문제" }, { eq: "x^2" }],
                needs_fix: true,
              },
            },
            {
              number: 2,
              data: {
                id: "q2",
                note: "확인 완료",
              },
            },
          ],
        },
      },
    ]);
  });
});

describe("transformToSSE", () => {
  it("converts system init into a system log event", () => {
    const events = transformToSSE(
      { type: "system", subtype: "init", model: "claude-test" } as unknown as ClaudeEvent,
      { name: "" }
    );

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("log");
    expect(events[0].data).toMatchObject({
      stage: "system",
      message: "Claude CLI 시작됨 (model: claude-test)",
      level: "info",
    });
    expect(events[0].data.timestamp).toEqual(expect.any(String));
  });

  it("emits stage transitions and logs from text stage detection", () => {
    const currentStage = { name: "" };
    const events = transformToSSE(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "exam-solver 에이전트가 해설을 생성합니다." }],
        },
      },
      currentStage
    );

    expect(currentStage.name).toBe("solver");
    expect(events[0]).toEqual({ event: "stage", data: { name: "solver", status: "running" } });
    expect(events[1].event).toBe("log");
    expect(events[1].data).toMatchObject({
      stage: "solver",
      message: "exam-solver 에이전트가 해설을 생성합니다.",
      level: "info",
    });
  });

  it("marks previous stage done before a tool-detected stage starts", () => {
    const currentStage = { name: "extractor" };
    const events = transformToSSE(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Agent", input: { subagent_type: "exam-builder" } }],
        },
      },
      currentStage
    );

    expect(currentStage.name).toBe("builder");
    expect(events[0]).toEqual({ event: "stage", data: { name: "extractor", status: "done" } });
    expect(events[1]).toEqual({ event: "stage", data: { name: "builder", status: "running" } });
    expect(events[2].event).toBe("log");
    expect(events[2].data).toMatchObject({ stage: "builder", message: "[Agent] " });
  });

  it("emits file and question events for per-question JSON writes", () => {
    const events = transformToSSE(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: "/work/q03_extracted.json", content: "{\"answer\":1}" },
            },
          ],
        },
      },
      { name: "" }
    );

    expect(events).toContainEqual({
      event: "file",
      data: { type: "json", name: "q03_extracted.json", path: "/work/q03_extracted.json" },
    });
    expect(events).toContainEqual({
      event: "question",
      data: { number: 3, phase: "extracted", content: "{\"answer\":1}" },
    });
  });

  it("emits file events for image, hwpx, and Bash-created hwpx outputs", () => {
    const imageEvents = transformToSSE(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Write", input: { file_path: "/out/figure.png" } }],
        },
      },
      { name: "" }
    );
    expect(imageEvents).toContainEqual({
      event: "file",
      data: { type: "image", name: "figure.png", path: "/out/figure.png" },
    });

    const hwpxEvents = transformToSSE(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "Write", input: { file_path: "/out/exam.hwpx" } },
            { type: "tool_use", name: "Bash", input: { command: "zip -r /out/final.hwpx Contents" } },
          ],
        },
      },
      { name: "" }
    );
    expect(hwpxEvents).toContainEqual({
      event: "file",
      data: { type: "hwpx", name: "exam.hwpx", path: "/out/exam.hwpx" },
    });
    expect(hwpxEvents).toContainEqual({
      event: "file",
      data: { type: "hwpx", name: "final.hwpx", path: "/out/final.hwpx" },
    });
  });

  it("switches to review_extract and emits extraction_review events from text blocks", () => {
    const currentStage = { name: "extractor" };
    const events = transformToSSE(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `[EXTRACTION_REVIEW]\n---\n[Q1]\nid: q1\n[/EXTRACTION_REVIEW]`,
            },
          ],
        },
      },
      currentStage
    );

    expect(currentStage.name).toBe("review_extract");
    expect(events[0]).toEqual({ event: "stage", data: { name: "extractor", status: "done" } });
    expect(events[1]).toEqual({ event: "stage", data: { name: "review_extract", status: "running" } });
    expect(events[2]).toEqual({
      event: "extraction_review",
      data: { items: [{ number: 1, data: { id: "q1" } }] },
    });
  });

  it("closes the current stage and emits success result events", () => {
    const events = transformToSSE(
      { type: "result", subtype: "success", result: "완료되었습니다." },
      { name: "builder" }
    );

    expect(events).toEqual([
      { event: "stage", data: { name: "builder", status: "done" } },
      { event: "result", data: { status: "success", result: "완료되었습니다." } },
    ]);
  });

  it("emits failed result events for non-success result subtypes", () => {
    const events = transformToSSE(
      { type: "result", subtype: "error", result: "실패했습니다." },
      { name: "" }
    );

    expect(events).toEqual([
      { event: "result", data: { status: "failed", result: "실패했습니다." } },
    ]);
  });
});
