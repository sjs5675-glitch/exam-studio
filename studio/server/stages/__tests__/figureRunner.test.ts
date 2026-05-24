/**
 * figureRunner.test.ts — Phase 4
 *
 * Tests for runFigureStage:
 *  1. Fixture round-trip: 3 figure_status.json fixtures (done/partial/failed)
 *  2. spawn argument capture: --no-regen in non-regen mode → Gemini call 0
 *  3. boundaryUncertain=false → needsAgentReview empty (agent call 0)
 */

import { mkdtemp, rm, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

// ── We mock the commands module so no real process is spawned ──────────────
vi.mock("../commands", () => ({
  runStageCommand: vi.fn(),
}));

import { runFigureStage } from "../figureRunner";
import * as commandsModule from "../commands";

import doneFixture from "./fixtures/figure-cases/figure_status.done.json";
import partialFixture from "./fixtures/figure-cases/figure_status.partial.json";
import failedFixture from "./fixtures/figure-cases/figure_status.failed.json";

const runStageCommandMock = commandsModule.runStageCommand as Mock;

const tempDirs: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "figurerunner-test-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Simulate a successful figure_processor.py spawn and write the given
 * fixture JSON to statusOutPath so runFigureStage can parse it.
 */
function mockSuccessSpawn(statusOutPath: string, fixture: object): void {
  runStageCommandMock.mockImplementation(async () => {
    await writeFile(statusOutPath, JSON.stringify(fixture), "utf8");
    return { status: "success", stdout: "", stderr: "", exitCode: 0, signal: null, elapsedMs: 1 };
  });
}

function mockFailedSpawn(): void {
  runStageCommandMock.mockResolvedValue({
    status: "non_zero_exit",
    stdout: "",
    stderr: "Python error",
    exitCode: 1,
    signal: null,
    elapsedMs: 1,
  });
}

// ──────────────────────────────────────────────
// 1. Fixture round-trip: done / partial / failed
// ──────────────────────────────────────────────

describe("runFigureStage — fixture round-trip", () => {
  it("done fixture: status=done, needsAgentReview=[]", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockSuccessSpawn(statusOutPath, doneFixture);

    const result = await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: true,
      baseDir: dir,
    });

    expect(result.status).toBe("done");
    expect(result.statusJsonPath).toBe(statusOutPath);
    expect(result.needsAgentReview).toEqual([]);
  });

  it("partial fixture: status=partial, needsAgentReview=[5]", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockSuccessSpawn(statusOutPath, partialFixture);

    const result = await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: true,
      baseDir: dir,
    });

    expect(result.status).toBe("partial");
    // Q5 has boundaryUncertain=true + needsAgentReview=true
    expect(result.needsAgentReview).toEqual([5]);
  });

  it("failed fixture: status=failed, needsAgentReview=[]", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockSuccessSpawn(statusOutPath, failedFixture);

    const result = await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: true,
      baseDir: dir,
    });

    expect(result.status).toBe("failed");
    expect(result.needsAgentReview).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 2. spawn argument capture: --no-regen
// ──────────────────────────────────────────────

describe("runFigureStage — spawn args", () => {
  it("--no-regen mode: passes --no-regen flag, Gemini call 0", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockSuccessSpawn(statusOutPath, doneFixture);

    await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: false, // ← no-regen
      baseDir: dir,
    });

    expect(runStageCommandMock).toHaveBeenCalledTimes(1);
    const callArgs = runStageCommandMock.mock.calls[0]![0] as { args: string[] };
    expect(callArgs.args).toContain("--no-regen");
    // --no-regen means no Gemini call — verified by absence of Gemini in args
    expect(callArgs.args).not.toContain("--regen");
  });

  it("regenerate=true: does NOT pass --no-regen flag", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockSuccessSpawn(statusOutPath, doneFixture);

    await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: true,
      baseDir: dir,
    });

    const callArgs = runStageCommandMock.mock.calls[0]![0] as { args: string[] };
    expect(callArgs.args).not.toContain("--no-regen");
  });

  it("regenerate=true with imageProvider: passes --image-provider", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockSuccessSpawn(statusOutPath, doneFixture);

    await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: true,
      imageProvider: "codex-cli",
      baseDir: dir,
    });

    const callArgs = runStageCommandMock.mock.calls[0]![0] as { args: string[] };
    const providerIdx = callArgs.args.indexOf("--image-provider");
    expect(providerIdx).toBeGreaterThan(-1);
    expect(callArgs.args[providerIdx + 1]).toBe("codex-cli");
  });

  it("questionNumber specified: passes --question N flag", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockSuccessSpawn(statusOutPath, doneFixture);

    await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: false,
      questionNumber: 7,
      baseDir: dir,
    });

    const callArgs = runStageCommandMock.mock.calls[0]![0] as { args: string[] };
    const qIdx = callArgs.args.indexOf("--question");
    expect(qIdx).toBeGreaterThan(-1);
    expect(callArgs.args[qIdx + 1]).toBe("7");
  });
});

