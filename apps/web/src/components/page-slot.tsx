"use client";

import { createPortal } from "react-dom";
import { PAGE_SLOT_MIN_PX, usePageSlot } from "@/hooks/use-header-slot";

/** Renders its children into the app header's page slot from `minPx` up (default md); on phones (or before the header exists) they stay where this is placed. */
export function PageSlot({ children, minPx = PAGE_SLOT_MIN_PX }: { children: React.ReactNode; minPx?: number }) {
  const slot = usePageSlot(minPx);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
