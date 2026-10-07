import type { StreamInfo } from "@/lib/streams";

export interface VaultDayData {
  date: string;
  mode: string;
  possible: number;
  blocks: Record<string, number>;
  total: number;
  pct: number;
  focus: string | null;
  log: string | null;
}

export interface VaultEditData {
  commit: string;
  day: VaultDayData | null;
}

export interface VaultWeekData {
  days: VaultDayData[];
  totals: Record<string, number>;
  week_total: number;
  week_possible: number;
  week_pct: number;
}

export interface VaultMonthData {
  month: string;
  days: VaultDayData[];
  totals: Record<string, number>;
  modes: Record<string, number>;
  month_pct: number;
}

export interface VaultBlocksSeriesData {
  range: number;
  blocks: Record<string, (number | null)[]>;
  averages: Record<string, number>;
}

export interface VaultStreakEntry {
  current: number;
  longest: number;
}

export interface VaultStreaksData {
  streaks: Record<string, VaultStreakEntry>;
}

export interface VaultSyncData {
  synced_days: number;
  errors: string[];
}

export interface VaultTaskData {
  path: string;
  line: number;
  hash: string;
  text: string;
  done: boolean;
}

export interface VaultLogEntry {
  index: number;
  hash: string;
  text: string;
}

export type MonthKey = "jan" | "feb" | "mar" | "apr" | "may" | "jun" | "jul" | "aug" | "sep" | "oct" | "nov" | "dec";
export type Lane = "now" | "next" | "backlog" | "done";

export interface VaultObjective {
  stream: string;
  name: string;
  color: string;
  icon: string;
  text: string;
  done: boolean;
  checkpoint: MonthKey | null;
}

export interface VaultObjectivesData {
  week: string;
  period: string;
  items: VaultObjective[];
}

export interface VaultEvent {
  title: string;
  calendar: string;
  color: string | null;
  all_day: boolean;
  location: string | null;
  /** Minutes since local midnight; null for all-day events. */
  start_min: number | null;
  end_min: number | null;
}

export interface GoogleStatusData {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

export interface NewEvent {
  title: string;
  /** Local HH:MM. */
  start: string;
  end: string;
  location?: string | null;
}

export interface VaultEventsData {
  events: VaultEvent[];
  errors: string[];
}

export interface QuarterStreamData extends StreamInfo {
  goal: string;
  checkpoints: { month: MonthKey; text: string }[];
}

export interface QuarterData {
  quarter: string;
  starts: string | null;
  ends: string | null;
  objective: string;
  objective_ar: string;
  week_of_quarter: number;
  weeks_in_quarter: number;
  current_month: MonthKey;
  /** The three months of this quarter, in order. */
  months: MonthKey[];
  /** Colour and icon keys a stream may use. */
  colors: string[];
  icons: string[];
  streams: QuarterStreamData[];
}

/** Fields of a stream to change (or, when adding, to start with); month checkpoints go in `checkpoints`. */
export interface StreamChange {
  name?: string;
  color?: string;
  icon?: string;
  slot?: string;
  weekly?: boolean;
  goal?: string;
  status?: "active" | "committed" | "paused" | "archived";
  checkpoints?: Partial<Record<MonthKey, string>>;
}

export interface PipelineItemData {
  line: number;
  hash: string;
  text: string;
  /** Free notes (details, context) kept as indented lines under the task. */
  description: string;
  /** Ids of the notebook blockers this item waits on. */
  blocked_by: string[];
  lane: Lane;
  checkpoint: MonthKey | null;
  added: string | null;
  done_on: string | null;
  /** Week label ("2026-W41") when this item is that week's small domino. */
  focus: string | null;
  done: boolean;
  age_days: number;
  stale: boolean;
}

export interface PipelineStreamData extends StreamInfo {
  path: string;
  items: PipelineItemData[];
}

export interface PipelinesData {
  /** The current week; items with focus === week are this week's small dominoes. */
  week: string;
  now_limit: number;
  stale_days: number;
  streams: PipelineStreamData[];
}

export type NotebookKind = "idea" | "brainstorm" | "link" | "meeting" | "blocker";

export interface NotebookEntryData {
  line: number;
  /** Stable across renames; null only until the note is next written. */
  id: string | null;
  hash: string;
  kind: NotebookKind;
  title: string;
  date: string | null;
  body: string;
  /** Blockers only: true until cleared. */
  open: boolean | null;
  /** Links only: the first URL in the body. */
  url: string | null;
}

export interface NotebookStreamData extends StreamInfo {
  path: string;
  entries: NotebookEntryData[];
}

export interface NotebooksData {
  streams: NotebookStreamData[];
}
