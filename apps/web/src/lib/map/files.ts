import { api, rawError } from "@/lib/api-client";

/** The shape of GET /boards/files (metadata only). */
export interface FileMeta { id: string; name: string; mime: string; size: number; created_at: string; used: boolean }
export interface FileList { used_bytes: number; quota_bytes: number; files: FileMeta[] }
export interface Uploaded { id: string; name: string; mime: string; size: number }

export const filesApi = {
  list: () => api.get<FileList>("/boards/files"),
  remove: (id: string) => api.delete(`/boards/files/${id}`),
  /** Raw body upload (planner v2 N8): the blob goes as the request body, its name in the query. */
  async upload(blob: Blob, name: string, boardId?: string): Promise<Uploaded> {
    const q = new URLSearchParams({ name });
    if (boardId && /^\d+$/.test(boardId)) q.set("board", boardId);
    const res = await api.raw(`/boards/files?${q}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type || "application/octet-stream" } });
    if (!res.ok) throw await rawError(res);
    return res.json();
  },
};

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

// ---- authenticated bytes -> object URL, cached ----
// An <img src> cannot carry the Bearer token, so the client fetches the bytes and shows an object URL. One fetch per file id per page.
const urls = new Map<string, Promise<string>>();

export function fileUrl(id: string): Promise<string> {
  let p = urls.get(id);
  if (!p) {
    p = (async () => {
      const res = await api.raw(`/boards/files/${id}`);
      if (!res.ok) throw await rawError(res);
      return URL.createObjectURL(await res.blob());
    })();
    p.catch(() => urls.delete(id));
    urls.set(id, p);
  }
  return p;
}

/** Drop a cached URL (a file replaced or deleted). */
export function forgetFile(id: string): void {
  const p = urls.get(id);
  urls.delete(id);
  void p?.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
}

/** Revoke every URL (the board is left). */
export function releaseFiles(): void {
  for (const id of [...urls.keys()]) forgetFile(id);
}

export async function downloadFile(id: string, name: string): Promise<void> {
  const url = await fileUrl(id);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

export async function openFile(id: string): Promise<void> {
  const url = await fileUrl(id);
  window.open(url, "_blank", "noopener");
}

// ---- client-side preparation ----

export const MAX_EDGE = 2048;
const RASTER = new Set(["image/png", "image/jpeg", "image/webp"]);
export interface Prepared { blob: Blob; name: string; nw: number; nh: number; image: boolean }

/** Longest edge scaled to `max`, never up. */
export function fitEdge(w: number, h: number, max = MAX_EDGE): { w: number; h: number; scaled: boolean } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: k < 1 };
}
/** The size an image node is first drawn at: natural, but at most 320 px on its longer side. */
export function nodeSize(nw: number, nh: number): { w: number; h: number } {
  const k = Math.min(1, 320 / Math.max(nw, nh));
  return { w: Math.max(40, Math.round(nw * k)), h: Math.max(40, Math.round(nh * k)) };
}
/** Should a raster image be re-encoded? When it is wider than 2048 px or heavy (> 600 KB). GIFs are never touched (animation). */
export const needsReencode = (type: string, bytes: number, w: number, h: number) => RASTER.has(type) && (Math.max(w, h) > MAX_EDGE || bytes > 600 * 1024);

/**
 * A picked, pasted or dropped file ready to upload. A png/jpeg/webp that is large is downscaled to 2048 px and re-encoded as WebP q0.85
 * (the re-encode is kept only when it is smaller); a GIF keeps its bytes (animation, planner v3 N7); anything the browser cannot decode as an image is a plain file.
 */
export async function prepare(file: File): Promise<Prepared> {
  const plain: Prepared = { blob: file, name: file.name || "file", nw: 0, nh: 0, image: false };
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return plain;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { return plain; }
  try {
    const keep: Prepared = { blob: file, name: file.name || "image", nw: bmp.width, nh: bmp.height, image: true };
    if (!needsReencode(file.type, file.size, bmp.width, bmp.height)) return keep;
    const t = fitEdge(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = t.w; canvas.height = t.h;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, t.w, t.h);
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.85));
    if (!out || out.type !== "image/webp" || (!t.scaled && out.size >= file.size)) return keep;
    return { blob: out, name: (file.name || "image").replace(/\.[^.]+$/, "") + ".webp", nw: t.w, nh: t.h, image: true };
  } finally { bmp.close(); }
}

export const humanSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
export const extOf = (name: string) => (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? "file").toUpperCase();
