import { access } from "fs/promises";
import type { StageCache } from "./cache";

/**
 * Per-question state from cache scan.
 * Matches the 4-state classification in SKILL.md:130-143 (detect_resume_state).
 */
export type QuestionState = "none" | "extracted" | "solved" | "verified";

/**
 * Scan cache files and return a map of question number → completion state.
 * Codifies SKILL.md:130-143 `detect_resume_state` Python logic as a deterministic TS function.
 */
export async function detectQuestionStates(
  cache: StageCache,
  questionNums: number[]
): Promise<Map<number, QuestionState>> {
  const entries = await Promise.all(
    questionNums.map(async (n) => {
      const [hasVerified, hasSolved, hasExtracted] = await Promise.all([
        fileExists(cache.verifierResultPath(n)),
        fileExists(cache.solverResultPath(n)),
        fileExists(cache.extractorResultPath(n)),
      ]);
      let state: QuestionState;
      if (hasVerified) {
        state = "verified";
      } else if (hasSolved) {
        state = "solved";
      } else if (hasExtracted) {
        state = "extracted";
      } else {
        state = "none";
      }
      return [n, state] as const;
    })
  );
  return new Map(entries);
}

/**
 * Ordered list of workflow stages. Each stage is identified by a string key.
 * "confirm" is treated as equivalent to "builder" (figure review complete).
 */
export type WorkflowStage =
  | "extractor"
  | "solver"
  | "verifier"
  | "figure"
  | "builder"
  | "checker";

const STAGE_ORDER: WorkflowStage[] = [
  "extractor",
  "solver",
  "verifier",
  "figure",
  "builder",
  "checker",
];

/**
 * Result of determining the start stage for a workflow run.
 *
 * `startStage` is the earliest stage that needs to run.
 * `targetQuestions` is the list of question numbers that still need processing
 * (for stages that operate per-question).
 */
interface DetermineStartStageResult {
  startStage: WorkflowStage;
  targetQuestions: number[];
}

/**
 * Determine which stage the orchestrator should start from, and which
 * question numbers still require processing.
 *
 * Rules:
 * 1. If `resumeFrom` is explicitly provided, use it directly (with "confirm" → "builder").
 * 2. Otherwise scan the cache for each question to find the earliest incomplete stage.
 * 3. "targetQuestions" for extractor/solver/verifier stages contains only
 *    questions that have not yet completed that stage.
 *    For figure/builder/checker, all questions are returned (non-per-question stages).
 */
export async function determineStartStage(
  resumeFrom: string | undefined,
  cache: StageCache,
  questionNumbers: number[]
): Promise<DetermineStartStageResult> {
  // "auto" sentinel from the [작업 재개] button → fall through to disk-scan.
  // (Without this, normalizeResumeName falls back to "extractor" and re-runs
  // every downstream stage including figure even when artifacts already exist.)
  if (resumeFrom && resumeFrom !== "auto") {
    const normalized = normalizeResumeName(resumeFrom);
    return {
      startStage: normalized,
      targetQuestions: questionNumbers,
    };
  }

  // Auto-detect from cache (resumeFrom undefined or "auto").
  return detectFromCache(cache, questionNumbers);
}

/**
 * Normalize resume names including legacy aliases.
 */
function normalizeResumeName(name: string): WorkflowStage {
  if (name === "confirm") return "builder";
  if (STAGE_ORDER.includes(name as WorkflowStage)) {
    return name as WorkflowStage;
  }
  // Unknown → start from beginning.
  return "extractor";
}

/**
 * Scan cache files to detect the earliest stage that still has incomplete work.
 */
async function detectFromCache(
  cache: StageCache,
  questionNumbers: number[]
): Promise<DetermineStartStageResult> {
  // Determine per-question completion for each model stage independently.
  const extractorDone: number[] = [];
  const solverDone: number[] = [];
  const verifierDone: number[] = [];

  for (const n of questionNumbers) {
    const [hasExtracted, hasSolved, hasVerified] = await Promise.all([
      fileExists(cache.extractorResultPath(n)),
      fileExists(cache.solverResultPath(n)),
      fileExists(cache.verifierResultPath(n)),
    ]);

    if (hasExtracted) extractorDone.push(n);
    if (hasSolved) solverDone.push(n);
    if (hasVerified) verifierDone.push(n);
  }

  // Determine which questions still need each stage.
  const needsExtractor = questionNumbers.filter((n) => !extractorDone.includes(n));
  const needsSolver = questionNumbers.filter((n) => !solverDone.includes(n));
  const needsVerifier = questionNumbers.filter((n) => !verifierDone.includes(n));

  if (needsExtractor.length > 0) {
    return { startStage: "extractor", targetQuestions: needsExtractor };
  }

  if (needsSolver.length > 0) {
    return { startStage: "solver", targetQuestions: needsSolver };
  }

  if (needsVerifier.length > 0) {
    return { startStage: "verifier", targetQuestions: needsVerifier };
  }

  // Check figure_status.json for figure stage completion.
  const hasFigureStatus = await fileExists(cache.paths.figureStatus);
  if (!hasFigureStatus) {
    return { startStage: "figure", targetQuestions: questionNumbers };
  }

  // Check build_status.json for builder stage completion.
  const hasBuildStatus = await fileExists(cache.paths.buildStatus);
  if (!hasBuildStatus) {
    return { startStage: "builder", targetQuestions: questionNumbers };
  }

  // Default: start from checker (or repeat if already done).
  return { startStage: "checker", targetQuestions: questionNumbers };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return true if `target` stage should run given a `startStage`.
 */
export function shouldRunStage(startStage: WorkflowStage, target: WorkflowStage): boolean {
  return STAGE_ORDER.indexOf(startStage) <= STAGE_ORDER.indexOf(target);
}
