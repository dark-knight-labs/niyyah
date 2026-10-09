"use client";

import { useMemo, useState } from "react";
import { Draft } from "@/components/settings/types";
import { CHIP, FIELD, MICRO, SettingsSection } from "@/components/settings/section";
import { ringGeometry } from "@/lib/ring";
import { ResolvedBlock, ScheduleMeta, computePrayerMinutes, findOverlaps, hasLocation, resolveTime } from "@/lib/routine";
import { colorVar } from "@/lib/streams";
import { BlockConfig, ScheduleRowIn } from "@/lib/vault-types";

type Tab = "weekday" | "weekend";
const EXAMPLE_PRAYERS: Record<string, number> = { fajr: 292, sunrise: 369, dhuhr: 724, asr: 927, maghrib: 1079, isha: 1155 };

function anchorsFor(meta: ScheduleMeta): { anchors: Record<string, number>; example: boolean } {
  if (hasLocation(meta)) {
    try {
      const { prayers, sunrise } = computePrayerMinutes(meta, new Date());
      return { anchors: { ...prayers, sunrise }, example: false };
    } catch {
      // an unknown time zone or method: fall through to the example times and let Save report the real problem
    }
  }
  return { anchors: EXAMPLE_PRAYERS, example: true };
}

interface Props {
  draft: Draft;
  streams: { id: string; label: string }[];
  onChange: (patch: Partial<Draft>) => void;
}

