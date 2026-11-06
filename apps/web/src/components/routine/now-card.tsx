import { useBlocks } from "@/lib/blocks";
import { ResolvedDay, formatMinutes } from "@/lib/routine";
import { currentBlock, duration, formatDuration, nextBlock } from "@/lib/ring";

/** Sits under the ring, one row: how far through the current block you are and what comes next (the ring's centre has the time left). Public. */
export function NowCard({ day, nowMin, preview }: { day: ResolvedDay; nowMin: number; /** Another date than today: its name instead of now and next (there is no now on it). */ preview?: string }) {
  const blocks = useBlocks();
  const current = currentBlock(day, nowMin);
  const next = nextBlock(day, nowMin);
  const color = current ? blocks.color(current.block) : "var(--muted-foreground)";
  const elapsed = current ? (((nowMin - current.startMin) % 1440) + 1440) % 1440 : 0;
  const total = current ? duration(current) : 1;
  const pct = Math.round((elapsed / total) * 100);
  const mono = "font-mono text-sm font-medium tabular-nums";

  if (preview) {
    return (
      <section className="mx-auto mt-3 grid w-full max-w-[35rem] grid-cols-[minmax(0,1fr)] gap-1.5" aria-label="Now" data-now-preview="">
        <div className="h-1 bg-[var(--muted)]" aria-hidden="true" />
        <p className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Preview</span>
          <span className="min-w-0 truncate"><b className="font-semibold">{preview}</b> <span className="text-[var(--muted-foreground)]">· {day.dayType}</span></span>
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto mt-3 grid w-full max-w-[35rem] grid-cols-[minmax(0,1fr)] gap-1.5" aria-label="Now">
      {current ? (
        <>
          <div className="h-1 overflow-hidden bg-[var(--muted)]" role="progressbar" aria-label={`${blocks.label(current.block)} elapsed`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
          </div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5" title={`${formatMinutes(current.startMin)}–${formatMinutes(current.endMin)} · ${formatDuration(elapsed)} passed, ${formatDuration(total - elapsed)} left`}>
              <span aria-hidden="true" className="h-2 w-2 shrink-0 self-center" style={{ background: color }} />
              <b className="min-w-0 truncate font-semibold">{current.what}</b>
              <span className={`${mono} text-[var(--muted-foreground)]`}>{pct}%</span>
            </span>
            {next && (
              <span className="shrink-0 whitespace-nowrap" title={`in ${formatDuration((((next.startMin - nowMin) % 1440) + 1440) % 1440)}`}>
                <span className="mr-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Next</span>{blocks.label(next.block)} <span className={`${mono} text-[var(--muted-foreground)]`}>{formatMinutes(next.startMin)}</span>
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="flex justify-between gap-3 text-sm">
          <p className="font-semibold">Unscheduled</p>
          {next && <span className="whitespace-nowrap"><span className="mr-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Next</span>{blocks.label(next.block)} <span className={`${mono} text-[var(--muted-foreground)]`}>{formatMinutes(next.startMin)}</span></span>}
        </div>
      )}
    </section>
  );
}
