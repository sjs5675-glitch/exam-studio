import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeSdkProvider } from "../ai/providers/claudeSdk";
import { openaiSdkProvider } from "../ai/providers/openaiSdk";

async function collectEvents(result: ReturnType<typeof claudeSdkProvider.run>) {
  const events = [];
  for await (const event of result.events) {
    events.push(event);
  }
  return events;
}

describe("claudeSdkProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct id and label", () => {
    expect(claudeSdkProvider.id).toBe("claude-sdk");
    expect(claudeSdkProvider.label).toBe("Claude SDK");
  });

  it("returns error event when ANTHROPIC_API_KEY is not configured", async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    const prevDisable = process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV = "1";

    try {
      const result = claudeSdkProvider.run("test", { stageKey: "create.solver" });
      const events = await collectEvents(result);
      expect(await result.exitCode).toBe(1);
      expect(events.at(-1)).toMatchObject({
        type: "result",
        subtype: "error",
        result: "ANTHROPIC_API_KEY is not configured.",
      });
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
      if (prevDisable === undefined) delete process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV;
      else process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV = prevDisable;
    }
  });

  it("emits aborted error when signal is aborted before run", async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    const prevDisable = process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV;
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV = "1";

    const controller = new AbortController();
    controller.abort();

    try {
      const result = claudeSdkProvider.run("test", { signal: controller.signal });
      const events = await collectEvents(result);
      expect(await result.exitCode).toBe(1);
      const last = events.at(-1) as { type: string; subtype: string; result: string };
      expect(last.type).toBe("result");
      expect(last.subtype).toBe("error");
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
      if (prevDisable === undefined) delete process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV;
      else process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV = prevDisable;
    }
  });
});

describe("openaiSdkProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct id and label", () => {
    expect(openaiSdkProvider.id).toBe("openai-sdk");
    expect(openaiSdkProvider.label).toBe("OpenAI SDK");
  });

  it("returns error event when OPENAI_API_KEY is not configured", async () => {
    const prevKey = process.env.OPENAI_API_KEY;
    const prevDisable = process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV;
    delete process.env.OPENAI_API_KEY;
    process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV = "1";

    try {
      const result = openaiSdkProvider.run("test", { stageKey: "create.solver" });
      const events = await collectEvents(result);
      expect(await result.exitCode).toBe(1);
      expect(events.at(-1)).toMatchObject({
        type: "result",
        subtype: "error",
        result: "OPENAI_API_KEY is not configured.",
      });
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevDisable === undefined) delete process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV;
      else process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV = prevDisable;
    }
  });

  it("emits aborted error when signal is aborted before run", async () => {
    const prevKey = process.env.OPENAI_API_KEY;
    const prevDisable = process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV = "1";

    const controller = new AbortController();
    controller.abort();

    try {
      const result = openaiSdkProvider.run("test", { signal: controller.signal });
      const events = await collectEvents(result);
      expect(await result.exitCode).toBe(1);
      const last = events.at(-1) as { type: string; subtype: string; result: string };
      expect(last.type).toBe("result");
      expect(last.subtype).toBe("error");
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevDisable === undefined) delete process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV;
      else process.env.EXAM_STUDIO_DISABLE_RUNTIME_ENV = prevDisable;
    }
  });
});
