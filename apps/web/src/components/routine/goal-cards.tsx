import { VaultGoalsData } from "@/lib/vault-types";

/** Goals you keep in front of you, one quiet line each, read from Calendar/Goals.md in the vault (edit them in Obsidian). */
export function GoalCards({ data }: { data: VaultGoalsData | null }) {
  const items = data?.items ?? [];
  if (data && items.length === 0) {
    return <p className="mb-3 text-xs text-[var(--muted-foreground)]">No goals yet.</p>;
  }
  return (
    <ul className="mb-3 flex flex-wrap gap-x-8 gap-y-2 border-y border-[var(--border)] py-2">
      {items.map((g) => (
        <li key={g.title} className="min-w-0">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">{g.title}</p>
          <p className="break-words text-sm">
            <span className="font-serif font-medium">{g.value}</span>
            {g.caption && <span className="text-[var(--muted-foreground)]"> · {g.caption}</span>}
          </p>
          {g.progress !== null && (
            <div className="mt-1 h-0.5 w-full bg-[var(--muted)]" role="progressbar" aria-label={`${g.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.progress}>
              <div className="h-full bg-[var(--accent)]" style={{ width: `${g.progress}%` }} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
