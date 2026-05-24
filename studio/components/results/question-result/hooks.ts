import { useEffect } from "react";
import { useJobStore } from "@/lib/store";

export function useSortedEntries() {
  const questionResults = useJobStore((s) => s.questionResults);
  return Object.values(questionResults).sort((a, b) => a.number - b.number);
}

export function useSelectedEntry() {
  const entries = useSortedEntries();
  const selectedNum = useJobStore((s) => s.selectedQuestionNumber);
  const setSelectedNum = useJobStore((s) => s.setSelectedQuestionNumber);

  // Auto-select first entry when entries become available or current selection disappears.
  useEffect(() => {
    if (entries.length === 0) {
      if (selectedNum !== null) setSelectedNum(null);
      return;
    }
    if (selectedNum == null || !entries.find((q) => q.number === selectedNum)) {
      setSelectedNum(entries[0].number);
    }
  }, [entries, selectedNum, setSelectedNum]);

  return { entries, selected: entries.find((q) => q.number === selectedNum) ?? entries[0] ?? null };
}
