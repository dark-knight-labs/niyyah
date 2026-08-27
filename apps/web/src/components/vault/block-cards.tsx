import type { CSSProperties } from "react";
import { Check } from "lucide-react";
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
            className="widget border border-[var(--border)] rounded px-2.5 pt-2.5 pb-2"
            style={
              {
                backgroundColor: stars > 0 ? `${color}14` : "var(--surface)",
                "--widget-accent": color,
              } as CSSProperties
            }
          >
            <p className="text-xs font-semibold tracking-tight mb-1.5" style={{ color }}>
              {BLOCK_LABELS[block]}
            </p>
            <div className="flex items-center gap-1">
              {/* Bullet-journal habit-tracker boxes: filled square = checked. */}
              {[1, 2, 3].map((level) => {
                const checked = level <= stars;
                return (
                  <span
                    key={level}
                    className="w-3.5 h-3.5 rounded-[2px] border flex items-center justify-center"
                    style={{
                      backgroundColor: checked ? color : "transparent",
                      borderColor: checked ? color : "var(--border)",
                    }}
                  >
                    {checked && <Check size={10} strokeWidth={3} color="var(--accent-fg)" />}
                  </span>
                );
              })}
              <span className="font-mono text-sm ml-1 tabular-nums text-[var(--muted-foreground)]">{stars}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
