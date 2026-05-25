/**
 * orchestrator.pipeline.test.ts
 *
 * Phase 6 — End-to-end mock codex smoke test.
 *
 * Strategy:
 *  - Mock all AI-calling stage runners (extractor, solver, verifier) so that
 *    per-question responses can be injected deterministically, simulating exam-rich
 *    codex responses without real API keys.
 *  - 4 scenarios:
 *    (A) full success — 3 questions, all verifier pass on first try
 *    (B) partial fail — Q2 extractor fails, Q1/Q3 continue through verifier
 *    (C) disk resume  — Q1 already has extracted+solved cache; verifier is the only new stage
 *    (D) interleaved logs — Q1 fast, Q3 slow; Q1 verify before Q3 extract
 *
 * Key invariant:
 *  - exam-rich fixture shapes in mockCodexResponses.ts must pass the real validators.
 *  - If validators reject the fixture, the test surfaces a contract break.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import type { AIProviderAdapter } from "@/lib/ai/types";
import type { SSEEvent } from "@/lib/claude";
import { FileBackedStageCache } from "../cache";
import type { ExtractorStageInput } from "../extractor";
import type { SolverStageInput } from "../solver";
import type { VerifierStageInput } from "../verifier";
import {
  MOCK_EXTRACTOR_RESPONSE_Q1,
  MOCK_EXTRACTOR_RESPONSE_Q2,
  MOCK_EXTRACTOR_RESPONSE_Q3,
  MOCK_SOLVER_RESPONSE_Q1,
  MOCK_SOLVER_RESPONSE_Q2,
  MOCK_SOLVER_RESPONSE_Q3,
  MOCK_VERIFIER_RESPONSE_Q1_PASS,
  MOCK_VERIFIER_RESPONSE_Q2_PASS,
  MOCK_VERIFIER_RESPONSE_Q3_PASS,
  MOCK_VERIFIER_RESPONSE_Q1_FAIL,
} from "./fixtures/mockCodexResponses";

// ────────────────────────────────────────────────────────────────────────────
// Per-question response maps — module-level mutable state injected before each test
// ────────────────────────────────────────────────────────────────────────────

/** Map from question number → extractor response (undefined = make provider fail) */
const extractorResponses: Map<number, unknown> = new Map();
/** Map from question number → solver response */
const solverResponses: Map<number, unknown> = new Map();
/**
 * Map from question number → verifier response queue.
 * Each call pops from the front; if empty, defaults to pass.
 */
const verifierQueues: Map<number, unknown[]> = new Map();

/** Per-stage delay overrides (ms) for interleaved ordering test. */
const stageDelays: { extractor: Map<number, number>; solver: Map<number, number>; verifier: Map<number, number> } = {
  extractor: new Map(),
  solver: new Map(),
  verifier: new Map(),
};

/**
 * Per-question Promise barriers.  When set, the extractor mock awaits the
 * barrier before proceeding — allows deterministic ordering without real timers.
 */
const extractorBarriers: Map<number, Promise<void>> = new Map();

function resetMockState(): void {
  extractorResponses.clear();
  solverResponses.clear();
  verifierQueues.clear();
  stageDelays.extractor.clear();
  stageDelays.solver.clear();
  stageDelays.verifier.clear();
  extractorBarriers.clear();
}

// ────────────────────────────────────────────────────────────────────────────
// Mock provider builder — injects into stage runners via vi.mock
// ────────────────────────────────────────────────────────────────────────────

