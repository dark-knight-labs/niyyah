import { describe, expect, it } from "vitest";
import { CAPS, capped, columnOf, dateText, goalIndex, groupByGoal, isLate, labelOf, matchesLabel, monthText, monthsOfQuarter, nestedCount, quarterText, sinceWeek } from "@/lib/plan-v2";

const item = (over: Record<string, unknown> = {}) => ({ lane: "next" as const, done: false, label_month: null, label_date: null, goal_ref: null, focus: null, ...over });

describe("label text", () => {
  it("formats months, days and quarters", () => {
    expect(monthText("2026-11")).toBe("Nov-2026");
    expect(monthText("2027-01")).toBe("Jan-2027");
    expect(dateText("2026-11-12")).toBe("Thu 12 Nov");
    expect(quarterText("2026-Q4")).toBe("Q4'26");
    expect(monthsOfQuarter("2026-Q4")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(monthsOfQuarter("2027-Q1")).toEqual(["2027-01", "2027-02", "2027-03"]);
  });
  it("labelOf prefers the day and is null without a label", () => {
    expect(labelOf(item())).toBeNull();
    expect(labelOf(item({ label_month: "2026-11" }))).toEqual({ kind: "month", value: "2026-11", text: "Nov-2026" });
    expect(labelOf(item({ label_date: "2026-11-12" }))?.text).toBe("Thu 12 Nov");
  });
});

describe("isLate", () => {
  const today = "2026-11-09";
  it("a past month is late, this and later months are not", () => {
    expect(isLate(item({ label_month: "2026-10" }), today)).toBe(true);
    expect(isLate(item({ label_month: "2026-11" }), today)).toBe(false);
    expect(isLate(item({ label_month: "2026-12" }), today)).toBe(false);
    expect(isLate(item({ label_month: "2025-12" }), "2026-01-02")).toBe(true);
  });
  it("a past day is late, today and later are not", () => {
    expect(isLate(item({ label_date: "2026-11-08" }), today)).toBe(true);
    expect(isLate(item({ label_date: "2026-11-09" }), today)).toBe(false);
    expect(isLate(item({ label_date: "2026-11-10" }), today)).toBe(false);
  });
  it("done and unlabelled items are never late", () => {
    expect(isLate(item({ label_month: "2026-01", done: true }), today)).toBe(false);
    expect(isLate(item({ label_month: "2026-01", lane: "done" }), today)).toBe(false);
    expect(isLate(item(), today)).toBe(false);
  });
});

describe("matchesLabel", () => {
  const today = "2026-11-09";
  it("filters by all, none, late and a month (a day counts in its month)", () => {
    const month = item({ label_month: "2026-11" }), day = item({ label_date: "2026-11-12" }), old = item({ label_month: "2026-10" }), bare = item();
    expect([month, day, old, bare].map((i) => matchesLabel(i, "all", today))).toEqual([true, true, true, true]);
    expect([month, day, old, bare].map((i) => matchesLabel(i, "2026-11", today))).toEqual([true, true, false, false]);
    expect([month, day, old, bare].map((i) => matchesLabel(i, "none", today))).toEqual([false, false, false, true]);
    expect([month, day, old, bare].map((i) => matchesLabel(i, "late", today))).toEqual([false, false, true, false]);
  });
});

describe("grouping under goals", () => {
  const goals = goalIndex([{ id: "g1", text: "Ship" }, { id: "g2", text: "Rest" }], "2026-Q4", [{ id: "old", text: "Last quarter", quarter: "2026-Q3" }]);
  const a = item({ goal_ref: "g2" }), b = item({ goal_ref: "g1" }), c = item(), d = item({ goal_ref: "old" }), e = item({ goal_ref: "gone" });
  it("orders groups by goal, ended goals after, not nested last; unknown refs count as not nested", () => {
    const groups = groupByGoal([a, b, c, d, e], goals);
    expect(groups.map((g) => g.goal?.id ?? null)).toEqual(["g1", "g2", "old", null]);
    expect(groups[2].goal?.ended).toBe(true);
    expect(groups[3].items).toEqual([c, e]);
  });
  it("leaves out empty groups and returns one plain group when nothing is nested", () => {
    expect(groupByGoal([c], goals)).toEqual([{ goal: null, items: [c] }]);
    expect(groupByGoal([], goals)).toEqual([]);
  });
  it("an ended goal also in the current list is not listed twice", () => {
    expect(goalIndex([{ id: "g1", text: "Ship" }], "2026-Q4", [{ id: "g1", text: "Ship", quarter: "2026-Q3" }])).toHaveLength(1);
  });
  it("counts done / nested across every lane", () => {
    expect(nestedCount([item({ goal_ref: "g1" }), item({ goal_ref: "g1", lane: "done", done: true }), item({ goal_ref: "g2" })], "g1")).toEqual({ done: 1, total: 2 });
    expect(nestedCount([], "g1")).toEqual({ done: 0, total: 0 });
  });
});

describe("columns, caps and since", () => {
  it("places items in a column", () => {
    expect(columnOf(item({ lane: "now" }))).toBe("now");
    expect(columnOf(item({ lane: "backlog" }))).toBe("someday");
    expect(columnOf(item({ lane: "done", done: true }))).toBeNull();
    expect(columnOf(item({ lane: "now", done: true }))).toBeNull();
  });
  it("caps Next at 6 and Someday at 3 with a +n more count, until opened", () => {
    const ten = Array.from({ length: 10 }, (_, i) => i);
    expect(capped(ten, CAPS.next, false)).toEqual({ shown: [0, 1, 2, 3, 4, 5], more: 4 });
    expect(capped(ten, CAPS.someday, false).more).toBe(7);
    expect(capped(ten, CAPS.next, true)).toEqual({ shown: ten, more: 0 });
    expect(capped(ten, CAPS.now, false).more).toBe(0);
  });
  it("keeps order for ties (the list is already in lane order)", () => {
    expect(capped(["x", "y", "z"], 2, false).shown).toEqual(["x", "y"]);
  });
  it("since shows only for open Now items focused in an earlier week", () => {
    expect(sinceWeek(item({ lane: "now", focus: "2026-W45" }), "2026-W46")).toBe("W45");
    expect(sinceWeek(item({ lane: "now", focus: "2026-W46" }), "2026-W46")).toBeNull();
    expect(sinceWeek(item({ lane: "next", focus: "2026-W40" }), "2026-W46")).toBeNull();
    expect(sinceWeek(item({ lane: "now", done: true, focus: "2026-W40" }), "2026-W46")).toBeNull();
  });
});
