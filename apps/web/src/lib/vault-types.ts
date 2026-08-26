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
