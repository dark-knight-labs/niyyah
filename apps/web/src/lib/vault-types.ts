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


export interface VaultTaskData {
  path: string;
  line: number;
  hash: string;
  text: string;
  done: boolean;
  /** The stream it belongs to (a stream id), if any. */
  stream: string | null;
  /** Tags, typed as #word in the text: the same system as the Plan page. */
  products?: string[];
  /** Details, like a Plan item's. */
  description?: string;
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

export interface DaysStatusData {
  days: number;
}

/** One line of a checklist under a goal or a month. */
export interface ChecklistItemData { id: string; text: string; done: boolean; /** Goal lines only (Plan v3): the slug of one of the block's products. */ product?: string | null }
/** A line being sent: a new one has no id yet. */
export interface ChecklistLine { id?: string; text: string; done?: boolean; product?: string | null }

export interface VaultGoal {
  title: string;
  value: string;
  caption: string;
  checklist: ChecklistItemData[];
  /** 0-100: from the checklist when there is one, else the number typed in; null when neither. */
  progress: number | null;
}

export interface VaultGoalsData {
  items: VaultGoal[];
}

export interface VaultObjectivesData {
  week: string;
  period: string;
  items: VaultObjective[];
}

export interface VaultEvent {
  /** Google event id; only events that can be moved or deleted have one. */
  id?: string | null;
  title: string;
  calendar: string;
  color: string | null;
  all_day: boolean;
  location: string | null;
  /** An https Zoom / Google Meet / Teams link found on the event. */
  meeting_url?: string | null;
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
  /** The goal's lines joined into one summary. */
  goal: string;
  goal_checklist: ChecklistItemData[];
  checkpoints: { month: MonthKey; text: string; checklist: ChecklistItemData[] }[];
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
  goal_checklist?: ChecklistLine[];
  month_checklists?: Partial<Record<MonthKey, ChecklistLine[]>>;
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
  /** The parts of the block this item belongs to (tags); most blocks have none. */
  products?: string[];
  done: boolean;
  age_days: number;
  stale: boolean;
  /** Plan v2: the id of the quarter goal line this item is nested under, or null. */
  goal_ref?: string | null;
  /** "2026-11"; an item has a month label or a date label, never both. */
  label_month?: string | null;
  /** ISO day. */
  label_date?: string | null;
}

/** A goal line of an earlier quarter that some item of the block is still nested under. */
export interface EndedGoalData { id: string; text: string; quarter: string }

/** Plan v3: a named part of a block. Tasks carry its slug as a tag, goal lines as `product`. */
export interface ProductData { id: number; block: string; slug: string; name: string; position: number; tasks: number; goals: number }

/** The goal lines of one block in one quarter (the current one or a later one). */
export interface QuarterGoalsData { quarter: string; goals: ChecklistItemData[] }

export interface PipelineStreamData extends StreamInfo {
  items: PipelineItemData[];
  ended_goals?: EndedGoalData[];
  products?: ProductData[];
  quarter_goals?: QuarterGoalsData[];
}

export interface PipelinesData {
  /** The current week; items with focus === week are this week's small dominoes. */
  week: string;
  now_limit: number;
  stale_days: number;
  streams: PipelineStreamData[];
  /** The quarter tabs: this quarter, the next, and any later one with goals. */
  quarters?: string[];
}

export type NotebookKind = "idea" | "meeting" | "blocker";

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
  /** The first URL in the body, if any. */
  url: string | null;
}

export interface NotebookStreamData extends StreamInfo {
  entries: NotebookEntryData[];
}

export interface NotebooksData {
  streams: NotebookStreamData[];
}

export interface BlockConfig {
  key: string;
  label: string;
  ring_name: string;
  color: string;
  counts_for_stars: boolean;
  archived: boolean;
}
export interface BlocksConfigData { blocks: BlockConfig[] }
export interface ScheduleRowIn { block: string; start: string; end: string; what: string; stream: string | null }
export interface ScheduleMetaIn { city: string | null; lat: number | null; lon: number | null; tz: string; method: string; madhab: string; weekend_days: string[] }
export interface ScheduleConfigIn { meta: ScheduleMetaIn; weekday: ScheduleRowIn[]; weekend: ScheduleRowIn[] }
export interface FeedData { id: number; name: string; host: string; color: string | null; email: string | null }

export interface GoalIn { title: string; value: string; caption: string; progress: number | null; checklist: ChecklistLine[] }

export interface ApiTokenData { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null }
export interface NewApiToken extends ApiTokenData { token: string }

