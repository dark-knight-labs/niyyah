import { isTimed, itemRef } from "@/lib/items";
import { computePrayerMinutes, dayTypeFor, PRAYERS, Prayer, ResolvedBlock, ResolvedDay, resolveDay, resolveTime, VaultScheduleData } from "@/lib/routine";
import type { ItemData } from "@/lib/vault-types";
import { addDays } from "@/lib/week";

/** The calendar page's views, in the order V rotates through them. Week Grid is the Overview's WeekCalendar. */
export const VIEWS = [
  { id: "day-grid", scope: "day", label: "Grid" },
  { id: "day-agenda", scope: "day", label: "Agenda" },
  { id: "day-ribbon", scope: "day", label: "Ribbon" },
  { id: "day-ring", scope: "day", label: "Ring" },
  { id: "week-grid", scope: "week", label: "Grid" },
  { id: "week-agenda", scope: "week", label: "Agenda" },
  { id: "week-strips", scope: "week", label: "Strips" },
  { id: "week-blocks", scope: "week", label: "Blocks" },
] as const;
export type ViewId = (typeof VIEWS)[number]["id"];
export const VIEW_IDS = VIEWS.map((v) => v.id) as readonly ViewId[];
export const viewName = (id: ViewId) => { const v = VIEWS.find((x) => x.id === id)!; return `${v.scope === "day" ? "Day" : "Week"} ${v.label.toLowerCase()}`; };

/** How meetings sit inside the day ring: the thin lane the Overview draws ("base"), lanes hugging the band (A), numbered pins (B), one lane per calendar with a texture each (C). */
export const RING_VARIANTS = ["base", "A", "B", "C"] as const;
export type RingVariant = (typeof RING_VARIANTS)[number];
export const RING_INFO: Record<RingVariant, [string, string]> = {
  base: ["Today", "What the Overview draws: one thin arc inside the band; overlaps hide each other."],
  A: ["Hugging lanes", "Ink arcs against the band; an overlap drops a lane inward. Numbers match the list."],
  B: ["Pins", "Thin lanes with a numbered pin at each start."],
  C: ["Lane per calendar", "One lane and texture per calendar, cross-hatch for your own items; the centre shows what is on now or next."],
};

/** Block colours: one hue per block, a lighter or darker step each time a block repeats in the day, or alternating light and dark. */
export const SHADE_MODES = ["hue", "shade", "alt"] as const;
export type ShadeMode = (typeof SHADE_MODES)[number];
export const SHADE_LABEL: Record<ShadeMode, string> = { hue: "One hue", shade: "Shade per repeat", alt: "Alternate" };

/** One day as every view draws it: the resolved schedule (null when it could not be read), the day's items, and where now is. */
export interface CalDay {
  iso: string;
  day: ResolvedDay | null;
  items: ItemData[];
  today: boolean;
  /** Before today: everything on it is over. */
  past: boolean;
  /** Minutes since midnight, today only. */
  nowMin: number | null;
}

/** The schedule for an ISO date. UTC noon keeps the date in every timezone the schedule can use. */
export function resolveIso(schedule: VaultScheduleData, iso: string, known: ReadonlySet<string>): ResolvedDay | null {
  try { return resolveDay(schedule, new Date(`${iso}T12:00:00Z`), known); } catch { return null; }
}

/** A stretch of one date's column in the week grid: minutes since midnight, `from` < `to` <= 1440. */
export interface Band { block: string; from: number; to: number; }

/**
 * The blocks as stretches of one date's column. A block that crosses midnight (isha to fajr-60) fills the evening of the date
 * its row belongs to; its morning half sits in the next date's column, ended by that date's prayer times (the row of the
 * evening before, the clock of the morning after).
 */
