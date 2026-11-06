import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/** Map v2, phase F: images and files (paste, drop, picker), authenticated blob display, downscale, download, the Files panel. */
test.describe.configure({ mode: "serial" });

const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
let tokens: { access_token: string; refresh_token: string } | null = null;
async function login(request: APIRequestContext) {
  if (!tokens) { const res = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } }); expect(res.ok()).toBeTruthy(); tokens = await res.json(); }
  return tokens!;
}
test.beforeEach(async ({ context, request }: { context: BrowserContext; request: APIRequestContext }) => {
  const t = await login(request);
  await context.addInitScript((tk) => { localStorage.setItem("access_token", tk.access_token); localStorage.setItem("refresh_token", tk.refresh_token); }, t);
});
const api = async (request: APIRequestContext, path: string, init?: { method?: string; data?: unknown }) => {
  const t = await login(request);
  const res = await request.fetch(`${API}/api/v1${path}`, { method: init?.method ?? "GET", data: init?.data, headers: { Authorization: `Bearer ${t.access_token}` } });
  expect(res.ok(), `${init?.method ?? "GET"} ${path} -> ${res.status()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
};
type N = { id: string; kind: string; text: string; x: number; y: number; w: number; h: number; style: Record<string, unknown> };
type Meta = { id: string; name: string; mime: string; size: number; used: boolean };
const node = (id: string, kind: string, o: Record<string, unknown> = {}) => ({ op: "upsert_node", base_updated_at: null, node: { id, kind, text: id, ...o } });
async function board(request: APIRequestContext, title: string, ops: unknown[] = []) {
  const b = await api(request, "/boards", { method: "POST", data: { title } });
  if (ops.length) await api(request, `/boards/${b.id}/ops`, { method: "POST", data: { ops } });
  return String(b.id);
}
const nodes = async (request: APIRequestContext, id: string) => ((await api(request, `/boards/${id}`)) as { nodes: N[] }).nodes;
const files = async (request: APIRequestContext) => ((await api(request, "/boards/files")) as { files: Meta[]; used_bytes: number }).files;
const settled = async (page: Page) => { await page.waitForTimeout(700); await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 }); };
const open = async (page: Page, id: string) => { await page.goto(`/map?board=${id}`); await page.waitForSelector('[data-testid="map-canvas"] .react-flow__renderer'); await page.waitForTimeout(700); };
const menuIds = (page: Page) => page.locator('[data-testid="context-menu"] [data-top-item]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cmd));

/** A PNG made in the page (noise, so it is big): returns base64. */
const makePng = (page: Page, w: number, h: number) => page.evaluate(({ w, h }) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d")!; const img = x.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = (i * 7) % 255; img.data[i + 1] = (i * 13) % 255; img.data[i + 2] = (i * 31) % 255; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  return c.toDataURL("image/png").split(",")[1];
}, { w, h });
const PNG1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const GIF1 = "R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=";

/** Dispatch a paste or drop carrying a file, the way the browser does. */
const pasteFile = (page: Page, b64: string, name: string, type: string) => page.evaluate(({ b64, name, type }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type }));
  window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, { b64, name, type });
const dropFile = (page: Page, b64: string, name: string, type: string, at: { x: number; y: number }) => page.evaluate(({ b64, name, type, at }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type }));
  document.querySelector(".niyyah-map")!.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
}, { b64, name, type, at });

test("pasting a big image downscales it to WebP, uploads it raw and shows it after reload", async ({ page, request }) => {
  const id = await board(request, "Paste image");
  await open(page, id);
  const posts: { type: string | undefined; multipart: boolean; size: number }[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/boards\/files/.test(r.url())) posts.push({ type: r.headers()["content-type"], multipart: /multipart/i.test(r.headers()["content-type"] ?? ""), size: r.postDataBuffer()?.length ?? 0 }); });
  await page.mouse.move(600, 400);
  await pasteFile(page, await makePng(page, 3000, 1500), "wide.png", "image/png");
  const img = page.locator('[data-testid^="image-"] img');
  await expect(img).toBeVisible({ timeout: 20_000 });
  await settled(page);
  expect(posts).toHaveLength(1); expect(posts[0].multipart).toBe(false); expect(posts[0].type).toBe("image/webp");
  const [meta] = await files(request);
  expect(meta.mime).toBe("image/webp"); expect(meta.name).toBe("wide.webp"); expect(meta.size).toBeLessThan(5_000_000);   // the 3000x1500 noise PNG is ~9 MB; the 2048 px WebP is not
  const n = (await nodes(request, id)).find((x) => x.kind === "image")!;
  expect(n.style.file_id).toBe(meta.id); expect(n.style.nw).toBe(2048); expect(n.style.nh).toBe(1024); expect(n.w).toBeLessThanOrEqual(320);
  await page.reload(); await open(page, id);
  const again = page.locator('[data-testid^="image-"] img');
  await expect(again).toBeVisible({ timeout: 20_000 });
  expect(await again.evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBe(2048);
  expect(await again.getAttribute("src")).toMatch(/^blob:/);                   // fetched with the token, shown as an object URL
});

test("the picker adds an image; its menu offers caption, replace, reset size, open and download; Replace swaps the file", async ({ page, request }) => {
  const id = await board(request, "Picker");
  await open(page, id);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Image or file" }).click()]);
  await chooser.setFiles({ name: "dot.png", mimeType: "image/png", buffer: Buffer.from(PNG1, "base64") });
  const el = page.locator('[data-testid^="image-"]');
  await expect(el).toBeVisible({ timeout: 15_000 });
  await settled(page);
  const first = (await files(request))[0];
  await el.click({ button: "right" });
  expect(await menuIds(page)).toEqual(["edit", "replace", "resetSize", "openFull", "download", "copy", "cut", "duplicate", "order", "lock", "connect", "delete"]);
  // caption
  await page.locator('[data-cmd="edit"]').click();
  await page.waitForFunction(() => { const a = document.activeElement as HTMLElement | null; return !!a && a.isContentEditable; });
  await page.keyboard.type("A caption"); await page.keyboard.press("Escape"); await settled(page);
  expect((await nodes(request, id)).find((n) => n.kind === "image")!.text).toBe("A caption");
  // replace
  await el.click({ button: "right" });
  const [chooser2] = await Promise.all([page.waitForEvent("filechooser"), page.locator('[data-cmd="replace"]').click()]);
  await chooser2.setFiles({ name: "other.png", mimeType: "image/png", buffer: Buffer.from(await makePng(page, 64, 48), "base64") });
  await expect.poll(async () => ((await nodes(request, id)).find((n) => n.kind === "image")!.style.file_id), { timeout: 15_000 }).not.toBe(first.id);
  await settled(page);
  const after = (await nodes(request, id)).find((n) => n.kind === "image")!;
  expect(after.text).toBe("A caption"); expect(after.style.nw).toBe(64);
  // reset size
  await el.click({ button: "right" }); await page.locator('[data-cmd="resetSize"]').click(); await settled(page);
  const r = (await nodes(request, id)).find((n) => n.kind === "image")!; expect([r.w, r.h]).toEqual([64, 48]);
});

test("a dropped file becomes a card with its name and size; the card downloads the same bytes", async ({ page, request }) => {
  const id = await board(request, "Drop file");
  await open(page, id);
  const text = "%PDF-1.4 hello from niyyah\n".repeat(40);
  await dropFile(page, Buffer.from(text).toString("base64"), "plan.pdf", "application/pdf", { x: 700, y: 450 });
  const card = page.locator('[data-testid^="file-"]').first();
  await expect(card).toContainText("plan.pdf", { timeout: 15_000 });
  await expect(card).toContainText("PDF"); await expect(card).toContainText("KB");
  await settled(page);
  const n = (await nodes(request, id)).find((x) => x.kind === "file")!;
  expect(n.text).toBe("plan.pdf"); expect(n.style.mime).toBe("application/octet-stream"); expect(n.style.bytes).toBe(Buffer.byteLength(text));
  const [dl] = await Promise.all([page.waitForEvent("download"), card.locator("button.nm-dl").click()]);
  expect(dl.suggestedFilename()).toBe("plan.pdf");
  const path = await dl.path();
  expect((await import("node:fs")).readFileSync(path!, "utf8")).toBe(text);
  await card.click({ button: "right" });
  expect(await menuIds(page)).toEqual(["edit", "replace", "download", "copy", "cut", "duplicate", "order", "lock", "connect", "delete"]);
  expect(await page.locator('[data-cmd="edit"]').textContent()).toContain("Rename");
});

test("a GIF keeps its bytes (animation); an SVG is a plain file, never an image", async ({ page, request }) => {
  const id = await board(request, "Gif svg");
  await open(page, id);
  await dropFile(page, GIF1, "spin.gif", "image/gif", { x: 500, y: 400 });
  await expect(page.locator('[data-testid^="image-"] img')).toBeVisible({ timeout: 15_000 });
  await dropFile(page, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString("base64"), "logo.svg", "image/svg+xml", { x: 900, y: 500 });
  await expect(page.locator('[data-testid^="file-"]')).toBeVisible({ timeout: 15_000 });
  await settled(page);
  const fs = await files(request);
  expect(fs.find((f) => f.name === "spin.gif")).toMatchObject({ mime: "image/gif", size: Buffer.from(GIF1, "base64").length });
  expect(fs.find((f) => f.name === "logo.svg")!.mime).toBe("application/octet-stream");
});

test("a thought attaches an image and gets a connector to it", async ({ page, request }) => {
  const id = await board(request, "Attach", [node("r", "mind", { x: 0, y: 0, text: "Idea" })]);
  await open(page, id);
  await page.getByTestId("mind-r").click({ button: "right" });
  expect(await menuIds(page)).toEqual(expect.arrayContaining(["attachImage", "attachFile"]));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator('[data-cmd="attachImage"]').click()]);
  await chooser.setFiles({ name: "dot.png", mimeType: "image/png", buffer: Buffer.from(PNG1, "base64") });
  await expect(page.locator('[data-testid^="image-"]')).toBeVisible({ timeout: 15_000 });
  await settled(page);
  const b = (await api(request, `/boards/${id}`)) as { nodes: N[]; edges: { from_id: string; to_id: string }[] };
  const img = b.nodes.find((n) => n.kind === "image")!;
  expect(b.edges).toHaveLength(1); expect([b.edges[0].from_id, b.edges[0].to_id]).toEqual(["r", img.id]);
});

test("the Files panel lists files, marks unused ones and deletes them; a deleted file shows File unavailable", async ({ page, request }) => {
  const id = await board(request, "Panel");
  await open(page, id);
  await dropFile(page, PNG1, "keep.png", "image/png", { x: 500, y: 400 });
  await dropFile(page, Buffer.from("spare file").toString("base64"), "spare.txt", "text/plain", { x: 900, y: 500 });
  await expect(page.locator('[data-testid^="file-"]')).toBeVisible({ timeout: 15_000 });
  await settled(page);
  const spare = (await nodes(request, id)).find((n) => n.kind === "file")!;
  await page.keyboard.press("Escape");
  await page.locator(`[data-testid="file-${spare.id}"]`).click(); await page.keyboard.press("Delete"); await settled(page);       // the node goes, the bytes stay
  await page.getByTestId("files-button").click();
  const panel = page.getByTestId("files-panel");
  await expect(panel).toBeVisible();
  const row = (name: string) => panel.locator("[data-used]", { hasText: name });
  await expect(row("keep.png")).toHaveAttribute("data-used", "1"); await expect(row("spare.txt")).toHaveAttribute("data-used", "0");
  await page.getByTestId("delete-unused").click();
  await expect(panel.locator('[data-used="0"]')).toHaveCount(0);
  await expect(row("spare.txt")).toHaveCount(0);
  expect((await files(request)).map((f) => f.name)).toContain("keep.png");
  expect((await files(request)).every((f) => f.used)).toBe(true);
  // delete a file an image still uses: the image becomes "File unavailable", keeping its place
  await panel.getByRole("button", { name: "Delete keep.png" }).click();
  await expect(row("keep.png")).toHaveCount(0);
  await page.getByRole("button", { name: "Close files" }).click();
  await page.reload(); await open(page, id);
  await expect(page.locator('[data-testid^="unavailable-"]')).toContainText("File unavailable", { timeout: 15_000 });
  expect((await nodes(request, id)).filter((n) => n.kind === "image")).toHaveLength(1);
});

test("a refused upload (quota) says how much is used and opens the Files panel; a file over 10 MB never leaves the browser", async ({ page, request }) => {
  const id = await board(request, "Quota");
  await open(page, id);
  let posted = 0;
  await page.route("**/api/v1/boards/files?*", async (route) => {
    posted++;
    await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ detail: "You are using 199.5 MB of 200 MB of file space. Delete files you no longer use in the Files panel (board bar).", used_bytes: 209_000_000, quota_bytes: 209_715_200 }) });
  });
  await dropFile(page, PNG1, "one.png", "image/png", { x: 500, y: 400 });
  await expect(page.getByTestId("toast")).toContainText("199.5 MB of 200 MB");
  await expect(page.getByTestId("toast")).toContainText("Files panel");
  await expect(page.getByTestId("files-panel")).toBeVisible();
  expect(posted).toBe(1);
  await page.unroute("**/api/v1/boards/files?*");
  await page.getByRole("button", { name: "Close files" }).click();
  await page.evaluate(() => { const big = new File([new Uint8Array(11 * 1024 * 1024)], "huge.bin", { type: "application/octet-stream" }); const dt = new DataTransfer(); dt.items.add(big); window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); });
  await expect(page.getByTestId("toast")).toContainText("over 10 MB");
  expect(posted).toBe(1);
  expect((await nodes(request, id)).length).toBe(0);
});
