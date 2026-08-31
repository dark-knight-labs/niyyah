import { resolveModeColor } from "@/lib/vault-constants";
import { VaultDayData, VaultMonthData } from "@/lib/vault-types";

interface MonthlyHeatmapProps {
  month: VaultMonthData | null;
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
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="heading-elegant text-base">Monthly Heatmap — {month.month}</p>
        <p className="font-hand text-lg leading-none text-[var(--muted-foreground)]">habit tracker</p>
      </div>
      {/* Fixed-width columns (not 1fr) — cells stay small habit-tracker
          squares instead of stretching to fill the card. Color is the mode's
          color everywhere on the page, not a separate percent-tier scale. */}
      <div className="grid grid-cols-[repeat(7,1.75rem)] gap-1">
        {WEEKDAY_LABELS.map((w, i) => (
          <p key={`h-${i}`} className="text-center text-[9px] uppercase text-[var(--muted-foreground)] font-mono">
            {w}
          </p>
        ))}
        {cells.map((day, i) =>
          day ? (
            <div
              key={day.date}
              title={`${day.date}: ${day.total}/${day.possible} · ${day.mode}`}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[8px] font-mono tabular-nums relative transition-transform duration-150 hover:scale-125 hover:z-10"
              style={{
                backgroundColor: resolveModeColor(day.mode),
                color: "rgba(255,255,255,0.8)",
              }}
            >
              {Number(day.date.slice(-2))}
            </div>
          ) : (
            <div key={`blank-${i}`} className="w-7 h-7" />
          )
        )}
      </div>
    </div>
  );
}
