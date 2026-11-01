import { expect, test, type Page } from "@playwright/test";

/**
 * Overview items against a seeded dev API (run.sh): quick add, the details card (sub-tasks, tags, notes), annotating a
 * calendar fixture event, locked fields on calendar items, and the week calendar's task tick / move / pin.
 * The tests share one database and run in order.
 */
test.describe.configure({ mode: "serial" });

const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const OUT = "e2e/out";

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Today in the schedule's timezone (the sample account is in Dhaka), and a neighbour in the same Sunday-Saturday week. */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
const other = iso(new Date(Date.parse(`${today}T00:00:00Z`) + (dow < 6 ? 1 : -1) * 86_400_000));

let tokens: { access_token: string; refresh_token: string } | null = null;

test.beforeEach(async ({ page, request }) => {
  if (!tokens) {
    const res = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    tokens = await res.json();
  }
  await page.addInitScript((t) => { localStorage.setItem("access_token", t.access_token); localStorage.setItem("refresh_token", t.refresh_token); }, tokens!);
});

const allDay = (page: Page, day: string) => page.locator(`[data-allday][data-day="${day}"]`);
const grid = (page: Page, day: string) => page.locator(`[data-grid-day="${day}"]`);
const card = (page: Page) => page.getByRole("region", { name: "Item details" });

async function openOverview(page: Page) {
  await page.goto("/");
  // The week has loaded once the fixture's daily standup shows on today.
  await expect(grid(page, today).getByText("Daily standup")).toBeVisible({ timeout: 30_000 });
}

