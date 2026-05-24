import { useJobStore } from "@/lib/store";
import type { SSEEvent } from "@/lib/claude";
import { applySSEEvent } from "@/lib/sseClient";

type Store = ReturnType<typeof useJobStore.getState>;

/** Send a resume/followup instruction via SSE */
export async function sendResumeAction(
  jobId: string,
  instruction: string,
  store: Store,
) {
  store.setStatus("running");
  store.addLog({
    timestamp: new Date().toISOString(),
    stage: "system",
    message: instruction,
    level: "info",
  });

  try {
    const res = await fetch(`/api/run/${jobId}/followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });

    if (!res.ok || !res.body) {
      store.setStatus("failed");
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
        } catch { /* skip */ }
      }
    }

    if (useJobStore.getState().status === "running") {
      store.setStatus("done");
    }
  } catch {
    store.setStatus("failed");
  }
}

// 로컬 handleSSEEvent는 lib/sseClient.ts의 applySSEEvent로 통합됨 (P7 F5)
