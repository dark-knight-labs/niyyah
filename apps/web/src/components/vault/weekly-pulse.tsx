import { MODE_COLORS } from "@/lib/vault-constants";
import { VaultWeekData } from "@/lib/vault-types";

interface WeeklyPulseProps {
  week: VaultWeekData | null;
}

export function WeeklyPulse({ week }: WeeklyPulseProps) {
  if (!week) return null;

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded p-4 mb-4">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">Weekly Pulse</p>
      <div className="flex gap-2 h-24 relative">
        <div
          className="absolute left-0 right-0 border-t border-dashed border-[var(--muted-foreground)]"
          style={{ bottom: `${week.week_pct}%` }}
        />
        {week.days.map((day) => {
          const dow = new Date(day.date).toLocaleDateString("en-US", { weekday: "short" });
          const color = MODE_COLORS[day.mode] ?? "#71717a";
          return (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex-1 flex items-end">
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
