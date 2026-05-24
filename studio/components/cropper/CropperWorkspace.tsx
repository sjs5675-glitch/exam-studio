"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import type { CropBox, PdfFlip, PdfRotation } from "@/lib/cropper/types";
import { autoNumber, normalizePdfRotation, normalizedBboxToCropBox } from "@/lib/cropper/coords";
import { PdfPageCanvas } from "./PdfPageCanvas";

// ─── types ────────────────────────────────────────────────────────────────────

interface PdfMeta {
  pages: number;
  page0Width: number;
  page0Height: number;
}

type CropItem = { number: number; kind?: "regular" | "essay"; blob: Blob };

// ─── helpers ──────────────────────────────────────────────────────────────────

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}

function legacyLsKey(pdfPath: string): string {
  return `pdf-cropper:${hashString(pdfPath)}`;
}

/** rotation-only key (Phase 2 이전 저장 데이터 호환) */
function rotationOnlyLsKey(pdfPath: string, rotation: PdfRotation): string {
  return `pdf-cropper:${hashString(pdfPath)}:rotation:${rotation}`;
}

function lsKey(pdfPath: string, rotation: PdfRotation, flip: PdfFlip): string {
  return `pdf-cropper:${hashString(pdfPath)}:rotation:${rotation}:flip:${flip ? 1 : 0}`;
}

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function fetchPdfMeta(path: string, rotation: PdfRotation, flip: PdfFlip): Promise<PdfMeta> {
  const metaRes = await fetch("/api/pdf-meta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdfPath: path, dpi: 200, rotation, flip }),
  });
  if (!metaRes.ok) {
    const errData = await metaRes.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error ?? "PDF 메타 조회 실패");
  }
  return metaRes.json();
}

function loadStoredBoxes(path: string, rotation: PdfRotation, flip: PdfFlip): CropBox[] {
  // Primary key: rotation + flip
  const stored = localStorage.getItem(lsKey(path, rotation, flip));
  if (stored) {
    const { boxes: storedBoxes } = JSON.parse(stored) as { boxes: CropBox[]; updatedAt: string };
    return storedBoxes;
  }

  // Fallback: rotation-only key (legacy from Phase 2 era) — only when flip=false
  if (!flip) {
    const rotOnlyStored = localStorage.getItem(rotationOnlyLsKey(path, rotation));
    if (rotOnlyStored) {
      const { boxes: storedBoxes } = JSON.parse(rotOnlyStored) as { boxes: CropBox[]; updatedAt: string };
      return storedBoxes;
    }
  }

  // Fallback: legacy key (rotation=0, flip=false)
  if (rotation === 0 && !flip) {
    const legacyStored = localStorage.getItem(legacyLsKey(path));
    if (legacyStored) {
      const { boxes: storedBoxes } = JSON.parse(legacyStored) as { boxes: CropBox[]; updatedAt: string };
      return storedBoxes;
    }
  }

  return [];
}

// ─── component ────────────────────────────────────────────────────────────────

interface CropperWorkspaceProps {
  /** Crop → callback (e.g. POST /api/question-images). Omit for ZIP download. */
  onExtract?: (items: CropItem[]) => Promise<void>;
  /** Auto-run 자동 분할 after PDF upload. Default false. */
  autoSplitOnUpload?: boolean;
  onPdfSelected?: (fileName: string) => void;
}

export interface CropperWorkspaceRef {
  openFilePicker: () => void;
}

