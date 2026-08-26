import { BLOCK_COLORS, BLOCK_LABELS, BLOCK_ORDER, MODE_COLORS } from "@/lib/vault-constants";
import { VaultMonthData, VaultStreaksData } from "@/lib/vault-types";

interface FooterStatsProps {
  month: VaultMonthData | null;
  streaks: VaultStreaksData | null;
}

export function FooterStats({ month, streaks }: FooterStatsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="border border-[var(--border)] bg-[var(--surface)] rounded p-4">
        <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
          Mode Distribution
        </p>
        {month && month.days.length > 0 ? (
          <div className="flex h-3 rounded overflow-hidden">
            {Object.entries(month.modes).map(([mode, count]) => (
              <div
                key={mode}
                style={{
                  width: `${(count / month.days.length) * 100}%`,
                  backgroundColor: MODE_COLORS[mode] ?? "#71717a",
                }}
                title={`${mode}: ${count}`}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">No data yet</p>
        )}
      </div>

      <div className="border border-[var(--border)] bg-[var(--surface)] rounded p-4">
        <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">Streaks</p>
        <div className="space-y-1">
          {BLOCK_ORDER.map((block) => {
            const entry = streaks?.streaks[block];
            return (
              <div key={block} className="flex items-center justify-between text-xs">
                <span style={{ color: BLOCK_COLORS[block] }}>{BLOCK_LABELS[block]}</span>
                <span className="font-mono text-[var(--muted-foreground)]">
                  {entry?.current ?? 0} / {entry?.longest ?? 0}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
