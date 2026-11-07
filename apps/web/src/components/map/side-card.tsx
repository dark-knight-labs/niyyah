"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveInfo } from "@/lib/map/life-tree";
import { STICKY_COLORS, type StickyColor } from "@/lib/map/types";
import type { Lane } from "@/lib/vault-types";

export type CardModel =
  | { type: "mind"; id: string; text: string; notes: string; below: number; depth: number; readOnly: boolean; make: MakeModel | null }
  | { type: "live"; id: string; text: string; below: number; depth: number; info: LiveInfo; head: string; stream: string | null; checkpoint: string | null; editable: boolean; hideable: boolean; compass: { mission: string; vision: string; week: string } | null }
  | { type: "item"; id: string; kind: "sticky" | "text" | "shape" | "frame" | "image" | "file"; text: string; color: StickyColor }
  | { type: "edge"; id: string; label: string }
  | { type: "many"; count: number };

export interface MakeModel {
  streams: { id: string; label: string }[];
  /** The nearest block above the thought, if any. */
  stream: string | null;
  checkpoint: string | null;
  /** Lane and product (tag) of the lane or product node it hangs under, if any. */
  lane: "now" | "next" | "backlog" | null;
  product: string | null;
  /** The product it hangs under has a tag the API refuses (spaces, non-ASCII, too long): none is offered. */
  productBlocked: boolean;
  /** The tags in use per block, offered by the Product select. */
  productsOf: Record<string, string[]>;
}

const LANES: { id: Lane; label: string }[] = [{ id: "now", label: "Now" }, { id: "next", label: "Next" }, { id: "backlog", label: "Someday" }, { id: "done", label: "Done" }];

const HEAD = { sticky: "Sticky note", text: "Text", shape: "Shape", frame: "Frame", image: "Image", file: "File" } as const;

/** Right-hand details card (330 px; a bottom sheet under 760 px). Edits are debounced so a burst of typing is one undo step. */
export function SideCard({ model, onText, onNotes, onLabel, onColor, onChild, onConnect, onDelete, onClose, onLane, onMake, onOpenPlan }: {
  model: CardModel; onLane: (id: string, lane: Lane) => void; onMake: (id: string, stream: string, lane: "now" | "next" | "backlog", product: string | null) => void; onOpenPlan: () => void; onText: (id: string, text: string) => void; onNotes: (id: string, notes: string) => void; onLabel: (id: string, label: string) => void; onColor: (id: string, c: StickyColor) => void;
  onChild: (id: string) => void; onConnect: (id: string) => void; onDelete: () => void; onClose: () => void;
}) {
  const head = model.type === "live" ? model.head : model.type === "mind" ? (model.depth === 0 ? "Central idea" : "Thought") : model.type === "item" ? HEAD[model.kind] : model.type === "edge" ? "Connector" : `${model.count} selected`;
  return (
    <aside className="nm-ui nm-card" aria-label="Details" data-testid="side-card">
      <div className="ch mono"><span>{head}</span><button type="button" aria-label="Close details" onClick={onClose}>✕</button></div>
      <div className="cb">
        {(model.type === "mind" || model.type === "item" || model.type === "live") && <TextField key={`t-${model.id}`} id={model.id} text={model.text} readOnly={(model.type === "mind" && model.readOnly) || (model.type === "live" && !model.editable)} lazy={model.type === "live"} label={model.type === "item" && model.kind !== "frame" ? "Text" : "Title"} onText={onText} />}
        {model.type === "live" && <LiveBody model={model} onLane={onLane} onOpenPlan={onOpenPlan} onHide={onDelete} />}
        {model.type === "mind" && model.make && <MakeItem key={`m-${model.id}`} id={model.id} make={model.make} onMake={onMake} />}
        {model.type === "mind" && !model.readOnly && <NotesField key={`n-${model.id}`} id={model.id} notes={model.notes} onNotes={onNotes} />}
        {model.type === "edge" && <LabelField key={`l-${model.id}`} id={model.id} label={model.label} onLabel={onLabel} />}
        {model.type === "item" && model.kind === "sticky" && (
          <div>
            <div className="lbl mono">Colour</div>
            <div className="chips">{STICKY_COLORS.map((c) => <button key={c} type="button" className={`chip ${c}`} aria-pressed={model.color === c} onClick={() => onColor(model.id, c)}>{c}</button>)}</div>
          </div>
        )}
        {model.type === "item" && model.kind === "frame" && <p className="note">Moving a frame moves what sits inside it. Frames are listed under Frames, top left.</p>}
        {model.type !== "live" && <div className="row">
          {model.type === "mind" && <button type="button" className="btn" onClick={() => onChild(model.id)}>Add child</button>}
          {model.type === "item" && <button type="button" className="btn" onClick={() => onConnect(model.id)}>Connect to…</button>}
          {model.type === "mind" && model.depth > 0 && <button type="button" className="btn" onClick={() => onConnect(model.id)}>Connect to…</button>}
          <button type="button" className="btn" onClick={onDelete}>{model.type === "mind" && model.depth === 0 ? "Delete map" : "Delete"}</button>
        </div>}
        {(model.type === "mind" || model.type === "live") && <p className="note mono" style={{ margin: 0 }}>{model.below} below · depth {model.depth}</p>}
      </div>
    </aside>
  );
}

