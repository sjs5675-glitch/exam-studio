"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 클릭하면 같은 자리에서 input/textarea 로 토글되는 인라인 텍스트 편집.
 * - Enter / blur: 저장 (값이 바뀐 경우에만 onSave 호출)
 *   - multiline=true 일 땐 Shift+Enter 줄바꿈, Enter 저장
 * - Esc: 취소
 * - onSave 가 throw 하면 에러 메시지를 잠시 표시하고 값은 원래대로 복귀
 */
export function InlineText({
  value,
  onSave,
  placeholder,
  display,
  className,
  inputClassName,
  multiline = false,
}: {
  value: string;
  onSave: (next: string) => Promise<void> | void;
  placeholder?: string;
  display?: ReactNode;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const enterEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(t);
  }, [error]);

  const commit = async () => {
    if (saving) return;
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
      setDraft(value);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    const commonProps = {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !(multiline && e.shiftKey)) {
          e.preventDefault();
          void commit();
        }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
      },
      placeholder,
      disabled: saving,
      className: cn(
        "px-2 py-0.5 border rounded bg-background outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50",
        inputClassName,
      ),
    };
    return (
      <span className={cn("inline-flex flex-col gap-0.5 relative z-10", className)}>
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            rows={3}
            {...commonProps}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            {...commonProps}
          />
        )}
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
        "cursor-text rounded transition-colors hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-primary/30",
        className,
      )}
    >
      {display ?? (value || <span className="text-muted-foreground italic">{placeholder ?? "(비어 있음)"}</span>)}
    </span>
  );
}
