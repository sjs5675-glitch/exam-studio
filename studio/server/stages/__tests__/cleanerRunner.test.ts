/**
 * cleanerRunner.test.ts
 *
 * Tests for runCleanerStage:
 *  1. Spawn arg capture (--no-clean, --question N)
 *  2. status fixture round-trip (done/partial/failed)
 *  3. spawn failure → status=failed
 */

import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("../commands", () => ({
  runStageCommand: vi.fn(),
}));

import { runCleanerStage } from "../cleanerRunner";
import * as commandsModule from "../commands";

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
  const dir = await mkdtemp(path.join(os.tmpdir(), "cleanerrunner-test-"));
  tempDirs.push(dir);
  return dir;
}

const DONE_FIXTURE = {
  status: "done",
  questions: {
    "1": { status: "ok", image: "/tmp/cleaned/q01.png", cleaned: true },
    "2": { status: "ok", image: "/tmp/cleaned/q02.png", cleaned: true },
  },
};

const PARTIAL_FIXTURE = {
  status: "partial",
  questions: {
    "1": { status: "ok", image: "/tmp/cleaned/q01.png", cleaned: true },
    "2": { status: "failed", image: "/tmp/cleaned/q02.png", cleaned: false, error: "boom" },
  },
};

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
// 1. Fixture round-trip
// ──────────────────────────────────────────────

describe("runCleanerStage — fixture round-trip", () => {
  it("done fixture → status=done", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "cleaning_status.json");
    mockSuccessSpawn(statusOutPath, DONE_FIXTURE);

    const result = await runCleanerStage({
      questionImagesDir: path.join(dir, "question_images"),
      statusOutPath,
      clean: true,
      baseDir: dir,
    });

    expect(result.status).toBe("done");
    expect(result.statusJsonPath).toBe(statusOutPath);
  });

  it("partial fixture → status=partial", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "cleaning_status.json");
    mockSuccessSpawn(statusOutPath, PARTIAL_FIXTURE);

    const result = await runCleanerStage({
      questionImagesDir: path.join(dir, "question_images"),
      statusOutPath,
      clean: true,
      baseDir: dir,
    });

    expect(result.status).toBe("partial");
  });
});

// ──────────────────────────────────────────────
// 2. Spawn args
// ──────────────────────────────────────────────

describe("runCleanerStage — spawn args", () => {
  it("clean=false → passes --no-clean flag", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "cleaning_status.json");
    mockSuccessSpawn(statusOutPath, DONE_FIXTURE);

    await runCleanerStage({
      questionImagesDir: path.join(dir, "question_images"),
      statusOutPath,
      clean: false,
      baseDir: dir,
    });

    const callArgs = runStageCommandMock.mock.calls[0]![0] as { args: string[] };
    expect(callArgs.args).toContain("--no-clean");
  });

  it("clean=true → does NOT pass --no-clean", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "cleaning_status.json");
    mockSuccessSpawn(statusOutPath, DONE_FIXTURE);

    await runCleanerStage({
      questionImagesDir: path.join(dir, "question_images"),
      statusOutPath,
      clean: true,
      baseDir: dir,
    });

    const callArgs = runStageCommandMock.mock.calls[0]![0] as { args: string[] };
    expect(callArgs.args).not.toContain("--no-clean");
  });

  it("clean=true with imageProvider → passes --image-provider", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "cleaning_status.json");
    mockSuccessSpawn(statusOutPath, DONE_FIXTURE);

    await runCleanerStage({
      questionImagesDir: path.join(dir, "question_images"),
      statusOutPath,
      clean: true,
      imageProvider: "codex-cli",
      baseDir: dir,
    });

    const callArgs = runStageCommandMock.mock.calls[0]![0] as { args: string[] };
    const providerIdx = callArgs.args.indexOf("--image-provider");
    expect(providerIdx).toBeGreaterThan(-1);
    expect(callArgs.args[providerIdx + 1]).toBe("codex-cli");
  });

  it("questionNumber specified → passes --question N", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "cleaning_status.json");
    mockSuccessSpawn(statusOutPath, DONE_FIXTURE);

    await runCleanerStage({
      questionImagesDir: path.join(dir, "question_images"),
      statusOutPath,
      clean: true,
      questionNumber: 5,
      baseDir: dir,
    });

    const callArgs = runStageCommandMock.mock.calls[0]![0] as { args: string[] };
    const qIdx = callArgs.args.indexOf("--question");
    expect(qIdx).toBeGreaterThan(-1);
    expect(callArgs.args[qIdx + 1]).toBe("5");
  });

  it("passes --question-images-dir and --status-out", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "cleaning_status.json");
    const qDir = path.join(dir, "question_images");
    mockSuccessSpawn(statusOutPath, DONE_FIXTURE);

    await runCleanerStage({
      questionImagesDir: qDir,
      statusOutPath,
      clean: true,
      baseDir: dir,
    });

    const callArgs = runStageCommandMock.mock.calls[0]![0] as { args: string[] };
    const dirIdx = callArgs.args.indexOf("--question-images-dir");
    const statIdx = callArgs.args.indexOf("--status-out");
    expect(dirIdx).toBeGreaterThan(-1);
    expect(callArgs.args[dirIdx + 1]).toBe(qDir);
    expect(statIdx).toBeGreaterThan(-1);
    expect(callArgs.args[statIdx + 1]).toBe(statusOutPath);
  });
});

// ──────────────────────────────────────────────
// 3. Spawn failure
// ──────────────────────────────────────────────

describe("runCleanerStage — spawn failure", () => {
  it("non-zero exit → status=failed", async () => {
    const dir = await makeTempDir();
    const statusOutPath = path.join(dir, "cleaning_status.json");
    mockFailedSpawn();

    const result = await runCleanerStage({
      questionImagesDir: path.join(dir, "question_images"),
      statusOutPath,
      clean: true,
      baseDir: dir,
    });

    expect(result.status).toBe("failed");
  });
});
