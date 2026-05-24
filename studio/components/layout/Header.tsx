"use client";

import { usePathname } from "next/navigation";

const pageTitles: Record<string, { title: string }> = {
  "/": { title: "대시보드" },
  "/create": { title: "시험지 제작" },
  "/history": { title: "작업 히스토리" },
  "/settings": { title: "설정" },
};

export function Header() {
  const pathname = usePathname();
  const page = pageTitles[pathname] ?? { title: "Exam Studio" };

  return (
    <header className="mb-4">
      <h1 className="text-2xl font-semibold">{page.title}</h1>
    </header>
  );
}