export type HabitStage = "installing" | "rails" | "retired";
export type HabitLevel = "done" | "min";
export type Tripwire = "quiet" | "close" | "fired";

export interface HabitWeek { start: string; count: number; pct: number; current: boolean }

/** A repeating behaviour that lives in a day block (not a stream) and is checked off per day. */
export interface HabitData {
  id: number;
  name: string;
  /** A key of the user's day blocks (Settings), not a plan stream. */
  block: string;
  anchor: string;
  /** Target days a week; 7 is daily. */
  per_week: number;
  /** The two-minute version; counts as showing up. */
  minimum: string;
  stage: HabitStage;
  stream: string | null;
  /** Plan v3: a goal line of `stream` (this quarter or later; it stays when its quarter ends). */
  goal_ref?: string | null;
  gate_pct: number;
  gate_weeks: number;
  trip_pct: number | null;
  trip_weeks: number | null;
  started_on: string;
  today: HabitLevel | null;
  streak: number;
  gate_run: number;
  gate_met: boolean;
  /** Only for habits on rails with a tripwire written. */
  tripwire: Tripwire | null;
  /** The last 12 weeks, oldest first. */
  weeks: HabitWeek[];
  days: Record<string, HabitLevel>;
}

export interface HabitsData { today: string; installing_limit: number; habits: HabitData[] }

export interface HabitFields {
  name?: string;
  block?: string;
  anchor?: string;
  per_week?: number;
  minimum?: string;
  stage?: HabitStage;
  stream?: string;
  clear_stream?: boolean;
  goal_ref?: string;
  clear_goal?: boolean;
  gate_pct?: number;
  gate_weeks?: number;
  trip_pct?: number;
  trip_weeks?: number;
  /** Demote although the gate is not met. */
  force?: boolean;
}

/** Open, done or skipped: what happened to an item. */
export type ItemStatus = "open" | "done" | "skipped";

/**
 * One item on one day: an own task (`kind` "task", with an `id`) or a calendar event (`kind` "event", with a `key`).
 * No start/end means all day. An event's title and time come from its calendar; the rest is the user's annotation.
 */
export interface ItemData {
  kind: "task" | "event";
  id: number | null;
  key: string | null;
  day: string | null;
  title: string;
  status: ItemStatus;
  done: boolean;
  /** 0-3. */
  weight: number;
  stream: string | null;
  /** Tags. */
  products: string[];
  /** Notes. */
  description: string;
  /** Sub-tasks. */
  checklist: ChecklistItemData[];
  all_day: boolean;
  start_min: number | null;
  end_min: number | null;
  // own items
  due_on?: string | null;
  scheduled_on?: string | null;
  start_on?: string | null;
  path?: string | null;
  // calendar items
  annotated?: boolean | null;
  /** Google event id, for moving or deleting through /vault/events. */
  event_id?: string | null;
  calendar?: string | null;
  color?: string | null;
  location?: string | null;
  meeting_url?: string | null;
  /** Set on an own item that is a pipeline row (it is on the Map's Life board as task:<id>). */
  lane?: Lane | null;
}

/** A calendar event's annotation, as PUT /vault/items/overlay returns it. */
export interface OverlayData {
  key: string;
  calendar: string;
  title: string;
  day: string | null;
  annotated: boolean;
  status: ItemStatus;
  done: boolean;
  weight: number;
  stream: string | null;
  products: string[];
  description: string;
  checklist: ChecklistItemData[];
}

export interface ItemsData {
  /** By day, all day first, then by start. */
  items: ItemData[];
  /** Annotations whose event no longer shows. */
  orphans: OverlayData[];
  errors: string[];
}

/** What a user can change on any item, own or calendar. Only the fields sent change. */
export interface ItemFields {
  status?: ItemStatus;
  weight?: number;
  stream?: string | null;
  products?: string[];
  description?: string;
  checklist?: ChecklistLine[];
}

export interface ItemCreate extends ItemFields {
  day: string;
  text: string;
  /** Both left out = all day. */
  start_min?: number;
  end_min?: number;
}

export interface ItemPatch extends ItemFields {
  text?: string;
  /** Reschedules: sets the scheduled date, leaves due and start dates alone. */
  day?: string;
  /** Send both null to make it all day. */
  start_min?: number | null;
  end_min?: number | null;
}

export interface OverlayIn extends ItemFields {
  key: string;
  title?: string;
  calendar?: string;
  day?: string;
}
