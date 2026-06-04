"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { type CropperWorkspaceRef } from "@/components/cropper/CropperWorkspace";
import { CropperModal } from "@/components/upload/CropperModal";
import {
  CURRICULUM_OPTIONS,
  FIGURE_MODES,
  SCIENCE_SUBJECTS,
  WORKBOOK_ROLES,
  WORKBOOK_TYPES,
  type Curriculum,
  type DocumentKind,
  type FigureMode,
  type MetaValue,
  type SchoolLevel,
  type WorkbookBookType,
  type WorkbookRole,
} from "@/components/upload/MetaForm";
import { parseExamMetaFromFilename } from "@/lib/pdf/filenameMeta";
import type { EndnoteMode, ExamMetaInput } from "@/lib/exam/meta";
import { useJobRunner } from "@/lib/useJobRunner";
import { useJobStore } from "@/lib/store";
import { sendResumeAction } from "@/components/results/question-result/resume";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PipelineView } from "@/components/pipeline/PipelineView";
import { QuestionList, QuestionDetailModal, QuestionPanelHeader, QuestionDetailView } from "@/components/results/QuestionResultPanel";
import { FigureReviewModal } from "@/components/results/question-result/FigureReviewModal";
import { LogStream } from "@/components/log/LogStream";
import { DownloadButton } from "@/components/shared/DownloadButton";
import { FollowupChat } from "@/components/shared/FollowupChat";
import {
  AI_STAGE_KEYS,
  DEFAULT_AI_SETTINGS,
  readAISettings,
  writeAISettings,
  type AISettings,
  type ImageProviderId,
} from "@/lib/ai/settings";
import type { AIProviderId } from "@/lib/ai";
import { NoActiveSessionPlaceholder } from "./NoActiveSessionPlaceholder";
import {
  AUTO_SPLIT_LS_KEY,
  AUTO_SPLIT_MODE_LS_KEY,
  AUTO_SPLIT_PROVIDER_LS_KEY,
  META_LS_KEY,
  PROVIDER_LABEL,
  STAGE_LABEL,
  createDefaultMeta,
  createYearOptions,
  loadStoredAutoSplitEnabled,
  loadStoredAutoSplitMode,
  loadStoredAutoSplitProvider,
  loadStoredMeta,
  preloadQuestionResultsFromCache,
  sanitizeCreateMeta,
  type BuildStatus,
  type ExistingImages,
} from "../_lib/createPageState";
import type { AutoCropMode } from "@/lib/cropper/types";

interface CreateV4PageProps {
  currentYear: number;
}

const fieldShellClass = "grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2 min-w-0";
const fieldLabelClass = "text-[10px] text-muted-foreground font-semibold shrink-0";
const fieldInputClass = "w-full min-w-0 px-0 py-0.5 text-sm bg-transparent border-b border-transparent focus:border-primary outline-none transition-colors placeholder:text-muted-foreground/40 disabled:opacity-70";

type CreateStartError = Error & { hint?: string; code?: string };

type ResultSessionSummary = {
  id: string;
  active: boolean;
  label: string;
  updatedAt: string;
  questionCount: number;
  essayCount: number;
  hasClean: boolean;
  meta?: ExamMetaInput;
};

type FigureProgress = {
  phase?: string;
  total?: number;
  currentIndex?: number;
  completed?: number;
  currentQuestion?: number | null;
  percent?: number;
  message?: string;
  updatedAt?: string;
};

type FigureStatusPayload = {
  pending?: boolean;
  done?: boolean;
  status?: string;
  success?: number[];
  failed?: number[];
  images?: string[];
  progress?: FigureProgress | null;
};

function getExistingQuestionNumbers(images: ExistingImages): number[] {
  return [...new Set([...(images.numbers || []), ...(images.essayNumbers || [])])]
    .sort((a, b) => a - b);
}

function getEffectiveMeta(hasJob: boolean, meta: MetaValue, v3Meta: ExamMetaInput | null | undefined): MetaValue {
  return hasJob ? { ...meta, ...(v3Meta ?? {}) } : meta;
}

