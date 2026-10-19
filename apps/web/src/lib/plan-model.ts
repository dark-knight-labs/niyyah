import type { Lane, NotebookEntryData, NotebookKind, NotebooksData, PipelineItemData, PipelinesData } from "@/lib/vault-types";

/** The horizons of the work list, plus the notebook and what is finished. */
export type Tab = "now" | "next" | "someday" | "notes" | "done";

export const TABS: { id: Tab; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "next", label: "Next" },
  { id: "someday", label: "Someday" },
  { id: "notes", label: "Notes" },
  { id: "done", label: "Done" },
];

/** The lane the API calls "backlog" is shown as Someday. */
export const LANE_FOR: Record<Exclude<Tab, "notes">, Lane> = { now: "now", next: "next", someday: "backlog", done: "done" };

export interface ItemRow { type: "item"; key: string; stream: string; item: PipelineItemData }
export interface NoteRow { type: "note"; key: string; stream: string; entry: NotebookEntryData }
export type Row = ItemRow | NoteRow;

/** What the work list is narrowed to: a tab, optionally one block, one tag and (on Notes) one kind. */
export interface View {
  tab: Tab;
  stream: string | null;
  tag: string | null;
  kind: NotebookKind | "all";
}

/** Every pipeline item and notebook entry of every block as one flat list. Keys follow the line and hash, so they change when a row is edited. */
export function buildRows(pipelines: PipelinesData | null, notebooks: NotebooksData | null): Row[] {
  const rows: Row[] = [];
  for (const s of pipelines?.streams ?? []) {
    for (const item of s.items) rows.push({ type: "item", key: `${s.stream}:i:${item.line}:${item.hash}`, stream: s.stream, item });
  }
  for (const s of notebooks?.streams ?? []) {
    for (const entry of s.entries) rows.push({ type: "note", key: `${s.stream}:n:${entry.id ?? `${entry.line}:${entry.hash}`}`, stream: s.stream, entry });
  }
  return rows;
}

export function tabOf(row: ItemRow): Tab {
  const lane = row.item.lane;
  return lane === "backlog" ? "someday" : lane;
}

/** True when the row is in the chosen block and carries the chosen tag (notes have no tags, so a tag hides them). */
export function inScope(row: Row, view: Pick<View, "stream" | "tag">): boolean {
  if (view.stream && row.stream !== view.stream) return false;
  if (view.tag) return row.type === "item" && (row.item.products ?? []).includes(view.tag);
  return true;
}

export function inTab(row: Row, tab: Tab, kind: NotebookKind | "all" = "all"): boolean {
  if (tab === "notes") return row.type === "note" && (kind === "all" || row.entry.kind === kind);
  return row.type === "item" && tabOf(row) === tab;
}

export const isOpenBlocker = (e: NotebookEntryData) => e.kind === "blocker" && !!e.open;

/** The blockers an item waits on: an id with no matching entry means the blocker was deleted. */
export function waitingOn(item: PipelineItemData, entries: NotebookEntryData[]): { id: string; found?: NotebookEntryData }[] {
  if (item.lane === "done") return [];
  return item.blocked_by.map((id) => ({ id, found: entries.find((e) => e.id === id) })).filter((w) => !w.found || isOpenBlocker(w.found));
}

/** Text with its tags written back in the form the API reads: `#word`, or `[product:: two words]` when a tag has spaces. */
export function tagged(text: string, tags: string[]): string {
  return [text, ...tags.map((t) => (/\s/.test(t) ? `[product:: ${t}]` : `#${t}`))].join(" ");
}

/** Tags in use among the items of these rows, most used first. */
export function tagTally(rows: Row[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const r of rows) if (r.type === "item") for (const p of r.item.products ?? []) tally.set(p, (tally.get(p) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
