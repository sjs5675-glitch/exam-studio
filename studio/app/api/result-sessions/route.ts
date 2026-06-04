import { NextRequest, NextResponse } from "next/server";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import path from "path";
import type { ExamMetaInput } from "@/lib/exam/meta";
import { getDataRoot } from "@/lib/server/paths";

const BASE_DIR = getDataRoot();
const EXAM_DIR = path.join(BASE_DIR, "inputs", "시험지 제작");
const CACHE_DIR = path.join(EXAM_DIR, ".v3cache");
const IMAGES_DIR = path.join(EXAM_DIR, "question_images");
const HISTORY_DIR = path.join(EXAM_DIR, ".history");
const OUTPUTS_IMAGES_DIR = path.join(BASE_DIR, "outputs", "images");
const LOCK_PATH = path.join(EXAM_DIR, ".create_start.lock");
const LOCK_STALE_MS = 30_000;

type ImageCounts = {
  questionCount: number;
  essayCount: number;
  hasClean: boolean;
};

type ResultSession = {
  id: string;
  active: boolean;
  label: string;
  updatedAt: string;
  questionCount: number;
  essayCount: number;
  hasClean: boolean;
  meta?: ExamMetaInput;
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isLocked(): Promise<boolean> {
  try {
    const s = await stat(LOCK_PATH);
    return Date.now() - s.mtimeMs <= LOCK_STALE_MS;
  } catch {
    return false;
  }
}

async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOTEMPTY";
      if (!transient || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 150 * (i + 1)));
    }
  }
}

async function readMeta(cacheDir: string): Promise<ExamMetaInput | undefined> {
  try {
    const raw = await readFile(path.join(cacheDir, "session_meta.json"), "utf-8");
    return JSON.parse(raw) as ExamMetaInput;
  } catch {
    return undefined;
  }
}

async function scanImages(imagesDir: string): Promise<ImageCounts> {
  let files: string[] = [];
  try {
    files = await readdir(imagesDir);
  } catch {
    return { questionCount: 0, essayCount: 0, hasClean: false };
  }

  const qRegex = /^q\d+\.(png|jpg|jpeg)$/i;
  const essayRegex = /^q_s\d+\.(png|jpg|jpeg)$/i;
  const questionCount = files.filter((file) => qRegex.test(file)).length;
  const essayCount = files.filter((file) => essayRegex.test(file)).length;

  let cleanedFiles: string[] = [];
  try {
    cleanedFiles = await readdir(path.join(imagesDir, "cleaned"));
  } catch {
    // optional folder
  }
  const hasClean = cleanedFiles.some((file) => qRegex.test(file) || essayRegex.test(file));
  return { questionCount, essayCount, hasClean };
}

async function latestMtime(paths: string[]): Promise<string> {
  let latest = 0;
  for (const p of paths) {
    try {
      const s = await stat(p);
      latest = Math.max(latest, s.mtimeMs);
    } catch {
      // ignore missing path
    }
  }
  return new Date(latest || Date.now()).toISOString();
}

function makeLabel(meta: ExamMetaInput | undefined, fallback: string): string {
  if (!meta) return fallback;
  const levelGrade = [meta.schoolLevel, meta.grade ? `${meta.grade}학년` : ""].filter(Boolean).join(" ");
  const parts = [
    meta.documentKind === "science_exam" ? "과학시험지" : "과학 문제집",
    levelGrade,
    meta.subject,
    meta.workbookRole === "teacher" ? "교사용" : meta.workbookRole === "student" ? "학생용" : undefined,
    meta.publisher,
    meta.bookTitle,
    meta.semester,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" · ") : fallback;
}

async function buildSession(
  id: string,
  active: boolean,
  cacheDir: string,
  imagesDir: string,
): Promise<ResultSession | null> {
  const imageState = await scanImages(imagesDir);
  const meta = await readMeta(cacheDir);
  if (imageState.questionCount + imageState.essayCount === 0 && !meta) return null;
  const updatedAt = await latestMtime([cacheDir, imagesDir, path.join(cacheDir, "session_meta.json")]);
  return {
    id,
    active,
    label: makeLabel(meta, active ? "현재 작업" : id),
    updatedAt,
    questionCount: imageState.questionCount,
    essayCount: imageState.essayCount,
    hasClean: imageState.hasClean,
    meta,
  };
}

async function archiveDirs(cacheDir: string, imagesDir: string, txid: string): Promise<void> {
  const hasCache = await exists(cacheDir);
  const hasImages = await exists(imagesDir);
  if (!hasCache && !hasImages) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(HISTORY_DIR, `${stamp}_${txid}`);
  await mkdir(archiveDir, { recursive: true });
  if (hasCache) await renameWithRetry(cacheDir, path.join(archiveDir, ".v3cache"));
  if (hasImages) await renameWithRetry(imagesDir, path.join(archiveDir, "question_images"));
}

