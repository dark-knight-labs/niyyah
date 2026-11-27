import { PipelineItemData, QuarterStreamData, PipelineStreamData, VaultTaskData } from "@/lib/vault-types";

/** What a report line is made of, so the By-day view can edit it: a calendar task, or a Plan item of a block. */
export type ItemRef = { kind: "task"; task: VaultTaskData } | { kind: "plan"; stream: string; item: PipelineItemData };

export interface ReportItem { text: string; tags: string[]; day: string | null; source: "task" | "plan"; ref?: ItemRef; done?: boolean; }
export interface StreamReport { id: string | null; name: string; color: string; done: ReportItem[]; open: ReportItem[]; tags: [string, number][]; }

/** Work per stream for the week `days` (ISO dates): tasks on the calendar that week (done or open) and Plan items finished that week. Streams with no work are left out. */
export function weeklyReport(
  days: string[], tasks: Record<string, VaultTaskData[]>, streams: Pick<QuarterStreamData, "stream" | "name" | "color">[], pipelines: PipelineStreamData[],
): StreamReport[] {
  const first = days[0];
  const last = days[days.length - 1];
  const groups = new Map<string | null, StreamReport>(
    [...streams.map((s) => [s.stream, { id: s.stream, name: s.name, color: s.color }] as const), [null, { id: null, name: "No stream", color: "slate" }] as const]
      .map(([id, s]) => [id, { ...s, done: [], open: [], tags: [] }]),
  );
  const group = (id: string | null) => groups.get(id) ?? groups.get(null)!;

  for (const day of days) {
    for (const t of tasks[day] ?? []) {
      const item: ReportItem = { text: t.text, tags: t.products ?? [], day, source: "task", ref: { kind: "task", task: t }, done: t.done };
      (t.done ? group(t.stream).done : group(t.stream).open).push(item);
    }
  }
  for (const s of pipelines) {
    for (const i of s.items) {
      if (i.done_on && i.done_on >= first && i.done_on <= last) group(s.stream).done.push({ text: i.text, tags: i.products ?? [], day: i.done_on, source: "plan", ref: { kind: "plan", stream: s.stream, item: i }, done: true });
    }
  }
  return [...groups.values()]
    .map((g) => {
      const tally = new Map<string, number>();
      for (const i of g.done) for (const t of i.tags) tally.set(t, (tally.get(t) ?? 0) + 1);
      return { ...g, tags: [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
    })
    .filter((g) => g.done.length + g.open.length > 0);
}

/** The report as Markdown, to paste into a note or message. */
export function reportMarkdown(label: string, report: StreamReport[]): string {
  const line = (i: ReportItem, mark: string) => `- [${mark}] ${i.text}${i.tags.map((t) => ` #${t.replace(/\s+/g, "-")}`).join("")}`;
  const body = report.map((g) => [
    `## ${g.name} (${g.done.length} done, ${g.open.length} open)`,
    ...g.done.map((i) => line(i, "x")),
    ...g.open.map((i) => line(i, " ")),
  ].join("\n"));
  return [`# Week ${label}`, ...(body.length ? body : ["Nothing logged this week."])].join("\n\n");
}

/** One product (a tag) inside a block of a day; `product` is null for items with no tag. */
export interface ProductReport { product: string | null; items: ReportItem[]; }
export interface DayBlock { id: string | null; name: string; color: string; products: ProductReport[]; }
export interface DayReport { day: string; blocks: DayBlock[]; }

/**
 * The same week as `weeklyReport`, grouped day -> block -> product (an item's first tag; no tag goes last as null).
 * Days with no work are left out. Inside a product, done items come first, then open ones, each in the order the week gave them.
 */
export function weeklyByDay(report: StreamReport[]): DayReport[] {
  const days = new Map<string, Map<string | null, { block: StreamReport; products: Map<string | null, ReportItem[]> }>>();
  for (const block of report) {
    for (const item of [...block.done, ...block.open]) {
      if (!item.day) continue;
      const blocks = days.get(item.day) ?? new Map();
      days.set(item.day, blocks);
      const entry = blocks.get(block.id) ?? { block, products: new Map<string | null, ReportItem[]>() };
      blocks.set(block.id, entry);
      const product = item.tags[0] ?? null;
      entry.products.set(product, [...(entry.products.get(product) ?? []), item]);
    }
  }
  const byProduct = (a: ProductReport, b: ProductReport) => (a.product === null ? 1 : b.product === null ? -1 : a.product.localeCompare(b.product));
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, blocks]) => ({
      day,
      blocks: [...blocks.values()].map(({ block, products }) => ({
        id: block.id, name: block.name, color: block.color,
        products: [...products].map(([product, items]) => ({ product, items: [...items.filter((i) => i.done), ...items.filter((i) => !i.done)] })).sort(byProduct),
      })),
    }));
}

/** The By-day view as Markdown: a heading per day, a bold block line, then each product's items. */
export function dayMarkdown(label: string, days: DayReport[]): string {
  const line = (i: ReportItem) => `- [${i.done ? "x" : " "}] ${i.text}${i.tags.map((t) => ` #${t.replace(/\s+/g, "-")}`).join("")}`;
  const body = days.map((d) => [
    `## ${d.day}`,
    ...d.blocks.flatMap((b) => [`**${b.name}**`, ...b.products.flatMap((p) => [...(p.product ? [`_${p.product}_`] : []), ...p.items.map(line)])]),
  ].join("\n"));
  return [`# Week ${label} by day`, ...(body.length ? body : ["Nothing logged this week."])].join("\n\n");
}
