import { describe, expect, it } from "vitest";
import { SHORTCUTS, shortcutsFor } from "@/lib/shortcuts";

const chords = SHORTCUTS.filter((s) => s.combo.includes(" "));
const firstKeys = new Set(chords.map((c) => c.combo.split(" ")[0]));
const secondKeys = new Set(chords.map((c) => c.combo.split(" ")[1]));

describe("shortcut registry", () => {
  it("binds a key once per scope", () => {
    const seen = new Set<string>();
    for (const s of SHORTCUTS) {
      const id = `${s.scope}|${s.combo}`;
      expect(seen.has(id), `duplicate ${id}`).toBe(false);
      seen.add(id);
    }
  });

  it("never reuses an Everywhere key on a page", () => {
    const everywhere = new Set(SHORTCUTS.filter((s) => s.scope === "Everywhere").map((s) => s.combo));
    for (const s of SHORTCUTS.filter((x) => x.scope !== "Everywhere")) expect(everywhere.has(s.combo), `${s.scope} ${s.combo}`).toBe(false);
  });

  it("keeps the chord's first key free as a single key", () => {
    for (const s of SHORTCUTS.filter((x) => !x.combo.includes(" "))) expect(firstKeys.has(s.combo), `${s.scope} ${s.combo}`).toBe(false);
  });

  it("keeps a chord's second key out of the capture-phase single keys, which would swallow the chord", () => {
    for (const s of SHORTCUTS.filter((x) => x.via === "hotkeys" && !x.combo.includes(" "))) expect(secondKeys.has(s.combo), `${s.scope} ${s.combo}`).toBe(false);
  });

  it("gives every row a label and a shown key, and every page its own scope on top of Everywhere", () => {
    for (const s of SHORTCUTS) { expect(s.label).not.toBe(""); expect(s.show).not.toBe(""); }
    expect(shortcutsFor("/plan").some((s) => s.scope === "Plan")).toBe(true);
    expect(shortcutsFor("/").some((s) => s.combo === "shift+d")).toBe(true);
    expect(shortcutsFor("/settings").every((s) => s.scope === "Everywhere")).toBe(true);
  });
});
