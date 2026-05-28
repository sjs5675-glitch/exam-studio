import path from "path";
import { readFile, stat, writeFile } from "fs/promises";
import type { SSEEvent } from "@/lib/claude";
import type { AIProviderId } from "@/lib/ai/types";
import { getProviderAdapter } from "@/lib/ai/registry";
import type { ImageProviderId, StageOverrideMap, StageProviderId, StageSkipMap } from "@/lib/ai/settings";
import type { ProviderTelemetryEntry } from "@/lib/ai/retry";
import { createProviderTelemetryEntry } from "@/lib/ai/retry";
import type { StageCache } from "./cache";
import { createStageCache } from "./cache";
import type { ExamMetaInput, FigureMode } from "@/lib/exam/meta";
import { buildExamDataJson } from "./examData";
import { runExtractorStage } from "./extractor";
import { runSolverStage } from "./solver";
import { runVerifierStage } from "./verifier";
import { runBuilderStage } from "./builder";
import { runCheckerWithAutoFix } from "./checker";
import { runFigureStage } from "./figureRunner";
import { runCleanerStage } from "./cleanerRunner";
import { readRuntimeEnv } from "../../lib/server/runtimeEnv";
import { checkProviderAuth } from "../../lib/server/providerAuth";
import { determineStartStage, shouldRunStage, type WorkflowStage } from "./resumeState";
import { applyVerifierRetry } from "./stagePlan";
import {
  stageEvent,
  progressEvent,
  logEvent,
  fileEvent,
  resultEvent,
  emitStageStart,
  emitStageDone,
  emitStageFailed,
  emitStageSkipped,
} from "./events";
import type { JobStore } from "./jobStore";
import { collectProviderText, parseModelJsonOutput } from "./modelHarness";

// ──────────────────────────────────────────────
// Public interfaces
// ──────────────────────────────────────────────

export interface OrchestratorInput {
  mode: "create" | "resume";
  /** Stage to resume from: "extractor"|"solver"|"verifier"|"figure"|"builder"|"confirm"|"checker" */
  resumeFrom?: string;
  meta: ExamMetaInput;
  questionImages: { number: number; path: string }[];
  stageOverrides: StageOverrideMap;
  /**
   * 사용자가 settings UI에서 선택한 default provider. sse.ts/followup route가 반드시 전달.
   * stageOverrides에 명시 안 된 stage는 이 provider로 fallback.
   * normalizeProviderId 결과("auto" 포함)를 받으므로 undefined 불가.
   */
  defaultProvider: AIProviderId;
  /** stage별 스킵 플래그. 현재는 create.verifier만 의미 있음. */
  stageSkip?: StageSkipMap;
  /** figure 재생성 단계에서 사용할 provider. */
  imageProvider?: ImageProviderId;
  /** 손글씨 제거/문제 이미지 정리 단계에서 사용할 provider. */
  imageCleaningProvider?: ImageProviderId;
  /** Gemini로 그림을 재생성할지. false면 crop만 (figure_processor.py --no-regen). default true. */
  figureRegen?: boolean;
  /** Per-job figure handling mode from the create screen. */
  figureMode?: FigureMode;
  /** nano-banana로 문제 이미지의 손글씨/필기 흔적을 정리할지. default true. false면 원본 그대로. */
  imageCleaningEnabled?: boolean;
  /** checker auto-fix 시도 최대 횟수. 0 = 검사만, 기본 2. 범위 0~5. */
  checkerMaxAttempts?: number;
  /** verifier 재시도 최대 횟수. 0 = verifier 단계 스킵, 기본 3. 범위 1~5 (>=1일 때만 적용). */
  verifierMaxAttempts?: number;
  /**
   * 마지막으로 실행할 단계. 지정 시 그 이후 stage 는 모두 스킵.
   * followup 의 per-question 액션버튼은 "해당 stage 만 재실행" 의미이므로 이 값을 세팅한다.
   * "cleaning" 은 extractor 직전의 cleaning 블록까지만 실행하고 멈추는 가상 단계.
   */
  stopAfterStage?: "cleaning" | "extractor" | "solver" | "verifier" | "figure" | "builder" | "checker";
  /**
   * figure stage에서 특정 문제만 재처리할 때 지정.
   * 지정하지 않으면 전체 figure 문제를 처리한다.
   * 단일 → --question N, 복수 → 번호별 runFigureStage 반복 + figure_status 병합.
   */
  targetQuestionNumbers?: number[];
  baseDir: string;
  send: (event: SSEEvent) => void;
  isAborted: () => boolean;
  /** Optional external AbortSignal — when aborted, fires the internal controller immediately
   *  (without waiting for the next stage-boundary `checkAborted()` poll). Required to kill
   *  in-flight provider processes (codex/claude CLI) on client disconnect. */
  externalSignal?: AbortSignal;
  /** Optional jobStore for live telemetry persistence */
  jobStore?: JobStore;
  jobId?: string;
  /** Override cache (used in tests) */
  cache?: StageCache;
}

export interface OrchestratorResult {
  status: "done" | "failed" | "cancelled";
  outputFile?: string;
  resultSummary?: string;
  providerTelemetry: ProviderTelemetryEntry[];
}

// ──────────────────────────────────────────────
// Concurrency helpers
// ──────────────────────────────────────────────

/**
 * Run `worker` over `items` with at most `limit` concurrent executions.
 * Results are returned in input order. Individual failures are captured as
 * `{ ok: false; error }` objects rather than re-thrown.
 */
