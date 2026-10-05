"use client";

import { Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { isAuthenticated } from "@/lib/auth";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
import { dateInTz, resolveDay, nowMinutes, VaultScheduleData } from "@/lib/routine";
import { resolveModeColor } from "@/lib/vault-constants";
import { useNow } from "@/hooks/use-now";
import { DayEditor } from "@/components/routine/day-editor";
import { RoutineRing } from "@/components/routine/routine-ring";

const REFRESH_MS = 60_000;

export default function RoutinePage() {
  const [schedule, setSchedule] = useState<VaultScheduleData | null>(null);
  const [today, setToday] = useState<VaultDayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const now = useNow(30_000);

  const load = useCallback(() => {
    vaultApi
      .schedule()
      .then((s) => {
        setSchedule(s);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error && (err as ApiError).status === 404
            ? "Calendar/Schedule.md is not in the synced vault yet. Push it and sync."
            : "Could not load the schedule — the API may be unreachable.",
        );
      })
      .finally(() => setLoading(false));

    // Mode is private decoration: only fetched with a session. 404 just means
    // no daily note synced yet.
    if (isAuthenticated()) {
      vaultApi.today().then(setToday).catch(() => setToday(null));
      vaultApi.editAccess().then((a) => setCanEdit(a.allowed)).catch(() => setCanEdit(false));
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const resolved = useMemo(() => {
    if (!schedule) return null;
    try {
      return { day: resolveDay(schedule, now), failure: null };
    } catch (err) {
      return { day: null, failure: (err as Error).message };
    }
  }, [schedule, now]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const problems = [
    ...(error ? [error] : []),
    ...(schedule?.errors ?? []),
    ...(resolved?.failure ? [resolved.failure] : []),
    ...(resolved?.day?.warnings ?? []),
  ];

  const dateLabel = schedule
    ? new Intl.DateTimeFormat("en-GB", { timeZone: schedule.meta.tz, weekday: "short", day: "numeric", month: "short" }).format(now)
    : "";

  return (
    <div className="w-full space-y-4">
      {problems.length > 0 && (
        <div className="border border-[var(--destructive)] bg-[var(--surface)] rounded-xl px-4 py-2 text-xs text-[var(--destructive)] space-y-0.5">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      {canEdit && schedule && resolved?.day && (
        <div className="flex justify-end">
          <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]">
            <Pencil size={14} /> Edit
          </button>
        </div>
      )}
      {schedule && resolved?.day && (
        <RoutineRing
          day={resolved.day}
          nowMin={nowMinutes(now, schedule.meta.tz)}
          dateLabel={dateLabel}
          mode={today?.mode ?? null}
          modeColor={resolveModeColor(today?.mode ?? "")}
          city={schedule.meta.city}
        />
      )}
      {canEdit && schedule && resolved?.day && (
        <DayEditor open={editing} onClose={() => setEditing(false)} day={dateInTz(now, schedule.meta.tz)} today={today} blocks={resolved.day.blocks} onSaved={setToday} />
      )}
    </div>
  );
}
