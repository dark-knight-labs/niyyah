import { HabitData, HabitStage } from "@/lib/vault-types";

export const STAGE_LABEL: Record<HabitStage, string> = { installing: "Installing", rails: "On rails", retired: "Retired" };

/** "Walk 20 min @after Asr, min: 5 min, 3/wk" -> name, cue, minimum and days a week; every part but the name is optional. */
export function parseHabit(line: string): { name: string; anchor: string; minimum: string; per_week: number } {
  let rest = line;
  const take = (re: RegExp) => { const m = re.exec(rest); if (m) rest = rest.replace(re, " "); return m?.[1]?.trim() ?? ""; };
  const minimum = take(/\bmin:\s*([^,]+)/i);
  const anchor = take(/@([^,]+)/);
  const weekly = take(/\b([1-7])\s*(?:x\s*)?\/\s*(?:wk|week)\b/i);
  const name = rest.replace(/\s*,\s*(?=,|$)/g, "").replace(/\s+/g, " ").replace(/[\s,]+$/, "").trim();
  return { name, anchor, minimum, per_week: weekly ? Number(weekly) : 7 };
}

/** Habits that count toward today's stars: daily ones, and weekly ones only when checked today, so a rest day costs nothing. */
export const countsToday = (h: HabitData) => h.stage !== "retired" && (h.per_week === 7 || h.today !== null);

/** 0-3 stars a block's habits suggest: all done is 3, over half (minimums count) is 2, any is 1. */
export function suggestedStars(habits: HabitData[]): number {
  const list = habits.filter(countsToday);
  if (!list.length) return 0;
  const done = list.filter((h) => h.today === "done").length;
  const shown = list.filter((h) => h.today !== null).length;
  if (done === list.length) return 3;
  if (shown > list.length / 2) return 2;
  return shown ? 1 : 0;
}

/** "Week 6 of 8" for a habit still installing. */
export const gateLabel = (h: HabitData) => `Week ${Math.min(h.gate_run, h.gate_weeks)} of ${h.gate_weeks}`;

/** The habits on rails whose tripwire is close or has fired. */
export const watching = (h: HabitData) => h.stage === "rails" && (h.tripwire === "fired" || h.tripwire === "close");
