"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface QuestionSlot {
  number: number;
  /** Object URL for preview (PNG or rendered PDF page) */
  previewUrl: string | null;
  /** Original file (PDF or PNG) */
  file: File | null;
  /** Source file name */
  fileName: string | null;
}

interface QuestionSlotGridProps {
  maxQuestions?: number;
  onChange?: (slots: QuestionSlot[]) => void;
}

export function QuestionSlotGrid({
  maxQuestions = 18,
  onChange,
}: QuestionSlotGridProps) {
  const [slots, setSlots] = useState<QuestionSlot[]>(() =>
    Array.from({ length: maxQuestions }, (_, i) => ({
      number: i + 1,
      previewUrl: null,
      file: null,
      fileName: null,
    }))
  );
  const [draggingOver, setDraggingOver] = useState<number | null>(null);
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // Update max questions
  const updateSlotCount = useCallback(
    (count: number) => {
      setSlots((prev) => {
        if (count === prev.length) return prev;
        if (count > prev.length) {
          return [
            ...prev,
            ...Array.from({ length: count - prev.length }, (_, i) => ({
              number: prev.length + i + 1,
              previewUrl: null,
              file: null,
              fileName: null,
            })),
          ];
        }
        // Shrink: revoke URLs
        prev.slice(count).forEach((s) => {
          if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
        });
        return prev.slice(0, count);
      });
    },
    []
  );

  const processFile = useCallback(
    async (file: File, slotIndex: number) => {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      let previewUrl: string;

      if (isPdf) {
        // Upload PDF and get first page render
        const formData = new FormData();
        formData.append("mode", "create");
        formData.append("files", file);

        try {
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });
          const uploadData = await uploadRes.json();
          const pdfPath = uploadData.files?.[0]?.path;

          if (!pdfPath) throw new Error("Upload failed");

          const renderRes = await fetch("/api/pdf-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pdfPath, page: 0, dpi: 150 }),
          });

          if (!renderRes.ok) throw new Error("Render failed");

          const blob = await renderRes.blob();
          previewUrl = URL.createObjectURL(blob);
        } catch {
          // Fallback: just show a PDF icon
          previewUrl = "";
        }
      } else {
        // PNG/JPG: direct preview
        previewUrl = URL.createObjectURL(file);
      }

      setSlots((prev) => {
        const next = [...prev];
        // Revoke old URL
        if (next[slotIndex].previewUrl) {
          URL.revokeObjectURL(next[slotIndex].previewUrl);
        }
        next[slotIndex] = {
          ...next[slotIndex],
          previewUrl,
          file,
          fileName: file.name,
        };
        return next;
      });
    },
    []
  );

  useEffect(() => {
    onChange?.(slots);
  }, [slots, onChange]);

  // Clipboard paste handler
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      // Only handle if a slot is selected
      if (selectedSlot === null) return;
      const slotIndex = selectedSlot - 1;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        // Handle pasted images (screenshots, cropped images)
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          const ext = item.type.split("/")[1] || "png";
          const file = new File(
            [blob],
            `paste_q${selectedSlot}.${ext}`,
            { type: item.type }
          );
          processFile(file, slotIndex);

          // Auto-advance to next empty slot
          const nextEmpty = slots.findIndex(
            (s, idx) => idx > slotIndex && s.file === null
          );
          if (nextEmpty !== -1) {
            setSelectedSlot(slots[nextEmpty].number);
          }
          return;
        }
      }
    },
    [selectedSlot, processFile, slots]
  );

  // Attach paste listener to document
  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleDrop = useCallback(
    (e: React.DragEvent, slotIndex: number) => {
      e.preventDefault();
      setDraggingOver(null);

      const file = e.dataTransfer.files[0];
      if (!file) return;

      const ext = file.name.toLowerCase();
      if (!ext.endsWith(".pdf") && !ext.endsWith(".png") && !ext.endsWith(".jpg") && !ext.endsWith(".jpeg")) {
        return;
      }

      processFile(file, slotIndex);
    },
    [processFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, slotIndex: number) => {
      const file = e.target.files?.[0];
      if (file) processFile(file, slotIndex);
      e.target.value = "";
    },
    [processFile]
  );

  const clearSlot = useCallback(
    (slotIndex: number, e: React.MouseEvent) => {
      e.stopPropagation();
      setSlots((prev) => {
        const next = [...prev];
        if (next[slotIndex].previewUrl) {
          URL.revokeObjectURL(next[slotIndex].previewUrl);
        }
        next[slotIndex] = {
          ...next[slotIndex],
          previewUrl: null,
          file: null,
          fileName: null,
        };
        return next;
      });
    },
    []
  );

  const clearAll = useCallback(() => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
        return { ...s, previewUrl: null, file: null, fileName: null };
      })
    );
  }, []);

  const filledCount = slots.filter((s) => s.file !== null).length;
  const expandedPreviewUrl = expandedSlot ? slots[expandedSlot - 1]?.previewUrl : null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">문제별 이미지</h3>
          <span className="text-xs text-muted-foreground">
            {filledCount}/{slots.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={slots.length}
            onChange={(e) => updateSlotCount(Number(e.target.value))}
            className="text-xs border rounded px-2 py-1 bg-background"
          >
            {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}문항
              </option>
            ))}
          </select>
          {filledCount > 0 && (
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              전체 삭제
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-5 gap-2">
        {slots.map((slot, i) => (
          <div
            key={slot.number}
            onDragOver={(e) => {
              e.preventDefault();
              setDraggingOver(slot.number);
            }}
            onDragLeave={() => setDraggingOver(null)}
            onDrop={(e) => handleDrop(e, i)}
            onMouseEnter={() => setSelectedSlot(slot.number)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                if (slot.file) clearSlot(i, e as unknown as React.MouseEvent);
              }
            }}
            onClick={() => {
              setSelectedSlot(slot.number);
              if (slot.previewUrl) {
                // Double-click to expand
              } else {
                fileInputRefs.current[slot.number]?.click();
              }
            }}
            onDoubleClick={() => {
              if (slot.previewUrl) {
                setExpandedSlot(expandedSlot === slot.number ? null : slot.number);
              }
            }}
            className={cn(
              "relative aspect-[3/4] border rounded-md flex flex-col items-center justify-center cursor-pointer transition-all overflow-hidden group outline-none",
              draggingOver === slot.number
                ? "border-primary/60 bg-accent ring-2 ring-primary/20"
                : selectedSlot === slot.number
                  ? "border-primary ring-2 ring-primary/40"
                  : slot.file
                    ? "border-primary/30 bg-accent/30"
                    : "border-dashed border-border hover:border-primary/30 hover:bg-accent/30"
            )}
          >
            <input
              ref={(el) => { fileInputRefs.current[slot.number] = el; }}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => handleFileInput(e, i)}
              className="hidden"
            />

            {slot.previewUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slot.previewUrl}
                  alt={`Q${slot.number}`}
                  className="w-full h-full object-cover"
                />
                {/* Overlay with number */}
                <div className="absolute top-0 left-0 bg-primary/80 text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-br">
                  {slot.number}
                </div>
                {/* Clear button */}
                <button
                  onClick={(e) => clearSlot(i, e)}
                  className="absolute top-0 right-0 bg-destructive/80 text-white text-[10px] p-0.5 rounded-bl opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                {/* Replace button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRefs.current[slot.number]?.click();
                  }}
                  className="absolute bottom-0 right-0 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-tl opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  교체
                </button>
              </>
            ) : (
              <>
                <span className="text-lg font-semibold text-muted-foreground/40">
                  {slot.number}
                </span>
                <span className="text-[9px] text-muted-foreground/40 mt-0.5">
                  PDF / PNG
                </span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Expanded preview */}
      {expandedSlot !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-8"
          onClick={() => setExpandedSlot(null)}
        >
          <div
            className="relative max-w-3xl max-h-[85vh] bg-background rounded-lg overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b">
              <span className="text-sm font-medium">
                {expandedSlot}번 문제 —{" "}
                {slots[expandedSlot - 1]?.fileName}
              </span>
              <button
                onClick={() => setExpandedSlot(null)}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(85vh-48px)] p-4">
              {expandedPreviewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={expandedPreviewUrl}
                  alt={`Q${expandedSlot} expanded`}
                  className="w-full object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        칸을 클릭하여 선택 후 Ctrl+V로 크롭한 이미지를 붙여넣거나, 파일을 드래그하여 삽입합니다. 더블클릭으로 확대, Delete로 삭제합니다.
      </p>
    </div>
  );
}
