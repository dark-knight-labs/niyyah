import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The Life board against the seeded plan (run.sh): the derived tree, thoughts hung on it, Make item, Show on map from Plan,
 * Hide and the hidden list, and what happens when a Plan item disappears. Seed: block "studio" (checkpoint Nov "Router live",
 * item "Wire the router" under it, "Plan the DNS cutover" next, "Replace the switch" someday) and block "shop".
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
interface Item { line: number; hash: string; text: string; lane: string; checkpoint: string | null }
const pipeline = async (request: APIRequestContext) => (await call(request, "/vault/pipelines")) as { streams: { stream: string; items: Item[] }[] };
const itemNamed = async (request: APIRequestContext, text: string) => {
  for (const s of (await pipeline(request)).streams) { const it = s.items.find((i) => i.text === text); if (it) return { stream: s.stream, item: it }; }
  return null;
};
const lifeBoard = async (request: APIRequestContext) => {
  const list = (await call(request, "/boards")) as { id: number; kind: string }[];
  const id = list.find((b) => b.kind === "life")!.id;
  return (await call(request, `/boards/${id}`)) as { id: number; nodes: { id: string; kind: string; text: string; parent_id: string | null; parent_key: string | null; ref_key: string | null; hidden: boolean }[] };
};

const node = (page: Page, text: string) => page.locator(".nm-mind", { hasText: text }).first();
const status = (page: Page) => page.getByTestId("save-status");
const settled = async (page: Page) => { await page.waitForTimeout(700); await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 15_000 }); };
const editorReady = (page: Page) => page.waitForFunction(() => { const a = document.activeElement as HTMLElement | null; return !!a && a.isContentEditable && a.classList.contains("nm-t"); });
const openLife = async (page: Page, query = "") => { await page.goto(`/map?board=life${query}`); await page.waitForSelector(".nm-mind"); await page.waitForTimeout(500); };
const hang = async (page: Page, under: string, text: string) => {
  await node(page, under).click();
  await page.keyboard.press("Tab");
  await editorReady(page);
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
};

test("the Life board shows the plan: root, blocks, checkpoint, items with lane tags; done items stay out", async ({ page }) => {
  await openLife(page);
  await expect(page.getByTestId("board-name")).toHaveText("Life");
  await expect(page.locator(".nm-sub")).toHaveText(/Q4 · Super Objective/i);
  for (const t of ["Studio", "Shop", "Router live", "Wire the router", "Plan the DNS cutover", "Replace the switch"]) await expect(node(page, t).first()).toBeVisible();
  await expect(node(page, "Plan the DNS cutover").locator(".nm-tag")).toHaveText("NEXT");
  await expect(node(page, "Replace the switch").locator(".nm-tag")).toHaveText("SOMEDAY");
  await expect(page.locator(".nm-mind", { hasText: "Wire the router" }).locator(".nm-tag.now")).toHaveText("NOW");
  await expect(node(page, "Order the modem")).toHaveCount(0);
  // under its checkpoint: the card says so
  await page.locator(".nm-mind", { has: page.locator(".nm-tag.now") }).first().click();
  const card = page.getByTestId("side-card");
  await expect(card).toContainText("Plan item · live");
  await expect(card).toContainText("Studio");
  await expect(card).toContainText("NOV");
  await page.screenshot({ path: `${OUT}/map-life-paper-light.png` });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: `${OUT}/map-life-paper-dark.png` });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  // Show done brings the done item back
  await page.getByTestId("board-menu").click();
  await page.getByTestId("show-done").click();
  await expect(node(page, "Order the modem")).toBeVisible();
  await page.getByTestId("board-menu").click();
  await page.getByTestId("show-done").click();
  await expect(node(page, "Order the modem")).toHaveCount(0);
});

test("a thought hung under a Plan item persists after reload and is stored by key, with no state row", async ({ page, request }) => {
  await openLife(page);
  await hang(page, "Plan the DNS cutover", "Ask the ISP about the static IP");
  await settled(page);
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await expect(node(page, "Ask the ISP")).toBeVisible();
  const target = (await itemNamed(request, "Plan the DNS cutover"))!;
  const b = await lifeBoard(request);
  const thought = b.nodes.find((n) => n.text === "Ask the ISP about the static IP")!;
  expect(thought.kind).toBe("mind");
  expect(thought.parent_key).toBe(`task:${target.item.line}`);
  expect(b.nodes.some((n) => n.kind === "ref")).toBe(false);          // nothing is stored for a derived node until its state changes
});

