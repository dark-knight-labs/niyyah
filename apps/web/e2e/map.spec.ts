import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * The Map (/map) against the seeded dev API (run.sh): boards, mind-map keys, stickies, frames and connectors, undo, the autosave queue
 * (offline, two tabs) and the screenshots of the page in three skins. Tests share one database and run in order.
 * Needs the Phase 1 API (/api/v1/boards); until it is merged in, point E2E_API_URL at anything that implements the same contract.
 */
test.describe.configure({ mode: "serial" });

const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const OUT = "e2e/out";

interface ApiNode { notes: string; id: string; kind: string; parent_id: string | null; text: string; x: number; y: number; w: number; h: number; frame_id: string | null; collapsed: boolean; hidden: boolean; style: Record<string, string> }
interface ApiBoard { id: string; title: string; kind: string; revision: number; nodes: ApiNode[]; edges: { id: string; from_id: string; to_id: string }[] }

let tokens: { access_token: string; refresh_token: string } | null = null;

async function login(request: import("@playwright/test").APIRequestContext) {
  if (!tokens) {
    const res = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    tokens = await res.json();
  }
  return tokens!;
}

async function authed(ctx: BrowserContext, request: import("@playwright/test").APIRequestContext) {
  const t = await login(request);
  await ctx.addInitScript((tk) => { localStorage.setItem("access_token", tk.access_token); localStorage.setItem("refresh_token", tk.refresh_token); }, t);
}

test.beforeEach(async ({ context, request }) => { await authed(context, request); });

