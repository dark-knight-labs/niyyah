import { QuarterStreamData, PipelineStreamData, VaultTaskData } from "@/lib/vault-types";

export interface ReportItem { text: string; tags: string[]; day: string | null; source: "task" | "plan"; }
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
      const item: ReportItem = { text: t.text, tags: t.products ?? [], day, source: "task" };
      (t.done ? group(t.stream).done : group(t.stream).open).push(item);
    }
  }
  for (const s of pipelines) {
    for (const i of s.items) {
      if (i.done_on && i.done_on >= first && i.done_on <= last) group(s.stream).done.push({ text: i.text, tags: i.products ?? [], day: i.done_on, source: "plan" });
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
