"use client";

import { useEffect, useState } from "react";
import { CHIP, SettingsSection } from "@/components/settings/section";
import { applyResolvedTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api-client";

const THEMES = ["system", "light", "dark"] as const;

/** Light, dark or follow the system; saved to the account and applied at once. */
export function AppearanceSection() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => { api.get<{ theme: string }>("/settings").then((s) => setTheme(s.theme)).catch(() => setTheme("system")); }, []);

  async function pick(next: string) {
    setTheme(next);
    applyResolvedTheme(next);
    try {
      await api.patch("/settings", { theme: next });
    } catch {
      // the choice still applies on this device; it will save the next time
    }
  }

  return (
    <SettingsSection id="appearance" title="Appearance">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Theme">
        {THEMES.map((t) => (
          <button key={t} type="button" className={CHIP} aria-pressed={theme === t} onClick={() => void pick(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
    </SettingsSection>
  );
}
