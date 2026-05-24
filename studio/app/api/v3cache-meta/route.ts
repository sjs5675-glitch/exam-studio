import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import type { ExamMetaInput } from "@/lib/exam/meta";

const BASE_DIR = path.resolve(process.cwd(), "..");
const EXAM_DIR = path.join(BASE_DIR, "inputs", "시험지 제작");
const CACHE_DIR = path.join(EXAM_DIR, ".v3cache");
const SESSION_META_PATH = path.join(CACHE_DIR, "session_meta.json");
// Lock written by /api/create/start during atomic commit window
const LOCK_PATH = path.join(EXAM_DIR, ".create_start.lock");
const LOCK_STALE_MS = 30_000;

interface MetaResult {
  found: boolean;
  meta?: ExamMetaInput;
  pending?: boolean;
}

async function isLocked(): Promise<boolean> {
  try {
    const s = await stat(LOCK_PATH);
    const ageMs = Date.now() - s.mtimeMs;
    if (ageMs > LOCK_STALE_MS) {
      // Stale lock from a crashed server — log and ignore
      console.warn(`[v3cache-meta] stale lock detected (age=${ageMs}ms), ignoring`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function GET(): Promise<NextResponse<MetaResult>> {
  if (await isLocked()) {
    return NextResponse.json({ found: false, pending: true }, { status: 409 });
  }
  try {
    const raw = await readFile(SESSION_META_PATH, "utf-8");
    const meta = JSON.parse(raw) as ExamMetaInput;
    return NextResponse.json({ found: true, meta });
  } catch {
    return NextResponse.json({ found: false });
  }
}

// POST handler removed — /api/create/start is now responsible for writing session_meta.json
// as part of the atomic reset+image+meta transaction.
