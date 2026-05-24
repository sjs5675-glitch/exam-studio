"use client";

import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useJobStore } from "@/lib/store";

export function ResultTabs() {
  const intermediateFiles = useJobStore((s) => s.intermediateFiles);
  const result = useJobStore((s) => s.result);
  const status = useJobStore((s) => s.status);

  const jsonFiles = intermediateFiles.filter((f) => f.type === "json");
  const imageFiles = intermediateFiles.filter((f) => f.type === "image");

  // 완료 시 리포트 모달 자동 오픈
  const [showReport, setShowReport] = useState(false);
  useEffect(() => {
    if ((status === "done" || status === "failed") && result?.summary) {
      queueMicrotask(() => setShowReport(true));
    }
  }, [status, result?.summary]);

  return (
    <>
      <Tabs defaultValue="json" className="w-full">
        <TabsList className="bg-secondary">
          <TabsTrigger value="json">
            JSON {jsonFiles.length > 0 && `(${jsonFiles.length})`}
          </TabsTrigger>
          <TabsTrigger value="images">
            이미지 {imageFiles.length > 0 && `(${imageFiles.length})`}
          </TabsTrigger>
          <TabsTrigger value="summary">요약</TabsTrigger>
        </TabsList>

        <TabsContent value="json" className="mt-3">
          {jsonFiles.length === 0 ? (
            <EmptyState message="JSON 파일이 아직 생성되지 않았습니다." />
          ) : (
            <ul className="space-y-2">
              {jsonFiles.map((f, i) => (
                <JsonFileItem key={i} file={f} />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="images" className="mt-3">
          {imageFiles.length === 0 ? (
            <EmptyState message="이미지가 아직 생성되지 않았습니다." />
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {imageFiles.map((f, i) => (
                <ImageFileItem key={i} file={f} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="summary" className="mt-3">
          {result ? (
            <div className="p-4 bg-secondary rounded-md space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      result.status === "success"
                        ? "bg-[var(--color-status-success)]"
                        : "bg-[var(--color-status-error)]"
                    }`}
                  />
                  <span className="text-sm font-medium">
                    {result.status === "success" ? "작업 완료" : "작업 실패"}
                  </span>
                </div>
                {result.summary && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowReport(true)}
                  >
                    리포트 보기
                  </Button>
                )}
              </div>
              {result.summary && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-5">
                  {result.summary}
                </p>
              )}
            </div>
          ) : (
            <EmptyState message="작업이 완료되면 요약이 표시됩니다." />
          )}
        </TabsContent>
      </Tabs>

      {/* 리포트 모달 */}
      {showReport && result?.summary && (
        <ReportModal
          summary={result.summary}
          status={result.status}
          onClose={() => setShowReport(false)}
        />
      )}
    </>
  );
}

// --- JSON 파일 항목 (호버 시 내용 팝업) ---

function JsonFileItem({ file }: { file: { name: string; path: string } }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [showPopup, setShowPopup] = useState(false);

  const loadPreview = useCallback(async () => {
    if (preview !== null) {
      setShowPopup(true);
      return;
    }
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(file.path)}`);
      if (!res.ok) {
        setPreview("(파일을 읽을 수 없습니다)");
      } else {
        const text = await res.text();
        // JSON 포맷팅
        try {
          const parsed = JSON.parse(text);
          setPreview(JSON.stringify(parsed, null, 2));
        } catch {
          setPreview(text);
        }
      }
      setShowPopup(true);
    } catch {
      setPreview("(파일을 읽을 수 없습니다)");
      setShowPopup(true);
    }
  }, [file.path, preview]);

  return (
    <li
      className="relative flex items-center gap-2 px-3 py-2 bg-secondary rounded-md text-sm cursor-pointer hover:bg-secondary/80 transition-colors"
      onMouseEnter={loadPreview}
      onMouseLeave={() => setShowPopup(false)}
    >
      <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="truncate">{file.name}</span>

      {showPopup && preview && (
        <div className="absolute left-full ml-2 top-0 z-50 w-[480px] max-h-[400px] overflow-auto bg-popover border border-border rounded-lg shadow-lg p-3">
          <pre className="text-xs text-popover-foreground whitespace-pre-wrap font-mono">
            {preview.slice(0, 5000)}
            {preview.length > 5000 && "\n... (truncated)"}
          </pre>
        </div>
      )}
    </li>
  );
}

// --- 이미지 파일 항목 (실제 이미지 렌더링) ---

function ImageFileItem({ file }: { file: { name: string; path: string } }) {
  const [error, setError] = useState(false);
  const imgSrc = `/api/file?path=${encodeURIComponent(file.path)}`;

  return (
    <div className="flex flex-col items-center gap-1.5 p-3 bg-secondary rounded-md">
      <div className="w-full aspect-square bg-muted rounded flex items-center justify-center overflow-hidden">
        {error ? (
          <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.2}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgSrc}
            alt={file.name}
            className="w-full h-full object-contain"
            onError={() => setError(true)}
          />
        )}
      </div>
      <span className="text-xs text-muted-foreground truncate w-full text-center">
        {file.name}
      </span>
    </div>
  );
}

// --- 리포트 모달 (마크다운 렌더링) ---

function ReportModal({
  summary,
  status,
  onClose,
}: {
  summary: string;
  status: string;
  onClose: () => void;
}) {
  // ESC 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                status === "success"
                  ? "bg-[var(--color-status-success)]"
                  : "bg-[var(--color-status-error)]"
              }`}
            />
            <h2 className="text-base font-semibold">작업 리포트</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body — 마크다운 스타일 렌더링 */}
        <div className="overflow-auto flex-1 px-5 py-4">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <MarkdownRenderer text={summary} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- 간단한 마크다운 렌더링 (외부 의존성 없이) ---

function MarkdownRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 제목
    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="text-sm font-semibold mt-3 mb-1">{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="text-base font-semibold mt-4 mb-1.5">{line.slice(3)}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={i} className="text-lg font-bold mt-4 mb-2">{line.slice(2)}</h1>);
    } else if (line.startsWith("===")) {
      elements.push(<hr key={i} className="my-3 border-border" />);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex gap-2 text-sm ml-2">
          <span className="text-muted-foreground shrink-0">-</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (/^\[.+\]/.test(line)) {
      // [태그] 형식
      const match = line.match(/^\[(.+?)\]\s*(.*)/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-2 text-sm">
            <span className="font-medium text-foreground shrink-0">[{match[1]}]</span>
            <span className="text-muted-foreground">{renderInline(match[2])}</span>
          </div>
        );
      } else {
        elements.push(<p key={i} className="text-sm text-muted-foreground">{renderInline(line)}</p>);
      }
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-sm text-muted-foreground">{renderInline(line)}</p>);
    }
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  // **bold** 처리
  const parts = text.split(/(\*\*.+?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    // `code` 처리
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((cp, j) => {
      if (cp.startsWith("`") && cp.endsWith("`")) {
        return <code key={`${i}-${j}`} className="px-1 py-0.5 bg-muted rounded text-xs font-mono">{cp.slice(1, -1)}</code>;
      }
      return cp;
    });
  });
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
