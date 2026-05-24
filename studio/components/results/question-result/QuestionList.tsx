"use client";

import { useEffect } from "react";
import { useJobStore, type QuestionResult } from "@/lib/store";
import { useSortedEntries } from "./hooks";

export function statusOf(qr: QuestionResult): { color: string; phases: string } {
  const ver = qr.verified as Record<string, unknown> | undefined;
  const sol = qr.solved as Record<string, unknown> | undefined;
  const ext = qr.extracted as Record<string, unknown> | undefined;

  // Use colors matching the navigator dots
  const color = ver
    ? "bg-emerald-500/80"
    : sol
    ? "bg-amber-500/80"
    : ext
    ? "bg-blue-500/80"
    : "bg-muted";

  const phases: string[] = [];
  if (ext) phases.push("추출");
  if (sol) phases.push("해설");
  if (ver) phases.push("검증");
  return { color, phases: phases.join(" → ") };
}

function QuestionListItem({
  qr,
  selected,
  onSelect,
}: {
  qr: QuestionResult;
  selected: boolean;
  onSelect: () => void;
}) {
  const ext = qr.extracted as Record<string, unknown> | undefined;
  const sol = qr.solved as Record<string, unknown> | undefined;
  const ver = qr.verified as Record<string, unknown> | undefined;
  const fig = qr.figure;
  const verStatus = ver ? String((ver as Record<string, unknown>).status ?? "") : "";
  const hasFigure = !!(ext as Record<string, unknown> | undefined)?.has_figure;
  const subtopic = ext && (ext.subtopic ?? "") ? String(ext.subtopic) : "";

  const verDotCls = ver
    ? verStatus === "fail"
      ? "bg-destructive/70"
      : "bg-[var(--color-status-success)]/70"
    : "bg-muted";

  // figure dot 색/title 결정:
  //  - 그림 결과 도착(fig 있음): status에 따라 색
  //  - 그림 필요(has_figure)지만 결과 없음: 회색 "그림 대기"
  //  - 그림 불필요: dot 숨김
  let figDotCls = "";
  let figDotTitle = "";
  if (fig) {
    if (fig.status === "ok") {
      figDotCls = "bg-[var(--color-status-success)]/70";
      figDotTitle = "그림 완료";
    } else if (fig.status === "failed") {
      figDotCls = "bg-destructive/70";
      figDotTitle = "그림 실패";
    } else {
      // boundary_uncertain
      figDotCls = "bg-amber-400/70";
      figDotTitle = "그림 경계 재조정 필요";
    }
  } else if (hasFigure) {
    figDotCls = "bg-muted";
    figDotTitle = "그림 대기";
  }

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left border-l-2 transition-colors ${
        selected
          ? "border-l-primary bg-primary/5"
          : "border-l-transparent hover:bg-muted/50"
      }`}
    >
      <span className="text-sm font-medium shrink-0">{qr.number}번</span>
      {subtopic && (
        <span className="text-[10px] text-muted-foreground truncate flex-1 min-w-0">
          {subtopic}
        </span>
      )}
      <span className="flex items-center gap-1 shrink-0 ml-auto">
        <span
          title={ext ? "추출 완료" : "추출 대기"}
          className={`w-1.5 h-1.5 rounded-full ${ext ? "bg-blue-400/70" : "bg-muted"}`}
        />
        <span
          title={sol ? "풀이 완료" : "풀이 대기"}
          className={`w-1.5 h-1.5 rounded-full ${sol ? "bg-amber-400/70" : "bg-muted"}`}
        />
        <span
          title={ver ? (verStatus === "fail" ? "검증 실패" : "검증 완료") : "검증 대기"}
          className={`w-1.5 h-1.5 rounded-full ${verDotCls}`}
        />
        {figDotCls && (
          <span
            title={figDotTitle}
            className={`w-1.5 h-1.5 rounded-full ${figDotCls}`}
          />
        )}
      </span>
    </button>
  );
}

/** 좌측 master: 문제 번호 리스트만. 페이지에서 단독 마운트 가능. */
export function QuestionList({ onItemClick }: { onItemClick?: (qNum: number) => void } = {}) {
  const entries = useSortedEntries();
  const selectedNum = useJobStore((s) => s.selectedQuestionNumber);
  const setSelectedNum = useJobStore((s) => s.setSelectedQuestionNumber);

  // Auto-select first entry on mount/update.
  useEffect(() => {
    if (entries.length === 0) {
      if (selectedNum !== null) setSelectedNum(null);
      return;
    }
    if (selectedNum == null || !entries.find((q) => q.number === selectedNum)) {
      setSelectedNum(entries[0].number);
    }
  }, [entries, selectedNum, setSelectedNum]);

  if (entries.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">아직 추출된 문제 없음</div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      {entries.map((qr) => (
        <QuestionListItem
          key={qr.number}
          qr={qr}
          selected={qr.number === selectedNum}
          onSelect={() => {
            setSelectedNum(qr.number);
            onItemClick?.(qr.number);
          }}
        />
      ))}
    </div>
  );
}
