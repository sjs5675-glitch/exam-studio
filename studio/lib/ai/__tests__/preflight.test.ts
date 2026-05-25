import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AIProviderId } from "../types";

// child_process, fs, path, os는 모두 mock
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));
vi.mock("fs", () => ({
  default: { existsSync: vi.fn() },
  existsSync: vi.fn(),
}));
vi.mock("../../server/runtimeEnv", () => ({
  getRuntimeEnvValue: vi.fn(),
}));
vi.mock("../providers/codexCli", () => ({
  getCodexBin: () => "codex",
}));

import { execSync } from "child_process";
import fs from "fs";
import { getRuntimeEnvValue } from "../../server/runtimeEnv";
import { checkProviderReady, resolveRequiredProviders, preflightProviders } from "../preflight";

const mockExecSync = execSync as ReturnType<typeof vi.fn>;
const mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
const mockGetRuntimeEnvValue = getRuntimeEnvValue as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkProviderReady — codex-cli", () => {
  it("설치+인증 → ready=true", () => {
    mockExecSync.mockReturnValue("1.0.0"); // --version OK
    // login status exit 0 (no throw)
    const result = checkProviderReady("codex-cli");
    expect(result.ready).toBe(true);
  });

  it("미설치(--version throw) → ready=false, 미설치 사유", () => {
    mockExecSync.mockImplementation(() => { throw new Error("ENOENT"); });
    const result = checkProviderReady("codex-cli");
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/설치/);
  });

  it("설치O+미인증(login status throw) → ready=false, 로그인 사유", () => {
    mockExecSync
      .mockReturnValueOnce("1.0.0") // --version OK
      .mockImplementationOnce(() => { throw new Error("not logged in"); }); // login status fail
    const result = checkProviderReady("codex-cli");
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/로그인/);
  });
});

describe("checkProviderReady — claude-cli", () => {
  it("설치+인증(env key) → ready=true", () => {
    mockExecSync.mockReturnValue("1.0.0"); // claude --version OK
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const result = checkProviderReady("claude-cli");
    expect(result.ready).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("설치+인증(credentials 파일) → ready=true", () => {
    mockExecSync.mockReturnValue("1.0.0");
    mockExistsSync.mockReturnValue(true);
    const result = checkProviderReady("claude-cli");
    expect(result.ready).toBe(true);
  });

  it("미설치 → ready=false", () => {
    mockExecSync.mockImplementation(() => { throw new Error("ENOENT"); });
    const result = checkProviderReady("claude-cli");
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/설치/);
  });

  it("설치O+미인증(파일없음+env없음) → ready=false", () => {
    mockExecSync.mockReturnValue("1.0.0");
    mockExistsSync.mockReturnValue(false);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const result = checkProviderReady("claude-cli");
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/로그인/);
  });
});

describe("checkProviderReady — SDK providers (env 키 기반)", () => {
  it("claude-sdk: ANTHROPIC_API_KEY 있으면 ready=true", () => {
    mockGetRuntimeEnvValue.mockReturnValue("sk-ant-test");
    const result = checkProviderReady("claude-sdk");
    expect(result.ready).toBe(true);
  });

  it("claude-sdk: ANTHROPIC_API_KEY 없으면 ready=false", () => {
    mockGetRuntimeEnvValue.mockReturnValue(undefined);
    const result = checkProviderReady("claude-sdk");
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("openai-sdk: OPENAI_API_KEY 있으면 ready=true", () => {
    mockGetRuntimeEnvValue.mockReturnValue("sk-openai-test");
    const result = checkProviderReady("openai-sdk");
    expect(result.ready).toBe(true);
  });

  it("openai-sdk: OPENAI_API_KEY 없으면 ready=false", () => {
    mockGetRuntimeEnvValue.mockReturnValue(undefined);
    const result = checkProviderReady("openai-sdk");
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/OPENAI_API_KEY/);
  });

  it("deepseek-v4: DEEPSEEK_API_KEY 있으면 ready=true", () => {
    mockGetRuntimeEnvValue.mockReturnValue("ds-test");
    const result = checkProviderReady("deepseek-v4");
    expect(result.ready).toBe(true);
  });

  it("deepseek-v4: DEEPSEEK_API_KEY 없으면 ready=false", () => {
    mockGetRuntimeEnvValue.mockReturnValue(undefined);
    const result = checkProviderReady("deepseek-v4");
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/DEEPSEEK_API_KEY/);
  });
});

describe("resolveRequiredProviders", () => {
  it("override 없으면 defaultProvider만 반환", () => {
    const set = resolveRequiredProviders("codex-cli", {});
    expect(set).toEqual(new Set(["codex-cli"]));
  });

  it("override 있으면 defaultProvider + override provider 모두 포함", () => {
    const set = resolveRequiredProviders("codex-cli", { "create.extractor": "claude-sdk" });
    expect(set.has("codex-cli")).toBe(true);
    expect(set.has("claude-sdk")).toBe(true);
  });
});

describe("preflightProviders", () => {
  it("준비된 provider가 하나라도 있으면 ok=true", () => {
    // codex-cli 준비됨
    mockExecSync.mockReturnValue("1.0.0");
    // login status OK
    const result = preflightProviders("codex-cli", {});
    expect(result.ok).toBe(true);
  });

  it("모든 provider 미준비면 ok=false + error + hint 반환", () => {
    mockExecSync.mockImplementation(() => { throw new Error("ENOENT"); });
    mockExistsSync.mockReturnValue(false);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const result = preflightProviders("claude-cli", {});
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(typeof result.hint).toBe("string");
  });

  it("auto: codex 준비되면 ok=true", () => {
    mockExecSync.mockReturnValue("1.0.0");
    const result = preflightProviders("auto", {});
    expect(result.ok).toBe(true);
  });
});
