"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useJobStore } from "@/lib/store";
import { sendResumeAction } from "./resume";

const RESUME_ACTIONS = [
  { label: "이미지 재정리", from: "cleaned" },
  { label: "재추출", from: "extractor" },
  { label: "해설 재작성", from: "solver" },
  { label: "검증 재실행", from: "verifier" },
] as const;

export function ActionButtons({ qNum }: { qNum: number }) {
  const jobId = useJobStore((s) => s.jobId);
  const store = useJobStore();
  const [loading, setLoading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAction = useCallback(async (from: string) => {
    if (!jobId || loading !== null) return;
    setLoading(from);
    const instruction = `resume --q=${qNum} --from=${from}`;
    await sendResumeAction(jobId, instruction, store);
    setLoading(null);
  }, [jobId, loading, qNum, store]);

  const handleImageReplace = useCallback(async (file: File) => {
    if (!jobId || loading !== null) return;
    setLoading("image_replace");

    const formData = new FormData();
    formData.append("qNum", String(qNum));
    formData.append("file", file);

    try {
      const res = await fetch("/api/question-images", { method: "PATCH", body: formData });
      if (!res.ok) throw new Error("Upload failed");
    } catch {
      setLoading(null);
      return;
    }

    const instruction = `resume --q=${qNum} --from=image_replace`;
    await sendResumeAction(jobId, instruction, store);
    setLoading(null);
  }, [jobId, loading, qNum, store]);

  const disabled = !jobId || loading !== null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mr-2">Actions:</span>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageReplace(file);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        className="h-8 px-3 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        {loading === "image_replace" ? (
          <svg className="w-3 h-3 animate-spin mr-1.5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-3 h-3 mr-1.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        )}
        이미지 교체
      </Button>

      {RESUME_ACTIONS.map((action) => (
        <Button
          key={action.from}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => handleAction(action.from)}
          className="h-8 px-3 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {loading === action.from && (
            <svg className="w-3 h-3 animate-spin mr-1.5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {action.label}
        </Button>
      ))}
    </div>
  );
}
