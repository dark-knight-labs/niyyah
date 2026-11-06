import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The Life tree v2 against a plan that mirrors the owner's production counts (2026-11-06): Block -> Goals + Week + Products -> Lanes -> items.
 * Blocks kahf, finance and distribution are added to the seeded account; every count below is the one measured on prod.
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
interface Item { line: number; hash: string; text: string; lane: string; checkpoint: string | null; products?: string[] }
const pipeline = async (request: APIRequestContext) => (await call(request, "/vault/pipelines")) as { streams: { stream: string; items: Item[] }[] };
const itemNamed = async (request: APIRequestContext, text: string) => {
  for (const s of (await pipeline(request)).streams) { const it = s.items.find((i) => i.text === text); if (it) return { stream: s.stream, item: it }; }
  return null;
};
const lifeBoard = async (request: APIRequestContext) => {
  const list = (await call(request, "/boards")) as { id: number; kind: string }[];
  const id = list.find((b) => b.kind === "life")!.id;
  return (await call(request, `/boards/${id}`)) as { id: number; nodes: { id: string; kind: string; text: string; parent_key: string | null; ref_key: string | null; hidden: boolean; collapsed: boolean }[] };
};

const key = (page: Page, k: string) => page.getByTestId(`mind-${k}`);
const node = (page: Page, text: string) => page.locator(".nm-mind", { hasText: text }).first();
const status = (page: Page) => page.getByTestId("save-status");
const settled = async (page: Page) => { await page.waitForTimeout(700); await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 15_000 }); };
const editorReady = (page: Page) => page.waitForFunction(() => { const a = document.activeElement as HTMLElement | null; return !!a && a.isContentEditable && a.classList.contains("nm-t"); });
const openLife = async (page: Page, query = "") => { await page.goto(`/map?board=life${query}`); await page.waitForSelector(".nm-mind"); await page.waitForTimeout(600); };
const parentOf = (page: Page, k: string) => key(page, k).getAttribute("data-parent");
const countOf = async (page: Page, k: string) => (await key(page, k).locator(".nm-tag").textContent())?.trim();
const yOf = async (page: Page, k: string) => (await key(page, k).boundingBox())!.y;

const addStream = (request: APIRequestContext, stream: string, name: string, color: string) =>
  call(request, "/vault/quarter/stream", { method: "POST", data: { stream, name, goal: `${name} goal`, color, status: "committed", checkpoints: { nov: `${name} goal for November` } } });
const addItems = (request: APIRequestContext, stream: string, lane: string, texts: string[]) =>
  call(request, `/vault/pipeline/${stream}/items`, { method: "POST", data: { texts, lane } });

/** [stream, lane, tag, n]: tag "" = untagged. The first item of every group also names a month. */
const MIRROR: [string, string, string, number][] = [
  ["kahf", "now", "", 4], ["kahf", "next", "", 6], ["kahf", "backlog", "", 2],
  ["kahf", "now", "infra", 1], ["kahf", "backlog", "infra", 1], ["kahf", "next", "internet", 1], ["kahf", "backlog", "internet", 1], ["kahf", "backlog", "router", 4],
  ["finance", "now", "", 1], ["finance", "backlog", "mec-payment", 1],
  ["distribution", "now", "", 1], ["distribution", "next", "", 1], ["distribution", "backlog", "", 1], ["distribution", "now", "ai-harness", 1], ["distribution", "backlog", "opportunity", 1],
];
const name = (stream: string, lane: string, tag: string, i: number) => `${stream} ${lane} ${tag || "plain"} ${i + 1}`;