test("collapsing a derived node stores one state row; Make item turns a thought into a live item in the chosen lane", async ({ page, request }) => {
  await openLife(page);
  await node(page, "Shop").click();
  await page.keyboard.press("Control+.");                              // Shop has a week objective: it collapses
  await settled(page);
  expect((await lifeBoard(request)).nodes.filter((n) => n.kind === "ref").map((n) => n.ref_key)).toEqual(["stream:shop"]);
  await page.keyboard.press("Control+.");
  await settled(page);

  await hang(page, "Shop", "Draft the FAQ page");
  await expect(node(page, "Draft the FAQ page")).toBeVisible();
  await node(page, "Draft the FAQ page").click();
  const make = page.getByTestId("make-item");
  await expect(make).toBeVisible();
  await expect(make.getByLabel("Block")).toHaveValue("shop");          // the nearest block above it
  await make.locator('[data-mklane="backlog"]').click();
  await page.getByTestId("make-item-go").click();
  await expect(page.getByTestId("toast")).toContainText("Added to Shop · Someday. It is a live Plan item now.");
  await expect(page.locator(".nm-mind", { hasText: "Draft the FAQ page" }).locator(".nm-tag")).toHaveText("SOMEDAY");
  const made = (await itemNamed(request, "Draft the FAQ page"))!;
  expect(made.stream).toBe("shop");
  expect(made.item.lane).toBe("backlog");
  // visible on /plan in that lane
  await page.goto("/plan");
  await page.getByRole("tab", { name: /^Someday/ }).click();
  await expect(page.getByText("Draft the FAQ page").first()).toBeVisible();
  // and there is exactly one node for it on the board after a reload
  await openLife(page);
  await expect(page.locator(".nm-mind", { hasText: "Draft the FAQ page" })).toHaveCount(1);
});

test("Make item under a checkpoint: one node, under that checkpoint, children kept", async ({ page, request }) => {
  await openLife(page);
  await hang(page, "Router live", "Test the failover");
  await hang(page, "Test the failover", "Pull the cable");
  await node(page, "Test the failover").click();
  await page.getByTestId("make-item").locator('[data-mklane="now"]').click();
  await page.getByTestId("make-item-go").click();
  await expect(page.getByTestId("toast")).toContainText("Added to Studio · Now");
  await expect(page.locator(".nm-mind", { hasText: "Test the failover" })).toHaveCount(1);
  await expect(node(page, "Pull the cable")).toBeVisible();            // the child follows it
  const made = (await itemNamed(request, "Test the failover"))!;
  expect(made.item.checkpoint).toBe("nov");                            // taken from the branch it sat in
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await expect(page.locator(".nm-mind", { hasText: "Test the failover" })).toHaveCount(1);
  await node(page, "Test the failover").click();
  await expect(page.getByTestId("side-card")).toContainText("NOV");
  await expect(node(page, "Pull the cable")).toBeVisible();
  const b = await lifeBoard(request);
  expect(b.nodes.filter((n) => n.text === "Test the failover" && n.kind === "ref")).toHaveLength(1);
});

test("Show on map from /plan opens the Life board with that item selected", async ({ page }) => {
  await page.goto("/plan");
  await page.getByRole("tab", { name: /^Next/ }).click();
  await page.getByText("Plan the DNS cutover").first().click();
  await page.getByRole("link", { name: "Show on map" }).click();
  await expect(page).toHaveURL(/\/map\?board=life&node=task:\d+/);
  await expect(page.locator(".nm-mind.sel-ring")).toContainText("Plan the DNS cutover", { timeout: 15_000 });
  await expect(page.getByTestId("side-card")).toContainText("Plan item · live");
  // centred in what the card leaves free: the node and its context bar sit left of the card
  await page.waitForTimeout(500);
  const card = (await page.getByTestId("side-card").boundingBox())!;
  const sel = (await page.locator(".nm-mind.sel-ring").boundingBox())!;
  const bar = (await page.getByRole("toolbar", { name: "Selection actions" }).boundingBox())!;
  expect(sel.x + sel.width).toBeLessThanOrEqual(card.x);
  expect(bar.x + bar.width).toBeLessThanOrEqual(card.x);
  expect(bar.x).toBeGreaterThanOrEqual(60);
  await page.screenshot({ path: `${OUT}/map-life-show-on-map.png` });
});

test("Make item then Ctrl+Z leaves the live item alone: no duplicate, still linked", async ({ page, request }) => {
  await openLife(page);
  await hang(page, "Shop", "Undo me not");
  await node(page, "Undo me not").click();
  await page.getByTestId("make-item-go").click();
  await expect(page.getByTestId("toast")).toContainText("It is a live Plan item now");
  await expect(node(page, "Undo me not").locator(".nm-tag")).toHaveText("NEXT");
  await page.mouse.click(700, 150);                                       // off the card, the board has focus
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1200);
  await expect(page.locator(".nm-mind", { hasText: "Undo me not" })).toHaveCount(1);
  await expect(node(page, "Undo me not").locator(".nm-tag")).toHaveText("NEXT");
  await settled(page);
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await expect(page.locator(".nm-mind", { hasText: "Undo me not" })).toHaveCount(1);
  const b = await lifeBoard(request);
  expect(b.nodes.filter((n) => n.text === "Undo me not")).toHaveLength(1);
  expect(b.nodes.find((n) => n.text === "Undo me not")!.kind).toBe("ref");
});

