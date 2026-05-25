/**
 * Standalone SSE server for Claude CLI streaming.
 * Runs on a separate port to bypass Next.js response buffering.
 *
 * Usage: pnpm tsx server/sse.ts
 */
import http from "http";
import { readdir, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Import from relative paths (tsx doesn't support @/ alias)
import type { ExamMetaInput } from "../lib/exam/meta";
import { transformToSSE, type SSEEvent } from "../lib/claude";
import {
  normalizeProviderId,
  resolveProviderId,
  runAIProvider,
  MAX_PROVIDER_ATTEMPTS,
  createProviderAttemptLog,
  createProviderRetryLog,
  createProviderTelemetryEntry,
  shouldRetryProviderAttempt,
  type AIProviderId,
  type AIStageKey,
} from "../lib/ai";
import { readRuntimeEnv } from "../lib/server/runtimeEnv";
import { normalizeStageOverrides, normalizeStageSkip, isImageProviderId, type ImageProviderId, type StageOverrideMap, type StageSkipMap } from "../lib/ai/settings";
import type { ProviderTelemetryEntry } from "../lib/ai/retry";
import { buildCropPrompt } from "../lib/prompts";
import { createJobStore } from "./stages/jobStore";
import { runStageOrchestrator } from "./stages/orchestrator";

// ---------------------------------------------------------------------------
// runCropJob — inline helper for crop mode (no HWPX output, no stage model)
// ---------------------------------------------------------------------------
async function runCropJob({
  prompt,
  requestedProvider,
  jobId,
  send,
  isClientDisconnected,
  setActiveProviderProcess,
  activeProcesses,
}: {
  prompt: string;
  requestedProvider: AIProviderId;
  jobId: string;
  send: (e: SSEEvent) => void;
  isClientDisconnected: () => boolean;
  setActiveProviderProcess: (p: ChildProcess | null) => void;
  activeProcesses: Set<ChildProcess>;
}): Promise<{ status: "done" | "failed" | "cancelled"; resultSummary?: string; providerTelemetry: ProviderTelemetryEntry[] }> {
  const currentStage = { name: "" };
  let resultSummary = "";
  let finalStatus: "done" | "failed" | "cancelled" = "done";
  let hadResultEvent = false;
  const providerTelemetry: ProviderTelemetryEntry[] = [];

  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = Date.now();
    let providerFailed = false;
    let attemptErrorSummary = "";

    send({
      event: "log",
      data: {
        stage: "system",
        message: createProviderAttemptLog(requestedProvider as Exclude<AIProviderId, "auto">, attempt),
        timestamp: new Date().toISOString(),
        level: "info",
      },
    });

    const { process: proc, events, exitCode, metadata } = runAIProvider(prompt, {
      provider: requestedProvider,
      cwd: BASE_DIR,
      env: readRuntimeEnv(),
      maxTurns: 30,
      mode: "crop",
      jobId,
      stageKey: undefined,
    });

    setActiveProviderProcess(proc);
    activeProcesses.add(proc);
    proc.on("close", () => {
      activeProcesses.delete(proc);
      setActiveProviderProcess(null);
    });

    send({
      event: "log",
      data: {
        stage: "system",
        message: proc.pid !== undefined
          ? `CLI 프로세스 시작됨 (PID: ${proc.pid}). API 연결 대기중...`
          : `${metadata.label} 호출 시작. API 연결 대기중...`,
        timestamp: new Date().toISOString(),
        level: "info",
      },
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) {
        send({
          event: "log",
          data: {
            stage: "system",
            message: `[stderr] ${msg.slice(0, 300)}`,
            timestamp: new Date().toISOString(),
            level: "warn",
          },
        });
      }
    });

    for await (const event of events) {
      const sseEvents = transformToSSE(event, currentStage);
      for (const sse of sseEvents) {
        if (sse.event === "result") {
          hadResultEvent = true;
          resultSummary = (sse.data.result as string) ?? "";
          finalStatus = sse.data.status === "success" ? "done" : "failed";
          providerFailed = sse.data.status !== "success";
          if (providerFailed) attemptErrorSummary = resultSummary.slice(0, 300);
        }
        if (sse.event === "error") {
          finalStatus = "failed";
          providerFailed = true;
          attemptErrorSummary = ((sse.data.message as string) ?? "Provider error").slice(0, 300);
        }
        send(sse);
      }
    }

    const code = await exitCode;
    if (code !== 0) {
      finalStatus = "failed";
      if (!attemptErrorSummary) attemptErrorSummary = `${metadata.label} exited with code ${code}`;
    }

    const clientDisconnected = isClientDisconnected();
    const retry = shouldRetryProviderAttempt({ attempt, exitCode: code, providerFailed, aborted: clientDisconnected });
    providerTelemetry.push(createProviderTelemetryEntry({
      stageKey: undefined,
      requestedProvider: metadata.requestedProvider,
      resolvedProvider: metadata.provider,
      attempt,
      status: clientDisconnected ? "cancelled" : providerFailed || code !== 0 ? "failed" : "success",
      elapsedMs: Date.now() - attemptStartedAt,
      retry,
      errorSummary: attemptErrorSummary || undefined,
      externalCostUsd: metadata.externalCostUsd,
    }));

    if (!retry) {
      if (code !== 0 && !currentStage.name) {
        send({ event: "error", data: { message: `${metadata.label} exited with code ${code}` } });
        finalStatus = "failed";
      }
      break;
    }

    send({
      event: "log",
      data: {
        stage: "system",
        message: createProviderRetryLog(metadata.provider, attempt),
        timestamp: new Date().toISOString(),
        level: "warn",
      },
    });
  }

  if (!hadResultEvent && isClientDisconnected()) {
    finalStatus = "cancelled";
  }

  return {
    status: finalStatus,
    resultSummary: resultSummary || undefined,
    providerTelemetry,
  };
}

// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.SSE_PORT ?? "3021", 10);
const __server_file = fileURLToPath(import.meta.url);
const __server_dir = path.dirname(__server_file);
const BASE_DIR = path.resolve(__server_dir, "../..");
const DATA_DIR = path.join(__server_dir, "../data/jobs");
const jobStore = createJobStore(DATA_DIR);
const HWPX_TEMPLATE = process.env.HWPX_TEMPLATE_PATH ?? "";

// 실행 중인 Claude CLI 프로세스 추적
import type { ChildProcess } from "child_process";
const activeProcesses = new Set<ChildProcess>();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("Request handler error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
});

// 서버 종료 시 모든 Claude CLI 프로세스 + Next.js 서버도 kill
import { execSync } from "child_process";
import os from "os";

function shutdown() {
  console.log(`\nShutting down... killing ${activeProcesses.size} active process(es)`);
  for (const proc of activeProcesses) {
    try { proc.kill("SIGTERM"); } catch { /* already dead */ }
  }

  // Next.js dev 서버도 종료 (포트 3020)
  try {
    if (os.platform() === "win32") {
      execSync('for /f "tokens=5" %a in (\'netstat -ano ^| findstr ":3020" ^| findstr "LISTENING"\') do taskkill /pid %a /f', { stdio: "ignore", shell: "cmd.exe" });
    } else {
      execSync("lsof -ti:3020 | xargs -r kill", { stdio: "ignore" });
    }
  } catch { /* ignore */ }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// --- Heartbeat: 브라우저 연결 감시 ---
// 브라우저가 10초마다 heartbeat를 보냄.
// 서버는 단순 대기 중에는 종료하지 않음 (start.bat의 "아무 키나 누르세요"로 수동 종료).
// heartbeat는 브라우저 연결 상태 확인용으로만 사용.
let lastHeartbeat = Date.now();
let browserConnected = false;

setInterval(() => {
  const elapsed = Date.now() - lastHeartbeat;
  const wasConnected = browserConnected;
  browserConnected = elapsed < 60_000;
  if (wasConnected && !browserConnected) {
    console.log(`Browser disconnected (no heartbeat for ${Math.round(elapsed / 1000)}s). Server continues running.`);
  }
}, 10_000);

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // CORS for Next.js dev server
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Heartbeat — 브라우저가 살아있는지 확인
  if (req.method === "GET" && req.url === "/api/heartbeat") {
    lastHeartbeat = Date.now();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/run") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // Parse request body (use event-based reading, not for-await)
  const rawBody = await new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
  });

  let body: {
    mode: string;
    files: { pdf: string; hwpx?: string; questionImages?: number[] };
    meta?: ExamMetaInput & { resumeFrom?: string; questionCount?: number };
    jobId: string;
    provider?: AIProviderId;
    stageOverrides?: Partial<Record<AIStageKey, AIProviderId>>;
    imageProvider?: ImageProviderId;
    figureRegen?: boolean;
    imageCleaningEnabled?: boolean;
    checkerMaxAttempts?: number;
    verifierMaxAttempts?: number;
    stageSkip?: Partial<Record<string, boolean>>;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const { mode, files, meta, jobId } = body;
  let requestedProvider: AIProviderId;
  let resolvedProvider: Exclude<AIProviderId, "auto">;
  let stageOverrides: StageOverrideMap;
  let stageSkip: StageSkipMap;
  const imageProvider = isImageProviderId(body.imageProvider) ? body.imageProvider : "gemini";
  let primaryStageKey: AIStageKey | undefined;
  try {
    requestedProvider = normalizeProviderId(body.provider);
    stageOverrides = normalizeStageOverrides(body.stageOverrides);
    stageSkip = normalizeStageSkip(body.stageSkip);
    primaryStageKey = inferPrimaryStageKey(body.mode, body.meta?.resumeFrom);
    const stageRequestedProvider = primaryStageKey ? stageOverrides[primaryStageKey] : undefined;
    requestedProvider = normalizeProviderId(stageRequestedProvider ?? requestedProvider);
    resolvedProvider = resolveProviderId(requestedProvider);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Invalid AI provider" }));
    return;
  }

  if (!mode || !jobId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing required fields: mode, jobId" }));
    return;
  }

  if (mode !== "create" && mode !== "resume" && mode !== "crop" && !files?.pdf) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing required fields: pdf" }));
    return;
  }

  if (mode === "create" && (!files?.questionImages || files.questionImages.length === 0)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "제작 모드에는 문제 이미지가 필요합니다." }));
    return;
  }

  if (mode === "resume" && !meta?.resumeFrom) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "resume 모드에는 resumeFrom이 필요합니다." }));
    return;
  }

  if (mode === "crop" && !files?.pdf) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "크롭 모드에는 PDF 파일이 필요합니다." }));
    return;
  }

  const resolvedFiles = {
    pdf: files?.pdf || "",
    hwpx: files?.hwpx ?? HWPX_TEMPLATE,
  };

  // 상대경로는 cwd(BASE_DIR) 기준이므로 절대경로로 변환
  const toAbs = (p: string) => (!p ? "" : path.isAbsolute(p) ? p : path.join(BASE_DIR, p));
  const absFiles = {
    pdf: toAbs(resolvedFiles.pdf),
    hwpx: toAbs(resolvedFiles.hwpx),
  };

  // 문제별 이미지 경로 생성. resume 모드에서 클라이언트가 questionImages를 안 보낼 때
  // (재개/재시도 버튼 등) question_images 디렉터리를 스캔해 보강한다.
  let questionNums: number[] = files?.questionImages ?? [];
  if (questionNums.length === 0 && (mode === "resume" || mode === "create")) {
    const dir = path.join(BASE_DIR, "inputs", "시험지 제작", "question_images");
    try {
      const entries = await readdir(dir);
      questionNums = entries
        .map((f) => /^q(\d+)\.png$/.exec(f))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => parseInt(m[1], 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
    } catch { /* dir missing → questionNums stays [] */ }
  }
  const questionImagePaths = questionNums.map((num: number) => {
    const padded = String(num).padStart(2, "0");
    return {
      number: num,
      path: toAbs(path.join("inputs", "시험지 제작", "question_images", `q${padded}.png`)),
    };
  });

  let prompt: string = "";
  if (mode === "crop") {
    const cropOutDir = toAbs(path.join(BASE_DIR, "inputs", "시험지 제작", "question_images"));
    prompt = buildCropPrompt(absFiles.pdf, cropOutDir);
  }

  // Save initial job data
  const jobData = {
    id: jobId,
    mode,
    requestedProvider,
    provider: resolvedProvider,
    stageOverrides,
    imageProvider,
    figureRegen: body.figureRegen,
    imageCleaningEnabled: body.imageCleaningEnabled,
    checkerMaxAttempts: body.checkerMaxAttempts ?? 2,
    verifierMaxAttempts: body.verifierMaxAttempts ?? 3,
    status: "running",
    inputFiles: [resolvedFiles.pdf, resolvedFiles.hwpx].filter(Boolean),
    meta: meta ?? {},
    stages: [],
    logs: [],
    startedAt: new Date().toISOString(),
  };
  await jobStore.write(jobData);

  // SSE headers — sent immediately, no buffering
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Flush headers right away
  res.flushHeaders();

  const send = (sseEvent: SSEEvent) => {
    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify(sseEvent)}\n\n`);
    }
  };

  send({ event: "log", data: { stage: "system", message: "CLI 프로세스를 시작합니다...", timestamp: new Date().toISOString(), level: "info" } });

  // Kill on client disconnect (중단/일시정지 버튼 또는 브라우저 닫기)
  let clientDisconnected = false;
  let activeProviderProcess: ChildProcess | null = null;
  const setActiveProviderProcess = (proc: ChildProcess | null) => { activeProviderProcess = proc; };
  const disconnectAbort = new AbortController();
  req.on("close", () => {
    clientDisconnected = true;
    disconnectAbort.abort();
    try { activeProviderProcess?.kill("SIGTERM"); } catch { /* already dead */ }
  });

  let outputFile = "";
  let resultSummary = "";
  let finalStatus: "done" | "failed" | "cancelled" = "done";
  let providerTelemetry: ProviderTelemetryEntry[] = [];

  try {
    if (mode === "crop") {
      // crop 전용 인라인 헬퍼 — orchestrator 에 의존하지 않음
      const cropResult = await runCropJob({
        prompt,
        requestedProvider,
        jobId,
        send,
        isClientDisconnected: () => clientDisconnected,
        setActiveProviderProcess,
        activeProcesses,
      });
      finalStatus = cropResult.status;
      resultSummary = cropResult.resultSummary ?? "";
      providerTelemetry = cropResult.providerTelemetry;
    } else {
      // create / resume — 모두 orchestrator 로 통합
      // create 모드는 figure 단계 직후 멈춰 사용자의 그림 확인을 기다린다.
      // 확인 CTA → /api/run/[jobId]/followup `resume --from=builder` 로 builder+checker 이어 실행.
      const orchResult = await runStageOrchestrator({
        mode: mode as "create" | "resume",
        resumeFrom: meta?.resumeFrom,
        meta: meta ?? {},
        questionImages: questionImagePaths,
        stageOverrides,
        stageSkip,
        imageProvider,
        figureRegen: body.figureRegen,
        imageCleaningEnabled: body.imageCleaningEnabled,
        checkerMaxAttempts: body.checkerMaxAttempts,
        verifierMaxAttempts: body.verifierMaxAttempts,
        stopAfterStage: mode === "create" ? "figure" : undefined,
        defaultProvider: requestedProvider,
        baseDir: BASE_DIR,
        send,
        isAborted: () => clientDisconnected,
        externalSignal: disconnectAbort.signal,
      });
      outputFile = orchResult.outputFile ?? "";
      resultSummary = orchResult.resultSummary ?? "";
      finalStatus = orchResult.status;
      providerTelemetry = orchResult.providerTelemetry;
    }
  } catch (err) {
    send({
      event: "error",
      data: { message: err instanceof Error ? err.message : "Unknown error" },
    });
    finalStatus = "failed";
  } finally {
    // outputFile이 없으면 폴백: outputs/ 폴더에서 최신 .hwpx 스캔
    if (!outputFile && mode === "create") {
      try {
        const outputsDir = path.join(BASE_DIR, "outputs");
        const dirFiles = await readdir(outputsDir);
        const hwpxFiles = dirFiles.filter((f) => f.endsWith(".hwpx"));
        if (hwpxFiles.length > 0) {
          let latest = { name: "", mtime: 0 };
          for (const f of hwpxFiles) {
            const s = await stat(path.join(outputsDir, f));
            if (s.mtimeMs > latest.mtime) {
              latest = { name: f, mtime: s.mtimeMs };
            }
          }
          const jobStart = new Date(jobData.startedAt).getTime();
          if (latest.mtime > jobStart) {
            outputFile = `outputs/${latest.name}`;
          }
        }
      } catch { /* 폴더가 없을 수 있음 */ }
    }

    // outputFile 경로를 상대경로로 정규화
    if (outputFile) {
      // 절대경로면 BASE_DIR 기준 상대경로로 변환
      if (path.isAbsolute(outputFile)) {
        outputFile = path.relative(BASE_DIR, outputFile);
      }
      send({ event: "file", data: { type: "hwpx", name: path.basename(outputFile), path: outputFile } });
    }

    try {
      await jobStore.write({
        ...jobData,
        requestedProvider,
        provider: resolvedProvider,
        imageProvider,
        providerTelemetry,
        status: finalStatus,
        finishedAt: new Date().toISOString(),
        outputFile: outputFile || undefined,
        resultSummary: resultSummary || undefined,
      });
    } catch { /* ignore */ }
    res.end();
  }
}

server.listen(PORT, () => {
  console.log(`SSE server listening on http://localhost:${PORT}`);
});

function inferPrimaryStageKey(mode: string, resumeFrom?: string): AIStageKey | undefined {
  if (mode === "create") return "create.extractor";
  if (mode === "resume") {
    if (resumeFrom === "verifier") return "create.verifier";
    if (resumeFrom === "solver") return "create.solver";
    return "create.extractor";
  }
  return undefined;
}
