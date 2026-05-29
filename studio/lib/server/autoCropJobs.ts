import { spawn } from "child_process";
import path from "path";
import { randomUUID } from "crypto";
import { readRuntimeEnv } from "@/lib/server/runtimeEnv";
import { getDataRoot } from "@/lib/server/paths";
import type { ImageProviderId } from "@/lib/ai/settings";
import type { PdfFlip, PdfRotation } from "@/lib/cropper/types";

type AutoCropStatus = "running" | "completed" | "failed";
type AutoCropPhase = "queued" | "rendering" | "detecting" | "parsing" | "completed" | "failed";

export interface AutoCropJobSnapshot {
  id: string;
  status: AutoCropStatus;
  provider: ImageProviderId;
  phase: AutoCropPhase;
  message: string;
  progress: number;
  currentPage: number;
  totalPages: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  detail?: string;
  result?: unknown;
}

interface AutoCropJob extends AutoCropJobSnapshot {
  stdout: string[];
  stderr: string[];
}

interface StartAutoCropJobInput {
  pdfPath: string;
  rotation: PdfRotation;
  flip: PdfFlip;
  provider: ImageProviderId;
}

const BASE_DIR = getDataRoot();

const SCRIPT_BY_PROVIDER: Record<ImageProviderId, string> = {
  gemini: "gemini_crop.py",
  "codex-cli": "codex_crop.py",
};

const TIMEOUT_BY_PROVIDER: Record<ImageProviderId, number> = {
  gemini: 180000,
  "codex-cli": 1800000,
};

const globalForJobs = globalThis as typeof globalThis & {
  __examStudioAutoCropJobs?: Map<string, AutoCropJob>;
};

const jobs = globalForJobs.__examStudioAutoCropJobs ?? new Map<string, AutoCropJob>();
globalForJobs.__examStudioAutoCropJobs = jobs;

export function startAutoCropJob(input: StartAutoCropJobInput): AutoCropJobSnapshot {
  const now = new Date().toISOString();
  const job: AutoCropJob = {
    id: randomUUID(),
    status: "running",
    provider: input.provider,
    phase: "queued",
    message: "자동분할 준비 중",
    progress: 0,
    currentPage: 0,
    totalPages: 0,
    startedAt: now,
    updatedAt: now,
    stdout: [],
    stderr: [],
  };
  jobs.set(job.id, job);
  void runAutoCropJob(job, input);
  return snapshotJob(job);
}

export function getAutoCropJob(jobId: string): AutoCropJobSnapshot | null {
  const job = jobs.get(jobId);
  return job ? snapshotJob(job) : null;
}

function snapshotJob(job: AutoCropJob): AutoCropJobSnapshot {
  return {
    id: job.id,
    status: job.status,
    provider: job.provider,
    phase: job.phase,
    message: job.message,
    progress: job.progress,
    currentPage: job.currentPage,
    totalPages: job.totalPages,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    error: job.error,
    detail: job.detail,
    result: job.result,
  };
}

