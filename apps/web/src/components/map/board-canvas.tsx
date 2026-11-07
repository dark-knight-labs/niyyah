"use client";

import "@xyflow/react/dist/base.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BackgroundVariant, ConnectionMode, MiniMap, ReactFlow, SelectionMode, ViewportPortal, useNodesInitialized, useReactFlow,
  type EdgeChange, type NodeChange, type OnConnect, type OnNodeDrag,
} from "@xyflow/react";
import { useRouter } from "next/navigation";
import { useBoard } from "@/hooks/use-board";
import type { Planner } from "@/hooks/use-planner";
import { boardsApi } from "@/lib/map/boards-api";
import { deriveLifeTree, enrichRefs, LANE_LABEL, PRODUCT_TAG, toStored, UNPLACED, type LifeView, type LiveInfo } from "@/lib/map/life-tree";
import { vaultApi } from "@/lib/vault-api";
import { compassApi, type CompassData } from "@/lib/compass-api";
import { MONTH_LABEL } from "@/lib/streams";
import type { Lane, MonthKey } from "@/lib/vault-types";
import * as A from "@/lib/map/actions";
import { navigate } from "@/lib/map/mind-keys";
import type { Size } from "@/lib/map/layout";
import { childIndex, depthOf, descendantCount, isDescendant, subtreeIds } from "@/lib/map/tree";
import type { Board, BoardNode, Op, StickyColor } from "@/lib/map/types";
import { barOf, makeSel, resolveMenu, runCommand, type Env, type MenuItem } from "@/lib/map/commands";
import { mapsOf, organizeOps } from "@/lib/map/organize";
import type { Layout } from "@/lib/map/layout";
import { STICKY_COLORS, isKnownKind } from "@/lib/map/types";
import { ContextMenu, PromptDialog } from "./context-menu";
import { FilesPanel, HelpSheet, SearchBar } from "./overlays";
import { copySelection, getClip, looksLikeOutline, outlineOf, outlineOps, parseOutline, pasteClip, setClip } from "@/lib/map/clipboard";
import { snapMove } from "@/lib/map/arrange";
import { BoardBar } from "./board-bar";
import { MultiBar } from "./context-bar";
import { derive, type Live, type MapNode } from "./derive";
import { BranchEdge } from "./edges/branch-edge";
import { ConnectorEdge } from "./edges/connector-edge";
import { MapCtx, type BarItem, type EditHow, type MapActions } from "./map-context";
import { FileNode, FrameNode, ImageNode, ShapeNode, StickyNode, TextNode, UnknownNode } from "./nodes/item-nodes";
import { downloadFile, filesApi, forgetFile, MAX_FILE_BYTES, openFile, prepare, releaseFiles } from "@/lib/map/files";
import { MindNode } from "./nodes/mind-node";
import { SideCard, type CardModel } from "./side-card";
import { ToolRail, TOOLS, type Tool } from "./tool-rail";
import { ZoomBar } from "./zoom-bar";

const nodeTypes = { mind: MindNode, sticky: StickyNode, text: TextNode, shape: ShapeNode, frame: FrameNode, image: ImageNode, file: FileNode, unknown: UnknownNode };
const edgeTypes = { branch: BranchEdge, connector: ConnectorEdge };
const ADD_TOOLS = new Set<Tool>(["mind", "sticky", "text", "shape", "frame"]);
const typingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

/**
 * What a thought inherits from where it hangs: the block, the month of a goal, the lane of a lane node and the product of a product
 * or lane node (nearest ancestors that are Plan objects). Under a Done lane the lane is left open (new items are never born done).
 */
interface MakeContext { stream: string | null; month: MonthKey | null; lane: "now" | "next" | "backlog" | null; product: string | null }
function makeContextOf(nodes: Map<string, BoardNode>, info: ReadonlyMap<string, LiveInfo>, id: string): MakeContext {
  const out: MakeContext = { stream: null, month: null, lane: null, product: null };
  const me = nodes.get(id);
  for (let n = me?.parent_id ? nodes.get(me.parent_id) : undefined; n; n = n.parent_id ? nodes.get(n.parent_id) : undefined) {
    const i = info.get(n.id);
    if (!i) continue;
    if (!out.month && i.type === "checkpoint" && i.month) out.month = i.month;
    if (!out.lane && i.type === "lane" && i.lane && i.lane !== "done") out.lane = i.lane;
    if (!out.product && (i.type === "lane" || i.type === "product") && i.product) out.product = i.product;
    if (!out.stream && i.stream) out.stream = i.stream;
    if (out.stream) break;
  }
  return out;
}

/** The part of the board the side card does not cover: 330px on the right, or the bottom sheet under 760px. */
function freeArea(el: HTMLElement, cardOpen: boolean): { w: number; h: number } {
  if (!cardOpen) return { w: el.clientWidth, h: el.clientHeight };
  return el.clientWidth < 760 ? { w: el.clientWidth, h: el.clientHeight * 0.45 } : { w: el.clientWidth - 330, h: el.clientHeight };
}

function rootOfFramed(nodes: Map<string, BoardNode>, id: string): boolean {
  let n = nodes.get(id);
  while (n?.parent_id && nodes.has(n.parent_id)) n = nodes.get(n.parent_id);
  return !!n?.frame_id;
}

interface Toast { message: string; undo?: boolean }

