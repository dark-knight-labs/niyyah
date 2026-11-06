import * as A from "./actions";
import { alignOps, distributeOps, fitFrameOps, tidyOps, zOps, type AlignMode, type ZMode } from "./arrange";
import { EDGE_DASHES, EDGE_PATHS, EDGE_WIDTHS, HEADS, readEdgeStyle } from "./connector";
import { SHAPES } from "./shapes";
import { LAYOUTS, type Layout } from "./layout";
import { mapsOf, type Rect } from "./organize";
import type { BoardData } from "./state";
import { colorKeyOf, depthOf, descendantCount, rootOf, subtreeIds } from "./tree";
import { BRANCH_COLORS, STICKY_COLORS, type BoardEdge, type BoardNode, type Op } from "./types";

/**
 * The command registry: ONE list every surface reads. The floating bar, the right-click menus, the keyboard and the "?" sheet all
 * resolve a command through here (label, shortcut, where it applies, what it does). Pure data + functions over a `Sel` (what is
 * selected) and an `Env` (what the canvas can do); the canvas owns the Env.
 */

/** What a menu is for: the kind of thing under the pointer / selected. `live` is a Plan-derived (ref) node. */
export type Kind = "mind" | "live" | "sticky" | "shape" | "text" | "frame" | "image" | "file" | "edge" | "multi" | "pane";

export interface Sel {
  kind: Kind;
  /** Selected node and edge ids, in selection order. */
  ids: string[];
  nodes: BoardNode[];
  edges: BoardEdge[];
  data: BoardData;
  idx: Map<string | null, BoardNode[]>;
  /** Absolute rectangles of drawn nodes (committed layout). */
  rects: ReadonlyMap<string, Rect>;
  /** Any selected node is a live Plan node. */
  live: boolean;
  /** Streams exist in Plan, so a thought can be made an item. */
  canMake: boolean;
  /** Something is on the internal clipboard. */
  hasClip: boolean;
  /** Any selected node is locked. */
  locked: boolean;
  /** Pane menu: where the pointer was, in board coordinates. */
  pos: { x: number; y: number } | null;
}

export interface Choice { id: string; label: string; swatch?: string }

/** What the canvas offers a command. Every method is a stable callback; the registry never touches React. */
export interface Env {
  commit(ops: Op[], tag?: string): boolean;
  select(ids: string[]): void;
  edit(id: string): void;
  /** Start typing in a node this command just created (it is not in the canvas's fresh data yet). An empty one is discarded. */
  editNew(id: string): void;
  addChild(id: string): void;
  addSibling(id: string): void;
  fold(id: string): void;
  /** Delete (a thought, a branch, items) or hide (live nodes) whatever is selected. */
  del(): void;
  connect(id: string): void;
  make(id: string): void;
  prompt(title: string, initial: string): Promise<string | null>;
  notify(message: string): void;
  focusNotes(id: string): void;
  organize(rootIds: string[], layout: Layout | "keep"): void;
  focusBranch(id: string | null): void;
  openPlan(): void;
  addAt(kind: "mind" | "sticky" | "text" | "shape" | "frame", pos: { x: number; y: number } | null): void;
  selectAll(): void;
  fit(): void;
  zoomToFrame(id: string): void;
  toggleMinimap(): void;
  /** Sizes the layout was last given: organize needs them. */
  sizes(): Map<string, { w: number; h: number }>;
  copy(cut: boolean): void;
  /** Paste the clipboard (internal first, then the system one) under a thought or onto the board at `pos`. */
  paste(parentId: string | null, pos: { x: number; y: number } | null): void;
  duplicate(): void;
  copyOutline(): void;
  search(): void;
  help(): void;
  toggleSnap(): void;
}

export interface Command {
  id: string;
  label: string | ((s: Sel) => string);
  /** Shown right-aligned and read by the "?" sheet. `native`: the canvas key handler already does it (the registry only documents it). */
  kbd?: string;
  native?: boolean;
  /** Kinds whose menu may offer it. */
  kinds: Kind[];
  /** Extra condition on top of the kind. */
  when?: (s: Sel) => boolean;
  /** Visible but greyed when false. */
  enabled?: (s: Sel) => boolean;
  choices?: (s: Sel) => Choice[];
  /** The choice (or toggle) that is on now. */
  current?: (s: Sel) => string | boolean | undefined;
  /** Floating bar: the label there, and its order. */
  bar?: { label: string | ((s: Sel) => string); order: number };
  danger?: boolean;
  run(env: Env, s: Sel, choice?: string): void | Promise<void>;
}

// ---- selection ----

