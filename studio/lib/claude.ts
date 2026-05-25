import { spawn, type ChildProcess } from "child_process";
import path from "path";

// --- Types ---

export interface ClaudeEvent {
  type: "system" | "assistant" | "result";
  subtype?: string;
  message?: {
    role: string;
    content: ContentBlock[];
  };
  result?: string;
  session_id?: string;
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface SSEEvent {
  event: "stage" | "log" | "progress" | "file" | "question" | "result" | "error" | "extraction_review";
  data: Record<string, unknown>;
}

// --- [EXTRACTION_REVIEW] block parser ---
// Claude가 V3 Step 3.5에서 출력하는 블록 형식:
//   [EXTRACTION_REVIEW]
//   total: N
//   ---
//   [Q1]
//   key: value
//   parts: [{"t":"..."}, {"eq":"..."}]
//   ...
//   ---
//   [Q2]
//   ...
//   [/EXTRACTION_REVIEW]

const REVIEW_BLOCK_RE = /\[EXTRACTION_REVIEW\]([\s\S]*?)\[\/EXTRACTION_REVIEW\]/g;

function parseReviewBlock(blockBody: string): { number: number; data: Record<string, unknown> }[] {
  const out: { number: number; data: Record<string, unknown> }[] = [];
  // 각 [QN] 섹션 분리
  const sections = blockBody.split(/^---\s*$/m);
  for (const sec of sections) {
    const qMatch = sec.match(/^\s*\[Q(\d+)\]\s*\n([\s\S]*)/);
    if (!qMatch) continue;
    const qNum = parseInt(qMatch[1], 10);
    const body = qMatch[2];
    const data: Record<string, unknown> = {};
    for (const line of body.split("\n")) {
      const m = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
      if (!m) continue;
      const key = m[1];
      const raw = m[2].trim();
      // JSON 값 시도 (배열, 객체, true/false/null/숫자)
      if (raw.startsWith("[") || raw.startsWith("{") || raw === "true" || raw === "false" || raw === "null" || /^-?\d/.test(raw)) {
        try {
          data[key] = JSON.parse(raw);
          continue;
        } catch { /* fall through to string */ }
      }
      data[key] = raw;
    }
    out.push({ number: qNum, data });
  }
  return out;
}

export function extractReviewEvents(text: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  let m: RegExpExecArray | null;
  REVIEW_BLOCK_RE.lastIndex = 0;
  while ((m = REVIEW_BLOCK_RE.exec(text)) !== null) {
    const items = parseReviewBlock(m[1]);
    if (items.length > 0) {
      events.push({
        event: "extraction_review",
        data: { items },
      });
    }
  }
  return events;
}

// --- Stage Detection ---

// 텍스트 기반 스테이지 감지 — 에이전트 이름 패턴 우선, 일반 키워드는 폴백
const stagePatterns: { name: string; patterns: RegExp[] }[] = [
  // 에이전트 이름 매칭 (가장 정확)
  { name: "extractor", patterns: [/exam-extractor/i, /extractor\s*(에이전트|agent)/i] },
  { name: "solver",    patterns: [/exam-solver/i, /solver\s*(에이전트|agent)/i] },
  { name: "verifier",  patterns: [/exam-verifier/i, /verifier\s*(에이전트|agent)/i] },
  { name: "figure",    patterns: [/exam-figure/i, /figure\s*(에이전트|agent)/i] },
  { name: "builder",   patterns: [/exam-builder/i, /builder\s*(에이전트|agent)/i] },
  { name: "checker",   patterns: [/exam-checker/i, /checker\s*(에이전트|agent)/i] },
];

// 일반 키워드 폴백 (에이전트 이름이 없을 때만)
const stageFallbackPatterns: { name: string; patterns: RegExp[] }[] = [
  { name: "cropper",   patterns: [/크롭/i, /crop.*완료/i, /페이지.*변환/i] },
  { name: "extractor", patterns: [/문제.*추출/i, /이미지.*추출/i, /extracted\.json/i] },
  { name: "solver",    patterns: [/해설.*생성/i, /해설.*보완/i, /풀이.*생성/i] },
  { name: "verifier",  patterns: [/해설.*검증/i, /검증.*결과/i, /exam-verifier/i] },
  { name: "figure",    patterns: [/그림.*처리/i, /crop/i, /nano-banana/i, /워터마크/i] },
  { name: "builder",   patterns: [/HWPX.*조립/i, /section0.*xml/i] },
  { name: "checker",   patterns: [/품질.*검수/i, /체크리스트.*검증/i] },
];

export function detectStage(text: string): string | null {
  // 1순위: 에이전트 이름 매칭
  for (const { name, patterns } of stagePatterns) {
    if (patterns.some((p) => p.test(text))) return name;
  }
  // 2순위: 일반 키워드 (더 엄격한 패턴)
  for (const { name, patterns } of stageFallbackPatterns) {
    if (patterns.some((p) => p.test(text))) return name;
  }
  return null;
}

// Agent subagent_type → stage 매핑
const agentTypeToStage: Record<string, string> = {
  "exam-extractor":  "extractor",
  "exam-solver":     "solver",
  "exam-verifier":   "verifier",
  "exam-figure":     "figure",
  "exam-builder":    "builder",
  "exam-checker":    "checker",
};

export function detectStageFromTool(toolName: string, input?: Record<string, unknown>): string | null {
  const filePath = (input?.file_path ?? input?.command ?? "") as string;

  if (toolName === "Read" && /\.pdf/i.test(filePath)) return "extractor";
  if (toolName === "Write" && /_extracted\.json/i.test(filePath)) return "extractor";
  if (toolName === "Agent") {
    // 1순위: subagent_type으로 정확히 매칭
    const subType = (input?.subagent_type ?? "") as string;
    if (agentTypeToStage[subType]) return agentTypeToStage[subType];

    // 2순위: description에서 에이전트 이름 매칭
    const desc = (input?.description ?? "") as string;
    for (const [agentName, stage] of Object.entries(agentTypeToStage)) {
      const shortName = agentName.replace("exam-", "");
      if (desc.toLowerCase().includes(shortName)) return stage;
    }

    // 3순위: prompt에서 에이전트 이름 패턴 매칭 (폴백)
    const prompt = (input?.prompt ?? "") as string;
    for (const [agentName, stage] of Object.entries(agentTypeToStage)) {
      if (prompt.includes(agentName)) return stage;
    }
  }
  if (toolName === "Skill") {
    const skillName = (input?.skill ?? "") as string;
    if (skillName === "exam-create") return "extractor"; // 오케스트레이터 시작 = extractor 시작
    if (skillName === "exam-crop") return "cropper"; // 크롭 스킬 시작
    if (skillName === "nano-banana") return "figure";
  }
  if (toolName === "Write" && /\.hwpx|section0|content\.hpf/i.test(filePath)) return "builder";
  return null;
}

// --- Claude CLI Runner ---

export function runClaude(
  prompt: string,
  options?: { maxTurns?: number; cwd?: string; env?: Record<string, string | undefined>; allowedTools?: string[] }
): { process: ChildProcess; events: AsyncIterable<ClaudeEvent>; exitCode: Promise<number> } {
  const claudeArgs = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns", String(options?.maxTurns ?? 100),
  ];

