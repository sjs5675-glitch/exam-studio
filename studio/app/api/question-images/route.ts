import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readdir, readFile, stat } from "fs/promises";
import path from "path";

const BASE_DIR = path.resolve(process.cwd(), "..");
const EXAM_DIR = path.join(BASE_DIR, "inputs", "시험지 제작");
const IMAGES_DIR = path.join(EXAM_DIR, "question_images");
const CACHE_DIR = path.join(EXAM_DIR, ".v3cache");
const FIGURE_STATUS_PATH = path.join(CACHE_DIR, "figure_status.json");
// Lock written by /api/create/start during atomic commit window
const LOCK_PATH = path.join(EXAM_DIR, ".create_start.lock");
const LOCK_STALE_MS = 30_000;

async function isLocked(): Promise<boolean> {
  try {
    const s = await stat(LOCK_PATH);
    const ageMs = Date.now() - s.mtimeMs;
    if (ageMs > LOCK_STALE_MS) {
      console.warn(`[question-images] stale lock detected (age=${ageMs}ms), ignoring`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

type FigurePhaseStatus = "ok" | "failed" | "boundary_uncertain";

interface QuestionCacheState {
  extracted: boolean;
  solved: boolean;
  verified: boolean;
  figure?: { status: FigurePhaseStatus; image?: string };
}

async function scanCacheState(numbers: number[]): Promise<Record<number, QuestionCacheState>> {
  let cacheFiles = new Set<string>();
  try {
    const entries = await readdir(CACHE_DIR);
    cacheFiles = new Set(entries);
  } catch { /* cache dir missing */ }

  let figureStatus: { questions?: Record<string, { status?: FigurePhaseStatus; image?: string }> } = {};
  try {
    const raw = await readFile(FIGURE_STATUS_PATH, "utf-8");
    figureStatus = JSON.parse(raw);
  } catch { /* figure_status.json missing → no figure state */ }

  const result: Record<number, QuestionCacheState> = {};
  for (const n of numbers) {
    const padded = String(n).padStart(2, "0");
    const state: QuestionCacheState = {
      extracted: cacheFiles.has(`q${padded}_extracted.json`),
      solved: cacheFiles.has(`q${padded}_solved.json`),
      verified: cacheFiles.has(`q${padded}_verified.json`),
    };
    const figQ = figureStatus.questions?.[String(n)] ?? figureStatus.questions?.[padded];
    if (figQ && figQ.status) {
      state.figure = { status: figQ.status, ...(figQ.image ? { image: figQ.image } : {}) };
    }
    result[n] = state;
  }
  return result;
}

export async function GET() {
  if (await isLocked()) {
    return NextResponse.json({ pending: true }, { status: 409 });
  }
  try {
    let files: string[] = [];
    try {
      files = await readdir(IMAGES_DIR);
    } catch { /* folder doesn't exist */ }

    const qRegex = /^q(\d+)\.(png|jpg|jpeg)$/i;
    const essayRegex = /^q_s(\d+)\.(png|jpg|jpeg)$/i;
    const numbers = files
      .map((f) => qRegex.exec(f))
      .filter(Boolean)
      .map((m) => parseInt(m![1], 10))
      .sort((a, b) => a - b);
    const essayNumbers = files
      .map((f) => essayRegex.exec(f))
      .filter(Boolean)
      .map((m) => parseInt(m![1], 10))
      .sort((a, b) => a - b);

    let cleanedFiles: string[] = [];
    try {
      cleanedFiles = await readdir(path.join(IMAGES_DIR, "cleaned"));
    } catch { /* no cleaned folder */ }
    const hasClean = cleanedFiles.some((f) => qRegex.test(f) || essayRegex.test(f));

    const cacheState = await scanCacheState([...numbers, ...essayNumbers]);

    return NextResponse.json({
      count: numbers.length + essayNumbers.length,
      numbers,
      essayNumbers,
      hasClean,
      cacheState,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Read failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const formData = await req.formData();
    const qNumStr = formData.get("qNum");
    const file = formData.get("file");
    const kind = String(formData.get("kind") ?? "regular");

    if (!qNumStr || !(file instanceof File)) {
      return NextResponse.json({ error: "qNum and file required" }, { status: 400 });
    }

    const num = parseInt(String(qNumStr), 10);
    if (isNaN(num)) {
      return NextResponse.json({ error: "Invalid qNum" }, { status: 400 });
    }

    await mkdir(IMAGES_DIR, { recursive: true });

    const padded = String(num).padStart(2, "0");
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const fileName = kind === "essay" ? `q_s${padded}.${ext}` : `q${padded}.${ext}`;
    const filePath = path.join(IMAGES_DIR, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    return NextResponse.json({
      number: num,
      path: `inputs/시험지 제작/question_images/${fileName}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Replace failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST is deprecated — use /api/create/start for atomic reset+image+meta transaction.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: "POST /api/question-images is deprecated. Use POST /api/create/start instead." },
    { status: 410 }
  );
}
