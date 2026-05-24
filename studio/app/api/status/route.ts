import { NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";
import { getQueueStatus } from "@/lib/queue";

const IS_WINDOWS = os.platform() === "win32";

function checkCli(binary: string): { available: boolean; version: string } {
  try {
    const cmd = IS_WINDOWS
      ? `wsl.exe -- bash -lc "${binary} --version 2>/dev/null"`
      : `${binary} --version 2>/dev/null`;
    const result = execSync(cmd, { timeout: 10000 }).toString().trim();
    if (result) return { available: true, version: result };
  } catch {
    // fall through
  }
  return { available: false, version: "" };
}

export async function GET() {
  const claude = checkCli("claude");
  const codex = checkCli("codex");
  const queueStatus = getQueueStatus();

  return NextResponse.json({
    cli: claude,
    codexCli: codex,
    queue: queueStatus,
    timestamp: new Date().toISOString(),
  });
}
