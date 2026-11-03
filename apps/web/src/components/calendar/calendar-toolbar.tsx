"use client";

import { ChevronDown, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, TriangleAlert } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { RING_INFO, RING_VARIANTS, RingVariant, SHADE_LABEL, SHADE_MODES, ShadeMode, ViewId, viewName, VIEWS } from "@/lib/calendar";
import { vaultApi } from "@/lib/vault-api";
import { fmtDay } from "@/lib/week";
import { MICRO } from "@/components/calendar/item-bits";

export const CHIP = "inline-flex min-h-8 items-center whitespace-nowrap border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)] disabled:opacity-40";
const SMALL = `${CHIP} min-h-7 px-2 text-[11px]`;

/** "18–24 Oct", or "28 Oct – 3 Nov" across two months. */
export function rangeLabel(first: string, last: string): string {
  const month = (d: string) => fmtDay(d, { month: "short" });
  const day = (d: string) => fmtDay(d, { day: "numeric" });
  return month(first) === month(last) ? `${day(first)}–${day(last)} ${month(last)}` : `${day(first)} ${month(first)} – ${day(last)} ${month(last)}`;
}

/** A button that opens a small panel under it; a click outside or Escape closes it. */
function Menu({ label, summary, name, children, align = "left" }: { label: ReactNode; summary?: string; name: string; children: ReactNode | ((close: () => void) => ReactNode); align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true" aria-label={summary ? `${name}: ${summary}` : name} className={`${CHIP} gap-1`}>
        {label}<ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div role="group" aria-label={name} className={`absolute top-full z-40 mt-1 grid min-w-[12rem] gap-2.5 border border-[var(--border)] bg-[var(--background)] p-2.5 shadow-[0_8px_24px_rgb(0_0_0/0.15)] ${align === "right" ? "right-0" : "left-0"}`}>
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1" role="group" aria-label={title}>
      <span className={MICRO}>{title}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

export interface CalendarBarProps {
  sidebar: boolean; onSidebar: () => void;
  scope: "day" | "week"; onScope: (s: "day" | "week") => void;
  view: ViewId; onView: (v: ViewId) => void;
  onStep: (n: number) => void; onToday: () => void; atToday: boolean;
  range: string; rangeLong: string;
  tags: [string, number][]; tag: string | null; onTag: (t: string | null) => void;
  showDone: boolean; onShowDone: (v: boolean) => void; doneCount: number;
  variant: RingVariant; onVariant: (v: RingVariant) => void; showsRing: boolean;
  shade: ShadeMode; onShade: (m: ShadeMode) => void;
  errors: string[];
  quickAdd: ReactNode;
}

/** The one row above the grid: rail toggle, prev / next / Today, the range, Day | Week, Style, quick add, tags, display, and a calendar-problems chip. Wraps to two rows on a phone. */
export function CalendarBar(p: CalendarBarProps) {
  const [problems, setProblems] = useState(false);
  const expired = p.errors.some((e) => e.includes("Reconnect"));
  const views = VIEWS.filter((v) => v.scope === p.scope);
  return (
    <div role="toolbar" aria-label="Calendar" data-cal-bar className="relative mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[var(--border)] pb-2">
      <button type="button" onClick={p.onSidebar} aria-pressed={p.sidebar} aria-keyshortcuts="Control+B Meta+B" aria-label={p.sidebar ? "Hide the sidebar" : "Show the sidebar"} title={`${p.sidebar ? "Hide" : "Show"} the sidebar (⌘B)`} className={`${CHIP} px-1.5`}>
        {p.sidebar ? <PanelLeftClose size={15} aria-hidden="true" /> : <PanelLeftOpen size={15} aria-hidden="true" />}
      </button>
      <span className="inline-flex shrink-0" role="group" aria-label="Move">
        <button type="button" onClick={() => p.onStep(-1)} aria-label={p.scope === "day" ? "Previous day" : "Previous week"} aria-keyshortcuts="[" className={`${CHIP} px-1.5`}><ChevronLeft size={15} aria-hidden="true" /></button>
        <button type="button" onClick={() => p.onStep(1)} aria-label={p.scope === "day" ? "Next day" : "Next week"} aria-keyshortcuts="]" className={`${CHIP} border-l-0 px-1.5`}><ChevronRight size={15} aria-hidden="true" /></button>
      </span>
      <button type="button" onClick={p.onToday} disabled={p.atToday} aria-keyshortcuts="t" title="Back to today (t)" className={CHIP}>Today</button>
      <h2 className="shrink-0 font-serif text-[17px] font-medium leading-none" aria-label={p.rangeLong} data-cal-range>{p.range}</h2>
      <span className="inline-flex shrink-0" role="group" aria-label="Scope">
        {(["day", "week"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={p.scope === s} onClick={() => p.scope !== s && p.onScope(s)} className={`${CHIP} ${s === "week" ? "border-l-0" : ""}`}>{s === "day" ? "Day" : "Week"}</button>
        ))}
      </span>
      <Menu name="Style" summary={viewName(p.view)} label={<>Style <span className="font-normal opacity-70">{VIEWS.find((v) => v.id === p.view)!.label}</span></>}>
        {(close) => <>
        <Section title={p.scope === "day" ? "Day views" : "Week views"}>
          {views.map((v) => <button key={v.id} type="button" aria-pressed={p.view === v.id} aria-label={viewName(v.id)} data-view-button={v.id} onClick={() => { p.onView(v.id); close(); }} className={SMALL}>{v.label}</button>)}
        </Section>
        <p className="text-micro text-[var(--muted-foreground)]">V next style, Shift+V previous, all nine.</p>
        </>}
      </Menu>
      {p.quickAdd}
      {p.tags.length > 0 || p.tag ? (
        <Menu name="Tags" summary={p.tag ? `#${p.tag}` : "all"} label={p.tag ? `#${p.tag}` : "Tags"} align="right">
          <Section title="Filter by tag">
            <button type="button" aria-pressed={!p.tag} onClick={() => p.onTag(null)} className={SMALL}>All</button>
            {(p.tag && !p.tags.some(([t]) => t === p.tag) ? [...p.tags, [p.tag, 0] as [string, number]] : p.tags).map(([t, n]) => (
              <button key={t} type="button" aria-pressed={p.tag === t} data-tag-filter={t} onClick={() => p.onTag(p.tag === t ? null : t)} aria-label={`#${t}, ${n} item${n === 1 ? "" : "s"}`} className={`${SMALL} font-mono`}>#{t} <span className="ml-1 opacity-70">{n}</span></button>
            ))}
          </Section>
        </Menu>
      ) : null}
      <Menu name="Display" label="Display" align="right">
        {p.view === "week-grid" && (
          <Section title="Done tasks">
            <button type="button" onClick={() => p.onShowDone(!p.showDone)} aria-pressed={p.showDone} aria-keyshortcuts="d" title={`${p.showDone ? "Hide" : "Show"} done tasks (d)`} className={`${SMALL} gap-1.5`}>
              Show done <span className="font-mono tabular-nums">{p.doneCount}</span>
            </button>
          </Section>
        )}
        {p.view !== "week-grid" && (
          <Section title="Block colours">
            {SHADE_MODES.map((m) => <button key={m} type="button" aria-pressed={p.shade === m} onClick={() => p.onShade(m)} className={SMALL}>{SHADE_LABEL[m]}</button>)}
          </Section>
        )}
        {p.showsRing && (
          <Section title="Ring lanes">
            {RING_VARIANTS.map((v) => (
              <button key={v} type="button" aria-pressed={p.variant === v} onClick={() => p.onVariant(v)} title={`${RING_INFO[v][0]}: ${RING_INFO[v][1]}`} aria-label={`Ring lanes: ${RING_INFO[v][0]}`} className={SMALL}>{v === "base" ? "Today" : v}</button>
            ))}
          </Section>
        )}
      </Menu>
      {p.errors.length > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => setProblems(!problems)} aria-expanded={problems} className={`${CHIP} gap-1.5 border-[var(--destructive)] text-[var(--destructive)]`} title={p.errors.join("\n")}>
            <TriangleAlert size={13} aria-hidden="true" />Calendar: {p.errors.length} problem{p.errors.length === 1 ? "" : "s"}
          </button>
          {expired && (
            <button type="button" onClick={onReconnect} className={`${CHIP} border-[var(--destructive)]`}>Reconnect</button>
          )}
        </span>
      )}
      {problems && p.errors.length > 0 && (
        <ul role="alert" className="absolute right-0 top-full z-40 mt-1 grid max-w-[28rem] gap-1 border border-[var(--destructive)] bg-[var(--background)] p-2.5 text-xs text-[var(--destructive)] shadow-[0_8px_24px_rgb(0_0_0/0.15)]">
          {p.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}

function onReconnect() {
  void vaultApi.googleConnect().then((r) => window.location.assign(r.url)).catch(() => {});
}
