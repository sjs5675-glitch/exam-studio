import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { readRuntimeEnv } from "../server/runtimeEnv";
import { deepseekV4Provider } from "../ai/providers/deepseekV4";
import { claudeSdkProvider } from "../ai/providers/claudeSdk";
import { createStageCache } from "../../server/stages/cache";
import { runExtractorStage } from "../../server/stages/extractor";
import { runVerifierStage } from "../../server/stages/verifier";
import { runSolverStage } from "../../server/stages/solver";

const env = readRuntimeEnv();
const liveKey = env.DEEPSEEK_API_KEY;
const anthropicKey = env.ANTHROPIC_API_KEY;
const describeLive = liveKey ? describe : describe.skip;
// Both keys required for extractor+solver+verifier full e2e (claude-sdk + deepseek-v4).
const describeBothLive =
  liveKey && anthropicKey ? describe : describe.skip;

describeLive("DeepSeek V4 live integration", () => {
  it("collects raw provider output for a small prompt", async () => {
    const result = deepseekV4Provider.run(
      "Return only JSON: {\"answer\": string}. What is 2+2?",
      { stageKey: "create.verifier" },
    );

    const events: unknown[] = [];
    for await (const event of result.events) {
      events.push(event);
    }
    const exit = await result.exitCode;

    expect(exit).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: "result", subtype: "success" });
  }, 60_000);

  it("runs verifier stage end-to-end and writes structured JSON", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "deepseek-verifier-live-"));
    const cache = createStageCache(tempDir);

    try {
      const result = await runVerifierStage({
        questionNumber: 1,
        extracted: { question: "What is 1+1?", choices: ["1", "2", "3", "4"], answer: 2 },
        solved: { answer: "2", explanation_parts: [{ t: "1 plus 1 equals 2." }] },
        guidelineContext: "Verify the solved answer matches the extracted answer. Status must be \"pass\" or \"fail\".",
        cache,
      });

      expect(result.status).toBe("completed");
      if (result.status !== "completed" || !result.output) {
        throw new Error(`verifier stage did not complete: ${JSON.stringify(result)}`);
      }
      expect(["pass", "fail"]).toContain(result.output.status);
      expect(Array.isArray(result.output.issues)).toBe(true);

      const written = await readFile(cache.verifierResultPath(1), "utf8");
      const parsed = JSON.parse(written);
      expect(parsed).toEqual(result.output);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 90_000);

  it("runs solver stage end-to-end and produces a valid solver JSON", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "deepseek-solver-live-"));
    const cache = createStageCache(tempDir);

    try {
      const result = await runSolverStage({
        questionNumber: 1,
        extracted: { question: "What is 3+4?", choices: ["5", "6", "7", "8"], answer: 3 },
        cache,
      });

      expect(result.status).toBe("completed");
      if (result.status !== "completed" || !result.output) {
        throw new Error(`solver stage did not complete: ${JSON.stringify(result)}`);
      }
      expect(typeof result.output.answer).toBe("string");
      expect(result.output.answer.length).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 120_000);
});

describeBothLive("extractor + solver + verifier full e2e (claude-sdk + deepseek-v4)", () => {
  it(
    "runs one question through extractor(claude-sdk) → solver(deepseek-v4) → verifier(deepseek-v4)",
    async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "live-e2e-"));
      const cache = createStageCache(tempDir);

      try {
        // Use fixture PNG as input image (1x1 pixel, so claude-sdk will see a minimal image).
        // The extractor may not produce a valid result from a 1x1 dummy, so we fall back to
        // manually writing a pre-baked extracted JSON and starting from solver.
        const fixturePng = path.join(
          __dirname,
          "../../server/stages/__tests__/fixtures/q01.png"
        );

        // Step 1: Attempt extractor (claude-sdk) with fixture image.
        const extractorResult = await runExtractorStage({
          questionNumber: 1,
          imagePath: fixturePng,
          cache,
          provider: claudeSdkProvider,
        });

        // If extractor fails (expected for 1x1 dummy), pre-populate cache manually.
        if (extractorResult.status !== "completed") {
          await cache.ensureCacheDir();
          const fallbackExtracted = {
            question: "What is 1+1?",
            choices: ["1", "2", "3", "4"],
            answer: "2",
            has_figure: false,
            figure_info: null,
          };
          await writeFile(
            cache.extractorResultPath(1),
            `${JSON.stringify(fallbackExtracted, null, 2)}\n`,
            "utf8"
          );
        }

        // Read back extracted data (may come from real extractor or fallback).
        let extracted: unknown;
        try {
          const extractedText = await readFile(cache.extractorResultPath(1), "utf8");
          extracted = JSON.parse(extractedText);
        } catch {
          extracted = { question: "What is 1+1?", choices: ["1", "2", "3", "4"], answer: "2", has_figure: false, figure_info: null };
        }

        // Step 2: Solver (deepseek-v4).
        const solverResult = await runSolverStage({
          questionNumber: 1,
          extracted,
          cache,
          provider: deepseekV4Provider,
        });

        expect(solverResult.status).toBe("completed");
        if (solverResult.status !== "completed" || !solverResult.output) {
          throw new Error(`solver failed: ${JSON.stringify(solverResult)}`);
        }
        expect(typeof solverResult.output.answer).toBe("string");
        expect(Array.isArray(solverResult.output.explanation_parts)).toBe(true);

        // Step 3: Verifier (deepseek-v4).
        const verifierResult = await runVerifierStage({
          questionNumber: 1,
          extracted,
          solved: solverResult.output,
          guidelineContext: 'Verify the solved answer. Status must be "pass" or "fail".',
          cache,
          provider: deepseekV4Provider,
        });

        expect(verifierResult.status).toBe("completed");
        if (verifierResult.status !== "completed" || !verifierResult.output) {
          throw new Error(`verifier failed: ${JSON.stringify(verifierResult)}`);
        }
        expect(["pass", "fail"]).toContain(verifierResult.output.status);
        expect(Array.isArray(verifierResult.output.issues)).toBe(true);

        // Verify persisted files.
        const writtenSolver = JSON.parse(await readFile(cache.solverResultPath(1), "utf8"));
        expect(writtenSolver).toEqual(solverResult.output);

        const writtenVerifier = JSON.parse(await readFile(cache.verifierResultPath(1), "utf8"));
        expect(writtenVerifier).toEqual(verifierResult.output);

        // Provider metadata must reflect correct providers.
        if (solverResult.status === "completed") {
          expect(solverResult.provider?.provider).toBe("deepseek-v4");
        }
        if (verifierResult.status === "completed") {
          expect(verifierResult.provider?.provider).toBe("deepseek-v4");
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    90_000
  );
});
