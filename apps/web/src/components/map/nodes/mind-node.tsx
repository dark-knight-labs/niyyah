"use client";

import { memo, useEffect, useRef } from "react";
import { Handle, NodeToolbar, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { EditableText } from "../editable";
import { useMapActions } from "../map-context";
import type { MapNode, MindData } from "../derive";
import { isHttpUrl } from "@/lib/map/url";
import { ContextBar } from "../context-bar";
import { Ports } from "./item-nodes";


const POS: Record<string, Position> = { tl: Position.Left, tr: Position.Right, tt: Position.Top, tb: Position.Bottom, sl: Position.Left, sr: Position.Right, st: Position.Top, sb: Position.Bottom };

export const MindNode = memo(function MindNode({ id, data, selected }: NodeProps<MapNode>) {
  const d = data as MindData;
  const { toggleFold } = useMapActions();
  const cls = d.depth === 0 ? "d0" : d.depth === 1 ? "d1" : "dn";
  const style = { "--c": d.color } as React.CSSProperties;
  const v = d.orient === "v";
  const update = useUpdateNodeInternals();
  const hsSeen = useRef(d.hs);
  // the handle set follows the layout: when it changes, React Flow must measure the new handles
  useEffect(() => { if (hsSeen.current !== d.hs) { hsSeen.current = d.hs; update(id); } }, [d.hs, id, update]);
  const [tgt, srcRaw] = d.hs.split("|");
  const srcs = srcRaw ? srcRaw.split(",") : [];
  const foldSide = v ? (d.dir < 0 ? { top: -26 } : { bottom: -26 }) : d.dir < 0 ? { left: -26 } : { right: -26 };
  const foldPos = v ? { left: "calc(50% - 9px)" } : { top: "calc(50% - 9px)" };
  return (
    <div className={`nm-mind ${cls} fill-${d.fill} shape-${d.shape} size-${d.size} ${d.bold ? "bold" : ""} ${d.locked ? "locked" : ""} ${d.own ? "own" : ""} ${d.dim ? "nm-dim" : ""} ${d.refKey ? "ref" : ""} ${d.done ? "done" : ""} ${d.gone ? "gone" : ""} ${d.flash ? "nm-flash" : ""} ${selected ? "sel-ring" : ""} ${d.drop ? "drop" : ""} ${d.editing ? "editing" : ""}`} style={style} data-testid={`mind-${id}`} data-parent={d.parent || undefined}>
      {tgt && <Handle id={tgt} type="target" position={POS[tgt]} className="nm-hh" isConnectable={false} />}
      {srcs.map((h) => <Handle key={h} id={h} type="source" position={POS[h]} className="nm-hh" isConnectable={false} />)}
      {d.depth === 0 && <Handle id="ct" type="target" position={Position.Left} className="nm-hh nm-ch" isConnectable={false} />}
      <Ports show={d.ports} />
      {d.sub && <span className="nm-sub mono">{d.sub}</span>}
      {d.depth === 0 && !d.text && !d.editing && !d.refKey && <span className="nm-tag">Central idea</span>}
      {d.icon && <span className="nm-ic" aria-hidden="true">{d.icon}</span>}
      <EditableText id={id} text={d.text} editing={d.editing} />
      {isHttpUrl(d.url) && !d.editing && <a className="nm-url nodrag nopan" href={d.url} target="_blank" rel="noopener noreferrer" title={`${d.url} (Ctrl/Cmd-click)`} onClick={(e) => { if (!(e.ctrlKey || e.metaKey)) e.preventDefault(); e.stopPropagation(); }} onPointerDown={(e) => e.stopPropagation()}>↗</a>}
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
