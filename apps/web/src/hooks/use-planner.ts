"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { vaultApi } from "@/lib/vault-api";
import { StreamMeta, toMeta } from "@/lib/streams";
import { NotebooksData, PipelinesData, QuarterData, VaultObjectivesData } from "@/lib/vault-types";

const REFRESH_MS = 60_000;

export interface Planner {
  loading: boolean;
  /** Plans are private: only the vault owner's session can read them. */
  owner: boolean;
  quarter: QuarterData | null;
  quarterError: string | null;
  pipelines: PipelinesData | null;
  objectives: VaultObjectivesData | null;
  /** Ideas, meetings, links and blockers per stream; null until loaded (the planner works without it). */
  notebooks: NotebooksData | null;
  /** The live blocks (quarter goal and pipeline), in quarter-note order; archived ones are left out. */
  streams: StreamMeta[];
  error: string | null;
  reload: () => Promise<void>;
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Quarter, pipelines and week objectives from the vault, refreshed every minute and after each edit. */
export function usePlanner(): Planner {
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState(false);
  const [quarter, setQuarter] = useState<QuarterData | null>(null);
  const [quarterError, setQuarterError] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<PipelinesData | null>(null);
  const [objectives, setObjectives] = useState<VaultObjectivesData | null>(null);
  const [notebooks, setNotebooks] = useState<NotebooksData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const access = await vaultApi.editAccess();
      setOwner(access.allowed);
      if (!access.allowed) return;
      const [q, p, o, n] = await Promise.allSettled([vaultApi.quarter(), vaultApi.pipelines(), vaultApi.objectives(), vaultApi.notebooks()]);
      if (q.status === "fulfilled") { setQuarter(q.value); setQuarterError(null); }
      else setQuarterError((q.reason as ApiError).status === 404 ? "This quarter's note is not in the synced vault yet." : message(q.reason, "Could not load the quarter."));
      if (p.status === "fulfilled") setPipelines(p.value);
      if (o.status === "fulfilled") setObjectives(o.value);
      if (n.status === "fulfilled") setNotebooks(n.value);
      setError(p.status === "rejected" || o.status === "rejected" ? "Could not load the plan. The API may be unreachable." : null);
    } catch (err) {
      setError(message(err, "Could not reach the API."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  const streams = useMemo(() => (pipelines?.streams ?? []).map(toMeta), [pipelines]);

  return { loading, owner, quarter, quarterError, pipelines, objectives, notebooks, streams, error, reload };
}
