import { expect, test, type Page } from "@playwright/test";

/**
 * Habits page, votes in the habit headers, and the re-arranged top bar, in a browser against the real seeded API.
 * Screenshots of Overview, Plan and Habits at 1440 and 390 go to e2e/out/.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const OUT = "e2e/out";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const V = `${API}/api/v1/vault`;

let tokens: { access_token: string; refresh_token: string } | null = null;
const errors: string[] = [];
let n = 0;
const uniq = (base: string) => `${base} ${Date.now().toString(36)}${n++}`;

test.beforeEach(async ({ context, request, page }) => {
  errors.length = 0;
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/v1/advisor/**", (route) => route.fulfill({ json: [] }));
  if (!tokens) { const r = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } }); expect(r.ok()).toBeTruthy(); tokens = await r.json(); }
  await context.addInitScript((t) => { localStorage.setItem("access_token", t.access_token); localStorage.setItem("refresh_token", t.refresh_token); }, tokens!);
});
test.afterEach(() => { expect(errors, "browser console errors").toEqual([]); });

const headers = () => ({ Authorization: `Bearer ${tokens!.access_token}` });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const headerBox = (page: Page) => page.locator("header").first().boundingBox();

test("Habits page: reachable from the nav and by g h; the board works; Plan no longer has the board but keeps habits under goals", async ({ page, request }) => {
  const name = uniq("Board habit");
  const made = await request.post(`${V}/habits`, { headers: headers(), data: { name, block: "soul", stream: "studio", per_week: 3 } });
  expect(made.ok(), await made.text()).toBeTruthy();
  const madeId = ((await made.json()).habits as { id: number; name: string }[]).find((h) => h.name === name)!.id;
  try {

  await page.goto("/plan");
  await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
  await expect(page.locator("#plan-habits")).toHaveCount(0);
  await expect(page.locator("[data-habit]").filter({ hasText: name })).toBeVisible();   // still under goals in the block column
  const main = page.getByRole("navigation", { name: "Main" }).first();
  await expect(main.getByRole("link")).toHaveText(["Overview", "Plan", "Habits", "Map", "Progress"]);

  await main.getByRole("link", { name: "Habits" }).click();
  await expect(page).toHaveURL(/\/habits$/);
  const board = page.getByRole("region", { name: "Habits" });
  await expect(board).toContainText("Installing");
  await expect(board).toContainText(name);
  await board.getByText(name).first().click();     // opens the habit card on the board
  await expect(board).toContainText(/Cadence|Tripwire|Gate|Move/i);

  await page.goto("/plan");
  await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page).toHaveURL(/\/habits$/);
  // the Plan's habit lines link to the page
  await page.goto("/plan");
  await page.locator('[aria-label="Habits this week"]').first().getByRole("link", { name: /Habits/ }).click();
  await expect(page).toHaveURL(/\/habits$/);
  } finally {
    await request.delete(`${V}/habits/${madeId}`, { headers: headers() });
  }
});

test("Overview votes through the habit group headers, including a counted block with no habit and a stale vote key, and Progress reflects it", async ({ page, request }) => {
  const blocks = (await (await request.get(`${V}/config/blocks`, { headers: headers() })).json()).blocks as { key: string; label: string; counts_for_stars: boolean; archived?: boolean }[];
  const counted = blocks.filter((b) => b.counts_for_stars && !b.archived);
  expect(counted.length, "the seeded account has counted blocks").toBeGreaterThan(0);
  // Fixture: the first counted block has no habit (the e2e database is disposable); another counted block gets one, if there is one.
  const bare = counted[0];
  const all = (await (await request.get(`${V}/habits`, { headers: headers() })).json()).habits as { id: number; block: string }[];
  for (const h of all.filter((x) => x.block === bare.key)) expect((await request.delete(`${V}/habits/${h.id}`, { headers: headers() })).ok()).toBeTruthy();
  const withHabit = counted[1] ?? null;
  // The sample account arrives with votes for today; start both blocks at 0 so the taps below set, not clear.
  for (const b of [bare, withHabit].filter((x) => !!x)) expect((await request.put(`${V}/day/${today}/vote`, { headers: headers(), data: { block: b.key, stars: 0 } })).ok()).toBeTruthy();
  const made: number[] = [];
  if (withHabit) {
    const r = await request.post(`${V}/habits`, { headers: headers(), data: { name: uniq("Vote habit"), block: withHabit.key, stream: "studio", per_week: 3 } });
    expect(r.ok(), await r.text()).toBeTruthy();
    made.push(...((await r.json()).habits as { id: number; block: string; name: string }[]).filter((h) => h.block === withHabit.key).map((h) => h.id));
  }
  try {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Votes" })).toHaveCount(0);   // the old strip is gone
    const panel = page.getByRole("region", { name: "Habits" });
    const group = panel.getByRole("group", { name: `${bare.label} vote` });
    await expect(group).toBeVisible();
    const star = group.getByRole("button", { name: `${bare.label} 2 stars` });
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(group).toContainText("2 of 3 stars");
    // Progress reads the stored votes of the month
    const stored = async () => ((await (await request.get(`${V}/month?month=${today.slice(0, 7)}`, { headers: headers() })).json()).days as { date: string; blocks: Record<string, number> }[]).find((d) => d.date === today)?.blocks[bare.key] ?? 0;
    expect(await stored()).toBe(2);
    await page.goto("/progress");
    await expect(page.getByRole("group", { name: "Range" })).toBeVisible();
    await page.goto("/");
    await expect(group).toContainText("2 of 3 stars");
    await star.click();                                  // tapping the current level clears it
    await expect(group).toContainText("0 of 3 stars");
    expect(await stored()).toBe(0);
    if (withHabit) {
      const g2 = panel.getByRole("group", { name: `${withHabit.label} vote` });
      await g2.getByRole("button", { name: `${withHabit.label} 1 star` }).click();
      await expect(g2).toContainText("1 of 3 stars");
      await g2.getByRole("button", { name: `${withHabit.label} 1 star` }).click();
      await expect(g2).toContainText("0 of 3 stars");
    }
    // A stored vote for a key that is no longer a configured block (the API refuses new ones, so the read is stubbed) still shows its stars.
    const ghost = "oldblock";
    await page.route("**/api/v1/vault/today", async (route) => {
      const res = await route.fetch();
      const day = await res.json();
      await route.fulfill({ response: res, json: { ...day, blocks: { ...day.blocks, [ghost]: 1 } } });
    });
    await page.goto("/");
    const gg = panel.getByRole("group", { name: `${ghost} vote` });
    await expect(gg).toContainText("1 of 3 stars");
    await expect(gg.getByRole("button", { name: `${ghost} 1 star` })).toHaveAttribute("aria-pressed", "true");
    await expect(gg.getByRole("button", { name: `${ghost} 3 stars` })).toBeEnabled();
  } finally {
    for (const id of made) await request.delete(`${V}/habits/${id}`, { headers: headers() });
  }
});

