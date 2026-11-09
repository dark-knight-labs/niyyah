import type { EndedGoalData, PipelineItemData } from "@/lib/vault-types";

/**
 * Plan v2 rules, pure: labels (a month "2026-11" or a day), late, nesting under quarter goals, and the per-cell caps.
 * They read fields the pipelines API returns (lane, done, goal_ref, label_month, label_date, focus) and nothing else.
 */

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-11" -> "Nov-2026". */
export const monthText = (m: string): string => `${MONTH_SHORT[Number(m.slice(5, 7)) - 1]}-${m.slice(0, 4)}`;

/** "2026-11-12" -> "Thu 12 Nov". */
export function dateText(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  return `${DAY_SHORT[x.getUTCDay()]} ${x.getUTCDate()} ${MONTH_SHORT[x.getUTCMonth()]}`;
}

/** "2026-Q4" -> "Q4'26". */
export const quarterText = (q: string): string => `${q.slice(5)}'${q.slice(2, 4)}`;

/** "2026-W46" -> "W46". */
export const weekText = (w: string): string => w.slice(5);

/** The three "YYYY-MM" months of "2026-Q4". */
export function monthsOfQuarter(q: string): string[] {
  const year = q.slice(0, 4);
  const first = (Number(q.slice(-1)) - 1) * 3;
  return [1, 2, 3].map((k) => `${year}-${String(first + k).padStart(2, "0")}`);
}

export type LabelFields = Pick<PipelineItemData, "label_month" | "label_date">;
export type Label = { kind: "month" | "date"; value: string; text: string } | null;

export function labelOf(i: LabelFields): Label {
  if (i.label_date) return { kind: "date", value: i.label_date, text: dateText(i.label_date) };
  if (i.label_month) return { kind: "month", value: i.label_month, text: monthText(i.label_month) };
  return null;
}

const isDone = (i: Pick<PipelineItemData, "lane" | "done">) => i.done || i.lane === "done";

/** Late = the label's month is before this month, or its day is before today, while the item is not done. */
export function isLate(i: LabelFields & Pick<PipelineItemData, "lane" | "done">, today: string): boolean {
  if (isDone(i)) return false;
  if (i.label_date) return i.label_date < today;
  return !!i.label_month && i.label_month < today.slice(0, 7);
}

/** all · none · late · a month "YYYY-MM" (matches a month label, or a day label inside that month). */
export type LabelFilter = string;

export function matchesLabel(i: LabelFields & Pick<PipelineItemData, "lane" | "done">, filter: LabelFilter, today: string): boolean {
  if (filter === "all") return true;
  if (filter === "none") return !i.label_month && !i.label_date;
  if (filter === "late") return isLate(i, today);
  return i.label_month === filter || (i.label_date ?? "").slice(0, 7) === filter;
}

/** A goal line the table can show: of this quarter, or of one that has ended. */
export interface GoalRef { id: string; text: string; quarter: string; ended: boolean }

export function goalIndex(current: { id: string; text: string }[], quarter: string, ended: EndedGoalData[] = []): GoalRef[] {
  return [
    ...current.map((g) => ({ id: g.id, text: g.text, quarter, ended: false })),
    ...ended.filter((g) => !current.some((c) => c.id === g.id)).map((g) => ({ id: g.id, text: g.text, quarter: g.quarter, ended: true })),
  ];
}

export interface GoalGroup<T> { goal: GoalRef | null; items: T[] }

/** Items grouped under their goals (this quarter's in order, then ended ones), then the not-nested rest. Empty groups are left out. */
export function groupByGoal<T extends { goal_ref?: string | null }>(items: T[], goals: GoalRef[]): GoalGroup<T>[] {
  const groups = goals.map((goal) => ({ goal: goal as GoalRef | null, items: items.filter((i) => i.goal_ref === goal.id) })).filter((g) => g.items.length > 0);
  const known = new Set(goals.map((g) => g.id));
  const rest = items.filter((i) => !i.goal_ref || !known.has(i.goal_ref));
  return rest.length ? [...groups, { goal: null, items: rest }] : groups;
}

/** Tasks done / nested under a goal, counting the block's items of every lane. */
export function nestedCount(items: Pick<PipelineItemData, "goal_ref" | "lane" | "done">[], goalId: string): { done: number; total: number } {
  const mine = items.filter((i) => i.goal_ref === goalId);
  return { done: mine.filter(isDone).length, total: mine.length };
}

export const CAPS = { now: Infinity, next: 6, someday: 3 } as const;

export function capped<T>(list: T[], cap: number, open: boolean): { shown: T[]; more: number } {
  const n = open ? Infinity : cap;
  return { shown: list.slice(0, n), more: Math.max(0, list.length - n) };
}

/** The week an open Now item was last the small domino, when that is before this week: "since W45". */
export function sinceWeek(i: Pick<PipelineItemData, "lane" | "done" | "focus">, week: string): string | null {
  return i.lane === "now" && !i.done && i.focus && i.focus < week ? weekText(i.focus) : null;
}

/** Which of the three open columns an item belongs to; null for Done. */
export function columnOf(i: Pick<PipelineItemData, "lane" | "done">): "now" | "next" | "someday" | null {
  if (isDone(i)) return null;
  return i.lane === "backlog" ? "someday" : i.lane === "done" ? null : i.lane;
}
