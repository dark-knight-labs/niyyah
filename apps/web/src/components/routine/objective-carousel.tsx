"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, ChevronLeft, ChevronRight, Pin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { QuarterData } from "@/lib/vault-types";

export interface ObjectiveChip {
  id: string;
  /** Small caps line: the block, or the goal's title. */
  label: string;
  title: string;
  /** CSS colour of the dot and the bar. */
  color: string;
  /** 0-100, or null when nothing measures it yet. */
  pct: number | null;
  href?: string;
  onOpen?: () => void;
  expanded?: boolean;
}

const PIN_KEY = "niyyah-pinned-objectives";
export const PIN_MAX = 3;

/** How much of the quarter has passed, 0-100; null when the quarter has no dates. */
export function quarterPace(q: QuarterData | null, now: Date): number | null {
  if (!q?.starts || !q.ends) return null;
  const start = Date.parse(`${q.starts}T00:00:00`);
  const end = Date.parse(`${q.ends}T00:00:00`) + 86_400_000;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return Math.round(Math.min(100, Math.max(0, (100 * (now.getTime() - start)) / (end - start))));
}

/** Which chips are pinned: remembered in this browser; until the owner picks, the first three. */
export function usePinned(ids: string[]) {
  const [saved, setSaved] = useState<string[] | null>(null);
  // Read after mount so the server and the first client render agree.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIN_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSaved(JSON.parse(raw) as string[]);
    } catch { /* default pins */ }
  }, []);
  const pinned = (saved ?? ids).filter((id) => ids.includes(id)).slice(0, PIN_MAX);
  const [full, setFull] = useState(false);
  function toggle(id: string) {
    const has = pinned.includes(id);
    if (!has && pinned.length >= PIN_MAX) { setFull(true); return; }
    setFull(false);
    const next = has ? pinned.filter((p) => p !== id) : [...pinned, id];
    setSaved(next);
    try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch { /* still pinned for this visit */ }
  }
  return { pinned, toggle, full };
}

function Pace({ pct, pace }: { pct: number; pace: number }) {
  const d = pct - pace;
  const [Icon, word, tone] = d >= 5 ? [ArrowUp, "Ahead", "text-[var(--accent)]"] : d >= -3 ? [ArrowRight, "On pace", "text-[var(--stream-indigo)]"] : [ArrowDown, "Behind", "text-[var(--destructive)]"];
  const n = `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}`;
  return (
    <span className={`inline-flex items-center gap-px font-mono font-medium normal-case tracking-normal ${tone}`} title={`${word}: ${n} points against an even pace`} role="img" aria-label={`${word}, ${n} points against an even pace`}>
      <Icon size={12} strokeWidth={2.25} aria-hidden="true" /><span className="tabular-nums">{n}</span>
    </span>
  );
}

/** One line: block name with its progress, then the title; the block's colour is the bar along the chip's bottom edge. */
function Body({ c, pace }: { c: ObjectiveChip; pace: number | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-left">
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-micro font-bold uppercase tracking-[0.07em] text-[var(--muted-foreground)]">
        <span className="max-w-[8rem] truncate">{c.label}</span>
        {c.pct !== null && <span className="font-mono font-medium normal-case tracking-normal tabular-nums">{c.pct}%</span>}
        {c.pct !== null && pace !== null && <Pace pct={c.pct} pace={pace} />}
      </span>
      <span className="max-w-[16rem] truncate text-small font-semibold">{c.title}</span>
    </span>
  );
}

const BODY = "block min-h-8 min-w-0 px-3 py-[5px] [@media(hover:none)]:pr-9 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]";

