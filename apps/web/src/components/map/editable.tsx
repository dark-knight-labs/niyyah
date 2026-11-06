"use client";

import { useEffect, useRef } from "react";
import { useMapActions, type EditHow } from "./map-context";

/**
 * Plain-text inline editor. Uncontrolled while editing (so the caret never jumps); the node resizes with its content and
 * React Flow re-measures it, which re-runs the layout live. Enter/Tab/Esc/blur finish; `multiline` lets Enter insert a newline.
 */
export function EditableText({ id, text, editing, multiline, className, placeholder }: {
  id: string; text: string; editing: boolean; multiline?: boolean; className?: string; placeholder?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { finishEdit } = useMapActions();
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    done.current = false;
    el.textContent = text;
    // A node React Flow has not measured yet is visibility:hidden and cannot take focus: retry for a few frames.
    let tries = 0;
    let raf = 0;
    const grab = () => {
      el.focus();
      if (document.activeElement !== el && tries++ < 40) { raf = requestAnimationFrame(grab); return; }
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    grab();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the moment editing starts matters
  }, [editing]);

  const finish = (how: EditHow) => {
    if (done.current) return;
    done.current = true;
    const el = ref.current;
    finishEdit(id, (el?.innerText ?? "").replace(/​/g, "").replace(/\n$/, ""), how);
  };

  // Two different elements: React owns the text of the view span; the edit span is filled by hand and thrown away when editing ends,
  // so the browser's own edits to its text node never meet React's bookkeeping.
  if (!editing) return <span className={`nm-t ${className ?? ""}`}>{text || "\u200b"}</span>;
  return (
    <span
      key="edit"
      ref={ref}
      className={`nm-t nodrag nopan nowheel ${className ?? ""}`}
      contentEditable="plaintext-only"
      data-placeholder={placeholder}
      suppressContentEditableWarning
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); finish("esc"); }
        else if (e.key === "Tab" && !multiline) { e.preventDefault(); finish("tab"); }
        else if (e.key === "Enter" && !e.shiftKey && !multiline) { e.preventDefault(); finish("enter"); }
      }}
      onBlur={() => finish("blur")}
    />
  );
}
