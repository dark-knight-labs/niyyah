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

export interface VaultObjective {
  block: string;
  text: string;
  done: boolean;
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
