import type { QuickParse } from "@/lib/items";
import { vaultApi } from "@/lib/vault-api";
import type { ItemCreate, Lane, PipelineItemData, PipelinesData, VaultObjective } from "@/lib/vault-types";

/**
 * Every call that joins planning (pipelines, weekly objectives) to the calendar (items) lives here and nowhere else.
 *
 * Today a pipeline item and a calendar item are two rows in two stores, so "plan this pipeline item on Tuesday" is two writes:
 * `addItem` then `movePipelineItem(…, "now")`. When pipelines and objectives become rows of the items table (Phase C), the same
 * intent is one patch of the same row. Only the bodies of planFromPipeline, setDomino, pickDomino and sendQuickAdd change then;
 * the components call these functions and know nothing about the two stores.
 */

/** A pipeline item as the tray lists it. */
export interface TrayRow { stream: string; item: PipelineItemData }

export const LANE_LABEL: Record<Lane, string> = { now: "Now", next: "Next", backlog: "Someday", done: "Done" };

/** Open items in a stream's Now lane, and the limit the server reports. */
export function nowRoom(pipelines: PipelinesData | null, stream: string): { count: number; limit: number; full: boolean } {
  const limit = pipelines?.now_limit ?? 3;
  const count = pipelines?.streams.find((s) => s.stream === stream)?.items.filter((i) => i.lane === "now" && !i.done).length ?? 0;
  return { count, limit, full: count >= limit };
}

export interface PlanResult {
  /** The calendar item exists. */
  created: boolean;
  /** The pipeline item moved to Now. */
  moved: boolean;
  /** Something to tell the owner (a toast); null when all went as asked. */
  message: string | null;
}

/**
 * Put a pipeline item on the calendar: create the item, then move the pipeline item to Now only when the stream's Now lane has
 * room (limit from the server); a full lane leaves it where it is and says so. A failed move keeps the created item (no rollback).
 */
export async function planFromPipeline(
  ctx: { create: (item: ItemCreate) => Promise<boolean>; pipelines: PipelinesData | null },
  stream: string, item: PipelineItemData, day: string, start?: number, end?: number,
): Promise<PlanResult> {
  const timed = start !== undefined && end !== undefined;
  const made = await ctx.create({
    day, text: item.text, stream, products: item.products ?? [],
    ...(item.description ? { description: item.description } : {}),
    ...(timed ? { start_min: start, end_min: end } : {}),
  });
  if (!made) return { created: false, moved: false, message: "Could not add the item to the calendar." };
  const room = nowRoom(ctx.pipelines, stream);
  if (room.full) return { created: true, moved: false, message: `Now is full (${room.limit}): left in ${LANE_LABEL[item.lane]}` };
  try {
    await vaultApi.movePipelineItem(stream, item, "now");
    return { created: true, moved: true, message: null };
  } catch (err) {
    return { created: true, moved: false, message: `Added to the calendar, but could not move it to Now${err instanceof Error ? `: ${err.message}` : ""}.` };
  }
}

/** The week's one thing for a stream: rewrite it or tick it. */
export function setDomino(stream: string, change: { text: string } | { done: boolean }) {
  return vaultApi.setObjective(stream, change);
}

/** Pick the week's one thing from the stream's pipeline. */
export function pickDomino(stream: string, item: PipelineItemData) {
  return vaultApi.focusPipelineItem(stream, item);
}

/** Where a quick-add line goes. A day word, a time or no known `@stream` keeps it on the calendar (Phase A). */
export type QuickRoute =
  | { kind: "calendar" }
  | { kind: "pipeline"; stream: string; lane: "backlog" | "next" }
  | { kind: "week"; stream: string };

export function quickAddRoute(p: Pick<QuickParse, "stream" | "when" | "start" | "bad" | "lane">): QuickRoute {
  if (!p.stream || p.when !== null || p.start !== null || p.bad) return { kind: "calendar" };
  if (p.lane === "wk") return { kind: "week", stream: p.stream };
  return { kind: "pipeline", stream: p.stream, lane: p.lane === "next" ? "next" : "backlog" };
}

export interface RouteData { pipelines: PipelinesData | null; objectives: VaultObjective[] | null; names: Record<string, string> }

/** What a `wk` line does right now: fill the stream's empty objective, else join Now, else (Now full) go to Someday. */
function weekTarget(stream: string, data: RouteData): "objective" | "now" | "backlog" {
  const o = data.objectives?.find((x) => x.stream === stream);
  if (o && !o.text.trim()) return "objective";
  return nowRoom(data.pipelines, stream).full ? "backlog" : "now";
}

/** The destination as the quick-add preview says it, before Enter. */
export function routePreview(route: QuickRoute, p: Pick<QuickParse, "tags">, data: RouteData): string {
  if (route.kind === "calendar") return "";
  const name = data.names[route.stream] ?? route.stream;
  const tags = p.tags.length ? ` · ${p.tags.map((t) => `#${t}`).join(" ")}` : "";
  if (route.kind === "pipeline") return `→ ${name} · ${LANE_LABEL[route.lane]}${tags}`;
  const target = weekTarget(route.stream, data);
  const where = target === "objective" ? "this week's objective" : target === "now" ? "Now" : `Someday (Now is full, ${data.pipelines?.now_limit ?? 3})`;
  return `→ ${name} · ${where}${tags}`;
}

/** Send a routed line to its pipeline lane or objective. Returns a toast text when it ended up somewhere other than first asked. */
export async function sendQuickAdd(route: Exclude<QuickRoute, { kind: "calendar" }>, p: Pick<QuickParse, "title" | "tags">, data: RouteData): Promise<string | null> {
  const text = [p.title, ...p.tags.map((t) => `#${t}`)].join(" ");
  if (route.kind === "pipeline") { await vaultApi.addPipelineItems(route.stream, [text], route.lane); return null; }
  const target = weekTarget(route.stream, data);
  if (target === "objective") { await setDomino(route.stream, { text: p.title }); return null; }
  await vaultApi.addPipelineItems(route.stream, [text], target);
  return target === "backlog" ? `Now is full (${nowRoom(data.pipelines, route.stream).limit}): left in Someday` : null;
}
