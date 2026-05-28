import path from "path";
import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";

export const IMAGE_CLEANER_LOCK_FILE = ".image_cleaner.lock";
export const IMAGE_CLEANER_LOCK_STALE_MS = 12 * 60 * 1000;

export interface ImageCleanerLockInfo {
  token: string;
  pid: number;
  startedAt: string;
  questionImagesDir: string;
  statusOutPath: string;
  clean: boolean;
  imageProvider?: string;
  questionNumber?: number;
}

export interface ActiveImageCleanerLock {
  lockPath: string;
  ageMs: number;
  info: Partial<ImageCleanerLockInfo>;
}

export interface ImageCleanerLockHandle {
  lockPath: string;
  token: string;
  release: () => Promise<void>;
}

export class ImageCleanerBusyError extends Error {
  constructor(readonly activeLock: ActiveImageCleanerLock) {
    super("Image cleaner is already running");
    this.name = "ImageCleanerBusyError";
  }
}

export function imageCleanerLockPath(statusOutPath: string): string {
  return path.join(path.dirname(statusOutPath), IMAGE_CLEANER_LOCK_FILE);
}

export async function getActiveImageCleanerLock(
  lockPath: string,
  staleMs = IMAGE_CLEANER_LOCK_STALE_MS
): Promise<ActiveImageCleanerLock | null> {
  let ageMs = 0;
  try {
    const lockStat = await stat(lockPath);
    ageMs = Date.now() - lockStat.mtimeMs;
  } catch {
    return null;
  }

  if (ageMs > staleMs) {
    await rm(lockPath, { force: true }).catch(() => {});
    return null;
  }

  let info: Partial<ImageCleanerLockInfo> = {};
  try {
    info = JSON.parse(await readFile(lockPath, "utf8")) as Partial<ImageCleanerLockInfo>;
  } catch {
    info = {};
  }

  return { lockPath, ageMs, info };
}

export async function acquireImageCleanerLock(input: {
  questionImagesDir: string;
  statusOutPath: string;
  clean: boolean;
  imageProvider?: string;
  questionNumber?: number;
}): Promise<ImageCleanerLockHandle> {
  const lockPath = imageCleanerLockPath(input.statusOutPath);
  await mkdir(path.dirname(lockPath), { recursive: true });

  const activeLock = await getActiveImageCleanerLock(lockPath);
  if (activeLock) {
    throw new ImageCleanerBusyError(activeLock);
  }

  const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const info: ImageCleanerLockInfo = {
    token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    questionImagesDir: input.questionImagesDir,
    statusOutPath: input.statusOutPath,
    clean: input.clean,
    ...(input.imageProvider ? { imageProvider: input.imageProvider } : {}),
    ...(input.questionNumber !== undefined ? { questionNumber: input.questionNumber } : {}),
  };

  try {
    await writeFile(lockPath, `${JSON.stringify(info, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      const existing = await getActiveImageCleanerLock(lockPath);
      throw new ImageCleanerBusyError(existing ?? { lockPath, ageMs: 0, info: {} });
    }
    throw err;
  }

  return {
    lockPath,
    token,
    release: async () => {
      try {
        const current = JSON.parse(await readFile(lockPath, "utf8")) as Partial<ImageCleanerLockInfo>;
        if (current.token === token) {
          await rm(lockPath, { force: true });
        }
      } catch {
        await rm(lockPath, { force: true }).catch(() => {});
      }
    },
  };
}
