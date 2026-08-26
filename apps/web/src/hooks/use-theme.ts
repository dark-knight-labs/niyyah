"use client";

import { useEffect } from "react";
import { api } from "@/lib/api-client";

interface ThemeSetting {
  theme: string;
}

function applyResolvedTheme(theme: string) {
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
