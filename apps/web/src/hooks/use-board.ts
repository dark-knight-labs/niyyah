"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boardsApi } from "@/lib/map/boards-api";
import { OpQueue, type DropKind, type SaveStatus } from "@/lib/map/ops";
import { applyOps, dataFrom, emptyData, stampAndInvert, type BoardData } from "@/lib/map/state";
import { childIndex } from "@/lib/map/tree";
import { MAX_NODES, MAX_EDGES, type Board, type BoardNode, type Op, type Viewport } from "@/lib/map/types";

const WATCH_MS = 30_000;
const VIEWPORT_MS = 2000;

const DROP_MESSAGE: Record<DropKind, string> = {
  bad_ops: "Some changes were dropped: their branch was deleted in another tab",
  full: "Board is full (5,000 items)",
  rejected: "Some changes could not be saved and were dropped",
  stale: "Kept newer changes from another device",
};

export interface UseBoard {
  board: Board | null;
  data: BoardData;
  idx: ReturnType<typeof childIndex>;
  loading: boolean;
  error: string | null;
  status: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  /** Apply ops locally, record them for undo and queue them for saving. False when the board limits block them. */
  commit: (ops: Op[], tag?: string) => boolean;
  /** Fold ops into the history entry tagged `tag` (one undo step); falls back to a normal commit when it is not on top. */
  amend: (tag: string, ops: Op[]) => boolean;
  /** Remove a tagged new thought that was left empty: undoes its entry and deletes it without leaving a redo. */
  discard: (tag: string, ops: Op[]) => void;
  undo: () => void;
  redo: () => void;
  /** Send everything queued now (promote needs the thought to exist on the server first). */
  flush: () => Promise<void>;
  /** Forget every undo/redo entry that touches a node (after Make item: its old rows must never be replayed). */
  forgetHistory: (id: string) => void;
  /** Take a row the server returned (promote) as the truth for that node. */
  adoptNode: (node: BoardNode, revision: number) => void;
  retry: () => void;
  rename: (title: string) => Promise<void>;
  saveViewport: (vp: Viewport) => void;
  reload: () => Promise<void>;
}

/**
 * One board's data, edits and autosave. Edits apply locally at once (rows replaced, never mutated), go through the OpQueue
 * (debounced, retried, persisted in localStorage) and are recorded for undo. The board reloads from the server when another
 * tab or device moved its revision (checked on focus and every 30 s while visible with an empty queue) and after dropped ops.
 */
