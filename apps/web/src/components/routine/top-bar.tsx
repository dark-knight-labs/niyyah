"use client";

import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
      <span className={LABEL}>Mode</span>
      <span className="text-small font-semibold capitalize">{label}</span>
    </>
  );
  if (!editable) return <div className={FACT}>{face}</div>;

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
        className={`${FACT} w-full pr-2.5 transition-colors hover:bg-[var(--muted)]`}>
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

const FACT = "relative flex h-full min-h-9 items-center gap-2 whitespace-nowrap border-l border-[var(--border)] px-3.5";
const LABEL = "mono text-[var(--muted-foreground)]";

interface FactsProps { dateLabel: string; city: string | null; editDay: string | null; today: VaultDayData | null; onMode: (mode: string) => void; }

/** Date, the day's mode and the star total as plain cells; they sit in the app's top bar, before the account. */
function TodayFacts({ dateLabel, city, editDay, today, onMode }: FactsProps) {
  return (
    <div className="flex h-full items-stretch" role="group" aria-label="Today">
      <div className={FACT} title={city ?? undefined}>
        <span className={LABEL}>Date</span>
        <span className="text-small font-semibold">{dateLabel}{city && <span className="hidden font-normal text-[var(--muted-foreground)] xl:inline"> · {city}</span>}</span>
      </div>
      {today && (
        <>
          <ModePicker mode={today.mode ?? "full"} editable={!!editDay} onChange={onMode} />
          <div className={FACT} role="progressbar" aria-label="Stars today" aria-valuemin={0} aria-valuemax={today.possible} aria-valuenow={today.total}>
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

/** Where the app's top bar wants the facts (md and up); below md they sit under the objectives instead. */
function useNavSlot(): HTMLElement | null {
  return useSyncExternalStore(() => () => {}, () => document.getElementById("nav-today"), () => null);
}

/** Slim objectives strip: the quarter's objectives as a one-line chip carousel (pinned first). */
export function TopBar({ dateLabel, city, editDay, today, onSaved, goals, quarter, onTick }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const opened = goals?.find((g) => g.title === open) ?? null;
  const chips = objectiveChips(quarter, goals, open, setOpen);
  const { pinned, toggle, full } = usePinned(chips.map((c) => c.id));
  const pace = quarterPace(quarter, useNow(3_600_000));
  const slot = useNavSlot();

  async function setMode(next: string) {
    if (!editDay) return;
    setError(null);
    try {
      onSaved((await vaultApi.setMode(editDay, next)).day);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  const facts: FactsProps = { dateLabel, city, editDay, today, onMode: (m) => void setMode(m) };

  return (
    <header className="mb-2 border-b border-[var(--border)] pb-2">
      {slot && createPortal(<TodayFacts {...facts} />, slot)}
      <div className={`border-b border-[var(--border)] ${slot ? "md:hidden" : ""}`}><TodayFacts {...facts} /></div>
      {chips.length > 0 && <ObjectiveCarousel chips={chips} pinned={pinned} onPin={toggle} pace={pace} full={full} />}
      {opened && (
        <div className="mt-3 border-t border-[var(--border)] pt-2.5">
          <Checklist label={`${opened.title} checklist`} items={opened.checklist} onToggle={(item, done) => onTick(item.id, done)} />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p>}
    </header>
  );
}
