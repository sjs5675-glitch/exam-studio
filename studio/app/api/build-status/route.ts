import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { getDataRoot } from "@/lib/server/paths";

const BASE_DIR = getDataRoot();

export async function GET() {
  const statusPath = path.join(BASE_DIR, "inputs", "시험지 제작", ".v3cache", "build_status.json");

  if (!existsSync(statusPath)) {
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
