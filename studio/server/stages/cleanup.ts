/**
 * cleanup.ts — Phase 2 (updated Phase 7)
 *
 * Deterministic cache cleanup for resume operations.
 * Codifies the cleanup_from_stage Python logic in
 * .claude/skills/exam-create/SKILL.md:88-128.
 *
 * Stage → deletion targets table (P7 원칙: 어느 stage에서 재개해도 exam_data는 새로 rebuild):
 * | fromStage     | 삭제 대상                                                                          |
 * |---------------|------------------------------------------------------------------------------------|
 * | extractor     | _extracted, _solved, _verified, figure outputs, figure_status.json, exam_data.json |
 * | solver        | _solved, _verified, figure outputs, figure_status.json, exam_data.json             |
 * | verifier      | _verified, figure outputs, figure_status.json, exam_data.json                      |
 * | figure        | figure outputs, figure_status.json, exam_data.json                                 |
 * | confirm       | exam_data.json (builder 진입 직전)                                                  |
 * | builder       | hwpx outputs, exam_data.json                                                       |
 * | cleaned       | _extracted, downstream all (이미지 보존)                                            |
 * | image_replace | 원본 이미지 + downstream all                                                        |
 * | review_extract| _solved, _verified, exam_data.json                                                 |
 */

import { unlink, readdir } from "fs/promises";
import path from "path";
import type { StageCache } from "./cache";
import type { ResumeStage } from "./resumeCommand";

export interface CleanupResult {
  deleted: string[];
  skipped: string[];
}

/**
 * Delete cache files for the given question numbers starting from the given stage.
 * Idempotent — files that don't exist are counted as skipped, not errors.
 */
export async function cleanupFromStage(
  cache: StageCache,
  questionNums: number[],
  fromStage: ResumeStage,
): Promise<CleanupResult> {
  const deleted: string[] = [];
  const skipped: string[] = [];

  async function tryDelete(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
      deleted.push(filePath);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") {
        skipped.push(filePath);
      } else {
        throw err;
      }
    }
  }

  switch (fromStage) {
    case "image_replace":
    case "cleaned": {
      // Delete cleaned images + all downstream cache
      // (image_replace: caller deletes the original before invoking; cleaned: original is preserved)
      for (const n of questionNums) {
        await tryDelete(
          path.join(cache.paths.questionImagesDir, "cleaned", `q${pad(n)}.png`)
        );
      }
      await deleteExtractorAndDownstream(cache, questionNums, tryDelete);
      break;
    }

    case "extractor": {
      await deleteExtractorAndDownstream(cache, questionNums, tryDelete);
      break;
    }

    case "review_extract": {
      // Keep _extracted, delete _solved, _verified, exam_data.json
      for (const n of questionNums) {
        await tryDelete(cache.solverResultPath(n));
        await tryDelete(cache.verifierResultPath(n));
      }
      await tryDelete(cache.paths.examData);
      break;
    }

    case "solver": {
      for (const n of questionNums) {
        await tryDelete(cache.solverResultPath(n));
        await tryDelete(cache.verifierResultPath(n));
      }
      await deleteFigureOutputs(cache, questionNums, tryDelete);
      await tryDelete(cache.paths.figureStatus);
      await tryDelete(cache.paths.examData);
      break;
    }

    case "verifier": {
      for (const n of questionNums) {
        await tryDelete(cache.verifierResultPath(n));
      }
      await deleteFigureOutputs(cache, questionNums, tryDelete);
      await tryDelete(cache.paths.figureStatus);
      await tryDelete(cache.paths.examData);
      break;
    }

    case "figure": {
      await deleteFigureOutputs(cache, questionNums, tryDelete);
      await tryDelete(cache.paths.figureStatus);
      await deleteExamData(cache, tryDelete);
      break;
    }

    case "confirm": {
      // confirm = builder 진입 직전. exam_data를 새 rebuild.
      await deleteExamData(cache, tryDelete);
      break;
    }

    case "builder": {
      await deleteHwpxOutputs(cache, tryDelete);
      await deleteExamData(cache, tryDelete);
      break;
    }

    default: {
      // Exhaustive check — TypeScript should catch unknown stages at compile time
      const _never: never = fromStage;
      throw new Error(`Unknown fromStage: ${_never}`);
    }
  }

  return { deleted, skipped };
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

type TryDelete = (filePath: string) => Promise<void>;

async function deleteExamData(
  cache: StageCache,
  tryDelete: TryDelete
): Promise<void> {
  await tryDelete(cache.paths.examData);
}

async function deleteExtractorAndDownstream(
  cache: StageCache,
  questionNums: number[],
  tryDelete: TryDelete
): Promise<void> {
  for (const n of questionNums) {
    await tryDelete(cache.extractorResultPath(n));
    await tryDelete(cache.solverResultPath(n));
    await tryDelete(cache.verifierResultPath(n));
  }
  await deleteFigureOutputs(cache, questionNums, tryDelete);
  await tryDelete(cache.paths.figureStatus);
  await tryDelete(cache.paths.examData);
}

async function deleteFigureOutputs(
  cache: StageCache,
  questionNums: number[],
  tryDelete: TryDelete
): Promise<void> {
  const outputsImagesDir = path.join(cache.paths.examDir, "..", "..", "outputs", "images");
  for (const n of questionNums) {
    const figurePath = path.join(outputsImagesDir, `prob${n}_final.png`);
    await tryDelete(figurePath);
  }
}

async function deleteHwpxOutputs(
  cache: StageCache,
  tryDelete: TryDelete
): Promise<void> {
  const outputsDir = path.join(cache.paths.examDir, "..", "..", "outputs");
  let entries: string[] = [];
  try {
    entries = await readdir(outputsDir);
  } catch {
    // outputs/ might not exist yet — skip silently
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith(".hwpx")) {
      await tryDelete(path.join(outputsDir, entry));
    }
  }
  // Also delete build_status.json
  await tryDelete(cache.paths.buildStatus);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
