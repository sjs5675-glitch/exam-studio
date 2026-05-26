import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * CLI provider(codex/claude)의 로그인(인증) 상태를 동기로 확인한다.
 * /api/status(대시보드 표시)와 orchestrator(작업 시작 시 경고)가 공유한다.
 */
export function checkProviderAuth(provider: "codex" | "claude"): boolean {
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
