"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useJobStore } from "@/lib/store";
import type { SSEEvent } from "@/lib/claude";

interface FollowupChatProps {
  disabled?: boolean;
}

export function FollowupChat({ disabled }: FollowupChatProps) {
  const [instruction, setInstruction] = useState("");
  const [isSending, setIsSending] = useState(false);
  const jobId = useJobStore((s) => s.jobId);
  const store = useJobStore();

  const handleSend = useCallback(async () => {
    if (!instruction.trim() || !jobId || isSending) return;

    setIsSending(true);
    store.setStatus("running");
    store.addLog({
      timestamp: new Date().toISOString(),
      stage: "system",
      message: `추가 지시: ${instruction}`,
      level: "info",
    });

    // resume --from=X 패턴 감지 → v3Meta.resumeFrom 업데이트
    const resumeMatch = instruction.match(/(?:^|\s)resume\b.*--from=(\w+)/i);
    if (resumeMatch) {
      const currentMeta = useJobStore.getState().v3Meta ?? {};
      store.setV3Meta({ ...currentMeta, resumeFrom: resumeMatch[1] });
    }

    try {
      const res = await fetch(`/api/run/${jobId}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });

      if (!res.ok || !res.body) {
        store.setStatus("failed");
        store.addLog({
          timestamp: new Date().toISOString(),
          stage: "system",
          message: `추가 지시 실패: ${res.status}`,
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
            handleSSEEvent(sseEvent, store);
          } catch {
            // skip
          }
        }
      }

      if (useJobStore.getState().status === "running") {
        store.setStatus("done");
        store.addLog({
          timestamp: new Date().toISOString(),
          stage: "system",
          message: "추가 지시 반영 완료.",
          level: "info",
        });
      }
    } catch (err) {
      store.setStatus("failed");
      store.addLog({
        timestamp: new Date().toISOString(),
        stage: "system",
        message: `오류: ${err instanceof Error ? err.message : "알 수 없음"}`,
        level: "error",
      });
    } finally {
      setIsSending(false);
      setInstruction("");
    }
  }, [instruction, jobId, isSending, store]);

  return (
    <div className="flex items-center gap-2">
      <Input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
        placeholder="추가 지시를 입력하세요..."
        disabled={disabled || isSending}
        className="flex-1"
      />
      <Button
        onClick={handleSend}
        disabled={disabled || isSending || !instruction.trim()}
        size="sm"
      >
        {isSending ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        )}
      </Button>
    </div>
  );
}

function handleSSEEvent(event: SSEEvent, store: ReturnType<typeof useJobStore.getState>) {
  const data = event.data;

  switch (event.event) {
    case "log":
      store.addLog({
        timestamp: (data.timestamp as string) ?? new Date().toISOString(),
        stage: (data.stage as string) ?? "system",
        message: (data.message as string) ?? "",
        level: (data.level as "info" | "warn" | "error") ?? "info",
      });
      break;
    case "stage":
      store.updateStage(data.name as string, {
        status: data.status as "running" | "done",
        ...(data.status === "running" ? { startedAt: new Date().toISOString() } : {}),
        ...(data.status === "done" ? { finishedAt: new Date().toISOString() } : {}),
      });
      break;
    case "result":
      store.setResult({
        status: data.status as string,
        outputPath: data.outputPath as string | undefined,
        summary: data.result as string | undefined,
      });
      store.setStatus((data.status as string) === "success" ? "done" : "failed");
      break;
    case "error":
      store.addLog({
        timestamp: new Date().toISOString(),
        stage: "system",
        message: (data.message as string) ?? "오류",
        level: "error",
      });
      store.setStatus("failed");
      break;
  }
}
