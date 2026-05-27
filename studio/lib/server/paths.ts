import path from "path";
import { existsSync } from "fs";

/**
 * Walk up from `start` until a directory containing `marker` is found.
 * Returns the directory holding the marker, or null if the filesystem root
 * is reached without a match.
 */
function findUp(start: string, marker: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/**
 * Repo/data root — the directory holding the Python pipeline + outputs/ + inputs/.
 *
 * Resolution is independent of where the server was launched (the old
 * `path.resolve(process.cwd(), "..")` broke whenever cwd or nesting depth
 * differed from the assumed layout):
 *   1. EXAM_STUDIO_ROOT env override (explicit escape hatch)
 *   2. nearest ancestor of cwd containing `assemble.py` (the pipeline root marker)
 *   3. fallback: parent of cwd (legacy behavior — the Next app is a child of the root)
 */
export function getDataRoot(cwd: string = process.cwd()): string {
  const override = process.env.EXAM_STUDIO_ROOT;
  if (override && override.trim()) return path.resolve(override);
  return findUp(cwd, "assemble.py") ?? path.resolve(cwd, "..");
}

/**
 * Next app's job-store directory (`data/jobs`), resolved relative to the app
 * root (nearest ancestor containing `next.config.ts`) rather than the launch
 * cwd, so it stays correct regardless of where the server was started.
 */
export function getJobsDir(cwd: string = process.cwd()): string {
  const appRoot = findUp(cwd, "next.config.ts") ?? cwd;
  return path.join(appRoot, "data", "jobs");
}
