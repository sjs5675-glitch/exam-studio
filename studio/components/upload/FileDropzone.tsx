"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

export interface UploadedFile {
  name: string;
  size: number;
  path: string;
}

interface FileDropzoneProps {
  mode: "create";
  accept?: string[];
  onFilesChange?: (files: UploadedFile[]) => void;
}

export function FileDropzone({
  mode,
  accept = [".pdf"],
  onFilesChange,
}: FileDropzoneProps) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const filtered = Array.from(fileList).filter((f) =>
        accept.some((ext) => f.name.toLowerCase().endsWith(ext))
      );
      if (filtered.length === 0) {
        setError(`지원하지 않는 파일 형식입니다. (${accept.join(", ")}만 가능)`);
        return;
      }

      setIsUploading(true);
      setProgress(0);
      setError(null);

      const formData = new FormData();
      formData.append("mode", mode);
      filtered.forEach((f) => formData.append("files", f));

      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        setProgress(100);

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `업로드 실패 (${res.status})`);
        }

        const data = await res.json();
        if (!Array.isArray(data.files) || data.files.length === 0) {
          throw new Error("서버 응답에 파일 정보가 없습니다.");
        }

        const uploaded: UploadedFile[] = data.files;
        const newFiles = [...files, ...uploaded];
        setFiles(newFiles);
        onFilesChange?.(newFiles);
      } catch (err) {
        setError(err instanceof Error ? err.message : "업로드 중 오류가 발생했습니다.");
      } finally {
        setIsUploading(false);
        setProgress(0);
      }
    },
    [accept, files, mode, onFilesChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) uploadFiles(e.target.files);
    },
    [uploadFiles]
  );

  const removeFile = useCallback(
    (index: number) => {
      const newFiles = files.filter((_, i) => i !== index);
      setFiles(newFiles);
      onFilesChange?.(newFiles);
    },
    [files, onFilesChange]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
          isDragging
            ? "border-primary/60 bg-accent"
            : "border-border hover:border-primary/30 hover:bg-accent/50"
        )}
        onClick={() => document.getElementById(`file-input-${mode}`)?.click()}
      >
        <input
          id={`file-input-${mode}`}
          type="file"
          multiple
          accept={accept.join(",")}
          onChange={handleFileInput}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-2">
          <svg
            className="w-8 h-8 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
          >
            <path d="M12 16V4m0 0L8 8m4-4l4 4" />
            <path d="M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" />
          </svg>
          <p className="text-sm text-muted-foreground">
            파일을 드래그하거나 클릭하여 업로드
          </p>
          <p className="text-xs text-muted-foreground">
            {accept.join(", ")} 지원
          </p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {isUploading && (
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center justify-between px-3 py-2 bg-surface-alt rounded-md text-sm"
              style={{ backgroundColor: "var(--secondary)" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <svg
                  className="w-4 h-4 text-muted-foreground shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={1.8}
                >
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatSize(file.size)}
                </span>
              </div>
              <button
                onClick={() => removeFile(i)}
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
