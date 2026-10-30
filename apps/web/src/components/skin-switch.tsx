"use client";

import { useEffect, useState } from "react";

const KEY = "niy-skin";

/** The available skins. "paper" is the default and sets no attribute. Add one here and as a :root[data-skin] block in globals.css. */
export const SKINS = [
  { id: "paper", label: "Paper (current)" },
  { id: "admin", label: "Admin (blue-gray, IBM Plex)" },
  { id: "artcraft", label: "ArtCraft (blueprint, square)" },
  { id: "minimal", label: "Minimal (editorial mono)" },
  { id: "brutalist", label: "Brutalist (terminal, red)" },
  { id: "editorial", label: "Editorial (cream, serif)" },
  { id: "oled", label: "OLED (black, emerald)" },
] as const;

type SkinId = (typeof SKINS)[number]["id"];
const IDS = SKINS.map((s) => s.id);

/** Runs before first paint: ?skin=<id> wins and is remembered; otherwise the remembered skin. "kahf" is the old name of "admin". */
export const SKIN_BOOT = `try{var ids=${JSON.stringify(IDS)},k="${KEY}",q=new URLSearchParams(location.search).get("skin");if(q==="kahf")q="admin";if(q&&ids.indexOf(q)>=0)localStorage.setItem(k,q);var s=localStorage.getItem(k);if(s==="kahf")s="admin";if(s&&s!=="paper"&&ids.indexOf(s)>=0)document.documentElement.setAttribute("data-skin",s)}catch(e){}`;

/** Skin picker fixed to the bottom-right corner. Remove once a skin wins. */
export function SkinSwitch() {
  const [skin, setSkin] = useState<SkinId>("paper");
  useEffect(() => { setSkin((document.documentElement.getAttribute("data-skin") as SkinId | null) ?? "paper"); }, []);

  function pick(next: SkinId) {
    setSkin(next);
    if (next === "paper") document.documentElement.removeAttribute("data-skin");
    else document.documentElement.setAttribute("data-skin", next);
    try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice just does not stick */ }
  }

  return (
    <label className="fixed bottom-3 right-3 z-50 inline-flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-semibold text-[var(--muted-foreground)] shadow-sm">
      Skin
      <select value={skin} onChange={(e) => pick(e.target.value as SkinId)} aria-label="Skin" className="min-h-8 bg-transparent text-[var(--foreground)]">
        {SKINS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </label>
  );
}
