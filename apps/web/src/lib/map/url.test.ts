import { describe, expect, it } from "vitest";
import { patchStyle } from "./actions";
import type { BoardNode } from "./types";
import { cleanStyle, isHttpUrl, safeUrl } from "./url";

describe("thought links", () => {
  it("accepts http and https only", () => {
    expect(safeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeUrl("HTTP://example.com")).toBe("HTTP://example.com");
    for (const bad of ["javascript:alert(1)", " javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "//evil.example", "ftp://x", "", undefined, null, 5]) {
      expect(isHttpUrl(bad)).toBe(false); expect(safeUrl(bad)).toBe("");
    }
  });
});

describe("an old row with a bad link stays editable", () => {
  const row = (url: unknown): BoardNode => ({ id: "n", kind: "mind", text: "t", style: { color: "teal", url } } as unknown as BoardNode);
  it("cleanStyle drops a non-http(s) url and nothing else, and leaves good styles untouched", () => {
    expect(cleanStyle({ color: "teal", url: "javascript:alert(1)" })).toEqual({ color: "teal" });
    const good = { color: "teal", url: "https://example.com" }; expect(cleanStyle(good)).toBe(good);
    const none = { color: "teal" }; expect(cleanStyle(none)).toBe(none);
  });
  it("recolouring a thought that holds a javascript: link writes a style the API accepts", () => {
    const ops = patchStyle([row("javascript:alert(1)")], { color: "rose" });
    expect(ops).toHaveLength(1);
    expect((ops[0] as { node: BoardNode }).node.style).toEqual({ color: "rose" });
  });
  it("even a patch that changes nothing else removes the bad link", () => {
    const ops = patchStyle([row("data:text/html,x")], { color: "teal" });
    expect(ops).toHaveLength(1); expect((ops[0] as { node: BoardNode }).node.style).toEqual({ color: "teal" });
  });
  it("a good link survives a style patch", () => {
    expect((patchStyle([row("https://example.com")], { color: "rose" })[0] as { node: BoardNode }).node.style).toEqual({ color: "rose", url: "https://example.com" });
  });
});
