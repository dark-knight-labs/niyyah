"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { advisorApi, type Proposal } from "@/lib/advisor-api";
import { ASK_TIMEOUT_MS, QUICK_PROMPTS, askErrorMessage, askWithTimeout, decide, filteredNote, isAbort, kindLabel, probeAdvisor } from "@/lib/advisor";
import { parseMarkdown, type Block, type Span } from "@/lib/markdown";

const COLLAPSED_KEY = "niyyah.advisor.collapsed";
const BUTTON = "min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50";
const CHIP = "min-h-8 rounded-full border border-[var(--border)] px-2.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]";
const MAX_WAIT = ASK_TIMEOUT_MS / 1000;

interface Turn {
  id: number;
  question: string;
  state: "waiting" | "done" | "error";
  answer?: string;
  note?: string | null;
  error?: string;
}

function Spans({ spans }: { spans: Span[] }): ReactNode {
  return spans.map((s, i) => {
    switch (s.t) {
      case "text": return <Fragment key={i}>{s.v}</Fragment>;
      case "code": return <code key={i} className="mono rounded bg-[var(--muted)] px-1 text-xs">{s.v}</code>;
      case "strong": return <strong key={i}><Spans spans={s.c} /></strong>;
      case "em": return <em key={i}><Spans spans={s.c} /></em>;
      case "link": return <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--accent)] underline"><Spans spans={s.c} /></a>;
    }
  });
}

function Answer({ source }: { source: string }) {
  const blocks: Block[] = parseMarkdown(source);
  return (
    <div className="grid gap-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p": return <p key={i} className="max-w-[70ch]"><Spans spans={b.c} /></p>;
          case "h": return <p key={i} className="heading-elegant text-base"><Spans spans={b.c} /></p>;
          case "quote": return <blockquote key={i} className="max-w-[70ch] border-l-2 border-[var(--border)] pl-3 text-[var(--muted-foreground)]"><Spans spans={b.c} /></blockquote>;
          case "pre": return <pre key={i} className="mono overflow-x-auto rounded-lg bg-[var(--muted)] p-3 text-xs">{b.v}</pre>;
          case "ul": return <ul key={i} className="list-disc pl-5">{b.items.map((it, j) => <li key={j}><Spans spans={it} /></li>)}</ul>;
          case "ol": return <ol key={i} className="list-decimal pl-5">{b.items.map((it, j) => <li key={j}><Spans spans={it} /></li>)}</ol>;
        }
      })}
    </div>
  );
}

/**
 * Advisor: ask a question and approve or reject the changes it proposes. Shown only when the proposals route answers 200
 * (the route is missing without the plugin and refused for accounts that are not allowed): otherwise this renders nothing.
 * `onApplied` runs after an approved change so the page can reload the plan.
 */
