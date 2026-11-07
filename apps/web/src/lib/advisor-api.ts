import { api } from "@/lib/api-client";

/** One change the advisor proposes. `text` is the full text the owner approves, `summary` a one-line clip. */
export interface Proposal {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  text: string | null;
  summary: string;
  reason: string | null;
  status: string; // pending | approved | rejected | stale
  created_at: string | null;
  decided_at: string | null;
}

export interface AskResult {
  answer: string;
  proposals_pending: number;
  filtered: boolean;
  removed: number;
}

export const advisorApi = {
  proposals: () => api.get<Proposal[]>("/advisor/proposals"),
  ask: (question: string) => api.post<AskResult>("/advisor/ask", { question }),
  approve: (id: number) => api.post<Proposal>(`/advisor/proposals/${id}/approve`, {}),
  reject: (id: number) => api.post<Proposal>(`/advisor/proposals/${id}/reject`, {}),
};
