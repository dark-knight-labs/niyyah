"use client";

import { Checklist } from "@/components/planner/checklist";
import { VaultGoalsData } from "@/lib/vault-types";

/** Goals you keep in front of you: a title, a value, an optional caption, and lines you can tick. Edit them in Settings. */
export function GoalCards({ data, onTick }: { data: VaultGoalsData | null; onTick: (id: string, done: boolean) => Promise<unknown> }) {
  const items = data?.items ?? [];
  if (data && items.length === 0) {
    return <p className="mb-3 text-xs text-[var(--muted-foreground)]">No goals yet.</p>;
  }
  return (
    <ul className="mb-3 flex flex-wrap gap-x-10 gap-y-3 border-y border-[var(--border)] py-2.5">
      {items.map((g) => (
        <li key={g.title} className={`min-w-0 ${g.checklist.length ? "w-full sm:w-auto sm:min-w-[13rem] sm:max-w-[20rem] sm:flex-1" : ""}`}>
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">{g.title}</p>
          <p className="break-words text-sm">
            <span className="font-serif font-medium">{g.value}</span>
            {g.caption && <span className="text-[var(--muted-foreground)]"> · {g.caption}</span>}
          </p>
          {g.checklist.length > 0 ? (
            <div className="mt-1.5">
              <Checklist label={`${g.title} checklist`} items={g.checklist} onToggle={(item, done) => onTick(item.id, done)} />
            </div>
          ) : (
            g.progress !== null && (
              <div className="mt-1 h-0.5 w-full bg-[var(--muted)]" role="progressbar" aria-label={`${g.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.progress}>
                <div className="h-full bg-[var(--accent)]" style={{ width: `${g.progress}%` }} />
              </div>
            )
          )}
        </li>
      ))}
    </ul>
  );
}
