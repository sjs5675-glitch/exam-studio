import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { getDataRoot } from "@/lib/server/paths";

const BASE_DIR = getDataRoot();

export async function GET() {
  const statusPath = path.join(BASE_DIR, "inputs", "시험지 제작", ".v3cache", "build_status.json");

  if (!existsSync(statusPath)) {
    const figureStatusPath = path.join(BASE_DIR, "inputs", "시험지 제작", ".v3cache", "figure_status.json");
    if (existsSync(figureStatusPath)) {
      try {
        const raw = await readFile(figureStatusPath, "utf-8");
        const figureStatus = JSON.parse(raw) as {
          status?: string;
          failed?: number[];
          questions?: Record<string, { status?: string; error?: string }>;
        };
        const failed = figureStatus.failed ?? Object.entries(figureStatus.questions ?? {})
          .filter(([, q]) => q.status === "failed")
          .map(([n]) => Number(n))
          .filter((n) => Number.isFinite(n));
        if (figureStatus.status === "failed" || failed.length > 0) {
          const sample = Object.entries(figureStatus.questions ?? {})
            .find(([, q]) => q.status === "failed")?.[1]?.error;
          return NextResponse.json({
            pending: false,
            status: "failed",
            error: sample
              ? `figure 단계 실패: ${sample}`
              : `figure 단계 실패: ${failed.join(", ")}번 그림을 확인하세요.`,
          });
        }
      } catch {
        // Fall through to the normal pending response.
      }
    }
    return NextResponse.json({ pending: true });
  }

  try {
    const raw = await readFile(statusPath, "utf-8");
    const status = JSON.parse(raw);
    return NextResponse.json({ pending: false, ...status });
  } catch {
    return NextResponse.json({ pending: false, status: "unknown" });
  }
}
