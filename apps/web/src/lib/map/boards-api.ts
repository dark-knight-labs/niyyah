import { api, type ApiError } from "@/lib/api-client";
import type { Board, BoardDetail, BadOpsBody, CreateBoardRequest, Op, PromoteRequest, PromoteResponse, OpsRequest, OpsResponse, PatchBoardRequest } from "./types";

/**
 * Typed calls for every /boards route. The API's board ids are integers; the client keeps every id as a string.
 * `GET /boards` is a bare list, `GET/POST/PATCH /boards/{id}` are flat objects, `viewport` is `{}` until one is saved.
 */

type RawBoard = Omit<Board, "id" | "viewport"> & { id: number | string; viewport: Board["viewport"] | Record<string, never> | null };

import { cleanStyle } from "./url";

const board = (b: RawBoard): Board => ({
  ...b,
  id: String(b.id),
  viewport: b.viewport && "zoom" in b.viewport ? (b.viewport as Board["viewport"]) : null,
});

/** The server validates payloads strictly: updated_at is output-only. */
function wire(op: Op): Op {
  if (op.op === "upsert_node") { const { updated_at: _u, ...node } = op.node; void _u; return { ...op, node: { ...node, style: cleanStyle(node.style) } as typeof op.node }; }
  if (op.op === "upsert_edge") { const { updated_at: _u, ...edge } = op.edge; void _u; return { ...op, edge }; }
  return op;
}

export const boardsApi = {
  list: async (): Promise<Board[]> => (await api.get<RawBoard[]>("/boards")).map(board),
  create: async (body: CreateBoardRequest): Promise<Board> => board(await api.post<RawBoard>("/boards", body)),
  get: async (id: string): Promise<BoardDetail> => {
    const raw = await api.get<RawBoard & Pick<BoardDetail, "nodes" | "edges">>(`/boards/${id}`);
    return { ...board(raw), nodes: raw.nodes.map((n) => ({ ...n, x: n.x ?? 0, y: n.y ?? 0, w: n.w ?? 0, h: n.h ?? 0, notes: n.notes ?? "" })), edges: raw.edges };
  },
  patch: async (id: string, body: PatchBoardRequest): Promise<Board> => board(await api.patch<RawBoard>(`/boards/${id}`, body)),
  remove: (id: string) => api.delete(`/boards/${id}`),
  /** A thought becomes a Plan item in one transaction; the node comes back as the ref row. */
  promote: (id: string, nodeId: string, body: PromoteRequest) => api.post<PromoteResponse>(`/boards/${id}/nodes/${nodeId}/promote`, body),
  ops: (id: string, body: OpsRequest, opts?: { keepalive?: boolean }) => api.post<OpsResponse>(`/boards/${id}/ops`, { ops: body.ops.map(wire) }, opts),
};

/** The ids a 422 refused (`bad_ops`), read off the error body. */
export function badOpsOf(e: ApiError): string[] {
  const b = e.body as BadOpsBody | undefined;
  return Array.isArray(b?.bad_ops) ? b.bad_ops.map(String) : [];
}