test("account menu holds the skin select; it sets data-skin, remembers it, and nothing is fixed in the corner", async ({ page }) => {
  await page.goto("/plan?skin=paper");
  await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
  await page.getByRole("button", { name: /^Account/ }).click();
  const skin = page.getByRole("menu").getByLabel("Skin");
  await skin.selectOption("admin");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "admin");
  await page.goto("/plan");                              // no ?skin= now: the remembered choice applies
  await expect(page.locator("html")).toHaveAttribute("data-skin", "admin");
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menu").getByLabel("Skin").selectOption("paper");
  await expect(page.locator("html")).not.toHaveAttribute("data-skin", /.+/);
  const fixedCorner = await page.evaluate(() => [...document.body.querySelectorAll("*")].filter((el) => {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    return s.position === "fixed" && r.bottom > innerHeight - 80 && r.right > innerWidth - 200 && r.width < 400 && el.tagName === "LABEL";
  }).length);
  expect(fixedCorner).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", { name: "Skin" })).toBeHidden();   // only inside the open account menu
});

test("Plan: Label and Block menus filter; they sit in the bar on md+ and in one row in the page on phones", async ({ page, request }) => {
  const text = uniq("Filter task");
  expect((await request.post(`${V}/pipeline/studio/items`, { headers: headers(), data: { texts: [text], lane: "now" } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/plan");
  await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
  const slot = page.locator("#page-slot");
  const label = slot.getByLabel("Label", { exact: true });
  const block = slot.getByLabel("Block", { exact: true });
  await expect(label).toBeVisible();
  const row = page.locator("[data-task]").filter({ hasText: text });
  await expect(row).toBeVisible();
  await label.selectOption("none");
  await expect(row).toBeVisible();                    // no label on a fresh task
  await label.selectOption({ index: 1 });             // a month nobody labelled: hidden
  await expect(row).toHaveCount(0);
  await label.selectOption("all");
  await expect(row).toBeVisible();
  await block.selectOption("studio");
  await expect(row).toBeVisible();
  await expect(page.locator("[data-block]:not([data-block=studio])")).toHaveCount(0);   // other blocks' rows hide
  await expect(page.locator('[data-block="studio"]')).toHaveCount(1);
  await block.selectOption("");
  await expect(page.locator("[data-block]:not([data-block=studio])").first()).toBeVisible();
  expect((await page.getByTestId("plan-controls").boundingBox())!.y).toBeLessThan(44);   // inside the 44px bar

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#page-slot").getByTestId("plan-controls")).toHaveCount(0);
  const ctl = page.getByTestId("plan-controls");
  await expect(ctl).toBeVisible();
  const box = (await ctl.boundingBox())!;
  expect(box.height).toBeLessThan(56);                // one row, not three
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

for (const width of [768, 1024]) {
  test(`Plan Label and Block selects show their value in full at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/plan");
    await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
    for (const name of ["Label", "Block"]) {
      const sel = page.locator(`select[aria-label="${name}"]`);
      await expect(sel).toBeVisible();
      const { box, need } = await sel.evaluate((el: HTMLSelectElement) => {
        const cs = getComputedStyle(el);
        const c = document.createElement("canvas").getContext("2d")!;
        c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const text = el.selectedOptions[0].textContent ?? "";
        return { box: el.getBoundingClientRect().width, need: c.measureText(text).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) };
      });
      expect(box, `${name} select is at least as wide as its value`).toBeGreaterThanOrEqual(need);
    }
  });
}

for (const width of [390, 768, 1024, 1280, 1440, 1920]) {
  for (const path of ["/", "/plan", "/habits"]) {
    test(`top bar ${path} at ${width}px: no horizontal overflow, one 44px row`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      if (path === "/") await expect(page.getByRole("region", { name: "Habits" })).toBeVisible({ timeout: 30_000 });
      else if (path === "/plan") await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
      else await expect(page.getByRole("region", { name: "Habits" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Account/ })).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const box = (await headerBox(page))!;
      expect(box.height).toBeLessThanOrEqual(45);
      // every header child sits inside the bar (nothing wrapped below it)
      const outside = await page.evaluate(() => {
        const h = document.querySelector("header")!; const hb = h.getBoundingClientRect();
        return [...h.querySelectorAll("a, button, select, p")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.bottom > hb.bottom + 1 || r.right > hb.right + 1); }).map((el) => el.textContent?.slice(0, 20));
      });
      expect(outside).toEqual([]);
      if (width < 768) {
        await expect(page.getByTestId("page-title")).toHaveText(path === "/" ? "Overview" : path === "/plan" ? "Plan" : "Habits");
        await expect(page.locator("header").getByText("Niyyah", { exact: true })).toBeHidden();
      }
      await page.screenshot({ path: `${OUT}/${path === "/" ? "overview" : path.slice(1)}-${width}.png` }).catch(() => undefined);
    });
  }
}
