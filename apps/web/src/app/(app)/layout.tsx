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
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const NAV_COLLAPSED_KEY = "niyyah-nav-collapsed";

const nav = [
  { href: "/vault", label: "Vault", icon: Activity },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/personas", label: "Personas", icon: Users },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/principles", label: "Principles", icon: Compass },
  { href: "/tracker", label: "Tracker", icon: CheckSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
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
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] shrink-0"
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
                  className={`flex items-center gap-3 px-3 py-2 text-sm rounded transition-colors ${
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
            className={`flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] ${
              collapsed ? "justify-center w-full" : ""
            }`}
          >
            <LogOut size={14} className="shrink-0" />
            {!collapsed && "Sign out"}
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  );
}
