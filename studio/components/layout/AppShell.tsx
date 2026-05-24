"use client";

import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { Heartbeat } from "@/components/shared/Heartbeat";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Heartbeat />
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <Header />
        {children}
      </main>
    </div>
  );
}
