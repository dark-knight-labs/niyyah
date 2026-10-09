import { Check } from "lucide-react";
import { useBlocks } from "@/lib/blocks";
import { VaultDayData } from "@/lib/vault-types";

interface BlockCardsProps {
  today: VaultDayData | null;
}

export function BlockCards({ today }: BlockCardsProps) {
  const blocks = useBlocks();
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-7 gap-1.5">
      {blocks.forDay(today?.blocks).filter((b) => b.counts_for_stars).map((b) => {
        const block = b.key;
        const stars = today?.blocks[block] ?? 0;
        const color = blocks.color(block);
        return (
          <div
            key={block}
            className="border border-[var(--border)] rounded-lg px-2 pt-1.5 pb-1.5"
            style={{ backgroundColor: stars > 0 ? `color-mix(in srgb, ${color} 8%, var(--surface))` : "var(--surface)" }}
          >
            <p className="text-xs font-semibold tracking-tight mb-1" style={{ color }}>
              {b.label}
            </p>
            <div className="flex items-center gap-1">
              {/* Bullet-journal habit-tracker boxes: filled square = checked. */}
              {[1, 2, 3].map((level) => {
                const checked = level <= stars;
                return (
                  <span
                    key={level}
                    className="w-3.5 h-3.5 rounded-[0.125rem] border flex items-center justify-center"
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