async function quickAdd(page: Page, line: string) {
  const input = page.locator("#quick-add-title");
  await input.fill(line);
  await expect(page.locator("#quick-add-preview")).toBeVisible();
  const preview = await page.locator("#quick-add-preview").innerText();
  const made = page.waitForResponse((r) => r.url().endsWith("/vault/items") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Add task" }).click();
  expect((await made).status()).toBe(201);
  await expect(input).toHaveValue("");
  return preview;
}

/** Open the details of the all-day own item `title` on `day` (its title button: the name starts with the title, tags follow). */
const openTask = (page: Page, day: string, title: string) => allDayTask(page, day, title).getByRole("button", { name: new RegExp(`^${title}`) }).click();

/** The own item called `title` on `day`, in the all-day row. */
const allDayTask = (page: Page, day: string, title: string) => allDay(page, day).locator('[data-item^="t:"]').filter({ hasText: title });

test("quick add: no time makes an all-day item, #tags become tags", async ({ page }) => {
  await openOverview(page);
  const preview = await quickAdd(page, "Buy milk #errand");
  expect(preview).toContain("all day");
  expect(preview).toContain("#errand");
  const row = allDayTask(page, today, "Buy milk");
  await expect(row).toBeVisible();
  await expect(row.locator('[data-tag="errand"]')).toBeVisible();
  await expect(row).not.toContainText("#errand Buy"); // the tag is not left in the title
});

test("quick add: 14:00-15:00 makes a timed item in the grid", async ({ page }) => {
  await openOverview(page);
  const preview = await quickAdd(page, "Write report 14:00-15:00 #work");
  expect(preview).toContain("14:00–15:00");
  const block = grid(page, today).locator('[data-item^="t:"]').filter({ hasText: "Write report" });
  await expect(block).toBeVisible();
  await expect(block).toContainText("14:00–15:00");
  await expect(allDayTask(page, today, "Write report")).toHaveCount(0);
  // "14:00 45m" form too.
  expect(await quickAdd(page, "Stretch 16:00 45m")).toContain("16:00–16:45");
  await expect(grid(page, today).locator('[data-item^="t:"]').filter({ hasText: "Stretch" })).toContainText("16:00–16:45");
});

test("quick add: a bad time falls back to all day", async ({ page }) => {
  await openOverview(page);
  const preview = await quickAdd(page, "Call bank 18:00-17:00");
  expect(preview).toContain("time not understood, added as all day");
  await expect(allDayTask(page, today, "Call bank")).toBeVisible();
  await expect(grid(page, today).locator('[data-item^="t:"]').filter({ hasText: "Call bank" })).toHaveCount(0);
});

test("details card: add, tick and remove sub-tasks; all done prompts to mark the item done", async ({ page }) => {
  await openOverview(page);
  await openTask(page, today, "Buy milk");
  const c = card(page);
  await expect(c).toBeVisible();
  const add = c.getByLabel("Sub-tasks: add a line");
  for (const line of ["Oat milk", "Eggs", "Bread"]) {
    const saved = page.waitForResponse((r) => r.url().includes("/vault/items/") && r.request().method() === "PATCH");
    await add.fill(line);
    await add.press("Enter");
    await saved;
    await expect(c.getByLabel(`Done: ${line}`)).toBeVisible();
  }
  const removed = page.waitForResponse((r) => r.url().includes("/vault/items/") && r.request().method() === "PATCH");
  await c.getByRole("button", { name: "Remove: Bread" }).click();
  await removed;
  await expect(c.getByLabel("Done: Bread")).toHaveCount(0);
  await expect(c.getByRole("status").filter({ hasText: "All sub-tasks are done" })).toHaveCount(0);
  for (const line of ["Oat milk", "Eggs"]) {
    const ticked = page.waitForResponse((r) => r.url().includes("/vault/items/") && r.request().method() === "PATCH");
    await c.getByLabel(`Done: ${line}`).check();
    await ticked;
  }
  await expect(c.getByText("2 / 2")).toBeVisible();
  await expect(allDayTask(page, today, "Buy milk").locator('[data-mark="subtasks"]')).toHaveText("2/2");
  const prompt = c.getByRole("status").filter({ hasText: "All sub-tasks are done." });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Mark item done" }).click();
  await expect(c.getByRole("group", { name: "Status" }).getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
  await expect(prompt).toHaveCount(0);
  // Reloaded, the sub-tasks and status are still there.
  await page.reload();
  await expect(grid(page, today).getByText("Daily standup")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Done \d+$/ }).click(); // show done tasks
  await openTask(page, today, "Buy milk");
  await expect(card(page).getByLabel("Reopen: Oat milk")).toBeChecked();
  await expect(card(page).getByRole("group", { name: "Status" }).getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
});

test("notes: a #word typed in the notes becomes a tag, shown on the item", async ({ page }) => {
  await openOverview(page);
  await openTask(page, today, "Call bank");
  const c = card(page);
  const saved = page.waitForResponse((r) => r.url().includes("/vault/items/") && r.request().method() === "PATCH");
  await c.getByRole("textbox", { name: "Details" }).fill("Ask about the fee #budget");
  await c.getByRole("group", { name: "Status" }).click({ position: { x: 1, y: 1 } }); // leave the field
  await saved;
  await expect(c.locator('[data-tag="budget"]')).toBeVisible();
  const row = allDayTask(page, today, "Call bank");
  await expect(row.locator('[data-tag="budget"]')).toBeVisible();
  await expect(row.locator('[data-mark="notes"]')).toBeVisible();
  // A tag added by hand shows too, and can be removed.
  const tagged = page.waitForResponse((r) => r.url().includes("/vault/items/") && r.request().method() === "PATCH");
  await c.getByLabel("Add a tag").fill("#calls");
  await c.getByLabel("Add a tag").press("Enter");
  await tagged;
  await expect(row.locator('[data-tag="calls"]')).toBeVisible();
});

test("calendar event: annotate notes and weight, still there after reload; title, time and delete are locked", async ({ page }) => {
  await openOverview(page);
  await grid(page, today).getByText("Daily standup").click();
  const c = card(page);
  await expect(c).toHaveAttribute("data-kind", "event");
  await expect(c.getByRole("heading", { name: "Daily standup" })).toBeVisible();
  await expect(c.getByRole("textbox", { name: "Title" })).toHaveCount(0);
  await expect(c.getByRole("button", { name: /delete/i })).toHaveCount(0);
  await expect(c.getByLabel("Day")).toHaveCount(0);
  await expect(c.getByRole("group", { name: "When" })).toHaveCount(0);
  await expect(c.locator("[data-locked]")).toContainText("from the Fixture calendar");
  await expect(c.getByRole("link", { name: "Join Meet" })).toBeVisible();

  let saved = page.waitForResponse((r) => r.url().endsWith("/vault/items/overlay") && r.request().method() === "PUT");
  await c.getByRole("textbox", { name: "Details" }).fill("Agenda: blockers first #standup");
  await c.getByRole("group", { name: "Status" }).click({ position: { x: 1, y: 1 } });
  const first = await saved;
  const body = first.request().postDataJSON();
  expect(body.key).toMatch(/^fixture-standup@niyyah\|/);
  expect(body.title).toBe("Daily standup");
  expect(body.calendar).toBe("Fixture");
  saved = page.waitForResponse((r) => r.url().endsWith("/vault/items/overlay") && r.request().method() === "PUT");
  await c.getByRole("button", { name: "Weight 2" }).click();
  await saved;

  await page.reload();
  await expect(grid(page, today).getByText("Daily standup")).toBeVisible({ timeout: 30_000 });
  const block = grid(page, today).locator('[data-item^="e:"]').filter({ hasText: "Daily standup" });
  await expect(block.locator('[data-mark="weight"]')).toHaveAttribute("aria-label", "Weight 2");
  await expect(block.locator('[data-mark="notes"]')).toBeVisible();
  await block.click();
  await expect(card(page).getByRole("textbox", { name: "Details" })).toHaveValue("Agenda: blockers first #standup");
  await expect(card(page).getByRole("button", { name: "Weight 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(card(page).locator('[data-tag="standup"]')).toBeVisible();
  // Another day's standup is a separate occurrence with its own notes.
  await page.keyboard.press("Escape");
  await grid(page, other).getByText("Daily standup").click();
  await expect(card(page).getByRole("textbox", { name: "Details" })).toHaveValue("");
});

test("week calendar: tick a task, move it to another day, toggle its pin star", async ({ page }) => {
  await openOverview(page);
  // Tick: a done task leaves the row while done tasks are hidden.
  const pay = allDayTask(page, today, "Pay invoice");
  await expect(pay).toBeVisible();
  await pay.getByRole("button", { name: "Done: Pay invoice" }).click();
  await expect(pay).toHaveCount(0);
  await page.getByRole("button", { name: /^Done \d+$/ }).click();
  await expect(pay.getByRole("button", { name: "Not done: Pay invoice" })).toHaveAttribute("aria-pressed", "true");
  await pay.getByRole("button", { name: "Not done: Pay invoice" }).click();
  await expect(pay.getByRole("button", { name: "Done: Pay invoice" })).toHaveAttribute("aria-pressed", "false");

  // Move: drag between days in the all-day row.
  const moved = page.waitForResponse((r) => r.url().endsWith("/vault/tasks/move"));
  await allDayTask(page, today, "Call bank").dragTo(allDay(page, other));
  expect((await moved).ok()).toBeTruthy();
  await expect(allDayTask(page, other, "Call bank")).toBeVisible();
  await expect(allDayTask(page, today, "Call bank")).toHaveCount(0);

  // Pin star.
  const star = allDayTask(page, other, "Call bank").getByRole("button", { name: "Important: Call bank" });
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Important", { exact: true }).getByText("Call bank")).toBeVisible();

  await page.reload();
  await expect(grid(page, today).getByText("Daily standup")).toBeVisible({ timeout: 30_000 });
  await expect(allDayTask(page, other, "Call bank")).toBeVisible();
  await expect(allDayTask(page, other, "Call bank").getByRole("button", { name: "Important: Call bank" })).toHaveAttribute("aria-pressed", "true");
  await allDayTask(page, other, "Call bank").getByRole("button", { name: "Important: Call bank" }).click();
  await expect(allDayTask(page, other, "Call bank").getByRole("button", { name: "Important: Call bank" })).toHaveAttribute("aria-pressed", "false");

  // The card's Day field moves an item too, and the card stays open on it.
  await openTask(page, other, "Call bank");
  const movedBack = page.waitForResponse((r) => r.url().endsWith("/vault/tasks/move"));
  await card(page).getByLabel("Day").fill(today);
  await movedBack;
  await expect(allDayTask(page, today, "Call bank")).toBeVisible();
  await expect(card(page).getByLabel("Day")).toHaveValue(today);

  // An own timed item drags in the grid too, and back to the all-day row.
  const stretch = grid(page, today).locator('[data-item^="t:"]').filter({ hasText: "Stretch" });
  const patched = page.waitForResponse((r) => r.url().includes("/vault/items/") && r.request().method() === "PATCH");
  await stretch.dragTo(allDay(page, today));
  await patched;
  await expect(allDayTask(page, today, "Stretch")).toBeVisible();
});

test("screenshots: light and dark", async ({ page }) => {
  await openOverview(page);
  await page.getByRole("button", { name: /^Done \d+$/ }).click(); // show done tasks: the done one with sub-tasks
  await openTask(page, today, "Buy milk");
  await expect(card(page)).toBeVisible();
  await page.screenshot({ path: `${OUT}/overview-task-light.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: `${OUT}/overview-task-dark.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await grid(page, today).getByText("Daily standup").click();
  await expect(card(page)).toHaveAttribute("data-kind", "event");
  await page.screenshot({ path: `${OUT}/overview-event-dark.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.screenshot({ path: `${OUT}/overview-event-light.png`, fullPage: true });
});
