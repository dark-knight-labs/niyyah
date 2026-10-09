"use client";

import { useRef } from "react";

/** The app's one checkbox: a 14px square with a 36px tap area. Ticking it draws the tick, rings once and flashes the row if the row has `data-check-row`. */
export function Checkbox({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  const box = useRef<HTMLLabelElement>(null);

  function change() {
    if (!checked && box.current) {
      const el = box.current;
      el.classList.remove("pulse");
      void el.offsetWidth; // restart the animation when ticked twice in a row
      el.classList.add("pulse");
      const row = el.closest("[data-check-row]");
      if (row) {
        row.classList.remove("niy-flash");
        void (row as HTMLElement).offsetWidth;
        row.classList.add("niy-flash");
      }
    }
    onChange();
  }

  return (
    <label ref={box} className="niy-cb">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={change} aria-label={label} />
      <span className="niy-cb-box" />
      <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.2 7.4l2.6 2.6 5-5.6" /></svg>
      <span className="niy-cb-ring" />
    </label>
  );
}
