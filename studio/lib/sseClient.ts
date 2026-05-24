"use client";

/**
 * sseClient.ts — Phase 7
 *
 * 단일 SSE 이벤트 핸들러. 메인 run(`useJobRunner`)와 followup(`resume.ts`) 모두 이 함수를 사용.
 * 두 경로의 UI 갱신 정합이 단일 구현에서 보장된다.
 */

import { useJobStore } from "@/lib/store";
import type { SSEEvent } from "@/lib/claude";

export type Store = ReturnType<typeof useJobStore.getState>;

/**
 * SSE 이벤트 → store 적용.
 * 메인 run(`useJobRunner`)와 followup(`resume.ts`) 모두 동일한 이벤트 처리 보장.
 */
export function applySSEEvent(event: SSEEvent, store: Store): void {
  const data = event.data;

  switch (event.event) {
    case "stage": {
      const name = data.name as string;
      const status = data.status as string;
      if (status === "running") {
        store.updateStage(name, {
          status: "running",
          startedAt: new Date().toISOString(),
        });
      } else if (status === "done") {
        store.updateStage(name, {
          status: "done",
          finishedAt: new Date().toISOString(),
          summary: (data.summary as string) ?? undefined,
        });
      } else if (status === "failed") {
        store.updateStage(name, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          summary: (data.summary as string) ?? undefined,
        });
      } else if (status === "skipped") {
        store.updateStage(name, {
          status: "pending",
          summary: (data.summary as string) ?? undefined,
        });
      }
      break;
    }
    case "log": {
      store.addLog({
        timestamp: (data.timestamp as string) ?? new Date().toISOString(),
        stage: (data.stage as string) ?? "system",
        message: (data.message as string) ?? "",
        level: (data.level as "info" | "warn" | "error") ?? "info",
      });
      break;
    }
    case "progress": {
      const name = data.stage as string;
      const percent = data.percent as number;
      store.updateStage(name, { progress: percent });
      break;
    }
    case "file": {
      store.addIntermediateFile({
        type: (data.type as string) ?? "unknown",
        name: (data.name as string) ?? "",
        path: (data.path as string) ?? "",
      });
      break;
    }
    case "result": {
      const status = data.status as string;
      store.setResult({
        status,
        outputPath: data.outputPath as string | undefined,
        summary: data.result as string | undefined,
      });
      store.setStatus(status === "success" ? "done" : "failed");
      break;
    }
    case "question": {
      // 서버(orchestrator)는 { number, stage, status: "ok"|"failed", data } 로 emit.
      // 구버전은 { number, phase, content(JSON string) }. 둘 다 처리.
      const num = data.number as number;
      const stage = (data.stage as string | undefined) ?? (data.phase as string | undefined);
      const status = data.status as string | undefined;
      if (!num || !stage) break;
      if (status && status !== "ok") break; // failed면 store에 결과 미반영
      const payload = (data.data as unknown) ?? (data.content as unknown);
      if (payload == null) break;
      if (typeof payload === "string") {
        try {
          store.updateQuestionResult(num, stage, JSON.parse(payload));
        } catch {
          store.updateQuestionResult(num, stage, { _raw: payload });
        }
      } else {
        store.updateQuestionResult(num, stage, payload as Record<string, unknown>);
      }
      break;
    }
    case "extraction_review": {
      if (Array.isArray(data.items)) {
        // legacy 일괄
        const items = data.items as { number: number; data: Record<string, unknown> }[];
        for (const item of items) {
          store.updateQuestionResult(item.number, "extracted", item.data);
        }
      } else if (typeof data.number === "number" && data.data) {
        // incremental per-question (단일 {number, data} 형식)
        store.updateQuestionResult(
          data.number as number,
          "extracted",
          data.data as Record<string, unknown>
        );
      }
      store.setExtractionReviewActive(true);
      break;
    }
    case "error": {
      store.addLog({
        timestamp: new Date().toISOString(),
        stage: "system",
        message: (data.message as string) ?? "알 수 없는 오류",
        level: "error",
      });
      store.setStatus("failed");
      break;
    }
  }
}
