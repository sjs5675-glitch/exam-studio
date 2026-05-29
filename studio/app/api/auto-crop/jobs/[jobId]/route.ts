import { NextResponse } from "next/server";
import { getAutoCropJob } from "@/lib/server/autoCropJobs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getAutoCropJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "auto-crop job not found" }, { status: 404 });
  }
  return NextResponse.json({ job });
}
