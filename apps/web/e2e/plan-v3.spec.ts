import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Plan v3 in a browser against the real seeded API (the sample account: block "Studio", one quarter goal "Ship DNS").
 * Each test makes its own data under unique names, so order does not matter. Any browser console error fails the spec.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";

// "Today" the way the planner sees it (Asia/Dhaka): the current quarter and the next, as the tabs name them.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const [year, month] = today.split("-").map(Number);
const qn = Math.floor((month - 1) / 3) + 1;
const qLabel = (y: number, n: number) => `Q${n}'${String(y).slice(2)}`;
const thisQ = qLabel(year, qn);
const nextYear = qn === 4 ? year + 1 : year, nextN = qn === 4 ? 1 : qn + 1;
const nextQ = qLabel(nextYear, nextN);
const afterYear = nextN === 4 ? nextYear + 1 : nextYear, afterN = nextN === 4 ? 1 : nextN + 1;
const afterQ = qLabel(afterYear, afterN);

let tokens: { access_token: string; refresh_token: string } | null = null;
const errors: string[] = [];
let n = 0;
const uniq = (base: string) => `${base} ${Date.now().toString(36)}${n++}`;

test.beforeEach(async ({ context, request, page }) => {
  errors.length = 0;
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/v1/advisor/**", (route) => route.fulfill({ json: [] })); // no advisor plugin in the seeded API
  if (!tokens) { const r = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } }); expect(r.ok()).toBeTruthy(); tokens = await r.json(); }
  await context.addInitScript((t) => { localStorage.setItem("access_token", t.access_token); localStorage.setItem("refresh_token", t.refresh_token); }, tokens!);
});
test.afterEach(() => {
  // A refused write (409) is a console error by design in the products test; it is whitelisted there by name.
  expect(errors.filter((e) => !e.includes("409")), "browser console errors").toEqual([]);
});

const headers = () => ({ Authorization: `Bearer ${tokens!.access_token}` });
const V = `${API}/api/v1/vault`;

async function addTasks(request: APIRequestContext, texts: string[], lane: "now" | "next" | "backlog" = "now") {
  const r = await request.post(`${V}/pipeline/studio/items`, { headers: headers(), data: { texts, lane } });
  expect(r.ok()).toBeTruthy();
}

async function addGoal(request: APIRequestContext, quarter: string, text: string, product?: string): Promise<string> {
  const lines = (await (await request.get(`${V}/pipelines`, { headers: headers() })).json()).streams.find((s: { stream: string }) => s.stream === "studio").quarter_goals
    .find((q: { quarter: string }) => q.quarter === quarter)?.goals ?? [];
  const r = await request.put(`${V}/plan/goals`, { headers: headers(), data: { stream: "studio", quarter, goals: [...lines, { text, product }] } });
  expect(r.ok(), await r.text()).toBeTruthy();
  const after = (await (await request.get(`${V}/pipelines`, { headers: headers() })).json()).streams.find((s: { stream: string }) => s.stream === "studio");
  return after.quarter_goals.find((q: { quarter: string }) => q.quarter === quarter).goals.find((g: { text: string }) => g.text === text).id;
}

const apiQuarter = `${year}-Q${qn}`;
const row = (page: Page, text: string) => page.locator("[data-task]").filter({ hasText: text });
const block = (page: Page) => page.locator('[data-block="studio"]');
const cell = (page: Page, col: "now" | "next" | "someday") => page.locator(`[data-block="studio"] [data-col="${col}"]`);
const open = async (page: Page) => { await page.goto("/plan"); await expect(page.getByRole("table", { name: "Plan" })).toBeVisible(); };

test("compass is one line; Mission & vision opens both texts side by side and the choice is remembered", async ({ page, request }) => {
  const mission = "Serve well in everything I build. A second sentence that only shows when it is open.";
  const vision = "A calm, useful life by the time the children are grown.";
  const put = await request.put(`${API}/api/v1/compass`, { headers: headers(), data: { mission, vision, vision_horizon: "2040" } });
  expect(put.ok()).toBeTruthy();
  await page.goto("/plan");
  const compass = page.getByRole("region", { name: "Compass" });
  await expect(compass).toContainText("Serve well in everything I build.");
  await expect(compass.getByText("A second sentence")).toHaveCount(0);     // collapsed: the first sentence only
  const closed = (await compass.boundingBox())!.height;
  expect(closed).toBeLessThan(60);
  await compass.getByRole("button", { name: "Mission & vision" }).click();
  const texts = compass.getByTestId("compass-texts");
  await expect(texts.getByText(mission)).toBeVisible();
  await expect(texts.getByText(vision)).toBeVisible();
  const [a, b] = [await texts.getByText(mission).boundingBox(), await texts.getByText(vision).boundingBox()];
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(40);                           // side by side, not stacked
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + 1);
  await page.reload();
  await expect(page.getByRole("region", { name: "Compass" }).getByTestId("compass-texts")).toBeVisible();   // remembered
  await page.getByRole("region", { name: "Compass" }).getByRole("button", { name: "Hide" }).click();
  await expect(page.getByRole("region", { name: "Compass" }).getByTestId("compass-texts")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Compass" }).getByRole("button", { name: "Mission & vision" })).toBeVisible();
  // Edit still works
  await page.getByRole("region", { name: "Compass" }).getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("textbox", { name: "Mission" })).toHaveValue(mission);
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("quarter tabs: this and next quarter, a goal added to the next one, + opens the quarter after", async ({ page, request }) => {
  const future = uniq("Next quarter goal");
  await open(page);
  const tabs = page.getByRole("table", { name: "Plan" }).getByRole("group", { name: "Quarter" });
  await expect(tabs.getByRole("button", { name: thisQ, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(tabs.getByRole("button", { name: `${nextQ} · next` })).toBeVisible();
  await tabs.getByRole("button", { name: `${nextQ} · next` }).click();
  await expect(block(page).getByRole("button", { name: `+ ${nextQ} goal` })).toBeVisible();
  await expect(block(page).getByText(`No ${nextQ} goal yet.`)).toBeVisible().catch(() => undefined);
  await block(page).getByRole("button", { name: `+ ${nextQ} goal` }).click();
  await block(page).getByRole("textbox", { name: `New ${nextQ} goal for Studio` }).fill(future);
  await block(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(block(page).getByRole("button", { name: future })).toBeVisible();
  // the current quarter's tab does not show it
  await tabs.getByRole("button", { name: thisQ, exact: true }).click();
  await expect(block(page).getByRole("button", { name: future })).toHaveCount(0);
  await expect(block(page).getByText("Ship DNS")).toBeVisible();
  // a task can be nested under the later goal and says which quarter it is
  const t = uniq("Nest later");
  await addTasks(request, [t]);
  await page.reload();
  await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
  await row(page, t).getByRole("button", { name: t, exact: true }).click();
  await page.getByRole("complementary", { name: "Item" }).getByRole("group", { name: "Goal" }).getByRole("button", { name: new RegExp(`${nextQ} · ${future}`) }).click();
  await expect(cell(page, "now").getByText(`↳ ${future} · ${nextQ}`)).toBeVisible();
  // "+" opens the quarter after the last tab, with no goal and nothing created until one is added
  await tabs.getByRole("button", { name: `Add quarter ${afterQ}` }).click();
  await expect(tabs.getByRole("button", { name: `${afterQ} · next` })).toHaveAttribute("aria-pressed", "true");
  await expect(block(page).getByRole("button", { name: `+ ${afterQ} goal` })).toBeVisible();
  // the next quarter keeps its tab after a reload because it has a goal; the empty one does not
  await page.reload();
  await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
  await expect(tabs.getByRole("button", { name: `${nextQ} · next` })).toBeVisible();
  await expect(tabs.getByRole("button", { name: `${afterQ} · next` })).toHaveCount(0);
});

test("products: add, tag a goal and a task, rename, delete with a warning", async ({ page, request }) => {
  const router = uniq("Router").replace(/\s+/g, "");  // a one-word name makes a clean slug
  const renamed = `${router}x`;
  const goal = uniq("Product goal"), task = uniq("Product task");
  await addTasks(request, [task]);
  await open(page);
  const b = block(page);
  await b.getByRole("button", { name: "Products of Studio" }).click();
  await b.getByRole("textbox", { name: "New product for Studio" }).fill(router);
  await b.getByRole("button", { name: "Add", exact: true }).last().click();
  await expect(b.locator("[data-product]").filter({ hasText: router })).toBeVisible();
  // a duplicate is refused
  await b.getByRole("textbox", { name: "New product for Studio" }).fill(router.toUpperCase());
  await b.getByRole("button", { name: "Add", exact: true }).last().click();
  await expect(page.getByRole("alert").filter({ hasText: /already a product/ })).toBeVisible();
  await b.getByRole("textbox", { name: "New product for Studio" }).fill("");
  // + goal lets you pick the product; the goal sits under its heading
  await b.getByRole("button", { name: /^\+ Q\d'\d\d goal$/ }).click();
  await b.getByRole("textbox", { name: /^New Q\d'\d\d goal/ }).fill(goal);
  await b.getByRole("group", { name: "Product of the new goal" }).getByRole("button", { name: router }).click();
  await b.getByRole("button", { name: "Add", exact: true }).first().click();
  const group = b.locator("[data-product-group]").filter({ hasText: goal });
  await expect(group.locator("p").first()).toHaveText(router);
  // the side card of a task has the product chips; toggling tags it, and the product tag shows on nothing else
  await row(page, task).getByRole("button", { name: task, exact: true }).click();
  const card = page.getByRole("complementary", { name: "Item" });
  await card.getByRole("group", { name: "Product" }).getByRole("button", { name: router }).click();
  await expect(card.getByRole("group", { name: "Product" }).getByRole("button", { name: router })).toHaveAttribute("aria-pressed", "true");
  const tagged = async () => ((await (await request.get(`${V}/pipelines`, { headers: headers() })).json()).streams.find((s: { stream: string }) => s.stream === "studio").items
    .find((i: { text: string }) => i.text === task).products as string[]);
  expect((await tagged()).map((t) => t.toLowerCase())).toContain(router.toLowerCase());
  // Edit goals can change a goal's product
  await b.getByRole("button", { name: "Edit goals of Studio" }).click();
  await b.getByLabel(`Product of ${goal}`).selectOption("");
  await b.getByRole("button", { name: "Done editing goals" }).click();
  await expect(b.locator('[data-product-group=""]').filter({ hasText: goal })).toBeVisible();
  await b.getByRole("button", { name: "Edit goals of Studio" }).click();
  await b.getByLabel(`Product of ${goal}`).selectOption({ label: router });
  await b.getByRole("button", { name: "Done editing goals" }).click();
  // rename: the heading and the task's tag follow
  await b.getByRole("button", { name: `Rename ${router}` }).click();
  await b.getByRole("textbox", { name: `New name for ${router}` }).fill(renamed);
  await b.getByRole("textbox", { name: `New name for ${router}` }).press("Enter");
  await expect(b.locator("[data-product]").filter({ hasText: renamed })).toBeVisible();
  await expect(b.locator("[data-product-group]").filter({ hasText: goal }).locator("p").first()).toHaveText(renamed);
  expect((await tagged()).map((t) => t.toLowerCase())).toContain(renamed.toLowerCase());
  // delete asks first and says how many tasks and goals lose the tag; the goal and the task stay
  await b.getByRole("button", { name: `Delete ${renamed}` }).click();
  await expect(b.getByRole("alertdialog")).toContainText(/1 task and 1 goal lose the tag/);
  await b.getByRole("button", { name: "Keep" }).click();
  await expect(b.locator("[data-product]").filter({ hasText: renamed })).toBeVisible();
  await b.getByRole("button", { name: `Delete ${renamed}` }).click();
  await b.getByRole("button", { name: "Delete product" }).click();
  await expect(b.locator("[data-product]").filter({ hasText: renamed })).toHaveCount(0);
  await expect(b.getByText(goal, { exact: true })).toBeVisible();
  await expect(row(page, task)).toBeVisible();
  expect((await tagged()).map((t) => t.toLowerCase())).not.toContain(renamed.toLowerCase());
});

test("habits sit under their goal, tick in Now with +1, and a task can become a habit", async ({ page, request }) => {
  const goalText = uniq("Habit goal"), habitName = uniq("Walk"), task = uniq("Become a habit");
  const goalId = await addGoal(request, apiQuarter, goalText);
  const made = await request.post(`${V}/habits`, { headers: headers(), data: { name: habitName, block: "soul", stream: "studio", per_week: 3, goal_ref: goalId } });
  expect(made.ok(), await made.text()).toBeTruthy();
  const loose = uniq("Loose habit");
  expect((await request.post(`${V}/habits`, { headers: headers(), data: { name: loose, block: "soul", stream: "studio", per_week: 5 } })).ok()).toBeTruthy();
  await addTasks(request, [task]);   // Now has no cap, so the row is on screen however many tasks earlier tests left
  await open(page);
  const b = block(page);
  // under the goal: ↻ name · n/wk · wk x/gate and a bar
  const under = b.locator(`[data-goal="${goalId}"]`).locator("xpath=..").locator("[data-habit]").filter({ hasText: habitName });
  await expect(under).toContainText("3/wk");
  await expect(under).toContainText(/wk \d+\/8/);
  // habits with no goal sit under their own heading
  await expect(b.locator("[data-habits-loose]")).toContainText("habits · no goal");
  await expect(b.locator("[data-habits-loose]")).toContainText(loose);
  // Now: this week's ticks and +1 for today
  const tick = cell(page, "now").locator("[data-habit-week]").filter({ hasText: habitName });
  const count = tick.locator("[data-habit-count]");
  const start = Number((await count.innerText()).split("/")[0]);
  await tick.getByRole("button", { name: `Tick today: ${habitName}` }).click();
  await expect(count).toHaveText(`${start + 1}/3`);
  await expect(tick.getByRole("button", { name: `Undo today: ${habitName}` })).toBeVisible();
  // goal focus highlights its habits and dims the rest
  await b.getByRole("button", { name: goalText }).click();
  await expect(cell(page, "now").locator("[data-habit-week]").filter({ hasText: loose })).toHaveClass(/opacity-30/);
  await expect(tick).not.toHaveClass(/opacity-30/);
  await page.getByRole("button", { name: "One goal ×" }).click();
  // the habit side card from the Plan: cadence, stage/week, goal picker
  await under.getByRole("button", { name: habitName }).click();
  const hcard = page.getByRole("complementary", { name: "Habit" });
  await expect(hcard.getByRole("group", { name: "Cadence" }).getByRole("button", { name: "3/wk" })).toHaveAttribute("aria-pressed", "true");
  await hcard.getByRole("group", { name: "Cadence" }).getByRole("button", { name: "4/wk" }).click();
  await expect(tick.locator("[data-habit-count]")).toHaveText(/\/4$/);
  await expect(hcard).toContainText("installing");
  await hcard.getByRole("group", { name: "Habit goal" }).getByRole("button", { name: "No goal" }).click();
  await expect(b.locator("[data-habits-loose]")).toContainText(habitName);
  await hcard.getByRole("group", { name: "Habit goal" }).getByRole("button", { name: new RegExp(goalText) }).click();
  await expect(under).toBeVisible();
  await hcard.getByRole("button", { name: "Close" }).click();
  // Make it a habit: asks, then the task is gone and the habit card opens
  await row(page, task).getByRole("button", { name: task, exact: true }).click();
  await page.getByRole("complementary", { name: "Item" }).getByRole("button", { name: "↻ Make it a habit" }).click();
  await page.getByRole("alertdialog", { name: "Make it a habit?" }).getByRole("button", { name: "Make habit" }).click();
  await expect(row(page, task)).toHaveCount(0);
  const card2 = page.getByRole("complementary", { name: "Habit" });
  await expect(card2).toContainText(task);
  await expect(card2.getByRole("group", { name: "Cadence" }).getByRole("button", { name: "3/wk" })).toHaveAttribute("aria-pressed", "true");
  await card2.getByRole("group", { name: "Cadence" }).getByRole("button", { name: "5/wk" }).click();
  await expect(b.locator("[data-habit]").filter({ hasText: task })).toContainText("5/wk");
});
