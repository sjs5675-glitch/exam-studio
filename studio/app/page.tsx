"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Job {
  id: string;
  mode: "create";
  status: string;
  inputFiles?: string[];
  startedAt?: string;
  finishedAt?: string;
}

interface ProviderQueueStatus {
  running: string | null;
  queueLength: number;
}

interface SystemStatus {
  cli: { available: boolean; version: string; authenticated: boolean };
  codexCli: { available: boolean; version: string; authenticated: boolean };
  queue: {
    running: string | null;
    runningProvider: "claude" | "codex" | "deepseek-v4" | null;
    queueLength: number;
    byProvider: Record<"claude" | "codex" | "deepseek-v4", ProviderQueueStatus>;
  };
}

export default function DashboardPage() {
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loginToast, setLoginToast] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/jobs?limit=5")
      .then((r) => r.json())
      .then((d) => setRecentJobs(d.jobs ?? []))
      .catch(() => {});

    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => setSystemStatus(d))
      .catch(() => {});
  }, []);

  async function handleLogin(provider: "codex" | "claude") {
    await fetch("/api/provider-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    setLoginToast("터미널에서 브라우저 로그인을 완료한 뒤 새로고침하세요.");
    setTimeout(() => setLoginToast(null), 6000);
  }

  // 설치됨 + 미인증인 provider 목록
  const loginNeeded: Array<{ provider: "codex" | "claude"; label: string }> = [];
  if (systemStatus?.codexCli.available && !systemStatus.codexCli.authenticated) {
    loginNeeded.push({ provider: "codex", label: "Codex" });
  }
  if (systemStatus?.cli.available && !systemStatus.cli.authenticated) {
    loginNeeded.push({ provider: "claude", label: "Claude Code" });
  }

  return (
    <div className="space-y-8">
      {/* 로그인 필요 배너 */}
      {loginNeeded.map(({ provider, label }) => (
        <div
          key={provider}
          className="flex items-center justify-between rounded-md border border-yellow-400/60 bg-yellow-50 dark:bg-yellow-950/20 px-4 py-3 text-sm"
        >
          <span className="text-yellow-800 dark:text-yellow-300">
            {label} 로그인이 필요합니다.
          </span>
          <button
            onClick={() => handleLogin(provider)}
            className="ml-4 rounded bg-yellow-400 px-3 py-1 text-xs font-medium text-yellow-900 hover:bg-yellow-300 transition-colors"
          >
            로그인
          </button>
        </div>
      ))}

      {/* 로그인 완료 안내 토스트 */}
      {loginToast && (
        <div className="rounded-md border border-blue-300/60 bg-blue-50 dark:bg-blue-950/20 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
          {loginToast}
        </div>
      )}

      {/* Quick start */}
      <div className="grid grid-cols-2 gap-4">
        <Link href="/create">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle className="text-lg">시험지 제작</CardTitle>
              <CardDescription>
                PDF + 양식 HWPX를 업로드하여 시험지를 제작합니다.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/pdf-cropper">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer border-dashed">
            <CardHeader>
              <CardTitle className="text-lg">PDF 크롭 (테스트)</CardTitle>
              <CardDescription>
                PDF 페이지에서 문제 영역을 박스로 선택해 PNG ZIP으로 추출합니다.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* System status */}
      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">시스템 상태</h3>
        <div className="space-y-2 text-sm">
          <ProviderStatusRow
            label="Claude Code"
            cli={systemStatus?.cli}
            queue={systemStatus?.queue.byProvider.claude}
            loaded={systemStatus !== null}
          />
          <ProviderStatusRow
            label="Codex"
            cli={systemStatus?.codexCli}
            queue={systemStatus?.queue.byProvider.codex}
            loaded={systemStatus !== null}
          />
        </div>
      </Card>

      {/* Recent jobs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">최근 작업</h3>
          <Link
            href="/history"
            className="text-xs text-primary hover:underline"
          >
            전체 보기
          </Link>
        </div>

        {recentJobs.length === 0 ? (
          <Card className="p-8">
            <p className="text-sm text-muted-foreground text-center">
              아직 작업 기록이 없습니다.
            </p>
          </Card>
        ) : (
          <div className="space-y-1">
            {recentJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center gap-3 px-4 py-3 rounded-md hover:bg-secondary transition-colors"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    job.status === "done"
                      ? "bg-[var(--color-status-success)]"
                      : job.status === "failed"
                        ? "bg-[var(--color-status-error)]"
                        : job.status === "cancelled"
                          ? "bg-orange-400"
                          : "bg-[var(--color-status-info)] animate-pulse"
                  }`}
                />
                <Badge variant="secondary" className="text-xs shrink-0">
                  제작
                </Badge>
                <span className="text-sm truncate flex-1">
                  {getJobTitle(job)}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatRelative(job.startedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderStatusRow({
  label,
  cli,
  queue,
  loaded,
}: {
  label: string;
  cli?: { available: boolean; version: string };
  queue?: ProviderQueueStatus;
  loaded: boolean;
}) {
  const available = cli?.available ?? false;
  return (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-2 min-w-[200px]">
        <span
          className={`w-2 h-2 rounded-full ${
            available
              ? "bg-[var(--color-status-success)]"
              : "bg-[var(--color-status-error)]"
          }`}
        />
        <span>{label}</span>
        {available ? (
          <span className="text-xs text-muted-foreground">
            {cli?.version || "연결됨"}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-status-error)]">
            {!loaded ? "확인중..." : "미설치"}
          </span>
        )}
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">대기열</span>
        <span>
          {queue?.running ? "1건 진행중" : "유휴"}
          {(queue?.queueLength ?? 0) > 0 && ` / ${queue!.queueLength}건 대기`}
        </span>
      </div>
    </div>
  );
}

function getJobTitle(job: Job): string {
  if (job.inputFiles && job.inputFiles.length > 0) {
    const pdf = job.inputFiles.find((f) => f.endsWith(".pdf"));
    if (pdf) return pdf.split("/").pop() ?? pdf;
  }
  return `작업 ${job.id.slice(0, 8)}`;
}

function formatRelative(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}
