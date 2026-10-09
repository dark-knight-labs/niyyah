"use client";

import { useCallback, useEffect, useState } from "react";
import { FIELD, SettingsSection } from "@/components/settings/section";
import { vaultApi } from "@/lib/vault-api";
import { FeedData } from "@/lib/vault-types";


/** iCal calendars whose events show on the Overview. Addresses are private: the page only ever sees the host. */
export function FeedsSection() {
  const [feeds, setFeeds] = useState<FeedData[] | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => vaultApi.feeds().then(setFeeds).catch(() => setFeeds([])), []);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await vaultApi.addFeed(name, url);
      setName("");
      setUrl("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the calendar");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setError(null);
    try {
      await vaultApi.removeFeed(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the calendar");
    }
  }

  return (
    <SettingsSection id="calendars" title="Calendars" aside="Events show on the Overview, with Join links">
      {feeds && feeds.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No calendars yet.</p>}
      <ul>
        {(feeds ?? []).map((f) => (
          <li key={f.id} className="flex items-center gap-3 border-t border-[var(--border)] py-2 first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{f.name}</p>
              <p className="truncate font-mono text-xs text-[var(--muted-foreground)]">{f.host}/••••••••</p>
            </div>
            <button type="button" onClick={() => void remove(f.id)} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--muted)]">Remove</button>
          </li>
        ))}
      </ul>
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
        <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Family" aria-label="Calendar name" />
        <input className={`${FIELD} font-mono`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Private iCal address (https://…)" aria-label="iCal address" />
        <button type="button" disabled={busy || !name.trim() || !url.trim()} onClick={() => void add()} className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--muted)] disabled:opacity-50">Add calendar</button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-[var(--destructive)]">{error}</p>}
      <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">The address is private. It is stored on the server and never sent back to the browser.</p>
    </SettingsSection>
  );
}
