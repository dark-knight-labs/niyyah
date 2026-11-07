import type { AskResult, Proposal } from "@/lib/advisor-api";

/** The slice of the API this module needs, so tests can pass a fake. */
export interface AdvisorCalls {
  proposals: () => Promise<Proposal[]>;
  approve: (id: number) => Promise<Proposal>;
  reject: (id: number) => Promise<Proposal>;
}

/**
 * Visibility probe. The panel exists only when the list answers 200: any error (404 without the plugin, 403 for a user who is
 * not allowed, 5xx, network) gives null and the page shows nothing about the advisor.
 */
export async function probeAdvisor(calls: Pick<AdvisorCalls, "proposals">): Promise<Proposal[] | null> {
  try {
    const list = await calls.proposals();
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

const status = (err: unknown) => (err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : undefined);
const text = (err: unknown) => (err instanceof Error ? err.message : "");

/** The ingress gives up at 100 s; the client stops waiting at the same moment. */
export const ASK_TIMEOUT_MS = 100_000;

/** Thrown when the client timeout fires: the same as the server's 504, so it reads the same. */
export const askTimeout = () => Object.assign(new Error("The advisor took too long to answer"), { status: 504 });

/**
 * One ask with a client timeout. `signal` aborts it early (the page went away): that rejects with an AbortError the caller ignores.
 * Without a response in `ms` the request is aborted and the result is a 504-shaped error.
 */
export async function askWithTimeout<T>(run: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal, ms = ASK_TIMEOUT_MS): Promise<T> {
  const ctl = new AbortController();
  let timedOut = false;
  const onOuter = () => ctl.abort();
  if (outer?.aborted) ctl.abort();
  outer?.addEventListener("abort", onOuter);
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
  try {
    return await run(ctl.signal);
  } catch (err) {
    if (timedOut) throw askTimeout();
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuter);
  }
}

export const isAbort = (err: unknown) => err instanceof Error && err.name === "AbortError";

/** What the owner reads when an ask fails. */
export function askErrorMessage(err: unknown): string {
  switch (status(err)) {
    case 429: return "The hourly limit of questions is used up. Try again later.";
    case 504: return "The advisor took too long to answer. Try a narrower question.";
    case 403: return "The advisor is switched off right now.";
    case 502: return "The advisor could not answer right now. Try again in a minute.";
    case undefined: return "Could not reach the server. Check the connection and try again.";
    default: return "Something went wrong asking the advisor. Try again in a moment.";
  }
}

/** What the owner reads when approve or reject fails: the server's own reason where it gave one. */
export function decisionErrorMessage(err: unknown): { text: string; stale: boolean } {
  const s = status(err);
  const detail = text(err);
  if (s === 409 && /^stale/i.test(detail)) return { text: `Out of date: ${detail.replace(/^stale:?\s*/i, "") || "the plan changed since this was proposed"}. It was not applied.`, stale: true };
  if (s === 409) return { text: detail || "This proposal can no longer be applied.", stale: false };
  if (s === 422) return { text: `Not applied: ${detail || "the plan refused this change"}. It is still waiting.`, stale: false };
  if (s === undefined) return { text: "Could not reach the server. Try again.", stale: false };
  return { text: detail || "Could not save the decision. Try again.", stale: false };
}

export type Decision = { ok: true; proposal: Proposal } | { ok: false; error: string; stale: boolean };

/**
 * Approve or reject, then run the follow-ups. An approved change touches the plan, so `onApplied` (the Plan page reload) runs
 * after approve succeeds and never after a refusal or a reject. The proposal list is refreshed either way via `onSettled`.
 */
export async function decide(
  calls: AdvisorCalls,
  action: "approve" | "reject",
  id: number,
  hooks: { onApplied?: () => Promise<unknown> | void; onSettled?: () => Promise<unknown> | void } = {},
): Promise<Decision> {
  try {
    const proposal = await calls[action](id);
    if (action === "approve") await hooks.onApplied?.();
    await hooks.onSettled?.();
    return { ok: true, proposal };
  } catch (err) {
    const m = decisionErrorMessage(err);
    // A stale or already-decided proposal changed state on the server: refresh so the list shows it.
    if (status(err) === 409) await hooks.onSettled?.();
    return { ok: false, error: m.text, stale: m.stale };
  }
}

/** Note shown under an answer the output filter edited. */
export function filteredNote(r: Pick<AskResult, "filtered" | "removed">): string | null {
  if (!r.filtered) return null;
  const n = Math.max(1, r.removed);
  return `${n} passage${n === 1 ? "" : "s"} removed: quotes and references are shown only from the verified set`;
}

export const KIND_LABEL: Record<string, string> = {
  pipeline_move: "Move item",
  objective_set: "Super Objective",
  note_add: "Add note",
  stream_checkpoint_set: "Checkpoint",
  weekly_objective_set: "Weekly objective",
};

export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind.replace(/_/g, " ");

export const QUICK_PROMPTS = ["Review my week", "What should I focus on next?", "Break down this month's checkpoint"];
