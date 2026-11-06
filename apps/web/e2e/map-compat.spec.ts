import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * Compatibility with rows a later release writes (R0): image/file rows render as a movable "File unavailable" card and keep their style.file_id;
 * a kind this build does not know is drawn inert and is never sent back in an ops request.
 */
test.describe.configure({ mode: "serial" });

const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const FILE_ID = "5f0c3a3e-1111-4222-8333-444455556666";

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
const row = (id: string, kind: string, o: Record<string, unknown> = {}) => ({ op: "upsert_node", base_updated_at: null, node: { id, kind, text: "", ...o } });
const status = (page: import("@playwright/test").Page) => page.getByTestId("save-status");
const settled = async (page: import("@playwright/test").Page) => { await page.waitForTimeout(700); await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 15_000 }); };
const open = async (page: import("@playwright/test").Page, id: string) => { await page.goto(`/map?board=${id}`); await page.waitForSelector('[data-testid="map-canvas"] .react-flow__renderer'); await page.waitForTimeout(500); };

test("image and file rows draw as a movable File unavailable card and keep style.file_id", async ({ page, request }) => {
  const b = await api(request, "/boards", { method: "POST", data: { title: "Media" } });
  await api(request, `/boards/${b.id}/ops`, { method: "POST", data: { ops: [
    row("pic", "image", { x: 200, y: 200, w: 170, h: 120, style: { file_id: FILE_ID } }),
    row("doc", "file", { x: 500, y: 200, w: 200, h: 60, text: "plan.pdf", style: { file_id: FILE_ID } }),
    row("note", "sticky", { x: 200, y: 450, w: 170, h: 130, text: "side", style: { color: "yellow" } }),
  ] } });
  await open(page, String(b.id));
  const card = page.getByTestId("unavailable-pic");
  await expect(card).toContainText("File unavailable");
  await expect(page.getByTestId("unavailable-doc")).toContainText("plan.pdf");
  const before = (await card.boundingBox())!;
  await page.mouse.move(before.x + 40, before.y + 40);
  await page.mouse.down();
  await page.mouse.move(before.x + 60, before.y + 60, { steps: 3 });
  await page.mouse.move(before.x + 140, before.y + 120, { steps: 10 });
  await page.mouse.up();
  await settled(page);
  const server = await api(request, `/boards/${b.id}`);
  const pic = server.nodes.find((n: { id: string }) => n.id === "pic");
  expect(pic.kind).toBe("image");
  expect(pic.style).toEqual({ file_id: FILE_ID });
  expect(pic.x).toBeGreaterThan(250);
  // deleting the placeholder is an ordinary valid write
  await card.click();
  await page.keyboard.press("Delete");
  await settled(page);
  expect((await api(request, `/boards/${b.id}`)).nodes.map((n: { id: string }) => n.id).sort()).toEqual(["doc", "note"]);
});

test("a kind this build does not know is inert and never appears in an ops request", async ({ page, request }) => {
  const b = await api(request, "/boards", { method: "POST", data: { title: "Later" } });
  await api(request, `/boards/${b.id}/ops`, { method: "POST", data: { ops: [
    row("fr", "frame", { x: 0, y: 0, w: 500, h: 400, text: "Frame A" }),
    row("note", "sticky", { x: 40, y: 60, w: 170, h: 130, text: "inside", style: { color: "yellow" }, frame_id: "fr" }),
  ] } });
  const ghost = { id: "ghost", kind: "video", parent_id: null, parent_key: null, position: 0, x: 260, y: 60, w: 160, h: 90, text: "", notes: "", style: { src: "x" }, collapsed: false, hidden: false, ref_key: null, frame_id: "fr", updated_at: new Date().toISOString() };
  await page.route(new RegExp(`/api/v1/boards/${b.id}$`), async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.nodes.push(ghost, { ...ghost, id: "ghost2", hidden: true });
    await route.fulfill({ response: res, json: body });
  });
  const bodies: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/boards\/\d+\/ops$/.test(r.url())) bodies.push(r.postData() ?? ""); });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page, String(b.id));
  const g = page.getByTestId("unknown-ghost");
  await expect(g).toContainText("Unsupported object");
  // inert: clicking it selects nothing (no details card), it cannot be dragged
  const gb = (await g.boundingBox())!;
  await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await expect(page.getByTestId("side-card")).toHaveCount(0);
  await page.mouse.move(gb.x + 10, gb.y + 10);
  await page.mouse.down(); await page.mouse.move(gb.x + 120, gb.y + 90, { steps: 8 }); await page.mouse.up();
  // the hidden list and the frames list never offer it
  await page.getByTestId("board-menu").click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("ghost")).toHaveCount(0);
  // move the framed sticky and the frame (a frame move rewrites its members): the unknown row must not ride along
  const sticky = page.getByTestId("sticky-note");
  const sb = (await sticky.boundingBox())!;
  await page.mouse.move(sb.x + 30, sb.y + 30); await page.mouse.down(); await page.mouse.move(sb.x + 40, sb.y + 40, { steps: 3 }); await page.mouse.move(sb.x + 80, sb.y + 60, { steps: 6 }); await page.mouse.up();
  await settled(page);
  await page.getByTestId("frame-fr").click({ position: { x: 20, y: 300 } });
  await page.keyboard.press("Delete");
  await settled(page);
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) expect(body, "an ops request mentioned the unknown row").not.toContain("ghost");
  expect(errors).toEqual([]);
  // the server still holds it untouched? (it never could: the API refuses kind video) - the board itself is fine
  expect((await api(request, `/boards/${b.id}`)).nodes.map((n: { id: string }) => n.id)).toEqual(["note"]);
});