test("setup: the owner's production counts become a plan", async ({ request }) => {
  await addStream(request, "kahf", "Kahf", "emerald");
  await addStream(request, "finance", "Finance", "amber");
  await addStream(request, "distribution", "Distribution", "sky");
  for (const [stream, lane, tag, n] of MIRROR) {
    // the tag is the item's first tag (typed as #word); the first item of a group names November
    await addItems(request, stream, lane, Array.from({ length: n }, (_, i) => `${name(stream, lane, tag, i)}${tag ? ` #${tag}` : ""}${i === 0 ? " #nov" : ""}`));
  }
  const p = await pipeline(request);
  expect(p.streams.find((s) => s.stream === "kahf")!.items).toHaveLength(20);
});

test("Kahf: products infra / internet / router with their lanes, counts as measured on prod", async ({ page }) => {
  await openLife(page, "&node=stream:kahf");
  for (const k of ["prod:kahf:infra", "prod:kahf:internet", "prod:kahf:router"]) expect(await parentOf(page, k)).toBe("stream:kahf");
  const lanes: [string, string][] = [
    ["lane:kahf:infra:now", "1"], ["lane:kahf:infra:backlog", "1"], ["lane:kahf:internet:next", "1"], ["lane:kahf:internet:backlog", "1"], ["lane:kahf:router:backlog", "4"],
    ["lane:kahf:_:now", "4"], ["lane:kahf:_:next", "6"], ["lane:kahf:_:backlog", "2"],
  ];
  for (const [k, n] of lanes) { await expect(key(page, k)).toBeVisible(); expect(await countOf(page, k), k).toBe(n); }
  // product lanes sit under their product, the untagged lanes directly under the block, and only non-empty lanes exist
  expect(await parentOf(page, "lane:kahf:infra:now")).toBe("prod:kahf:infra");
  expect(await parentOf(page, "lane:kahf:router:backlog")).toBe("prod:kahf:router");
  expect(await parentOf(page, "lane:kahf:_:now")).toBe("stream:kahf");
  for (const k of ["lane:kahf:router:now", "lane:kahf:router:next", "lane:kahf:infra:next", "lane:kahf:_:done"]) await expect(key(page, k)).toHaveCount(0);
  await expect(key(page, "prod:kahf:infra")).toContainText("infra");
  await expect(key(page, "lane:kahf:infra:now")).toContainText("Now");
  await expect(key(page, "lane:kahf:internet:backlog")).toContainText("Someday");
  // 20 items, each under a lane; no item hangs on the block or a product
  const items = page.locator('[data-testid^="mind-task:"]');
  expect(await items.evaluateAll((els) => els.filter((e) => (e.getAttribute("data-parent") ?? "").startsWith("lane:kahf:")).length)).toBe(20);
  await page.screenshot({ path: `${OUT}/tree-kahf-expanded.png` });
});

test("Finance and Distribution mirror prod; blocks with only untagged items have lanes straight under the block", async ({ page }) => {
  await openLife(page);
  expect(await parentOf(page, "lane:finance:mec-payment:backlog")).toBe("prod:finance:mec-payment");
  expect(await countOf(page, "lane:finance:mec-payment:backlog")).toBe("1");
  expect(await countOf(page, "lane:finance:_:now")).toBe("1");
  for (const [k, n] of [["lane:distribution:ai-harness:now", "1"], ["lane:distribution:opportunity:backlog", "1"], ["lane:distribution:_:now", "1"], ["lane:distribution:_:next", "1"], ["lane:distribution:_:backlog", "1"]]) expect(await countOf(page, k), k).toBe(n);
  // studio: "Wire the router" carries the tags Router and Studio, its first tag is the product; the rest are untagged
  await expect(page.locator('[data-testid^="mind-prod:studio:"]')).toHaveCount(1);
  await expect(key(page, "prod:studio:router")).toContainText("Router");
  expect(await parentOf(page, "lane:studio:router:now")).toBe("prod:studio:router");
  expect(await parentOf(page, "lane:studio:_:next")).toBe("stream:studio");
});

test("order: Now above Next above Someday, products alphabetical, items in pipeline order, goals are leaves with a month", async ({ page }) => {
  await openLife(page, "&node=stream:kahf");
  const y = (k: string) => yOf(page, k);
  expect(await y("lane:kahf:_:now")).toBeLessThan(await y("lane:kahf:_:next"));
  expect(await y("lane:kahf:_:next")).toBeLessThan(await y("lane:kahf:_:backlog"));
  expect(await y("prod:kahf:infra")).toBeLessThan(await y("prod:kahf:internet"));
  expect(await y("prod:kahf:internet")).toBeLessThan(await y("prod:kahf:router"));
  const ys: number[] = [];
  for (let i = 0; i < 4; i++) ys.push((await node(page, name("kahf", "now", "", i)).boundingBox())!.y);
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  // the November goal: a leaf, with its month tag; items name their month in a tag instead of hanging under it
  const goal = key(page, "cp:kahf:nov");
  await expect(goal).toContainText("Kahf goal for November");
  await expect(goal.locator(".nm-tag")).toHaveText("NOV");
  expect(await parentOf(page, "cp:kahf:nov")).toBe("stream:kahf");
  await expect(page.locator('[data-parent="cp:kahf:nov"]')).toHaveCount(0);
  await expect(node(page, name("kahf", "now", "", 0)).locator(".nm-tag")).toHaveText("NOV");
  await expect(node(page, name("kahf", "now", "", 1)).locator(".nm-tag")).toHaveCount(0);
});

test("tags group case-insensitively under the first spelling; a tag with spaces or non-ASCII still gets a product (hash key starting with _)", async ({ page, request }) => {
  await addStream(request, "lab", "Lab", "rose");
  await addItems(request, "lab", "next", ["lab one #Router", "lab two #router", "lab three [product:: Café au lait]"]);
  await openLife(page);
  await expect(page.locator('[data-testid^="mind-prod:lab:"]')).toHaveCount(2);
  await expect(key(page, "prod:lab:router")).toContainText("Router");
  expect(await countOf(page, "lane:lab:router:next")).toBe("2");
  const cafe = page.locator('[data-testid^="mind-prod:lab:_"]');
  await expect(cafe).toHaveCount(1);
  await expect(cafe).toContainText("Café au lait");
});

test("a collapsed lane whose last item moves away leaves no GONE item behind", async ({ page, request }) => {
  await openLife(page);
  await key(page, "lane:finance:mec-payment:backlog").click();
  await page.keyboard.press("Control+.");
  await settled(page);
  expect((await lifeBoard(request)).nodes.some((n) => n.ref_key === "lane:finance:mec-payment:backlog" && n.collapsed)).toBe(true);
  const it = (await itemNamed(request, name("finance", "backlog", "mec-payment", 0)))!;
  await call(request, "/vault/pipeline/move", { method: "PUT", data: { stream: "finance", line: it.item.line, hash: it.item.hash, lane: "now" } });
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await page.waitForTimeout(500);
  await expect(key(page, "lane:finance:mec-payment:backlog")).toHaveCount(0);
  await expect(key(page, "lane:finance:mec-payment:now")).toBeVisible();
  await expect(node(page, "Unplaced")).toHaveCount(0);
  await expect(page.getByText("PLAN ITEM GONE")).toHaveCount(0);
});

test("Make item under a product lane takes the lane, the product and the block from its place", async ({ page, request }) => {
  await openLife(page, "&node=stream:kahf");
  await key(page, "lane:kahf:infra:backlog").click();
  await page.keyboard.press("Tab");
  await editorReady(page);
  await page.keyboard.type("Replace the core switch");
  await page.keyboard.press("Escape");
  await node(page, "Replace the core switch").click();
  const make = page.getByTestId("make-item");
  await expect(make.getByLabel("Block")).toHaveValue("kahf");
  await expect(make.getByLabel("Product")).toHaveValue("infra");
  await expect(make.locator('[data-mklane="backlog"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("make-item-go").click();
  await expect(page.getByTestId("toast")).toContainText("Added to Kahf · Someday");
  const made = (await itemNamed(request, "Replace the core switch"))!;
  expect(made.stream).toBe("kahf");
  expect(made.item.lane).toBe("backlog");
  expect(made.item.products?.[0]).toBe("infra");
  expect(made.item.checkpoint).toBeNull();
  await expect.poll(async () => parentOf(page, `task:${made.item.line}`)).toBe("lane:kahf:infra:backlog");
  expect(await countOf(page, "lane:kahf:infra:backlog")).toBe("2");
});

test("Make item: product can be chosen, lane is changeable; under a goal the month comes from the goal; under the block lane defaults to Next", async ({ page, request }) => {
  await openLife(page, "&node=stream:kahf");
  await key(page, "lane:kahf:_:now").click();
  await page.keyboard.press("Tab");
  await editorReady(page);
  await page.keyboard.type("Call the ISP");
  await page.keyboard.press("Escape");
  await node(page, "Call the ISP").click();
  const make = page.getByTestId("make-item");
  await expect(make.getByLabel("Product")).toHaveValue("");
  await expect(make.locator('[data-mklane="now"]')).toHaveAttribute("aria-pressed", "true");
  await make.getByLabel("Product").selectOption("router");
  await make.locator('[data-mklane="next"]').click();
  await page.getByTestId("make-item-go").click();
  await expect(page.getByTestId("toast")).toContainText("Added to Kahf · Next");
  const made = (await itemNamed(request, "Call the ISP"))!;
  expect([made.item.lane, made.item.products?.[0]]).toEqual(["next", "router"]);
  await expect.poll(async () => parentOf(page, `task:${made.item.line}`)).toBe("lane:kahf:router:next");

  await openLife(page, "&node=cp:kahf:nov");                           // the goal is selected and centred
  await page.keyboard.press("Tab");
  await editorReady(page);
  await page.keyboard.type("Review the quarter");
  await page.keyboard.press("Escape");
  await node(page, "Review the quarter").click();
  await expect(page.getByTestId("make-item").locator('[data-mklane="next"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("make-item-go").click();
  await expect(page.getByTestId("toast")).toContainText("Added to Kahf · Next");
  expect((await itemNamed(request, "Review the quarter"))!.item.checkpoint).toBe("nov");
});

test("live items still snap back: dropping an item on another lane changes nothing", async ({ page, request }) => {
  await openLife(page, "&node=stream:kahf");
  const t = name("kahf", "next", "internet", 0);
  const from = (await node(page, t).boundingBox())!;
  const to = (await key(page, "lane:kahf:router:backlog").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("toast")).toContainText("Plan items keep their place");
  expect((await itemNamed(request, t))!.item.lane).toBe("next");
  const after = (await node(page, t).boundingBox())!;
  expect(Math.abs(after.x - from.x)).toBeLessThan(2);
});

test("Make item under a product whose tag the API refuses: no product is sent, the card says why", async ({ page, request }) => {
  await openLife(page, "&node=stream:lab");
  const lane = page.locator('[data-testid^="mind-lane:lab:_"]').first();      // the Café au lait product's lane
  await expect(lane).toBeVisible();
  await lane.click();
  await page.keyboard.press("Tab");
  await editorReady(page);
  await page.keyboard.type("Brew a test pot");
  await page.keyboard.press("Escape");
  await node(page, "Brew a test pot").click();
  const make = page.getByTestId("make-item");
  await expect(make.getByLabel("Product")).toHaveValue("");
  await expect(make.getByLabel("Product").locator("option", { hasText: "Café" })).toHaveCount(0);
  await expect(page.getByTestId("product-note")).toContainText("can't be set from the map");
  await page.getByTestId("make-item-go").click();
  await expect(page.getByTestId("toast")).toContainText("Added to Lab · Next");
  const made = (await itemNamed(request, "Brew a test pot"))!;
  expect(made.item.products ?? []).toEqual([]);
});

test("a refused product shows a readable message, not [object Object]", async ({ page }) => {
  await openLife(page, "&node=stream:lab");
  await key(page, "lane:lab:router:next").click();
  await page.keyboard.press("Tab");
  await editorReady(page);
  await page.keyboard.type("Send a bad tag");
  await page.keyboard.press("Escape");
  await page.route("**/nodes/*/promote", (route) => route.continue({ postData: JSON.stringify({ ...JSON.parse(route.request().postData() ?? "{}"), product: "bad tag" }) }));
  await node(page, "Send a bad tag").click();
  await page.getByTestId("make-item-go").click();
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("product must be a tag");
  await expect(toast).not.toContainText("[object");
  await page.unroute("**/nodes/*/promote");
});

test("a done item that kept a state row is not shown as a gone Plan item while Show done is off", async ({ page, request }) => {
  await addItems(request, "lab", "next", ["Finish me early"]);
  await openLife(page);
  await node(page, "Finish me early").click();
  await page.keyboard.press("Delete");                                       // hides it: one stored task: state row
  await settled(page);
  expect((await lifeBoard(request)).nodes.some((n) => n.ref_key?.startsWith("task:") && n.hidden)).toBe(true);
  const it = (await itemNamed(request, "Finish me early"))!;
  await call(request, "/vault/pipeline/move", { method: "PUT", data: { stream: "lab", line: it.item.line, hash: it.item.hash, lane: "done" } });
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await page.waitForTimeout(500);
  await expect(node(page, "Finish me early")).toHaveCount(0);
  await expect(node(page, "Unplaced")).toHaveCount(0);
});

test("thoughts under a done item hide with it while Show done is off, and come back when it is on; they are not Unplaced", async ({ page, request }) => {
  await addItems(request, "lab", "next", ["Carry a thought"]);
  await openLife(page);
  await node(page, "Carry a thought").click();
  await page.keyboard.press("Tab");
  await editorReady(page);
  await page.keyboard.type("Child thought");
  await page.keyboard.press("Escape");
  await node(page, "Child thought").click();
  await page.keyboard.press("Tab");
  await editorReady(page);
  await page.keyboard.type("Grandchild thought");
  await page.keyboard.press("Escape");
  await settled(page);
  const it = (await itemNamed(request, "Carry a thought"))!;
  await call(request, "/vault/pipeline/move", { method: "PUT", data: { stream: "lab", line: it.item.line, hash: it.item.hash, lane: "done" } });
  await page.reload();
  await page.waitForSelector(".nm-mind");
  await page.waitForTimeout(500);
  for (const t of ["Carry a thought", "Child thought", "Grandchild thought", "Unplaced"]) await expect(node(page, t), t).toHaveCount(0);
  await page.getByTestId("board-menu").click();
  await page.getByTestId("show-done").click();
  for (const t of ["Carry a thought", "Child thought", "Grandchild thought"]) await expect(node(page, t), t).toBeVisible();
  expect(await node(page, "Child thought").getAttribute("data-parent")).toBe(`task:${it.item.line}`);
  await expect(node(page, "Unplaced")).toHaveCount(0);
  await page.getByTestId("board-menu").click();                          // leave Show done off for the tests after this one
  await page.getByTestId("show-done").click();
  await expect(node(page, "Child thought")).toHaveCount(0);
});

test("Life board screenshots with the production-mirroring plan: paper light and dark", async ({ page }) => {
  await openLife(page);
  await page.getByRole("button", { name: "Fit everything" }).click().catch(() => undefined);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/tree-life-paper-light.png` });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: `${OUT}/tree-life-paper-dark.png` });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
});
