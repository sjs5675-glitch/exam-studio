"use client";

import { CONDITION_BOX_LABEL, type Part } from "../types";
import { InlinePartsEditor } from "./InlinePartsEditor";

export function ConditionBoxEditor({
  cb,
  onSave,
}: {
  cb: Record<string, unknown>;
  onSave: (next: Record<string, unknown>) => Promise<void> | void;
}) {
  const typeLabel = CONDITION_BOX_LABEL[String(cb.type ?? "")] ?? String(cb.type ?? "");
  const items = Array.isArray(cb.items) ? (cb.items as { label: string; parts: Part[] }[]) : [];

  return (
    <div className="space-y-2">
      <span className="text-[10px] text-muted-foreground">[{typeLabel}]</span>
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-start">
          <span className="font-medium shrink-0 text-[14px] pt-0.5">{item.label}.</span>
          <div className="flex-1">
            <InlinePartsEditor
              parts={item.parts ?? []}
              onSave={(p) => {
                const nextItems = items.slice();
                nextItems[i] = { ...item, parts: p };
                onSave({ ...cb, items: nextItems });
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
