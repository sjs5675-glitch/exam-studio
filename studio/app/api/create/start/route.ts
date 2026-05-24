import { NextRequest, NextResponse } from "next/server";
import { mkdir, rm, rename, writeFile, stat } from "fs/promises";
import path from "path";
import type { ExamMetaInput } from "@/lib/exam/meta";

const BASE_DIR = path.resolve(process.cwd(), "..");
const EXAM_DIR = path.join(BASE_DIR, "inputs", "시험지 제작");
const CACHE_DIR = path.join(EXAM_DIR, ".v3cache");
const IMAGES_DIR = path.join(EXAM_DIR, "question_images");
const OUTPUTS_IMAGES_DIR = path.join(BASE_DIR, "outputs", "images");
export const LOCK_PATH = path.join(EXAM_DIR, ".create_start.lock");

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 신규 시험지 작업 시작 — 단일 트랜잭션:
 *   1. .v3cache.next_<txid> / question_images.next_<txid> 임시 디렉터리에 새 상태 완성
 *   2. 모든 파일 검증 완료 후 transaction lock을 잡고 final path를 짧은 rename window에서 교체
 *   3. session_meta.json은 새 .v3cache.next_<txid> 안에 작성
 *
 * write/validate 단계에서 실패하면 임시 디렉터리만 삭제하고 500 반환.
 * final path는 commit 전까지 변경하지 않는다. commit 중에는 reader API가 lock을 보고
 * 409/{ pending: true }를 반환하므로 partial 상태를 외부에 노출하지 않는다.
 *
 * multipart/form-data 입력:
 *   - meta: JSON string (ExamMetaInput)
 *   - q01, q02, ... (regular) / q_s01, q_s02, ... (essay): File
 */
export async function POST(req: NextRequest) {
  // ── stage 1: parse + validate ──
  let meta: ExamMetaInput;
  const images: { key: string; file: File }[] = [];
  try {
    const formData = await req.formData();
    const metaStr = formData.get("meta");
    if (typeof metaStr !== "string") {
      return NextResponse.json({ error: "meta(JSON) 필드 필요" }, { status: 400 });
    }
    meta = JSON.parse(metaStr) as ExamMetaInput;
    for (const [key, value] of formData.entries()) {
      if (key === "meta") continue;
      if (!(value instanceof File)) continue;
      images.push({ key, file: value });
    }
    if (images.length === 0) {
      return NextResponse.json({ error: "최소 1개 이상의 문제 이미지 필요" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: `request 파싱 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  // ── stage 2: write fresh state into temp dirs (final path untouched) ──
  const txid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const nextCacheDir = path.join(EXAM_DIR, `.v3cache.next_${txid}`);
  const nextImagesDir = path.join(EXAM_DIR, `question_images.next_${txid}`);
  const oldCacheDir = path.join(EXAM_DIR, `.v3cache.old_${txid}`);
  const oldImagesDir = path.join(EXAM_DIR, `question_images.old_${txid}`);
  const nextSessionMetaPath = path.join(nextCacheDir, "session_meta.json");
  const saved: { number: number; kind: "regular" | "essay"; path: string }[] = [];

  try {
    await mkdir(nextCacheDir, { recursive: true });
    await mkdir(nextImagesDir, { recursive: true });

    // images
    for (const { key, file } of images) {
      const essay = key.startsWith("q_s");
      const numPart = essay ? key.slice(3) : key.startsWith("q") ? key.slice(1) : null;
      if (numPart === null) continue;
      const num = parseInt(numPart, 10);
      if (isNaN(num)) continue;
      const padded = String(num).padStart(2, "0");
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const fileName = essay ? `q_s${padded}.${ext}` : `q${padded}.${ext}`;
      const filePath = path.join(nextImagesDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer);
      saved.push({
        number: num,
        kind: essay ? "essay" : "regular",
        path: `inputs/시험지 제작/question_images/${fileName}`,
      });
    }

    if (saved.length !== images.length) {
      throw new Error(`저장 가능한 이미지 수 불일치 (${saved.length}/${images.length})`);
    }

    // session_meta (next .v3cache 안)
    await writeFile(nextSessionMetaPath, JSON.stringify(meta, null, 2), "utf-8");
  } catch (err) {
    // final path는 아직 untouched. temp만 정리.
    try {
      await rm(nextCacheDir, { recursive: true, force: true });
      await rm(nextImagesDir, { recursive: true, force: true });
    } catch {
      /* temp cleanup best effort */
    }
    return NextResponse.json(
      { error: `작업 시작 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  // ── stage 3: commit (short locked rename window) ──
  // old .v3cache는 디버그 보존 없이 바로 삭제.
  // question_images old는 파생 입력이므로 성공 후 삭제.
  // outputs/images/는 derivable artifact이므로 commit 성공 후 best-effort로 클리어.
  let oldCacheMoved = false;
  let oldImagesMoved = false;
  let newCacheCommitted = false;
  let newImagesCommitted = false;
  try {
    await writeFile(LOCK_PATH, JSON.stringify({ txid, startedAt: new Date().toISOString() }), "utf-8");
    if (await exists(CACHE_DIR)) {
      await rename(CACHE_DIR, oldCacheDir);
      oldCacheMoved = true;
    }
    if (await exists(IMAGES_DIR)) {
      await rename(IMAGES_DIR, oldImagesDir);
      oldImagesMoved = true;
    }
    await rename(nextCacheDir, CACHE_DIR);
    newCacheCommitted = true;
    await rename(nextImagesDir, IMAGES_DIR);
    newImagesCommitted = true;

    // old cache 삭제 (백업 없음)
    if (await exists(oldCacheDir)) await rm(oldCacheDir, { recursive: true, force: true });
    if (await exists(oldImagesDir)) await rm(oldImagesDir, { recursive: true, force: true });

    // outputs/images/ 클리어 + 재생성 (derivable artifact 갱신). 실패해도 입력 commit은 유지한다.
    try {
      if (await exists(OUTPUTS_IMAGES_DIR)) {
        await rm(OUTPUTS_IMAGES_DIR, { recursive: true, force: true });
      }
      await mkdir(OUTPUTS_IMAGES_DIR, { recursive: true });
    } catch (cleanupErr) {
      console.warn(
        `[create/start] outputs/images cleanup failed: ${
          cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
        }`
      );
    }

    await rm(LOCK_PATH, { force: true }).catch(() => {});
  } catch (err) {
    // Commit 실패는 위험 상태일 수 있으므로 best-effort 복구 후 hard fail.
    try {
      if (newCacheCommitted) {
        await rm(CACHE_DIR, { recursive: true, force: true });
      }
      if (newImagesCommitted) {
        await rm(IMAGES_DIR, { recursive: true, force: true });
      }
      if (oldCacheMoved && (await exists(oldCacheDir)))
        await rename(oldCacheDir, CACHE_DIR);
      if (oldImagesMoved && (await exists(oldImagesDir)))
        await rename(oldImagesDir, IMAGES_DIR);
      await rm(nextCacheDir, { recursive: true, force: true });
      await rm(nextImagesDir, { recursive: true, force: true });
      await rm(LOCK_PATH, { force: true }).catch(() => {});
    } catch {
      /* recovery best effort */
    }
    return NextResponse.json(
      { error: `작업 시작 commit 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, images: saved });
}
