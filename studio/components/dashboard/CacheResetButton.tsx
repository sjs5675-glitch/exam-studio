"use client";

import { useState } from "react";
import { Trash2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "working" | "done" | "failed";

/**
 * 진행 중인 시험지 캐시(.v3cache)를 수동으로 비우는 버튼.
 * 코드 업데이트로 추출/해설 형식이 바뀐 뒤 옛 캐시가 그대로 표시·resume 되는 것을
 * 막기 위함. 작업물이 지워지므로 confirm 후 실행한다.
 */
export function CacheResetButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  const reset = async () => {
    const ok = window.confirm(
      "진행 중인 시험지 작업 캐시를 모두 비웁니다.\n" +
        "추출·해설 결과가 삭제되어 다음 작업은 처음부터 다시 생성됩니다.\n계속할까요?"
    );
    if (!ok) return;
    setPhase("working");
    setError("");
    try {
      const r = await fetch("/api/v3cache-clear", { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setPhase("done");
      } else {
        setError(d.error ?? "캐시 비우기에 실패했습니다.");
        setPhase("failed");
      }
    } catch {
      setError("캐시 비우기 중 오류가 발생했습니다.");
      setPhase("failed");
    }
  };

  return (
    <div className="flex items-center gap-2">
      {phase === "done" && (
        <span className="text-xs text-[var(--color-status-success)] flex items-center gap-1">
          <CheckCircle2 className="size-3" /> 비웠습니다
        </span>
      )}
      {phase === "failed" && (
        <span className="text-xs text-[var(--color-status-error)] flex items-center gap-1">
          <AlertTriangle className="size-3" /> {error}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={reset}
        disabled={phase === "working"}
        title="진행 중 작업 캐시 비우기"
      >
        {phase === "working" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
        캐시 비우기
      </Button>
    </div>
  );
}
