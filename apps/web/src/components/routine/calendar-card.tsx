"use client";

import { useState } from "react";
import { formatMinutes } from "@/lib/routine";
import { formatDuration } from "@/lib/ring";
import { vaultApi } from "@/lib/vault-api";
import { GoogleStatusData, VaultEventsData } from "@/lib/vault-types";
import { Section } from "@/components/routine/section";

const INPUT = "min-h-9 min-w-0 rounded-[0.375rem] border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm placeholder:text-[var(--muted-foreground)]";

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

/** Add an event to Google Calendar (primary) for `day`; the list reloads through `onChanged`. */
function AddEventForm({ day, onChanged }: { day: string; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(nextHalfHour);
  const [end, setEnd] = useState(() => plusHour(nextHalfHour()));
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
    <form onSubmit={submit} className="mt-1.5 space-y-1.5">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New event" maxLength={200} aria-label="Event title" className={`${INPUT} w-full`} />
      <div className="flex gap-2">
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" className={`${INPUT} flex-1`} />
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End time" className={`${INPUT} flex-1`} />
      </div>
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" maxLength={200} aria-label="Location" className={`${INPUT} w-full`} />
      <button type="submit" disabled={busy || !title.trim() || !start || !end} className="min-h-9 rounded-[0.375rem] bg-[var(--accent)] px-3.5 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50">Add event</button>
      {error && <p role="alert" className="text-xs text-[var(--destructive)]">{error}</p>}
    </form>
  );
}

function ConnectButton() {
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
      <button type="button" onClick={connect} className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-bold text-[var(--accent-fg)]">Connect Google Calendar</button>
      {error && <p role="alert" className="mt-2 text-xs text-[var(--destructive)]">{error}</p>}
    </div>
  );
}

/** "Meet", "Zoom" or "Teams" for a meeting link, else "call". */
function meetingName(url: string): string {
  const host = new URL(url).hostname;
  if (host.endsWith("meet.google.com")) return "Meet";
  if (host.includes("zoom")) return "Zoom";
  if (host.includes("teams")) return "Teams";
  return "call";
}

/** Today's events from your calendar feeds (Settings > Calendars); new ones go to Google Calendar. */
export function CalendarCard({ day, data, status, onChanged }: { day: string | null; data: VaultEventsData | null; status: GoogleStatusData | null; onChanged: () => void }) {
  if (!data) return null;
  return (
    <Section title="Calendar" aside={`${data.events.length} today`}>
      {data.errors.length > 0 && <p className="mb-2 text-xs text-[var(--destructive)]">Could not read: {data.errors.join(", ")}</p>}
      {data.events.length === 0 ? (
        <p className="py-2 text-sm text-[var(--muted-foreground)]">No events today.</p>
      ) : (
        <ul>
          {data.events.map((e, i) => (
            <li key={`${e.calendar}-${e.title}-${i}`} className="flex gap-3 border-b border-[var(--border)] py-1.5 text-[0.8125rem]" style={{ borderLeft: `3px solid ${e.color ?? "var(--border)"}`, paddingLeft: 10 }}>
              <span className="w-[6.5rem] shrink-0 tabular-nums text-[var(--muted-foreground)]">
                {e.all_day || e.start_min === null || e.end_min === null ? "All day" : `${formatMinutes(e.start_min)}–${formatMinutes(e.end_min)}`}
              </span>
              <span className="min-w-0 flex-1">
                <span className="break-words">{e.title}</span>
                <span className="block text-xs text-[var(--muted-foreground)]">
                  {e.calendar}
                  {e.start_min !== null && e.end_min !== null && e.end_min > e.start_min ? ` · ${formatDuration(e.end_min - e.start_min)}` : ""}
                  {e.location ? ` · ${e.location}` : ""}
                </span>
              </span>
              {e.meeting_url && (
                <a href={e.meeting_url} target="_blank" rel="noopener noreferrer" aria-label={`Join: ${e.title}`}
                  className="inline-flex min-h-8 shrink-0 items-center self-start whitespace-nowrap rounded-[0.3125rem] border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-light)]">
                  Join {meetingName(e.meeting_url)}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {status?.connected && day && <AddEventForm day={day} onChanged={onChanged} />}
      {status?.configured && !status.connected && <ConnectButton />}
      {status && !status.configured && <p className="mt-2 text-xs text-[var(--muted-foreground)]">Google Calendar is not set up on the server yet.</p>}
      {data.events.some((e) => e.calendar !== "Google Calendar") && status?.connected && (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">Events from other calendars are read-only here.</p>
      )}
    </Section>
  );
}
