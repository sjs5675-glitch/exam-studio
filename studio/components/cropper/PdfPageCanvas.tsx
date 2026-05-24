"use client";

import React, { useEffect, useRef, useState } from "react";
import type { CropBox } from "@/lib/cropper/types";
import { CropBoxLayer } from "./CropBoxLayer";

export interface PdfPageCanvasProps {
  pageImageUrl: string;     // blob URL from /api/pdf-preview
  pageIndex: number;        // 0-indexed page number
  imageWidth: number;       // rendered PNG pixel width
  imageHeight: number;      // rendered PNG pixel height
  boxes: CropBox[];         // only boxes for this page (parent filters)
  selectedBoxId: string | null;
  onBoxesChange: (boxes: CropBox[]) => void; // full page boxes after CRUD
  onSelectBox: (id: string | null) => void;
}

export function PdfPageCanvas({
  pageImageUrl,
  pageIndex,
  imageWidth,
  imageHeight,
  boxes,
  selectedBoxId,
  onBoxesChange,
  onSelectBox,
}: PdfPageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayWidth, setDisplayWidth] = useState(0);
  const [displayHeight, setDisplayHeight] = useState(0);

  // Track container display size via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0 && imageWidth > 0) {
          const ratio = imageHeight / imageWidth;
          setDisplayWidth(width);
          setDisplayHeight(Math.round(width * ratio));
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [imageWidth, imageHeight]);

  // Ensure boxes emitted by this page carry the correct page index
  function handleBoxesChange(updated: CropBox[]) {
    onBoxesChange(updated.map((b) => ({ ...b, page: pageIndex })));
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: imageWidth,
        height: displayHeight > 0 ? displayHeight : "auto",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* PDF page image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pageImageUrl}
        alt={`PDF page ${pageIndex + 1}`}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          pointerEvents: "none",
        }}
        draggable={false}
      />

      {/* Crop box overlay — only rendered once dimensions are known */}
      {displayWidth > 0 && displayHeight > 0 && (
        <CropBoxLayer
          boxes={boxes}
          selectedBoxId={selectedBoxId}
          displayWidth={displayWidth}
          displayHeight={displayHeight}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          onBoxesChange={handleBoxesChange}
          onSelectBox={onSelectBox}
        />
      )}
    </div>
  );
}
