export const BLOCK_ORDER = ["soul", "onething", "ops", "ot", "body", "distribution", "fnf", "sleep"] as const;
export type Block = (typeof BLOCK_ORDER)[number];

// 2026-10-06..2026-12-31: ONE Thing + OPS vote as one "OT" block. Old days keep
// the legacy pair. Delete this and "ot" after the experiment.
export const LEGACY_MERGED_BLOCKS: readonly Block[] = ["onething", "ops"];

/** Blocks a day actually has, in BLOCK_ORDER; no data -> all but the legacy pair. */
export function blocksForDay(blocks: Record<string, number> | undefined): Block[] {
  const present = BLOCK_ORDER.filter((b) => blocks && b in blocks);
  return present.length > 0 ? present : BLOCK_ORDER.filter((b) => !LEGACY_MERGED_BLOCKS.includes(b));
}

export const BLOCK_LABELS: Record<Block, string> = {
  soul: "Soul",
  onething: "ONE Thing",
  ops: "OPS",
  ot: "OT",
  body: "Body",
  distribution: "Distribution",
  fnf: "FnF",
  sleep: "Sleep",
};

export const BLOCK_COLORS: Record<Block, string> = {
  soul: "#10b981",
  onething: "#3b82f6",
  ops: "#8b5cf6",
  ot: "#8b5cf6",
  body: "#f59e0b",
  fnf: "#f43f5e",
  distribution: "#06b6d4",
  sleep: "#64748b",
};

export const MODE_COLORS: Record<string, string> = {
  full: "#059669",
  yellow: "#eab308",
  compressed: "#3b82f6",
  minimal: "#8b5cf6",
  off: "#ef4444",
  ramadan: "#06b6d4",
  fasting: "#f59e0b",
};

// Older vault notes (pre-taxonomy) used "green" as a synonym for "full" —
// the backend parser already falls back to the "full" star ceiling for any
// unrecognized mode, so the color should agree rather than falling back to
// a flat gray everywhere this vault's real history is rendered.
const MODE_ALIASES: Record<string, string> = { green: "full" };

const FALLBACK_MODE_COLOR = "#71717a";

// Single source of truth for "what color is this mode" — every widget that
// renders a mode (header badge, weekly bars, monthly heatmap, mode
// distribution) must call this instead of indexing MODE_COLORS directly,
// so the same mode always reads as the same color everywhere on the page.
export function resolveModeColor(mode: string): string {
  const canonical = MODE_ALIASES[mode] ?? mode;
  return MODE_COLORS[canonical] ?? FALLBACK_MODE_COLOR;
}
