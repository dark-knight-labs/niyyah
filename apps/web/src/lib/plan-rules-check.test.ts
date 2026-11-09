import { describe, expect, it } from "vitest";
import { check, isoWeekOf, type ExportV1 } from "../../scripts/plan-rules-check";

// Synthetic export: invented text-free rows only.
const exp: ExportV1 = {
  quarters: [{ label: "2026-Q4" }],
  week_objectives: [{ week: "2026-W46", stream: "shop", text: "Ship the thing" }],
  pipeline_items: [
    { id: 1, stream: "studio", lane: "now", focus_week: "2026-W43" },
    { id: 2, stream: "studio", lane: "now", focus_week: "2026-W45" },
    { id: 3, stream: "studio", lane: "next", focus_week: "2026-W40" },
    { id: 4, stream: "shop", lane: "now", focus_week: "2026-W45" },
    { id: 5, stream: "shop", lane: "backlog", checkpoint: "jun" },
    { id: 6, stream: "shop", lane: "next", checkpoint: "nov" },
    { id: 7, stream: "shop", lane: "done", checkpoint: "jun", done: true },
    { id: 8, stream: "studio", lane: "now", focus_week: "2026-W46" },
  ],
};

describe("isoWeekOf", () => {
  it.each([["2026-11-09", "2026-W46"], ["2026-11-30", "2026-W49"], ["2027-01-01", "2026-W53"], ["2026-01-01", "2026-W01"]])("%s -> %s", (d, w) => expect(isoWeekOf(d)).toBe(w));
});

describe("check", () => {
  it("runs the plan rules over an export", () => {
    expect(check(exp, "2026-11-09")).toEqual({
      week: "2026-W46",
      current: "nov",
      carried: ["1", "2", "4"],
      carriedPick: { studio: "2" },          // shop has an objective this week, so no pick
      overdue: ["5"],
      monthTab: ["5", "6", "8"],
    });
  });
  it("is deterministic and does not mutate the input", () => {
    const before = JSON.stringify(exp);
    expect(check(exp, "2026-11-09")).toEqual(check(exp, "2026-11-09"));
    expect(JSON.stringify(exp)).toBe(before);
  });
  it("tolerates an empty export", () => expect(check({}, "2026-11-09").monthTab).toEqual([]));
});
