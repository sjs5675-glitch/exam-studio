import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { readRuntimeEnv } from "@/lib/server/runtimeEnv";
import { normalizePdfRotation } from "@/lib/cropper/coords";
import { getDataRoot } from "@/lib/server/paths";
import { isImageProviderId, type ImageProviderId } from "@/lib/ai/settings";

export const maxDuration = 1800;

const execFileAsync = promisify(execFile);
const BASE_DIR = getDataRoot();

const SCRIPT_BY_PROVIDER: Record<ImageProviderId, string> = {
  gemini: "gemini_crop.py",
  "codex-cli": "codex_crop.py",
};

const TIMEOUT_BY_PROVIDER: Record<ImageProviderId, number> = {
  gemini: 180000,
  "codex-cli": 1800000,
};

export async function POST(req: NextRequest) {
  let provider: ImageProviderId = "gemini";
  try {
    const body = await req.json();
    const {
      pdfPath,
      rotation: rawRotation = 0,
      flip = false,
      provider: rawProvider = "gemini",
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
    const rotation = normalizePdfRotation(rotationValue);
    const fullPath = path.join(BASE_DIR, pdfPath);
    const scriptPath = path.join(BASE_DIR, "workspaces", "crop", SCRIPT_BY_PROVIDER[provider]);

    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    const pythonArgs = [scriptPath, fullPath, "--json-only", "--rotation", String(rotation)];
    if (flip) pythonArgs.push("--flip");
    if (provider === "codex-cli") pythonArgs.push("--page-timeout-sec", "120");

    const { stdout, stderr } = await execFileAsync(
      pythonCmd,
      pythonArgs,
      {
        timeout: TIMEOUT_BY_PROVIDER[provider],
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