export function dayBands(schedule: VaultScheduleData, iso: string, known: ReadonlySet<string>): Band[] {
  const own = resolveIso(schedule, iso, known);
  const bands: Band[] = (own?.blocks ?? []).map((b) => ({ block: b.block, from: b.startMin, to: Math.min(b.endMin, 1440) }));
  try {
    const { meta } = schedule;
    const prev = new Date(`${addDays(iso, -1)}T12:00:00Z`);
    const type = dayTypeFor(prev, meta.tz, meta.weekend_days ?? ["fri", "sat"]);
    const rows = schedule.days[type]?.length ? schedule.days[type] : schedule.days.weekday ?? [];
    const before = computePrayerMinutes(meta, prev);
    const after = computePrayerMinutes(meta, new Date(`${iso}T12:00:00Z`));
    for (const row of rows) {
      if (known.size > 0 && !known.has(row.block)) continue;
      try {
        const start = resolveTime(row.start, { ...before.prayers, sunrise: before.sunrise });
        const end = resolveTime(row.end, { ...before.prayers, sunrise: before.sunrise });
        if (end > start) continue;
        const morning = resolveTime(row.end, { ...after.prayers, sunrise: after.sunrise });
        if (morning > 0) bands.push({ block: row.block, from: 0, to: Math.min(morning, 1440) });
      } catch { /* a row that cannot be read is skipped, as in resolveDay */ }
    }
  } catch { /* no location: no prayer times, no carried night */ }
  return bands;
}

/** The minute falls in the span (a block crossing midnight also covers the early hours). */
export const inSpan = (min: number, s: number, e: number) => (min >= s && min < e) || (min + 1440 >= s && min + 1440 < e);

/** A block as one or two pieces inside 0..1440 (a block past midnight wraps to the morning). */
export interface Piece { index: number; block: ResolvedBlock; from: number; to: number; }
export function pieces(blocks: ResolvedBlock[]): Piece[] {
  return blocks.flatMap((block, index) => (block.endMin > 1440
    ? [{ index, block, from: block.startMin, to: 1440 }, { index, block, from: 0, to: block.endMin - 1440 }]
    : [{ index, block, from: block.startMin, to: block.endMin }]));
}

const STEPS: [string, number][] = [["white", 24], ["black", 24], ["white", 40], ["black", 40]];

/** A colour per block of the day (by index), in the chosen mode. `base` is the block's own token. */
export function blockColours(blocks: ResolvedBlock[], base: (key: string) => string, mode: ShadeMode): string[] {
  const seen: Record<string, number> = {};
  return blocks.map((b, i) => {
    const c = base(b.block);
    const repeat = (seen[b.block] = (seen[b.block] ?? -1) + 1);
    if (mode === "shade" && repeat > 0) { const [mix, pct] = STEPS[(repeat - 1) % STEPS.length]; return `color-mix(in srgb, ${c}, ${mix} ${pct}%)`; }
    if (mode === "alt") return i % 2 ? `color-mix(in srgb, ${c}, white 26%)` : `color-mix(in srgb, ${c}, black 14%)`;
    return c;
  });
}
export const tint = (colour: string, pct: number) => `color-mix(in srgb, ${colour} ${pct}%, var(--surface))`;

/** Timed items in order of start (then end); the order the numbers on rings and lists follow. */
export function timedItems(items: ItemData[]): ItemData[] {
  return items.filter(isTimed).sort((a, b) => (a.start_min as number) - (b.start_min as number) || (a.end_min as number) - (b.end_min as number));
}
export const allDayItems = (items: ItemData[]) => items.filter((i) => !isTimed(i));

/** Which calendar an item comes from; own items are "Yours". */
export const sourceOf = (i: ItemData) => (i.kind === "task" ? "Yours" : i.calendar ?? "Calendar");

export interface Lanes {
  /** Overlap lane of each item (by itemRef) and how many lanes its overlapping group uses. */
  lane: Map<string, { lane: number; cols: number }>;
  count: number;
  /** One run of lanes per calendar (C): each item's lane, and where each calendar's run starts. */
  calLane: Map<string, number>;
  calendars: { name: string; first: number; texture: Texture }[];
  calCount: number;
}
export type Texture = "solid" | "hatch" | "dots" | "cross";
const TEXTURES: Texture[] = ["solid", "hatch", "dots"];

