"use client";

import { useState } from "react";
import { SettingsSection, FIELD, MICRO } from "@/components/settings/section";
import { colorVar } from "@/lib/streams";
import { BlockConfig } from "@/lib/vault-types";

export const COLOR_KEYS = ["emerald", "amber", "violet", "fuchsia", "cyan", "rose", "slate", "teal", "orange", "indigo", "lime", "sky"];

function newKey(blocks: BlockConfig[]): string {
  const taken = new Set(blocks.map((b) => b.key));
  if (!taken.has("new-block")) return "new-block";
  let n = 2;
  while (taken.has(`new-block-${n}`)) n++;
  return `new-block-${n}`;
}

interface Props {
  blocks: BlockConfig[];
  onChange: (blocks: BlockConfig[]) => void;
  /** Keys the weekly schedule still uses: those cannot be archived. */
  usedKeys: ReadonlySet<string>;
}

/** The parts of your day. A block shows on the clock when the schedule uses it, and takes stars when "Stars" is on. */
export function BlocksSection({ blocks, onChange, usedKeys }: Props) {
  const [picking, setPicking] = useState<string | null>(null);
  const active = blocks.filter((b) => !b.archived);
  const archived = blocks.filter((b) => b.archived);

  const update = (key: string, patch: Partial<BlockConfig>) => onChange(blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  function move(key: string, dir: -1 | 1) {
    const i = blocks.findIndex((b) => b.key === key);
    const indexes = blocks.map((b, n) => (b.archived ? -1 : n)).filter((n) => n >= 0);
    const at = indexes.indexOf(i);
    const target = indexes[at + dir];
    if (target === undefined) return;
    const next = [...blocks];
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  }
  function add() {
    const used = new Set(blocks.map((b) => b.color));
    const color = COLOR_KEYS.find((c) => !used.has(c)) ?? COLOR_KEYS[blocks.length % COLOR_KEYS.length];
    const at = blocks.findIndex((b) => b.archived);
    const fresh: BlockConfig = { key: newKey(blocks), label: "New block", ring_name: "NEW", color, counts_for_stars: true, archived: false };
    onChange(at < 0 ? [...blocks, fresh] : [...blocks.slice(0, at), fresh, ...blocks.slice(at)]);
  }

  return (
    <SettingsSection id="blocks" title="Blocks" aside={`${active.length} active · ${active.filter((b) => b.counts_for_stars).length} count for stars`}>
      <p className="mb-2 max-w-[62ch] text-sm text-[var(--muted-foreground)]">A block is a part of your day. It shows on the clock when the schedule uses it, and you give it stars when &quot;Stars&quot; is on. Archived blocks keep your history readable.</p>
      <ul>
        {active.map((b, i) => (
          <li key={b.key} className="border-t border-[var(--border)] first:border-t-0">
            <div className="grid grid-cols-[auto_auto_minmax(0,1.4fr)_minmax(4.5rem,.6fr)_auto_auto] items-center gap-2 py-1.5 max-sm:grid-cols-[auto_auto_minmax(0,1fr)_auto]">
              <span className="flex flex-col">
                <button type="button" disabled={i === 0} onClick={() => move(b.key, -1)} aria-label={`Move ${b.label} up`} className="px-1 text-[0.625rem] leading-none text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-30">▲</button>
                <button type="button" disabled={i === active.length - 1} onClick={() => move(b.key, 1)} aria-label={`Move ${b.label} down`} className="px-1 text-[0.625rem] leading-none text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-30">▼</button>
              </span>
              <button type="button" aria-label={`Colour of ${b.label}`} onClick={() => setPicking(picking === b.key ? null : b.key)}
                className="h-[1.375rem] w-[1.375rem] rounded-full border-2 border-[var(--surface)] shadow-[0_0_0_1px_var(--border)]" style={{ background: colorVar(b.color) }} />
              <input className={FIELD} value={b.label} aria-label="Block name" aria-invalid={!b.label.trim()} onChange={(e) => update(b.key, { label: e.target.value })} />
              <input className={`${FIELD} font-mono max-sm:col-start-3`} value={b.ring_name} maxLength={6} aria-label="Short name on the clock" onChange={(e) => update(b.key, { ring_name: e.target.value.toUpperCase() })} />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--muted-foreground)]">
                <input type="checkbox" checked={b.counts_for_stars} onChange={(e) => update(b.key, { counts_for_stars: e.target.checked })} /> Stars
              </label>
              <button type="button" disabled={usedKeys.has(b.key)} title={usedKeys.has(b.key) ? "Still on your schedule: remove those rows first" : undefined}
                onClick={() => update(b.key, { archived: true })} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-40">Archive</button>
            </div>
            {picking === b.key && (
              <div role="group" aria-label="Pick a colour" className="flex flex-wrap gap-1.5 pb-2 pl-9">
                {COLOR_KEYS.map((c) => (
                  <button key={c} type="button" aria-label={c} aria-pressed={b.color === c} onClick={() => { update(b.key, { color: c }); setPicking(null); }}
                    className="h-5 w-5 rounded-full border-2 border-[var(--surface)] shadow-[0_0_0_1px_var(--border)] aria-pressed:shadow-[0_0_0_2px_var(--foreground)]" style={{ background: colorVar(c) }} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <button type="button" onClick={add} className="mt-2 min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--muted)]">Add block</button>
      {archived.length > 0 && (
        <div className="mt-4">
          <p className={`${MICRO} mb-1`}>Archived</p>
          <ul>
            {archived.map((b) => (
              <li key={b.key} className="flex items-center gap-2 border-t border-[var(--border)] py-1.5 text-sm opacity-75 first:border-t-0">
                <span className="h-[1.125rem] w-[1.125rem] rounded-full" style={{ background: colorVar(b.color) }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{b.label} <span className="ml-1 rounded bg-[var(--muted)] px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-[0.05em] text-[var(--muted-foreground)]">history only</span></span>
                <button type="button" onClick={() => update(b.key, { archived: false })} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)]">Restore</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsSection>
  );
}