function useDebounced(fn: (v: string) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  const pending = useRef<string | null>(null);
  const flush = () => { clearTimeout(timer.current); if (pending.current !== null) { latest.current(pending.current); pending.current = null; } };
  const call = (v: string) => { pending.current = v; clearTimeout(timer.current); timer.current = setTimeout(flush, ms); };
  useEffect(() => () => flush(), []);
  return { call, flush };
}

function TextField({ id, text, readOnly, lazy, label, onText }: { id: string; text: string; readOnly: boolean; lazy?: boolean; label: string; onText: (id: string, t: string) => void }) {
  const [v, setV] = useState(text);
  const [seen, setSeen] = useState(text);
  const [focused, setFocused] = useState(false);
  // The node's text changed elsewhere (inline edit, undo): follow it unless the owner is typing here.
  if (text !== seen) { setSeen(text); if (!focused) setV(text); }
  const d = useDebounced((t) => onText(id, t), 500);
  const pending = useRef<string | null>(null);   // a live node writes to Plan, so it saves on blur only
  return (
    <textarea className="ttl" rows={3} aria-label={label} value={v} readOnly={readOnly} maxLength={4000} data-testid="card-title"
      onFocus={() => setFocused(true)}
      onChange={(e) => { setV(e.target.value); if (lazy) pending.current = e.target.value; else d.call(e.target.value); }} onBlur={() => { setFocused(false); if (lazy) { if (pending.current !== null && pending.current !== text) onText(id, pending.current); pending.current = null; } else d.flush(); }} onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); e.stopPropagation(); }} />
  );
}

function NotesField({ id, notes, onNotes }: { id: string; notes: string; onNotes: (id: string, t: string) => void }) {
  const [v, setV] = useState(notes);
  const d = useDebounced((t) => onNotes(id, t), 500);
  return (
    <div>
      <div className="lbl mono">Notes</div>
      <textarea className="ttl" style={{ fontSize: "0.8125rem", fontFamily: "inherit", minHeight: 80 }} rows={4} value={v} maxLength={10000} aria-label="Notes" data-testid="card-notes"
        placeholder="Anything worth keeping next to this thought"
        onChange={(e) => { setV(e.target.value); d.call(e.target.value); }} onBlur={d.flush} onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); e.stopPropagation(); }} />
    </div>
  );
}

function LabelField({ id, label, onLabel }: { id: string; label: string; onLabel: (id: string, t: string) => void }) {
  const [v, setV] = useState(label);
  const d = useDebounced((t) => onLabel(id, t), 500);
  return (
    <div>
      <div className="lbl mono">Label</div>
      <input className="ttl" style={{ fontSize: "0.875rem", fontFamily: "inherit" }} value={v} maxLength={120} aria-label="Connector label" placeholder="No label"
        onChange={(e) => { setV(e.target.value); d.call(e.target.value); }} onBlur={d.flush} onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); e.stopPropagation(); }} />
    </div>
  );
}

