"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { shortcutsFor, scopeOfPath, SHORTCUTS, ShortcutScope } from "@/lib/shortcuts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathname: string;
}

/**
 * The "?" sheet for every page but the Map: the keys that work everywhere, then the ones of the page you are on.
 * `data-shortcut-help` tells the key handlers to stand down while it is open (hooks/use-hotkeys.ts, plan-table.tsx).
 * "?" again or Esc closes it, the way the Map's own sheet does.
 */
export function ShortcutHelp({ open, onOpenChange, pathname }: Props) {
  const rows = shortcutsFor(pathname);
  const scopes: ShortcutScope[] = ["Everywhere", ...(scopeOfPath(pathname) ? [scopeOfPath(pathname)!] : [])];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content data-shortcut-help="" aria-describedby={undefined} data-testid="shortcut-help"
          onKeyDown={(e) => { if (e.key === "?") { e.preventDefault(); onOpenChange(false); } }}
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-[var(--rule)] bg-[var(--surface)] text-[var(--foreground)] shadow-xl outline-none">
          <div className="flex h-11 items-center justify-between border-b border-[var(--border)] px-4">
            <Dialog.Title className="mono text-[var(--muted-foreground)]">Keyboard shortcuts</Dialog.Title>
            <Dialog.Close aria-label="Close" className="mono px-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">×</Dialog.Close>
          </div>
          {scopes.map((scope) => (
            <section key={scope} aria-label={scope} data-scope={scope}>
              <h3 className="mono border-b border-[var(--border)] px-4 py-2 text-[var(--muted-foreground)]">{scope}</h3>
              <dl className="px-4 py-1">
                {rows.filter((r) => r.scope === scope).map((r) => (
                  <div key={r.combo} data-kbd={r.combo} className="flex items-baseline gap-4 border-b border-[var(--border)] py-1.5 last:border-b-0">
                    <dt className="mono w-28 shrink-0 text-[var(--accent)]">{r.show}</dt>
                    <dd className="text-small">{r.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="mono border-t border-[var(--border)] px-4 py-2 text-[var(--muted-foreground)]">
            The Map has its own list: press ? there. {SHORTCUTS.length} keys listed here.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
