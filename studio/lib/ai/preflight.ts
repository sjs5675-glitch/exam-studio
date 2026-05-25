/**
 * 런타임 preflight — job 큐잉 전에 provider 설치·인증 상태를 점검한다.
 *
 * 판별 전략:
 *  - CLI provider(claude-cli, codex-cli): binary PATH 검색 + 인증 확인
 *  - SDK provider(claude-sdk, openai-sdk, deepseek-v4): env 키 존재 여부로 판정
 *  - auto: claude-cli 또는 codex-cli 중 하나라도 준비되면 OK
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { getRuntimeEnvValue } from "../server/runtimeEnv";
import type { AIProviderId } from "./types";
import type { StageOverrideMap } from "./settings";
import { getCodexBin } from "./providers/codexCli";

// ── 내부 판별 함수 ─────────────────────────────────────────────────────────

function isCliAvailable(binary: string): boolean {
  try {
    execSync(`${binary} --version`, {
      timeout: 10000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function isCodexAuthenticated(): boolean {
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

function isClaudeAuthenticated(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return true;
  }
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const credFile = path.join(home, ".claude", ".credentials.json");
  return fs.existsSync(credFile);
}

// ── 공개 API ───────────────────────────────────────────────────────────────

export interface ProviderReadyResult {
  ready: boolean;
  /** 미준비 사유 (한국어). ready=true 이면 undefined. */
  reason?: string;
  /** 해결 힌트 (한국어). ready=true 이면 undefined. */
  hint?: string;
}

/**
 * 단일 provider가 설치+인증 상태인지 확인한다.
 */
export function checkProviderReady(provider: AIProviderId): ProviderReadyResult {
  switch (provider) {
    case "codex-cli": {
      const bin = getCodexBin();
      if (!isCliAvailable(bin)) {
        return {
          ready: false,
          reason: "Codex CLI가 설치되어 있지 않습니다.",
          hint: "터미널에서 `npm install -g @openai/codex` 실행 후 다시 시도하세요.",
        };
      }
      if (!isCodexAuthenticated()) {
        return {
          ready: false,
          reason: "Codex CLI 로그인이 필요합니다.",
          hint: "터미널에서 `codex login` 실행 후 다시 시도하세요.",
        };
      }
      return { ready: true };
    }

    case "claude-cli": {
      if (!isCliAvailable("claude")) {
        return {
          ready: false,
          reason: "Claude Code CLI가 설치되어 있지 않습니다.",
          hint: "터미널에서 `npm install -g @anthropic-ai/claude-code` 실행 후 다시 시도하세요.",
        };
      }
      if (!isClaudeAuthenticated()) {
        return {
          ready: false,
          reason: "Claude Code CLI 로그인이 필요합니다.",
          hint: "터미널에서 `claude` 실행 후 로그인 후 다시 시도하세요.",
        };
      }
      return { ready: true };
    }

    case "claude-sdk": {
      const key = getRuntimeEnvValue("ANTHROPIC_API_KEY");
      if (!key) {
        return {
          ready: false,
          reason: "ANTHROPIC_API_KEY가 설정되어 있지 않습니다.",
          hint: "설정 화면에서 Anthropic API 키를 입력하세요.",
        };
      }
      return { ready: true };
    }

    case "openai-sdk": {
      const key = getRuntimeEnvValue("OPENAI_API_KEY");
      if (!key) {
        return {
          ready: false,
          reason: "OPENAI_API_KEY가 설정되어 있지 않습니다.",
          hint: "설정 화면에서 OpenAI API 키를 입력하세요.",
        };
      }
      return { ready: true };
    }

    case "deepseek-v4": {
      const key = getRuntimeEnvValue("DEEPSEEK_API_KEY");
      if (!key) {
        return {
          ready: false,
          reason: "DEEPSEEK_API_KEY가 설정되어 있지 않습니다.",
          hint: "설정 화면에서 DeepSeek API 키를 입력하세요.",
        };
      }
      return { ready: true };
    }

    case "auto": {
      // auto: claude-cli 또는 codex-cli 중 하나라도 준비되면 통과
      const codexReady = checkProviderReady("codex-cli");
      if (codexReady.ready) return { ready: true };
      const claudeReady = checkProviderReady("claude-cli");
      if (claudeReady.ready) return { ready: true };
      return {
        ready: false,
        reason: "Codex 또는 Claude Code CLI가 없거나 로그인이 필요합니다.",
        hint: "터미널에서 `codex login` 또는 `claude` 실행 후 다시 시도하세요.",
      };
    }

    default:
      return { ready: true };
  }
}

/**
 * 이 job이 실제로 호출할 provider 집합을 도출한다.
 * stageOverrides에 명시된 provider + defaultProvider 를 합산한다.
 */
export function resolveRequiredProviders(
  defaultProvider: AIProviderId,
  stageOverrides: StageOverrideMap
): Set<AIProviderId> {
  const providers = new Set<AIProviderId>([defaultProvider]);
  for (const provider of Object.values(stageOverrides)) {
    if (provider) providers.add(provider);
  }
  return providers;
}

export interface PreflightResult {
  ok: boolean;
  /** ok=false 일 때만 존재. 한국어 사유. */
  error?: string;
  /** ok=false 일 때만 존재. 한국어 해결 힌트. */
  hint?: string;
}

/**
 * 필요한 provider 중 **준비된 것이 ≥1** 인지 확인한다.
 *
 * - 준비된 provider가 하나라도 있으면 ok=true (나머지는 stageOverride fallback이 처리).
 * - 모두 미준비면 ok=false + 사유/힌트 반환.
 *
 * 영향 범위 주석:
 *   false-positive(정상 환경을 막음)가 false-negative(불량 환경을 통과)보다 나쁘다.
 *   따라서 판별 불명 상황은 차단하지 않는다.
 */
export function preflightProviders(
  defaultProvider: AIProviderId,
  stageOverrides: StageOverrideMap
): PreflightResult {
  const required = resolveRequiredProviders(defaultProvider, stageOverrides);

  const failures: ProviderReadyResult[] = [];
  for (const provider of required) {
    const result = checkProviderReady(provider);
    if (result.ready) {
      // 하나라도 준비되면 통과
      return { ok: true };
    }
    failures.push(result);
  }

  // 모든 provider 미준비
  const first = failures[0];
  return {
    ok: false,
    error: first?.reason ?? "AI provider가 준비되어 있지 않습니다.",
    hint: first?.hint,
  };
}