function makeMockProvider(
  responseJson: unknown,
  opts: { id?: AIProviderAdapter["id"]; delayMs?: number } = {}
): AIProviderAdapter {
  const id = opts.id ?? "claude-sdk";
  const delayMs = opts.delayMs ?? 0;
  const text = typeof responseJson === "string" ? responseJson : JSON.stringify(responseJson);

  return {
    id,
    label: `Mock(${id})`,
    supportsTools: true as const,
    run() {
      async function* events() {
        if (delayMs > 0) {
          await new Promise<void>((r) => setTimeout(r, delayMs));
        }
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

function makeFailProvider(opts: { id?: AIProviderAdapter["id"] } = {}): AIProviderAdapter {
  const id = opts.id ?? "claude-sdk";
  return {
    id,
    label: `FailMock(${id})`,
    supportsTools: true as const,
    run() {
      async function* events() {
        yield { type: "result" as const, subtype: "error" as const, result: "provider failed" };
      }
      let resolveExit!: (n: number) => void;
      const exitCodePromise = new Promise<number>((r) => { resolveExit = r; });
      const eventsAsync = (async function* () {
        for await (const e of events()) yield e;
        resolveExit(1);
      })();
      return {
        process: {} as import("child_process").ChildProcess,
        events: eventsAsync,
        exitCode: exitCodePromise,
        metadata: { requestedProvider: id, provider: id, label: `FailMock(${id})` },
      };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// vi.mock — intercept stage runners, inject per-question responses
// ────────────────────────────────────────────────────────────────────────────

vi.mock("../extractor", async (importOriginal) => {
  const real = await importOriginal<typeof import("../extractor")>();
  return {
    ...real,
    runExtractorStage: vi.fn(async (input: ExtractorStageInput) => {
      const n = input.questionNumber;
      // If a deterministic barrier is set for this question, await it first
      // before any provider call.  This allows tests to control ordering
      // without relying on real wall-clock timers.
      const barrier = extractorBarriers.get(n);
      if (barrier !== undefined) {
        await barrier;
      }
      const response = extractorResponses.get(n);
      if (response === undefined) {
        // Question not in map → simulate provider failure
        return real.runExtractorStage({ ...input, provider: makeFailProvider() });
      }
      const delayMs = stageDelays.extractor.get(n) ?? 0;
      const provider = makeMockProvider(response, { id: "claude-sdk", delayMs });
      return real.runExtractorStage({ ...input, provider });
    }),
  };
});

vi.mock("../solver", async (importOriginal) => {
  const real = await importOriginal<typeof import("../solver")>();
  return {
    ...real,
    runSolverStage: vi.fn(async (input: SolverStageInput) => {
      const n = input.questionNumber;
      const response = solverResponses.get(n) ?? MOCK_SOLVER_RESPONSE_Q1;
      const delayMs = stageDelays.solver.get(n) ?? 0;
      const provider = makeMockProvider(response, { id: "deepseek-v4", delayMs });
      return real.runSolverStage({ ...input, provider });
    }),
  };
});

vi.mock("../verifier", async (importOriginal) => {
  const real = await importOriginal<typeof import("../verifier")>();
  return {
    ...real,
    runVerifierStage: vi.fn(async (input: VerifierStageInput) => {
      const n = input.questionNumber;
      const queue = verifierQueues.get(n);
      // Pop next response from queue, or default to pass
      const response =
        queue && queue.length > 0
          ? queue.shift()
          : MOCK_VERIFIER_RESPONSE_Q1_PASS;
      const delayMs = stageDelays.verifier.get(n) ?? 0;
      const provider = makeMockProvider(response, { id: "deepseek-v4", delayMs });
      return real.runVerifierStage({ ...input, provider });
    }),
  };
});

vi.mock("../commands", async (importOriginal) => {
  const real = await importOriginal<typeof import("../commands")>();
  const { readFile: fsReadFile, writeFile: fsWriteFile, mkdir: fsMkdir } = await import("fs/promises");
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
          await fsWriteFile(hwpxPath, "fake-hwpx-content", "utf8");
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
      // figure_processor.py: write the status file that figureRunner expects.
      if (firstArg.endsWith("figure_processor.py")) {
        const examDataPath = args[args.indexOf("--exam-data") + 1];
        const outputDir = args[args.indexOf("--output-dir") + 1];
        const statusOutPath = args[args.indexOf("--status-out") + 1];
        if (typeof examDataPath === "string" && typeof outputDir === "string" && typeof statusOutPath === "string") {
          const examData = JSON.parse(await fsReadFile(examDataPath, "utf8")) as {
            problems?: Array<{ number?: number }>;
          };
          await fsMkdir(outputDir, { recursive: true });
          const questions: Record<string, { status: "ok"; finalImage: string; boundaryUncertain: false }> = {};
          for (const problem of examData.problems ?? []) {
            const n = problem.number;
            if (typeof n !== "number") continue;
            const finalImage = path.join(outputDir, `prob${n}_final.png`);
            await fsWriteFile(finalImage, "fake-image", "utf8");
            questions[String(n)] = { status: "ok", finalImage, boundaryUncertain: false };
          }
          await fsWriteFile(
            statusOutPath,
            JSON.stringify({ status: "done", questions }, null, 2),
            "utf8"
          );
        }
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
      }
      // All other commands (fix_namespaces, validate): return success
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
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  resetMockState();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pipeline-test-"));
  tempDirs.push(dir);
  return dir;
}

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

const QUESTION_NUMS = [1, 2, 3];
const STAGE_OVERRIDES = {
  "create.extractor": "claude-sdk" as const,
  "create.solver": "deepseek-v4" as const,
  "create.verifier": "deepseek-v4" as const,
};

/** Complete meta satisfying assertCompleteMeta — used by pipeline tests that reach buildExamDataJson. */
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

// ────────────────────────────────────────────────────────────────────────────
// Scenario A: Full success — 3 questions, all verifier pass on first try
// ────────────────────────────────────────────────────────────────────────────

describe("orchestrator per-question pipeline", () => {
  let baseDir: string;
  let cache: FileBackedStageCache;

  beforeEach(async () => {
    baseDir = await makeTempDir();
    cache = await makeCache(baseDir);
    await mkdir(path.join(baseDir, "outputs"), { recursive: true });
  });

  it("(A) 3 question full success — extractor → solver → verifier all pass", async () => {
    // Inject exam-rich extractor responses for Q1-Q3
    extractorResponses.set(1, MOCK_EXTRACTOR_RESPONSE_Q1);
    extractorResponses.set(2, MOCK_EXTRACTOR_RESPONSE_Q2);
    extractorResponses.set(3, MOCK_EXTRACTOR_RESPONSE_Q3);

    // Solver responses
    solverResponses.set(1, MOCK_SOLVER_RESPONSE_Q1);
    solverResponses.set(2, MOCK_SOLVER_RESPONSE_Q2);
    solverResponses.set(3, MOCK_SOLVER_RESPONSE_Q3);

    // Verifier queues — all pass on first try
    verifierQueues.set(1, [MOCK_VERIFIER_RESPONSE_Q1_PASS]);
    verifierQueues.set(2, [MOCK_VERIFIER_RESPONSE_Q2_PASS]);
    verifierQueues.set(3, [MOCK_VERIFIER_RESPONSE_Q3_PASS]);

    const { events, send } = makeSseCollector();
    const questionImages = QUESTION_NUMS.map((n) => ({ number: n, path: `/fake/q0${n}.png` }));

    const { runStageOrchestrator } = await import("../orchestrator");
    const result = await runStageOrchestrator({
      mode: "create",
      meta: COMPLETE_META,
      questionImages,
      stageOverrides: STAGE_OVERRIDES,
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    // ── Result ──────────────────────────────────────────────────────────────
    expect(result.status).toBe("done");
    expect(Array.isArray(result.providerTelemetry)).toBe(true);

    // ── Stage events: extractor running → done ───────────────────────────
    const extractorRunning = events.filter(
      (e) => e.event === "stage" && (e.data as Record<string, unknown>).name === "extractor"
        && (e.data as Record<string, unknown>).status === "running"
    );
    expect(extractorRunning).toHaveLength(1);

    const extractorDone = events.filter(
      (e) => e.event === "stage" && (e.data as Record<string, unknown>).name === "extractor"
        && (e.data as Record<string, unknown>).status === "done"
    );
    expect(extractorDone).toHaveLength(1);

    // ── Stage events: solver running → done ──────────────────────────────
    const solverRunning = events.filter(
      (e) => e.event === "stage" && (e.data as Record<string, unknown>).name === "solver"
        && (e.data as Record<string, unknown>).status === "running"
    );
    expect(solverRunning).toHaveLength(1);

    const solverDone = events.filter(
      (e) => e.event === "stage" && (e.data as Record<string, unknown>).name === "solver"
        && (e.data as Record<string, unknown>).status === "done"
    );
    expect(solverDone).toHaveLength(1);

    // ── Stage events: verifier running → done ────────────────────────────
    const verifierRunning = events.filter(
      (e) => e.event === "stage" && (e.data as Record<string, unknown>).name === "verifier"
        && (e.data as Record<string, unknown>).status === "running"
    );
    expect(verifierRunning).toHaveLength(1);

    const verifierDone = events.filter(
      (e) => e.event === "stage" && (e.data as Record<string, unknown>).name === "verifier"
        && (e.data as Record<string, unknown>).status === "done"
    );
    expect(verifierDone).toHaveLength(1);

    // ── Per-question events: extracted, solved, verified for each question ─
    const extractedEvents = events.filter(
      (e) => e.event === "question" && (e.data as Record<string, unknown>).stage === "extracted"
    );
    expect(extractedEvents).toHaveLength(3);

    const solvedEvents = events.filter(
      (e) => e.event === "question" && (e.data as Record<string, unknown>).stage === "solved"
    );
    expect(solvedEvents).toHaveLength(3);

    const verifiedEvents = events.filter(
      (e) => e.event === "question" && (e.data as Record<string, unknown>).stage === "verified"
    );
    expect(verifiedEvents).toHaveLength(3);

    // ── extraction_review incremental events (one per question) ───────────
    const incrementalReviewEvents = events.filter(
      (e) => e.event === "extraction_review"
        && typeof (e.data as Record<string, unknown>).number === "number"
    );
    expect(incrementalReviewEvents).toHaveLength(3);

    // ── Telemetry: 3 extractor + 3 solver + 3 verifier = 9 minimum ────────
    expect(result.providerTelemetry.length).toBeGreaterThanOrEqual(9);

    const extractorTelemetry = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "create.extractor"
    );
    expect(extractorTelemetry).toHaveLength(3);

    const solverTelemetry = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "create.solver"
    );
    expect(solverTelemetry).toHaveLength(3);

    const verifierTelemetry = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "create.verifier"
    );
    expect(verifierTelemetry).toHaveLength(3);

    // All verifier entries should be pass (no retries)
    for (const entry of verifierTelemetry) {
      expect(entry.status).toBe("success");
      expect(entry.retry).toBe(false);
    }
  }, 60_000);

  // ────────────────────────────────────────────────────────────────────────
  // Scenario B: Partial fail — Q2 extractor fails, Q1/Q3 succeed
  // ────────────────────────────────────────────────────────────────────────

  it("(B) partial fail — Q2 extractor fails, Q1/Q3 pass through verifier", async () => {
    // Q1 and Q3 succeed; Q2 not injected → makeFailProvider fires
    extractorResponses.set(1, MOCK_EXTRACTOR_RESPONSE_Q1);
    // Q2 is intentionally not set → fails with provider error
    extractorResponses.set(3, MOCK_EXTRACTOR_RESPONSE_Q3);

    solverResponses.set(1, MOCK_SOLVER_RESPONSE_Q1);
    solverResponses.set(3, MOCK_SOLVER_RESPONSE_Q3);

    verifierQueues.set(1, [MOCK_VERIFIER_RESPONSE_Q1_PASS]);
    verifierQueues.set(3, [MOCK_VERIFIER_RESPONSE_Q3_PASS]);

    const { events, send } = makeSseCollector();
    const questionImages = QUESTION_NUMS.map((n) => ({ number: n, path: `/fake/q0${n}.png` }));

    const { runStageOrchestrator } = await import("../orchestrator");
    const result = await runStageOrchestrator({
      mode: "create",
      meta: COMPLETE_META,
      questionImages,
      stageOverrides: STAGE_OVERRIDES,
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    // Pipeline processes Q1/Q3; orchestrator filters Q2 from buildExamDataJson
    // input so the surviving 2 questions form a usable exam_data.json (partial-skip).
    expect(result.status).toBe("done");

    // ── Extractor stage should be "done" (2 of 3 succeeded) ──────────────
    const extractorStageEvents = events.filter(
      (e) => e.event === "stage" && (e.data as Record<string, unknown>).name === "extractor"
    );
    // At minimum: running + done/failed
    expect(extractorStageEvents.length).toBeGreaterThanOrEqual(2);

    // extractor summary should be "done" (not "failed") since 2/3 succeeded
    const extractorDoneEvent = extractorStageEvents.find(
      (e) => (e.data as Record<string, unknown>).status === "done"
    );
    expect(extractorDoneEvent).toBeDefined();

    // ── Q2 should have a failed question event at extracted stage ──────────
    const q2FailedEvent = events.find(
      (e) => e.event === "question"
        && (e.data as Record<string, unknown>).number === 2
        && (e.data as Record<string, unknown>).stage === "extracted"
        && (e.data as Record<string, unknown>).status === "failed"
    );
    expect(q2FailedEvent).toBeDefined();

    // ── Q1 and Q3 should succeed through solver and verifier ───────────────
    const q1VerifiedOk = events.find(
      (e) => e.event === "question"
        && (e.data as Record<string, unknown>).number === 1
        && (e.data as Record<string, unknown>).stage === "verified"
        && (e.data as Record<string, unknown>).status === "ok"
    );
    expect(q1VerifiedOk).toBeDefined();

    const q3VerifiedOk = events.find(
      (e) => e.event === "question"
        && (e.data as Record<string, unknown>).number === 3
        && (e.data as Record<string, unknown>).stage === "verified"
        && (e.data as Record<string, unknown>).status === "ok"
    );
    expect(q3VerifiedOk).toBeDefined();

    // ── Solver/verifier telemetry for Q1 and Q3 only ──────────────────────
    const solverTelemetry = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "create.solver"
    );
    // Q2 never reaches solver, so exactly 2 solver entries
    expect(solverTelemetry).toHaveLength(2);

    const verifierTelemetry = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "create.verifier"
    );
    expect(verifierTelemetry).toHaveLength(2);
  }, 60_000);

  // ────────────────────────────────────────────────────────────────────────
  // Scenario C: Disk resume — Q1 already extracted+solved, verifier is new
  // ────────────────────────────────────────────────────────────────────────

  it("(C) disk resume — Q1 extracted+solved already cached, only verifier runs", async () => {
    // Pre-write Q1 extractor and solver cache files
    await cache.ensureCacheDir();
    await writeFile(
      cache.extractorResultPath(1),
      `${JSON.stringify(MOCK_EXTRACTOR_RESPONSE_Q1, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      cache.solverResultPath(1),
      `${JSON.stringify(MOCK_SOLVER_RESPONSE_Q1, null, 2)}\n`,
      "utf8"
    );

    // Verifier will run (not cached)
    verifierQueues.set(1, [MOCK_VERIFIER_RESPONSE_Q1_PASS]);

    const { events, send } = makeSseCollector();
    const { runExtractorStage } = await import("../extractor");
    const { runSolverStage } = await import("../solver");
    const { runVerifierStage } = await import("../verifier");

    // Reset call counts before the test run
    vi.clearAllMocks();

    const { runStageOrchestrator } = await import("../orchestrator");
    const result = await runStageOrchestrator({
      mode: "resume",
      resumeFrom: "extractor",
      meta: COMPLETE_META,
      questionImages: [{ number: 1, path: "/fake/q01.png" }],
      stageOverrides: STAGE_OVERRIDES,
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    expect(result.status).toBe("done");

    // ── Extractor and solver should NOT have been called (disk resume) ─────
    expect(runExtractorStage).not.toHaveBeenCalled();
    expect(runSolverStage).not.toHaveBeenCalled();

    // ── Verifier should have been called exactly once ─────────────────────
    expect(runVerifierStage).toHaveBeenCalledTimes(1);

    // ── Verifier telemetry should have exactly 1 entry ────────────────────
    const verifierTelemetry = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "create.verifier"
    );
    expect(verifierTelemetry).toHaveLength(1);
    expect(verifierTelemetry[0]?.status).toBe("success");

    // ── Cache-hit emit: extracted/solved 결과가 SSE로 흘러나와야 한다 ─────
    // Navigator dot이 캐시 hit 상태도 정확히 반영하려면 신규 계산과 동일한
    // event=question 이벤트가 emit되어야 한다.
    const extractedEvent = events.find(
      (e) =>
        e.event === "question"
        && (e.data as Record<string, unknown>).stage === "extracted"
        && (e.data as Record<string, unknown>).number === 1
    );
    expect(extractedEvent).toBeDefined();
    expect((extractedEvent!.data as Record<string, unknown>).status).toBe("ok");
    expect((extractedEvent!.data as Record<string, unknown>).data).toEqual(MOCK_EXTRACTOR_RESPONSE_Q1);

    const solvedEvent = events.find(
      (e) =>
        e.event === "question"
        && (e.data as Record<string, unknown>).stage === "solved"
        && (e.data as Record<string, unknown>).number === 1
    );
    expect(solvedEvent).toBeDefined();
    expect((solvedEvent!.data as Record<string, unknown>).status).toBe("ok");
    expect((solvedEvent!.data as Record<string, unknown>).data).toEqual(MOCK_SOLVER_RESPONSE_Q1);
  }, 30_000);

  // ────────────────────────────────────────────────────────────────────────
  // Scenario D: Interleaved logs — Q1 fast, Q3 slow; Q1 verify before Q3 extract
  // ────────────────────────────────────────────────────────────────────────

  it("(D) interleaved logs — Q1 fast, Q3 slow; Q1 verified event before Q3 extracted event", async () => {
    // Strategy: Q3's extractor is held behind a barrier Promise (in
    // extractorBarriers) that is resolved from outside.  Because Q1 has zero
    // delays (pure microtask resolution), its entire pipeline drains before we
    // release Q3.  This avoids real wall-clock timers entirely and is safe on CI.

    // Create barrier for Q3 — stored in the module-level map read by the mock
    let releaseQ3Extractor!: () => void;
    const q3ExtractorBarrier = new Promise<void>((resolve) => {
      releaseQ3Extractor = resolve;
    });
    extractorBarriers.set(3, q3ExtractorBarrier);

    // Q1: all stages 0ms (pure microtask resolution)
    extractorResponses.set(1, MOCK_EXTRACTOR_RESPONSE_Q1);
    solverResponses.set(1, MOCK_SOLVER_RESPONSE_Q1);
    verifierQueues.set(1, [MOCK_VERIFIER_RESPONSE_Q1_PASS]);

    // Q2: normal (no barrier, no delay)
    extractorResponses.set(2, MOCK_EXTRACTOR_RESPONSE_Q2);
    solverResponses.set(2, MOCK_SOLVER_RESPONSE_Q2);
    verifierQueues.set(2, [MOCK_VERIFIER_RESPONSE_Q2_PASS]);

    // Q3: extractor is gated by the barrier above; solver/verifier are normal
    extractorResponses.set(3, MOCK_EXTRACTOR_RESPONSE_Q3);
    solverResponses.set(3, MOCK_SOLVER_RESPONSE_Q3);
    verifierQueues.set(3, [MOCK_VERIFIER_RESPONSE_Q3_PASS]);

    // Set up a "Q1 verified" Promise — resolves the moment the event is collected.
    // We release Q3's extractor barrier only after Q1 has been fully verified.
    let resolveQ1Verified!: () => void;
    const q1VerifiedPromise = new Promise<void>((resolve) => {
      resolveQ1Verified = resolve;
    });

    // Wrap the SSE collector to detect Q1 "verified" and release Q3
    const rawEvents: SSEEvent[] = [];
    const send = (e: SSEEvent): void => {
      rawEvents.push(e);
      if (
        e.event === "question"
        && (e.data as Record<string, unknown>).number === 1
        && (e.data as Record<string, unknown>).stage === "verified"
      ) {
        resolveQ1Verified();
        // Now release Q3's extractor barrier
        releaseQ3Extractor();
      }
    };

    const questionImages = QUESTION_NUMS.map((n) => ({ number: n, path: `/fake/q0${n}.png` }));

    const { runStageOrchestrator } = await import("../orchestrator");

    // Start orchestrator concurrently; Q3's extractor is immediately blocked
    const orchestratorPromise = runStageOrchestrator({
      mode: "create",
      meta: COMPLETE_META,
      questionImages,
      stageOverrides: STAGE_OVERRIDES,
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    // Wait for Q1 to be verified (and Q3 barrier to be released) before awaiting orchestrator
    await q1VerifiedPromise;
    await orchestratorPromise;

    const events = rawEvents;

    // Collect final indices
    const q1VerifiedIdx = events.findIndex(
      (e) => e.event === "question"
        && (e.data as Record<string, unknown>).number === 1
        && (e.data as Record<string, unknown>).stage === "verified"
    );
    const q3ExtractedIdx = events.findIndex(
      (e) => e.event === "question"
        && (e.data as Record<string, unknown>).number === 3
        && (e.data as Record<string, unknown>).stage === "extracted"
    );

    expect(q1VerifiedIdx).toBeGreaterThanOrEqual(0);
    expect(q3ExtractedIdx).toBeGreaterThanOrEqual(0);

    // Q1 "verified" must appear before Q3 "extracted".
    // The barrier contract guarantees this: Q3's extractor only ran after
    // Q1 "verified" was emitted (that's exactly when releaseQ3Extractor() fired).
    expect(q1VerifiedIdx).toBeLessThan(q3ExtractedIdx);
  }, 30_000);

  // ────────────────────────────────────────────────────────────────────────
  // Bonus: verifier feedback loop — Q1 fails first, passes on second attempt
  // ────────────────────────────────────────────────────────────────────────

  it("verifier retry loop — Q1 verifier fails then passes; solver called twice", async () => {
    extractorResponses.set(1, MOCK_EXTRACTOR_RESPONSE_Q1);
    solverResponses.set(1, MOCK_SOLVER_RESPONSE_Q1);
    // Q1 verifier: fail first, then pass
    verifierQueues.set(1, [MOCK_VERIFIER_RESPONSE_Q1_FAIL, MOCK_VERIFIER_RESPONSE_Q1_PASS]);

    const { send } = makeSseCollector();
    const { runVerifierStage } = await import("../verifier");
    vi.clearAllMocks();

    const { runStageOrchestrator } = await import("../orchestrator");
    const result = await runStageOrchestrator({
      mode: "create",
      meta: COMPLETE_META,
      questionImages: [{ number: 1, path: "/fake/q01.png" }],
      stageOverrides: STAGE_OVERRIDES,
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    expect(result.status).toBe("done");

    // Verifier was called twice (fail then pass)
    expect(runVerifierStage).toHaveBeenCalledTimes(2);

    // Solver was called twice (initial + feedback re-run)
    const { runSolverStage } = await import("../solver");
    expect(runSolverStage).toHaveBeenCalledTimes(2);

    // Verifier telemetry: 2 entries (both provider-level success; output.status differs)
    // Note: telemetry "status" is "success" when the provider call itself succeeds
    // (JSON parsed OK), regardless of whether the verifier output.status is "pass"/"fail".
    const verifierTelemetry = result.providerTelemetry.filter(
      (e) => e.workflowStageKey === "create.verifier"
    );
    expect(verifierTelemetry).toHaveLength(2);

    // First entry: provider succeeded (completed), no retry
    expect(verifierTelemetry[0]?.status).toBe("success");
    expect(verifierTelemetry[0]?.retry).toBe(false);
    // Second entry: provider succeeded, retry=true (feedback loop re-run)
    expect(verifierTelemetry[1]?.status).toBe("success");
    expect(verifierTelemetry[1]?.retry).toBe(true);
  }, 30_000);

  // ────────────────────────────────────────────────────────────────────────
  // Scenario E-ext: cache hit + miss 혼합 시 stage counter 정합 (F8)
  // ────────────────────────────────────────────────────────────────────────

  it("(E-ext) cache hit + miss 혼합 — extractor/solver/verifier stage done events 모두 emit됨", async () => {
    // Q1: solver cache hit (extracted + solved already), Q2/Q3 fresh
    await cache.ensureCacheDir();
    await writeFile(
      cache.extractorResultPath(1),
      `${JSON.stringify(MOCK_EXTRACTOR_RESPONSE_Q1, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      cache.solverResultPath(1),
      `${JSON.stringify(MOCK_SOLVER_RESPONSE_Q1, null, 2)}\n`,
      "utf8"
    );

    extractorResponses.set(1, MOCK_EXTRACTOR_RESPONSE_Q1); // not used (cache hit)
    extractorResponses.set(2, MOCK_EXTRACTOR_RESPONSE_Q2);
    extractorResponses.set(3, MOCK_EXTRACTOR_RESPONSE_Q3);

    solverResponses.set(1, MOCK_SOLVER_RESPONSE_Q1); // not used (cache hit)
    solverResponses.set(2, MOCK_SOLVER_RESPONSE_Q2);
    solverResponses.set(3, MOCK_SOLVER_RESPONSE_Q3);

    verifierQueues.set(1, [MOCK_VERIFIER_RESPONSE_Q1_PASS]);
    verifierQueues.set(2, [MOCK_VERIFIER_RESPONSE_Q2_PASS]);
    verifierQueues.set(3, [MOCK_VERIFIER_RESPONSE_Q3_PASS]);

    const { events, send } = makeSseCollector();
    const questionImages = QUESTION_NUMS.map((n) => ({ number: n, path: `/fake/q0${n}.png` }));

    const { runStageOrchestrator } = await import("../orchestrator");
    const result = await runStageOrchestrator({
      mode: "resume",
      resumeFrom: "extractor",
      meta: COMPLETE_META,
      questionImages,
      stageOverrides: STAGE_OVERRIDES,
      defaultProvider: "auto",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    expect(result.status).toBe("done");

    // extractor stage must emit "done" (2 miss + 1 cache-hit)
    const extractorDone = events.find(
      (e) => e.event === "stage"
        && (e.data as Record<string, unknown>).name === "extractor"
        && (e.data as Record<string, unknown>).status === "done"
    );
    expect(extractorDone).toBeDefined();

    // solver stage must emit "done" (2 miss + 1 cache-hit)
    const solverDone = events.find(
      (e) => e.event === "stage"
        && (e.data as Record<string, unknown>).name === "solver"
        && (e.data as Record<string, unknown>).status === "done"
    );
    expect(solverDone).toBeDefined();

    // verifier stage must emit "done" (3 miss)
    const verifierDone = events.find(
      (e) => e.event === "stage"
        && (e.data as Record<string, unknown>).name === "verifier"
        && (e.data as Record<string, unknown>).status === "done"
    );
    expect(verifierDone).toBeDefined();
  }, 30_000);

  // ────────────────────────────────────────────────────────────────────────
  // Scenario F-ext: targetQuestionNumbers — per-Q figure 재처리 (F3)
  // ────────────────────────────────────────────────────────────────────────

  it("(F-ext) targetQuestionNumbers=[2] — figure stage에서 --question 2만 처리됨", async () => {
    // Pre-cache all extractors/solvers/verifiers so pipeline skips to figure
    await cache.ensureCacheDir();
    for (const n of QUESTION_NUMS) {
      await writeFile(
        cache.extractorResultPath(n),
        `${JSON.stringify(MOCK_EXTRACTOR_RESPONSE_Q1, null, 2)}\n`,
        "utf8"
      );
      await writeFile(
        cache.solverResultPath(n),
        `${JSON.stringify(MOCK_SOLVER_RESPONSE_Q1, null, 2)}\n`,
        "utf8"
      );
      await writeFile(
        cache.verifierResultPath(n),
        `${JSON.stringify(MOCK_VERIFIER_RESPONSE_Q1_PASS, null, 2)}\n`,
        "utf8"
      );
    }

    const { send } = makeSseCollector();
    const questionImages = QUESTION_NUMS.map((n) => ({ number: n, path: `/fake/q0${n}.png` }));
    const { runStageCommand } = await import("../commands");
    vi.clearAllMocks();

    const { runStageOrchestrator } = await import("../orchestrator");
    const result = await runStageOrchestrator({
      mode: "resume",
      resumeFrom: "figure",
      meta: COMPLETE_META,
      questionImages,
      stageOverrides: STAGE_OVERRIDES,
      defaultProvider: "auto",
      targetQuestionNumbers: [2],
      stopAfterStage: "figure",
      baseDir,
      send,
      isAborted: () => false,
      cache,
    });

    expect(result.status).toBe("done");

    // figure_processor.py should have been called with --question 2
    const figureCalls = (runStageCommand as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => {
        const args = (call[0] as { args?: string[] }).args ?? [];
        return typeof args[0] === "string" && args[0].endsWith("figure_processor.py");
      }
    );

    expect(figureCalls.length).toBeGreaterThanOrEqual(1);
    const firstFigureCall = figureCalls[0]![0] as { args: string[] };
    const qIdx = firstFigureCall.args.indexOf("--question");
    expect(qIdx).toBeGreaterThan(-1);
    expect(firstFigureCall.args[qIdx + 1]).toBe("2");
  }, 30_000);
});

// ────────────────────────────────────────────────────────────────────────────
// Stage provider routing tests
// ────────────────────────────────────────────────────────────────────────────

describe("orchestrator stage provider routing", () => {
  // ── (H) defaultProvider routing — codex-cli default, empty stageOverrides → all stages codex-cli
  it("(H) defaultProvider: codex-cli + empty stageOverrides → all stage adapters resolve to codex-cli", async () => {
    const { getProviderAdapter } = await import("@/lib/ai/registry");

    // Simulate getProviderForStage(stageKey, {}, "codex-cli") for each stage:
    // overrides[stageKey] is undefined → falls back to defaultProvider "codex-cli"
    const emptyOverrides: Record<string, string> = {};
    const defaultProvider = "codex-cli";

    for (const stageKey of ["create.extractor", "create.solver", "create.verifier"] as const) {
      const id = emptyOverrides[stageKey] ?? defaultProvider;
      const adapter = getProviderAdapter(id as Parameters<typeof getProviderAdapter>[0]);
      expect(adapter.id).toBe("codex-cli");
    }
  }, 5_000);

  // ── (I) defaultProvider + partial override — solver overridden, others use default
  it("(I) defaultProvider: codex-cli + create.solver overridden to claude-sdk → solver=claude-sdk, rest=codex-cli", async () => {
    const { getProviderAdapter } = await import("@/lib/ai/registry");

    // Simulate getProviderForStage with stageOverrides that only overrides solver
    const stageOverrides: Record<string, string> = {
      "create.solver": "claude-sdk",
    };
    const defaultProvider = "codex-cli";

    // solver: uses override "claude-sdk"
    const solverId = stageOverrides["create.solver"] ?? defaultProvider;
    const solverAdapter = getProviderAdapter(solverId as Parameters<typeof getProviderAdapter>[0]);
    expect(solverAdapter.id).toBe("claude-sdk");

    // extractor: no override → falls back to defaultProvider "codex-cli"
    const extractorId = stageOverrides["create.extractor"] ?? defaultProvider;
    const extractorAdapter = getProviderAdapter(extractorId as Parameters<typeof getProviderAdapter>[0]);
    expect(extractorAdapter.id).toBe("codex-cli");

    // verifier: no override → falls back to defaultProvider "codex-cli"
    const verifierId = stageOverrides["create.verifier"] ?? defaultProvider;
    const verifierAdapter = getProviderAdapter(verifierId as Parameters<typeof getProviderAdapter>[0]);
    expect(verifierAdapter.id).toBe("codex-cli");
  }, 5_000);

  // ── (J) defaultProvider: auto → all stages resolve to codex-cli (auto resolve)
  it("(J) defaultProvider: auto + empty stageOverrides → all stages resolve to codex-cli", async () => {
    const { getProviderAdapter } = await import("@/lib/ai/registry");

    // Simulate getProviderForStage(stageKey, {}, "auto"):
    // overrides[stageKey] is undefined → falls back to "auto" → resolves to codex-cli
    const emptyOverrides: Record<string, string> = {};
    const defaultProvider = "auto";

    for (const stageKey of ["create.extractor", "create.solver", "create.verifier"] as const) {
      const id = emptyOverrides[stageKey] ?? defaultProvider;
      const adapter = getProviderAdapter(id as Parameters<typeof getProviderAdapter>[0]);
      // "auto" resolves to "codex-cli" via getProviderAdapter
      expect(adapter.id).toBe("codex-cli");
    }
  }, 5_000);
});
