import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

const BASE_DIR = path.resolve(process.cwd(), "..");

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

    return NextResponse.json({
      pending: false,
      done: status.completed === true,
      success: status.success ?? [],
      failed: status.failed ?? [],
      images,
    });
  } catch {
    return NextResponse.json({ pending: false, done: false, success: [], failed: [], images: [] });
  }
}