/** The weekday and weekend layouts, with a live clock so a change is visible before you save it. */
export function ScheduleSection({ draft, streams, onChange }: Props) {
  const [tab, setTab] = useState<Tab>("weekday");
  const rows = draft[tab];
  const byKey = useMemo(() => new Map(draft.blocks.map((b) => [b.key, b])), [draft.blocks]);
  const choices = draft.blocks.filter((b) => !b.archived);
  const setRows = (next: ScheduleRowIn[]) => onChange({ [tab]: next } as Partial<Draft>);
  const edit = (i: number, patch: Partial<ScheduleRowIn>) => setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const { anchors, example } = useMemo(() => anchorsFor(draft.meta as ScheduleMeta), [draft.meta]);
  const { slices, problems } = useMemo(() => {
    const out: { block: BlockConfig | undefined; row: ScheduleRowIn; startMin: number; endMin: number }[] = [];
    const bad: string[] = [];
    rows.forEach((row, i) => {
      try {
        const startMin = resolveTime(row.start.trim().toLowerCase(), anchors);
        let endMin = resolveTime(row.end.trim().toLowerCase(), anchors);
        if (endMin <= startMin) endMin += 1440;
        out.push({ block: byKey.get(row.block), row, startMin, endMin });
      } catch {
        bad.push(`Row ${i + 1}: "${row.start}" to "${row.end}" is not a time`);
      }
    });
    const asBlocks: ResolvedBlock[] = out.map((o) => ({ block: o.block?.label ?? o.row.block, startMin: o.startMin, endMin: o.endMin, what: o.row.what, stream: o.row.stream }));
    return { slices: out, problems: [...bad, ...findOverlaps(asBlocks)] };
  }, [rows, anchors, byKey]);

  const cx = 130, cy = 130, R = 92;
  const g = ringGeometry(cx, cy, R);
  const used = [...new Set(slices.map((s) => s.row.block))];

  return (
    <SettingsSection id="schedule" title="Weekly schedule" aside={
      <span className="flex gap-1.5" role="group" aria-label="Day type">
        {(["weekday", "weekend"] as Tab[]).map((t) => (
          <button key={t} type="button" className={CHIP} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === "weekday" ? "Weekday" : "Weekend"}</button>
        ))}
      </span>
    }>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <div className="min-w-0">
          <div className="hidden grid-cols-[minmax(6rem,1.1fr)_7.25rem_7.25rem_minmax(5.5rem,1.4fr)_minmax(6rem,1fr)_auto] gap-1.5 pb-0.5 sm:grid" aria-hidden="true">
            {["Block", "Start", "End", "What", "Stream", ""].map((h) => <span key={h} className={MICRO}>{h}</span>)}
          </div>
          {rows.length === 0 && <p className="py-2 text-sm text-[var(--muted-foreground)]">No rows yet. Add one.</p>}
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] items-center gap-1.5 py-1 sm:grid-cols-[minmax(6rem,1.1fr)_7.25rem_7.25rem_minmax(5.5rem,1.4fr)_minmax(6rem,1fr)_auto]">
              <select className={FIELD} aria-label="Block" value={r.block} onChange={(e) => edit(i, { block: e.target.value })}>
                {choices.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                {!choices.some((b) => b.key === r.block) && <option value={r.block}>{byKey.get(r.block)?.label ?? r.block} (archived)</option>}
              </select>
              <input className={`${FIELD} font-mono`} aria-label="Start" value={r.start} onChange={(e) => edit(i, { start: e.target.value })} />
              <input className={`${FIELD} font-mono`} aria-label="End" value={r.end} onChange={(e) => edit(i, { end: e.target.value })} />
              <input className={`${FIELD} col-span-3 sm:col-span-1`} aria-label="What" value={r.what} onChange={(e) => edit(i, { what: e.target.value })} />
              <select className={`${FIELD} col-span-2 sm:col-span-1`} aria-label="Stream" value={r.stream ?? ""} onChange={(e) => edit(i, { stream: e.target.value || null })}>
                <option value="">No stream</option>
                {streams.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                {r.stream && !streams.some((s) => s.id === r.stream) && <option value={r.stream}>{r.stream}</option>}
              </select>
              <button type="button" onClick={() => setRows(rows.filter((_, n) => n !== i))} aria-label="Remove row" className="min-h-8 rounded-lg px-2 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--muted)]">Remove</button>
            </div>
          ))}
          <button type="button" disabled={choices.length === 0} onClick={() => setRows([...rows, { block: choices[0]?.key ?? "", start: "09:00", end: "10:00", what: "", stream: null }])}
            className="mt-2 min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--muted)] disabled:opacity-50">Add row</button>
          <p className="mt-2 max-w-[62ch] text-xs text-[var(--muted-foreground)]">
            Times are 24h <span className="font-mono">HH:MM</span> or a prayer with an offset, like <span className="font-mono">fajr+10</span> or <span className="font-mono">maghrib-15</span>.
            A stream on a row makes it the owner of that slot on the Overview.
          </p>
          {problems.length > 0 && <div className="mt-2 rounded-lg bg-[var(--warn)]/10 px-2.5 py-1.5 text-xs text-[var(--warn)]">{problems.map((p, i) => <p key={`${i}-${p}`}>{p}</p>)}</div>}
        </div>
        <div className="mx-auto w-full max-w-[16rem] text-center lg:sticky lg:top-3">
          <svg viewBox="0 0 260 260" role="img" aria-label="Preview of the 24 hour clock" className="h-auto w-full">
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--muted)" strokeWidth={22} />
            {slices.map((s, i) => <path key={i} d={g.arc(s.startMin, s.endMin)} fill="none" stroke={colorVar(s.block?.color ?? "slate")} strokeWidth={22} opacity={0.92} />)}
            {Object.entries(anchors).filter(([n]) => n !== "sunrise").map(([n, m]) => { const [x, y] = g.point(R + 19, m); return <circle key={n} cx={x} cy={y} r={2.6} fill="var(--foreground)" />; })}
            {[0, 6, 12, 18].map((h) => { const [x, y] = g.point(R - 26, h * 60); return <text key={h} x={x} y={y + 3.5} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)" fontFamily="var(--font-mono)">{String(h).padStart(2, "0")}</text>; })}
            <text x={cx} y={cy - 2} textAnchor="middle" fontSize={22} fill="var(--foreground)" fontFamily="var(--font-serif)">{tab === "weekday" ? "Weekday" : "Weekend"}</text>
            <text x={cx} y={cy + 16} textAnchor="middle" fontSize={10.5} fill="var(--muted-foreground)">{slices.length} slots{example ? " · example prayers" : ""}</text>
          </svg>
          <ul className="flex flex-wrap justify-center gap-x-2.5 gap-y-1 text-small text-[var(--muted-foreground)]">
            {used.map((k) => <li key={k}><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorVar(byKey.get(k)?.color ?? "slate") }} />{byKey.get(k)?.ring_name ?? k}</li>)}
          </ul>
        </div>
      </div>
    </SettingsSection>
  );
}
