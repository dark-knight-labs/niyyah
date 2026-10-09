import { StreamMeta } from "@/lib/streams";

/** A stream's icon on a tinted square, so the stream is recognised by colour and shape before its name is read. */
export function StreamIcon({ stream, size = 36 }: { stream: StreamMeta; size?: number }) {
  const Icon = stream.icon;
  return (
    <span className="grid shrink-0 place-items-center rounded-[0.625rem]"
      style={{ width: size, height: size, color: stream.color, background: `color-mix(in srgb, ${stream.color} 13%, var(--background))` }}>
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  if (!status) return null;
  const active = status === "active";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] font-bold ${active ? "bg-[var(--accent-light)] text-[var(--accent)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>
      {status}
    </span>
  );
}

/** A month checkpoint tag, tinted in the stream's colour. */
export function MonthTag({ label, color, muted }: { label: string; color?: string; muted?: boolean }) {
  return (
    <span className="rounded-md px-1.5 py-px text-[0.6875rem] font-bold tabular-nums"
      style={muted ? { background: "var(--muted)", color: "var(--muted-foreground)" } : { color, background: `color-mix(in srgb, ${color} 14%, var(--background))` }}>
      {label}
    </span>
  );
}
