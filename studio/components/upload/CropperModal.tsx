"use client";

import { useEffect, forwardRef } from "react";
import { Badge } from "@/components/ui/badge";
import { CropperWorkspace, type CropperWorkspaceRef } from "@/components/cropper/CropperWorkspace";

interface CropperModalProps {
  open: boolean;
  onClose: () => void;
  onExtract: (items: { number: number; kind?: "regular" | "essay"; blob: Blob }[]) => Promise<void>;
  autoSplitOnUpload: boolean;
  onPdfSelected: (path: string) => void;
}

export const CropperModal = forwardRef<CropperWorkspaceRef, CropperModalProps>(
  function CropperModal({ open, onClose, onExtract, autoSplitOnUpload, onPdfSelected }, ref) {
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
          className="bg-background border border-border shadow-2xl w-[96vw] max-w-[1000px] h-[95vh] flex flex-col overflow-hidden rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 px-6 py-4 border-b flex items-center justify-between bg-muted/5">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-foreground tracking-tight">PDF 크롭 작업</span>
              <Badge
                variant="secondary"
                className="text-[10px] font-bold px-2 py-0 bg-muted/50 border-none text-muted-foreground uppercase tracking-widest"
              >
                Cropper
              </Badge>
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
            <CropperWorkspace
              ref={ref}
              onExtract={async (items) => {
                await onExtract(items);
                onClose();
              }}
              autoSplitOnUpload={autoSplitOnUpload}
              onPdfSelected={onPdfSelected}
            />
          </div>
        </div>
      </div>
    );
  }
);
