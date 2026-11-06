"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Ellipsis, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RING_INFO, RING_VARIANTS, RingVariant, SHADE_LABEL, SHADE_MODES, ShadeMode, ViewId, viewName, VIEWS } from "@/lib/calendar";
import { vaultApi } from "@/lib/vault-api";
import type { GoogleStatusData } from "@/lib/vault-types";
import { fmtDay } from "@/lib/week";
import { MICRO } from "@/components/calendar/item-bits";

export const CHIP = "inline-flex min-h-8 items-center whitespace-nowrap border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)] disabled:opacity-40";
const SMALL = `${CHIP} min-h-7 px-2 text-[11px]`;
/** A borderless icon button (the sidebar toggle): it is an action, not a mode, so it never shows a pressed fill. */
const ICON = "inline-grid h-8 min-w-8 shrink-0 place-items-center px-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]";
const PANEL = "absolute top-full z-40 mt-1 grid min-w-[12rem] gap-2.5 border border-[var(--border)] bg-[var(--background)] p-2.5 shadow-[0_8px_24px_rgb(0_0_0/0.15)]";

/** "18–24 Oct", or "28 Oct – 3 Nov" across two months. */
export function rangeLabel(first: string, last: string): string {
  const month = (d: string) => fmtDay(d, { month: "short" });
  const day = (d: string) => fmtDay(d, { day: "numeric" });
  return month(first) === month(last) ? `${day(first)}–${day(last)} ${month(last)}` : `${day(first)} ${month(first)} – ${day(last)} ${month(last)}`;
}

/** A button that opens a small panel under it, kept inside the window (the bar wraps on a phone); a click outside or Escape closes it. */
function Menu({ label, summary, name, children, align = "left", className = `${CHIP} gap-1`, chevron = true }: {
  label: ReactNode; summary?: string; name: string; children: ReactNode | ((close: () => void) => ReactNode); align?: "left" | "right"; className?: string; chevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const r = panel.current.getBoundingClientRect();
    const right = Math.min(0, window.innerWidth - 8 - r.right);
    setShift(r.left + right < 8 ? 8 - r.left : right);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away);
    // On window, capture phase: ahead of the page hotkeys (document, capture), whose Escape would otherwise swallow it.
    window.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => { setShift(0); setOpen(!open); }} aria-expanded={open} aria-haspopup="true" aria-label={summary ? `${name}: ${summary}` : name} className={className}>
        {label}{chevron && <ChevronDown size={12} aria-hidden="true" />}
      </button>
      {open && (
        <div ref={panel} role="group" aria-label={name} style={shift ? { transform: `translateX(${shift}px)` } : undefined} className={`${PANEL} ${align === "right" ? "right-0" : "left-0"}`}>
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

/**
 * The calendar's state in one quiet control, shown only when something needs the owner: problems reading a calendar (with
 * Reconnect when consent expired), or Google Calendar not connected / not set up on the server. Problems are errors (red);
 * the other two are setup, not failures (amber dot).
 */
function CalendarStatus({ errors, google, compact }: { errors: string[]; google: GoogleStatusData | null; compact: boolean }) {
  const [connectError, setConnectError] = useState<string | null>(null);
  const expired = errors.some((e) => e.includes("Reconnect"));
  const notConnected = !!google?.configured && !google.connected;
  const notSetUp = !!google && !google.configured;
  if (!errors.length && !notConnected && !notSetUp) return null;

  async function connect() {
    setConnectError(null);
    try { window.location.assign((await vaultApi.googleConnect()).url); } catch (err) { setConnectError(err instanceof Error ? err.message : "Could not start the Google sign-in."); }
  }
  const connectButton = (text: string) => (
    <button type="button" onClick={connect} className={`${CHIP} justify-self-start border-[var(--foreground)] text-[var(--foreground)]`}>{text}</button>
  );

  if (errors.length) {
    const summary = `${errors.length} problem${errors.length === 1 ? "" : "s"}`;
    return (
      <Menu name="Calendar" summary={summary} align="right" chevron={false}
        className="inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--muted)]"
        label={<><span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--destructive)]" />{compact ? <>Calendar <span className="font-mono tabular-nums">{errors.length}</span></> : `Calendar: ${summary}`}</>}>
        <div className="grid w-[min(28rem,80vw)] gap-2 text-xs">
          <ul role="alert" className="grid gap-1 text-[var(--destructive)]">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          {expired && connectButton("Reconnect")}
          {connectError && <p role="alert" className="text-[var(--destructive)]">{connectError}</p>}
        </div>
      </Menu>
    );
  }
  const summary = notConnected ? "not connected" : "not set up";
  return (
    <Menu name="Calendar" summary={summary} align="right" chevron={false}
      className="inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-xs font-semibold text-[var(--warn)] hover:bg-[var(--warn-light)]"
      label={<><span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--warn)]" />Calendar</>}>
      <div className="grid w-[min(20rem,80vw)] gap-2 text-xs text-[var(--foreground)]">
        {notConnected
          ? <><p>Google Calendar is not connected. Connect it to see your events here and to add events from quick add.</p>{connectButton("Connect Google Calendar")}</>
          : <p>Google Calendar is not set up on the server yet. Events from Google show here once it is.</p>}
        {connectError && <p role="alert" className="text-[var(--destructive)]">{connectError}</p>}
      </div>
    </Menu>
  );
}

