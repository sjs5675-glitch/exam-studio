"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useJobStore, type QuestionResult } from "@/lib/store";
import type { Part } from "./types";
import { QuestionImages } from "./QuestionImages";
import { SolutionView } from "./SolutionView";
import { ActionButtons } from "./ActionButtons";
import { statusOf } from "./QuestionList";
import { InlineText } from "./inline/InlineText";
import { InlineSelect } from "./inline/InlineSelect";
import { InlinePartsEditor } from "./inline/InlinePartsEditor";
import { ConditionBoxEditor } from "./inline/ConditionBoxEditor";
import { InlineTableEditor } from "./inline/InlineTableEditor";

function difficultyColor(diff: string) {
  switch (diff) {
    case "하": return "text-emerald-600/90 border-border/60 bg-muted/10";
    case "중": return "text-blue-600/90 border-border/60 bg-muted/10";
    case "상": return "text-amber-600/90 border-border/60 bg-muted/10";
    case "킬": return "text-red-600/90 border-border/60 bg-muted/10";
    default: return "text-muted-foreground border-border/60 bg-muted/10";
  }
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 opacity-40">
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center border border-border/60 shadow-inner">
        <svg className="w-7 h-7 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{message}</p>
    </div>
  );
}

export function QuestionDetail({ qr }: { qr: QuestionResult }) {
  const updateQuestionResult = useJobStore((s) => s.updateQuestionResult);

  const ext = qr.extracted as Record<string, unknown> | undefined;
  const sol = qr.solved as Record<string, unknown> | undefined;
  const ver = qr.verified as Record<string, unknown> | undefined;

  const { color, phases } = statusOf(qr);

  const saveExtract = async (next: Record<string, unknown>) => {
    const res = await fetch(`/api/extracted-json?q=${qr.number}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error || "저장 실패");
    }
    updateQuestionResult(qr.number, "extracted", next);
  };

  const saveSolve = async (next: Record<string, unknown>) => {
    const res = await fetch(`/api/solver-json?q=${qr.number}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error || "저장 실패");
    }
    updateQuestionResult(qr.number, "solved", next);
  };

  return (
    <div className="flex flex-col h-full bg-background font-sans">
      {/* Top sticky header: Minimal & Professional */}
      <div className="flex items-center gap-3 px-6 py-4 border-b bg-card shrink-0">
        <div className={cn("w-2.5 h-2.5 rounded-full ring-4 ring-background", color)} />
        <h2 className="text-base font-bold text-foreground tracking-tight">문제 {qr.number}번</h2>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{phases}</span>

        <div className="ml-auto flex items-center gap-2">
          {ext && (
            <Badge variant="outline" className="font-mono text-[9px] px-2 py-0 bg-muted/20 border-border/50 text-muted-foreground">
              <InlineText
                value={String(ext.subtopic ?? "")}
                placeholder="단원 미지정"
                onSave={(v) => saveExtract({ ...ext, subtopic: v })}
                inputClassName="font-mono text-[9px] px-1 py-0 h-4 leading-none"
              />
            </Badge>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Images (Reduced clutter) */}
        <div className="w-[42%] border-r bg-muted/5 overflow-y-auto p-6 space-y-8 text-muted-foreground/60">
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              원본 이미지
            </h3>
            <QuestionImages qNum={qr.number} version={qr.updatedAt} />
          </div>

          {Boolean(ext?.has_figure) && (
             <div className="pt-6 border-t border-border/60">
               <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-4">처리된 그림</h3>
               <div className="rounded-xl border bg-white p-3 shadow-sm hover:shadow-md transition-shadow">
                 {/* eslint-disable-next-line @next/next/no-img-element */}
                 <img
                   src={`/api/file?path=${encodeURIComponent(`outputs/images/prob${qr.number}_final.png`)}&v=${encodeURIComponent(qr.updatedAt ?? "")}`}
                   className="w-full h-auto object-contain"
                   alt="Final Figure"
                   onError={(e) => { (e.target as HTMLImageElement).src = "https://placehold.co/400x200?text=그림+처리+중"; }}
                 />
               </div>
             </div>
          )}
        </div>

        {/* Right Column: Data & Tabs (High density) */}
        <div className="flex-1 flex flex-col overflow-hidden bg-card">
          <Tabs defaultValue="extract" className="flex-1 flex flex-col overflow-hidden">
            <div className="px-6 bg-muted/10 border-b shrink-0">
              <TabsList className="h-12 bg-transparent p-0 gap-8">
                <TabsTrigger value="extract" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-3.5 pt-4 font-bold text-[11px] uppercase tracking-wider text-muted-foreground data-[state=active]:text-foreground transition-all">
                  1. 추출 결과
                </TabsTrigger>
                <TabsTrigger value="solve" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-3.5 pt-4 font-bold text-[11px] uppercase tracking-wider text-muted-foreground data-[state=active]:text-foreground transition-all">
                  2. 풀이 및 해설
                </TabsTrigger>
                <TabsTrigger value="verify" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-3.5 pt-4 font-bold text-[11px] uppercase tracking-wider text-muted-foreground data-[state=active]:text-foreground transition-all">
                  3. 검증 리포트
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              <TabsContent value="extract" className="m-0 p-8 focus-visible:outline-none">
                {ext ? (
                  <div className="space-y-10 max-w-3xl">
                    {/* Metadata: Minimalist badges */}
                    <div className="flex flex-wrap items-center gap-8 pb-8 border-b border-border/60">
                      <div className="space-y-2">
                        <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest block">유형</span>
                        <Badge variant="outline" className="rounded-md border-border/80 text-foreground font-medium text-[11px] px-2.5 py-0.5">
                          <InlineSelect
                            value={String(ext.type ?? "essay")}
                            options={[
                              { value: "choice", label: "객관식" },
                              { value: "essay", label: "주관식" },
                            ]}
                            onSave={(v) => saveExtract({ ...ext, type: v })}
                            selectClassName="text-[11px] px-1 py-0 h-4 leading-none"
                          />
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest block">난이도</span>
                        <Badge variant="outline" className={cn("rounded-md font-bold text-[11px] px-2.5 py-0.5", difficultyColor(String(ext.difficulty ?? "중")))}>
                          <InlineSelect
                            value={String(ext.difficulty ?? "중")}
                            options={[
                              { value: "하", label: "하" },
                              { value: "중", label: "중" },
                              { value: "상", label: "상" },
                              { value: "킬", label: "킬" },
                            ]}
                            onSave={(v) => saveExtract({ ...ext, difficulty: v })}
                            selectClassName="text-[11px] px-1 py-0 h-4 leading-none font-bold"
                          />
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest block">배점</span>
                        <span className="text-sm font-bold text-foreground tracking-tight">
                          <InlineText
                            value={String(ext.score ?? "")}
                            placeholder="0"
                            onSave={(v) => saveExtract({ ...ext, score: v })}
                            display={<>{String(ext.score ?? "0")}점</>}
                            inputClassName="text-sm font-bold w-16"
                          />
                        </span>
                      </div>
                      <div className="space-y-2">
                        <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest block">그림</span>
                        <Badge variant="outline" className={cn("rounded-md text-[11px] px-2.5 py-0.5", ext.has_figure ? "text-blue-600 border-blue-100 bg-blue-50/20" : "text-muted-foreground border-border/80")}>
                          {ext.has_figure ? "포함" : "없음"}
                        </Badge>
                      </div>
                    </div>

                    {/* Question Content: Refined Typography */}
                    <div className="space-y-8">
                      <div className="space-y-10 animate-in fade-in duration-500 fill-mode-both">
                        <h4 className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.2em]">QUESTION BODY</h4>

                        <div className="relative p-7 rounded-xl border bg-card shadow-sm border-border/80">
                            <InlinePartsEditor
                              parts={(ext.parts as Part[]) ?? []}
                              onSave={(p) => saveExtract({ ...ext, parts: p })}
                            />
                          </div>

                          {ext.condition_box != null && (
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.2em] px-1">CONDITION BOX</h4>
                              <div className="p-6 rounded-xl border border-border/80 bg-muted/10">
                                <ConditionBoxEditor
                                  cb={ext.condition_box as Record<string, unknown>}
                                  onSave={(next) => saveExtract({ ...ext, condition_box: next })}
                                />
                              </div>
                            </div>
                          )}

                          {ext.data_table != null && (
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.2em] px-1">DATA TABLE</h4>
                              <div className="overflow-x-auto">
                                <InlineTableEditor
                                  dt={ext.data_table as Record<string, unknown>}
                                  onSave={(next) => saveExtract({ ...ext, data_table: next })}
                                />
                              </div>
                            </div>
                          )}

                          {Array.isArray(ext.choices) && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                              {(ext.choices as Part[][]).map((c: Part[], i: number) => (
                                <div key={i} className="flex gap-4 items-start p-4 rounded-xl border border-border/80 bg-card shadow-sm">
                                  <span className="w-7 h-7 rounded-lg bg-muted border border-border text-muted-foreground flex items-center justify-center text-[13px] font-bold shrink-0">
                                    {["①","②","③","④","⑤"][i]}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <InlinePartsEditor
                                      parts={c ?? []}
                                      onSave={(p) => {
                                        const next = (ext.choices as Part[][]).slice();
                                        next[i] = p;
                                        return saveExtract({ ...ext, choices: next });
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                    </div>
                  </div>
                ) : (
                  <EmptyTab message="추출된 데이터가 없습니다." />
                )}
              </TabsContent>

              <TabsContent value="solve" className="m-0 p-8 focus-visible:outline-none">
                {sol ? (
                  <div className="space-y-8 max-w-3xl">
                    <SolutionView sol={sol} onSave={saveSolve} />
                  </div>
                ) : (
                  <EmptyTab message="아직 해설이 생성되지 않았습니다. 추출 완료 후 진행하세요." />
                )}
              </TabsContent>

              <TabsContent value="verify" className="m-0 p-8 focus-visible:outline-none">
                {ver ? (
                  <div className="space-y-8 max-w-3xl animate-in slide-in-from-bottom-2 duration-500 fill-mode-both">
                    {process.env.NODE_ENV !== "production" && (() => {
                      console.log(`[verify-debug] Q${qr.number}`, {
                        status: ver.status,
                        revised: ver.revised,
                        attempts: ver.attempts,
                        issuesIsArray: Array.isArray(ver.issues),
                        issuesLength: Array.isArray(ver.issues) ? (ver.issues as unknown[]).length : "N/A",
                        ver,
                      });
                      return null;
                    })()}
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.2em]">VERIFICATION REPORT</h4>
                      <Badge variant="outline" className={cn(
                        "font-bold text-[10px] px-2.5 py-0.5 shadow-none border-border/60 bg-muted/10",
                        ver.revised
                          ? "text-amber-600/90"
                          : ver.status === "pass" ? "text-emerald-600/90" : "text-red-600/90"
                      )}>
                        {ver.revised
                          ? `FEEDBACK 반영 (${String(ver.attempts ?? "?")}회 시도)`
                          : String(ver.status ?? "UNKNOWN").toUpperCase()}
                      </Badge>
                    </div>

                    {Boolean(ver.revised) && (
                      <div className="p-4 rounded-lg border border-amber-100 bg-amber-50/40 text-[12px] text-amber-900/90 leading-relaxed">
                        <p className="font-bold mb-1 text-amber-700">현재 풀이는 아래 이슈를 반영해 재생성되었습니다.</p>
                        <p className="text-amber-700/80">
                          마지막 풀이는 verifier 로 재검증되지 않았으며, 아래는 직전 사이클에서 발견된 이슈입니다.
                          필요 시 하단 &quot;검증 재실행&quot; 버튼으로 현재 풀이를 다시 검증할 수 있습니다.
                        </p>
                      </div>
                    )}

                    {Array.isArray(ver.issues) && (ver.issues as unknown[]).length > 0 ? (
                      <div className="space-y-4">
                        {(ver.issues as Record<string, unknown>[]).map((issue, i) => (
                          <div key={i} className="p-5 rounded-xl border border-red-100 bg-red-50/20 flex gap-5 shadow-sm">
                            <div className="w-10 h-10 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0 border border-red-200/50">
                               <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </div>
                            <div className="space-y-1.5 py-0.5">
                              <p className="text-[10px] font-bold text-red-600 uppercase tracking-widest">[{String(issue.category)}]</p>
                              <p className="text-[14px] text-red-900/90 font-medium leading-relaxed">{String(issue.description)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-16 text-center space-y-4 border rounded-2xl bg-muted/5 border-dashed border-border/80">
                        <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
                          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-emerald-900">검증 완료</p>
                          <p className="text-xs text-emerald-600/80">발견된 오류가 없습니다.</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <EmptyTab message="검증이 아직 수행되지 않았습니다." />
                )}
              </TabsContent>
            </div>

            {/* Sticky Action Footer: Cleaner and more integrated */}
            <div className="shrink-0 p-5 border-t bg-muted/10 backdrop-blur-md flex items-center">
              <ActionButtons qNum={qr.number} />
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
