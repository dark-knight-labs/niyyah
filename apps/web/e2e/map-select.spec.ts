import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Area select (Miro behaviour): a plain drag on empty canvas draws a selection box; pan with Space+drag, the Hand tool, middle or
 * right drag, or two-finger scroll. Touch keeps one-finger pan and gets no box. Selections act as a group.
 */
test.describe.configure({ mode: "serial" });

const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const OUT = "e2e/out";

let tokens: { access_token: string; refresh_token: string } | null = null;
test.beforeEach(async ({ context, request }) => {
  if (!tokens) { const r = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } }); expect(r.ok()).toBeTruthy(); tokens = await r.json(); }
  await context.addInitScript((t) => { localStorage.setItem("access_token", t.access_token); localStorage.setItem("refresh_token", t.refresh_token); }, tokens!);
});

const call = async (request: APIRequestContext, path: string, init?: { method?: string; data?: unknown }) => {
  const res = await request.fetch(`${API}/api/v1${path}`, { method: init?.method ?? "GET", data: init?.data, headers: { Authorization: `Bearer ${tokens!.access_token}` } });
  expect(res.ok(), `${init?.method ?? "GET"} ${path} -> ${res.status()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
};
interface ApiNode { id: string; kind: string; text: string; x: number; y: number; hidden: boolean; parent_key: string | null; ref_key: string | null; style: Record<string, string> }
const serverBoard = async (request: APIRequestContext, id: number | string) => (await call(request, `/boards/${id}`)) as { nodes: ApiNode[] };
const lifeId = async (request: APIRequestContext) => ((await call(request, "/boards")) as { id: number; kind: string }[]).find((b) => b.kind === "life")!.id;

const status = (page: Page) => page.getByTestId("save-status");
const settled = async (page: Page) => { await page.waitForTimeout(700); await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 15_000 }); };
const sticky = (id: string, text: string, x: number, y: number) => ({ op: "upsert_node", base_updated_at: null, node: { id, kind: "sticky", text, x, y, w: 140, h: 100, style: { color: "yellow" } } });

/** A free board with four stickies: A, B, C close together on the left, D far to the right. */
async function stickyBoard(request: APIRequestContext, page: Page, title: string) {
  const b = (await call(request, "/boards", { method: "POST", data: { title } })) as { id: number };
  await call(request, `/boards/${b.id}/ops`, { method: "POST", data: { ops: [sticky("sa", "Sticky A", 0, 0), sticky("sb", "Sticky B", 200, 0), sticky("sc", "Sticky C", 0, 160), sticky("sd", "Sticky D", 700, 0)] } });
  await page.goto(`/map?board=${b.id}`);
  await page.waitForSelector(".nm-sticky");
  await page.waitForTimeout(500);
  return b.id;
}
const box = async (page: Page, text: string) => (await page.locator(".nm-sticky", { hasText: text }).boundingBox())!;
const viewport = (page: Page) => page.evaluate(() => {
  const m = /matrix\(([^,]+),[^,]+,[^,]+,[^,]+,([^,]+),([^)]+)\)/.exec(getComputedStyle(document.querySelector(".react-flow__viewport")!).transform);
  return m ? { x: +m[2], y: +m[3], zoom: +m[1] } : { x: 0, y: 0, zoom: 1 };
});
/** A drag with real pointer moves. */
async function dragPane(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, button: "left" | "middle" | "right" = "left") {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(from.x + (to.x - from.x) / 3, from.y + (to.y - from.y) / 3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up({ button });
}
const selectedCount = (page: Page) => page.locator(".nm-sticky.sel-ring").count();
/** Corners of a rectangle that surrounds A, B and C only. */
async function around(page: Page) {
  const a = await box(page, "Sticky A"), b = await box(page, "Sticky B"), c = await box(page, "Sticky C");
  return { from: { x: a.x - 30, y: a.y - 40 }, to: { x: b.x + b.width + 30, y: c.y + c.height + 30 } };
}

test("a plain drag on empty canvas draws a selection box around three stickies", async ({ page, request }) => {
  await stickyBoard(request, page, "Select box");
  const vp = await viewport(page);
  const r = await around(page);
  await page.mouse.move(r.from.x, r.from.y);
  await page.mouse.down();
  await page.mouse.move((r.from.x + r.to.x) / 2, (r.from.y + r.to.y) / 2, { steps: 5 });
  await page.mouse.move(r.to.x, r.to.y, { steps: 8 });
  await expect(page.locator(".react-flow__selection")).toBeVisible();
  await page.screenshot({ path: `${OUT}/select-box-in-progress.png` });
  await page.mouse.up();
  expect(await selectedCount(page)).toBe(3);
  await expect(page.locator(".nm-sticky.sel-ring", { hasText: "Sticky D" })).toHaveCount(0);
  expect(await viewport(page)).toEqual(vp);                        // it selected, it did not pan
  await expect(page.getByTestId("multi-count")).toHaveText("3 selected");
  await expect(page.getByTestId("side-card")).toContainText("3 selected");
  await page.screenshot({ path: `${OUT}/select-box-done.png` });
});

test("a box that only touches part of a sticky selects it (partial)", async ({ page, request }) => {
  await stickyBoard(request, page, "Select partial");
  const d = await box(page, "Sticky D");
  await dragPane(page, { x: d.x - 40, y: d.y - 30 }, { x: d.x + 20, y: d.y + 20 });
  expect(await selectedCount(page)).toBe(1);
  await expect(page.locator(".nm-sticky.sel-ring", { hasText: "Sticky D" })).toHaveCount(1);
});

test("Esc clears the selection", async ({ page, request }) => {
  await stickyBoard(request, page, "Select esc");
  const r = await around(page);
  await dragPane(page, r.from, r.to);
  expect(await selectedCount(page)).toBe(3);
  await page.keyboard.press("Escape");
  expect(await selectedCount(page)).toBe(0);
  await expect(page.getByTestId("multi-bar")).toHaveCount(0);
});

test("Delete from the selection bar removes all three in one undo step; Ctrl+Z brings them back", async ({ page, request }) => {
  const id = await stickyBoard(request, page, "Select delete");
  const r = await around(page);
  await dragPane(page, r.from, r.to);
  await page.getByTestId("multi-bar").getByRole("button", { name: /^Delete/ }).click();
  await expect(page.locator(".nm-sticky")).toHaveCount(1);
  await settled(page);
  expect((await serverBoard(request, id)).nodes.map((n) => n.text)).toEqual(["Sticky D"]);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".nm-sticky")).toHaveCount(4);
  await settled(page);
  expect((await serverBoard(request, id)).nodes).toHaveLength(4);
});

test("the Delete key does the same", async ({ page, request }) => {
  await stickyBoard(request, page, "Select delete key");
  const r = await around(page);
  await dragPane(page, r.from, r.to);
  await page.keyboard.press("Delete");
  await expect(page.locator(".nm-sticky")).toHaveCount(1);
});

test("a colour picked in the bar applies to every selected sticky", async ({ page, request }) => {
  const id = await stickyBoard(request, page, "Select colour");
  const r = await around(page);
  await dragPane(page, r.from, r.to);
  await page.getByTestId("multi-bar").getByRole("button", { name: "pink" }).click();
  await settled(page);
  const b = await serverBoard(request, id);
  expect(Object.fromEntries(b.nodes.map((n) => [n.text, n.style.color]))).toEqual({ "Sticky A": "pink", "Sticky B": "pink", "Sticky C": "pink", "Sticky D": "yellow" });
});

test("dragging one selected sticky moves all of them together", async ({ page, request }) => {
  const id = await stickyBoard(request, page, "Select move");
  const before = Object.fromEntries((await serverBoard(request, id)).nodes.map((n) => [n.text, [n.x, n.y]]));
  const r = await around(page);
  await dragPane(page, r.from, r.to);
  const a = await box(page, "Sticky A");
  await dragPane(page, { x: a.x + a.width / 2, y: a.y + a.height / 2 }, { x: a.x + a.width / 2 + 120, y: a.y + a.height / 2 + 80 });
  await settled(page);
  const after = Object.fromEntries((await serverBoard(request, id)).nodes.map((n) => [n.text, [n.x, n.y]]));
  for (const t of ["Sticky A", "Sticky B", "Sticky C"]) {
    expect(after[t][0] - before[t][0], t).toBeGreaterThan(100);
    expect(after[t][1] - before[t][1], t).toBeGreaterThan(60);
  }
  expect(after["Sticky D"]).toEqual(before["Sticky D"]);
  expect(after["Sticky B"][0] - after["Sticky A"][0]).toBe(before["Sticky B"][0] - before["Sticky A"][0]);   // the group kept its shape
});

test("Space+drag pans and selects nothing", async ({ page, request }) => {
  await stickyBoard(request, page, "Pan space");
  const vp = await viewport(page);
  const r = await around(page);
  await page.keyboard.down("Space");
  await dragPane(page, r.from, { x: r.from.x + 150, y: r.from.y + 90 });
  await page.keyboard.up("Space");
  const after = await viewport(page);
  expect(Math.round(after.x - vp.x)).toBeGreaterThan(120);
  expect(Math.round(after.y - vp.y)).toBeGreaterThan(70);
  expect(await selectedCount(page)).toBe(0);
});

test("the Hand tool pans on a plain drag", async ({ page, request }) => {
  await stickyBoard(request, page, "Pan hand");
  await page.keyboard.press("h");
  const vp = await viewport(page);
  await dragPane(page, { x: 800, y: 700 }, { x: 650, y: 640 });
  const after = await viewport(page);
  expect(Math.round(vp.x - after.x)).toBeGreaterThan(120);
  expect(await selectedCount(page)).toBe(0);
});

test("middle-button drag pans", async ({ page, request }) => {
  await stickyBoard(request, page, "Pan middle");
  const vp = await viewport(page);
  await dragPane(page, { x: 800, y: 700 }, { x: 700, y: 640 }, "middle");
  const after = await viewport(page);
  expect(Math.round(vp.x - after.x)).toBeGreaterThan(80);
  expect(await selectedCount(page)).toBe(0);
});

test("right-button drag pans and opens no context menu", async ({ page, request }) => {
  await stickyBoard(request, page, "Pan right");
  await page.evaluate(() => { (window as unknown as { __ctx: boolean[] }).__ctx = []; window.addEventListener("contextmenu", (e) => (window as unknown as { __ctx: boolean[] }).__ctx.push(e.defaultPrevented)); });
  const vp = await viewport(page);
  await dragPane(page, { x: 800, y: 700 }, { x: 700, y: 640 }, "right");
  const after = await viewport(page);
  expect(Math.round(vp.x - after.x)).toBeGreaterThan(80);
  const seen = await page.evaluate(() => (window as unknown as { __ctx: boolean[] }).__ctx);
  expect(seen.every(Boolean)).toBe(true);                          // every contextmenu event that fired was cancelled
});

test("two-finger scroll pans", async ({ page, request }) => {
  await stickyBoard(request, page, "Pan scroll");
  const vp = await viewport(page);
  await page.mouse.move(800, 700);
  await page.mouse.wheel(90, 60);
  await page.waitForTimeout(200);
  const after = await viewport(page);
  expect(Math.round(vp.x - after.x)).toBeGreaterThan(40);
  expect(Math.round(vp.y - after.y)).toBeGreaterThan(20);
});

test("Life board: a mixed selection hides live nodes, deletes thoughts, skips the root, and Ctrl+Z restores both", async ({ page, request }) => {
  const id = await lifeId(request);
  await call(request, `/boards/${id}/ops`, { method: "POST", data: { ops: [{ op: "upsert_node", base_updated_at: null, node: { id: "sel-thought", kind: "mind", text: "Group delete me", parent_key: "stream:shop", position: 99 } }] } });
  await page.goto("/map?board=life&node=stream:shop");
  await page.waitForSelector(".nm-mind");
  await page.waitForTimeout(700);
  const mind = (t: string) => page.locator(".nm-mind", { hasText: t }).first();
  await mind("Group delete me").click();
  await mind("Launch page").click({ modifiers: ["Shift"] });
  await page.locator('[data-testid^="mind-quarter:"]').click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("multi-count")).toHaveText("3 selected");
  await page.keyboard.press("Delete");
  await expect(page.locator(".nm-mind", { hasText: "Group delete me" })).toHaveCount(0);
  await expect(page.locator(".nm-mind", { hasText: "Launch page" })).toHaveCount(0);
  await expect(page.locator(".nm-mind", { hasText: "Super Objective" })).toBeVisible();      // the root stays
  await settled(page);
  const b = await serverBoard(request, id);
  expect(b.nodes.some((n) => n.text === "Group delete me")).toBe(false);
  expect(b.nodes.find((n) => n.ref_key?.startsWith("week:shop:"))?.hidden).toBe(true);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".nm-mind", { hasText: "Group delete me" })).toHaveCount(1);
  await expect(page.locator(".nm-mind", { hasText: "Launch page" })).toHaveCount(1);          // one undo entry for the whole group
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1000 } });

  test("one finger pans the canvas and draws no selection box", async ({ page, request }) => {
    await stickyBoard(request, page, "Pan touch");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const vp = await viewport(page);
    const client = await page.context().newCDPSession(page);
    const swipe = async (x0: number, y0: number, x1: number, y1: number) => {
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 8; i++) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await swipe(300, 800, 180, 740);
    await page.waitForTimeout(200);
    const after = await viewport(page);
    expect(Math.round(vp.x - after.x)).toBeGreaterThan(60);
    await expect(page.locator(".react-flow__selection")).toHaveCount(0);
    expect(await selectedCount(page)).toBe(0);
  });
});
