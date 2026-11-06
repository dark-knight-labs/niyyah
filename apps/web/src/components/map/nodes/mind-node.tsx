"use client";

import { memo } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { EditableText } from "../editable";
import { useMapActions } from "../map-context";
import type { MapNode, MindData } from "../derive";
import { ContextBar } from "../context-bar";

/** Handles sit where the branch edges attach: the middle of a boxed node's side, the underline of a deeper one. */
function anchor(boxed: boolean) {
  return boxed ? { top: "50%" } : { top: "100%" };
}

export const MindNode = memo(function MindNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as MindData;
  const { toggleFold } = useMapActions();
  const boxed = d.depth <= 1;
  const cls = d.depth === 0 ? "d0" : d.depth === 1 ? "d1" : "dn";
  const style = { "--c": d.color } as React.CSSProperties;
  const foldSide = d.dir < 0 ? { left: -26 } : { right: -26 };
  return (
    <div className={`nm-mind ${cls} ${d.refKey ? "ref" : ""} ${d.done ? "done" : ""} ${d.gone ? "gone" : ""} ${d.flash ? "nm-flash" : ""} ${selected ? "sel-ring" : ""} ${d.drop ? "drop" : ""} ${d.editing ? "editing" : ""}`} style={style} data-testid={`mind-${id}`} data-parent={d.parent || undefined}>
      <Handle id="tl" type="target" position={Position.Left} className="nm-hh" style={anchor(boxed)} isConnectable={false} />
      <Handle id="tr" type="target" position={Position.Right} className="nm-hh" style={anchor(boxed)} isConnectable={false} />
      <Handle id="sl" type="source" position={Position.Left} className="nm-hh" style={anchor(boxed)} isConnectable={false} />
      <Handle id="sr" type="source" position={Position.Right} className="nm-hh" style={anchor(boxed)} isConnectable={false} />
      <Handle id="cs" type="source" position={Position.Right} className="nm-hh nm-ch" isConnectable={false} />
      <Handle id="ct" type="target" position={Position.Left} className="nm-hh nm-ch" isConnectable={false} />
      {d.sub && <span className="nm-sub mono">{d.sub}</span>}
      {d.depth === 0 && !d.text && !d.editing && !d.refKey && <span className="nm-tag">Central idea</span>}
      <EditableText id={id} text={d.text} editing={d.editing} />
      {d.tag && !d.editing && <span className={`nm-tag ${d.tagNow ? "now" : ""} ${d.gone ? "warn" : ""}`}>{d.tag}</span>}
      {d.hasChildren && d.depth > 0 && (
        <button type="button" className={`nm-fold nodrag nopan ${d.collapsed ? "shut" : ""}`} style={{ top: boxed ? "calc(50% - 9px)" : "calc(100% - 9px)", ...foldSide }}
          title={d.collapsed ? "Expand (Ctrl+.)" : "Collapse (Ctrl+.)"} aria-label={d.collapsed ? "Expand branch" : "Collapse branch"}
          onClick={(e) => { e.stopPropagation(); toggleFold(id); }} onPointerDown={(e) => e.stopPropagation()}>
          {d.collapsed ? d.hiddenCount : "−"}
        </button>
      )}
      <NodeToolbar isVisible={selected && d.bar && !d.editing} position={Position.Top} offset={14}><ContextBar id={id} /></NodeToolbar>
    </div>
  );
});