export async function runWithConcurrency<T, R>(
  limit: number,
  items: T[],
  worker: (item: T) => Promise<R>
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  const queue = items.map((item, index) => ({ item, index }));
  let queueIndex = 0;

  async function runOne(): Promise<void> {
    while (queueIndex < queue.length) {
      const current = queue[queueIndex++];
      if (!current) break;
      try {
        const value = await worker(current.item);
        results[current.index] = { ok: true, value };
      } catch (error) {
        results[current.index] = { ok: false, error };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runOne());
  await Promise.all(workers);

  return results;
}

/**
 * A promise-based semaphore that limits concurrent executions.
 * acquire() waits until a slot is available, runs `fn`, then releases.
 */
export function semaphore(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return {
    acquire: async <T>(fn: () => Promise<T>): Promise<T> => {
      if (active >= max) {
        await new Promise<void>((resolve) => queue.push(resolve));
      }
      active++;
      try {
        return await fn();
      } finally {
        active--;
        const next = queue.shift();
        next?.();
      }
    },
  };
}

// ──────────────────────────────────────────────
// Concurrency constants
// ──────────────────────────────────────────────

const EXTRACTOR_CONCURRENCY = 4;
const SOLVER_CONCURRENCY = 6;
const VERIFIER_CONCURRENCY = 6;

// ──────────────────────────────────────────────
// Provider selection helper
// ──────────────────────────────────────────────

function getProviderForStage(
  stageKey: keyof StageOverrideMap,
  overrides: StageOverrideMap,
  defaultProvider: AIProviderId
) {
  const id: StageProviderId = overrides[stageKey] ?? defaultProvider;
  return getProviderAdapter(id);
}

/**
 * 작업에 쓰이는 CLI provider(auto/claude-cli→claude, codex-cli→codex)의 로그인 상태를
 * 확인해 Activity Log("system")에 결과를 남긴다. 로그인됨 → info("로그인 확인 완료"),
 * 미로그인 → warn(터미널 로그인 명령 안내). 어느 쪽이든 작업은 그대로 진행한다.
 * 로그인은 대시보드가 아니라 터미널(CLI)에서 해야 하므로 명령을 함께 안내한다.
 * SDK/API-key provider는 로그인 개념이 없어 제외. `isAuthenticated`는 테스트 주입용
 * seam(기본값은 실제 CLI 확인).
 */
export function reportProviderAuthStatus(
  defaultProvider: AIProviderId,
  stageOverrides: StageOverrideMap,
  send: (event: SSEEvent) => void,
  isAuthenticated: (provider: "claude" | "codex") => boolean = checkProviderAuth,
): void {
  const usedProviders = new Set<AIProviderId>([
    defaultProvider,
    ...Object.values(stageOverrides).filter((p): p is StageProviderId => Boolean(p)),
  ]);
  const authTargets = new Set<"claude" | "codex">();
  for (const p of usedProviders) {
    if (p === "auto" || p === "claude-cli") authTargets.add("claude");
    else if (p === "codex-cli") authTargets.add("codex");
  }
  for (const target of authTargets) {
    const label = target === "claude" ? "Claude Code" : "Codex";
    if (isAuthenticated(target)) {
      send(logEvent("system", `${label} CLI 로그인 확인 완료.`, "info"));
    } else {
      const loginCmd = target === "claude" ? "claude" : "codex login";
      send(logEvent(
        "system",
        `${label} CLI 로그인이 안 되어 있습니다. 터미널에서 '${loginCmd}' 로 로그인하세요 — 그렇지 않으면 해당 단계에서 실패할 수 있습니다.`,
        "warn",
      ));
    }
  }
}

export async function runStageOrchestrator(
  input: OrchestratorInput
): Promise<OrchestratorResult> {
  const { baseDir, send, isAborted, stageOverrides, meta, questionImages } = input;

  const cache = input.cache ?? createStageCache(baseDir);
  const questionNumbers = questionImages.map((q) => q.number);
  const providerTelemetry: ProviderTelemetryEntry[] = [];

  // AbortController used to propagate cancellation into provider SDK fetch calls.
  const controller = new AbortController();
  const { signal } = controller;

  // Forward external aborts (e.g. SSE client disconnect) immediately — don't wait
  // for the next stage-boundary `checkAborted()` poll.
  if (input.externalSignal) {
    if (input.externalSignal.aborted) {
      controller.abort();
    } else {
      input.externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  /** Checks isAborted() and, if true, fires controller.abort() then returns true. */
  function checkAborted(): boolean {
    if (isAborted()) {
      controller.abort();
      return true;
    }
    return false;
  }

  // Determine where to start.
  const { startStage } = await determineStartStage(
    input.resumeFrom,
    cache,
    questionNumbers
  );

  // 작업에 쓰이는 CLI provider의 로그인 상태를 Activity Log에 보고한다(완료/미로그인).
  reportProviderAuthStatus(input.defaultProvider, stageOverrides, send);

  // stopAfterStage 가 지정되면 그 이후 stage 는 실행하지 않는다.
  // "cleaning" 은 extractor 직전의 cleaning 단계까지만, 그 외는 WorkflowStage 와 동일.
  type StopStage = "cleaning" | WorkflowStage;
  const STOP_ORDER: StopStage[] = ["cleaning", "extractor", "solver", "verifier", "figure", "builder", "checker"];
  function stillUnder(target: StopStage): boolean {
    const cap = input.stopAfterStage;
    if (!cap) return true;
    return STOP_ORDER.indexOf(target) <= STOP_ORDER.indexOf(cap);
  }

  let outputFile: string | undefined;
  let resultSummary: string | undefined;

  // Semaphores for per-question pipeline concurrency control.
  const extractSem = semaphore(EXTRACTOR_CONCURRENCY);
  const solveSem   = semaphore(SOLVER_CONCURRENCY);
  const verifySem  = semaphore(VERIFIER_CONCURRENCY);

  // Stage counters for atomic stage event emission.
  // Each stage tracks how many questions entered and how many finished.
  const stageCounter = {
    extractor: { entered: 0, completed: 0, failed: 0, total: 0 },
    solver:    { entered: 0, completed: 0, failed: 0, total: 0 },
    verifier:  { entered: 0, completed: 0, failed: 0, total: 0 },
  };

  type PipelineStageName = "extractor" | "solver" | "verifier";

  const stageLabel: Record<PipelineStageName, string> = {
    extractor: "추출",
    solver: "풀이",
    verifier: "검증",
  };

  function onEnter(stage: PipelineStageName, n: number): void {
    const c = stageCounter[stage];
    c.entered++;
    if (c.entered === 1) {
      // First question entering this stage — emit "running".
      send(stageEvent(stage, "running"));
    }
    send(logEvent(stage, `Q${n} ${stageLabel[stage]} 시작`));
  }

  /**
   * cache-hit 분기에서 stageCounter를 정확히 카운팅하기 위한 헬퍼.
   * onEnter + onLeave를 한 번에 호출한다.
   */
  function markCacheHit(stage: PipelineStageName, n: number): void {
    onEnter(stage, n);
    onLeave(stage, n, "completed");
  }

  /**
   * 이전 stage 실패로 인해 이 stage에 진입하지 못할 때 카운터를 맞추기 위한 헬퍼.
   * total에는 포함됐지만 실제 실행 없이 failed로 처리한다.
   */
  function markSkippedDueToFailure(stage: PipelineStageName, n: number): void {
    onEnter(stage, n);
    onLeave(stage, n, "failed");
  }

  function onLeave(stage: PipelineStageName, n: number, status: "completed" | "failed"): void {
    const c = stageCounter[stage];
    if (status === "completed") c.completed++;
    else c.failed++;

    const done = c.completed + c.failed;
    const resultLabel = status === "completed" ? "완료" : "실패";
    send(logEvent(stage, `Q${n} ${stageLabel[stage]} ${resultLabel}`));
    send(progressEvent(stage, Math.round((done / c.total) * 100)));

    if (done === c.total) {
      // All questions have passed through this stage — emit summary stage event.
      const summary = `완료: ${c.completed}/${c.total}${c.failed > 0 ? `, 실패: [확인 필요]` : ""}`;
      if (c.completed === 0) {
        send(stageEvent(stage, "failed", { summary }));
      } else {
        send(stageEvent(stage, "done", { summary }));
      }
    }
  }

  /** Per-question result: which stage it failed at (undefined = full success). */
  interface QuestionPipelineResult {
    number: number;
    failedAt?: PipelineStageName;
    error?: string;
  }

  /** Run a single question through extract→solve→verify, skipping stages that are
   *  already cached (disk-scan resume). */
  async function processQuestion(
    img: { number: number; path: string }
  ): Promise<QuestionPipelineResult> {
    const n = img.number;

    // ── Disk-scan: determine which stages are already done ──────────────────
    const state = await cache.scanQuestionState(n);

    // Skip extractor if: stage is not needed (startStage > extractor), disk cache exists,
    // or user explicitly started from solver/verifier (extractor results must exist).
    const skipExtractor =
      !shouldRunStage(startStage, "extractor") ||
      !stillUnder("extractor") ||
      state.extracted ||
      startStage === "solver" ||
      startStage === "verifier";

    // Skip solver if: stage not needed OR disk cache already has solver result.
    const skipSolver =
      !shouldRunStage(startStage, "solver") ||
      !stillUnder("solver") ||
      state.solved;

    // verifier 재시도 최대 횟수 (기본 3, 범위 0~5). 0이면 verifier 단계 스킵.
    const verifierMaxAttempts = Math.max(0, Math.min(5, Math.round(input.verifierMaxAttempts ?? 3)));

    // Skip verifier if: stage not needed OR disk cache already has verifier result
    // OR user explicitly set stageSkip["create.verifier"] = true OR verifierMaxAttempts === 0.
    const skipVerifier =
      !shouldRunStage(startStage, "verifier") ||
      !stillUnder("verifier") ||
      state.verified ||
      input.stageSkip?.["create.verifier"] === true ||
      verifierMaxAttempts === 0;

    // ── Stage: Extractor ────────────────────────────────────────────────────
    let extractedOutput: unknown = null;

    if (skipExtractor) {
      extractedOutput = await readCacheJson(cache.extractorResultPath(n));
      // 캐시 hit: UI에 결과를 흘려준다. 라이브 모드든 resume이든
      // Navigator dot이 일관되게 켜지도록 신규 계산과 동일한 이벤트를 emit한다.
      if (extractedOutput != null) {
        send({
          event: "question",
          data: { number: n, stage: "extracted", status: "ok", data: extractedOutput },
        });
      }
      // P7 F8: cache-hit도 stageCounter에 카운트해 done === total 조건을 보장한다.
      const forceExtracted = startStage === "solver" || startStage === "verifier";
      const runExtractorLocal = shouldRunStage(startStage, "extractor") && stillUnder("extractor");
      if (runExtractorLocal && !forceExtracted) {
        markCacheHit("extractor", n);
      }
    } else {
      const result = await extractSem.acquire(async () => {
        if (isAborted()) throw new Error("aborted");
        onEnter("extractor", n);
        const r = await runExtractorStage({
          questionNumber: n,
          imagePath: img.path,
          examMeta: input.meta,
          cache,
          provider: getProviderForStage("create.extractor", stageOverrides, input.defaultProvider),
          signal,
        });
        onLeave("extractor", n, r.status === "completed" ? "completed" : "failed");
        return r;
      });

      if (result.provider) {
        providerTelemetry.push(
          createProviderTelemetryEntry({
            stageKey: "create.extractor",
            workflowStageKey: "create.extractor",
            requestedProvider: result.provider.requestedProvider ?? "auto",
            resolvedProvider: result.provider.provider ?? "claude-cli",
            attempt: 1,
            status: result.status === "completed" ? "success" : "failed",
            elapsedMs: computeElapsedMs(result.startedAt, result.completedAt),
            retry: false,
            errorSummary: result.error?.message,
          })
        );
      }

      if (result.status !== "completed") {
        send({
          event: "question",
          data: { number: n, stage: "extracted", status: "failed", error: result.error?.message },
        });
        // P7 F8: extractor 실패로 solver/verifier에 진입 못 하므로 total 카운터를 맞춤
        const runSolverL = shouldRunStage(startStage, "solver") && stillUnder("solver");
        const runVerifierL = shouldRunStage(startStage, "verifier") && stillUnder("verifier");
        if (runSolverL)   markSkippedDueToFailure("solver", n);
        if (runVerifierL) markSkippedDueToFailure("verifier", n);
        return { number: n, failedAt: "extractor", error: result.error?.message };
      }

      send({
        event: "question",
        data: { number: n, stage: "extracted", status: "ok", data: result.output },
      });
      // Incremental extraction_review (per-question).
      send({ event: "extraction_review", data: { number: n, data: result.output } });
      extractedOutput = result.output;
    }

    // ── Stage: Solver ───────────────────────────────────────────────────────
    let solvedOutput: unknown = null;

    if (skipSolver) {
      solvedOutput = await readCacheJson(cache.solverResultPath(n));
      if (solvedOutput != null) {
        send({
          event: "question",
          data: { number: n, stage: "solved", status: "ok", data: solvedOutput },
        });
      }
      // P7 F8: cache-hit도 stageCounter에 카운트
      const runSolverLocal = shouldRunStage(startStage, "solver") && stillUnder("solver");
      if (runSolverLocal) markCacheHit("solver", n);
    } else {
      const result = await solveSem.acquire(async () => {
        if (isAborted()) throw new Error("aborted");
        onEnter("solver", n);
        const r = await runSolverStage({
          questionNumber: n,
          extracted: extractedOutput,
          examMeta: input.meta,
          cache,
          provider: getProviderForStage("create.solver", stageOverrides, input.defaultProvider),
          signal,
        });
        onLeave("solver", n, r.status === "completed" ? "completed" : "failed");
        return r;
      });

      if (result.provider) {
        providerTelemetry.push(
          createProviderTelemetryEntry({
            stageKey: "create.solver",
            workflowStageKey: "create.solver",
            requestedProvider: result.provider.requestedProvider ?? "auto",
            resolvedProvider: result.provider.provider ?? "claude-cli",
            attempt: 1,
            status: result.status === "completed" ? "success" : "failed",
            elapsedMs: computeElapsedMs(result.startedAt, result.completedAt),
            retry: false,
            errorSummary: result.error?.message,
          })
        );
      }

      if (result.status !== "completed") {
        send({
          event: "question",
          data: { number: n, stage: "solved", status: "failed", error: result.error?.message },
        });
        // P7 F8: solver 실패로 verifier에 진입 못 하므로 total 카운터를 맞춤
        const runVerifierL2 = shouldRunStage(startStage, "verifier") && stillUnder("verifier");
        if (runVerifierL2) markSkippedDueToFailure("verifier", n);
        return { number: n, failedAt: "solver", error: result.error?.message };
      }

      send({
        event: "question",
        data: { number: n, stage: "solved", status: "ok", data: result.output },
      });
      solvedOutput = result.output;
    }

    // ── Stage: Verifier (with feedback loop via applyVerifierRetry) ──────────
    // When skipped explicitly by user setting, emit a single done event for UI clarity.
    const verifierExplicitlySkipped =
      (input.stageSkip?.["create.verifier"] === true || verifierMaxAttempts === 0) &&
      !state.verified;
    if (verifierExplicitlySkipped) {
      send(stageEvent("verifier", "done", { summary: "스킵됨 (사용자 설정)" }));
      send(logEvent("verifier", `Q${n} 검증 스킵 (verifierMaxAttempts=${verifierMaxAttempts})`));
    }

    // 캐시 hit: verifier 결과를 UI에 흘려준다 (verifier 블록은 통째로 스킵되므로 별도 처리).
    if (skipVerifier && state.verified) {
      const cachedVerified = await readCacheJson(cache.verifierResultPath(n));
      if (cachedVerified != null) {
        send({
          event: "question",
          data: { number: n, stage: "verified", status: "ok", data: cachedVerified },
        });
      }
      // P7 F8: verifier cache-hit도 stageCounter에 카운트
      const runVerifierLocal = shouldRunStage(startStage, "verifier") && stillUnder("verifier");
      if (runVerifierLocal) markCacheHit("verifier", n);
    } else if (skipVerifier && !state.verified) {
      // 명시적 스킵(verifierMaxAttempts=0 등): runVerifier가 켜져 있어서 total에 포함됐으나
      // 실제 실행이 없으므로 카운터를 맞추기 위해 markSkippedDueToFailure로 처리.
      const runVerifierLocal2 = shouldRunStage(startStage, "verifier") && stillUnder("verifier");
      if (runVerifierLocal2) markSkippedDueToFailure("verifier", n);
    }

    if (!skipVerifier) {
      if (isAborted()) throw new Error("aborted");

      const verifierProvider = getProviderForStage("create.verifier", stageOverrides, input.defaultProvider);
      const solverProvider   = getProviderForStage("create.solver",   stageOverrides, input.defaultProvider);

      onEnter("verifier", n);

      // retryAttempt tracks how many retry solver calls have been made (for telemetry attempt number).
      let retryAttempt = 0;

      const retryResult = await applyVerifierRetry(
        // runSolver callback: called only on verifier-feedback retries (feedback is always set).
        // The initial solver output (solvedOutput) is provided via initialSolverOutput.
        async (feedback) => {
          if (isAborted()) throw new Error("aborted");
          retryAttempt++;
          send(logEvent(
            "verifier",
            `Q${n} 검증 feedback 반영 — solver 재풀이 (라운드 ${retryAttempt}/${Math.max(1, verifierMaxAttempts)})`
          ));
          const solverResult = await solveSem.acquire(async () =>
            runSolverStage({
              questionNumber: n,
              extracted: extractedOutput,
              guidelineContext: feedback ? `Verifier feedback: ${feedback}` : undefined,
              examMeta: input.meta,
              cache,
              provider: solverProvider,
              signal,
            })
          );
          if (solverResult.provider) {
            providerTelemetry.push(
              createProviderTelemetryEntry({
                stageKey: "create.solver",
                workflowStageKey: "create.solver",
                requestedProvider: solverResult.provider.requestedProvider ?? "auto",
                resolvedProvider: solverResult.provider.provider ?? "claude-cli",
                attempt: retryAttempt,
                status: solverResult.status === "completed" ? "success" : "failed",
                elapsedMs: computeElapsedMs(solverResult.startedAt, solverResult.completedAt),
                retry: true,
                downstreamCorrection: true,
                errorSummary: solverResult.error?.message,
              })
            );
          }
          return solverResult.status === "completed" ? solverResult.output as unknown : solvedOutput;
        },
        // runVerifier callback: called after each solver run
        async (currentSolvedOutput) => {
          if (isAborted()) throw new Error("aborted");
          const verifierResult = await verifySem.acquire(async () =>
            runVerifierStage({
              questionNumber: n,
              extracted: extractedOutput,
              solved: currentSolvedOutput,
              examMeta: input.meta,
              cache,
              provider: verifierProvider,
              signal,
            })
          );
          if (verifierResult.provider) {
            providerTelemetry.push(
              createProviderTelemetryEntry({
                stageKey: "create.verifier",
                workflowStageKey: "create.verifier",
                requestedProvider: verifierResult.provider.requestedProvider ?? "auto",
                resolvedProvider: verifierResult.provider.provider ?? "claude-cli",
                attempt: retryAttempt + 1,
                status: verifierResult.status === "completed" ? "success" : "failed",
                elapsedMs: computeElapsedMs(verifierResult.startedAt, verifierResult.completedAt),
                retry: retryAttempt > 0,
                errorSummary: verifierResult.error?.message,
              })
            );
          }
          if (verifierResult.status === "completed" && verifierResult.output?.status === "pass") {
            return { status: "pass" as const };
          }
          const feedback = verifierResult.output?.feedback;
          return { status: "fail" as const, ...(feedback ? { feedback } : {}) };
        },
        // config — pass the already-computed solver output to skip the initial solver call
        {
          maxAttempts: Math.max(1, verifierMaxAttempts),
          initialSolverOutput: solvedOutput,
        }
      );

      if (retryResult.status === "pass" || retryResult.status === "revised") {
        if (retryResult.status === "revised") {
          send(logEvent("verifier", `Q${n} 검증 feedback 반영 완료 — 수정된 solver 풀이를 채택합니다.`));
        }
        onLeave("verifier", n, "completed");
        // revised 케이스: finalVerifierOutput 은 마지막 fail verifier 출력 (재풀이 후 재검증 안 함).
        // UI 가 "재풀이로 반영된 과거 이슈" 임을 알 수 있도록 revised/attempts 메타를 합치고
        // 디스크 캐시도 같이 갱신해 페이지 리로드 후에도 일관되게 보이도록 한다.
        const verifiedPayload = retryResult.status === "revised"
          ? {
              ...(retryResult.finalVerifierOutput as Record<string, unknown>),
              revised: true,
              attempts: retryResult.attempts,
            }
          : retryResult.finalVerifierOutput;
        if (retryResult.status === "revised") {
          await writeFile(
            cache.verifierResultPath(n),
            `${JSON.stringify(verifiedPayload, null, 2)}\n`,
            "utf8",
          );
        }
        send({
          event: "question",
          data: { number: n, stage: "verified", status: "ok", data: verifiedPayload },
        });
        return { number: n };
      }
    }

    return { number: n };
  }

  try {
    // ── Stage 0: Image cleaning (nano-banana) ─────────────────────────────
    // extractor 진입 전에 손글씨/필기 흔적을 제거해 추출 정확도와 figure ref 품질을 함께 끌어올린다.
    // 토글 OFF면 원본을 cleaned/로 복사만(spawn은 함). resume에서 cleaned가 이미 있으면 skip.
    const runCleaner = shouldRunStage(startStage, "extractor") && stillUnder("cleaning");
    if (runCleaner && !checkAborted()) {
      const imageProvider = input.imageCleaningProvider ?? input.imageProvider ?? "gemini";
      const cleaningEnabled = input.imageCleaningEnabled !== false;
      const runtimeEnv = readRuntimeEnv() as Record<string, string | undefined>;
      let cleanFlag = cleaningEnabled;
      if (cleanFlag && imageProvider === "gemini" && !runtimeEnv.GEMINI_API_KEY && !runtimeEnv.GOOGLE_API_KEY) {
        send(logEvent(
          "create.cleaned",
          "GEMINI_API_KEY 미설정 — nano-banana 정리 생략, 원본 그대로 진행합니다.",
          "warn",
        ));
        cleanFlag = false;
      }
      // 이미 모든 문제의 cleaned가 존재하면 spawn 자체를 건너뛴다.
      const needCleaning = await needsCleaningRun(cache, questionNumbers);
      if (!needCleaning) {
        emitStageSkipped(send, "create.cleaned", { message: "image_cleaner.py 스킵 — 캐시 사용." });
      } else {
        emitStageStart(send, "create.cleaned", cleanFlag
          ? `image_cleaner.py 실행 (${imageProvider}로 손글씨 제거).`
          : "image_cleaner.py 실행 (--no-clean: 원본 복사만).");
        const cleanerResult = await runCleanerStage({
          questionImagesDir: cache.paths.questionImagesDir,
          statusOutPath: cache.paths.cleaningStatus,
          clean: cleanFlag,
          imageProvider,
          baseDir,
          signal,
          env: runtimeEnv as NodeJS.ProcessEnv,
        });
        if (checkAborted()) return cancelled(providerTelemetry);
        if (cleanerResult.status !== "failed") {
          const summary = cleanFlag ? "이미지 정리 완료" : "정리 OFF — 원본 사용";
          emitStageDone(send, "create.cleaned", { summary });
        } else if (cleanerResult.reason === "busy") {
          emitStageFailed(send, "create.cleaned", {
            summary: "정리 작업 중복 감지",
            message: cleanerResult.message ?? "이미지 정리/손글씨 제거 작업이 이미 실행 중이라 원본 이미지로 진행합니다.",
            level: "warn",
          });
        } else {
          // cleaning 실패는 hard fail이 아님 — 원본으로 진행.
          emitStageFailed(send, "create.cleaned", {
            summary: "정리 실패, 원본으로 진행",
            message: "image_cleaner.py 실패 — 원본 이미지로 진행합니다.",
            level: "warn",
          });
        }
      }
    }

    // 정리본이 있으면 extractor 입력 경로를 cleaned/로 스왑한다.
    // figure_processor.py도 cleaned/가 존재하면 그쪽을 우선 사용하도록 처리되어 있다.
    const effectiveQuestionImages = await swapToCleanedPaths(cache, questionImages);

    // ── Per-question pipeline: extractor → solver → verifier ──────────────
    const runExtractor = shouldRunStage(startStage, "extractor") && stillUnder("extractor");
    const runSolver    = shouldRunStage(startStage, "solver")    && stillUnder("solver");
    const runVerifier  = shouldRunStage(startStage, "verifier")  && stillUnder("verifier");

    // All questions participate when any per-question stage is active;
    // processQuestion() handles per-question skip logic via disk-scan.
    const pipelineQuestions = (runExtractor || runSolver || runVerifier) ? effectiveQuestionImages : [];

    const failedQuestionNumbers = new Set<number>();

    if (pipelineQuestions.length === 0) {
      // All model stages skipped (e.g. resume past verifier). Emit done events
      // so UI shows cached stages as completed rather than perpetual pending.
      for (const stage of ["extractor", "solver", "verifier"] as const) {
        send(stageEvent(stage, "done", { summary: "캐시로 스킵" }));
        send(progressEvent(stage, 100));
      }
    }

    if (pipelineQuestions.length > 0) {
      if (checkAborted()) return cancelled(providerTelemetry);

      // Initialise stage totals so onLeave can emit summaries correctly.
      // P7: total = pipeline에 들어가는 전체 문제 수 (cache hit + miss 모두 포함).
      // markCacheHit(stage, n)이 onEnter + onLeave를 호출하므로 hit도 total에 포함해야
      // done === total 조건이 정확히 성립한다.
      const forceExtracted = startStage === "solver" || startStage === "verifier";
      const pipelineTotal = pipelineQuestions.length;
      if (runExtractor && !forceExtracted) stageCounter.extractor.total += pipelineTotal;
      if (runSolver) stageCounter.solver.total += pipelineTotal;
      if (runVerifier) stageCounter.verifier.total += pipelineTotal;

      // If all questions already have cached results for a given stage, emit
      // a "done" event with cache-summary so UI doesn't show the card as pending.
      for (const stage of ["extractor", "solver", "verifier"] as const) {
        const enabled = stage === "extractor" ? runExtractor : stage === "solver" ? runSolver : runVerifier;
        if (enabled && stageCounter[stage].total === 0) {
          send(stageEvent(stage, "done", { summary: "캐시로 스킵" }));
          send(progressEvent(stage, 100));
        }
      }

      const pipelineResults = await Promise.all(pipelineQuestions.map(processQuestion));

      if (checkAborted()) return cancelled(providerTelemetry);

      // Aggregate pipeline result.
      const failedQuestions = pipelineResults.filter((r) => r.failedAt !== undefined);
      const successCount = pipelineResults.length - failedQuestions.length;

      if (successCount === 0 && pipelineResults.length > 0 && runExtractor) {
        // All questions failed in extractor — hard fail.
        send(logEvent("system", "모든 문제 추출 실패 — 작업을 중단합니다.", "error"));
        return failed(providerTelemetry, "extractor: 모든 문제 추출 실패");
      }

      if (failedQuestions.length > 0) {
        const failedNums = failedQuestions.map((r) => `Q${r.number}(${r.failedAt ?? "?"})`).join(", ");
        send(logEvent("system", `일부 문제 처리 실패: [${failedNums}] — 성공한 문제만으로 exam_data.json을 조립합니다.`, "warn"));
        for (const r of failedQuestions) failedQuestionNumbers.add(r.number);
      }

      // Emit batch extraction_review for backward-compatibility when extractor ran.
      // (Per-question incremental events were already sent; this gives UI the full list.)
      if (runExtractor && stageCounter.extractor.total > 0) {
        send({ event: "extraction_review", data: { questionNumbers } });
      }
    }

    // ── Build exam_data.json ───────────────────
    // stopAfterStage 가 figure 이전이면 다운스트림이 안 도니까 rebuild 스킵.
    // (스코프 좁힌 per-question rerun 에서 exam_data.json 을 truncated 상태로 덮는 부작용 회피)
    if (!checkAborted() && stillUnder("figure")) {
      await persistTelemetry(input, providerTelemetry, "running");
      const successfulQuestionNumbers = questionNumbers.filter((n) => !failedQuestionNumbers.has(n));
      if (successfulQuestionNumbers.length === 0) {
        send(logEvent("system", "성공한 문제가 없어 exam_data.json을 생성할 수 없습니다.", "error"));
        return failed(providerTelemetry, "모든 문제 처리 실패");
      }
      try {
        await buildExamDataJson({ cache, meta, questionNumbers: successfulQuestionNumbers });
        const skippedCount = questionNumbers.length - successfulQuestionNumbers.length;
        const summary = skippedCount > 0
          ? `exam_data.json 생성 완료 (${successfulQuestionNumbers.length}/${questionNumbers.length}, ${skippedCount}개 누락)`
          : "exam_data.json 생성 완료";
        send(logEvent("system", summary));
      } catch (err) {
        send(logEvent("system", `exam_data.json 생성 실패: ${err instanceof Error ? err.message : String(err)}`, "error"));
        return failed(providerTelemetry, "exam_data.json 생성 실패");
      }
    }

    // ── Stage 4: Figure ────────────────────────
    if (!checkAborted() && shouldRunStage(startStage, "figure") && stillUnder("figure")) {
      const figureMode = input.figureMode ?? "auto";
      const teacherWorkbook =
        input.meta.documentKind === "science_workbook" &&
        input.meta.workbookRole === "teacher";
      const imageProvider = figureMode === "chatgpt-image2" ? "codex-cli" : (input.imageProvider ?? "gemini");
      const runtimeEnv = readRuntimeEnv() as Record<string, string | undefined>;
      let regenerate = figureMode === "chatgpt-image2"
        ? true
        : figureMode === "original" || figureMode === "grayscale"
          ? false
          : input.figureRegen !== false;
      const grayscale = figureMode === "grayscale" || (
        teacherWorkbook && (figureMode === "original" || figureMode === "auto")
      );
      const removeBlueText = teacherWorkbook;
      if (regenerate && imageProvider === "gemini" && !runtimeEnv.GEMINI_API_KEY && !runtimeEnv.GOOGLE_API_KEY) {
        send(logEvent(
          "figure",
          "GEMINI_API_KEY 미설정 — Gemini 재생성 건너뛰고 crop 폴백으로 진행합니다.",
          "warn",
        ));
        regenerate = false;
      }
      const figureModeLabel = figureMode === "chatgpt-image2"
        ? "ChatGPT 이미지2 재생성"
        : figureMode === "grayscale"
          ? "흑백 crop"
          : figureMode === "original"
            ? (teacherWorkbook ? "교사용 파란글씨 제거 + 흑백 crop" : "원본 crop")
            : regenerate
              ? `${imageProvider} 재생성`
              : (teacherWorkbook ? "교사용 파란글씨 제거 + 흑백 crop" : "crop");
      emitStageStart(send, "figure", `figure_processor.py를 실행합니다 (${figureModeLabel}).`);

      const figureResult = await runTargetedFigureStage({
        examDataPath: cache.paths.examData,
        outputDir: path.join(baseDir, "outputs", "images"),
        statusOutPath: cache.paths.figureStatus,
        regenerate,
        grayscale,
        removeBlueText,
        imageProvider,
        baseDir,
        signal,
        env: runtimeEnv as NodeJS.ProcessEnv,
        targetQuestionNumbers: input.targetQuestionNumbers,
      });

      // figure_status.json을 읽어 문제별 결과를 SSE로 흘려준다.
      // (figureRunner는 partial/failed 상태에도 status 파일을 쓰므로 항상 시도.)
      await emitFigureQuestionEvents(cache.paths.figureStatus, send);

      if (figureResult.status !== "failed") {
        const counts = await summarizeFigureCounts(cache.paths.figureStatus);
        const summary = "figure 처리 완료";
        const message = counts
          ? `figure_processor.py 완료: ${counts.ok}/${counts.total} 성공${counts.failed > 0 ? ` (실패 ${counts.failed})` : ""}`
          : "figure_processor.py 완료";
        emitStageDone(send, "figure", { summary, message });
      } else {
        const errorSummary = await summarizeFigureErrors(cache.paths.figureStatus);
        const quotaHint = "Gemini API 월 지출 한도 초과 — https://ai.studio/spend 에서 한도 상향 후 figure 단계만 재시도하세요.";
        const failSummary = errorSummary?.quotaExceeded
          ? "Gemini 지출 한도 초과"
          : "figure_processor.py 실패";
        const failMessage = errorSummary?.quotaExceeded
          ? `${quotaHint} (원인 샘플: ${errorSummary.sample})`
          : errorSummary?.sample
            ? `figure_processor.py 실패: ${errorSummary.sample}`
            : "figure_processor.py 실패";
        emitStageFailed(send, "figure", { summary: failSummary, message: failMessage });
        if (checkAborted()) return cancelled(providerTelemetry);
        return failed(providerTelemetry, failSummary);
      }
    }

    // ── Stage 5: Builder ───────────────────────
    if (!checkAborted() && shouldRunStage(startStage, "builder") && stillUnder("builder")) {
      emitStageStart(send, "builder", "deterministic builder runner를 실행합니다.");

      const builderStartedAt = Date.now();
      const builderResult = await runBuilderStage({ baseDir, cache });

      if (builderResult.status === "completed" && builderResult.output) {
        const relativeOutput = path.relative(baseDir, builderResult.output.hwpxPath);
        outputFile = relativeOutput;
        resultSummary = "builder 완료";
        emitStageDone(send, "builder", {
          summary: resultSummary,
          message: `HWPX 조립 완료 → ${relativeOutput}`,
        });
        send(fileEvent({ type: "hwpx", name: path.basename(relativeOutput), path: relativeOutput }));
      } else {
        emitStageFailed(send, "builder", {
          summary: builderResult.error?.message ?? "builder 실패",
          message: "deterministic builder 실패. LLM fallback 없이 작업을 중단합니다.",
        });
        providerTelemetry.push(
          createProviderTelemetryEntry({
            stageKey: undefined,
            workflowStageKey: "builder",
            requestedProvider: "auto",
            resolvedProvider: "claude-cli",
            attempt: 1,
            status: "failed",
            elapsedMs: Date.now() - builderStartedAt,
            retry: false,
            errorSummary: builderResult.error?.message?.slice(0, 300),
          })
        );
        await persistTelemetry(input, providerTelemetry, "failed");
        return failed(providerTelemetry, builderResult.error?.message);
      }

      providerTelemetry.push(
        createProviderTelemetryEntry({
          stageKey: undefined,
          workflowStageKey: "builder",
          requestedProvider: "auto",
          resolvedProvider: "claude-cli",
          attempt: 1,
          status: "success",
          elapsedMs: Date.now() - builderStartedAt,
          retry: false,
        })
      );

      await persistTelemetry(input, providerTelemetry, "running");
      if (checkAborted()) return cancelled(providerTelemetry);
    }

    // ── Stage 6: Checker (with auto-fix) ──────────
    const checkerAttempts = input.checkerMaxAttempts ?? 2;
    if (!checkAborted() && shouldRunStage(startStage, "checker") && stillUnder("checker") && checkerAttempts > 0) {
      emitStageStart(send, "checker", "deterministic checker runner를 실행합니다.");

      // resume이 startStage="checker"로 바로 진입하면 builder를 건너뛰어
      // outputFile이 비어 있다. 이전 builder 산출 경로를 복원한다.
      const hwpxPath = outputFile
        ? (path.isAbsolute(outputFile) ? outputFile : path.join(baseDir, outputFile))
        : await loadBuilderOutputPath(cache.paths.buildStatus, baseDir);

      const checkerStartedAt = Date.now();
      const { result: checkerResult, autofixed } = await runCheckerWithAutoFix(
        { hwpxPath, schoolLevel: input.meta.schoolLevel, subject: input.meta.subject },
        checkerAttempts
      );

      if (autofixed) {
        send(logEvent("checker", "auto-fix 적용됨: 결정적 수정 후 재검사 완료."));
      }

      providerTelemetry.push(
        createProviderTelemetryEntry({
          stageKey: undefined,
          workflowStageKey: "checker",
          requestedProvider: "auto",
          resolvedProvider: "claude-cli",
          attempt: 1,
          status: checkerResult.status === "completed" ? "success" : "failed",
          elapsedMs: Date.now() - checkerStartedAt,
          retry: false,
          ...(autofixed ? { downstreamCorrection: true } : {}),
        })
      );

      if (checkerResult.status === "completed" && checkerResult.output) {
        const issueCount = checkerResult.output.issues.length;
        resultSummary = `checker 완료: ${issueCount} issue(s)${autofixed ? " (auto-fixed)" : ""}`;
        // progress extra(issueCount)가 필요해 progressEvent는 primitive 사용.
        send(progressEvent("checker", 100, { issueCount }));
        send(stageEvent("checker", "done", { summary: resultSummary }));
        send(logEvent("checker", `검수 완료: ${issueCount}건 issue${autofixed ? " (auto-fixed)" : ""}`, "info"));
      } else {
        const issueCount = checkerResult.output?.issues.length ?? 0;
        const errorMsg = checkerResult.error?.message ?? `${issueCount} issue(s)`;
        emitStageFailed(send, "checker", {
          summary: errorMsg,
          message: `검수 실패: ${errorMsg}`,
        });
      }

      if (checkAborted()) return cancelled(providerTelemetry);
    } else if (checkerAttempts === 0 && shouldRunStage(startStage, "checker") && stillUnder("checker")) {
      send(logEvent("system", "checker 단계 건너뜀", "info"));
    }

    // ── Done ───────────────────────────────────
    if (checkAborted()) return cancelled(providerTelemetry);

    send(resultEvent("success", resultSummary, outputFile));
    await persistTelemetry(input, providerTelemetry, "done");

    return {
      status: "done",
      outputFile,
      resultSummary,
      providerTelemetry,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send(logEvent("system", `오케스트레이터 오류: ${message}`, "error"));
    send(resultEvent("failed", message));
    await persistTelemetry(input, providerTelemetry, "failed");
    return failed(providerTelemetry, message);
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

async function readCacheJson(filePath: string): Promise<unknown> {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * build_status.json에서 직전 builder 산출 HWPX 경로를 복원한다.
 * resume이 builder를 건너뛰고 checker로 바로 진입한 경우에 사용한다.
 */
async function loadBuilderOutputPath(buildStatusPath: string, baseDir: string): Promise<string | undefined> {
  const parsed = (await readCacheJson(buildStatusPath)) as { status?: string; outputFile?: string } | null;
  if (!parsed || parsed.status !== "completed" || !parsed.outputFile) return undefined;
  return path.isAbsolute(parsed.outputFile) ? parsed.outputFile : path.join(baseDir, parsed.outputFile);
}

/** 모든 문제의 cleaned 정리본이 이미 존재하면 false (skip), 하나라도 없으면 true. */
async function needsCleaningRun(cache: StageCache, questionNumbers: number[]): Promise<boolean> {
  if (questionNumbers.length === 0) return false;
  const checks = await Promise.all(
    questionNumbers.map((n) => fileExists(cache.cleanedImagePath(n)))
  );
  return checks.some((exists) => !exists);
}

/**
 * questionImages 배열의 path를 cleaned/q{N}.png 존재 시 그쪽으로 스왑한다.
 * cleaned가 없으면 원본 경로 그대로 둔다.
 */
async function swapToCleanedPaths(
  cache: StageCache,
  imgs: { number: number; path: string }[]
): Promise<{ number: number; path: string }[]> {
  return Promise.all(imgs.map(async (img) => {
    const cleanedPath = cache.cleanedImagePath(img.number);
    if (await fileExists(cleanedPath)) {
      return { number: img.number, path: cleanedPath };
    }
    return img;
  }));
}

interface FigureStatusFile {
  questions?: Record<string, {
    status?: string;
    finalImage?: string;
    error?: string;
  }>;
}

/**
 * figure_status.json을 읽어 문제별 figure 결과를 SSE `question` 이벤트로 흘려준다.
 * Navigator의 그림 dot이 완료/실패/경계불확실을 정확히 반영하도록 한다.
 */
async function summarizeFigureCounts(
  statusPath: string,
): Promise<{ total: number; ok: number; failed: number } | null> {
  const parsed = (await readCacheJson(statusPath)) as FigureStatusFile | null;
  if (!parsed?.questions) return null;
  let ok = 0;
  let failed = 0;
  let total = 0;
  for (const q of Object.values(parsed.questions)) {
    total += 1;
    if (q?.status === "failed" || q?.error) failed += 1;
    else ok += 1;
  }
  if (total === 0) return null;
  return { total, ok, failed };
}

async function summarizeFigureErrors(
  statusPath: string,
): Promise<{ quotaExceeded: boolean; sample: string } | null> {
  const parsed = (await readCacheJson(statusPath)) as FigureStatusFile | null;
  if (!parsed?.questions) return null;
  const errors: string[] = [];
  for (const q of Object.values(parsed.questions)) {
    if (q?.error) errors.push(q.error);
  }
  if (errors.length === 0) return null;
  const quotaPattern = /(429|RESOURCE_EXHAUSTED|quota|exceeded.*spend|free.*tier.*limit)/i;
  return { quotaExceeded: errors.some((e) => quotaPattern.test(e)), sample: errors[0] };
}

async function emitFigureQuestionEvents(
  statusPath: string,
  send: (event: SSEEvent) => void,
): Promise<void> {
  const parsed = await readCacheJson(statusPath) as FigureStatusFile | null;
  if (!parsed?.questions) return;
  for (const [key, q] of Object.entries(parsed.questions)) {
    const n = Number(key);
    if (!Number.isFinite(n)) continue;
    // SSE envelope status는 항상 "ok"로 둔다 — figure 단계의 ok/failed/boundary_uncertain
    // 구분은 payload 내부 status 필드로 전달하여 클라이언트 핸들러 필터에 막히지 않도록 한다.
    const payload: Record<string, unknown> = {
      status: q?.status ?? "ok",
      ...(q?.finalImage ? { finalImage: q.finalImage } : {}),
      ...(q?.error ? { error: q.error } : {}),
    };
    send({
      event: "question",
      data: { number: n, stage: "figure", status: "ok", data: payload },
    });
  }
}

function computeElapsedMs(startedAt?: string, completedAt?: string): number {
  if (!startedAt || !completedAt) return 0;
  return Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
}

async function persistTelemetry(
  input: OrchestratorInput,
  telemetry: ProviderTelemetryEntry[],
  status: string
): Promise<void> {
  if (!input.jobStore || !input.jobId) return;
  try {
    await input.jobStore.update(input.jobId, {
      providerTelemetry: telemetry,
      status,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // telemetry persistence is best-effort
  }
}

function cancelled(providerTelemetry: ProviderTelemetryEntry[]): OrchestratorResult {
  return { status: "cancelled", providerTelemetry };
}

function failed(providerTelemetry: ProviderTelemetryEntry[], message?: string): OrchestratorResult {
  return { status: "failed", resultSummary: message, providerTelemetry };
}

// ──────────────────────────────────────────────
// Per-Q figure forwarding (F3)
// ──────────────────────────────────────────────

import type { FigureRunnerInput, FigureRunnerOutput } from "./figureRunner";

type TargetedFigureInput = FigureRunnerInput & { targetQuestionNumbers?: number[] };

/**
 * figure_processor.py 실행 래퍼.
 * - targetQuestionNumbers 없음 → 전체 문제 처리 (기존 동작)
 * - 단일 → --question N 전달
 * - 복수 → 번호별 runFigureStage 반복 + figure_status.json 병합
 */
async function runTargetedFigureStage(
  input: TargetedFigureInput
): Promise<FigureRunnerOutput> {
  const targets = input.targetQuestionNumbers;

  if (!targets || targets.length === 0) {
    return runFigureStage(input);
  }

  if (targets.length === 1) {
    return runFigureStage({ ...input, questionNumber: targets[0] });
  }

  // 복수 문제: 번호별로 실행하고 figure_status.json을 병합한다.
  // figure_processor.py는 --question N 지정 시 해당 문제만 status에 기록(나머지 보존).
  // TS에서 각 실행 직후 읽어 최종 merged status를 직접 병합한다.
  const mergedQuestions: Record<string, unknown> = {};
  let overallStatus: "done" | "partial" | "failed" = "done";
  const needsAgentReview: number[] = [];

  for (const n of targets) {
    const result = await runFigureStage({ ...input, questionNumber: n });
    if (result.status === "failed") {
      overallStatus = "failed";
    } else if (result.status === "partial" && overallStatus !== "failed") {
      overallStatus = "partial";
    }
    if (result.needsAgentReview.length > 0) {
      needsAgentReview.push(...result.needsAgentReview);
    }
    // 이번 실행 결과를 figure_status.json에서 읽어 merged에 반영한다.
    try {
      const text = await readFile(input.statusOutPath, "utf8");
      const parsed = JSON.parse(text) as { questions?: Record<string, unknown> };
      if (parsed.questions) {
        Object.assign(mergedQuestions, parsed.questions);
      }
    } catch {
      // ignore — 이번 문제 결과를 반영 못 한 경우
    }
  }

  // merged 결과를 statusOutPath에 덮어쓴다.
  const mergedStatus = { status: overallStatus, questions: mergedQuestions };
  try {
    await writeFile(input.statusOutPath, JSON.stringify(mergedStatus, null, 2), "utf8");
  } catch {
    // ignore write errors — best effort
  }

  return {
    status: overallStatus,
    statusJsonPath: input.statusOutPath,
    needsAgentReview: [...new Set(needsAgentReview)].sort((a, b) => a - b),
  };
}
