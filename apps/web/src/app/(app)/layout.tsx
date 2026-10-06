"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { logout } from "@/lib/auth";
import {
  LayoutDashboard,
  Users,
  Calendar,
  Compass,
  CheckSquare,
  Activity,
  Clock,
  CalendarDays,
  Layers3,
  Target,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const NAV_COLLAPSED_KEY = "niyyah-nav-collapsed";

// Readable without signing in; every other page in this group requires a session.
const PUBLIC_PATHS = ["/routine"];

const nav = [
  { href: "/routine", label: "Routine", icon: Clock },
  { href: "/week", label: "Week", icon: CalendarDays },
  { href: "/quarter", label: "Quarter", icon: Target },
  { href: "/pipelines", label: "Pipelines", icon: Layers3 },
  { href: "/vault", label: "Vault", icon: Activity },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/personas", label: "Personas", icon: Users },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/principles", label: "Principles", icon: Compass },
  { href: "/tracker", label: "Tracker", icon: CheckSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
        className={`border-r border-[var(--border)] flex flex-col justify-between p-4 hidden md:flex transition-[width] duration-200 ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        <div>
          <div className="flex items-center justify-between mb-6 gap-2">
            {!collapsed && (
              <Link href="/vault" className="block min-w-0">
                <h1 className="text-lg font-bold tracking-tight">Niyyah</h1>
                <p className="text-xs text-[var(--muted-foreground)]" dir="rtl">نِيَّة</p>
              </Link>
            )}
            <button
              onClick={toggleCollapsed}
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] shrink-0 transition-colors active:scale-90"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
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
        <div className="border-t border-[var(--border)] pt-4">
          {!collapsed && (
            <p className="text-xs text-[var(--muted-foreground)] truncate mb-2">{user.email}</p>
          )}
          <button
            onClick={logout}
            title={collapsed ? "Sign out" : undefined}
            className={`flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors active:scale-95 ${
              collapsed ? "justify-center w-full" : ""
            }`}
          >
            <LogOut size={14} className="shrink-0" />
            {!collapsed && "Sign out"}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto px-4 pb-24 pt-6 sm:px-6 md:pb-8 xl:px-10">
        {children}
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex gap-1 overflow-x-auto border-t border-[var(--border)] bg-[var(--background)] px-2 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1 md:hidden">
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
              className={`flex min-h-12 min-w-[4.5rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[11px] font-semibold ${active ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]"}`}>
              <item.icon size={19} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
