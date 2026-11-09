import { describe, expect, it } from "vitest";
import { carriedFrom, carriedPick, inMonth, monthDelta, monthTab, overdue, weekMonth, type RuleItem } from "@/lib/plan-rules";
import type { MonthKey } from "@/lib/vault-types";

const it_ = (over: Partial<RuleItem> & { id?: string }): RuleItem & { id?: string } => ({ lane: "now", checkpoint: null, focus: null, ...over });

describe("carriedFrom", () => {
  it("is the old focus week for an open Now item", () => expect(carriedFrom(it_({ focus: "2026-W45" }), "2026-W46")).toBe("2026-W45"));
  it("is null for the current or a later week", () => {
    expect(carriedFrom(it_({ focus: "2026-W46" }), "2026-W46")).toBeNull();
    expect(carriedFrom(it_({ focus: "2026-W47" }), "2026-W46")).toBeNull();
  });
  it("is null for Next, Someday, done and unfocused items", () => {
    expect(carriedFrom(it_({ lane: "next", focus: "2026-W40" }), "2026-W46")).toBeNull();
    expect(carriedFrom(it_({ lane: "backlog", focus: "2026-W40" }), "2026-W46")).toBeNull();
    expect(carriedFrom(it_({ done: true, focus: "2026-W40" }), "2026-W46")).toBeNull();
    expect(carriedFrom(it_({ lane: "done", focus: "2026-W40" }), "2026-W46")).toBeNull();
    expect(carriedFrom(it_({}), "2026-W46")).toBeNull();
  });
  it("compares across the year boundary lexically", () => expect(carriedFrom(it_({ focus: "2025-W52" }), "2026-W01")).toBe("2025-W52"));
});

describe("weekMonth (month of the ISO Thursday)", () => {
  it.each([["2026-W49", "dec"], ["2026-W53", "dec"], ["2026-W46", "nov"], ["2026-W01", "jan"], ["2025-W01", "jan"], ["2026-W44", "oct"], ["2026-W45", "nov"]])("%s -> %s", (w, m) => expect(weekMonth(w)).toBe(m));
  it("is null for a bad label", () => expect(weekMonth("nope")).toBeNull());
});

describe("monthDelta and overdue (fixtures are current, checkpoint)", () => {
  // Spec fixtures: "(dec, jan) ahead; (jan, oct) overdue; (nov, oct) overdue; (nov, dec) ahead" read as (current, checkpoint).
  it.each([["dec", "jan", "ahead"], ["jan", "oct", "overdue"], ["nov", "oct", "overdue"], ["nov", "dec", "ahead"], ["oct", "oct", "this"]] as [MonthKey, MonthKey, string][])("current %s, checkpoint %s is %s", (current, cp, kind) => {
    const d = monthDelta(cp, current);
    expect(kind === "overdue" ? d >= 6 : kind === "ahead" ? d >= 1 && d <= 5 : d === 0).toBe(true);
    expect(overdue(it_({ checkpoint: cp }), current)).toBe(kind === "overdue");
  });
  it("done or lane done is never overdue; no checkpoint is never overdue", () => {
    expect(overdue(it_({ checkpoint: "oct", done: true }), "jan")).toBe(false);
    expect(overdue(it_({ checkpoint: "oct", lane: "done" }), "jan")).toBe(false);
    expect(overdue(it_({}), "jan")).toBe(false);
  });
  it("delta 6 is overdue, delta 5 is ahead", () => {
    expect(overdue(it_({ checkpoint: "apr" }), "oct")).toBe(true);   // 3-9 = -6 -> 6
    expect(overdue(it_({ checkpoint: "mar" }), "oct")).toBe(false);  // 5
  });
});

describe("carriedPick", () => {
  it("latest focus week wins", () => {
    const items = [it_({ id: "a", focus: "2026-W43" }), it_({ id: "b", focus: "2026-W45" })];
    expect(carriedPick(items, "2026-W46")?.id).toBe("b");
  });
  it("ties go to the lowest order", () => {
    const items = [it_({ id: "a", focus: "2026-W45", order: 9 }), it_({ id: "b", focus: "2026-W45", order: 2 })];
    expect(carriedPick(items, "2026-W46")?.id).toBe("b");
  });
  it("is null with nothing carried", () => expect(carriedPick([it_({ lane: "next", focus: "2026-W40" })], "2026-W46")).toBeNull());
});

describe("monthTab", () => {
  it("orders overdue, this month's checkpoint, focus-week items, then lane, then existing order", () => {
    const items = [
      it_({ id: "backlog-cp", lane: "backlog", checkpoint: "nov" }),
      it_({ id: "now-focus", lane: "now", focus: "2026-W46" }),
      it_({ id: "late", lane: "backlog", checkpoint: "jun" }),
      it_({ id: "next-cp", lane: "next", checkpoint: "nov" }),
      it_({ id: "later", lane: "now", checkpoint: "dec" }),
      it_({ id: "done", lane: "done", checkpoint: "nov" }),
      it_({ id: "now-cp", lane: "now", checkpoint: "nov" }),
    ];
    expect(monthTab(items, "nov", "2026-W46").map((i) => i.id)).toEqual(["late", "now-cp", "next-cp", "backlog-cp", "now-focus"]);
  });
  it("declared boundary: on 2026-11-30 (W49 -> dec) an item focused W49 is NOT in the Nov Month tab", () => {
    expect(weekMonth("2026-W49")).toBe("dec");
    expect(inMonth(it_({ focus: "2026-W49" }), "nov", "2026-W49")).toBe(false);
    expect(monthTab([it_({ focus: "2026-W49" })], "nov", "2026-W49")).toEqual([]);
    expect(inMonth(it_({ focus: "2026-W49" }), "dec", "2026-W49")).toBe(true);
  });
  it("an item focused in a past week of this month is not included by focus alone", () => expect(inMonth(it_({ focus: "2026-W45" }), "nov", "2026-W46")).toBe(false));
});
