import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

const BASE_DIR = path.resolve(process.cwd(), "..");
const DATA_DIR = path.join(process.cwd(), "data/jobs");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const jobFile = path.join(DATA_DIR, `${jobId}.json`);

    if (!existsSync(jobFile)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const job = JSON.parse(await readFile(jobFile, "utf-8"));
    const outputPath = job.outputFile;

    if (!outputPath) {
      return NextResponse.json({ error: "No output file" }, { status: 404 });
    }

    // 절대경로와 상대경로 모두 처리
    const fullPath = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(BASE_DIR, outputPath);
    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: `File not found: ${fullPath}` }, { status: 404 });
    }

    const buffer = await readFile(fullPath);
    const fileName = path.basename(fullPath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
