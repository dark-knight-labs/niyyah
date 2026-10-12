"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";

export interface PickOption { value: string; label: string }

interface Props {
  value: string;
  options: PickOption[];
  onChange: (value: string) => void;
  /** Names the control for screen readers. */
  label: string;
  /** Shown while no option matches `value`. */
  placeholder?: string;
  disabled?: boolean;
  /** Draws the trigger in the warning colour (an item with no checkpoint for too long). */
  warn?: boolean;
  className?: string;
}

/** The app's one dropdown: a square mono trigger and a hairline menu, in place of the browser's own select. */
export function Pick({ value, options, onChange, label, placeholder = "Choose", disabled, warn, className = "" }: Props) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger disabled={disabled} aria-label={label} title={label}
        className={`mono inline-flex h-8 max-w-full items-center justify-between gap-2 border bg-[var(--surface)] px-2.5 hover:bg-[var(--muted)] disabled:opacity-50 data-[state=open]:bg-[var(--muted)] ${warn ? "border-[var(--warn)] text-[var(--warn)]" : "border-[var(--rule)] text-[var(--foreground)]"} ${className}`}>
        <span className="min-w-0 truncate">{current?.label ?? placeholder}</span>
        <ChevronDown size={13} aria-hidden="true" className="shrink-0 text-[var(--muted-foreground)]" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} collisionPadding={12}
          className="z-50 max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto border border-[var(--rule)] bg-[var(--surface)] py-1 shadow-[0_12px_30px_rgba(0,0,0,0.2)]">
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            {options.map((o) => (
              <DropdownMenu.RadioItem key={o.value} value={o.value}
                className="flex min-h-8 cursor-pointer items-center gap-2 px-3 py-1 text-small outline-none data-[highlighted]:bg-[var(--muted)] data-[state=checked]:font-medium">
                <span className="min-w-0 flex-1 break-words">{o.label}</span>
                <DropdownMenu.ItemIndicator><Check size={13} aria-hidden="true" className="text-[var(--accent)]" /></DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
