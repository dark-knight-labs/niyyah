"use client";

import { useEffect, useRef } from "react";

/** Key -> action. A key is one character or name ("t", "[", "Escape"), "mod+b" (Cmd on a Mac, Ctrl elsewhere), or a two-key chord ("g o"). */
export type Hotkeys = Record<string, () => void>;

const CHORD_MS = 1000;

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest("[role=menu]"));
}

/**
 * Page-wide shortcuts. Plain keys and chords are ignored while typing; "mod+" keys work everywhere.
 * A matched key stops here (capture phase), so a page's own single-key handler never also sees the second key of a chord.
 */
export function useHotkeys(keys: Hotkeys) {
  const latest = useRef(keys);
  useEffect(() => { latest.current = keys; });

  useEffect(() => {
    let first: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => { first = null; clearTimeout(timer); };

    function onKey(e: KeyboardEvent) {
      const map = latest.current;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const run = (combo: string) => {
        const action = map[combo];
        if (!action) return false;
        e.preventDefault();
        e.stopImmediatePropagation();
        action();
        return true;
      };

      if ((e.metaKey || e.ctrlKey) && !e.altKey) { run(`mod+${key}`); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) { reset(); return; }

      if (first && run(`${first} ${key}`)) { reset(); return; }
      reset();
      if (run(key)) return;
      if (Object.keys(map).some((k) => k.startsWith(`${key} `))) {
        first = key;
        timer = setTimeout(reset, CHORD_MS);
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); reset(); };
  }, []);
}
