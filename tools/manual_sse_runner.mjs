import { appendFileSync, readFileSync } from "node:fs";

const log = process.env.RUN_LOG;
const body = process.env.RUN_PAYLOAD ?? (
  process.env.RUN_PAYLOAD_FILE
    ? readFileSync(process.env.RUN_PAYLOAD_FILE, "utf8")
    : undefined
);
const cleanBody = body?.replace(/^\uFEFF/, "");

if (!log) throw new Error("RUN_LOG is required");
if (!cleanBody) throw new Error("RUN_PAYLOAD or RUN_PAYLOAD_FILE is required");

const append = (line) => appendFileSync(log, `${line}\n`, "utf8");

append(`[${new Date().toISOString()}] START manual SSE run`);
append(`payload.bytes=${Buffer.byteLength(cleanBody, "utf8")}`);

try {
  const res = await fetch("http://localhost:3031/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: cleanBody,
  });

  append(`[${new Date().toISOString()}] HTTP ${res.status}`);
  if (!res.ok || !res.body) {
    append(await res.text());
    process.exit(1);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6);
      try {
        const ev = JSON.parse(raw);
        append(JSON.stringify({ event: ev.event, data: ev.data }));
      } catch {
        append(raw);
      }
    }
  }

  if (buffer.trim()) append(buffer.trim());
  append(`[${new Date().toISOString()}] DONE manual SSE run`);
} catch (err) {
  append(`[${new Date().toISOString()}] ERROR ${err?.stack ?? String(err)}`);
  process.exit(1);
}
