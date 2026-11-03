import { useSyncExternalStore } from "react";
import type { TrayRow } from "@/lib/plan-bridge";

/** The tray row being dragged, shared with the calendar views that take the drop (a tiny store: dataTransfer is unreadable during dragover). */
let current: TrayRow | null = null;
const listeners = new Set<() => void>();

export const trayDrag = {
  get: () => current,
  set(row: TrayRow | null) { current = row; listeners.forEach((l) => l()); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

/** The tray row being dragged now, or null. */
export const useTrayDrag = () => useSyncExternalStore(trayDrag.subscribe, trayDrag.get, () => null);

/** Called by a view when a tray row is dropped on a day (all day) or a time slot. */
export type PlanDrop = (row: TrayRow, day: string, start?: number, end?: number) => void;
