"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

export interface LogEntry {
  timestamp: string;
  stage: string;
  message: string;
  level: "info" | "warn" | "error";
}

const stageColorMap: Record<string, string> = {
  reader: "text-[var(--color-stage-reader)]",
  solver: "text-[var(--color-stage-solver)]",
  figure: "text-[var(--color-stage-figure)]",
  builder: "text-[var(--color-stage-builder)]",
  checker: "text-[var(--color-stage-checker)]",
  reviewer: "text-[var(--color-stage-solver)]",
  system: "text-muted-foreground",
};

const levelStyles: Record<string, string> = {
  info: "",
  warn: "text-[var(--color-status-warning)]",
  error: "text-[var(--color-status-error)]",
};

interface LogStreamProps {
  logs: LogEntry[];
  className?: string;
}

export function LogStream({ logs, className }: LogStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setIsAutoScroll(atBottom);
  }, []);

  useEffect(() => {
    if (isAutoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, isAutoScroll]);

  return (
    <div className={cn("rounded-lg overflow-hidden", className)}>
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between px-4 py-2 bg-[#2D2A26] text-[#E5E2DB] text-sm hover:bg-[#3a3632] transition-colors"
      >
        <span className="font-medium">로그</span>
        <svg
          className={cn("w-4 h-4 transition-transform", isCollapsed ? "" : "rotate-180")}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {!isCollapsed && (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="bg-[#2D2A26] px-4 py-2 h-48 overflow-y-auto font-mono text-xs leading-5"
        >
          {logs.length === 0 ? (
            <p className="text-[#9C9590]">대기 중...</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[#9C9590] shrink-0 select-none">
                  {formatTime(log.timestamp)}
                </span>
                <span
                  className={cn(
                    "shrink-0 w-24 text-right truncate",
                    stageColorMap[log.stage] ?? "text-[#9C9590]"
                  )}
                  title={`[${log.stage}]`}
                >
                  [{log.stage}]
                </span>
                <span className={cn("text-[#E5E2DB]", levelStyles[log.level])}>
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}
