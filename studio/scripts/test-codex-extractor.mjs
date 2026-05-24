#!/usr/bin/env node
// codex CLI 추출 스모크 테스트
//
// 사용법:
//   node studio/scripts/test-codex-extractor.mjs [image-path]
//
// 환경 변수:
//   CODEX_IDLE_TIMEOUT_MS  (default 60000 — 스모크 테스트는 짧게)
//
// 목적: orchestrator/extractor 우회하고 codex CLI가 이미지를 받아 JSON을 반환하는지 단독 검증.
// 출력: 실시간 stderr + stdout 라인, 마지막에 exit code.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const imagePath = resolve(
  process.argv[2] ??
    "inputs/시험지 제작/question_images/q01.png"
);

if (!existsSync(imagePath)) {
  console.error(`[smoke] 이미지 없음: ${imagePath}`);
  process.exit(2);
}

const prompt = [
  "다음 이미지에는 수학 문제 1개가 들어있습니다.",
  "아래 JSON 스키마로만 응답하세요(추가 텍스트 금지):",
  '{"question":"...","answer":1,"has_figure":false,"figure_info":null}',
].join("\n");

const args = [
  "exec",
  "--json",
  "--cd",
  process.cwd(),
  "--sandbox",
  "danger-full-access",
  "--image",
  imagePath,
  "--",
  prompt,
];

console.error(`[smoke] codex ${args.slice(0, -1).join(" ")} <PROMPT len=${prompt.length}>`);
const proc = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });

const TIMEOUT_MS = Number(process.env.CODEX_IDLE_TIMEOUT_MS ?? 60000);
let lastActivity = Date.now();
const timer = setInterval(() => {
  if (Date.now() - lastActivity > TIMEOUT_MS) {
    console.error(`[smoke] idle ${TIMEOUT_MS}ms — killing`);
    try { proc.kill("SIGTERM"); } catch {}
  }
}, 5000);
timer.unref();

proc.stdout.on("data", (b) => {
  lastActivity = Date.now();
  process.stdout.write(`[stdout] ${b}`);
});
proc.stderr.on("data", (b) => {
  lastActivity = Date.now();
  process.stderr.write(`[stderr] ${b}`);
});

proc.on("close", (code) => {
  clearInterval(timer);
  console.error(`\n[smoke] exit code = ${code}`);
  process.exit(code === 0 ? 0 : 1);
});
