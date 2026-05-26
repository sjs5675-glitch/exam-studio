import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { getQueueStatus } from "@/lib/queue";
import { checkProviderAuth } from "@/lib/server/providerAuth";

function checkCli(binary: string): { available: boolean; version: string } {
  try {
    const result = execSync(`${binary} --version`, {
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (result) return { available: true, version: result };
  } catch {
    // fall through
  }
  return { available: false, version: "" };
}

export async function GET() {
  const claudeCli = checkCli("claude");
  const codexCli = checkCli("codex");
  const queueStatus = getQueueStatus();

  return NextResponse.json({
    cli: {
      ...claudeCli,
      authenticated: claudeCli.available ? checkProviderAuth("claude") : false,
    },
    codexCli: {
      ...codexCli,
      authenticated: codexCli.available ? checkProviderAuth("codex") : false,
    },
    queue: queueStatus,
    timestamp: new Date().toISOString(),
  });
}
