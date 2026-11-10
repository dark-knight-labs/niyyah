"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useBlocks } from "@/lib/blocks";
import { countsToday, gateLabel, suggestedStars } from "@/lib/habit";
import { vaultApi } from "@/lib/vault-api";
import { HabitData, HabitLevel, HabitsData, VaultDayData } from "@/lib/vault-types";

interface Props {
  day: string;
  /** The block you are in; its group is bright, the rest are dimmed (today only). */
  current?: string;
  data: HabitsData;
  today: VaultDayData | null;
  onData: (data: HabitsData) => void;
  onVoted: (day: VaultDayData | null) => void;
  /** Where the habit list is: while it loads or failed, no "No habits yet" is shown (voting still works). */
  habitsState?: "loading" | "error" | "ready";
}

/** How many days back the API lets a check or vote be edited (the week endpoint covers today and the six before). */
const BACK_DAYS = 6;

/** The day `back` days before `day` (both YYYY-MM-DD). */
function shiftDay(day: string, back: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Habits under the day block they live in, and the one place to vote: each block that counts for stars has 1-3 star buttons in its header (tap the level you have to clear it), and ticking habits updates the count they suggest; one tap applies it. Counted blocks with no habit show as header-only rows. The arrows step back through the last week so a missed day can be filled in. */
export function HabitsPanel({ day: todayKey, current, data, today: todayData, onData, onVoted, habitsState = "ready" }: Props) {
  const blocks = useBlocks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [back, setBack] = useState(0);
  const [past, setPast] = useState<VaultDayData | null>(null);
  const day = shiftDay(todayKey, back);
  const isToday = back === 0;
  const today = isToday ? todayData : past;
  // A habit viewed on an earlier day shows that day's check in place of today's.
  const live = data.habits.filter((h) => h.stage !== "retired").map((h) => (isToday ? h : { ...h, today: h.days[day] ?? null }));

  useEffect(() => {
    if (back === 0) return;
    let stale = false;
    vaultApi.week().then((w) => { if (!stale) setPast(w.days.find((d) => d.date === day) ?? null); }).catch(() => { if (!stale) setPast(null); });
    return () => { stale = true; };
  }, [back, day]);

  async function guard(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await work(); } catch (err) { setError(err instanceof Error ? err.message : "Could not save"); } finally { setBusy(false); }
  }
  const check = (h: HabitData, level: HabitLevel | null) => guard(async () => onData(await vaultApi.checkHabit(h.id, day, level)));
  const apply = (block: string, stars: number) => guard(async () => {
    const saved = (await vaultApi.setVote(day, block, stars)).day;
    if (isToday) onVoted(saved); else setPast(saved);
  });

  const counted = blocks.forDay(today?.blocks).filter((b) => b.counts_for_stars).map((b) => b.key);
  const groups = [...blocks.list.map((b) => b.key), ...live.map((h) => h.block), ...counted]
    .filter((k, i, all) => all.indexOf(k) === i)
    .map((key) => ({ key, habits: live.filter((h) => h.block === key) }))
    .filter((g) => g.habits.length > 0 || counted.includes(g.key));
  const due = live.filter(countsToday);
  const doneCount = due.filter((h) => h.today !== null).length;

  return (
    <section aria-label="Habits" className="border border-[var(--border)] bg-[var(--surface)]">
      <h2 className="mono flex h-11 items-center justify-between gap-4 border-b border-[var(--border)] px-4 text-[var(--muted-foreground)]">
        <span>Habits</span>
        <span className="flex items-center gap-2 tabular-nums">
          <button type="button" aria-label="Previous day" disabled={back >= BACK_DAYS} onClick={() => setBack(back + 1)} className="px-1.5 hover:text-[var(--foreground)] disabled:opacity-30">‹</button>
          <span>{isToday ? "Today" : day}: {doneCount} of {due.length}</span>
          <button type="button" aria-label="Next day" disabled={isToday} onClick={() => setBack(back - 1)} className="px-1.5 hover:text-[var(--foreground)] disabled:opacity-30">›</button>
        </span>
      </h2>
      {habitsState === "loading" && <p className="px-4 py-3 text-small text-[var(--muted-foreground)]">Loading habits…</p>}
      {habitsState === "error" && <p role="alert" className="px-4 py-3 text-small text-[var(--destructive)]">Could not load habits.</p>}
      {habitsState === "ready" && live.length === 0 && (
        <p className="px-4 py-3 text-small text-[var(--muted-foreground)]">No habits yet. Add one from the capture line on <Link href="/plan" className="underline">Plan</Link>; see <Link href="/habits" className="underline">Habits</Link>.</p>
      )}
      {groups.map(({ key, habits }) => {
        const color = blocks.color(key);
        const suggested = suggestedStars(habits);
        const stars = today?.blocks[key] ?? 0;
        const countsForStars = counted.includes(key) || (blocks.get(key)?.counts_for_stars ?? false);
        return (
          <div key={key} className="border-b border-[var(--border)] last:border-b-0">
            <div className="flex min-h-10 flex-wrap items-center gap-x-2.5 bg-[var(--muted)] px-4">
              <span className="h-2 w-2 shrink-0" style={{ background: color }} aria-hidden="true" />
              <span className="mono text-[var(--foreground)]">{blocks.label(key)}</span>
              {countsForStars && (
                <span role="group" aria-label={`${blocks.label(key)} vote`} className={`mono ml-auto flex items-center gap-2 text-[var(--muted-foreground)] transition-opacity ${isToday && current && current !== key ? "opacity-60" : ""}`}>
                  <span className="tabular-nums">{stars} of 3 stars</span>
                  {suggested !== stars && habits.length > 0 && (
                    <button type="button" disabled={busy} onClick={() => void apply(key, suggested)}
                      className="border border-[var(--rule)] px-2 py-0.5 text-[var(--accent)] hover:bg-[var(--surface)] disabled:opacity-40">Set {suggested}</button>
                  )}
                  <span className="flex">
                    {[1, 2, 3].map((n) => (
                      <button key={n} type="button" disabled={busy} aria-pressed={stars === n} aria-label={`${blocks.label(key)} ${n} ${n === 1 ? "star" : "stars"}`}
                        onClick={() => void apply(key, stars === n ? 0 : n)} className="group grid h-10 w-8 place-items-center disabled:opacity-60">
                        <span className="grid h-6 w-6 place-items-center bg-[var(--surface)] text-micro font-semibold text-[var(--muted-foreground)] transition-colors group-hover:bg-[var(--border)] group-aria-pressed:text-white"
                          style={stars === n ? { background: color } : undefined}>{n}</span>
                      </button>
                    ))}
                  </span>
                </span>
              )}
            </div>
            {habits.map((h) => {
              const off = !countsToday(h);
              return (
                <div key={h.id} className="flex min-h-11 items-center gap-3 border-t border-[var(--border)] px-4 first:border-t-0">
                  <button type="button" disabled={busy} aria-label={h.today === "done" ? `Uncheck ${h.name}` : `Check ${h.name}`}
                    onClick={() => void check(h, h.today === "done" ? null : "done")}
                    className="grid h-5 w-5 shrink-0 place-items-center">
                    <span className={`grid h-4 w-4 place-items-center border text-[11px] leading-none ${h.today === "done" ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]" : h.today === "min" ? "border-[var(--warn)] bg-[var(--warn)] text-[var(--accent-fg)]" : "border-[var(--rule)] bg-[var(--surface)]"}`}>
                      {h.today === "done" ? "✓" : h.today === "min" ? "–" : ""}
                    </span>
                  </button>
                  <div className={`min-w-0 flex-1 text-small ${h.today ? "text-[var(--muted-foreground)] line-through" : ""}`}>
                    <span className="font-medium">{h.name}</span>
                    {(h.anchor || h.minimum) && (
                      <span className="block text-xs text-[var(--muted-foreground)] no-underline">
                        {[h.anchor, h.per_week < 7 ? `${h.per_week} a week` : "", h.minimum ? `min: ${h.minimum}` : ""].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  {h.stage === "installing" && <span className="mono hidden border border-[var(--accent)] px-1.5 py-0.5 text-[var(--accent)] sm:inline">{gateLabel(h)}</span>}
                  {h.tripwire === "fired" && <span className="mono border border-[var(--destructive)] px-1.5 py-0.5 text-[var(--destructive)]">Tripwire</span>}
                  {!h.today && h.minimum && (
                    <button type="button" disabled={busy} onClick={() => void check(h, "min")} title="Count the minimum version"
                      className="mono border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted-foreground)] hover:border-[var(--warn)] hover:text-[var(--warn)] disabled:opacity-40">Min</button>
                  )}
                  <span className="mono w-10 text-right tabular-nums text-[var(--muted-foreground)]">{off ? "rest" : h.streak ? `${h.streak}d` : "·"}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {error && <p role="alert" className="border-t border-[var(--destructive)] px-4 py-2 text-xs text-[var(--destructive)]">{error}</p>}
    </section>
  );
}
