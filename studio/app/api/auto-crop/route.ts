import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { readRuntimeEnv } from "@/lib/server/runtimeEnv";
import { normalizePdfRotation } from "@/lib/cropper/coords";
import { getDataRoot } from "@/lib/server/paths";
import { isImageProviderId, type ImageProviderId } from "@/lib/ai/settings";
import { resolveAutoCropTimeoutMs } from "@/lib/server/autoCropJobs";
import { resolvePythonCommand } from "@/lib/server/python";
import type { AutoCropMode } from "@/lib/cropper/types";

export const maxDuration = 21600;

const execFileAsync = promisify(execFile);
const BASE_DIR = getDataRoot();

const SCRIPT_BY_PROVIDER: Record<ImageProviderId, string> = {
  gemini: "gemini_crop.py",
  "codex-cli": "codex_crop.py",
};

function normalizeAutoCropMode(value: unknown): AutoCropMode {
  return value === "fast" ? "fast" : "accurate";
}

function normalizeIncludedPages(value: unknown, totalPages?: number): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("includedPages must be an array");
  const pages: number[] = [];
  const seen = new Set<number>();
  for (const raw of value) {
    const page = Number(raw);
    if (!Number.isInteger(page) || page < 0) throw new Error("includedPages must contain zero-based page indexes");
    if (totalPages !== undefined && page >= totalPages) throw new Error("includedPages contains a page outside the PDF");
    if (!seen.has(page)) {
      seen.add(page);
      pages.push(page);
    }
  }
  if (pages.length === 0) throw new Error("includedPages must include at least one page");
  return pages.sort((a, b) => a - b);
}

export async function POST(req: NextRequest) {
  let provider: ImageProviderId = "gemini";
  try {
    const body = await req.json();
    const {
      pdfPath,
      rotation: rawRotation = 0,
      flip = false,
      provider: rawProvider = "gemini",
      mode: rawMode = "accurate",
      totalPages: rawTotalPages,
      includedPages: rawIncludedPages,
    } = body;

    if (!pdfPath || typeof pdfPath !== "string") {
      return NextResponse.json(
        { error: "pdfPath is required" },
        { status: 400 },
      );
    }

    const rotationValue = Number(rawRotation);
    if (!Number.isFinite(rotationValue)) {
      return NextResponse.json(
        { error: "rotation must be a number" },
        { status: 400 },
      );
    }
    if (typeof flip !== "boolean") {
      return NextResponse.json(
        { error: "flip must be a boolean" },
        { status: 400 },
      );
    }
    if (!isImageProviderId(rawProvider)) {
      return NextResponse.json(
        { error: "provider must be gemini or codex-cli" },
        { status: 400 },
      );
    }
    provider = rawProvider;
    const totalPages = rawTotalPages === undefined ? undefined : Number(rawTotalPages);
    if (totalPages !== undefined && (!Number.isFinite(totalPages) || totalPages <= 0)) {
      return NextResponse.json(
        { error: "totalPages must be a positive number" },
        { status: 400 },
      );
    }
    let includedPages: number[] | undefined;
    try {
      includedPages = normalizeIncludedPages(
        rawIncludedPages,
        totalPages === undefined ? undefined : Math.trunc(totalPages),
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "includedPages is invalid" },
        { status: 400 },
      );
    }
    const rotation = normalizePdfRotation(rotationValue);
    const fullPath = path.join(BASE_DIR, pdfPath);
    const scriptPath = path.join(BASE_DIR, "workspaces", "crop", SCRIPT_BY_PROVIDER[provider]);

    const pythonCmd = resolvePythonCommand({ baseDir: BASE_DIR });

    const pythonArgs = [scriptPath, fullPath, "--json-only", "--rotation", String(rotation)];
    if (flip) pythonArgs.push("--flip");
    if (includedPages?.length) pythonArgs.push("--pages", includedPages.join(","));
    const mode = normalizeAutoCropMode(rawMode);
    if (provider === "gemini") {
      if (mode === "fast") {
        pythonArgs.push("--batch-size", "4", "--no-verify-pass");
      } else {
        pythonArgs.push("--batch-size", "1");
      }
    }
    if (provider === "codex-cli") pythonArgs.push("--page-timeout-sec", "120");

    const { stdout, stderr } = await execFileAsync(
      pythonCmd,
      pythonArgs,
      {
        timeout: resolveAutoCropTimeoutMs({
          provider,
          mode,
          totalPages: includedPages?.length ?? (totalPages === undefined ? undefined : Math.trunc(totalPages)),
        }),
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
          ...readRuntimeEnv(),
        },
      },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      const hint = stderr ? stderr.slice(0, 300) : stdout.slice(0, 300);
      return NextResponse.json(
        { error: `Failed to parse ${SCRIPT_BY_PROVIDER[provider]} output`, detail: hint },
        { status: 500 },
      );
    }

    return NextResponse.json(parsed);
  } catch (err: unknown) {
    const isExecError =
      err !== null &&
      typeof err === "object" &&
      "stderr" in err &&
      "code" in err;

    if (isExecError) {
      const execErr = err as { stderr?: string; code?: number | string; message?: string };
      const detail = execErr.stderr
        ? execErr.stderr.slice(0, 500)
        : (execErr.message ?? "Unknown error");
      return NextResponse.json(
        { error: `${SCRIPT_BY_PROVIDER[provider]} execution failed`, detail },
        { status: 500 },
      );
    }

    const message =
      err instanceof Error ? err.message : "auto-crop failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
