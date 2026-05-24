"use client";

import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { useSelectedEntry } from "./hooks";
import { QuestionDetail } from "./QuestionDetail";

/** 문제 상세를 큰 팝업 모달로 띄운다. 네비게이터 클릭 시 사용. */
export function QuestionDetailModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { selected } = useSelectedEntry();

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !selected) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-300"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border shadow-2xl w-[94vw] max-w-6xl h-[90vh] flex flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-6 py-4 border-b flex items-center justify-between bg-muted/5">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-foreground tracking-tight">문제 {selected.number}번 상세 정보</span>
            <Badge variant="secondary" className="text-[10px] font-bold px-2 py-0 bg-muted/50 border-none text-muted-foreground uppercase tracking-widest">Inspector</Badge>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all flex items-center justify-center border border-transparent hover:border-border"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <QuestionDetail qr={selected} />
        </div>
      </div>
    </div>
  );
}
