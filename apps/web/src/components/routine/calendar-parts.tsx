"use client";

import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { fmtDay } from "@/lib/week";

const INPUT = "min-h-9 min-w-0 rounded-none border border-[var(--border)] bg-[var(--surface)] px-3.5 text-small placeholder:text-[var(--muted-foreground)]";

/** The next half hour as HH:MM, for the new event's default start (capped so +1h stays on the same day). */
function nextHalfHour(): string {
  const now = new Date();
  const total = Math.min(22 * 60, (Math.floor((now.getHours() * 60 + now.getMinutes()) / 30) + 1) * 30);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function plusHour(hhmm: string): string {
  const hour = Math.min(23, Number(hhmm.slice(0, 2)) + 1);
  return `${String(hour).padStart(2, "0")}${hhmm.slice(2)}`;
}

/** Add an event to Google Calendar (primary) for `day`, starting at `start` when a grid slot was clicked; the list reloads through `onChanged`. */
export function AddEventForm({ day, start: initial, onChanged, onCancel }: { day: string; start?: string; onChanged: () => void; onCancel?: () => void }) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(initial ?? nextHalfHour);
  const [end, setEnd] = useState(() => plusHour(initial ?? nextHalfHour()));
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await vaultApi.addEvent(day, { title: title.trim(), start, end, location: location.trim() || null });
      setTitle("");
      setLocation("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the event.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap gap-1.5">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`New event · ${fmtDay(day, { weekday: "short", day: "numeric", month: "short" })}`} maxLength={200} aria-label="Event title" className={`${INPUT} min-w-[10rem] flex-1`} />
      <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" className={`${INPUT} w-28`} />
      <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End time" className={`${INPUT} w-28`} />
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" maxLength={200} aria-label="Location" className={`${INPUT} min-w-[8rem] flex-1`} />
      <button type="submit" disabled={busy || !title.trim() || !start || !end} className="min-h-9 rounded-none bg-[var(--accent)] px-3.5 text-small font-bold text-[var(--accent-fg)] disabled:opacity-50">Add event</button>
      {onCancel && <button type="button" onClick={onCancel} className="min-h-9 border border-[var(--border)] px-3 text-small font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)]">Cancel</button>}
      {error && <p role="alert" className="w-full text-xs text-[var(--destructive)]">{error}</p>}
    </form>
  );
}

export function ConnectButton() {
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setError(null);
    try {
      window.location.assign((await vaultApi.googleConnect()).url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the Google sign-in.");
    }
  }

  return (
    <div className="mt-2.5">
      <button type="button" onClick={connect} className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-small font-bold text-[var(--accent-fg)]">Connect Google Calendar</button>
      {error && <p role="alert" className="mt-2 text-xs text-[var(--destructive)]">{error}</p>}
    </div>
  );
}

/** "Meet", "Zoom" or "Teams" for a meeting link, else "call". */
export function meetingName(url: string): string {
  const host = new URL(url).hostname;
  if (host.endsWith("meet.google.com")) return "Meet";
  if (host.includes("zoom")) return "Zoom";
  if (host.includes("teams")) return "Teams";
  return "call";
}
