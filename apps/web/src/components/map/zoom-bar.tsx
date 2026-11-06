"use client";

import { useReactFlow, useStore } from "@xyflow/react";

/** Bottom-right: minimap toggle, zoom out, percentage (click = 100%), zoom in, fit. Shifts left when the side card is open. */
export function ZoomBar({ minimap, onMinimap, cardOpen, onFit }: { minimap: boolean; onMinimap: () => void; cardOpen: boolean; onFit: () => void }) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const right = cardOpen ? 342 : 12;
  return (
    <>
      <div className="nm-ui nm-zoom" style={{ right }} role="toolbar" aria-label="Zoom">
        <button type="button" aria-pressed={minimap} title="Minimap" aria-label="Minimap" onClick={onMinimap}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3zM12 11h6v5h-6z" /></svg>
        </button>
        <button type="button" title="Zoom out (−)" aria-label="Zoom out" onClick={() => void rf.zoomOut({ duration: 120 })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
        <button type="button" className="pct" title="Reset to 100% (Ctrl+0)" aria-label="Zoom level, reset to 100%" onClick={() => void rf.zoomTo(1, { duration: 120 })}>{Math.round(zoom * 100)}%</button>
        <button type="button" title="Zoom in (+)" aria-label="Zoom in" onClick={() => void rf.zoomIn({ duration: 120 })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></button>
        <button type="button" title="Fit everything (Shift+1)" aria-label="Fit everything" onClick={onFit}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg></button>
      </div>
    </>
  );
}
