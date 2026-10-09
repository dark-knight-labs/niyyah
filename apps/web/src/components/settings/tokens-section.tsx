"use client";

import { useCallback, useEffect, useState } from "react";
import { FIELD, SettingsSection } from "@/components/settings/section";
import { tokensApi } from "@/lib/tokens-api";
import { ApiTokenData } from "@/lib/vault-types";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "never");

/** Read-only tokens for tools that mirror or back up your data through GET /api/v1/export. A token can read the export and nothing else. */
export function TokensSection() {
  const [tokens, setTokens] = useState<ApiTokenData[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => tokensApi.list().then(setTokens).catch(() => setTokens([])), []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const made = await tokensApi.create(name);
      setFresh(made.token);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    setError(null);
    try {
      await tokensApi.revoke(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the token");
    }
  }

  return (
    <SettingsSection id="tokens" title="API tokens" aside="Read-only, for tools that copy your data out">
      {tokens && tokens.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No tokens yet.</p>}
      <ul>
        {(tokens ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-3 border-t border-[var(--border)] py-2 first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{t.name}</p>
              <p className="truncate font-mono text-xs text-[var(--muted-foreground)]">{t.prefix}•••• · last used {when(t.last_used_at)}</p>
            </div>
            <button type="button" onClick={() => void revoke(t.id)} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--muted)]">Revoke</button>
          </li>
        ))}
      </ul>
      {fresh && (
        <div role="status" className="mt-2 rounded-lg bg-[var(--muted)] px-3 py-2">
          <p className="text-xs font-semibold">Copy this token now. It is not shown again.</p>
          <p className="mt-1 break-all font-mono text-xs">{fresh}</p>
          <button type="button" onClick={() => setFresh(null)} className="mt-1.5 min-h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold">I have copied it</button>
        </div>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name, e.g. Vault mirror" aria-label="Token name" />
        <button type="button" disabled={busy || !name.trim()} onClick={() => void create()} className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--muted)] disabled:opacity-50">Create token</button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-[var(--destructive)]">{error}</p>}
      <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">A token can read your export (<span className="font-mono">GET /api/v1/export</span>) and nothing else. Revoke it and it stops at once.</p>
    </SettingsSection>
  );
}