function OutputOptionsPanel({
  meta,
  disabled,
  onPatch,
  yearOptions,
}: {
  meta: MetaValue;
  disabled: boolean;
  onPatch: (patch: Partial<MetaValue>) => void;
  yearOptions: number[];
}) {
  const documentKind = meta.documentKind ?? "science_workbook";
  const isWorkbook = documentKind === "science_workbook";
  const checkboxClass = "accent-primary h-3.5 w-3.5 shrink-0";
  const labelClass = cn(
    "flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground",
    disabled && "opacity-60"
  );
  const smallFieldClass = "grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2 min-w-0";
  const smallLabelClass = "text-[10px] text-muted-foreground font-semibold shrink-0";
  const smallInputClass = "h-8 w-full min-w-0 rounded-md border bg-background px-2 text-xs text-foreground outline-none disabled:opacity-70";

  return (
    <div className="shrink-0 border-b bg-muted/10 px-6 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          HWPX 조립 설정
        </span>
        <span className="rounded-full border bg-background px-2 py-0.5 text-[9px] font-bold text-muted-foreground">
          Builder
        </span>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-2 xl:grid-cols-4">
        <div className={smallFieldClass}>
          <span className={smallLabelClass}>작업</span>
          <select
            value={documentKind}
            onChange={(e) => {
              const nextKind = e.target.value as DocumentKind;
              onPatch({
                documentKind: nextKind,
                examType: nextKind === "science_workbook" ? "문제집" : "중간",
                outputVersion: nextKind === "science_workbook"
                  ? (meta.workbookRole === "teacher" ? "교사용" : "학생용")
                  : "시험지",
                answerPolicy: nextKind === "science_workbook" && meta.workbookRole === "teacher"
                  ? "blue_keep"
                  : "none",
              });
            }}
            disabled={disabled}
            className={smallInputClass}
          >
            <option value="science_workbook">과학 문제집</option>
            <option value="science_exam">과학시험지</option>
          </select>
        </div>
        <div className={smallFieldClass}>
          <span className={smallLabelClass}>학교급</span>
          <select
            value={meta.schoolLevel}
            onChange={(e) => onPatch({ schoolLevel: e.target.value as SchoolLevel })}
            disabled={disabled}
            className={smallInputClass}
          >
            <option value="중">중학교</option>
            <option value="고">고등학교</option>
          </select>
        </div>
        <div className={smallFieldClass}>
          <span className={smallLabelClass}>학년</span>
          <select
            value={meta.grade}
            onChange={(e) => onPatch({ grade: Number(e.target.value) })}
            disabled={disabled}
            className={smallInputClass}
          >
            {[1, 2, 3].map((g) => <option key={g} value={g}>{g}학년</option>)}
          </select>
        </div>
        <div className={smallFieldClass}>
          <span className={smallLabelClass}>과목</span>
          <select
            value={meta.subject}
            onChange={(e) => onPatch({ subject: e.target.value })}
            disabled={disabled}
            className={smallInputClass}
          >
            {SCIENCE_SUBJECTS.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
          </select>
        </div>
        <div className={smallFieldClass}>
          <span className={smallLabelClass}>교육과정</span>
          <select
            value={meta.curriculum ?? "22개정"}
            onChange={(e) => onPatch({ curriculum: e.target.value as Curriculum })}
            disabled={disabled}
            className={smallInputClass}
          >
            {CURRICULUM_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>

        {isWorkbook ? (
          <>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>출판사</span>
              <input
                type="text"
                value={meta.publisher ?? ""}
                onChange={(e) => onPatch({ publisher: e.target.value })}
                placeholder="예: 미래엔, 천재"
                disabled={disabled}
                className={smallInputClass}
              />
            </div>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>교재명</span>
              <input
                type="text"
                value={meta.bookTitle ?? ""}
                onChange={(e) => onPatch({ bookTitle: e.target.value })}
                placeholder="예: 오투, 체크체크"
                disabled={disabled}
                className={smallInputClass}
              />
            </div>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>유형</span>
              <select
                value={meta.bookType ?? "본문"}
                onChange={(e) => onPatch({ bookType: e.target.value as WorkbookBookType })}
                disabled={disabled}
                className={smallInputClass}
              >
                {WORKBOOK_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>버전</span>
              <select
                value={meta.workbookRole ?? "student"}
                onChange={(e) => {
                  const workbookRole = e.target.value as WorkbookRole;
                  onPatch({
                    workbookRole,
                    outputVersion: workbookRole === "teacher" ? "교사용" : "학생용",
                    answerPolicy: workbookRole === "teacher" ? "blue_keep" : "none",
                  });
                }}
                disabled={disabled}
                className={smallInputClass}
              >
                {WORKBOOK_ROLES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>권/학기</span>
              <input
                type="text"
                value={meta.bookVolume ?? ""}
                onChange={(e) => onPatch({ bookVolume: e.target.value, semester: e.target.value })}
                placeholder="예: 1학기, 2-1"
                disabled={disabled}
                className={smallInputClass}
              />
            </div>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>범위</span>
              <input
                type="text"
                value={meta.range}
                onChange={(e) => onPatch({ range: e.target.value })}
                placeholder="예: 생물의 구성~자극과 반응"
                disabled={disabled}
                className={smallInputClass}
              />
            </div>
          </>
        ) : (
          <>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>학년도</span>
              <select
                value={meta.year}
                onChange={(e) => onPatch({ year: Number(e.target.value) })}
                disabled={disabled}
                className={smallInputClass}
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>학교</span>
              <input
                type="text"
                value={meta.school}
                onChange={(e) => onPatch({ school: e.target.value })}
                placeholder={meta.schoolLevel === "중" ? "OO중학교" : "OO고등학교"}
                disabled={disabled}
                className={smallInputClass}
              />
            </div>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>학기</span>
              <select
                value={meta.semester}
                onChange={(e) => onPatch({ semester: e.target.value })}
                disabled={disabled}
                className={smallInputClass}
              >
                <option value="1학기">1학기</option>
                <option value="2학기">2학기</option>
              </select>
            </div>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>시험</span>
              <select
                value={meta.examType}
                onChange={(e) => onPatch({ examType: e.target.value })}
                disabled={disabled}
                className={smallInputClass}
              >
                <option value="중간">중간</option>
                <option value="기말">기말</option>
                <option value="모의">모의</option>
              </select>
            </div>
            <div className={smallFieldClass}>
              <span className={smallLabelClass}>범위</span>
              <input
                type="text"
                value={meta.range}
                onChange={(e) => onPatch({ range: e.target.value })}
                placeholder="예: 물질의 구성~전기와 자기"
                disabled={disabled}
                className={smallInputClass}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="mr-1 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            출력 옵션
          </span>
          <span className="rounded-full border bg-background px-2 py-0.5 text-[9px] font-bold text-muted-foreground">
            HWPX
          </span>
        </div>

        {isWorkbook && (
          <>
            <label className={labelClass}>
              <input
                type="checkbox"
                checked={meta.removeProblemIds ?? true}
                onChange={(e) => onPatch({ removeProblemIds: e.target.checked })}
                disabled={disabled}
                className={checkboxClass}
              />
              고유번호 제외
            </label>
            <label className={labelClass}>
              <input
                type="checkbox"
                checked={meta.removeImportanceTags ?? true}
                onChange={(e) => onPatch({ removeImportanceTags: e.target.checked })}
                disabled={disabled}
                className={checkboxClass}
              />
              중요 태그 제외
            </label>
            <label className={labelClass}>
              <input
                type="checkbox"
                checked={meta.removeQrCodes ?? true}
                onChange={(e) => onPatch({ removeQrCodes: e.target.checked })}
                disabled={disabled}
                className={checkboxClass}
              />
              QR 제외
            </label>
            <label className={labelClass}>
              <input
                type="checkbox"
                checked={meta.removePageFooters ?? true}
                onChange={(e) => onPatch({ removePageFooters: e.target.checked })}
                disabled={disabled}
                className={checkboxClass}
              />
              쪽수 제외
            </label>
          </>
        )}

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={meta.showProblemMetadata ?? false}
            onChange={(e) => onPatch({ showProblemMetadata: e.target.checked })}
            disabled={disabled}
            className={checkboxClass}
          />
          중단원/난이도 표시
        </label>

        <label className={labelClass}>
          <input
            type="checkbox"
            checked={(meta.endnoteMode ?? "answer_and_explanation") !== "answer_only"}
            onChange={(e) =>
              onPatch({
                endnoteMode: (e.target.checked
                  ? "answer_and_explanation"
                  : "answer_only") as EndnoteMode,
              })
            }
            disabled={disabled}
            className={checkboxClass}
          />
          미주 해설 포함
        </label>

        <label className={cn("flex items-center gap-2 text-[11px] font-bold text-muted-foreground", disabled && "opacity-60")}>
          그림
          <select
            value={meta.figureMode ?? "auto"}
            onChange={(e) => onPatch({ figureMode: e.target.value as FigureMode })}
            disabled={disabled}
            className="h-7 min-w-[8rem] rounded-md border bg-background px-2 text-xs font-medium text-foreground disabled:opacity-70"
          >
            {FIGURE_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function PdfWorkflowOptionsPanel({
  autoSplitActive,
  autoSplitProvider,
  autoSplitMode,
  autoSplitProviderMissing,
  onAutoSplitToggle,
  onAutoSplitProviderChange,
  onAutoSplitModeChange,
  imageCleaningActive,
  cleaningProviderMissing,
  aiSettings,
  onAISettingsChange,
}: {
  autoSplitActive: boolean;
  autoSplitProvider: ImageProviderId;
  autoSplitMode: AutoCropMode;
  autoSplitProviderMissing: boolean;
  onAutoSplitToggle: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAutoSplitProviderChange: (provider: ImageProviderId) => void;
  onAutoSplitModeChange: (mode: AutoCropMode) => void;
  imageCleaningActive: boolean;
  cleaningProviderMissing: boolean;
  aiSettings: AISettings;
  onAISettingsChange: (settings: AISettings) => void;
}) {
  const compactButton = "rounded-md border px-2.5 py-1 text-xs font-bold transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        PDF 작업 옵션
      </span>

      <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1">
        <label
          className={cn(
            "flex items-center gap-2 text-xs font-bold text-muted-foreground",
            autoSplitProviderMissing ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          )}
        >
          <input
            type="checkbox"
            checked={autoSplitActive}
            onChange={onAutoSplitToggle}
            disabled={autoSplitProviderMissing}
            className="h-3.5 w-3.5 accent-primary"
          />
          자동 분할
        </label>
        <span className="text-[10px] font-bold text-muted-foreground/70">엔진</span>
        <div className="flex items-center gap-1" aria-label="자동분할 엔진 선택">
          <button
            type="button"
            onClick={() => onAutoSplitProviderChange("gemini")}
            aria-pressed={autoSplitProvider === "gemini"}
            className={cn(
              compactButton,
              autoSplitProvider === "gemini"
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            Gemini API
          </button>
          <button
            type="button"
            onClick={() => onAutoSplitProviderChange("codex-cli")}
            aria-pressed={autoSplitProvider === "codex-cli"}
            className={cn(
              compactButton,
              autoSplitProvider === "codex-cli"
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            Codex
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
        <span className="text-[10px] font-bold text-muted-foreground/70">목적</span>
        {(["accurate", "fast"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onAutoSplitModeChange(mode)}
            title={
              mode === "accurate"
                ? "정확도 우선: 1페이지씩 분석하고 2차 검수까지 진행합니다."
                : "속도 우선: 여러 페이지를 묶어 빠르게 분석하고 2차 검수는 생략합니다."
            }
            className={cn(
              compactButton,
              autoSplitMode === mode
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            {mode === "accurate" ? "정확도" : "속도"}
          </button>
        ))}
      </div>

      <label
        className={cn(
          "flex items-center gap-2 text-xs font-bold text-muted-foreground",
          cleaningProviderMissing ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        )}
        title="추출 전에 문제 이미지의 손글씨/필기 흔적을 제거합니다."
      >
        <input
          type="checkbox"
          checked={imageCleaningActive}
          disabled={cleaningProviderMissing}
          onChange={(e) => onAISettingsChange(writeAISettings({
            ...aiSettings,
            imageCleaningEnabled: e.target.checked,
          }))}
          className="h-3.5 w-3.5 accent-primary"
        />
        손글씨 제거 <span className="font-normal opacity-70">
          ({aiSettings.imageCleaningProvider === "codex-cli" ? "ChatGPT 이미지2" : "Gemini API"})
        </span>
      </label>

      <label
        className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground"
        title="완성된 HWPX를 자동 점검하고 가능한 오류를 고친 뒤 다시 점검합니다."
      >
        <input
          type="checkbox"
          checked={aiSettings.checkerMaxAttempts > 0}
          onChange={(e) => onAISettingsChange(writeAISettings({
            ...aiSettings,
            checkerMaxAttempts: e.target.checked ? 2 : 0,
          }))}
          className="h-3.5 w-3.5 accent-primary"
        />
        자동검수
      </label>

      <label
        className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground"
        title="AI 풀이를 다시 검토하는 횟수입니다. 0이면 풀이 검증을 건너뜁니다."
      >
        풀이검증
        <input
          type="number"
          min={0}
          max={5}
          step={1}
          value={aiSettings.verifierMaxAttempts}
          onChange={(e) => onAISettingsChange(writeAISettings({
            ...aiSettings,
            verifierMaxAttempts: Number(e.target.value),
          }))}
          className="h-7 w-12 rounded-md border bg-background px-1.5 text-center text-xs"
        />
      </label>

      {(autoSplitProviderMissing || cleaningProviderMissing) && (
        <a href="/settings" className="text-[10px] font-medium text-destructive/80 hover:text-destructive hover:underline">
          설정 확인 필요
        </a>
      )}
    </div>
  );
}

function isTeacherWorkbook(meta: MetaValue): boolean {
  return (meta.documentKind ?? "science_workbook") === "science_workbook" && meta.workbookRole === "teacher";
}

function withDocumentKind(meta: MetaValue, documentKind: DocumentKind): MetaValue {
  return {
    ...meta,
    documentKind,
    examType: documentKind === "science_workbook" ? "문제집" : "중간",
    outputVersion: documentKind === "science_workbook"
      ? (meta.workbookRole === "teacher" ? "교사용" : "학생용")
      : "시험지",
    answerPolicy: documentKind === "science_workbook" && meta.workbookRole === "teacher"
      ? "blue_keep"
      : "none",
  };
}

function withWorkbookRole(meta: MetaValue, workbookRole: WorkbookRole): MetaValue {
  return {
    ...meta,
    workbookRole,
    outputVersion: workbookRole === "teacher" ? "교사용" : "학생용",
    answerPolicy: workbookRole === "teacher" ? "blue_keep" : "none",
  };
}

function formatResultSessionTime(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return time.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFigureProgressPercent(status: FigureStatusPayload | null): number | undefined {
  const raw = status?.progress?.percent;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function getFigureProgressSummary(status: FigureStatusPayload | null): string | undefined {
  if (!status || status.pending) return undefined;
  const progress = status.progress;
  const total = progress?.total ?? 0;
  const completed = progress?.completed ?? status.success?.length ?? 0;
  const failed = status.failed?.length ?? 0;
  const currentQuestion = progress?.currentQuestion;

  if (currentQuestion && total > 0) {
    const currentIndex = progress?.currentIndex ?? completed + 1;
    return `Q${currentQuestion} 그림 처리 중 (${currentIndex}/${total}, 완료 ${completed}${failed ? `, 실패 ${failed}` : ""})`;
  }
  if (total > 0) {
    return `그림 ${completed}/${total} 완료${failed ? `, 실패 ${failed}` : ""}`;
  }
  if (progress?.message) return progress.message;
  if (status.status === "done" || status.done) {
    return "그림 처리 완료";
  }
  return undefined;
}

export default function CreateV4Page({ currentYear }: CreateV4PageProps) {
  const defaultMeta = useMemo(() => createDefaultMeta(currentYear), [currentYear]);
  const yearOptions = useMemo(() => createYearOptions(currentYear), [currentYear]);
  const reset = useJobStore((s) => s.reset);
  const { startJob, stopJob, pauseJob } = useJobRunner();
  const cropperRef = useRef<CropperWorkspaceRef>(null);

  // Store subscriptions
  const status = useJobStore((s) => s.status);
  const mode = useJobStore((s) => s.mode);
  const stages = useJobStore((s) => s.stages);
  const logs = useJobStore((s) => s.logs);
  const jobId = useJobStore((s) => s.jobId);
  const result = useJobStore((s) => s.result);
  const v3Meta = useJobStore((s) => s.v3Meta);
  const setV3Meta = useJobStore((s) => s.setV3Meta);
  const questionResults = useJobStore((s) => s.questionResults);
  const entries = Object.values(questionResults).sort((a, b) => a.number - b.number);
  const extractionReviewActive = useJobStore((s) => s.extractionReviewActive);
  const setExtractionReviewActive = useJobStore((s) => s.setExtractionReviewActive);
  const store = useJobStore();
  const isRunning = status === "running";
  const isPaused = status === "paused";
  const isFailed = status === "failed";
  const isDone = status === "done" || status === "failed";
  const hasJob = isRunning || isDone || isPaused;

  // figure 단계가 완료(done/failed)되면 extractionReviewActive를 초기화한다.
  // figure 완료 후 "그림 결과 확인" 버튼이 보이도록 하기 위함.
  // (extractionReviewActive=true이면 해당 버튼이 숨겨지고 "해설 생성 시작" 버튼이 잘못 노출됨)
  useEffect(() => {
    if (!extractionReviewActive) return;
    const figureStage = stages.find((s) => s.name === "figure");
    if (figureStage?.status === "done" || figureStage?.status === "failed") {
      setExtractionReviewActive(false);
    }
  }, [stages, extractionReviewActive, setExtractionReviewActive]);

  const resumeOrRetry = useCallback(async () => {
    const base = v3Meta ?? {};
    const jobMeta = { ...base, resumeFrom: "auto" };
    setV3Meta(jobMeta);

    // Pre-load all question data from cache
    fetch("/api/question-images")
      .then((r) => r.json())
      .then(async (existingImages: ExistingImages) => {
        const qNums = getExistingQuestionNumbers(existingImages);
        await preloadQuestionResultsFromCache(qNums, existingImages.cacheState);
        await startJob("resume", { pdf: "" }, jobMeta);
      })
      .catch(() => {});
  }, [v3Meta, startJob, setV3Meta]);

  const [autoSplitEnabled, setAutoSplitEnabled] = useState(false);
  const [autoSplitProvider, setAutoSplitProvider] = useState<ImageProviderId>("gemini");
  const [autoSplitMode, setAutoSplitMode] = useState<AutoCropMode>("accurate");
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  const [codexReady, setCodexReady] = useState<boolean | null>(null);
  const [aiSettings, setAiSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [meta, setMeta] = useState<MetaValue>(() => createDefaultMeta(currentYear));

  useEffect(() => {
    queueMicrotask(() => {
      setAutoSplitEnabled(loadStoredAutoSplitEnabled());
      setAutoSplitProvider(loadStoredAutoSplitProvider());
      setAutoSplitMode(loadStoredAutoSplitMode());
      setAiSettings(readAISettings());
      setMeta(loadStoredMeta(defaultMeta));
    });

    const loadGeminiStatus = () => {
      fetch("/api/env-settings")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { keys?: Record<string, { configured?: boolean }> } | null) => {
          setGeminiConfigured(Boolean(data?.keys?.GEMINI_API_KEY?.configured));
        })
        .catch(() => setGeminiConfigured(null));
    };
    const loadCodexStatus = () => {
      fetch("/api/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { codexCli?: { available?: boolean; authenticated?: boolean } } | null) => {
          setCodexReady(Boolean(data?.codexCli?.available && data?.codexCli?.authenticated));
        })
        .catch(() => setCodexReady(null));
    };
    loadGeminiStatus();
    loadCodexStatus();

    const onFocus = () => {
      setAiSettings(readAISettings());
      loadGeminiStatus();
      loadCodexStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [defaultMeta]);

  // Gemini 키가 확실히 없을 때만 자동 분할을 막는다 (null=확인 전/실패 → 막지 않음).
  const geminiMissing = geminiConfigured === false;
  const autoSplitProviderMissing = autoSplitProvider === "codex-cli"
    ? codexReady === false
    : geminiMissing;
  const autoSplitActive = autoSplitEnabled && !autoSplitProviderMissing;

  // 선택된 손글씨 제거 provider가 확실히 미가용일 때만 이미지 정리를 막는다 (null=확인 전/실패 → 막지 않음).
  const cleaningProviderMissing = aiSettings.imageCleaningProvider === "codex-cli"
    ? codexReady === false
    : geminiMissing;
  const imageCleaningActive = aiSettings.imageCleaningEnabled && !cleaningProviderMissing;
  const autoFigureProviderMissing = meta.figureMode === "auto" && aiSettings.figureRegen && (
    aiSettings.imageProvider === "codex-cli" ? codexReady === false : geminiMissing
  );
  const figureProviderMissing = (
    meta.figureMode === "chatgpt-image2" && codexReady === false
  ) || autoFigureProviderMissing;

  const deepSeekStages = AI_STAGE_KEYS.filter(
    (key) => aiSettings.stageOverrides[key] === "deepseek-v4"
  );
  const deepSeekBlocksCreate = deepSeekStages.includes("create.extractor");

  function handleAutoSplitToggle(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.checked;
    setAutoSplitEnabled(next);
    try {
      localStorage.setItem(AUTO_SPLIT_LS_KEY, String(next));
    } catch {}
  }

  function handleAutoSplitProviderChange(provider: ImageProviderId) {
    setAutoSplitProvider(provider);
    try {
      localStorage.setItem(AUTO_SPLIT_PROVIDER_LS_KEY, provider);
    } catch {}
  }

  function handleAutoSplitModeChange(mode: AutoCropMode) {
    setAutoSplitMode(mode);
    try {
      localStorage.setItem(AUTO_SPLIT_MODE_LS_KEY, mode);
    } catch {}
  }

  function handleMetaChange(next: MetaValue) {
    const switchedToTeacherWorkbook = !isTeacherWorkbook(meta) && isTeacherWorkbook(next);
    setMeta(next);
    const persistedMeta = hasJob ? { ...(v3Meta ?? {}), ...next } : next;
    if (hasJob) setV3Meta(persistedMeta);
    try {
      sessionStorage.setItem(META_LS_KEY, JSON.stringify(persistedMeta));
    } catch {}

    if (switchedToTeacherWorkbook && aiSettings.imageCleaningEnabled) {
      setAiSettings(writeAISettings({
        ...aiSettings,
        imageCleaningEnabled: false,
      }));
    }
  }

  function handleRuntimeMetaPatch(patch: Partial<MetaValue>) {
    const current = getEffectiveMeta(hasJob, meta, v3Meta);
    handleMetaChange({ ...current, ...patch });
  }

  const handlePdfSelected = useCallback((fileName: string) => {
    const parsed = parseExamMetaFromFilename(fileName);
    if (!parsed) return;

    setMeta((current) => {
      const next: MetaValue = {
        ...current,
        ...parsed,
        range: parsed.range ?? current.range,
      };
      try {
        sessionStorage.setItem(META_LS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // v3Meta auto-restore: 이전 작업 메타를 폼에 복원 (idle 상태일 때만)
  useEffect(() => {
    if (!v3Meta || hasJob) return;
    queueMicrotask(() => {
      setMeta({
        ...defaultMeta,
        ...v3Meta,
        schoolLevel: v3Meta.schoolLevel ?? defaultMeta.schoolLevel,
        school: v3Meta.school ?? defaultMeta.school,
        grade: v3Meta.grade ?? defaultMeta.grade,
        year: v3Meta.year ?? currentYear,
        subject: v3Meta.subject ?? defaultMeta.subject,
        semester: v3Meta.semester ?? defaultMeta.semester,
        examType: v3Meta.examType ?? defaultMeta.examType,
        range: v3Meta.range ?? defaultMeta.range,
      });
    });
  }, [v3Meta, hasJob, currentYear, defaultMeta]);

  // 이전 작업 재개 상태
  const [existingImages, setExistingImages] = useState<ExistingImages | null>(null);
  const [resultSessionsOpen, setResultSessionsOpen] = useState(false);
  const [resultSessions, setResultSessions] = useState<ResultSessionSummary[]>([]);
  const [resultSessionsLoading, setResultSessionsLoading] = useState(false);
  const [selectedResultSessionId, setSelectedResultSessionId] = useState<string | null>(null);
  const [resultSessionsError, setResultSessionsError] = useState<string | null>(null);

  // build 상태 + 폴링
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const buildIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [figureStatus, setFigureStatus] = useState<FigureStatusPayload | null>(null);
  const figureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activityLogCollapsed, setActivityLogCollapsed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null);
  const [questionModalOpen, setQuestionModalOpen] = useState(false);
  const [figureModalOpen, setFigureModalOpen] = useState(false);
  const [figureGlobalLoading, setFigureGlobalLoading] = useState<string | null>(null);
  const [builderStarting, setBuilderStarting] = useState(false);
  const [cacheReviewLoading, setCacheReviewLoading] = useState(false);
  const [cropperOpen, setCropperOpen] = useState(false);

  // create 모드 또는 "그림 전체 재생성" 재개 모드: figure 단계가 done이 되면 자동으로 FigureReviewModal을 연다.
  // orchestrator(sse.ts)가 stopAfterStage="figure"로 figure 직후 멈추므로,
  // 사용자는 그림을 확인한 뒤 오른쪽 작업 헤더의 HWPX 조립 버튼으로 builder를 트리거한다.
  // jobId당 1회만 자동 오픈해 사용자가 닫은 모달을 다시 띄우지 않는다.
  const autoOpenedFigureJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    const shouldAutoOpen =
      mode === "create" ||
      (mode === "resume" && v3Meta?.resumeFrom === "figure");
    if (!shouldAutoOpen) return;
    if (!jobId) return;
    const figureStage = stages.find((s) => s.name === "figure");
    if (figureStage?.status !== "done") return;
    if (autoOpenedFigureJobIdRef.current === jobId) return;
    autoOpenedFigureJobIdRef.current = jobId;
    setQuestionModalOpen(false);
    setFigureModalOpen(true);
  }, [mode, v3Meta?.resumeFrom, jobId, stages]);

  // 이전 작업 재개 이미지 fetch (진행 중인 작업이 없을 때만)
  useEffect(() => {
    if (hasJob) return;
    fetch("/api/question-images")
      .then((r) => r.json())
      .then((data) => {
        if (data.count > 0) setExistingImages(data);
      })
      .catch(() => {});
  }, [hasJob]);

  const loadResultSessions = useCallback(async () => {
    setResultSessionsLoading(true);
    setResultSessionsError(null);
    try {
      const res = await fetch("/api/result-sessions", { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as {
        sessions?: ResultSessionSummary[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `결과 목록 조회 실패 (${res.status})`);
      }
      const sessions = data.sessions ?? [];
      setResultSessions(sessions);
      setSelectedResultSessionId((current) => (
        current && sessions.some((session) => session.id === current)
          ? current
          : sessions[0]?.id ?? null
      ));
    } catch (err) {
      setResultSessions([]);
      setSelectedResultSessionId(null);
      setResultSessionsError(err instanceof Error ? err.message : "결과 목록 조회 실패");
    } finally {
      setResultSessionsLoading(false);
    }
  }, []);

  const handleOpenResultSessions = useCallback(async () => {
    setResultSessionsOpen(true);
    await loadResultSessions();
  }, [loadResultSessions]);

  const handleResume = useCallback(async () => {
    if (!existingImages) return;
    let cachedMeta: ExamMetaInput = {};
    try {
      const r = await fetch("/api/v3cache-meta");
      const data = await r.json() as { found: boolean; meta?: ExamMetaInput };
      if (data.found && data.meta) cachedMeta = data.meta;
    } catch { /* ignore */ }

    const jobMeta = {
      ...meta,
      ...cachedMeta,
      questionCount: getExistingQuestionNumbers(existingImages).length,
      resumeFrom: "auto",
    };
    setV3Meta({ ...jobMeta });

    // Pre-load all question data from cache
    const qNums = getExistingQuestionNumbers(existingImages);
    await preloadQuestionResultsFromCache(qNums, existingImages.cacheState);

    await startJob("resume", { pdf: "" }, jobMeta);
  }, [existingImages, meta, startJob, setV3Meta]);

  const handleLoadCachedResults = useCallback(async (sessionId = "active") => {
    setCacheReviewLoading(true);
    setSubmitError(null);
    setRecoveryHint(null);

    try {
      if (sessionId !== "active") {
        const restoreRes = await fetch("/api/result-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sessionId }),
        });
        if (!restoreRes.ok) {
          const restoreError = await restoreRes.json().catch(() => ({})) as { error?: string };
          throw new Error(restoreError.error ?? `결과 복원 실패 (${restoreRes.status})`);
        }
      }

      const imagesRes = await fetch("/api/question-images");
      if (!imagesRes.ok) {
        throw new Error("기존 결과를 불러오지 못했습니다.");
      }
      const images = (await imagesRes.json()) as ExistingImages;
      if (!images.count) {
        throw new Error("불러올 문제 결과가 없습니다.");
      }

      let cachedMeta: ExamMetaInput = {};
      try {
        const r = await fetch("/api/v3cache-meta");
        const data = await r.json() as { found: boolean; meta?: ExamMetaInput };
        if (data.found && data.meta) cachedMeta = data.meta;
      } catch { /* ignore */ }

      const jobMeta = {
        ...meta,
        ...cachedMeta,
        questionCount: getExistingQuestionNumbers(images).length,
        resumeFrom: "confirm",
      };
      const reviewRes = await fetch("/api/review-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta: jobMeta, settings: readAISettings() }),
      });
      if (!reviewRes.ok) {
        const errData = await reviewRes.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? "검토 세션을 만들지 못했습니다.");
      }
      const review = await reviewRes.json() as { jobId: string };

      reset();
      const liveStore = useJobStore.getState();
      liveStore.setJobId(review.jobId);
      liveStore.setMode("resume", "confirm");
      liveStore.setStatus("done");
      liveStore.setResult({ status: "success", summary: "cache-review" });
      liveStore.setV3Meta(jobMeta);
      liveStore.addLog({
        timestamp: new Date().toISOString(),
        stage: "system",
        message: "캐시된 결과를 불러왔습니다. 누락/실패한 그림은 검토 창에서 사용자가 직접 재생성할 수 있습니다.",
        level: "info",
      });

      const qNums = getExistingQuestionNumbers(images);
      await preloadQuestionResultsFromCache(qNums, images.cacheState);
      useJobStore.getState().setSelectedQuestionNumber(qNums[0] ?? null);
      setExistingImages(images);
      setResultSessionsOpen(false);
      setQuestionModalOpen(false);
      setFigureModalOpen(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "기존 결과 불러오기 실패");
      setRecoveryHint("작업 재개는 재처리를 시작합니다. 먼저 결과만 확인하려면 캐시 폴더와 기존 문제 이미지가 남아 있어야 합니다.");
    } finally {
      setCacheReviewLoading(false);
    }
  }, [meta, reset]);

  const handleConfirmFigure = useCallback(async () => {
    if (!jobId) return;
    await sendResumeAction(jobId, "resume --from=builder", store, getEffectiveMeta(hasJob, meta, v3Meta));
  }, [hasJob, jobId, meta, store, v3Meta]);

  const handleStartBuilder = useCallback(async () => {
    if (!jobId || builderStarting) return;
    setBuilderStarting(true);
    try {
      await handleConfirmFigure();
      setFigureModalOpen(false);
    } finally {
      setBuilderStarting(false);
    }
  }, [builderStarting, handleConfirmFigure, jobId]);

  // build 상태 패널 표시 여부
  const isCacheReviewSession =
    status === "done" &&
    mode === "resume" &&
    v3Meta?.resumeFrom === "confirm" &&
    result?.summary === "cache-review";

  const showBuildStatus = (isRunning || isDone) &&
    (mode === "create" || mode === "resume") &&
    v3Meta?.resumeFrom !== "figure" &&
    !isCacheReviewSession;

  const figureStage = stages.find((s) => s.name === "figure");
  const shouldPollFigureStatus =
    hasJob &&
    (mode === "create" || mode === "resume") &&
    (figureStage?.status === "running" || figureStage?.status === "done" || figureStage?.status === "failed");

  const stagesForDisplay = useMemo(() => {
    if (!figureStatus || stages.length === 0) return stages;
    const progress = getFigureProgressPercent(figureStatus);
    const summary = getFigureProgressSummary(figureStatus);
    return stages.map((stage) => {
      if (stage.name !== "figure") return stage;
      return {
        ...stage,
        progress: progress ?? stage.progress,
        summary: summary ?? stage.summary,
      };
    });
  }, [figureStatus, stages]);

  // build_status.json 폴링
  useEffect(() => {
    if (!showBuildStatus) {
      if (buildIntervalRef.current) {
        clearInterval(buildIntervalRef.current);
        buildIntervalRef.current = null;
      }
      queueMicrotask(() => setBuildStatus(null));
      return;
    }

    const poll = async () => {
      try {
        const r = await fetch("/api/build-status");
        const data: BuildStatus = await r.json();
        setBuildStatus(data);
        if (!data.pending && (data.status === "success" || data.status === "completed" || data.status === "failed")) {
          if (buildIntervalRef.current) {
            clearInterval(buildIntervalRef.current);
            buildIntervalRef.current = null;
          }
        }
      } catch { /* ignore */ }
    };

    poll();
    buildIntervalRef.current = setInterval(poll, 2000);
    return () => {
      if (buildIntervalRef.current) {
        clearInterval(buildIntervalRef.current);
        buildIntervalRef.current = null;
      }
    };
  }, [showBuildStatus]);

  useEffect(() => {
    setFigureStatus(null);
  }, [jobId]);

  useEffect(() => {
    if (!shouldPollFigureStatus) {
      if (figureIntervalRef.current) {
        clearInterval(figureIntervalRef.current);
        figureIntervalRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/figure-status", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as FigureStatusPayload;
        if (cancelled) return;
        if (data.pending) {
          setFigureStatus(null);
          return;
        }
        setFigureStatus(data);
        if (
          figureStage?.status !== "running" &&
          (data.done || data.status === "done" || data.status === "failed" || data.status === "partial")
        ) {
          if (figureIntervalRef.current) {
            clearInterval(figureIntervalRef.current);
            figureIntervalRef.current = null;
          }
        }
      } catch { /* ignore */ }
    };

    poll();
    figureIntervalRef.current = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      if (figureIntervalRef.current) {
        clearInterval(figureIntervalRef.current);
        figureIntervalRef.current = null;
      }
    };
  }, [shouldPollFigureStatus, figureStage?.status]);

  const handleExtract = useCallback(
    async (items: { number: number; kind?: "regular" | "essay"; blob: Blob }[]) => {
      if (items.length === 0) return;

      if (figureProviderMissing) {
        setSubmitError("선택한 그림 처리 엔진을 사용할 수 없습니다. 설정에서 Codex CLI 로그인 또는 Gemini API 키 상태를 확인하세요.");
        return;
      }

      if (deepSeekBlocksCreate) {
        setSubmitError(
          "현재 'create.extractor' stage가 DeepSeek로 지정돼 있습니다. DeepSeek V4는 이미지 입력을 지원하지 않으므로 /settings에서 해당 stage를 Claude/Codex로 되돌리세요."
        );
        return;
      }

      setSubmitting(true);
      setSubmitError(null);
      setRecoveryHint(null);

      const createMeta = sanitizeCreateMeta(meta);
      const formData = new FormData();
      formData.append("meta", JSON.stringify(createMeta));
      let rIdx = 0;
      let eIdx = 0;
      for (const item of items) {
        let key: string;
        if (item.kind === "essay") {
          eIdx++;
          key = `q_s${String(eIdx).padStart(2, "0")}`;
        } else {
          rIdx++;
          key = `q${String(rIdx).padStart(2, "0")}`;
        }
        formData.append(key, new File([item.blob], `${key}.png`, { type: "image/png" }));
      }

      let saved: { number: number }[];
      try {
        const res = await fetch("/api/create/start", { method: "POST", body: formData });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({})) as { error?: string; hint?: string; code?: string };
          const err = new Error(errData.error ?? `작업 시작 실패 (${res.status})`) as CreateStartError;
          err.hint = errData.hint;
          err.code = errData.code;
          throw err;
        }
        const data = (await res.json()) as { ok: true; images: { number: number }[] };
        saved = data.images;
      } catch (e) {
        const err = e as CreateStartError;
        setSubmitError(e instanceof Error ? e.message : "작업 시작 실패");
        setRecoveryHint(
          err.hint ??
          "디스크 상태가 rollback되어 이전 상태로 복구되었습니다. 다시 시도하세요."
        );
        setSubmitting(false);
        return;
      }

      // v3Meta를 store에 설정 (startJob 전)
      const jobMeta = { ...createMeta, questionCount: saved.length, resumeFrom: "extractor" };
      setV3Meta(jobMeta);

      try {
        await startJob("create", { pdf: "", questionImages: saved.map((s) => s.number) }, jobMeta);
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "작업 시작 실패");
        setRecoveryHint("이미지/메타 모두 저장됐습니다. 페이지를 새로고침하면 '이전 작업 재개' 카드에서 이어 작업할 수 있습니다.");
      } finally {
        // 성공 경로에서도 submitting을 풀어야 한다. 안 풀면 작업 완료 후 "새 작업"으로
        // hasJob이 false가 됐을 때 PDF 열기/작업 재개 버튼이 disabled={submitting}으로 묶인다.
        setSubmitting(false);
      }
    },
    [meta, figureProviderMissing, deepSeekBlocksCreate, startJob, setV3Meta]
  );

  const runtimeMeta = getEffectiveMeta(hasJob, meta, v3Meta);
  const runtimeOptionsDisabled = submitting || isRunning || cacheReviewLoading || builderStarting;

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] overflow-hidden bg-background text-foreground">
      {/* Studio Control Center (Top Bar) */}
      <div className="shrink-0 border rounded-2xl mb-4 bg-card shadow-sm overflow-hidden">
        <div className="grid min-h-[96px] grid-cols-1 xl:grid-cols-[minmax(360px,440px)_minmax(220px,260px)_minmax(110px,140px)_minmax(320px,1fr)]">
        {/* Section 1: Workflow summary */}
        <div className="min-w-0 border-b px-5 py-3 xl:border-b-0 xl:border-r">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Science Typing</span>
            {!hasJob && <span className="flex h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
            <span className="rounded-full border bg-background px-2.5 py-1">PDF 준비</span>
            <span className="text-muted-foreground/40">→</span>
            <span className="rounded-full border bg-background px-2.5 py-1">문제 추출</span>
            <span className="text-muted-foreground/40">→</span>
            <span className="rounded-full border bg-background px-2.5 py-1">HWPX 조립 설정</span>
          </div>
        </div>

        {/* Partial Separator */}
        <div className="hidden" />

        {/* Section 2: AI Config */}
        <div className="hidden min-w-0 border-r px-5 py-3 xl:block">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">AI Provider</div>
          <div className="flex flex-col gap-2">
            {AI_STAGE_KEYS.slice(0, 3).map((stageKey) => {
              const provider = aiSettings.stageOverrides[stageKey] ?? aiSettings.defaultProvider;
              const isDeepSeek = provider === "deepseek-v4";
              return (
                <div key={stageKey} className="flex items-center justify-between gap-6">
                  <span className="text-[8px] text-muted-foreground uppercase font-bold tracking-tight">{STAGE_LABEL[stageKey]}</span>
                  <span className={cn("text-[10px] font-mono", isDeepSeek ? "text-blue-500 font-bold" : "text-foreground/80")}>
                    {isDeepSeek ? "DS-V4" : (PROVIDER_LABEL[provider as AIProviderId] ?? "Auto")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Partial Separator */}
        <div className="hidden" />

        {/* Section 3: Job Status */}
        <div className="hidden min-w-0 border-r px-5 py-3 xl:block">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Status</div>
          <div className="flex items-center gap-2.5">
            <span className={cn("w-2 h-2 rounded-full ring-4 ring-offset-0", 
              isRunning ? "bg-yellow-500 animate-pulse ring-yellow-500/20" :
              isPaused ? "bg-blue-500 ring-blue-500/20" :
              !hasJob ? "bg-muted-foreground/20 ring-transparent" :
              result?.status === "success" || isCacheReviewSession ? "bg-green-500 ring-green-500/20" : "bg-destructive ring-destructive/20"
            )} />
            <span className="text-xs font-bold tracking-tight uppercase">
              {isRunning ? "Running" : isPaused ? "Paused" : !hasJob ? "Idle" : isCacheReviewSession ? "Review" : result?.status === "success" ? "Success" : "Failed"}
            </span>
          </div>
        </div>

        {/* Section 4: Global Actions */}
        <div className="min-w-0 bg-muted/10 px-5 py-3 flex flex-col justify-center gap-2.5">
          {!hasJob && existingImages && (
            <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
              {"\uC774\uC804 \uC791\uC5C5 \uACB0\uACFC\uAC00 \uC788\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 \"\uACB0\uACFC \uBD88\uB7EC\uC624\uAE30\"\uB85C \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694."}
            </div>
          )}
          {false && !hasJob && existingImages && (
            <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
              이전 작업이 존재합니다. &quot;작업 재개&quot;를 클릭하세요.
            </div>
          )}
          <div className="flex items-center gap-2">
            {!hasJob ? (
              <div className="flex w-full items-center gap-2">
                <Button
                  onClick={() => {
                    setQuestionModalOpen(false);
                    setFigureModalOpen(false);
                    setCropperOpen(true);
                    queueMicrotask(() => cropperRef.current?.openFilePicker());
                  }}
                  disabled={submitting || cacheReviewLoading}
                  variant="outline"
                  size="sm"
                  className="h-9 min-w-[140px] flex-1 text-xs font-bold border-primary text-primary hover:bg-primary/5 transition-all shadow-sm active:scale-95 gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  PDF 열기
                </Button>
                <Button
                  onClick={handleOpenResultSessions}
                  disabled={submitting || cacheReviewLoading || resultSessionsLoading}
                  size="sm"
                  className="h-9 min-w-[140px] flex-1 bg-primary hover:bg-primary/85 text-primary-foreground font-bold shadow-md active:scale-95"
                >
                  {cacheReviewLoading || resultSessionsLoading ? "\uBD88\uB7EC\uC624\uB294 \uC911" : "\uACB0\uACFC \uBD88\uB7EC\uC624\uAE30"}
                </Button>
                {existingImages && (
                  <Button onClick={handleResume} disabled={submitting || cacheReviewLoading} size="sm" className="h-9 min-w-[140px] flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-md active:scale-95">
                    작업 재개
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex gap-2 w-full">
                {isRunning && (
                  <>
                    <Button onClick={pauseJob} variant="outline" size="sm" className="flex-1 h-9 text-xs font-bold border-muted-foreground/30">일시 정지</Button>
                    <Button onClick={stopJob} variant="destructive" size="sm" className="flex-1 h-9 text-xs font-bold">중단</Button>
                  </>
                )}
                {(isPaused || isFailed) && (
                  <>
                    <Button onClick={resumeOrRetry} size="sm" className="flex-1 h-9 text-xs font-bold bg-primary shadow-lg shadow-primary/20 hover:bg-primary/85">작업 재개</Button>
                    <Button onClick={reset} variant="outline" size="sm" className="flex-1 h-9 text-xs font-bold border-muted-foreground/30">초기화</Button>
                  </>
                )}
                {status === "done" && !isFailed && isCacheReviewSession && (
                  <>
                    <Button onClick={() => setFigureModalOpen(true)} size="sm" className="flex-1 h-9 text-xs font-bold shadow-lg shadow-primary/20">
                      {"\uADF8\uB9BC \uACB0\uACFC \uD655\uC778"}
                    </Button>
                    <Button onClick={reset} variant="outline" size="sm" className="flex-1 h-9 text-xs font-bold">{"\uC0C8 \uC791\uC5C5"}</Button>
                  </>
                )}
                {status === "done" && !isFailed && !isCacheReviewSession && (
                  <>
                    <DownloadButton jobId={jobId ?? ""} disabled={result?.status !== "success"} className="flex-1 h-9 text-xs font-bold shadow-lg shadow-primary/20" />
                    <Button onClick={reset} variant="outline" size="sm" className="flex-1 h-9 text-xs font-bold">새 작업</Button>
                  </>
                )}
              </div>
            )}
          </div>

          {submitError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              <div className="font-bold">{submitError}</div>
              {recoveryHint && (
                <div className="mt-1 font-normal text-destructive/80">{recoveryHint}</div>
              )}
            </div>
          )}
          
          <div className="hidden">
            <label
              className={cn(
                "flex items-center gap-2 group",
                autoSplitProviderMissing ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              )}
            >
              <input
                type="checkbox"
                checked={autoSplitActive}
                onChange={handleAutoSplitToggle}
                disabled={autoSplitProviderMissing}
                className="accent-primary w-3.5 h-3.5"
              />
              <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors font-bold tracking-tight">
                자동 분할 <span className="font-normal opacity-70">({autoSplitProvider === "codex-cli" ? "Codex" : "Gemini API"} 사용)</span>
              </span>
            </label>
            <div className="ml-[1.375rem] flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleAutoSplitProviderChange("gemini")}
                className={cn(
                  "px-2 py-0.5 rounded border text-[10px] font-bold transition-colors",
                  autoSplitProvider === "gemini"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground hover:text-foreground"
                )}
              >
                Gemini API
              </button>
              <button
                type="button"
                onClick={() => handleAutoSplitProviderChange("codex-cli")}
                className={cn(
                  "px-2 py-0.5 rounded border text-[10px] font-bold transition-colors",
                  autoSplitProvider === "codex-cli"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground hover:text-foreground"
                )}
              >
                Codex
              </button>
            </div>
            <div className="ml-[1.375rem] flex items-center gap-1">
              {(["accurate", "fast"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleAutoSplitModeChange(mode)}
                  title={
                    mode === "accurate"
                      ? "정확도 우선: 1페이지씩 분석하고 2차 검수까지 진행합니다."
                      : "속도 우선: 여러 페이지를 묶어 빠르게 분석하고 2차 검수는 생략합니다."
                  }
                  className={cn(
                    "px-2 py-0.5 rounded border text-[10px] font-bold transition-colors",
                    autoSplitMode === mode
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode === "accurate" ? "정확도" : "속도"}
                </button>
              ))}
            </div>
            {autoSplitProviderMissing && (
              <a
                href="/settings"
                className="ml-[1.375rem] text-[10px] text-destructive/80 hover:text-destructive hover:underline"
              >
                {autoSplitProvider === "codex-cli"
                  ? "Codex CLI 설치와 로그인이 필요합니다 — 설정에서 확인"
                  : "Gemini API 키가 필요합니다 — 설정에서 입력"}
              </a>
            )}
            <label
              className={cn(
                "flex items-center gap-2 group",
                cleaningProviderMissing ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              )}
              title="추출 전에 문제 이미지의 손글씨/필기 흔적을 제거합니다. 체크 해제 시 원본 이미지로 진행."
            >
              <input
                type="checkbox"
                checked={imageCleaningActive}
                disabled={cleaningProviderMissing}
                onChange={(e) => setAiSettings(writeAISettings({
                  ...aiSettings,
                  imageCleaningEnabled: e.target.checked,
                }))}
                className="accent-primary w-3.5 h-3.5"
              />
              <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors font-bold tracking-tight">
                손글씨 제거 <span className="font-normal opacity-70">
                  ({aiSettings.imageCleaningProvider === "codex-cli" ? "ChatGPT 이미지2" : "Gemini API"})
                </span>
              </span>
            </label>
            {cleaningProviderMissing && (
              <a
                href="/settings"
                className="ml-[1.375rem] text-[10px] text-destructive/80 hover:text-destructive hover:underline"
              >
                {aiSettings.imageCleaningProvider === "codex-cli"
                  ? "Codex CLI 설치·로그인이 필요합니다 — 설정에서 확인"
                  : "Gemini API 키가 필요합니다 — 설정에서 입력"}
              </a>
            )}
            {figureProviderMissing && (
              <a
                href="/settings"
                className="ml-[1.375rem] text-[10px] text-destructive/80 hover:text-destructive hover:underline"
              >
                ChatGPT 이미지2 그림 처리를 쓰려면 Codex CLI 설치·로그인이 필요합니다
              </a>
            )}
            <div className="flex items-center gap-3">
              <label
                className="flex items-center gap-1.5 cursor-pointer"
                title="체크 해제 → HWPX 검수 단계 자체를 건너뜁니다. 체크 → 완성된 HWPX 를 자동 점검하고 자주 나는 사소한 오류(빈 줄 누락·수식 기호 오타 등)를 자동으로 고친 뒤 다시 점검합니다."
              >
                <input
                  type="checkbox"
                  checked={aiSettings.checkerMaxAttempts > 0}
                  onChange={(e) => setAiSettings(writeAISettings({
                    ...aiSettings,
                    checkerMaxAttempts: e.target.checked ? 2 : 0,
                  }))}
                  className="accent-primary w-3.5 h-3.5"
                />
                <span className={cn(
                  "text-[11px] font-bold tracking-tight transition-colors",
                  aiSettings.checkerMaxAttempts === 0 ? "text-muted-foreground/40" : "text-muted-foreground",
                )}>자동검수</span>
              </label>
              <label
                className="flex items-center gap-1.5"
                title="AI가 푼 풀이를 또 다른 AI가 다시 검토합니다. 틀린 곳이 있으면 풀이를 다시 시도하며, 횟수가 많을수록 정확도는 올라가지만 시간·비용이 늘어납니다. 0 = 검증 없이 첫 풀이 그대로 사용."
              >
                <span className={cn(
                  "text-[11px] font-bold tracking-tight transition-colors",
                  aiSettings.verifierMaxAttempts === 0 ? "text-muted-foreground/40" : "text-muted-foreground",
                )}>풀이검증</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={1}
                  value={aiSettings.verifierMaxAttempts}
                  onChange={(e) => setAiSettings(writeAISettings({
                    ...aiSettings,
                    verifierMaxAttempts: Number(e.target.value),
                  }))}
                  className={cn(
                    "w-10 px-1.5 py-0.5 rounded-md border bg-background text-xs text-center",
                    aiSettings.verifierMaxAttempts === 0 && "opacity-40",
                  )}
                />
            </label>
          </div>
        </div>
        </div>
      </div>
      </div>

      {/* Main Studio Body */}
      <div className="flex-1 flex gap-5 overflow-hidden">
        {/* Left Sidebar: Project Navigator */}
        <div className="w-[320px] xl:w-[340px] 2xl:w-[360px] shrink-0 flex flex-col border rounded-2xl bg-card overflow-hidden shadow-sm">
          <div className="shrink-0 px-5 py-3 border-b bg-muted/20 flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Navigator
            </span>
            {hasJob && v3Meta?.questionCount && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                {Object.keys(useJobStore.getState().questionResults).length} / {v3Meta.questionCount}
              </span>
            )}
          </div>

          {hasJob && (
            <div className="shrink-0 px-5 py-1.5 border-b bg-muted/10 flex items-center gap-3 text-[9px] text-muted-foreground uppercase tracking-wider">
              <span className="flex items-center gap-1" title="추출 단계 완료 여부">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400/70" />추출
              </span>
              <span className="flex items-center gap-1" title="풀이(해설) 단계 완료 여부">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70" />풀이
              </span>
              <span className="flex items-center gap-1" title="검증 단계 — pass / 적색 fail">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-status-success)]/70" />검증
              </span>
              <span className="flex items-center gap-1 opacity-70" title="그림이 필요한 문제(has_figure)">
                <span className="w-1.5 h-1.5 rounded-full bg-muted border border-border" />그림
              </span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {!hasJob ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4 opacity-40">
                <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center rotate-3 border-2 border-dashed border-muted-foreground/30">
                  <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">No Active Session</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    상단에서 PDF를 업로드하거나<br/>이전 작업을 재개하세요.
                  </p>
                </div>
              </div>
            ) : (
              <QuestionList onItemClick={() => setQuestionModalOpen(true)} />
            )}
          </div>

        </div>

        {/* Right Workspace: The Interactive Area */}
        <div className="flex-1 flex flex-col border rounded-xl bg-card overflow-hidden shadow-sm">
          {/* Fixed Workspace Pipeline */}
          <div className="shrink-0 border-b px-4 py-3 bg-muted/5">
            <PipelineView 
              mode="create" 
              stages={stagesForDisplay.length > 0 ? stagesForDisplay : undefined} 
              orientation="horizontal" 
            />
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {!hasJob ? (
              <NoActiveSessionPlaceholder />
            ) : (
              <div className="flex flex-col h-full">
                <div className="shrink-0 border-b px-6 py-3 bg-background/50">
                  <QuestionPanelHeader
                    onOpenFigureModal={() => {
                      setQuestionModalOpen(false);
                      setFigureModalOpen(true);
                    }}
                    onStartBuilder={handleStartBuilder}
                    builderLoading={builderStarting}
                  />
                </div>
                <OutputOptionsPanel
                  meta={runtimeMeta}
                  disabled={runtimeOptionsDisabled}
                  onPatch={handleRuntimeMetaPatch}
                  yearOptions={yearOptions}
                />
                <div className={cn(
                  "flex-1 min-h-0 grid",
                  activityLogCollapsed
                    ? "grid-rows-[minmax(0,1fr)_42px]"
                    : "grid-rows-[minmax(0,1fr)_128px] 2xl:grid-rows-[minmax(0,1fr)_160px]"
                )}>
                  <div className="min-h-0 overflow-y-auto">
                    <QuestionDetailView />
                  </div>
                  <div className="min-h-0 border-t bg-muted/5 flex flex-col">
                    <div className="shrink-0 px-4 py-2 border-b bg-muted/20 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Activity Log</span>
                      <div className="flex items-center gap-3">
                        <span className="hidden xl:inline text-[9px] text-muted-foreground/60">문제 클릭 → 오른쪽 상세와 팝업 동시 이동</span>
                        <button
                          type="button"
                          onClick={() => setActivityLogCollapsed((v) => !v)}
                          className="rounded-md border px-2 py-0.5 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-background"
                        >
                          {activityLogCollapsed ? "로그 펼치기" : "로그 접기"}
                        </button>
                      </div>
                    </div>
                    {!activityLogCollapsed && (
                      <div className="flex-1 min-h-0 overflow-y-auto p-3">
                        <LogStream logs={logs} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>


      {/* Question Detail Modal — 네비게이터 클릭 시 표시 */}
      {resultSessionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl max-h-[82vh] overflow-hidden rounded-2xl border bg-card shadow-2xl flex flex-col">
            <div className="shrink-0 px-5 py-4 border-b flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-sm font-bold">결과 불러오기</h2>
                <p className="text-xs text-muted-foreground mt-1">작업 결과를 선택하면 검수 화면으로 바로 열립니다.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setResultSessionsOpen(false)}
                disabled={cacheReviewLoading}
                className="shrink-0"
              >
                닫기
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
              {resultSessionsLoading && (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  결과 목록을 불러오는 중입니다.
                </div>
              )}

              {!resultSessionsLoading && resultSessionsError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  {resultSessionsError}
                </div>
              )}

              {!resultSessionsLoading && !resultSessionsError && resultSessions.length === 0 && (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  불러올 작업 결과가 없습니다.
                </div>
              )}

              {!resultSessionsLoading && resultSessions.map((session) => {
                const selected = selectedResultSessionId === session.id;
                const totalCount = session.questionCount + session.essayCount;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedResultSessionId(session.id)}
                    aria-pressed={selected}
                    className={cn(
                      "w-full text-left rounded-xl border p-4 transition-colors",
                      selected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-border bg-background hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold break-keep">{session.label}</span>
                          {session.active && (
                            <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-bold text-green-700 border border-green-500/20">
                              현재
                            </span>
                          )}
                          {session.hasClean && (
                            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-500/20">
                              정리 이미지 있음
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatResultSessionTime(session.updatedAt)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-bold">{totalCount}문제</div>
                        {session.essayCount > 0 && (
                          <div className="text-[10px] text-muted-foreground">서술형 {session.essayCount}</div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="shrink-0 px-5 py-4 border-t bg-muted/10 flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={loadResultSessions}
                disabled={resultSessionsLoading || cacheReviewLoading}
              >
                새로고침
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!selectedResultSessionId) return;
                  void handleLoadCachedResults(selectedResultSessionId);
                }}
                disabled={!selectedResultSessionId || resultSessionsLoading || cacheReviewLoading}
              >
                {cacheReviewLoading ? "여는 중" : "선택 결과 열기"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <QuestionDetailModal
        open={questionModalOpen && hasJob}
        onClose={() => setQuestionModalOpen(false)}
      />

      {/* Figure Review Modal — 그림 결과 확인 / 재생성 */}
      <FigureReviewModal
        open={figureModalOpen && hasJob}
        onClose={() => setFigureModalOpen(false)}
        entries={entries}
        jobId={jobId}
        globalLoading={figureGlobalLoading}
        onRetryFigure={(qNum) => {
          if (!jobId) return;
          // figure 재시도 시 extractionReviewActive 초기화 — 그렇지 않으면
          // "그림 결과 확인" 버튼이 사라지고 "해설 생성 시작" 버튼이 잘못 노출됨.
          store.setExtractionReviewActive(false);
          sendResumeAction(jobId, `resume --q=${qNum} --from=figure`, store, runtimeMeta);
        }}
        onRetryQuestions={(qNums) => {
          if (!jobId || qNums.length === 0) return;
          store.setExtractionReviewActive(false);
          sendResumeAction(jobId, `resume --q=${qNums.join(",")} --from=figure`, store, runtimeMeta);
        }}
        onRetryAll={async () => {
          if (!jobId || status === "running") return;
          store.setExtractionReviewActive(false);
          setFigureGlobalLoading("figure");
          await sendResumeAction(jobId, "resume --from=figure", store, runtimeMeta);
          setFigureGlobalLoading(null);
        }}
      />

      {/* Cropper Modal — !hasJob 상태에서 PDF 업로드/크롭 작업 */}
      <CropperModal
        ref={cropperRef}
        open={cropperOpen && !hasJob}
        onClose={() => setCropperOpen(false)}
        onExtract={handleExtract}
        autoSplitOnUpload={autoSplitActive}
        autoSplitProvider={autoSplitProvider}
        autoSplitMode={autoSplitMode}
        onPdfSelected={handlePdfSelected}
        workflowOptions={
          <PdfWorkflowOptionsPanel
            autoSplitActive={autoSplitActive}
            autoSplitProvider={autoSplitProvider}
            autoSplitMode={autoSplitMode}
            autoSplitProviderMissing={autoSplitProviderMissing}
            onAutoSplitToggle={handleAutoSplitToggle}
            onAutoSplitProviderChange={handleAutoSplitProviderChange}
            onAutoSplitModeChange={handleAutoSplitModeChange}
            imageCleaningActive={imageCleaningActive}
            cleaningProviderMissing={cleaningProviderMissing}
            aiSettings={aiSettings}
            onAISettingsChange={setAiSettings}
          />
        }
      />

      {/* Bottom Panel — build 결과 / followup chat 같은 이벤트성 UI 전용 */}
      {hasJob && ((showBuildStatus && buildStatus && !buildStatus.pending) || isDone) && (
        <div className="shrink-0 mt-3 border rounded-xl bg-card shadow-sm overflow-hidden flex flex-col max-h-[220px]">
          <div className="px-4 py-2 border-b bg-muted/20 flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Pipeline Action</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Build status panel */}
            {showBuildStatus && buildStatus && !buildStatus.pending && (
              <Card className={cn(
                "p-4 border shadow-sm",
                buildStatus.status === "success" || buildStatus.status === "completed" ? "border-green-500/30 bg-green-500/5" :
                buildStatus.status === "failed" ? "border-destructive/30 bg-destructive/5" : "border-yellow-500/30 bg-yellow-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">HWPX Build Status</h3>
                  <span className={cn("text-xs font-bold uppercase",
                    buildStatus.status === "success" || buildStatus.status === "completed" ? "text-green-600" :
                    buildStatus.status === "failed" ? "text-destructive" : "text-yellow-600"
                  )}>
                    {buildStatus.status}
                  </span>
                </div>
                {buildStatus.error && <p className="text-[10px] text-destructive mt-2 font-mono whitespace-pre-wrap">{buildStatus.error}</p>}
              </Card>
            )}

            {isDone && <FollowupChat disabled={isRunning} />}
          </div>
        </div>
      )}
    </div>
  );
}
