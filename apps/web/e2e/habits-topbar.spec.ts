import { expect, test, type Page } from "@playwright/test";

/**
 * Habits page, votes in the habit headers, and the re-arranged top bar, in a browser against the real seeded API.
 * Screenshots of Overview, Plan and Habits at 1440 and 390 go to e2e/out/.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const OUT = "e2e/out";
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
});

test("Overview votes through the habit group headers, including a counted block with no habit, and Progress reflects it", async ({ page, request }) => {
  const blocks = (await (await request.get(`${V}/config/blocks`, { headers: headers() })).json()).blocks as { key: string; label: string; counts_for_stars: boolean; archived?: boolean }[];
  const habits = (await (await request.get(`${V}/habits`, { headers: headers() })).json()).habits as { block: string; stage: string }[];
  const counted = blocks.filter((b) => b.counts_for_stars && !b.archived);
  const bare = counted.find((b) => !habits.some((h) => h.block === b.key && h.stage !== "retired"));
  test.skip(!bare, "every counted block already has a habit");
  const withHabit = counted.find((b) => habits.some((h) => h.block === b.key && h.stage !== "retired")) ?? null;

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Votes" })).toHaveCount(0);   // the old strip is gone
  const panel = page.getByRole("region", { name: "Habits" });
  const group = panel.getByRole("group", { name: `${bare!.label} vote` });
  await expect(group).toBeVisible();
  const star = (g = group, k = 2) => g.getByRole("button", { name: `${bare!.label} ${k} stars` });
  await star().click();
  await expect(star()).toHaveAttribute("aria-pressed", "true");
  await expect(group).toContainText("2 of 3 stars");
  // Progress reads the same stored vote (its series endpoint ends with today)
  // (the API's "today" is UTC and the app's is Dhaka, so look at the last two days)
  const series = async () => ((await (await request.get(`${V}/blocks?days=7`, { headers: headers() })).json()).blocks[bare!.key] as (number | null)[]).slice(-2);
  expect(await series()).toContain(2);
  await page.goto("/progress");
  await expect(page.getByRole("group", { name: "Range" })).toBeVisible();

  await page.goto("/");
  await expect(group).toContainText("2 of 3 stars");
  await star().click();                                  // tapping the current level clears it
  await expect(group).toContainText("0 of 3 stars");
  expect(await series()).not.toContain(2);
  if (withHabit) {
    const g2 = panel.getByRole("group", { name: `${withHabit.label} vote` });
    await g2.getByRole("button", { name: `${withHabit.label} 1 star` }).click();
    await expect(g2).toContainText("1 of 3 stars");
    await g2.getByRole("button", { name: `${withHabit.label} 1 star` }).click();
    await expect(g2).toContainText("0 of 3 stars");
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
  await block.selectOption("");
  await expect(page.locator("[data-block]").first()).toBeVisible();
  expect((await page.getByTestId("plan-controls").boundingBox())!.y).toBeLessThan(44);   // inside the 44px bar

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#page-slot").getByTestId("plan-controls")).toHaveCount(0);
  const ctl = page.getByTestId("plan-controls");
  await expect(ctl).toBeVisible();
  const box = (await ctl.boundingBox())!;
  expect(box.height).toBeLessThan(56);                // one row, not three
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

for (const width of [390, 768, 1024, 1280, 1440, 1920]) {
  for (const path of ["/", "/plan", "/habits"]) {
    test(`top bar ${path} at ${width}px: no horizontal overflow, one 44px row`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      if (path === "/") await expect(page.getByRole("region", { name: "Habits" })).toBeVisible({ timeout: 30_000 });
      else if (path === "/plan") await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
      else await expect(page.getByRole("region", { name: "Habits" })).toBeVisible();
      await page.waitForTimeout(400);
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
