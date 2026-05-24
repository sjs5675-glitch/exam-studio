import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, access } from "fs/promises";
import os from "os";
import path from "path";
import { FileBackedStageCache } from "../cache";
import { cleanupFromStage } from "../cleanup";

// ──────────────────────────────────────────────
// Test setup helpers
// ──────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cleanup-test-"));
  tempDirs.push(dir);
  return dir;
}

async function makeCache(baseDir: string): Promise<FileBackedStageCache> {
  const examDir = path.join(baseDir, "inputs", "시험지 제작");
  await mkdir(path.join(examDir, ".v3cache"), { recursive: true });
  await mkdir(path.join(examDir, "question_images", "cleaned"), { recursive: true });
  const outputsImages = path.join(baseDir, "outputs", "images");
  await mkdir(outputsImages, { recursive: true });
  const outputsDir = path.join(baseDir, "outputs");
  await mkdir(outputsDir, { recursive: true });
  return new FileBackedStageCache(examDir);
}

async function touchFile(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("cleanupFromStage — extractor", () => {
  it("deletes _extracted, _solved, _verified, figure outputs, figure_status.json, exam_data.json", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    await touchFile(cache.extractorResultPath(1));
    await touchFile(cache.solverResultPath(1));
    await touchFile(cache.verifierResultPath(1));
    await touchFile(cache.paths.figureStatus);
    await touchFile(cache.paths.examData);

    const result = await cleanupFromStage(cache, [1], "extractor");

    expect(await fileExists(cache.extractorResultPath(1))).toBe(false);
    expect(await fileExists(cache.solverResultPath(1))).toBe(false);
    expect(await fileExists(cache.verifierResultPath(1))).toBe(false);
    expect(await fileExists(cache.paths.figureStatus)).toBe(false);
    expect(await fileExists(cache.paths.examData)).toBe(false);
    expect(result.deleted.length).toBeGreaterThanOrEqual(5);
  });
});

describe("cleanupFromStage — solver", () => {
  it("deletes _solved, _verified, figure outputs, figure_status.json, exam_data.json; keeps _extracted", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    await touchFile(cache.extractorResultPath(2));
    await touchFile(cache.solverResultPath(2));
    await touchFile(cache.verifierResultPath(2));
    await touchFile(cache.paths.figureStatus);
    await touchFile(cache.paths.examData);

    await cleanupFromStage(cache, [2], "solver");

    expect(await fileExists(cache.extractorResultPath(2))).toBe(true);
    expect(await fileExists(cache.solverResultPath(2))).toBe(false);
    expect(await fileExists(cache.verifierResultPath(2))).toBe(false);
    expect(await fileExists(cache.paths.figureStatus)).toBe(false);
    expect(await fileExists(cache.paths.examData)).toBe(false);
  });
});

describe("cleanupFromStage — verifier", () => {
  it("deletes _verified, figure outputs, figure_status.json, and exam_data.json; keeps _extracted and _solved", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    await touchFile(cache.extractorResultPath(3));
    await touchFile(cache.solverResultPath(3));
    await touchFile(cache.verifierResultPath(3));
    await touchFile(cache.paths.figureStatus);
    await touchFile(cache.paths.examData);

    await cleanupFromStage(cache, [3], "verifier");

    expect(await fileExists(cache.extractorResultPath(3))).toBe(true);
    expect(await fileExists(cache.solverResultPath(3))).toBe(true);
    expect(await fileExists(cache.verifierResultPath(3))).toBe(false);
    expect(await fileExists(cache.paths.figureStatus)).toBe(false);
    expect(await fileExists(cache.paths.examData)).toBe(false);
  });
});

describe("cleanupFromStage — figure", () => {
  it("deletes figure outputs, figure_status.json, and exam_data.json; keeps per-question cache", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    await touchFile(cache.extractorResultPath(1));
    await touchFile(cache.solverResultPath(1));
    await touchFile(cache.verifierResultPath(1));
    await touchFile(cache.paths.figureStatus);
    await touchFile(cache.paths.examData);

    await cleanupFromStage(cache, [1], "figure");

    expect(await fileExists(cache.extractorResultPath(1))).toBe(true);
    expect(await fileExists(cache.solverResultPath(1))).toBe(true);
    expect(await fileExists(cache.verifierResultPath(1))).toBe(true);
    expect(await fileExists(cache.paths.figureStatus)).toBe(false);
    expect(await fileExists(cache.paths.examData)).toBe(false);
  });
});

