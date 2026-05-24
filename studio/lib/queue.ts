// Simple in-memory job queue for sequential execution
// Only one job runs at a time; others wait in queue

export type QueueProvider = "claude" | "codex" | "deepseek-v4";

type QueuedJob = {
  id: string;
  provider: QueueProvider;
  execute: () => Promise<void>;
};

let queue: QueuedJob[] = [];
let running: { id: string; provider: QueueProvider } | null = null;
const listeners: Set<() => void> = new Set();

export interface ProviderQueueStatus {
  running: string | null;
  queueLength: number;
}

export interface QueueStatus {
  running: string | null;
  runningProvider: QueueProvider | null;
  queued: string[];
  queueLength: number;
  byProvider: Record<QueueProvider, ProviderQueueStatus>;
}

function providerBreakdown(): Record<QueueProvider, ProviderQueueStatus> {
  const providers: QueueProvider[] = ["claude", "codex", "deepseek-v4"];
  const result = {} as Record<QueueProvider, ProviderQueueStatus>;
  for (const p of providers) {
    result[p] = {
      running: running?.provider === p ? running.id : null,
      queueLength: queue.filter((j) => j.provider === p).length,
    };
  }
  return result;
}

export function getQueueStatus(): QueueStatus {
  return {
    running: running?.id ?? null,
    runningProvider: running?.provider ?? null,
    queued: queue.map((j) => j.id),
    queueLength: queue.length,
    byProvider: providerBreakdown(),
  };
}

export function onQueueChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((l) => l());
}

export async function enqueue(id: string, provider: QueueProvider, execute: () => Promise<void>) {
  queue.push({ id, provider, execute });
  notify();

  if (!running) {
    processNext();
  }
}

export function cancelQueued(id: string) {
  queue = queue.filter((j) => j.id !== id);
  notify();
}

async function processNext() {
  if (running || queue.length === 0) return;

  const job = queue.shift()!;
  running = { id: job.id, provider: job.provider };
  notify();

  try {
    await job.execute();
  } catch {
    // error handled by the execute function itself
  } finally {
    running = null;
    notify();
    processNext();
  }
}
