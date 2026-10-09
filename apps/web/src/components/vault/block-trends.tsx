import { useBlocks } from "@/lib/blocks";
import { VaultBlocksSeriesData } from "@/lib/vault-types";

interface BlockTrendsProps {
  series: VaultBlocksSeriesData | null;
}

export function BlockTrends({ series }: BlockTrendsProps) {
  const blocks = useBlocks();
  if (!series) return null;

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded-xl p-3.5">
      <div className="flex items-baseline justify-between mb-2.5">
        <p className="heading-elegant text-sm">Block Trends ({series.range}d)</p>
        <p className="text-xs text-[var(--muted-foreground)]">the long view</p>
      </div>
      <div className="space-y-1">
        {blocks.list.filter((b) => b.counts_for_stars).map((b) => {
          const block = b.key;
          const values = series.blocks[block] ?? [];
          if (values.every((v) => v === null)) return null; // e.g. legacy blocks in a post-merge range
          const avg = series.averages[block] ?? 0;
          const color = blocks.color(block);
          return (
            <div key={block} className="flex items-center gap-3">
              <span className="text-xs w-24 shrink-0" style={{ color }}>
                {b.label}
              </span>
              <div className="chart-grid flex-1 flex items-end gap-px h-5 rounded-sm">
                {values.map((v, i) =>
                  v === null ? (
                    // No data for this day (block wasn't applicable) — a faint
                    // full-height marker, visually distinct from an actual
                    // "voted 0" bar rather than rendering as an empty gap.
                    <div
                      key={i}
                      className="flex-1 rounded-sm bg-[var(--border)]"
                      style={{ height: "100%", opacity: 0.15 }}
                      title="No data"
                    />
                  ) : (
                    <div
                      key={i}
                      className="flex-1 rounded-sm"
                      style={{ height: `${Math.max((v / 3) * 100, 4)}%`, backgroundColor: color }}
                      title={`${v} star${v === 1 ? "" : "s"}`}
                    />
                  )
                )}
              </div>
              <span className="font-mono text-xs w-8 text-right text-[var(--muted-foreground)]">{avg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
