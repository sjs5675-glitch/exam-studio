import { NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { getQueueStatus } from "@/lib/queue";

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

function checkAuth(provider: "codex" | "claude"): boolean {
  if (provider === "codex") {
    try {
      execSync("codex login status", {
        timeout: 10000,
        stdio: ["ignore", "ignore", "ignore"],
      });
      return true;
    } catch {
      return false;
    }
  }

  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN
  ) {
    return true;
  }

  const home =
    process.env.USERPROFILE || process.env.HOME || os.homedir();
  const credFile = path.join(home, ".claude", ".credentials.json");
  return fs.existsSync(credFile);
}

export async function GET() {
  const claudeCli = checkCli("claude");
  const codexCli = checkCli("codex");
  const queueStatus = getQueueStatus();

  return NextResponse.json({
    cli: {
      ...claudeCli,
      authenticated: claudeCli.available ? checkAuth("claude") : false,
    },
    codexCli: {
      ...codexCli,
      authenticated: codexCli.available ? checkAuth("codex") : false,
    },
    queue: queueStatus,
    timestamp: new Date().toISOString(),
  });
}
