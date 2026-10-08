import { BLOCK_COLORS, BLOCK_LABELS, BLOCK_ORDER, resolveModeColor } from "@/lib/vault-constants";
import { VaultMonthData, VaultStreaksData } from "@/lib/vault-types";

interface FooterStatsProps {
  /** Put the two cards in one column (for a narrow slot). */
  stacked?: boolean;
  month: VaultMonthData | null;
  streaks: VaultStreaksData | null;
}

export function FooterStats({ stacked, month, streaks }: FooterStatsProps) {
  return (
    <div className={`grid grid-cols-1 gap-3 ${stacked ? "" : "md:grid-cols-2"}`}>
      <div className="border border-[var(--border)] bg-[var(--surface)] rounded-xl p-3.5">
        <div className="flex items-baseline justify-between mb-2">
          <p className="heading-elegant text-sm">Mode Distribution</p>
          <p className="text-xs text-[var(--muted-foreground)]">the month in modes</p>
        </div>
        {month && month.days.length > 0 ? (
          <>
            <div className="flex h-3 rounded overflow-hidden mb-2">
              {Object.entries(month.modes).map(([mode, count]) => (
                <div
                  key={mode}
                  style={{
                    width: `${(count / month.days.length) * 100}%`,
                    backgroundColor: resolveModeColor(mode),
                  }}
                  title={`${mode}: ${count}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(month.modes).map(([mode, count]) => (
                <span key={mode} className="flex items-center gap-1 text-[0.625rem] font-mono text-[var(--muted-foreground)]">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: resolveModeColor(mode) }} />
                  {mode} {count}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">No data yet</p>
        )}
      </div>

      <div className="border border-[var(--border)] bg-[var(--surface)] rounded-xl p-3.5">
        <div className="flex items-baseline justify-between mb-2">
          <p className="heading-elegant text-sm">Streaks</p>
          <p className="text-xs text-[var(--muted-foreground)]">current / best</p>
        </div>
        <div className="space-y-1">
          {BLOCK_ORDER.map((block) => {
            const entry = streaks?.streaks[block];
            if (streaks && !entry) return null; // block never voted (e.g. legacy or merged)
            const current = entry?.current ?? 0;
            const color = BLOCK_COLORS[block];
            return (
              <div key={block} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span style={{ color }}>{BLOCK_LABELS[block]}</span>
                </span>
                <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
                  {current} / {entry?.longest ?? 0}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
