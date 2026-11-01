import type { ChecklistItemData, ItemData, ItemFields, OverlayData } from "@/lib/vault-types";

/** One handle for an item on one day: own items by id, calendar items by key (one per occurrence), both with the day, since a task can show on several days and an event can span several. */
export function itemRef(item: Pick<ItemData, "kind" | "id" | "key" | "day">): string {
  return item.kind === "task" ? `t:${item.id}:${item.day}` : `e:${item.key}:${item.day}`;
}

export const isTimed = (i: ItemData) => !i.all_day && i.start_min !== null && i.end_min !== null;

/** All day first, then by start; the order GET /vault/items uses. */
export function byStart(a: ItemData, b: ItemData): number {
  return Number(isTimed(a)) - Number(isTimed(b)) || (a.start_min ?? 0) - (b.start_min ?? 0);
}

/** An own item as the range read shows it: once on each of its due, scheduled and start dates in `days`, timed only on its scheduled date. */
export function placeTask(task: ItemData, days: string[]): ItemData[] {
  const on = new Set([task.due_on, task.scheduled_on, task.start_on].filter((d): d is string => !!d && days.includes(d)));
  const timedOn = task.start_min !== null && task.end_min !== null ? task.scheduled_on : null;
  return [...on].sort().map((day) => {
    const timed = day === timedOn;
    return { ...task, day, all_day: !timed, start_min: timed ? task.start_min : null, end_min: timed ? task.end_min : null };
  });
}

/** The fields an edit changes, applied before the server answers. */
export function withFields(item: ItemData, fields: ItemFields): ItemData {
  const next = { ...item, ...fields } as ItemData;
  if (fields.status) next.done = fields.status === "done";
  if (fields.checklist) next.checklist = fields.checklist.map((l, n) => ({ id: l.id ?? `new-${n}`, text: l.text, done: !!l.done }));
  return next;
}

/** A calendar item with the annotation the server returned. */
export function withOverlay(item: ItemData, o: OverlayData): ItemData {
  return { ...item, annotated: o.annotated, status: o.status, done: o.done, weight: o.weight, stream: o.stream, products: o.products, description: o.description, checklist: o.checklist };
}

export function subtaskStat(list: ChecklistItemData[]): { done: number; total: number } {
  return { done: list.filter((l) => l.done).length, total: list.length };
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
/** `#word` tags, as the server reads them (a month like #oct is not a tag). */
const TAG = new RegExp(`(^|\\s)#(?!(?:${MONTHS})\\b)([A-Za-z][\\w-]*)`, "gi");

export function hashtags(text: string): string[] {
  return [...new Set([...text.matchAll(TAG)].map((m) => m[2].toLowerCase()))];
}

export interface QuickParse {
  title: string;
  tags: string[];
  /** Minutes from midnight; both null = all day. */
  start: number | null;
  end: number | null;
  /** A time was typed but makes no sense (end before start, past midnight): the item is added all day. */
  bad: boolean;
}

/**
 * Read a quick-add line: `#tag` words become tags; `14:00-15:00` or `14:00 45m` / `14:00 1h` (a bare `14:00` is 30 minutes)
 * makes it timed; no time means all day. The time and tags are taken out of the title.
 */
export function parseQuick(text: string): QuickParse {
  const tags = hashtags(text);
  let t = ` ${text.replace(TAG, " ")} `;
  let start: number | null = null;
  let end: number | null = null;
  let typed = false;
  const range = t.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  const single = range ? null : t.match(/(?:\bat\s+)?\b(\d{1,2}):(\d{2})(?:\s+(\d+)\s*(m|h)\b)?/i);
  if (range) {
    typed = true;
    t = t.replace(range[0], " ");
    if (+range[2] < 60 && +range[4] < 60) { start = +range[1] * 60 + +range[2]; end = +range[3] * 60 + +range[4]; }
  } else if (single) {
    typed = true;
    t = t.replace(single[0], " ");
    if (+single[2] < 60) {
      start = +single[1] * 60 + +single[2];
      end = start + (single[3] ? (single[4].toLowerCase() === "h" ? +single[3] * 60 : +single[3]) : 30);
    }
  }
  const title = t.replace(/\s+/g, " ").trim();
  if (typed && (start === null || end === null || start >= 1440 || end <= start || end > 1440)) return { title, tags, start: null, end: null, bad: true };
  return { title, tags, start, end, bad: false };
}
