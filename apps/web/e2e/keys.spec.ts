import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Keyboard shortcuts in a browser against the seeded API (run.sh): Overview d / w / Shift+D, Plan 1 2 3 / n, the "?" sheet,
 * and the g-chords that must keep working next to all of them. Any browser console error fails the spec.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";

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

async function addTasks(request: APIRequestContext, texts: string[], lane: "now" | "next" | "backlog") {
  const r = await request.post(`${API}/api/v1/vault/pipeline/studio/items`, { headers: { Authorization: `Bearer ${tokens!.access_token}` }, data: { texts, lane } });
  expect(r.ok()).toBeTruthy();
}

const calView = (page: Page) => page.locator("[data-cal-view]");
const sheet = (page: Page) => page.getByTestId("shortcut-help");
async function openOverview(page: Page) {
  await page.goto("/");
  await expect(calView(page)).toBeVisible({ timeout: 30_000 });
}
async function openPlan(page: Page) {
  await page.goto("/plan");
  await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
}
/** "Show done N" in the View options menu is on or off (week grid only); the menu is closed again after. */
async function showDoneOn(page: Page) {
  await page.locator("[data-cal-bar]").getByRole("button", { name: /^View options/ }).click();
  const on = await page.getByRole("button", { name: /^Show done \d+$/ }).getAttribute("aria-pressed");
  await page.keyboard.press("Escape");
  return on === "true";
}

test("hotkeys overview: w and d switch Week and Day, Shift+D toggles done, g p still navigates, typing in quick add is ignored", async ({ page }) => {
  await openOverview(page);
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("w");
  await expect(calView(page)).toHaveAttribute("data-cal-view", "week-grid");
  const before = await showDoneOn(page);
  await page.keyboard.press("Shift+D");
  expect(await showDoneOn(page)).toBe(!before);
  await page.keyboard.press("Shift+D");
  expect(await showDoneOn(page)).toBe(before);
  await page.keyboard.press("d");
  await expect(calView(page)).not.toHaveAttribute("data-cal-view", "week-grid");
  await expect(page.locator("[data-cal-bar]").getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Typing in the quick-add line is not a shortcut.
  await page.locator("#quick-add-title").click();
  await page.keyboard.type("wd");
  await expect(page.locator("#quick-add-title")).toHaveValue("wd");
  await expect(page.locator("[data-cal-bar]").getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator("#quick-add-title").fill("");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page).toHaveURL(/\/plan$/);
});

test("hotkeys plan: 1 2 3 pick a column, n adds there, g s still opens Settings, typing in the capture bar is ignored", async ({ page, request }) => {
  const a = uniq("Key now"), b = uniq("Key next"), c = uniq("Key someday");
  await addTasks(request, [a], "now");
  await addTasks(request, [b], "next");
  await addTasks(request, [c], "backlog");
  await openPlan(page);
  await page.locator('select[aria-label="Block"]').selectOption("studio");
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  const picked = (col: string) => page.locator(`td[data-col="${col}"] [data-task].shadow-\\[inset_2px_0_0_var\\(--accent\\)\\]`);
  await page.keyboard.press("2");
  await expect(picked("next")).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: "Item" })).toBeVisible();
  await page.keyboard.press("3");
  await expect(picked("someday")).toHaveCount(1);
  await expect(picked("next")).toHaveCount(0);
  await page.keyboard.press("1");
  await expect(picked("now")).toHaveCount(1);
  // n adds in the column last pointed at (Now here), and the letters typed after it stay in the line.
  await page.keyboard.press("n");
  await expect(page.locator("#plan-capture")).toBeFocused();
  await expect(page.getByRole("button", { name: "Add to column" })).toContainText("Now");
  await expect(page.locator("#plan-capture")).toHaveValue("");
  await page.keyboard.type("n12j");
  await expect(page.locator("#plan-capture")).toHaveValue("n12j");
  await expect(page.getByRole("button", { name: "Add to column" })).toContainText("Now");
  const added = uniq("Added by n");
  await page.locator("#plan-capture").fill(added);
  await page.keyboard.press("Enter");
  await expect(page.locator('td[data-col="now"] [data-task]').filter({ hasText: added })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page).toHaveURL(/\/settings$/);
});

test("hotkeys help: ? opens the list on Overview and Plan, Esc and ? close it, keys do nothing behind it", async ({ page }) => {
  await openOverview(page);
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("d");
  await expect(page.locator("[data-cal-bar]").getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("?");
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('[data-scope="Overview"]')).toContainText("Show or hide done tasks");
  await expect(sheet(page).locator('[data-scope="Everywhere"]')).toContainText("Go to Plan");
  await expect(sheet(page).locator('[data-scope="Plan"]')).toHaveCount(0);
  // keys do nothing behind it: w would switch to Week, g p would leave the page
  await page.keyboard.press("w");
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page).toHaveURL(/\/$/);
  await expect(calView(page)).not.toHaveAttribute("data-cal-view", "week-grid"); // the page behind is aria-hidden, so read the attribute
  // Esc closes it on Overview, where the page has an Escape key of its own
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await page.keyboard.press("?");
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press("?");
  await expect(sheet(page)).toHaveCount(0);
  // after it closed, keys work again
  await page.keyboard.press("w");
  await expect(calView(page)).toHaveAttribute("data-cal-view", "week-grid");

  await openPlan(page);
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("?");
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('[data-scope="Plan"]')).toContainText("Pick the first task in Next");
  await expect(sheet(page).locator('[data-scope="Overview"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
});
