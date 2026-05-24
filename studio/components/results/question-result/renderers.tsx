import { Badge } from "@/components/ui/badge";
import { CONDITION_BOX_LABEL, DATA_TABLE_LABEL, type Part } from "./types";

export function renderParts(parts: Part[]) {
  return parts.map((p, i) => {
    if (p.br) return <br key={i} />;
    if (p.eq) {
      return (
        <code key={i} className="mx-0.5 px-1.5 py-0.5 text-[11px] font-mono bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded border border-blue-100 dark:border-blue-800/50">
          {p.eq}
        </code>
      );
    }
    return <span key={i} className="leading-relaxed">{p.t}</span>;
  });
}

export function renderConditionBox(cb: Record<string, unknown>) {
  const typeLabel = CONDITION_BOX_LABEL[String(cb.type ?? "")] ?? String(cb.type ?? "");
  const items = Array.isArray(cb.items)
    ? (cb.items as { label: string; parts: Part[] }[])
    : [];
  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-muted-foreground">[{typeLabel}]</span>
      {items.map((item, i) => (
        <div key={i} className="flex gap-1">
          <span className="font-medium shrink-0">{item.label}.</span>
          <span>{renderParts(item.parts ?? [])}</span>
        </div>
      ))}
    </div>
  );
}

export function renderDataTable(dt: Record<string, unknown>) {
  const typeLabel = DATA_TABLE_LABEL[String(dt.type ?? "")] ?? String(dt.type ?? "");
  const headers = Array.isArray(dt.headers) ? (dt.headers as string[]) : [];
  const rows = Array.isArray(dt.rows) ? (dt.rows as string[][]) : [];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-muted/50">{typeLabel}</Badge>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-[11px] border-collapse bg-white">
          <thead>
            <tr className="bg-muted/30">
              {headers.map((h, i) => (
                <th key={i} className="border-b border-r last:border-r-0 border-border px-2 py-1.5 font-bold text-muted-foreground text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-muted/10 transition-colors">
                {row.map((cell, j) => (
                  <td key={j} className="border-b last:border-b-0 border-r last:border-r-0 border-border px-2 py-1.5 font-medium">
                    {cell}
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
