"use client";

import { ItemCard } from "@/components/routine/item-card";
import { pinOf, Week } from "@/components/routine/week-calendar";
import { itemRef } from "@/lib/items";
import { StreamMeta } from "@/lib/streams";

/**
 * The picked item's details card (the Overview's ItemCard): a side panel beside the view from lg up, a bottom sheet above
 * the tab bar on narrower screens. Esc or the card's cross closes it.
 */
export function ItemPanel({ week, streams, onChanged }: { week: Week; streams: StreamMeta[]; onChanged?: () => void }) {
  const sel = week.selected;
  if (!sel) return null;
  return (
    <aside aria-label="Item panel"
      className="fixed inset-x-0 bottom-12 z-30 max-h-[70vh] overflow-y-auto border-t border-[var(--rule)] bg-[var(--background)] p-2 shadow-[0_-12px_30px_rgb(0_0_0/0.18)] md:bottom-0 lg:sticky lg:top-14 lg:z-auto lg:max-h-[calc(100vh-4.5rem)] lg:border-t-0 lg:bg-transparent lg:p-0 lg:shadow-none">
      <ItemCard key={itemRef(sel)} item={sel} streams={streams} items={week.items} pinned={week.pins.includes(pinOf(sel))} stacked onChanged={onChanged}
        onPin={() => week.togglePin(pinOf(sel))} onClose={() => week.setPicked(null)}
        onMoved={(to) => week.setPicked(week.days.includes(to) ? itemRef({ ...sel, day: to }) : null)} />
    </aside>
  );
}
