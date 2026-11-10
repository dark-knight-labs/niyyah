"use client";

import { createPortal } from "react-dom";
import { PAGE_SLOT_MIN_PX, usePageSlot } from "@/hooks/use-header-slot";

/** Renders its children into the app header's page slot from md up; on phones (or before the header exists) they stay where this is placed. */
export function PageSlot({ children }: { children: React.ReactNode }) {
  const slot = usePageSlot(PAGE_SLOT_MIN_PX);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
