"use client";

import { useEffect } from "react";
import { api } from "@/lib/api-client";
import { isAuthenticated } from "@/lib/auth";

interface ThemeSetting {
  theme: string;
}

export function applyResolvedTheme(theme: string) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function useTheme() {
  useEffect(() => {
    let cancelled = false;

    // Public pages have no session, so there are no saved settings to fetch.
    if (!isAuthenticated()) {
      applyResolvedTheme("light");
      return;
    }

    api
      .get<ThemeSetting>("/settings")
      .then((settings) => {
        if (!cancelled) applyResolvedTheme(settings.theme);
      })
      .catch(() => {
        if (!cancelled) applyResolvedTheme("light");
      });

    return () => {
      cancelled = true;
    };
  }, []);
}
