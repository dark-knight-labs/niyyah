import { describe, expect, it } from "vitest";
import { doneText, groupByDay } from "@/lib/weekly-log";
import { WeeklyLogData } from "@/lib/vault-types";

const entry = (id: number, stream: string, done: boolean) => ({ id, text: `t${id}`, stream, done, on: done ? "done" as const : "captured" as const, link: null, tracked_seconds: 0 });
const log: WeeklyLogData = {
  week: "2026-W48", start: "2026-11-22", end: "2026-11-28", prev_week: "2026-W47", next_week: "2026-W49",
  streams: [{ stream: "kahf", name: "Kahf", color: "violet", done: 1, total: 2 }, { stream: "alisha", name: "Alisha Noor", color: "rose", done: 0, total: 1 }],
  days: [
    { day: "2026-11-22", entries: [] },
    { day: "2026-11-23", entries: [entry(1, "alisha", false), entry(2, "kahf", true), entry(3, "kahf", false)] },
  ],
};

describe("weekly log", () => {
  it("keeps every day and orders streams as the week's totals list them", () => {
    const days = groupByDay(log);
    expect(days.map((d) => d.day)).toEqual(["2026-11-22", "2026-11-23"]);
    expect(days[0]).toMatchObject({ groups: [], count: 0 });
    expect(days[1].groups.map((g) => [g.stream.name, g.entries.map((e) => e.id)])).toEqual([["Kahf", [2, 3]], ["Alisha Noor", [1]]]);
    expect(days[1].count).toBe(3);
  });
  it("keeps a stream it does not know under its slug", () => {
    const odd: WeeklyLogData = { ...log, streams: [], days: [{ day: "2026-11-23", entries: [entry(9, "mystery", true)] }] };
    expect(groupByDay(odd)[0].groups[0].stream).toMatchObject({ stream: "mystery", name: "mystery" });
  });
  it("words the per-stream count", () => expect(doneText(log.streams[0])).toBe("1 of 2 done"));
});
