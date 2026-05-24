import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const BASE_DIR = path.resolve(process.cwd(), "..");
const CACHE_DIR = path.join(BASE_DIR, "inputs", "시험지 제작", ".v3cache");

function jsonPath(qNum: number) {
  return path.join(CACHE_DIR, `q${qNum}_extracted.json`);
}

export async function GET(req: NextRequest) {
  try {
    const qNumStr = req.nextUrl.searchParams.get("q");
    if (!qNumStr) {
      return NextResponse.json({ error: "q param required" }, { status: 400 });
    }
    const qNum = parseInt(qNumStr, 10);
    if (isNaN(qNum)) {
      return NextResponse.json({ error: "Invalid q" }, { status: 400 });
    }

    const data = await readFile(jsonPath(qNum), "utf-8");
    return NextResponse.json(JSON.parse(data));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Read failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const qNumStr = req.nextUrl.searchParams.get("q");
    if (!qNumStr) {
      return NextResponse.json({ error: "q param required" }, { status: 400 });
    }
    const qNum = parseInt(qNumStr, 10);
    if (isNaN(qNum)) {
      return NextResponse.json({ error: "Invalid q" }, { status: 400 });
    }

    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(jsonPath(qNum), JSON.stringify(body, null, 2), "utf-8");

    return NextResponse.json({ number: qNum, saved: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
