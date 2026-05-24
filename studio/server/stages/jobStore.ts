import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";

export type JobStatus = "running" | "done" | "failed" | "cancelled" | string;

export type JsonObject = Record<string, unknown>;

export interface FileBackedJobData extends JsonObject {
  id: string;
  mode: string;
  status: JobStatus;
  inputFiles?: string[];
  stages?: unknown[];
  logs?: unknown[];
  startedAt?: string;
  finishedAt?: string;
  outputFile?: string;
  resultSummary?: string;
}

export type StageFileStoreErrorCode =
  | "invalid_job_id"
  | "read_failed"
  | "write_failed"
  | "parse_failed"
  | "list_failed";

export class StageFileStoreError extends Error {
  readonly code: StageFileStoreErrorCode;
  readonly filePath?: string;
  readonly cause?: unknown;

  constructor(code: StageFileStoreErrorCode, message: string, options?: { filePath?: string; cause?: unknown }) {
    super(message);
    this.name = "StageFileStoreError";
    this.code = code;
    this.filePath = options?.filePath;
    this.cause = options?.cause;
  }
}

export interface JobStore {
  readonly jobsDir: string;
  jobPath(jobId: string): string;
  read(jobId: string): Promise<FileBackedJobData>;
  write(job: FileBackedJobData): Promise<void>;
  update(jobId: string, patch: JsonObject): Promise<FileBackedJobData>;
  list(): Promise<FileBackedJobData[]>;
}

export class FileBackedJobStore implements JobStore {
  readonly jobsDir: string;

  constructor(jobsDir: string) {
    this.jobsDir = jobsDir;
  }

  jobPath(jobId: string): string {
    assertSafeJobId(jobId);
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  async read(jobId: string): Promise<FileBackedJobData> {
    const filePath = this.jobPath(jobId);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (cause) {
      throw new StageFileStoreError("read_failed", `Failed to read job file: ${jobId}`, { filePath, cause });
    }

    try {
      return JSON.parse(raw) as FileBackedJobData;
    } catch (cause) {
      throw new StageFileStoreError("parse_failed", `Failed to parse job file: ${jobId}`, { filePath, cause });
    }
  }

  async write(job: FileBackedJobData): Promise<void> {
    const filePath = this.jobPath(job.id);
    try {
      await mkdir(this.jobsDir, { recursive: true });
      await writeFile(filePath, JSON.stringify(job, null, 2));
    } catch (cause) {
      throw new StageFileStoreError("write_failed", `Failed to write job file: ${job.id}`, { filePath, cause });
    }
  }

  async update(jobId: string, patch: JsonObject): Promise<FileBackedJobData> {
    const current = await this.read(jobId);
    const next = { ...current, ...patch, id: current.id };
    await this.write(next);
    return next;
  }

  async list(): Promise<FileBackedJobData[]> {
    let files: string[];
    try {
      await mkdir(this.jobsDir, { recursive: true });
      files = await readdir(this.jobsDir);
    } catch (cause) {
      throw new StageFileStoreError("list_failed", "Failed to list job files", { filePath: this.jobsDir, cause });
    }

    const jobs: FileBackedJobData[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const jobId = file.slice(0, -".json".length);
      try {
        jobs.push(await this.read(jobId));
      } catch {
        // Preserve legacy tolerance: one bad job file should not hide the rest.
      }
    }
    return jobs;
  }
}

export function createJobStore(jobsDir: string): JobStore {
  return new FileBackedJobStore(jobsDir);
}

function assertSafeJobId(jobId: string): void {
  if (!jobId || jobId.includes("/") || jobId.includes("\\") || jobId.includes("..")) {
    throw new StageFileStoreError("invalid_job_id", `Invalid job id: ${jobId}`);
  }
}
