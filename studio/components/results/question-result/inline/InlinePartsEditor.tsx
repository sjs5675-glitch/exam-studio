"use client";

import { cn } from "@/lib/utils";
import type { Part } from "../types";
import { InlineText } from "./InlineText";

/**
 * Part[] (텍스트/수식/줄바꿈 chunk 배열) 인라인 편집 — "값 수정" 전용.
 * - text chip: 클릭 → input 토글
 * - eq chip: 클릭 → textarea 토글 (multiline, Enter 저장 / Shift+Enter 줄바꿈)
 * - br chip: 표시만 (수정 불가)
 * - 추가/중간 삽입/명시적 삭제 UI 는 없음. parts 분할 자체는 LLM/HWPX 단계의 책임.
 * - 텍스트/수식 chip 의 값이 빈 문자열로 저장되면 자동 삭제 (오타로 비워진 chunk 정리).
 */
export function InlinePartsEditor({
  parts,
  onSave,
  className,
}: {
  parts: Part[];
  onSave: (next: Part[]) => Promise<void> | void;
  className?: string;
}) {
  const replaceAt = (i: number, p: Part | null): Part[] => {
    const next = parts.slice();
    if (p === null) next.splice(i, 1);
    else next[i] = p;
    return next;
  };

  return (
    <div className={cn("leading-relaxed text-[15px] text-foreground/90 flex flex-wrap items-baseline gap-x-1 gap-y-1.5", className)}>
      {parts.map((p, i) => {
        if (p.br) return <BrChip key={i} />;
        if (p.eq !== undefined) {
          return (
            <EqChip
              key={i}
              value={p.eq}
              onSave={(v) => onSave(v === "" ? replaceAt(i, null) : replaceAt(i, { eq: v }))}
            />
          );
        }
        return (
          <TextChip
            key={i}
            value={p.t ?? ""}
            onSave={(v) => onSave(v === "" ? replaceAt(i, null) : replaceAt(i, { t: v }))}
          />
        );
      })}
    </div>
  );
}

function TextChip({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<void> | void;
}) {
  return (
    <InlineText
      value={value}
      onSave={onSave}
      placeholder="텍스트"
      className="px-1.5 py-0.5 bg-muted/30 rounded text-[14px]"
      inputClassName="text-[14px] min-w-[80px]"
    />
  );
}

function EqChip({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<void> | void;
}) {
  return (
    <InlineText
      value={value}
      onSave={onSave}
      multiline
      placeholder="수식"
      display={
        <code className="px-1.5 py-0.5 text-[11px] font-mono bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded border border-blue-100 dark:border-blue-800/50">
          {value}
        </code>
      }
      inputClassName="font-mono text-[11px] w-[300px] bg-blue-50/50 dark:bg-blue-900/20"
    />
  );
}

function BrChip() {
  return (
    <span className="basis-full text-[10px] text-muted-foreground/60 italic select-none px-1 border-l-2 border-muted-foreground/20">
      ↵ 줄바꿈
    </span>
  );
}
