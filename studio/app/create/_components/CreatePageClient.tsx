"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { type CropperWorkspaceRef } from "@/components/cropper/CropperWorkspace";
import { CropperModal } from "@/components/upload/CropperModal";
import { HIGH_SCHOOL_SUBJECTS, MIDDLE_SCHOOL_SUBJECT, type MetaValue, type SchoolLevel } from "@/components/upload/MetaForm";
import { parseExamMetaFromFilename } from "@/lib/pdf/filenameMeta";
import type { ExamMetaInput } from "@/lib/exam/meta";
import { useJobRunner } from "@/lib/useJobRunner";
import { useJobStore } from "@/lib/store";
import { sendResumeAction } from "@/components/results/question-result/resume";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PipelineView } from "@/components/pipeline/PipelineView";
import { QuestionList, QuestionDetailModal, QuestionPanelHeader } from "@/components/results/QuestionResultPanel";
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
} from "@/lib/ai/settings";
import type { AIProviderId } from "@/lib/ai";
import { NoActiveSessionPlaceholder } from "./NoActiveSessionPlaceholder";
import {
  AUTO_SPLIT_LS_KEY,
  META_LS_KEY,
  PROVIDER_LABEL,
  STAGE_LABEL,
  createDefaultMeta,
  createYearOptions,
  loadStoredAutoSplitEnabled,
  loadStoredMeta,
  preloadQuestionResultsFromCache,
  type BuildStatus,
  type ExistingImages,
} from "../_lib/createPageState";

