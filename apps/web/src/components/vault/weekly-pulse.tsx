import { resolveModeColor } from "@/lib/vault-constants";
import { VaultWeekData } from "@/lib/vault-types";

interface WeeklyPulseProps {
  week: VaultWeekData | null;
}

export function WeeklyPulse({ week }: WeeklyPulseProps) {
  if (!week) return null;

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="heading-elegant text-base">Weekly Pulse</p>
        <p className="font-hand text-lg leading-none text-[var(--muted-foreground)]">this week&rsquo;s spread</p>
      </div>
      <div className="chart-grid flex gap-2 h-24 relative rounded-sm">
        <div
          className="absolute left-0 right-0 border-t border-dashed border-[var(--accent)] z-10"
          style={{ bottom: `${week.week_pct}%` }}
        />
        {week.days.map((day) => {
          const dow = new Date(day.date).toLocaleDateString("en-US", { weekday: "short" });
          const color = resolveModeColor(day.mode);
          return (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-1 relative z-10">
              <div className="w-full flex-1 flex items-end" title={`${day.pct}%`}>
                <div
                  className="w-full rounded-t"
                  style={{ height: `${Math.max(day.pct, 2)}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-[10px] uppercase text-[var(--muted-foreground)] font-mono">{dow}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