export function useBoard(boardId: string, notify: (message: string) => void): UseBoard {
  const [board, setBoard] = useState<Board | null>(null);
  const [data, setData] = useState<BoardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [hist, setHist] = useState({ undo: false, redo: false });
  const dataRef = useRef<BoardData>(data);
  const queueRef = useRef<OpQueue | null>(null);
  const revision = useRef(0);
  const notifyRef = useRef(notify);
  const vpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadSeq = useRef(0);

  useEffect(() => { notifyRef.current = notify; });

  /**
   * Our own write moved the server revision by exactly one: follow it. A bigger jump means someone else wrote in between, so
   * keep the older number and let the next check see the difference and reload.
   */
  const adopt = useCallback((r: number) => { if (r === revision.current + 1) revision.current = r; }, []);

  const setBoth = useCallback((next: BoardData) => { dataRef.current = next; setData(next); }, []);

  const load = useCallback(async (id: string, fresh: boolean) => {
    const seq = ++loadSeq.current;
    try {
      const detail = await boardsApi.get(id);
      if (seq !== loadSeq.current) return;
      const { nodes, edges, ...b } = detail;
      revision.current = b.revision;
      setBoard(b);
      // Pending ops restored from a previous session sit on top of what the server has.
      const pending = fresh ? [] : (queueRef.current?.snapshot() ?? []);
      setBoth(applyOps(dataFrom(nodes, edges), pending));
      setError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Could not load the board");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [setBoth]);

  // Open a board: build its queue (which restores unsent ops from localStorage), then load.
  useEffect(() => {
    let live = true;
    setLoading(true);
    setBoard(null);
    setBoth(emptyData());
    setStatus("saved");
    const q = new OpQueue({
      boardId,
      send: (id, ops, o) => boardsApi.ops(id, { ops }, o),
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      onStatus: (s) => { if (live) setStatus(s); },
      onRevision: (r) => adopt(r),
      onWritten: (updated) => {
        if (!live) return;
        // The server stamped these rows: that stamp is the base for our next write to them.
        const cur = dataRef.current;
        const nodes = new Map(cur.nodes);
        const edges = new Map(cur.edges);
        let changed = false;
        for (const [id, at] of Object.entries(updated)) {
          const n = nodes.get(id);
          if (n) { nodes.set(id, { ...n, updated_at: at }); changed = true; continue; }
          const e = edges.get(id);
          if (e) { edges.set(id, { ...e, updated_at: at }); changed = true; }
        }
        if (changed) setBoth({ nodes, edges });
      },
      onDropped: (kind) => {
        if (!live) return;
        notifyRef.current(DROP_MESSAGE[kind]);
        void q.idle().then(() => { if (live && q.empty) void load(boardId, true); });
      },
    });
    queueRef.current = q;
    void load(boardId, false);
    return () => {
      live = false;
      clearTimeout(vpTimer.current);
      void q.flush({ keepalive: true }).finally(() => q.dispose());
    };
  }, [boardId, load, setBoth, adopt]);

  // Change detection: another tab or device moved the revision while our queue is empty.
  useEffect(() => {
    let busy = false;
    const check = async () => {
      const q = queueRef.current;
      if (busy || document.visibilityState !== "visible" || !q?.empty) return;
      busy = true;
      try {
        const mine = (await boardsApi.list()).find((b) => b.id === boardId);
        if (mine && mine.revision > revision.current && q.empty) await load(boardId, true);
      } catch { /* offline: the next tick tries again */ } finally { busy = false; }
    };
    const timer = setInterval(() => void check(), WATCH_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [boardId, load]);

  // Flush on tab hide / close so a quick edit is not left only in localStorage.
  useEffect(() => {
    const flush = () => { void queueRef.current?.flush({ keepalive: true }); };
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    const online = () => queueRef.current?.retry();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("online", online);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("online", online); };
  }, []);

  const commit = useCallback((ops: Op[], tag?: string) => {
    const q = queueRef.current;
    if (!q || !ops.length) return false;
    const cur = dataRef.current;
    const next = applyOps(cur, ops);
    if (next.nodes.size > Math.max(MAX_NODES, cur.nodes.size) || next.edges.size > Math.max(MAX_EDGES, cur.edges.size)) {
      notifyRef.current("Board is full (5,000 items)");
      return false;
    }
    const { ops: stamped, inverse } = stampAndInvert(cur, ops);
    setBoth(applyOps(cur, stamped));
    q.record(stamped, inverse, tag);
    q.enqueue(stamped);
    setHist({ undo: q.canUndo, redo: q.canRedo });
    return true;
  }, [setBoth]);

  const amend = useCallback((tag: string, ops: Op[]) => {
    const q = queueRef.current;
    if (!q || !ops.length) return false;
    const { ops: stamped } = stampAndInvert(dataRef.current, ops);
    if (!q.amend(tag, stamped)) return commit(ops);
    setBoth(applyOps(dataRef.current, stamped));
    q.enqueue(stamped);
    setHist({ undo: q.canUndo, redo: q.canRedo });
    return true;
  }, [commit, setBoth]);

  const discard = useCallback((tag: string, ops: Op[]) => {
    const q = queueRef.current;
    if (!q) return;
    const { ops: stamped } = stampAndInvert(dataRef.current, ops);
    q.discard(tag);
    setBoth(applyOps(dataRef.current, stamped));
    q.enqueue(stamped);
    setHist({ undo: q.canUndo, redo: q.canRedo });
  }, [setBoth]);

  const replay = useCallback((ops: Op[] | null) => {
    const q = queueRef.current;
    if (!q || !ops) return;
    const { ops: stamped } = stampAndInvert(dataRef.current, ops);
    setBoth(applyOps(dataRef.current, stamped));
    q.enqueue(stamped);
    setHist({ undo: q.canUndo, redo: q.canRedo });
  }, [setBoth]);

  const undo = useCallback(() => replay(queueRef.current?.undo() ?? null), [replay]);
  const redo = useCallback(() => replay(queueRef.current?.redo() ?? null), [replay]);
  const forgetHistory = useCallback((id: string) => {
    const q = queueRef.current;
    if (!q) return;
    q.forget(id);
    setHist({ undo: q.canUndo, redo: q.canRedo });
  }, []);
  const flush = useCallback(async () => { await queueRef.current?.flush(); }, []);
  const adoptNode = useCallback((node: BoardNode, rev: number) => {
    const cur = dataRef.current;
    const nodes = new Map(cur.nodes);
    nodes.set(node.id, { ...node, x: node.x ?? 0, y: node.y ?? 0, w: node.w ?? 0, h: node.h ?? 0, notes: node.notes ?? "" });
    setBoth({ ...cur, nodes });
    adopt(rev);
  }, [setBoth, adopt]);
  const retry = useCallback(() => queueRef.current?.retry(), []);

  const rename = useCallback(async (title: string) => {
    const b = await boardsApi.patch(boardId, { title });
    adopt(b.revision); // a title change bumps the revision by one
    setBoard((cur) => (cur ? { ...cur, title: b.title } : cur));
  }, [boardId, adopt]);

  const saveViewport = useCallback((vp: Viewport) => {
    clearTimeout(vpTimer.current);
    vpTimer.current = setTimeout(() => {
      boardsApi.patch(boardId, { viewport: vp }).then(() => { /* a viewport-only PATCH does not bump the revision */ }).catch(() => { /* the view is not worth a banner */ });
    }, VIEWPORT_MS);
  }, [boardId]);

  const reload = useCallback(() => load(boardId, true), [boardId, load]);
  const idx = useMemo(() => childIndex(data.nodes), [data.nodes]);

  return { board, data, idx, loading, error, status, canUndo: hist.undo, canRedo: hist.redo, commit, amend, discard, undo, redo, flush, forgetHistory, adoptNode, retry, rename, saveViewport, reload };
}
