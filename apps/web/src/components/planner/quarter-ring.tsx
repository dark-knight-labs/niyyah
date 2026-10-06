/** The quarter as a ring of weeks: passed weeks filled, this week bold, the rest faint. */
export function QuarterRing({ week, weeks, label, size = 132 }: { week: number; weeks: number; label: string; size?: number }) {
  const r = size / 2 - 8;
  const c = size / 2;
  const seg = (2 * Math.PI) / weeks;
  const gap = 0.07;
  const arc = (i: number) => {
    const a0 = i * seg - Math.PI / 2 + gap;
    const a1 = (i + 1) * seg - Math.PI / 2 - gap;
    const p = (a: number) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
    return `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`Week ${week} of ${weeks}`}>
      {Array.from({ length: weeks }, (_, i) => (
        <path key={i} d={arc(i)} fill="none" strokeLinecap="round" stroke="var(--accent)"
          strokeWidth={i + 1 === week ? 9 : 5} strokeOpacity={i + 1 === week ? 1 : i + 1 < week ? 0.55 : 0.16} />
      ))}
      <text x={c} y={c - 2} textAnchor="middle" fontSize={size * 0.26} fontWeight="300" fill="var(--foreground)" style={{ fontFamily: "var(--font-serif)" }}>{week}</text>
      <text x={c} y={c + size * 0.14} textAnchor="middle" fontSize={size * 0.085} letterSpacing="0.14em" fill="var(--muted-foreground)">{label}</text>
    </svg>
  );
}
