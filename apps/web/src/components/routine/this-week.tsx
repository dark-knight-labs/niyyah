import { colorVar } from "@/lib/streams";
import { QuarterData, VaultObjectivesData } from "@/lib/vault-types";

/** The quarter goal and each stream's small domino for the week, as plain text beside a stream-coloured square. */
export function ThisWeek({ quarter, objectives }: { quarter: QuarterData | null; objectives: VaultObjectivesData | null }) {
  const items = (objectives?.items ?? []).filter((o) => o.text);
  return (
    <section aria-label="This week" className="border border-[var(--border)] bg-[var(--surface)]">
      <h2 className="mono flex h-[30px] items-center justify-between border-b border-[var(--border)] px-3 text-[var(--foreground)]">
        This week
        {quarter && <span className="font-normal text-[var(--muted-foreground)]">Wk {quarter.week_of_quarter} / {quarter.weeks_in_quarter}</span>}
      </h2>
      <div className="grid gap-2 px-3 py-2.5 text-small">
        {quarter?.objective && (
          <>
            <p className="mono text-[var(--muted-foreground)]">Quarter goal</p>
            <p>{quarter.objective}</p>
          </>
        )}
        <p className="mono mt-1 text-[var(--muted-foreground)]">Small dominoes</p>
        {items.length === 0 && <p className="text-[var(--muted-foreground)]">None set for this week.</p>}
        {items.map((o) => (
          <p key={o.stream} className={`flex items-baseline gap-2 ${o.done ? "text-[var(--muted-foreground)] line-through" : ""}`}>
            <span className="h-2 w-2 shrink-0" style={{ background: colorVar(o.color) }} aria-hidden="true" />
            {o.text}
          </p>
        ))}
      </div>
    </section>
  );
}
