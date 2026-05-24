"use client";

import { cn } from "@/lib/utils";
import { StageCard, type StageStatus } from "./StageCard";

export interface PipelineStage {
  name: string;
  label: string;
  status: StageStatus;
  summary?: string;
  progress?: number;
  startedAt?: string;
  finishedAt?: string;
}

const defaultCreateStages: PipelineStage[] = [
  { name: "extractor", label: "문제 추출", status: "pending" },
  { name: "solver", label: "해설 생성", status: "pending" },
  { name: "verifier", label: "해설 검증", status: "pending" },
  { name: "figure", label: "그림 처리", status: "pending" },
  { name: "builder", label: "HWPX 조립", status: "pending" },
  { name: "checker", label: "품질 검수", status: "pending" },
];

interface PipelineViewProps {
  mode: "create";
  stages?: PipelineStage[];
  /** "vertical" (기본) — timeline 형태 / "horizontal" — 가로 dot+label 형태 */
  orientation?: "vertical" | "horizontal";
}

const statusDotColor: Record<StageStatus, string> = {
  pending: "bg-muted-foreground/30",
  running: "bg-[var(--color-status-info)] animate-pulse",
  done: "bg-[var(--color-status-success)]",
  failed: "bg-[var(--color-status-error)]",
};

function HorizontalStage({ stage, isLast }: { stage: PipelineStage; isLast: boolean }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <div className="flex flex-col items-center gap-1 shrink-0">
        <span className={cn("w-3 h-3 rounded-full", statusDotColor[stage.status])} />
        <span className={cn(
          "text-[10px] whitespace-nowrap",
          stage.status === "running" ? "text-foreground font-medium"
            : stage.status === "done" ? "text-foreground"
            : "text-muted-foreground"
        )}>{stage.label}</span>
        {stage.status === "running" && stage.progress != null && (
          <span className="text-[9px] text-muted-foreground">{stage.progress}%</span>
        )}
      </div>
      {!isLast && (
        <div className={cn(
          "h-px w-6 mb-4 shrink-0",
          stage.status === "done" ? "bg-border" : "bg-border/40"
        )} />
      )}
    </div>
  );
}

export function PipelineView({ stages, orientation = "vertical" }: PipelineViewProps) {
  const defaults = defaultCreateStages;
  const displayStages = stages ?? defaults;

  if (orientation === "horizontal") {
    return (
      <div className="flex items-start gap-0 overflow-x-auto py-1">
        {displayStages.map((stage, i) => (
          <HorizontalStage key={stage.name} stage={stage} isLast={i === displayStages.length - 1} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        파이프라인
      </h3>
      <div className="space-y-2">
        {displayStages.map((stage, i) => (
          <StageCard
            key={stage.name}
            stage={stage}
            isLast={i === displayStages.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
