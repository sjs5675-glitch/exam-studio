import type { SSEEvent } from "../../lib/claude";
import type { WorkflowStageKey } from "./types";

export type StageEventStatus = "running" | "done" | "failed" | "skipped";
export type StageLogLevel = "info" | "warn" | "error";
export type StageResultStatus = "success" | "failed";

export interface StageEventFile {
  type: string;
  name: string;
  path: string;
}

export function stageEvent(name: WorkflowStageKey | string, status: StageEventStatus, extra?: Record<string, unknown>): SSEEvent {
  return {
    event: "stage",
    data: {
      name,
      status,
      ...extra,
    },
  };
}

export function logEvent(
  stage: WorkflowStageKey | string,
  message: string,
  level: StageLogLevel = "info",
  timestamp = new Date().toISOString()
): SSEEvent {
  return {
    event: "log",
    data: {
      stage,
      message,
      timestamp,
      level,
    },
  };
}

export function progressEvent(stage: WorkflowStageKey | string, percent: number, extra?: Record<string, unknown>): SSEEvent {
  return {
    event: "progress",
    data: {
      stage,
      percent: clampPercent(percent),
      ...extra,
    },
  };
}

export function fileEvent(file: StageEventFile): SSEEvent {
  return {
    event: "file",
    data: { ...file },
  };
}

export function resultEvent(status: StageResultStatus, result?: string, outputPath?: string): SSEEvent {
  return {
    event: "result",
    data: {
      status,
      result,
      outputPath,
    },
  };
}

export function errorEvent(message: string, stage: WorkflowStageKey | string = "system", extra?: Record<string, unknown>): SSEEvent {
  return {
    event: "error",
    data: {
      stage,
      message,
      ...extra,
    },
  };
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export type SendEvent = (event: SSEEvent) => void;

/**
 * Invariant: 모든 stage 전이(running/done/failed/skipped)는 stageEvent와
 * logEvent를 짝지어 emit한다. 한쪽만 보내면 StageCard와 LogStream의
 * 진실이 어긋나서 사용자가 "완료 메시지가 안 나옴"으로 체감한다.
 *
 * 헬퍼는 정상 케이스용. progress extra/stage extra가 필요한 특수 케이스는
 * 기존 primitives(stageEvent/logEvent/progressEvent)를 그대로 사용.
 */

export function emitStageStart(
  send: SendEvent,
  stage: WorkflowStageKey | string,
  message: string,
  startPercent = 5,
): void {
  send(stageEvent(stage, "running"));
  send(progressEvent(stage, startPercent));
  send(logEvent(stage, message, "info"));
}

export function emitStageDone(
  send: SendEvent,
  stage: WorkflowStageKey | string,
  opts: { summary: string; message?: string; level?: StageLogLevel },
): void {
  send(progressEvent(stage, 100));
  send(stageEvent(stage, "done", { summary: opts.summary }));
  send(logEvent(stage, opts.message ?? opts.summary, opts.level ?? "info"));
}

export function emitStageFailed(
  send: SendEvent,
  stage: WorkflowStageKey | string,
  opts: { summary: string; message?: string; level?: StageLogLevel },
): void {
  send(stageEvent(stage, "failed", { summary: opts.summary }));
  send(logEvent(stage, opts.message ?? opts.summary, opts.level ?? "error"));
}

export function emitStageSkipped(
  send: SendEvent,
  stage: WorkflowStageKey | string,
  opts: { summary?: string; message?: string },
): void {
  const summary = opts.summary ?? "캐시로 스킵";
  send(progressEvent(stage, 100));
  send(stageEvent(stage, "done", { summary }));
  if (opts.message) send(logEvent(stage, opts.message, "info"));
}
