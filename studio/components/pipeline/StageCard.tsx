"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "./PipelineView";

export type StageStatus = "pending" | "running" | "done" | "failed";

const stageColors: Record<string, { dot: string; bg: string }> = {
  reader:   { dot: "bg-[var(--color-stage-reader)]",   bg: "bg-[var(--color-stage-reader-bg)]" },
  solver:   { dot: "bg-[var(--color-stage-solver)]",   bg: "bg-[var(--color-stage-solver-bg)]" },
  figure:   { dot: "bg-[var(--color-stage-figure)]",   bg: "bg-[var(--color-stage-figure-bg)]" },
  builder:  { dot: "bg-[var(--color-stage-builder)]",  bg: "bg-[var(--color-stage-builder-bg)]" },
  checker:  { dot: "bg-[var(--color-stage-checker)]",  bg: "bg-[var(--color-stage-checker-bg)]" },
  reviewer: { dot: "bg-[var(--color-stage-solver)]",   bg: "bg-[var(--color-stage-solver-bg)]" },
};

const statusConfig: Record<StageStatus, { icon: React.ReactNode; label: string }> = {
  pending: {
    icon: <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30" />,
    label: "대기",
  },
  running: {
    icon: (
      <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-status-info)] animate-pulse" />
    ),
    label: "진행중",
  },
  done: {
    icon: (
      <svg className="w-3.5 h-3.5 text-[var(--color-status-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    label: "완료",
  },
  failed: {
    icon: (
      <svg className="w-3.5 h-3.5 text-[var(--color-status-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
    label: "실패",
  },
};

interface StageCardProps {
  stage: PipelineStage;
  isLast: boolean;
}

export function StageCard({ stage, isLast }: StageCardProps) {
  const colors = stageColors[stage.name] ?? { dot: "bg-muted-foreground", bg: "bg-muted" };
  const status = statusConfig[stage.status];
  const isActive = stage.status === "running" || stage.status === "done";

  // running 상태일 때 1초마다 강제 리렌더하여 타이머 실시간 갱신
  const [, setTick] = useState(0);
  useEffect(() => {
    if (stage.status !== "running") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [stage.status]);

  const elapsed = getElapsed(stage.startedAt, stage.finishedAt);

  return (
    <div className="flex gap-3">
      {/* Timeline */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "w-3 h-3 rounded-full mt-1.5 shrink-0",
            isActive ? colors.dot : "bg-muted-foreground/20"
          )}
        />
        {!isLast && (
          <div className={cn(
            "w-px flex-1 mt-1",
            stage.status === "done" ? "bg-border" : "bg-border/50"
          )} />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex-1 rounded-md px-3 py-2.5 mb-2 transition-colors",
          stage.status === "running" ? colors.bg : "",
          stage.status === "pending" ? "opacity-50" : ""
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {status.icon}
            <span className="text-sm font-medium">{stage.label}</span>
            <span className="text-xs text-muted-foreground">{status.label}</span>
          </div>
          {elapsed && (
            <span className="text-xs text-muted-foreground font-mono">
              {elapsed}
            </span>
          )}
        </div>

        {stage.status === "running" && stage.progress != null && (
          <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-500", colors.dot)}
              style={{ width: `${stage.progress}%` }}
            />
          </div>
        )}

        {stage.summary && (
          <p className="mt-1.5 text-xs text-muted-foreground">{stage.summary}</p>
        )}
      </div>
    </div>
  );
}

function getElapsed(start?: string, end?: string): string | null {
  if (!start) return null;
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.floor((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}
