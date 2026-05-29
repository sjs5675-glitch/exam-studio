import { NextRequest, NextResponse } from "next/server";
import { normalizePdfRotation } from "@/lib/cropper/coords";
import { isImageProviderId } from "@/lib/ai/settings";
import { startAutoCropJob } from "@/lib/server/autoCropJobs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      pdfPath,
      rotation: rawRotation = 0,
      flip = false,
      provider: rawProvider = "gemini",
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

    const job = startAutoCropJob({
      pdfPath,
      rotation: normalizePdfRotation(rotationValue),
      flip,
      provider: rawProvider,
    });

    return NextResponse.json({ jobId: job.id, job });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "auto-crop job start failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
