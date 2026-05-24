"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type InlineSelectOption = { value: string; label: string };

/**
 * 클릭하면 같은 자리에서 select 로 토글되는 인라인 선택.
 * - change / blur: 저장 (값이 바뀐 경우에만 onSave 호출)
 * - Esc: 취소
 */
export function InlineSelect({
  value,
  options,
  onSave,
  display,
  className,
  selectClassName,
}: {
  value: string;
  options: InlineSelectOption[];
  onSave: (next: string) => Promise<void> | void;
  display?: ReactNode;
  className?: string;
  selectClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const enterEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  useEffect(() => {
    if (editing) selectRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(t);
  }, [error]);

  const commit = async (next: string) => {
    if (saving) return;
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
      setDraft(value);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className={cn("inline-flex flex-col gap-0.5 relative z-10", className)}>
        <select
          ref={selectRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            void commit(e.target.value);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setDraft(value); setEditing(false); }
          }}
          disabled={saving}
          className={cn(
            "px-2 py-0.5 border rounded bg-background outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50",
            selectClassName,
          )}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={enterEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          enterEdit();
        }
      }}
      title="클릭하여 편집"
      className={cn(
        "cursor-pointer rounded transition-colors hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-primary/30",
        className,
      )}
    >
      {display ?? options.find((o) => o.value === value)?.label ?? value}
    </span>
  );
}
