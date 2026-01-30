"use client";

import dynamic from "next/dynamic";

const VibeKanbanWebCompanion = dynamic(
  () =>
    import("vibe-kanban-web-companion").then(
      (mod) => mod.VibeKanbanWebCompanion
    ),
  { ssr: false }
);

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <VibeKanbanWebCompanion />
    </>
  );
}
