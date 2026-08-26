import { BLOCK_COLORS, BLOCK_LABELS, BLOCK_ORDER } from "@/lib/vault-constants";
import { VaultBlocksSeriesData } from "@/lib/vault-types";

interface BlockTrendsProps {
  series: VaultBlocksSeriesData | null;
}

export function BlockTrends({ series }: BlockTrendsProps) {
  if (!series) return null;

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded p-4 mb-4">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
        Block Trends ({series.range}d)
      </p>
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
              <div className="flex-1 flex items-end gap-px h-6">
                {values.map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm"
                    style={{ height: `${Math.max((v / 3) * 100, 4)}%`, backgroundColor: color }}
                  />
                ))}
              </div>
              <span className="font-mono text-xs w-8 text-right text-[var(--muted-foreground)]">{avg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
