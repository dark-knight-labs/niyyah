"use client";

import { memo } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { EditableText } from "../editable";
import { useMapActions } from "../map-context";
import type { MapNode, MindData } from "../derive";
import { ContextBar } from "../context-bar";


export const MindNode = memo(function MindNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as MindData;
  const { toggleFold } = useMapActions();
  const cls = d.depth === 0 ? "d0" : d.depth === 1 ? "d1" : "dn";
  const style = { "--c": d.color } as React.CSSProperties;
  const v = d.orient === "v";
  const foldSide = v ? (d.dir < 0 ? { top: -26 } : { bottom: -26 }) : d.dir < 0 ? { left: -26 } : { right: -26 };
  const foldPos = v ? { left: "calc(50% - 9px)" } : { top: "calc(50% - 9px)" };
  return (
    <div className={`nm-mind ${cls} fill-${d.fill} shape-${d.shape} size-${d.size} ${d.bold ? "bold" : ""} ${d.locked ? "locked" : ""} ${d.own ? "own" : ""} ${d.dim ? "nm-dim" : ""} ${d.refKey ? "ref" : ""} ${d.done ? "done" : ""} ${d.gone ? "gone" : ""} ${d.flash ? "nm-flash" : ""} ${selected ? "sel-ring" : ""} ${d.drop ? "drop" : ""} ${d.editing ? "editing" : ""}`} style={style} data-testid={`mind-${id}`} data-parent={d.parent || undefined}>
      <Handle id="tl" type="target" position={Position.Left} className="nm-hh" isConnectable={false} />
      <Handle id="tr" type="target" position={Position.Right} className="nm-hh" isConnectable={false} />
      <Handle id="sl" type="source" position={Position.Left} className="nm-hh" isConnectable={false} />
      <Handle id="sr" type="source" position={Position.Right} className="nm-hh" isConnectable={false} />
      <Handle id="tt" type="target" position={Position.Top} className="nm-hh" isConnectable={false} />
      <Handle id="tb" type="target" position={Position.Bottom} className="nm-hh" isConnectable={false} />
      <Handle id="st" type="source" position={Position.Top} className="nm-hh" isConnectable={false} />
      <Handle id="sb" type="source" position={Position.Bottom} className="nm-hh" isConnectable={false} />
      <Handle id="cs" type="source" position={Position.Right} className="nm-hh nm-ch" isConnectable={false} />
      <Handle id="ct" type="target" position={Position.Left} className="nm-hh nm-ch" isConnectable={false} />
      {d.sub && <span className="nm-sub mono">{d.sub}</span>}
      {d.depth === 0 && !d.text && !d.editing && !d.refKey && <span className="nm-tag">Central idea</span>}
      {d.icon && <span className="nm-ic" aria-hidden="true">{d.icon}</span>}
      <EditableText id={id} text={d.text} editing={d.editing} />
      {d.url && !d.editing && <a className="nm-url nodrag nopan" href={d.url} target="_blank" rel="noopener noreferrer" title={`${d.url} (Ctrl/Cmd-click)`} onClick={(e) => { if (!(e.ctrlKey || e.metaKey)) e.preventDefault(); e.stopPropagation(); }} onPointerDown={(e) => e.stopPropagation()}>↗</a>}
      {d.hasNotes && !d.editing && <span className="nm-note" title="Has a note" />}
      {d.tag && !d.editing && <span className={`nm-tag ${d.tagNow ? "now" : ""} ${d.gone ? "warn" : ""}`}>{d.tag}</span>}
      {d.hasChildren && d.depth > 0 && (
        <button type="button" className={`nm-fold nodrag nopan ${d.collapsed ? "shut" : ""}`} style={{ ...foldPos, ...foldSide }}
          title={d.collapsed ? "Expand (Ctrl+.)" : "Collapse (Ctrl+.)"} aria-label={d.collapsed ? "Expand branch" : "Collapse branch"}
          onClick={(e) => { e.stopPropagation(); toggleFold(id); }} onPointerDown={(e) => e.stopPropagation()}>
          {d.collapsed ? d.hiddenCount : "−"}
        </button>
      )}
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});
