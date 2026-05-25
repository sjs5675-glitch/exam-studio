"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Cpu, KeyRound, Loader2, PlugZap, Settings2, Sparkles, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AI_STAGE_KEYS,
  DEEPSEEK_MODEL_STAGE_KEYS,
  DEFAULT_AI_SETTINGS,
  allModelStagesUseDeepSeek,
  createDeepSeekStageOverrides,
  readAISettings,
  writeAISettings,
  type AISettings,
  type ImageProviderId,
  type SelectableProviderId,
  type StageProviderId,
} from "@/lib/ai/settings";
import { STAGE_PROVIDER_CAPABILITY } from "@/lib/ai/stageCapability";
import { recommendStageProvider } from "@/lib/ai/recommendation";
import type { AIStageKey } from "@/lib/ai";
import { cn } from "@/lib/utils";
import {
  IMAGE_PROVIDER_LABEL,
  PROVIDER_LABEL,
  apiKeyFields,
  imageProviderOptions,
  providerOptions,
  stageLabels,
  type ApiTestProvider,
  type ApiTestState,
  type EnvKeyStatus,
  type ProviderOption,
  type SettingsTab,
  type StatusResponse,
} from "../_lib/settingsPageConfig";

// ── Main page component ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("engine");
  const [settings, setSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [envStatus, setEnvStatus] = useState<Record<string, EnvKeyStatus>>({});
  const [cliStatus, setCliStatus] = useState<StatusResponse>({});
  const [envMessage, setEnvMessage] = useState("");
  const [apiTests, setApiTests] = useState<Record<ApiTestProvider, ApiTestState>>({
    deepseek: { status: "idle" },
    gemini: { status: "idle" },
    claude: { status: "idle" },
    openai: { status: "idle" },
  });

  const deepSeekEnabled = allModelStagesUseDeepSeek(settings.stageOverrides);

  const applyEnvKeys = useCallback((keys: Record<string, EnvKeyStatus> | undefined) => {
    setEnvStatus(keys ?? {});
    setEnvValues((current) => ({
      ...current,
      ANTHROPIC_MODEL: keys?.ANTHROPIC_MODEL?.value ?? current.ANTHROPIC_MODEL ?? "",
      OPENAI_MODEL: keys?.OPENAI_MODEL?.value ?? current.OPENAI_MODEL ?? "",
      DEEPSEEK_API_BASE_URL: keys?.DEEPSEEK_API_BASE_URL?.value ?? current.DEEPSEEK_API_BASE_URL ?? "",
      DEEPSEEK_MODEL: keys?.DEEPSEEK_MODEL?.value ?? current.DEEPSEEK_MODEL ?? "",
    }));
  }, []);

  const loadEnvSettings = useCallback(async () => {
    const response = await fetch("/api/env-settings");
    if (!response.ok) return;
    const data = await response.json() as { keys?: Record<string, EnvKeyStatus> };
    applyEnvKeys(data.keys);
  }, [applyEnvKeys]);

  const loadCliStatus = useCallback(async () => {
    const response = await fetch("/api/status");
    if (!response.ok) return;
    const data = await response.json() as StatusResponse;
    setCliStatus(data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only; keep SSR hydration deterministic.
    setSettings(readAISettings());
    void loadEnvSettings();
    void loadCliStatus();
  }, [loadEnvSettings, loadCliStatus]);

  const selectProvider = (provider: SelectableProviderId) => {
    setSettings(writeAISettings({ ...settings, defaultProvider: provider }));
  };

  const setStageOverride = (stageKey: AIStageKey, provider: StageProviderId | "") => {
    const next = { ...settings.stageOverrides };
    if (provider === "") {
      delete next[stageKey];
    } else {
      next[stageKey] = provider;
    }
    setSettings(writeAISettings({ ...settings, stageOverrides: next }));
  };

  const selectImageProvider = (imageProvider: ImageProviderId) => {
    setSettings(writeAISettings({ ...settings, imageProvider }));
  };

  const toggleDeepSeek = () => {
    setSettings(writeAISettings({
      ...settings,
      stageOverrides: deepSeekEnabled ? {} : createDeepSeekStageOverrides(),
    }));
  };

  const resetSettings = () => {
    setSettings(writeAISettings(DEFAULT_AI_SETTINGS));
  };

  const saveEnvSettings = async () => {
    setEnvMessage("");
    const values = Object.fromEntries(
      Object.entries(envValues).filter(([key, value]) => !key.endsWith("_API_KEY") || value.trim())
    );
    const response = await fetch("/api/env-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });

    if (!response.ok) {
      setEnvMessage("저장에 실패했습니다.");
      return;
    }

    const data = await response.json() as { keys?: Record<string, EnvKeyStatus> };
    applyEnvKeys(data.keys);
    setEnvValues((current) => ({
      ...current,
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      GEMINI_API_KEY: "",
    }));
    setEnvMessage("저장되었습니다.");
  };

  const testApiConnection = async (provider: ApiTestProvider) => {
    setApiTests((current) => ({
      ...current,
      [provider]: { status: "running", message: "테스트 중..." },
    }));

    const response = await fetch("/api/env-settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, values: envValues }),
    });
    const data = await response.json().catch(() => undefined) as { ok?: boolean; message?: string; detail?: string } | undefined;
    const message = [data?.message, data?.detail].filter(Boolean).join(" · ") || "테스트 실패";

    setApiTests((current) => ({
      ...current,
      [provider]: {
        status: response.ok && data?.ok ? "success" : "error",
        message,
      },
    }));
  };

  /** Check if a provider card has an auth warning */
  function providerHasAuthWarning(option: ProviderOption): boolean {
    // CLI providers
    if (option.cliKey) {
      const cliInfo = cliStatus[option.cliKey];
      if (option.id === "auto" || option.id === "claude-cli") {
        // OK if CLI is available OR ANTHROPIC_API_KEY is set
        const cliOk = cliInfo?.available ?? false;
        const sdkKeyOk = envStatus["ANTHROPIC_API_KEY"]?.configured ?? false;
        return !cliOk && !sdkKeyOk;
      }
      if (option.id === "codex-cli") {
        // codex는 설치(available)뿐 아니라 로그인(authenticated)까지 돼야 사용 가능.
        return !((cliInfo?.available ?? false) && (cliInfo?.authenticated ?? false));
      }
    }
    // SDK providers: check required env keys
    return option.requiredEnvKeys.some((key) => !(envStatus[key]?.configured ?? false));
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Tab bar */}
      <div className="flex w-fit rounded-lg border bg-card p-1">
        {([
          { id: "engine", label: "AI 엔진", icon: Cpu },
          { id: "keys", label: "API 키", icon: KeyRound },
        ] as const).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex h-9 items-center gap-2 rounded-md px-3 text-sm transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "engine" ? (
        <>
          {/* ── 기본 실행 엔진 (5장 + auto 카드) ─────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Cpu className="size-4" />
              AI 엔진
            </div>

            <div className="rounded-lg border bg-card">
              <div className="flex items-start justify-between gap-4 border-b px-4 py-4">
                <div className="space-y-1">
                  <h2 className="text-base font-medium">기본 실행 엔진</h2>
                  <p className="text-sm text-muted-foreground">
                    새 작업을 시작할 때 사용할 provider 기본값입니다. Stage별 override가 없으면 이 값이 적용됩니다.
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                  <Settings2 className="size-3.5" />
                  localStorage
                </div>
              </div>

              <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                {providerOptions.map((option) => {
                  const selected = option.id === settings.defaultProvider;
                  const hasWarning = providerHasAuthWarning(option);

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => selectProvider(option.id)}
                      disabled={hasWarning && !selected}
                      className={cn(
                        "min-h-36 rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed",
                        selected
                          ? "border-primary bg-primary/5"
                          : hasWarning
                          ? "border-destructive/40 opacity-60"
                          : "border-border hover:border-primary/40 hover:bg-muted/40"
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{option.label}</span>
                          {hasWarning && (
                            <AlertTriangle className="size-3.5 text-destructive" aria-label={option.authNote} />
                          )}
                        </div>
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full border",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/30 text-transparent"
                          )}
                          aria-hidden="true"
                        >
                          <Check className="size-3.5" />
                        </span>
                      </div>

                      <p className="min-h-10 text-xs leading-5 text-muted-foreground">
                        {option.detail}
                      </p>

                      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                        <div>
                          실행: <span className="text-foreground">{option.resolved}</span>
                        </div>
                        <div>
                          이미지:{" "}
                          <span className={option.vision === "supported" ? "text-foreground" : option.vision === "pending" ? "text-amber-500" : "text-destructive"}>
                            {option.visionNote}
                          </span>
                        </div>
                        <div className={cn("text-xs", hasWarning ? "text-destructive" : "text-muted-foreground")}>
                          {hasWarning ? "⚠ " : ""}{option.authNote}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ── Stage override 드롭다운 매트릭스 ─────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Workflow className="size-4" />
              Stage override
            </div>

            <div className="rounded-lg border bg-card">
              <div className="flex items-start justify-between gap-4 border-b px-4 py-4">
                <div>
                  <h2 className="text-base font-medium">AI 단계별 Provider 선택</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    각 stage에서 사용할 provider를 지정합니다. &quot;자동&quot;은 기본 provider를 사용합니다.
                  </p>
                </div>
                <Button
                  variant={deepSeekEnabled ? "secondary" : "default"}
                  onClick={toggleDeepSeek}
                >
                  <Sparkles className="size-4" />
                  {deepSeekEnabled ? "자동으로 전환" : "DeepSeek 일괄 사용"}
                </Button>
              </div>

              <div className="grid gap-2 p-4 md:grid-cols-2">
                {AI_STAGE_KEYS.map((stageKey) => {
                  const recommendation = recommendStageProvider({
                    stageKey,
                    stageOverrides: settings.stageOverrides,
                    telemetry: [],
                  });
                  const currentOverride = settings.stageOverrides[stageKey] ?? "";
                  const allowedProviders = STAGE_PROVIDER_CAPABILITY[stageKey];
                  const deepSeekSupported = DEEPSEEK_MODEL_STAGE_KEYS.includes(stageKey);

                  return (
                    <div
                      key={stageKey}
                      className={cn(
                        "rounded-lg border px-4 py-3 space-y-2",
                        currentOverride ? "border-primary/40 bg-primary/5" : "border-border bg-background"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{stageLabels[stageKey]}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {stageKey} · 실행: {PROVIDER_LABEL[recommendation.provider] ?? recommendation.provider}
                            {!deepSeekSupported && " · DeepSeek 미지원"}
                          </div>
                        </div>
                      </div>

                      <select
                        value={currentOverride}
                        onChange={(e) => setStageOverride(stageKey, e.target.value as StageProviderId | "")}
                        disabled={stageKey === "create.verifier" && settings.verifierMaxAttempts === 0}
                        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none transition-colors focus:border-primary disabled:opacity-40"
                      >
                        <option value="">자동 (기본 provider 사용)</option>
                        {allowedProviders.filter((p) => p !== "auto").map((p) => (
                          <option key={p} value={p}>
                            {PROVIDER_LABEL[p] ?? p}
                          </option>
                        ))}
                      </select>

                      {stageKey === "create.verifier" && settings.verifierMaxAttempts === 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          비활성화 — create 페이지의 풀이검증이 0으로 설정되어 verifier 단계가 스킵됩니다.
                        </p>
                      )}

                      {!deepSeekSupported && (
                        <p className="text-xs text-muted-foreground">
                          DeepSeek V4는 이미지 입력을 지원하지 않아 이 단계에는 사용할 수 없습니다.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="border-t px-4 py-3 text-xs text-muted-foreground">
                builder, checker, cropper는 로컬 deterministic runner가 처리합니다.
                create.extractor는 DeepSeek V4가 이미지 입력을 지원하지 않아 선택 불가입니다.
              </div>
            </div>
          </section>

          {/* ── 그림 처리 ─────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Sparkles className="size-4" />
              그림 처리
            </div>

            <div className="rounded-lg border bg-card">
              <div className="border-b px-4 py-4">
                <h2 className="text-base font-medium">이미지 처리 Provider</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  손글씨 제거와 figure 재생성에 사용할 이미지 provider입니다. Codex CLI는 built-in image generation tool을 사용하는 실험 옵션입니다.
                </p>
              </div>

              <div className="grid gap-2 p-4 md:grid-cols-2">
                {imageProviderOptions.map((option) => {
                  const selected = option.id === settings.imageProvider;
                  const hasWarning = option.id === "gemini"
                    ? !(envStatus.GEMINI_API_KEY?.configured ?? false)
                    : !((cliStatus.codexCli?.available ?? false) && (cliStatus.codexCli?.authenticated ?? false));

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => selectImageProvider(option.id)}
                      disabled={hasWarning && !selected}
                      className={cn(
                        "min-h-32 rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed",
                        selected
                          ? "border-primary bg-primary/5"
                          : hasWarning
                          ? "border-destructive/40 opacity-60"
                          : "border-border hover:border-primary/40 hover:bg-muted/40"
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{option.label}</span>
                          {option.experimental && (
                            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              experimental
                            </span>
                          )}
                          {hasWarning && (
                            <AlertTriangle className="size-3.5 text-destructive" aria-label={option.authNote} />
                          )}
                        </div>
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full border",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/30 text-transparent"
                          )}
                          aria-hidden="true"
                        >
                          <Check className="size-3.5" />
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">{option.detail}</p>
                      <p className={cn("mt-3 text-xs", hasWarning ? "text-destructive" : "text-muted-foreground")}>
                        {hasWarning ? "⚠ " : ""}{option.authNote}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-4 border-t px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium">그림 재생성</h3>
                    <p className="text-sm text-muted-foreground">
                      켜져 있으면 has_figure 문제의 그림을 PDF에서 crop → {IMAGE_PROVIDER_LABEL[settings.imageProvider]}로 재생성 → 트리밍.
                      끄면 crop 결과를 그대로 사용합니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.figureRegen}
                    onClick={() => setSettings(writeAISettings({ ...settings, figureRegen: !settings.figureRegen }))}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                      settings.figureRegen ? "bg-primary" : "bg-muted",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none inline-block size-5 transform rounded-full bg-background shadow ring-0 transition-transform",
                        settings.figureRegen ? "translate-x-5" : "translate-x-0",
                      )}
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ── 현재 선택 요약 ─────────────────────────────────────────── */}
          <section className="rounded-lg border bg-card px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-medium">현재 선택</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  다음 작업부터 <code className="text-xs bg-muted px-1 rounded">{settings.defaultProvider}</code> provider와 stage override 설정이 요청 본문에 포함됩니다.
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={resetSettings}
              >
                자동으로 되돌리기
              </Button>
            </div>
          </section>
        </>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <KeyRound className="size-4" />
            API 키
          </div>

          <div className="rounded-lg border bg-card">
            <div className="border-b px-4 py-4">
              <h2 className="text-base font-medium">로컬 API 키</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                입력한 값은 이 앱의 <code className="text-xs bg-muted px-1 rounded">.env.local</code>에 저장되고 다음 실행부터 바로 사용됩니다.
              </p>
            </div>

            <div className="grid gap-4 p-4">
              {apiKeyFields.map((field) => {
                const configured = Boolean(envStatus[field.key]?.configured);
                const isSecret = field.key.endsWith("_API_KEY");

                return (
                  <label key={field.key} className="grid gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{field.label}</span>
                      <span className={cn(
                        "rounded-md px-2 py-1 text-xs",
                        configured ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      )}>
                        {configured
                          ? <span className="flex items-center gap-1"><CheckCircle2 className="size-3" /> 설정됨</span>
                          : "미설정"}
                      </span>
                    </div>
                    <input
                      type={isSecret ? "password" : "text"}
                      value={envValues[field.key] ?? ""}
                      onChange={(event) => setEnvValues({
                        ...envValues,
                        [field.key]: event.target.value,
                      })}
                      placeholder={isSecret && configured ? "새 값 입력 시 교체" : field.placeholder}
                      className="h-10 rounded-md border bg-background px-3 text-sm outline-none transition-colors focus:border-primary"
                    />
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-4 py-4">
              <p className="text-sm text-muted-foreground">
                빈 API key 입력란은 기존 값을 유지합니다.
              </p>
              <div className="flex items-center gap-3">
                {envMessage ? <span className="text-sm text-muted-foreground">{envMessage}</span> : null}
                <Button onClick={saveEnvSettings}>
                  <KeyRound className="size-4" />
                  저장
                </Button>
              </div>
            </div>
          </div>

          {/* ── 연결 테스트 ─────────────────────────────────────────────── */}
          <div className="rounded-lg border bg-card">
            <div className="border-b px-4 py-4">
              <h2 className="text-base font-medium">연결 테스트</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                현재 입력값 또는 저장된 값을 사용해 provider 인증을 확인합니다.
              </p>
            </div>

            <div className="grid gap-3 p-4 md:grid-cols-2">
              {([
                { provider: "claude", label: "Claude SDK" },
                { provider: "openai", label: "OpenAI SDK" },
                { provider: "deepseek", label: "DeepSeek" },
                { provider: "gemini", label: "Nano Banana / Gemini" },
              ] as const).map((item) => {
                const state = apiTests[item.provider];
                const running = state.status === "running";

                return (
                  <div key={item.provider} className="rounded-lg border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{item.label}</div>
                        <div className={cn(
                          "mt-1 text-xs",
                          state.status === "success" ? "text-primary" : state.status === "error" ? "text-destructive" : "text-muted-foreground"
                        )}>
                          {state.message ?? "아직 테스트하지 않음"}
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => testApiConnection(item.provider)}
                        disabled={running}
                      >
                        {running ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                        테스트
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