function safeHistoryPath(id: string): string | null {
  if (!/^[\w.-]+$/.test(id)) return null;
  const full = path.join(HISTORY_DIR, id);
  const relative = path.relative(HISTORY_DIR, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return full;
}

function isTransientFsBusyError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOTEMPTY";
}

export async function GET() {
  if (await isLocked()) {
    return NextResponse.json({ pending: true, sessions: [] }, { status: 409 });
  }

  try {
    const sessions: ResultSession[] = [];
    const active = await buildSession("active", true, CACHE_DIR, IMAGES_DIR);
    if (active) sessions.push(active);

    let historyIds: string[] = [];
    try {
      historyIds = await readdir(HISTORY_DIR);
    } catch {
      // no history yet
    }

    for (const id of historyIds) {
      const root = safeHistoryPath(id);
      if (!root) continue;
      const session = await buildSession(
        id,
        false,
        path.join(root, ".v3cache"),
        path.join(root, "question_images"),
      );
      if (session) sessions.push(session);
    }

    sessions.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
    return NextResponse.json({ sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "결과 목록 조회 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (await isLocked()) {
    return NextResponse.json({ error: "다른 작업이 입력 폴더를 갱신 중입니다." }, { status: 409 });
  }

  try {
    const body = await req.json() as { id?: string };
    const id = body.id;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    if (id === "active") return NextResponse.json({ ok: true, id });

    const sourceRoot = safeHistoryPath(id);
    if (!sourceRoot || !(await exists(sourceRoot))) {
      return NextResponse.json({ error: "선택한 결과를 찾을 수 없습니다." }, { status: 404 });
    }

    const sourceCache = path.join(sourceRoot, ".v3cache");
    const sourceImages = path.join(sourceRoot, "question_images");
    const hasSourceCache = await exists(sourceCache);
    const hasSourceImages = await exists(sourceImages);
    if (!hasSourceCache && !hasSourceImages) {
      return NextResponse.json({ error: "선택한 결과의 캐시 또는 이미지가 없습니다." }, { status: 404 });
    }

    const txid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const nextCacheDir = path.join(EXAM_DIR, `.v3cache.restore_${txid}`);
    const nextImagesDir = path.join(EXAM_DIR, `question_images.restore_${txid}`);
    const oldCacheDir = path.join(EXAM_DIR, `.v3cache.old_restore_${txid}`);
    const oldImagesDir = path.join(EXAM_DIR, `question_images.old_restore_${txid}`);

    if (hasSourceCache) {
      await cp(sourceCache, nextCacheDir, { recursive: true });
    } else {
      await mkdir(nextCacheDir, { recursive: true });
    }
    if (hasSourceImages) {
      await cp(sourceImages, nextImagesDir, { recursive: true });
    } else {
      await mkdir(nextImagesDir, { recursive: true });
    }

    let oldCacheMoved = false;
    let oldImagesMoved = false;
    let newCacheCommitted = false;
    let newImagesCommitted = false;

    try {
      await writeFile(LOCK_PATH, JSON.stringify({ txid, startedAt: new Date().toISOString(), restoreFrom: id }), "utf-8");
      if (await exists(CACHE_DIR)) {
        await renameWithRetry(CACHE_DIR, oldCacheDir);
        oldCacheMoved = true;
      }
      if (await exists(IMAGES_DIR)) {
        await renameWithRetry(IMAGES_DIR, oldImagesDir);
        oldImagesMoved = true;
      }
      await renameWithRetry(nextCacheDir, CACHE_DIR);
      newCacheCommitted = true;
      await renameWithRetry(nextImagesDir, IMAGES_DIR);
      newImagesCommitted = true;
      await archiveDirs(oldCacheDir, oldImagesDir, `restore_${txid}`);
      await rm(OUTPUTS_IMAGES_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(OUTPUTS_IMAGES_DIR, { recursive: true });
      await rm(LOCK_PATH, { force: true }).catch(() => {});
    } catch (err) {
      if (newCacheCommitted) await rm(CACHE_DIR, { recursive: true, force: true }).catch(() => {});
      if (newImagesCommitted) await rm(IMAGES_DIR, { recursive: true, force: true }).catch(() => {});
      if (oldCacheMoved && await exists(oldCacheDir)) await renameWithRetry(oldCacheDir, CACHE_DIR).catch(() => {});
      if (oldImagesMoved && await exists(oldImagesDir)) await renameWithRetry(oldImagesDir, IMAGES_DIR).catch(() => {});
      await rm(nextCacheDir, { recursive: true, force: true }).catch(() => {});
      await rm(nextImagesDir, { recursive: true, force: true }).catch(() => {});
      await rm(LOCK_PATH, { force: true }).catch(() => {});
      throw err;
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "결과 복원 실패";
    return NextResponse.json(
      { error: message },
      { status: isTransientFsBusyError(err) ? 409 : 500 },
    );
  }
}
