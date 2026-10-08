import { ROUTINE_BLOCKS, ResolvedDay, formatMinutes } from "@/lib/routine";
import { currentBlock, duration, formatDuration, nextBlock } from "@/lib/ring";

/** The block you are in, how far through it you are, and what comes next. Public. */
export function NowCard({ day, nowMin }: { day: ResolvedDay; nowMin: number }) {
  const current = currentBlock(day, nowMin);
  const next = nextBlock(day, nowMin);
  const color = current ? ROUTINE_BLOCKS[current.block].color : "var(--muted-foreground)";
  const elapsed = current ? (((nowMin - current.startMin) % 1440) + 1440) % 1440 : 0;
  const total = current ? duration(current) : 1;
  const pct = Math.round((elapsed / total) * 100);
  const minutesToNext = next ? (((next.startMin - nowMin) % 1440) + 1440) % 1440 : 0;

  return (
    <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="Now">
      <div className="flex gap-3">
        <div className="w-1 self-stretch rounded" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Now</p>
          <h2 className="mt-0.5 text-xl font-extrabold">
            {current ? `${ROUTINE_BLOCKS[current.block].label} · ${formatMinutes(current.startMin)}–${formatMinutes(current.endMin)}` : "Unscheduled"}
          </h2>
          {current && <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{current.what}</p>}
          {current && (
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[var(--muted)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
          )}
        </div>
      </div>
      {next && (
        <div className="mt-3 flex justify-between gap-3 border-t border-[var(--border)] pt-3 text-sm">
          <span><span className="mr-1 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Next</span><b>{ROUTINE_BLOCKS[next.block].label}</b> · {next.what}</span>
          <span className="whitespace-nowrap text-[var(--muted-foreground)]">in {formatDuration(minutesToNext)}</span>
        </div>
      )}
    </section>
  );
}
