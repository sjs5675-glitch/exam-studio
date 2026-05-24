import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const BASE_DIR = path.resolve(process.cwd(), "..");
const CACHE_DIR = path.join(BASE_DIR, "inputs", "시험지 제작", ".v3cache");

function jsonPath(qNum: number, phase: string) {
  const padded = String(qNum).padStart(2, "0");
  return path.join(CACHE_DIR, `q${padded}_${phase}.json`);
}

export async function GET(req: NextRequest) {
  try {
    const qNumStr = req.nextUrl.searchParams.get("q");
    const phase = req.nextUrl.searchParams.get("phase") ?? "extracted";

    if (!qNumStr) {
      return NextResponse.json({ error: "q param required" }, { status: 400 });
    }
    const qNum = parseInt(qNumStr, 10);
    if (isNaN(qNum)) {
      return NextResponse.json({ error: "Invalid q" }, { status: 400 });
    }

    const data = await readFile(jsonPath(qNum, phase), "utf-8");
    return NextResponse.json(JSON.parse(data));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Read failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