test("Make item on a free board selects the promoted node", async ({ page, request }) => {
  const list = (await call(request, "/boards", { method: "POST", data: { title: "Free promote" } })) as { id: number };
  await page.goto(`/map?board=${list.id}`);
  await page.waitForSelector('[data-testid="map-canvas"] .react-flow__renderer');
  await page.waitForTimeout(500);
  await page.keyboard.press("m");
  await page.mouse.click(600, 450);
  await editorReady(page);
  await page.keyboard.type("Free thought");
  await page.keyboard.press("Escape");
  await node(page, "Free thought").click();
  await page.getByTestId("make-item-go").click();
  await expect(page.getByTestId("toast")).toContainText("It is a live Plan item now");
  await expect(page.locator(".nm-mind.sel-ring")).toContainText("Free thought");
  await expect(page.getByTestId("side-card")).toContainText("Plan item · live");
  expect(await itemNamed(request, "Free thought")).not.toBeNull();
});

test("an edit made just before leaving the page is still saved (keepalive flush)", async ({ page, request }) => {
  await openLife(page);
  await hang(page, "Shop", "Typed then left at once");
  await page.goto("/plan");                                            // well inside the 600 ms debounce
  await expect.poll(async () => (await lifeBoard(request)).nodes.some((n) => n.text === "Typed then left at once"), { timeout: 10_000 }).toBe(true);
});

test("a collapsed branch opens for a deep link", async ({ page, request }) => {
  const target = (await itemNamed(request, "Wire the router"))!;
  await openLife(page);
  await node(page, "Studio").click();
  await page.keyboard.press("Control+.");
  await expect(node(page, "Wire the router")).toHaveCount(0);
  await settled(page);
  await page.goto(`/map?board=life&node=task:${target.item.line}`);
  await expect(page.locator(".nm-mind.sel-ring")).toContainText("Wire the router", { timeout: 15_000 });
  await settled(page);                                                 // the test context is torn down, which does not fire pagehide
});

test("Hide removes a live node from the board only; the hidden list restores it", async ({ page, request }) => {
  await openLife(page);
  await node(page, "Replace the switch").click();
  await page.keyboard.press("Delete");
  await expect(node(page, "Replace the switch")).toHaveCount(0);
  await expect(page.getByTestId("toast")).toContainText("stays in Plan");
  await settled(page);
  expect(await itemNamed(request, "Replace the switch")).not.toBeNull();   // /plan still has it
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await expect(node(page, "Replace the switch")).toHaveCount(0);
  await page.getByTestId("board-menu").click();
  await page.getByRole("menuitem", { name: /Replace the switch/ }).click();
  await expect(node(page, "Replace the switch")).toBeVisible();
  await settled(page);
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await expect(node(page, "Replace the switch")).toBeVisible();
});

test("the root cannot be hidden; a Plan item cannot be reparented by dragging", async ({ page }) => {
  await openLife(page);
  await page.locator(".nm-mind", { hasText: "Super Objective" }).click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".nm-mind", { hasText: "Super Objective" })).toBeVisible();
  const from = (await node(page, "Plan the DNS cutover").boundingBox())!;
  const to = (await node(page, "Shop").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("toast")).toContainText("Plan items keep their place from Plan");
  const after = (await node(page, "Plan the DNS cutover").boundingBox())!;
  expect(Math.abs(after.x - from.x)).toBeLessThan(2);
});

test("an item deleted in Plan moves its thoughts to Unplaced; nothing is deleted", async ({ page, request }) => {
  await call(request, "/vault/pipeline/studio/items", { method: "POST", data: { texts: ["Doomed item"], lane: "next" } });
  await openLife(page);
  await expect(node(page, "Doomed item")).toBeVisible({ timeout: 15_000 });
  await hang(page, "Doomed item", "Orphan thought");
  await settled(page);
  const doomed = (await itemNamed(request, "Doomed item"))!;
  await call(request, "/vault/pipeline/remove", { method: "POST", data: { stream: doomed.stream, line: doomed.item.line, hash: doomed.item.hash } });
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await expect(node(page, "Doomed item")).toHaveCount(0);
  await expect(node(page, "Unplaced")).toBeVisible();
  await expect(node(page, "Orphan thought")).toBeVisible();
  await page.screenshot({ path: `${OUT}/map-life-unplaced.png` });
  expect((await lifeBoard(request)).nodes.some((n) => n.text === "Orphan thought")).toBe(true);
});
