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
