import { execSync } from "child_process";

/**
 * CLI provider(codex/claude)의 로그인(인증) 상태를 동기로 확인한다.
 * /api/status(대시보드 표시)와 orchestrator(작업 시작 시 안내)가 공유한다.
 *
 * 두 provider 모두 CLI 에 직접 상태를 묻는다. 과거 claude 는 ~/.claude/.credentials.json
 * 파일 존재로 판단했으나, macOS/Windows 는 자격증명을 keychain 에 저장해 그 파일이 없어도
 * 로그인 상태일 수 있어 오탐(로그인됐는데 "안 됨")이 발생했다. → CLI 가 keychain/oauth/env 를
 * 모두 고려해 판단하도록 `claude auth status` 출력을 신뢰한다.
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

  // claude: env key 가 있으면 그것으로 인증되므로 CLI 호출을 아낀다.
  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN
  ) {
    return true;
  }
  try {
    const out = execSync("claude auth status", {
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    return /"loggedIn"\s*:\s*true/.test(out);
  } catch {
    return false;
  }
}
