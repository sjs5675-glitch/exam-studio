import { spawn, type ChildProcess } from "child_process";
import type { ClaudeEvent, ContentBlock } from "../../claude";
import type { AIProviderAdapter, ProviderRunOptions, ProviderRunResult } from "../types";

/**
 * Windows: npm 전역 설치 시 PATH에 놓이는 것은 codex.cmd shim이며,
 * shell:false(기본)일 때 Node spawn은 .cmd를 직접 실행하지 못해 ENOENT가 발생함.
 * → win32에서만 "codex.cmd"를 반환해 shell:false를 유지한다.
 * macOS/Linux는 현행 "codex" 그대로.
 */
export function getCodexBin(): string {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

const CODEX_PREAMBLE = [
  "You are running inside studio as an alternate AI provider.",
  "Reuse the existing .claude/skills and .claude/agents workflow files when they are relevant.",
  "Preserve the same stage meanings and output file conventions used by the Claude provider.",
  "When you create or update files, report paths clearly so the SSE layer can surface progress.",
].join("\n");

export function buildCodexPrompt(prompt: string): string {
  return `${CODEX_PREAMBLE}\n\n--- USER TASK ---\n${prompt}`;
}

export function buildCodexExecArgs(prompt: string, cwd: string, imagePaths?: string[]): string[] {
  const imageArgs: string[] = [];
  for (const imgPath of imagePaths ?? []) {
    imageArgs.push("--image", imgPath);
  }

  // `--image <FILE>...` is variadic; without a `--` terminator clap would greedily
  // consume the trailing prompt as another image path. Insert `--` whenever images
  // are present so the prompt is unambiguously the positional argument.
  const separator = imageArgs.length > 0 ? ["--"] : [];

  // Codex 0.130+ removed `--ask-for-approval`; non-interactive `exec` no longer
  // prompts for approvals (TTY-less). Sandbox alone suffices for our purposes.
  return [
    "exec",
    "--json",
    "--cd",
    cwd,
    "--sandbox",
    "danger-full-access",
    ...imageArgs,
    ...separator,
    buildCodexPrompt(prompt),
  ];
}

export function parseCodexJsonLine(line: string): ClaudeEvent[] {
  if (!line.trim()) return [];
  try {
    return codexJsonToClaudeEvents(JSON.parse(line));
  } catch {
    return [];
  }
}

function codexJsonToClaudeEvents(value: unknown): ClaudeEvent[] {
  if (!isRecord(value)) return [];

  if (isRecord(value.item)) {
    return codexJsonToClaudeEvents(value.item);
  }

  const type = stringValue(value.type);
  const text = extractText(value);
  if (text) {
    return [assistantEvent([{ type: "text", text }])];
  }

  if (type === "tool_call" || type === "function_call") {
    const name = stringValue(value.name) || "Tool";
    return [assistantEvent([{ type: "tool_use", name, input: objectValue(value.input) ?? objectValue(value.arguments) ?? {} }])];
  }

  if (type === "exec_command" || type === "command") {
    const command = stringValue(value.command);
    if (command) {
      return [assistantEvent([{ type: "tool_use", name: "Bash", input: { command } }])];
    }
  }

  if (type === "result" || type === "task_complete" || type === "turn_complete") {
    const success = value.success !== false && value.status !== "failed" && value.status !== "error";
    return [{
      type: "result",
      subtype: success ? "success" : "error",
      result: stringValue(value.message) || stringValue(value.result) || stringValue(value.error) || "",
    }];
  }

  if (type === "error") {
    return [{ type: "result", subtype: "error", result: stringValue(value.message) || stringValue(value.error) || "Codex error" }];
  }

  return [];
}

function assistantEvent(content: ContentBlock[]): ClaudeEvent {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content,
    },
  };
}

function extractText(value: Record<string, unknown>): string {
  const direct = stringValue(value.message) || stringValue(value.text) || stringValue(value.output);
  if (direct) return direct;

  const content = value.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item)) return stringValue(item.text) || stringValue(item.output_text);
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function* parseCodexStream(proc: ChildProcess, stderrChunks: string[]): AsyncIterable<ClaudeEvent> {
  let buffer = "";

  if (proc.stdout) {
    for await (const chunk of proc.stdout) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        yield* parseCodexJsonLine(line);
      }
    }
  }

  for (const event of parseCodexJsonLine(buffer)) {
    yield event;
  }

  const stderr = stderrChunks.join("").trim();
  if (stderr) {
    yield {
      type: "result",
      subtype: "error",
      result: `Codex CLI error: ${stderr.slice(0, 500)}`,
    };
  }
}

/** Per-process timeout for codex CLI. Kills the process if it produces no output
 *  for this many milliseconds. Env-tunable; default 180s. Set to 0 to disable. */
const CODEX_IDLE_TIMEOUT_MS = parseInt(process.env.CODEX_IDLE_TIMEOUT_MS ?? "180000", 10);

export const codexCliProvider: AIProviderAdapter = {
  id: "codex-cli",
  label: "Codex CLI",
  supportsTools: true,
  run(prompt: string, options?: ProviderRunOptions): ProviderRunResult {
    const cwd = options?.cwd ?? process.cwd();
    const args = buildCodexExecArgs(prompt, cwd, options?.imagePaths);
    const codexBin = getCodexBin();
    process.stderr.write(`[codex] spawn: ${codexBin} ${args.slice(0, args.length - 1).join(" ")} <PROMPT len=${prompt.length}>\n`);
    const proc = spawn(codexBin, args, {
      cwd,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderrChunks: string[] = [];
    // Real-time stderr passthrough: helps diagnose hangs (auth prompts, model loading).
    proc.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderrChunks.push(s);
      process.stderr.write(`[codex stderr pid=${proc.pid}] ${s}`);
    });

    // Idle-timeout: if no stdout/stderr activity for N ms, kill the process.
    let lastActivity = Date.now();
    proc.stdout?.on("data", () => { lastActivity = Date.now(); });
    proc.stderr?.on("data", () => { lastActivity = Date.now(); });
    let timedOut = false;
    const idleTimer = CODEX_IDLE_TIMEOUT_MS > 0
      ? setInterval(() => {
          if (Date.now() - lastActivity > CODEX_IDLE_TIMEOUT_MS) {
            timedOut = true;
            process.stderr.write(`[codex pid=${proc.pid}] idle timeout (${CODEX_IDLE_TIMEOUT_MS}ms) — killing\n`);
            try { proc.kill("SIGTERM"); } catch { /* already dead */ }
            setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* dead */ } }, 5000).unref();
          }
        }, 5000)
      : null;
    idleTimer?.unref();
    proc.on("close", () => { if (idleTimer) clearInterval(idleTimer); });

    // signal: abort 시 프로세스 종료
    options?.signal?.addEventListener("abort", () => {
      proc.kill("SIGTERM");
    });

    return {
      process: proc,
      events: parseCodexStream(proc, stderrChunks),
      exitCode: new Promise<number>((resolve) => {
        proc.on("close", (code) => {
          if (timedOut) {
            stderrChunks.push(`\n[codex] killed by idle timeout (${CODEX_IDLE_TIMEOUT_MS}ms)`);
          }
          resolve(code ?? 1);
        });
      }),
      metadata: {
        requestedProvider: "codex-cli",
        provider: "codex-cli",
        label: "Codex CLI",
      },
    };
  },
};
