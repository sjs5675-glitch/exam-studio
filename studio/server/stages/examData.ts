import { readFile, writeFile } from "fs/promises";
import type { StageCache } from "./cache";
import type { ExamMetaInput, ExamMeta } from "@/lib/exam/meta";
import { buildFilenameBase, isExamMetaComplete } from "@/lib/exam/meta";

/**
 * Per-question cache merge contract (verifier = solver reviewer).
 *
 * Cache files store disjoint field sets, NOT progressively-enriched versions of
 * the same object. They must be merged, not picked:
 *
 *   _extracted.json : problem definition
 *                     (type, score, parts, choices, has_figure, condition_box,
 *                      bogi_box, data_table, explanation_table, figure_info, ...)
 *                     — produced by extractor, kept as-is throughout the pipeline.
 *
 *   _solved.json    : { number, answer, explanation_parts } only
 *                     — produced by solver. On verifier-feedback retries the
 *                       orchestrator re-runs solver, which OVERWRITES this file,
 *                       so the latest _solved.json always carries the corrected
 *                       answer/explanation (see orchestrator.ts applyVerifierRetry).
 *
 *   _verified.json  : { number, status, issues, feedback } only
 *                     — reviewer ledger. NEVER contains answer/explanation_parts or
 *                       problem-definition fields, so MUST NOT participate in
 *                       problem-body merge. Used by orchestrator to seed solver
 *                       feedback rounds.
 *
 * The canonical merged problem = { ...extracted, ...solved }.
 * build_hwpx.py / assemble.py expect this shape (e.g. prob["type"], prob["parts"]).
 */

/**
 * A single problem entry in the combined exam_data.json.
 * The shape is determined by the extractor/solver/verifier JSON output.
 */
export type ExamDataProblem = Record<string, unknown>;

/**
 * Top-level shape of exam_data.json.
 * Uses `info` key for compatibility with figure_processor.py and build_hwpx.py.
 * `info` is typed as ExamMeta (camelCase only) — snake_case dual-emit removed in P2.
 */
export interface ExamDataOutput {
  info: ExamMeta;
  problems: ExamDataProblem[];
}

/**
 * Validate that meta has all required fields and return a complete ExamMeta.
 * Automatically fills in `filenameBase` if not supplied.
 * Throws if required fields are missing.
 */
function assertCompleteMeta(meta: ExamMetaInput): ExamMeta {
  if (!isExamMetaComplete(meta)) {
    throw new Error(
      `exam_data.json: meta missing required fields (schoolLevel/school/grade/year/subject/semester/examType/range)`
    );
  }
  const complete: ExamMeta = { ...meta };
  complete.filenameBase = meta.filenameBase ?? buildFilenameBase(complete);
  return complete;
}

/**
 * Build and write exam_data.json by merging per-question cache files.
 *
 * Merge: { ...extracted, ...solved }. _verified.json is gating only and never
 * contributes problem-body fields. Both _extracted and _solved are REQUIRED
 * (orchestrator only invokes this with question numbers that passed the
 * solver stage), so missing either raises.
 */
export async function buildExamDataJson(input: {
  cache: StageCache;
  meta: ExamMetaInput;
  questionNumbers: number[];
}): Promise<ExamDataOutput> {
  const { cache, meta, questionNumbers } = input;
  const problems: ExamDataProblem[] = [];

  for (const n of questionNumbers) {
    const problem = await mergeQuestionSources(cache, n, { requireSolved: true });
    problems.push(problem);
  }

  const completeMeta = assertCompleteMeta(meta);
  const output: ExamDataOutput = {
    info: completeMeta,
    problems,
  };

  await writeFile(
    cache.paths.examData,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  return output;
}

/**
 * Merge per-question cache sources into a single problem object.
 *
 * Layers: base = _extracted.json (problem definition);
 *         overlay = _solved.json (answer + explanation_parts).
 * _verified.json is intentionally NOT a source — see contract at top of file.
 *
 * - `requireSolved: true`  → solver result must exist (orchestrator main path).
 * - `requireSolved: false` → solver result may be absent; extracted-only is
 *   returned (aggregate path may want to surface partially-processed problems).
 * If _extracted is missing this always throws — no fallback can produce the
 * problem-definition fields (type/score/parts/choices) build_hwpx.py requires.
 */
async function mergeQuestionSources(
  cache: StageCache,
  n: number,
  opts: { requireSolved: boolean }
): Promise<ExamDataProblem> {
  const [extracted, solved] = await Promise.all([
    tryReadJson(cache.extractorResultPath(n)),
    tryReadJson(cache.solverResultPath(n)),
  ]);

  if (!extracted) {
    throw new Error(
      `missing extracted for Q${n}: _extracted.json could not be read (problem definition required)`
    );
  }
  if (opts.requireSolved && !solved) {
    throw new Error(
      `missing solved for Q${n}: _solved.json could not be read (answer/explanation required)`
    );
  }

  return solved ? { ...extracted, ...solved } : extracted;
}

async function tryReadJson(filePath: string): Promise<ExamDataProblem | null> {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text) as ExamDataProblem;
  } catch {
    return null;
  }
}
