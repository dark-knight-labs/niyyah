"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { logout } from "@/lib/auth";
import { BlocksProvider } from "@/lib/blocks";
import {
  Activity,
  Clock,
  ListChecks,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const NAV_COLLAPSED_KEY = "niyyah-nav-collapsed";

// Readable without signing in; every other page in this group requires a session.
const PUBLIC_PATHS = ["/"];

const nav = [
  { href: "/", label: "Overview", icon: Clock },
  { href: "/plan", label: "Plan", icon: ListChecks },
  { href: "/vault", label: "Vault", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** The ring-and-dot mark: the 24-hour ring with its gap, and the intention at the centre. */
function NiyyahMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="14" cy="14" r="10" stroke="currentColor" strokeWidth="2.4" strokeDasharray="46 17" strokeLinecap="round" transform="rotate(-70 14 14)" />
      <circle cx="14" cy="14" r="3" fill="currentColor" />
    </svg>
  );
}

/** Account avatar at the foot of the sidebar; opens a small menu with the email, Settings and Sign out. */
function AccountMenu({ email, collapsed }: { email: string; collapsed: boolean }) {
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
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-small hover:bg-[var(--muted)]";
  return (
    <div ref={ref} className="relative border-t border-[var(--border)] pt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label="Account"
        className={`flex w-full items-center gap-2.5 rounded-lg p-1 hover:bg-[var(--muted)] ${collapsed ? "justify-center" : ""}`}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--muted)] text-xs font-semibold uppercase">{email.slice(0, 1)}</span>
        {!collapsed && <span className="min-w-0 truncate text-xs text-[var(--muted-foreground)]">{email}</span>}
      </button>
      {open && (
        <div role="menu" className="absolute bottom-2 left-full z-30 ml-2 w-52 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl">
          <p className="truncate px-2 py-1.5 text-xs text-[var(--muted-foreground)]">{email}</p>
          <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className={item}><Settings size={14} aria-hidden="true" />Settings</Link>
          <button type="button" role="menuitem" onClick={logout} className={item}><LogOut size={14} aria-hidden="true" />Sign out</button>
        </div>
      )}
    </div>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const { user, loading } = useAuth(!isPublic);
  useTheme();

  // Defaults to collapsed; a stored preference (from a prior toggle) wins.
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(NAV_COLLAPSED_KEY);
    if (stored !== null) setCollapsed(stored === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
      return next;
    });
  }

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
        <header className="flex items-center justify-between px-6 py-4">
          <h1 className="text-lg font-bold tracking-tight">Niyyah <span className="text-xs font-normal text-[var(--muted-foreground)]" dir="rtl">نِيَّة</span></h1>
          <Link href="/login" className="text-sm text-[var(--accent)] hover:underline">Sign in</Link>
        </header>
        <main className="px-6 pb-6">{children}</main>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen flex">
      <aside
        className={`sticky top-0 h-screen shrink-0 self-start border-r border-[var(--border)] flex flex-col justify-between p-4 hidden md:flex transition-[width] duration-200 ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        <div>
          <Link href="/" aria-label="Niyyah" title="Niyyah" className={`mb-6 flex min-h-10 items-center gap-2.5 text-[var(--accent)] ${collapsed ? "justify-center" : "px-1"}`}>
            <NiyyahMark />
            {!collapsed && <span className="font-serif text-lg font-medium leading-none text-[var(--foreground)]">Niyyah</span>}
          </Link>
          <nav className="space-y-1">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-3 px-3 py-2 text-sm rounded transition active:scale-[0.98] ${
                    collapsed ? "justify-center" : ""
                  } ${
                    active
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--foreground)] hover:bg-[var(--muted)]"
                  }`}
                >
                  <item.icon size={16} className="shrink-0" />
                  {!collapsed && item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-1/2 z-10 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] active:scale-90"
        >
          {collapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>
        <AccountMenu email={user.email} collapsed={collapsed} />
      </aside>

      <main className="min-w-0 flex-1 overflow-x-clip px-4 pb-24 pt-6 sm:px-6 md:pb-8 xl:px-10">
        {children}
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex gap-1 overflow-x-auto border-t border-[var(--border)] bg-[var(--background)] px-2 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1 md:hidden">
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
              className={`flex min-h-12 min-w-[4.5rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-micro font-semibold ${active ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]"}`}>
              <item.icon size={19} aria-hidden="true" />
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
