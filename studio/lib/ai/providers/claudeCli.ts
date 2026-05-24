import { runClaude } from "../../claude";
import type { AIProviderAdapter, ProviderRunOptions, ProviderRunResult } from "../types";

export const claudeCliProvider: AIProviderAdapter = {
  id: "claude-cli",
  label: "Claude CLI",
  supportsTools: true,
  run(prompt: string, options?: ProviderRunOptions): ProviderRunResult {
    // imagePaths: Claude CLI는 파일 시스템에 직접 접근 가능하므로 별도 flag 없이
    // 프롬프트 내 경로 텍스트로 충분히 인식됨 (향후 --image flag 추가 시 이곳 보강)
    const result = runClaude(prompt, {
      cwd: options?.cwd,
      env: options?.env,
      maxTurns: options?.maxTurns,
      allowedTools: options?.allowedTools,
    });

    return {
      ...result,
      metadata: {
        requestedProvider: "claude-cli",
        provider: "claude-cli",
        label: "Claude CLI",
      },
    };
  },
};
