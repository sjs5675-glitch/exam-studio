"use client";

import { useCallback, useRef } from "react";
import { useJobStore } from "./store";
import type { SSEEvent } from "./claude";
import type { AIProviderId } from "./ai";
import { readAISettings, type AISettings, type ImageProviderId } from "./ai/settings";
import { applySSEEvent } from "./sseClient";
import type { ExamMetaInput, FigureMode } from "@/lib/exam/meta";

// SSE server runs on a separate port to avoid Next.js response buffering
const SSE_BASE = process.env.NEXT_PUBLIC_SSE_URL ?? "http://localhost:3021";

function resolveFigureSettings(
  meta: ExamMetaInput | undefined,
  aiSettings: AISettings
): { figureMode: FigureMode; figureRegen: boolean; imageProvider: ImageProviderId } {
  const figureMode = meta?.figureMode ?? "auto";
  if (figureMode === "original" || figureMode === "grayscale") {
    return { figureMode, figureRegen: false, imageProvider: aiSettings.imageProvider };
  }
  if (figureMode === "chatgpt-image2") {
    return { figureMode, figureRegen: true, imageProvider: "codex-cli" };
  }
  return {
    figureMode: "auto",
    figureRegen: aiSettings.figureRegen,
    imageProvider: aiSettings.imageProvider,
  };
}

export function useJobRunner() {
  const store = useJobStore();
  const abortRef = useRef<AbortController | null>(null);

  const stopJob = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    store.setStatus("failed");
    store.addLog({
      timestamp: new Date().toISOString(),
      stage: "system",
      message: "작업이 중단되었습니다.",
      level: "warn",
    });
  }, [store]);

  const pauseJob = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    store.setStatus("paused");
    store.addLog({
      timestamp: new Date().toISOString(),
      stage: "system",
      message: "작업을 일시정지했습니다. 캐시된 결과는 보존되며 '재개' 버튼으로 이어 진행할 수 있습니다.",
      level: "info",
    });
  }, [store]);

  const startJob = useCallback(
    async (
      mode: "create" | "resume" | "crop",
      files: { pdf: string; hwpx?: string; questionImages?: number[] },
      meta?: ExamMetaInput & { resumeFrom?: string; questionCount?: number },
      provider?: AIProviderId
    ) => {
      const jobId = crypto.randomUUID();
      const abortController = new AbortController();
      abortRef.current = abortController;

      // resume 모드에서는 호출자가 캐시 데이터를 questionResults에 미리 채워놓을 수 있다.
      // reset()이 그걸 비워버리지 않도록 snapshot 후 복원한다.
      const preloadedQuestionResults =
        mode === "resume" ? useJobStore.getState().questionResults : null;

      store.reset();
      store.setJobId(jobId);
      store.setMode(mode, meta?.resumeFrom);
      store.setStatus("running");
      // Re-set v3Meta after reset so it persists during job execution
      if (meta && (mode === "create" || mode === "resume")) {
        store.setV3Meta(meta);
      }
      if (preloadedQuestionResults && Object.keys(preloadedQuestionResults).length > 0) {
        useJobStore.setState({ questionResults: preloadedQuestionResults });
      }

      // Mark first stage as running
      const rawResumeFrom = meta?.resumeFrom ?? "extractor";
      // "confirm" triggers builder; use "builder" as the first visible stage
      const effectiveResumeFrom = rawResumeFrom === "confirm" ? "builder" : rawResumeFrom;
      const firstStage = mode === "crop" ? "cropper"
        : mode === "create" ? "extractor"
        : effectiveResumeFrom;
      store.updateStage(firstStage, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      store.addLog({
        timestamp: new Date().toISOString(),
        stage: "system",
        message: "작업을 시작합니다...",
        level: "info",
      });
      const aiSettings = readAISettings();
      const selectedProvider = provider ?? aiSettings.defaultProvider;
      const figureSettings = resolveFigureSettings(meta, aiSettings);

      try {
        const res = await fetch(`${SSE_BASE}/api/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            files,
            meta,
            jobId,
            provider: selectedProvider,
            stageOverrides: aiSettings.stageOverrides,
            imageProvider: figureSettings.imageProvider,
            imageCleaningProvider: aiSettings.imageCleaningProvider,
            figureRegen: figureSettings.figureRegen,
            figureMode: figureSettings.figureMode,
            imageCleaningEnabled: aiSettings.imageCleaningEnabled,
            checkerMaxAttempts: aiSettings.checkerMaxAttempts,
            verifierMaxAttempts: aiSettings.verifierMaxAttempts,
            stageSkip: aiSettings.stageSkip,
          }),
          signal: abortController.signal,
        });

        if (!res.ok || !res.body) {
          store.setStatus("failed");
          store.addLog({
            timestamp: new Date().toISOString(),
            stage: "system",
            message: `API 오류: ${res.status}`,
            level: "error",
          });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const dataLine = line.trim();
            if (!dataLine.startsWith("data: ")) continue;

            try {
              const sseEvent: SSEEvent = JSON.parse(dataLine.slice(6));
              applySSEEvent(sseEvent, store);
            } catch {
              // skip malformed events
            }
          }
        }

        // If status is still running, mark as done
        const state = useJobStore.getState();
        if (state.status === "running") {
          if (!state.result) {
            store.setResult({ status: "success" });
          }
          store.setStatus("done");
          store.addLog({
            timestamp: new Date().toISOString(),
            stage: "system",
            message: "작업이 완료되었습니다.",
            level: "info",
          });
        }
      } catch (err) {
        // AbortError는 사용자가 중단한 것이므로 무시
        if (err instanceof DOMException && err.name === "AbortError") return;
        store.setStatus("failed");
        store.addLog({
          timestamp: new Date().toISOString(),
          stage: "system",
          message: `연결 오류: ${err instanceof Error ? err.message : "알 수 없음"}`,
          level: "error",
        });
      } finally {
        abortRef.current = null;
      }
    },
    [store]
  );

  return { startJob, stopJob, pauseJob };
}

// 로컬 handleSSEEvent는 lib/sseClient.ts의 applySSEEvent로 통합됨 (P7 F5)