export function makeSel(p: { ids: string[]; data: BoardData; idx: Map<string | null, BoardNode[]>; rects?: ReadonlyMap<string, Rect>; canMake?: boolean; hasClip?: boolean; pos?: { x: number; y: number } | null }): Sel {
  const nodes = p.ids.map((id) => p.data.nodes.get(id)).filter((n): n is BoardNode => !!n);
  const edges = p.ids.map((id) => p.data.edges.get(id)).filter((e): e is BoardEdge => !!e);
  let kind: Kind;
  if (p.ids.length === 0) kind = "pane";
  else if (p.ids.length > 1 || (nodes.length && edges.length)) kind = "multi";
  else if (edges.length === 1) kind = "edge";
  else {
    const n = nodes[0];
    kind = !n ? "pane" : n.kind === "ref" ? "live" : (["mind", "sticky", "shape", "text", "frame", "image", "file"].includes(n.kind) ? n.kind : "pane") as Kind;
  }
  return { kind, ids: p.ids, nodes, edges, data: p.data, idx: p.idx, rects: p.rects ?? new Map(), live: nodes.some((n) => n.kind === "ref"), locked: nodes.some((n) => !!n.style.locked), canMake: !!p.canMake, hasClip: !!p.hasClip, pos: p.pos ?? null };
}

/** Commands that change or remove what a live (Plan) node says or is: never offered on a live node, whatever the menu lists. */
export const LIVE_BLOCKED: ReadonlySet<string> = new Set(["edit", "deleteBranch", "cut", "convert", "detach", "toSticky", "parent", "sibling", "paste", "pasteChild", "note", "make"]);

/** What a locked selection still offers: reading, copying, arranging in the stack, and unlocking. Everything that edits or removes is hidden. */
export const LOCK_ALLOWED: ReadonlySet<string> = new Set(["lock", "copy", "duplicate", "copyOutline", "connect", "selectBranch", "focusBranch", "fold", "collapseBelow", "expandBelow", "showInPlan", "order", "zoomFrame", "selectAll"]);

/** Does the command belong in this selection's menu? Kind, extra condition, and the live-node rule. */
export function appliesTo(c: Command, s: Sel): boolean {
  if (!c.kinds.includes(s.kind)) return false;
  if (s.live && LIVE_BLOCKED.has(c.id)) return false;
  if (s.locked && !LOCK_ALLOWED.has(c.id)) return false;
  if (s.live && c.id === "delete" && s.kind !== "multi") return false;   // a live node is hidden, never deleted (the "hide" command)
  return c.when ? c.when(s) : true;
}
export const isEnabled = (c: Command, s: Sel) => (c.enabled ? c.enabled(s) : true);
export const labelOf = (c: Command, s: Sel) => (typeof c.label === "function" ? c.label(s) : c.label);

// ---- helpers ----

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const mindOf = (s: Sel) => s.nodes.filter((n) => n.kind === "mind" || n.kind === "ref");
const only = (s: Sel) => s.nodes[0];
const rootsOfSel = (s: Sel) => mapsOf(s.data, s.idx, s.ids);
const styleAll = (env: Env, s: Sel, patch: Record<string, unknown>, nodes = s.nodes) => { env.commit(A.patchStyle(nodes, patch)); void s; };
const hasKids = (s: Sel, n: BoardNode) => (s.idx.get(n.id) ?? []).some((c) => !c.hidden);
const commonStyle = (s: Sel, key: string) => { const vals = new Set(s.nodes.map((n) => (n.style as Record<string, unknown>)[key])); return vals.size === 1 ? ([...vals][0] as string | boolean | undefined) : undefined; };
const toggleOf = (key: string) => (env: Env, s: Sel) => { const on = !!commonStyle(s, key); styleAll(env, s, { [key]: on ? undefined : true }); };

export const BRANCH_CHOICES: Choice[] = BRANCH_COLORS.map((c) => ({ id: c, label: cap(c), swatch: `var(--stream-${c})` }));
export const STICKY_CHOICES: Choice[] = STICKY_COLORS.map((c) => ({ id: c, label: cap(c), swatch: `var(--map-sticky-${c})` }));
export const ICONS = ["💡", "⭐", "✅", "❗", "❓", "🎯", "📌", "🔥", "⚠️", "🔗", "📎", "❤️"];

export const LAYOUT_LABEL: Record<Layout, string> = { both: "Balanced (both sides)", right: "Right", left: "Left", down: "Down (org chart)", up: "Up" };

// ---- the commands (window 1: thoughts, live nodes, the basics of every kind) ----

const MIND: Kind[] = ["mind", "live"];