export const CropperWorkspace = forwardRef<CropperWorkspaceRef, CropperWorkspaceProps>(
  ({ onExtract, autoSplitOnUpload = false, onPdfSelected }, ref) => {
    // Upload state
    const [pdfPath, setPdfPath] = useState<string | null>(null);
    const [pdfMeta, setPdfMeta] = useState<PdfMeta | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      openFilePicker: () => {
        fileInputRef.current?.click();
      },
    }));

  // Page state
  const [currentPage, setCurrentPage] = useState(0);
  const [rotation, setRotation] = useState<PdfRotation>(0);
  const [flip, setFlip] = useState<PdfFlip>(false);
  // pageImages: Map<pageIndex, blobUrl>
  const [pageImages, setPageImages] = useState<Map<number, string>>(new Map());
  const [loadingPage, setLoadingPage] = useState(false);

  // Box state (global, all pages)
  const [boxes, setBoxes] = useState<CropBox[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const [autoCropping, setAutoCropping] = useState(false);
  const [autoCropError, setAutoCropError] = useState<string | null>(null);

  // Gemini 키가 확실히 없을 때만 자동 분할을 막는다 (null=확인 전/실패 → 막지 않음).
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  const geminiMissing = geminiConfigured === false;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/env-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { keys?: Record<string, { configured?: boolean }> } | null) => {
        if (!cancelled) setGeminiConfigured(Boolean(data?.keys?.GEMINI_API_KEY?.configured));
      })
      .catch(() => {
        if (!cancelled) setGeminiConfigured(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingAutoSplitRef = useRef(false);

  const [extracting, setExtracting] = useState(false);

  const saveToLS = useMemo(
    () => debounce((path: string, rot: PdfRotation, fl: PdfFlip, bxs: CropBox[]) => {
      try {
        localStorage.setItem(
          lsKey(path, rot, fl),
          JSON.stringify({ boxes: bxs, rotation: rot, flip: fl, updatedAt: new Date().toISOString() })
        );
      } catch {
        // quota exceeded or unavailable — ignore
      }
    }, 500),
    []
  );

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    onPdfSelected?.(file.name);

    try {
      const formData = new FormData();
      formData.append("mode", "create");
      formData.append("files", file);

      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("업로드 실패");
      const uploadData = await uploadRes.json();
      const path: string = uploadData.files?.[0]?.path;
      if (!path) throw new Error("서버 경로 없음");

      const initialRotation: PdfRotation = 180;
      const initialFlip: PdfFlip = true;
      const meta = await fetchPdfMeta(path, initialRotation, initialFlip);

      setPdfPath(path);
      setPdfMeta(meta);
      setCurrentPage(0);
      setRotation(initialRotation);
      setFlip(initialFlip);
      setPageImages(new Map());
      setSelectedBoxId(null);

      try {
        setBoxes(loadStoredBoxes(path, initialRotation, initialFlip));
      } catch {
        setBoxes([]);
      }

      if (autoSplitOnUpload) {
        pendingAutoSplitRef.current = true;
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "오류 발생");
    } finally {
      setUploading(false);
    }
  }

  const fetchPage = useCallback(
    async (pageIndex: number, path: string, meta: PdfMeta): Promise<string | null> => {
      if (pageIndex < 0 || pageIndex >= meta.pages) return null;
      setLoadingPage(true);
      try {
        const res = await fetch("/api/pdf-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdfPath: path, page: pageIndex, dpi: 200, rotation, flip }),
        });
        if (!res.ok) throw new Error("페이지 렌더 실패");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setPageImages((prev) => {
          const next = new Map(prev);
          next.set(pageIndex, url);
          return next;
        });
        return url;
      } catch {
        return null;
      } finally {
        setLoadingPage(false);
      }
    },
    [rotation, flip]
  );

  // Fetch page when pdfPath/currentPage changes
  useEffect(() => {
    if (!pdfPath || !pdfMeta) return;
    if (!pageImages.has(currentPage)) {
      queueMicrotask(() => void fetchPage(currentPage, pdfPath, pdfMeta));
    }
    // Prefetch next page
    if (
      currentPage + 1 < pdfMeta.pages &&
      !pageImages.has(currentPage + 1)
    ) {
      queueMicrotask(() => void fetchPage(currentPage + 1, pdfPath, pdfMeta));
    }
  }, [pdfPath, pdfMeta, currentPage, fetchPage, pageImages]);

  // Preserves global creation order: in-place update existing, drop removed, append new.
  // Cross-page order unchanged; reordering happens via handleReorderBoxes (DnD).
  function handlePageBoxesChange(updatedPageBoxes: CropBox[]) {
    setBoxes((prev) => {
      const updatedById = new Map(updatedPageBoxes.map((b) => [b.id, b]));
      const seen = new Set<string>();
      const result: CropBox[] = [];

      for (const b of prev) {
        if (b.page === currentPage) {
          const upd = updatedById.get(b.id);
          if (upd) {
            result.push(upd);
            seen.add(b.id);
          }
        } else {
          result.push(b);
        }
      }
      for (const b of updatedPageBoxes) {
        if (!seen.has(b.id)) {
          result.push(b);
        }
      }

      const numbered = autoNumber(result);
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
      return numbered;
    });
  }

  function handleDeleteBox(id: string) {
    setBoxes((prev) => {
      const filtered = prev.filter((b) => b.id !== id);
      const numbered = autoNumber(filtered);
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
      return numbered;
    });
    setSelectedBoxId((cur) => (cur === id ? null : cur));
  }

  function handleReorderBoxes(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    setBoxes((prev) => {
      if (fromIdx < 0 || fromIdx >= prev.length) return prev;
      if (toIdx < 0 || toIdx > prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      const adjusted = toIdx > fromIdx ? toIdx - 1 : toIdx;
      next.splice(adjusted, 0, moved);
      const numbered = autoNumber(next);
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
      return numbered;
    });
  }

  function goPrev() {
    if (!pdfMeta) return;
    setCurrentPage((p) => Math.max(0, p - 1));
    setSelectedBoxId(null);
  }
  function goNext() {
    if (!pdfMeta) return;
    setCurrentPage((p) => Math.min(pdfMeta.pages - 1, p + 1));
    setSelectedBoxId(null);
  }

  async function handleRotate(delta: number) {
    if (!pdfPath) return;
    const nextRotation = normalizePdfRotation(rotation + delta);
    if (nextRotation === rotation) return;

    setLoadingPage(true);
    setUploadError(null);
    try {
      const meta = await fetchPdfMeta(pdfPath, nextRotation, flip);
      setRotation(nextRotation);
      setPdfMeta(meta);
      setPageImages(new Map());
      setSelectedBoxId(null);
      try {
        setBoxes(loadStoredBoxes(pdfPath, nextRotation, flip));
      } catch {
        setBoxes([]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "PDF 메타 조회 실패");
    } finally {
      setLoadingPage(false);
    }
  }

  async function handleFlipToggle() {
    if (!pdfPath) return;
    const nextFlip: PdfFlip = !flip;

    setLoadingPage(true);
    setUploadError(null);
    try {
      const meta = await fetchPdfMeta(pdfPath, rotation, nextFlip);
      setFlip(nextFlip);
      setPdfMeta(meta);
      setPageImages(new Map());
      setSelectedBoxId(null);
      try {
        setBoxes(loadStoredBoxes(pdfPath, rotation, nextFlip));
      } catch {
        setBoxes([]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "PDF 메타 조회 실패");
    } finally {
      setLoadingPage(false);
    }
  }

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!pdfMeta) return;
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfMeta]);

  function handleClearStorage() {
    if (!pdfPath) return;
    localStorage.removeItem(lsKey(pdfPath, rotation, flip));
    // Also clear rotation-only fallback key when flip=false
    if (!flip) localStorage.removeItem(rotationOnlyLsKey(pdfPath, rotation));
    // Also clear legacy key when rotation=0 and flip=false
    if (rotation === 0 && !flip) localStorage.removeItem(legacyLsKey(pdfPath));
    setBoxes([]);
    setSelectedBoxId(null);
  }

  async function handleAutoCrop() {
    if (!pdfPath || !pdfMeta) return;
    if (geminiMissing) {
      setAutoCropError("Gemini API 키가 설정되지 않았습니다. 설정에서 입력 후 다시 시도하세요.");
      return;
    }

    if (boxes.length > 0) {
      const ok = window.confirm(
        `기존 박스 ${boxes.length}개를 모두 비우고 자동 분할을 진행하시겠습니까?`
      );
      if (!ok) return;
    }

    setAutoCropping(true);
    setAutoCropError(null);

    try {
      const res = await fetch("/api/auto-crop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfPath, rotation, flip }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as {
        pages: Array<{
          pageIndex: number;
          imageWidth: number;
          imageHeight: number;
          answerPage: boolean;
          questions: Array<{
            number: number | string;
            kind: "regular" | "essay";
            bbox: [number, number, number, number];
          }>;
        }>;
      };

      const result: CropBox[] = [];
      for (const page of data.pages) {
        if (page.answerPage) continue;
        for (const q of page.questions) {
          const box = normalizedBboxToCropBox({
            bbox: q.bbox,
            pageIndex: page.pageIndex,
            imageWidth: page.imageWidth,
            imageHeight: page.imageHeight,
            number: typeof q.number === "number" ? q.number : 0,
            kind: q.kind,
          });
          result.push(box);
        }
      }

      result.sort((a, b) => a.page - b.page);

      const numbered = autoNumber(result);
      setBoxes(numbered);
      setSelectedBoxId(null);
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
    } catch (err) {
      setAutoCropError(err instanceof Error ? err.message : "자동 분할 실패");
    } finally {
      setAutoCropping(false);
    }
  }

  useEffect(() => {
    if (!pendingAutoSplitRef.current) return;
    if (!pdfPath || !pdfMeta) return;
    pendingAutoSplitRef.current = false;
    queueMicrotask(() => void handleAutoCrop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfPath, pdfMeta]);

  async function cropAllBoxesToBlobs(): Promise<CropItem[]> {
    if (!pdfPath || !pdfMeta) return [];

    const items: CropItem[] = [];
    for (const box of boxes) {
      const blobUrl = pageImages.get(box.page) ?? await fetchPage(box.page, pdfPath, pdfMeta);
      if (!blobUrl) continue;

      const img = await loadImage(blobUrl);
      const canvas = document.createElement("canvas");
      canvas.width = box.w;
      canvas.height = box.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

      const pngBlob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("canvas.toBlob failed"));
        }, "image/png");
      });

      items.push({ number: box.number, kind: box.kind, blob: pngBlob });
    }
    return items;
  }

  /**
   * kind별 독립 카운터로 파일명 결정.
   * "regular" (미지정 포함) → q{NN}.png
   * "essay" → q_s{NN}.png
   * kind별 1부터 zero-pad (총 kind별 count 기준).
   */
  function kindFilename(items: CropItem[]): Array<{ item: CropItem; fname: string }> {
    const regularCount = items.filter((it) => (it.kind ?? "regular") !== "essay").length;
    const essayCount   = items.filter((it) => it.kind === "essay").length;

    const regularWidth = String(regularCount).length;
    const essayWidth   = String(essayCount).length;

    let rIdx = 0;
    let eIdx = 0;

    return items.map((item) => {
      if (item.kind === "essay") {
        eIdx++;
        const pad = String(eIdx).padStart(Math.max(2, essayWidth), "0");
        return { item, fname: `q_s${pad}.png` };
      } else {
        rIdx++;
        const pad = String(rIdx).padStart(Math.max(2, regularWidth), "0");
        return { item, fname: `q${pad}.png` };
      }
    });
  }

  async function handleExtract() {
    if (boxes.length === 0) return;
    setExtracting(true);
    try {
      const items = await cropAllBoxesToBlobs();

      if (onExtract) {
        await onExtract(items);
      } else {
        const zip = new JSZip();
        for (const { item, fname } of kindFilename(items)) {
          zip.file(fname, item.blob);
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "crop_result.zip";
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExtracting(false);
    }
  }

  const currentBoxes = boxes.filter((b) => b.page === currentPage);
  const currentImageUrl = pageImages.get(currentPage) ?? null;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2 border-b shrink-0 bg-muted/5">
        {/* Hidden Upload Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={handleFileChange}
          disabled={uploading}
        />

        {/* Page navigation */}
        {pdfMeta && (
          <>
            <button
              onClick={goPrev}
              disabled={currentPage === 0}
              className="px-2 py-1 rounded border text-sm disabled:opacity-40 hover:bg-secondary"
            >
              ←
            </button>
            <span className="text-sm tabular-nums">
              {currentPage + 1} / {pdfMeta.pages}
            </span>
            <button
              onClick={goNext}
              disabled={currentPage === pdfMeta.pages - 1}
              className="px-2 py-1 rounded border text-sm disabled:opacity-40 hover:bg-secondary"
            >
              →
            </button>
          </>
        )}

        {/* Rotation */}
        {pdfMeta && (
          <div className="flex items-center gap-1 border-l pl-3">
            <button
              type="button"
              onClick={() => void handleRotate(-90)}
              className="px-2 py-1 rounded border text-sm hover:bg-secondary"
              aria-label="왼쪽으로 90도 회전"
              title="왼쪽으로 90도 회전"
            >
              ↺
            </button>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
              {rotation}°
            </span>
            <button
              type="button"
              onClick={() => void handleRotate(90)}
              className="px-2 py-1 rounded border text-sm hover:bg-secondary"
              aria-label="오른쪽으로 90도 회전"
              title="오른쪽으로 90도 회전"
            >
              ↻
            </button>
          </div>
        )}

        {/* Flip */}
        {pdfMeta && (
          <div className="flex items-center gap-1 border-l pl-3">
            <button
              type="button"
              onClick={() => void handleFlipToggle()}
              className={`px-2 py-1 rounded border text-sm ${
                flip
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "hover:bg-secondary"
              }`}
              aria-label="좌우 반전 토글"
              aria-pressed={flip}
              title={flip ? "좌우 반전 ON (클릭해서 해제)" : "좌우 반전 OFF (클릭해서 활성화)"}
            >
              ⇔
            </button>
            {flip && (
              <span className="text-xs text-primary font-medium">반전</span>
            )}
          </div>
        )}

        {/* Auto-crop button */}
        {pdfMeta && (
          <button
            onClick={handleAutoCrop}
            disabled={autoCropping || geminiMissing}
            title={geminiMissing ? "Gemini API 키가 필요합니다 — 설정에서 입력" : undefined}
            className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {autoCropping ? "자동 분할 중…" : "자동 분할"}
          </button>
        )}

        <div className="flex-1" />

        {/* Extract button */}
        {boxes.length > 0 && (
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="px-3 py-1.5 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {extracting
              ? "추출 중..."
              : onExtract
              ? `시험지 제작 시작 (${boxes.length}문제)`
              : `추출 실행 (${boxes.length}문제)`}
          </button>
        )}
      </header>

      {uploadError && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm">
          {uploadError}
        </div>
      )}

      {autoCropError && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm flex items-center justify-between">
          <span>자동 분할 오류: {autoCropError}</span>
          <button
            type="button"
            onClick={() => setAutoCropError(null)}
            className="ml-4 text-destructive hover:opacity-70"
            aria-label="오류 닫기"
          >
            ×
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
          {!pdfPath && (
            <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground mt-24">
              <p className="text-lg">PDF 파일을 업로드하세요</p>
              <p className="text-sm">
                왼쪽 상단의 &ldquo;PDF 열기&rdquo; 버튼 또는 파일을 선택하세요.
              </p>
            </div>
          )}

          {pdfPath && !currentImageUrl && (
            <div className="flex items-center justify-center mt-24 text-muted-foreground">
              {loadingPage ? "페이지 로딩 중..." : "페이지를 불러올 수 없습니다."}
            </div>
          )}

          {pdfPath && currentImageUrl && pdfMeta && (
            <PdfPageCanvas
              pageImageUrl={currentImageUrl}
              pageIndex={currentPage}
              imageWidth={pdfMeta.page0Width}
              imageHeight={pdfMeta.page0Height}
              boxes={currentBoxes}
              selectedBoxId={selectedBoxId}
              onBoxesChange={handlePageBoxesChange}
              onSelectBox={setSelectedBoxId}
            />
          )}
        </div>

        {/* Side panel */}
        {pdfPath && (
          <aside className="w-56 border-l flex flex-col shrink-0 overflow-hidden">
            <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground">
              박스 리스트
            </div>

            <div className="flex-1 overflow-y-auto">
              {boxes.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted-foreground">
                  박스가 없습니다.
                  <br />
                  캔버스를 드래그해 박스를 그리세요.
                </p>
              ) : (
                <ul className="divide-y">
                  {boxes.map((box, idx) => (
                    <li
                      key={box.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(idx));
                        e.dataTransfer.effectAllowed = "move";
                        setDragOverIdx(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverIdx !== idx) setDragOverIdx(idx);
                      }}
                      onDragLeave={() => {
                        if (dragOverIdx === idx) setDragOverIdx(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const raw = e.dataTransfer.getData("text/plain");
                        const fromIdx = parseInt(raw, 10);
                        setDragOverIdx(null);
                        if (Number.isFinite(fromIdx)) {
                          handleReorderBoxes(fromIdx, idx);
                        }
                      }}
                      onClick={() => {
                        setCurrentPage(box.page);
                        setSelectedBoxId(box.id);
                      }}
                      className={`px-3 py-2 text-xs cursor-grab active:cursor-grabbing hover:bg-secondary flex items-center justify-between gap-2 ${
                        box.id === selectedBoxId ? "bg-secondary" : ""
                      } ${
                        dragOverIdx === idx ? "border-t-2 border-primary" : ""
                      }`}
                    >
                      <span className="truncate">
                        <span className="font-medium">#{box.number}</span>{" "}
                        <span className="text-muted-foreground">
                          p.{box.page + 1} ({Math.round(box.x)},
                          {Math.round(box.y)})
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteBox(box.id);
                        }}
                        className="shrink-0 w-5 h-5 rounded text-muted-foreground hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center"
                        aria-label={`박스 #${box.number} 삭제`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-3 py-2 border-t flex flex-col gap-2">
              <button
                onClick={() => {
                  setBoxes([]);
                  setSelectedBoxId(null);
                  if (pdfPath) saveToLS(pdfPath, rotation, flip, []);
                }}
                disabled={boxes.length === 0}
                className="w-full px-2 py-1 rounded border text-xs hover:bg-secondary disabled:opacity-40"
              >
                전체 삭제
              </button>
              <button
                onClick={handleClearStorage}
                className="w-full px-2 py-1 rounded border text-xs hover:bg-secondary"
              >
                초기화 (localStorage)
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
});

CropperWorkspace.displayName = "CropperWorkspace";
