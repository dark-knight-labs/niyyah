"use client";

import { memo, useEffect, useState } from "react";
import { Handle, NodeResizer, NodeResizeControl, NodeToolbar, Position, useNodeId, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { shapeOf } from "@/lib/map/shapes";
import { downloadFile, extOf, fileUrl, humanSize } from "@/lib/map/files";
import { EditableText } from "../editable";
import { useMapActions } from "../map-context";
import type { ItemData, MapNode } from "../derive";
import { ContextBar } from "../context-bar";

/** Four side ports, shown while the object is selected or a connector is being dragged (so a 1,000-object board carries none at rest). */
export function Ports({ show }: { show?: boolean }) {
  return show ? <PortHandles /> : null;
}
function PortHandles() {
  const id = useNodeId();
  const update = useUpdateNodeInternals();
  // React Flow measures a node's handles when it measures the node: ports that appear later must be announced
  useEffect(() => { if (id) update(id); }, [id, update]);
  return (
    <>
      <Handle id="p-t" type="source" position={Position.Top} className="nm-port" />
      <Handle id="p-r" type="source" position={Position.Right} className="nm-port" />
      <Handle id="p-b" type="source" position={Position.Bottom} className="nm-port" />
      <Handle id="p-l" type="source" position={Position.Left} className="nm-port" />
    </>
  );
}

const styleCls = (d: ItemData) => `${d.size && d.size !== "M" ? `size-${d.size}` : ""} ${d.bold ? "bold" : ""} ${d.align ? `al-${d.align}` : ""} ${d.locked ? "locked" : ""}`;

function Handles() {
  return (
    <>
      <Handle id="cs" type="source" position={Position.Right} className="nm-conn" />
      <Handle id="ct" type="target" position={Position.Left} className="nm-hh nm-ch" isConnectable={false} />
    </>
  );
}

function Resizer({ id, selected, minWidth, minHeight, locked }: { id: string; selected: boolean; minWidth: number; minHeight: number; locked?: boolean }) {
  const { resizeEnd } = useMapActions();
  return <NodeResizer isVisible={selected && !locked} minWidth={minWidth} minHeight={minHeight} onResizeEnd={(_, p) => resizeEnd(id, p)} handleStyle={{ width: 9, height: 9 }} />;
}

export const StickyNode = memo(function StickyNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as ItemData;
  return (
    <div className={`nm-item nm-sticky ${d.color} ${styleCls(d)} ${d.dim ? "nm-dim" : ""} ${selected ? "sel-ring" : ""} ${d.editing ? "editing" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} data-testid={`sticky-${id}`}>
      <Resizer id={id} selected={selected} minWidth={90} minHeight={70} locked={d.locked} />
      <Handles /><Ports show={d.ports} />
      <div className="nm-sticky-in"><EditableText id={id} text={d.text} editing={d.editing} multiline /></div>
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});

export const TextNode = memo(function TextNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as ItemData;
  return (
    <div className={`nm-item nm-text ${styleCls(d)} ${d.dim ? "nm-dim" : ""} ${selected ? "sel-ring" : ""} ${d.editing ? "editing" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} style={{ height: "auto" }} data-testid={`text-${id}`}>
      <Resizer id={id} selected={selected} minWidth={60} minHeight={20} locked={d.locked} />
      <Handles /><Ports show={d.ports} />
      <EditableText id={id} text={d.text} editing={d.editing} multiline />
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});

const fillVar = (c: string | undefined) => (!c ? "var(--surface)" : c === "none" ? "transparent" : `var(--map-sticky-${c}, var(--surface))`);   // an unknown key (old row, import, a mind colour such as "sky") falls back to paper, never to black
const strokeVar = (k: string | undefined) => (!k || k === "ink" ? "var(--foreground)" : `var(--stream-${k}, var(--foreground))`);
const DASH_ARR: Record<string, string> = { solid: "none", dashed: "7 5", dotted: "1.5 4" };

/** One of 12 shapes: rectangle, rounded and ellipse are bordered boxes; the rest are SVG paths stretched to the object. */
export const ShapeNode = memo(function ShapeNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as ItemData;
  const sh = shapeOf(d.shape);
  const vars = { "--sf": fillVar(d.fillc), "--sb": strokeVar(d.border), "--sw": `${d.bw ?? 1}px`, "--sd": d.dash ?? "solid", "--sda": DASH_ARR[d.dash ?? "solid"] } as React.CSSProperties;
  return (
    <div className={`nm-item nm-shape sh-${sh.id} ${sh.css ? "css-box" : ""} ${styleCls(d)} ${d.dim ? "nm-dim" : ""} ${selected ? "sel-ring" : ""} ${d.editing ? "editing" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} style={vars} data-testid={`shape-${id}`} data-shape={sh.id}>
      <Resizer id={id} selected={selected} minWidth={60} minHeight={40} locked={d.locked} />
      <Handles /><Ports show={d.ports} />
      {!sh.css && (
        <svg className="nm-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={sh.path} />{sh.extra && <path d={sh.extra} className="nm-shape-lip" />}
        </svg>
      )}
      <div className="nm-st" style={sh.inset ? { inset: sh.inset } : undefined}><EditableText id={id} text={d.text} editing={d.editing} multiline /></div>
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});

/** The card shown when the bytes cannot be had (deleted, another account, an older server): the node keeps its place and file id. */
function Missing({ id, d, selected }: { id: string; d: ItemData; selected: boolean }) {
  return (
    <div className={`nm-item nm-unavailable ${selected ? "sel-ring" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} data-testid={`unavailable-${id}`}>
      <Handles /><Ports show={d.ports} />
      <span className="mono nm-ut">File unavailable</span>
      {d.text && <span className="nm-un">{d.text}</span>}
      <NodeToolbar isVisible={selected && d.bar} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
}

/** The bytes of a file as an object URL (fetched with the bearer token, cached per id). */
function useFileUrl(fileId: string | undefined): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ id?: string; url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    let live = true;
    if (!fileId) return;
    fileUrl(fileId).then((u) => { if (live) setState({ id: fileId, url: u, failed: false }); }).catch(() => { if (live) setState({ id: fileId, url: null, failed: true }); });
    return () => { live = false; };
  }, [fileId]);
  if (!fileId) return { url: null, failed: true };
  return state.id === fileId ? state : { url: null, failed: false };
}

export const ImageNode = memo(function ImageNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as ItemData;
  const { url, failed } = useFileUrl(d.fileId);
  const { resizeEnd } = useMapActions();
  if (failed) return <Missing id={id} d={d} selected={selected} />;
  return (
    <div className={`nm-item nm-image ${styleCls(d)} ${d.dim ? "nm-dim" : ""} ${selected ? "sel-ring" : ""} ${d.editing ? "editing" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} data-testid={`image-${id}`} data-loaded={url ? "1" : "0"}>
      <NodeResizer isVisible={selected && !d.locked} minWidth={48} minHeight={48} keepAspectRatio onResizeEnd={(_, p) => resizeEnd(id, p)} handleStyle={{ width: 9, height: 9 }} />
      <Handles /><Ports show={d.ports} />
      {url ? (
        // an object URL of bytes fetched with the bearer token: next/image cannot optimise it
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={d.text || "Image"} draggable={false} />
      ) : <div className="nm-img-wait" aria-hidden="true" />}
      {(d.text || d.editing) && <div className="nm-cap"><EditableText id={id} text={d.text} editing={d.editing} multiline placeholder="Caption" /></div>}
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});

export const FileNode = memo(function FileNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as ItemData;
  const name = d.text || "file";
  return (
    <div className={`nm-item nm-file ${styleCls(d)} ${d.dim ? "nm-dim" : ""} ${selected ? "sel-ring" : ""} ${d.editing ? "editing" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} data-testid={`file-${id}`}>
      <Resizer id={id} selected={selected} minWidth={150} minHeight={48} locked={d.locked} />
      <Handles /><Ports show={d.ports} />
      <span className="nm-ext mono" aria-hidden="true">{extOf(name)}</span>
      <div className="nm-fi"><div className="nm-fn"><EditableText id={id} text={name} editing={d.editing} /></div>{d.bytes ? <div className="nm-fs mono">{humanSize(d.bytes)}</div> : null}</div>
      <button type="button" className="nm-dl nodrag nopan" aria-label={`Download ${name}`} title="Download" data-testid={`download-${id}`}
        onClick={(e) => { e.stopPropagation(); if (d.fileId) void downloadFile(d.fileId, name).catch(() => undefined); }} onPointerDown={(e) => e.stopPropagation()}>↓</button>
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});

/** A kind written by a later release: shown, never touched. */
export const UnknownNode = memo(function UnknownNode({ id }: NodeProps<MapNode>) {
  return <div className="nm-item nm-unavailable nm-unknown" data-testid={`unknown-${id}`}><span className="mono nm-ut">Unsupported object</span></div>;
});

export const FrameNode = memo(function FrameNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as ItemData;
  const { resizeEnd } = useMapActions();
  return (
    <div className={`nm-item nm-frame ${selected ? "sel-ring" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} data-testid={`frame-${id}`}>
      {/* Bottom-right only: resizing from the top or left would have to move every item inside. */}
      <NodeResizeControl position="bottom-right" minWidth={120} minHeight={80} onResizeEnd={(_, p) => resizeEnd(id, p)} style={{ background: "transparent", border: "none" }}>
        <span style={{ display: selected ? "block" : "none", width: 9, height: 9, background: "var(--surface)", border: "1.5px solid var(--accent)", transform: "translate(-50%, -50%)" }} />
      </NodeResizeControl>
      <Handles /><Ports show={d.ports} />
      <span className="nm-ft"><EditableText id={id} text={d.text || "Frame"} editing={d.editing} /></span>
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={26}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});