async function runAutoCropJob(job: AutoCropJob, input: StartAutoCropJobInput): Promise<void> {
  const fullPath = path.join(BASE_DIR, input.pdfPath);
  const scriptPath = path.join(BASE_DIR, "workspaces", "crop", SCRIPT_BY_PROVIDER[input.provider]);
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  const args = [scriptPath, fullPath, "--json-only", "--rotation", String(input.rotation)];
  if (input.flip) args.push("--flip");
  if (input.provider === "codex-cli") args.push("--page-timeout-sec", "120");

  updateJob(job, {
    phase: "rendering",
    message: "PDF 페이지 렌더링 준비 중",
    progress: 2,
  });

  const proc = spawn(pythonCmd, args, {
    cwd: BASE_DIR,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      ...readRuntimeEnv(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      // already gone
    }
  }, TIMEOUT_BY_PROVIDER[input.provider]);
  timer.unref?.();

  proc.stdout.on("data", (chunk: Buffer) => {
    job.stdout.push(chunk.toString("utf8"));
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    job.stderr.push(text);
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) updateProgressFromStderr(job, input.provider, line.trim());
    }
  });

  proc.on("error", (error) => {
    clearTimeout(timer);
    failJob(job, "자동분할 프로세스 실행 실패", error.message);
  });

  proc.on("close", (code) => {
    clearTimeout(timer);
    if (job.status === "failed") return;

    const stdout = job.stdout.join("").trim();
    const stderr = job.stderr.join("").trim();
    if (timedOut) {
      failJob(job, "자동분할 시간이 초과되었습니다.", stderr.slice(-1200));
      return;
    }
    if (code !== 0) {
      failJob(job, `${SCRIPT_BY_PROVIDER[input.provider]} execution failed`, stderr.slice(-1200));
      return;
    }

    try {
      const parsed = JSON.parse(stdout) as unknown;
      updateJob(job, {
        status: "completed",
        phase: "completed",
        message: "자동분할 완료",
        progress: 100,
        result: parsed,
        completedAt: new Date().toISOString(),
      });
    } catch {
      failJob(job, `${SCRIPT_BY_PROVIDER[input.provider]} output parse failed`, (stderr || stdout).slice(-1200));
    }
  });
}

function updateProgressFromStderr(job: AutoCropJob, provider: ImageProviderId, line: string): void {
  const renderMatch = /Rendering page\s+(\d+)\/(\d+)/i.exec(line);
  if (renderMatch) {
    const currentPage = Number(renderMatch[1]);
    const totalPages = Number(renderMatch[2]);
    updateJob(job, {
      phase: "rendering",
      currentPage,
      totalPages,
      progress: Math.min(35, Math.round((currentPage / Math.max(1, totalPages)) * 35)),
      message: `페이지 렌더링 중 ${currentPage}/${totalPages}`,
    });
    return;
  }

  const codexMatch = /Codex auto-crop page\s+(\d+)\/(\d+)/i.exec(line);
  if (codexMatch) {
    const currentPage = Number(codexMatch[1]);
    const totalPages = Number(codexMatch[2]);
    updateJob(job, {
      phase: "detecting",
      currentPage,
      totalPages,
      progress: Math.min(95, Math.max(5, Math.round((currentPage / Math.max(1, totalPages)) * 95))),
      message: `Codex 자동분할 중 ${currentPage}/${totalPages}`,
    });
    return;
  }

  const geminiMatch = /Gemini API 호출 중.*\((\d+)\s*페이지\)/i.exec(line);
  if (geminiMatch) {
    const totalPages = Number(geminiMatch[1]);
    updateJob(job, {
      phase: "detecting",
      currentPage: totalPages,
      totalPages,
      progress: 70,
      message: `Gemini API 분석 중 (${totalPages}페이지)`,
    });
    return;
  }

  const geminiPageMatch = /Gemini API pages?\s+(\d+)(?:-(\d+))?\/(\d+)/i.exec(line);
  if (geminiPageMatch) {
    const currentPage = Number(geminiPageMatch[2] ?? geminiPageMatch[1]);
    const totalPages = Number(geminiPageMatch[3]);
    updateJob(job, {
      phase: "detecting",
      currentPage,
      totalPages,
      progress: Math.min(95, Math.max(35, 35 + Math.round((currentPage / Math.max(1, totalPages)) * 60))),
      message: `Gemini API 분석 중 ${currentPage}/${totalPages}`,
    });
    return;
  }

  if (/Gemini 응답 파싱|JSON/i.test(line)) {
    updateJob(job, {
      phase: "parsing",
      progress: Math.max(job.progress, provider === "gemini" ? 88 : 96),
      message: "자동분할 결과 정리 중",
    });
  }
}

function updateJob(job: AutoCropJob, patch: Partial<AutoCropJob>): void {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

function failJob(job: AutoCropJob, error: string, detail?: string): void {
  updateJob(job, {
    status: "failed",
    phase: "failed",
    message: error,
    error,
    detail,
    completedAt: new Date().toISOString(),
  });
}
