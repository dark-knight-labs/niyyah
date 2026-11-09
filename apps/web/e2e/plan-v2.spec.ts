import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Plan v2 in a browser against the real seeded API (the sample account: block "Studio", one quarter goal "Ship DNS").
 * Each test makes its own tasks, so order does not matter. Any browser console error fails the spec.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const MS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Today" the way the planner sees it (Asia/Dhaka), to name the months the page shows.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const [year, month] = today.split("-").map(Number);
const monthLabel = (y: number, m: number) => `${MS[m - 1]}-${y}`;
const thisMonth = monthLabel(year, month);
const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
const firstOfQuarter = monthLabel(year, quarterStart);
const earlier = month === quarterStart ? null : firstOfQuarter; // a month of this quarter before the current one, if there is one

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
test.afterEach(() => { expect(errors, "browser console errors").toEqual([]); });

const headers = () => ({ Authorization: `Bearer ${tokens!.access_token}` });

async function addTasks(request: APIRequestContext, texts: string[], lane: "now" | "next" | "backlog" = "now") {
  const r = await request.post(`${API}/api/v1/vault/pipeline/studio/items`, { headers: headers(), data: { texts, lane } });
  expect(r.ok()).toBeTruthy();
}

const row = (page: Page, text: string) => page.locator("[data-task]").filter({ hasText: text });
const cell = (page: Page, col: "now" | "next" | "someday") => page.locator(`[data-block="studio"] [data-col="${col}"]`);
const open = async (page: Page) => { await page.goto("/plan"); await expect(page.getByRole("table", { name: "Plan" })).toBeVisible(); };

