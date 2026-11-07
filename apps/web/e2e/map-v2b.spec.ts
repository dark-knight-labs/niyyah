import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { COMMANDS } from "../src/lib/map/commands";
import { SHAPE_IDS } from "../src/lib/map/shapes";

/** Map v2, window 2: shapes, sticky colours, connectors, clipboard, find, lock, order, align, guides, the "?" sheet. */
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
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addInitScript((tk) => { localStorage.setItem("access_token", tk.access_token); localStorage.setItem("refresh_token", tk.refresh_token); }, t);
});
const api = async (request: APIRequestContext, path: string, init?: { method?: string; data?: unknown }) => {
  const t = await login(request);
  const res = await request.fetch(`${API}/api/v1${path}`, { method: init?.method ?? "GET", data: init?.data, headers: { Authorization: `Bearer ${t.access_token}` } });
  expect(res.ok(), `${init?.method ?? "GET"} ${path} -> ${res.status()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
};
type N = { id: string; kind: string; text: string; x: number; y: number; w: number; h: number; style: Record<string, unknown>; parent_id: string | null };
const node = (id: string, kind: string, o: Record<string, unknown> = {}) => ({ op: "upsert_node", base_updated_at: null, node: { id, kind, text: id, ...o } });
const edge = (id: string, from: string, to: string, style: Record<string, unknown> = {}, label = "") => ({ op: "upsert_edge", base_updated_at: null, edge: { id, from_id: from, to_id: to, label, style } });
async function board(request: APIRequestContext, title: string, ops: unknown[]) {
  const b = await api(request, "/boards", { method: "POST", data: { title } });
  await api(request, `/boards/${b.id}/ops`, { method: "POST", data: { ops } });
  return String(b.id);
}
const server = async (request: APIRequestContext, id: string) => (await api(request, `/boards/${id}`)) as { nodes: N[]; edges: { id: string; from_id: string; to_id: string; label: string; style: Record<string, unknown> }[] };
const settled = async (page: Page) => { await page.waitForTimeout(700); await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 }); };
const open = async (page: Page, id: string) => { await page.goto(`/map?board=${id}`); await page.waitForSelector('[data-testid="map-canvas"] .react-flow__renderer'); await page.waitForSelector(".react-flow__node"); await page.waitForTimeout(700); };
const menuIds = (page: Page) => page.locator('[data-testid="context-menu"] [data-top-item]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cmd));
const pickSub = async (page: Page, cmd: string, choice: string) => { await page.locator(`[data-cmd="${cmd}"]`).hover(); await page.locator(`[data-sub="${cmd}"] [data-choice="${choice}"]`).click(); };
const sticky = (page: Page, id: string) => page.getByTestId(`sticky-${id}`);
const centre = async (loc: ReturnType<Page["locator"]>) => { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
/** Right-click the middle of the first connector (its interaction path is a thin line, so click a point on it, not in its box). */
async function rightClickEdge(page: Page) {
  const pt = await page.locator(".react-flow__edge-path.nm-link").first().evaluate((el) => { const p = el as unknown as SVGPathElement; const m = p.getPointAtLength(p.getTotalLength() * 0.4); const c = p.getScreenCTM()!; return { x: m.x * c.a + m.y * c.c + c.e, y: m.x * c.b + m.y * c.d + c.f }; });
  await page.mouse.click(pt.x, pt.y, { button: "right" });
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
}

test("all 12 shapes render; a sticky offers 8 colours", async ({ page, request }) => {
  const ops = SHAPE_IDS.map((s, i) => node(`sh-${s}`, "shape", { x: (i % 4) * 230, y: Math.floor(i / 4) * 150, w: 170, h: 100, text: s, style: s === "rect" ? {} : { shape: s, color: i % 2 ? "teal" : "orange" } }));
  ops.push(node("st", "sticky", { x: 1000, y: 0, w: 170, h: 130, style: { color: "yellow" } }));
  ops.push(node("odd", "shape", { x: 1000, y: 300, w: 170, h: 100, text: "odd", style: { shape: "diamond", color: "sky", border: "nope" } }));   // a colour key the shape palette does not have
  const id = await board(request, "Shapes", ops);
  await open(page, id);
  expect(SHAPE_IDS).toHaveLength(12);
  const odd = await page.getByTestId("shape-odd").locator("svg path").first().evaluate((p) => ({ fill: getComputedStyle(p).fill, stroke: getComputedStyle(p).stroke }));
  expect(odd.fill, "an unknown fill key falls back to paper, not black").not.toBe("rgb(0, 0, 0)"); expect(odd.stroke).not.toBe("none");
  for (const s of SHAPE_IDS) {
    const el = page.getByTestId(`shape-sh-${s}`);
    await expect(el, s).toBeVisible();
    await expect(el).toHaveAttribute("data-shape", s);
    if (s !== "rect" && s !== "rounded" && s !== "ellipse") await expect(el.locator("svg path").first(), `${s} draws a path`).toHaveAttribute("d", /\S/);
  }
  await page.getByTestId("shape-sh-diamond").click({ button: "right" });
  expect(await menuIds(page)).toEqual(expect.arrayContaining(["shapeKind", "color", "border", "bw", "dash", "convert"]));
  await page.keyboard.press("Escape");
  await pickShape(page, "star");
  await settled(page);
  expect((await server(request, id)).nodes.find((n) => n.id === "sh-diamond")!.style.shape).toBe("star");
  await page.mouse.click(1400, 800);
  await sticky(page, "st").click({ button: "right" });
  await page.locator('[data-cmd="color"]').hover();
  await expect(page.locator('[data-sub="color"] [data-choice]')).toHaveCount(8);
  await page.locator('[data-sub="color"] [data-choice="violet"]').click();
  await settled(page);
  expect((await server(request, id)).nodes.find((n) => n.id === "st")!.style.color).toBe("violet");
  await expect(sticky(page, "st")).toHaveClass(/violet/);
});
async function pickShape(page: Page, shape: string) { await page.getByTestId("shape-sh-diamond").click({ button: "right" }); await pickSub(page, "shapeKind", shape); }

test("connector style (path, width, dash, heads, colour) persists after reload; the edge menu edits it", async ({ page, request }) => {
  const id = await board(request, "Connectors", [
    node("a", "sticky", { x: 100, y: 200, w: 170, h: 130 }), node("b", "sticky", { x: 600, y: 200, w: 170, h: 130 }),
    edge("e1", "a", "b", { path: "straight", width: 5, dash: "dotted", start: "dot", end: "diamond", color: "rose" }, "needs"),
  ]);
  await open(page, id);
  const path = page.locator(".react-flow__edge-path.nm-link");
  const css = await path.evaluate((e) => { const c = getComputedStyle(e); return { w: c.strokeWidth, d: c.strokeDasharray, s: c.stroke }; });
  expect(css.w).toBe("5px"); expect(css.d).not.toBe("none"); expect(css.s).toBe("rgb(225, 29, 72)");   // --stream-rose
  await expect(page.locator(".react-flow__edges svg path:not(.react-flow__edge-path):not(.react-flow__edge-interaction)")).toHaveCount(2);   // two heads
  await expect(page.locator(".nm-elabel")).toHaveText("needs");
  // the edge menu
  await rightClickEdge(page);
  expect(await menuIds(page)).toEqual(["epath", "ewidth", "edash", "estart", "eend", "ecolor", "elabel", "eswap", "delete"]);
  await pickSub(page, "epath", "elbow");
  await rightClickEdge(page);
  await pickSub(page, "ewidth", "3");
  await rightClickEdge(page);
  await pickSub(page, "eend", "arrow");
  await settled(page);
  expect((await server(request, id)).edges[0].style).toMatchObject({ path: "elbow", width: 3, dash: "dotted", start: "dot", end: "arrow", color: "rose" });
  await page.reload(); await open(page, id);
  expect(await page.locator(".react-flow__edge-path.nm-link").evaluate((e) => getComputedStyle(e).strokeWidth)).toBe("3px");
  // swap direction
  await rightClickEdge(page);
  await page.locator('[data-cmd="eswap"]').click(); await settled(page);
  const e = (await server(request, id)).edges[0]; expect([e.from_id, e.to_id, e.style.start, e.style.end]).toEqual(["b", "a", "arrow", "dot"]);
});

test("dragging from a side port connects to a side port and remembers the sides", async ({ page, request }) => {
  const id = await board(request, "Ports", [node("a", "sticky", { x: 100, y: 200, w: 170, h: 130 }), node("b", "sticky", { x: 600, y: 200, w: 170, h: 130 })]);
  await open(page, id);
  await sticky(page, "a").click();
  const from = await centre(page.locator('.react-flow__node[data-id="a"] [data-handleid="p-r"]'));
  const to = await centre(sticky(page, "b"));
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 30, from.y + 5, { steps: 4 });
  const target = await centre(page.locator('.react-flow__node[data-id="b"] [data-handleid="p-l"]'));
  await page.mouse.move(target.x, target.y, { steps: 12 }); void to;
  await page.mouse.up(); await settled(page);
  const edges = (await server(request, id)).edges;
  expect(edges).toHaveLength(1);
  expect(edges[0].style).toMatchObject({ path: "curved", sp: "r", tp: "l" });
});

test("copy, cut, paste, duplicate; outline paste makes a subtree; Copy as outline", async ({ page, request }) => {
  const id = await board(request, "Clipboard", [
    node("st", "sticky", { x: 100, y: 100, w: 170, h: 130, text: "Original", style: { color: "blue" } }),
    node("r", "mind", { x: 700, y: 400, text: "Root" }), node("a", "mind", { parent_id: "r", text: "Alpha", style: { side: "R", color: "violet" } }), node("a1", "mind", { parent_id: "a", text: "Alpha child" }), node("b", "mind", { parent_id: "r", position: 1, text: "Beta", style: { side: "R", color: "orange" } }),
  ]);
  await open(page, id);
  await sticky(page, "st").click(); await page.keyboard.press("Control+c"); await page.keyboard.press("Control+v");
  await expect(page.locator(".nm-sticky")).toHaveCount(2);
  await page.keyboard.press("Control+d");
  await expect(page.locator(".nm-sticky")).toHaveCount(3);
  await settled(page);
  const s = await server(request, id);
  expect(s.nodes.filter((n) => n.text === "Original")).toHaveLength(3);
  expect(new Set(s.nodes.filter((n) => n.text === "Original").map((n) => n.id)).size).toBe(3);
  expect(s.nodes.filter((n) => n.text === "Original").every((n) => n.style.color === "blue")).toBe(true);
  // cut removes, paste brings back
  await page.keyboard.press("Control+x");
  await expect(page.locator(".nm-sticky")).toHaveCount(2);
  await page.keyboard.press("Control+v");
  await expect(page.locator(".nm-sticky")).toHaveCount(3);
  // branch: copy Alpha (with its child), paste under Beta
  await page.getByTestId("mind-a").click(); await page.keyboard.press("Control+c");
  await page.getByTestId("mind-b").click(); await page.keyboard.press("Control+v");
  await settled(page);
  const s2 = await server(request, id);
  const copy = s2.nodes.find((n) => n.text === "Alpha" && n.id !== "a")!;
  expect(copy.parent_id).toBe("b");
  expect(s2.nodes.find((n) => n.text === "Alpha child" && n.parent_id === copy.id)).toBeTruthy();
  // outline from the system clipboard onto a node -> subtree
  await page.evaluate(() => navigator.clipboard.writeText("Phase one\n  Design\n  Build\nPhase two"));
  await page.mouse.click(900, 200); await page.getByTestId("mind-r").click(); await page.keyboard.press("Control+v");
  await settled(page);
  const s3 = await server(request, id);
  const p1 = s3.nodes.find((n) => n.text === "Phase one")!;
  expect(p1.parent_id).toBe("r"); expect(s3.nodes.filter((n) => n.parent_id === p1.id).map((n) => n.text).sort()).toEqual(["Build", "Design"]); expect(s3.nodes.find((n) => n.text === "Phase two")!.parent_id).toBe("r");
  // Copy as outline (menu) puts Markdown on the system clipboard
  await page.mouse.click(900, 200);
  await page.getByTestId("mind-a").click({ button: "right" }); await page.locator('[data-cmd="copyOutline"]').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("- Alpha\n  - Alpha child");
});

test("copying or duplicating a frame that holds a promoted (live) item makes no live copy and no 422; the selection is the created rows", async ({ page, request }) => {
  const id = await board(request, "Frame with a live item", [
    node("fr", "frame", { x: 100, y: 100, w: 520, h: 360, text: "Frame" }),
    node("st", "sticky", { x: 140, y: 160, w: 170, h: 130, text: "Inside", frame_id: "fr" }),
    node("lv", "ref", { ref_key: "task:9", x: 340, y: 160, w: 200, h: 80, text: "Promoted", frame_id: "fr" }),
  ]);
  const refused: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/ops") && r.status() >= 400) refused.push(`${r.status()}`); });
  await open(page, id);
  await page.getByTestId("frame-fr").locator(".nm-ft").click();
  await page.keyboard.press("Control+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("- Frame");   // the system clipboard write is async: paste only after it landed (an earlier test leaves other text there)
  await page.keyboard.press("Control+v");
  await expect(page.locator('[data-testid^="frame-"]')).toHaveCount(2);
  await page.keyboard.press("Control+d");
  await expect(page.locator('[data-testid^="frame-"]')).toHaveCount(3);
  await settled(page);
  expect(refused).toEqual([]);
  const s = await server(request, id);
  expect(s.nodes.filter((n) => n.kind === "frame")).toHaveLength(3);
  expect(s.nodes.filter((n) => n.kind === "sticky")).toHaveLength(3);
  expect(s.nodes.filter((n) => n.kind === "ref")).toHaveLength(1);                       // no copy of the live item
  const sel = await page.locator(".react-flow__node.selected").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  expect(sel).toHaveLength(2);                                                            // the duplicate frame and its sticky: exactly the rows just created
  expect(sel.every((i) => !["fr", "st", "lv"].includes(i ?? ""))).toBe(true);
  expect(s.nodes.filter((n) => sel.includes(n.id)).map((n) => n.kind).sort()).toEqual(["frame", "sticky"]);
});

test("a thought link with a javascript: scheme (old row, import) is never rendered as a link", async ({ page, request }) => {
  const id = await board(request, "Links", [node("r", "mind", { x: 0, y: 0, text: "Root" }), node("ok", "mind", { parent_id: "r", text: "Fine", style: { side: "R", url: "https://example.com/a" } }), node("bad", "mind", { parent_id: "r", position: 1, text: "Evil", style: { side: "R" } })]);
  // the API now refuses such a link, so serve one the way an old row would arrive
  await page.route(new RegExp(`/api/v1/boards/${id}$`), async (route) => {
    const res = await route.fetch(); const j = await res.json();
    for (const n of j.nodes) if (n.id === "bad") n.style = { ...n.style, url: "javascript:window.__xss=1" };
    await route.fulfill({ response: res, json: j });
  });
  await open(page, id);
  await expect(page.getByTestId("mind-ok").locator("a.nm-url")).toHaveAttribute("href", "https://example.com/a");
  await expect(page.getByTestId("mind-bad")).toBeVisible();
  await expect(page.getByTestId("mind-bad").locator("a")).toHaveCount(0);
  await page.getByTestId("mind-bad").click({ modifiers: ["Control"] });
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("Ctrl+F finds a thought and selects it; outside the canvas the browser keeps Ctrl+F", async ({ page, request }) => {
  const id = await board(request, "Find", [node("r", "mind", { x: 0, y: 0, text: "Root" }), node("a", "mind", { parent_id: "r", text: "Needle in a haystack", style: { side: "R", color: "violet" } }), node("b", "mind", { parent_id: "r", position: 1, text: "Hay", style: { side: "L", color: "orange" } })]);
  await open(page, id);
  await page.mouse.click(1200, 150);                         // focus is in the canvas
  await page.keyboard.press("Control+f");
  await expect(page.getByTestId("search-input")).toBeFocused();
  await page.keyboard.type("needle");
  await expect(page.getByTestId("search-count")).toHaveText("1 / 1");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mind-a")).toHaveClass(/sel-ring/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("search-bar")).toHaveCount(0);
  // focus outside the canvas (the nav): the app does not take Ctrl+F
  await page.getByRole("link", { name: "Overview" }).focus();
  await page.evaluate(() => { (window as unknown as { __f: boolean }).__f = false; window.addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "f") (window as unknown as { __f: boolean }).__f = e.defaultPrevented; }); });
  await page.keyboard.press("Control+f");
  await expect(page.getByTestId("search-bar")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __f: boolean }).__f)).toBe(false);   // not preventDefault-ed: the browser's own find stays
  // focus tracks the canvas, not the last click: tabbing/focusing back into it re-arms Ctrl+F
  await page.mouse.click(1200, 150);
  await page.keyboard.press("Control+f");
  await expect(page.getByTestId("search-input")).toBeFocused();
});

test("lock: a locked sticky cannot be moved, edited or deleted; the menu offers Unlock", async ({ page, request }) => {
  const id = await board(request, "Lock", [node("a", "sticky", { x: 200, y: 200, w: 170, h: 130, text: "Keep", style: { color: "yellow" } })]);
  await open(page, id);
  await sticky(page, "a").click({ button: "right" }); await page.locator('[data-cmd="lock"]').click(); await settled(page);
  expect((await server(request, id)).nodes[0].style.locked).toBe(true);
  const before = await sticky(page, "a").boundingBox();
  await drag(page, await centre(sticky(page, "a")), { x: 800, y: 600 });
  const after = await sticky(page, "a").boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  await sticky(page, "a").click(); await page.keyboard.press("Delete");
  await expect(sticky(page, "a")).toHaveCount(1);
  await sticky(page, "a").dblclick();
  await expect(page.locator(".nm-sticky .nm-t[contenteditable]")).toHaveCount(0);
  await sticky(page, "a").click({ button: "right" });
  const ids = await menuIds(page);
  expect(ids).toContain("lock"); expect(ids).not.toContain("edit"); expect(ids).not.toContain("delete"); expect(ids).not.toContain("color");
  await expect(page.locator('[data-cmd="lock"]')).toContainText("Unlock");
  await page.locator('[data-cmd="lock"]').click(); await settled(page);
  expect((await server(request, id)).nodes[0].style.locked).toBeUndefined();
});

test("z-order: Bring to front puts the lower sticky on top", async ({ page, request }) => {
  const id = await board(request, "Order", [node("a1", "sticky", { x: 300, y: 300, w: 170, h: 130, style: { color: "yellow" } }), node("b1", "sticky", { x: 340, y: 340, w: 170, h: 130, style: { color: "blue" } })]);
  await open(page, id);
  const spot = { x: 400, y: 400 };
  const topAt = async () => page.evaluate((p) => (document.elementsFromPoint(p.x, p.y).map((e) => e.closest("[data-testid^='sticky-']")?.getAttribute("data-testid")).find(Boolean)), { x: (await sticky(page, "a1").boundingBox())!.x + 100, y: (await sticky(page, "a1").boundingBox())!.y + 100 });
  void spot;
  expect(await topAt()).toBe("sticky-b1");
  await sticky(page, "a1").click({ button: "right", position: { x: 20, y: 20 } });
  await pickSub(page, "order", "front");
  await settled(page);
  expect(await topAt()).toBe("sticky-a1");
  const z = (await server(request, id)).nodes.map((n) => [n.id, n.style.z ?? 0]);
  expect(Object.fromEntries(z)).toEqual({ a1: 1, b1: 0 });
  await page.keyboard.press("Control+Shift+BracketLeft");
});

test("align and distribute from the selection menu; alignment guides show while dragging", async ({ page, request }) => {
  const id = await board(request, "Align", [
    node("a", "sticky", { x: 100, y: 100, w: 170, h: 100, style: { color: "yellow" } }), node("b", "sticky", { x: 400, y: 180, w: 170, h: 100, style: { color: "green" } }), node("c", "sticky", { x: 900, y: 260, w: 170, h: 100, style: { color: "pink" } }),
  ]);
  await open(page, id);
  await page.mouse.click(700, 820);
  await page.keyboard.press("Control+a");
  await sticky(page, "b").click({ button: "right" });
  expect(await menuIds(page)).toEqual(expect.arrayContaining(["align", "distribute", "tidy", "frameSel", "mindFromStickies"]));
  await pickSub(page, "align", "top");
  await settled(page);
  expect((await server(request, id)).nodes.map((n) => n.y)).toEqual([100, 100, 100]);
  await page.mouse.click(700, 820); await page.keyboard.press("Control+a"); await sticky(page, "b").click({ button: "right" });
  await pickSub(page, "distribute", "h"); await settled(page);
  const xs = (await server(request, id)).nodes.sort((p, q) => p.x - q.x).map((n) => n.x);
  expect(Math.round(xs[1] - (xs[0] + 170))).toBe(Math.round(xs[2] - (xs[1] + 170)));
  // guides: drag c so its top edge nears a's
  await page.mouse.click(700, 820);
  const c = await centre(sticky(page, "c"));
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 8, c.y + 8, { steps: 3 }); await page.mouse.move(c.x + 8, c.y + 4, { steps: 6 });
  await expect(page.getByTestId("guides")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("guides")).toHaveCount(0);
});

test("make a mind map from stickies; frame the selection", async ({ page, request }) => {
  const id = await board(request, "Stickies", [node("a", "sticky", { x: 100, y: 100, w: 170, h: 100, text: "One", style: { color: "yellow" } }), node("b", "sticky", { x: 400, y: 100, w: 170, h: 100, text: "Two", style: { color: "green" } }), node("c", "sticky", { x: 700, y: 100, w: 170, h: 100, text: "Three", style: { color: "pink" } })]);
  await open(page, id);
  await page.keyboard.press("Control+a");
  await sticky(page, "b").click({ button: "right" }); await page.locator('[data-cmd="frameSel"]').click(); await settled(page);
  const s = await server(request, id);
  const f = s.nodes.find((n) => n.kind === "frame")!;
  expect(f).toBeTruthy(); expect(s.nodes.filter((n) => (n as unknown as { frame_id: string }).frame_id === f.id)).toHaveLength(3);
  // a second board: Ctrl+A, then the menu
  const id2 = await board(request, "Stickies 2", [node("a", "sticky", { x: 100, y: 100, w: 170, h: 100, text: "One", style: { color: "yellow" } }), node("b", "sticky", { x: 400, y: 100, w: 170, h: 100, text: "Two", style: { color: "green" } }), node("c", "sticky", { x: 700, y: 100, w: 170, h: 100, text: "Three", style: { color: "pink" } })]);
  await open(page, id2);
  await page.mouse.click(700, 820); await page.keyboard.press("Control+a");
  await sticky(page, "c").click({ button: "right" }); await page.locator('[data-cmd="mindFromStickies"]').click(); await settled(page);
  const m = await server(request, id2);
  expect(m.nodes.filter((n) => n.kind === "sticky")).toHaveLength(0);
  const root = m.nodes.find((n) => n.kind === "mind" && !n.parent_id)!;
  expect(m.nodes.filter((n) => n.parent_id === root.id).map((n) => n.text).sort()).toEqual(["One", "Three", "Two"]);
});

test('"?" opens the shortcut sheet listing every command that has a shortcut', async ({ page, request }) => {
  const id = await board(request, "Help", [node("a", "sticky", { x: 100, y: 100, w: 170, h: 100 })]);
  await open(page, id);
  await page.mouse.click(1200, 700);
  await page.keyboard.press("?");
  const sheet = page.getByTestId("help-sheet");
  await expect(sheet).toBeVisible();
  const kbds = new Set(COMMANDS.filter((c) => c.kbd).map((c) => c.kbd!));
  expect(kbds.size).toBeGreaterThan(15);
  for (const k of kbds) await expect(sheet.locator(`[data-kbd="${k}"]`).first(), k).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});
