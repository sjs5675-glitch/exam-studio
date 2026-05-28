/**
 * orchestrator.integration.test.ts
 *
 * Phase 7 cross-language parity + Phase 9 mock integration e2e test.
 *
 * Strategy:
 *  - Mock all AI-calling stage runners (extractor, solver, verifier) via vi.mock so
 *    the test can inject deterministic "pass" responses without real API keys.
 *  - Mock the figure stage (runStageCommand) to write a fixture figure_status.json.
 *  - The builder and checker use their real deterministic code paths but are given
 *    a tempdir that lacks Python scripts, so they fall through to the legacy fallback
 *    (which is also mocked/pre-populated).
 *  - 3-question e2e: solver → verifier → figure → builder → checker → done
 *    (The orchestrator pauses after extractor; we resume from "solver".)
 *
 * Assertions:
 *  - result.status === "done"
 *  - providerTelemetry has entries for solver + verifier (2 per question × 3 = 6) +
 *    builder + checker (1 each = 2 total)
 *  - SSE events contain extraction_review ✗ (bypassed), solver stage events ✓
 *
 * Phase 7 (parity suite):
 *  - All 28 normalization fixtures: TS normalizeParts == Python normalize_parts
 *  - Spawns Python subprocess per fixture to get a byte-level comparable JSON output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { readdirSync as readdirSyncNode } from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import type { AIProviderAdapter } from "@/lib/ai/types";
import type { SSEEvent } from "@/lib/claude";
import { FileBackedStageCache } from "../cache";

// ────────────────────────────────────────────────────────────────────────────
// Fixture data mirrors server/stages/__tests__/fixtures/
// ────────────────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, "fixtures");

const EXTRACTED_Q1 = {
  question: "다음 중 옳은 것은? (문제 1)",
  choices: ["① 1", "② 2", "③ 3", "④ 4", "⑤ 5"],
  answer: "①",
  has_figure: false,
  figure_info: null,
};

const EXTRACTED_Q2 = {
  question: "그림을 보고 물음에 답하시오. (문제 2)",
  choices: ["① 가", "② 나", "③ 다", "④ 라", "⑤ 마"],
  answer: "③",
  has_figure: true,
  figure_info: {
    description_en: "A right triangle with legs a and b and hypotenuse c.",
    position: "right",
    crop_ratio: [0.1, 0.1, 0.9, 0.9],
  },
};

const EXTRACTED_Q3 = {
  question: "다음 식을 계산하시오. (문제 3)",
  choices: null,
  answer: "4",
  has_figure: false,
  figure_info: null,
};

const SOLVED_OUTPUT = {
  answer: "①",
  explanation_parts: [{ t: "정답 설명입니다." }],
};

const VERIFIED_OUTPUT_PASS = {
  status: "pass" as const,
  issues: [],
  feedback: undefined,
};

// ────────────────────────────────────────────────────────────────────────────
// Mock provider factory — deterministic JSON response
// ────────────────────────────────────────────────────────────────────────────

function makeMockProvider(
  responseJson: unknown,
  opts: { id?: AIProviderAdapter["id"] } = {}
): AIProviderAdapter {
  const id = opts.id ?? "claude-sdk";
  const text = typeof responseJson === "string" ? responseJson : JSON.stringify(responseJson);

  return {
    id,
    label: `Mock(${id})`,
    supportsTools: true as const,
    run() {
      async function* events() {
        yield {
          type: "assistant" as const,
          message: {
            role: "assistant" as const,
            content: [{ type: "text" as const, text }],
          },
        };
        yield { type: "result" as const, subtype: "success" as const, result: text };
      }

      let resolveExit!: (n: number) => void;
      const exitCodePromise = new Promise<number>((r) => {
        resolveExit = r;
      });

      const eventsAsync = (async function* () {
        for await (const e of events()) yield e;
        resolveExit(0);
      })();

      return {
        process: {} as import("child_process").ChildProcess,
        events: eventsAsync,
        exitCode: exitCodePromise,
        metadata: {
          requestedProvider: id,
          provider: id,
          label: `Mock(${id})`,
        },
      };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// vi.mock — intercept stage runners so they use mock providers
// ────────────────────────────────────────────────────────────────────────────

// We mock the three AI-calling stage runners by intercepting their module exports.
// The mocked implementations delegate to the real logic but inject mock providers.
vi.mock("../extractor", async (importOriginal) => {
  const real = await importOriginal<typeof import("../extractor")>();
  return {
    ...real,
    runExtractorStage: vi.fn(async (input: Parameters<typeof real.runExtractorStage>[0]) => {
      const mockProvider = makeMockProvider(EXTRACTED_Q1, { id: "claude-sdk" });
      return real.runExtractorStage({ ...input, provider: mockProvider });
    }),
  };
});

vi.mock("../solver", async (importOriginal) => {
  const real = await importOriginal<typeof import("../solver")>();
  return {
    ...real,
    runSolverStage: vi.fn(async (input: Parameters<typeof real.runSolverStage>[0]) => {
      const mockProvider = makeMockProvider(SOLVED_OUTPUT, { id: "deepseek-v4" });
      return real.runSolverStage({ ...input, provider: mockProvider });
    }),
  };
});

vi.mock("../verifier", async (importOriginal) => {
  const real = await importOriginal<typeof import("../verifier")>();
  return {
    ...real,
    runVerifierStage: vi.fn(async (input: Parameters<typeof real.runVerifierStage>[0]) => {
      const mockProvider = makeMockProvider(VERIFIED_OUTPUT_PASS, { id: "deepseek-v4" });
      return real.runVerifierStage({ ...input, provider: mockProvider });
    }),
  };
});

// Mock the figure stage command runner so python3 is never invoked.
// Also handles builder stage: writes a fake HWPX file and returns the expected stdout.
vi.mock("../commands", async (importOriginal) => {
  const real = await importOriginal<typeof import("../commands")>();
  const { readFile: fsReadFile, writeFile: fsWriteFile, mkdir: fsMkdir } = await import("fs/promises");
  const { default: JSZip } = await import("jszip");
  return {
    ...real,
    runStageCommand: vi.fn(async (opts: Parameters<typeof real.runStageCommand>[0]) => {
      const args = opts.args ?? [];
      const firstArg = typeof args[0] === "string" ? args[0] : "";
      // build_hwpx.py: write a fake HWPX file and return stdout with the path
      if (firstArg.endsWith("build_hwpx.py")) {
        const outputDir = typeof args[2] === "string" ? args[2] : "";
        if (outputDir) {
          await fsMkdir(outputDir, { recursive: true });
          const hwpxPath = outputDir + "/test_built.hwpx";
          const zip = new JSZip();
          zip.file("Contents/section0.xml", "<hp:sec><hp:p><hp:t>테스트</hp:t></hp:p></hp:sec>");
          await fsWriteFile(hwpxPath, await zip.generateAsync({ type: "nodebuffer" }));
          return {
            command: opts.command,
            args,
            status: "success" as const,
            exitCode: 0,
            stdout: `HWPX written: ${hwpxPath}\n`,
            stderr: "",
            signal: null,
            elapsedMs: 0,
          };
        }
      }
      if (firstArg.endsWith("figure_processor.py")) {
        const examDataIdx = args.indexOf("--exam-data");
        const outputDirIdx = args.indexOf("--output-dir");
        const statusIdx = args.indexOf("--status-out");
        const examDataPath = examDataIdx >= 0 ? args[examDataIdx + 1] : undefined;
        const outputDir = outputDirIdx >= 0 ? args[outputDirIdx + 1] : undefined;
        const statusOutPath = statusIdx >= 0 ? args[statusIdx + 1] : undefined;
        if (typeof examDataPath === "string" && typeof outputDir === "string" && typeof statusOutPath === "string") {
          const examData = JSON.parse(await fsReadFile(examDataPath, "utf8")) as {
            problems?: Array<{ number?: number }>;
          };
          const questions: Record<string, { status: "ok"; finalImage: string; boundaryUncertain: false }> = {};
          await fsMkdir(outputDir, { recursive: true });
          for (const problem of examData.problems ?? []) {
            const n = problem.number;
            if (typeof n !== "number") continue;
            const finalImage = path.join(outputDir, `prob${n}_final.png`);
            await fsWriteFile(finalImage, "fake-image", "utf8");
            questions[String(n)] = { status: "ok", finalImage, boundaryUncertain: false };
          }
          await fsMkdir(path.dirname(statusOutPath), { recursive: true });
          await fsWriteFile(statusOutPath, JSON.stringify({ status: "done", questions }, null, 2), "utf8");
        }
      }
      // All other commands (fix_namespaces, validate, figure_processor): return success
      return {
        command: opts.command,
        args,
        status: "success" as const,
        exitCode: 0,
        stdout: "",
        stderr: "",
        signal: null,
        elapsedMs: 0,
      };
    }),
  };
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orch-int-test-"));
  tempDirs.push(dir);
  return dir;
}

/** Complete meta satisfying assertCompleteMeta — used by e2e tests that reach buildExamDataJson. */
const COMPLETE_META = {
  schoolLevel: "고" as const,
  school: "테스트고",
  grade: 2,
  year: 2025,
  subject: "수학",
  semester: "1학기",
  examType: "중간",
  range: "전범위",
};

