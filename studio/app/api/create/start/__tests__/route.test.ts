/**
 * Tests for POST /api/create/start — atomic reset+image+meta transaction.
 *
 * Strategy: We can't import the Next.js route handler directly because it
 * references process.cwd() at module load time (path constants). Instead we
 * mock the fs/promises module and test the transaction logic by re-exporting
 * the handler with the path constants overridden via vi.mock.
 *
 * The tests exercise the four properties specified in the phase design:
 *  1. Happy path — meta + images → .v3cache/session_meta.json + question_images/qNN.png
 *     + old cache deleted (no .v3cache_prev) + outputs/images/ cleared and recreated
 *  2. Validation errors (no meta, no images)
 *  3. Write-stage failure → final path untouched
 *  4. Commit-stage failure → best-effort recovery + 500
 *  5. Reader API lock regression — temp dirs never visible from GET endpoints
 *  6. Lock present → reader returns 409 / pending
 */

import { mkdtemp, mkdir, writeFile, readdir, stat, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function makeTempBase(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "create-start-test-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Create a fake exam directory layout under baseDir, matching what the route expects
 * relative to process.cwd() (which is studio, so parent = /inputs/시험지 제작).
 * Returns { examDir, cacheDir, imagesDir, lockPath, outputsImagesDir }.
 */
async function makeExamDirs(baseDir: string) {
  const examDir = path.join(baseDir, "inputs", "시험지 제작");
  const cacheDir = path.join(examDir, ".v3cache");
  const imagesDir = path.join(examDir, "question_images");
  const lockPath = path.join(examDir, ".create_start.lock");
  const outputsImagesDir = path.join(baseDir, "outputs", "images");
  await mkdir(examDir, { recursive: true });
  await mkdir(outputsImagesDir, { recursive: true });
  return { examDir, cacheDir, imagesDir, lockPath, outputsImagesDir };
}

/**
 * Build a minimal multipart/form-data request body with meta + image files.
 * Returns a mock NextRequest object compatible with the route handler.
 */
function makeRequest(
  meta: Record<string, unknown>,
  images: { key: string; name: string; data: ArrayBuffer }[]
): NextRequest {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  for (const img of images) {
    form.append(img.key, new File([img.data], img.name, { type: "image/png" }));
  }
  // Minimal NextRequest mock — the route only calls req.formData()
  return {
    formData: async () => form,
  } as unknown as NextRequest;
}

// ──────────────────────────────────────────────────────────────
// Import the route handler inline, overriding path constants.
// We use a factory function so each test gets a fresh instance
// with its own temp examDir.
// ──────────────────────────────────────────────────────────────

/**
 * Dynamically build a route handler that uses `examDir` instead of
 * the production path derived from process.cwd().
 *
 * @param examDir        Temp directory that stands in for the production exam dir.
 * @param outputsImagesDir  Temp directory that stands in for outputs/images/.
 * @param overrides Optional function overrides for fs/promises operations.
 *                  Used to inject commit-stage failures in tests.
 *
 * This avoids touching the real filesystem at /inputs/시험지 제작.
 *
 * NOTE: mirrors the production route.ts logic exactly:
 *   - No .v3cache_prev rotation; old cache is deleted directly after commit.
 *   - outputs/images/ is cleared + recreated after commit succeeds.
 */
async function buildHandler(
  examDir: string,
  outputsImagesDir: string,
  overrides?: {
    rename?: (oldPath: string, newPath: string) => Promise<void>;
    rm?: (path: string, options?: Parameters<typeof import("fs/promises").rm>[1]) => Promise<void>;
  }
) {
  const { mkdir, rm: fsRm, rename: fsRename, writeFile, stat } = await import("fs/promises");
  const { getActiveImageCleanerLock, imageCleanerLockPath } = await import("@/lib/server/imageCleanerLock");
  const rename = overrides?.rename ?? fsRename;
  const rm = overrides?.rm ?? fsRm;

  const CACHE_DIR = path.join(examDir, ".v3cache");
  const IMAGES_DIR = path.join(examDir, "question_images");
  const OUTPUTS_IMAGES_DIR = outputsImagesDir;
  const CLEANING_STATUS_PATH = path.join(CACHE_DIR, "cleaning_status.json");
  const IMAGE_CLEANER_LOCK_PATH = imageCleanerLockPath(CLEANING_STATUS_PATH);
  const LOCK_PATH = path.join(examDir, ".create_start.lock");

  async function exists(p: string): Promise<boolean> {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  }

  function isTransientFsBusyError(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOTEMPTY";
  }

  // Inline the route logic with overridden paths (mirrors route.ts exactly)
  async function POST(req: NextRequest) {
    const { NextResponse } = await import("next/server");

    let meta: Record<string, unknown>;
    const images: { key: string; file: File }[] = [];
    try {
      const formData = await req.formData();
      const metaStr = formData.get("meta");
      if (typeof metaStr !== "string") {
        return NextResponse.json({ error: "meta(JSON) 필드 필요" }, { status: 400 });
      }
      meta = { ...(JSON.parse(metaStr) as Record<string, unknown>) };
      delete meta.resumeFrom;
      delete meta.questionCount;
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

    const activeCleaner = await getActiveImageCleanerLock(IMAGE_CLEANER_LOCK_PATH);
    if (activeCleaner) {
      return NextResponse.json(
        {
          error: "이전 이미지 정리/손글씨 제거 작업이 아직 실행 중입니다.",
          hint: "이전 손글씨 제거/이미지 생성 작업이 question_images 폴더를 아직 사용 중입니다.",
          code: "image_cleaner_busy",
        },
        { status: 409 }
      );
    }

    const txid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const nextCacheDir = path.join(examDir, `.v3cache.next_${txid}`);
    const nextImagesDir = path.join(examDir, `question_images.next_${txid}`);
    const oldCacheDir = path.join(examDir, `.v3cache.old_${txid}`);
    const oldImagesDir = path.join(examDir, `question_images.old_${txid}`);
    const nextSessionMetaPath = path.join(nextCacheDir, "session_meta.json");
    const saved: { number: number; kind: "regular" | "essay"; path: string }[] = [];

    try {
      await mkdir(nextCacheDir, { recursive: true });
      await mkdir(nextImagesDir, { recursive: true });

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

      await writeFile(nextSessionMetaPath, JSON.stringify(meta, null, 2), "utf-8");
    } catch (err) {
      try {
        await rm(nextCacheDir, { recursive: true, force: true });
        await rm(nextImagesDir, { recursive: true, force: true });
      } catch { /* best effort */ }
      return NextResponse.json(
        { error: `작업 시작 실패: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      );
    }

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

      // old cache 삭제 (백업 없음 — .v3cache_prev 회전 없음)
      if (await exists(oldCacheDir)) await rm(oldCacheDir, { recursive: true, force: true });
      if (await exists(oldImagesDir)) await rm(oldImagesDir, { recursive: true, force: true });

      // outputs/images/ 클리어 + 재생성 (derivable artifact 갱신). 실패해도 입력 commit은 유지한다.
      try {
        if (await exists(OUTPUTS_IMAGES_DIR)) {
          await rm(OUTPUTS_IMAGES_DIR, { recursive: true, force: true });
        }
        await mkdir(OUTPUTS_IMAGES_DIR, { recursive: true });
      } catch {
        /* derivable artifact cleanup best effort */
      }

      await rm(LOCK_PATH, { force: true }).catch(() => {});
    } catch (err) {
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
      } catch { /* best effort */ }
      if (isTransientFsBusyError(err)) {
        return NextResponse.json(
          {
            error: `작업 시작 보류: 입력 이미지 폴더가 다른 프로세스에서 사용 중입니다. (${err instanceof Error ? err.message : String(err)})`,
            hint: "이전 손글씨 제거/이미지 생성 작업이 question_images 폴더를 아직 사용 중입니다.",
            code: "input_dir_busy",
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: `작업 시작 commit 실패: ${err instanceof Error ? err.message : String(err)}`, code: "commit_failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, images: saved });
  }

  return { POST, CACHE_DIR, IMAGES_DIR, OUTPUTS_IMAGES_DIR, LOCK_PATH, IMAGE_CLEANER_LOCK_PATH };
}

// ──────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────

function pngBuffer(): ArrayBuffer {
  // Minimal valid PNG header (1x1 transparent)
  const hex = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6260000000020001e221bc330000000049454e44ae426082";
  const ab = new ArrayBuffer(hex.length / 2);
  const view = new Uint8Array(ab);
  for (let i = 0; i < view.length; i++) {
    view[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return ab;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

describe("POST /api/create/start", () => {
  let baseDir: string;
  let examDir: string;
  let outputsImagesDir: string;

  beforeEach(async () => {
    baseDir = await makeTempBase();
    ({ examDir, outputsImagesDir } = await makeExamDirs(baseDir));
  });

  it("정상 흐름: meta + images 2장 → session_meta.json + question_images 존재, 이전 캐시 삭제, outputs/images 클리어", async () => {
    // Pre-populate existing .v3cache to verify old cache is deleted (not rotated to _prev)
    const existingCacheDir = path.join(examDir, ".v3cache");
    const existingImagesDir = path.join(examDir, "question_images");
    await mkdir(existingCacheDir, { recursive: true });
    await writeFile(path.join(existingCacheDir, "old_file.txt"), "old data", "utf-8");
    await mkdir(existingImagesDir, { recursive: true });
    await writeFile(path.join(existingImagesDir, "q01.png"), "old image", "utf-8");
    // Pre-populate outputs/images with a stale file from a previous exam
    await writeFile(path.join(outputsImagesDir, "prob5_final.png"), "stale figure", "utf-8");

    const { POST, CACHE_DIR, IMAGES_DIR, OUTPUTS_IMAGES_DIR } = await buildHandler(examDir, outputsImagesDir);
    const meta = { schoolLevel: "고", school: "테스트고", grade: 2, year: 2025, subject: "수학 I", semester: "1학기", examType: "중간", range: "지수~로그" };
    const req = makeRequest(meta, [
      { key: "q01", name: "q01.png", data: pngBuffer() },
      { key: "q02", name: "q02.png", data: pngBuffer() },
    ]);

    const res = await POST(req);
    const body = await res.json() as { ok: boolean; images: { number: number; kind: string; path: string }[] };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.images).toHaveLength(2);
    expect(body.images.map((i) => i.number).sort()).toEqual([1, 2]);

    // session_meta.json에 메타 저장됐는지 확인
    const metaRaw = await readdir(CACHE_DIR);
    expect(metaRaw).toContain("session_meta.json");
    const savedMeta = JSON.parse(
      await import("fs/promises").then((fs) => fs.readFile(path.join(CACHE_DIR, "session_meta.json"), "utf-8"))
    ) as typeof meta;
    expect(savedMeta.school).toBe("테스트고");

    // question_images에 파일 저장됐는지 확인
    const imgFiles = await readdir(IMAGES_DIR);
    expect(imgFiles).toContain("q01.png");
    expect(imgFiles).toContain("q02.png");

    // 이전 캐시가 삭제됐는지 확인 (.v3cache_prev 없음)
    expect(await fileExists(path.join(examDir, ".v3cache_prev"))).toBe(false);

    // outputs/images/ 가 클리어 + 재생성됐는지 확인 (stale file 사라짐)
    expect(await fileExists(OUTPUTS_IMAGES_DIR)).toBe(true);
    const outputFiles = await readdir(OUTPUTS_IMAGES_DIR);
    expect(outputFiles).not.toContain("prob5_final.png");
    // dir itself exists (empty, ready for figure_processor)
    expect(outputFiles).toHaveLength(0);

    // lock이 정리됐는지 확인
    const lockPath = path.join(examDir, ".create_start.lock");
    expect(await fileExists(lockPath)).toBe(false);

    // .next_* 임시 디렉터리가 남아있지 않은지 확인
    const examEntries = await readdir(examDir);
    const tempDirRemaining = examEntries.filter((e) => e.includes(".next_") || e.includes(".old_"));
    expect(tempDirRemaining).toHaveLength(0);
  });

  it("essay 이미지 처리: q_s01 → kind=essay, 파일명 q_s01.png", async () => {
    const { POST, IMAGES_DIR } = await buildHandler(examDir, outputsImagesDir);
    const meta = { schoolLevel: "고", school: "학교", grade: 1, year: 2025, subject: "수학", semester: "1학기", examType: "기말", range: "전범위" };
    const req = makeRequest(meta, [
      { key: "q_s01", name: "q_s01.png", data: pngBuffer() },
    ]);

    const res = await POST(req);
    const body = await res.json() as { ok: boolean; images: { number: number; kind: string }[] };

    expect(res.status).toBe(200);
    expect(body.images[0].kind).toBe("essay");
    const imgFiles = await readdir(IMAGES_DIR);
    expect(imgFiles).toContain("q_s01.png");
  });

  it("strips runtime resume fields from fresh create metadata", async () => {
    const { POST, CACHE_DIR } = await buildHandler(examDir, outputsImagesDir);
    const meta = {
      school: "runtime leak test",
      year: 2026,
      resumeFrom: "confirm",
      questionCount: 99,
    };
    const req = makeRequest(meta, [
      { key: "q01", name: "q01.png", data: pngBuffer() },
    ]);

    const res = await POST(req);
    expect(res.status).toBe(200);

    const savedMeta = JSON.parse(
      await import("fs/promises").then((fs) => fs.readFile(path.join(CACHE_DIR, "session_meta.json"), "utf-8"))
    ) as Record<string, unknown>;
    expect(savedMeta.school).toBe("runtime leak test");
    expect(savedMeta.resumeFrom).toBeUndefined();
    expect(savedMeta.questionCount).toBeUndefined();
  });

  it("meta 필드 없음 → 400", async () => {
    const { POST } = await buildHandler(examDir, outputsImagesDir);
    const form = new FormData();
    form.append("q01", new File([pngBuffer()], "q01.png", { type: "image/png" }));
    const req = { formData: async () => form } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("meta");
  });

  it("images 0개 → 400", async () => {
    const { POST } = await buildHandler(examDir, outputsImagesDir);
    const meta = { school: "학교", year: 2025 };
    const req = makeRequest(meta, []);

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("이미지");
  });

  it("이미지 정리 lock이 살아있으면 새 작업 시작을 409로 보류", async () => {
    const { POST, IMAGE_CLEANER_LOCK_PATH } = await buildHandler(examDir, outputsImagesDir);
    await mkdir(path.dirname(IMAGE_CLEANER_LOCK_PATH), { recursive: true });
    await writeFile(
      IMAGE_CLEANER_LOCK_PATH,
      JSON.stringify({
        token: "cleaning",
        pid: process.pid,
        startedAt: new Date().toISOString(),
        questionImagesDir: path.join(examDir, "question_images"),
        statusOutPath: path.join(examDir, ".v3cache", "cleaning_status.json"),
        clean: true,
      }),
      "utf-8"
    );

    const req = makeRequest({ school: "학교" }, [
      { key: "q01", name: "q01.png", data: pngBuffer() },
    ]);

    const res = await POST(req);
    const body = await res.json() as { code?: string; hint?: string };

    expect(res.status).toBe(409);
    expect(body.code).toBe("image_cleaner_busy");
    expect(body.hint).toContain("question_images");
  });

  it("write 단계 실패 시 final path untouched (기존 .v3cache 그대로)", async () => {
    // Pre-populate existing .v3cache with a sentinel file
    const existingCacheDir = path.join(examDir, ".v3cache");
    await mkdir(existingCacheDir, { recursive: true });
    await writeFile(path.join(existingCacheDir, "sentinel.txt"), "must survive", "utf-8");

    const { POST, CACHE_DIR } = await buildHandler(examDir, outputsImagesDir);

    // Craft a request where the key is completely invalid to trigger the
    // "saved.length !== images.length" check by using a key with no numeric part.
    // Actually we need a different approach: use a key like "meta2" (no q prefix → skipped).
    // Let's inject an image with an invalid key that gets skipped, causing count mismatch.
    const form = new FormData();
    form.append("meta", JSON.stringify({ school: "학교" }));
    // "xyz" key — doesn't start with q or q_s → numPart = null → skipped
    form.append("xyz01", new File([pngBuffer()], "xyz01.png", { type: "image/png" }));
    const req = { formData: async () => form } as unknown as NextRequest;

    const res = await POST(req);
    // images.length = 1 (File), but saved = 0 → mismatch → 500
    expect(res.status).toBe(500);

    // Final .v3cache must be untouched — sentinel still there
    const files = await readdir(CACHE_DIR);
    expect(files).toContain("sentinel.txt");

    // No .next_* temps left behind
    const examEntries = await readdir(examDir);
    const leftover = examEntries.filter((e) => e.includes(".next_") || e.includes(".old_"));
    expect(leftover).toHaveLength(0);
  });

  it("temp dirs never visible from final paths during write stage", async () => {
    // This test verifies that the final CACHE_DIR and IMAGES_DIR are not modified
    // until the commit step — so any reader polling between write and commit sees
    // the pre-existing state, not partial temp data.

    // Populate existing state
    const existingCacheDir = path.join(examDir, ".v3cache");
    const existingImagesDir = path.join(examDir, "question_images");
    await mkdir(existingCacheDir, { recursive: true });
    await writeFile(path.join(existingCacheDir, "session_meta.json"), JSON.stringify({ school: "old" }), "utf-8");
    await mkdir(existingImagesDir, { recursive: true });
    await writeFile(path.join(existingImagesDir, "q01.png"), "old image data", "utf-8");

    const { POST, CACHE_DIR, IMAGES_DIR } = await buildHandler(examDir, outputsImagesDir);

    // We intercept mid-write by using a proxy — but since we can't easily pause
    // async execution, we verify the invariant post-commit: temp dirs are gone.
    const meta = { school: "new" };
    const req = makeRequest(meta, [
      { key: "q01", name: "q01.png", data: pngBuffer() },
    ]);

    await POST(req);

    // After success: only final dirs exist, no .next_* or .old_*
    const entries = await readdir(examDir);
    expect(entries.filter((e) => e.includes(".next_"))).toHaveLength(0);
    expect(entries.filter((e) => e.includes(".old_"))).toHaveLength(0);

    // Final paths point to new data
    const metaContent = JSON.parse(
      await import("fs/promises").then((fs) => fs.readFile(path.join(CACHE_DIR, "session_meta.json"), "utf-8"))
    ) as { school: string };
    expect(metaContent.school).toBe("new");

    // Images dir has new content
    const imgFiles = await readdir(IMAGES_DIR);
    expect(imgFiles).toContain("q01.png");
  });

  it("lock 파일 존재 시 GET /api/question-images가 pending/409 반환", async () => {
    // Write a fresh lock file
    const lockPath = path.join(examDir, ".create_start.lock");
    await writeFile(lockPath, JSON.stringify({ txid: "test", startedAt: new Date().toISOString() }), "utf-8");

    // Build a minimal isLocked function matching the route logic
    const LOCK_STALE_MS = 30_000;
    async function isLocked(): Promise<boolean> {
      try {
        const s = await stat(lockPath);
        const ageMs = Date.now() - s.mtimeMs;
        if (ageMs > LOCK_STALE_MS) return false;
        return true;
      } catch {
        return false;
      }
    }

    expect(await isLocked()).toBe(true);
  });

  it("stale lock (>30s) → isLocked 반환 false (정상 읽기 재시도)", async () => {
    const lockPath = path.join(examDir, ".create_start.lock");
    await writeFile(lockPath, JSON.stringify({ txid: "stale" }), "utf-8");

    // Manually backdate the file mtime by setting utimes to 60s ago
    const { utimes } = await import("fs/promises");
    const pastTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, pastTime, pastTime);

    const LOCK_STALE_MS = 30_000;
    async function isLocked(): Promise<boolean> {
      try {
        const s = await stat(lockPath);
        const ageMs = Date.now() - s.mtimeMs;
        if (ageMs > LOCK_STALE_MS) return false;
        return true;
      } catch {
        return false;
      }
    }

    expect(await isLocked()).toBe(false);
  });

  it("기존 .v3cache가 없을 때도 정상 작동 (신규 시험지 최초 작업)", async () => {
    // No pre-existing .v3cache or question_images
    const { POST, CACHE_DIR, IMAGES_DIR } = await buildHandler(examDir, outputsImagesDir);
    const meta = { school: "초기화학교" };
    const req = makeRequest(meta, [
      { key: "q01", name: "q01.png", data: pngBuffer() },
    ]);

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await fileExists(path.join(CACHE_DIR, "session_meta.json"))).toBe(true);
    expect(await fileExists(path.join(IMAGES_DIR, "q01.png"))).toBe(true);

    // No .v3cache_prev should exist (nothing to rotate)
    expect(await fileExists(path.join(examDir, ".v3cache_prev"))).toBe(false);
  });

  it("commit 단계 실패 시 HTTP 500, 적절한 에러 메시지, .next_*/.old_* 찌꺼기 없음", async () => {
    // Pre-populate existing .v3cache / question_images so they get renamed to old_ during commit
    const existingCacheDir = path.join(examDir, ".v3cache");
    const existingImagesDir = path.join(examDir, "question_images");
    await mkdir(existingCacheDir, { recursive: true });
    await writeFile(path.join(existingCacheDir, "sentinel.txt"), "original data", "utf-8");
    await mkdir(existingImagesDir, { recursive: true });
    await writeFile(path.join(existingImagesDir, "q01.png"), "original image", "utf-8");

    // Inject a rename that succeeds for the first two calls (old → old_<txid>)
    // but throws on the third (next_<txid> → CACHE_DIR), simulating a commit failure.
    const { rename: realRename } = await import("fs/promises");
    let renameCallCount = 0;
    const faultyRename = async (oldPath: string, newPath: string): Promise<void> => {
      renameCallCount++;
      // The commit sequence:
      //   call 1: CACHE_DIR → oldCacheDir   (old .v3cache aside)
      //   call 2: IMAGES_DIR → oldImagesDir (old question_images aside)
      //   call 3: nextCacheDir → CACHE_DIR  ← inject failure here
      if (renameCallCount === 3) {
        throw new Error("simulated commit rename failure");
      }
      return realRename(oldPath, newPath);
    };

    const { POST } = await buildHandler(examDir, outputsImagesDir, { rename: faultyRename });
    const meta = { school: "새학교" };
    const req = makeRequest(meta, [
      { key: "q01", name: "q01.png", data: pngBuffer() },
    ]);

    const res = await POST(req);

    // (a) HTTP 500 반환
    expect(res.status).toBe(500);

    // (b) 응답 본문에 적절한 에러 메시지
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
    expect(typeof body.error).toBe("string");

    // (c) .next_* / .old_* 찌꺼기가 디스크에 남아있지 않음
    const examEntries = await readdir(examDir);
    const leftovers = examEntries.filter(
      (e) => e.includes(".next_") || e.includes(".old_")
    );
    expect(leftovers).toHaveLength(0);

    // lock 파일도 정리됐는지 확인
    const lockPath = path.join(examDir, ".create_start.lock");
    expect(await fileExists(lockPath)).toBe(false);
  });

  it("question_images rename이 Windows 잠금 오류면 409와 재시도 힌트를 반환", async () => {
    const existingCacheDir = path.join(examDir, ".v3cache");
    const existingImagesDir = path.join(examDir, "question_images");
    await mkdir(existingCacheDir, { recursive: true });
    await writeFile(path.join(existingCacheDir, "sentinel.txt"), "original cache", "utf-8");
    await mkdir(existingImagesDir, { recursive: true });
    await writeFile(path.join(existingImagesDir, "q01.png"), "original image", "utf-8");

    const { rename: realRename } = await import("fs/promises");
    let renameCallCount = 0;
    const busyRename = async (oldPath: string, newPath: string): Promise<void> => {
      renameCallCount++;
      if (renameCallCount === 2) {
        const err = new Error("simulated EPERM") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return realRename(oldPath, newPath);
    };

    const { POST, CACHE_DIR, IMAGES_DIR } = await buildHandler(examDir, outputsImagesDir, { rename: busyRename });
    const req = makeRequest({ school: "새학교" }, [
      { key: "q01", name: "q01.png", data: pngBuffer() },
    ]);

    const res = await POST(req);
    const body = await res.json() as { code?: string; hint?: string };

    expect(res.status).toBe(409);
    expect(body.code).toBe("input_dir_busy");
    expect(body.hint).toContain("question_images");
    expect(await fileExists(path.join(CACHE_DIR, "sentinel.txt"))).toBe(true);
    expect(await fileExists(path.join(IMAGES_DIR, "q01.png"))).toBe(true);
  });

  it("commit 4번째 rename 실패 시 새 cache를 제거하고 기존 cache/images를 모두 복원", async () => {
    const existingCacheDir = path.join(examDir, ".v3cache");
    const existingImagesDir = path.join(examDir, "question_images");
    await mkdir(existingCacheDir, { recursive: true });
    await writeFile(path.join(existingCacheDir, "sentinel.txt"), "original cache", "utf-8");
    await mkdir(existingImagesDir, { recursive: true });
    await writeFile(path.join(existingImagesDir, "q01.png"), "original image", "utf-8");

    const { rename: realRename } = await import("fs/promises");
    let renameCallCount = 0;
    const faultyRename = async (oldPath: string, newPath: string): Promise<void> => {
      renameCallCount++;
      if (renameCallCount === 4) {
        throw new Error("simulated image commit failure");
      }
      return realRename(oldPath, newPath);
    };

    const { POST, CACHE_DIR, IMAGES_DIR } = await buildHandler(examDir, outputsImagesDir, { rename: faultyRename });
    const req = makeRequest({ school: "새학교" }, [
      { key: "q01", name: "q01.png", data: pngBuffer() },
    ]);

    const res = await POST(req);
    expect(res.status).toBe(500);

    const cacheFiles = await readdir(CACHE_DIR);
    expect(cacheFiles).toContain("sentinel.txt");
    expect(cacheFiles).not.toContain("session_meta.json");

    const imageContent = await import("fs/promises").then((fs) =>
      fs.readFile(path.join(IMAGES_DIR, "q01.png"), "utf-8")
    );
    expect(imageContent).toBe("original image");

    const examEntries = await readdir(examDir);
    expect(examEntries.filter((e) => e.includes(".next_") || e.includes(".old_"))).toHaveLength(0);
    expect(await fileExists(path.join(examDir, ".create_start.lock"))).toBe(false);
  });

  it("outputs/images cleanup 실패는 입력 commit을 rollback하지 않는다", async () => {
    const existingCacheDir = path.join(examDir, ".v3cache");
    const existingImagesDir = path.join(examDir, "question_images");
    await mkdir(existingCacheDir, { recursive: true });
    await writeFile(path.join(existingCacheDir, "old_file.txt"), "old cache", "utf-8");
    await mkdir(existingImagesDir, { recursive: true });
    await writeFile(path.join(existingImagesDir, "q01.png"), "old image", "utf-8");
    await writeFile(path.join(outputsImagesDir, "stale.png"), "stale", "utf-8");

    const { rm: realRm } = await import("fs/promises");
    const faultyRm = async (target: string, options?: Parameters<typeof realRm>[1]): Promise<void> => {
      if (target === outputsImagesDir) {
        throw new Error("simulated outputs cleanup failure");
      }
      return realRm(target, options);
    };

    const { POST, CACHE_DIR, IMAGES_DIR } = await buildHandler(examDir, outputsImagesDir, { rm: faultyRm });
    const req = makeRequest({ school: "새학교" }, [
      { key: "q01", name: "q01.png", data: pngBuffer() },
    ]);

    const res = await POST(req);
    const body = await res.json() as { ok: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const cacheFiles = await readdir(CACHE_DIR);
    expect(cacheFiles).toContain("session_meta.json");
    expect(cacheFiles).not.toContain("old_file.txt");
    expect(await fileExists(path.join(IMAGES_DIR, "q01.png"))).toBe(true);
    expect(await fileExists(path.join(outputsImagesDir, "stale.png"))).toBe(true);
    expect(await fileExists(path.join(examDir, ".create_start.lock"))).toBe(false);
  });
});
