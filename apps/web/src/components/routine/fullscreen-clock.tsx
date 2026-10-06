"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ROUTINE_BLOCKS, ResolvedDay, formatMinutes } from "@/lib/routine";
import { duration, formatDuration } from "@/lib/ring";
import { RingGraphic } from "@/components/routine/ring-graphic";

interface Props {
  day: ResolvedDay;
  nowMin: number;
  onClose: () => void;
}

/** Only the clock, filling the screen, every block labelled beside it. Esc or the button leaves. */
export function FullScreenClock({ day, nowMin, onClose }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [portrait, setPortrait] = useState(false);
  const close = useRef(onClose);

  useEffect(() => { close.current = onClose; });

  useEffect(() => {
    const measure = () => setPortrait(window.innerHeight > window.innerWidth * 1.05);
    measure();
    window.addEventListener("resize", measure);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    // Also ask the browser for real full screen; the overlay works without it.
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onFsChange = () => !document.fullscreenElement && close.current();
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFsChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-[var(--background)] p-4" role="dialog" aria-label="Full screen clock">
      <button onClick={onClose} className="fixed right-4 top-4 z-10 flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--background)] px-3.5 text-[13px] font-semibold hover:bg-[var(--muted)]">
        <X size={14} /> Close
      </button>
      {portrait ? (
        <>
          <svg viewBox="0 0 760 700" className="mx-auto block h-auto w-full max-w-[760px] select-none" aria-label="24-hour routine ring">
            <RingGraphic day={day} nowMin={nowMin} cx={380} cy={350} r={250} t={44} height={700} nameSize={14} clockSize={72} pop={1.1}
              hover={hover} onHover={setHover} prayers={false} sideLabels={false} idPrefix="fsp" />
          </svg>
          <ul className="mx-auto grid w-full max-w-md gap-4 pb-6">
            {day.blocks.map((b) => (
              <li key={`${b.block}-${b.startMin}`} className="border-l-4 pl-3" style={{ borderColor: ROUTINE_BLOCKS[b.block].color }}>
                <p className="font-bold">{ROUTINE_BLOCKS[b.block].label}</p>
                <p className="text-sm text-[var(--muted-foreground)]">{formatMinutes(b.startMin)} – {formatMinutes(b.endMin)}</p>
                <p className="text-sm text-[var(--muted-foreground)]">{formatDuration(duration(b))}</p>
                <p className="text-sm">{b.what}</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <svg viewBox="0 0 1240 800" className="m-auto block h-full max-h-screen w-full select-none" aria-label="24-hour routine ring">
          <RingGraphic day={day} nowMin={nowMin} cx={620} cy={400} r={262} t={48} height={800} nameSize={14} clockSize={76} pop={1.1}
            hover={hover} onHover={setHover} prayers={false} sideLabels idPrefix="fs" />
        </svg>
      )}
    </div>
  );
}
