import { mkdtemp, rm, readFile, mkdir } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runVerifierStage, validateVerifierOutput } from "../verifier";
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "verifier-test-"));
  tempDirs.push(dir);
  return dir;
}

async function makeCache(baseDir: string): Promise<FileBackedStageCache> {
  const examDir = path.join(baseDir, "inputs", "시험지 제작");
  const cacheDir = path.join(examDir, ".v3cache");
  await mkdir(cacheDir, { recursive: true });
  return new FileBackedStageCache(examDir);
}

/** Valid pass verifier output */
const VALID_PASS_OUTPUT = {
  number: 1,
  status: "pass" as const,
  issues: [],
  feedback: null,
};

/** Valid fail verifier output */
const VALID_FAIL_OUTPUT = {
  number: 1,
  status: "fail" as const,
  issues: [
    {
      category: "math_accuracy" as const,
      description: "x = 2가 올바른 값이나 x = 1로 계산됨",
      location: "explanation_parts[1]",
    },
  ],
  feedback: "x의 값을 다시 계산하라. 올바른 값은 x = 2이다.",
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

// ─── runVerifierStage ─────────────────────────────────────────────────────────

describe("runVerifierStage", () => {
  it("returns completed and writes cache file on valid pass response", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);
    const provider = makeMockProvider(JSON.stringify(VALID_PASS_OUTPUT));

    const result = await runVerifierStage({
      questionNumber: 1,
      extracted: { number: 1 },
      solved: { answer: "①", explanation_parts: [{ t: "풀이" }] },
      cache,
      provider,
    });

    expect(result.status).toBe("completed");
    expect(result.output?.status).toBe("pass");

    const cachePath = cache.verifierResultPath(1);
    const written = JSON.parse(await readFile(cachePath, "utf8")) as typeof VALID_PASS_OUTPUT;
    expect(written.status).toBe("pass");
    expect(written.issues).toHaveLength(0);
  });

  it("returns completed on valid fail response", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);
    const provider = makeMockProvider(JSON.stringify(VALID_FAIL_OUTPUT));

    const result = await runVerifierStage({
      questionNumber: 1,
      extracted: {},
      solved: {},
      cache,
      provider,
    });

    expect(result.status).toBe("completed");
    expect(result.output?.status).toBe("fail");
    expect(result.output?.issues).toHaveLength(1);
    expect(result.output?.issues[0].category).toBe("math_accuracy");
  });

  it("returns failed on invalid JSON response", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);
    const provider = makeMockProvider("이것은 JSON이 아닙니다.");

    const result = await runVerifierStage({
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

    const result = await runVerifierStage({
      questionNumber: 3,
      extracted: {},
      cache,
      provider,
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("verifier_provider_failed");
  });

  it("passes stageKey to provider.run", async () => {
    const base = await makeTempDir();
    const cache = await makeCache(base);
    const spy = vi.fn();
    const provider = makeMockProvider(JSON.stringify(VALID_PASS_OUTPUT), 0, spy);

    await runVerifierStage({
      questionNumber: 1,
      extracted: {},
      cache,
      provider,
    });

    expect(spy).toHaveBeenCalledOnce();
    const [, options] = spy.mock.calls[0] as [string, ProviderRunOptions];
    expect(options.stageKey).toBe("create.verifier");
  });
});

// ─── validateVerifierOutput ───────────────────────────────────────────────────

describe("validateVerifierOutput", () => {
  it("passes for valid pass output with empty issues", () => {
    const result = validateVerifierOutput(VALID_PASS_OUTPUT);
    expect(result.ok).toBe(true);
  });

  it("passes for valid fail output with issues", () => {
    const result = validateVerifierOutput(VALID_FAIL_OUTPUT);
    expect(result.ok).toBe(true);
  });

  it("passes without number field", () => {
    const rest: Partial<typeof VALID_PASS_OUTPUT> = { ...VALID_PASS_OUTPUT };
    delete rest.number;
    const result = validateVerifierOutput(rest);
    expect(result.ok).toBe(true);
  });

  it("fails when status is missing", () => {
    const rest: Partial<typeof VALID_PASS_OUTPUT> = { ...VALID_PASS_OUTPUT };
    delete rest.status;
    const result = validateVerifierOutput(rest);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("status");
  });

  it("fails when status is not pass or fail", () => {
    const result = validateVerifierOutput({ ...VALID_PASS_OUTPUT, status: "unknown" });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("status");
  });

  it("fails when issues is not an array", () => {
    const result = validateVerifierOutput({ ...VALID_PASS_OUTPUT, issues: null });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("issues");
  });

  it("fails when status=fail with empty issues", () => {
    const result = validateVerifierOutput({ ...VALID_FAIL_OUTPUT, issues: [] });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("issues");
  });

  it("fails when issue has invalid category", () => {
    const result = validateVerifierOutput({
      ...VALID_FAIL_OUTPUT,
      issues: [{ category: "unknown_category", description: "some error" }],
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("category");
  });

  it("fails when issue description is missing", () => {
    const result = validateVerifierOutput({
      ...VALID_FAIL_OUTPUT,
      issues: [{ category: "math_accuracy" }],
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("description");
  });

  it("fails when issue description is empty string", () => {
    const result = validateVerifierOutput({
      ...VALID_FAIL_OUTPUT,
      issues: [{ category: "math_accuracy", description: "" }],
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("description");
  });

  it("passes for all valid issue categories", () => {
    const categories = [
      "math_accuracy",
      "math_completeness",
      "curriculum_scope",
      "curriculum_term",
      "format_rule",
      "equation_syntax",
      "extraction_mismatch",
    ];
    for (const category of categories) {
      const result = validateVerifierOutput({
        status: "fail",
        issues: [{ category, description: "test error" }],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("preserves location when present", () => {
    const result = validateVerifierOutput(VALID_FAIL_OUTPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.issues[0].location).toBe("explanation_parts[1]");
    }
  });

  it("fails when output is not an object", () => {
    const result = validateVerifierOutput("not an object");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain("object");
  });
});
