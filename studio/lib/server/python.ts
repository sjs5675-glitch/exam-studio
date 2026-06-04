import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

export interface ResolvePythonCommandOptions {
  cwd?: string;
  baseDir?: string;
}

const ENV_KEYS = ["EXAM_STUDIO_PYTHON", "PYTHON_BIN", "PYTHON_PATH"] as const;
const REQUIRED_MODULES = ["fitz", "PIL"] as const;
const pythonUsabilityCache = new Map<string, boolean>();

export function resolvePythonCommand(options: ResolvePythonCommandOptions = {}): string {
  const explicit = firstNonEmpty(ENV_KEYS.map((key) => process.env[key]));
  if (explicit) {
    if (canUsePythonCommand(explicit)) return explicit;
  }

  for (const candidate of collectPythonCandidates(options)) {
    if (canUsePythonCommand(candidate)) return candidate;
  }

  return process.platform === "win32" ? "python" : "python3";
}

export function shouldResolveAsPython(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return normalized === "python" || normalized === "python3" || normalized === "py";
}

function collectPythonCandidates(options: ResolvePythonCommandOptions): string[] {
  const dirs = collectSearchDirs(options);
  const candidates: string[] = [];

  for (const dir of dirs) {
    candidates.push(...venvPythonCandidates(dir));
  }

  candidates.push(...systemPythonCandidates());
  candidates.push(codexBundledPython());
  return unique(candidates.filter(Boolean));
}

function collectSearchDirs(options: ResolvePythonCommandOptions): string[] {
  const seeds = [options.baseDir, options.cwd, process.cwd()].filter(isNonEmpty);
  const dirs: string[] = [];

  for (const seed of seeds) {
    let current = path.resolve(seed);
    while (true) {
      dirs.push(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return unique(dirs);
}

function venvPythonCandidates(dir: string): string[] {
  if (process.platform === "win32") {
    return [
      path.join(dir, ".venv", "Scripts", "python.exe"),
      path.join(dir, "venv", "Scripts", "python.exe"),
    ];
  }

  return [
    path.join(dir, ".venv", "bin", "python3"),
    path.join(dir, ".venv", "bin", "python"),
    path.join(dir, "venv", "bin", "python3"),
    path.join(dir, "venv", "bin", "python"),
  ];
}

function systemPythonCandidates(): string[] {
  if (process.platform === "win32") return ["python", "py"];
  return ["python3", "python"];
}

function codexBundledPython(): string {
  return path.join(
    os.homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    process.platform === "win32" ? "python.exe" : "bin/python",
  );
}

function canUsePythonCommand(command: string): boolean {
  if (path.isAbsolute(command) && !fs.existsSync(command)) return false;

  const cached = pythonUsabilityCache.get(command);
  if (cached !== undefined) return cached;

  const script = [
    "import importlib.util, sys",
    `mods=${JSON.stringify(REQUIRED_MODULES)}`,
    "missing=[m for m in mods if importlib.util.find_spec(m) is None]",
    "sys.exit(1 if missing else 0)",
  ].join("; ");

  const result = spawnSync(command, ["-c", script], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
  });

  const usable = !result.error && result.status === 0;
  pythonUsabilityCache.set(command, usable);
  return usable;
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.find(isNonEmpty);
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