/** Pinned objectives first, then (unless `pinnedOnly`) the rest dashed; an arrow shows only on a side with more chips off screen. */
export function ObjectiveCarousel({ chips, pinned, onPin, pace, full, pinnedOnly = false }: { chips: ObjectiveChip[]; pinned: string[]; onPin: (id: string) => void; pace: number | null; full: boolean; pinnedOnly?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const raf = requestAnimationFrame(measure); // layout may not be ready inside the effect
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); el.removeEventListener("scroll", measure); };
  }, [measure, chips.length]);

  const ordered = [...chips.filter((c) => pinned.includes(c.id)), ...(pinnedOnly ? [] : chips.filter((c) => !pinned.includes(c.id)))];
  const fade = 44;
  const mask = edge.l || edge.r
    ? `linear-gradient(90deg, ${edge.l ? "transparent 0" : "#000 0"}, #000 ${edge.l ? fade : 0}px, #000 calc(100% - ${edge.r ? fade : 0}px), ${edge.r ? "transparent" : "#000"} 100%)`
    : undefined;
  const go = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: "smooth" });
  const arrow = "absolute top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] transition-opacity duration-300 hover:bg-[var(--muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

  return (
    <div className="min-w-0">
      <div className="group/car relative">
        <button type="button" onClick={() => go(-1)} aria-label="Scroll left" tabIndex={edge.l ? 0 : -1} className={`${arrow} left-0 ${edge.l ? "pointer-events-none opacity-0 focus-visible:opacity-100 group-hover/car:pointer-events-auto group-hover/car:opacity-100 [@media(hover:none)]:hidden" : "pointer-events-none opacity-0"}`}><ChevronLeft size={15} aria-hidden="true" /></button>
        <div ref={ref} role="group" aria-label="Quarter objectives" style={{ WebkitMaskImage: mask, maskImage: mask }}
          className="flex snap-x gap-2 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ordered.map((c) => {
            const on = pinned.includes(c.id);
            return (
              <div key={c.id} className={`group relative shrink-0 snap-start overflow-hidden rounded-lg border border-[var(--border)] ${on ? "bg-[var(--surface)]" : "border-dashed opacity-75"}`}>
                {c.href
                  ? <Link href={c.href} className={BODY}><Body c={c} pace={pace} /></Link>
                  : c.onOpen
                    ? <button type="button" onClick={c.onOpen} aria-expanded={!!c.expanded} className={`${BODY} w-full`}><Body c={c} pace={pace} /></button>
                    : <div className={BODY}><Body c={c} pace={pace} /></div>}
                {c.pct !== null && (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-[var(--muted)]" role="progressbar" aria-label={`${c.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.pct}>
                    <span className="absolute inset-y-0 left-0 transition-[width] duration-[350ms] ease-out" style={{ width: `${c.pct}%`, background: c.color }} />
                    {pace !== null && <span className="absolute inset-y-0 w-px bg-[var(--foreground)] opacity-60" style={{ left: `${pace}%` }} aria-hidden="true" />}
                  </span>
                )}
                <button type="button" onClick={() => onPin(c.id)} aria-pressed={on} aria-label={`${on ? "Unpin" : "Pin"} ${c.title}`} title={on ? "Unpin" : "Pin"}
                  className={`absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-[var(--surface)] transition-opacity hover:bg-[var(--muted)] focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 ${on ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]"}`}>
                  <Pin size={13} fill={on ? "currentColor" : "none"} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => go(1)} aria-label="Scroll right" tabIndex={edge.r ? 0 : -1} className={`${arrow} right-0 ${edge.r ? "pointer-events-none opacity-0 focus-visible:opacity-100 group-hover/car:pointer-events-auto group-hover/car:opacity-100 [@media(hover:none)]:hidden" : "pointer-events-none opacity-0"}`}><ChevronRight size={15} aria-hidden="true" /></button>
      </div>
      {full && <p role="status" className="mt-1 text-xs text-[var(--muted-foreground)]">Three are pinned already. Unpin one first.</p>}
    </div>
  );
}

/** Quarter objectives as chips: each stream's goal (progress from its checklist) and the goals set in Settings. */
export function objectiveChips(quarter: QuarterData | null, goals: { title: string; value: string; progress: number | null; checklist: unknown[] }[] | null, open: string | null, setOpen: (id: string | null) => void): ObjectiveChip[] {
  const streams = (quarter?.streams ?? []).filter((s) => s.goal.trim() && s.status !== "archived").map((s): ObjectiveChip => {
    const lines = s.goal_checklist;
    return {
      id: `stream:${s.stream}`, label: s.name, title: s.goal, color: `var(--stream-${s.color || "slate"})`,
      pct: lines.length ? Math.round((100 * lines.filter((l) => l.done).length) / lines.length) : null, href: `/plan?stream=${s.stream}`,
    };
  });
  const own = (goals ?? []).map((g): ObjectiveChip => ({
    id: `goal:${g.title}`, label: g.title, title: g.value, color: "var(--accent)", pct: g.progress,
    onOpen: g.checklist.length ? () => setOpen(open === g.title ? null : g.title) : undefined, expanded: open === g.title,
  }));
  return [...streams, ...own];
}
