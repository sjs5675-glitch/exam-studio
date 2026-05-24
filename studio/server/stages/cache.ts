import { mkdir, access } from "fs/promises";
import path from "path";

export interface StageCachePaths {
  examDir: string;
  cacheDir: string;
  questionImagesDir: string;
  cleanedImagesDir: string;
  examData: string;
  figureStatus: string;
  cleaningStatus: string;
  buildStatus: string;
}

/** Per-question disk cache presence for resume/skip decisions. */
export interface QuestionCacheState {
  extracted: boolean;
  solved: boolean;
  verified: boolean;
}

export interface StageCache {
  readonly paths: StageCachePaths;
  questionImagePath(questionNumber: number): string;
  cleanedImagePath(questionNumber: number): string;
  questionJsonPath(questionNumber: number): string;
  extractorResultPath(questionNumber: number): string;
  solverResultPath(questionNumber: number): string;
  verifierResultPath(questionNumber: number): string;
  /** Returns the path to the combined exam_data.json output. */
  examDataPath(): string;
  ensureCacheDir(): Promise<void>;
  ensureQuestionImagesDir(): Promise<void>;
  /** Scan disk presence of extracted/solved/verified cache files for a question. */
  scanQuestionState(questionNumber: number): Promise<QuestionCacheState>;
  /** Scan all questions and return a Map from question number to cache state. */
  scanAll(numbers: number[]): Promise<Map<number, QuestionCacheState>>;
}

export function createStageCache(baseDir: string, examDir = path.join(baseDir, "inputs", "시험지 제작")): StageCache {
  return new FileBackedStageCache(examDir);
}

export class FileBackedStageCache implements StageCache {
  readonly paths: StageCachePaths;

  constructor(examDir: string) {
    const cacheDir = path.join(examDir, ".v3cache");
    const questionImagesDir = path.join(examDir, "question_images");
    this.paths = {
      examDir,
      cacheDir,
      questionImagesDir,
      cleanedImagesDir: path.join(questionImagesDir, "cleaned"),
      examData: path.join(cacheDir, "exam_data.json"),
      figureStatus: path.join(cacheDir, "figure_status.json"),
      cleaningStatus: path.join(cacheDir, "cleaning_status.json"),
      buildStatus: path.join(cacheDir, "build_status.json"),
    };
  }

  private pad(n: number): string {
    return String(n).padStart(2, "0");
  }

  questionImagePath(questionNumber: number): string {
    return path.join(this.paths.questionImagesDir, `q${this.pad(questionNumber)}.png`);
  }

  cleanedImagePath(questionNumber: number): string {
    return path.join(this.paths.cleanedImagesDir, `q${this.pad(questionNumber)}.png`);
  }

  questionJsonPath(questionNumber: number): string {
    return path.join(this.paths.cacheDir, `q${this.pad(questionNumber)}.json`);
  }

  extractorResultPath(questionNumber: number): string {
    return path.join(this.paths.cacheDir, `q${this.pad(questionNumber)}_extracted.json`);
  }

  solverResultPath(questionNumber: number): string {
    return path.join(this.paths.cacheDir, `q${this.pad(questionNumber)}_solved.json`);
  }

  verifierResultPath(questionNumber: number): string {
    return path.join(this.paths.cacheDir, `q${this.pad(questionNumber)}_verified.json`);
  }

  examDataPath(): string {
    return this.paths.examData;
  }

  async ensureCacheDir(): Promise<void> {
    await mkdir(this.paths.cacheDir, { recursive: true });
  }

  async ensureQuestionImagesDir(): Promise<void> {
    await mkdir(this.paths.questionImagesDir, { recursive: true });
  }

  async scanQuestionState(questionNumber: number): Promise<QuestionCacheState> {
    const [extracted, solved, verified] = await Promise.all([
      fileExists(this.extractorResultPath(questionNumber)),
      fileExists(this.solverResultPath(questionNumber)),
      fileExists(this.verifierResultPath(questionNumber)),
    ]);
    return { extracted, solved, verified };
  }

  async scanAll(numbers: number[]): Promise<Map<number, QuestionCacheState>> {
    const entries = await Promise.all(
      numbers.map(async (n) => [n, await this.scanQuestionState(n)] as const)
    );
    return new Map(entries);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
