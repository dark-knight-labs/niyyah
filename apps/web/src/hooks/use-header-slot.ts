"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Width from which the Overview's calendar bar sits in the app header instead of above the calendar. */
export const HEADER_BAR_MIN_PX = 1280;
/** Width from which a page's compact controls (see PageSlot) sit in the header: the desktop nav is shown from here. */
export const PAGE_SLOT_MIN_PX = 768;

/** The header's #page-slot while the window is at least `minPx` wide; null below that and on the server. */
export function usePageSlot(minPx: number): HTMLElement | null {
  const query = `(min-width: ${minPx}px)`;
  const subscribe = useCallback((onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => (window.matchMedia(query).matches ? document.getElementById("page-slot") : null), () => null);
}

/** The slot for the Overview's calendar bar (wide screens only). */
export function useHeaderSlot(): HTMLElement | null {
  return usePageSlot(HEADER_BAR_MIN_PX);
}
