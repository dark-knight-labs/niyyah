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

export interface QuarterStreamData {
  stream: string;
  goal: string;
  status: string;
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
  streams: QuarterStreamData[];
}

export interface PipelineItemData {
  line: number;
  hash: string;
  text: string;
  lane: Lane;
  checkpoint: MonthKey | null;
  added: string | null;
  done_on: string | null;
  done: boolean;
  age_days: number;
  stale: boolean;
}

export interface PipelineStreamData {
  stream: string;
  path: string;
  items: PipelineItemData[];
}

export interface PipelinesData {
  now_limit: number;
  stale_days: number;
  streams: PipelineStreamData[];
}
