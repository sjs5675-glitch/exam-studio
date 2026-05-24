/**
 * stagePlan.ts — Phase 3
 *
 * Codifies batch scheduling, verifier retry loop, and per-question stage plan
 * previously inlined inside orchestrator.ts and described in natural language
 * in .claude/skills/exam-create/SKILL.md (Steps 3, 4, 5).
 *
 * Exports:
 *   - buildStagePlan   : resume + state → per-question stage plan
 *   - runBatches       : concurrency-limited batch runner
 *   - applyVerifierRetry : verifier feedback rounds
 */

import type { ResumeCommand, ResumeStage } from "./resumeCommand";
import type { QuestionState } from "./resumeState";

// ──────────────────────────────────────────────
// buildStagePlan
// ──────────────────────────────────────────────

/**
 * Ordered list of per-question stages (subset of workflow stages that operate
 * per-question in the extractor→solver→verifier pipeline).
 */
export type PerQuestionStage = Extract<ResumeStage, "extractor" | "solver" | "verifier">;

const PER_QUESTION_STAGE_ORDER: PerQuestionStage[] = [
  "extractor",
  "solver",
  "verifier",
];

/** Index of each stage in PER_QUESTION_STAGE_ORDER (pre-computed for readability). */
const STAGE_IDX: Record<PerQuestionStage, number> = {
  extractor: 0,
  solver: 1,
  verifier: 2,
};

export interface PerQuestionPlan {
  questionNumber: number;
  /** Ordered list of stages that need to run for this question (may be empty if all cached). */
  stages: PerQuestionStage[];
}

export interface StagePlan {
  totalQuestions: number[];
  perQuestion: PerQuestionPlan[];
}

/**
 * Build a per-question stage plan from a resume command and current disk state.
 *
 * Rules:
 * - resume.questions=undefined → all questions in `allQuestions`
 * - state="verified" → stages=[] (skip entirely)
 * - state="solved" → start from verifier
 * - state="extracted" → start from solver
 * - state="none" → start from extractor
 * - If resume.fromStage is given, use that as the minimum start stage
 *   (overrides cache-based detection, but still skips stages if state implies skip).
 */
export function buildStagePlan(
  resume: ResumeCommand,
  states: Map<number, QuestionState>,
  allQuestions: number[],
): StagePlan {
  const targetQuestions = resume.questions ?? allQuestions;

  const perQuestion: PerQuestionPlan[] = targetQuestions.map((n) => {
    const state = states.get(n) ?? "none";

    // Determine the earliest stage the cache state requires.
    // "verified" = 0 stages needed; others map to the first incomplete stage.
    const stateStartIdx =
      state === "verified" ? PER_QUESTION_STAGE_ORDER.length // beyond the array = skip all
      : state === "solved"    ? STAGE_IDX.verifier
      : state === "extracted" ? STAGE_IDX.solver
      : STAGE_IDX.extractor;

    // If resume.fromStage maps to a per-question stage, it sets a desired start.
    // Effective start = min(fromStage, stateStartIdx) — we can skip stages that are
    // already cached, but we cannot skip stages that are required by the disk state.
    // Example: state=none + fromStage=solver → still need extractor first.
    // Example: state=verified + fromStage=solver → run from solver (re-run override).
    let effectiveStartIdx = stateStartIdx;
    if (resume.fromStage) {
      const fromIdx = STAGE_IDX[resume.fromStage as PerQuestionStage] ?? -1;
      if (fromIdx !== -1) {
        // fromStage overrides: if state requires an earlier stage (smaller index), use that.
        // If state allows skipping to fromStage or further, use fromStage.
        effectiveStartIdx = Math.min(fromIdx, stateStartIdx);
      }
      // fromStage is a non-per-question stage → fall through (use stateStartIdx)
    }

    if (effectiveStartIdx >= PER_QUESTION_STAGE_ORDER.length) {
      return { questionNumber: n, stages: [] };
    }

    const stages = PER_QUESTION_STAGE_ORDER.slice(effectiveStartIdx);
    return { questionNumber: n, stages };
  });

  return {
    totalQuestions: allQuestions,
    perQuestion,
  };
}

// ──────────────────────────────────────────────
// runBatches
// ──────────────────────────────────────────────

/** Default concurrency for batch stage runs (8 = SKILL.md Step 3 배치 크기). */
export const DEFAULT_BATCH_CONCURRENCY = 8;

export interface RunBatchesOptions<T> {
  concurrency: number;
  items: T[];
  worker: (item: T, signal: AbortSignal) => Promise<unknown>;
  onProgress?: (done: number, total: number) => void;
  signal: AbortSignal;
}

