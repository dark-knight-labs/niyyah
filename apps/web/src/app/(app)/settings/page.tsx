"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { BlocksSection } from "@/components/settings/blocks-section";
import { GoalsSection } from "@/components/settings/goals-section";
import { FeedsSection } from "@/components/settings/feeds-section";
import { LocationSection } from "@/components/settings/location-section";
import { ScheduleSection } from "@/components/settings/schedule-section";
import { useBlocks } from "@/lib/blocks";
import { VaultScheduleData } from "@/lib/routine";
import { vaultApi } from "@/lib/vault-api";
import { Draft } from "@/components/settings/types";
import { ScheduleRowIn } from "@/lib/vault-types";


const toRows = (rows: VaultScheduleData["days"][string] | undefined): ScheduleRowIn[] =>
  (rows ?? []).map((r) => ({ block: r.block, start: r.start, end: r.end, what: r.what, stream: r.stream ?? null }));

export default function SettingsPage() {
  const blocksCtx = useBlocks();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [streams, setStreams] = useState<{ id: string; label: string }[]>([]);

  const load = useCallback(async () => {
    const [cfg, sched, quarter, goals] = await Promise.all([vaultApi.blocksConfig(), vaultApi.schedule(), vaultApi.quarter().catch(() => null), vaultApi.goals()]);
    const next: Draft = {
      blocks: cfg.blocks,
      goals: goals.items.map((x) => ({ title: x.title, value: x.value, caption: x.caption, progress: x.progress })),
      meta: { city: sched.meta.city, lat: sched.meta.lat, lon: sched.meta.lon, tz: sched.meta.tz, method: sched.meta.method.toLowerCase(),
        madhab: sched.meta.madhab.toLowerCase(), weekend_days: sched.meta.weekend_days },
      weekday: toRows(sched.days.weekday), weekend: toRows(sched.days.weekend),
    };
    setDraft(next);
    setSaved(JSON.stringify(next));
    setStreams((quarter?.streams ?? []).map((s) => ({ id: s.stream, label: s.name })));
  }, []);

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load settings")); }, [load]);

  const dirty = useMemo(() => !!draft && JSON.stringify(draft) !== saved, [draft, saved]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await vaultApi.saveBlocks(draft.blocks);
      await vaultApi.saveSchedule({ meta: draft.meta, weekday: draft.weekday, weekend: draft.weekend });
      await vaultApi.saveGoals(draft.goals);
      await blocksCtx.reload();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : <div className="grid h-64 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" /></div>;
  }
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <div className="mx-auto max-w-[68rem] pb-24">
      <h1 className="font-serif text-[1.6rem] leading-tight">Settings</h1>
      <p className="mb-5 mt-1 max-w-[62ch] text-sm text-[var(--muted-foreground)]">Where you are, the blocks of your day, the schedule on your clock and the calendars you read. Streams are edited on the Plan page.</p>
      <LocationSection meta={draft.meta} onChange={(meta) => set({ meta })} />
      <BlocksSection blocks={draft.blocks} onChange={(b) => set({ blocks: b })} usedKeys={new Set([...draft.weekday, ...draft.weekend].map((r) => r.block))} />
      <GoalsSection goals={draft.goals} onChange={(goals) => set({ goals })} />
      <ScheduleSection draft={draft} streams={streams} onChange={set} />
      <FeedsSection />
      <AppearanceSection />
      <div className="fixed inset-x-0 bottom-0 flex flex-wrap items-center justify-end gap-2.5 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
        <span role="status" className={`mr-auto text-sm ${error ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]"}`}>{error ?? (dirty ? "Unsaved changes" : "All changes saved")}</span>
        <button type="button" disabled={!dirty || busy} onClick={() => setDraft(JSON.parse(saved))} className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-50">Discard</button>
        <button type="button" disabled={!dirty || busy} onClick={() => void save()} className="min-h-9 rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--accent-fg)] disabled:opacity-50">{busy ? "Saving…" : "Save settings"}</button>
      </div>
    </div>
  );
}
