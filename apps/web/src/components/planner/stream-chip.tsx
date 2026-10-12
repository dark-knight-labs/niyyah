export function StatusPill({ status }: { status: string }) {
  if (!status) return null;
  const active = status === "active";
  return (
    <span className={`rounded-none px-2.5 py-0.5 text-micro font-bold ${active ? "bg-[var(--accent-light)] text-[var(--accent)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>
      {status}
    </span>
  );
}
