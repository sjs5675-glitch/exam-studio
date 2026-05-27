"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Download, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface CommitInfo {
  hash: string;
  date: string;
  subject: string;
}

interface UpdateStatus {
  ok: boolean;
  offline?: boolean;
  branch?: string;
  current?: CommitInfo | null;
  updateAvailable?: boolean;
  behind?: number;
  commits?: CommitInfo[];
  error?: string;
}

type Phase = "checking" | "idle" | "updating" | "done" | "update-failed";

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export function UpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [updateError, setUpdateError] = useState<string>("");

  const check = useCallback(async () => {
    setPhase("checking");
    try {
      const r = await fetch("/api/update", { method: "GET" });
      const d: UpdateStatus = await r.json();
      setStatus(d);
    } catch {
      setStatus({ ok: false, error: "업데이트 확인 중 오류가 발생했습니다." });
    } finally {
      setPhase("idle");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const applyUpdate = useCallback(async () => {
    setPhase("updating");
    setUpdateError("");
    try {
      const r = await fetch("/api/update", { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setPhase("done");
      } else {
        setUpdateError(d.error ?? "업데이트에 실패했습니다.");
        setPhase("update-failed");
      }
    } catch {
      setUpdateError("업데이트 중 오류가 발생했습니다. 인터넷 연결을 확인해 주세요.");
      setPhase("update-failed");
    }
  }, []);

  const current = status?.current;
  const versionLabel = current
    ? `현재 버전 ${current.hash} (${formatDate(current.date)})`
    : "버전 정보 확인 중";

  return (
    <Card className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold leading-none">프로그램 업데이트</h3>
        {(phase === "idle" || phase === "update-failed") && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={check}
            aria-label="업데이트 다시 확인"
            title="다시 확인"
          >
            <RefreshCw className="size-4" />
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{versionLabel}</p>

      <div className="flex-1">
        {phase === "checking" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            업데이트 확인 중...
          </div>
        )}

        {phase === "idle" && status?.offline && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-orange-400" />
            <span>인터넷에 연결되어 있지 않아 업데이트를 확인할 수 없습니다.</span>
          </div>
        )}

        {phase === "idle" && status && !status.ok && (
          <div className="flex items-start gap-2 text-sm text-[var(--color-status-error)]">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>{status.error}</span>
          </div>
        )}

        {phase === "idle" && status?.ok && !status.offline && !status.updateAvailable && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-[var(--color-status-success)]" />
            최신 버전입니다.
          </div>
        )}

        {phase === "idle" && status?.ok && status.updateAvailable && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              새 업데이트가 있습니다{" "}
              <span className="text-muted-foreground font-normal">
                (변경 {status.behind}건)
              </span>
            </p>
            {status.commits && status.commits.length > 0 && (
              <ul className="text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
                {status.commits.slice(0, 5).map((c) => (
                  <li key={c.hash} className="truncate">
                    · {c.subject}
                  </li>
                ))}
                {status.commits.length > 5 && (
                  <li className="text-muted-foreground/70">
                    외 {status.commits.length - 5}건...
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {phase === "updating" && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              업데이트 중입니다...
            </div>
            <p className="text-xs text-muted-foreground">
              몇 분 걸릴 수 있어요. 이 창을 닫지 마세요.
            </p>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-status-success)]">
              <CheckCircle2 className="size-4" />
              업데이트 완료!
            </div>
            <p className="text-xs text-muted-foreground">
              프로그램을 완전히 종료한 뒤, 시작 파일을 다시 실행해 주세요.
            </p>
          </div>
        )}

        {phase === "update-failed" && (
          <div className="flex items-start gap-2 text-sm text-[var(--color-status-error)]">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>{updateError}</span>
          </div>
        )}
      </div>

      {phase === "idle" && status?.ok && status.updateAvailable && (
        <Button onClick={applyUpdate} className="w-full">
          <Download className="size-4" />
          지금 업데이트
        </Button>
      )}
    </Card>
  );
}
