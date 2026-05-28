import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { getDataRoot } from "@/lib/server/paths";

const BASE_DIR = getDataRoot();

export async function GET() {
  const statusPath = path.join(BASE_DIR, "inputs", "시험지 제작", ".v3cache", "figure_status.json");

  if (!existsSync(statusPath)) {
    return NextResponse.json({ pending: true, done: false, success: [], failed: [], images: [] });
  }

  try {
    const raw = await readFile(statusPath, "utf-8");
    const status = JSON.parse(raw);

    const imagesDir = path.join(BASE_DIR, "outputs", "images");
    let images: string[] = [];
    if (existsSync(imagesDir)) {
      const files = await readdir(imagesDir);
      images = files
        .filter((f) => /^prob\d+_final\.png$/.test(f))
        .sort()
        .map((f) => `outputs/images/${f}`);
    }

    const questions = status.questions && typeof status.questions === "object" ? status.questions as Record<string, { status?: string }> : {};
    const success = status.success ?? Object.entries(questions)
      .filter(([, q]) => q.status === "ok" || q.status === "boundary_uncertain")
      .map(([n]) => Number(n))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const failed = status.failed ?? Object.entries(questions)
      .filter(([, q]) => q.status === "failed")
      .map(([n]) => Number(n))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const done = status.completed === true || status.status === "done";

    return NextResponse.json({
      pending: false,
      done,
      status: status.status,
      success,
      failed,
      images,
    });
  } catch {
    return NextResponse.json({ pending: false, done: false, success: [], failed: [], images: [] });
  }
}