  // --allowed-tools: restrict which tools the CLI agent may call (e.g. ["Read"] for extractor sandbox)
  if (options?.allowedTools && options.allowedTools.length > 0) {
    claudeArgs.push("--allowed-tools", options.allowedTools.join(","));
  }

  const cwd = options?.cwd ?? process.cwd();
  const env = options?.env ? { ...process.env, ...options.env } : process.env;

  const proc = spawn("claude", claudeArgs, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const exitCode = new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 1));
  });

  const stderrChunks: string[] = [];
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString());
  });

  const events = parseStreamJson(proc, stderrChunks);
  return { process: proc, events, exitCode };
}

async function* parseStreamJson(proc: ChildProcess, stderrChunks: string[]): AsyncIterable<ClaudeEvent> {
  let buffer = "";

  for await (const chunk of proc.stdout!) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          yield JSON.parse(line);
        } catch {
          // non-JSON lines ignored
        }
      }
    }
  }

  if (stderrChunks.length > 0) {
    const stderr = stderrChunks.join("").trim();
    if (stderr) {
      yield {
        type: "result",
        subtype: "error",
        result: `CLI error: ${stderr.slice(0, 500)}`,
      } as ClaudeEvent;
    }
  }
}

// --- Stream-to-SSE Transformer ---

