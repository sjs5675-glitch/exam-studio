import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { writeFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import {
  executeHostTool,
  withinSandbox,
  type HostToolContext,
} from "../tools/index";
import { TOOL_SCHEMAS_ANTHROPIC, TOOL_SCHEMAS_OPENAI } from "../tools/schema";

// ---------------------------------------------------------------------------
// Helpers: set up a temporary sandbox directory with fixture files
// ---------------------------------------------------------------------------

let sandboxRoot: string;
let ctx: HostToolContext;

beforeAll(async () => {
  sandboxRoot = path.join(tmpdir(), `ngd-tools-test-${Date.now()}`);
  await mkdir(sandboxRoot, { recursive: true });

  // Create fixture files
  await writeFile(
    path.join(sandboxRoot, "hello.md"),
    "# Hello\nThis is a test file.\npattern_match_here"
  );
  await writeFile(
    path.join(sandboxRoot, "data.md"),
    "# Data\nanother line\npattern_match_here too"
  );

  // Create a sub-directory inside sandbox
  await mkdir(path.join(sandboxRoot, "subdir"), { recursive: true });
  await writeFile(
    path.join(sandboxRoot, "subdir", "nested.md"),
    "nested content"
  );

  ctx = {
    allowedRoot: sandboxRoot,
    repoRoot: sandboxRoot,
  };
});

// ---------------------------------------------------------------------------
// withinSandbox
// ---------------------------------------------------------------------------

describe("withinSandbox", () => {
  it("returns true for a path inside the sandbox root", () => {
    expect(withinSandbox(path.join(sandboxRoot, "hello.md"), sandboxRoot)).toBe(
      true
    );
  });

  it("returns true for the sandbox root itself", () => {
    expect(withinSandbox(sandboxRoot, sandboxRoot)).toBe(true);
  });

  it("returns false for a path outside the sandbox root", () => {
    expect(withinSandbox("/etc/passwd", sandboxRoot)).toBe(false);
  });

  it("returns false for a path traversal attack", () => {
    expect(
      withinSandbox(
        path.join(sandboxRoot, "..", "..", "etc", "passwd"),
        sandboxRoot
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Read tool
// ---------------------------------------------------------------------------

describe("executeHostTool: Read", () => {
  it("reads a file inside the sandbox", async () => {
    const result = await executeHostTool(
      "Read",
      { path: path.join(sandboxRoot, "hello.md") },
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("Hello");
    }
  });

  it("rejects a path outside the sandbox", async () => {
    const result = await executeHostTool(
      "Read",
      { path: "/etc/passwd" },
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/sandbox/);
    }
  });

  it("rejects files exceeding 100 KB", async () => {
    // Write a >100 KB file inside sandbox
    const bigPath = path.join(sandboxRoot, "big.md");
    await writeFile(bigPath, "x".repeat(101 * 1024));
    const result = await executeHostTool("Read", { path: bigPath }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/100 KB/);
    }
    await rm(bigPath);
  });

  it("returns an error for a non-existent file", async () => {
    const result = await executeHostTool(
      "Read",
      { path: path.join(sandboxRoot, "nonexistent.md") },
      ctx
    );
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Grep tool
// ---------------------------------------------------------------------------

describe("executeHostTool: Grep", () => {
  it("finds lines matching the pattern across sandbox .md files", async () => {
    const result = await executeHostTool(
      "Grep",
      { pattern: "pattern_match_here" },
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("pattern_match_here");
    }
  });

  it("returns '(no matches)' when nothing matches", async () => {
    const result = await executeHostTool(
      "Grep",
      { pattern: "ZZZZZ_no_match_ZZZZZ" },
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe("(no matches)");
    }
  });

  it("rejects a search root outside the sandbox", async () => {
    const result = await executeHostTool(
      "Grep",
      { pattern: ".*", path: "/etc" },
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/sandbox/);
    }
  });

  it("returns an error for an invalid regex", async () => {
    const result = await executeHostTool(
      "Grep",
      { pattern: "[invalid" },
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/invalid pattern/);
    }
  });
});

// ---------------------------------------------------------------------------
// Glob tool
// ---------------------------------------------------------------------------

describe("executeHostTool: Glob", () => {
  it("lists .md files matching a pattern inside the sandbox", async () => {
    const result = await executeHostTool(
      "Glob",
      { pattern: "**/*.md" },
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("hello.md");
      expect(result.output).toContain("data.md");
    }
  });

  it("returns '(no matches)' when the pattern matches nothing", async () => {
    const result = await executeHostTool(
      "Glob",
      { pattern: "**/*.xyz_nonexistent" },
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe("(no matches)");
    }
  });

  it("rejects a path root outside the sandbox", async () => {
    const result = await executeHostTool(
      "Glob",
      { pattern: "**/*.conf", path: "/etc" },
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/sandbox/);
    }
  });
});

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

describe("TOOL_SCHEMAS_ANTHROPIC", () => {
  it("exports schemas for Read, Grep, Glob", () => {
    const names = TOOL_SCHEMAS_ANTHROPIC.map((s) => s.name);
    expect(names).toContain("Read");
    expect(names).toContain("Grep");
    expect(names).toContain("Glob");
  });

  it("each schema has input_schema with type object", () => {
    for (const schema of TOOL_SCHEMAS_ANTHROPIC) {
      expect(schema.input_schema.type).toBe("object");
      expect(schema.input_schema.required).toBeInstanceOf(Array);
    }
  });
});

describe("TOOL_SCHEMAS_OPENAI", () => {
  it("exports schemas for Read, Grep, Glob as function type", () => {
    for (const schema of TOOL_SCHEMAS_OPENAI) {
      expect(schema.type).toBe("function");
      expect(schema.function.name).toBeDefined();
      expect(schema.function.parameters.type).toBe("object");
    }
  });

  it("OpenAI and Anthropic schemas cover same tools", () => {
    const anthropicNames = TOOL_SCHEMAS_ANTHROPIC.map((s) => s.name).sort();
    const openaiNames = TOOL_SCHEMAS_OPENAI.map((s) => s.function.name).sort();
    expect(anthropicNames).toEqual(openaiNames);
  });
});