/**
 * Run `worker` over `items` with at most `concurrency` concurrent executions.
 *
 * - Results are returned in input order.
 * - Individual failures are captured as `{ ok: false; error }` rather than re-thrown.
 * - If `signal` is already aborted when an item is about to run, the item is
 *   captured as `{ ok: false; error: AbortError }`.
 * - `onProgress(done, total)` is called after each item completes.
 *
 * This function codifies the SKILL.md "8개씩 배치, 병렬" pattern (Steps 3-1, 4-1, 4-2)
 * and unifies orchestrator.ts `runWithConcurrency` with a named, typed interface.
 */
export async function runBatches<T>(
  opts: RunBatchesOptions<T>
): Promise<Array<{ ok: true; value: unknown } | { ok: false; error: unknown }>> {
  const { concurrency, items, worker, onProgress, signal } = opts;

  const results: Array<{ ok: true; value: unknown } | { ok: false; error: unknown }> =
    new Array(items.length);
  const queue = items.map((item, index) => ({ item, index }));
  let queueIndex = 0;
  let done = 0;

  async function runOne(): Promise<void> {
    while (queueIndex < queue.length) {
      const current = queue[queueIndex++];
      if (!current) break;

      if (signal.aborted) {
        results[current.index] = {
          ok: false,
          error: new DOMException("Aborted", "AbortError"),
        };
        done++;
        onProgress?.(done, items.length);
        continue;
      }

      try {
        const value = await worker(current.item, signal);
        results[current.index] = { ok: true, value };
      } catch (error) {
        results[current.index] = { ok: false, error };
      }
      done++;
      onProgress?.(done, items.length);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length || 1) },
    () => runOne()
  );
  await Promise.all(workers);

  return results;
}

// ──────────────────────────────────────────────
// applyVerifierRetry
// ──────────────────────────────────────────────

export interface VerifierRetryConfig {
  /** Maximum total verifier attempts (default: 3). Codifies SKILL.md "최대 3회". */
  maxAttempts: number;
  onAttemptFail?: (attempt: number, feedback: string) => void;
}

export interface VerifierRetryResult {
  /** "pass" if verifier approved; "revised" if verifier feedback was applied by solver. */
  status: "pass" | "revised";
  finalSolverOutput: unknown;
  finalVerifierOutput: unknown;
  attempts: number;
  feedbackHistory: string[];
}

/**
 * Apply verifier feedback rounds.
 *
 * One round means:
 *   1. Run verifier against the current solver output.
 *   2. If verifier passes, finish.
 *   3. If verifier fails, pass its feedback to solver and adopt that revised
 *      solver output as the next current output.
 *
 * The final round still runs solver on fail. We do not require a follow-up
 * verifier pass after the last feedback application; verifier is a reviewer
 * for improving solver output, not a hard approval gate.
 *
 * @param runSolver         — Calls the solver, optionally with a feedback string.
 *                            If `initialSolverOutput` is provided, the first verifier run uses
 *                            that output directly (no initial solver call). Failed verifier
 *                            rounds always call `runSolver(feedback)`.
 * @param runVerifier       — Calls the verifier with the current solver output.
 *                            Must return { status: "pass" | "fail"; feedback?: string }.
 * @param config            — { maxAttempts: 3, onAttemptFail?, initialSolverOutput? }
 */
export async function applyVerifierRetry(
  runSolver: (feedback?: string) => Promise<unknown>,
  runVerifier: (
    solverOutput: unknown
  ) => Promise<{ status: "pass" | "fail"; feedback?: string }>,
  config: VerifierRetryConfig & { initialSolverOutput?: unknown }
): Promise<VerifierRetryResult> {
  const { maxAttempts = 3, onAttemptFail, initialSolverOutput } = config;
  const feedbackHistory: string[] = [];
  let attempt = 0;
  // If caller provides pre-computed solver output, skip the initial solver call.
  let currentSolverOutput: unknown =
    initialSolverOutput !== undefined ? initialSolverOutput : await runSolver(undefined);
  let lastVerifierOutput: { status: "pass" | "fail"; feedback?: string } | undefined;
  let revised = false;

  while (attempt < maxAttempts) {
    const verifierOutput = await runVerifier(currentSolverOutput);
    lastVerifierOutput = verifierOutput;
    attempt++;

    if (verifierOutput.status === "pass") {
      return {
        status: "pass",
        finalSolverOutput: currentSolverOutput,
        finalVerifierOutput: verifierOutput,
        attempts: attempt,
        feedbackHistory,
      };
    }

    // Verifier failed.
    const feedback = verifierOutput.feedback ?? "";
    if (feedback) feedbackHistory.push(feedback);
    onAttemptFail?.(attempt, feedback);

    // Re-run solver with feedback and adopt the revised output. If this was
    // the final round, the revised solver output is the final result.
    currentSolverOutput = await runSolver(feedback || undefined);
    revised = true;
  }

  return {
    status: revised ? "revised" : "pass",
    finalSolverOutput: currentSolverOutput,
    finalVerifierOutput: lastVerifierOutput,
    attempts: attempt,
    feedbackHistory,
  };
}
