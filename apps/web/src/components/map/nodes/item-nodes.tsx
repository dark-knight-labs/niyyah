"use client";

import { memo } from "react";
import { Handle, NodeResizer, NodeResizeControl, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { EditableText } from "../editable";
import { useMapActions } from "../map-context";
import type { ItemData, MapNode } from "../derive";
import { ContextBar } from "../context-bar";

function Handles() {
  return (
    <>
      <Handle id="cs" type="source" position={Position.Right} className="nm-conn" />
      <Handle id="ct" type="target" position={Position.Left} className="nm-hh nm-ch" isConnectable={false} />
    </>
  );
}

function Resizer({ id, selected, minWidth, minHeight }: { id: string; selected: boolean; minWidth: number; minHeight: number }) {
  const { resizeEnd } = useMapActions();
  return <NodeResizer isVisible={selected} minWidth={minWidth} minHeight={minHeight} onResizeEnd={(_, p) => resizeEnd(id, p)} handleStyle={{ width: 9, height: 9 }} />;
}

export const StickyNode = memo(function StickyNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as ItemData;
  return (
    <div className={`nm-item nm-sticky ${d.dim ? "nm-dim" : ""} ${d.color} ${selected ? "sel-ring" : ""} ${d.editing ? "editing" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} data-testid={`sticky-${id}`}>
      <Resizer id={id} selected={selected} minWidth={90} minHeight={70} />
      <Handles />
      <EditableText id={id} text={d.text} editing={d.editing} multiline />
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});

export const TextNode = memo(function TextNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as ItemData;
  return (
    <div className={`nm-item nm-text ${d.dim ? "nm-dim" : ""} ${selected ? "sel-ring" : ""} ${d.editing ? "editing" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} style={{ height: "auto" }} data-testid={`text-${id}`}>
      <Resizer id={id} selected={selected} minWidth={60} minHeight={20} />
      <Handles />
      <EditableText id={id} text={d.text} editing={d.editing} multiline />
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});

export const ShapeNode = memo(function ShapeNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as ItemData;
  return (
    <div className={`nm-item nm-shape ${d.dim ? "nm-dim" : ""} ${selected ? "sel-ring" : ""} ${d.editing ? "editing" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} data-testid={`shape-${id}`}>
      <Resizer id={id} selected={selected} minWidth={60} minHeight={40} />
      <Handles />
      <EditableText id={id} text={d.text} editing={d.editing} multiline />
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});

/** An image or file row on a build that cannot show it yet: a movable placeholder. Position, size and style.file_id stay untouched. */
export const UnavailableNode = memo(function UnavailableNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as ItemData;
  return (
    <div className={`nm-item nm-unavailable ${selected ? "sel-ring" : ""} ${d.linkFrom ? "nm-linkfrom" : ""}`} data-testid={`unavailable-${id}`}>
      <Handles />
      <span className="mono nm-ut">File unavailable</span>
      {d.text && <span className="nm-un">{d.text}</span>}
      <NodeToolbar isVisible={selected && d.bar} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
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
      <Handles />
      <span className="nm-ft"><EditableText id={id} text={d.text || "Frame"} editing={d.editing} /></span>
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={26}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});
