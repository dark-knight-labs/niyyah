"use client";

import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { Checklist } from "@/components/planner/checklist";
import { HabitLine, RunHabits } from "@/components/planner/plan-habits";
import { Checkbox } from "@/components/routine/checkbox";
import { GoalRef, nestedCount, quarterText } from "@/lib/plan-v2";
import { deleteWarning, groupGoals, habitsByGoal } from "@/lib/plan-v3";
import { StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { ChecklistItemData, HabitData, PipelineItemData, ProductData } from "@/lib/vault-types";

type Run = (action: () => Promise<unknown>) => Promise<boolean>;

const chip = "mono min-h-6 border border-[var(--rule)] px-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]";
const link = "mono text-[var(--accent)] hover:underline";
const input = "min-w-0 border border-[var(--rule)] bg-[var(--background)] px-1.5 py-1 text-small outline-none focus:border-[var(--accent)]";

/** Products of a block, inline: chips with add, rename and delete. Delete asks first and says how many tasks and goals lose the tag. */
function ProductsEditor({ stream, products, busy, run }: { stream: StreamMeta; products: ProductData[]; busy: boolean; run: Run }) {
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [asking, setAsking] = useState<ProductData | null>(null);

  async function ask(p: ProductData) {
    // The pipelines read carries no usage counts; the products list does.
    const fresh = (await vaultApi.products(stream.id).catch(() => ({ products: [] }))).products.find((x) => x.id === p.id);
    setAsking(fresh ?? p);
  }

  return (
    <div className="mt-1.5 grid gap-1.5 border border-[var(--border)] p-2" role="group" aria-label={`Products of ${stream.label}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {products.length === 0 && <span className="text-xs text-[var(--muted-foreground)]">No products yet.</span>}
        {products.map((p) => (
          <span key={p.id} data-product={p.slug} className="mono inline-flex items-center border border-[var(--rule)]">
            {renaming?.id === p.id ? (
              <input autoFocus value={renaming.name} maxLength={60} aria-label={`New name for ${p.name}`} onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                onBlur={() => {
                  const next = renaming.name.trim();
                  if (next && next !== p.name) void run(() => vaultApi.renameProduct(p.id, next)).then((ok) => ok && setRenaming(null));
                  else setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setRenaming(null);
                  if (e.key === "Enter" && renaming.name.trim()) void run(() => vaultApi.renameProduct(p.id, renaming.name)).then((ok) => ok && setRenaming(null));
                }} className={`${input} w-28`} />
            ) : <span className="px-1.5 py-0.5">{p.name}</span>}
            <button type="button" disabled={busy} aria-label={`Rename ${p.name}`} onClick={() => setRenaming({ id: p.id, name: p.name })} className="px-1 py-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><Pencil size={10} aria-hidden="true" /></button>
            <button type="button" disabled={busy} aria-label={`Delete ${p.name}`} onClick={() => void ask(p)} className="px-1 py-0.5 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"><X size={11} aria-hidden="true" /></button>
          </span>
        ))}
      </div>
      {asking && (
        <div role="alertdialog" aria-label={`Delete ${asking.name}?`} className="grid gap-1 border border-[var(--destructive)] bg-[var(--warn-light)] p-2 text-xs">
          <p>{deleteWarning(asking)}</p>
          <span className="flex gap-3">
            <button type="button" disabled={busy} className="mono text-[var(--destructive)] hover:underline" onClick={() => void run(() => vaultApi.deleteProduct(asking.id)).then((ok) => ok && setAsking(null))}>Delete product</button>
            <button type="button" className={link} onClick={() => setAsking(null)}>Keep</button>
          </span>
        </div>
      )}
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void run(() => vaultApi.addProduct(stream.id, draft)).then((ok) => ok && setDraft("")); }}>
        <input value={draft} maxLength={60} aria-label={`New product for ${stream.label}`} placeholder="+ product" onChange={(e) => setDraft(e.target.value)} className={`${input} flex-1`} />
        <button type="submit" disabled={busy || !draft.trim()} className={`${chip} disabled:opacity-40`}>Add</button>
      </form>
    </div>
  );
}

interface Props {
  stream: StreamMeta;
  /** The quarter tab that is open, and the real current quarter. */
  quarter: string;
  currentQuarter: string;
  /** The goal lines of the block in the open quarter. */
  lines: ChecklistItemData[];
  /** Every goal the block's tasks can nest under (any quarter), to name the ended goals of habits. */
  goalRefs: GoalRef[];
  products: ProductData[];
  items: PipelineItemData[];
  habits: HabitData[];
  focus: string | null;
  onFocus: (id: string | null) => void;
  nowN: number;
  nowLimit: number;
  stuck: { id: string; title: string }[];
  onStuck: () => void;
  onEdit: () => void;
  pickedHabit: number | null;
  onPickHabit: (id: number) => void;
  busy: boolean;
  run: Run;
  runHabits: RunHabits;
}

/** The Block column cell: the block's goals of the open quarter under product headings, each with its habits, then products and habits with no goal. */
export function BlockCell({ stream, quarter, currentQuarter, lines, goalRefs, products, items, habits, focus, onFocus, nowN, nowLimit, stuck, onStuck, onEdit, pickedHabit, onPickHabit, busy, run }: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftProduct, setDraftProduct] = useState("");
  const [editingGoals, setEditingGoals] = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const q = quarterText(quarter);
  const isCurrent = quarter === currentQuarter;

  const asLines = (list: ChecklistItemData[]) => list.map((l) => ({ id: l.id, text: l.text, done: l.done, ...(l.product ? { product: l.product } : {}) }));
  const save = (next: { id?: string; text: string; done?: boolean; product?: string | null }[]) => run(() => vaultApi.setPlanGoals(stream.id, quarter, next));
  const tick = (id: string, done: boolean) => (isCurrent ? run(() => vaultApi.tickStreamItem(stream.id, "goal", id, done)) : save(asLines(lines).map((l) => (l.id === id ? { ...l, done } : l))));

  function addGoal() {
    const text = draft.trim();
    if (!text) return;
    void save([...asLines(lines), { text, ...(draftProduct ? { product: draftProduct } : {}) }]).then((ok) => { if (ok) { setDraft(""); setDraftProduct(""); setAdding(false); } });
  }

  const groups = groupGoals(lines, products);
  const headed = groups.length > 1 || (groups[0]?.product ?? null) !== null;
  const endedIds = goalRefs.filter((g) => g.ended).map((g) => g.id);
  const otherIds = goalRefs.filter((g) => !lines.some((l) => l.id === g.id) && !g.ended).map((g) => g.id);
  const split = habitsByGoal(habits, lines.map((l) => l.id), endedIds, otherIds);
  const dimHabit = (h: HabitData) => !!focus && h.goal_ref !== focus;
  const endedGroups = [...new Set(split.ended.map((h) => h.goal_ref as string))];

  return (
    <td className="bg-[var(--surface)] px-3 py-3 align-top">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="h-2 w-2 shrink-0" style={{ background: stream.color }} aria-hidden="true" />
        <b className="text-small font-semibold">{stream.label}</b>
        {nowN > nowLimit && <span className="mono text-[var(--warn)]">Now {nowN}/{nowLimit}</span>}
        {stuck.length > 0 && (
          <button type="button" onClick={onStuck} aria-label={`${stuck.length} blocked in ${stream.label}`} className="mono text-[var(--destructive)] hover:underline">blocked {stuck.length}</button>
        )}
        <button type="button" onClick={onEdit} aria-label={`Edit ${stream.label}`} className={`${link} ml-auto`}>Edit</button>
      </div>

      {editingGoals ? (
        <div className="mt-1.5">
          <Checklist label={`${stream.label} ${q} goals`} items={lines} busy={busy} placeholder={`Add a ${q} goal`}
            onToggle={(item, done) => tick(item.id, done)}
            onChange={(next) => save(next)}
            extra={products.length > 0 ? (item, change) => (
              <select aria-label={`Product of ${item.text}`} value={item.product ?? ""} disabled={busy} onChange={(e) => change({ product: e.target.value || null })}
                className="mono max-w-[6.5rem] shrink-0 border border-[var(--rule)] bg-[var(--background)] px-1 text-xs">
                <option value="">no product</option>
                {products.map((p) => <option key={p.id} value={p.slug}>{p.name}</option>)}
              </select>
            ) : undefined} />
          <button type="button" className={`${link} mt-1`} onClick={() => setEditingGoals(false)}>Done editing goals</button>
        </div>
      ) : (
        <>
          <div className="mt-1.5" role="list" aria-label={`${stream.label} goals`}>
            {groups.map((g) => (
              <div key={g.product?.slug ?? "none"} data-product-group={g.product?.slug ?? ""}>
                {headed && <p className="mono mt-1 truncate text-[var(--muted-foreground)] first:mt-0">{g.product ? g.product.name : "no product"}</p>}
                {g.goals.map((line) => {
                  const n = nestedCount(items, line.id);
                  return (
                    <div key={line.id}>
                      <div role="listitem" data-goal={line.id} className={`flex items-center gap-1.5 border-t border-[var(--border)] py-0.5 first:border-t-0 ${focus === line.id ? "bg-[var(--muted)] shadow-[inset_2px_0_0_var(--accent)]" : ""}`}>
                        <Checkbox checked={line.done} disabled={busy} label={`Goal reached: ${line.text}`} onChange={() => void tick(line.id, !line.done)} />
                        <button type="button" aria-pressed={focus === line.id} title="Show only the tasks nested under this goal" onClick={() => onFocus(focus === line.id ? null : line.id)}
                          className={`min-w-0 flex-1 text-left text-small font-medium leading-snug hover:text-[var(--accent)] ${line.done ? "text-[var(--muted-foreground)] line-through" : ""}`}>{line.text}</button>
                        {n.total > 0 && <span className="mono shrink-0 text-[var(--muted-foreground)]" title="tasks done / nested">{n.done}/{n.total}</span>}
                      </div>
                      {(split.byGoal.get(line.id) ?? []).map((h) => <HabitLine key={h.id} habit={h} picked={pickedHabit === h.id} dim={dimHabit(h)} onPick={() => onPickHabit(h.id)} />)}
                    </div>
                  );
                })}
              </div>
            ))}
            {lines.length === 0 && <p className="text-xs text-[var(--muted-foreground)]">No {q} goal yet.</p>}
            {isCurrent && endedGroups.map((ref) => {
              const goal = goalRefs.find((g) => g.id === ref);
              return (
                <div key={ref} data-habit-ended={ref}>
                  <p className="mono mt-1.5 truncate text-[var(--warn)]">↳ {goal?.text ?? "(removed goal)"} · {quarterText(goal?.quarter ?? currentQuarter)} ended</p>
                  {split.ended.filter((h) => h.goal_ref === ref).map((h) => <HabitLine key={h.id} habit={h} picked={pickedHabit === h.id} dim={dimHabit(h)} warn onPick={() => onPickHabit(h.id)} onRelink={() => onPickHabit(h.id)} />)}
                </div>
              );
            })}
            {isCurrent && split.removed.length > 0 && (
              <div data-habits-removed>
                <p className="mono mt-1.5 truncate text-[var(--warn)]">↳ (removed goal) · re-link</p>
                {split.removed.map((h) => <HabitLine key={h.id} habit={h} picked={pickedHabit === h.id} dim={dimHabit(h)} warn onPick={() => onPickHabit(h.id)} onRelink={() => onPickHabit(h.id)} />)}
              </div>
            )}
            {isCurrent && split.loose.length > 0 && (
              <div data-habits-loose>
                <p className="mono mt-1.5 truncate text-[var(--muted-foreground)]">habits · no goal</p>
                {split.loose.map((h) => <HabitLine key={h.id} habit={h} picked={pickedHabit === h.id} dim={!!focus} onPick={() => onPickHabit(h.id)} />)}
              </div>
            )}
          </div>

          {adding ? (
            <form className="mt-1 grid gap-1" onSubmit={(e) => { e.preventDefault(); addGoal(); }}>
              <div className="flex gap-1">
                <input autoFocus value={draft} maxLength={300} aria-label={`New ${q} goal for ${stream.label}`} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} className={`${input} flex-1`} />
                <button type="submit" disabled={busy || !draft.trim()} className={`${chip} disabled:opacity-40`}>Add</button>
              </div>
              {products.length > 0 && (
                <div role="group" aria-label="Product of the new goal" className="flex flex-wrap gap-1">
                  {[...products.map((p) => [p.slug, p.name] as const), ["", "no product"] as const].map(([slug, name]) => (
                    <button key={slug || "none"} type="button" aria-pressed={draftProduct === slug} onClick={() => setDraftProduct(slug)} className={chip}>{name}</button>
                  ))}
                </div>
              )}
            </form>
          ) : (
            <span className="mt-1 flex flex-wrap gap-x-3">
              <button type="button" className={link} onClick={() => { setAdding(true); setDraft(""); setDraftProduct(""); }}>+ {q} goal</button>
              {lines.length > 0 && <button type="button" className={link} aria-label={`Edit goals of ${stream.label}`} onClick={() => setEditingGoals(true)}>Edit goals</button>}
              <button type="button" className={link} aria-expanded={showProducts} aria-label={`Products of ${stream.label}`} onClick={() => setShowProducts((v) => !v)}>Products{products.length ? ` ${products.length}` : ""}</button>
            </span>
          )}
          {showProducts && <ProductsEditor stream={stream} products={products} busy={busy} run={run} />}
        </>
      )}
    </td>
  );
}