const CORE: Command[] = [
  { id: "child", label: "Add child", kbd: "Tab", native: true, kinds: MIND, bar: { label: "+ Child", order: 10 }, run: (env, s) => env.addChild(s.ids[0]) },
  { id: "sibling", label: "Add sibling", kbd: "Enter", native: true, kinds: ["mind"], when: (s) => !!only(s)?.parent_id, bar: { label: "+ Sibling", order: 20 }, run: (env, s) => env.addSibling(s.ids[0]) },
  {
    id: "parent", label: "Add parent", kinds: ["mind"], when: (s) => !!only(s)?.parent_id,
    run: (env, s) => { const made = A.insertParent(s.data.nodes, only(s)); if (env.commit(made.ops, `new:${made.id}`)) env.editNew(made.id); },
  },
  { id: "edit", label: "Edit text", kbd: "F2", native: true, kinds: ["mind", "sticky", "shape", "text", "frame"], run: (env, s) => env.edit(s.ids[0]) },
  {
    id: "note", label: "Note…", kinds: ["mind"],
    current: (s) => !!only(s)?.notes.trim(), run: (env, s) => env.focusNotes(s.ids[0]),
  },
  {
    id: "link", label: (s) => (only(s)?.style.url ? "Edit link…" : "Link…"), kinds: MIND,
    async run(env, s) {
      const n = only(s);
      const v = await env.prompt("Link (https://…)", n.style.url ?? "https://");
      if (v === null) return;
      const t = v.trim();
      if (!t || t === "https://") { env.commit(A.patchStyle([n], { url: undefined })); return; }
      const url = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
      if (!/^https?:\/\//i.test(url)) { env.notify("Only http and https links can be added"); return; }
      env.commit(A.patchStyle([n], { url: url.slice(0, 500) }));
    },
  },
  { id: "unlink", label: "Remove link", kinds: MIND, when: (s) => !!only(s)?.style.url, run: (env, s) => styleAll(env, s, { url: undefined }) },
  {
    id: "color", label: (s) => (s.kind === "shape" ? "Fill" : "Colour"), kinds: ["mind", "live", "sticky", "shape", "multi"],
    when: (s) => (s.kind === "multi" ? s.nodes.length > 0 && (s.nodes.every((n) => n.kind === "sticky" || n.kind === "shape") || s.nodes.every((n) => n.kind === "mind" || n.kind === "ref")) : true),
    choices: (s) => (s.nodes.every((n) => n.kind === "sticky") ? STICKY_CHOICES : s.nodes.every((n) => n.kind === "shape" || n.kind === "sticky") ? [{ id: "none", label: "No fill" }, ...STICKY_CHOICES] : BRANCH_CHOICES),
    current: (s) => (s.kind === "mind" || s.kind === "live" ? (only(s)?.style.color ?? colorKeyOf(s.data.nodes, s.ids[0])) : commonStyle(s, "color") as string | undefined ?? (s.nodes.every((n) => n.kind === "sticky") ? "yellow" : undefined)),
    run: (env, s, c) => { if (c) styleAll(env, s, { color: c }); },
  },
  {
    id: "fill", label: "Box fill", kinds: [...MIND, "multi"], when: (s) => s.kind !== "multi" || mindOf(s).length === s.nodes.length,
    choices: () => [{ id: "outline", label: "Outline" }, { id: "tint", label: "Tint" }, { id: "solid", label: "Solid" }],
    current: (s) => commonStyle(s, "fill") as string | undefined ?? (only(s) && depthOf(s.data.nodes, s.ids[0]) === 1 ? "tint" : "outline"),
    run: (env, s, c) => { if (c) styleAll(env, s, { fill: c }); },
  },
  {
    id: "mshape", label: "Box shape", kinds: [...MIND, "multi"], when: (s) => s.kind !== "multi" || mindOf(s).length === s.nodes.length,
    choices: () => [{ id: "rect", label: "Square corners" }, { id: "rounded", label: "Rounded" }, { id: "pill", label: "Pill" }],
    current: (s) => (commonStyle(s, "shape") as string | undefined) ?? "rect",
    run: (env, s, c) => { if (c) styleAll(env, s, { shape: c === "rect" ? undefined : c }); },
  },
  {
    id: "size", label: "Text size", kinds: [...MIND, "sticky", "shape", "text", "multi"], when: (s) => s.kind !== "multi" || s.nodes.every((n) => n.kind !== "frame" && n.kind !== "image" && n.kind !== "file"),
    choices: () => [{ id: "S", label: "Small" }, { id: "M", label: "Medium" }, { id: "L", label: "Large" }],
    current: (s) => (commonStyle(s, "size") as string | undefined) ?? "M",
    run: (env, s, c) => { if (c) styleAll(env, s, { size: c === "M" ? undefined : c }); },
  },
  { id: "bold", label: "Bold", kbd: "Ctrl+B", kinds: [...MIND, "sticky", "shape", "text", "multi"], when: (s) => s.kind !== "multi" || s.nodes.every((n) => n.kind !== "frame" && n.kind !== "image" && n.kind !== "file"), current: (s) => !!commonStyle(s, "bold"), run: toggleOf("bold") },
  {
    id: "icon", label: "Icon", kinds: [...MIND, "multi"], when: (s) => s.kind !== "multi" || mindOf(s).length === s.nodes.length,
    choices: () => [{ id: "", label: "None" }, ...ICONS.map((i) => ({ id: i, label: i }))],
    current: (s) => (commonStyle(s, "icon") as string | undefined) ?? "",
    run: (env, s, c) => { if (c !== undefined) styleAll(env, s, { icon: c || undefined }); },
  },
  {
    id: "layout", label: "Layout of this map", kinds: MIND,
    choices: () => LAYOUTS.map((l) => ({ id: l, label: LAYOUT_LABEL[l] })),
    current: (s) => (rootOf(s.data.nodes, s.ids[0])?.style.layout as string | undefined) ?? "both",
    run: (env, s, c) => { if (c) env.organize(rootsOfSel(s), c as Layout); },
  },
  {
    id: "branchLines", label: "Branch lines", kinds: MIND,
    choices: () => [{ id: "curved", label: "Curved" }, { id: "elbow", label: "Elbow" }, { id: "straight", label: "Straight" }],
    current: (s) => (rootOf(s.data.nodes, s.ids[0])?.style.edge as string | undefined) ?? "curved",
    run: (env, s, c) => { const root = rootOf(s.data.nodes, s.ids[0]); if (root && c) env.commit(A.patchStyle([root], { edge: c === "curved" ? undefined : c })); },
  },
  { id: "organizeMap", label: "Organize this map", kinds: MIND, run: (env, s) => env.organize(rootsOfSel(s), "keep") },
  {
    id: "fold", label: (s) => (only(s)?.collapsed ? "Expand" : "Collapse"), kbd: "Ctrl+.", native: true, kinds: MIND,
    when: (s) => !!only(s)?.parent_id && hasKids(s, only(s)), bar: { label: (s) => (only(s)?.collapsed ? "Expand" : "Collapse"), order: 30 }, run: (env, s) => env.fold(s.ids[0]),
  },
  {
    id: "collapseBelow", label: "Collapse all below", kinds: MIND, when: (s) => hasKids(s, only(s)),
    run: (env, s) => { const ids = subtreeIds(s.idx, s.ids[0]).filter((id) => id !== s.ids[0] && (s.idx.get(id)?.length ?? 0) > 0); env.commit(ids.map((id) => ({ op: "upsert_node", node: { ...s.data.nodes.get(id)!, collapsed: true }, base_updated_at: null }))); },
  },
  {
    id: "expandBelow", label: "Expand all below", kinds: MIND, when: (s) => hasKids(s, only(s)) || !!only(s)?.collapsed,
    run: (env, s) => { const ids = subtreeIds(s.idx, s.ids[0]).filter((id) => s.data.nodes.get(id)?.collapsed); env.commit(ids.map((id) => ({ op: "upsert_node", node: { ...s.data.nodes.get(id)!, collapsed: false }, base_updated_at: null }))); },
  },
  { id: "focusBranch", label: "Focus this branch", kinds: MIND, when: (s) => hasKids(s, only(s)), run: (env, s) => env.focusBranch(s.ids[0]) },
  { id: "selectBranch", label: "Select branch", kinds: MIND, when: (s) => hasKids(s, only(s)), run: (env, s) => env.select(subtreeIds(s.idx, s.ids[0])) },
  { id: "moveUp", label: "Move up", kbd: "Alt+↑", kinds: ["mind"], when: (s) => !!only(s)?.parent_id, enabled: (s) => (s.idx.get(only(s).parent_id)?.[0]?.id ?? "") !== s.ids[0], run: (env, s) => { env.commit(A.moveSibling(s.idx, only(s), -1)); } },
  { id: "moveDown", label: "Move down", kbd: "Alt+↓", kinds: ["mind"], when: (s) => !!only(s)?.parent_id, enabled: (s) => (s.idx.get(only(s).parent_id)?.at(-1)?.id ?? "") !== s.ids[0], run: (env, s) => { env.commit(A.moveSibling(s.idx, only(s), 1)); } },
  {
    id: "detach", label: "Detach as new map", kinds: ["mind"], when: (s) => !!only(s)?.parent_id,
    run: (env, s) => {
      const r = s.rects.get(s.ids[0]);
      if (!r) return;
      const n = only(s);
      env.commit(A.detach(s.data.nodes, n, r, colorKeyOf(s.data.nodes, n.id)));
    },
  },
  {
    id: "toSticky", label: "Convert to sticky", kinds: ["mind"], when: (s) => !hasKids(s, only(s)),
    run: (env, s) => { const r = s.rects.get(s.ids[0]); if (r) env.commit([A.convertTo(only(s), "sticky", r)]); },
  },
  {
    id: "make", label: "Make item", kinds: ["mind"], when: (s) => s.canMake, bar: { label: "Make item", order: 40 }, run: (env, s) => env.make(s.ids[0]),
  },
  { id: "showInPlan", label: "Show in Plan", kinds: ["live"], run: (env) => env.openPlan() },
  { id: "connect", label: "Connect…", kinds: ["mind", "live", "sticky", "shape", "text", "frame", "image", "file"], bar: { label: "Connect", order: 50 }, run: (env, s) => env.connect(s.ids[0]) },
  {
    id: "zoomFrame", label: "Zoom to frame", kinds: ["frame"], run: (env, s) => env.zoomToFrame(s.ids[0]),
  },
  {
    id: "hide", label: "Hide from this board", kbd: "Del", native: true, kinds: ["live"], when: (s) => !!only(s)?.parent_id, bar: { label: "Hide", order: 90 }, run: (env) => env.del(),
  },
  {
    id: "delete", label: (s) => (s.kind === "frame" ? "Delete frame (keep contents)" : s.kind === "mind" ? (!only(s).parent_id ? "Delete map" : hasKids(s, only(s)) ? "Delete branch" : "Delete") : s.kind === "edge" ? "Delete connector" : "Delete"), kbd: "Del", native: true, danger: true,
    kinds: ["mind", "sticky", "shape", "text", "frame", "image", "file", "edge", "multi"],
    bar: { label: (s) => (s.kind === "mind" && !only(s)?.parent_id ? "Delete map" : "Delete"), order: 90 }, run: (env) => env.del(),
  },
  // pane
  { id: "addSticky", label: "Add sticky note", kbd: "N", kinds: ["pane"], run: (env, s) => env.addAt("sticky", s.pos) },
  { id: "addMind", label: "Add mind map", kbd: "M", kinds: ["pane"], run: (env, s) => env.addAt("mind", s.pos) },
  { id: "addShape", label: "Add shape", kbd: "S", kinds: ["pane"], run: (env, s) => env.addAt("shape", s.pos) },
  { id: "addText", label: "Add text", kbd: "T", kinds: ["pane"], run: (env, s) => env.addAt("text", s.pos) },
  { id: "addFrame", label: "Add frame", kbd: "F", kinds: ["pane"], run: (env, s) => env.addAt("frame", s.pos) },
  { id: "selectAll", label: "Select all", kbd: "Ctrl+A", kinds: ["pane"], run: (env) => env.selectAll() },
  {
    id: "organizeAll", label: "Organize all maps", kinds: ["pane"], when: (s) => (s.idx.get(null)?.length ?? 0) > 0,
    choices: () => [{ id: "both", label: "Horizontal, balanced" }, { id: "right", label: "Horizontal, to the right" }, { id: "down", label: "Vertical, down" }, { id: "up", label: "Vertical, up" }],
    run: (env, s, c) => { if (c) env.organize(mapsOf(s.data, s.idx, []), c as Layout); },
  },
  { id: "fit", label: "Zoom to fit", kbd: "Shift+1", kinds: ["pane"], run: (env) => env.fit() },
  { id: "minimap", label: "Minimap on/off", kinds: ["pane"], run: (env) => env.toggleMinimap() },
];

// ---- window 2: objects, clipboard, arrangement, connectors ----

const ITEM: Kind[] = ["sticky", "shape", "text", "frame", "image", "file"];
const GENERIC: Kind[] = ["mind", "live", "sticky", "shape", "text", "frame", "image", "file", "multi"];
const itemsOf = (s: Sel) => s.nodes.filter((n) => n.kind !== "mind" && n.kind !== "ref");
const selIds = (s: Sel) => new Set(s.ids);
const ZMODES: { id: ZMode; label: string; kbd?: string }[] = [{ id: "front", label: "Bring to front", kbd: "Ctrl+Shift+]" }, { id: "forward", label: "Bring forward", kbd: "Ctrl+]" }, { id: "backward", label: "Send backward", kbd: "Ctrl+[" }, { id: "back", label: "Send to back", kbd: "Ctrl+Shift+[" }];
const edgeStyleCmd = (id: string, label: string, key: string, choices: { id: string; label: string }[], conv: (c: string) => unknown = (c) => c): Command => ({
  id, label, kinds: ["edge"], choices: () => choices,
  current: (s) => { const v = (readEdgeStyle(s.edges[0]?.style) as unknown as Record<string, unknown>)[key]; return String(v); },
  run: (env, s, c) => { if (c !== undefined) env.commit(A.patchEdgeStyle(s.edges, { [key]: conv(c) })); },
});
const nameOf = (c: string) => c[0].toUpperCase() + c.slice(1);
const ALIGNS: { id: AlignMode; label: string }[] = [{ id: "left", label: "Left" }, { id: "center", label: "Centre" }, { id: "right", label: "Right" }, { id: "top", label: "Top" }, { id: "middle", label: "Middle" }, { id: "bottom", label: "Bottom" }];
const membersOf = (s: Sel, frameId: string) => [...s.data.nodes.values()].filter((n) => n.frame_id === frameId);
const KIND_LABEL: Record<string, string> = { sticky: "Sticky note", shape: "Shape", text: "Text", mind: "Mind map node" };

const MORE: Command[] = [
  { id: "copy", label: "Copy", kbd: "Ctrl+C", native: true, kinds: GENERIC, run: (env) => env.copy(false) },
  { id: "cut", label: "Cut", kbd: "Ctrl+X", native: true, kinds: ["mind", "sticky", "shape", "text", "frame", "image", "file", "multi"], run: (env) => env.copy(true) },
  { id: "pasteChild", label: "Paste as child", kbd: "Ctrl+V", native: true, kinds: ["mind"], run: (env, s) => env.paste(s.ids[0], null) },
  { id: "paste", label: "Paste here", kbd: "Ctrl+V", native: true, kinds: ["pane"], run: (env, s) => env.paste(null, s.pos) },
  { id: "duplicate", label: "Duplicate", kbd: "Ctrl+D", native: true, kinds: ["mind", "sticky", "shape", "text", "frame", "image", "file", "multi"], when: (s) => !s.live || s.kind === "multi", run: (env) => env.duplicate() },
  { id: "copyOutline", label: "Copy as outline (Markdown)", kinds: ["mind", "live", "multi"], run: (env) => env.copyOutline() },
  { id: "lock", label: (s) => (s.locked ? "Unlock" : "Lock"), kbd: "Ctrl+L", native: true, kinds: GENERIC, when: (s) => !(s.kind === "multi" && s.nodes.length === 0), run: (env, s) => { const on = !s.locked; env.commit(A.patchStyle(s.nodes, { locked: on ? true : undefined })); } },
  {
    id: "order", label: "Order", kinds: ["sticky", "shape", "text", "image", "file", "multi"], when: (s) => itemsOf(s).length > 0,
    choices: () => ZMODES.map((z) => ({ id: z.id, label: z.kbd ? `${z.label}` : z.label })),
    run: (env, s, c) => { if (c) env.commit(zOps([...s.data.nodes.values()], selIds(s), c as ZMode)); },
  },
  {
    id: "shapeKind", label: "Shape", kinds: ["shape"], choices: () => SHAPES.map((x) => ({ id: x.id, label: x.label })), current: (s) => (only(s)?.style.shape as string | undefined) ?? "rect",
    run: (env, s, c) => { if (c) styleAll(env, s, { shape: c === "rect" ? undefined : c }); },
  },
  {
    id: "border", label: "Border colour", kinds: ["shape"], choices: () => [{ id: "ink", label: "Ink", swatch: "var(--foreground)" }, ...BRANCH_CHOICES], current: (s) => (only(s)?.style.border as string | undefined) ?? "ink",
    run: (env, s, c) => { if (c) styleAll(env, s, { border: c === "ink" ? undefined : c }); },
  },
  {
    id: "bw", label: "Border width", kinds: ["shape"], choices: () => [{ id: "1", label: "Thin" }, { id: "2", label: "Medium" }, { id: "4", label: "Thick" }], current: (s) => String(only(s)?.style.bw ?? 1),
    run: (env, s, c) => { if (c) styleAll(env, s, { bw: c === "1" ? undefined : Number(c) }); },
  },
  {
    id: "dash", label: "Border style", kinds: ["shape"], choices: () => EDGE_DASHES.map((d) => ({ id: d, label: nameOf(d) })), current: (s) => (only(s)?.style.dash as string | undefined) ?? "solid",
    run: (env, s, c) => { if (c) styleAll(env, s, { dash: c === "solid" ? undefined : c }); },
  },
  {
    id: "talign", label: "Text align", kinds: ["sticky", "shape", "text"], choices: () => [{ id: "left", label: "Left" }, { id: "center", label: "Centre" }, { id: "right", label: "Right" }],
    current: (s) => (only(s)?.style.align as string | undefined) ?? (s.kind === "sticky" || s.kind === "text" ? "left" : "center"),
    run: (env, s, c) => { if (c) styleAll(env, s, { align: c }); },
  },
  {
    id: "convert", label: "Convert to", kinds: ["sticky", "shape", "text"],
    choices: (s) => (["sticky", "shape", "text", "mind"] as const).filter((k) => k !== only(s)?.kind).map((k) => ({ id: k, label: KIND_LABEL[k] })),
    run: (env, s, c) => { const n = only(s), r = s.rects.get(n.id); if (c && r) env.commit([A.convertTo(n, c as "mind", r)]); },
  },
  { id: "align", label: "Align", kinds: ["multi"], when: (s) => itemsOf(s).length + s.nodes.filter((n) => n.kind === "mind" && !n.parent_id).length > 1, choices: () => ALIGNS, run: (env, s, c) => { if (c) env.commit(alignOps(s.nodes, s.rects, c as AlignMode)); } },
  {
    id: "distribute", label: "Distribute", kinds: ["multi"], when: (s) => s.nodes.length >= 3,
    choices: () => [{ id: "h", label: "Horizontally" }, { id: "v", label: "Vertically" }], run: (env, s, c) => { if (c) env.commit(distributeOps(s.nodes, s.rects, c as "h" | "v")); },
  },
  { id: "tidy", label: "Tidy into a grid", kinds: ["multi"], when: (s) => s.nodes.length >= 2, run: (env, s) => { env.commit(tidyOps(s.nodes, s.rects)); } },
  {
    id: "frameSel", label: "Frame selection", kinds: ["multi"], when: (s) => s.nodes.some((n) => n.kind !== "frame" && n.kind !== "ref" && (n.kind !== "mind" || !n.parent_id)),
    run: (env, s) => {
      const mem = s.nodes.filter((n) => n.kind !== "frame" && n.kind !== "ref" && (n.kind !== "mind" || !n.parent_id) && s.rects.has(n.id));
      if (!mem.length) return;
      const rs = mem.map((n) => s.rects.get(n.id)!);
      const x0 = Math.min(...rs.map((r) => r.x)) - 32, y0 = Math.min(...rs.map((r) => r.y)) - 44, x1 = Math.max(...rs.map((r) => r.x + r.w)) + 32, y1 = Math.max(...rs.map((r) => r.y + r.h)) + 32;
      const frames = [...s.data.nodes.values()].filter((n) => n.kind === "frame").length;
      const f = A.blank("frame", { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), text: `Frame ${frames + 1}` });
      env.commit([{ op: "upsert_node", node: f, base_updated_at: null }, ...mem.map((n) => ({ op: "upsert_node", node: { ...n, frame_id: f.id }, base_updated_at: null }) as Op)]);
      env.select([f.id]);
    },
  },
  {
    id: "mindFromStickies", label: "Make mind map from stickies", kinds: ["multi"], when: (s) => s.nodes.length >= 2 && s.nodes.every((n) => n.kind === "sticky"),
    run: (env, s) => {
      const st = [...s.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
      const cx = Math.round(st.reduce((t, n) => t + n.x + n.w / 2, 0) / st.length), cy = Math.round(st.reduce((t, n) => t + n.y + n.h / 2, 0) / st.length);
      const root = A.blank("mind", { x: cx, y: cy, text: "Ideas" });
      const ops: Op[] = [{ op: "upsert_node", node: root, base_updated_at: null }];
      st.forEach((n, i) => ops.push({ op: "upsert_node", base_updated_at: null, node: A.blank("mind", { parent_id: root.id, position: i, text: n.text, style: { side: i % 2 ? "L" : "R", color: BRANCH_COLORS[i % BRANCH_COLORS.length] } }) }));
      for (const n of st) ops.push({ op: "delete_node", id: n.id, base_updated_at: null });
      env.commit(ops);
      env.select([root.id]);
    },
  },
  { id: "fitFrame", label: "Fit to contents", kinds: ["frame"], when: (s) => membersOf(s, s.ids[0]).length > 0, run: (env, s) => { env.commit(fitFrameOps(only(s), membersOf(s, s.ids[0]).map((m) => s.rects.get(m.id) ?? { x: m.x, y: m.y, w: m.w, h: m.h }))); } },
  {
    id: "tidyFrame", label: "Tidy contents", kinds: ["frame"], when: (s) => membersOf(s, s.ids[0]).length > 1,
    run: (env, s) => { const m = membersOf(s, s.ids[0]); env.commit(tidyOps(m, new Map(m.map((n) => [n.id, s.rects.get(n.id) ?? { x: n.x, y: n.y, w: n.w, h: n.h }])))); },
  },
  {
    id: "deleteFrameAll", label: "Delete frame and contents", danger: true, kinds: ["frame"],
    run: (env, s) => {
      const ids = new Set<string>([s.ids[0]]);
      for (const m of membersOf(s, s.ids[0])) subtreeIds(s.idx, m.id).forEach((x) => ids.add(x));
      env.commit([...ids].map((id) => ({ op: "delete_node", id, base_updated_at: null }) as Op));
      env.select([]);
    },
  },
  { id: "toggleSnap", label: "Alignment guides on/off", kinds: ["pane"], run: (env) => env.toggleSnap() },
  { id: "find", label: "Find on board", kbd: "Ctrl+F", native: true, kinds: ["pane"], run: (env) => env.search() },
  { id: "help", label: "Keyboard shortcuts", kbd: "?", native: true, kinds: ["pane"], run: (env) => env.help() },
  // connectors
  edgeStyleCmd("epath", "Line", "path", EDGE_PATHS.map((p) => ({ id: p, label: nameOf(p) }))),
  edgeStyleCmd("ewidth", "Thickness", "width", EDGE_WIDTHS.map((w) => ({ id: String(w), label: `${w} px` })), Number),
  edgeStyleCmd("edash", "Dash", "dash", EDGE_DASHES.map((d) => ({ id: d, label: nameOf(d) }))),
  edgeStyleCmd("estart", "Start arrowhead", "start", HEADS.map((h) => ({ id: h, label: nameOf(h) }))),
  edgeStyleCmd("eend", "End arrowhead", "end", HEADS.map((h) => ({ id: h, label: nameOf(h) }))),
  {
    id: "ecolor", label: "Colour", kinds: ["edge"], choices: () => [{ id: "ink", label: "Ink", swatch: "var(--muted-foreground)" }, ...BRANCH_CHOICES], current: (s) => readEdgeStyle(s.edges[0]?.style).color,
    run: (env, s, c) => { if (c) env.commit(A.patchEdgeStyle(s.edges, { color: c })); },
  },
  {
    id: "elabel", label: (s) => (s.edges[0]?.label ? "Edit label…" : "Add label…"), kinds: ["edge"],
    async run(env, s) {
      const e = s.edges[0];
      const v = await env.prompt("Connector label", e.label);
      if (v !== null && v.trim() !== e.label) env.commit([{ op: "upsert_edge", edge: { ...e, label: v.trim().slice(0, 200) }, base_updated_at: null }]);
    },
  },
  { id: "eswap", label: "Swap direction", kinds: ["edge"], run: (env, s) => { const e = s.edges[0]; const st = readEdgeStyle(e.style); env.commit([{ op: "upsert_edge", edge: { ...e, from_id: e.to_id, to_id: e.from_id, style: { ...e.style, start: st.end, end: st.start, sp: st.tp, tp: st.sp } }, base_updated_at: null }]); } },
];

export const COMMANDS: Command[] = [...CORE, ...MORE];
void ITEM;
export const REGISTRY: ReadonlyMap<string, Command> = new Map(COMMANDS.map((c) => [c.id, c]));

/** Menu layout per kind: groups (a hairline between them), each a list of command ids. Resolution hides what does not apply. */
export const MENUS: Record<Kind, string[][]> = {
  mind: [["child", "sibling", "parent"], ["edit", "note", "link", "unlink"], ["color", "fill", "mshape", "size", "bold", "icon"], ["layout", "branchLines", "organizeMap"], ["fold", "collapseBelow", "expandBelow", "focusBranch", "selectBranch"], ["moveUp", "moveDown"], ["copy", "cut", "pasteChild", "duplicate", "copyOutline"], ["detach", "toSticky", "lock"], ["make", "connect"], ["delete"]],
  live: [["child"], ["link", "unlink"], ["color", "fill", "mshape", "size", "bold", "icon"], ["layout", "branchLines", "organizeMap"], ["fold", "collapseBelow", "expandBelow", "focusBranch", "selectBranch"], ["copy", "copyOutline", "lock"], ["showInPlan", "connect"], ["hide"]],
  sticky: [["edit"], ["color", "size", "bold", "talign"], ["convert"], ["copy", "cut", "duplicate"], ["order", "lock"], ["connect"], ["delete"]],
  shape: [["edit"], ["shapeKind", "color", "border", "bw", "dash", "size", "bold", "talign"], ["convert"], ["copy", "cut", "duplicate"], ["order", "lock"], ["connect"], ["delete"]],
  text: [["edit"], ["size", "bold", "talign"], ["convert"], ["copy", "cut", "duplicate"], ["order", "lock"], ["connect"], ["delete"]],
  frame: [["edit", "zoomFrame", "fitFrame", "tidyFrame"], ["copy", "cut", "duplicate", "lock"], ["connect"], ["delete", "deleteFrameAll"]],
  image: [["copy", "cut", "duplicate"], ["order", "lock"], ["connect"], ["delete"]],
  file: [["copy", "cut", "duplicate"], ["order", "lock"], ["connect"], ["delete"]],
  edge: [["epath", "ewidth", "edash", "estart", "eend", "ecolor"], ["elabel", "eswap"], ["delete"]],
  multi: [["align", "distribute", "tidy", "frameSel", "mindFromStickies"], ["color", "size", "bold"], ["copy", "cut", "duplicate", "lock"], ["order"], ["delete"]],
  pane: [["addSticky", "addMind", "addShape", "addText", "addFrame"], ["paste", "selectAll", "find"], ["organizeAll", "toggleSnap"], ["fit", "minimap", "help"]],
};

export interface MenuItem {
  id: string;
  label: string;
  kbd?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  /** A submenu: the choices, one of them checked. */
  choices?: (Choice & { checked: boolean })[];
}

/** The menu for a selection: groups of the commands that apply, empty groups dropped. */
export function resolveMenu(s: Sel, menus: Record<Kind, string[][]> = MENUS): MenuItem[][] {
  const out: MenuItem[][] = [];
  for (const group of menus[s.kind]) {
    const items: MenuItem[] = [];
    for (const id of group) {
      const c = REGISTRY.get(id);
      if (!c || !appliesTo(c, s)) continue;
      const cur = c.current?.(s);
      const item: MenuItem = { id, label: labelOf(c, s), kbd: c.kbd, disabled: !isEnabled(c, s), danger: c.danger };
      if (c.choices) item.choices = c.choices(s).map((ch) => ({ ...ch, checked: cur === ch.id }));
      else if (typeof cur === "boolean") item.checked = cur;
      items.push(item);
    }
    if (items.length) out.push(items);
  }
  return out;
}

/** Run a command by id if it applies and is enabled. Returns false when it did not run. */
export function runCommand(env: Env, s: Sel, id: string, choice?: string): boolean {
  const c = REGISTRY.get(id);
  if (!c || !appliesTo(c, s) || !isEnabled(c, s)) return false;
  void c.run(env, s, choice);
  return true;
}

/** The floating bar for a selection: commands with a `bar` entry that apply, in order. */
export function barOf(s: Sel): { id: string; label: string; kbd?: string }[] {
  return COMMANDS.filter((c) => c.bar && appliesTo(c, s) && isEnabled(c, s))
    .sort((a, b) => a.bar!.order - b.bar!.order)
    .map((c) => ({ id: c.id, label: typeof c.bar!.label === "function" ? c.bar!.label(s) : c.bar!.label, kbd: c.kbd }));
}

/** Everything with a shortcut, for the "?" sheet. */
export function shortcutList(): { id: string; label: string; kbd: string }[] {
  return COMMANDS.filter((c) => c.kbd).map((c) => ({ id: c.id, label: typeof c.label === "string" ? c.label : (c.label as (s: Sel) => string)({ nodes: [], data: { nodes: new Map(), edges: new Map() } } as unknown as Sel) , kbd: c.kbd! }));
}

/** Descendant count helper re-exported for the canvas (collapse badges). */
export { descendantCount };
