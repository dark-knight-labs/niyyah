import { describe, expect, it } from "vitest";
import { extOf, fitEdge, humanSize, needsReencode, nodeSize } from "./files";

describe("file helpers", () => {
  it("downscales the longest edge to 2048 and never up", () => {
    expect(fitEdge(4096, 2048)).toEqual({ w: 2048, h: 1024, scaled: true });
    expect(fitEdge(1000, 3000)).toEqual({ w: 683, h: 2048, scaled: true });
    expect(fitEdge(800, 600)).toEqual({ w: 800, h: 600, scaled: false });
  });
  it("draws a new image at its natural size, at most 320 px on the long side", () => {
    expect(nodeSize(160, 90)).toEqual({ w: 160, h: 90 }); expect(nodeSize(3200, 1600)).toEqual({ w: 320, h: 160 }); expect(nodeSize(10, 10)).toEqual({ w: 40, h: 40 });
  });
  it("re-encodes big png/jpeg/webp, never a gif", () => {
    expect(needsReencode("image/png", 100, 3000, 100)).toBe(true); expect(needsReencode("image/jpeg", 700 * 1024, 800, 600)).toBe(true);
    expect(needsReencode("image/png", 100 * 1024, 800, 600)).toBe(false); expect(needsReencode("image/gif", 9_000_000, 5000, 5000)).toBe(false);
  });
  it("sizes and extensions read well", () => {
    expect(humanSize(512)).toBe("512 B"); expect(humanSize(2048)).toBe("2 KB"); expect(humanSize(3 * 1048576)).toBe("3.0 MB");
    expect(extOf("plan.pdf")).toBe("PDF"); expect(extOf("README")).toBe("FILE"); expect(extOf("a.tar.gz")).toBe("GZ");
  });
});
