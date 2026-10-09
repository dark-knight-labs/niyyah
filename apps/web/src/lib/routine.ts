import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from "adhan";

export interface ScheduleBlockData {
  block: string;
  start: string;
  end: string;
  what: string;
  /** The stream that owns this slot (shown on the Overview), if the schedule names one. */
  stream?: string | null;
}

export interface ScheduleMeta {
  city: string | null;
  lat: number | null;
  lon: number | null;
  tz: string;
  method: string;
  madhab: string;
  /** Weekdays ("mon".."sun") that use the weekend schedule. */
  weekend_days: string[];
}

/** Prayer times need a location; a new account has none until it sets one in Settings. */
export const hasLocation = (meta: ScheduleMeta) => meta.lat != null && meta.lon != null;

export interface VaultScheduleData {
  meta: ScheduleMeta;
  days: Record<string, ScheduleBlockData[]>;
  errors: string[];
}

export const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
export type Prayer = (typeof PRAYERS)[number];
export type DayType = "weekday" | "weekend";

export type RoutineBlock = string; // a key of the user's blocks (see useBlocks)

export interface ResolvedBlock {
  block: RoutineBlock;
  startMin: number; // 0..1439
  endMin: number; // startMin < endMin <= startMin + 1440 (may exceed 1440 when crossing midnight)
  what: string;
  stream: string | null;
}

export interface ResolvedDay {
  dayType: DayType;
  prayers: Record<Prayer, number>; // minutes since midnight in schedule tz
  sunrise: number;
  blocks: ResolvedBlock[];
  warnings: string[];
}

const METHODS: Record<string, () => ReturnType<typeof CalculationMethod.Karachi>> = {
  karachi: CalculationMethod.Karachi,
  mwl: CalculationMethod.MuslimWorldLeague,
  isna: CalculationMethod.NorthAmerica,
  egyptian: CalculationMethod.Egyptian,
  ummalqura: CalculationMethod.UmmAlQura,
  dubai: CalculationMethod.Dubai,
  qatar: CalculationMethod.Qatar,
  kuwait: CalculationMethod.Kuwait,
  singapore: CalculationMethod.Singapore,
  turkey: CalculationMethod.Turkey,
  tehran: CalculationMethod.Tehran,
  moonsighting: CalculationMethod.MoonsightingCommittee,
};

const TIME_RE = /^(?:(\d{1,2}):(\d{2})|(fajr|sunrise|dhuhr|asr|maghrib|isha)(?:([+-])(\d+))?)$/;

/** Minutes since midnight of `date` as seen in `tz`. */
function minutesInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") * 60 + get("minute");
}

/** Calendar date (y, m, d) of `date` as seen in `tz`. */
function ymdInTz(date: Date, tz: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return [get("year"), get("month"), get("day")];
}

/** "YYYY-MM-DD" of `date` as seen in `tz`. */
export function dateInTz(date: Date, tz: string): string {
  const [y, m, d] = ymdInTz(date, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function dayTypeFor(date: Date, tz: string, weekendDays: string[]): DayType {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date).toLowerCase().slice(0, 3);
  return weekendDays.includes(weekday) ? "weekend" : "weekday";
}

export function computePrayerMinutes(meta: ScheduleMeta, date: Date) {
  if (meta.lat == null || meta.lon == null) throw new Error("set your location in Settings");
  const method = METHODS[meta.method.toLowerCase()];
  if (!method) throw new Error(`unknown prayer method '${meta.method}'`);
  const params = method();
  params.madhab = meta.madhab.toLowerCase() === "hanafi" ? Madhab.Hanafi : Madhab.Shafi;

  const [y, m, d] = ymdInTz(date, meta.tz);
  // adhan reads the calendar date from local getters, so build the date at local noon.
  const times = new PrayerTimes(new Coordinates(meta.lat as number, meta.lon as number), new Date(y, m - 1, d, 12), params);
  const at = (t: Date) => minutesInTz(t, meta.tz);
  return {
    sunrise: at(times.sunrise),
    prayers: {
      fajr: at(times.fajr), dhuhr: at(times.dhuhr), asr: at(times.asr),
      maghrib: at(times.maghrib), isha: at(times.isha),
    } as Record<Prayer, number>,
  };
}

export function resolveTime(value: string, anchors: Record<string, number>): number {
  const match = TIME_RE.exec(value);
  if (!match) throw new Error(`invalid time '${value}'`);
  if (match[1] !== undefined) return Number(match[1]) * 60 + Number(match[2]);
  const offset = match[4] ? Number(match[5]) * (match[4] === "-" ? -1 : 1) : 0;
  return anchors[match[3]] + offset;
}

/** Overlap check on the circular 24h timeline. */
export function findOverlaps(blocks: ResolvedBlock[]): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      const overlaps = [-1440, 0, 1440].some(
        (shift) => a.startMin < b.endMin + shift && b.startMin + shift < a.endMin,
      );
      if (overlaps) warnings.push(`${a.block} overlaps ${b.block}`);
    }
  }
  return warnings;
}

/** `known` is the set of block keys the user has; empty means "do not check". */
export function resolveDay(schedule: VaultScheduleData, date: Date, known: ReadonlySet<string>): ResolvedDay {
  const { meta } = schedule;
  const dayType = dayTypeFor(date, meta.tz, meta.weekend_days ?? ["fri", "sat"]);
  const rows = schedule.days[dayType]?.length ? schedule.days[dayType] : schedule.days.weekday ?? [];
  const { prayers, sunrise } = computePrayerMinutes(meta, date);
  const anchors = { ...prayers, sunrise };

  const warnings: string[] = [];
  const blocks: ResolvedBlock[] = [];
  for (const row of rows) {
    try {
      const startMin = resolveTime(row.start, anchors);
      let endMin = resolveTime(row.end, anchors);
      if (endMin <= startMin) endMin += 1440; // crosses midnight
      if (known.size > 0 && !known.has(row.block)) throw new Error(`unknown block '${row.block}'`);
      blocks.push({ block: row.block, startMin, endMin, what: row.what, stream: row.stream ?? null });
    } catch (err) {
      warnings.push(`${row.block}: ${(err as Error).message}`);
    }
  }
  warnings.push(...findOverlaps(blocks));
  return { dayType, prayers, sunrise, blocks, warnings };
}

export function formatMinutes(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function nowMinutes(now: Date, tz: string): number {
  return minutesInTz(now, tz);
}

/** The stream that owns the schedule's slot on `date`: the first row of that day's schedule that names one. */
export function slotOwnerFor(schedule: VaultScheduleData, date: Date): string | null {
  const type = dayTypeFor(date, schedule.meta.tz, schedule.meta.weekend_days ?? ["fri", "sat"]);
  const rows = schedule.days[type]?.length ? schedule.days[type] : schedule.days.weekday ?? [];
  return rows.find((r) => r.stream)?.stream ?? null;
}
