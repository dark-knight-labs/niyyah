"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
import { resolveModeColor } from "@/lib/vault-constants";

const MODES = [
  ["full", "Full"], ["yellow", "Yellow"], ["compressed", "Compressed"], ["minimal", "Minimal"],
  ["off", "Off"], ["ramadan", "Ramadan"], ["fasting", "Fasting"],
] as const;

interface Props {
  dateLabel: string;
  city: string | null;
  /** "YYYY-MM-DD"; only passed for the owner, who can change the mode. */
  editDay: string | null;
  today: VaultDayData | null;
  onSaved: (day: VaultDayData | null) => void;
}

/** The day's mode: a chip that opens a short list (colour dot, name, tick on the current one). Arrow keys move, Enter picks, Esc closes. */
function ModePicker({ mode, editable, onChange, cell }: { mode: string; editable: boolean; onChange: (mode: string) => void; cell: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = MODES.findIndex(([key]) => key === mode);
  const label = MODES[current]?.[1] ?? mode;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const face = (
    <>
      <span className="h-2 w-2 shrink-0 transition-colors" style={{ background: resolveModeColor(mode) }} aria-hidden="true" />
      <span className={LABEL}>Mode</span>
      <span className="text-small font-semibold capitalize">{label}</span>
    </>
  );
  if (!editable) return <div className={cell}>{face}</div>;

  function pick(key: string) {
    setOpen(false);
    button.current?.focus();
    if (key !== mode) onChange(key);
  }
  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(current, 0)); setOpen(true); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % MODES.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + MODES.length) % MODES.length); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(MODES[active][0]); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={root} className="relative flex" onKeyDown={onKey}>
      <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Day mode: ${label}`}
        onClick={() => { setActive(Math.max(current, 0)); setOpen(!open); }}
        className={`${cell} w-full pr-2.5 transition-colors hover:bg-[var(--muted)]`}>
        {face}
        <ChevronDown size={13} aria-hidden="true" className={`ml-1 max-sm:ml-auto text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul role="listbox" aria-label="Day mode" className="absolute right-0 top-full z-30 mt-1 min-w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl">
          {MODES.map(([key, name], i) => (
            <li key={key} role="option" aria-selected={key === mode} onMouseEnter={() => setActive(i)} onClick={() => pick(key)}
              className={`flex min-h-9 cursor-pointer items-center gap-2.5 whitespace-nowrap px-3 text-small font-semibold ${i === active ? "bg-[var(--muted)]" : ""}`}>
              <span className="h-2 w-2 shrink-0" style={{ background: resolveModeColor(key) }} aria-hidden="true" />
              <span className="flex-1">{name}</span>
              {key === mode && <Check size={13} aria-hidden="true" className="text-[var(--accent)]" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Cells of the facts strip: "top" in its own row above the page (public view), "row" under the clock, "bar" in the calendar bar. */
type FactsLook = "top" | "row" | "bar";
const CELL: Record<FactsLook, string> = {
  top: "relative flex h-full min-h-9 items-center gap-2 whitespace-nowrap border-l border-[var(--border)] px-3.5",
  row: "relative flex h-full min-h-8 items-center gap-2 whitespace-nowrap px-2 first:pl-0",
  bar: "relative flex h-full min-h-8 items-center gap-1.5 whitespace-nowrap border-l border-[var(--border)] px-2",
};
const LABEL = "mono text-[var(--muted-foreground)]";

interface FactsProps { dateLabel: string; city: string | null; editDay: string | null; today: VaultDayData | null; onMode: (mode: string) => void; look: FactsLook; }

/** Date (top look only), the day's mode and the star total as plain cells. */
function TodayFacts({ dateLabel, city, editDay, today, onMode, look }: FactsProps) {
  const cell = CELL[look];
  return (
    <div className="flex h-full items-stretch" role="group" aria-label="Today">
      {look === "top" && (
        <div className={cell} title={city ?? undefined}>
          <span className={LABEL}>Date</span>
          <span className="text-small font-semibold">{dateLabel}{city && <span className="hidden font-normal text-[var(--muted-foreground)] xl:inline"> · {city}</span>}</span>
        </div>
      )}
      {today && (
        <>
          <ModePicker mode={today.mode ?? "full"} editable={!!editDay} onChange={onMode} cell={cell} />
          <div className={cell} role="progressbar" aria-label="Stars today" aria-valuemin={0} aria-valuemax={today.possible} aria-valuenow={today.total}>
            <span className={LABEL}>Stars</span>
            <span className="text-small font-semibold"><b className="font-mono tabular-nums">{today.total}</b><span className="font-normal text-[var(--muted-foreground)]"> / <span className="font-mono tabular-nums">{today.possible}</span></span></span>
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-[var(--muted)]" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 bg-[var(--accent)] transition-[width] duration-[350ms]" style={{ width: `${today.possible ? Math.round((100 * today.total) / today.possible) : 0}%` }} />
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The day's facts. `look="top"` (public view): a strip with the date above the clock. For the owner the date is left to the
 * calendar range and the clock: `look="row"` sits under the clock, `look="bar"` goes in the calendar bar while the sidebar is hidden.
 */
export function TopBar({ dateLabel, city, editDay, today, onSaved, look = "top" }: Props & { look?: FactsLook }) {
  const [error, setError] = useState<string | null>(null);

  async function setMode(next: string) {
    if (!editDay) return;
    setError(null);
    try {
      onSaved((await vaultApi.setMode(editDay, next)).day);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  const facts: FactsProps = { dateLabel, city, editDay, today, onMode: (m) => void setMode(m), look };
  // Under the clock and in the bar the strip is only mode and stars, which need the day's note.
  if (look !== "top" && !today) return null;
  if (look === "bar") return <div className="flex h-8 shrink-0 items-stretch" title={error ?? undefined}><TodayFacts {...facts} />{error && <span role="alert" className="sr-only">{error}</span>}</div>;
  return (
    <header className={look === "row" ? "border-b border-[var(--border)] py-1" : "mb-2 border-b border-[var(--border)] pb-2"} title={look === "row" ? city ?? undefined : undefined}>
      <TodayFacts {...facts} />
      {error && <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p>}
    </header>
  );
}
