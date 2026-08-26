"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { logout } from "@/lib/auth";
import {
  LayoutDashboard,
  Users,
  Calendar,
  Compass,
  CheckSquare,
  Settings,
  LogOut,
} from "lucide-react";

const nav = [
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
      <aside className="w-56 border-r border-[var(--border)] flex flex-col justify-between p-4 hidden md:flex">
        <div>
          <Link href="/dashboard" className="block mb-6">
            <h1 className="text-lg font-bold tracking-tight">Niyyah</h1>
            <p className="text-xs text-[var(--muted-foreground)]" dir="rtl">نِيَّة</p>
          </Link>
          <nav className="space-y-1">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 text-sm rounded transition-colors ${
                    active
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--foreground)] hover:bg-[var(--muted)]"
                  }`}
                >
                  <item.icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="border-t border-[var(--border)] pt-4">
          <p className="text-xs text-[var(--muted-foreground)] truncate mb-2">{user.email}</p>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  );
}
