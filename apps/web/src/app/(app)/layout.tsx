"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useTheme } from "@/hooks/use-theme";
import { logout } from "@/lib/auth";
import { BlocksProvider } from "@/lib/blocks";
import {
  Activity,
  Clock,
  ListChecks,
  Settings,
  LogOut,
} from "lucide-react";

// Readable without signing in; every other page in this group requires a session.
const PUBLIC_PATHS = ["/"];

const nav = [
  { href: "/", label: "Overview", icon: Clock, key: "o" },
  { href: "/plan", label: "Plan", icon: ListChecks, key: "p" },
  { href: "/progress", label: "Progress", icon: Activity, key: "r" },
  { href: "/settings", label: "Settings", icon: Settings, key: "s" },
];

/** The ring-and-dot mark: the 24-hour ring with its gap, and the intention at the centre. */
function NiyyahMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="14" cy="14" r="10" stroke="currentColor" strokeWidth="2.4" strokeDasharray="46 17" strokeLinecap="round" transform="rotate(-70 14 14)" />
      <circle cx="14" cy="14" r="3" fill="currentColor" />
    </svg>
  );
}

/** Account cell at the right end of the top bar; opens a small menu with the email, Settings and Sign out. */
function AccountMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-small hover:bg-[var(--muted)]";
  return (
    <div ref={ref} className="relative flex border-l border-[var(--border)]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label="Account"
        className="flex items-center gap-2.5 px-4 hover:bg-[var(--muted)]">
        <span className="grid h-6 w-6 place-items-center border border-[var(--rule)] bg-[var(--muted)] mono text-[var(--foreground)]">{email.slice(0, 1)}</span>
        <span className="mono hidden max-w-[14rem] truncate text-[var(--muted-foreground)] md:block">{email}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 w-52 border border-[var(--rule)] bg-[var(--surface)] shadow-xl">
          <p className="truncate border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">{email}</p>
          <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className={item}><Settings size={14} aria-hidden="true" />Settings</Link>
          <button type="button" role="menuitem" onClick={logout} className={item}><LogOut size={14} aria-hidden="true" />Sign out</button>
        </div>
      )}
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" aria-label="Niyyah" className="flex items-center gap-2.5 border-r border-[var(--border)] px-4 text-[var(--accent)]">
      <NiyyahMark />
      <span className="font-serif text-lg font-medium leading-none text-[var(--foreground)]">Niyyah</span>
    </Link>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const { user, loading } = useAuth(!isPublic);
  const router = useRouter();
  useTheme();
  // "g" then a letter goes to a page, like the hint on each tab says.
  useHotkeys(user ? Object.fromEntries(nav.map((item) => [`g ${item.key}`, () => router.push(item.href)])) : {});

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user && isPublic) {
    return (
      <div className="min-h-screen">
        <header className="flex h-11 items-stretch border-b border-[var(--rule)] bg-[var(--background)]">
          <Brand />
          <span className="flex-1" />
          <Link href="/login" className="mono flex items-center border-l border-[var(--border)] bg-[var(--accent)] px-4 text-[var(--accent-fg)]">Sign in</Link>
        </header>
        <main className="px-4 py-4 sm:px-6">{children}</main>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-11 items-stretch border-b border-[var(--rule)] bg-[var(--background)]">
        <Brand />
        <nav aria-label="Main" className="hidden flex-1 md:flex">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} title={`${item.label} (g ${item.key})`} aria-keyshortcuts={`g ${item.key}`}
                className={`mono flex items-center border-r border-[var(--border)] px-4 ${active ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <span className="flex-1 md:hidden" />
        {/* The Overview page puts the date, mode and stars here (see TopBar). */}
        <div id="nav-today" className="hidden items-stretch md:flex" />
        <AccountMenu email={user.email} />
      </header>

      <main className="min-w-0 overflow-x-clip px-4 pb-24 pt-4 sm:px-6 md:pb-8">
        {children}
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t border-[var(--rule)] bg-[var(--background)] pb-[max(env(safe-area-inset-bottom),0px)] md:hidden">
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
              className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 px-2 mono ${active ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "text-[var(--muted-foreground)]"}`}>
              <item.icon size={17} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <BlocksProvider>
      <AppShell>{children}</AppShell>
    </BlocksProvider>
  );
}
