import { MONTH_LABEL } from "@/lib/streams";
import { MonthKey } from "@/lib/vault-types";

interface Props {
  checkpoints: { month: MonthKey; text: string }[];
  current: MonthKey;
  color: string;
}

/** Month checkpoints on a track: reached months filled, this month ringed, later ones hollow. */
export function MonthTrack({ checkpoints, current, color }: Props) {
  const here = Math.max(checkpoints.findIndex((c) => c.month === current), 0);
  return (
    <ol className="grid gap-4 sm:grid-cols-3 sm:gap-3">
      {checkpoints.map((cp, i) => {
        const state = i < here ? "past" : i === here ? "now" : "next";
        return (
          <li key={cp.month} className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
                {state === "now" && <circle cx="8" cy="8" r="7.5" fill={color} fillOpacity="0.2" />}
                <circle cx="8" cy="8" r="4.5" fill={state === "past" ? color : "var(--background)"} stroke={color} strokeWidth="2" strokeOpacity={state === "next" ? 0.4 : 1} />
              </svg>
              <span className="text-[0.6875rem] font-extrabold uppercase tracking-[0.12em]" style={{ color: state === "next" ? "var(--muted-foreground)" : color }}>
                {MONTH_LABEL[cp.month]}{state === "now" ? " · now" : ""}
              </span>
              <span className="hidden h-px flex-1 sm:block" style={{ background: color, opacity: state === "next" ? 0.15 : 0.4 }} aria-hidden="true" />
            </div>
            <p className={`break-words text-[0.8125rem] leading-snug ${state === "next" ? "text-[var(--muted-foreground)]" : ""}`}>{cp.text}</p>
          </li>
        );
      })}
    </ol>
  );
}
