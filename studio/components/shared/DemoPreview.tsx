"use client";

import { PipelineView } from "@/components/pipeline/PipelineView";
import { LogStream } from "@/components/log/LogStream";
import type { PipelineStage } from "@/components/pipeline/PipelineView";
import type { LogEntry } from "@/components/log/LogStream";

const mockStages: PipelineStage[] = [
  { name: "reader", label: "PDF 읽기", status: "done", summary: "15개 문제 추출 완료", startedAt: "2026-03-08T10:30:00Z", finishedAt: "2026-03-08T10:31:20Z" },
  { name: "solver", label: "해설 생성", status: "done", summary: "부실 해설 3건 보완", startedAt: "2026-03-08T10:31:20Z", finishedAt: "2026-03-08T10:32:45Z" },
  { name: "figure", label: "그림 처리", status: "running", progress: 60, startedAt: "2026-03-08T10:32:45Z" },
  { name: "builder", label: "HWPX 조립", status: "pending" },
  { name: "checker", label: "품질 검수", status: "pending" },
];

const mockLogs: LogEntry[] = [
  { timestamp: "2026-03-08T10:30:00Z", stage: "system", message: "작업 시작", level: "info" },
  { timestamp: "2026-03-08T10:30:05Z", stage: "reader", message: "PDF 페이지 1/4 처리중...", level: "info" },
  { timestamp: "2026-03-08T10:30:30Z", stage: "reader", message: "PDF 페이지 2/4 처리중...", level: "info" },
  { timestamp: "2026-03-08T10:31:00Z", stage: "reader", message: "PDF 페이지 3/4 처리중...", level: "info" },
  { timestamp: "2026-03-08T10:31:15Z", stage: "reader", message: "PDF 페이지 4/4 처리중...", level: "info" },
  { timestamp: "2026-03-08T10:31:20Z", stage: "reader", message: "15개 문제 추출 완료", level: "info" },
  { timestamp: "2026-03-08T10:31:25Z", stage: "solver", message: "해설 검증 시작", level: "info" },
  { timestamp: "2026-03-08T10:32:00Z", stage: "solver", message: "3번 문제 해설 부실 → 보완중", level: "warn" },
  { timestamp: "2026-03-08T10:32:30Z", stage: "solver", message: "7번 문제 해설 부실 → 보완중", level: "warn" },
  { timestamp: "2026-03-08T10:32:45Z", stage: "solver", message: "해설 보완 완료 (3건)", level: "info" },
  { timestamp: "2026-03-08T10:32:50Z", stage: "figure", message: "그림 1/3 crop 완료", level: "info" },
  { timestamp: "2026-03-08T10:33:10Z", stage: "figure", message: "그림 1/3 nano-banana 재생성중...", level: "info" },
];

export function DemoPreview() {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-muted-foreground">
        컴포넌트 미리보기 (목 데이터)
      </h2>
      <div className="grid grid-cols-[280px_1fr] gap-6">
        <PipelineView mode="create" stages={mockStages} />
        <LogStream logs={mockLogs} />
      </div>
    </div>
  );
}
