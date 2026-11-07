import { describe, expect, it } from "vitest";
import { isHttpUrl, safeUrl } from "./url";

describe("thought links", () => {
  it("accepts http and https only", () => {
    expect(safeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeUrl("HTTP://example.com")).toBe("HTTP://example.com");
    for (const bad of ["javascript:alert(1)", " javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "//evil.example", "ftp://x", "", undefined, null, 5]) {
      expect(isHttpUrl(bad)).toBe(false); expect(safeUrl(bad)).toBe("");
    }
  });
});
