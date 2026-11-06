import type { ApiError } from "@/lib/api-client";
import { badOpsOf } from "./boards-api";
import { MAX_OPS, opTarget, type Op, type OpsResponse } from "./types";

/**
 * Autosave queue plus undo/redo history for one board.
 *
 * Writes: ops are coalesced per target, flushed 600 ms after the last change in batches of at most 500, and kept in
 * localStorage until the server acknowledges them (survives reload and offline). Network errors and 5xx retry with
 * backoff (1 s, 2 s, 5 s, then Offline and every 10 s); a 4xx is never retried: 422 drops the refused ops, 413 and the
 * other 4xx drop the batch, and the owner is told through onDropped so the board can reload from the server.
 *
 * History: record() stores the forward and inverse ops of one user action; undo()/redo() hand back the ops to apply
 * and enqueue. The history is in memory only.
 */

export type SaveStatus = "saved" | "saving" | "retrying" | "offline";
export type DropKind = "bad_ops" | "full" | "rejected" | "stale";

export interface QueueOptions {
  boardId: string;
  send: (boardId: string, ops: Op[], opts?: { keepalive?: boolean }) => Promise<OpsResponse>;
  onStatus?: (s: SaveStatus) => void;
  /** Ops the server refused or skipped. The caller reloads the board and tells the owner. */
  onDropped?: (kind: DropKind, ids: string[]) => void;
  /** Revision the server reported after a batch (for change detection). */
  onRevision?: (revision: number) => void;
  /** A successful batch: the server's new updated_at per written row (the next base_updated_at). */
  onWritten?: (updated: Record<string, string>) => void;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
  /** This tab's id (sessionStorage); tests pass their own. */
  tab?: string;
  debounceMs?: number;
  backoffMs?: number[];
}

interface Entry { forward: Op[]; inverse: Op[]; tag?: string }

/**
 * Each tab keeps its own pending queue (`niyyah-map-pending-<board>-<tab>`), so two tabs on one board never overwrite each other.
 * The tab id lives in sessionStorage (it survives a reload of that tab). A tab refreshes a heartbeat while its queue lives; on start a
 * queue adopts, and deletes, the pending ops of other tabs whose heartbeat is older than 30 s (a closed tab's unsent work).
 */
export const pendingPrefix = (boardId: string) => `niyyah-map-pending-${boardId}-`;
export const heartbeatKey = (tab: string) => `niyyah-map-hb-${tab}`;
const HEARTBEAT_MS = 10_000;
const DEAD_AFTER_MS = 30_000;

export function tabId(): string {
  try {
    let id = window.sessionStorage.getItem("niyyah-map-tab");
    if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); window.sessionStorage.setItem("niyyah-map-tab", id); }
    return id;
  } catch { return "solo"; }
}
const OFFLINE_RETRY_MS = 10_000;
const HISTORY = 200;
const KEEPALIVE_MAX = 60_000;

