import { VaultGoalsData } from "@/lib/vault-types";

/** Goals you keep in front of you, one card each, read from Calendar/Goals.md in the vault (edit them in Obsidian). */
export function GoalCards({ data }: { data: VaultGoalsData | null }) {
  const items = data?.items ?? [];
  if (data && items.length === 0) {
    return <p className="self-center text-xs text-[var(--muted-foreground)]">No goals yet. Add one line each to Calendar/Goals.md in the vault.</p>;
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(10.625rem,1fr))] gap-2.5">
      {items.map((g) => (
        <article key={g.title} className="grid min-w-0 content-start gap-0.5 rounded-lg border border-[var(--border)] px-3 py-2">
          <h2 className="text-[0.625rem] font-extrabold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">{g.title}</h2>
          <p className="break-words font-serif text-xl font-medium leading-tight">{g.value}</p>
          {g.caption && <p className="text-xs text-[var(--muted-foreground)]">{g.caption}</p>}
          {g.progress !== null && (
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-[var(--muted)]" role="progressbar" aria-label={`${g.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.progress}>
              <div className="h-full bg-[var(--accent)]" style={{ width: `${g.progress}%` }} />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