describe("cleanupFromStage — confirm", () => {
  it("deletes exam_data.json (builder 진입 직전 rebuild 준비); keeps everything else", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    await touchFile(cache.extractorResultPath(1));
    await touchFile(cache.paths.figureStatus);
    await touchFile(cache.paths.examData);

    await cleanupFromStage(cache, [1], "confirm");

    expect(await fileExists(cache.extractorResultPath(1))).toBe(true);
    expect(await fileExists(cache.paths.figureStatus)).toBe(true);
    expect(await fileExists(cache.paths.examData)).toBe(false);
  });
});

describe("cleanupFromStage — builder", () => {
  it("deletes .hwpx files, build_status.json, and exam_data.json", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    const outputsDir = path.join(baseDir, "outputs");
    const hwpxFile = path.join(outputsDir, "test_output.hwpx");
    await touchFile(hwpxFile);
    await touchFile(cache.paths.buildStatus);
    await touchFile(cache.paths.examData);

    await cleanupFromStage(cache, [1], "builder");

    expect(await fileExists(hwpxFile)).toBe(false);
    expect(await fileExists(cache.paths.buildStatus)).toBe(false);
    expect(await fileExists(cache.paths.examData)).toBe(false);
  });
});

describe("cleanupFromStage — cleaned", () => {
  it("deletes cleaned image + all downstream (extracted/solved/verified/figure/examData)", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    const cleanedPath = path.join(cache.paths.questionImagesDir, "cleaned", "q01.png");
    await touchFile(cleanedPath);
    await touchFile(cache.extractorResultPath(1));
    await touchFile(cache.solverResultPath(1));
    await touchFile(cache.paths.examData);

    await cleanupFromStage(cache, [1], "cleaned");

    expect(await fileExists(cleanedPath)).toBe(false);
    expect(await fileExists(cache.extractorResultPath(1))).toBe(false);
    expect(await fileExists(cache.solverResultPath(1))).toBe(false);
    expect(await fileExists(cache.paths.examData)).toBe(false);
  });
});

describe("cleanupFromStage — image_replace", () => {
  it("deletes cleaned image + all downstream", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    const cleanedPath = path.join(cache.paths.questionImagesDir, "cleaned", "q02.png");
    await touchFile(cleanedPath);
    await touchFile(cache.extractorResultPath(2));
    await touchFile(cache.verifierResultPath(2));
    await touchFile(cache.paths.examData);

    await cleanupFromStage(cache, [2], "image_replace");

    expect(await fileExists(cleanedPath)).toBe(false);
    expect(await fileExists(cache.extractorResultPath(2))).toBe(false);
    expect(await fileExists(cache.verifierResultPath(2))).toBe(false);
    expect(await fileExists(cache.paths.examData)).toBe(false);
  });
});

describe("cleanupFromStage — review_extract", () => {
  it("deletes _solved, _verified, exam_data.json; keeps _extracted", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    await touchFile(cache.extractorResultPath(1));
    await touchFile(cache.solverResultPath(1));
    await touchFile(cache.verifierResultPath(1));
    await touchFile(cache.paths.examData);

    await cleanupFromStage(cache, [1], "review_extract");

    expect(await fileExists(cache.extractorResultPath(1))).toBe(true);
    expect(await fileExists(cache.solverResultPath(1))).toBe(false);
    expect(await fileExists(cache.verifierResultPath(1))).toBe(false);
    expect(await fileExists(cache.paths.examData)).toBe(false);
  });
});

describe("cleanupFromStage — idempotent", () => {
  it("running twice does not throw even if files are already gone", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    // No files created — all should be skipped
    const result1 = await cleanupFromStage(cache, [1], "extractor");
    expect(result1.deleted).toHaveLength(0);

    const result2 = await cleanupFromStage(cache, [1], "extractor");
    expect(result2.deleted).toHaveLength(0);
  });
});

describe("cleanupFromStage — multiple questions", () => {
  it("deletes files for all specified question numbers", async () => {
    const baseDir = await makeTempDir();
    const cache = await makeCache(baseDir);

    await touchFile(cache.verifierResultPath(1));
    await touchFile(cache.verifierResultPath(2));
    await touchFile(cache.verifierResultPath(3));

    await cleanupFromStage(cache, [1, 2, 3], "verifier");

    expect(await fileExists(cache.verifierResultPath(1))).toBe(false);
    expect(await fileExists(cache.verifierResultPath(2))).toBe(false);
    expect(await fileExists(cache.verifierResultPath(3))).toBe(false);
  });
});
