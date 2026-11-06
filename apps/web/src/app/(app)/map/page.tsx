"use client";

import { Suspense, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { BoardCanvas } from "@/components/map/board-canvas";
import { useBoards } from "@/hooks/use-boards";
import { usePlanner } from "@/hooks/use-planner";

const LAST = "niyyah-map-last";

function MapRoot() {
  const params = useSearchParams();
  const router = useRouter();
  const { boards, error, create, remove, retitle } = useBoards();
  const plan = usePlanner();
  const want = params.get("board");
  const isNew = params.get("new") === "1";

  // ?board=<id> (or the alias "life"), else the one opened last, else the Life board, else the first.
  const current = boards && (
    boards.find((b) => b.id === want)
    ?? (want === "life" ? boards.find((b) => b.kind === "life") : undefined)
    ?? boards.find((b) => b.id === (typeof window !== "undefined" ? window.localStorage.getItem(LAST) : null))
    ?? boards.find((b) => b.kind === "life")
    ?? boards[0]
  );

  const open = useCallback((id: string, extra = "") => router.replace(`/map?board=${id}${extra}`), [router]);

  useEffect(() => {
    if (!current) return;
    try { window.localStorage.setItem(LAST, current.id); } catch { /* private mode */ }
    if (want !== current.id && want !== "life") router.replace(`/map?board=${current.id}`);
  }, [current, want, router]);

  const onNew = useCallback(async () => {
    const b = await create("Untitled board");
    open(b.id, "&new=1");
  }, [create, open]);

  const onDelete = useCallback(async (id: string) => {
    if (!window.confirm("Delete this board and everything on it?")) return;
    await remove(id);
    router.replace("/map?board=life");
  }, [remove, router]);

  if (error && !boards) return <div className="grid h-full place-items-center p-6 text-small text-[var(--muted-foreground)]" role="alert">{error}</div>;
  if (!boards || !current) return <div className="grid h-full place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" /></div>;

  return (
    <ReactFlowProvider key={current.id}>
      <BoardCanvas boardId={current.id} boards={boards} startNew={isNew} focusNode={params.get("node")} plan={plan}
        onOpen={(id) => open(id)} onNew={() => void onNew()} onRetitle={retitle} onDelete={(id) => void onDelete(id)} />
    </ReactFlowProvider>
  );
}

/** Full-bleed under the 44px top bar (and above the 48px mobile tab bar). */
export default function MapPage() {
  return (
    <div className="fixed inset-x-0 bottom-12 top-11 md:bottom-0">
      <Suspense fallback={null}><MapRoot /></Suspense>
    </div>
  );
}
