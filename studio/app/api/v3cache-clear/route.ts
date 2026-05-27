import { NextResponse } from "next/server";
import { rm, mkdir } from "fs/promises";
import path from "path";
import { getDataRoot } from "@/lib/server/paths";

const CACHE_DIR = path.join(getDataRoot(), "inputs", "시험지 제작", ".v3cache");

/**
 * POST /api/v3cache-clear — 진행 중인 시험지 캐시(.v3cache)를 비운다.
 *
 * 코드 업데이트로 추출/해설 형식이 바뀐 뒤 옛 캐시가 그대로 표시·resume 되는 것을
 * 막기 위한 수동 리셋. outputs/inputs 원본은 건드리지 않고 재생성 가능한 캐시만 삭제.
 * (사용자가 명시적으로 누르는 버튼 — 진행 중 작업물이 지워지므로 프론트에서 확인받는다.)
 */
export async function POST() {
  try {
    await rm(CACHE_DIR, { recursive: true, force: true });
    await mkdir(CACHE_DIR, { recursive: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 }
    );
  }
}
