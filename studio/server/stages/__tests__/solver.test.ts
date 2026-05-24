import { mkdtemp, rm, readFile, mkdir } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSolverStage, validateSolverOutput } from "../solver";
import { FileBackedStageCache } from "../cache";
import type { AIProviderAdapter, ProviderRunOptions } from "@/lib/ai/types";

// ─── helpers ──────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "solver-test-"));
  tempDirs.push(dir);
  return dir;
}

async function makeCache(baseDir: string): Promise<FileBackedStageCache> {
  const examDir = path.join(baseDir, "inputs", "시험지 제작");
  const cacheDir = path.join(examDir, ".v3cache");
  await mkdir(cacheDir, { recursive: true });
  return new FileBackedStageCache(examDir);
}

/** Minimal valid solver output JSON (new exam-rich schema) */
const VALID_OUTPUT = {
  number: 1,
  answer: "①",
  explanation_parts: [
    { t: "먼저" },
    { eq: "x = 1" },
    { br: true },
    { t: "그러면..." },
  ],
};

function makeMockProvider(
  responseJson: string,
  exitCode = 0,
  runSpy?: ReturnType<typeof vi.fn>
): AIProviderAdapter {
  const runFn = runSpy ?? vi.fn();

  return {
    id: "claude-sdk",
    label: "Mock Provider",
    supportsTools: false as const,
    run(prompt: string, options?: ProviderRunOptions) {
      runFn(prompt, options);

      let exitResolve: (code: number) => void = () => undefined;
      const exitCodePromise = new Promise<number>((resolve) => {
        exitResolve = resolve;
      });

      async function* events() {
        if (exitCode === 0) {
          yield {
            type: "assistant" as const,
            message: {
              role: "assistant" as const,
              content: [{ type: "text" as const, text: responseJson }],
            },
          };
        }
        yield { type: "result" as const, subtype: exitCode === 0 ? ("success" as const) : ("error" as const), result: responseJson };
        exitResolve(exitCode);
      }

      return {
        process: {} as import("child_process").ChildProcess,
        events: events(),
        exitCode: exitCodePromise,
        metadata: {
          requestedProvider: "claude-sdk",
          provider: "claude-sdk",
          label: "Mock Provider",
        },
      };
    },
  };
}

// ─── runSolverStage ───────────────────────────────────────────────────────────

describe("runSolverStage", () => {
  it("returns completed and writes cache file on valid JSON response", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);
    const provider = makeMockProvider(JSON.stringify(VALID_OUTPUT));

    const result = await runSolverStage({
      questionNumber: 1,
      extracted: { number: 1, question: "test" },
      cache,
      provider,
    });

    expect(result.status).toBe("completed");
    expect(result.output).toBeDefined();
    expect(result.output?.answer).toBe("①");

    const cachePath = cache.solverResultPath(1);
    const written = JSON.parse(await readFile(cachePath, "utf8")) as typeof VALID_OUTPUT;
    expect(written.answer).toBe("①");
    expect(written.explanation_parts).toHaveLength(4);
  });

  it("returns failed on invalid JSON response", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);
    const provider = makeMockProvider("이것은 JSON이 아닙니다.");

    const result = await runSolverStage({
      questionNumber: 2,
      extracted: {},
      cache,
      provider,
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("model_json_parse_failed");
  });

  it("returns failed when provider exits with non-zero code", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);
    const provider = makeMockProvider("", 1);

    const result = await runSolverStage({
      questionNumber: 3,
      extracted: {},
      cache,
      provider,
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("solver_provider_failed");
  });

  it("passes stageKey to provider.run", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);
    const spy = vi.fn();
    const provider = makeMockProvider(JSON.stringify(VALID_OUTPUT), 0, spy);

    await runSolverStage({
      questionNumber: 1,
      extracted: {},
      cache,
      provider,
    });

    expect(spy).toHaveBeenCalledOnce();
    const [, options] = spy.mock.calls[0] as [string, ProviderRunOptions];
    expect(options.stageKey).toBe("create.solver");
  });
});

// ─── validateSolverOutput ─────────────────────────────────────────────────────

describe("validateSolverOutput", () => {
  it("passes for valid output with t/eq/br parts", () => {
    const result = validateSolverOutput(VALID_OUTPUT);
    expect(result.ok).toBe(true);
  });

  it("passes without number field", () => {
    const rest: Partial<typeof VALID_OUTPUT> = { ...VALID_OUTPUT };
    delete rest.number;
    const result = validateSolverOutput(rest);
    expect(result.ok).toBe(true);
  });

  it("fails when answer is missing", () => {
    const rest: Partial<typeof VALID_OUTPUT> = { ...VALID_OUTPUT };
    delete rest.answer;
    const result = validateSolverOutput(rest);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("answer");
  });

  it("fails when answer is empty string", () => {
    const result = validateSolverOutput({ ...VALID_OUTPUT, answer: "" });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("answer");
  });

  it("fails when explanation_parts is missing", () => {
    const rest: Partial<typeof VALID_OUTPUT> = { ...VALID_OUTPUT };
    delete rest.explanation_parts;
    const result = validateSolverOutput(rest);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("explanation_parts");
  });

  it("fails when explanation_parts is empty array", () => {
    const result = validateSolverOutput({ ...VALID_OUTPUT, explanation_parts: [] });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("explanation_parts");
  });

  it("fails when explanation_parts element has unknown key", () => {
    const result = validateSolverOutput({
      ...VALID_OUTPUT,
      explanation_parts: [{ unknown_key: "value" }],
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("unknown key");
  });

  it("fails when br value is not true", () => {
    const result = validateSolverOutput({
      ...VALID_OUTPUT,
      explanation_parts: [{ br: false }],
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("br");
  });

  it("calls validateEquation callback for eq parts", () => {
    const validateEquation = vi.fn().mockReturnValue("equation error");
    const result = validateSolverOutput(VALID_OUTPUT, validateEquation);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toBe("equation error");
    expect(validateEquation).toHaveBeenCalledWith("x = 1");
  });

  it("passes when validateEquation returns undefined", () => {
    const validateEquation = vi.fn().mockReturnValue(undefined);
    const result = validateSolverOutput(VALID_OUTPUT, validateEquation);
    expect(result.ok).toBe(true);
  });

  it("fails when output is not an object", () => {
    const result = validateSolverOutput("not an object");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("object");
  });
});
