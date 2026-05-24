"use client";

import type { Part } from "./types";
import { InlineText } from "./inline/InlineText";
import { InlinePartsEditor } from "./inline/InlinePartsEditor";

export function SolutionView({
  sol,
  onSave,
}: {
  sol: Record<string, unknown>;
  onSave: (updated: Record<string, unknown>) => Promise<void>;
}) {
  const parts = (sol.explanation_parts as Part[] | undefined) ?? [];
  const answer = sol.answer;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 fill-mode-both">
      <h4 className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.2em]">EXPLANATION</h4>

      <div className="relative p-7 rounded-xl border bg-card shadow-sm border-border/80">
        <InlinePartsEditor
          parts={parts}
          onSave={(p) => onSave({ ...sol, explanation_parts: p })}
        />
      </div>

      <div className="pt-2 flex items-center gap-6">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-border/60" />
        <div className="px-8 py-2.5 rounded-lg border border-primary/20 bg-primary/[0.03] text-primary text-[13px] font-bold tracking-tight">
          <span className="text-[10px] font-bold opacity-60 mr-2 uppercase tracking-widest">정답:</span>
          <InlineText
            value={String(answer ?? "")}
            placeholder="정답 미지정"
            onSave={(v) => onSave({ ...sol, answer: v })}
            inputClassName="text-[13px] font-bold w-32"
          />
        </div>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-border/60" />
      </div>
    </div>
  );
}
