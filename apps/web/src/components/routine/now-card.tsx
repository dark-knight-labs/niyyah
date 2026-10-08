import { ROUTINE_BLOCKS, ResolvedDay, formatMinutes } from "@/lib/routine";
import { currentBlock, duration, formatDuration, nextBlock } from "@/lib/ring";

/** Sits under the ring: how far through the current block you are (passed, left) and what comes next. Public. */
export function NowCard({ day, nowMin }: { day: ResolvedDay; nowMin: number }) {
  const current = currentBlock(day, nowMin);
  const next = nextBlock(day, nowMin);
  const color = current ? ROUTINE_BLOCKS[current.block].color : "var(--muted-foreground)";
  const elapsed = current ? (((nowMin - current.startMin) % 1440) + 1440) % 1440 : 0;
  const total = current ? duration(current) : 1;
  const pct = Math.round((elapsed / total) * 100);
  const minutesToNext = next ? (((next.startMin - nowMin) % 1440) + 1440) % 1440 : 0;
  const mono = "font-mono text-sm font-medium tabular-nums";

  return (
    <section className="mx-auto mt-3 grid w-full max-w-[35rem] gap-2" aria-label="Now">
      {current ? (
        <>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className={mono}>{formatMinutes(current.startMin)}</span>
            <span className="min-w-0 truncate text-[var(--muted-foreground)]">{current.what}</span>
            <span className={mono}>{formatMinutes(current.endMin)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-[var(--muted)]" role="progressbar" aria-label={`${ROUTINE_BLOCKS[current.block].label} elapsed`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <span><b className={mono}>{formatDuration(elapsed)}</b> <span className="text-[var(--muted-foreground)]">passed</span></span>
            <span className="text-[var(--muted-foreground)]">{pct}%</span>
            <span><b className={mono}>{formatDuration(total - elapsed)}</b> <span className="text-[var(--muted-foreground)]">left</span></span>
          </div>
        </>
      ) : (
        <p className="text-sm font-semibold">Unscheduled</p>
      )}
      {next && (
        <div className="flex justify-between gap-3 border-t border-[var(--border)] pt-2 text-sm">
          <span><span className="mr-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Next</span><b>{ROUTINE_BLOCKS[next.block].label}</b> <span className={`${mono} text-[var(--muted-foreground)]`}>{formatMinutes(next.startMin)}</span></span>
          <span className="whitespace-nowrap text-[var(--muted-foreground)]">in {formatDuration(minutesToNext)}</span>
        </div>
      )}
    </section>
  );
}