const api = async (request: import("@playwright/test").APIRequestContext, path: string, init?: { method?: string; data?: unknown }) => {
  const t = await login(request);
  const res = await request.fetch(`${API}/api/v1${path}`, { method: init?.method ?? "GET", data: init?.data, headers: { Authorization: `Bearer ${t.access_token}` } });
  expect(res.ok(), `${init?.method ?? "GET"} ${path} -> ${res.status()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
};
const serverBoard = async (request: import("@playwright/test").APIRequestContext, id: string) => api(request, `/boards/${id}`) as Promise<ApiBoard>;
async function newBoard(request: import("@playwright/test").APIRequestContext, title: string): Promise<string> {
  const b = await api(request, "/boards", { method: "POST", data: { title } });
  return String(b.id);
}

const status = (page: Page) => page.getByTestId("save-status");
// 700 ms > the 600 ms debounce: the status has left "saved" by the time we look
const settled = async (page: Page) => { await page.waitForTimeout(700); await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 15_000 }); };
const mind = (page: Page, text: string) => page.locator(".nm-mind", { hasText: text }).first();
/** Typing target is ready once the inline editor has focus (a new node is hidden until React Flow measures it). */
const editorReady = (page: Page) => page.waitForFunction(() => { const a = document.activeElement as HTMLElement | null; return !!a && a.isContentEditable && a.classList.contains("nm-t"); });
const open = async (page: Page, id: string) => { await page.goto(`/map?board=${id}`); await page.waitForSelector('[data-testid="map-canvas"] .react-flow__renderer'); await page.waitForTimeout(500); /* nodes measured and laid out */ };
const typeInto = async (page: Page, text: string) => { await editorReady(page); await page.keyboard.type(text); };
const zoomPct = async (page: Page) => parseInt((await page.getByRole("button", { name: /^Zoom level/ }).textContent()) ?? "0", 10);

/** Drag with real pointer moves (React Flow's drag ignores jumps). */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}
const centre = async (loc: import("@playwright/test").Locator) => { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

let boardId = "";

test("opens /map on the Life board and lists it; a free board is created from the menu", async ({ page, request }) => {
  await page.goto("/map");
  await expect(page.getByTestId("board-name")).toHaveText("Life");
  await page.getByTestId("board-menu").click();
  await expect(page.getByRole("menuitem", { name: /Life/ })).toBeVisible();
  await page.getByTestId("new-board").click();
  // a new board opens with a central idea, ready to type over
  await typeInto(page, "Launch");
  await page.keyboard.press("Escape");
  await expect(mind(page, "Launch")).toBeVisible();
  await settled(page);
  boardId = new URL(page.url()).searchParams.get("board")!;
  expect(boardId).toBeTruthy();
  const b = await serverBoard(request, boardId);
  expect(b.kind).toBe("free");
  expect(b.nodes.map((n) => n.text)).toEqual(["Launch"]);
  await page.screenshot({ path: `${OUT}/map-new-board.png` });
});

test("Tab and Enter build thoughts; reload keeps them", async ({ page, request }) => {
  await open(page, boardId);
  await mind(page, "Launch").click();
  await page.keyboard.press("Tab");        // child of the root
  await typeInto(page, "Design");
  await page.keyboard.press("Enter");      // sibling
  await typeInto(page, "Build");
  await page.keyboard.press("Tab");        // child of Build
  await typeInto(page, "API");
  await page.keyboard.press("Escape");
  await expect(page.locator(".nm-mind")).toHaveCount(4);
  await settled(page);
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await expect(page.locator(".nm-mind")).toHaveCount(4);
  for (const t of ["Launch", "Design", "Build", "API"]) await expect(mind(page, t)).toBeVisible();
  const b = await serverBoard(request, boardId);
  const by = Object.fromEntries(b.nodes.map((n) => [n.text, n]));
  expect(by.Design.parent_id).toBe(by.Launch.id);
  expect(by.Build.parent_id).toBe(by.Launch.id);
  expect(by.API.parent_id).toBe(by.Build.id);
  expect(by.Design.style.color).toBeTruthy();               // first level carries a branch colour
  expect(by.API.style.color).toBeUndefined();               // deeper levels follow it
});

test("keyboard: arrows move along the tree, F2 edits, Ctrl+. collapses and a badge counts what is hidden", async ({ page }) => {
  await open(page, boardId);
  await mind(page, "Build").click();
  await page.keyboard.press("ArrowRight");                   // into its child
  await expect(page.locator(".nm-mind.sel-ring")).toContainText("API");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".nm-mind.sel-ring")).toContainText("Build");
  await page.keyboard.press("ArrowUp");                      // previous sibling
  await expect(page.locator(".nm-mind.sel-ring")).toContainText("Design");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("F2");
  await editorReady(page);
  await page.keyboard.type("Build it");
  await page.keyboard.press("Escape");
  await expect(mind(page, "Build it")).toBeVisible();
  await page.keyboard.press("Control+.");
  await expect(mind(page, "API")).toHaveCount(0);
  await expect(page.locator(".nm-fold.shut")).toHaveText("1");
  await page.keyboard.press("Control+.");
  await expect(mind(page, "API")).toBeVisible();
  await settled(page);
});

test("the details card keeps notes on a thought", async ({ page, request }) => {
  await open(page, boardId);
  await mind(page, "Design").click();
  await page.getByTestId("card-notes").fill("Check the colour contrast in dark");
  await settled(page);
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await mind(page, "Design").click();
  await expect(page.getByTestId("card-notes")).toHaveValue("Check the colour contrast in dark");
  expect((await serverBoard(request, boardId)).nodes.find((n) => n.text === "Design")!.notes).toBe("Check the colour contrast in dark");
});

test("dragging a node onto another moves its branch", async ({ page, request }) => {
  await open(page, boardId);
  await drag(page, await centre(mind(page, "API")), await centre(mind(page, "Design")));
  await settled(page);
  const b = await serverBoard(request, boardId);
  const by = Object.fromEntries(b.nodes.map((n) => [n.text, n]));
  expect(by.API.parent_id).toBe(by.Design.id);
  await page.keyboard.press("Control+z");
  await settled(page);
  const after = await serverBoard(request, boardId);
  expect(after.nodes.find((n) => n.text === "API")!.parent_id).toBe(after.nodes.find((n) => n.text === "Build it")!.id);
});

test("undo removes the last thought and the server agrees after reload; Del removes a subtree and undo restores it", async ({ page, request }) => {
  await open(page, boardId);
  await mind(page, "Build it").click();
  await page.keyboard.press("Tab");
  await typeInto(page, "Temp");
  await page.keyboard.press("Escape");
  await expect(mind(page, "Temp")).toBeVisible();
  await page.keyboard.press("Control+z");                    // text and creation are one step
  await expect(mind(page, "Temp")).toHaveCount(0);
  await settled(page);
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await expect(mind(page, "Temp")).toHaveCount(0);
  expect((await serverBoard(request, boardId)).nodes.some((n) => n.text === "Temp")).toBe(false);

  // Del on a thought removes its whole subtree
  await mind(page, "Build it").click();
  await page.keyboard.press("Delete");
  await expect(mind(page, "Build it")).toHaveCount(0);
  await expect(mind(page, "API")).toHaveCount(0);
  await settled(page);
  let b = await serverBoard(request, boardId);
  expect(b.nodes.map((n) => n.text).sort()).toEqual(["Design", "Launch"]);
  // undo restores the subtree on the server (v2 N6)
  await page.keyboard.press("Control+z");
  await expect(mind(page, "API")).toBeVisible();
  await settled(page);
  await page.reload();
  await page.waitForSelector(".nm-mind");
  b = await serverBoard(request, boardId);
  expect(b.nodes.map((n) => n.text).sort()).toEqual(["API", "Build it", "Design", "Launch"]);
  const by = Object.fromEntries(b.nodes.map((n) => [n.text, n]));
  expect(by.API.parent_id).toBe(by["Build it"].id);
});

test("sticky, frame and connector persist across reload; a frame carries what sits in it", async ({ page, request }) => {
  await open(page, boardId);
  // frame first (F + click), then a sticky inside it (N + click inside the frame), then a sticky outside
  await page.keyboard.press("f");
  await page.mouse.click(700, 560);
  await settled(page);
  const frame = page.locator(".nm-frame").first();
  await expect(frame).toBeVisible();
  const fb = (await frame.boundingBox())!;
  await page.keyboard.press("n");
  await page.mouse.click(fb.x + 120, fb.y + 120);
  await typeInto(page, "Inside");
  await page.keyboard.press("Escape");
  await page.keyboard.press("n");
  await page.mouse.click(1100, 300);
  await typeInto(page, "Loose");
  await page.keyboard.press("Escape");
  await expect(page.locator(".nm-sticky")).toHaveCount(2);

  // connector: L, first object, second object
  await page.keyboard.press("l");
  await page.locator(".nm-sticky", { hasText: "Loose" }).click();
  await page.locator(".nm-sticky", { hasText: "Inside" }).click();
  await expect(page.locator(".react-flow__edge-path.nm-link")).toHaveCount(1);

  // moving the frame moves the sticky inside it by the same amount
  const before = (await page.locator(".nm-sticky", { hasText: "Inside" }).boundingBox())!;
  await drag(page, { x: fb.x + fb.width - 40, y: fb.y + fb.height - 40 }, { x: fb.x + fb.width - 40 + 90, y: fb.y + fb.height - 40 + 60 });
  const moved = (await page.locator(".nm-sticky", { hasText: "Inside" }).boundingBox())!;
  const fAfter = (await frame.boundingBox())!;
  expect(Math.abs(fAfter.x - fb.x)).toBeGreaterThan(60);                       // the frame moved (the drag threshold eats a few px)
  expect(Math.round(moved.x - before.x)).toBe(Math.round(fAfter.x - fb.x));    // and the sticky moved by exactly the same amount
  expect(Math.round(moved.y - before.y)).toBe(Math.round(fAfter.y - fb.y));
  await settled(page);

  await page.reload();
  await page.waitForSelector(".nm-sticky");
  await expect(page.locator(".nm-sticky")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge-path.nm-link")).toHaveCount(1);
  const after = (await page.locator(".nm-sticky", { hasText: "Inside" }).boundingBox())!;
  expect(Math.round(after.x - moved.x)).toBe(0);
  const b = await serverBoard(request, boardId);
  const f = b.nodes.find((n) => n.kind === "frame")!;
  const inside = b.nodes.find((n) => n.text === "Inside")!;
  expect(inside.frame_id).toBe(f.id);
  expect(b.nodes.find((n) => n.text === "Loose")!.frame_id).toBeNull();
  expect(b.edges).toHaveLength(1);
});

test("the Frames list zooms to a frame; zoom bar and fit work", async ({ page }) => {
  await open(page, boardId);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  const small = await zoomPct(page);
  expect(small).toBeLessThan(100);
  await page.getByTestId("frames-menu").click();
  await page.locator("[data-frame]").first().click();
  await expect.poll(() => zoomPct(page), { timeout: 5000 }).toBeGreaterThan(small);
  await page.getByRole("button", { name: /^Zoom level/ }).click();
  await expect.poll(() => zoomPct(page)).toBe(100);
  await page.keyboard.press("Shift+1");
  await expect.poll(() => zoomPct(page)).not.toBe(100);
});

test("two tabs on one board keep both edits (per-row last write wins)", async ({ browser, request }) => {
  const ctxB = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await authed(ctxB, request);
  const a = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await authed(a.context(), request);
  const bpage = await ctxB.newPage();
  const id = await newBoard(request, "Two tabs");
  // seed two roots through the API so each tab can edit a different one
  const ops = ["Alpha", "Beta"].map((text, i) => ({ op: "upsert_node", base_updated_at: null, node: { id: crypto.randomUUID(), kind: "mind", parent_id: null, parent_key: null, position: 0, x: i * 600, y: 0, w: 0, h: 0, text, notes: "", style: {}, collapsed: false, hidden: false, ref_key: null, frame_id: null } }));
  await api(request, `/boards/${id}/ops`, { method: "POST", data: { ops } });
  await open(a, id);
  await open(bpage, id);
  await mind(a, "Alpha").dblclick();
  await editorReady(a);
  await a.keyboard.type("Alpha one");
  await a.keyboard.press("Escape");
  await mind(bpage, "Beta").dblclick();
  await editorReady(bpage);
  await bpage.keyboard.type("Beta two");
  await bpage.keyboard.press("Escape");
  await settled(a); await settled(bpage);
  await a.bringToFront();
  await a.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(mind(a, "Beta two")).toBeVisible({ timeout: 15_000 });   // change detection on focus
  await bpage.reload();
  await expect(mind(bpage, "Alpha one")).toBeVisible();
  await expect(mind(bpage, "Beta two")).toBeVisible();
  expect((await serverBoard(request, id)).nodes.map((n) => n.text).sort()).toEqual(["Alpha one", "Beta two"]);
  await ctxB.close(); await a.context().close();
});

test("a cycle made in two tabs is refused and nothing gets stuck Offline", async ({ browser, request }) => {
  const id = await newBoard(request, "Cycle");
  const mk = (text: string, parent: string | null, pos: number) => ({ id: crypto.randomUUID(), text, parent, pos });
  const root = mk("Root", null, 0), x = mk("X", null, 0), y = mk("Y", null, 1);
  const rows = [root, x, y].map((r, i) => ({ op: "upsert_node", base_updated_at: null, node: { id: r.id, kind: "mind", parent_id: i === 0 ? null : root.id, parent_key: null, position: r.pos, x: 0, y: 0, w: 0, h: 0, text: r.text, notes: "", style: i === 0 ? {} : { side: "R", color: "violet" }, collapsed: false, hidden: false, ref_key: null, frame_id: null } }));
  await api(request, `/boards/${id}/ops`, { method: "POST", data: { ops: rows } });
  // each tab has the board loaded, then both write: A puts X under Y, B puts Y under X
  const ctxA = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); await authed(ctxA, request);
  const ctxB = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); await authed(ctxB, request);
  const A = await ctxA.newPage(), B = await ctxB.newPage();
  await open(A, id); await open(B, id);
  await drag(A, await centre(mind(A, "X")), await centre(mind(A, "Y")));
  await settled(A);
  await drag(B, await centre(mind(B, "Y")), await centre(mind(B, "X")));
  await expect(status(B)).toHaveAttribute("data-status", "saved", { timeout: 20_000 });   // 4xx is never retried: no stuck Offline
  const b = await serverBoard(request, id);
  const byId = new Map(b.nodes.map((n) => [n.id, n]));
  for (const n of b.nodes) { // every parent chain ends at a root (no cycle)
    let cur: ApiNode | undefined = n; let hops = 0;
    while (cur?.parent_id && hops++ < 10) cur = byId.get(cur.parent_id);
    expect(cur?.parent_id ?? null).toBeNull();
  }
  await ctxA.close(); await ctxB.close();
});

test("offline: edits show Offline, survive a reload from localStorage and flush when the connection returns", async ({ page, request }) => {
  const id = await newBoard(request, "Offline");
  await open(page, id);
  await page.keyboard.press("m");
  await page.mouse.click(700, 500);
  await typeInto(page, "Root");
  await page.keyboard.press("Escape");
  await settled(page);
  // writes fail at the network level (the page itself stays reachable, so it can reload)
  await page.route("**/api/v1/boards/*/ops", (r) => r.abort("internetdisconnected"));
  await mind(page, "Root").click();
  await page.keyboard.press("Tab");
  await typeInto(page, "One");
  await page.keyboard.press("Enter");
  await typeInto(page, "Two");
  await page.keyboard.press("Escape");
  await expect(status(page)).toHaveAttribute("data-status", "offline", { timeout: 25_000 });
  expect((await serverBoard(request, id)).nodes.map((n) => n.text)).toEqual(["Root"]);
  await page.reload();                                         // still failing: the pending ops come back from localStorage
  await expect(mind(page, "One")).toBeVisible();
  await expect(mind(page, "Two")).toBeVisible();
  await page.unroute("**/api/v1/boards/*/ops");
  await page.getByRole("button", { name: "Retry" }).first().click();
  await settled(page);
  expect((await serverBoard(request, id)).nodes.map((n) => n.text).sort()).toEqual(["One", "Root", "Two"]);
});

/** A full node row as the API stores it (for seeding through /ops). */
const row = (p: Partial<ApiNode> & { id: string; kind: string; text: string }) => ({ parent_id: null, parent_key: null, position: 0, x: 0, y: 0, w: 0, h: 0, notes: "", style: {}, collapsed: false, hidden: false, ref_key: null, frame_id: null, ...p });
const seed = async (request: import("@playwright/test").APIRequestContext, id: string, nodes: ReturnType<typeof row>[]) => {
  for (let i = 0; i < nodes.length; i += 500) {
    await api(request, `/boards/${id}/ops`, { method: "POST", data: { ops: nodes.slice(i, i + 500).map((node) => ({ op: "upsert_node", base_updated_at: null, node })) } });
  }
};

test("two quick edits of one row while the first save is in flight both persist, with no stale toast", async ({ page, request }) => {
  const id = await newBoard(request, "Own write race");
  await seed(request, id, [row({ id: crypto.randomUUID(), kind: "sticky", text: "Nudge me", x: 200, y: 200, w: 170, h: 130, style: { color: "yellow" } })]);
  await open(page, id);
  const before = (await serverBoard(request, id)).nodes[0];
  await page.route("**/api/v1/boards/*/ops", async (r) => { await new Promise((res) => setTimeout(res, 400)); await r.continue(); });
  await page.locator(".nm-sticky").click();
  await page.keyboard.press("ArrowRight");          // +10, saved 600 ms later and in flight for 400 ms
  await page.waitForTimeout(700);                    // inside that flight
  await page.keyboard.press("ArrowRight");          // +10 again, queued with the base it had before the first write
  await settled(page);
  await page.waitForTimeout(500);
  await settled(page);
  await expect(page.getByTestId("toast")).toHaveCount(0);       // no "Kept newer changes from another device"
  expect((await serverBoard(request, id)).nodes[0].x).toBe(before.x + 20);
});

test("two tabs keep separate pending queues; a closed tab's unsent work is adopted", async ({ page, context, request }) => {
  const id = await newBoard(request, "Two queues");
  await open(page, id);
  await page.route("**/api/v1/boards/*/ops", (r) => r.abort("internetdisconnected"));
  await page.keyboard.press("m");
  await page.mouse.click(500, 400);
  await typeInto(page, "From tab A");
  await page.keyboard.press("Escape");
  await expect(status(page)).not.toHaveAttribute("data-status", "saved");
  const keys = () => page.evaluate((b) => Object.keys(localStorage).filter((k) => k.startsWith(`niyyah-map-pending-${b}-`)), id);
  expect(await keys()).toHaveLength(1);
  // a second tab (own sessionStorage, same localStorage) saves its own work without touching tab A's queue
  const b = await context.newPage();
  await open(b, id);
  await b.keyboard.press("m");
  await b.mouse.click(900, 600);
  await typeInto(b, "From tab B");
  await b.keyboard.press("Escape");
  await settled(b);
  expect(await keys()).toHaveLength(1);                                   // A's queue is still there
  expect(await page.evaluate((k) => localStorage.getItem(k), (await keys())[0])).toContain("From tab A");
  await page.unroute("**/api/v1/boards/*/ops");
  await page.getByRole("button", { name: "Retry" }).first().click();
  await settled(page);
  expect((await serverBoard(request, id)).nodes.map((n) => n.text).sort()).toEqual(["From tab A", "From tab B"]);
  await b.close();

  // a tab that died (old heartbeat) left unsent work: the next queue on that board takes it over
  const id2 = await newBoard(request, "Dead tab");
  const op = { op: "upsert_node", base_updated_at: null, node: { ...row({ id: crypto.randomUUID(), kind: "mind", text: "Rescued", x: 0, y: 0 }), updated_at: null } };
  const c = await context.newPage();
  await c.addInitScript(([bid, o]) => {
    localStorage.setItem(`niyyah-map-pending-${bid}-deadtab`, JSON.stringify([o]));
    localStorage.setItem("niyyah-map-hb-deadtab", String(Date.now() - 120_000));
  }, [id2, op] as const);
  await open(c, id2);
  await expect(mind(c, "Rescued")).toBeVisible();
  await settled(c);
  expect((await serverBoard(request, id2)).nodes.map((n) => n.text)).toEqual(["Rescued"]);
  expect(await c.evaluate((bid) => Object.keys(localStorage).filter((k) => k.includes("deadtab") && k.includes(bid)), id2)).toHaveLength(0);
  await c.close();
});

test("undoing the delete of a 600-node subtree restores it, parents first, with no refused batch", async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = await newBoard(request, "Big subtree");
  const root = crypto.randomUUID(), hub = crypto.randomUUID();
  await seed(request, id, [
    row({ id: root, kind: "mind", text: "Root" }),
    row({ id: hub, kind: "mind", text: "Hub", parent_id: root, style: { side: "R", color: "violet" } }),
    ...Array.from({ length: 599 }, (_, i) => row({ id: crypto.randomUUID(), kind: "mind", text: `leaf ${i}`, parent_id: hub, position: i })),
  ]);
  await open(page, id);
  await page.waitForTimeout(1500);
  await mind(page, "Root").click();
  await page.keyboard.press("ArrowRight");                   // onto Hub
  await expect(page.locator(".nm-mind.sel-ring")).toContainText("Hub");
  await page.keyboard.press("Delete");
  await expect(mind(page, "leaf 0")).toHaveCount(0);
  await settled(page);
  expect((await serverBoard(request, id)).nodes).toHaveLength(1);
  await page.keyboard.press("Control+z");
  await expect(mind(page, "leaf 598")).toBeVisible();
  await settled(page);
  await page.waitForTimeout(1500);
  await expect(status(page)).toHaveAttribute("data-status", "saved");     // not retrying, not dropped
  await expect(page.getByTestId("toast")).not.toContainText("dropped");
  const b = await serverBoard(request, id);
  expect(b.nodes).toHaveLength(601);
  expect(b.nodes.filter((n) => n.parent_id === hub)).toHaveLength(599);
});

test("looks right in paper light, paper dark and another skin", async ({ page }) => {
  await open(page, boardId);
  await page.getByTestId("board-menu").click();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${OUT}/map-paper-light.png` });   // nothing selected: minimap and zoom bar visible
  await mind(page, "Design").click();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: `${OUT}/map-paper-dark.png` });
  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "light"); document.documentElement.setAttribute("data-skin", "editorial"); });
  await page.screenshot({ path: `${OUT}/map-skin-editorial.png` });
  await page.evaluate(() => { document.documentElement.setAttribute("data-skin", "oled"); });
  await page.screenshot({ path: `${OUT}/map-skin-oled.png` });
  await page.evaluate(() => { document.documentElement.removeAttribute("data-skin"); });
});