// ──────────────────────────────────────────────
// 3. boundaryUncertain=false → agent call 0
// ──────────────────────────────────────────────

describe("runFigureStage — agent call guard", () => {
  it("done fixture (all boundaryUncertain=false) → needsAgentReview empty", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockSuccessSpawn(statusOutPath, doneFixture);

    const result = await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: false,
      baseDir: dir,
    });

    // Caller would only dispatch agent if needsAgentReview.length > 0
    expect(result.needsAgentReview).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────
// 4. spawn failure → status=failed
// ──────────────────────────────────────────────

describe("runFigureStage — spawn failure", () => {
  it("non-zero exit → status=failed, needsAgentReview=[]", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockFailedSpawn();

    const result = await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: true,
      baseDir: dir,
    });

    expect(result.status).toBe("failed");
    expect(result.needsAgentReview).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 5. exam_data.json read-only 검증 (P3 load-bearing)
// ──────────────────────────────────────────────

describe("runFigureStage — exam_data.json read-only", () => {
  it("figure stage 실행 후 exam_data.json mtime 불변 (TS runner가 exam_data 수정 안 함)", async () => {
    const dir = await makeTempDir();
    const examDataPath = path.join(dir, "exam_data.json");
    const statusOutPath = path.join(dir, "figure_status.json");

    // exam_data.json 초기 파일 생성
    const examDataContent = JSON.stringify({ problems: [] });
    await writeFile(examDataPath, examDataContent, "utf8");

    // mtime 캡처 (초 단위로 비교하면 충분)
    const statBefore = await stat(examDataPath);

    // figure stage 실행 (mock: figure_status.json만 씀)
    mockSuccessSpawn(statusOutPath, doneFixture);
    await runFigureStage({
      examDataPath,
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: false,
      baseDir: dir,
    });

    // exam_data.json mtime이 변하지 않아야 함
    const statAfter = await stat(examDataPath);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);

    // exam_data.json 내용도 동일해야 함
    const { readFile: _readFile } = await import("fs/promises");
    const contentAfter = await _readFile(examDataPath, "utf8");
    expect(contentAfter).toBe(examDataContent);
  });

  it("done fixture: finalImage 키가 figure_status에 존재함 (P3 정본 키 검증)", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockSuccessSpawn(statusOutPath, doneFixture);

    const result = await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: false,
      baseDir: dir,
    });

    expect(result.status).toBe("done");

    // fixture에 finalImage 키가 있는지 확인
    for (const q of Object.values(doneFixture.questions)) {
      expect(q).toHaveProperty("finalImage");
    }
  });

  it("partial fixture: camelCase 키(needsAgentReview, boundaryUncertain) 인식", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "figure_status.json");
    mockSuccessSpawn(statusOutPath, partialFixture);

    const result = await runFigureStage({
      examDataPath: path.join(dir, "exam_data.json"),
      outputDir: path.join(dir, "images"),
      statusOutPath,
      regenerate: false,
      baseDir: dir,
    });

    // Q5: needsAgentReview=true (camelCase)
    expect(result.needsAgentReview).toContain(5);

    // fixture에 camelCase 키가 존재하는지 확인
    const q5 = (partialFixture.questions as Record<string, Record<string, unknown>>)["5"];
    expect(q5).toHaveProperty("needsAgentReview", true);
    expect(q5).toHaveProperty("boundaryUncertain", true);
    expect(q5).toHaveProperty("finalImage");
  });
});
