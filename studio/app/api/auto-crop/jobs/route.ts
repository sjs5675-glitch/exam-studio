import { NextRequest, NextResponse } from "next/server";
import { normalizePdfRotation } from "@/lib/cropper/coords";
import { isImageProviderId } from "@/lib/ai/settings";
import { startAutoCropJob } from "@/lib/server/autoCropJobs";
import type { AutoCropMode } from "@/lib/cropper/types";

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
      return NextResponse.json({ error: "pdfPath is required" }, { status: 400 });
    }

    const rotationValue = Number(rawRotation);
    if (!Number.isFinite(rotationValue)) {
      return NextResponse.json({ error: "rotation must be a number" }, { status: 400 });
    }
    if (typeof flip !== "boolean") {
      return NextResponse.json({ error: "flip must be a boolean" }, { status: 400 });
    }
    if (!isImageProviderId(rawProvider)) {
      return NextResponse.json({ error: "provider must be gemini or codex-cli" }, { status: 400 });
    }
    const totalPages = rawTotalPages === undefined ? undefined : Number(rawTotalPages);
    if (totalPages !== undefined && (!Number.isFinite(totalPages) || totalPages <= 0)) {
      return NextResponse.json({ error: "totalPages must be a positive number" }, { status: 400 });
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

    const job = startAutoCropJob({
      pdfPath,
      rotation: normalizePdfRotation(rotationValue),
      flip,
      provider: rawProvider,
      mode: normalizeAutoCropMode(rawMode),
      totalPages: totalPages === undefined ? undefined : Math.trunc(totalPages),
      includedPages,
    });

    return NextResponse.json({ jobId: job.id, job });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "auto-crop job start failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
