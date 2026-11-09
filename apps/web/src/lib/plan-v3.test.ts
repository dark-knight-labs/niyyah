import { describe, expect, it } from "vitest";
import {
  deleteWarning, firstSentence, habitLoss, gateShare, groupGoals, habitsByGoal, nextQuarter, planHabits, plainTags, quarterOf, quarterTabs, tabLabel, tagSlug,
  taskProducts, weekChecks, weekLabel, weekStart,
} from "@/lib/plan-v3";
import type { HabitData, ProductData } from "@/lib/vault-types";

const prod = (slug: string, position: number, over: Partial<ProductData> = {}): ProductData => ({ id: position + 1, block: "studio", slug, name: slug, position, tasks: 0, goals: 0, ...over });
const goal = (id: string, product?: string) => ({ id, text: id, done: false, product });
const habit = (over: Partial<HabitData> = {}): HabitData => ({
  id: 1, name: "Walk", block: "soul", anchor: "", per_week: 3, minimum: "", stage: "installing", stream: "studio", goal_ref: null, gate_pct: 80, gate_weeks: 8,
  trip_pct: null, trip_weeks: null, started_on: "2026-10-06", today: null, streak: 0, gate_run: 2, gate_met: false, tripwire: null, weeks: [], days: {}, ...over,
});

describe("quarters", () => {
  it("steps over the year end", () => {
    expect(nextQuarter("2026-Q3")).toBe("2026-Q4");
    expect(nextQuarter("2026-Q4")).toBe("2027-Q1");
  });
  it("finds the quarter of a day, either side of the new year", () => {
    expect(quarterOf("2026-12-31")).toBe("2026-Q4");
    expect(quarterOf("2027-01-01")).toBe("2027-Q1");
  });
  it("labels future quarters with next", () => {
    expect(tabLabel("2026-Q4", "2026-Q4")).toBe("Q4'26");
    expect(tabLabel("2027-Q1", "2026-Q4")).toBe("Q1'27 · next");
    expect(tabLabel("2027-Q3", "2026-Q4")).toBe("Q3'27");   // only the quarter right after the current one is "next"
    expect(tabLabel("2027-Q2", "2027-Q1")).toBe("Q2'27 · next");
  });
  it("tabs: current, next, quarters with goals; + opens the one after the last", () => {
    expect(quarterTabs("2026-Q4", undefined)).toEqual({ tabs: ["2026-Q4", "2027-Q1"], plus: "2027-Q2" });
    expect(quarterTabs("2026-Q4", ["2026-Q4", "2027-Q1", "2027-Q3"])).toEqual({ tabs: ["2026-Q4", "2027-Q1", "2027-Q3"], plus: "2027-Q4" });
    expect(quarterTabs("2026-Q4", ["2026-Q4"], ["2027-Q2"])).toEqual({ tabs: ["2026-Q4", "2027-Q1", "2027-Q2"], plus: "2027-Q3" });
  });
  it("the tabs follow the clock across the new year (frozen 2027-01-01)", () => {
    expect(quarterTabs(quarterOf("2027-01-01"), ["2026-Q4", "2027-Q1"])).toEqual({ tabs: ["2027-Q1", "2027-Q2"], plus: "2027-Q3" });
  });
});

describe("compass line", () => {
  it("takes the first sentence", () => {
    expect(firstSentence("Allah's satisfaction. I live it as a builder.")).toBe("Allah's satisfaction.");
    expect(firstSentence("No full stop here")).toBe("No full stop here");
    expect(firstSentence("  One. Two. ")).toBe("One.");
    expect(firstSentence("")).toBe("");
  });
});

describe("goals by product", () => {
  const products = [prod("dns", 1), prod("router", 0)];
  it("orders products by position, then no product; empty groups vanish", () => {
    const groups = groupGoals([goal("a", "dns"), goal("b"), goal("c", "router"), goal("d", "gone")], products);
    expect(groups.map((g) => [g.product?.slug ?? null, g.goals.map((x) => x.id)])).toEqual([["router", ["c"]], ["dns", ["a"]], [null, ["b", "d"]]]);
    expect(groupGoals([goal("a")], products).map((g) => g.product)).toEqual([null]);
    expect(groupGoals([], products)).toEqual([]);
  });
});

