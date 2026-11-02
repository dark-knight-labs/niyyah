"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { parseQuick, quickDay, type QuickParse } from "@/lib/items";
import { formatMinutes } from "@/lib/routine";
import { vaultApi } from "@/lib/vault-api";
import { StreamMeta } from "@/lib/streams";
import type { ItemCreate } from "@/lib/vault-types";
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

/** What a quick-add line will make: day, time (or all day), tags and stream, and a word when a typed time was not understood. */
export function quickPreview(p: QuickParse, day: string, google = false): string {
  if (!p.title) return "Type a title. Add a day (fri, tomorrow), a time like 14:00-15:00, #tags.";
  const when = p.start !== null && p.end !== null ? `${formatMinutes(p.start)}–${formatMinutes(Math.min(1439, p.end))}` : "all day";
  const bits = [`→ ${fmtDay(day, { weekday: "short", day: "numeric", month: "short" })}`, when, ...(p.tags.length ? [p.tags.map((t) => `#${t}`).join(" ")] : []), ...(p.stream ? [`@${p.stream}`] : []), ...(google ? ["Google Calendar"] : [])];
  return `${bits.join(" · ")}${p.bad ? " · time not understood, added as all day" : ""}`;
}

/**
 * One line adds an item. `#tag` words become tags; `14:00-15:00` or `14:00 45m` makes it timed (no time = all day); `today`,
 * `tomorrow` or a weekday of the shown week picks the day (none = the focused day), and with a day, `@stream` sets the stream.
 * A timed line can go to Google Calendar instead of Niyyah (the toggle shows when Google is connected). The preview says where it lands.
 */
export function QuickAdd({ focus, today, days, connected, streams, onCreate, onAdded }: {
  focus: string; today: string; days: string[]; connected: boolean; streams: StreamMeta[]; onCreate: (item: ItemCreate) => Promise<boolean>; onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [google, setGoogle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseQuick(title, streams);
  const day = quickDay(parsed, { today, days, focus });
  const timed = parsed.start !== null && parsed.end !== null;
  const toGoogle = google && timed && connected;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed.title) return;
    setBusy(true);
    setError(null);
    try {
      if (toGoogle) {
        if (parsed.title.length > 200) throw new Error("A Google event title can be 200 characters at most.");
        await vaultApi.addEvent(day, { title: parsed.title, start: formatMinutes(parsed.start as number), end: formatMinutes(Math.min(1439, parsed.end as number)), location: null });
      } else {
        const when = timed ? { start_min: parsed.start as number, end_min: parsed.end as number } : {};
        if (!(await onCreate({ day, text: parsed.title, products: parsed.tags, stream: parsed.stream, ...when }))) throw new Error("Could not add the item.");
      }
      setTitle("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-w-[14rem] flex-1 items-start gap-1.5" aria-label="Add a task or event">
      <div className="relative min-w-0 flex-1">
        <input id="quick-add-title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }} maxLength={300}
          placeholder="Add: fri 14:00-15:00 call #work" aria-label="Add a task or event" aria-describedby="quick-add-preview" style={title.trim() ? { paddingRight: "min(52%, 24rem)" } : undefined}
          className="min-h-8 w-full border border-[var(--border)] bg-[var(--surface)] px-2.5 text-small placeholder:text-[var(--muted-foreground)] max-lg:!pr-2.5" />
        {title.trim() && (
          <p id="quick-add-preview" aria-live="polite" title={quickPreview(parsed, day, toGoogle)}
            className={`pointer-events-none px-0.5 pt-0.5 font-mono text-micro lg:absolute lg:inset-y-0 lg:right-2 lg:flex lg:max-w-[50%] lg:items-center lg:truncate lg:p-0 ${parsed.bad ? "text-[var(--warn)]" : "text-[var(--muted-foreground)]"}`}>
            <span className="truncate">{quickPreview(parsed, day, toGoogle)}</span>
          </p>
        )}
        {error && <p role="alert" className="pt-0.5 text-xs text-[var(--destructive)]">{error}</p>}
      </div>
      {connected && timed && (
        <button type="button" aria-pressed={google} onClick={() => setGoogle(!google)} title="Make a Google Calendar event instead of a Niyyah item"
          className="min-h-8 shrink-0 whitespace-nowrap border border-[var(--border)] px-2 text-xs font-semibold text-[var(--muted-foreground)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]">Put in Google Calendar</button>
      )}
      <button type="submit" disabled={busy || !parsed.title} aria-label="Add item" className="inline-flex min-h-8 shrink-0 items-center gap-1 bg-[var(--accent)] px-3 text-xs font-bold text-[var(--accent-fg)] disabled:opacity-50"><Plus size={13} aria-hidden="true" />Add</button>
    </form>
  );
}
