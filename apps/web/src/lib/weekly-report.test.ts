import { describe, expect, it } from "vitest";
import { dayMarkdown, weeklyByDay, weeklyReport } from "@/lib/weekly-report";
import type { PipelineItemData, PipelineStreamData, VaultTaskData } from "@/lib/vault-types";

const DAYS = ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"];
const streams = [{ stream: "studio", name: "Studio", color: "blue" }, { stream: "shop", name: "Shop", color: "pink" }];
const task = (text: string, o: Partial<VaultTaskData> = {}): VaultTaskData => ({ path: "p", line: 1, hash: "h", text, done: false, stream: "studio", ...o });
const planItem = (text: string, o: Partial<PipelineItemData> = {}) => ({ line: 1, hash: "h", text, lane: "done", done: true, done_on: "2026-11-24", ...o }) as PipelineItemData;
const pipeline = (stream: string, items: PipelineItemData[]) => ({ stream, items }) as unknown as PipelineStreamData;

describe("weeklyByDay", () => {
  it("groups day -> block -> product and puts no-tag items last", () => {
    const report = weeklyReport(DAYS, {
      "2026-11-23": [task("Wire", { done: true, products: ["router"] }), task("Plain", { done: true }), task("Cable", { done: true, products: ["router", "lab"] })],
    }, streams, []);
    const [day] = weeklyByDay(report);
    expect(day.day).toBe("2026-11-23");
    expect(day.blocks).toHaveLength(1);
    expect(day.blocks[0].name).toBe("Studio");
    expect(day.blocks[0].products.map((p) => p.product)).toEqual(["router", null]); // an item sits under its first tag only
    expect(day.blocks[0].products[0].items.map((i) => i.text)).toEqual(["Wire", "Cable"]);
  });

  it("leaves empty days out and sorts the days", () => {
    const report = weeklyReport(DAYS, { "2026-11-26": [task("Late", { done: true })], "2026-11-23": [task("Early", { done: true })] }, streams, []);
    expect(weeklyByDay(report).map((d) => d.day)).toEqual(["2026-11-23", "2026-11-26"]);
    expect(weeklyByDay([])).toEqual([]);
  });

  it("puts a Plan item finished mid-week on its done day, in its own block, marked as a plan item", () => {
    const report = weeklyReport(DAYS, {}, streams, [pipeline("shop", [planItem("Launch", { done_on: "2026-11-24", products: ["store"] }), planItem("Old", { done_on: "2026-10-01" })])]);
    const days = weeklyByDay(report);
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe("2026-11-24");
    expect(days[0].blocks[0].name).toBe("Shop");
    expect(days[0].blocks[0].products[0].product).toBe("store");
    expect(days[0].blocks[0].products[0].items[0].source).toBe("plan");
    expect(days[0].blocks[0].products[0].items[0].ref?.kind).toBe("plan");
  });

  it("lists done items before open ones inside a product and keeps blocks apart", () => {
    const report = weeklyReport(DAYS, { "2026-11-25": [task("Open one", { products: ["x"] }), task("Done one", { done: true, products: ["x"] }), task("Other block", { stream: "shop", done: true })] }, streams, []);
    const [day] = weeklyByDay(report);
    expect(day.blocks.map((b) => b.name).sort()).toEqual(["Shop", "Studio"]);
    const studio = day.blocks.find((b) => b.name === "Studio")!;
    expect(studio.products[0].items.map((i) => `${i.text}:${i.done}`)).toEqual(["Done one:true", "Open one:false"]);
  });

  it("writes Markdown per day, with the block and product lines", () => {
    const md = dayMarkdown("22–28 Nov 2026", weeklyByDay(weeklyReport(DAYS, { "2026-11-23": [task("Wire", { done: true, products: ["router"] })] }, streams, [])));
    expect(md).toContain("# Week 22–28 Nov 2026 by day");
    expect(md).toContain("## 2026-11-23");
    expect(md).toContain("**Studio**");
    expect(md).toContain("_router_");
    expect(md).toContain("- [x] Wire #router");
    expect(dayMarkdown("w", [])).toContain("Nothing logged this week.");
  });
});
