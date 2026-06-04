import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import type { ExamMetaInput } from "@/lib/exam/meta";
import type { AISettings } from "@/lib/ai/settings";
import { DEFAULT_AI_SETTINGS, normalizeStageOverrides, normalizeStageSkip } from "@/lib/ai/settings";
import { getJobsDir } from "@/lib/server/paths";

type ReviewMeta = ExamMetaInput & { questionCount?: number; resumeFrom?: string };

type ReviewSessionBody = {
  meta?: ReviewMeta;
  settings?: Partial<AISettings>;
};

function withDefaultSettings(settings: Partial<AISettings> | undefined): AISettings {
  const raw = settings ?? {};
  const imageProvider = raw.imageProvider ?? DEFAULT_AI_SETTINGS.imageProvider;
  return {
    defaultProvider: raw.defaultProvider ?? DEFAULT_AI_SETTINGS.defaultProvider,
    stageOverrides: normalizeStageOverrides(raw.stageOverrides),
    imageProvider,
    imageCleaningProvider: raw.imageCleaningProvider ?? imageProvider,
    figureRegen: raw.figureRegen !== false,
    imageCleaningEnabled: raw.imageCleaningEnabled !== false,
    checkerMaxAttempts: typeof raw.checkerMaxAttempts === "number"
      ? raw.checkerMaxAttempts
      : DEFAULT_AI_SETTINGS.checkerMaxAttempts,
    verifierMaxAttempts: typeof raw.verifierMaxAttempts === "number"
      ? raw.verifierMaxAttempts
      : DEFAULT_AI_SETTINGS.verifierMaxAttempts,
    stageSkip: normalizeStageSkip(raw.stageSkip),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ReviewSessionBody;
    const meta: ReviewMeta = {
      ...(body.meta ?? {}),
      resumeFrom: "confirm",
    };
    const settings = withDefaultSettings(body.settings);
    const jobId = randomUUID();
    const now = new Date().toISOString();

    const jobData = {
      id: jobId,
      mode: "resume",
      requestedProvider: settings.defaultProvider,
      provider: settings.defaultProvider,
      stageOverrides: settings.stageOverrides,
      stageSkip: settings.stageSkip,
      imageProvider: settings.imageProvider,
      imageCleaningProvider: settings.imageCleaningProvider,
      figureRegen: settings.figureRegen,
      figureMode: meta.figureMode,
      imageCleaningEnabled: settings.imageCleaningEnabled,
      checkerMaxAttempts: settings.checkerMaxAttempts,
      verifierMaxAttempts: settings.verifierMaxAttempts,
      status: "done",
      inputFiles: [],
      meta,
      stages: [],
      logs: [
        {
          timestamp: now,
          stage: "system",
          message: "Cached review session created. No pipeline stage was executed.",
          level: "info",
        },
      ],
      followups: [],
      startedAt: now,
      finishedAt: now,
      resultSummary: "cache-review",
    };

    const jobsDir = getJobsDir();
    await mkdir(jobsDir, { recursive: true });
    await writeFile(path.join(jobsDir, `${jobId}.json`), JSON.stringify(jobData, null, 2), "utf-8");

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Review session failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
