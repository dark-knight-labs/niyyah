"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { StreamMeta } from "@/lib/streams";
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

/** Add an event to Google Calendar (primary) for `day`, from `start` to `end` when a grid slot was drawn; the list reloads through `onChanged`. */
export function AddEventForm({ day, start: initial, end: initialEnd, onChanged, onCancel }: { day: string; start?: string; end?: string; onChanged: () => void; onCancel?: () => void }) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(initial ?? nextHalfHour);
  const [end, setEnd] = useState(() => initialEnd ?? plusHour(initial ?? nextHalfHour()));
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

/** Add a task (any date, optionally in a stream) or a Google Calendar event (any date, start to end). The date starts on today. */
export function QuickAdd({ day, connected, streams, onAdded }: { day: string; connected: boolean; streams: StreamMeta[]; onAdded: () => void }) {
  const [kind, setKind] = useState<"task" | "event">("task");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [start, setStart] = useState(nextHalfHour);
  const [end, setEnd] = useState(() => plusHour(nextHalfHour()));
  const [stream, setStream] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const event = kind === "event";
  const date = picked ?? day;

  function changeStart(value: string) {
    setStart(value);
    if (value) setEnd(plusHour(value));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = title.trim();
    if (!text || !date) return;
    setBusy(true);
    setError(null);
    try {
      if (event) await vaultApi.addEvent(date, { title: text, start, end, location: null });
      else await vaultApi.addTask(date, text, stream);
      setTitle("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not add the ${kind}.`);
    } finally {
      setBusy(false);
    }
  }

  const KIND = "min-h-8 px-2.5 text-xs font-semibold aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)] text-[var(--muted-foreground)] disabled:opacity-40";
  const FIELD = "min-h-8 border border-[var(--border)] bg-[var(--surface)] px-2 text-small";
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" aria-label="Add a task or event">
      <span className="inline-flex shrink-0 border border-[var(--border)]" role="group" aria-label="Add as">
        <button type="button" aria-pressed={!event} onClick={() => setKind("task")} className={KIND}>Task</button>
        <button type="button" aria-pressed={event} disabled={!connected} title={connected ? undefined : "Connect Google Calendar to add events"} onClick={() => setKind("event")} className={KIND}>Event</button>
      </span>
      <input id="quick-add-title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }} maxLength={event ? 200 : 300} placeholder={event ? "New event" : "New task #tag"} aria-label={event ? "Event title" : "Task title"}
        className="min-h-8 min-w-[8rem] flex-1 border border-[var(--border)] bg-[var(--surface)] px-2.5 text-small placeholder:text-[var(--muted-foreground)]" />
      <input type="date" value={date} onChange={(e) => setPicked(e.target.value || null)} aria-label="Date" className={`${FIELD} w-[9.5rem]`} />
      {event ? (
        <>
          <input type="time" value={start} onChange={(e) => changeStart(e.target.value)} aria-label="Start time" className={`${FIELD} w-[6.5rem]`} />
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End time" className={`${FIELD} w-[6.5rem]`} />
        </>
      ) : streams.length > 0 && (
        <select value={stream ?? ""} onChange={(e) => setStream(e.target.value || null)} aria-label="Stream" title="Stream" className={`${FIELD} max-w-[9rem]`}>
          <option value="">No stream</option>
          {streams.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      )}
      <button type="submit" disabled={busy || !title.trim() || !date || (event && (!start || !end))} aria-label={`Add ${kind}`} className="inline-flex min-h-8 items-center gap-1 bg-[var(--accent)] px-3 text-xs font-bold text-[var(--accent-fg)] disabled:opacity-50"><Plus size={13} aria-hidden="true" />Add</button>
      {error && <p role="alert" className="w-full text-xs text-[var(--destructive)]">{error}</p>}
    </form>
  );
}
