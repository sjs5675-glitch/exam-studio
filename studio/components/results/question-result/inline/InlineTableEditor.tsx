"use client";

import { Badge } from "@/components/ui/badge";
import { DATA_TABLE_LABEL } from "../types";
import { InlineText } from "./InlineText";
import { InlineSelect } from "./InlineSelect";

/**
 * data_table 인라인 편집 — 셀 값 수정 전용.
 * - 타입 라벨: InlineSelect (DATA_TABLE_LABEL 키)
 * - 헤더 셀 / 본문 셀: InlineText
 * - 행/열 추가/삭제 UI 는 의도적으로 제외 — 구조 변경은 LLM/HWPX 책임.
 */
export function InlineTableEditor({
  dt,
  onSave,
}: {
  dt: Record<string, unknown>;
  onSave: (next: Record<string, unknown>) => Promise<void> | void;
}) {
  const type = String(dt.type ?? "general");
  const headers = Array.isArray(dt.headers) ? (dt.headers as string[]) : [];
  const rows = Array.isArray(dt.rows) ? (dt.rows as string[][]) : [];

  const saveHeader = (i: number, v: string) => {
    const next = headers.slice();
    next[i] = v;
    return onSave({ ...dt, headers: next });
  };

  const saveCell = (r: number, c: number, v: string) => {
    const next = rows.map((row) => row.slice());
    next[r][c] = v;
    return onSave({ ...dt, rows: next });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-muted/50">
          <InlineSelect
            value={type}
            options={Object.entries(DATA_TABLE_LABEL).map(([value, label]) => ({ value, label }))}
            onSave={(v) => onSave({ ...dt, type: v })}
            selectClassName="text-[9px] px-1 py-0 h-3.5 leading-none"
          />
        </Badge>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-[11px] border-collapse bg-white">
          <thead>
            <tr className="bg-muted/30">
              {headers.map((h, i) => (
                <th key={i} className="border-b border-r last:border-r-0 border-border px-2 py-1.5 font-bold text-muted-foreground text-left">
                  <InlineText
                    value={h}
                    onSave={(v) => saveHeader(i, v)}
                    placeholder="헤더"
                    inputClassName="text-[11px] font-bold w-full min-w-[60px]"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="border-b last:border-b-0 border-r last:border-r-0 border-border px-2 py-1.5 font-medium">
                    <InlineText
                      value={cell}
                      onSave={(v) => saveCell(r, c, v)}
                      placeholder=""
                      inputClassName="text-[11px] w-full min-w-[60px]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
