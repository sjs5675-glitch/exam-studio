"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import JSZip from "jszip";
import type { AutoCropMode, CropBox, CropRegionType, FigureRegionMode, PdfFlip, PdfRotation } from "@/lib/cropper/types";
import { CROP_REGION_TYPES } from "@/lib/cropper/types";
import { autoNumber, cropRegionType, isProblemBox, normalizePdfRotation, normalizedBboxToCropBox } from "@/lib/cropper/coords";
import type { ImageProviderId } from "@/lib/ai/settings";
import { PdfPageCanvas } from "./PdfPageCanvas";

// ─── types ────────────────────────────────────────────────────────────────────

interface PdfMeta {
  pages: number;
  page0Width: number;
  page0Height: number;
}

type CropItem = { number: number; kind?: "regular" | "essay"; blob: Blob };
const AUTO_CROP_PROVIDER_LABEL: Record<ImageProviderId, string> = {
  gemini: "Gemini API",
  "codex-cli": "Codex",
};
const AUTO_CROP_MODE_LABEL: Record<AutoCropMode, string> = {
  accurate: "정확도",
  fast: "속도",
};
const AUTO_CROP_MODE_LS_KEY = "exam-studio:auto-crop-mode";

const REGION_LABEL: Record<CropRegionType, string> = {
  problem: "문제",
  figure: "그림",
  table: "표",
  passage: "지문",
  experiment: "실험",
  exclude: "제외",
};

const REGION_HELP: Record<CropRegionType, string> = {
  problem: "최종 문제 crop으로 추출됩니다.",
  figure: "문제 안 그림/도해/그래프 참조 영역입니다.",
  table: "표 또는 데이터 상자 영역입니다.",
  passage: "긴 공통 지문, 긴 자료 설명, 실험 과정/장치 구성/관찰 설명 영역입니다.",
  experiment: "기존 호환용 타입입니다. 새 영역은 지문으로 통합됩니다.",
  exclude: "문제 crop에서 제외하고 싶은 보조 표시 영역입니다.",
};

const CHILD_REGION_TYPES: CropRegionType[] = ["problem", "figure", "table", "passage"];
const FIGURE_MODE_LABEL: Record<FigureRegionMode, string> = {
  original: "원본",
  grayscale: "흑백",
  "remove-blue": "파란글씨 제거",
  regenerate: "AI 재생성",
};

type AutoCropRegion = {
  type?: string;
  regionType?: string;
  number?: number | string;
  ownerNumber?: number | string;
  owner?: number | string;
  bbox?: [number, number, number, number];
  box_2d?: [number, number, number, number];
  label?: string;
  instruction?: string;
  figureMode?: FigureRegionMode;
};

type AutoCropResult = {
  pages: Array<{
    pageIndex: number;
    imageWidth: number;
    imageHeight: number;
    answerPage: boolean;
    questions: Array<{
      number: number | string;
      kind: "regular" | "essay";
      bbox: [number, number, number, number];
      regions?: AutoCropRegion[];
    }>;
    regions?: AutoCropRegion[];
  }>;
  warnings?: Array<{ page?: number; message?: string }>;
};

type AutoCropJobStatus = "running" | "completed" | "failed";
type AutoCropProgress = {
  provider: ImageProviderId;
  status: AutoCropJobStatus;
  phase?: string;
  message: string;
  progress: number;
  currentPage: number;
  totalPages: number;
};

type AutoCropJob = AutoCropProgress & {
  id: string;
  error?: string;
  detail?: string;
  result?: AutoCropResult;
};

type PageViewMode = "single" | "spread";

type AutoCropReviewIssue = {
  id: string;
  pageIndex: number;
  severity: "warn" | "error";
  title: string;
  message: string;
  boxId?: string;
};

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

function parseLooseNumber(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.match(/\d+/);
    if (match) return Number(match[0]);
  }
  return undefined;
}

