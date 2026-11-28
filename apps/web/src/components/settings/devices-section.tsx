"use client";

import { useCallback, useEffect, useState } from "react";
import { FIELD, SettingsSection } from "@/components/settings/section";
import { devicesApi } from "@/lib/devices-api";
import { DeviceTokenData } from "@/lib/vault-types";

/** The shown token hides itself after this long: it is only meant to be copied straight away. */
export const SHOW_MS = 5 * 60 * 1000;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "never");

/**
 * Device tokens for capture clients (the Niyyah Capture menu-bar app). A device token can create tasks and read the capture
 * options, nothing else. The raw token exists only in `fresh` (React state): it is never written to storage, the URL, a log
 * or an error message, and it is dropped on dismiss, on a new create, on revoking that device, after SHOW_MS and when the page unmounts.
 * The list holds active tokens only (the API drops a revoked one), so revoking removes the row.
 */
export function DevicesSection() {
  const [tokens, setTokens] = useState<DeviceTokenData[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ id: number; name: string; token: string } | null>(null);
  const [expired, setExpired] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [listError, setListError] = useState(false);

  // A failed load keeps what is already known (null stays null: the list is unknown, not empty) and says so.
  const load = useCallback(() => devicesApi.list().then((list) => { setTokens(list); setListError(false); }).catch(() => setListError(true)), []);
  useEffect(() => { void load(); }, [load]);
  // Not cleared when the tab is hidden: copying into another app is the normal flow. A timer hides it instead, visibly.
  const freshId = fresh?.id;
  useEffect(() => {
    if (freshId === undefined) return;
    const timer = setTimeout(() => { setFresh(null); setCopied(false); setExpired(true); }, SHOW_MS);
    return () => clearTimeout(timer);
  }, [freshId]);

  async function create() {
    setBusy(true);
    setError(null);
    setFresh(null);
    setExpired(false);
    setCopied(false);
    try {
      const made = await devicesApi.create(name.trim());
      setFresh({ id: made.id, name: made.name, token: made.token });
      setName("");
      await load();
    } catch (err) {
      // 422 is the API's own rule text (name length, token cap); anything else gets a fixed message, never the raw response.
      setError((err as { status?: number }).status === 422 && err instanceof Error ? err.message : "Could not create the device token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    setError(null);
    setConfirming(null);
    try {
      await devicesApi.revoke(id);
      setFresh((f) => (f?.id === id ? null : f));
    } catch {
      setError("Could not revoke the device token");
    }
    await load(); // success or not, show the server's truth (a 404 means the row was already gone)
  }

  async function copy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.token);
      setCopied(true);
    } catch {
      setError("Copy failed: select the token and copy it by hand");
    }
  }

  return (
    <SettingsSection id="devices" title="Devices" aside="Capture clients, such as Niyyah Capture">
      {tokens && tokens.length === 0 && !listError && <p className="text-sm text-[var(--muted-foreground)]">No devices yet.</p>}
      {listError && <p role="alert" className="text-xs text-[var(--destructive)]">Could not load the device list.{tokens ? " Showing the last list we had." : ""}</p>}
      <ul aria-label="Device tokens">
        {(tokens ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-3 border-t border-[var(--border)] py-2 first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{t.name}</p>
              <p className="truncate font-mono text-xs text-[var(--muted-foreground)]">{t.prefix}•••• · created {when(t.created_at)} · last used {when(t.last_used_at)} · active</p>
            </div>
            {confirming === t.id ? (
              <div className="flex items-center gap-1" role="group" aria-label={`Confirm revoking ${t.name}`}>
                <span className="text-xs text-[var(--muted-foreground)]">Revoke now? That device stops working.</span>
                <button type="button" onClick={() => void revoke(t.id)} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--muted)]">Yes, revoke</button>
                <button type="button" onClick={() => setConfirming(null)} className="min-h-8 rounded-lg px-2 text-xs font-semibold hover:bg-[var(--muted)]">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(t.id)} aria-label={`Revoke ${t.name}`} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--muted)]">Revoke</button>
            )}
          </li>
        ))}
      </ul>
      {fresh && (
        <div role="status" aria-label="New device token" className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2">
          <p className="text-xs font-semibold">Token for {fresh.name}. Shown once: copy it now. After you dismiss this, nobody can read it again.</p>
          <input readOnly value={fresh.token} aria-label="Device token" onFocus={(e) => e.currentTarget.select()} autoComplete="off" spellCheck={false}
            className="mt-1 w-full min-w-0 break-all rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-xs" />
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => void copy()} className="min-h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold">{copied ? "Copied" : "Copy"}</button>
            <button type="button" onClick={() => { setFresh(null); setCopied(false); setExpired(false); }} className="min-h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold">I have copied it</button>
          </div>
        </div>
      )}
      {expired && <p role="status" className="mt-2 text-xs text-[var(--muted-foreground)]">Token hidden after 5 minutes. Revoke this device and create a new one if you did not copy it.</p>}
      <form className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(e) => { e.preventDefault(); if (!busy && name.trim()) void create(); }}>
        <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name, e.g. Work MacBook" aria-label="Device name" autoComplete="off" />
        <button type="submit" disabled={busy || !name.trim()} className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--muted)] disabled:opacity-50">Create device token</button>
      </form>
      {error && <p role="alert" className="mt-1.5 text-xs text-[var(--destructive)]">{error}</p>}
      <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">A device token can add tasks and read the capture options (<span className="font-mono">POST /api/v1/vault/items</span>, <span className="font-mono">GET /api/v1/capture/options</span>) and nothing else. Lost the laptop? Revoke its token here and it stops at once.</p>
    </SettingsSection>
  );
}