export class OpQueue {
  private pending = new Map<string, Op>();
  private inflight: Op[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | null = null;
  private failures = 0;
  private done: Entry[] = [];
  private undone: Entry[] = [];
  private status: SaveStatus = "saved";
  private disposed = false;
  private keepalive = false;
  private beat: ReturnType<typeof setInterval> | undefined;
  private readonly tab: string;
  private readonly debounce: number;
  private readonly backoff: number[];

  constructor(private readonly o: QueueOptions) {
    this.debounce = o.debounceMs ?? 600;
    this.backoff = o.backoffMs ?? [1000, 2000, 5000];
    this.tab = o.tab ?? tabId();
    this.restore();
    this.startHeartbeat();
    if (this.pending.size) { this.markBusy(); this.schedule(0); }
  }

  get size() { return this.pending.size + this.inflight.length; }
  get empty() { return this.size === 0; }
  get canUndo() { return this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }
  /** Pending ops (for re-applying over a freshly loaded board). */
  snapshot(): Op[] { return [...this.inflight, ...this.pending.values()]; }

  /** Queue ops for saving. Later ops on the same target replace earlier pending ones (keeping the first base_updated_at). */
  enqueue(ops: Op[]) {
    for (const op of ops) {
      const id = opTarget(op);
      const prev = this.pending.get(id);
      let next = op;
      // Coalesced ops keep the FIRST base_updated_at: it is what the client last saw from the server.
      if (prev) next = { ...op, base_updated_at: prev.base_updated_at } as Op;
      this.pending.delete(id); // keep Map order = last change last
      this.pending.set(id, next);
    }
    this.persist();
    this.markBusy();
    this.schedule(this.debounce);
  }

  record(forward: Op[], inverse: Op[], tag?: string) {
    if (!forward.length) return;
    this.done.push({ forward, inverse, tag });
    if (this.done.length > HISTORY) this.done.shift();
    this.undone = [];
  }

  /**
   * Fold ops into the newest history entry when it carries `tag` (a new thought and the text typed into it undo as one step).
   * Redo then replays the merged ops. False when the newest entry is something else.
   */
  amend(tag: string, ops: Op[]): boolean {
    const top = this.done.at(-1);
    if (!top || top.tag !== tag) return false;
    const merged = new Map<string, Op>();
    for (const op of [...top.forward, ...ops]) merged.set(opTarget(op), op);
    top.forward = [...merged.values()];
    return true;
  }

  /** Drop the newest history entry if it carries `tag` (an empty new thought that was never kept). */
  discard(tag: string): boolean {
    if (this.done.at(-1)?.tag !== tag) return false;
    this.done.pop();
    return true;
  }

  undo(): Op[] | null {
    const e = this.done.pop();
    if (!e) return null;
    this.undone.push(e);
    return e.inverse;
  }

  redo(): Op[] | null {
    const e = this.undone.pop();
    if (!e) return null;
    this.done.push(e);
    return e.forward;
  }

  /** Send everything now (skips the debounce). Resolves when the queue is empty or a failure stopped it. */
  flush(opts?: { keepalive?: boolean }): Promise<void> {
    if (opts?.keepalive) this.keepalive = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.flushing) return this.flushing;
    this.flushing = this.run().finally(() => { this.flushing = null; this.keepalive = false; });
    return this.flushing;
  }

  /** Resolves once nothing is pending or in flight (or the queue is offline and has stopped retrying quickly). */
  async idle() {
    while (!this.disposed && !this.empty && this.status !== "offline" && this.status !== "retrying") await this.flush();
  }

  /** Manual Retry button / `online` event. */
  retry() {
    this.failures = 0;
    this.schedule(0);
  }

  /** Drop every history entry (done and undone) that touches `id`: after a promote the node is a different kind of row, and replaying its old rows would overwrite it. */
  forget(id: string) {
    const touches = (e: Entry) => [...e.forward, ...e.inverse].some((op) => opTarget(op) === id);
    this.done = this.done.filter((e) => !touches(e));
    this.undone = this.undone.filter((e) => !touches(e));
  }

