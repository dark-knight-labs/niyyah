"use client";

import { useCallback, useEffect, useState } from "react";
import { CompassChange, CompassData, RoleData, ValueData, compassApi } from "@/lib/compass-api";
import { firstSentence } from "@/lib/plan-v3";
import { StreamMeta } from "@/lib/streams";

const FIELD = "w-full rounded-lg border border-[var(--accent)] bg-[var(--background)] px-3 py-2 text-sm";
const BUTTON = "min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]";

interface Loaded {
  compass: CompassData;
  values: ValueData[];
  roles: RoleData[];
}

const OPEN_KEY = "niyyah.compass.open";

/** Compass, one line: the first sentence of the mission; "Mission & vision" opens both texts side by side. Open or closed is remembered. */
/** Compass: why this plan exists. Mission, vision and its horizon are edited here; values (principles) are read-only; a role points at a block. */
export function CompassBand({ streams }: { streams: StreamMeta[] }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ mission: "", vision: "", vision_horizon: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openRole, setOpenRole] = useState<number | null>(null);
  // Read once, when the band is first drawn: the page shows a spinner until the plan has loaded, so this never runs on the server.
  const [open, setOpen] = useState(() => (typeof window === "undefined" ? false : window.localStorage.getItem(OPEN_KEY) === "1"));

  const load = useCallback(async () => {
    try {
      const [compass, values, roles] = await Promise.all([compassApi.get(), compassApi.values().catch(() => []), compassApi.roles().catch(() => [])]);
      setData({ compass, values, roles });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load once on mount, independent of the planner
    void load();
  }, [load]);

  if (failed) return <p role="status" className="mb-4 text-xs text-[var(--muted-foreground)]">Compass could not be loaded.</p>;
  // A line-high placeholder keeps the page from jumping when the compass arrives.
  if (!data) return <section aria-label="Compass" aria-busy="true" className="mb-3 h-9 border-y border-[var(--border)]" />;
  const { compass, values, roles } = data;
  const empty = !compass.mission && !compass.vision;

  function start() {
    setDraft({ mission: compass.mission, vision: compass.vision, vision_horizon: compass.vision_horizon });
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    const change: CompassChange = {};
    for (const key of ["mission", "vision", "vision_horizon"] as const) if (draft[key].trim() !== compass[key]) change[key] = draft[key].trim();
    setBusy(true);
    setError(null);
    try {
      const saved = Object.keys(change).length ? await compassApi.put(change) : compass;
      setData((d) => (d ? { ...d, compass: saved } : d));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function linkRole(role: RoleData, stream: string | null) {
    setError(null);
    try {
      const saved = await compassApi.setRoleStream(role.id, stream);
      setData((d) => (d ? { ...d, roles: d.roles.map((r) => (r.id === role.id ? { ...r, stream: saved.stream } : r)) } : d));
      setOpenRole(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  const label = "mono pt-1.5 text-[var(--muted-foreground)] sm:w-20 sm:flex-none";
  const toggle = () => setOpen((v) => { window.localStorage.setItem(OPEN_KEY, v ? "0" : "1"); return !v; });
  const showTexts = open && !editing;
  const hasBody = editing || !!error || (open && (!empty || values.length > 0 || roles.length > 0));

  return (
    <section aria-label="Compass" className="mb-3 border-y border-[var(--border)]">
      <div className="flex min-h-9 flex-wrap items-baseline gap-x-3 gap-y-1 px-1 py-1.5">
        <span className="mono shrink-0 text-[var(--muted-foreground)]">Compass</span>
        <span className="min-w-0 flex-1 truncate text-small font-medium" title={compass.mission}>{empty ? "Write why this plan exists." : firstSentence(compass.mission)}</span>
        {!editing && (
          <>
            {!empty && <button type="button" aria-expanded={open} onClick={toggle} className="mono text-[var(--accent)] hover:underline">{open ? "Hide" : "Mission & vision"}</button>}
            <button type="button" onClick={start} className="mono text-[var(--accent)] hover:underline">Edit</button>
          </>
        )}
      </div>
      <div className={`grid gap-3 ${hasBody ? "px-1 pb-3" : ""}`}>
        {error && <p role="alert" className="border border-[var(--destructive)] px-3 py-2 text-xs text-[var(--destructive)]">{error}</p>}

        {editing ? (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => e.key === "Escape" && cancel()}>
            <label className="grid gap-1"><span className="mono text-[var(--muted-foreground)]">Mission</span>
              <textarea autoFocus rows={3} maxLength={1000} value={draft.mission} onChange={(e) => setDraft({ ...draft, mission: e.target.value })} className={FIELD} /></label>
            <label className="grid gap-1"><span className="mono text-[var(--muted-foreground)]">Vision</span>
              <textarea rows={3} maxLength={1000} value={draft.vision} onChange={(e) => setDraft({ ...draft, vision: e.target.value })} className={FIELD} /></label>
            <label className="grid gap-1 sm:w-40"><span className="mono text-[var(--muted-foreground)]">Horizon</span>
              <input maxLength={10} value={draft.vision_horizon} placeholder="2046" onChange={(e) => setDraft({ ...draft, vision_horizon: e.target.value })} className={FIELD} /></label>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-9 rounded-lg bg-[var(--accent)] px-4 text-xs font-bold text-[var(--accent-fg)] disabled:opacity-50">Save</button>
              <button type="button" onClick={cancel} className={BUTTON}>Cancel</button>
            </div>
          </form>
        ) : showTexts && !empty ? (
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2" data-testid="compass-texts">
            <div><span className="mono text-[var(--muted-foreground)]">Mission</span><p className="mt-1 max-w-[62ch] text-xs leading-relaxed">{compass.mission}</p></div>
            <div><span className="mono text-[var(--muted-foreground)]">Vision{compass.vision_horizon ? ` · by ${compass.vision_horizon}` : ""}</span><p className="mt-1 max-w-[62ch] text-xs leading-relaxed">{compass.vision}</p></div>
          </div>
        ) : null}

        {open && !editing && values.length > 0 && (
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <span className={label}>Values</span>
            <ul className="flex flex-wrap gap-1.5">
              {values.map((v) => <li key={v.id} className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs">{v.name}</li>)}
            </ul>
          </div>
        )}

        {open && !editing && roles.length > 0 && (
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <span className={label}>Roles</span>
            <div className="grid gap-2">
              <ul className="flex flex-wrap gap-1.5">
                {roles.map((r) => {
                  const linked = streams.find((s) => s.id === r.stream);
                  return (
                    <li key={r.id}>
                      <button type="button" aria-expanded={openRole === r.id} onClick={() => setOpenRole(openRole === r.id ? null : r.id)}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 text-xs hover:bg-[var(--muted)]">
                        {/* a linked role takes its block's theme colour; otherwise the role's own stored colour */}
                        <i className="h-2 w-2 rounded-full" style={{ background: linked ? linked.color : r.color }} />
                        {r.name}{linked && <span className="text-[var(--muted-foreground)]">· {linked.label}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {openRole !== null && (() => {
                const role = roles.find((r) => r.id === openRole);
                if (!role) return null;
                return (
                  <div role="group" aria-label={`Block for ${role.name}`} className="flex flex-wrap gap-1.5 border-t border-[var(--border)] pt-2">
                    {streams.map((s) => (
                      <button key={s.id} type="button" aria-pressed={role.stream === s.id} onClick={() => void linkRole(role, s.id)}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 text-xs aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]">
                        <i className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}
                      </button>
                    ))}
                    <button type="button" aria-pressed={role.stream === null} onClick={() => void linkRole(role, null)}
                      className="min-h-8 rounded-full border border-[var(--border)] px-2.5 text-xs text-[var(--muted-foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]">none</button>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