/** Lanes for timed items (sorted by start): first free lane, so overlaps sit side by side or step inward. */
export function lanes(timed: ItemData[]): Lanes {
  const lane = new Map<string, { lane: number; cols: number }>();
  const fill = (list: ItemData[], set: (i: ItemData, l: number) => void) => {
    const ends: number[] = [];
    for (const i of list) {
      let l = ends.findIndex((end) => end <= (i.start_min as number));
      if (l < 0) { l = ends.length; ends.push(0); }
      ends[l] = i.end_min as number;
      set(i, l);
    }
    return ends.length;
  };
  const count = fill(timed, (i, l) => lane.set(itemRef(i), { lane: l, cols: 1 }));
  // Overlapping groups share a column count, so their cards split the width evenly.
  let group: ItemData[] = [];
  let groupEnd = -1;
  const flush = () => { const cols = Math.max(1, ...group.map((g) => lane.get(itemRef(g))!.lane + 1)); group.forEach((g) => { lane.get(itemRef(g))!.cols = cols; }); group = []; };
  for (const i of timed) {
    if (group.length && (i.start_min as number) >= groupEnd) flush();
    group.push(i);
    groupEnd = Math.max(groupEnd, i.end_min as number);
  }
  flush();

  const calLane = new Map<string, number>();
  const names = [...new Set(timed.map(sourceOf))].sort((a, b) => Number(a === "Yours") - Number(b === "Yours") || a.localeCompare(b));
  const calendars: Lanes["calendars"] = [];
  let base = 0;
  names.forEach((name, n) => {
    const used = fill(timed.filter((i) => sourceOf(i) === name), (i, l) => calLane.set(itemRef(i), base + l));
    calendars.push({ name, first: base, texture: name === "Yours" ? "cross" : TEXTURES[n % TEXTURES.length] });
    base += used;
  });
  return { lane, count: Math.max(1, count), calLane, calendars, calCount: Math.max(1, base) };
}

/** What an item's styling says: its status first, then (timed, open) whether it is on now or over. */
export type ItemState = "done" | "skipped" | "live" | "past" | "open";
export function itemState(i: ItemData, d: Pick<CalDay, "past" | "nowMin">): ItemState {
  if (i.status === "done") return "done";
  if (i.status === "skipped") return "skipped";
  if (!isTimed(i)) return "open";
  if (d.past) return "past";
  if (d.nowMin === null) return "open";
  if ((i.start_min as number) <= d.nowMin && d.nowMin < (i.end_min as number)) return "live";
  return (i.end_min as number) <= d.nowMin ? "past" : "open";
}
/** Tailwind classes per state; the same in every view. */
export const STATE_CLASS: Record<ItemState, string> = {
  done: "opacity-60 [&_[data-title]]:line-through",
  skipped: "opacity-40 [&_[data-title]]:line-through",
  live: "outline outline-2 outline-[var(--accent)]",
  past: "opacity-60",
  open: "",
};

export interface PrayerMark { name: Prayer; label: string; min: number; next: boolean; }
/** The day's five prayers; on today the next one is marked. */
export function prayerMarks(day: ResolvedDay, nowMin: number | null): PrayerMark[] {
  const nextName = nowMin === null ? null : PRAYERS.find((p) => day.prayers[p] > nowMin) ?? "fajr";
  return PRAYERS.map((p) => ({ name: p, label: `${p[0].toUpperCase()}${p.slice(1)}`, min: day.prayers[p], next: p === nextName }));
}

/** Every tag in the items, most used first. */
export function tagCounts(items: ItemData[]): [string, number][] {
  const seen = new Map<string, Set<string>>();
  for (const i of items) for (const t of i.products) {
    // An own item shows once per date it has; count it once.
    const id = i.kind === "task" ? `t:${i.id}` : itemRef(i);
    if (!seen.has(t)) seen.set(t, new Set());
    seen.get(t)!.add(id);
  }
  return [...seen.entries()].map(([t, s]): [string, number] => [t, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Booked minutes of the day's timed items (overlaps counted once each, like the mock). */
export const bookedMin = (items: ItemData[]) => timedItems(items).reduce((n, i) => n + (i.end_min as number) - (i.start_min as number), 0);

/** Minutes of `items` inside [from, to). */
export const bookedIn = (items: ItemData[], from: number, to: number) =>
  timedItems(items).reduce((n, i) => n + Math.max(0, Math.min(i.end_min as number, to) - Math.max(i.start_min as number, from)), 0);