  dispose() {
    clearInterval(this.beat);
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private schedule(ms: number) {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private async run() {
    while (!this.disposed && this.pending.size) {
      const batch = [...this.pending.values()].slice(0, MAX_OPS);
      this.inflight = batch;
      for (const op of batch) this.pending.delete(opTarget(op));
      this.markBusy();
      try {
        // keepalive requests are capped at 64 KB by the browser: a bigger batch goes without it
        const keepalive = this.keepalive && JSON.stringify(batch).length < KEEPALIVE_MAX;
        const res = await this.o.send(this.o.boardId, batch, keepalive ? { keepalive } : undefined);
        this.inflight = [];
        this.failures = 0;
        if (this.status !== "saved") this.setStatus("saving");
        // Ops queued while this batch was in flight carry the base they were stamped with (before this write): move them to the new stamp.
        for (const [id, at] of Object.entries(res.updated ?? {})) {
          const op = this.pending.get(id);
          if (op && op.base_updated_at !== null) this.pending.set(id, { ...op, base_updated_at: at } as Op);
        }
        this.persist();
        this.o.onWritten?.(res.updated ?? {});
        this.o.onRevision?.(res.revision);
        if (res.bad_ops?.length) this.o.onDropped?.("bad_ops", res.bad_ops);
        if (res.stale_ops?.length) this.o.onDropped?.("stale", res.stale_ops);
      } catch (e) {
        const err = e as ApiError;
        const status = err.status;
        if (status !== undefined && status >= 400 && status < 500) {
          this.inflight = [];
          if (status === 422) {
            const bad = new Set(badOpsOf(err));
            const keep = bad.size ? batch.filter((op) => !bad.has(opTarget(op))) : [];
            for (const op of keep.reverse()) if (!this.pending.has(opTarget(op))) this.pending = new Map([[opTarget(op), op], ...this.pending]);
            this.persist();
            this.o.onDropped?.("bad_ops", bad.size ? [...bad] : batch.map(opTarget));
          } else {
            this.persist();
            this.o.onDropped?.(status === 413 ? "full" : "rejected", batch.map(opTarget));
          }
          continue; // the rest of the queue (if any) is independent of the dropped batch
        }
        // Network error or 5xx: put the batch back in front (newer pending ops on the same target win) and back off.
        const restored = new Map<string, Op>();
        for (const op of batch) restored.set(opTarget(op), op);
        for (const [id, op] of this.pending) restored.set(id, op);
        this.pending = restored;
        this.inflight = [];
        this.persist();
        const wait = this.backoff[this.failures] ?? null;
        this.failures += 1;
        if (wait === null) { this.setStatus("offline"); this.schedule(OFFLINE_RETRY_MS); } else { this.setStatus("retrying"); this.schedule(wait); }
        return;
      }
    }
    if (!this.pending.size && !this.inflight.length) this.setStatus("saved");
  }

  /** Saving, unless a failure banner (retrying/offline) is already showing: that stays until a write succeeds. */
  private markBusy() {
    if (this.status === "saved") this.setStatus("saving");
  }

  private setStatus(s: SaveStatus) {
    if (s === this.status) return;
    this.status = s;
    this.o.onStatus?.(s);
  }

  private ownKey() { return pendingPrefix(this.o.boardId) + this.tab; }

  private startHeartbeat() {
    const st = this.o.storage;
    if (!st) return;
    const beat = () => { try { st.setItem(heartbeatKey(this.tab), String(Date.now())); } catch { /* blocked */ } };
    beat();
    this.beat = setInterval(beat, HEARTBEAT_MS);
  }

  private persist() {
    const st = this.o.storage;
    if (!st) return;
    try {
      const all = this.snapshot();
      if (all.length) st.setItem(this.ownKey(), JSON.stringify(all));
      else st.removeItem(this.ownKey());
    } catch { /* storage full or blocked: the queue still works in memory */ }
  }

  /** This tab's own pending ops (it was reloaded), plus those of tabs that are gone. */
  private restore() {
    const st = this.o.storage;
    if (!st) return;
    const load = (key: string) => {
      try {
        const raw = st.getItem(key);
        if (!raw) return;
        for (const op of JSON.parse(raw) as Op[]) if (!this.pending.has(opTarget(op))) this.pending.set(opTarget(op), op);
      } catch { /* unreadable: dropped below */ }
    };
    load(this.ownKey());
    const prefix = pendingPrefix(this.o.boardId);
    const others: string[] = [];
    for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k && k.startsWith(prefix) && k !== this.ownKey()) others.push(k); }
    for (const k of others) {
      const beat = Number(st.getItem(heartbeatKey(k.slice(prefix.length))));
      if (beat && Date.now() - beat < DEAD_AFTER_MS) continue;   // that tab is alive and owns its queue
      load(k);
      st.removeItem(k);
      st.removeItem(heartbeatKey(k.slice(prefix.length)));
    }
    if (this.pending.size) this.persist();
  }
}
