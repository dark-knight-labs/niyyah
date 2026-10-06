/** Eyebrow, serif title and an optional visual on the right; shared by the planner pages. */
export function PageTitle({ eyebrow, title, sub, visual, action }: { eyebrow: string; title: React.ReactNode; sub?: React.ReactNode; visual?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="mb-8 flex w-full flex-wrap items-end justify-between gap-x-10 gap-y-6">
      <div className="min-w-0 flex-[1_1_22rem]">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="heading-elegant mt-2 text-[clamp(1.7rem,3.4vw,3.1rem)] leading-[1.15]">{title}</h1>
        {sub && <div className="mt-3 text-sm text-[var(--muted-foreground)]">{sub}</div>}
        {action && <div className="mt-4">{action}</div>}
      </div>
      {visual}
    </header>
  );
}

/** Small caps section heading with a quiet note on the right (same voice as /routine). */
export function SectionTitle({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-baseline justify-between gap-4 text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
      {title}
      {aside && <span className="hidden text-xs font-medium normal-case tracking-normal sm:inline">{aside}</span>}
    </h2>
  );
}

/** Centered message for loading failures and owner-only pages. */
export function Notice({ children }: { children: React.ReactNode }) {
  return <p role="status" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted-foreground)]">{children}</p>;
}

export function Spinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
    </div>
  );
}
