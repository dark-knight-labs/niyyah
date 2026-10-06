import { ChevronRight } from "lucide-react";
import { DominoChain } from "@/components/planner/domino-chain";
import { MONTH_LABEL } from "@/lib/streams";
import { QuarterStreamData, VaultObjective } from "@/lib/vault-types";

/** Quarter goal > month checkpoint > week objective: where this work sits in the chain. */
export function ChainCrumbs({ goal, objective, color, showWeek = true }: { goal?: QuarterStreamData; objective?: VaultObjective | null; color: string; showWeek?: boolean }) {
  const month = objective?.checkpoint ?? goal?.checkpoints[0]?.month ?? null;
  const checkpoint = goal?.checkpoints.find((c) => c.month === month);
  const first = (goal?.goal ?? "").split(/[.;]/)[0];
  return (
    <nav aria-label="Where this sits in the chain" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted-foreground)]">
      <span style={{ color }}><DominoChain count={4} height={22} /></span>
      <Crumb label="Quarter goal" value={first || "not set"} />
      <ChevronRight size={13} aria-hidden="true" />
      <Crumb label={month ? MONTH_LABEL[month] : "Month"} value={checkpoint?.text.split(" · ")[0] ?? "no checkpoint"} />
      {showWeek && (
        <>
          <ChevronRight size={13} aria-hidden="true" />
          <Crumb label="This week" value={objective?.text || "not chosen"} />
        </>
      )}
    </nav>
  );
}

function Crumb({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0">
      <span className="mr-1.5">{label}</span>
      <b className="font-bold text-[var(--foreground)]">{value}</b>
    </span>
  );
}
