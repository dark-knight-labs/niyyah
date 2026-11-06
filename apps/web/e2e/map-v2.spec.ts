import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/** Map v2, window 1: boxed mind nodes, layouts + Organize, the command registry behind the bar, right-click menus and the keyboard. */
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
const node = (id: string, kind: string, o: Record<string, unknown> = {}) => ({ op: "upsert_node", base_updated_at: null, node: { id, kind, text: id, ...o } });
async function board(request: APIRequestContext, title: string, ops: unknown[]) {
  const b = await api(request, "/boards", { method: "POST", data: { title } });
  await api(request, `/boards/${b.id}/ops`, { method: "POST", data: { ops } });
  return String(b.id);
}
const settled = async (page: Page) => { await page.waitForTimeout(700); await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 }); };
const open = async (page: Page, url: string) => { await page.goto(url); await page.waitForSelector('[data-testid="map-canvas"] .react-flow__renderer'); await page.waitForSelector(".nm-mind, .nm-sticky, .nm-shape"); await page.waitForTimeout(600); };
const mindEl = (page: Page, id: string) => page.getByTestId(`mind-${id}`);
const boxes = async (page: Page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>(".nm-mind")].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.testid!.replace("mind-", ""), { x: r.x, y: r.y, w: r.width, h: r.height }]; })));
type Box = { x: number; y: number; w: number; h: number };
const overlaps = (m: Record<string, Box>) => { const v = Object.entries(m); const out: string[] = []; for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) { const a = v[i][1], b = v[j][1]; if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) out.push(`${v[i][0]}/${v[j][0]}`); } return out; };
const menuIds = (page: Page) => page.locator('[data-testid="context-menu"] [data-top-item]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cmd));
/** Esc closes a submenu first (the pointer rests on the menu it opened from), then the menu. */
const closeMenu = async (page: Page) => { for (let i = 0; i < 3 && (await page.getByTestId("context-menu").count()); i++) await page.keyboard.press("Escape"); };
const rightClick = (page: Page, loc: ReturnType<Page["locator"]>) => loc.click({ button: "right" });

/** A map with 3 branches of 2 children (depth 3 under the first), plus a second small map beside it. */
const tree = (second = { x: 1200, y: 300 }): unknown[] => {
  const ops: unknown[] = [node("r", "mind", { x: 0, y: 0, text: "Idea" })];
  ["a", "b", "c"].forEach((b, i) => {
    ops.push(node(b, "mind", { parent_id: "r", position: i, text: `Branch ${b}`, style: { side: i % 2 ? "L" : "R", color: ["violet", "orange", "emerald"][i] } }));
    for (let k = 0; k < 2; k++) ops.push(node(`${b}${k}`, "mind", { parent_id: b, position: k, text: `Leaf ${b}${k}` }));
  });
  ops.push(node("a00", "mind", { parent_id: "a0", text: "Deep a00" }), node("a000", "mind", { parent_id: "a00", text: "Deeper a000" }));
  ops.push(node("r2", "mind", { ...second, text: "Second map" }), node("s1", "mind", { parent_id: "r2", text: "Side one", style: { side: "R" } }), node("s2", "mind", { parent_id: "r2", position: 1, text: "Side two", style: { side: "L" } }));
  return ops;
};

test("every mind depth renders a box (computed border on depth 3)", async ({ page, request }) => {
  const id = await board(request, "Boxes", tree());
  await open(page, `/map?board=${id}`);
  for (const [nid, depth] of [["r", 0], ["a", 1], ["a0", 2], ["a00", 3], ["a000", 4]] as const) {
    const css = await mindEl(page, nid).evaluate((e) => { const c = getComputedStyle(e); return { w: parseFloat(c.borderTopWidth), s: c.borderTopStyle, l: parseFloat(c.borderLeftWidth), b: parseFloat(c.borderBottomWidth) }; });
    expect(css.s, `depth ${depth}`).toBe("solid");
    expect(css.w, `depth ${depth}`).toBeGreaterThanOrEqual(1);
    expect(css.l).toBeGreaterThanOrEqual(1);
    expect(css.b).toBeGreaterThanOrEqual(1);
  }
});

test("Organize balanced / right / down / up: positions change along the right axis, no overlaps, one undo restores", async ({ page, request }) => {
  const id = await board(request, "Organize", tree({ x: 120, y: 60 }));   // the second map starts on top of the first
  await open(page, `/map?board=${id}`);
  const start = await boxes(page);
  await page.getByTestId("organize-menu").click();
  await expect(page.locator('[data-layout]')).toHaveCount(4);                 // horizontal and vertical options
  await page.keyboard.press("Escape");
  const run = async (layout: string) => { await page.getByTestId("organize-menu").click(); await page.locator(`[data-layout="${layout}"]`).click(); await page.waitForTimeout(600); return boxes(page); };
  const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

  const right = await run("right");
  for (const k of ["a", "b", "c", "a0", "a00"]) expect(right[k].x, `right: ${k}`).toBeGreaterThan(right.r.x + right.r.w - 1);
  expect(overlaps(right)).toEqual([]);

  const down = await run("down");
  for (const k of ["a", "b", "c", "a0", "a00"]) expect(down[k].y, `down: ${k}`).toBeGreaterThan(down.r.y + down.r.h - 1);
  expect(Math.abs(centre(down.a).x - centre(down.c).x), "siblings spread across").toBeGreaterThan(40);
  expect(overlaps(down)).toEqual([]);

  const up = await run("up");
  for (const k of ["a", "b", "c", "a0"]) expect(up[k].y + up[k].h, `up: ${k}`).toBeLessThan(up.r.y + 1);
  expect(overlaps(up)).toEqual([]);

  const both = await run("both");
  const xs = ["a", "b", "c"].map((k) => centre(both[k]).x - centre(both.r).x);
  expect(xs.some((x) => x > 0) && xs.some((x) => x < 0), "balanced puts branches on both sides").toBe(true);
  expect(overlaps(both)).toEqual([]);

  // one undo restores the previous layout (the vertical one before: "up"), not a half-step
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(600);
  const undone = await boxes(page);
  for (const k of ["a", "b", "c"]) expect(Math.abs(undone[k].y - up[k].y), `undo ${k}`).toBeLessThan(2);
  await settled(page);
  expect(Object.keys(start).length).toBe(Object.keys(up).length);
});

test("right-click menu item ids per kind", async ({ page, request }) => {
  const id = await board(request, "Menus", [
    ...tree(),
    node("st", "sticky", { x: 400, y: 300, w: 170, h: 130, style: { color: "yellow" } }), node("st2", "sticky", { x: 600, y: 300, w: 170, h: 130, style: { color: "blue" } }),
    node("sh", "shape", { x: 400, y: 500, w: 170, h: 80 }), node("tx", "text", { x: 600, y: 520, w: 220, h: 32 }), node("fr", "frame", { x: 400, y: 640, w: 300, h: 160, text: "Frame" }),
  ]);
  await open(page, `/map?board=${id}`);
  await page.getByRole("button", { name: "Fit everything" }).click();
  await page.waitForTimeout(500);

  await rightClick(page, mindEl(page, "a0"));
  expect(await menuIds(page)).toEqual(expect.arrayContaining(["child", "sibling", "parent", "edit", "note", "link", "color", "fill", "mshape", "size", "bold", "icon", "layout", "branchLines", "organizeMap", "fold", "detach", "connect", "delete"]));
  expect(await menuIds(page)).not.toContain("toSticky");        // a0 has branches
  await closeMenu(page);
  await rightClick(page, mindEl(page, "r"));
  const root = await menuIds(page);
  expect(root).toContain("child"); expect(root).not.toContain("sibling"); expect(root).not.toContain("detach");
  await closeMenu(page);

  await rightClick(page, page.getByTestId("sticky-st"));
  expect(await menuIds(page)).toEqual(expect.arrayContaining(["edit", "color", "size", "bold", "talign", "convert", "copy", "cut", "duplicate", "order", "lock", "connect", "delete"]));
  await closeMenu(page);
  await rightClick(page, page.getByTestId("shape-sh"));
  expect(await menuIds(page)).toEqual(expect.arrayContaining(["edit", "connect", "delete"]));
  await closeMenu(page);
  await rightClick(page, page.getByTestId("text-tx"));
  expect(await menuIds(page)).toEqual(expect.arrayContaining(["edit", "connect", "delete"]));
  await closeMenu(page);
  await page.getByTestId("frame-fr").click({ button: "right", position: { x: 20, y: 120 } });
  expect(await menuIds(page)).toEqual(expect.arrayContaining(["edit", "zoomFrame", "connect", "delete"]));
  await closeMenu(page);

  // selection: two stickies
  await page.getByTestId("sticky-st").click();
  await page.getByTestId("sticky-st2").click({ modifiers: ["Shift"] });
  await rightClick(page, page.getByTestId("sticky-st2"));
  expect(await menuIds(page)).toEqual(expect.arrayContaining(["align", "color", "copy", "lock", "order", "delete"]));
  await closeMenu(page);

  // pane: an empty spot
  await closeMenu(page);
  await page.mouse.click(1000, 140, { button: "right" });
  expect(await menuIds(page)).toEqual(expect.arrayContaining(["addSticky", "addMind", "addShape", "addText", "addFrame", "selectAll", "organizeAll", "fit", "minimap"]));
  await closeMenu(page);
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
});

test("the floating bar's more button opens the same menu; the menu runs commands", async ({ page, request }) => {
  const id = await board(request, "Bar", tree());
  await open(page, `/map?board=${id}`);
  await mindEl(page, "b0").click();
  await page.locator('[data-bar="more"]').click();
  const viaBar = await menuIds(page);
  await page.keyboard.press("Escape");
  await rightClick(page, mindEl(page, "b0"));
  expect(await menuIds(page)).toEqual(viaBar);
  await page.locator('[data-cmd="sibling"]').click();
  await expect(page.locator(".nm-mind")).toHaveCount(16);                  // 15 + the new sibling
});

test("menu keyboard: context-menu key opens, arrows move, Right opens a submenu, Enter runs, Esc closes", async ({ page, request }) => {
  const id = await board(request, "Keys", tree());
  await open(page, `/map?board=${id}`);
  await mindEl(page, "c0").click();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByTestId("context-menu")).toBeVisible();
  const first = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.cmd);
  await page.keyboard.press("ArrowDown");
  const second = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.cmd);
  expect(second).not.toBe(first);
  // walk to Colour and open it
  for (let i = 0; i < 40 && (await page.evaluate(() => (document.activeElement as HTMLElement).dataset.cmd)) !== "color"; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-sub="color"]')).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
  await settled(page);
  const server = await api(request, `/boards/${id}`);
  expect(server.nodes.find((n: { id: string }) => n.id === "c0").style.color).toBeTruthy();
  await mindEl(page, "c0").click();
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
});