export function transformToSSE(event: ClaudeEvent, currentStage: { name: string }): SSEEvent[] {
  const results: SSEEvent[] = [];

  if (event.type === "system" && event.subtype === "init") {
    results.push({
      event: "log",
      data: {
        stage: "system",
        message: `Claude CLI 시작됨 (model: ${(event as unknown as Record<string, unknown>).model ?? "unknown"})`,
        timestamp: new Date().toISOString(),
        level: "info",
      },
    });
    return results;
  }

  if (event.type === "assistant" && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === "text" && block.text) {
        // V3 Step 3.5: [EXTRACTION_REVIEW] 블록 감지
        const reviewEvents = extractReviewEvents(block.text);
        if (reviewEvents.length > 0) {
          if (currentStage.name && currentStage.name !== "review_extract") {
            results.push({ event: "stage", data: { name: currentStage.name, status: "done" } });
          }
          currentStage.name = "review_extract";
          results.push({ event: "stage", data: { name: "review_extract", status: "running" } });
          results.push(...reviewEvents);
        }

        const detected = detectStage(block.text);
        if (detected && detected !== currentStage.name) {
          if (currentStage.name) {
            results.push({ event: "stage", data: { name: currentStage.name, status: "done" } });
          }
          currentStage.name = detected;
          results.push({ event: "stage", data: { name: detected, status: "running" } });
        }
        results.push({
          event: "log",
          data: {
            stage: currentStage.name || "system",
            message: block.text.slice(0, 200),
            timestamp: new Date().toISOString(),
            level: "info",
          },
        });
      }

      if (block.type === "tool_use" && block.name) {
        const detected = detectStageFromTool(block.name, block.input);
        if (detected && detected !== currentStage.name) {
          if (currentStage.name) {
            results.push({ event: "stage", data: { name: currentStage.name, status: "done" } });
          }
          currentStage.name = detected;
          results.push({ event: "stage", data: { name: detected, status: "running" } });
        }
        results.push({
          event: "log",
          data: {
            stage: currentStage.name || "system",
            message: `[${block.name}] ${summarizeToolInput(block.name, block.input)}`,
            timestamp: new Date().toISOString(),
            level: "info",
          },
        });

        if (block.name === "Write" && block.input?.file_path) {
          const fp = block.input.file_path as string;
          if (/\.(png|jpg|jpeg|bmp)$/i.test(fp)) {
            results.push({ event: "file", data: { type: "image", name: fp.split("/").pop(), path: fp } });
          } else if (/\.json$/i.test(fp)) {
            results.push({ event: "file", data: { type: "json", name: fp.split("/").pop(), path: fp } });
            // V3 문제별 JSON 감지 → question 이벤트 발행
            const qMatch = fp.match(/q(\d+)_(extracted|solved|verified)\.json$/);
            if (qMatch && block.input.content) {
              results.push({
                event: "question",
                data: {
                  number: parseInt(qMatch[1]),
                  phase: qMatch[2], // "extracted" | "solved" | "verified"
                  content: String(block.input.content).slice(0, 5000),
                },
              });
            }
          } else if (/\.hwpx$/i.test(fp)) {
            results.push({ event: "file", data: { type: "hwpx", name: fp.split("/").pop(), path: fp } });
          }
        }

        // Bash로 zip/cp/mv 등으로 .hwpx 생성하는 경우도 감지
        if (block.name === "Bash" && block.input?.command) {
          const cmd = block.input.command as string;
          const hwpxMatch = cmd.match(/(?:zip|cp|mv)\s+.*?([\w/.-]+\.hwpx)/i);
          if (hwpxMatch) {
            results.push({ event: "file", data: { type: "hwpx", name: hwpxMatch[1].split("/").pop(), path: hwpxMatch[1] } });
          }
        }
      }
    }
  }

  if (event.type === "result") {
    if (currentStage.name) {
      results.push({ event: "stage", data: { name: currentStage.name, status: "done" } });
    }
    results.push({
      event: "result",
      data: {
        status: event.subtype === "success" ? "success" : "failed",
        result: event.result?.slice(0, 500),
      },
    });
  }

  return results;
}

function summarizeToolInput(name: string, input?: Record<string, unknown>): string {
  if (!input) return "";
  if (name === "Read" || name === "Write" || name === "Edit") {
    const fp = (input.file_path ?? "") as string;
    return path.basename(fp) || fp;
  }
  if (name === "Bash") {
    const cmd = (input.command ?? "") as string;
    return cmd.slice(0, 80);
  }
  if (name === "Agent") {
    const desc = (input.description ?? "") as string;
    return desc.slice(0, 60);
  }
  return "";
}
