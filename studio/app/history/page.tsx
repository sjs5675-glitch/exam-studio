"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DownloadButton } from "@/components/shared/DownloadButton";

interface Job {
  id: string;
  mode: "create";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  inputFiles?: string[];
  outputFile?: string;
  startedAt?: string;
  finishedAt?: string;
  followups?: { instruction: string; startedAt: string; finishedAt?: string }[];
}

type FilterMode = "all" | "create";
type FilterStatus = "all" | "done" | "failed" | "cancelled";

export default function HistoryPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs?limit=50");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs);
        setTotal(data.total);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(fetchJobs);
  }, [fetchJobs]);

  const filtered = jobs.filter((j) => {
    if (filterMode !== "all" && j.mode !== filterMode) return false;
    if (filterStatus !== "all" && j.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          {(["all", "create"] as FilterMode[]).map((m) => (
            <Button
              key={m}
              variant={filterMode === m ? "default" : "secondary"}
              size="sm"
              onClick={() => setFilterMode(m)}
            >
              {m === "all" ? "전체" : "제작"}
            </Button>
          ))}
        </div>
        <div className="w-px h-5 bg-border" />
        <div className="flex gap-1">
          {(["all", "done", "failed", "cancelled"] as FilterStatus[]).map((s) => (
            <Button
              key={s}
              variant={filterStatus === s ? "default" : "secondary"}
              size="sm"
              onClick={() => setFilterStatus(s)}
            >
              {s === "all" ? "전체" : s === "done" ? "완료" : s === "failed" ? "실패" : "중단"}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-auto">
          총 {total}건 / 필터 {filtered.length}건
        </span>
      </div>

      <div className="grid grid-cols-[1fr_360px] gap-6">
        {/* Job list */}
        <div className="space-y-1">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              작업 기록이 없습니다.
            </div>
          ) : (
            filtered.map((job) => (
              <button
                key={job.id}
                onClick={() => setSelectedJob(job)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-left transition-colors ${
                  selectedJob?.id === job.id
                    ? "bg-accent"
                    : "hover:bg-secondary"
                }`}
              >
                {/* Status dot */}
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    job.status === "done"
                      ? "bg-[var(--color-status-success)]"
                      : job.status === "failed"
                        ? "bg-[var(--color-status-error)]"
                        : job.status === "cancelled"
                          ? "bg-[var(--color-status-warning,orange)]"
                          : job.status === "running"
                            ? "bg-[var(--color-status-info)] animate-pulse"
                            : "bg-muted-foreground/30"
                  }`}
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className="text-xs shrink-0"
                    >
                      제작
                    </Badge>
                    <span className="truncate">
                      {getJobTitle(job)}
                    </span>
                  </div>
                </div>

                {/* Time */}
                <div className="text-xs text-muted-foreground shrink-0 text-right">
                  <div>{formatDate(job.startedAt)}</div>
                  {job.finishedAt && job.startedAt && (
                    <div>{formatDuration(job.startedAt, job.finishedAt)}</div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail panel */}
        <Card className="p-4 space-y-4 h-fit">
          {selectedJob ? (
            <>
              <h3 className="text-sm font-medium">작업 상세</h3>

              <div className="space-y-2 text-sm">
                <Row label="ID" value={selectedJob.id.slice(0, 8)} />
                <Row
                  label="유형"
                  value="시험지 제작"
                />
                <Row label="상태" value={statusLabel(selectedJob.status)} />
                <Row label="시작" value={formatDateTime(selectedJob.startedAt)} />
                <Row label="종료" value={formatDateTime(selectedJob.finishedAt)} />
                {selectedJob.finishedAt && selectedJob.startedAt && (
                  <Row
                    label="소요"
                    value={formatDuration(selectedJob.startedAt, selectedJob.finishedAt)}
                  />
                )}
              </div>

              {selectedJob.inputFiles && selectedJob.inputFiles.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">입력 파일</p>
                  {selectedJob.inputFiles.map((f, i) => (
                    <p key={i} className="text-xs truncate">
                      {f}
                    </p>
                  ))}
                </div>
              )}

              {selectedJob.followups && selectedJob.followups.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    추가 지시 ({selectedJob.followups.length}건)
                  </p>
                  {selectedJob.followups.map((f, i) => (
                    <p key={i} className="text-xs text-muted-foreground truncate">
                      {f.instruction}
                    </p>
                  ))}
                </div>
              )}

              {selectedJob.status === "done" && (
                <DownloadButton
                  jobId={selectedJob.id}
                />
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              작업을 선택하면 상세 정보가 표시됩니다.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value ?? "-"}</span>
    </div>
  );
}

function getJobTitle(job: Job): string {
  if (job.inputFiles && job.inputFiles.length > 0) {
    const pdf = job.inputFiles.find((f) => f.endsWith(".pdf"));
    if (pdf) return pdf.split("/").pop() ?? pdf;
  }
  return job.id.slice(0, 8);
}

function statusLabel(status: string): string {
  switch (status) {
    case "done": return "완료";
    case "failed": return "실패";
    case "cancelled": return "중단";
    case "running": return "진행중";
    case "queued": return "대기";
    default: return status;
  }
}

function formatDate(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateTime(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(start: string, end: string): string {
  const sec = Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 ${sec % 60}초`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}
