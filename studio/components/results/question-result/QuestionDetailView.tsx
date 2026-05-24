"use client";

import { useSelectedEntry } from "./hooks";
import { QuestionDetail } from "./QuestionDetail";

/** 우측 detail: 현재 선택된 문제만. 페이지에서 단독 마운트 가능. */
export function QuestionDetailView() {
  const { selected } = useSelectedEntry();
  if (!selected) {
    return (
      <div className="p-4 text-xs text-muted-foreground">왼쪽에서 문제를 선택하세요</div>
    );
  }
  return <QuestionDetail qr={selected} />;
}
