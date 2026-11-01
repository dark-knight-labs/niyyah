"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { byStart, placeTask, withFields, withOverlay } from "@/lib/items";
import { vaultApi } from "@/lib/vault-api";
import type { ItemCreate, ItemData, ItemFields, ItemPatch, OverlayData } from "@/lib/vault-types";

/** Quiet time after the last edit before the range is read again: a run of quick edits costs one calendar read. */
const SETTLE_MS = 700;

type Change = (list: ItemData[]) => ItemData[];

/**
 * Own items and calendar events for `days` (one read of GET /vault/items), merged per day.
 *
 * An edit shows at once, then settles on what the server answers (PATCH / PUT / POST return the written item), and the range
 * is read again in the background. The read goes out to every calendar and is slow, so no edit waits on it, and a read that
 * started before an edit (or ends while one is in flight) is dropped rather than undoing what was just shown.
 */
export function useItems(days: string[], refreshKey: number) {
  const [items, setItems] = useState<ItemData[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [orphans, setOrphans] = useState<OverlayData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  const generation = useRef(0);
  const pending = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = days[0];
  const last = days[days.length - 1];

  useEffect(() => {
    if (!first || !last) return;
    let live = true;
    const started = generation.current;
    vaultApi.items(first, last).then((res) => {
      if (!live || started !== generation.current || pending.current > 0) return;
      setItems(res.items);
      setErrors(res.errors);
      setOrphans(res.orphans);
      setLoaded(true);
    }).catch(() => {
      if (live) setErrors(["Calendar: could not load"]);
    });
    return () => { live = false; };
  }, [first, last, refreshKey, reads]);

  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);

  /** Read the range again once edits have gone quiet. */
  const refetch = useCallback(() => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => setReads((n) => n + 1), SETTLE_MS);
  }, []);

  /** Show `local` now, send `request`, apply what it answers; on failure say so and let the read put things right. */
  const run = useCallback(async (local: Change | null, request: () => Promise<Change>): Promise<boolean> => {
    generation.current += 1;
    pending.current += 1;
    setProblem(null);
    if (local) setItems(local);
    try {
      const answer = await request();
      setItems(answer);
      return true;
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save");
      return false;
    } finally {
      pending.current -= 1;
      generation.current += 1;
      refetch();
    }
  }, [refetch]);

  /** Every showing of own item `id`, replaced by `task` placed on the days it now falls on. */
  const replaceTask = useCallback((id: number, task: ItemData | null): Change => (list) => [
    ...list.filter((i) => !(i.kind === "task" && i.id === id)), ...(task ? placeTask(task, days) : []),
  ], [days]);

  /** The item's full record, from the showing that carries its time (its scheduled day) when there is one. */
  const template = useCallback((item: ItemData) => {
    const all = items.filter((i) => i.kind === "task" && i.id === item.id);
    return all.find((i) => i.day === i.scheduled_on) ?? all[0] ?? item;
  }, [items]);

  const byDay = useMemo(() => {
    const out: Record<string, ItemData[]> = Object.fromEntries(days.map((d) => [d, []]));
    for (const i of items) if (i.day && out[i.day]) out[i.day].push(i);
    for (const d of days) out[d].sort(byStart);
    return out;
  }, [items, days]);

  return {
    byDay, errors, orphans, loaded, problem, setProblem, refetch,

    /** Add an own item; it shows once the server has it (a local write, fast). */
    create: (input: ItemCreate) => run(null, async () => {
      const made = await vaultApi.addItem(input);
      return replaceTask(made.id as number, made);
    }),

    /** Change an own item. A new day or time moves it on the grid at once. */
    patch: (item: ItemData, change: ItemPatch) => {
      const id = item.id as number;
      const base = template(item);
      const { day, start_min, end_min, text, ...fields } = change;
      const next = withFields(base, fields as ItemFields);
      if (text !== undefined) next.title = text;
      if (day !== undefined) next.scheduled_on = day;
      if (start_min !== undefined || end_min !== undefined) { next.start_min = start_min ?? null; next.end_min = end_min ?? null; }
      else if (day !== undefined || base.day !== base.scheduled_on) { next.start_min = base.day === base.scheduled_on ? base.start_min : null; next.end_min = base.day === base.scheduled_on ? base.end_min : null; }
      return run(replaceTask(id, next), async () => replaceTask(id, await vaultApi.patchItem(id, change)));
    },

    /** Move an own item off `from` to `to`, as a task drag always has (its dates on `from` follow; with none there it is scheduled on `to`). */
    move: (item: ItemData, from: string, to: string) => {
      const id = item.id as number;
      const base = template(item);
      const next = { ...base };
      let moved = false;
      for (const f of ["due_on", "scheduled_on", "start_on"] as const) if (next[f] === from) { next[f] = to; moved = true; }
      if (!moved) next.scheduled_on = to;
      const local = replaceTask(id, next);
      return run(local, async () => { await vaultApi.moveItem(id, from, to); return local; });
    },

    /** Annotate a calendar event: status, weight, stream, tags, notes, sub-tasks. Its title, calendar and day go along so the first write can file it. */
    annotate: (item: ItemData, fields: ItemFields) => {
      const same = (i: ItemData) => i.kind === "event" && i.key === item.key;
      return run(
        (list) => list.map((i) => (same(i) ? withFields(i, fields) : i)),
        async () => {
          const o = await vaultApi.annotate({ key: item.key as string, title: item.title, calendar: item.calendar ?? undefined, day: item.day ?? undefined, ...fields });
          return (list) => list.map((i) => (same(i) ? withOverlay(i, o) : i));
        },
      );
    },

    remove: (item: ItemData) => {
      const id = item.id as number;
      const local = replaceTask(id, null);
      return run(local, async () => { await vaultApi.removeItem(id); return local; });
    },
  };
}
export type Items = ReturnType<typeof useItems>;
