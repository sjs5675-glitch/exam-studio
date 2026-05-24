import { access, mkdir, writeFile } from "fs/promises";
import path from "path";
import type { StageCache } from "./cache";
import { createStageCache } from "./cache";
import { runStageCommand, stageCommandToError, type StageCommandResult } from "./commands";
import type { StageError, StageResult, StageRunner } from "./types";

export interface BuilderStageInput {
  baseDir: string;
  examDataPath?: string;
  outputDir?: string;
  cache?: StageCache;
  pythonCommand?: string;
  timeoutMs?: number;
  commandRunner?: (options: {
    command: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
  }) => Promise<StageCommandResult>;
}

export interface BuilderCommandSummary {
  name: "build_hwpx" | "fix_namespaces" | "validate_hwpx";
  status: StageCommandResult["status"];
  exitCode: number | null;
  elapsedMs: number;
  stdout: string;
  stderr: string;
}

export interface BuilderStageOutput {
  hwpxPath: string;
  buildStatusPath: string;
  commands: BuilderCommandSummary[];
}

interface BuildStatusFile {
  status: "running" | "completed" | "failed";
  outputFile?: string;
  error?: string;
  commands: BuilderCommandSummary[];
  updatedAt: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export const builderStageRunner: StageRunner<BuilderStageInput, BuilderStageOutput> = {
  key: "builder",
  run: runBuilderStage,
};

export async function runBuilderStage(input: BuilderStageInput): Promise<StageResult<BuilderStageOutput>> {
  const startedAt = new Date().toISOString();
  const cache = input.cache ?? createStageCache(input.baseDir);
  const outputDir = input.outputDir ?? path.join(input.baseDir, "outputs");
  const examDataPath = input.examDataPath ?? cache.paths.examData;
  const python = input.pythonCommand ?? "python3";
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runCommand = input.commandRunner ?? runStageCommand;
  const commands: BuilderCommandSummary[] = [];

  await cache.ensureCacheDir();
  await mkdir(outputDir, { recursive: true });
  await writeBuildStatus(cache.paths.buildStatus, { status: "running", commands });

  try {
    const scripts = resolveBuilderScripts(input.baseDir);
    await assertFileExists(examDataPath, "exam_data.json");

    const build = await runCommand({
      command: python,
      args: [scripts.buildHwpx, examDataPath, outputDir],
      cwd: input.baseDir,
      timeoutMs,
    });
    commands.push(toSummary("build_hwpx", build));
    throwIfCommandFailed(build);

    const hwpxPath = extractHwpxPath(build.stdout) ?? await findExpectedHwpxPath(outputDir, build.stdout);
    await assertFileExists(hwpxPath, "builder output HWPX");

    const fix = await runCommand({
      command: python,
      args: [scripts.fixNamespaces, hwpxPath],
      cwd: input.baseDir,
      timeoutMs,
    });
    commands.push(toSummary("fix_namespaces", fix));
    throwIfCommandFailed(fix);

    const validate = await runCommand({
      command: python,
      args: [scripts.validateHwpx, hwpxPath, "--fix"],
      cwd: input.baseDir,
      timeoutMs,
    });
    commands.push(toSummary("validate_hwpx", validate));
    throwIfCommandFailed(validate);

    await writeBuildStatus(cache.paths.buildStatus, {
      status: "completed",
      outputFile: hwpxPath,
      commands,
    });

    return {
      status: "completed",
      output: {
        hwpxPath,
        buildStatusPath: cache.paths.buildStatus,
        commands,
      },
      files: [
        { path: hwpxPath, kind: "output", label: "HWPX output", mimeType: "application/zip" },
        { path: cache.paths.buildStatus, kind: "metadata", label: "Build status" },
      ],
      startedAt,
      completedAt: new Date().toISOString(),
      metadata: { deterministic: true },
    };
  } catch (error) {
    const stageError = normalizeBuilderError(error);
    await writeBuildStatus(cache.paths.buildStatus, {
      status: "failed",
      error: stageError.message,
      commands,
    });

    return {
      status: "failed",
      error: stageError,
      startedAt,
      completedAt: new Date().toISOString(),
      metadata: { deterministic: true },
    };
  }
}

export function resolveBuilderScripts(baseDir: string): {
  buildHwpx: string;
  fixNamespaces: string;
  validateHwpx: string;
} {
  return {
    buildHwpx: path.join(baseDir, "build_hwpx.py"),
    fixNamespaces: path.join(baseDir, "resources", "hwpx_scripts", "fix_namespaces.py"),
    validateHwpx: path.join(baseDir, "resources", "hwpx_scripts", "validate.py"),
  };
}

function extractHwpxPath(stdout: string): string | undefined {
  const match = stdout.match(/HWPX written:\s*(.+\.hwpx)\s*$/m);
  return match?.[1]?.trim();
}

async function findExpectedHwpxPath(outputDir: string, stdout: string): Promise<string> {
  const writingMatch = stdout.match(/Writing HWPX to\s+(.+\.hwpx)\.\.\./m);
  if (writingMatch?.[1]) return writingMatch[1].trim();
  throw new Error(`Unable to determine HWPX output path in ${outputDir}`);
}

async function assertFileExists(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath);
  } catch (error) {
    throw {
      code: "builder_file_missing",
      message: `Missing ${label}: ${filePath}`,
      cause: error,
      retryable: false,
      details: { filePath },
    } satisfies StageError;
  }
}

function throwIfCommandFailed(result: StageCommandResult): void {
  const error = stageCommandToError(result);
  if (error) throw error;
}

function toSummary(name: BuilderCommandSummary["name"], result: StageCommandResult): BuilderCommandSummary {
  return {
    name,
    status: result.status,
    exitCode: result.exitCode,
    elapsedMs: result.elapsedMs,
    stdout: result.stdout.slice(-2000),
    stderr: result.stderr.slice(-2000),
  };
}

async function writeBuildStatus(filePath: string, status: Omit<BuildStatusFile, "updatedAt">): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

function normalizeBuilderError(error: unknown): StageError {
  if (isStageError(error)) return error;
  if (error instanceof Error) {
    return {
      code: "builder_failed",
      message: error.message,
      cause: error,
      retryable: false,
    };
  }
  return {
    code: "builder_failed",
    message: String(error),
    retryable: false,
  };
}

function isStageError(error: unknown): error is StageError {
  return Boolean(error && typeof error === "object" && "code" in error && "message" in error);
}