function normalizeAutoRegionType(value: string | undefined): CropRegionType | null {
  const raw = (value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (raw === "problem" || raw === "question") return "problem";
  if (raw === "figure" || raw === "image" || raw === "diagram" || raw === "graph" || raw === "chart") return "figure";
  if (raw === "table" || raw === "data_table" || raw === "data_box") return "table";
  if (
    raw === "passage" ||
    raw === "stem" ||
    raw === "stimulus" ||
    raw === "text" ||
    raw === "source" ||
    raw === "experiment" ||
    raw === "lab" ||
    raw === "apparatus" ||
    raw === "setup"
  ) return "passage";
  if (raw === "exclude" || raw === "ignore" || raw === "decoration") return "exclude";
  return null;
}

function boxCenter(box: CropBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function problemContainsRegion(problem: CropBox, region: CropBox): boolean {
  const center = boxCenter(region);
  return (
    problem.page === region.page &&
    center.x >= problem.x &&
    center.x <= problem.x + problem.w &&
    center.y >= problem.y &&
    center.y <= problem.y + problem.h
  );
}

function boxContainmentRatio(container: CropBox, inner: CropBox): number {
  if (container.page !== inner.page) return 0;
  const x1 = Math.max(container.x, inner.x);
  const y1 = Math.max(container.y, inner.y);
  const x2 = Math.min(container.x + container.w, inner.x + inner.w);
  const y2 = Math.min(container.y + container.h, inner.y + inner.h);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const innerArea = Math.max(1, inner.w * inner.h);
  return overlap / innerArea;
}

function boxArea(box: Pick<CropBox, "w" | "h">): number {
  return Math.max(1, box.w * box.h);
}

function boxIntersectionArea(a: CropBox, b: CropBox): number {
  if (a.page !== b.page) return 0;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function boxOverlapRatio(a: CropBox, b: CropBox): number {
  const intersection = boxIntersectionArea(a, b);
  return intersection / Math.max(1, Math.min(boxArea(a), boxArea(b)));
}

function buildAutoCropReviewIssues(args: {
  boxes: CropBox[];
  data: AutoCropResult;
  excludedPages: Set<number>;
}): AutoCropReviewIssue[] {
  const issues: AutoCropReviewIssue[] = [];
  const pageSize = new Map(args.data.pages.map((page) => [
    page.pageIndex,
    { width: page.imageWidth, height: page.imageHeight },
  ]));
  const problemBoxes = args.boxes.filter((box) => isProblemBox(box) && !args.excludedPages.has(box.page));
  const problemsByPage = new Map<number, CropBox[]>();
  for (const problem of problemBoxes) {
    const list = problemsByPage.get(problem.page) ?? [];
    list.push(problem);
    problemsByPage.set(problem.page, list);
  }

  for (const warning of args.data.warnings ?? []) {
    const pageIndex = Math.max(0, Number(warning.page ?? 1) - 1);
    issues.push({
      id: `ai-warning-${issues.length}`,
      pageIndex,
      severity: "warn",
      title: `${pageIndex + 1}쪽 AI 경고`,
      message: warning.message ?? "AI 자동분할 결과를 확인하세요.",
    });
  }

  for (const page of args.data.pages) {
    if (args.excludedPages.has(page.pageIndex) || page.answerPage) continue;
    const pageProblems = problemsByPage.get(page.pageIndex) ?? [];
    if (pageProblems.length === 0) {
      issues.push({
        id: `empty-page-${page.pageIndex}`,
        pageIndex: page.pageIndex,
        severity: "warn",
        title: `${page.pageIndex + 1}쪽 문제 없음`,
        message: "사용 중인 쪽인데 문제 영역이 잡히지 않았습니다.",
      });
    }
  }

  for (const [pageIndex, pageProblems] of problemsByPage) {
    const size = pageSize.get(pageIndex);
    if (size) {
      const pageArea = Math.max(1, size.width * size.height);
      for (const problem of pageProblems) {
        const ratio = boxArea(problem) / pageArea;
        if (ratio > 0.55) {
          issues.push({
            id: `large-problem-${problem.id}`,
            pageIndex,
            severity: "warn",
            title: `${pageIndex + 1}쪽 문제 #${problem.number} 과대`,
            message: "문제 박스가 페이지의 절반 이상을 덮습니다. 다음 문제나 해설까지 포함됐는지 확인하세요.",
            boxId: problem.id,
          });
        }
      }
    }

    for (let i = 0; i < pageProblems.length; i += 1) {
      for (let j = i + 1; j < pageProblems.length; j += 1) {
        const a = pageProblems[i];
        const b = pageProblems[j];
        if (boxOverlapRatio(a, b) > 0.18) {
          issues.push({
            id: `overlap-problem-${a.id}-${b.id}`,
            pageIndex,
            severity: "error",
            title: `${pageIndex + 1}쪽 문제 겹침`,
            message: `문제 #${a.number}와 #${b.number} 박스가 크게 겹칩니다. 둘 중 하나가 다음 문제를 침범했을 가능성이 큽니다.`,
            boxId: a.id,
          });
        }
      }
    }
  }

  const nonProblems = args.boxes.filter((box) => !isProblemBox(box) && cropRegionType(box) !== "exclude");
  for (const region of nonProblems) {
    const owner = findOwnerProblem(region, problemBoxes);
    if (!owner) continue;
    const containment = boxContainmentRatio(owner, region);
    const typeLabel = REGION_LABEL[cropRegionType(region)];
    if (containment < 0.45) {
      issues.push({
        id: `region-outside-${region.id}`,
        pageIndex: region.page,
        severity: "warn",
        title: `${region.page + 1}쪽 ${typeLabel} 위치 확인`,
        message: `${typeLabel} 영역이 소유 문제 #${owner.number} 밖으로 많이 벗어났습니다.`,
        boxId: region.id,
      });
    }
    if (boxArea(region) / boxArea(owner) > 0.85) {
      issues.push({
        id: `region-covers-${region.id}`,
        pageIndex: region.page,
        severity: "warn",
        title: `${region.page + 1}쪽 ${typeLabel} 과대`,
        message: `${typeLabel} 영역이 문제 #${owner.number} 대부분을 덮습니다. 문제 박스와 내부 영역이 뒤섞였는지 확인하세요.`,
        boxId: region.id,
      });
    }
  }

  return issues.slice(0, 80);
}

function ownedRegions(problem: CropBox, allBoxes: CropBox[]): CropBox[] {
  return allBoxes.filter(
    (box) =>
      !isProblemBox(box) &&
      cropRegionType(box) !== "exclude" &&
      (box.ownerBoxId === problem.id || box.ownerNumber === problem.number)
  );
}

function sortedSegmentsForProblem(problem: CropBox, allBoxes: CropBox[]): CropBox[] {
  const externalChildren = ownedRegions(problem, allBoxes).filter(
    (child) => boxContainmentRatio(problem, child) < 0.92
  );
  return [problem, ...externalChildren].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}

function findOwnerProblem(region: CropBox, problems: CropBox[]): CropBox | undefined {
  const byId = region.ownerBoxId ? problems.find((problem) => problem.id === region.ownerBoxId) : undefined;
  if (byId) return byId;

  const byNumber = region.ownerNumber ? problems.find((problem) => problem.number === region.ownerNumber) : undefined;
  if (byNumber) return byNumber;

  const containing = problems
    .filter((problem) => problemContainsRegion(problem, region))
    .sort((a, b) => a.w * a.h - b.w * b.h)[0];
  if (containing) return containing;

  const samePage = problems
    .filter((problem) => problem.page === region.page)
    .sort((a, b) => {
      const ay = a.y <= region.y ? region.y - a.y : 100000 + a.y - region.y;
      const by = b.y <= region.y ? region.y - b.y : 100000 + b.y - region.y;
      return ay - by || Math.abs(a.x - region.x) - Math.abs(b.x - region.x);
    });
  return samePage[0];
}

function reconcileCropBoxes(input: CropBox[]): CropBox[] {
  const numbered = autoNumber(input);
  const problems = numbered.filter(isProblemBox);
  return numbered.map((box) => {
    if (isProblemBox(box)) {
      return {
        ...box,
        regionType: "problem" as const,
        ownerNumber: undefined,
        ownerBoxId: undefined,
      };
    }
    const owner = findOwnerProblem(box, problems);
    const ownerNumber = owner?.number ?? box.ownerNumber ?? box.number;
    const type = cropRegionType(box);
    return {
      ...box,
      regionType: type,
      ownerBoxId: owner?.id ?? box.ownerBoxId,
      ownerNumber,
      number: ownerNumber,
      figureMode: type === "figure" ? box.figureMode ?? "original" : undefined,
    };
  });
}

function countChildRegions(problem: CropBox, allBoxes: CropBox[]): Record<CropRegionType, number> {
  const counts = Object.fromEntries(CROP_REGION_TYPES.map((type) => [type, 0])) as Record<CropRegionType, number>;
  for (const box of allBoxes) {
    const type = cropRegionType(box);
    if (isProblemBox(box)) continue;
    const belongsToProblem = box.ownerBoxId === problem.id || box.ownerNumber === problem.number;
    if (belongsToProblem) counts[type] += 1;
  }
  return counts;
}

function findIncludedPageNear(pageIndex: number, excludedPages: Set<number>, totalPages: number): number {
  if (totalPages <= 0) return 0;
  if (!excludedPages.has(pageIndex)) return Math.max(0, Math.min(totalPages - 1, pageIndex));
  for (let offset = 1; offset < totalPages; offset += 1) {
    const next = pageIndex + offset;
    if (next < totalPages && !excludedPages.has(next)) return next;
    const prev = pageIndex - offset;
    if (prev >= 0 && !excludedPages.has(prev)) return prev;
  }
  return Math.max(0, Math.min(totalPages - 1, pageIndex));
}

function clampViewerZoom(value: number): number {
  return Math.max(0.3, Math.min(1.6, Math.round(value * 100) / 100));
}

// ─── component ────────────────────────────────────────────────────────────────

interface CropperWorkspaceProps {
  /** Crop → callback (e.g. POST /api/question-images). Omit for ZIP download. */
  onExtract?: (items: CropItem[]) => Promise<void>;
  /** Auto-run 자동 분할 after PDF upload. Default false. */
  autoSplitOnUpload?: boolean;
  /** Provider used when autoSplitOnUpload triggers. Manual buttons choose their own provider. */
  autoSplitProvider?: ImageProviderId;
  /** Speed/accuracy mode used when autoSplitOnUpload triggers. */
  autoSplitMode?: AutoCropMode;
  onPdfSelected?: (fileName: string) => void;
  workflowOptions?: React.ReactNode;
}

export interface CropperWorkspaceRef {
  openFilePicker: () => void;
}

export const CropperWorkspace = forwardRef<CropperWorkspaceRef, CropperWorkspaceProps>(
  ({ onExtract, autoSplitOnUpload = false, autoSplitProvider = "gemini", autoSplitMode = "accurate", onPdfSelected, workflowOptions }, ref) => {
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
  const [pageViewMode, setPageViewMode] = useState<PageViewMode>("single");
  const [viewerZoom, setViewerZoom] = useState(0.65);
  const [rotation, setRotation] = useState<PdfRotation>(0);
  const [flip, setFlip] = useState<PdfFlip>(false);
  // pageImages: Map<pageIndex, blobUrl>
  const [pageImages, setPageImages] = useState<Map<number, string>>(new Map());
  const [thumbnailImages, setThumbnailImages] = useState<Map<number, string>>(new Map());
  const [thumbnailErrors, setThumbnailErrors] = useState<Set<number>>(new Set());
  const [excludedPages, setExcludedPages] = useState<Set<number>>(new Set());
  const [pageOverviewOpen, setPageOverviewOpen] = useState(false);
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);
  const thumbnailImagesRef = useRef<Map<number, string>>(new Map());
  const thumbnailRequestsRef = useRef<Map<number, Promise<string | null>>>(new Map());
  const [selectedOverviewPages, setSelectedOverviewPages] = useState<Set<number>>(new Set());
  const [lastOverviewPage, setLastOverviewPage] = useState<number | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);

  // Box state (global, all pages)
  const [boxes, setBoxes] = useState<CropBox[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [createRegionType, setCreateRegionType] = useState<CropRegionType>("problem");
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const [autoCroppingProvider, setAutoCroppingProvider] = useState<ImageProviderId | null>(null);
  const [autoCropError, setAutoCropError] = useState<string | null>(null);
  const [autoCropProgress, setAutoCropProgress] = useState<AutoCropProgress | null>(null);
  const [autoCropMode, setAutoCropMode] = useState<AutoCropMode>(autoSplitMode);
  const [autoSplitDeferred, setAutoSplitDeferred] = useState(false);
  const [autoCropReviewIssues, setAutoCropReviewIssues] = useState<AutoCropReviewIssue[]>([]);

  // Gemini 키가 확실히 없을 때만 자동 분할을 막는다 (null=확인 전/실패 → 막지 않음).
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  const geminiMissing = geminiConfigured === false;
  const [codexReady, setCodexReady] = useState<boolean | null>(null);
  const codexMissing = codexReady === false;
  const autoCropping = autoCroppingProvider !== null;

  useEffect(() => {
    const stored = window.localStorage.getItem(AUTO_CROP_MODE_LS_KEY);
    if (stored === "fast" || stored === "accurate") setAutoCropMode(stored);
  }, []);

  useEffect(() => {
    setAutoCropMode(autoSplitMode);
  }, [autoSplitMode]);

  useEffect(() => {
    if (pdfMeta) setAutoSplitDeferred(Boolean(autoSplitOnUpload));
  }, [autoSplitOnUpload, pdfMeta]);

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
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { codexCli?: { available?: boolean; authenticated?: boolean } } | null) => {
        if (!cancelled) setCodexReady(Boolean(data?.codexCli?.available && data?.codexCli?.authenticated));
      })
      .catch(() => {
        if (!cancelled) setCodexReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    thumbnailImagesRef.current = thumbnailImages;
  }, [thumbnailImages]);

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

      const initialRotation: PdfRotation = 0;
      const initialFlip: PdfFlip = false;
      const meta = await fetchPdfMeta(path, initialRotation, initialFlip);

      setPdfPath(path);
      setPdfMeta(meta);
      setCurrentPage(0);
      setRotation(initialRotation);
      setFlip(initialFlip);
      setPageImages(new Map());
      setThumbnailImages(new Map());
      thumbnailImagesRef.current = new Map();
      thumbnailRequestsRef.current.clear();
      setThumbnailErrors(new Set());
      setExcludedPages(new Set());
      setSelectedOverviewPages(new Set([0]));
      setLastOverviewPage(0);
      setPageOverviewOpen(true);
      setSelectedBoxId(null);
      setAutoSplitDeferred(Boolean(autoSplitOnUpload));
      setAutoCropReviewIssues([]);

      try {
        setBoxes(reconcileCropBoxes(loadStoredBoxes(path, initialRotation, initialFlip)));
      } catch {
        setBoxes([]);
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

  const fetchThumbnail = useCallback(
    async (pageIndex: number, path: string, meta: PdfMeta): Promise<string | null> => {
      if (pageIndex < 0 || pageIndex >= meta.pages) return null;
      const cached = thumbnailImagesRef.current.get(pageIndex);
      if (cached) return cached;
      const inFlight = thumbnailRequestsRef.current.get(pageIndex);
      if (inFlight) return inFlight;

      const request = (async () => {
        try {
          setThumbnailErrors((prev) => {
            if (!prev.has(pageIndex)) return prev;
            const next = new Set(prev);
            next.delete(pageIndex);
            return next;
          });
          const res = await fetch("/api/pdf-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pdfPath: path, page: pageIndex, dpi: 55, rotation, flip }),
          });
          if (!res.ok) throw new Error("thumbnail render failed");
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          setThumbnailImages((prev) => {
            if (prev.has(pageIndex)) {
              URL.revokeObjectURL(url);
              thumbnailImagesRef.current = prev;
              return prev;
            }
            const next = new Map(prev);
            next.set(pageIndex, url);
            thumbnailImagesRef.current = next;
            return next;
          });
          setThumbnailErrors((prev) => {
            if (!prev.has(pageIndex)) return prev;
            const next = new Set(prev);
            next.delete(pageIndex);
            return next;
          });
          return url;
        } catch {
          setThumbnailErrors((prev) => {
            const next = new Set(prev);
            next.add(pageIndex);
            return next;
          });
          return null;
        } finally {
          thumbnailRequestsRef.current.delete(pageIndex);
        }
      })();

      thumbnailRequestsRef.current.set(pageIndex, request);
      return request;
    },
    [rotation, flip]
  );

  // Fetch page when pdfPath/currentPage changes
  useEffect(() => {
    if (!pdfPath || !pdfMeta) return;
    if (pageOverviewOpen) return;
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
  }, [pdfPath, pdfMeta, currentPage, fetchPage, pageImages, pageOverviewOpen]);

  useEffect(() => {
    if (!pageOverviewOpen || !pdfPath || !pdfMeta) return;
    let cancelled = false;
    const activePdfPath = pdfPath;
    const activePdfMeta = pdfMeta;

    async function loadOverviewThumbnails() {
      setLoadingThumbnails(true);
      const missing = Array.from({ length: activePdfMeta.pages }, (_, pageIndex) => pageIndex).filter(
        (pageIndex) => !thumbnailImagesRef.current.has(pageIndex)
      );
      const concurrency = 2;
      for (let start = 0; start < missing.length && !cancelled; start += concurrency) {
        const batch = missing.slice(start, start + concurrency);
        await Promise.all(batch.map((pageIndex) => fetchThumbnail(pageIndex, activePdfPath, activePdfMeta)));
      }
      if (!cancelled) setLoadingThumbnails(false);
    }

    void loadOverviewThumbnails();
    return () => {
      cancelled = true;
    };
  }, [pageOverviewOpen, pdfPath, pdfMeta, fetchThumbnail]);

  const includedPages = useMemo(() => {
    if (!pdfMeta) return [];
    return Array.from({ length: pdfMeta.pages }, (_, pageIndex) => pageIndex).filter(
      (pageIndex) => !excludedPages.has(pageIndex)
    );
  }, [pdfMeta, excludedPages]);
  const includedPageCount = includedPages.length;
  const currentPageExcluded = excludedPages.has(currentPage);
  const previousIncludedPage = useMemo(() => {
    if (!pdfMeta) return null;
    for (let pageIndex = currentPage - 1; pageIndex >= 0; pageIndex -= 1) {
      if (!excludedPages.has(pageIndex)) return pageIndex;
    }
    return null;
  }, [currentPage, excludedPages, pdfMeta]);
  const nextIncludedPage = useMemo(() => {
    if (!pdfMeta) return null;
    for (let pageIndex = currentPage + 1; pageIndex < pdfMeta.pages; pageIndex += 1) {
      if (!excludedPages.has(pageIndex)) return pageIndex;
    }
    return null;
  }, [currentPage, excludedPages, pdfMeta]);
  const visiblePageIndexes = useMemo(() => {
    const pages = [currentPage];
    if (pageViewMode === "spread" && nextIncludedPage !== null) pages.push(nextIncludedPage);
    return pages;
  }, [currentPage, nextIncludedPage, pageViewMode]);

  useEffect(() => {
    if (!pdfMeta || !excludedPages.has(currentPage)) return;
    setCurrentPage(findIncludedPageNear(currentPage, excludedPages, pdfMeta.pages));
  }, [currentPage, excludedPages, pdfMeta]);

  useEffect(() => {
    if (!pdfPath || !pdfMeta || pageOverviewOpen) return;
    for (const pageIndex of visiblePageIndexes) {
      if (!pageImages.has(pageIndex)) {
        queueMicrotask(() => void fetchPage(pageIndex, pdfPath, pdfMeta));
      }
    }
  }, [fetchPage, pageImages, pageOverviewOpen, pdfMeta, pdfPath, visiblePageIndexes]);

  function handleToggleCurrentPageExcluded() {
    if (!pdfMeta) return;
    const willExclude = !excludedPages.has(currentPage);
    if (willExclude && includedPageCount <= 1) {
      setUploadError("최소 1쪽은 남겨야 합니다.");
      return;
    }

    const targetPage = currentPage;
    const next = new Set(excludedPages);
    if (willExclude) next.add(targetPage);
    else next.delete(targetPage);
    setExcludedPages(next);
    setUploadError(null);
    if (willExclude) setCurrentPage(findIncludedPageNear(targetPage, next, pdfMeta.pages));

    if (willExclude) {
      setBoxes((prev) => {
        const numbered = reconcileCropBoxes(prev.filter((box) => box.page !== targetPage));
        if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
        return numbered;
      });
      setSelectedBoxId(null);
    }
  }

  function handleOpenPageOverview() {
    const initialPage = pdfMeta ? findIncludedPageNear(currentPage, excludedPages, pdfMeta.pages) : currentPage;
    setSelectedOverviewPages(new Set([initialPage]));
    setLastOverviewPage(initialPage);
    setPageOverviewOpen(true);
  }

  function handleOverviewPageClick(pageIndex: number, event: MouseEvent<HTMLButtonElement>) {
    if (!excludedPages.has(pageIndex)) setCurrentPage(pageIndex);
    setSelectedBoxId(null);
    setSelectedOverviewPages((prev) => {
      if (event.shiftKey && lastOverviewPage !== null) {
        const start = Math.min(lastOverviewPage, pageIndex);
        const end = Math.max(lastOverviewPage, pageIndex);
        const next = new Set(event.ctrlKey || event.metaKey ? prev : []);
        for (let page = start; page <= end; page += 1) next.add(page);
        return next;
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(prev);
        if (next.has(pageIndex)) next.delete(pageIndex);
        else next.add(pageIndex);
        return next;
      }
      return new Set([pageIndex]);
    });
    setLastOverviewPage(pageIndex);
  }

  function handleExcludeSelectedOverviewPages() {
    if (!pdfMeta || selectedOverviewPages.size === 0) return;
    const pagesToExclude = Array.from(selectedOverviewPages).filter((pageIndex) => !excludedPages.has(pageIndex));
    if (includedPageCount - pagesToExclude.length <= 0) {
      setUploadError("최소 1쪽은 남겨야 합니다.");
      return;
    }
    const next = new Set(excludedPages);
    for (const pageIndex of pagesToExclude) next.add(pageIndex);
    setExcludedPages(next);
    setUploadError(null);
    setCurrentPage((pageIndex) => findIncludedPageNear(pageIndex, next, pdfMeta.pages));
    setBoxes((prev) => {
      const numbered = reconcileCropBoxes(prev.filter((box) => !next.has(box.page)));
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
      return numbered;
    });
    setSelectedBoxId(null);
  }

  function handleRestoreSelectedOverviewPages() {
    if (selectedOverviewPages.size === 0) return;
    const next = new Set(excludedPages);
    for (const pageIndex of selectedOverviewPages) next.delete(pageIndex);
    setExcludedPages(next);
    setUploadError(null);
  }

  function handleSelectAllOverviewPages() {
    if (!pdfMeta) return;
    setSelectedOverviewPages(new Set(Array.from({ length: pdfMeta.pages }, (_, pageIndex) => pageIndex)));
    setLastOverviewPage(pdfMeta.pages - 1);
  }

  function handleClearOverviewSelection() {
    setSelectedOverviewPages(new Set());
    setLastOverviewPage(null);
  }

  function handleClosePageOverview() {
    if (pdfMeta) {
      setCurrentPage((pageIndex) => findIncludedPageNear(pageIndex, excludedPages, pdfMeta.pages));
    }
    setPageOverviewOpen(false);
  }

  // Preserves global creation order: in-place update existing, drop removed, append new.
  // Cross-page order unchanged; reordering happens via handleReorderBoxes (DnD).
  function handlePageBoxesChangeForPage(pageIndex: number, updatedPageBoxes: CropBox[]) {
    if (excludedPages.has(pageIndex)) return;
    setBoxes((prev) => {
      const updatedById = new Map(updatedPageBoxes.map((b) => [b.id, b]));
      const seen = new Set<string>();
      const result: CropBox[] = [];

      for (const b of prev) {
        if (b.page === pageIndex) {
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

      const numbered = reconcileCropBoxes(result);
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
      return numbered;
    });
  }

  function handleDeleteBox(id: string) {
    setBoxes((prev) => {
      const filtered = prev.filter((b) => b.id !== id);
      const numbered = reconcileCropBoxes(filtered);
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
      const numbered = reconcileCropBoxes(next);
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
      return numbered;
    });
  }

  function handlePageBoxesChange(updatedPageBoxes: CropBox[]) {
    handlePageBoxesChangeForPage(currentPage, updatedPageBoxes);
  }

  function updateSelectedBox(patch: Partial<CropBox>) {
    if (!selectedBoxId) return;
    setBoxes((prev) => {
      const next = prev.map((box) => (box.id === selectedBoxId ? { ...box, ...patch } : box));
      const numbered = reconcileCropBoxes(next);
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
      return numbered;
    });
  }

  function handleSelectedRegionTypeChange(regionType: CropRegionType) {
    if (!selectedBoxId) return;
    setBoxes((prev) => {
      const current = prev.find((box) => box.id === selectedBoxId);
      const currentOwner =
        current && !isProblemBox(current)
          ? current.ownerBoxId
          : prev.find((box) => isProblemBox(box) && box.id !== selectedBoxId)?.id;
      const next = prev.map((box) => {
        if (box.id !== selectedBoxId) return box;
        if (regionType === "problem") {
          const keepAsChildProblem = current && !isProblemBox(current) && currentOwner;
          return {
            ...box,
            regionType,
            ownerBoxId: keepAsChildProblem ? currentOwner : undefined,
            ownerNumber: keepAsChildProblem ? box.ownerNumber : undefined,
            figureMode: undefined,
          };
        }
        return {
          ...box,
          regionType,
          ownerBoxId: currentOwner,
          figureMode: regionType === "figure" ? box.figureMode ?? "original" : undefined,
        };
      });
      const numbered = reconcileCropBoxes(next);
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
      return numbered;
    });
  }

  function handleSelectedOwnerChange(ownerBoxId: string) {
    if (!selectedBoxId) return;
    const owner = boxes.find((box) => box.id === ownerBoxId && isProblemBox(box));
    updateSelectedBox({
      ownerBoxId: owner?.id,
      ownerNumber: owner?.number,
      number: owner?.number ?? 0,
    });
  }

  function handleAddChildRegion(problem: CropBox, regionType: CropRegionType) {
    if (!pdfMeta) return;
    if (excludedPages.has(problem.page)) return;
    const existingChildren = boxes.filter(
      (box) => !isProblemBox(box) && (box.ownerBoxId === problem.id || box.ownerNumber === problem.number)
    );
    const sortedChildren = [...existingChildren].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
    const lastChild = sortedChildren.filter((box) => box.page === problem.page).at(-1);
    const width =
      regionType === "problem"
        ? Math.max(120, Math.round(problem.w * 0.92))
        : Math.max(80, Math.round(problem.w * 0.38));
    const height =
      regionType === "problem"
        ? Math.max(80, Math.round(problem.h * 0.18))
        : Math.max(60, Math.round(problem.h * 0.22));
    const fallbackOffsetY = Math.min(
      Math.max(18, existingChildren.length * 22 + 18),
      Math.max(18, problem.h - height - 8)
    );
    const childX =
      regionType === "problem"
        ? problem.x + Math.max(0, Math.round(problem.w * 0.04))
        : problem.x + Math.max(12, Math.round(problem.w * 0.08));
    const childY = lastChild ? lastChild.y + lastChild.h + 12 : problem.y + fallbackOffsetY;
    const child: CropBox = {
      id: crypto.randomUUID(),
      page: problem.page,
      x: Math.min(childX, pdfMeta.page0Width - width),
      y: Math.min(childY, pdfMeta.page0Height - height),
      w: width,
      h: height,
      number: problem.number,
      regionType,
      ownerBoxId: problem.id,
      ownerNumber: problem.number,
      figureMode: regionType === "figure" ? "original" : undefined,
    };

    setBoxes((prev) => {
      const siblingIds = new Set(
        prev
          .filter((box) => !isProblemBox(box) && (box.ownerBoxId === problem.id || box.ownerNumber === problem.number))
          .map((box) => box.id)
      );
      const lastSiblingIndex = prev.reduce(
        (last, box, index) => (siblingIds.has(box.id) ? index : last),
        prev.findIndex((box) => box.id === problem.id)
      );
      const insertAt = Math.max(0, lastSiblingIndex + 1);
      const next = [...prev];
      next.splice(insertAt, 0, child);
      const numbered = reconcileCropBoxes(next);
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
      return numbered;
    });
    setCurrentPage(problem.page);
    setSelectedBoxId(child.id);
    setCreateRegionType(regionType);
  }

  function handleInsertProblemAfter(problem?: CropBox) {
    if (!pdfMeta) return;
    const page = problem?.page ?? currentPage;
    if (excludedPages.has(page)) return;
    const pageProblems = boxes
      .filter((box) => isProblemBox(box) && box.page === page)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const after = problem ?? pageProblems[pageProblems.length - 1];
    const afterIndex = after ? pageProblems.findIndex((box) => box.id === after.id) : -1;
    const nextProblem = afterIndex >= 0 ? pageProblems[afterIndex + 1] : undefined;
    const width = after?.w ?? Math.round(pdfMeta.page0Width * 0.82);
    const height = Math.max(140, Math.min(after?.h ?? 260, Math.round(pdfMeta.page0Height * 0.22)));
    const x = Math.max(0, Math.min(after?.x ?? Math.round(pdfMeta.page0Width * 0.08), pdfMeta.page0Width - width));
    const preferredY = after ? after.y + after.h + 20 : 40;
    const gapBottom = nextProblem ? nextProblem.y - 12 : pdfMeta.page0Height - 20;
    const y = Math.max(0, Math.min(preferredY, Math.max(0, gapBottom - height), pdfMeta.page0Height - height));
    const newProblem: CropBox = {
      id: crypto.randomUUID(),
      page,
      x,
      y,
      w: Math.max(80, Math.min(width, pdfMeta.page0Width - x)),
      h: height,
      number: 0,
      kind: "regular",
      regionType: "problem",
    };

    setBoxes((prev) => {
      const targetIdx = after ? prev.findIndex((box) => box.id === after.id) : prev.length - 1;
      const next = [...prev];
      next.splice(Math.max(0, targetIdx + 1), 0, newProblem);
      const numbered = reconcileCropBoxes(next);
      if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
      return numbered;
    });
    setCurrentPage(page);
    setSelectedBoxId(newProblem.id);
    setCreateRegionType("problem");
  }

  function goPrev() {
    if (!pdfMeta) return;
    if (previousIncludedPage === null) return;
    setCurrentPage(previousIncludedPage);
    setSelectedBoxId(null);
  }
  function goNext() {
    if (!pdfMeta) return;
    if (nextIncludedPage === null) return;
    setCurrentPage(nextIncludedPage);
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
      setThumbnailImages(new Map());
      setThumbnailErrors(new Set());
      setSelectedOverviewPages(new Set());
      setLastOverviewPage(null);
      setSelectedBoxId(null);
      try {
        setBoxes(
          reconcileCropBoxes(loadStoredBoxes(pdfPath, nextRotation, flip)).filter(
            (box) => !excludedPages.has(box.page)
          )
        );
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
      setThumbnailImages(new Map());
      setThumbnailErrors(new Set());
      setSelectedOverviewPages(new Set());
      setLastOverviewPage(null);
      setSelectedBoxId(null);
      try {
        setBoxes(
          reconcileCropBoxes(loadStoredBoxes(pdfPath, rotation, nextFlip)).filter(
            (box) => !excludedPages.has(box.page)
          )
        );
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
      if (pageOverviewOpen) return;
      if (e.key === "ArrowLeft" && previousIncludedPage !== null) {
        setCurrentPage(previousIncludedPage);
        setSelectedBoxId(null);
      }
      if (e.key === "ArrowRight" && nextIncludedPage !== null) {
        setCurrentPage(nextIncludedPage);
        setSelectedBoxId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pdfMeta, pageOverviewOpen, previousIncludedPage, nextIncludedPage]);

  useEffect(() => {
    if (!pageOverviewOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (pdfMeta) {
        setCurrentPage((pageIndex) => findIncludedPageNear(pageIndex, excludedPages, pdfMeta.pages));
      }
      setPageOverviewOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageOverviewOpen, excludedPages, pdfMeta]);

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

  function getAutoCropProviderError(provider: ImageProviderId): string | null {
    if (provider === "gemini" && geminiMissing) {
      return "Gemini API 키가 설정되지 않았습니다. 설정에서 입력 후 다시 시도하세요.";
    }
    if (provider === "codex-cli" && codexMissing) {
      return "Codex CLI가 준비되지 않았습니다. 설치와 로그인을 확인한 뒤 다시 시도하세요.";
    }
    return null;
  }

  function applyAutoCropResult(data: AutoCropResult) {
    const result: CropBox[] = [];
    const pageWidthByIndex = new Map(data.pages.map((page) => [page.pageIndex, page.imageWidth]));
    for (const page of data.pages) {
      if (excludedPages.has(page.pageIndex)) continue;
      if (page.answerPage) continue;
      for (const q of page.questions) {
        const problemId = crypto.randomUUID();
        const box = normalizedBboxToCropBox({
          bbox: q.bbox,
          pageIndex: page.pageIndex,
          imageWidth: page.imageWidth,
          imageHeight: page.imageHeight,
          number: typeof q.number === "number" ? q.number : 0,
          kind: q.kind,
          id: problemId,
        });
        result.push({ ...box, regionType: "problem" });
        for (const region of q.regions ?? []) {
          const regionType = normalizeAutoRegionType(region.regionType ?? region.type);
          const bbox = region.bbox ?? region.box_2d;
          if (!regionType || regionType === "problem" || !bbox) continue;
          const regionBox = normalizedBboxToCropBox({
            bbox,
            pageIndex: page.pageIndex,
            imageWidth: page.imageWidth,
            imageHeight: page.imageHeight,
            number: typeof q.number === "number" ? q.number : 0,
            kind: q.kind,
          });
          result.push({
            ...regionBox,
            regionType,
            ownerBoxId: problemId,
            ownerNumber: parseLooseNumber(q.number),
            label: region.label,
            instruction: region.instruction,
            figureMode: regionType === "figure" ? region.figureMode ?? "original" : undefined,
          });
        }
      }
      for (const region of page.regions ?? []) {
        const regionType = normalizeAutoRegionType(region.regionType ?? region.type);
        const bbox = region.bbox ?? region.box_2d;
        if (!regionType || regionType === "problem" || !bbox) continue;
        const ownerNumber = parseLooseNumber(region.ownerNumber ?? region.owner ?? region.number);
        const regionBox = normalizedBboxToCropBox({
          bbox,
          pageIndex: page.pageIndex,
          imageWidth: page.imageWidth,
          imageHeight: page.imageHeight,
          number: ownerNumber ?? 0,
        });
        result.push({
          ...regionBox,
          regionType,
          ownerNumber,
          label: region.label,
          instruction: region.instruction,
          figureMode: regionType === "figure" ? region.figureMode ?? "original" : undefined,
        });
      }
    }

    result.sort((a, b) => (
      a.page - b.page ||
      cropBoxColumn(a, pageWidthByIndex) - cropBoxColumn(b, pageWidthByIndex) ||
      a.y - b.y ||
      a.x - b.x
    ));

    const numbered = reconcileCropBoxes(result);
    const reviewIssues = buildAutoCropReviewIssues({
      boxes: numbered,
      data,
      excludedPages,
    });
    setBoxes(numbered);
    setAutoCropReviewIssues(reviewIssues);
    if (reviewIssues.length > 0) {
      const firstIssue = reviewIssues[0];
      setCurrentPage(findIncludedPageNear(firstIssue.pageIndex, excludedPages, pdfMeta?.pages ?? data.pages.length));
      setSelectedBoxId(firstIssue.boxId ?? null);
    } else {
      setSelectedBoxId(null);
    }
    if (pdfPath) saveToLS(pdfPath, rotation, flip, numbered);
  }

  function cropBoxColumn(box: CropBox, pageWidthByIndex: Map<number, number>): number {
    const pageWidth = pageWidthByIndex.get(box.page) ?? 1;
    const xMin = (box.x / pageWidth) * 1000;
    const xMax = ((box.x + box.w) / pageWidth) * 1000;
    const centerX = (xMin + xMax) / 2;
    return centerX >= 575 && xMin >= 360 ? 1 : 0;
  }

  async function pollAutoCropJob(jobId: string, provider: ImageProviderId): Promise<AutoCropResult> {
    while (true) {
      const res = await fetch(`/api/auto-crop/jobs/${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const error = errData as { error?: string };
        throw new Error(error.error ?? `자동분할 상태 조회 실패 (${res.status})`);
      }

      const data = await res.json() as { job?: AutoCropJob };
      const job = data.job;
      if (!job) throw new Error("자동분할 상태 응답이 비어 있습니다.");

      setAutoCropProgress({
        provider,
        status: job.status,
        phase: job.phase,
        message: job.message,
        progress: job.progress,
        currentPage: job.currentPage,
        totalPages: job.totalPages,
      });

      if (job.status === "completed") {
        if (!job.result) throw new Error("자동분할 결과가 비어 있습니다.");
        return job.result;
      }
      if (job.status === "failed") {
        const detail = job.detail ? `: ${job.detail}` : "";
        throw new Error(`${job.error ?? "자동분할 실패"}${detail}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async function handleAutoCrop(provider: ImageProviderId) {
    if (!pdfPath || !pdfMeta) return;
    const pagesToProcess = includedPages;
    if (pagesToProcess.length === 0) {
      setAutoCropError("자동분할에 사용할 PDF 쪽이 없습니다. 최소 1쪽은 남겨주세요.");
      return;
    }
    const providerError = getAutoCropProviderError(provider);
    if (providerError) {
      setAutoCropError(providerError);
      return;
    }

    if (boxes.length > 0) {
      const ok = window.confirm(
        `기존 박스 ${boxes.length}개를 모두 비우고 ${AUTO_CROP_PROVIDER_LABEL[provider]} 자동 분할을 진행하시겠습니까?`
      );
      if (!ok) return;
    }

    setAutoCroppingProvider(provider);
    setAutoCropError(null);
    setAutoCropProgress({
      provider,
      status: "running",
      phase: "queued",
      message: `${AUTO_CROP_PROVIDER_LABEL[provider]} 자동분할 준비 중`,
      progress: 0,
      currentPage: 0,
      totalPages: pagesToProcess.length,
    });

    try {
      const res = await fetch("/api/auto-crop/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfPath,
          rotation,
          flip,
          provider,
          mode: autoCropMode,
          totalPages: pdfMeta.pages,
          includedPages: pagesToProcess,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const error = errData as { error?: string; detail?: string };
        const detail = error.detail ? `: ${error.detail}` : "";
        throw new Error(`${error.error ?? `HTTP ${res.status}`}${detail}`);
      }

      const startData = await res.json() as { jobId?: string; job?: AutoCropJob };
      if (startData.job) {
        setAutoCropProgress({
          provider,
          status: startData.job.status,
          phase: startData.job.phase,
          message: startData.job.message,
          progress: startData.job.progress,
          currentPage: startData.job.currentPage,
          totalPages: startData.job.totalPages || pagesToProcess.length,
        });
      }
      if (!startData.jobId) throw new Error("자동분할 작업 ID를 받지 못했습니다.");

      const data = await pollAutoCropJob(startData.jobId, provider);
      applyAutoCropResult(data);
      setAutoSplitDeferred(false);
    } catch (err) {
      setAutoCropError(err instanceof Error ? err.message : "자동 분할 실패");
    } finally {
      setAutoCroppingProvider(null);
      setAutoCropProgress(null);
    }
  }

  function handleAutoCropModeChange(mode: AutoCropMode) {
    setAutoCropMode(mode);
    window.localStorage.setItem(AUTO_CROP_MODE_LS_KEY, mode);
  }

  async function cropAllBoxesToBlobs(): Promise<CropItem[]> {
    if (!pdfPath || !pdfMeta) return [];

    const items: CropItem[] = [];
    const rootProblems = boxes
      .filter((box) => isProblemBox(box) && !excludedPages.has(box.page))
      .sort((a, b) => {
        const an = typeof a.number === "number" ? a.number : Number(a.number);
        const bn = typeof b.number === "number" ? b.number : Number(b.number);
        if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
        return a.page - b.page || a.y - b.y || a.x - b.x;
    });
    for (const box of rootProblems) {
      const segments = sortedSegmentsForProblem(box, boxes).filter((segment) => !excludedPages.has(segment.page));
      const segmentImages = [];
      for (const segment of segments) {
        const blobUrl = pageImages.get(segment.page) ?? await fetchPage(segment.page, pdfPath, pdfMeta);
        if (!blobUrl) continue;
        segmentImages.push({ box: segment, img: await loadImage(blobUrl) });
      }
      if (segmentImages.length === 0) continue;

      const minX = Math.min(...segmentImages.map(({ box: segment }) => segment.x));
      const maxX = Math.max(...segmentImages.map(({ box: segment }) => segment.x + segment.w));
      const gap = segmentImages.length > 1 ? 8 : 0;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, maxX - minX);
      canvas.height = Math.max(
        1,
        segmentImages.reduce((sum, { box: segment }) => sum + segment.h, 0) + gap * (segmentImages.length - 1)
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let offsetY = 0;
      for (const { box: segment, img } of segmentImages) {
        ctx.drawImage(
          img,
          segment.x,
          segment.y,
          segment.w,
          segment.h,
          segment.x - minX,
          offsetY,
          segment.w,
          segment.h
        );
        offsetY += segment.h + gap;
      }

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
    if (boxes.filter(isProblemBox).length === 0) return;
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

  const problemBoxes = boxes.filter((box) => isProblemBox(box) && !excludedPages.has(box.page));
  const sortedProblemBoxes = [...problemBoxes].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const selectedBox = selectedBoxId ? boxes.find((box) => box.id === selectedBoxId) ?? null : null;
  const selectedRegionType = selectedBox ? cropRegionType(selectedBox) : null;
  const selectedProblemForCreate =
    selectedBox && isProblemBox(selectedBox)
      ? selectedBox
      : selectedBox?.ownerBoxId
      ? problemBoxes.find((box) => box.id === selectedBox.ownerBoxId) ?? null
      : null;
  const createOwnerBoxId = selectedProblemForCreate?.id ?? null;

  function renderPdfPage(pageIndex: number) {
    if (!pdfMeta) return null;
    const pageImageUrl = pageImages.get(pageIndex) ?? null;
    const pageExcluded = excludedPages.has(pageIndex);
    const pageBoxes = pageExcluded ? [] : boxes.filter((b) => b.page === pageIndex);
    const pageWidth = Math.max(1, Math.round(pdfMeta.page0Width * viewerZoom));
    const pageHeight = Math.max(1, Math.round(pdfMeta.page0Height * viewerZoom));

    return (
      <div key={pageIndex} className="relative shrink-0">
        <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
          <span>p.{pageIndex + 1}</span>
          {pageExcluded && <span className="text-red-600">제외됨</span>}
        </div>
        {!pageImageUrl ? (
          <div
            className="flex items-center justify-center rounded border bg-muted/20 text-xs text-muted-foreground"
            style={{ width: pageWidth, height: pageHeight }}
          >
            {loadingPage ? "페이지 로딩 중..." : "페이지를 불러올 수 없습니다."}
          </div>
        ) : (
          <PdfPageCanvas
            pageImageUrl={pageImageUrl}
            pageIndex={pageIndex}
            imageWidth={pdfMeta.page0Width}
            imageHeight={pdfMeta.page0Height}
            boxes={pageBoxes}
            selectedBoxId={selectedBoxId}
            createRegionType={createRegionType}
            createOwnerBoxId={createOwnerBoxId}
            displayScale={viewerZoom}
            onBoxesChange={(updated) => handlePageBoxesChangeForPage(pageIndex, updated)}
            onSelectBox={setSelectedBoxId}
          />
        )}
        {pageExcluded && (
          <div className="absolute inset-x-0 bottom-0 top-5 z-10 flex items-center justify-center bg-white/55">
            <div className="rounded border border-red-200 bg-white px-4 py-3 text-center text-sm text-red-700 shadow-sm">
              <div className="font-semibold">자동분할에서 제외한 쪽입니다.</div>
              <button
                type="button"
                onClick={() => {
                  setCurrentPage(pageIndex);
                  handleToggleCurrentPageExcluded();
                }}
                className="mt-2 rounded border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
              >
                이 쪽 복원
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-2 px-4 py-2 border-b shrink-0 bg-muted/5">
        {/* Hidden Upload Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={handleFileChange}
          disabled={uploading}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {pdfMeta ? "PDF 다시 열기" : uploading ? "업로드 중..." : "PDF 파일 선택"}
        </button>

        {/* Page navigation */}
        {pdfMeta && (
          <>
            <button
              onClick={goPrev}
              disabled={previousIncludedPage === null}
              className="shrink-0 px-2 py-1 rounded border text-sm disabled:opacity-40 hover:bg-secondary"
            >
              ←
            </button>
            <span className="text-sm tabular-nums">
              {currentPage + 1} / {pdfMeta.pages}
            </span>
            <span
              className={`shrink-0 whitespace-nowrap rounded border px-2 py-1 text-xs ${
                currentPageExcluded
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
              title="자동분할과 추출에 포함될 PDF 쪽 수"
            >
              {currentPageExcluded ? "제외됨" : `사용 ${includedPageCount}/${pdfMeta.pages}`}
            </span>
            <button
              onClick={goNext}
              disabled={nextIncludedPage === null}
              className="shrink-0 px-2 py-1 rounded border text-sm disabled:opacity-40 hover:bg-secondary"
            >
              →
            </button>
            <button
              type="button"
              onClick={handleToggleCurrentPageExcluded}
              className={`shrink-0 whitespace-nowrap px-2 py-1 rounded border text-xs font-medium ${
                currentPageExcluded
                  ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  : "border-red-300 text-red-700 hover:bg-red-50"
              }`}
            >
              {currentPageExcluded ? "현재 쪽 복원" : "현재 쪽 제외"}
            </button>
            <button
              type="button"
              onClick={handleOpenPageOverview}
              className="shrink-0 whitespace-nowrap px-2 py-1 rounded border text-xs font-medium hover:bg-secondary"
            >
              전체 쪽 보기
            </button>
            <div className="flex shrink-0 items-center gap-1 border-l pl-3">
              <div className="flex overflow-hidden rounded border" aria-label="PDF 보기 방식">
                <button
                  type="button"
                  onClick={() => setPageViewMode("single")}
                  aria-pressed={pageViewMode === "single"}
                  className={`px-2 py-1 text-xs font-medium ${
                    pageViewMode === "single"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-secondary"
                  }`}
                >
                  한쪽
                </button>
                <button
                  type="button"
                  onClick={() => setPageViewMode("spread")}
                  aria-pressed={pageViewMode === "spread"}
                  className={`px-2 py-1 text-xs font-medium ${
                    pageViewMode === "spread"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-secondary"
                  }`}
                >
                  두쪽
                </button>
              </div>
              <button
                type="button"
                onClick={() => setViewerZoom((z) => clampViewerZoom(z - 0.1))}
                className="rounded border px-2 py-1 text-xs font-medium hover:bg-secondary"
                aria-label="축소"
                title="축소"
              >
                -
              </button>
              <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(viewerZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setViewerZoom((z) => clampViewerZoom(z + 0.1))}
                className="rounded border px-2 py-1 text-xs font-medium hover:bg-secondary"
                aria-label="확대"
                title="확대"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setViewerZoom(pageViewMode === "spread" ? 0.42 : 0.65)}
                className="rounded border px-2 py-1 text-xs font-medium hover:bg-secondary"
                title="현재 보기 방식에 맞는 기본 배율로 되돌립니다."
              >
                맞춤
              </button>
            </div>
          </>
        )}

        {/* Rotation */}
        {pdfMeta && (
          <div className="flex shrink-0 items-center gap-1 border-l pl-3">
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
          <div className="flex shrink-0 items-center gap-1 border-l pl-3">
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

        {/* Auto-crop action */}
        {pdfMeta && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-l pl-3">
            <button
              type="button"
              onClick={() => void handleAutoCrop(autoSplitProvider)}
              disabled={autoCropping || Boolean(getAutoCropProviderError(autoSplitProvider))}
              title={getAutoCropProviderError(autoSplitProvider) ?? undefined}
              className="whitespace-nowrap px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {autoCroppingProvider
                ? `${AUTO_CROP_PROVIDER_LABEL[autoCroppingProvider]} 분할 중…`
                : `자동분할 실행 (${AUTO_CROP_PROVIDER_LABEL[autoSplitProvider]} · ${AUTO_CROP_MODE_LABEL[autoCropMode]})`}
            </button>
          </div>
        )}

        {pdfMeta && (
          <div className="flex shrink-0 items-center gap-1 border-l pl-3">
            <span className="shrink-0 text-xs text-muted-foreground">영역</span>
            <div className="flex shrink-0 items-center rounded border overflow-hidden">
              {CROP_REGION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setCreateRegionType(type)}
                  aria-pressed={createRegionType === type}
                  title={REGION_HELP[type]}
                  className={`whitespace-nowrap px-2 py-1 text-xs font-medium ${
                    createRegionType === type
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-secondary"
                  }`}
                >
                  {REGION_LABEL[type]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1" />

        {/* Extract button */}
        {problemBoxes.length > 0 && (
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {extracting
              ? "추출 중..."
              : onExtract
              ? `과학 자료 타이핑 시작 (${problemBoxes.length}문제)`
              : `추출 실행 (${problemBoxes.length}문제)`}
          </button>
        )}
      </header>

      {uploadError && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm">
          {uploadError}
        </div>
      )}

      {pdfMeta && workflowOptions && (
        <div className="border-b bg-muted/10 px-4 py-2">
          {workflowOptions}
        </div>
      )}

      {pdfMeta && autoSplitDeferred && (
        <div className="px-4 py-2 bg-amber-50 text-amber-900 text-sm border-b border-amber-100 flex items-center justify-between gap-3">
          <span>
            PDF 쪽 정리 단계입니다. 필요 없는 쪽을 제외한 뒤 자동분할을 시작하세요.
            <span className="ml-2 text-xs tabular-nums text-amber-700">
              사용 {includedPageCount}/{pdfMeta.pages}쪽
            </span>
          </span>
          <button
            type="button"
            onClick={() => void handleAutoCrop(autoSplitProvider)}
            disabled={autoCropping || includedPageCount === 0 || Boolean(getAutoCropProviderError(autoSplitProvider))}
            className="shrink-0 rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            쪽 정리 후 자동분할
          </button>
        </div>
      )}

      {autoCropProgress && (
        <div className="px-4 py-2 bg-blue-50 text-blue-900 text-sm border-b border-blue-100">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">
              {AUTO_CROP_PROVIDER_LABEL[autoCropProgress.provider]} 자동분할 진행 중
            </span>
            <span className="text-xs tabular-nums text-blue-700">
              {autoCropProgress.totalPages > 0
                ? `${autoCropProgress.currentPage}/${autoCropProgress.totalPages} 페이지`
                : autoCropProgress.phase}
              {" · "}
              {Math.round(autoCropProgress.progress)}%
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-blue-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-500"
              style={{ width: `${Math.max(0, Math.min(100, autoCropProgress.progress))}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-blue-700 truncate">
            {autoCropProgress.message}
          </div>
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

      {autoCropReviewIssues.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold">자동분할 초안 검수 {autoCropReviewIssues.length}건</span>
              <span className="ml-2 text-xs text-amber-800">
                겹침, 과대 박스, 내부 영역 이탈을 먼저 확인하세요.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const firstIssue = autoCropReviewIssues[0];
                  setPageOverviewOpen(false);
                  setCurrentPage(findIncludedPageNear(firstIssue.pageIndex, excludedPages, pdfMeta?.pages ?? 1));
                  setSelectedBoxId(firstIssue.boxId ?? null);
                }}
                className="rounded bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800"
              >
                첫 검수 위치로 이동
              </button>
              <button
                type="button"
                onClick={() => setAutoCropReviewIssues([])}
                className="rounded border border-amber-300 bg-white/70 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-white"
              >
                검수 완료
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {autoCropReviewIssues.slice(0, 8).map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => {
                  setPageOverviewOpen(false);
                  setCurrentPage(findIncludedPageNear(issue.pageIndex, excludedPages, pdfMeta?.pages ?? 1));
                  setSelectedBoxId(issue.boxId ?? null);
                }}
                className={`rounded border px-2 py-1 text-[11px] font-medium ${
                  issue.severity === "error"
                    ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
                    : "border-amber-300 bg-white/70 text-amber-900 hover:bg-white"
                }`}
                title={issue.message}
              >
                {issue.title}
              </button>
            ))}
            {autoCropReviewIssues.length > 8 && (
              <span className="px-2 py-1 text-[11px] text-amber-800">
                외 {autoCropReviewIssues.length - 8}건
              </span>
            )}
          </div>
        </div>
      )}

      {pageOverviewOpen && pdfMeta && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-neutral-950 text-white">
          <div className="shrink-0 border-b border-white/10 px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">PDF 전체 쪽 보기</div>
                <div className="mt-0.5 text-xs text-white/60">
                  Ctrl+클릭으로 여러 쪽 선택 · Shift+클릭으로 범위 선택 · 더블클릭하면 해당 쪽으로 이동
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-white/15 px-2 py-1 text-xs tabular-nums text-white/80">
                  선택 {selectedOverviewPages.size} · 사용 {includedPageCount}/{pdfMeta.pages}쪽
                </span>
                <button
                  type="button"
                  onClick={handleSelectAllOverviewPages}
                  className="rounded border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
                >
                  전체 선택
                </button>
                <button
                  type="button"
                  onClick={handleClearOverviewSelection}
                  disabled={selectedOverviewPages.size === 0}
                  className="rounded border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-40"
                >
                  선택 해제
                </button>
                <button
                  type="button"
                  onClick={handleExcludeSelectedOverviewPages}
                  disabled={selectedOverviewPages.size === 0}
                  className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                >
                  선택 쪽 제외
                </button>
                <button
                  type="button"
                  onClick={handleRestoreSelectedOverviewPages}
                  disabled={selectedOverviewPages.size === 0}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  선택 쪽 복원
                </button>
                <button
                  type="button"
                  onClick={handleClosePageOverview}
                  className="rounded border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                >
                  닫기
                </button>
              </div>
            </div>
            {loadingThumbnails && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-white/50" />
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto px-8 py-7">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-10 gap-y-10">
              {Array.from({ length: pdfMeta.pages }, (_, pageIndex) => {
                const selected = selectedOverviewPages.has(pageIndex);
                const excluded = excludedPages.has(pageIndex);
                const thumbnailUrl = thumbnailImages.get(pageIndex);
                const thumbnailFailed = thumbnailErrors.has(pageIndex);
                const isCurrent = pageIndex === currentPage;
                return (
                  <button
                    key={pageIndex}
                    type="button"
                    onClick={(event) => handleOverviewPageClick(pageIndex, event)}
                    onDoubleClick={() => {
                      if (excluded) {
                        setSelectedOverviewPages(new Set([pageIndex]));
                        setLastOverviewPage(pageIndex);
                        return;
                      }
                      setCurrentPage(pageIndex);
                      setPageOverviewOpen(false);
                    }}
                    className="group flex min-w-0 flex-col items-center gap-2 text-center outline-none"
                    aria-pressed={selected}
                  >
                    <span
                      className={`relative flex aspect-[3/4] w-full max-w-[220px] items-center justify-center overflow-hidden border bg-white shadow-sm transition ${
                        selected
                          ? "border-blue-400 ring-4 ring-blue-400/45"
                          : isCurrent && !excluded
                          ? "border-white ring-2 ring-white/45"
                          : "border-white/30 group-hover:border-white/70"
                      } ${excluded ? "opacity-60" : ""}`}
                    >
                      {thumbnailUrl && !thumbnailFailed ? (
                        <img
                          src={thumbnailUrl}
                          alt={`${pageIndex + 1}쪽 미리보기`}
                          className="h-full w-full object-contain"
                          draggable={false}
                          onError={() => {
                            setThumbnailImages((prev) => {
                              const existing = prev.get(pageIndex);
                              if (existing) URL.revokeObjectURL(existing);
                              const next = new Map(prev);
                              next.delete(pageIndex);
                              return next;
                            });
                            setThumbnailErrors((prev) => {
                              const next = new Set(prev);
                              next.add(pageIndex);
                              return next;
                            });
                          }}
                        />
                      ) : thumbnailFailed ? (
                        <span className="px-3 text-xs leading-5 text-neutral-500">
                          미리보기 실패
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-500">불러오는 중...</span>
                      )}
                      {excluded && (
                        <span className="absolute inset-0 flex items-center justify-center bg-red-950/55 text-sm font-bold text-white">
                          제외
                        </span>
                      )}
                      {selected && (
                        <span className="absolute left-2 top-2 rounded bg-blue-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
                          선택
                        </span>
                      )}
                    </span>
                    <span className={`text-sm tabular-nums ${excluded ? "text-red-300" : "text-white/85"}`}>
                      {pageIndex + 1}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 overflow-auto p-4">
          {!pdfPath && (
            <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground mt-24">
              <p className="text-lg">PDF 파일을 업로드하세요</p>
              <p className="text-sm">
                왼쪽 상단의 &ldquo;PDF 열기&rdquo; 버튼 또는 파일을 선택하세요.
              </p>
            </div>
          )}

          {pdfPath && !pdfMeta && (
            <div className="flex items-center justify-center mt-24 text-muted-foreground">
              {loadingPage ? "페이지 로딩 중..." : "페이지를 불러올 수 없습니다."}
            </div>
          )}

          {pdfPath && pdfMeta && (
            <div className="flex min-w-max items-start justify-center gap-4">
              {visiblePageIndexes.map((pageIndex) => renderPdfPage(pageIndex))}
            </div>
          )}
        </div>

        {/* Side panel */}
        {pdfPath && (
          <aside className="w-80 border-l flex flex-col shrink-0 overflow-hidden bg-background">
            <div className="px-3 py-2 border-b">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">문제/영역</span>
                <span className="text-[11px] text-muted-foreground">
                  문제 {problemBoxes.length} · 영역 {boxes.length - problemBoxes.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleInsertProblemAfter()}
                disabled={currentPageExcluded}
                className="mt-2 w-full px-2 py-1.5 rounded border text-xs font-medium hover:bg-secondary"
              >
                현재 페이지에 문제 추가
              </button>
              {pdfMeta && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded border bg-muted/20 px-2 py-1.5">
                  <div className="min-w-0 text-[11px]">
                    <div className="font-medium text-foreground">PDF 쪽</div>
                    <div className="mt-0.5 truncate tabular-nums text-muted-foreground">
                      사용 {includedPageCount}/{pdfMeta.pages}쪽 · 제외 {excludedPages.size}쪽
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenPageOverview}
                    className="shrink-0 rounded border bg-background px-2 py-1 text-[11px] font-medium hover:bg-secondary"
                  >
                    전체 보기
                  </button>
                </div>
              )}
              {autoCropReviewIssues.length > 0 && (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-950">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">자동분할 검수</span>
                    <button
                      type="button"
                      onClick={() => setAutoCropReviewIssues([])}
                      className="text-[10px] font-medium text-amber-800 hover:underline"
                    >
                      완료
                    </button>
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {autoCropReviewIssues.slice(0, 6).map((issue) => (
                      <button
                        key={issue.id}
                        type="button"
                        onClick={() => {
                          setPageOverviewOpen(false);
                          setCurrentPage(findIncludedPageNear(issue.pageIndex, excludedPages, pdfMeta?.pages ?? 1));
                          setSelectedBoxId(issue.boxId ?? null);
                        }}
                        className="block w-full rounded border border-amber-200 bg-white/70 px-2 py-1 text-left hover:bg-white"
                        title={issue.message}
                      >
                        <span className={issue.severity === "error" ? "font-semibold text-red-700" : "font-semibold"}>
                          {issue.title}
                        </span>
                        <span className="mt-0.5 block truncate text-amber-800">
                          {issue.message}
                        </span>
                      </button>
                    ))}
                    {autoCropReviewIssues.length > 6 && (
                      <div className="text-amber-800">
                        외 {autoCropReviewIssues.length - 6}건은 상단 검수 바에서 확인하세요.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="hidden">
              박스 리스트
            </div>

            <div className="flex-1 overflow-y-auto">
              {sortedProblemBoxes.length === 0 ? (
                <p className="px-3 py-4 text-xs leading-5 text-muted-foreground">
                  문제 영역이 없습니다.
                  <br />
                  상단에서 문제를 선택한 뒤 PDF 위를 드래그하거나, 현재 페이지에 문제를 추가하세요.
                </p>
              ) : (
                <ul className="divide-y">
                  {sortedProblemBoxes.map((problem) => {
                    const counts = countChildRegions(problem, boxes);
                    const children = boxes.filter(
                      (box) =>
                        !isProblemBox(box) &&
                        (box.ownerBoxId === problem.id || box.ownerNumber === problem.number)
                    );
                    return (
                      <li key={problem.id} className={problem.id === selectedBoxId ? "bg-secondary/70" : ""}>
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentPage(problem.page);
                            setSelectedBoxId(problem.id);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-secondary"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">문제 #{problem.number}</span>
                            <span className="text-[11px] text-muted-foreground">p.{problem.page + 1}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {CHILD_REGION_TYPES.map((type) => (
                              <span
                                key={type}
                                className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                              >
                                {REGION_LABEL[type]} {counts[type]}
                              </span>
                            ))}
                          </div>
                        </button>

                        {children.length > 0 && (
                          <div className="px-3 pb-2 space-y-1">
                            {children.map((child) => {
                              const type = cropRegionType(child);
                              return (
                                <button
                                  key={child.id}
                                  type="button"
                                  onClick={() => {
                                    setCurrentPage(child.page);
                                    setSelectedBoxId(child.id);
                                  }}
                                  className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-secondary ${
                                    child.id === selectedBoxId ? "bg-secondary" : "text-muted-foreground"
                                  }`}
                                >
                                  {REGION_LABEL[type]} · ({Math.round(child.x)}, {Math.round(child.y)})
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <div className="px-3 pb-2 flex flex-wrap gap-1">
                          {CHILD_REGION_TYPES.map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => handleAddChildRegion(problem, type)}
                              className="px-2 py-1 rounded border text-[11px] hover:bg-secondary"
                            >
                              + {REGION_LABEL[type]}
                            </button>
                          ))}
                        </div>

                        <div className="px-3 pb-3">
                          <button
                            type="button"
                            onClick={() => handleInsertProblemAfter(problem)}
                            className="w-full px-2 py-1 rounded border border-dashed text-xs hover:bg-secondary"
                          >
                            이 문제 아래에 새 문제 추가
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {selectedBox && selectedRegionType && (
              <div className="border-t px-3 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">선택 영역</span>
                  <button
                    type="button"
                    onClick={() => handleDeleteBox(selectedBox.id)}
                    className="px-2 py-1 rounded border text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  >
                    삭제
                  </button>
                </div>

                <label className="block text-[11px] text-muted-foreground">
                  영역 타입
                  <select
                    value={selectedRegionType}
                    onChange={(e) => handleSelectedRegionTypeChange(e.target.value as CropRegionType)}
                    className="mt-1 w-full rounded border bg-background px-2 py-1 text-xs text-foreground"
                  >
                    {CROP_REGION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {REGION_LABEL[type]}
                      </option>
                    ))}
                  </select>
                </label>

                {!isProblemBox(selectedBox) && (
                  <label className="block text-[11px] text-muted-foreground">
                    소속 문제
                    <select
                      value={selectedBox.ownerBoxId ?? ""}
                      onChange={(e) => handleSelectedOwnerChange(e.target.value)}
                      className="mt-1 w-full rounded border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      <option value="">자동 추정</option>
                      {sortedProblemBoxes.map((problem) => (
                        <option key={problem.id} value={problem.id}>
                          문제 #{problem.number} · p.{problem.page + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedRegionType === "figure" && (
                  <label className="block text-[11px] text-muted-foreground">
                    그림 처리
                    <select
                      value={selectedBox.figureMode ?? "original"}
                      onChange={(e) => updateSelectedBox({ figureMode: e.target.value as FigureRegionMode })}
                      className="mt-1 w-full rounded border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      {Object.entries(FIGURE_MODE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="block text-[11px] text-muted-foreground">
                  라벨
                  <input
                    value={selectedBox.label ?? ""}
                    onChange={(e) => updateSelectedBox({ label: e.target.value })}
                    className="mt-1 w-full rounded border bg-background px-2 py-1 text-xs text-foreground"
                    placeholder="예: 공통 그림, 실험 자료"
                  />
                </label>

                <label className="block text-[11px] text-muted-foreground">
                  재생성 지시
                  <textarea
                    value={selectedBox.instruction ?? ""}
                    onChange={(e) => updateSelectedBox({ instruction: e.target.value })}
                    className="mt-1 h-16 w-full resize-none rounded border bg-background px-2 py-1 text-xs text-foreground"
                    placeholder="그림 재생성 시 주의할 점"
                  />
                </label>
              </div>
            )}

            <div className="hidden">
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
