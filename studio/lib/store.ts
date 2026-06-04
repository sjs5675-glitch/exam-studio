import { create } from "zustand";
import { PIPELINE_STAGES, type PipelineStageName } from "@/lib/pipelineStages";
import type { PipelineStage } from "@/components/pipeline/PipelineView";
import type { LogEntry } from "@/components/log/LogStream";
import type { ExamMetaInput } from "@/lib/exam/meta";

export interface QuestionFigureResult {
  /** "ok": 그림 처리 성공, "failed": 실패, "boundary_uncertain": 경계 재조정 필요 */
  status: "ok" | "failed" | "boundary_uncertain";
  /** 생성된 그림 파일의 경로 (있을 때) */
  image?: string;
  /** figure_status.json 원본 finalImage 경로. image와 동일하게 쓰되 후방호환을 위해 둘 다 허용. */
  finalImage?: string;
  /** 실패 시 에러 메시지 */
  error?: string;
}

export interface QuestionResult {
  number: number;
  extracted?: Record<string, unknown>;
  solved?: Record<string, unknown>;
  verified?: Record<string, unknown>;
  figure?: QuestionFigureResult;
  updatedAt: string;
}

/** Store meta shape — ExamMetaInput plus UI-only fields. */
export type V3Meta = ExamMetaInput & { questionCount?: number; resumeFrom?: string };

export interface JobState {
  jobId: string | null;
  mode: "create" | "resume" | "crop" | null;
  status: "idle" | "uploading" | "running" | "paused" | "done" | "failed";
  stages: PipelineStage[];
  logs: LogEntry[];
  files: { name: string; size: number; path: string }[];
  intermediateFiles: { type: string; name: string; path: string }[];
  result: { status: string; outputPath?: string; summary?: string } | null;
  questionResults: Record<number, QuestionResult>;
  v3Meta: V3Meta | null;
  extractionReviewActive: boolean;
  /** master-detail UI에서 현재 선택된 문제 번호 */
  selectedQuestionNumber: number | null;

  // Actions
  reset: () => void;
  setJobId: (id: string) => void;
  setMode: (mode: "create" | "resume" | "crop", resumeFrom?: string) => void;
  setStatus: (status: JobState["status"]) => void;
  setFiles: (files: JobState["files"]) => void;
  setStages: (stages: PipelineStage[]) => void;
  updateStage: (name: string, update: Partial<PipelineStage>) => void;
  addLog: (log: LogEntry) => void;
  addIntermediateFile: (file: { type: string; name: string; path: string }) => void;
  setResult: (result: JobState["result"]) => void;
  updateQuestionResult: (number: number, phase: string, content: Record<string, unknown>) => void;
  /** 주어진 번호들에 대해 빈 QuestionResult stub을 생성. 이미 존재하면 건드리지 않음. */
  seedQuestionResults: (numbers: number[]) => void;
  setV3Meta: (meta: V3Meta) => void;
  setExtractionReviewActive: (active: boolean) => void;
  setSelectedQuestionNumber: (n: number | null) => void;
}

const createStages: PipelineStage[] = [
  { name: "extractor", label: "문제 추출", status: "pending" },
  { name: "solver",    label: "해설 생성", status: "pending" },
  { name: "verifier",  label: "해설 검증", status: "pending" },
  { name: "figure",    label: "그림 처리", status: "pending" },
  { name: "builder",   label: "HWPX 조립", status: "pending" },
  { name: "checker",   label: "품질 검수", status: "pending" },
];

const STAGE_ORDER: PipelineStageName[] = [...PIPELINE_STAGES];

function buildResumeStages(resumeFrom?: string): PipelineStage[] {
  // "confirm" means figure is done, proceed to builder
  const effectiveFrom = resumeFrom === "confirm" ? "builder" : resumeFrom;
  const resumeIdx = effectiveFrom ? STAGE_ORDER.indexOf(effectiveFrom as PipelineStageName) : 0;
  return createStages.map((s) => ({
    ...s,
    status: (resumeIdx > 0 && STAGE_ORDER.indexOf(s.name as PipelineStageName) < resumeIdx) ? "done" as const : "pending" as const,
  }));
}

const cropStages: PipelineStage[] = [
  { name: "cropper", label: "PDF 크롭", status: "pending" },
];

export const useJobStore = create<JobState>((set) => ({
  jobId: null,
  mode: null,
  status: "idle",
  stages: [],
  logs: [],
  files: [],
  intermediateFiles: [],
  result: null,
  questionResults: {},
  v3Meta: null,
  extractionReviewActive: false,
  selectedQuestionNumber: null,

  reset: () =>
    set({
      jobId: null,
      mode: null,
      status: "idle",
      stages: [],
      logs: [],
      files: [],
      intermediateFiles: [],
      result: null,
      questionResults: {},
      v3Meta: null,
      extractionReviewActive: false,
      selectedQuestionNumber: null,
    }),

  setJobId: (id) => set({ jobId: id }),
  setMode: (mode, resumeFrom) =>
    set({
      mode,
      stages: mode === "create"
        ? createStages.map((s) => ({ ...s }))
        : mode === "resume"
        ? buildResumeStages(resumeFrom)
        : cropStages.map((s) => ({ ...s })),
    }),
  setStatus: (status) => set({ status }),
  setFiles: (files) => set({ files }),
  setStages: (stages) => set({ stages }),

  updateStage: (name, update) =>
    set((state) => ({
      stages: state.stages.map((s) =>
        s.name === name ? { ...s, ...update } : s
      ),
    })),

  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),

  addIntermediateFile: (file) =>
    set((state) => ({
      intermediateFiles: [...state.intermediateFiles, file],
    })),

  setResult: (result) => set({ result }),

  setV3Meta: (meta) => set({ v3Meta: meta }),
  setExtractionReviewActive: (active) => set({ extractionReviewActive: active }),
  setSelectedQuestionNumber: (n) => set({ selectedQuestionNumber: n }),

  updateQuestionResult: (number, phase, content) =>
    set((state) => {
      const prev = state.questionResults[number] ?? { number, updatedAt: "" };
      return {
        questionResults: {
          ...state.questionResults,
          [number]: {
            ...prev,
            [phase]: content,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  seedQuestionResults: (numbers) =>
    set((state) => {
      const next = { ...state.questionResults };
      let changed = false;
      for (const n of numbers) {
        if (next[n] === undefined) {
          next[n] = { number: n, updatedAt: "" };
          changed = true;
        }
      }
      return changed ? { questionResults: next } : state;
    }),
}));

// Dev-only: 브라우저 콘솔에서 useJobStore.getState() 로 store 조회 가능.
// 예) useJobStore.getState().questionResults[1].verified
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { useJobStore: typeof useJobStore }).useJobStore = useJobStore;
}
