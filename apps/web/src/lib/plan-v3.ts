import type { ChecklistItemData, HabitData, ProductData } from "@/lib/vault-types";

/**
 * Plan v3 rules, pure: quarter tabs, goals grouped by product, habits under goals, the week's ticks, the compass line.
 * Nothing here talks to the API.
 */

/** "2026-Q4" -> "2027-Q1". */
export function nextQuarter(q: string): string {
  const year = Number(q.slice(0, 4));
  const n = Number(q.slice(-1));
  return n === 4 ? `${year + 1}-Q1` : `${year}-Q${n + 1}`;
}

/** The quarter a date ("YYYY-MM-DD") falls in. */
export const quarterOf = (day: string): string => `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;

const qText = (q: string): string => `${q.slice(5)}'${q.slice(2, 4)}`;

/** "Q4'26" for the current quarter (or an earlier one), "Q1'27 · next" for the quarter right after the current one, a bare label for the rest. */
export function tabLabel(q: string, current: string): string {
  return q === nextQuarter(current) ? `${qText(q)} · next` : qText(q);
}

/**
 * The tabs: the quarters the API lists (this one, the next, any later one with goals), plus the one the owner just opened with
 * "+" (`extra`), in order, without duplicates; and the quarter "+" opens next (the one after the last tab).
 */
export function quarterTabs(current: string, listed: string[] | undefined, extra: string[] = []): { tabs: string[]; plus: string } {
  const tabs = [...new Set([current, nextQuarter(current), ...(listed ?? []), ...extra])].filter((q) => q >= current).sort();
  return { tabs, plus: nextQuarter(tabs[tabs.length - 1]) };
}

/** The first sentence of the mission, for the one-line compass. A text with no full stop is returned whole. */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = /^([\s\S]+?[.!?])(?:\s|$)/.exec(t);
  return m ? m[1] : t;
}

export interface GoalGroup { product: ProductData | null; goals: ChecklistItemData[] }

/**
 * Goals under small product headings: the block's products in their order, then "no product". A goal whose product is not
 * (or no longer) one of `products` counts as no product. Empty groups are left out.
 */
export function groupGoals(goals: ChecklistItemData[], products: ProductData[]): GoalGroup[] {
  const known = new Set(products.map((p) => p.slug));
  const groups: GoalGroup[] = [...products].sort((a, b) => a.position - b.position || a.id - b.id)
    .map((product) => ({ product, goals: goals.filter((g) => g.product === product.slug) }));
  groups.push({ product: null, goals: goals.filter((g) => !g.product || !known.has(g.product)) });
  return groups.filter((g) => g.goals.length > 0);
}

/** The tag a product stands for: lowercase, runs of anything but letters and digits as one dash ("Home Lab" -> "home-lab"). */
export const tagSlug = (tag: string): string => tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");

/** The slugs of the block's products a task carries among its tags (other tags are plain tags). */
export function taskProducts(tags: string[] | undefined, products: ProductData[]): string[] {
  const known = new Set(products.map((p) => p.slug));
  return [...new Set((tags ?? []).map(tagSlug).filter((s) => known.has(s)))];
}

/** Tags that are not products of the block. */
export const plainTags = (tags: string[] | undefined, products: ProductData[]): string[] => {
  const known = new Set(products.map((p) => p.slug));
  return (tags ?? []).filter((t) => !known.has(tagSlug(t)));
};

/** Monday of the week of a day, "YYYY-MM-DD". */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Days checked (done or its minimum, as the habit board counts them) in the week of `today`. */
export function weekChecks(h: Pick<HabitData, "days">, today: string): number {
  const start = weekStart(today);
  return Object.keys(h.days ?? {}).filter((d) => d >= start && d <= today).length;
}

/** A habit's Plan block: the API's `plan_block`; older answers fall back to `stream`. */
export const planBlockOf = (h: Pick<HabitData, "stream" | "plan_block">): string | null => (h.plan_block !== undefined ? h.plan_block : h.stream) ?? null;

/** Habits shown in the Plan: live ones whose Plan block is one of `blocks`. */
export function planHabits(habits: HabitData[], blocks: string[]): HabitData[] {
  return habits.filter((h) => {
    const b = planBlockOf(h);
    return h.stage !== "retired" && b !== null && blocks.includes(b);
  });
}

/** What a Make it a habit loses, in words, for the confirmation (the habit keeps its name, block, goal; short details become its minimum). */
export function habitLoss(item: { description?: string; products?: string[]; subtasks?: number }): string[] {
  const note = (item.description ?? "").replace(/\s+/g, " ").trim();
  const out: string[] = [];
  if (note.length > 120) out.push("its details");
  if ((item.subtasks ?? 0) > 0) out.push(`${item.subtasks} sub-task${item.subtasks === 1 ? "" : "s"}`);
  if ((item.products ?? []).length > 0) out.push(`its tag${(item.products ?? []).length === 1 ? "" : "s"} (${(item.products ?? []).map((t) => `#${t}`).join(" ")})`);
  return out;
}

export interface HabitsByGoal {
  /** Habit lists keyed by goal id, for the goals in `goalIds` (the selected quarter's). */
  byGoal: Map<string, HabitData[]>;
  /** Linked to a goal of an earlier quarter, or one that was removed. */
  ended: HabitData[];
  /** Linked to a goal that no longer exists (removed): shown with a hint to re-link. */
  removed: HabitData[];
  /** Linked to no goal (a goal of another tab's quarter is not listed here: it shows with its goal there). */
  loose: HabitData[];
}

/**
 * Splits a block's habits for the block cell. `shown` = the goal ids on the selected tab, `endedIds` = goals of quarters that have
 * ended, `otherIds` = goals of other tabs' quarters (a habit linked there is not shown here, not even as loose).
 */
export function habitsByGoal(habits: HabitData[], shown: string[], endedIds: string[], otherIds: string[] = []): HabitsByGoal {
  const byGoal = new Map<string, HabitData[]>();
  const ended: HabitData[] = [];
  const removed: HabitData[] = [];
  const loose: HabitData[] = [];
  for (const h of habits) {
    const ref = h.goal_ref ?? null;
    if (ref && shown.includes(ref)) byGoal.set(ref, [...(byGoal.get(ref) ?? []), h]);
    else if (ref && endedIds.includes(ref)) ended.push(h);
    else if (!ref) loose.push(h);
    else if (!otherIds.includes(ref)) removed.push(h);
  }
  return { byGoal, ended, removed, loose };
}

/** Gate progress for the mini bar: weeks at the gate over the weeks it takes, 0-100. */
export const gateShare = (h: Pick<HabitData, "gate_run" | "gate_weeks">): number => Math.min(100, Math.round((100 * h.gate_run) / h.gate_weeks));

/** "wk 6/8" for a habit that is still installing; rails and retired habits have no week count. */
export const weekLabel = (h: Pick<HabitData, "gate_run" | "gate_weeks" | "stage">): string =>
  h.stage === "installing" ? `wk ${Math.min(h.gate_run, h.gate_weeks)}/${h.gate_weeks}` : "";

/** How many tasks and goals lose the tag when a product is deleted: the sentence the confirmation shows. */
export function deleteWarning(p: Pick<ProductData, "name" | "tasks" | "goals">): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return `Delete ${p.name}? ${plural(p.tasks, "task")} and ${plural(p.goals, "goal")} lose the tag; nothing else is deleted.`;
}
