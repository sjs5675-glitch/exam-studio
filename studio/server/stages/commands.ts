import { spawn } from "child_process";
import type { StageError } from "./types";

export type StageCommandStatus = "success" | "non_zero_exit" | "timeout" | "spawn_error";

export interface StageCommandOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface StageCommandResult {
  command: string;
  args: string[];
  cwd?: string;
  status: StageCommandStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  error?: Error;
}

export async function runStageCommand(options: StageCommandOptions): Promise<StageCommandResult> {
  const startedAt = Date.now();
  const args = options.args ?? [];

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(options.command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (
      status: StageCommandStatus,
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      error?: Error
    ) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);

      resolve({
        command: options.command,
        args,
        cwd: options.cwd,
        status,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
        signal,
        elapsedMs: Date.now() - startedAt,
        error,
      });
    };

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => finish("spawn_error", null, null, error));
    child.on("close", (exitCode, signal) => {
      if (timedOut) {
        finish("timeout", exitCode, signal);
        return;
      }

      finish(exitCode === 0 ? "success" : "non_zero_exit", exitCode, signal);
    });
  });
}

export function stageCommandToError(result: StageCommandResult): StageError | undefined {
  if (result.status === "success") return undefined;

  const details = {
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    elapsedMs: result.elapsedMs,
    stderr: result.stderr.slice(0, 2000),
  };

  if (result.status === "timeout") {
    return {
      code: "stage_command_timeout",
      message: `Command timed out: ${formatCommand(result)}`,
      retryable: true,
      details,
    };
  }

  if (result.status === "spawn_error") {
    return {
      code: "stage_command_spawn_error",
      message: result.error?.message ?? `Failed to spawn command: ${formatCommand(result)}`,
      cause: result.error,
      retryable: false,
      details,
    };
  }

  return {
    code: "stage_command_failed",
    message: `Command exited with code ${result.exitCode}: ${formatCommand(result)}`,
    retryable: false,
    details,
  };
}

function formatCommand(result: Pick<StageCommandResult, "command" | "args">): string {
  return [result.command, ...result.args].join(" ");
}
