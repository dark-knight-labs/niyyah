import { describe, expect, it } from "vitest";
import { copySelection, countOutline, looksLikeOutline, outlineOf, outlineOps, parseOutline, pasteClip } from "./clipboard";
import { applyOps, dataFrom } from "./state";
import { childIndex } from "./tree";
import type { BoardNode } from "./types";

const row = (id: string, o: Partial<BoardNode> = {}): BoardNode => ({
  id, kind: "mind", parent_id: null, parent_key: null, position: 0, x: 0, y: 0, w: 0, h: 0, text: id, notes: "", style: {}, collapsed: false, hidden: false, ref_key: null, frame_id: null, updated_at: null, ...o,
});
const data = dataFrom([row("r"), row("a", { parent_id: "r", style: { side: "R", color: "violet" } }), row("a1", { parent_id: "a" }), row("b", { parent_id: "r", position: 1 }),
  row("st", { kind: "sticky", x: 50, y: 60, w: 170, h: 130 }), row("fr", { kind: "frame", x: 0, y: 300, w: 400, h: 300 }), row("in", { kind: "sticky", x: 20, y: 320, w: 100, h: 100, frame_id: "fr" }), row("live", { kind: "ref", ref_key: "task:1", parent_id: "r", position: 2 })], []);

describe("outline", () => {
  it("serialises mind subtrees with two spaces per level and other objects as top lines", () => {
    expect(outlineOf(data, ["a"])).toBe("- a\n  - a1");
    expect(outlineOf(data, ["a", "a1", "st"])).toBe("- a\n  - a1\n- st");
  });
  it("parses bullets, numbers, tabs and 2/4-space indents", () => {
    const f = parseOutline("- Plan\n  - Step one\n  - Step two\n    - Detail\n- Other\n");
    expect(f.map((n) => n.text)).toEqual(["Plan", "Other"]); expect(f[0].children.map((n) => n.text)).toEqual(["Step one", "Step two"]); expect(f[0].children[1].children[0].text).toBe("Detail");
    expect(parseOutline("1. a\n\t2. b\n").map((n) => [n.text, n.children.length])).toEqual([["a", 1]]);
    expect(parseOutline("x\n    y\n        z")[0].children[0].children[0].text).toBe("z");
    expect(countOutline(f)).toBe(5);
  });
  it("a single plain line is not an outline; two lines or an indent is", () => {
    expect(looksLikeOutline("just a thought")).toBe(false); expect(looksLikeOutline("one\ntwo")).toBe(true); expect(looksLikeOutline("one\n  two")).toBe(true);
  });
  it("outline paste on a node makes children; on the board it makes a map whose root is the first line", () => {
    const onNode = outlineOps(parseOutline("x\n  y\nz"), data.nodes.get("b")!, { x: 0, y: 0 }, data);
    const after = applyOps(data, onNode.ops); const idx = childIndex(after.nodes);
    expect((idx.get("b") ?? []).map((n) => n.text)).toEqual(["x", "z"]); expect(idx.get(onNode.ids[0])!.map((n) => n.text)).toEqual(["y"]);
    const onBoard = outlineOps(parseOutline("Root\n  a\n  b"), null, { x: 400, y: 200 }, data);
    const made = applyOps(data, onBoard.ops); const root = made.nodes.get(onBoard.ids[0])!;
    expect([root.text, root.x, root.y, root.parent_id]).toEqual(["Root", 400, 200, null]);
    expect((childIndex(made.nodes).get(root.id) ?? []).map((n) => n.text)).toEqual(["a", "b"]);
    expect((childIndex(made.nodes).get(root.id) ?? []).map((n) => n.style.side)).toEqual(["R", "L"]);
  });
});

describe("copy and paste", () => {
  it("copies a branch with its descendants, skips live nodes as rows, takes frame members along", () => {
    expect(copySelection(data, ["a"])!.nodes.map((n) => n.id).sort()).toEqual(["a", "a1"]);
    expect(copySelection(data, ["live"])!.nodes).toEqual([]);                  // text only
    expect(copySelection(data, ["live"])!.text).toBe("- live");
    expect(copySelection(data, ["fr"])!.nodes.map((n) => n.id).sort()).toEqual(["fr", "in"]);
  });
  it("paste as child: fresh ids, parent links remapped, top branch hangs under the target", () => {
    const clip = copySelection(data, ["a"])!;
    const { ops, ids } = pasteClip(clip, { parent: data.nodes.get("b")!, pos: null, data });
    const after = applyOps(data, ops); const top = after.nodes.get(ids[0])!;
    expect(top.parent_id).toBe("b"); expect(top.id).not.toBe("a"); expect(top.style.side).toBeUndefined();
    const kid = [...after.nodes.values()].find((n) => n.parent_id === top.id)!;
    expect(kid.text).toBe("a1");
  });
  it("paste on a root: the branch gets a side and colour", () => {
    const clip = copySelection(data, ["b"])!;
    const { ops, ids } = pasteClip(clip, { parent: data.nodes.get("r")!, pos: null, data });
    const top = applyOps(data, ops).nodes.get(ids[0])!; expect(["R", "L"]).toContain(top.style.side); expect(top.style.color).toBeTruthy();
  });
  it("duplicate/paste on the board nudges items, keeps a copied frame's members inside it", () => {
    const clip = copySelection(data, ["fr", "st"])!;
    const { ops } = pasteClip(clip, { parent: null, pos: null, data });
    const after = applyOps(data, ops); const copies = [...after.nodes.values()].filter((n) => !data.nodes.has(n.id));
    const fr = copies.find((n) => n.kind === "frame")!; const inn = copies.find((n) => n.text === "in")!;
    expect(inn.frame_id).toBe(fr.id); expect(fr.x).toBe(28); expect(copies.find((n) => n.text === "st")!.x).toBe(78);
  });
  it("paste at a point moves the first item there", () => {
    const clip = copySelection(data, ["st"])!;
    const { ops, ids } = pasteClip(clip, { parent: null, pos: { x: 500, y: 500 }, data });
    expect(applyOps(data, ops).nodes.get(ids[0])!.x).toBe(500);
  });
});