test("mind style from the menu persists after reload; Link, Add parent, Move down, Detach, Convert to sticky, Focus branch", async ({ page, request }) => {
  const id = await board(request, "Style", tree());
  await open(page, `/map?board=${id}`);
  const clear = async (p: Page) => { await p.keyboard.press("Escape"); await p.mouse.click(1100, 140); };   // the floating bar of the last pick can sit over the next node
  const pick = async (nodeId: string, cmd: string, choice?: string) => {
    await clear(page); await rightClick(page, mindEl(page, nodeId));
    const item = page.locator(`[data-cmd="${cmd}"]`);
    if (choice) { await item.hover(); await page.locator(`[data-sub="${cmd}"] [data-choice="${choice}"]`).click(); } else await item.click();
  };
  await pick("b", "color", "rose"); await pick("b", "fill", "solid"); await pick("b", "mshape", "pill"); await pick("b", "size", "L"); await pick("b", "icon", "💡"); await pick("b", "bold");
  await settled(page);
  const server = await api(request, `/boards/${id}`);
  expect(server.nodes.find((n: { id: string }) => n.id === "b").style).toMatchObject({ color: "rose", fill: "solid", shape: "pill", size: "L", icon: "💡", bold: true });
  await page.reload(); await open(page, `/map?board=${id}`);
  await expect(mindEl(page, "b")).toHaveClass(/fill-solid/); await expect(mindEl(page, "b")).toHaveClass(/shape-pill/); await expect(mindEl(page, "b")).toContainText("💡");

  // Link…
  await clear(page); await rightClick(page, mindEl(page, "c1")); await page.locator('[data-cmd="link"]').click();
  await page.getByTestId("prompt-input").fill("example.com/x"); await page.keyboard.press("Enter");
  await expect(mindEl(page, "c1").locator("a.nm-url")).toHaveAttribute("href", "https://example.com/x");

  // Move down (Alt+ArrowDown) reorders siblings
  await clear(page); await mindEl(page, "c0").click(); await page.keyboard.press("Alt+ArrowDown"); await settled(page);
  const pos = (await api(request, `/boards/${id}`)).nodes.filter((n: { parent_id: string }) => n.parent_id === "c").sort((x: { position: number }, y: { position: number }) => x.position - y.position).map((n: { id: string }) => n.id);
  expect(pos).toEqual(["c1", "c0"]);

  // Add parent
  await clear(page); await rightClick(page, mindEl(page, "a1")); await page.locator('[data-cmd="parent"]').click();
  await page.waitForFunction(() => { const a = document.activeElement as HTMLElement | null; return !!a && a.isContentEditable; });
  await page.keyboard.type("Middle"); await page.keyboard.press("Escape"); await settled(page);
  const s2 = await api(request, `/boards/${id}`);
  const mid = s2.nodes.find((n: { text: string }) => n.text === "Middle");
  expect(mid.parent_id).toBe("a"); expect(s2.nodes.find((n: { id: string }) => n.id === "a1").parent_id).toBe(mid.id);

  // Detach as new map
  await clear(page); await rightClick(page, mindEl(page, "c1")); await page.locator('[data-cmd="detach"]').click(); await settled(page);
  const s3 = await api(request, `/boards/${id}`);
  expect(s3.nodes.find((n: { id: string }) => n.id === "c1").parent_id).toBeNull();

  // Convert to sticky (a leaf)
  await clear(page); await rightClick(page, mindEl(page, "c0")); await page.locator('[data-cmd="toSticky"]').click(); await settled(page);
  expect((await api(request, `/boards/${id}`)).nodes.find((n: { id: string }) => n.id === "c0").kind).toBe("sticky");

  // Focus branch dims the rest, Esc clears it
  await clear(page); await rightClick(page, mindEl(page, "a")); await page.locator('[data-cmd="focusBranch"]').click();
  await expect(mindEl(page, "r2")).toHaveClass(/nm-dim/);
  await page.keyboard.press("Escape");
  await expect(mindEl(page, "r2")).not.toHaveClass(/nm-dim/);
});

