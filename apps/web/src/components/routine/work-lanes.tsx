"use client";

import { useMemo, useState } from "react";
import { Checkbox } from "@/components/routine/checkbox";
import { Section } from "@/components/routine/section";
import { StreamMeta, toMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { Lane, NotebooksData, PipelineItemData, PipelinesData } from "@/lib/vault-types";

const NEXT_SHOWN = 5;

interface Row {
  stream: string;
  meta: StreamMeta;
  item: PipelineItemData;
  blocked: boolean;
}

interface Props {
  data: PipelinesData;
  /** Used to tell a cleared blocker from an open one; without it no item shows as blocked. */
  notebooks: NotebooksData | null;
  /** The stream that owns today's OT slot; its items are listed first. */
  ot: string | undefined;
  onChanged: () => void;
}

interface ItemProps {
  r: Row;
  to: Lane;
  toLabel: string;
  tick?: boolean;
  week: string;
  busy: boolean;
  onMove: (r: Row, to: Lane) => Promise<void>;
}

function Item({ r, to, toLabel, tick, week, busy, onMove }: ItemProps) {
  return (
    <li className="flex min-h-11 items-center gap-2 border-b border-[var(--border)] py-0.5">
      {tick ? (
        <Checkbox checked={false} disabled={busy} label={`Done: ${r.item.text}`} onChange={() => void onMove(r, "done")} />
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.meta.color }} aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 break-words text-sm">
        {r.item.text} <span className="text-xs text-[var(--muted-foreground)]">{r.meta.label}</span>
      </span>
      {r.item.focus === week && <span className="text-[11px] font-bold" style={{ color: r.meta.color }}>★ week</span>}
      {r.blocked && <span className="text-[11px] font-bold text-[var(--destructive)]">blocked</span>}
      <button type="button" disabled={busy} onClick={() => void onMove(r, to)} aria-label={`Move to ${toLabel}: ${r.item.text}`}
        className="min-h-9 shrink-0 rounded-md px-2 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50">
        → {toLabel}
      </button>
    </li>
  );
}

function Head({ title, count }: { title: string; count: number }) {
  return (
    <h3 className="mb-1 flex items-baseline justify-between border-b border-[var(--border)] pb-2 text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
      {title}<span className="font-medium normal-case tracking-normal tabular-nums">{count}</span>
    </h3>
  );
}

/** Now, Next and Someday across every block. Someday is the pipeline's Backlog lane under another name. */
export function WorkLanes({ data, notebooks, ot, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allSomeday, setAllSomeday] = useState(false);

  const rows = useMemo(() => {
    const all: Row[] = data.streams.flatMap((s) => {
      const meta = toMeta(s);
      const open = new Set(
        (notebooks?.streams.find((n) => n.stream === s.stream)?.entries ?? [])
          .filter((e) => e.kind === "blocker" && e.open && e.id)
          .map((e) => e.id as string),
      );
      return s.items.map((item) => ({ stream: s.stream, meta, item, blocked: item.blocked_by.some((id) => open.has(id)) }));
    });
    // Array.prototype.sort is stable, so the vault's own order holds inside each group.
    const rank = (r: Row) => (r.stream === ot ? 0 : 2) + (r.item.focus === data.week ? 0 : 1);
    return all.sort((a, b) => rank(a) - rank(b));
  }, [data, notebooks, ot]);

  const lane = (l: Lane) => rows.filter((r) => r.item.lane === l);
  const now = lane("now");
  const next = lane("next");
  const someday = lane("backlog");

  async function move(r: Row, to: Lane) {
    setError(null);
    setBusy(true);
    try {
      await vaultApi.movePipelineItem(r.stream, r.item, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  const otLabel = rows.find((r) => r.stream === ot)?.meta.label;

  const empty = (text: string) => <p className="py-2 text-sm text-[var(--muted-foreground)]">{text}</p>;

  return (
    <Section title="Work" aside={otLabel ? `all blocks · ${otLabel} has OT today` : "all blocks"} error={error}>
      <div className="grid gap-8 md:grid-cols-3">
        <div>
          <Head title="Now" count={now.length} />
          {now.length === 0 ? empty("Nothing in Now.") : <ul>{now.map((r) => <Item key={`${r.stream}:${r.item.line}`} r={r} week={data.week} busy={busy} onMove={move} to="next" toLabel="Next" tick />)}</ul>}
        </div>
        <div>
          <Head title="Next" count={next.length} />
          {next.length === 0 ? empty("Nothing queued.") : <ul>{next.slice(0, NEXT_SHOWN).map((r) => <Item key={`${r.stream}:${r.item.line}`} r={r} week={data.week} busy={busy} onMove={move} to="now" toLabel="Now" />)}</ul>}
          {next.length > NEXT_SHOWN && <p className="py-2 text-xs text-[var(--muted-foreground)]">+ {next.length - NEXT_SHOWN} more in the pipelines</p>}
        </div>
        <div>
          <Head title="Someday" count={someday.length} />
          {someday.length === 0 ? empty("Nothing parked.") : allSomeday ? (
            <ul>{someday.map((r) => <Item key={`${r.stream}:${r.item.line}`} r={r} week={data.week} busy={busy} onMove={move} to="next" toLabel="Next" />)}</ul>
          ) : empty(`${someday.length} parked.`)}
          {someday.length > 0 && (
            <button type="button" onClick={() => setAllSomeday((v) => !v)} aria-expanded={allSomeday}
              className="min-h-9 text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              {allSomeday ? "▾ Hide" : "▸ Show all"}
            </button>
          )}
        </div>
      </div>
    </Section>
  );
}
