import { describe, expect, it, vi } from "vitest";
import type { Proposal } from "@/lib/advisor-api";
import { askErrorMessage, decide, decisionErrorMessage, filteredNote, probeAdvisor } from "@/lib/advisor";

const prop = (id: number, status = "pending"): Proposal => ({ id, kind: "note_add", payload: {}, text: "t", summary: "t", reason: null, status, created_at: null, decided_at: null });
const fail = (status: number | undefined, message = "x") => Object.assign(new Error(message), { status });

describe("probeAdvisor", () => {
  it("returns the list on 200", async () => {
    expect(await probeAdvisor({ proposals: async () => [prop(1)] })).toEqual([prop(1)]);
  });
  it.each([403, 404, 500, 502, undefined])("is null (panel hidden) on %s", async (status) => {
    expect(await probeAdvisor({ proposals: async () => { throw fail(status); } })).toBeNull();
  });
  it("is null when the body is not a list", async () => {
    expect(await probeAdvisor({ proposals: async () => ({}) as unknown as Proposal[] })).toBeNull();
  });
});

describe("error mapping", () => {
  it("ask: cap, timeout, down, network", () => {
    expect(askErrorMessage(fail(429))).toMatch(/limit/i);
    expect(askErrorMessage(fail(504))).toMatch(/too long.*narrower/i);
    expect(askErrorMessage(fail(502))).toMatch(/could not answer/i);
    expect(askErrorMessage(fail(503))).toMatch(/could not answer/i);
    expect(askErrorMessage(fail(undefined))).toMatch(/reach the server/i);
  });
  it("decision: stale, filter 409, core 422", () => {
    expect(decisionErrorMessage(fail(409, "stale: the item moved"))).toEqual({ text: "Out of date: the item moved. It was not applied.", stale: true });
    expect(decisionErrorMessage(fail(409, "text quotes scripture that is not in the verified set")).stale).toBe(false);
    expect(decisionErrorMessage(fail(409, "text quotes scripture that is not in the verified set")).text).toMatch(/verified set/);
    expect(decisionErrorMessage(fail(422, "no such item")).text).toMatch(/no such item.*still waiting/);
  });
  it("filtered note", () => {
    expect(filteredNote({ filtered: false, removed: 0 })).toBeNull();
    expect(filteredNote({ filtered: true, removed: 1 })).toBe("1 passage removed (not in the verified set)");
    expect(filteredNote({ filtered: true, removed: 3 })).toBe("3 passages removed (not in the verified set)");
  });
});

describe("decide", () => {
  const calls = (over: Partial<Record<"approve" | "reject", () => Promise<Proposal>>> = {}) => ({
    proposals: async () => [],
    approve: vi.fn(over.approve ?? (async () => prop(1, "approved"))),
    reject: vi.fn(over.reject ?? (async () => prop(1, "rejected"))),
  });
  it("approve success reloads the plan, then refreshes the list", async () => {
    const order: string[] = [];
    const r = await decide(calls(), "approve", 1, { onApplied: () => { order.push("plan"); }, onSettled: () => { order.push("list"); } });
    expect(r.ok).toBe(true);
    expect(order).toEqual(["plan", "list"]);
  });
  it("reject refreshes the list but not the plan", async () => {
    const onApplied = vi.fn();
    const onSettled = vi.fn();
    await decide(calls(), "reject", 1, { onApplied, onSettled });
    expect(onApplied).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });
  it("a 422 refusal does not reload the plan and shows the detail", async () => {
    const onApplied = vi.fn();
    const onSettled = vi.fn();
    const r = await decide(calls({ approve: async () => { throw fail(422, "no such item"); } }), "approve", 1, { onApplied, onSettled });
    expect(r).toMatchObject({ ok: false, stale: false });
    expect(r.ok === false && r.error).toMatch(/no such item/);
    expect(onApplied).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });
  it("a stale 409 is flagged and the list refreshes (it is now stale there)", async () => {
    const onSettled = vi.fn();
    const r = await decide(calls({ approve: async () => { throw fail(409, "stale: moved"); } }), "approve", 1, { onSettled });
    expect(r).toMatchObject({ ok: false, stale: true });
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
