import { BLOCK_COLORS, BLOCK_LABELS, BLOCK_ORDER } from "@/lib/vault-constants";
import { VaultDayData } from "@/lib/vault-types";

interface BlockCardsProps {
  today: VaultDayData | null;
}

export function BlockCards({ today }: BlockCardsProps) {
  return (
    <div className="grid grid-cols-4 md:grid-cols-7 gap-2 mb-4">
      {BLOCK_ORDER.map((block) => {
        const stars = today?.blocks[block] ?? 0;
        const color = BLOCK_COLORS[block];
        return (
          <div
            key={block}
            className="border border-[var(--border)] rounded px-3 py-2"
            style={{ backgroundColor: stars > 0 ? `${color}14` : "var(--surface)" }}
          >
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color }}>
              {BLOCK_LABELS[block]}
            </p>
            <div className="flex items-center gap-1">
              {[1, 2, 3].map((level) => (
                <span
                  key={level}
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: level <= stars ? color : "var(--border)" }}
                />
              ))}
              <span className="font-mono text-xs ml-1 text-[var(--muted-foreground)]">{stars}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
