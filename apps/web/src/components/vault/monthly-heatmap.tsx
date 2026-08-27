import { VaultDayData, VaultMonthData } from "@/lib/vault-types";

interface MonthlyHeatmapProps {
  month: VaultMonthData | null;
}

function heatColor(pct: number): string {
  if (pct === 0) return "var(--border)";
  if (pct < 34) return "#ef4444";
  if (pct < 67) return "#eab308";
  return "#059669";
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function MonthlyHeatmap({ month }: MonthlyHeatmapProps) {
  if (!month) return null;

  const [year, monthNum] = month.month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const firstWeekday = new Date(year, monthNum - 1, 1).getDay();
  const byDate = new Map(month.days.map((d) => [d.date, d]));

  // Real calendar grid (not just a sequential strip) — leading blanks align
  // day 1 under its actual weekday, like a paper habit-tracker spread.
  const cells: (VaultDayData | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const dateStr = `${month.month}-${String(i + 1).padStart(2, "0")}`;
      return byDate.get(dateStr) ?? null;
    }),
  ];

  return (
    <div className="widget border border-[var(--border)] bg-[var(--surface)] rounded p-4 mb-4">
      <div className="flex items-baseline justify-between mb-4">
        <p className="heading-elegant text-base">Monthly Heatmap — {month.month}</p>
        <p className="font-hand text-lg leading-none text-[var(--muted-foreground)]">habit tracker</p>
      </div>
      <div className="grid grid-cols-7 gap-2.5">
        {WEEKDAY_LABELS.map((w, i) => (
          <p key={`h-${i}`} className="text-center text-[10px] uppercase text-[var(--muted-foreground)] font-mono">
            {w}
          </p>
        ))}
        {/* Bigger paper-like cells — the fill color is the mark; the date is
            a quiet corner annotation, not the focal point. */}
        {cells.map((day, i) =>
          day ? (
            <div
              key={day.date}
              title={`${day.date}: ${day.total}/${day.possible}`}
              className="aspect-square rounded-lg flex items-start justify-start p-1.5 text-[8px] font-mono tabular-nums"
              style={{
                backgroundColor: heatColor(day.pct),
                color: day.pct > 0 ? "rgba(255,255,255,0.75)" : "var(--muted-foreground)",
              }}
            >
              {Number(day.date.slice(-2))}
            </div>
          ) : (
            <div key={`blank-${i}`} className="aspect-square" />
          )
        )}
      </div>
    </div>
  );
}
