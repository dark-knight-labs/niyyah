import { BLOCK_COLORS, BLOCK_LABELS, BLOCK_ORDER } from "@/lib/vault-constants";
import { VaultBlocksSeriesData } from "@/lib/vault-types";

interface BlockTrendsProps {
  series: VaultBlocksSeriesData | null;
}

export function BlockTrends({ series }: BlockTrendsProps) {
  if (!series) return null;

  return (
    <div className="widget border border-[var(--border)] bg-[var(--surface)] rounded p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          Block Trends ({series.range}d)
        </p>
        <p className="font-hand text-lg leading-none text-[var(--muted-foreground)]">the long view</p>
      </div>
      <div className="space-y-2">
        {BLOCK_ORDER.map((block) => {
          const values = series.blocks[block] ?? [];
          const avg = series.averages[block] ?? 0;
          const color = BLOCK_COLORS[block];
          return (
            <div key={block} className="flex items-center gap-3">
              <span className="text-xs w-24 shrink-0" style={{ color }}>
                {BLOCK_LABELS[block]}
              </span>
              <div className="chart-grid flex-1 flex items-end gap-px h-6 rounded-sm">
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
