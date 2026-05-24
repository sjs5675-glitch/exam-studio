"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

export function QuestionImages({ qNum, version }: { qNum: number; version?: string }) {
  return <QuestionImagesContent key={`${qNum}:${version ?? ""}`} qNum={qNum} version={version} />;
}

function QuestionImagesContent({ qNum, version }: { qNum: number; version?: string }) {
  const padded = String(qNum).padStart(2, "0");
  const v = encodeURIComponent(version ?? "");
  const originalSrc = `/api/file?path=${encodeURIComponent(`inputs/시험지 제작/question_images/q${padded}.png`)}&v=${v}`;
  const cleanedSrc = `/api/file?path=${encodeURIComponent(`inputs/시험지 제작/question_images/cleaned/q${padded}.png`)}&v=${v}`;
  const [cleanedError, setCleanedError] = useState(false);
  // null = 아직 로딩 중, true = 실제로 정리된 이미지, false = 정리 안 함(원본 복사)
  const [isActuallyCleaned, setIsActuallyCleaned] = useState<boolean | null>(null);

  useEffect(() => {
    // cleaning_status.json을 읽어 이 문제가 실제로 정리됐는지 확인한다.
    // cleaned=false이면 파일은 존재하지만 원본의 복사본 — raw 이미지를 "정리본"으로 표시하지 않기 위해.
    fetch(
      `/api/file?path=${encodeURIComponent("inputs/시험지 제작/.v3cache/cleaning_status.json")}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { questions?: Record<string, { cleaned?: boolean }> } | null) => {
        if (!json?.questions) return;
        const qStatus = json.questions[String(qNum)];
        setIsActuallyCleaned(qStatus?.cleaned ?? null);
      })
      .catch(() => {
        /* 상태 파일 없으면 표준 onError 폴백에 맡김 */
      });
  }, [qNum, version]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[9px] font-bold bg-white/50">ORIGINAL</Badge>
          <span className="text-[10px] text-muted-foreground font-mono">q{padded}.png</span>
        </div>
        <div className="rounded-xl border bg-white p-2 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={originalSrc}
            alt={`문제 ${qNum} 원본`}
            className="w-full h-auto rounded-lg"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[9px] font-bold bg-blue-50 text-blue-600 border-blue-100 uppercase">Cleaned</Badge>
          {!cleanedError && isActuallyCleaned !== false && (
            <span className="text-[10px] text-muted-foreground font-mono">cleaned/q{padded}.png</span>
          )}
        </div>
        <div className="rounded-xl border bg-white p-2 shadow-sm min-h-[100px] flex items-center justify-center">
          {/* cleaned=false: 이미지 정리 미실행 — 원본 복사본을 "정리본"으로 오표시 방지 */}
          {isActuallyCleaned === false ? (
            <div className="text-[10px] text-muted-foreground italic p-4 text-center">
              이미지 처리 전 (원본과 동일)<br/>
              <span className="text-[9px] opacity-70">이미지 처리 단계 실행 후 확인하세요.</span>
            </div>
          ) : !cleanedError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cleanedSrc}
              alt={`문제 ${qNum} 정리본`}
              className="w-full h-auto rounded-lg"
              onError={() => setCleanedError(true)}
            />
          ) : (
            <div className="text-[10px] text-muted-foreground italic p-4 text-center">
              정리본 이미지가 아직 생성되지 않았거나<br/>파일을 찾을 수 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
