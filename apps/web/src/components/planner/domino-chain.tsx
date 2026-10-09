/** Dominoes of falling size and growing lean: the quarter goal topples the month, the week, the day. */
export function DominoChain({ count = 5, height = 40, active, className }: { count?: number; height?: number; active?: number; className?: string }) {
  const gap = height * 0.34;
  const width = height * 0.22;
  const dominoes = Array.from({ length: count }, (_, i) => {
    const scale = 1 - i * (0.62 / Math.max(count - 1, 1));
    const h = height * scale;
    return { h, w: width * (0.7 + 0.3 * scale), lean: i * 7, x: i * (gap + width * 0.55) };
  });
  const total = dominoes[count - 1].x + height * 0.5;
  return (
    <svg viewBox={`0 0 ${total} ${height + 2}`} width={total} height={height + 2} className={className} aria-hidden="true" fill="none">
      <line x1="0" y1={height + 1} x2={total} y2={height + 1} stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
      {dominoes.map((d, i) => (
        <g key={i} transform={`translate(${d.x} ${height + 1}) rotate(${d.lean})`}>
          <rect x="0" y={-d.h} width={d.w} height={d.h} rx={d.w * 0.28}
            fill="currentColor" fillOpacity={active === undefined || active === i ? 1 : 0.28} />
          <circle cx={d.w / 2} cy={-d.h * 0.7} r={d.w * 0.13} fill="var(--background)" />
          <circle cx={d.w / 2} cy={-d.h * 0.3} r={d.w * 0.13} fill="var(--background)" />
        </g>
      ))}
    </svg>
  );
}
