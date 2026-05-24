/**
 * cleanerRunner.ts
 *
 * TS runner that spawns image_cleaner.py — nano-banana 기반 손글씨 제거 단계.
 * extractor 진입 직전에 호출되어 `question_images/q{N}.png` → `question_images/cleaned/q{N}.png`로
 * 정리본을 생성한다. figure ref crop도 정리본 위에서 자르게 되므로 figure 품질에도 기여.
 *
 * 토글 OFF (clean=false) → --no-clean으로 spawn (원본을 복사만).
 */

import path from "path";
import { readFile } from "fs/promises";
import type { ImageProviderId } from "@/lib/ai/settings";
import { runStageCommand } from "./commands";

// ──────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────

export interface CleanerRunnerInput {
  /** 원본 q{N}.png들이 위치한 폴더 (정리본은 그 아래 cleaned/) */
  questionImagesDir: string;
  /** cleaning_status.json 경로 */
  statusOutPath: string;
  /** false → --no-clean (Gemini 호출 없이 원본 복사) */
  clean: boolean;
  /** 이미지 정리 provider. clean=false면 사용하지 않음. */
  imageProvider?: ImageProviderId;
  /** 단일 문제만 처리하고 싶을 때 */
  questionNumber?: number;
  /** image_cleaner.py가 위치한 디렉터리 (기본 process.cwd()) */
  baseDir?: string;
  /** 향후 cancellation 용 — 현재는 사용 안 함 */
  signal?: AbortSignal;
  /** 자식 프로세스에 주입할 env (GEMINI_API_KEY 등) */
  env?: NodeJS.ProcessEnv;
}

export interface CleanerRunnerOutput {
  status: "done" | "partial" | "failed";
  /** cleaning_status.json 절대 경로 */
  statusJsonPath: string;
}

// ──────────────────────────────────────────────
// cleaning_status.json schema (emitted by image_cleaner.py)
// ──────────────────────────────────────────────

interface CleanerQuestionStatus {
  status: "ok" | "failed";
  image?: string;
  cleaned?: boolean;
  error?: string;
}

interface CleanerStatusJson {
  status: "done" | "partial" | "failed";
  questions: Record<string, CleanerQuestionStatus>;
}

// ──────────────────────────────────────────────
// Implementation
// ──────────────────────────────────────────────

export async function runCleanerStage(
  input: CleanerRunnerInput
): Promise<CleanerRunnerOutput> {
  const baseDir = input.baseDir ?? process.cwd();
  const python = process.platform === "win32" ? "python" : "python3";
  const scriptPath = path.join(baseDir, "image_cleaner.py");

  const args: string[] = [
    scriptPath,
    "--question-images-dir",
    input.questionImagesDir,
    "--status-out",
    input.statusOutPath,
  ];

  if (!input.clean) {
    args.push("--no-clean");
  }

  if (input.clean && input.imageProvider) {
    args.push("--image-provider", input.imageProvider);
  }

  if (input.questionNumber !== undefined) {
    args.push("--question", String(input.questionNumber));
  }

  const result = await runStageCommand({
    command: python,
    args,
    cwd: baseDir,
    timeoutMs: 600_000, // 10 minutes — N문제 × 4-8s 마진
    ...(input.env ? { env: input.env } : {}),
  });

  if (result.status !== "success") {
    return {
      status: "failed",
      statusJsonPath: input.statusOutPath,
    };
  }

  const parsed = await parseCleanerStatusJson(input.statusOutPath);
  return {
    status: parsed.status,
    statusJsonPath: input.statusOutPath,
  };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

async function parseCleanerStatusJson(
  statusPath: string
): Promise<CleanerStatusJson> {
  try {
    const text = await readFile(statusPath, "utf8");
    return JSON.parse(text) as CleanerStatusJson;
  } catch {
    return { status: "failed", questions: {} };
  }
}
