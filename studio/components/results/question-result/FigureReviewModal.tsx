"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { QuestionResult } from "@/lib/store";

export function FigureReviewModal({
  open,
  onClose,
  entries,
  jobId,
  globalLoading,
  onConfirm,
  onRetryFigure,
  onRetryAll,
}: {
  open: boolean;
  onClose: () => void;
  entries: QuestionResult[];
  jobId: string | null;
  globalLoading: string | null;
  onConfirm: () => void;
  onRetryFigure: (qNum: number) => void;
  onRetryAll: () => void;
}) {
  const figureProblems = useMemo(
    () => entries.filter((q) => (q.extracted as Record<string, unknown> | undefined)?.has_figure),
    [entries]
  );

  const [loadedSet, setLoadedSet] = useState<Set<number>>(new Set());
  // 재생성 진행 중인 문제 번호. 완료는 SSE figure 이벤트(= updatedAt 변화)로 판정한다.
  const [regenerating, setRegenerating] = useState<Set<number>>(new Set());
  // 재생성 클릭 시점의 updatedAt 스냅샷 — 이 값이 바뀌면 재생성 완료로 본다.
  const regenBaselineRef = useRef<Record<number, string>>({});

  // 재생성 완료 감지: regenerating 중인 문제의 updatedAt 이 baseline 과 달라지면
  // (= 새 figure SSE 이벤트 수신) 스피너를 끈다. 이미지 src 는 &v=updatedAt 이라
  // updatedAt 변화만으로 자동 갱신되므로 별도 캐시버스터 bump 는 필요 없다.
  useEffect(() => {
    if (regenerating.size === 0) return;
    const done = [...regenerating].filter((num) => {
      const q = figureProblems.find((p) => p.number === num);
      return q && q.updatedAt && q.updatedAt !== regenBaselineRef.current[num];
    });
    if (done.length === 0) return;
    setRegenerating((prev) => {
      const s = new Set(prev);
      for (const num of done) s.delete(num);
      return s;
    });
  }, [figureProblems, regenerating]);

  const handleRetry = (qNum: number) => {
    const q = figureProblems.find((p) => p.number === qNum);
    regenBaselineRef.current[qNum] = q?.updatedAt ?? "";
    setLoadedSet((prev) => {
      const s = new Set(prev);
      s.delete(qNum);
      return s;
    });
    setRegenerating((prev) => new Set(prev).add(qNum));
    onRetryFigure(qNum);
  };

  // 전체 재생성: 모든 문제를 regenerating 으로 표시하고 baseline 을 스냅샷한다.
  // 캐시버스터 bump 는 문제별 완료(SSE) 시점에 일어난다.
  const handleRetryAll = () => {
    for (const q of figureProblems) {
      regenBaselineRef.current[q.number] = q.updatedAt ?? "";
    }
    setLoadedSet(new Set());
    setRegenerating(new Set(figureProblems.map((q) => q.number)));
    onRetryAll();
  };

  const failedProblems = useMemo(
    () => figureProblems.filter((q) => q.figure?.status === "failed"),
    [figureProblems]
  );

  const allLoaded =
    figureProblems.length === 0 ||
    figureProblems.every((q) => loadedSet.has(q.number) || q.figure?.status === "failed");

  // ESC 닫기 (QuestionDetailModal 패턴 그대로)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-300"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border shadow-2xl w-[94vw] max-w-6xl h-[90vh] flex flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="shrink-0 px-6 py-4 border-b flex items-center justify-between bg-muted/5">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-foreground tracking-tight">
              그림 결과 확인 ({loadedSet.size}/{figureProblems.length})
            </span>
            <Badge
              variant="secondary"
              className="text-[10px] font-bold px-2 py-0 bg-muted/50 border-none text-muted-foreground uppercase tracking-widest"
            >
              Figure
            </Badge>
            {failedProblems.length > 0 && (
              <span className="text-[10px] font-bold text-destructive">
                실패 {failedProblems.length}개
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all flex items-center justify-center border border-transparent hover:border-border"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 컨텐츠 영역 — 자체 스크롤 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {figureProblems.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              그림이 있는 문제가 없습니다.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-muted-foreground">
                  그림 생성 결과 ({loadedSet.size}/{figureProblems.length})
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetryAll}
                  disabled={!jobId || globalLoading !== null || regenerating.size > 0}
                  className="h-7 text-xs"
                >
                  전체 재생성
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {figureProblems.map((q) => {
                  const v = encodeURIComponent(q.updatedAt ?? "");
                  const finalSrc = `/api/file?path=${encodeURIComponent(
                    `outputs/images/prob${q.number}_final.png`
                  )}&v=${v}`;
                  const refSrc = `/api/file?path=${encodeURIComponent(
                    `inputs/시험지 제작/.v3cache/prob${q.number}_ref.jpg`
                  )}&v=${v}`;
                  const loaded = loadedSet.has(q.number);
                  const isFailed = q.figure?.status === "failed";
                  const isRegenerating = regenerating.has(q.number);
                  return (
                    <div
                      key={q.number}
                      className={`space-y-2 rounded-lg p-3 ${isFailed ? "border border-destructive/30 bg-destructive/5" : "border border-border/40"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${isFailed && !isRegenerating ? "text-destructive" : "text-foreground"}`}>
                          {q.number}번 {isRegenerating ? "재생성 중..." : isFailed ? "✗ 생성 실패" : loaded ? "✓" : "생성 중..."}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRetry(q.number)}
                          disabled={!jobId || globalLoading !== null || isRegenerating}
                          className="h-7 text-xs"
                        >
                          재생성
                        </Button>
                      </div>
                      {isFailed && !isRegenerating ? (
                        <div className="rounded border border-destructive/20 bg-destructive/5 p-3 text-[10px] text-destructive/70 text-center min-h-[60px] flex items-center justify-center">
                          {q.figure?.error
                            ? <span className="font-mono break-all">{q.figure.error}</span>
                            : <span>figure_processor.py 실패</span>
                          }
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground text-center">크롭 원본</p>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={refSrc}
                              alt={`문제 ${q.number} 크롭 원본`}
                              className="w-full rounded border bg-white"
                            />
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground text-center">생성된 그림</p>
                            {/* 박스 크기는 이미지가 그대로 유지하고, 재생성 중엔 스피너를 위에 오버레이 — 레이아웃 흔들림 방지. */}
                            <div className="relative w-full min-h-[120px]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={finalSrc}
                                alt={`문제 ${q.number} 생성 그림`}
                                className={`w-full rounded border bg-white transition-opacity ${
                                  isRegenerating ? "opacity-40" : loaded ? "opacity-100" : "opacity-20"
                                }`}
                                onLoad={() =>
                                  setLoadedSet((prev) => new Set([...prev, q.number]))
                                }
                              />
                              {isRegenerating && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded bg-white/40 text-muted-foreground">
                                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  <span className="text-[10px]">재생성 중...</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* 확인 CTA — handleConfirmFigure(startJob, resumeFrom:"confirm") 경로 */}
          <div className="pt-2">
            <Button
              size="sm"
              disabled={!jobId || globalLoading !== null || !allLoaded}
              onClick={onConfirm}
              className="h-9 text-xs w-full"
            >
              {globalLoading === "confirm" ? (
                <svg
                  className="w-3 h-3 animate-spin mr-1"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : !allLoaded ? (
                `그림 생성 중... (${loadedSet.size}/${figureProblems.length})`
              ) : (
                "그림 확인 완료 — HWPX 조립 시작"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
