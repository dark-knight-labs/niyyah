export function SettingsSection({ id, title, aside, children }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t border-[var(--border)] py-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[1.2rem]">{title}</h2>
        {aside && <span className="text-xs font-medium text-[var(--muted-foreground)]">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export const FIELD = "min-h-9 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm";
export const MICRO = "text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]";
export const CHIP = "min-h-8 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--muted-foreground)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]";