interface CreateV4PageProps {
  currentYear: number;
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
        const qNums = [...(existingImages.numbers || []), ...(existingImages.essayNumbers || [])];
        await preloadQuestionResultsFromCache(qNums, existingImages.cacheState);
        await startJob("resume", { pdf: "" }, jobMeta);
      })
      .catch(() => {});
  }, [v3Meta, startJob, setV3Meta]);

  const [autoSplitEnabled, setAutoSplitEnabled] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  const [aiSettings, setAiSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [meta, setMeta] = useState<MetaValue>(() => createDefaultMeta(currentYear));

  useEffect(() => {
    queueMicrotask(() => {
      setAutoSplitEnabled(loadStoredAutoSplitEnabled());
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
    loadGeminiStatus();

    const onFocus = () => {
      setAiSettings(readAISettings());
      loadGeminiStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [defaultMeta]);

  // Gemini 키가 확실히 없을 때만 자동 분할을 막는다 (null=확인 전/실패 → 막지 않음).
  const geminiMissing = geminiConfigured === false;
  const autoSplitActive = autoSplitEnabled && !geminiMissing;

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

  function handleMetaChange(next: MetaValue) {
    setMeta(next);
    try {
      sessionStorage.setItem(META_LS_KEY, JSON.stringify(next));
    } catch {}
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
        schoolLevel: v3Meta.schoolLevel ?? "고",
        school: v3Meta.school ?? "",
        grade: v3Meta.grade ?? 2,
        year: v3Meta.year ?? currentYear,
        subject: v3Meta.subject ?? "수학 I",
        semester: v3Meta.semester ?? "1학기",
        examType: v3Meta.examType ?? "중간",
        range: v3Meta.range ?? "",
      });
    });
  }, [v3Meta, hasJob, currentYear]);

  // 이전 작업 재개 상태
  const [existingImages, setExistingImages] = useState<ExistingImages | null>(null);

  // build 상태 + 폴링
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const buildIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null);
  const [questionModalOpen, setQuestionModalOpen] = useState(false);
  const [figureModalOpen, setFigureModalOpen] = useState(false);
  const [figureGlobalLoading, setFigureGlobalLoading] = useState<string | null>(null);
  const [cropperOpen, setCropperOpen] = useState(false);

  // create 모드: figure 단계가 done이 되면 자동으로 FigureReviewModal을 연다.
  // orchestrator(sse.ts)가 stopAfterStage="figure"로 figure 직후 멈추므로,
  // 사용자는 그림을 확인하고 "확인 완료 → HWPX 조립 시작" CTA로 builder를 트리거한다.
  // jobId당 1회만 자동 오픈해 사용자가 닫은 모달을 다시 띄우지 않는다.
  const autoOpenedFigureJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "create") return;
    if (!jobId) return;
    const figureStage = stages.find((s) => s.name === "figure");
    if (figureStage?.status !== "done") return;
    if (autoOpenedFigureJobIdRef.current === jobId) return;
    autoOpenedFigureJobIdRef.current = jobId;
    setQuestionModalOpen(false);
    setFigureModalOpen(true);
  }, [mode, jobId, stages]);

  const isMetaComplete =
    meta.school.trim().length > 0 &&
    meta.grade > 0 &&
    meta.year > 0 &&
    meta.subject.trim().length > 0 &&
    meta.semester.trim().length > 0 &&
    meta.examType.trim().length > 0 &&
    meta.range.trim().length > 0;

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

  const handleResume = useCallback(async () => {
    if (!existingImages) return;
    let cachedMeta: ExamMetaInput = {};
    try {
      const r = await fetch("/api/v3cache-meta");
      const data = await r.json() as { found: boolean; meta?: ExamMetaInput };
      if (data.found && data.meta) cachedMeta = data.meta;
    } catch { /* ignore */ }

    const jobMeta = {
      schoolLevel: cachedMeta.schoolLevel ?? meta.schoolLevel,
      school: cachedMeta.school ?? meta.school,
      grade: cachedMeta.grade ?? meta.grade,
      year: cachedMeta.year ?? meta.year,
      subject: cachedMeta.subject ?? meta.subject,
      semester: cachedMeta.semester ?? meta.semester,
      examType: cachedMeta.examType ?? meta.examType,
      range: cachedMeta.range ?? meta.range,
      questionCount: existingImages.count,
      resumeFrom: "auto",
    };
    setV3Meta({ ...jobMeta });

    // Pre-load all question data from cache
    const qNums = [...(existingImages.numbers || []), ...(existingImages.essayNumbers || [])];
    await preloadQuestionResultsFromCache(qNums, existingImages.cacheState);

    await startJob("resume", { pdf: "" }, jobMeta);
  }, [existingImages, meta, startJob, setV3Meta]);

  const handleConfirmFigure = useCallback(async () => {
    if (!jobId) return;
    await sendResumeAction(jobId, "resume --from=builder", store);
  }, [jobId, store]);

  // build 상태 패널 표시 여부
  const showBuildStatus = (isRunning || isDone) &&
    (mode === "create" || mode === "resume") &&
    v3Meta?.resumeFrom !== "figure";

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
        if (!data.pending && (data.status === "success" || data.status === "failed")) {
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

  const handleExtract = useCallback(
    async (items: { number: number; kind?: "regular" | "essay"; blob: Blob }[]) => {
      if (items.length === 0) return;

      if (!isMetaComplete) {
        setSubmitError("학교/학년/학년도/과목/학기/시험/범위 7개 필드를 모두 입력하세요.");
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

      const formData = new FormData();
      formData.append("meta", JSON.stringify(meta));
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
          const errData = await res.json().catch(() => ({}));
          throw new Error((errData as { error?: string }).error ?? `작업 시작 실패 (${res.status})`);
        }
        const data = (await res.json()) as { ok: true; images: { number: number }[] };
        saved = data.images;
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "작업 시작 실패");
        setRecoveryHint("디스크 상태가 rollback되어 이전 상태로 복구되었습니다. 다시 시도하세요.");
        setSubmitting(false);
        return;
      }

      // v3Meta를 store에 설정 (startJob 전)
      const jobMeta = { ...meta, questionCount: saved.length };
      setV3Meta(jobMeta);

      try {
        await startJob("create", { pdf: "", questionImages: saved.map((s) => s.number) }, jobMeta);
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "작업 시작 실패");
        setRecoveryHint("이미지/메타 모두 저장됐습니다. 페이지를 새로고침하면 '이전 작업 재개' 카드에서 이어 작업할 수 있습니다.");
        setSubmitting(false);
      }
    },
    [meta, isMetaComplete, deepSeekBlocksCreate, startJob, setV3Meta]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] overflow-hidden bg-background text-foreground">
      {/* Sophisticated Studio Control Center (Top Bar) */}
      <div className="shrink-0 border rounded-2xl mb-5 bg-card shadow-sm flex items-start p-1 overflow-hidden">
        {/* Section 1: Exam Configuration (The Form) */}
        <div className="px-5 py-3 flex-[3] min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Exam Configuration</span>
            {!hasJob && <span className="flex h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />}
            {hasJob && <span className="text-[9px] font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">LOCKED</span>}
          </div>
          
          {(() => {
            const effectiveLevel: SchoolLevel = (hasJob ? (v3Meta?.schoolLevel ?? meta.schoolLevel) : meta.schoolLevel) ?? "고";
            const isMiddle = effectiveLevel === "중";
            const handleLevelChange = (next: SchoolLevel) => {
              const nextSubject = next === "중" ? MIDDLE_SCHOOL_SUBJECT : (HIGH_SCHOOL_SUBJECTS.includes(meta.subject as typeof HIGH_SCHOOL_SUBJECTS[number]) ? meta.subject : HIGH_SCHOOL_SUBJECTS[0]);
              handleMetaChange({ ...meta, schoolLevel: next, subject: nextSubject });
            };
            const subjectOptions = isMiddle ? [MIDDLE_SCHOOL_SUBJECT] : [...HIGH_SCHOOL_SUBJECTS];
            return (
              <div className="flex flex-col gap-2.5">
                {/* Row 1: 학교급 | 학년도 | 학교 | 학년 */}
                <div className="grid grid-cols-4 gap-x-6 gap-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] w-10 text-muted-foreground font-semibold shrink-0">학교급</span>
                    <select
                      value={effectiveLevel}
                      onChange={(e) => handleLevelChange(e.target.value as SchoolLevel)}
                      disabled={submitting || isRunning || hasJob}
                      className="flex-1 min-w-0 px-0 py-0.5 text-sm bg-transparent border-b border-transparent focus:border-primary outline-none cursor-pointer disabled:opacity-70"
                    >
                      <option value="고">고등학교</option>
                      <option value="중">중학교</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] w-10 text-muted-foreground font-semibold shrink-0">학년도</span>
                    <select
                      value={hasJob ? (v3Meta?.year || meta.year) : meta.year}
                      onChange={(e) => handleMetaChange({ ...meta, year: Number(e.target.value) })}
                      disabled={submitting || isRunning || hasJob}
                      className="flex-1 min-w-0 px-0 py-0.5 text-sm bg-transparent border-b border-transparent focus:border-primary outline-none cursor-pointer disabled:opacity-70"
                    >
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] w-10 text-muted-foreground font-semibold shrink-0">학교</span>
                    <input
                      type="text"
                      value={hasJob ? (v3Meta?.school || "") : meta.school}
                      onChange={(e) => handleMetaChange({ ...meta, school: e.target.value })}
                      placeholder={isMiddle ? "OO중학교" : "학교명 입력"}
                      disabled={submitting || isRunning || hasJob}
                      className="flex-1 min-w-0 px-0 py-0.5 text-sm bg-transparent border-b border-transparent focus:border-primary outline-none transition-colors placeholder:text-muted-foreground/40 disabled:opacity-70"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] w-10 text-muted-foreground font-semibold shrink-0">학년</span>
                    <select
                      value={hasJob ? (v3Meta?.grade || 2) : meta.grade}
                      onChange={(e) => handleMetaChange({ ...meta, grade: Number(e.target.value) })}
                      disabled={submitting || isRunning || hasJob}
                      className="flex-1 min-w-0 px-0 py-0.5 text-sm bg-transparent border-b border-transparent focus:border-primary outline-none cursor-pointer disabled:opacity-70"
                    >
                      {[1, 2, 3].map(g => <option key={g} value={g}>{g}학년</option>)}
                    </select>
                  </div>
                </div>

                {/* Row 2: 과목 | 학기 | 시험 | 범위 */}
                <div className="grid grid-cols-4 gap-x-6 gap-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] w-10 text-muted-foreground font-semibold shrink-0">과목</span>
                    <select
                      value={hasJob ? (v3Meta?.subject || (isMiddle ? MIDDLE_SCHOOL_SUBJECT : "수학 I")) : meta.subject}
                      onChange={(e) => handleMetaChange({ ...meta, subject: e.target.value })}
                      disabled={submitting || isRunning || hasJob || isMiddle}
                      title={isMiddle ? "중학교는 단일 과목(수학)으로 고정됩니다." : undefined}
                      className="flex-1 min-w-0 px-0 py-0.5 text-sm bg-transparent border-b border-transparent focus:border-primary outline-none cursor-pointer disabled:opacity-70"
                    >
                      {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] w-10 text-muted-foreground font-semibold shrink-0">학기</span>
                    <select
                      value={hasJob ? (v3Meta?.semester || "1학기") : meta.semester}
                      onChange={(e) => handleMetaChange({ ...meta, semester: e.target.value })}
                      disabled={submitting || isRunning || hasJob}
                      className="flex-1 min-w-0 px-0 py-0.5 text-sm bg-transparent border-b border-transparent focus:border-primary outline-none cursor-pointer disabled:opacity-70"
                    >
                      <option value="1학기">1학기</option>
                      <option value="2학기">2학기</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] w-10 text-muted-foreground font-semibold shrink-0">시험</span>
                    <select
                      value={hasJob ? (v3Meta?.examType || "중간") : meta.examType}
                      onChange={(e) => handleMetaChange({ ...meta, examType: e.target.value })}
                      disabled={submitting || isRunning || hasJob}
                      className="flex-1 min-w-0 px-0 py-0.5 text-sm bg-transparent border-b border-transparent focus:border-primary outline-none cursor-pointer disabled:opacity-70"
                    >
                      <option value="중간">중간</option>
                      <option value="기말">기말</option>
                      <option value="모의">모의</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] w-10 text-muted-foreground font-semibold shrink-0">범위</span>
                    <input
                      type="text"
                      value={hasJob ? (v3Meta?.range || "") : meta.range}
                      onChange={(e) => handleMetaChange({ ...meta, range: e.target.value })}
                      placeholder={isMiddle ? "예: 정수와 유리수~일차방정식" : "예: 지수~로그"}
                      disabled={submitting || isRunning || hasJob}
                      className="flex-1 min-w-0 px-0 py-0.5 text-sm bg-transparent border-b border-transparent focus:border-primary outline-none transition-colors placeholder:text-muted-foreground/40 disabled:opacity-70"
                    />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Partial Separator */}
        <div className="w-px h-16 bg-border/40 self-center mx-2" />

        {/* Section 2: AI Config */}
        <div className="px-6 py-3 min-w-[160px]">
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
        <div className="w-px h-16 bg-border/40 self-center mx-2" />

        {/* Section 3: Job Status */}
        <div className="px-6 py-3 min-w-[130px]">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Status</div>
          <div className="flex items-center gap-2.5">
            <span className={cn("w-2 h-2 rounded-full ring-4 ring-offset-0", 
              isRunning ? "bg-yellow-500 animate-pulse ring-yellow-500/20" :
              isPaused ? "bg-blue-500 ring-blue-500/20" :
              !hasJob ? "bg-muted-foreground/20 ring-transparent" :
              result?.status === "success" ? "bg-green-500 ring-green-500/20" : "bg-destructive ring-destructive/20"
            )} />
            <span className="text-xs font-bold tracking-tight uppercase">
              {isRunning ? "Running" : isPaused ? "Paused" : !hasJob ? "Idle" : result?.status === "success" ? "Success" : "Failed"}
            </span>
          </div>
        </div>

        {/* Section 4: Global Actions */}
        <div className="px-6 py-3 bg-muted/10 self-stretch flex flex-col justify-center gap-3 min-w-[240px] rounded-r-2xl border-l">
          {!hasJob && existingImages && (
            <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
              이전 작업이 존재합니다. &quot;작업 재개&quot;를 클릭하세요.
            </div>
          )}
          <div className="flex items-center gap-2">
            {!hasJob ? (
              <>
                <Button
                  onClick={() => {
                    setQuestionModalOpen(false);
                    setFigureModalOpen(false);
                    setCropperOpen(true);
                    queueMicrotask(() => cropperRef.current?.openFilePicker());
                  }}
                  disabled={submitting}
                  variant="outline"
                  size="sm"
                  className="h-9 flex-1 text-xs font-bold border-primary text-primary hover:bg-primary/5 transition-all shadow-sm active:scale-95 gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  PDF 열기
                </Button>
                {existingImages && (
                  <Button onClick={handleResume} disabled={submitting} size="sm" className="h-9 flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-md active:scale-95">
                    작업 재개
                  </Button>
                )}
              </>
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
                {status === "done" && !isFailed && (
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
          
          <div className="flex flex-col gap-1.5">
            <label
              className={cn(
                "flex items-center gap-2 group",
                geminiMissing ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              )}
            >
              <input
                type="checkbox"
                checked={autoSplitActive}
                onChange={handleAutoSplitToggle}
                disabled={geminiMissing}
                className="accent-primary w-3.5 h-3.5"
              />
              <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors font-bold tracking-tight">
                자동 분할 <span className="font-normal opacity-70">(Gemini API 사용)</span>
              </span>
            </label>
            {geminiMissing && (
              <a
                href="/settings"
                className="ml-[1.375rem] text-[10px] text-destructive/80 hover:text-destructive hover:underline"
              >
                Gemini API 키가 필요합니다 — 설정에서 입력
              </a>
            )}
            <label
              className="flex items-center gap-2 cursor-pointer group"
              title="추출 전에 nano-banana로 문제 이미지의 손글씨/필기 흔적을 제거합니다. 인쇄된 텍스트·수식·표는 그대로 유지. 체크 해제 시 원본 이미지로 진행."
            >
              <input
                type="checkbox"
                checked={aiSettings.imageCleaningEnabled}
                onChange={(e) => setAiSettings(writeAISettings({
                  ...aiSettings,
                  imageCleaningEnabled: e.target.checked,
                }))}
                className="accent-primary w-3.5 h-3.5"
              />
              <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors font-bold tracking-tight">
                이미지 정리 <span className="font-normal opacity-70">
                  (손글씨 제거, {aiSettings.imageProvider === "codex-cli" ? "Codex CLI ImageGen" : "Gemini API"} 사용)
                </span>
              </span>
            </label>
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

      {/* Main Studio Body */}
      <div className="flex-1 flex gap-5 overflow-hidden">
        {/* Left Sidebar: Project Navigator */}
        <div className="w-[400px] shrink-0 flex flex-col border rounded-2xl bg-card overflow-hidden shadow-sm">
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

          {!hasJob && !isMetaComplete && (
             <div className="p-5 bg-amber-500/[0.03] border-t border-amber-500/10">
               <div className="p-3 rounded-xl border border-amber-500/20 bg-card text-[11px] text-amber-700 leading-normal flex gap-2.5 shadow-sm">
                  <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span>모든 필수 설정을 완료해야<br/>추출을 시작할 수 있습니다.</span>
               </div>
             </div>
          )}
        </div>

        {/* Right Workspace: The Interactive Area */}
        <div className="flex-1 flex flex-col border rounded-xl bg-card overflow-hidden shadow-sm">
          {/* Fixed Workspace Pipeline */}
          <div className="shrink-0 border-b px-4 py-3 bg-muted/5">
            <PipelineView 
              mode="create" 
              stages={stages.length > 0 ? stages : undefined} 
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
                  />
                </div>
                <div className="shrink-0 px-4 py-2 border-b bg-muted/20 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Activity Log</span>
                  <span className="text-[9px] text-muted-foreground/60">문제 클릭 → 팝업으로 상세 보기</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <LogStream logs={logs} />
                </div>
              </div>
            )}

          </div>
        </div>
      </div>


      {/* Question Detail Modal — 네비게이터 클릭 시 표시 */}
      <QuestionDetailModal
        open={questionModalOpen && hasJob}
        onClose={() => setQuestionModalOpen(false)}
      />

      {/* Figure Review Modal — 그림 결과 확인 / 재생성 / HWPX 조립 진입점 */}
      <FigureReviewModal
        open={figureModalOpen && hasJob}
        onClose={() => setFigureModalOpen(false)}
        entries={entries}
        jobId={jobId}
        globalLoading={figureGlobalLoading}
        onConfirm={async () => {
          setFigureGlobalLoading("confirm");
          await handleConfirmFigure();
          setFigureGlobalLoading(null);
          setFigureModalOpen(false);
        }}
        onRetryFigure={(qNum) => {
          if (!jobId) return;
          // figure 재시도 시 extractionReviewActive 초기화 — 그렇지 않으면
          // "그림 결과 확인" 버튼이 사라지고 "해설 생성 시작" 버튼이 잘못 노출됨.
          store.setExtractionReviewActive(false);
          sendResumeAction(jobId, `resume --q=${qNum} --from=figure`, store);
        }}
        onRetryAll={async () => {
          if (!jobId || status === "running") return;
          store.setExtractionReviewActive(false);
          setFigureGlobalLoading("figure");
          await sendResumeAction(jobId, "resume --from=figure", store);
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
        onPdfSelected={handlePdfSelected}
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
                buildStatus.status === "success" ? "border-green-500/30 bg-green-500/5" :
                buildStatus.status === "failed" ? "border-destructive/30 bg-destructive/5" : "border-yellow-500/30 bg-yellow-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">HWPX Build Status</h3>
                  <span className={cn("text-xs font-bold uppercase",
                    buildStatus.status === "success" ? "text-green-600" :
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
