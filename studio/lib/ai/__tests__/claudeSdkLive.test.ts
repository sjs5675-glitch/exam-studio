import { describe, expect, it } from "vitest";
import path from "path";
import { readRuntimeEnv } from "../../server/runtimeEnv";
import { claudeSdkProvider } from "../providers/claudeSdk";
import type { ClaudeEvent } from "../../claude";

const env = readRuntimeEnv();
const liveKey = env.ANTHROPIC_API_KEY;
const describeLive = liveKey ? describe : describe.skip;

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describeLive("claude-sdk live tool use", () => {
  it(
    "agentic loop: model calls Read on a sandbox file and returns content-aware answer",
    async () => {
      const prompt =
        "Use the Read tool to read 'proposition.md' from your working directory. " +
        "After reading, answer in one short sentence: what is the value of the `type` field " +
        "shown in the JSON schema inside that file?";

      const result = claudeSdkProvider.run(prompt, {
        cwd: REPO_ROOT,
        allowedTools: ["Read", "Grep", "Glob"],
        maxTurns: 5,
        stageKey: "create.extractor",
      });

      const events: ClaudeEvent[] = [];
      for await (const event of result.events) {
        events.push(event);
      }
      const exit = await result.exitCode;

      if (exit !== 0) {
        const last = events.at(-1);
        console.error("claude-sdk live failed:", JSON.stringify(last));
      }

      expect(exit).toBe(0);

      const toolUseEvents = events.filter(
        (e) =>
          e.type === "assistant" &&
          Array.isArray(e.message?.content) &&
          e.message.content.some(
            (b) =>
              typeof b === "object" &&
              b !== null &&
              (b as { type?: string }).type === "tool_use"
          )
      );
      expect(toolUseEvents.length).toBeGreaterThan(0);

      const last = events.at(-1) as ClaudeEvent | undefined;
      expect(last).toMatchObject({ type: "result", subtype: "success" });
      const resultText = (last as { result?: string }).result ?? "";
      expect(resultText.toLowerCase()).toContain("choice_table");
    },
    90_000
  );
});