export function BoardCanvas({ boardId, boards, startNew, onOpen, onNew, onRetitle, onDelete, focusNode, plan }: {
  boardId: string; boards: Board[]; startNew: boolean; focusNode: string | null; plan: Planner;
  onOpen: (id: string) => void; onNew: () => void; onRetitle: (id: string, title: string) => void; onDelete: (id: string) => void;
}) {
  const rf = useReactFlow();
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string, undo = false) => {
    setToast({ message, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);
  const raw = useBoard(boardId, notify);
  const router = useRouter();
  const isLife = raw.board?.kind === "life";
  const [showDone, setShowDoneState] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("niyyah-map-show-done") === "1");
  const setShowDone = useCallback((v: boolean) => { setShowDoneState(v); try { window.localStorage.setItem("niyyah-map-show-done", v ? "1" : "0"); } catch { /* private mode */ } }, []);
  const planIn = useMemo(() => ({ quarter: plan.quarter, pipelines: plan.pipelines, objectives: plan.objectives }), [plan.quarter, plan.pipelines, plan.objectives]);
  // The Life board is Plan plus what the board stores; any other board only gets live titles on its promoted thoughts.
  const view = useMemo<LifeView>(() => (isLife ? deriveLifeTree(planIn, raw.data, { showDone }) : enrichRefs(raw.data, planIn)), [isLife, planIn, raw.data, showDone]);
  const data = view.data;
  const idx = useMemo(() => childIndex(data.nodes), [data.nodes]);
  const b = raw;
  const [flash, setFlash] = useState<string | null>(null);
  const [compass, setCompass] = useState<CompassData | null>(null);
  useEffect(() => { if (isLife) void compassApi.get().then(setCompass).catch(() => setCompass(null)); }, [isLife]);

  // A finger pans; a mouse or pen draws the selection box. Re-evaluated when the primary pointer changes (a tablet with a keyboard).
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [live, setLive] = useState<ReadonlyMap<string, Live>>(new Map());
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[]; pos: { x: number; y: number } | null; label: string; groups: MenuItem[][] } | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; initial: string; resolve: (v: string | null) => void } | null>(null);
  const [focus, setFocus] = useState<ReadonlySet<string> | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [search, setSearch] = useState<{ q: string; at: number } | null>(null);
  const [help, setHelp] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const pickCtx = useRef<{ at: { x: number; y: number } | null; replaceId?: string; attachTo?: string; imageOnly?: boolean }>({ at: null });
  const [guides, setGuides] = useState<{ vx: number[]; hy: number[] } | null>(null);
  const [snapOn, setSnapOn] = useState(() => typeof window === "undefined" || window.localStorage.getItem("niyyah-map-snap") !== "0");
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const inCanvas = useRef(false);
  const pendingAnim = useRef<Map<string, { x: number; y: number }> | null>(null);
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map());
  // The minimap redraws every node on each pan frame: at ~1,000 nodes it costs ~10 fps, so big boards start without it (the button turns it on).
  const [minimapPref, setMinimap] = useState<boolean | null>(null);
  const minimap = minimapPref ?? data.nodes.size <= 400;
  const prevNodes = useState(() => new Map<string, MapNode>())[0];
  const fresh = useRef(new Set<string>());
  const reveal = useRef<string | null>(null);
  const cardTag = useRef<string | null>(null);
  const fitted = useRef(false);
  const seeded = useRef(false);

  const derived = useMemo(
    () => derive(data, idx, { selected, editing, dropTarget, linkFrom, flash, info: view.info, live, sizes, focus, connecting }, prevNodes),
    [data, idx, selected, editing, dropTarget, linkFrom, flash, view.info, live, sizes, focus, connecting, prevNodes],
  );
  const initialized = useNodesInitialized();

  /** Centre a rectangle in the part of the board the side card leaves free (`card`: it is or will be open). */
  const centerIn = useCallback((r: { x: number; y: number; w: number; h: number }, zoom: number, animate: boolean) => {
    const el = document.querySelector(".niyyah-map .react-flow") as HTMLElement | null;
    if (!el) return;
    const free = freeArea(el, true);
    void rf.setViewport({ x: free.w / 2 - (r.x + r.w / 2) * zoom, y: free.h / 2 - (r.y + r.h / 2) * zoom, zoom }, { duration: animate ? 250 : 150 });
  }, [rf]);

  // Fresh read access for callbacks that must keep a stable identity.
  // Canvas ops speak in view ids; the Life board stores state rows and parent keys instead (toStored).
  const wrapB = (): typeof raw => ({
    ...raw,
    commit: (ops: Op[], tag?: string) => raw.commit(isLife ? toStored(ops, view, raw.data) : ops, tag),
    amend: (tag: string, ops: Op[]) => raw.amend(tag, isLife ? toStored(ops, view, raw.data) : ops),
    discard: (tag: string, ops: Op[]) => raw.discard(tag, isLife ? toStored(ops, view, raw.data) : ops),
  });
  const L = useRef({ b: raw, data, idx, selected, tool, linkFrom, derived, info: view.info, plan, sizes, snapOn });
  const envRef = useRef<Env | null>(null);
  const focusRef = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => { L.current = { b: wrapB(), data, idx, selected, tool, linkFrom, derived, info: view.info, plan, sizes, snapOn }; });

  const select = useCallback((ids: Iterable<string>) => { cardTag.current = null; setSelected(new Set(ids)); }, []);

  // ---- viewport: fit once everything is measured; centre a requested node; keep new nodes in view ----
  useEffect(() => {
    if (fitted.current || b.loading || !b.board || (isLife && plan.loading)) return;
    if (b.board.viewport) { fitted.current = true; return; }
    if (data.nodes.size === 0) {
      fitted.current = true;
      const el = document.querySelector(".niyyah-map .react-flow") as HTMLElement | null;
      void rf.setViewport({ x: (el?.clientWidth ?? 800) / 2, y: (el?.clientHeight ?? 600) / 2, zoom: 1 });
    } else if (initialized) {
      fitted.current = true;
      const t = setTimeout(() => void rf.fitView({ padding: 0.12, maxZoom: 1, duration: 0 }), 60);
      return () => clearTimeout(t);
    }
  }, [b.loading, b.board, data.nodes.size, initialized, rf, isLife, plan.loading]);

  // Deep link (?node=<key|id>): expand the ancestors, unhide it, select, centre and flash. Waits for Plan on the Life board.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNode || focused.current === focusNode || b.loading || (isLife && plan.loading) || !initialized) return;
    const n = data.nodes.get(focusNode);
    if (!n) return;
    const open: Op[] = [];
    if (n.hidden) open.push({ op: "upsert_node", node: { ...n, hidden: false }, base_updated_at: null });
    for (let p = n.parent_id ? data.nodes.get(n.parent_id) : undefined; p; p = p.parent_id ? data.nodes.get(p.parent_id) : undefined) {
      if (p.collapsed || p.hidden) open.push({ op: "upsert_node", node: { ...p, collapsed: false, hidden: false }, base_updated_at: null });
    }
    if (open.length) { L.current.b.commit(open); return; }          // re-runs once the tree has re-laid out
    const r = derived.rects.get(focusNode);
    if (!r) return;
    focused.current = focusNode;
    setTimeout(() => {
      select([focusNode]);
      setFlash(focusNode);
      centerIn(r, 1.2, true);
      setTimeout(() => setFlash(null), 2600);
    }, 150);
  });

  useEffect(() => {
    const id = reveal.current;
    if (!id) return;
    const r = derived.rects.get(id);
    if (!r) return;
    reveal.current = null;
    const el = document.querySelector(".niyyah-map .react-flow") as HTMLElement | null;
    if (!el) return;
    const { x, y, zoom } = rf.getViewport();
    const free = freeArea(el, true);          // the node is selected, so the card is (about to be) open
    const left = r.x * zoom + x, top = r.y * zoom + y, right = left + r.w * zoom, bottom = top + r.h * zoom;
    const pad = 70;
    if (left < pad + 52 || top < pad + 40 || right > free.w - pad || bottom > free.h - pad) centerIn(r, zoom, false);
  }, [derived, rf, centerIn]);

  // A new board opens with a central idea, ready to type over.
  useEffect(() => {
    if (!startNew || seeded.current || b.loading || !b.board || data.nodes.size > 0) return;
    seeded.current = true;
    const { ops, id } = A.addRoot(0, 0, "Central idea");
    L.current.b.commit(ops, `new:${id}`);
    fresh.current.add(id);
    select([id]);
    setEditing(id);
  }, [startNew, b, data.nodes.size, select]);

  // ---- helpers over current data ----
  const place = useCallback((cx: number, cy: number) => rf.screenToFlowPosition({ x: cx, y: cy }), [rf]);

  const startEdit = useCallback((id: string) => {
    const n = L.current.data.nodes.get(id);
    if (!n || n.style.locked) return;
    if (n.kind === "ref") {
      // a live node edits the real Plan row; the Unplaced branch and rows whose Plan object is gone cannot be edited
      const i = L.current.info.get(id);
      if (!i || i.type === "unplaced" || i.type === "product" || i.type === "lane" || i.gone) return;
    }
    setEditing(id);
  }, []);

  const removeOps = useCallback((ids: Iterable<string>, edgeIds: Iterable<string>): { ops: Op[]; count: number } => {
    const { data: d, idx: ix } = L.current;
    const nodeIds = new Set<string>();
    for (const id of ids) {
      const n = d.nodes.get(id);
      if (!n) continue;
      if (n.kind === "mind" || n.kind === "ref") subtreeIds(ix, id).forEach((x) => nodeIds.add(x)); else nodeIds.add(id);
    }
    const ops: Op[] = [];
    const edgeSet = new Set(edgeIds);
    for (const e of d.edges.values()) if (nodeIds.has(e.from_id) || nodeIds.has(e.to_id)) edgeSet.add(e.id);
    for (const id of edgeSet) ops.push({ op: "delete_edge", id, base_updated_at: null });
    // what sat in a deleted frame stays on the board
    for (const n of d.nodes.values()) if (n.frame_id && nodeIds.has(n.frame_id) && !nodeIds.has(n.id)) ops.push({ op: "upsert_node", node: { ...n, frame_id: null }, base_updated_at: null });
    for (const id of nodeIds) ops.push({ op: "delete_node", id, base_updated_at: null });
    return { ops, count: nodeIds.size };
  }, []);

  const deleteSelection = useCallback(() => {
    const { selected: sel, data: d } = L.current;
    const lockedIds = [...sel].filter((id) => d.nodes.get(id)?.style.locked);
    if (lockedIds.length) notify("Locked: unlock to delete");
    const nodeIds = [...sel].filter((id) => d.nodes.has(id) && !d.nodes.get(id)?.style.locked);
    const edgeIds = [...sel].filter((id) => d.edges.has(id));
    // a live node is hidden from this board (the Plan item stays); the root cannot be; a thought or item is removed
    const live = nodeIds.filter((id) => d.nodes.get(id)?.kind === "ref");
    const rest = nodeIds.filter((id) => !live.includes(id));
    const hide: Op[] = live.filter((id) => d.nodes.get(id)!.parent_id && id !== UNPLACED).map((id) => ({ op: "upsert_node", node: { ...d.nodes.get(id)!, hidden: true }, base_updated_at: null }));
    if (live.length && !hide.length && !rest.length && !edgeIds.length) { notify("The Super Objective is the centre of the Life board"); return; }
    const { ops: del, count } = removeOps(rest, edgeIds);
    const ops = [...hide, ...del];
    if (!ops.length) return;
    const parent = nodeIds.length === 1 ? d.nodes.get(nodeIds[0])?.parent_id ?? null : null;
    L.current.b.commit(ops);
    select(parent && d.nodes.has(parent) ? [parent] : []);
    if (hide.length) notify(hide.length === 1 ? `Hidden from this board. "${d.nodes.get(live[0])!.text}" stays in Plan.` : `Hidden ${hide.length} Plan items from this board`, true);
    else notify(count > 1 ? `Deleted ${count} items` : count === 1 ? "Deleted" : "Deleted the connector", true);
  }, [removeOps, select, notify]);

  /** One colour for every selected sticky, as one undo step. */
  const colorSelection = useCallback((color: StickyColor) => {
    const { selected: sel, data: d, b: bd } = L.current;
    const ops = [...sel].map((id) => d.nodes.get(id)).filter((n): n is BoardNode => n?.kind === "sticky").map((n) => A.setColor(n, color));
    if (ops.length) bd.commit(ops);
  }, []);

  const createMind = useCallback((kind: "child" | "sibling", id: string) => {
    const { data: d, idx: ix, b: bd } = L.current;
    if (!d.nodes.has(id)) return;
    const made = kind === "child" ? A.addChild(d.nodes, ix, id) : A.addSibling(d.nodes, ix, id);
    if (!bd.commit(made.ops, `new:${made.id}`)) return;
    fresh.current.add(made.id);
    reveal.current = made.id;
    select([made.id]);
    setEditing(made.id);
  }, [select]);

  const toggleFold = useCallback((id: string) => {
    const { data: d, idx: ix, b: bd } = L.current;
    const n = d.nodes.get(id);
    if (!n || !n.parent_id || !(ix.get(id)?.length)) return;
    bd.commit([{ op: "upsert_node", node: { ...n, collapsed: !n.collapsed }, base_updated_at: null }]);
  }, []);

  /** Edit the real Plan row behind a live node; the planner data is reloaded after, so the title on the board is Plan's. */
  const liveRename = useCallback(async (id: string, text: string) => {
    const { info, plan: pl } = L.current;
    const i = info.get(id);
    const t = text.trim();
    if (!i || !t) return;
    try {
      if (i.type === "task" && i.item && i.stream) { if (i.item.text === t) return; await vaultApi.renamePipelineItem(i.stream, i.item, t); }
      else if (i.type === "stream" && i.stream) await vaultApi.updateStream(i.stream, { name: t });
      else if (i.type === "checkpoint" && i.stream && i.month) await vaultApi.updateStream(i.stream, { checkpoints: { [i.month]: t } });
      else if (i.type === "week" && i.stream) await vaultApi.setObjective(i.stream, { text: t });
      else if (i.type === "quarter") await vaultApi.setSuperObjective(t);
      else return;
    } catch (e) { notify(e instanceof Error ? e.message : "Could not save to Plan"); }
    await pl.reload();
  }, [notify]);

  const liveLane = useCallback(async (id: string, lane: Lane) => {
    const { info, plan: pl } = L.current;
    const i = info.get(id);
    if (!i || i.type !== "task" || !i.item || !i.stream) return;
    try { await vaultApi.movePipelineItem(i.stream, i.item, lane); notify(`Moved to ${lane === "backlog" ? "Someday" : lane[0].toUpperCase() + lane.slice(1)} in Plan`, false); }
    catch (e) { notify(e instanceof Error ? e.message : "Could not move the item"); }
    await pl.reload();
  }, [notify]);

  const finishEdit = useCallback((id: string, raw: string, how: EditHow) => {
    const { data: d, idx: ix, b: bd } = L.current;
    setEditing(null);
    const n = d.nodes.get(id);
    if (!n) return;
    if (n.kind === "ref") {
      select([id]);
      void liveRename(id, raw);
      if (how === "tab") createMind("child", id);
      return;
    }
    const isFresh = fresh.current.delete(id);
    const mind = n.kind === "mind";
    const text = mind ? A.clampText(raw.trim()) : A.clampText(raw);
    if (mind && !text && isFresh && !(ix.get(id)?.length)) {
      const parent = n.parent_id;
      bd.discard(`new:${id}`, [{ op: "delete_node", id, base_updated_at: null }]);
      select(parent && d.nodes.has(parent) ? [parent] : []);
      return;
    }
    if (text !== n.text && !(mind && !text)) {
      const op = A.setText(n, text);
      if (isFresh) bd.amend(`new:${id}`, [op]); else bd.commit([op]);
    }
    select([id]);
    if (!mind) return;
    if (how === "enter") createMind("sibling", id);
    else if (how === "tab") createMind("child", id);
  }, [createMind, select, liveRename]);

  const connectTo = useCallback((from: string, to: string, sp?: string, tp?: string) => {
    const { data: d, b: bd } = L.current;
    if (from === to || !d.nodes.has(from) || !d.nodes.has(to)) return;
    for (const e of d.edges.values()) if ((e.from_id === from && e.to_id === to) || (e.from_id === to && e.to_id === from)) return;
    const { op, id } = A.edgeBetween(from, to, sp, tp);
    bd.commit([op]);
    select([id]);
  }, [select]);

  const chooseTool = useCallback((t: Tool) => {
    setTool(t);
    setLinkFrom(null);
    if (t === "link") notify("Click the first object, then the second");
  }, [notify]);

  const addItemAt = useCallback((kind: "mind" | "sticky" | "text" | "shape" | "frame", flowX: number, flowY: number) => {
    const { data: d, b: bd } = L.current;
    const fr = kind === "frame" ? null : A.frameAt(d.nodes, flowX, flowY);
    const made = kind === "mind" ? A.addRoot(flowX, flowY, "", fr?.id ?? null) : A.addItem(kind, flowX, flowY, d.nodes, fr?.id ?? null);
    if (!bd.commit(made.ops, `new:${made.id}`)) return;
    setTool("select");
    select([made.id]);
    if (kind !== "frame") { fresh.current.add(made.id); setEditing(made.id); }
  }, [select]);

  // ---- React Flow events ----
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let nextSizes: Map<string, Size> | null = null;
    let nextLive: Map<string, Live> | null = null;
    let nextSel: Set<string> | null = null;
    let nextGuides: { vx: number[]; hy: number[] } | null | undefined;
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) {
        if (c.resizing || c.setAttributes) {
          nextLive ??= new Map(live);
          nextLive.set(c.id, { ...nextLive.get(c.id), w: c.dimensions.width, h: c.dimensions.height });
        } else {
          const cur = (nextSizes ?? sizes).get(c.id);
          const w = c.dimensions.width, h = c.dimensions.height;
          if (!cur || Math.abs(cur.w - w) > 0.5 || Math.abs(cur.h - h) > 0.5) { nextSizes ??= new Map(sizes); nextSizes.set(c.id, { w, h }); }
        }
      } else if (c.type === "position" && c.position) {
        nextLive ??= new Map(live);
        let pos = c.position;
        const moving = changes.filter((x) => x.type === "position").length === 1;
        const row = L.current.data.nodes.get(c.id);
        if (c.dragging && moving && L.current.snapOn && row && !row.frame_id && row.kind !== "frame" && !(row.parent_id && row.kind === "mind")) {
          const sz = row.kind === "mind" ? L.current.sizes.get(c.id) : { w: row.w, h: row.h };
          if (sz) {
            const zoom = rf.getZoom();
            const others = [...L.current.derived.rects].filter(([id]) => id !== c.id && L.current.data.nodes.get(id)?.kind !== "frame").map(([, r]) => r);
            const snap = snapMove({ x: pos.x, y: pos.y, w: sz.w, h: sz.h }, others, 6 / zoom);
            pos = { x: pos.x + snap.dx, y: pos.y + snap.dy };
            nextGuides = { vx: snap.vx, hy: snap.hy };
          }
        }
        nextLive.set(c.id, { ...nextLive.get(c.id), x: pos.x, y: pos.y });
      } else if (c.type === "select") {
        nextSel ??= new Set(selected);
        if (c.selected) nextSel.add(c.id); else nextSel.delete(c.id);
      }
    }
    const ng = nextGuides as { vx: number[]; hy: number[] } | null | undefined;
    if (ng !== undefined) setGuides(ng && (ng.vx.length || ng.hy.length) ? ng : null);
    if (nextSizes) setSizes(nextSizes);
    if (nextLive) setLive(nextLive);
    if (nextSel) { cardTag.current = null; setSelected(nextSel); }
  }, [live, sizes, selected, rf]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    let next: Set<string> | null = null;
    for (const c of changes) if (c.type === "select") { next ??= new Set(selected); if (c.selected) next.add(c.id); else next.delete(c.id); }
    if (next) setSelected(next);
  }, [selected]);

  const side = (h: string | null | undefined) => (h && /^p-[trbl]$/.test(h) ? h[2] : undefined);
  const onConnect: OnConnect = useCallback((c) => connectTo(c.source, c.target, side(c.sourceHandle), side(c.targetHandle)), [connectTo]);

  const onPaneClick = useCallback((e: React.MouseEvent) => {
    setEditing(null);
    if (ADD_TOOLS.has(tool)) { const p = place(e.clientX, e.clientY); addItemAt(tool as "mind", p.x, p.y); }
  }, [tool, place, addItemAt]);

  const onNodeClick = useCallback((e: React.MouseEvent, node: MapNode) => {
    if (tool === "link") {
      if (!linkFrom) { setLinkFrom(node.id); return; }
      connectTo(linkFrom, node.id);
      setLinkFrom(null);
      setTool("select");
      return;
    }
    if (ADD_TOOLS.has(tool) && node.type === "frame") { const p = place(e.clientX, e.clientY); addItemAt(tool as "mind", p.x, p.y); }
  }, [tool, linkFrom, connectTo, place, addItemAt]);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: MapNode) => { if (tool === "select") startEdit(node.id); }, [tool, startEdit]);

  const dropTargetAt = useCallback((e: MouseEvent | TouchEvent, dragged: string): string | null => {
    const pt = "touches" in e ? (e.touches[0] ?? e.changedTouches[0]) : e;
    for (const el of document.elementsFromPoint(pt.clientX, pt.clientY)) {
      const nodeEl = el.closest(".react-flow__node");
      const id = nodeEl?.getAttribute("data-id");
      if (id && id !== dragged) {
        const { data: d } = L.current;
        const n = d.nodes.get(id);
        if (n && (n.kind === "mind" || n.kind === "ref") && id !== UNPLACED && !isDescendant(d.nodes, id, dragged)) return id;
        return null;
      }
    }
    return null;
  }, []);

  const onNodeDrag: OnNodeDrag<MapNode> = useCallback((e, node) => {
    const n = L.current.data.nodes.get(node.id);
    if (!n || n.kind !== "mind" || !n.parent_id) return;
    const t = dropTargetAt(e, node.id);
    setDropTarget((cur) => (cur === t ? cur : t));
  }, [dropTargetAt]);

  const onNodeDragStop: OnNodeDrag<MapNode> = useCallback((e, node, dragged) => {
    const { data: d, idx: ix, b: bd } = L.current;
    setDropTarget(null);
    setGuides(null);
    const ops: Op[] = [];
    const movedFrames = new Set(dragged.filter((x) => d.nodes.get(x.id)?.kind === "frame").map((x) => x.id));
    for (const dn of dragged) {
      const n = d.nodes.get(dn.id);
      if (!n) continue;
      const parent = n.frame_id ? d.nodes.get(n.frame_id) : undefined;
      if (n.frame_id && movedFrames.has(n.frame_id)) continue; // moves with its frame
      if (n.kind === "mind" && n.parent_id) {
        // a branch dropped on a node moves under it; anywhere else it snaps back
        const target = dragged.length === 1 ? dropTargetAt(e, n.id) : null;
        if (target) {
          const t = d.nodes.get(target)!;
          const ptr = place("touches" in e ? e.changedTouches[0].clientX : e.clientX, 0).x;
          const side = !t.parent_id && ptr < t.x ? "L" : "R";
          ops.push(...A.reparent(d.nodes, ix, n.id, target, side));
        } else if (dragged.length === 1) notify("Mind map nodes sit in the tree. Drop onto another node to move the branch.");
        continue;
      }
      if (n.kind === "ref") { if (dragged.length === 1) notify("Plan items keep their place from Plan. Drag thoughts freely, or change the block in Plan."); continue; }
      const measured = sizes.get(n.id);
      const w = n.kind === "mind" ? measured?.w ?? 0 : n.w, h = n.kind === "mind" ? measured?.h ?? 0 : n.h;
      const absX = dn.position.x + (parent && !movedFrames.has(parent.id) ? parent.x : 0);
      const absY = dn.position.y + (parent && !movedFrames.has(parent.id) ? parent.y : 0);
      if (n.kind === "frame") {
        const dx = Math.round(absX) - n.x, dy = Math.round(absY) - n.y;
        ops.push({ op: "upsert_node", node: { ...n, x: n.x + dx, y: n.y + dy }, base_updated_at: null });
        for (const m of d.nodes.values()) if (m.frame_id === n.id) ops.push({ op: "upsert_node", node: { ...m, x: m.x + dx, y: m.y + dy }, base_updated_at: null });
        continue;
      }
      // a root is positioned by its centre; an item by its corner
      const x = n.kind === "mind" ? Math.round(absX + w / 2) : Math.round(absX);
      const y = n.kind === "mind" ? Math.round(absY + h / 2) : Math.round(absY);
      const cx = n.kind === "mind" ? x : x + w / 2, cy = n.kind === "mind" ? y : y + h / 2;
      const into = A.frameAt(d.nodes, cx, cy);
      ops.push({ op: "upsert_node", node: { ...n, x, y, frame_id: into?.id ?? null }, base_updated_at: null });
    }
    setLive((cur) => { const next = new Map(cur); for (const x of dragged) next.delete(x.id); return next; });
    if (ops.length) bd.commit(ops);
  }, [dropTargetAt, place, notify, sizes]);

  const resizeEnd = useCallback((id: string, p: { x: number; y: number; width: number; height: number }) => {
    const { data: d, b: bd } = L.current;
    const n = d.nodes.get(id);
    setLive((cur) => { const next = new Map(cur); next.delete(id); return next; });
    if (!n) return;
    const parent = n.frame_id ? d.nodes.get(n.frame_id) : undefined;
    const x = Math.round(p.x + (parent?.x ?? 0)), y = Math.round(p.y + (parent?.y ?? 0));
    bd.commit([{ op: "upsert_node", node: { ...n, x: n.kind === "frame" ? n.x : x, y: n.kind === "frame" ? n.y : y, w: Math.round(p.width), h: Math.round(p.height) }, base_updated_at: null }]);
  }, []);

  // ---- bar / card ----
  const makeContext = useCallback((id: string) => makeContextOf(L.current.data.nodes, L.current.info, id), []);

  /** Thought -> Plan item: the server creates the pipeline row and turns the node into its ref row, in one transaction. */
  const makeItem = useCallback(async (id: string, stream: string, lane: "now" | "next" | "backlog", product: string | null) => {
    const { data: d, plan: pl } = L.current;
    const n = d.nodes.get(id);
    if (!n || n.kind !== "mind") return;
    if (!n.text.trim()) { notify("Give the thought a title first"); return; }
    const month = makeContext(id).month;
    try {
      await raw.flush();
      const res = await boardsApi.promote(boardId, id, { stream, lane, checkpoint: month, ...(product ? { product } : {}) });
      await pl.reload();            // the item must be in the derived tree before its row turns into a ref, or it would flash under Unplaced
      raw.forgetHistory(id);        // undo must never put the old thought row back over the ref row
      raw.adoptNode(res.node, res.revision);
      const name = pl.pipelines?.streams.find((s) => s.stream === stream)?.name ?? stream;
      notify(`Added to ${name} · ${lane === "backlog" ? "Someday" : lane[0].toUpperCase() + lane.slice(1)}. It is a live Plan item now.`);
      select([L.current.b.board?.kind === "life" ? `task:${res.task_id}` : res.node.id]);   // on Life the node's id is its key
    } catch (e) { notify(e instanceof Error ? e.message : "Could not make the item"); }
  }, [boardId, raw, makeContext, notify, select]);

  const cardModel = useMemo<CardModel | null>(() => {
    if (selected.size === 0) return null;
    if (selected.size > 1) return { type: "many", count: selected.size };
    const id = [...selected][0];
    const n = data.nodes.get(id);
    if (n) {
      if (n.kind === "ref") {
        const i = view.info.get(id);
        if (i) {
          const depth = depthOf(data.nodes, id);
          const goal = i.type === "task" && i.item?.checkpoint && i.stream ? data.nodes.get(`cp:${i.stream}:${i.item.checkpoint}`) : undefined;
          const quarter = plan.quarter;
          return {
            type: "live", id, text: n.text, below: descendantCount(idx, id), depth, info: i, stream: i.streamName ?? null,
            checkpoint: i.type === "task" && i.item?.checkpoint ? `${i.item.checkpoint.toUpperCase()}${goal ? ` · ${goal.text}` : ""}` : (i.month ? MONTH_LABEL[i.month] : null),
            head: { quarter: "Super Objective · live", stream: "Block · live", checkpoint: "Goal · live", week: "Week objective · live", product: "Product · from tags", lane: `Lane · ${i.lane ? LANE_LABEL[i.lane] : ""}`, task: i.gone ? "Plan item · gone" : "Plan item · live", unplaced: "Unplaced" }[i.type],
            editable: !i.gone && i.type !== "unplaced" && i.type !== "product" && i.type !== "lane", hideable: depth > 0 && i.type !== "unplaced",
            compass: i.type === "quarter" ? { mission: compass?.mission ?? "", vision: compass?.vision ?? "", week: quarter ? `${quarter.week_of_quarter} of ${quarter.weeks_in_quarter}` : "" } : null,
          };
        }
      }
      if (n.kind === "mind" || n.kind === "ref") {
        const mc = n.kind === "mind" ? makeContextOf(data.nodes, view.info, id) : null;
        const streams = (plan.pipelines?.streams ?? []).filter((s) => s.status !== "archived").map((s) => ({ id: s.stream, label: s.name }));
        const productsOf: Record<string, string[]> = {};
        for (const s of plan.pipelines?.streams ?? []) {
          const seen = new Map<string, string>();
          for (const it of s.items) for (const t of it.products ?? []) if (PRODUCT_TAG.test(t) && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
          productsOf[s.stream] = [...seen.values()].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
        }
        const make = mc && streams.length && n.text.trim() ? { streams, stream: mc.stream, checkpoint: mc.month ? mc.month.toUpperCase() : null, lane: mc.lane, product: mc.product && PRODUCT_TAG.test(mc.product) ? mc.product : null, productBlocked: !!mc.product && !PRODUCT_TAG.test(mc.product), productsOf } : null;
        return { type: "mind", id, text: n.text, notes: n.notes, below: descendantCount(idx, id), depth: depthOf(data.nodes, id), readOnly: n.kind === "ref", make };
      }
      return { type: "item", id, kind: n.kind as "sticky" | "text" | "shape" | "frame" | "image" | "file", text: n.text, color: (n.style.color as StickyColor) ?? "yellow" };
    }
    const e = data.edges.get(id);
    return e ? { type: "edge", id, label: e.label } : null;
  }, [selected, data, idx, view.info, plan.quarter, plan.pipelines, compass]);

  const cardText = useCallback((id: string, text: string) => {
    const { data: d, b: bd } = L.current;
    const n = d.nodes.get(id);
    if (n?.kind === "ref") { void liveRename(id, text); return; }
    if (!n || n.text === text) return;
    const op = A.setText(n, text);
    const tag = `card:${id}`;
    if (cardTag.current === tag) bd.amend(tag, [op]); else { bd.commit([op], tag); cardTag.current = tag; }
  }, [liveRename]);

  const cardNotes = useCallback((id: string, notes: string) => {
    const { data: d, b: bd } = L.current;
    const n = d.nodes.get(id);
    if (!n || n.notes === notes) return;
    const tag = `notes:${id}`;
    const op: Op = { op: "upsert_node", node: { ...n, notes: notes.slice(0, 10000) }, base_updated_at: null };
    if (cardTag.current === tag) bd.amend(tag, [op]); else { bd.commit([op], tag); cardTag.current = tag; }
  }, []);

  const cardLabel = useCallback((id: string, label: string) => {
    const { data: d, b: bd } = L.current;
    const e = d.edges.get(id);
    if (e && e.label !== label) bd.commit([{ op: "upsert_edge", edge: { ...e, label }, base_updated_at: null }]);
  }, []);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typingTarget(e.target) || (e.target as HTMLElement | null)?.closest?.("[role=menu]")) return;
      const { selected: sel, data: d, idx: ix, b: bd, tool: tl } = L.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      const one = sel.size === 1 ? [...sel][0] : null;
      const node = one ? d.nodes.get(one) : undefined;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      const env = envRef.current;
      if ((key === "ContextMenu" || (e.shiftKey && key === "F10")) && env) {
        stop();
        const first = [...sel][0];
        const r = first ? L.current.derived.rects.get(first) : undefined;
        const pt = r ? rf.flowToScreenPosition({ x: r.x + r.w, y: r.y + r.h / 2 }) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        const pos = r ? null : rf.screenToFlowPosition(pt);
        setMenu({ x: pt.x, y: pt.y, ids: [...sel], pos, label: "Actions", groups: resolveMenu(makeSel({ ids: [...sel], data: d, idx: ix, rects: L.current.derived.rects, canMake: !!L.current.plan.pipelines?.streams.length, pos })) });
        return;
      }
      if (e.altKey && !mod && (key === "ArrowUp" || key === "ArrowDown") && env && one) {
        stop();
        runCommand(env, makeSel({ ids: [one], data: d, idx: ix, rects: L.current.derived.rects }), key === "ArrowUp" ? "moveUp" : "moveDown");
        return;
      }
      if (mod && env && sel.size > 0 && !e.shiftKey && ["c", "x", "d", "l"].includes(key.toLowerCase())) {
        stop();
        const cmd = { c: "copy", x: "cut", d: "duplicate", l: "lock" }[key.toLowerCase() as "c"];
        runCommand(env, makeSel({ ids: [...sel], data: d, idx: ix, rects: L.current.derived.rects }), cmd);
        return;
      }
      if (mod && key.toLowerCase() === "a" && env) { stop(); env.selectAll(); return; }
      if (mod && key.toLowerCase() === "f" && env && inCanvas.current) { stop(); env.search(); return; }
      if (mod && env && sel.size > 0 && (key === "]" || key === "[" || key === "}" || key === "{")) {
        stop();
        const mode = key === "]" ? "forward" : key === "[" ? "backward" : key === "}" ? "front" : "back";
        runCommand(env, makeSel({ ids: [...sel], data: d, idx: ix, rects: L.current.derived.rects }), "order", mode);
        return;
      }
      if (!mod && !e.altKey && !e.shiftKey && key.toLowerCase() === "i" && env) { stop(); env.pickFiles({ imageOnly: true }); return; }
      if (!mod && !e.altKey && key === "?" && env) { stop(); env.help(); return; }
      if (mod && key.toLowerCase() === "b" && env && sel.size > 0) { stop(); runCommand(env, makeSel({ ids: [...sel], data: d, idx: ix }), "bold"); return; }
      if (mod && key.toLowerCase() === "z") { stop(); if (e.shiftKey) bd.redo(); else bd.undo(); return; }
      if (mod && key.toLowerCase() === "y") { stop(); bd.redo(); return; }
      if (mod && key === ".") { stop(); if (node && (node.kind === "mind" || node.kind === "ref")) toggleFold(node.id); return; }
      if (mod && key === "0") { stop(); void rf.zoomTo(1, { duration: 120 }); return; }
      if (mod || e.altKey) return;
      if (e.shiftKey && (key === "!" || e.code === "Digit1")) { stop(); void rf.fitView({ padding: 0.12, maxZoom: 1.5, duration: 250 }); return; }
      if (key === "+" || key === "=") { stop(); void rf.zoomIn({ duration: 120 }); return; }
      if (key === "-") { stop(); void rf.zoomOut({ duration: 120 }); return; }
      if (key === "Escape") { stop(); if (tl !== "select") chooseTool("select"); else if (focusRef.current) setFocus(null); else select([]); return; }
      if (node && (node.kind === "mind" || node.kind === "ref")) {
        if (key === "Tab") { stop(); createMind("child", node.id); return; }
        if (key === "Enter" && node.kind === "mind") { stop(); createMind(node.parent_id ? "sibling" : "child", node.id); return; }
        if (key === "Escape") { /* handled below */ }
        if (key.startsWith("Arrow")) {
          stop();
          const to = navigate(d.nodes, ix, node.id, key as "ArrowLeft");
          if (to) { select([to]); reveal.current = to; setLive((c) => new Map(c)); }
          return;
        }
      }
      if (node && node.kind !== "mind" && node.kind !== "ref" && key.startsWith("Arrow")) {
        stop();
        const step = e.shiftKey ? 40 : 10;
        const dx = key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0, dy = key === "ArrowDown" ? step : key === "ArrowUp" ? -step : 0;
        const ops: Op[] = [{ op: "upsert_node", node: { ...node, x: node.x + dx, y: node.y + dy }, base_updated_at: null }];
        if (node.kind === "frame") for (const m of d.nodes.values()) if (m.frame_id === node.id) ops.push({ op: "upsert_node", node: { ...m, x: m.x + dx, y: m.y + dy }, base_updated_at: null });
        bd.commit(ops);
        return;
      }
      if (one && (key === "F2" || (key === "Enter" && node && node.kind !== "mind"))) { stop(); startEdit(one); return; }
      if (sel.size > 0 && (key === "Delete" || key === "Backspace")) { stop(); deleteSelection(); return; }
      const t = TOOLS.find((x) => x.key.toLowerCase() === key.toLowerCase());
      if (t && !e.shiftKey) { stop(); chooseTool(t.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rf, chooseTool, createMind, deleteSelection, select, startEdit, toggleFold]);

  // Find: matches by text (and notes) among the drawn objects, in reading order; stepping selects, centres and flashes one.
  const searchQ = search?.q;
  const matches = useMemo(() => {
    const q = searchQ?.trim().toLowerCase();
    if (!q) return [] as string[];
    const out: { id: string; y: number; x: number }[] = [];
    for (const n of data.nodes.values()) {
      const r = derived.rects.get(n.id);
      if (!r || !isKnownKind(n.kind)) continue;
      if (n.text.toLowerCase().includes(q) || n.notes.toLowerCase().includes(q)) out.push({ id: n.id, x: r.x, y: r.y });
    }
    return out.sort((a, b) => a.y - b.y || a.x - b.x).map((m) => m.id);
  }, [searchQ, data.nodes, derived.rects]);
  const jump = useCallback((i: number, list: string[]) => {
    const id = list[i];
    const r = id ? L.current.derived.rects.get(id) : undefined;
    if (!id || !r) return;
    select([id]);
    setFlash(id);
    centerIn(r, Math.max(1, rf.getZoom()), true);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
  }, [select, centerIn, rf]);

  const frames = useMemo(() => [...data.nodes.values()].filter((n) => n.kind === "frame"), [data.nodes]);
  const hidden = useMemo(() => [...data.nodes.values()].filter((n) => n.hidden && (n.kind === "mind" || n.kind === "ref")), [data.nodes]);

  const zoomFrame = useCallback((id: string) => {
    const f = L.current.data.nodes.get(id);
    if (!f) return;
    select([id]);
    const el = document.querySelector(".niyyah-map .react-flow") as HTMLElement | null;
    if (!el) return;
    // fit into what the card (which opens with the selection) leaves free
    const free = freeArea(el, true), pad = 70;
    const rect = { x: f.x, y: f.y - 30, w: f.w, h: f.h + 30 };
    const zoom = Math.min(4, Math.max(0.1, Math.min((free.w - pad * 2) / rect.w, (free.h - pad * 2) / rect.h)));
    centerIn(rect, zoom, true);
  }, [select, centerIn]);

  const unhide = useCallback((id: string) => {
    const { data: d, b: bd } = L.current;
    const n = d.nodes.get(id);
    if (!n) return;
    bd.commit([{ op: "upsert_node", node: { ...n, hidden: false }, base_updated_at: null }]);
    select([id]);
    reveal.current = id;
  }, [select]);

  const fit = useCallback(() => void rf.fitView({ padding: 0.12, maxZoom: 1.5, duration: 250 }), [rf]);

  // ---- command registry wiring: the bar, the right-click menu and the keyboard all run the same commands ----
  const selFor = useCallback((ids: string[], pos: { x: number; y: number } | null = null) => {
    const { data: d, idx: ix, derived: dv, plan: pl } = L.current;
    return makeSel({ ids, data: d, idx: ix, rects: dv.rects, canMake: !!pl.pipelines?.streams.length, pos });
  }, []);

  const organize = useCallback((rootIds: string[], layout: Layout | "keep") => {
    const { data: d, idx: ix, derived: dv, b: bd } = L.current;
    const obstacles = [...dv.rects].filter(([id]) => { const n = d.nodes.get(id); return !!n && n.kind !== "mind" && n.kind !== "ref" && n.kind !== "frame"; }).map(([, r]) => r);
    const ops = organizeOps(d, ix, rootIds, layout, L.current.sizes as Map<string, Size>, obstacles);
    if (!ops.length) { notify("Already organized"); return; }
    pendingAnim.current = new Map([...dv.rects].map(([id, r]) => [id, { x: r.x, y: r.y }]));
    bd.commit(ops);
  }, [notify]);

  /** Where a new object lands when nothing says: under the pointer, else the middle of the window. */
  const placeFresh = useCallback(() => (pointer.current ? rf.screenToFlowPosition(pointer.current) : rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })), [rf]);
  // ---- images and files: picked, pasted or dropped -> prepared (big images downscaled) -> uploaded -> an object on the board ----
  useEffect(() => () => releaseFiles(), [boardId]);
  const ingest = useCallback(async (files: File[], at: { x: number; y: number } | null, opts: { replaceId?: string; attachTo?: string } = {}) => {
    const base = at ?? placeFresh();
    let i = 0;
    for (const f of files) {
      try {
        notify(`Uploading ${f.name || "file"}…`);
        const prep = await prepare(f);
        if (prep.blob.size > MAX_FILE_BYTES) { notify(`${f.name || "That file"} is over ${MAX_FILE_BYTES / 1048576} MB`); continue; }
        const up = await filesApi.upload(prep.blob, prep.name, boardId);
        const kind = up.mime.startsWith("image/") ? "image" : "file";
        const { data: d, b: bd } = L.current;
        const meta = { file_id: up.id, name: up.name, bytes: up.size, mime: up.mime, nw: prep.nw || undefined, nh: prep.nh || undefined };
        if (opts.replaceId) {
          const n = d.nodes.get(opts.replaceId);
          if (!n) continue;
          const oldId = n.style.file_id;
          const sty = { ...n.style, file_id: up.id, bytes: up.size, mime: up.mime, nw: meta.nw, nh: meta.nh } as BoardNode["style"];
          if (!meta.nw) { delete sty.nw; delete sty.nh; }
          bd.commit([{ op: "upsert_node", node: { ...n, kind, style: sty, text: kind === "file" && !n.text ? up.name : n.text }, base_updated_at: null }]);
          if (oldId) forgetFile(oldId);
          notify("Replaced");
          continue;
        }
        let px = base.x + i * 28, py = base.y + i * 28;
        const anchor = opts.attachTo ? d.nodes.get(opts.attachTo) : undefined;
        const ar = opts.attachTo ? L.current.derived.rects.get(opts.attachTo) : undefined;
        if (anchor && ar) { px = ar.x + ar.w + 120; py = ar.y + ar.h / 2 + i * 90; }
        const fr = A.frameAt(d.nodes, px, py);
        const made = A.addMedia(kind, px, py, meta, fr?.id ?? null);
        const ops = [...made.ops];
        if (anchor) ops.push(A.edgeBetween(anchor.id, made.id).op);
        if (bd.commit(ops)) select([made.id]);
        i++;
        notify(kind === "image" ? "Image added" : "File added");
      } catch (e) {
        const err = e as { status?: number; message?: string };
        notify(err.message || "Could not upload");
        if (err.status === 422) setFilesOpen(true);
      }
    }
  }, [boardId, notify, placeFresh, select]);
  const pickFiles = useCallback((o: { at?: { x: number; y: number } | null; replaceId?: string; attachTo?: string; imageOnly?: boolean } = {}) => {
    pickCtx.current = { at: o.at ?? null, replaceId: o.replaceId, attachTo: o.attachTo, imageOnly: o.imageOnly };
    const el = picker.current;
    if (!el) return;
    el.accept = o.imageOnly ? "image/png,image/jpeg,image/webp,image/gif" : "";
    el.multiple = !o.replaceId;
    el.value = "";
    el.click();
  }, []);

  // ---- clipboard: copy / cut / paste / duplicate (internal clipboard + a Markdown outline on the system one) ----
  const copyCmd = useCallback((cut: boolean) => {
    const { selected: sel, data: d } = L.current;
    const ids = [...sel].filter((id) => d.nodes.has(id));
    const clip = copySelection(d, ids);
    if (!clip) { notify("Nothing to copy"); return; }
    setClip(clip);
    if (clip.text) void navigator.clipboard?.writeText(clip.text).catch(() => undefined);
    if (cut) { const { ops } = removeOps(ids.filter((id) => d.nodes.get(id)?.kind !== "ref" && !d.nodes.get(id)?.style.locked), []); if (ops.length) { L.current.b.commit(ops); select([]); } notify("Cut", true); } else notify("Copied");
  }, [notify, removeOps, select]);
  const doPasteText = useCallback((text: string, parentId: string | null, pos: { x: number; y: number } | null) => {
    const { data: d, b: bd } = L.current;
    const parent = parentId ? d.nodes.get(parentId) ?? null : null;
    const at = pos ?? placeFresh();
    if (looksLikeOutline(text)) {
      const made = outlineOps(parseOutline(text), parent && parent.kind === "mind" ? parent : null, at, d);
      if (bd.commit(made.ops)) { select(made.ids); notify(parent ? "Pasted the outline under it" : "Pasted the outline as a map"); }
      return;
    }
    const line = text.trim().slice(0, 4000);
    if (!line) return;
    if (parent && parent.kind === "mind") {
      const made = A.addChild(d.nodes, L.current.idx, parent.id);
      const op = made.ops.at(-1)!;
      if (op.op === "upsert_node") op.node = { ...op.node, text: line };
      if (bd.commit(made.ops)) select([made.id]);
    } else {
      const made = A.addItem("sticky", at.x, at.y, d.nodes, A.frameAt(d.nodes, at.x, at.y)?.id ?? null);
      const op = made.ops[0];
      if (op.op === "upsert_node") op.node = { ...op.node, text: line };
      if (bd.commit(made.ops)) select([made.id]);
    }
  }, [placeFresh, select, notify]);
  const pasteCmd = useCallback((parentId: string | null, pos: { x: number; y: number } | null) => {
    const { data: d, b: bd } = L.current;
    const clip = getClip();
    if (clip && clip.nodes.length) {
      const parent = parentId ? d.nodes.get(parentId) ?? null : null;
      const made = pasteClip(clip, { parent: parent && parent.kind === "mind" ? parent : null, pos: parent ? null : pos, data: d });
      if (bd.commit(made.ops)) { select(made.ids); notify("Pasted"); }
      return;
    }
    void navigator.clipboard?.readText().then((t) => { if (t.trim()) doPasteText(t, parentId, pos); else notify("Nothing to paste"); }).catch(() => notify("Nothing to paste"));
  }, [select, notify, doPasteText]);
  const duplicateCmd = useCallback(() => {
    const { selected: sel, data: d, b: bd } = L.current;
    const ids = [...sel].filter((id) => d.nodes.has(id));
    const clip = copySelection(d, ids);
    if (!clip || !clip.nodes.length) return;
    const one = ids.length === 1 ? d.nodes.get(ids[0]) : undefined;
    const parent = one && one.kind === "mind" && one.parent_id ? d.nodes.get(one.parent_id) ?? null : null;
    const made = pasteClip(clip, { parent, pos: null, data: d });
    if (bd.commit(made.ops)) select(made.ids);
  }, [select]);

  // Paste: the system clipboard is read from the paste event (text and, later, images); our own copy wins when its outline is what is on it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (typingTarget(e.target) || (e.target as HTMLElement | null)?.closest?.("[role=menu]")) return;
      const { selected: sel, data: d } = L.current;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) { e.preventDefault(); void ingest(files, null); return; }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const one = sel.size === 1 ? d.nodes.get([...sel][0]) : undefined;
      const parent = one && one.kind === "mind" ? one.id : null;
      const clip = getClip();
      e.preventDefault();
      if (clip && clip.nodes.length && (!text || text === clip.text)) pasteCmd(parent, null);
      else if (text.trim()) doPasteText(text, parent, null);
    };
    const onMove = (e: PointerEvent) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("paste", onPaste);
    window.addEventListener("pointermove", onMove, { passive: true });
    // Ctrl+F belongs to the map only while focus is in it (a focused wrapper, node or input). A removed element (the closed search box) fires no focusout, so the flag then keeps its value.
    const inMap = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.(".niyyah-map");
    const onFocusIn = (e: FocusEvent) => { inCanvas.current = inMap(e.target); };
    const onFocusOut = (e: FocusEvent) => { if (!e.relatedTarget && document.hasFocus() && inMap(e.target)) inCanvas.current = false; };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => { window.removeEventListener("paste", onPaste); window.removeEventListener("pointermove", onMove); document.removeEventListener("focusin", onFocusIn); document.removeEventListener("focusout", onFocusOut); };
  }, [pasteCmd, doPasteText, ingest]);

  const env = useMemo<Env>(() => ({
    commit: (ops, tag) => L.current.b.commit(ops, tag),
    select, edit: startEdit,
    editNew: (id) => { fresh.current.add(id); reveal.current = id; select([id]); setEditing(id); },
    addChild: (id) => createMind("child", id), addSibling: (id) => createMind("sibling", id),
    fold: toggleFold, del: deleteSelection,
    connect: (id) => { setTool("link"); setLinkFrom(id); },
    make: (id) => { const c = makeContext(id); if (c.stream) void makeItem(id, c.stream, c.lane ?? "next", c.product && PRODUCT_TAG.test(c.product) ? c.product : null); else notify("Choose a block in the details card"); },
    prompt: (title, initial) => new Promise((resolve) => setPrompt({ title, initial, resolve })),
    notify: (m) => notify(m),
    focusNotes: (id) => { select([id]); setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-testid="card-notes"]')?.focus(), 140); },
    organize,
    focusBranch: (id) => { if (!id) { setFocus(null); return; } setFocus(new Set(subtreeIds(L.current.idx, id))); },
    openPlan: () => router.push("/plan"),
    addAt: (kind, pos) => { const p = pos ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); addItemAt(kind, p.x, p.y); },
    selectAll: () => select([...L.current.data.nodes.values()].filter((n) => isKnownKind(n.kind) && !n.hidden && L.current.derived.rects.has(n.id)).map((n) => n.id)),
    fit: () => void rf.fitView({ padding: 0.12, maxZoom: 1.5, duration: 250 }),
    zoomToFrame: (id) => zoomFrame(id),
    toggleMinimap: () => setMinimap((m) => !(m ?? data.nodes.size <= 400)),
    sizes: () => L.current.sizes as Map<string, Size>,
    copy: (cut) => copyCmd(cut), paste: (parentId, pos) => pasteCmd(parentId, pos), duplicate: () => duplicateCmd(),
    copyOutline: () => { const { selected: sel, data: d } = L.current; const t = outlineOf(d, [...sel]); if (t) { void navigator.clipboard?.writeText(t).catch(() => undefined); notify("Copied as an outline"); } },
    search: () => setSearch((s) => s ?? { q: "", at: 0 }), help: () => setHelp(true),
    pickFiles: (o) => pickFiles(o),
    download: (id) => { const n = L.current.data.nodes.get(id); const fid = n?.style.file_id; if (fid) void downloadFile(fid, n.text || "file").catch(() => notify("Could not download")); },
    openFull: (id) => { const fid = L.current.data.nodes.get(id)?.style.file_id; if (fid) void openFile(fid).catch(() => notify("Could not open")); },
    toggleSnap: () => setSnapOn((v) => { const n = !v; try { window.localStorage.setItem("niyyah-map-snap", n ? "1" : "0"); } catch { /* private mode */ } return n; }),
  }), [pickFiles, copyCmd, pasteCmd, duplicateCmd, select, startEdit, createMind, toggleFold, deleteSelection, makeContext, makeItem, notify, organize, router, rf, addItemAt, zoomFrame, data.nodes.size]);
  useEffect(() => { envRef.current = env; });
  useEffect(() => { focusRef.current = focus; }, [focus]);

  const barItems = useCallback((id: string): BarItem[] => {
    const s = selFor([id]);
    const items: BarItem[] = barOf(s).map((c) => ({ key: c.id, label: c.label, kbd: c.kbd }));
    if (s.kind === "sticky") return [...STICKY_COLORS.map((c) => ({ key: `color:${c}`, label: c, swatch: c })), ...items];
    return items;
  }, [selFor]);

  const openMenuAt = useCallback((x: number, y: number, ids: string[], pos: { x: number; y: number } | null, label: string) => setMenu({ x, y, ids, pos, label, groups: resolveMenu(selFor(ids, pos)) }), [selFor]);
  const runBar = useCallback((id: string, key: string, anchor?: DOMRect) => {
    if (key.startsWith("color:")) { const n = L.current.data.nodes.get(id); if (n) L.current.b.commit([A.setColor(n, key.slice(6) as StickyColor)]); return; }
    if (key === "more") { const r = anchor; openMenuAt(r ? r.left : 200, r ? r.bottom + 4 : 200, [id], null, "Actions"); return; }
    runCommand(env, selFor([id]), key);
  }, [env, selFor, openMenuAt]);
  const actions = useMemo<MapActions>(() => ({ finishEdit, toggleFold, resizeEnd, barItems, runBar }), [finishEdit, toggleFold, resizeEnd, barItems, runBar]);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: MapNode) => {
    e.preventDefault();
    if (node.type === "unknown") return;
    const cur = L.current.selected;
    const ids = cur.has(node.id) ? [...cur] : [node.id];
    if (!cur.has(node.id)) select(ids);
    openMenuAt(e.clientX, e.clientY, ids, null, "Actions");
  }, [select, openMenuAt]);
  const onSelectionContextMenu = useCallback((e: React.MouseEvent, nodes: MapNode[]) => { e.preventDefault(); openMenuAt(e.clientX, e.clientY, nodes.map((n) => n.id), null, "Selection actions"); }, [openMenuAt]);
  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: { id: string; type?: string }) => {
    e.preventDefault();
    if (edge.type === "branch") return;
    select([edge.id]);
    openMenuAt(e.clientX, e.clientY, [edge.id], null, "Connector actions");
  }, [select, openMenuAt]);
  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    if ((e.target as HTMLElement | null)?.closest?.(".react-flow__node, .react-flow__edge, .nm-cm")) return;   // React Flow reports a right-button release as a pane menu: a node's, a connector's or an open menu's own stays
    select([]);
    openMenuAt(e.clientX, e.clientY, [], rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), "Board actions");
  }, [select, openMenuAt, rf]);

  // Organize animates: every node that moved glides from where it was (250 ms, none under prefers-reduced-motion).
  const animRaf = useRef(0);
  useEffect(() => {
    const from = pendingAnim.current;
    if (!from) return;
    pendingAnim.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const moves = new Map<string, { f: { x: number; y: number }; t: { x: number; y: number } }>();
    for (const [id, r] of derived.rects) {
      const f = from.get(id), n = data.nodes.get(id);
      if (!f || !n || n.frame_id || (Math.abs(f.x - r.x) < 1 && Math.abs(f.y - r.y) < 1)) continue;
      if ((n.kind === "mind" || n.kind === "ref") && rootOfFramed(data.nodes, id)) continue;
      moves.set(id, { f, t: { x: r.x, y: r.y } });
    }
    if (!moves.size) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 250), e = 1 - Math.pow(1 - k, 3);
      setLive((cur) => {
        const next = new Map(cur);
        for (const [id, m] of moves) { if (k >= 1) next.delete(id); else next.set(id, { ...next.get(id), x: m.f.x + (m.t.x - m.f.x) * e, y: m.f.y + (m.t.y - m.f.y) * e }); }
        return next;
      });
      if (k < 1) animRaf.current = requestAnimationFrame(step);
    };
    animRaf.current = requestAnimationFrame(step);
  }, [derived, data.nodes]);
  useEffect(() => () => cancelAnimationFrame(animRaf.current), []);

  if (b.error && !b.board) return <div className="grid h-full place-items-center p-6 text-small text-[var(--muted-foreground)]" role="alert">{b.error}</div>;
  if (!b.board) return <div className="grid h-full place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" /></div>;
  const board = b.board;
  if (isLife && plan.loading) return <div className="grid h-full place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" /></div>;
  if (isLife && (!plan.owner || !plan.quarter)) return <div className="grid h-full place-items-center p-6 text-center text-small text-[var(--muted-foreground)]" role="status"><p>{plan.owner ? (plan.quarterError ?? "The Life board is built from this quarter's plan, which is not available yet.") : "The Life board is built from your Plan, which only the owner can read."}</p></div>;
  const cardOpen = !!cardModel;
  const panTool = tool === "hand";
  const boxSelect = !coarse && tool === "select";
  const selectedStickies = [...selected].map((id) => data.nodes.get(id)).filter((n): n is BoardNode => !!n);
  const allStickies = selectedStickies.length > 1 && selectedStickies.length === selected.size && selectedStickies.every((n) => n.kind === "sticky");

  return (
    <MapCtx.Provider value={actions}>
      <div className="niyyah-map" tabIndex={-1} data-tool={tool} data-card={cardOpen ? "1" : undefined} data-testid="map-canvas" data-board={board.id}
        onDragOver={(e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropping(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
        onDrop={(e) => { setDropping(false); const files = [...(e.dataTransfer?.files ?? [])]; if (!files.length) return; e.preventDefault(); void ingest(files, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })); }}>
        <input ref={picker} type="file" hidden data-testid="upload-input" aria-hidden="true" tabIndex={-1}
          onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; const c = pickCtx.current; if (files.length) void ingest(files, c.at, { replaceId: c.replaceId, attachTo: c.attachTo }); }} />
        {dropping && <div className="nm-drop" aria-hidden="true">Drop to add to the board</div>}
        <ReactFlow
          nodes={derived.nodes} edges={derived.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onPaneClick={onPaneClick} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick}
          onNodeDrag={onNodeDrag} onNodeDragStop={onNodeDragStop}
          onMoveEnd={(_, vp) => b.saveViewport({ x: Math.round(vp.x), y: Math.round(vp.y), zoom: +vp.zoom.toFixed(3) })}
          defaultViewport={board.viewport ?? undefined}
          minZoom={0.1} maxZoom={4}
          panOnDrag={boxSelect ? [1, 2] : true} panOnScroll zoomOnScroll={false} zoomOnDoubleClick={false} zoomActivationKeyCode={["Control", "Meta"]} panActivationKeyCode="Space"
          selectionOnDrag={boxSelect} selectionMode={SelectionMode.Partial} onPaneContextMenu={onPaneContextMenu} onNodeContextMenu={onNodeContextMenu} onSelectionContextMenu={onSelectionContextMenu} onEdgeContextMenu={onEdgeContextMenu}
          selectionKeyCode="Shift" multiSelectionKeyCode={["Shift", "Control", "Meta"]} deleteKeyCode={null} disableKeyboardA11y
          connectionMode={ConnectionMode.Loose} onConnectStart={() => setConnecting(true)} onConnectEnd={() => setConnecting(false)}
          nodesDraggable={!panTool} elementsSelectable={!panTool} nodesConnectable={tool === "select"} nodeDragThreshold={4}
          connectionRadius={24}
          attributionPosition="bottom-left"
        >
          {guides && (
            <ViewportPortal>
              <svg className="nm-guides" style={{ left: -100000, top: -100000, width: 200000, height: 200000 }} aria-hidden="true" data-testid="guides">
                {guides.vx.map((x) => <line key={`v${x}`} x1={x + 100000} x2={x + 100000} y1={0} y2={200000} />)}
                {guides.hy.map((y) => <line key={`h${y}`} y1={y + 100000} y2={y + 100000} x1={0} x2={200000} />)}
              </svg>
            </ViewportPortal>
          )}
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color="var(--rule)" />
          {minimap && (
            <MiniMap pannable zoomable ariaLabel="Minimap: drag to move the view" maskStrokeWidth={2}
              nodeColor={(n) => {
                const dd = n.data as { kind?: string; color?: string } | undefined;
                if (n.type === "mind") return dd?.color ?? "var(--foreground)";
                if (n.type === "sticky") return `var(--map-sticky-${dd?.color ?? "yellow"})`;
                return n.type === "frame" ? "var(--muted)" : "var(--rule)";
              }} nodeStrokeWidth={0} />
          )}
        </ReactFlow>

        {selected.size > 1 && <MultiBar count={selected.size} stickies={allStickies} onColor={colorSelection} onDelete={deleteSelection} />}
        <BoardBar board={board} boards={boards} frames={frames} hidden={hidden} status={b.status}
          onOpen={onOpen} onNew={onNew} onDelete={() => onDelete(board.id)}
          onRename={(t) => { void b.rename(t).then(() => onRetitle(board.id, t)).catch(() => notify("Could not rename the board")); }}
          onOrganize={(l) => organize(mapsOf(data, idx, selected), l)} onZoomFrame={zoomFrame} onUnhide={unhide} onRetry={b.retry} showDone={isLife ? showDone : null} onShowDone={setShowDone} onFiles={() => setFilesOpen((v) => !v)} filesOpen={filesOpen} />
        <ToolRail onImage={() => pickFiles({ imageOnly: true })} tool={tool} onTool={chooseTool} canUndo={b.canUndo} canRedo={b.canRedo} onUndo={b.undo} onRedo={b.redo} />
        <ZoomBar minimap={minimap} onMinimap={() => setMinimap(!minimap)} cardOpen={cardOpen} onFit={fit} />
        <div className="nm-help">Tab child · Enter sibling · F2 edit · Del remove · drag empty space to select · space+drag or two fingers to pan · drop on a node to reparent</div>
        {cardModel && (
          <SideCard model={cardModel} onText={cardText} onNotes={cardNotes} onLabel={cardLabel}
            onColor={(id, c) => { const n = data.nodes.get(id); if (n) L.current.b.commit([A.setColor(n, c)]); }}
            onChild={(id) => createMind("child", id)} onConnect={(id) => { setTool("link"); setLinkFrom(id); }}
            onDelete={deleteSelection} onClose={() => select([])}
            onLane={(id, lane) => void liveLane(id, lane)} onMake={(id, stream, lane, product) => void makeItem(id, stream, lane, product)} onOpenPlan={() => router.push("/plan")} />
        )}
        {menu && <ContextMenu key={`${menu.x}:${menu.y}:${menu.ids.join(",")}`} x={menu.x} y={menu.y} label={menu.label} groups={menu.groups} onClose={() => setMenu(null)} onRun={(id, choice) => { runCommand(env, selFor(menu.ids, menu.pos), id, choice); }} />}
        {search && <SearchBar q={search.q} count={matches.length} at={Math.min(search.at, Math.max(0, matches.length - 1))}
          onQuery={(q) => setSearch({ q, at: 0 })}
          onStep={(dlt) => { if (!matches.length) return; const at = (search.at + dlt + matches.length) % matches.length; setSearch({ q: search.q, at }); jump(at, matches); }}
          onClose={() => setSearch(null)} />}
        {help && <HelpSheet onClose={() => setHelp(false)} />}
        {filesOpen && <FilesPanel onClose={() => setFilesOpen(false)} onGone={(id) => forgetFile(id)} notify={notify} />}
        {prompt && <PromptDialog title={prompt.title} initial={prompt.initial} onDone={(v) => { prompt.resolve(v); setPrompt(null); }} />}
        {(b.status === "retrying" || b.status === "offline") && (
          <div className="nm-banner" role="alert">
            <span>{b.status === "offline" ? "Offline. Changes are kept on this device and will save when the connection returns." : "Not saved. Retrying."}</span>
            <button type="button" onClick={b.retry}>Retry</button>
          </div>
        )}
        {toast && (
          <div className="nm-toast" role="status" data-testid="toast">
            <span>{toast.message}</span>
            {toast.undo && <button type="button" onClick={() => { b.undo(); setToast(null); }}>Undo</button>}
          </div>
        )}
      </div>
    </MapCtx.Provider>
  );
}

export type { BoardNode };
