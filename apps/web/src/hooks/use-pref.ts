"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "niy-pref";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(EVENT, onChange); };
}

/** Where a choice goes when localStorage is unavailable (private mode): it holds until reload. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return memory.get(key) ?? null; }
}

/**
 * A UI choice kept in localStorage (one of `allowed`, else `fallback`). The server render and first paint use the fallback,
 * then the stored value; every component reading the same key follows a change.
 */
export function usePref<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (next: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => { const v = read(key); return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback; },
    () => fallback,
  );
  const set = useCallback((next: T) => {
    try { localStorage.setItem(key, next); } catch { memory.set(key, next); }
    window.dispatchEvent(new Event(EVENT));
  }, [key]);
  return [value, set];
}