function LiveBody({ model, onLane, onOpenPlan, onHide }: { model: Extract<CardModel, { type: "live" }>; onLane: (id: string, l: Lane) => void; onOpenPlan: () => void; onHide: () => void }) {
  const { info } = model;
  return (
    <>
      {info.type === "quarter" && model.compass && (
        <div className="kv">
          <span className="lbl mono">Mission</span><span>{model.compass.mission || "Not set"}</span>
          <span className="lbl mono">Vision</span><span>{model.compass.vision || "Not set"}</span>
          <span className="lbl mono">Week</span><span>{model.compass.week}</span>
        </div>
      )}
      {info.type !== "quarter" && info.type !== "unplaced" && (
        <div className="kv">
          {model.info.product && info.type !== "product" && <><span className="lbl mono">Product</span><span>{model.info.product}</span></>}
          {model.stream && <><span className="lbl mono">Block</span><span>{model.stream}</span></>}
          {model.checkpoint && info.type !== "checkpoint" && <><span className="lbl mono">Checkpoint</span><span>{model.checkpoint}</span></>}
          {info.type === "week" && info.week && <><span className="lbl mono">Week</span><span>{info.week}</span></>}
          <span className="lbl mono">Source</span><span>Plan (edits here edit the real {info.type === "stream" ? "block" : "item"})</span>
        </div>
      )}
      {info.type === "task" && info.item && !info.gone && (
        <div>
          <div className="lbl mono">Lane</div>
          <div className="chips">{LANES.map((l) => <button key={l.id} type="button" className="chip" data-lane={l.id} aria-pressed={info.lane === l.id} onClick={() => onLane(model.id, l.id)}>{l.label}</button>)}</div>
        </div>
      )}
      {info.gone && <p className="note">This Plan item no longer exists. Its thoughts stay here; move or delete them.</p>}
      <div className="row">
        {!info.gone && info.type !== "unplaced" && <button type="button" className="btn" onClick={onOpenPlan}>Open in Plan</button>}
        {model.hideable && <button type="button" className="btn" onClick={onHide}>Hide from board</button>}
      </div>
      {model.hideable && <p className="note">Hide removes it from this board only. Delete the item from its card in Plan.</p>}
      {info.type === "product" && <p className="note">Products come from the first tag of each item. Thoughts here follow the tag name: rename the tag and they move to Unplaced.</p>}
      {info.type === "lane" && <p className="note">Lanes come from Plan. To move an item between lanes, use its card or Plan.</p>}
      {info.type === "quarter" && <p className="note">The tree around this node is built from Plan on every load. New items in Plan appear here without syncing.</p>}
    </>
  );
}

function MakeItem({ id, make, onMake }: { id: string; make: MakeModel; onMake: (id: string, stream: string, lane: "now" | "next" | "backlog", product: string | null) => void }) {
  const [stream, setStream] = useState(make.stream ?? make.streams[0]?.id ?? "");
  const [lane, setLane] = useState<"now" | "next" | "backlog">(make.lane ?? "next");
  const [product, setProduct] = useState(make.product ?? "");
  const tags = make.productsOf[stream] ?? [];
  const shown = product && !tags.some((t) => t.toLowerCase() === product.toLowerCase()) ? [...tags, product] : tags;   // a product with no item yet stays selectable
  if (!make.streams.length) return null;
  return (
    <div data-testid="make-item">
      <div className="lbl mono">Make it a Plan item</div>
      <select value={stream} onChange={(e) => setStream(e.target.value)} aria-label="Block" onKeyDown={(e) => e.stopPropagation()}>
        {make.streams.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Product" style={{ marginTop: 8 }} onKeyDown={(e) => e.stopPropagation()}>
        <option value="">Product: none</option>
        {shown.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {make.productBlocked && <p className="note" style={{ marginTop: 4 }} data-testid="product-note">This product&apos;s tag can&apos;t be set from the map.</p>}
      <div className="chips" style={{ marginTop: 8 }}>
        {LANES.slice(0, 3).map((l) => <button key={l.id} type="button" className="chip" data-mklane={l.id} aria-pressed={lane === l.id} onClick={() => setLane(l.id as "now" | "next" | "backlog")}>{l.label}</button>)}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn pri" data-testid="make-item-go" onClick={() => onMake(id, stream, lane, product || null)}>Make item</button>
      </div>
      <p className="note" style={{ marginTop: 8 }}>{make.checkpoint ? `Checkpoint ${make.checkpoint} comes from the goal it sits under.` : "Block, product and lane come from where it hangs; change them here."}</p>
    </div>
  );
}
