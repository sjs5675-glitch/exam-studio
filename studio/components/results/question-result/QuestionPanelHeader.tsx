"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useJobStore } from "@/lib/store";
import { sendResumeAction } from "./resume";
import { useSortedEntries } from "./hooks";

/** 상단 컨트롤 bar: 추출 편집 진행 / 추출 결과 검증 / Figure 확인 버튼 진입점. */
export function QuestionPanelHeader({
  onOpenFigureModal,
}: {
  onOpenFigureModal?: () => void;
}) {
  const entries = useSortedEntries();
  const jobId = useJobStore((s) => s.jobId);
  const status = useJobStore((s) => s.status);
  const reviewActive = useJobStore((s) => s.extractionReviewActive);
  const setReviewActive = useJobStore((s) => s.setExtractionReviewActive);
  const store = useJobStore();
  const [globalLoading, setGlobalLoading] = useState<string | null>(null);

  // figure 문제 진행률 (버튼 라벨용)
  const figureProblems = useMemo(
    () => entries.filter((q) => (q.extracted as Record<string, unknown> | undefined)?.has_figure),
    [entries]
  );
  const loadedFigureCount = useMemo(
    () => figureProblems.filter((q) => q.figure?.status === "ok").length,
    [figureProblems]
  );
  const figureProblemCount = figureProblems.length;
  const allFiguresLoaded = figureProblemCount === 0 || loadedFigureCount >= figureProblemCount;

  if (entries.length === 0) return null;
  const doneCount = entries.filter((q) => q.verified || q.solved).length;
  const isDone = status === "done" || status === "failed";

  const handleGlobalAction = async (from: string) => {
    if (!jobId || status === "running") return;
    setGlobalLoading(from);
    const instruction = `resume --from=${from}`;
    if (from === "solver") setReviewActive(false);
    await sendResumeAction(jobId, instruction, store);
    setGlobalLoading(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          문제별 결과 {reviewActive && <span className="text-blue-600 ml-2">(추출 편집 모드)</span>}
        </h3>
        <span className="text-xs text-muted-foreground">
          {doneCount}/{entries.length}문제 처리
        </span>
      </div>

      {reviewActive && isDone && (
        <div className="space-y-2 pb-2 border-b">
          <div className="text-xs text-muted-foreground">
            모든 문제의 추출 결과를 확인/편집한 후 [진행]을 누르면 해설 생성을 시작합니다.
          </div>
          <Button
            size="sm"
            disabled={globalLoading !== null}
            onClick={() => handleGlobalAction("solver")}
            className="h-8 text-xs w-full"
          >
            {globalLoading === "solver" ? (
              <svg className="w-3 h-3 animate-spin mr-1" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : null}
            진행 → 해설 생성 시작
          </Button>
        </div>
      )}

      {!reviewActive && isDone && entries.some((q) => q.extracted && !q.solved) && (
        <div className="pb-2 border-b">
          <Button
            variant="outline"
            size="sm"
            disabled={globalLoading !== null}
            onClick={() => handleGlobalAction("review_extract")}
            className="h-7 text-xs w-full"
          >
            추출 결과 검증
          </Button>
        </div>
      )}

      {!reviewActive && isDone && figureProblemCount > 0 && (
        <div className="space-y-2 pb-2 border-b">
          <Button
            variant={allFiguresLoaded ? "outline" : "default"}
            size="sm"
            disabled={globalLoading !== null}
            onClick={onOpenFigureModal}
            className={cn(
              "h-8 text-xs w-full",
              !allFiguresLoaded && "bg-amber-600 hover:bg-amber-700 text-white animate-pulse"
            )}
          >
            그림 결과 확인 ({loadedFigureCount}/{figureProblemCount}{allFiguresLoaded ? " ✓" : ""})
          </Button>
        </div>
      )}
    </div>
  );
}
