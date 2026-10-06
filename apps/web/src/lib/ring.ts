import { ResolvedBlock, ResolvedDay, RoutineBlock, PRAYERS, Prayer } from "@/lib/routine";

const TAU = Math.PI * 2;

/** Short name written on the ring itself. */
export const RING_NAMES: Record<RoutineBlock, string> = {
  soul: "SOUL", body: "BODY", ot: "OT", planning: "PLAN", distribution: "DIST", fnf: "FNF", sleep: "SLEEP",
};

export const duration = (b: ResolvedBlock) => b.endMin - b.startMin;

/** "5h", "1h 45m", "45m". */
export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const inBlock = (b: ResolvedBlock, nowMin: number) =>
  (nowMin >= b.startMin && nowMin < b.endMin) || (nowMin + 1440 >= b.startMin && nowMin + 1440 < b.endMin);

/** The block ended earlier today (a block crossing midnight is never "past"). */
export const isPast = (b: ResolvedBlock, nowMin: number) => !inBlock(b, nowMin) && b.endMin <= nowMin;

export function currentBlock(day: ResolvedDay, nowMin: number): ResolvedBlock | undefined {
  return day.blocks.find((b) => inBlock(b, nowMin));
}

export function nextBlock(day: ResolvedDay, nowMin: number): ResolvedBlock | undefined {
  const upcoming = day.blocks
    .map((b) => ({ b, in: ((b.startMin - nowMin) % 1440 + 1440) % 1440 }))
    .filter((x) => x.in > 0)
    .sort((a, b) => a.in - b.in);
  return upcoming[0]?.b;
}

export function nextPrayer(day: ResolvedDay, nowMin: number): { name: Prayer; in: number } {
  const later = PRAYERS.map((p) => ({ name: p, min: day.prayers[p] })).find((x) => x.min > nowMin);
  return later ? { name: later.name, in: later.min - nowMin } : { name: "fajr", in: day.prayers.fajr + 1440 - nowMin };
}

/** Points and arcs on the 24h circle centred on (cx, cy); minute 0 is straight up. */
export function ringGeometry(cx: number, cy: number, r: number) {
  const point = (radius: number, min: number): [number, number] => {
    const a = (min / 1440) * TAU - Math.PI / 2;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  };
  const arc = (startMin: number, endMin: number) => {
    const [x1, y1] = point(r, startMin);
    const [x2, y2] = point(r, endMin);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${endMin - startMin > 720 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  /** The same arc drawn backwards: text on it reads upright on the bottom half of the ring. */
  const arcBackwards = (startMin: number, endMin: number) => {
    const [x1, y1] = point(r, startMin);
    const [x2, y2] = point(r, endMin);
    return `M ${x2} ${y2} A ${r} ${r} 0 ${endMin - startMin > 720 ? 1 : 0} 0 ${x1} ${y1}`;
  };
  return { point, arc, arcBackwards };
}

/** Name along the arc only if it fits (about 6.3 units per capital at the ring's font size). */
export function nameFits(b: ResolvedBlock, r: number, charWidth: number): boolean {
  const length = (TAU * r * duration(b)) / 1440;
  return length >= RING_NAMES[b.block].length * charWidth + 2;
}

export const onBottomHalf = (b: ResolvedBlock) => {
  const mid = ((b.startMin + b.endMin) / 2) % 1440;
  return mid > 360 && mid < 1080;
};
