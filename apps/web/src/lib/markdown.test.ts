import { describe, expect, it } from "vitest";
import { inline, parseMarkdown, safeHref } from "@/lib/markdown";

describe("markdown", () => {
  it("keeps raw HTML as text", () => {
    expect(parseMarkdown('<img src=x onerror="alert(1)">')).toEqual([{ t: "p", c: [{ t: "text", v: '<img src=x onerror="alert(1)">' }] }]);
  });
  it("links: only http(s) and mailto survive", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("https://a.b/c")).toBe("https://a.b/c");
    expect(inline("[x](javascript:void)")).toEqual([{ t: "text", v: "x" }]);
    expect(inline("[x](https://a.b)")).toEqual([{ t: "link", href: "https://a.b", c: [{ t: "text", v: "x" }] }]);
  });
  it("inline spans", () => {
    expect(inline("a **b** *c* `d`")).toEqual([
      { t: "text", v: "a " }, { t: "strong", c: [{ t: "text", v: "b" }] }, { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "c" }] }, { t: "text", v: " " }, { t: "code", v: "d" },
    ]);
  });
  it("blocks: heading, lists, quote, fence", () => {
    const b = parseMarkdown("## Week\n\n- one\n- two\n\n1. a\n2. b\n\n> note\n\n```\nx < y\n```\n\nend");
    expect(b.map((x) => x.t)).toEqual(["h", "ul", "ol", "quote", "pre", "p"]);
    expect(b[1]).toMatchObject({ items: [[{ t: "text", v: "one" }], [{ t: "text", v: "two" }]] });
    expect(b[4]).toEqual({ t: "pre", v: "x < y" });
  });
  it("joins wrapped paragraph lines", () => {
    expect(parseMarkdown("one\ntwo")).toEqual([{ t: "p", c: [{ t: "text", v: "one two" }] }]);
  });
});

describe("markdown limits", () => {
  it("renders a 200 KB markup-free answer fast", () => {
    const src = "word ".repeat(40_000);
    const t0 = performance.now();
    const spans = inline(src);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(spans).toHaveLength(1);
    const t1 = performance.now();
    parseMarkdown(src);
    expect(performance.now() - t1).toBeLessThan(200);
  });
  it("does not throw on 50 KB of alternating unmatched emphasis", () => {
    const src = "*a _b ".repeat(8_500);
    const t0 = performance.now();
    expect(() => inline(src)).not.toThrow();
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it("is linear on unmatched ** and backticks and brackets", () => {
    for (const unit of ["** ", "` ", "[a](", "_a "]) {
      const t0 = performance.now();
      inline(unit.repeat(20_000));
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });
  it("shows emphasis nested deeper than the limit as plain text", () => {
    const deep = inline("*a **b *c **d *e* d** c* b** a*");
    const depthOf = (spans: ReturnType<typeof inline>): number => Math.max(0, ...spans.map((x) => ("c" in x ? 1 + depthOf(x.c) : 0)));
    expect(depthOf(deep)).toBeLessThanOrEqual(3);
    expect(depthOf(inline("*".repeat(5_000) + "a" + "*".repeat(5_000)))).toBeLessThanOrEqual(3);
  });
});
