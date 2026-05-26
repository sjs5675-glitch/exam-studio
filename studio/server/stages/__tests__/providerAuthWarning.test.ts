import { describe, it, expect, vi } from "vitest";
import type { SSEEvent } from "@/lib/claude";
import { warnUnauthenticatedProviders } from "../orchestrator";

function collect() {
  const events: SSEEvent[] = [];
  const send = (e: SSEEvent) => {
    events.push(e);
  };
  const warnLogs = () =>
    events.filter(
      (e) =>
        e.event === "log" &&
        e.data.stage === "system" &&
        e.data.level === "warn",
    );
  return { send, warnLogs };
}

const msg = (e: SSEEvent) => e.data.message as string;

describe("warnUnauthenticatedProviders", () => {
  it("codex-cli + 미인증 → Codex 경고 + 터미널 'codex login' 안내", () => {
    const { send, warnLogs } = collect();
    warnUnauthenticatedProviders("codex-cli", {}, send, () => false);
    const logs = warnLogs();
    expect(logs).toHaveLength(1);
    expect(msg(logs[0])).toContain("Codex");
    expect(msg(logs[0])).toContain("codex login");
  });

  it("auto + 미인증 → Claude Code 경고 + 'claude' 안내 (auto는 claude로 resolve)", () => {
    const { send, warnLogs } = collect();
    warnUnauthenticatedProviders("auto", {}, send, () => false);
    const logs = warnLogs();
    expect(logs).toHaveLength(1);
    expect(msg(logs[0])).toContain("Claude Code");
    expect(msg(logs[0])).toContain("'claude'");
  });

  it("로그인된 provider → 경고 없음", () => {
    const { send, warnLogs } = collect();
    warnUnauthenticatedProviders("codex-cli", {}, send, () => true);
    expect(warnLogs()).toHaveLength(0);
  });

  it("SDK/API-key provider(claude-sdk) → 경고 없음 + 인증 확인 자체를 호출하지 않음", () => {
    const { send, warnLogs } = collect();
    const isAuth = vi.fn(() => false);
    warnUnauthenticatedProviders("claude-sdk", {}, send, isAuth);
    expect(warnLogs()).toHaveLength(0);
    expect(isAuth).not.toHaveBeenCalled();
  });

  it("default + stageOverride 합집합 → 서로 다른 CLI provider 둘 다 경고", () => {
    const { send, warnLogs } = collect();
    // default codex-cli + solver override claude-cli, 둘 다 미인증
    warnUnauthenticatedProviders(
      "codex-cli",
      { "create.solver": "claude-cli" },
      send,
      () => false,
    );
    const text = warnLogs().map(msg).join("\n");
    expect(warnLogs()).toHaveLength(2);
    expect(text).toContain("Codex");
    expect(text).toContain("Claude Code");
  });

  it("같은 인증 타깃은 한 번만 경고 (claude-cli + auto override → claude 1회)", () => {
    const { send, warnLogs } = collect();
    warnUnauthenticatedProviders(
      "claude-cli",
      { "create.extractor": "auto" },
      send,
      () => false,
    );
    expect(warnLogs()).toHaveLength(1);
  });
});