describe("product tags on a task", () => {
  const products = [prod("home-lab", 0), prod("dns", 1)];
  it("slugs tags", () => {
    expect(tagSlug("Home Lab")).toBe("home-lab");
    expect(tagSlug("DNS")).toBe("dns");
    expect(tagSlug("--odd__tag--")).toBe("odd-tag");
  });
  it("a tag is a product when its slug is; others stay plain", () => {
    expect(taskProducts(["DNS", "Home Lab", "loose"], products)).toEqual(["dns", "home-lab"]);
    expect(plainTags(["DNS", "Home Lab", "loose"], products)).toEqual(["loose"]);
    expect(taskProducts(undefined, products)).toEqual([]);
  });
});

describe("habit ticks", () => {
  it("weeks start on Monday", () => {
    expect(weekStart("2026-11-09")).toBe("2026-11-09"); // a Monday
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // the Sunday after
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
  it("counts the checked days of this week only", () => {
    const h = { days: { "2026-11-08": "done", "2026-11-09": "done", "2026-11-11": "min", "2026-11-12": "done" } as HabitData["days"] };
    expect(weekChecks(h, "2026-11-11")).toBe(2); // the 12th is after today, the 8th is last week
    expect(weekChecks(h, "2026-11-15")).toBe(3);
    expect(weekChecks({ days: {} }, "2026-11-11")).toBe(0);
  });
  it("labels the week and the bar", () => {
    expect(weekLabel(habit())).toBe("wk 2/8");
    expect(weekLabel(habit({ gate_run: 11 }))).toBe("wk 8/8");
    expect(weekLabel(habit({ stage: "rails" }))).toBe("");
    expect(gateShare(habit())).toBe(25);
    expect(gateShare(habit({ gate_run: 20 }))).toBe(100);
  });
});

describe("habits in the block cell", () => {
  const hs = [habit({ id: 1, goal_ref: "g1" }), habit({ id: 2, goal_ref: null }), habit({ id: 3, goal_ref: "old" }), habit({ id: 4, goal_ref: "n1" }),
    habit({ id: 5, goal_ref: "g1" }), habit({ id: 6, goal_ref: "gone" })];
  it("sorts them under their goal, the ended heading and no goal", () => {
    const r = habitsByGoal(hs, ["g1", "g2"], ["old"], ["n1"]);
    expect([...r.byGoal].map(([k, v]) => [k, v.map((h) => h.id)])).toEqual([["g1", [1, 5]]]);
    expect(r.ended.map((h) => h.id)).toEqual([3]);
    expect(r.loose.map((h) => h.id)).toEqual([2]);
    expect(r.removed.map((h) => h.id)).toEqual([6]); // 4 belongs to another tab's quarter and is listed nowhere here
  });
  it("a habit with no stream belongs to its day block when that is a Plan block (the API says so in plan_block)", () => {
    const all = [habit({ id: 1, stream: null, plan_block: "studio" }), habit({ id: 2, stream: null, plan_block: null }), habit({ id: 3, stream: "studio", plan_block: "studio" })];
    expect(planHabits(all, ["studio"]).map((h) => h.id)).toEqual([1, 3]);
  });
  it("shows only live habits of Plan blocks", () => {
    const all = [habit({ id: 1 }), habit({ id: 2, stage: "retired" }), habit({ id: 3, stream: null }), habit({ id: 4, stream: "elsewhere" })];
    expect(planHabits(all, ["studio"]).map((h) => h.id)).toEqual([1]);
  });
});

describe("what Make it a habit loses", () => {
  it("names details past the short limit, sub-tasks and tags; nothing when there are none", () => {
    expect(habitLoss({})).toEqual([]);
    expect(habitLoss({ description: "Five minutes of stretching" })).toEqual([]);   // short details become the minimum
    expect(habitLoss({ description: "x".repeat(121), subtasks: 2, products: ["dns", "lab"] })).toEqual(["its details", "2 sub-tasks", "its tags (#dns #lab)"]);
    expect(habitLoss({ subtasks: 1, products: ["dns"] })).toEqual(["1 sub-task", "its tag (#dns)"]);
  });
});

describe("delete warning", () => {
  it("says how many tasks and goals lose the tag", () => {
    expect(deleteWarning({ name: "Router", tasks: 3, goals: 1 })).toBe("Delete Router? 3 tasks and 1 goal lose the tag; nothing else is deleted.");
    expect(deleteWarning({ name: "Router", tasks: 1, goals: 0 })).toBe("Delete Router? 1 task and 0 goals lose the tag; nothing else is deleted.");
  });
});
