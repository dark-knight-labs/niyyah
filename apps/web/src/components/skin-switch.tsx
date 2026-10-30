"use client";

import { useEffect, useState } from "react";

const KEY = "niy-skin";

/** Runs before first paint: ?skin=kahf|paper wins and is remembered; otherwise the remembered skin. No attribute means paper. */
export const SKIN_BOOT = `try{var q=new URLSearchParams(location.search).get("skin");if(q==="kahf"||q==="paper")localStorage.setItem("${KEY}",q);if(localStorage.getItem("${KEY}")==="kahf")document.documentElement.setAttribute("data-skin","kahf")}catch(e){}`;

/** A/B switch between the paper skin and the kahf skin, fixed to the bottom-right corner. Remove once one wins. */
export function SkinSwitch() {
  const [skin, setSkin] = useState<"paper" | "kahf">("paper");
  useEffect(() => { setSkin(document.documentElement.getAttribute("data-skin") === "kahf" ? "kahf" : "paper"); }, []);

  function pick(next: "paper" | "kahf") {
    setSkin(next);
    if (next === "kahf") document.documentElement.setAttribute("data-skin", "kahf");
    else document.documentElement.removeAttribute("data-skin");
    try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice just does not stick */ }
  }

  return (
    <div role="group" aria-label="Skin" className="fixed bottom-3 right-3 z-50 inline-flex border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold shadow-sm">
      {(["paper", "kahf"] as const).map((s) => (
        <button key={s} type="button" aria-pressed={skin === s} onClick={() => pick(s)}
          className={`min-h-8 px-2.5 ${skin === s ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`}>{s}</button>
      ))}
    </div>
  );
}
