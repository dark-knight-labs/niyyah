/**
 * Read-only check of the Plan week/month rules against a data export (export format v1).
 *   npx tsx scripts/plan-rules-check.ts <export.json> <today YYYY-MM-DD>
 * Runs the same src/lib/plan-rules.ts the Plan page uses and prints JSON:
 *   { week, current, carried: [ids], carriedPick: { stream: id }, overdue: [ids], monthTab: [ids] }
 * It never writes anything. "current" is the calendar month of today; "week" is the ISO week of today.
 */
import { readFileSync } from "node:fs";
import { MONTHS, carriedFrom, carriedPick, monthTab, overdue, type RuleItem } from "../src/lib/plan-rules";

interface ExportItem { id?: number | null; stream: string; lane: string; checkpoint?: string | null; focus_week?: string | null; done?: boolean }
interface ExportObjective { week: string; stream: string; text?: string }
export interface ExportV1 { pipeline_items?: ExportItem[]; week_objectives?: ExportObjective[]; quarters?: { label: string }[] }

export interface CheckResult {
  week: string;
  current: string;
  carried: string[];
  carriedPick: Record<string, string>;
  overdue: string[];
  monthTab: string[];
}

/** ISO week label of a "YYYY-MM-DD" date, e.g. "2026-W46". */
export function isoWeekOf(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`bad date: ${today}`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);                 // the Thursday of this week
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function check(exp: ExportV1, today: string): CheckResult {
  const week = isoWeekOf(today);
  const current = MONTHS[Number(today.slice(5, 7)) - 1];
  const items = (exp.pipeline_items ?? []).map((it, idx) => ({
    key: it.id != null ? String(it.id) : `#${idx}`,
    stream: it.stream,
    rule: {
      lane: it.lane, done: !!it.done || it.lane === "done", order: idx,
      checkpoint: it.checkpoint && MONTHS.includes(it.checkpoint as never) ? it.checkpoint : null,
      focus: it.focus_week ?? null,
    } as RuleItem,
  }));
  const withObjective = new Set((exp.week_objectives ?? []).filter((o) => o.week === week && (o.text ?? "").trim()).map((o) => o.stream));
  const pick: Record<string, string> = {};
  for (const stream of new Set(items.map((i) => i.stream))) {
    if (withObjective.has(stream)) continue;
    const mine = items.filter((i) => i.stream === stream);
    const p = carriedPick(mine.map((i) => ({ ...i.rule, key: i.key })), week);
    if (p) pick[stream] = p.key;
  }
  return {
    week,
    current,
    carried: items.filter((i) => carriedFrom(i.rule, week)).map((i) => i.key),
    carriedPick: pick,
    overdue: items.filter((i) => overdue(i.rule, current)).map((i) => i.key),
    monthTab: monthTab(items.map((i) => ({ ...i.rule, key: i.key })), current, week).map((i) => i.key),
  };
}

if (process.argv[1]?.endsWith("plan-rules-check.ts")) {
  const [file, today] = process.argv.slice(2);
  if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) {
    console.error("usage: plan-rules-check.ts <export.json> <today YYYY-MM-DD>");
    process.exit(2);
  }
  console.log(JSON.stringify(check(JSON.parse(readFileSync(file, "utf8")) as ExportV1, today), null, 2));
}