test("one table: blocks against Now, Next and Someday, with the header and the quarter goals", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("region", { name: "Map" })).toHaveCount(0);       // the old Horizons map is gone
  await expect(page.getByRole("listbox", { name: "Work items" })).toHaveCount(0); // and so is the old work list
  const heads = page.getByRole("table", { name: "Plan" }).getByRole("columnheader");
  await expect(heads.nth(0)).toContainText("Block");
  await expect(heads.nth(1)).toContainText("Now");
  await expect(heads.nth(1)).toContainText("this week · W");
  await expect(heads.nth(2)).toContainText("prioritized");
  await expect(heads.nth(3)).toContainText("ideas, notes, links");
  await expect(page.getByText(/Plan · Q\d'\d\d/).first()).toBeVisible();
  await expect(page.getByText(/W\d\d · [A-Z][a-z]{2}-\d{4}/).first()).toBeVisible();
  const block = page.locator('[data-block="studio"]');
  await expect(block.getByText("Studio", { exact: true })).toBeVisible();
  await expect(block.getByRole("listitem", { name: "" }).first()).toContainText("Ship DNS");
  await expect(block.getByRole("button", { name: /^\+ Q\d'\d\d goal$/ })).toBeVisible();
  await expect(cell(page, "now")).toContainText("Wire the router");
  await expect(cell(page, "next")).toContainText("Plan the DNS cutover");
  await expect(cell(page, "someday")).toContainText("Replace the switch");
  // narrow screens scroll the table inside its own container, not the page
  await page.setViewportSize({ width: 600, height: 900 });
  const box = await page.getByTestId("plan-scroll").evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(box.scroll).toBeGreaterThan(box.client);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("a goal can be added, a task nested under it, and focus mode dims the rest", async ({ page, request }) => {
  const nested = uniq("Nested task"), loose = uniq("Loose task"), goal = uniq("Goal");
  await addTasks(request, [nested, loose]);
  await open(page);
  const block = page.locator('[data-block="studio"]');
  await block.getByRole("button", { name: /^\+ Q\d'\d\d goal$/ }).click();
  await block.getByRole("textbox", { name: /^New Q\d'\d\d goal/ }).fill(goal);
  await block.getByRole("button", { name: "Add", exact: true }).click();
  await expect(block.getByRole("button", { name: goal })).toBeVisible();
  await row(page, nested).getByRole("button", { name: nested, exact: true }).click();
  const card = page.getByRole("complementary", { name: "Item" });
  await card.getByRole("group", { name: "Goal" }).getByRole("button", { name: new RegExp(goal) }).click();
  await expect(cell(page, "now").getByText(`↳ ${goal}`)).toBeVisible();
  await expect(cell(page, "now").getByText("not nested", { exact: true })).toBeVisible();
  await expect(block.locator(`[data-goal]`).filter({ hasText: goal })).toContainText("0/1");
  await block.getByRole("button", { name: goal }).click();                       // focus mode
  await expect(row(page, loose)).toHaveClass(/opacity-30/);
  await expect(row(page, nested)).not.toHaveClass(/opacity-30/);
  await page.getByRole("button", { name: "One goal ×" }).click();
  await expect(row(page, loose)).not.toHaveClass(/opacity-30/);
  // un-nest from the card
  await card.getByRole("group", { name: "Goal" }).getByRole("button", { name: "Not nested" }).click();
  await expect(cell(page, "now").getByText(`↳ ${goal}`)).toHaveCount(0);
});

test("labels: month, date, late with a quick move, and the filters", async ({ page, request }) => {
  const a = uniq("Label task");
  await addTasks(request, [a]);
  await open(page);
  await row(page, a).getByRole("button", { name: a, exact: true }).click();
  const card = page.getByRole("complementary", { name: "Item" });
  const label = card.getByRole("group", { name: "Label" });
  await label.getByRole("button", { name: thisMonth }).click();
  await expect(row(page, a).locator("[data-label]")).toHaveText(thisMonth);
  // a day label replaces the month
  await label.getByLabel("Label date").fill(`${year}-${String(month).padStart(2, "0")}-28`);
  await label.getByLabel("Label date").press("Enter");  // saved on Enter or blur, not on every keystroke
  await expect(row(page, a).locator("[data-label]")).toHaveText(/^[A-Z][a-z]{2} 28 [A-Z][a-z]{2}$/);
  // the filter row: this month shows it, No label hides it
  await page.getByRole("group", { name: "Label" }).first().getByRole("button", { name: thisMonth }).click();
  await expect(row(page, a)).toBeVisible();
  await page.getByRole("button", { name: "No label" }).click();
  await expect(row(page, a)).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(row(page, a)).toBeVisible();
  await label.getByRole("button", { name: "None" }).click();
  await expect(row(page, a).locator("[data-label]")).toHaveCount(0);
  // late: a past day label is red and offers a one-click move to this month
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date(Date.now() - 86_400_000 * 3));
  await label.getByLabel("Label date").fill(yesterday);
  await label.getByLabel("Label date").press("Enter");
  await expect(row(page, a).locator("[data-label]")).toHaveClass(/destructive/);
  await expect(page.getByRole("button", { name: /^Late \d+$/ })).toBeVisible();
  await page.getByRole("button", { name: `Move to ${thisMonth}: ${a}` }).click();
  await expect(row(page, a).locator("[data-label]")).toHaveText(thisMonth);
  await expect(row(page, a).locator("[data-label]")).not.toHaveClass(/destructive/);
  if (earlier) {
    await label.getByRole("button", { name: earlier }).click();
    await expect(row(page, a).locator("[data-label]")).toHaveClass(/destructive/);   // an earlier month of the quarter is late too
  }
});

test("Next is ordered and numbered per block; up and down reorder", async ({ page, request }) => {
  const first = uniq("Order A"), second = uniq("Order B");
  await addTasks(request, [first, second], "next");
  await open(page);
  const next = cell(page, "next");
  const order = async () => (await next.locator("[data-task]").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
  const before = await order();
  const at = (list: string[], text: string) => list.findIndex((t) => t.includes(text));
  expect(at(before, first)).toBeLessThan(at(before, second));
  await page.getByRole("button", { name: `Move up: ${second}` }).click();
  await expect.poll(async () => { const l = await order(); return at(l, second) < at(l, first); }).toBe(true);
  await page.getByRole("button", { name: `Move down: ${second}` }).click();
  await expect.poll(async () => { const l = await order(); return at(l, first) < at(l, second); }).toBe(true);
  expect((await order())[0]).toMatch(/^1\b/);                                         // numbered from 1
});

test("Now over its limit warns on the block; Next and Someday show +n more", async ({ page, request }) => {
  await addTasks(request, [uniq("Hot 1"), uniq("Hot 2"), uniq("Hot 3"), uniq("Hot 4")], "now");
  await addTasks(request, Array.from({ length: 5 }, (_, i) => uniq(`Idea ${i}`)), "backlog");
  await addTasks(request, Array.from({ length: 7 }, (_, i) => uniq(`Queue ${i}`)), "next");
  await open(page);
  await expect(page.locator('[data-block="studio"]').getByText(/Now \d+\/3/)).toBeVisible();
  await expect(cell(page, "next").locator("[data-task]")).toHaveCount(6);
  await expect(cell(page, "next").getByRole("button", { name: /^\+\d+ more$/ })).toBeVisible();
  await expect(cell(page, "someday").locator("[data-task]")).toHaveCount(3);  // the cap counts tasks and plain notes; open blockers sit outside it
  await cell(page, "next").getByRole("button", { name: /^\+\d+ more$/ }).click();
  expect(await cell(page, "next").locator("[data-task]").count()).toBeGreaterThan(6);
});

test("Done view: ticking moves a task there, its checkbox reopens it", async ({ page, request }) => {
  const t = uniq("Finish me");
  await addTasks(request, [t]);
  await open(page);
  await page.getByLabel(`Done: ${t}`).click({ force: true });
  await expect(row(page, t)).toHaveCount(0);
  await page.getByRole("button", { name: /^Done \d+$/ }).click();
  const done = page.getByRole("table", { name: "Done" });
  await expect(done.getByRole("columnheader")).toHaveText(["Item", "Block", "Goal", "Label"]);
  const doneRow = done.getByRole("row").filter({ hasText: t });
  await expect(doneRow).toContainText("Studio");
  await doneRow.getByLabel(`Reopen: ${t}`).click({ force: true });
  await expect(doneRow).toHaveCount(0);
  await page.getByRole("button", { name: "Back to Plan" }).click();
  const more = cell(page, "next").getByRole("button", { name: /^\+\d+ more$/ }); // a reopened task goes to the end of Next, which may be capped
  if (await more.count()) await more.click();
  await expect(row(page, t)).toBeVisible();
});

test("the side card keeps rename, details and delete, and adds Status", async ({ page, request }) => {
  const t = uniq("Card task");
  await addTasks(request, [t]);
  await open(page);
  await row(page, t).getByRole("button", { name: t, exact: true }).click();
  const card = page.getByRole("complementary", { name: "Item" });
  await card.getByRole("group", { name: "Status" }).getByRole("button", { name: "Someday" }).click();
  await expect(card.getByRole("group", { name: "Status" }).getByRole("button", { name: "Someday" })).toHaveAttribute("aria-pressed", "true");
  await card.getByLabel("Details").fill("some notes");
  await card.getByLabel("Details").blur();
  await card.getByRole("button", { name: "Delete" }).click();
  await card.getByRole("button", { name: "Confirm delete" }).click();
  await expect(row(page, t)).toHaveCount(0);
});

test("dark theme keeps the table readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await expect(page.getByRole("table", { name: "Plan" })).toBeVisible();
});

test("an open blocker is flagged in the block cell and listed first in Someday, whatever the filters", async ({ page }) => {
  await open(page);
  const block = page.locator('[data-block="studio"]');
  await expect(block.getByRole("button", { name: /blocked in Studio/ })).toBeVisible();
  await page.getByRole("button", { name: "No label" }).click();                       // hides every labelled item and the plain notes
  await expect(cell(page, "someday")).toContainText("Waiting on legal");
  await block.getByRole("button", { name: /blocked in Studio/ }).click();
  await expect(page.getByRole("complementary", { name: "Item" }).getByLabel("Title")).toHaveValue("Waiting on legal");
});

test("goal lines can be renamed and removed; a task under a removed goal says so", async ({ page, request }) => {
  const t = uniq("Orphan task"), goal = uniq("Short lived");
  await addTasks(request, [t]);
  await open(page);
  const block = page.locator('[data-block="studio"]');
  await block.getByRole("button", { name: /^\+ Q\d'\d\d goal$/ }).click();
  await block.getByRole("textbox", { name: /^New Q\d'\d\d goal/ }).fill(goal);
  await block.getByRole("button", { name: "Add", exact: true }).click();
  await row(page, t).getByRole("button", { name: t, exact: true }).click();
  await page.getByRole("group", { name: "Goal" }).getByRole("button", { name: new RegExp(goal) }).click();
  await expect(cell(page, "now").getByText(`↳ ${goal}`)).toBeVisible();
  await block.getByRole("button", { name: "Edit goals of Studio" }).click();
  const renamed = `${goal} renamed`;
  const text = block.getByText(goal, { exact: true });
  await text.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" renamed");
  await page.keyboard.press("Enter");
  await expect(block.getByText(renamed, { exact: true })).toBeVisible();
  await block.getByRole("button", { name: `Remove: ${renamed}` }).click({ force: true });
  await block.getByRole("button", { name: "Done editing goals" }).click();
  await expect(cell(page, "now").getByText("↳ (removed goal)")).toBeVisible();
  await expect(cell(page, "now").getByText("↳ (removed goal)")).toHaveClass(/warn/);
});

test("keyboard: j selects the next task, x ticks it, / goes to the capture bar", async ({ page, request }) => {
  const t = uniq("Keyed");
  await addTasks(request, [t]);
  await open(page);
  await page.keyboard.press("j");
  await expect(page.getByRole("complementary", { name: "Item" })).toBeVisible();
  const first = await page.locator("[data-task].shadow-\\[inset_2px_0_0_var\\(--accent\\)\\]").first().getAttribute("data-task");
  expect(first).not.toBeNull();
  await page.keyboard.press("/");
  await expect(page.locator("#plan-capture")).toBeFocused();
  await page.keyboard.press("Escape");
  await row(page, t).getByRole("button", { name: t, exact: true }).click();
  await page.keyboard.press("x");
  await expect(row(page, t)).toHaveCount(0);
});

test("Next arrows act on the order shown: numbered as displayed, hidden while a label filter is on", async ({ page, request }) => {
  const a = uniq("Arrow A"), b = uniq("Arrow B");
  await addTasks(request, [a, b], "next");
  await open(page);
  await expect(page.getByRole("button", { name: /^Move up: / }).first()).toBeVisible();
  await page.getByRole("button", { name: "No label" }).click();
  await expect(page.getByRole("button", { name: /^Move up: / })).toHaveCount(0);
  const nums = (await cell(page, "next").locator("[data-task] > span.mono").first().innerText()).trim();
  expect(nums).toBe("1");
});
