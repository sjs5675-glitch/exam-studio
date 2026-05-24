/**
 * Host-side tool execution module for SDK providers.
 *
 * Provides Read / Grep / Glob tools that SDK providers (claude-sdk, openai-sdk)
 * can execute on behalf of the model when it issues tool_use blocks.
 *
 * All paths are sandboxed to a configurable allowedRoot.
 * Bash / Write / Edit are intentionally NOT implemented.
 */

import path from "path";
import { readFile, readdir, stat } from "fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HostToolInput {
  Read: { path: string };
  Grep: { pattern: string; path?: string };
  Glob: { pattern: string; path?: string };
}

export interface HostToolContext {
  /** Sandbox-allowed directory (absolute path). Default: docs/extractor-reference */
  allowedRoot: string;
  /** Repo root (used to resolve relative paths) */
  repoRoot: string;
}

export type HostToolName = keyof HostToolInput;

// ---------------------------------------------------------------------------
// Sandbox enforcement
// ---------------------------------------------------------------------------

/**
 * Returns true if `target` (after path.resolve) is inside `allowedRoot`.
 * Works on both Windows and macOS because it relies solely on path.resolve /
 * path.relative (no hardcoded separators).
 */
export function withinSandbox(target: string, allowedRoot: string): boolean {
  const abs = path.resolve(target);
  const root = path.resolve(allowedRoot);
  const rel = path.relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sandboxError(target: string, root: string): { ok: false; error: string } {
  return {
    ok: false,
    error:
      "sandbox: path '" +
      target +
      "' outside allowed root '" +
      path.resolve(root) +
      "'",
  };
}

const MAX_READ_BYTES = 100 * 1024; // 100 KB
const MAX_GREP_LINES = 50;
const MAX_GLOB_FILES = 100;

/** Regex special characters (excluding * and ?) that must be escaped */
const REGEX_SPECIAL_CHARS = new Set<string>(
  [".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]
);

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports:
 *   **\/  → match any path prefix, including empty (so root-level files match)
 *   **    → match anything
 *   *     → match within a single path segment
 *   ?     → match single non-separator character
 *
 * Paths are normalized to forward slashes before matching.
 */
function globToRegex(pattern: string): RegExp {
  let s = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    const ch1 = pattern[i + 1];
    const ch2 = pattern[i + 2];
    if (ch === "*" && ch1 === "*") {
      if (ch2 === "/") {
        // **/ matches any path prefix including none
        s += "(?:.+/)?";
        i += 3;
      } else {
        s += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      s += "[^/]*";
      i++;
    } else if (ch === "?") {
      s += "[^/]";
      i++;
    } else if (REGEX_SPECIAL_CHARS.has(ch)) {
      s += "\\" + ch;
      i++;
    } else {
      s += ch;
      i++;
    }
  }
  return new RegExp("^" + s + "$");
}

/**
 * Recursively list all files under `dir`, returning absolute paths.
 */
async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      const sub = await walkDir(full);
      results.push(...sub);
    } else {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function executeRead(
  input: HostToolInput["Read"],
  ctx: HostToolContext
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const abs = path.resolve(input.path);

  if (!withinSandbox(abs, ctx.allowedRoot)) {
    return sandboxError(abs, ctx.allowedRoot);
  }

  try {
    const buf = await readFile(abs);
    if (buf.byteLength > MAX_READ_BYTES) {
      return {
        ok: false,
        error:
          "Read: file exceeds 100 KB limit (" +
          buf.byteLength +
          " bytes): " +
          abs,
      };
    }
    return { ok: true, output: buf.toString("utf-8") };
  } catch (err) {
    return {
      ok: false,
      error: "Read: " + (err instanceof Error ? err.message : String(err)),
    };
  }
}

async function executeGrep(
  input: HostToolInput["Grep"],
  ctx: HostToolContext
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const searchRoot = input.path
    ? path.resolve(input.path)
    : path.resolve(ctx.allowedRoot);

  if (!withinSandbox(searchRoot, ctx.allowedRoot)) {
    return sandboxError(searchRoot, ctx.allowedRoot);
  }

  let regex: RegExp;
  try {
    regex = new RegExp(input.pattern);
  } catch (err) {
    return {
      ok: false,
      error:
        "Grep: invalid pattern '" +
        input.pattern +
        "': " +
        (err instanceof Error ? err.message : String(err)),
    };
  }

  const allFiles = await walkDir(searchRoot);
  const mdFiles = allFiles.filter(
    (f) => f.endsWith(".md") && withinSandbox(f, ctx.allowedRoot)
  );

  const resultLines: string[] = [];
  for (const filePath of mdFiles) {
    if (resultLines.length >= MAX_GREP_LINES) break;
    try {
      const lines = (await readFile(filePath, "utf-8")).split("\n");
      for (let li = 0; li < lines.length; li++) {
        if (resultLines.length >= MAX_GREP_LINES) break;
        if (regex.test(lines[li])) {
          resultLines.push(filePath + ":" + (li + 1) + ":" + lines[li]);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return {
    ok: true,
    output: resultLines.length > 0 ? resultLines.join("\n") : "(no matches)",
  };
}

async function executeGlob(
  input: HostToolInput["Glob"],
  ctx: HostToolContext
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const searchRoot = input.path
    ? path.resolve(input.path)
    : path.resolve(ctx.allowedRoot);

  if (!withinSandbox(searchRoot, ctx.allowedRoot)) {
    return sandboxError(searchRoot, ctx.allowedRoot);
  }

  const patternRegex = globToRegex(input.pattern);
  const allFiles = await walkDir(searchRoot);
  const results: string[] = [];

  for (const filePath of allFiles) {
    if (!withinSandbox(filePath, ctx.allowedRoot)) continue;
    // Normalize to forward slashes for cross-platform glob matching
    const rel = path.relative(searchRoot, filePath).split(path.sep).join("/");
    if (patternRegex.test(rel)) {
      results.push(filePath);
      if (results.length >= MAX_GLOB_FILES) break;
    }
  }

  return {
    ok: true,
    output: results.length > 0 ? results.join("\n") : "(no matches)",
  };
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function executeHostTool<N extends HostToolName>(
  name: N,
  input: HostToolInput[N],
  ctx: HostToolContext
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  switch (name) {
    case "Read":
      return executeRead(input as HostToolInput["Read"], ctx);
    case "Grep":
      return executeGrep(input as HostToolInput["Grep"], ctx);
    case "Glob":
      return executeGlob(input as HostToolInput["Glob"], ctx);
    default: {
      const exhaustive: never = name;
      return { ok: false, error: "Unknown tool: " + exhaustive };
    }
  }
}
