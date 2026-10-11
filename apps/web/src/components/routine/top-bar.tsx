"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNow } from "@/hooks/use-now";
import { Checklist } from "@/components/planner/checklist";
import { vaultApi } from "@/lib/vault-api";
import { ObjectiveCarousel, objectiveChips, quarterPace, usePinned } from "@/components/routine/objective-carousel";
import { QuarterData, VaultDayData, VaultGoal } from "@/lib/vault-types";
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
  /** Owner only: the goals from Settings and the quarter's streams, shown as objective chips. */
  goals: VaultGoal[] | null;
  quarter: QuarterData | null;
  onTick: (id: string, done: boolean) => Promise<unknown>;
}

/** The day's mode: a chip that opens a short list (colour dot, name, tick on the current one). Arrow keys move, Enter picks, Esc closes. */
function ModePicker({ mode, editable, onChange }: { mode: string; editable: boolean; onChange: (mode: string) => void }) {
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
      <span className="grid text-left leading-tight">
        <span className={LABEL}>Mode</span>
        <span className="text-small font-semibold capitalize">{label}</span>
      </span>
    </>
  );
  if (!editable) return <div className={CHIP}>{face}</div>;

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
    <div ref={root} className="relative" onKeyDown={onKey}>
      <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Day mode: ${label}`}
        onClick={() => { setActive(Math.max(current, 0)); setOpen(!open); }}
        className={`${CHIP} w-full pr-2.5 transition-colors hover:bg-[var(--muted)] aria-expanded:border-[var(--muted-foreground)]`}>
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

/** Slim top bar: the quarter's objectives as a chip carousel (pinned first), then the date, the day's mode and the star total. */
const CHIP = "relative flex min-h-11 items-center gap-2.5 overflow-hidden rounded-lg border border-[var(--rule)] bg-[var(--surface)] px-3";
const LABEL = "mono text-[var(--muted-foreground)]";

export function TopBar({ dateLabel, city, editDay, today, onSaved, goals, quarter, onTick }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const mode = today?.mode ?? null;
  const opened = goals?.find((g) => g.title === open) ?? null;
  const chips = objectiveChips(quarter, goals, open, setOpen);
  const { pinned, toggle, full } = usePinned(chips.map((c) => c.id));
  const pace = quarterPace(quarter, useNow(3_600_000));

  async function setMode(next: string) {
    if (!editDay) return;
    setError(null);
    try {
      onSaved((await vaultApi.setMode(editDay, next)).day);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  return (
    <header className="mb-4 border-b border-[var(--border)] pb-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 flex-1 basis-[28rem]">
        {chips.length > 0 && <ObjectiveCarousel chips={chips} pinned={pinned} onPin={toggle} pace={pace} full={full} />}
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center" role="group" aria-label="Today">
        <div className={`${CHIP} min-w-0`} title={city ?? undefined}>
          <span className="grid leading-tight">
            <span className={LABEL}>Date</span>
            <span className="text-small font-semibold">{dateLabel}{city && <span className="font-normal text-[var(--muted-foreground)]"> · {city}</span>}</span>
          </span>
        </div>
        {today && (
          <>
            <ModePicker mode={mode ?? "full"} editable={!!editDay} onChange={(m) => void setMode(m)} />
            <div className={`${CHIP} col-span-2 sm:col-span-1`} role="progressbar" aria-label="Stars today" aria-valuemin={0} aria-valuemax={today.possible} aria-valuenow={today.total}>
              <span className="grid leading-tight">
                <span className={LABEL}>Stars</span>
                <span className="text-small font-semibold"><b className="font-mono tabular-nums">{today.total}</b><span className="font-normal text-[var(--muted-foreground)]"> / <span className="font-mono tabular-nums">{today.possible}</span></span></span>
              </span>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-[var(--muted)]" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 bg-[var(--accent)] transition-[width] duration-[350ms]" style={{ width: `${today.possible ? Math.round((100 * today.total) / today.possible) : 0}%` }} />
              </span>
            </div>
          </>
        )}
      </div>
      </div>
      {opened && (
        <div className="mt-3 border-t border-[var(--border)] pt-2.5">
          <Checklist label={`${opened.title} checklist`} items={opened.checklist} onToggle={(item, done) => onTick(item.id, done)} />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p>}
    </header>
  );
}