export function AdvisorPanel({ onApplied }: { onApplied: () => Promise<unknown> | void }) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => typeof window !== "undefined" && localStorage.getItem(COLLAPSED_KEY) === "1");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const nextId = useRef(1);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false); // set synchronously: a second Ctrl+Enter before the next render must not send a second ask
  const page = useRef<AbortController | null>(null);
  const decidingRef = useRef(false); // one decision at a time, set synchronously like inFlight

  const refresh = useCallback(async () => {
    try { setProposals(await advisorApi.proposals()); } catch { /* keep the list we have; the panel is already visible */ }
  }, []);

  useEffect(() => {
    let live = true;
    void probeAdvisor(advisorApi).then((list) => { if (live) setProposals(list); });
    return () => { live = false; };
  }, []);

  // Leaving the page cancels an ask in flight (each one costs from the hourly cap and holds a bridge turn).
  useEffect(() => {
    const ctl = new AbortController();
    page.current = ctl;
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    if (!asking) return;
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => { clearInterval(timer); setElapsed(0); };
  }, [asking]);

  if (proposals === null) return null;

  const pending = proposals.filter((p) => p.status === "pending");
  const recent = proposals.filter((p) => p.status !== "pending");

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* private mode: the state just does not persist */ }
  }

  async function send() {
    const q = question.trim();
    if (!q || inFlight.current) return;
    inFlight.current = true;
    const id = nextId.current++;
    setTurns((t) => [{ id, question: q, state: "waiting" }, ...t]);
    setQuestion("");
    setAsking(true);
    try {
      const r = await askWithTimeout((signal) => advisorApi.ask(q, signal), page.current?.signal);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, state: "done", answer: r.answer, note: filteredNote(r) } : x)));
      if (r.proposals_pending > 0) await refresh();
    } catch (err) {
      if (isAbort(err) && page.current?.signal.aborted) return; // the page is gone: nothing to show
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, state: "error", error: askErrorMessage(err) } : x)));
    } finally {
      inFlight.current = false;
      setAsking(false);
    }
  }

  async function choose(action: "approve" | "reject", p: Proposal) {
    if (decidingRef.current) return;
    decidingRef.current = true;
    setDeciding(p.id);
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => Number(k) !== p.id)));
    const result = await decide(advisorApi, action, p.id, { onApplied, onSettled: refresh });
    if (!result.ok) setErrors((e) => ({ ...e, [p.id]: result.error }));
    decidingRef.current = false;
    setDeciding(null);
  }

  return (
    <section aria-label="Advisor" className="mb-4 border border-[var(--border)] bg-[var(--surface)]">
      <h2 className="mono flex h-11 items-center text-[var(--muted-foreground)]">
        <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls="advisor-body"
          className="flex h-full w-full items-center justify-between gap-4 px-4 text-left">
          <span>Advisor</span>
          <span className="text-xs font-normal normal-case tracking-normal">
            {pending.length > 0 ? `${pending.length} waiting` : "nothing waiting"} · {collapsed ? "Show" : "Hide"}
          </span>
        </button>
      </h2>

      {!collapsed && (
        <div id="advisor-body" className="grid gap-4 border-t border-[var(--border)] px-4 py-3">
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick prompts">
              {QUICK_PROMPTS.map((p) => (
                <button key={p} type="button" className={CHIP} onClick={() => { setQuestion(p); textarea.current?.focus(); }}>{p}</button>
              ))}
            </div>
            <textarea ref={textarea} aria-label="Ask the advisor" rows={3} maxLength={4000} value={question} placeholder="Ask about your plan"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm focus:border-[var(--accent)]" />
            <div className="flex items-center gap-3">
              <button type="submit" disabled={asking || !question.trim()} className="min-h-9 rounded-lg bg-[var(--accent)] px-4 text-xs font-bold text-[var(--accent-fg)] disabled:opacity-50">Send</button>
              <span className="mono text-[var(--muted-foreground)]">Ctrl/Cmd + Enter</span>
              {asking && <span role="status" className="mono text-xs text-[var(--muted-foreground)]">Thinking · {elapsed}s of up to {MAX_WAIT}s</span>}
            </div>
          </form>

          {turns.length > 0 && (
            <ol aria-label="Conversation" className="grid gap-3">
              {turns.map((t) => (
                <li key={t.id} className="grid gap-1.5 border-t border-[var(--border)] pt-3">
                  <p className="text-sm font-semibold">{t.question}</p>
                  {t.state === "waiting" && <p className="text-xs text-[var(--muted-foreground)]">Waiting for the answer.</p>}
                  {t.state === "error" && <p role="alert" className="border border-[var(--destructive)] px-3 py-2 text-xs text-[var(--destructive)]">{t.error}</p>}
                  {t.state === "done" && (
                    <>
                      <Answer source={t.answer ?? ""} />
                      {t.note && <p className="mono text-[var(--muted-foreground)]">{t.note}</p>}
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}

          <div className="grid gap-2 border-t border-[var(--border)] pt-3">
            <h3 className="mono text-[var(--muted-foreground)]">Proposed changes</h3>
            {pending.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">Nothing waiting. Ask for a change and it appears here.</p>}
            <ul className="grid">
              {pending.map((p) => (
                <li key={p.id} className="grid gap-1.5 border-t border-[var(--border)] py-2 first:border-t-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">{kindLabel(p.kind)}</span>
                    <span className="text-sm">{p.text || p.summary}</span>
                  </div>
                  {p.reason && <p className="text-xs text-[var(--muted-foreground)]">Why: {p.reason}</p>}
                  {errors[p.id] && <p role="alert" className="border border-[var(--destructive)] px-3 py-1.5 text-xs text-[var(--destructive)]">{errors[p.id]}</p>}
                  <div className="flex gap-2">
                    <button type="button" disabled={deciding !== null} aria-label={`Approve: ${p.summary || p.text}`} onClick={() => void choose("approve", p)}
                      className="min-h-9 rounded-lg bg-[var(--accent)] px-4 text-xs font-bold text-[var(--accent-fg)] disabled:opacity-50">Approve</button>
                    <button type="button" disabled={deciding !== null} aria-label={`Reject: ${p.summary || p.text}`} onClick={() => void choose("reject", p)} className={BUTTON}>Reject</button>
                  </div>
                </li>
              ))}
            </ul>
            {recent.length > 0 && (
              <details className="border-t border-[var(--border)] pt-2">
                <summary className="mono cursor-pointer text-[var(--muted-foreground)]">Recent decisions · {recent.length}</summary>
                <ul className="mt-2 grid">
                  {recent.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-baseline gap-2 border-t border-[var(--border)] py-1.5 text-sm first:border-t-0">
                      <span className="mono rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">{p.status}</span>
                      <span className="text-[var(--muted-foreground)]">{kindLabel(p.kind)}</span>
                      <span>{p.summary || p.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
