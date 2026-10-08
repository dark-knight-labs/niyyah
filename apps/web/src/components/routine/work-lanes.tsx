"use client";

import { useMemo, useState } from "react";
import { Checkbox } from "@/components/routine/checkbox";
import { Section } from "@/components/routine/section";
import { StreamMeta, toMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { Lane, NotebooksData, PipelineItemData, PipelinesData } from "@/lib/vault-types";

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
    <li className="group flex min-h-8 items-center gap-1.5 rounded-md px-1 hover:bg-[var(--muted)]">
      {tick ? (
        <Checkbox checked={false} disabled={busy} label={`Done: ${r.item.text}`} onChange={() => void onMove(r, "done")} />
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.meta.color }} aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 break-words text-[13px] leading-snug">{r.item.text}</span>
      {r.item.product && <span className="shrink-0 rounded bg-[var(--muted)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.05em] text-[var(--muted-foreground)]">{r.item.product}</span>}
      {r.item.focus === week && <span className="text-[11px] font-bold" style={{ color: r.meta.color }} title="This week's focus">★</span>}
      {r.blocked && <span className="text-[10px] font-bold uppercase text-[var(--destructive)]">blocked</span>}
      <button type="button" disabled={busy} onClick={() => void onMove(r, to)} aria-label={`Move to ${toLabel}: ${r.item.text}`}
        className="min-h-8 shrink-0 whitespace-nowrap rounded px-1.5 text-[11px] font-semibold text-[var(--muted-foreground)] hover:bg-[var(--border)] hover:text-[var(--foreground)] disabled:opacity-50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100">
        → {toLabel}
      </button>
    </li>
  );
}

const TH = "px-2.5 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-[0.09em] text-[var(--muted-foreground)]";
const TD = "border-t border-[var(--border)] px-2.5 py-1.5 align-top";

/** Now, Next and Someday for every block, one table row per block. Someday is the pipeline's Backlog lane under another name. */
export function WorkLanes({ data, notebooks, ot, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allSomeday, setAllSomeday] = useState(false);
  /** Per block, the product its items are narrowed to (blocks without products never have one). */
  const [product, setProduct] = useState<Record<string, string | null>>({});

  const blocks = useMemo(() => {
    const list = data.streams.map((s) => {
      const meta = toMeta(s);
      const open = new Set(
        (notebooks?.streams.find((n) => n.stream === s.stream)?.entries ?? [])
          .filter((e) => e.kind === "blocker" && e.open && e.id)
          .map((e) => e.id as string),
      );
      // Array.prototype.sort is stable, so the vault's own order holds inside each lane; this week's focus goes first.
      const rows: Row[] = s.items
        .map((item) => ({ stream: s.stream, meta, item, blocked: item.blocked_by.some((id) => open.has(id)) }))
        .sort((a, b) => Number(b.item.focus === data.week) - Number(a.item.focus === data.week));
      return { id: s.stream, meta, rows };
    });
    // The block that owns today's OT slot leads.
    return list.sort((a, b) => Number(b.id === ot) - Number(a.id === ot));
  }, [data, notebooks, ot]);

  const count = (l: Lane) => blocks.reduce((n, b) => n + b.rows.filter((r) => r.item.lane === l).length, 0);

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

  const otLabel = blocks.find((b) => b.id === ot)?.meta.label;
  const dash = <span className="text-[var(--border)]" aria-label="empty">·</span>;
  const cell = (rows: Row[], to: Lane, toLabel: string, tick?: boolean) =>
    rows.length === 0 ? dash : (
      <ul>{rows.map((r) => <Item key={`${r.stream}:${r.item.line}`} r={r} week={data.week} busy={busy} onMove={move} to={to} toLabel={toLabel} tick={tick} />)}</ul>
    );

  return (
    <Section title="Work" aside={otLabel ? `by block · ${otLabel} has OT today` : "by block"} error={error}>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full min-w-[760px] table-fixed border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-36`}>Block</th>
              <th className={TH}>Now <span className="ml-1 font-mono font-medium normal-case tracking-normal">{count("now")}</span></th>
              <th className={TH}>Next <span className="ml-1 font-mono font-medium normal-case tracking-normal">{count("next")}</span></th>
              <th className={TH}>Someday <span className="ml-1 font-mono font-medium normal-case tracking-normal">{count("backlog")}</span></th>
            </tr>
          </thead>
          <tbody>
            {blocks.map(({ id, meta, rows: all }) => {
              const products = [...new Set(all.map((r) => r.item.product).filter((p): p is string => !!p))];
              const picked = product[id] && products.includes(product[id] as string) ? product[id] : null;
              const rows = picked ? all.filter((r) => r.item.product === picked) : all;
              const by = (l: Lane) => rows.filter((r) => r.item.lane === l);
              const parked = by("backlog");
              return (
                <tr key={id} className={id === ot ? "bg-[var(--accent-light)]" : ""}>
                  <th scope="row" className={`${TD} text-left text-xs font-bold`}>
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: meta.color }} aria-hidden="true" />{meta.label}
                    {id === ot && <span className="mt-1 block w-fit rounded bg-[var(--surface)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.05em] text-[var(--accent)]">OT today</span>}
                    {products.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={`${meta.label} products`}>
                        {products.map((p) => (
                          <button key={p} type="button" aria-pressed={picked === p} onClick={() => setProduct((cur) => ({ ...cur, [id]: picked === p ? null : p }))}
                            className="min-h-6 rounded-full border border-[var(--border)] px-2 text-[10px] font-semibold text-[var(--muted-foreground)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]">
                            {p}
                          </button>
                        ))}
                      </span>
                    )}
                  </th>
                  <td className={TD}>{cell(by("now"), "next", "Next", true)}</td>
                  <td className={TD}>{cell(by("next"), "now", "Now")}</td>
                  <td className={TD}>
                    {parked.length === 0 ? dash : allSomeday ? cell(parked, "next", "Next") : <span className="text-xs text-[var(--muted-foreground)]">{parked.length} parked</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {count("backlog") > 0 && (
        <button type="button" onClick={() => setAllSomeday((v) => !v)} aria-expanded={allSomeday}
          className="mt-1 min-h-9 text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          {allSomeday ? "▾ Hide Someday" : "▸ Show all Someday"}
        </button>
      )}
    </Section>
  );
}
