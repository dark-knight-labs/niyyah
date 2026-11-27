import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKINS } from "@/components/skin-switch";

const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");

/** The body of `selector { ... }` (the first block with exactly that selector), or null. */
function block(selector: string): string | null {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return null;
  return css.slice(at, css.indexOf("}", at));
}

/** The tokens a skin that starts from paper's values must set itself, or it would silently inherit paper's. */
const REQUIRED = ["--background", "--surface", "--foreground", "--muted", "--muted-foreground", "--border", "--rule", "--accent", "--accent-fg", "--accent-light", "--destructive", "--warn", "--warn-light"];

describe("skins", () => {
  it("has unique ids and keeps paper as the first, attribute-free default", () => {
    const ids = SKINS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("paper");
  });

  it("has a :root[data-skin] block for every skin except paper", () => {
    for (const s of SKINS.filter((x) => x.id !== "paper")) expect(block(`:root[data-skin="${s.id}"]`), s.id).not.toBeNull();
  });

  it("lists Next Up as the eighth skin", () => {
    expect(SKINS).toHaveLength(8);
    expect(SKINS[7].id).toBe("nextup");
  });

  it("sets every required token in both the light and the dark block of nextup", () => {
    for (const sel of [':root[data-skin="nextup"]', ':root[data-skin="nextup"][data-theme="dark"]']) {
      const body = block(sel);
      expect(body, sel).not.toBeNull();
      for (const t of REQUIRED) expect(body!, `${sel} ${t}`).toMatch(new RegExp(`${t}:\\s*#[0-9a-fA-F]{6};`));
    }
  });
});
