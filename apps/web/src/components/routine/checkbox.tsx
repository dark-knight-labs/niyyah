import { Check } from "lucide-react";

/** Square tick box with a 44px tap area; the native input stays for keyboard and screen readers. */
export function Checkbox({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return (
    <label className="relative -mx-2.5 grid h-11 w-11 shrink-0 cursor-pointer place-items-center">
      <input type="checkbox" className="peer absolute inset-0 cursor-pointer opacity-0" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
      <span className="grid h-[22px] w-[22px] place-items-center rounded-[7px] border-2 border-[var(--muted-foreground)] text-transparent transition peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] peer-checked:text-[var(--accent-fg)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]">
        <Check size={14} strokeWidth={3.5} />
      </span>
    </label>
  );
}
