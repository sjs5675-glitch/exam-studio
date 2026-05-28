import crossSpawn from "cross-spawn";
import type { StageError } from "./types";

export type StageCommandStatus = "success" | "non_zero_exit" | "timeout" | "spawn_error";

export interface StageCommandOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
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
    let aborted = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    // cross-spawn: Windows에서 python이 pyenv-win/MS Store 별칭 등 .bat/.cmd shim일 때도
    // 기본 spawn(shell:false)의 EINVAL 없이 안전하게 실행한다.
    const child = crossSpawn(options.command, args, {
      cwd: options.cwd,
      // Force Python UTF-8 mode so Korean stdout/paths don't garble on Windows (CP949 default).
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        ...(options.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const terminateChild = () => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") {
          crossSpawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        try { child.kill("SIGTERM"); } catch { /* already dead */ }
      }
    };

    const onAbort = () => {
      aborted = true;
      terminateChild();
    };

    const finish = (
      status: StageCommandStatus,
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      error?: Error
    ) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);

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
          terminateChild();
        }, options.timeoutMs)
      : undefined;

    if (options.signal?.aborted) {
      onAbort();
    } else {
      options.signal?.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => finish("spawn_error", null, null, error));
    child.on("close", (exitCode, signal) => {
      if (aborted) {
        finish("non_zero_exit", exitCode, signal);
        return;
      }
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
