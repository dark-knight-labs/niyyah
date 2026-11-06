import { describe, expect, it } from "vitest";
import { COMMANDS, LIVE_BLOCKED, MENUS, REGISTRY, appliesTo, barOf, makeSel, resolveMenu, runCommand, type Env, type Kind } from "./commands";
import { dataFrom } from "./state";
import { childIndex } from "./tree";
import type { BoardEdge, BoardNode, Op } from "./types";

const row = (id: string, o: Partial<BoardNode> = {}): BoardNode => ({
  id, kind: "mind", parent_id: null, parent_key: null, position: 0, x: 0, y: 0, w: 0, h: 0, text: id, notes: "", style: {}, collapsed: false, hidden: false, ref_key: null, frame_id: null, updated_at: null, ...o,
});
const nodes = [
  row("r"), row("a", { parent_id: "r", style: { side: "R" } }), row("a1", { parent_id: "a" }), row("b", { parent_id: "r", position: 1 }),
  row("live", { kind: "ref", ref_key: "task:1", parent_id: "r", position: 2 }),
  row("st", { kind: "sticky", x: 300 }), row("sh", { kind: "shape" }), row("tx", { kind: "text" }), row("fr", { kind: "frame" }), row("im", { kind: "image" }), row("fi", { kind: "file" }),
];
const edge: BoardEdge = { id: "e1", from_id: "st", to_id: "sh", label: "", style: {} };
const data = dataFrom(nodes, [edge]);
const idx = childIndex(data.nodes);
const sel = (ids: string[], extra = {}) => makeSel({ ids, data, idx, canMake: true, rects: new Map(nodes.map((n) => [n.id, { x: 0, y: 0, w: 100, h: 30 }])), ...extra });
const ids = (s: ReturnType<typeof sel>) => resolveMenu(s).flat().map((i) => i.id);

describe("selection kinds", () => {
  it("classifies", () => {
    const k = (i: string[]) => sel(i).kind;
    expect([k([]), k(["r"]), k(["live"]), k(["st"]), k(["sh"]), k(["tx"]), k(["fr"]), k(["im"]), k(["fi"]), k(["e1"]), k(["st", "sh"])]).toEqual(
      ["pane", "mind", "live", "sticky", "shape", "text", "frame", "image", "file", "edge", "multi"] satisfies Kind[]);
  });
});

describe("registry", () => {
  it("every menu entry names a registered command, ids are unique", () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
    for (const [kind, groups] of Object.entries(MENUS)) for (const g of groups) for (const id of g) expect(REGISTRY.has(id), `${kind}: ${id}`).toBe(true);
  });
  it("every menu entry applies to the kind it is listed under", () => {
    for (const [kind, groups] of Object.entries(MENUS)) for (const id of groups.flat()) expect(REGISTRY.get(id)!.kinds, `${kind}/${id}`).toContain(kind);
  });
  it("mind menu offers structure, style, layout, and delete", () => {
    const m = ids(sel(["a"]));
    for (const id of ["child", "sibling", "parent", "edit", "color", "fill", "layout", "organizeMap", "fold", "detach", "connect", "delete"]) expect(m, id).toContain(id);
  });
  it("a root has no sibling/parent/detach; a leaf can become a sticky", () => {
    const m = ids(sel(["r"]));
    for (const id of ["sibling", "parent", "detach", "fold"]) expect(m).not.toContain(id);
    expect(ids(sel(["b"]))).toContain("toSticky");
    expect(ids(sel(["a"]))).not.toContain("toSticky");
  });
  it("pane menu adds things and organizes", () => {
    expect(ids(sel([], { pos: { x: 1, y: 2 } }))).toEqual(expect.arrayContaining(["addSticky", "addMind", "addShape", "addText", "addFrame", "selectAll", "organizeAll", "fit"]));
  });
  it("sticky gets eight colours", () => {
    const c = resolveMenu(sel(["st"])).flat().find((i) => i.id === "color")!;
    expect(c.choices!.map((x) => x.id)).toEqual(["yellow", "orange", "green", "teal", "blue", "violet", "pink", "gray"]);
  });
});

describe("live (Plan) nodes", () => {
  it("never offer a command that edits, deletes, cuts, converts or detaches", () => {
    for (const id of LIVE_BLOCKED) { const c = REGISTRY.get(id); if (c) expect(appliesTo(c, sel(["live"])), id).toBe(false); }
    const m = ids(sel(["live"]));
    for (const id of ["edit", "delete", "deleteBranch", "cut", "convert", "detach", "toSticky", "note", "make"]) expect(m, id).not.toContain(id);
    expect(m).toEqual(expect.arrayContaining(["hide", "color", "layout", "connect", "showInPlan"]));
  });
  it("a live node in a multi-selection still blocks cut/convert, but Delete (which hides it) stays", () => {
    const m = ids(sel(["a", "live"]));
    expect(m).toContain("delete"); expect(m).not.toContain("cut");
  });
});

describe("running", () => {
  const calls: string[] = [];
  const ops: Op[][] = [];
  const env = new Proxy({ commit: (o: Op[]) => { ops.push(o); return true; } } as unknown as Env, { get: (t, k: string) => (k in t ? (t as never)[k] : (...a: unknown[]) => { calls.push(`${k}:${a.join(",")}`); }) });
  it("color writes style.color on the node as one batch", () => {
    ops.length = 0;
    expect(runCommand(env, sel(["a"]), "color", "orange")).toBe(true);
    expect(ops).toHaveLength(1);
    expect((ops[0][0] as { node: BoardNode }).node.style).toEqual({ side: "R", color: "orange" });
  });
  it("a command that does not apply does not run", () => {
    ops.length = 0;
    expect(runCommand(env, sel(["live"]), "detach")).toBe(false);
    expect(ops).toHaveLength(0);
  });
  it("layout asks the canvas to organize this map", () => {
    calls.length = 0;
    runCommand(env, sel(["a1"]), "layout", "down");
    expect(calls).toEqual(["organize:r,down"]);
  });
  it("the bar is read from the registry", () => {
    expect(barOf(sel(["a"])).map((b) => b.id)).toEqual(["child", "sibling", "fold", "make", "connect", "delete"]);
    expect(barOf(sel(["live"])).map((b) => b.id)).toEqual(["child", "connect", "hide"]);
  });
});