async function makeCache(baseDir: string): Promise<FileBackedStageCache> {
  const examDir = path.join(baseDir, "inputs", "시험지 제작");
  await mkdir(path.join(examDir, ".v3cache"), { recursive: true });
  await mkdir(path.join(examDir, "question_images"), { recursive: true });
  return new FileBackedStageCache(examDir);
}

function makeSseCollector(): { events: SSEEvent[]; send: (e: SSEEvent) => void } {
  const events: SSEEvent[] = [];
  return { events, send: (e) => events.push(e) };
}

/** Pre-populate cache so the orchestrator can resume from a given stage. */
async function prepopulateSolverCache(cache: FileBackedStageCache, questionNums: number[]): Promise<void> {
  await cache.ensureCacheDir();
  for (const n of questionNums) {
    const extractedFixture = path.join(FIXTURES_DIR, "extracted", `q0${n}.json`);
    const extractedContent = await readFile(extractedFixture, "utf8");
    await writeFile(cache.extractorResultPath(n), extractedContent, "utf8");
  }
}

async function prepopulateBuilderCache(cache: FileBackedStageCache, questionNums: number[]): Promise<void> {
  await cache.ensureCacheDir();
  for (const n of questionNums) {
    const solvedFixture = path.join(FIXTURES_DIR, "solved", `q0${n}.json`);
    const verifiedFixture = path.join(FIXTURES_DIR, "verified", `q0${n}.json`);
    await writeFile(cache.solverResultPath(n), await readFile(solvedFixture, "utf8"), "utf8");
    await writeFile(cache.verifierResultPath(n), await readFile(verifiedFixture, "utf8"), "utf8");
  }
  const examData = {
    info: { school: "테스트고", grade: 2, subject: "수학" },
    problems: [EXTRACTED_Q1, EXTRACTED_Q2, EXTRACTED_Q3],
  };
  await writeFile(cache.paths.examData, `${JSON.stringify(examData, null, 2)}\n`, "utf8");
  const figureStatusFixture = await readFile(
    path.join(FIXTURES_DIR, "figure_status.success.json"),
    "utf8"
  );
  await writeFile(cache.paths.figureStatus, figureStatusFixture, "utf8");
}
void prepopulateBuilderCache;

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("orchestrator.integration — 3-question mock e2e", () => {
  let baseDir: string;
  let cache: FileBackedStageCache;

  beforeEach(async () => {
    baseDir = await makeTempDir();
    cache = await makeCache(baseDir);
    await mkdir(path.join(baseDir, "outputs"), { recursive: true });
  });

  it("solver → verifier → figure → builder → checker: returns done status", async () => {
    const { send } = makeSseCollector();
    const questionNums = [1, 2, 3];
    const questionImages = questionNums.map((n) => ({
      number: n,
      path: path.join(FIXTURES_DIR, `q0${n}.png`),
    }));

    // Pre-write extracted cache so we can resume from solver.
    await prepopulateSolverCache(cache, questionNums);

    const { runStageOrchestrator } = await import("../orchestrator");

    const result = await runStageOrchestrator({
      mode: "resume",
      resumeFrom: "solver",
      meta: COMPLETE_META,
      questionImages,
      stageOverrides: {
        "create.extractor": "claude-sdk",
        "create.solver": "deepseek-v4",
        "create.verifier": "deepseek-v4",
      },
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    expect(result.status, result.resultSummary).toBe("done");
    expect(Array.isArray(result.providerTelemetry)).toBe(true);

    // Solver telemetry: 1 entry per question (3 total).
    const solverEntries = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "create.solver"
    );
    expect(solverEntries.length).toBeGreaterThanOrEqual(3);

    // Verifier telemetry: 1 entry per question (3 total, pass on first try).
    const verifierEntries = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "create.verifier"
    );
    expect(verifierEntries.length).toBeGreaterThanOrEqual(3);

    // Builder + checker telemetry (1 each).
    const builderEntries = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "builder"
    );
    const checkerEntries = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "checker"
    );
    expect(builderEntries).toHaveLength(1);
    expect(checkerEntries).toHaveLength(1);

    // Total telemetry entries: 3 solver + 3 verifier + 1 builder + 1 checker = 8
    // (no retries since verifier passes first time)
    expect(result.providerTelemetry.length).toBeGreaterThanOrEqual(6);
  }, 30_000);

  it("resume(auto) after figure+build complete: recovers hwpxPath from build_status.json", async () => {
    const questionNums = [1, 2, 3];
    const questionImages = questionNums.map((n) => ({
      number: n,
      path: path.join(FIXTURES_DIR, `q0${n}.png`),
    }));
    const stageOverrides = {
      "create.extractor": "claude-sdk",
      "create.solver": "deepseek-v4",
      "create.verifier": "deepseek-v4",
    } as const;

    await prepopulateSolverCache(cache, questionNums);
    const { runStageOrchestrator } = await import("../orchestrator");

    // 1st run: full pipeline writes figure_status.json + build_status.json + HWPX.
    const first = await runStageOrchestrator({
      mode: "resume",
      resumeFrom: "solver",
      meta: COMPLETE_META,
      questionImages,
      stageOverrides,
      defaultProvider: "auto",
      baseDir,
      send: makeSseCollector().send,
      isAborted: () => false,
      cache,
    });
    expect(first.status, first.resultSummary).toBe("done");

    // 2nd run: [작업 재개] → resumeFrom:"auto". detectFromCache sees figure+build
    // done → startStage="checker", so builder is skipped and outputFile is empty.
    // The orchestrator must recover hwpxPath from build_status.json instead of
    // failing with "Checker requires hwpxPath, sectionXmlPath, or sectionXml".
    const second = await runStageOrchestrator({
      mode: "resume",
      resumeFrom: "auto",
      meta: COMPLETE_META,
      questionImages,
      stageOverrides,
      defaultProvider: "auto",
      baseDir,
      send: makeSseCollector().send,
      isAborted: () => false,
      cache,
    });

    expect(second.status, second.resultSummary).toBe("done");
    // builder must NOT re-run (startStage resolved to checker, not builder).
    expect(
      second.providerTelemetry.filter((e) => e.workflowStageKey === "builder")
    ).toHaveLength(0);
    // checker still runs and passes against the recovered HWPX path.
    const checkerEntries = second.providerTelemetry.filter(
      (e) => e.workflowStageKey === "checker"
    );
    expect(checkerEntries).toHaveLength(1);
    expect(checkerEntries[0]?.status).toBe("success");
  }, 30_000);

  it("solver stage emits SSE events for all 3 questions", async () => {
    const { events, send } = makeSseCollector();
    const questionNums = [1, 2, 3];
    const questionImages = questionNums.map((n) => ({
      number: n,
      path: path.join(FIXTURES_DIR, `q0${n}.png`),
    }));

    await prepopulateSolverCache(cache, questionNums);

    const { runStageOrchestrator } = await import("../orchestrator");

    await runStageOrchestrator({
      mode: "resume",
      resumeFrom: "solver",
      meta: COMPLETE_META,
      questionImages,
      stageOverrides: {
        "create.extractor": "claude-sdk",
        "create.solver": "deepseek-v4",
        "create.verifier": "deepseek-v4",
      },
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    // solver and verifier stage events should be emitted.
    const solverStageEvent = events.find(
      (e) => e.event === "stage" && (e.data as Record<string, unknown>).name === "solver"
    );
    expect(solverStageEvent).toBeDefined();

    const verifierStageEvent = events.find(
      (e) => e.event === "stage" && (e.data as Record<string, unknown>).name === "verifier"
    );
    expect(verifierStageEvent).toBeDefined();

    // No extraction_review — we started from solver.
    const reviewEvent = events.find((e) => e.event === "extraction_review");
    expect(reviewEvent).toBeUndefined();

    // Should have question events for all 3 problems (solved + verified).
    const questionEvents = events.filter((e) => e.event === "question");
    expect(questionEvents.length).toBeGreaterThanOrEqual(6); // 3 solved + 3 verified
  }, 30_000);

  it("full pipeline from create: extractor → solver → verifier → done (per-question, no pause)", async () => {
    // Per-question pipeline: extractor runs, then immediately flows to solver+verifier.
    // No extraction_review pause — auto-continue to solver.
    const { events, send } = makeSseCollector();
    const questionNums = [1, 2, 3];
    const questionImages = questionNums.map((n) => ({
      number: n,
      path: path.join(FIXTURES_DIR, `q0${n}.png`),
    }));

    const { runStageOrchestrator } = await import("../orchestrator");

    const result = await runStageOrchestrator({
      mode: "create",
      meta: COMPLETE_META,
      questionImages,
      stageOverrides: {
        "create.extractor": "claude-sdk",
        "create.solver": "deepseek-v4",
        "create.verifier": "deepseek-v4",
      },
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    // Full pipeline should complete to done.
    expect(result.status, result.resultSummary).toBe("done");
    expect(Array.isArray(result.providerTelemetry)).toBe(true);

    // Per-question incremental extraction_review events should be emitted (one per question).
    const reviewEvents = events.filter((e) => e.event === "extraction_review");
    expect(reviewEvents.length).toBeGreaterThanOrEqual(3);

    // At least extractor + solver + verifier telemetry (3+3+3 = 9).
    expect(result.providerTelemetry.length).toBeGreaterThanOrEqual(9);
  }, 60_000);

  it("abort mid-run: returns cancelled status", async () => {
    const { send } = makeSseCollector();
    const questionNums = [1, 2, 3];

    await prepopulateSolverCache(cache, questionNums);

    const { runStageOrchestrator } = await import("../orchestrator");

    let callCount = 0;
    const result = await runStageOrchestrator({
      mode: "resume",
      resumeFrom: "solver",
      meta: {},
      questionImages: questionNums.map((n) => ({
        number: n,
        path: path.join(FIXTURES_DIR, `q0${n}.png`),
      })),
      stageOverrides: {},
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => {
        // Abort after first poll.
        callCount++;
        return callCount >= 1;
      },
      cache,
    });

    expect(result.status).toBe("cancelled");
    expect(Array.isArray(result.providerTelemetry)).toBe(true);
  }, 15_000);

  it("verifier pass-on-first-try: providerTelemetry has exactly 3 verifier entries", async () => {
    const { send } = makeSseCollector();
    const questionNums = [1, 2, 3];

    await prepopulateSolverCache(cache, questionNums);

    const { runStageOrchestrator } = await import("../orchestrator");

    const result = await runStageOrchestrator({
      mode: "resume",
      resumeFrom: "solver",
      meta: COMPLETE_META,
      questionImages: questionNums.map((n) => ({
        number: n,
        path: path.join(FIXTURES_DIR, `q0${n}.png`),
      })),
      stageOverrides: {
        "create.solver": "deepseek-v4",
        "create.verifier": "deepseek-v4",
      },
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    expect(result.status, result.resultSummary).toBe("done");

    // Verifier passes on first try for all 3 questions → exactly 3 entries.
    const verifierEntries = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "create.verifier"
    );
    expect(verifierEntries).toHaveLength(3);

    // All verifier entries should be successful (pass).
    for (const entry of verifierEntries) {
      expect(entry.status).toBe("success");
      expect(entry.retry).toBe(false);
    }
  }, 30_000);

  it("figure: auto-downgrades to --no-regen when no Gemini/Google API key is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("EXAM_STUDIO_DISABLE_RUNTIME_ENV", "1");

    try {
      const { events, send } = makeSseCollector();
      const questionNums = [1, 2, 3];
      const questionImages = questionNums.map((n) => ({
        number: n,
        path: path.join(FIXTURES_DIR, `q0${n}.png`),
      }));

      await prepopulateSolverCache(cache, questionNums);

      const { runStageOrchestrator } = await import("../orchestrator");
      const { runStageCommand } = await import("../commands");
      const spy = vi.mocked(runStageCommand);
      spy.mockClear();

      const result = await runStageOrchestrator({
        mode: "resume",
        resumeFrom: "solver",
        meta: COMPLETE_META,
        questionImages,
        stageOverrides: {
          "create.solver": "deepseek-v4",
          "create.verifier": "deepseek-v4",
        },
        defaultProvider: "auto",
        figureRegen: true,
        baseDir,
        send,
        isAborted: () => false,
        cache,
      });

      expect(result.status, result.resultSummary).toBe("done");

      const figureCall = spy.mock.calls.find((call) =>
        (call[0].args ?? []).some(
          (a) => typeof a === "string" && a.endsWith("figure_processor.py")
        )
      );
      expect(figureCall).toBeDefined();
      expect(figureCall![0].args).toContain("--no-regen");

      const warnLog = events.find((e) => {
        if (e.event !== "log") return false;
        const d = e.data as Record<string, unknown>;
        return d.level === "warn"
          && typeof d.message === "string"
          && d.message.includes("crop 폴백");
      });
      expect(warnLog).toBeDefined();
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 7: Cross-language normalizer parity
//
// For every fixture in tests/fixtures/parts_normalization/, verify that
// TS normalizeParts and Python normalize_parts produce byte-level equal JSON.
//
// Python is invoked via spawnSync so the test remains deterministic and
// does not require a live API key.
// ────────────────────────────────────────────────────────────────────────────

const PARTS_FIXTURES_DIR = path.resolve(__dirname, "../../../tests/fixtures/parts_normalization");
const PYTHON_EQUATION_PY = path.resolve(__dirname, "../../../../equation.py");

/**
 * Run Python normalize_parts on the given parts JSON string.
 * Returns parsed result or throws if Python process fails.
 *
 * Data is passed via stdin to avoid shell quoting/escaping issues with
 * arbitrary JSON content (e.g. single quotes, backslashes in part text).
 */
function runPythonNormalize(partsJson: string): unknown[] {
  const pythonBin = process.platform === "win32" ? "python" : "python3";
  // Read JSON from stdin to avoid embedding arbitrary JSON in script string literals.
  const script = [
    "import json, sys, os",
    `sys.path.insert(0, os.path.dirname(r'${PYTHON_EQUATION_PY}'))`,
    "from equation import normalize_parts",
    "result = normalize_parts(json.loads(sys.stdin.read()))",
    "print(json.dumps(result, ensure_ascii=False))",
  ].join("\n");

  const proc = spawnSync(pythonBin, ["-c", script], {
    input: partsJson,
    encoding: "utf8",
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    timeout: 10_000,
  });

  if (proc.error) {
    throw new Error(`Python spawn error: ${proc.error.message}`);
  }
  if (proc.status !== 0) {
    throw new Error(`Python exited ${proc.status}: ${proc.stderr}`);
  }
  return JSON.parse(proc.stdout.trim()) as unknown[];
}

describe("Phase 7: normalizer parity — TS == Python for all fixtures", () => {
  // Discover all fixture files synchronously (test collection time).
  const fixtureFiles = readdirSyncNode(PARTS_FIXTURES_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .sort();

  for (const file of fixtureFiles) {
    it(`parity: ${path.basename(file, ".json")}`, async () => {
      const { normalizeParts } = await import("@/lib/parts/normalize");

      const content = await readFile(path.join(PARTS_FIXTURES_DIR, file), "utf8");
      const fx = JSON.parse(content) as {
        id: string;
        input: { parts: Parameters<typeof normalizeParts>[0] };
        expected: { parts: unknown[] };
      };

      // TS result
      const tsResult = normalizeParts(fx.input.parts);

      // Python result (subprocess)
      const partsJson = JSON.stringify(fx.input.parts);
      const pyResult = runPythonNormalize(partsJson);

      // Both should match expected
      expect(tsResult).toEqual(fx.expected.parts);
      expect(pyResult).toEqual(fx.expected.parts);

      // Cross-language byte-level equality (canonical JSON comparison)
      expect(JSON.stringify(tsResult)).toBe(JSON.stringify(pyResult));
    });
  }
});
