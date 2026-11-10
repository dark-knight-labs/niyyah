"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePlanner } from "@/hooks/use-planner";
import { HabitBoard } from "@/components/planner/habit-board";
import { Notice, PageTitle, Spinner } from "@/components/planner/page-title";
import { vaultApi } from "@/lib/vault-api";
import { HabitsData } from "@/lib/vault-types";

/** Habits: the board of every habit by stage (installing, on rails, watching). The Plan shows them under goals; Overview ticks them for today. */
export default function HabitsPage() {
  const { loading, owner, streams } = usePlanner();
  const [habits, setHabits] = useState<HabitsData | null>(null);
  const [habitPick, setHabitPick] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (owner) vaultApi.habits().then(setHabits).catch(() => setProblem("Could not load the habits."));
  }, [owner]);

  /** Habit writes answer with the whole habit list, so the board needs no reload. */
  async function runHabits(action: () => Promise<HabitsData>): Promise<boolean> {
    setProblem(null);
    setBusy(true);
    try {
      setHabits(await action());
      return true;
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (!owner) return <Notice>Habits are private to the vault owner.</Notice>;

  const installing = habits?.habits.filter((h) => h.stage === "installing").length ?? 0;
  const rails = habits?.habits.filter((h) => h.stage === "rails").length ?? 0;
  return (
    <div className="w-full">
      <PageTitle eyebrow={`Habits · ${installing} installing · ${rails} on rails`} title="Habits"
        sub={<>Write a new one in the capture line on <Link href="/plan" className="underline">Plan</Link>. Today&apos;s checklist is on <Link href="/" className="underline">Overview</Link>.</>} />
      {problem && <p role="alert" className="mb-4 border border-[var(--destructive)] px-4 py-2 text-xs text-[var(--destructive)]">{problem}</p>}
      {habits ? (
        <section id="habits-board" aria-label="Habits" className="border border-[var(--border)] bg-[var(--surface)]">
          <HabitBoard data={habits} streams={streams} busy={busy} runHabits={runHabits} picked={habitPick} onPick={setHabitPick} />
        </section>
      ) : !problem && <Spinner />}
    </div>
  );
}