export interface CalendarBarProps {
  /** "header": one row inside the app header (wide screens); "page": its own wrapping row above the calendar. */
  placement: "header" | "page";
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
  google: GoogleStatusData | null;
  quickAdd: ReactNode;
  /** Shown after the range (the day's mode and stars while the sidebar, their usual place, is hidden). */
  extra?: ReactNode;
}

/**
 * The one calendar row: sidebar toggle, ‹ › and the range (Today only when away from today), then quick add, Day | Week,
 * one View options menu (style, tag filter, display) and the calendar status. In the header on wide screens; wraps on a phone.
 */
export function CalendarBar(p: CalendarBarProps) {
  const header = p.placement === "header";
  const views = VIEWS.filter((v) => v.scope === p.scope);
  const hasTags = p.tags.length > 0 || !!p.tag;
  return (
    <div role="toolbar" aria-label="Calendar" data-cal-bar={p.placement}
      className={header
        ? "flex h-full min-w-0 flex-1 items-center gap-1.5 border-l border-[var(--border)] pl-1.5 pr-2"
        : "relative mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[var(--border)] pb-2"}>
      <button type="button" onClick={p.onSidebar} aria-pressed={p.sidebar} aria-keyshortcuts="Control+B Meta+B" aria-label={p.sidebar ? "Hide the sidebar" : "Show the sidebar"} title={`${p.sidebar ? "Hide" : "Show"} the sidebar (⌘B)`} className={ICON}>
        {p.sidebar ? <PanelLeftClose size={15} aria-hidden="true" /> : <PanelLeftOpen size={15} aria-hidden="true" />}
      </button>
      <span className="inline-flex shrink-0" role="group" aria-label="Move">
        <button type="button" onClick={() => p.onStep(-1)} aria-label={p.scope === "day" ? "Previous day" : "Previous week"} aria-keyshortcuts="[" className={`${CHIP} px-1.5`}><ChevronLeft size={15} aria-hidden="true" /></button>
        <button type="button" onClick={() => p.onStep(1)} aria-label={p.scope === "day" ? "Next day" : "Next week"} aria-keyshortcuts="]" className={`${CHIP} border-l-0 px-1.5`}><ChevronRight size={15} aria-hidden="true" /></button>
      </span>
      <h2 className="mono min-w-0 shrink truncate !text-[13px] !font-semibold text-[var(--foreground)]" aria-label={p.rangeLong} title={p.rangeLong} data-cal-range>{p.range}</h2>
      {!p.atToday && <button type="button" onClick={p.onToday} aria-keyshortcuts="t" title="Back to today (t)" className={CHIP}>Today</button>}
      {p.extra}
      <span className={header ? "min-w-2 flex-1" : "hidden"} aria-hidden="true" />
      {p.quickAdd}
      <span className="inline-flex shrink-0" role="group" aria-label="Scope">
        {(["day", "week"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={p.scope === s} onClick={() => p.scope !== s && p.onScope(s)} className={`${CHIP} ${s === "week" ? "border-l-0" : ""}`}>{s === "day" ? "Day" : "Week"}</button>
        ))}
      </span>
      <Menu name="View options" summary={p.tag ? `${viewName(p.view)}, tag #${p.tag}` : viewName(p.view)} align="right" chevron={false}
        className={`${CHIP} gap-1 px-1.5 ${p.tag ? "font-mono" : ""}`}
        label={<>{p.tag && <span className="max-w-[7rem] truncate">#{p.tag}</span>}<Ellipsis size={15} aria-hidden="true" /></>}>
        {(close) => <>
          <Section title={p.scope === "day" ? "Day views" : "Week views"}>
            {views.map((v) => <button key={v.id} type="button" aria-pressed={p.view === v.id} aria-label={viewName(v.id)} data-view-button={v.id} onClick={() => { p.onView(v.id); close(); }} className={SMALL}>{v.label}</button>)}
          </Section>
          <p className="text-micro text-[var(--muted-foreground)]">V next style, Shift+V previous, all eight.</p>
          {hasTags && (
            <Section title="Filter by tag">
              <button type="button" aria-pressed={!p.tag} onClick={() => p.onTag(null)} className={SMALL}>All</button>
              {(p.tag && !p.tags.some(([t]) => t === p.tag) ? [...p.tags, [p.tag, 0] as [string, number]] : p.tags).map(([t, n]) => (
                <button key={t} type="button" aria-pressed={p.tag === t} data-tag-filter={t} onClick={() => p.onTag(p.tag === t ? null : t)} aria-label={`#${t}, ${n} item${n === 1 ? "" : "s"}`} className={`${SMALL} font-mono`}>#{t} <span className="ml-1 opacity-70">{n}</span></button>
              ))}
            </Section>
          )}
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
        </>}
      </Menu>
      <CalendarStatus errors={p.errors} google={p.google} compact={header} />
    </div>
  );
}
