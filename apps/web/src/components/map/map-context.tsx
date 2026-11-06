"use client";

import { createContext, useContext } from "react";

export type EditHow = "enter" | "tab" | "esc" | "blur";

/** What node components may ask of the canvas. Stable identity (the canvas keeps one object in a ref). */
export interface MapActions {
  /** The inline editor finished. `text` is the raw typed text. */
  finishEdit: (id: string, text: string, how: EditHow) => void;
  toggleFold: (id: string) => void;
  /** NodeResizer released: size and position in RF coordinates. */
  /** Buttons of the floating bar above a selected node, and what pressing one does. */
  barItems: (id: string) => BarItem[];
  runBar: (id: string, key: string, anchor?: DOMRect) => void;
  resizeEnd: (id: string, p: { x: number; y: number; width: number; height: number }) => void;
}

export interface BarItem {
  key: string;
  label: string;
  kbd?: string;
  /** Sticky colour swatch. */
  swatch?: string;
}

export const MapCtx = createContext<MapActions | null>(null);

export function useMapActions(): MapActions {
  const a = useContext(MapCtx);
  if (!a) throw new Error("MapCtx missing");
  return a;
}