test("live node menu has none of Edit text, Delete, Delete branch, Cut, Convert, Detach as new map", async ({ page }) => {
  await open(page, "/map?board=life");
  await page.getByRole("button", { name: "Fit everything" }).click(); await page.waitForTimeout(400);
  const live = page.locator('[data-testid^="mind-stream:"]').first();
  await rightClick(page, live);
  const ids = await menuIds(page);
  expect(ids).toEqual(expect.arrayContaining(["hide", "color", "layout", "connect"]));
  for (const bad of ["edit", "delete", "deleteBranch", "cut", "convert", "toSticky", "detach", "parent", "sibling", "note", "make"]) expect(ids, bad).not.toContain(bad);
  await page.keyboard.press("Escape");
});

test("Life board: layout and colour set on a Life root and on a live branch survive a reload; the Plan item is untouched", async ({ page, request }) => {
  const before = await api(request, "/vault/pipelines").catch(() => null);
  await open(page, "/map?board=life");
  const fit = async () => { await page.getByRole("button", { name: "Fit everything" }).click(); await page.waitForTimeout(500); };
  await fit();
  const root = page.locator('[data-testid^="mind-quarter:"]');
  const pickOn = async (loc: ReturnType<Page["locator"]>, cmd: string, choice: string) => { await rightClick(page, loc); await page.locator(`[data-cmd="${cmd}"]`).hover(); await page.locator(`[data-sub="${cmd}"] [data-choice="${choice}"]`).click(); };
  await pickOn(root, "layout", "down");
  await page.waitForTimeout(600); await fit();
  const branch = page.locator('[data-testid^="mind-stream:"]').first();
  await pickOn(branch, "color", "rose");
  await settled(page);
  const key = await branch.getAttribute("data-testid");
  const life = (await api(request, "/boards")).find((b: { kind: string }) => b.kind === "life");
  const rows = (await api(request, `/boards/${life.id}`)).nodes as { ref_key: string; style: Record<string, string> }[];
  expect(rows.find((n) => n.ref_key?.startsWith("quarter:"))?.style.layout).toBe("down");
  expect(rows.find((n) => n.ref_key === key!.replace("mind-", ""))?.style.color).toBe("rose");
  await page.reload(); await open(page, "/map?board=life"); await fit();
  const r = await page.locator('[data-testid^="mind-quarter:"]').boundingBox(); const c = await page.locator('[data-testid^="mind-stream:"]').first().boundingBox();
  expect(c!.y, "children hang below the root after reload").toBeGreaterThan(r!.y + r!.height - 1);
  const after = await api(request, "/vault/pipelines").catch(() => null);
  expect(JSON.stringify(after)).toBe(JSON.stringify(before));
});
