import { VaultMonthData } from "@/lib/vault-types";

interface MonthlyHeatmapProps {
  month: VaultMonthData | null;
}

function heatColor(pct: number): string {
  if (pct === 0) return "var(--border)";
  if (pct < 34) return "#ef4444";
  if (pct < 67) return "#eab308";
  return "#059669";
}

export function MonthlyHeatmap({ month }: MonthlyHeatmapProps) {
  if (!month) return null;

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded p-4 mb-4">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
        Monthly Heatmap — {month.month}
      </p>
      <div className="grid grid-cols-7 gap-2">
        {month.days.map((day) => (
          <div
            key={day.date}
            title={`${day.date}: ${day.total}/${day.possible}`}
            className="w-6 h-6 rounded-full mx-auto"
            style={{ backgroundColor: heatColor(day.pct) }}
          />
        ))}
      </div>
    </div>
  );
}
