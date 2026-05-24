"use client";

import { Card } from "@/components/ui/card";
import { useSelectedEntry } from "./hooks";
import { QuestionList } from "./QuestionList";
import { QuestionDetailView } from "./QuestionDetailView";
import { QuestionPanelHeader } from "./QuestionPanelHeader";

export function QuestionResultPanel() {
  const { entries } = useSelectedEntry();
  if (entries.length === 0) return null;

  return (
    <Card className="p-4 space-y-3">
      <QuestionPanelHeader />
      <div className="grid grid-cols-[140px_1fr] gap-0 border rounded-md overflow-hidden h-[640px]">
        <div className="border-r bg-muted/20">
          <QuestionList />
        </div>
        <div className="overflow-hidden">
          <QuestionDetailView />
        </div>
      </div>
    </Card>
  );
}
