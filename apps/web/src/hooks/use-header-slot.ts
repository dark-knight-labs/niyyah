"use client";

import { useSyncExternalStore } from "react";

/** Width from which the Overview's calendar bar sits in the app header instead of above the calendar. */
export const HEADER_BAR_MIN_PX = 1280;
const QUERY = `(min-width: ${HEADER_BAR_MIN_PX}px)`;

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** The header's #nav-cal slot while the window is wide enough for the bar to live there; null below that and on the server. */
export function useHeaderSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => (window.matchMedia(QUERY).matches ? document.getElementById("nav-cal") : null), () => null);
}
