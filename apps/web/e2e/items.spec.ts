import { expect, test, type Page } from "@playwright/test";

/**
 * Overview items against a seeded dev API (run.sh): quick add, the details card (sub-tasks, tags, notes), annotating a
 * calendar fixture event, locked fields on calendar items, and the week calendar's task tick / move / pin.
 * Then /calendar: its eight views, V rotation, the stored choice, the card, the All day strip and the tag filter.
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
const bar = (page: Page) => page.locator("[data-cal-bar]");
const day3 = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00Z`));
const plus = (iso: string, n: number) => iso8601(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));
const iso8601 = (d: Date) => d.toISOString().slice(0, 10);
const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const wordOf = (isoDay: string) => WD[new Date(`${isoDay}T00:00:00Z`).getUTCDay()];

/** Open the bar's View options menu (styles, tag filter, display) unless it is open already. */
async function menu(page: Page) {
  const b = bar(page).getByRole("button", { name: /^View options/ });
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
}

/** Choose a style from the Style menu, switching Day | Week first when the style is in the other scope. */
async function pickView(page: Page, v: string) {
  const scope = v.startsWith("day") ? "Day" : "Week";
  const btn = bar(page).getByRole("group", { name: "Scope" }).getByRole("button", { name: scope, exact: true });
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await menu(page);
  await page.locator(`[data-view-button="${v}"]`).click();
}

/** Show done tasks through the Display menu (week grid). */
async function showDone(page: Page) {
  await menu(page);
  const b = page.getByRole("button", { name: /^Show done \d+$/ });
  if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
  await page.keyboard.press("Escape");
}

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
  await page.getByRole("button", { name: "Add item" }).click();
  expect((await made).status()).toBe(201);
  await expect(input).toHaveValue("");
  return preview;
}

/** Open the details of the all-day own item `title` on `day` (its title button: the name starts with the title, tags follow). */
const openTask = async (page: Page, day: string, title: string) => (await task(page, day, title)).getByRole("button", { name: new RegExp(`^${title}`) }).click();

/** The own item called `title` on `day`, in the all-day row (in the DOM whether or not the day's list is open, so a count of 0 is real). */
const allDayTask = (page: Page, day: string, title: string) => allDay(page, day).locator('[data-item^="t:"]').filter({ hasText: title });

/** Open `day`'s all-day list when the day shows a count (two or more items) and it is closed; one item shows in the cell itself. */
async function showAllDay(page: Page, day: string) {
  const count = page.locator(`[data-allday-count="${day}"]`);
  if ((await count.count()) && (await count.getAttribute("aria-expanded")) !== "true") await count.click();
}

/** allDayTask with the day's list opened first, for a row to look at or use. */
async function task(page: Page, day: string, title: string) {
  await showAllDay(page, day);
  return allDayTask(page, day, title);
}

test("quick add: no time makes an all-day item, #tags become tags", async ({ page }) => {
  await openOverview(page);
  const preview = await quickAdd(page, "Buy milk #errand");
  expect(preview).toContain("all day");
  expect(preview).toContain("#errand");
  const row = await task(page, today, "Buy milk");
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
  await expect(await task(page, today, "Call bank")).toBeVisible();
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
  await showDone(page);
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
  const row = await task(page, today, "Call bank");
  await expect(row.locator('[data-tag="budget"]')).toBeVisible();
  await expect(row.locator('[data-mark="notes"]')).toBeVisible();
  // A tag added by hand shows too, and can be removed.
  const tagged = page.waitForResponse((r) => r.url().includes("/vault/items/") && r.request().method() === "PATCH");
  await c.getByLabel("Add a tag").fill("#calls");
  await c.getByLabel("Add a tag").press("Enter");
  await tagged;
  await showAllDay(page, today); // the card took the click, which closed the list
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
  const pay = await task(page, today, "Pay invoice");
  await expect(pay).toBeVisible();
  await pay.getByRole("button", { name: "Done: Pay invoice" }).click();
  await expect(pay).toHaveCount(0);
  await showDone(page);
  await showAllDay(page, today);
  await expect(pay.getByRole("button", { name: "Not done: Pay invoice" })).toHaveAttribute("aria-pressed", "true");
  await pay.getByRole("button", { name: "Not done: Pay invoice" }).click();
  await expect(pay.getByRole("button", { name: "Done: Pay invoice" })).toHaveAttribute("aria-pressed", "false");

  // Move: drag between days in the all-day row.
  const moved = page.waitForResponse((r) => r.url().endsWith("/vault/tasks/move"));
  await (await task(page, today, "Call bank")).dragTo(allDay(page, other));
  expect((await moved).ok()).toBeTruthy();
  await expect(await task(page, other, "Call bank")).toBeVisible();
  await expect(allDayTask(page, today, "Call bank")).toHaveCount(0);

  // Pin star.
  const star = (await task(page, other, "Call bank")).getByRole("button", { name: "Important: Call bank" });
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Important", { exact: true }).getByText("Call bank")).toBeVisible();

  await page.reload();
  await expect(grid(page, today).getByText("Daily standup")).toBeVisible({ timeout: 30_000 });
  await expect(await task(page, other, "Call bank")).toBeVisible();
  await expect(allDayTask(page, other, "Call bank").getByRole("button", { name: "Important: Call bank" })).toHaveAttribute("aria-pressed", "true");
  await allDayTask(page, other, "Call bank").getByRole("button", { name: "Important: Call bank" }).click();
  await expect(allDayTask(page, other, "Call bank").getByRole("button", { name: "Important: Call bank" })).toHaveAttribute("aria-pressed", "false");

  // The card's Day field moves an item too, and the card stays open on it.
  await openTask(page, other, "Call bank");
  const movedBack = page.waitForResponse((r) => r.url().endsWith("/vault/tasks/move"));
  await card(page).getByLabel("Day").fill(today);
  await movedBack;
  await expect(await task(page, today, "Call bank")).toBeVisible();
  await expect(card(page).getByLabel("Day")).toHaveValue(today);

  // An own timed item drags in the grid too, and back to the all-day row.
  const stretch = grid(page, today).locator('[data-item^="t:"]').filter({ hasText: "Stretch" });
  const patched = page.waitForResponse((r) => r.url().includes("/vault/items/") && r.request().method() === "PATCH");
  await stretch.dragTo(allDay(page, today));
  await patched;
  await expect(await task(page, today, "Stretch")).toBeVisible();
});

test("screenshots: light and dark", async ({ page }) => {
  await openOverview(page);
  await showDone(page); // the done task with sub-tasks
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

/* ---------- the calendar on "/": the eight rotatable views ---------- */

const VIEWS = ["day-grid", "day-agenda", "day-ribbon", "day-ring", "week-grid", "week-agenda", "week-strips", "week-blocks"] as const;
const view = (page: Page) => page.locator("[data-cal-view]");
const panel = (page: Page) => page.getByRole("complementary", { name: "Item panel" });

/** Console errors and uncaught page errors, collected for the whole test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Open the calendar on `start` (stored the way the page stores it) and wait for the week's items. */
async function openCalendar(page: Page, start: (typeof VIEWS)[number]) {
  await page.addInitScript((v) => { if (!sessionStorage.getItem("e2e-view-set")) { localStorage.setItem("niy-calendar-view", v); sessionStorage.setItem("e2e-view-set", "1"); } }, start);
  const loaded = page.waitForResponse((r) => r.url().includes("/vault/items?from="));
  await page.goto("/");
  expect((await loaded).ok()).toBeTruthy();
  await expect(view(page)).toHaveAttribute("data-cal-view", start, { timeout: 30_000 });
}

const noPageScrollX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("calendar: every view renders, with no console errors and no sideways page scroll", async ({ page }) => {
  const errors = watchErrors(page);
  await openCalendar(page, "day-grid");
  const expectations: Record<(typeof VIEWS)[number], string> = {
    "day-grid": `[data-allday-strip="${today}"]`,
    "day-agenda": `[data-allday-strip="${today}"]`,
    "day-ribbon": `[data-allday-strip="${today}"]`,
    "day-ring": "svg[aria-label^='24-hour ring']",
    "week-grid": `[data-grid-day="${today}"]`,
    "week-agenda": `[data-agenda-day="${today}"]`,
    "week-strips": `[data-strip-day="${today}"]`,
    "week-blocks": "table",
  };
  for (const v of VIEWS) {
    await pickView(page, v);
    await expect(view(page)).toHaveAttribute("data-cal-view", v);
    await expect(view(page).locator(expectations[v]).first()).toBeVisible();
    expect(await noPageScrollX(page), `${v}: page scrolls sideways`).toBeLessThanOrEqual(0);
  }
  // Today's daily standup shows in the views that write titles out.
  for (const v of ["day-grid", "day-agenda", "week-agenda"] as const) {
    await pickView(page, v);
    await expect(view(page).locator('[data-cal-item^="e:"]').filter({ hasText: "Daily standup" }).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("calendar: V cycles through all eight views and back, Shift+V goes back, typing a v does not", async ({ page }) => {
  await openCalendar(page, "day-grid");
  const seen: string[] = [];
  for (let n = 0; n < VIEWS.length; n++) {
    await page.keyboard.press("v");
    seen.push((await view(page).getAttribute("data-cal-view")) as string);
  }
  expect(seen).toEqual([...VIEWS.slice(1), VIEWS[0]]);
  await page.keyboard.press("Shift+V");
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-blocks");
  await page.keyboard.press("Shift+V");
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-strips");
  await page.locator("#quick-add-title").fill("v");
  await page.locator("#quick-add-title").press("v");
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-strips");
  await page.locator("#quick-add-title").fill("");
});

test("calendar: a reload keeps the chosen view, ring variant and colour mode", async ({ page }) => {
  await openCalendar(page, "day-grid");
  await pickView(page, "day-ring");
  await menu(page);
  await page.getByRole("button", { name: "Ring lanes: Lane per calendar" }).click();
  await page.getByRole("group", { name: "Block colours" }).getByRole("button", { name: "Alternate" }).click();
  await page.reload();
  await expect(view(page)).toHaveAttribute("data-cal-view", "day-ring", { timeout: 30_000 });
  await menu(page);
  await expect(page.getByRole("button", { name: "Ring lanes: Lane per calendar" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Block colours" }).getByRole("button", { name: "Alternate" })).toHaveAttribute("aria-pressed", "true");
  // A week style is for the session: after a reload the week opens as Grid.
  await pickView(page, "week-strips");
  await page.reload();
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-grid", { timeout: 30_000 });
});

test("calendar: clicking an item in a day view and in a week view opens its details card", async ({ page }) => {
  await openCalendar(page, "day-grid");
  await view(page).locator('[data-cal-item^="e:"]').filter({ hasText: "Daily standup" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(card(page)).toHaveAttribute("data-kind", "event");
  await expect(card(page).getByRole("heading", { name: "Daily standup" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  await pickView(page, "week-agenda");
  await view(page).locator(`[data-agenda-day="${today}"] [data-cal-item^="t:"]`).filter({ hasText: "Write report" }).getByRole("button", { name: /^Details: Write report/ }).click();
  await expect(card(page)).toHaveAttribute("data-kind", "task");
  await expect(card(page).getByRole("textbox", { name: "Title" })).toHaveValue("Write report");
  // The ring's lanes open the card too (keyboard: Enter on the item).
  await pickView(page, "day-ring");
  await view(page).locator('svg [data-cal-item^="e:"] [role="button"]').first().focus();
  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveAttribute("data-kind", "event");
  // In the week grid (the Overview's WeekCalendar) the card opens in the same panel, not above the grid.
  await page.keyboard.press("Escape");
  await pickView(page, "week-grid");
  await grid(page, today).getByText("Daily standup").click();
  await expect(panel(page).getByRole("region", { name: "Item details" })).toBeVisible();
  await expect(card(page)).toHaveCount(1);
});

test("calendar: all-day items sit in the All day strip, timed ones do not; ticking one marks it done", async ({ page }) => {
  await openCalendar(page, "day-grid");
  const strip = page.locator(`[data-allday-strip="${today}"]`);
  await expect(strip.locator('[data-cal-item^="t:"]').filter({ hasText: "Call bank" })).toBeVisible();
  await expect(strip.locator('[data-cal-item^="t:"]').filter({ hasText: "Buy milk" })).toHaveAttribute("data-state", "done");
  await expect(strip.locator("[data-cal-item]").filter({ hasText: "Write report" })).toHaveCount(0);
  await expect(strip.locator("[data-cal-item]").filter({ hasText: "Daily standup" })).toHaveCount(0);
  const call = strip.locator('[data-cal-item^="t:"]').filter({ hasText: "Call bank" });
  const ticked = page.waitForResponse((r) => r.url().includes("/vault/items/") && r.request().method() === "PATCH");
  await call.getByRole("button", { name: "Done: Call bank" }).click();
  expect((await ticked).ok()).toBeTruthy();
  await expect(call).toHaveAttribute("data-state", "done");
  await call.getByRole("button", { name: "Not done: Call bank" }).click();
  await expect(call).toHaveAttribute("data-state", "open");
  await pickView(page, "day-agenda");
  await expect(page.locator(`[data-allday-strip="${today}"]`).getByText("Call bank")).toBeVisible();
});

test("calendar: a tag filter dims items without the tag, in day views and the week grid", async ({ page }) => {
  await openCalendar(page, "day-agenda");
  await menu(page);
  await page.locator('[data-tag-filter="errand"]').click();
  const milk = view(page).locator('[data-cal-item^="t:"]').filter({ hasText: "Buy milk" }).first();
  const standup = view(page).locator('[data-cal-item^="e:"]').filter({ hasText: "Daily standup" }).first();
  await expect(milk).not.toHaveAttribute("data-dimmed", "true");
  await expect(standup).toHaveAttribute("data-dimmed", "true");
  expect(Number(await standup.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.5);
  expect(Number(await milk.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.5);
  await pickView(page, "week-grid");
  await expect(grid(page, today).locator('[data-item^="e:"]').filter({ hasText: "Daily standup" })).toHaveAttribute("data-dimmed", "true");
  await pickView(page, "day-ring");
  await expect(view(page).locator('svg [data-cal-item^="e:"]').first()).toHaveAttribute("data-dimmed", "true");
  await menu(page);
  await page.getByRole("group", { name: "Filter by tag" }).getByRole("button", { name: "All", exact: true }).click();
  await expect(view(page).locator('[data-dimmed="true"]')).toHaveCount(0);
});

test("calendar: screenshots of every view, light and dark", async ({ page }) => {
  await openCalendar(page, "day-grid");
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    for (const v of VIEWS) {
      await pickView(page, v);
      await expect(view(page)).toHaveAttribute("data-cal-view", v);
      await page.screenshot({ path: `${OUT}/calendar-${v}-${theme}.png`, fullPage: true });
    }
  }
  // A picked item with its side panel, and the phone layout with the bottom sheet.
  await pickView(page, "day-grid");
  await view(page).locator('[data-cal-item^="e:"]').filter({ hasText: "Daily standup" }).click();
  await page.screenshot({ path: `${OUT}/calendar-day-grid-panel-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page)).toBeVisible();
  expect(await noPageScrollX(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${OUT}/calendar-phone-sheet-dark.png` });
});

/* ---------- one view: "/" is the only calendar page ---------- */

const todayDay = day3(today);

test("/calendar redirects to / and the stored view still applies", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("niy-calendar-view", "day-agenda"));
  await page.goto("/calendar");
  await expect(view(page)).toHaveAttribute("data-cal-view", "day-agenda", { timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/");
  // The old nav entry is gone; the home page is the calendar.
  await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Calendar" })).toHaveCount(0);
});

test("bar: in the 44px app header at 1440x900, one row even with a long line typed; ‹ › and Today move the range", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOverview(page);
  await expect(page.locator("header [data-cal-bar]")).toHaveAttribute("data-cal-bar", "header");
  expect((await page.locator("header").first().boundingBox())!.height).toBe(44);
  const box0 = await bar(page).boundingBox();
  expect(box0!.height).toBeLessThanOrEqual(44);
  await page.locator("#quick-add-title").fill("Plan the quarterly review tomorrow 14:00-15:30 #work @studio");
  await expect(page.locator("#quick-add-preview")).toBeVisible();
  const box = await bar(page).boundingBox();
  expect(box!.height, "bar height with text typed").toBeLessThanOrEqual(44);
  // The preview floats under the input, above the calendar's sticky head.
  const pv = (await page.locator("#quick-add-preview").boundingBox())!;
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("#quick-add-preview"), [pv.x + 4, pv.y + pv.height / 2])).toBe(true);
  await page.screenshot({ path: `${OUT}/home-1440-typing.png`, fullPage: true });
  await page.locator("#quick-add-title").fill("");
  // Range, next / previous, Today.
  const range = bar(page).locator("[data-cal-range]");
  const first = (await range.textContent()) as string;
  await bar(page).getByRole("button", { name: "Next week" }).click();
  await expect(range).not.toHaveText(first);
  await expect(bar(page).getByRole("button", { name: "Today", exact: true })).toBeVisible();
  await page.keyboard.press("t");
  await expect(range).toHaveText(first);
  await expect(bar(page).getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/home-1440.png`, fullPage: true });
});

test("bar: Day | Week, week headers open the day in the last day style, display and tag menus", async ({ page }) => {
  await openOverview(page);
  const range = bar(page).locator("[data-cal-range]");
  // A week header opens that day (day grid is the default day style).
  await page.locator(`[data-open-day="${other}"]`).click();
  await expect(view(page)).toHaveAttribute("data-cal-view", "day-grid");
  await expect(range).toHaveText(day3(other));
  // Week brings back the last week style; the headers of the agenda and strips open a day in the last day style too.
  await pickView(page, "day-agenda");
  await bar(page).getByRole("group", { name: "Scope" }).getByRole("button", { name: "Week", exact: true }).click();
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-grid");
  await pickView(page, "week-agenda");
  await page.locator(`[data-open-day="${today}"]`).click();
  await expect(view(page)).toHaveAttribute("data-cal-view", "day-agenda");
  await expect(range).toHaveText(todayDay);
  await pickView(page, "week-strips");
  await page.locator(`[data-open-day="${other}"]`).click();
  await expect(view(page)).toHaveAttribute("data-cal-view", "day-agenda");

  // Display menu: week grid has the done count; a ring view has ring lanes and block colours.
  await pickView(page, "week-grid");
  await menu(page);
  const done = page.getByRole("button", { name: /^Show done \d+$/ });
  await expect(done).toHaveAttribute("aria-pressed", "false");
  await done.click();
  await expect(done).toHaveAttribute("aria-pressed", "true");
  await done.click();
  await expect(page.getByRole("group", { name: "Block colours" })).toHaveCount(0);
  await pickView(page, "day-ring");
  await menu(page);
  await expect(page.getByRole("group", { name: "Ring lanes" }).getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("group", { name: "Block colours" }).getByRole("button")).toHaveCount(3);
  await page.keyboard.press("Escape");

  // Tag menu: shown (there are tags this week), picking a tag shows it on the button, All clears it.
  await menu(page);
  await page.locator('[data-tag-filter="errand"]').click();
  await expect(bar(page).getByRole("button", { name: /^View options: .*tag #errand/ })).toBeVisible();
  await page.getByRole("group", { name: "Filter by tag" }).getByRole("button", { name: "All", exact: true }).click();
  await expect(bar(page).getByRole("button", { name: /^View options/ })).not.toHaveAccessibleName(/tag #/);
});

test("rail: Ctrl+B and the sidebar button hide and show it; mode and stars sit under the clock, in the bar while it is hidden; a goal item ticks", async ({ page }) => {
  await openOverview(page);
  const rail = page.getByRole("region", { name: "This week" });
  await expect(rail).toBeVisible();
  // A vote makes today's note, which carries the mode and the stars.
  const voted = page.waitForResponse((r) => r.url().includes("/vault/") && r.request().method() !== "GET");
  await page.getByRole("group", { name: "Soul vote" }).getByRole("button", { name: "Soul 1 star" }).click();
  await voted;
  const facts = page.getByRole("group", { name: "Today" });
  await expect(facts).toHaveCount(1);
  await expect(facts.getByRole("progressbar", { name: "Stars today" })).toBeVisible();
  await expect(bar(page).getByRole("group", { name: "Today" })).toHaveCount(0);
  await page.keyboard.press("Control+b");
  await expect(rail).toBeHidden();
  await expect(bar(page).getByRole("group", { name: "Today" }).getByRole("button", { name: /^Day mode/ })).toBeVisible();
  await expect(bar(page).getByRole("progressbar", { name: "Stars today" })).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Show the sidebar" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Show the sidebar" }).click();
  await expect(rail).toBeVisible();
  await expect(bar(page).getByRole("group", { name: "Today" })).toHaveCount(0);
  await page.getByRole("group", { name: "Soul vote" }).getByRole("button", { name: "Soul 1 star" }).click(); // undo the vote
  // Goals section of the rail: open a goal with a checklist and tick a line.
  await rail.getByRole("button", { name: /Zero debt/ }).click();
  const line = rail.getByRole("checkbox", { name: /Pay the card/ });
  await expect(line).not.toBeChecked();
  const ticked = page.waitForResponse((r) => r.url().includes("/vault/goals") && r.request().method() !== "GET");
  await line.click();
  expect((await ticked).ok()).toBeTruthy();
  await expect(line).toBeChecked();
});

test("?calendar=connected shows a note once and leaves the URL", async ({ page }) => {
  await page.goto("/?calendar=connected");
  await expect(page.getByRole("status").filter({ hasText: "Google Calendar connected." })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("quick add: the preview says where each line lands (parser table)", async ({ page }) => {
  await openOverview(page);
  const input = page.locator("#quick-add-title");
  const preview = page.locator("#quick-add-preview");
  const tomorrow = plus(today, 1);
  const sunday = plus(today, -dow); // the shown week's Sunday
  const table: [string, string][] = [
    ["Buy milk", `→ ${todayDay} · all day`],
    ["Buy milk today", `→ ${todayDay} · all day`],
    ["Buy milk tomorrow", `→ ${day3(tomorrow)} · all day`],
    [`Buy milk ${wordOf(other)}`, `→ ${day3(other)} · all day`],
    ["Buy milk sunday", `→ ${day3(sunday)} · all day`],
    ["Call 14:00", `→ ${todayDay} · 14:00–14:30`],
    ["Call 14:00-15:30", `→ ${todayDay} · 14:00–15:30`],
    ["Call 14:00 45m", `→ ${todayDay} · 14:00–14:45`],
    ["Call 14:00 1h", `→ ${todayDay} · 14:00–15:00`],
    ["Plan #work", `→ ${todayDay} · all day · #work`],
    ["Plan #oct", `→ ${todayDay} · all day`],
    [`Plan ${wordOf(other)} @studio`, `→ ${day3(other)} · all day · @studio`],
    [`Plan ${wordOf(other)} @nope`, `→ ${day3(other)} · all day`],
    ["Plan @studio", `→ ${todayDay} · all day`],
    ["Standup tomorrow 09:30-10:00 #work @studio", `→ ${day3(tomorrow)} · 09:30–10:00 · #work · @studio`],
    ["Call bank 18:00-17:00", `→ ${todayDay} · all day · time not understood, added as all day`],
  ];
  expect(table.length).toBeGreaterThanOrEqual(13);
  for (const [line, expected] of table) {
    await input.fill(line);
    await expect(preview, line).toHaveText(expected);
  }
  // No title (only a day word): rejected.
  await input.fill("fri");
  await expect(preview).toContainText("Type a title");
  await expect(page.getByRole("button", { name: "Add item" })).toBeDisabled();
  await input.fill("");
});

test("quick add: a line with a day, time, tag and @stream creates one item with those fields", async ({ page }) => {
  await openOverview(page);
  await page.locator("#quick-add-title").fill(`Stream check ${wordOf(other)} 10:00-11:00 #errand @studio`);
  const made = page.waitForResponse((r) => r.url().endsWith("/vault/items") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Add item" }).click();
  const res = await made;
  expect(res.status()).toBe(201);
  const item = await res.json();
  expect(item).toMatchObject({ day: other, start_min: 600, end_min: 660, stream: "studio", products: ["errand"], title: "Stream check" });
  await expect(grid(page, other).locator('[data-item^="t:"]').filter({ hasText: "Stream check" })).toBeVisible();
});

test("quick add: Put in Google Calendar shows for timed lines when connected and makes exactly one entry in each mode", async ({ page }) => {
  let events = 0;
  let items = 0;
  await page.route("**/vault/calendar/google/status", (r) => r.fulfill({ json: { configured: true, connected: true, email: "e2e@example.com" } }));
  await page.route("**/vault/day/*/events", (r) => {
    if (r.request().method() !== "POST") return r.continue();
    events += 1;
    return r.fulfill({ status: 201, json: { title: "G", calendar: "Google", color: null, all_day: false, location: null } });
  });
  page.on("request", (rq) => { if (rq.method() === "POST" && rq.url().endsWith("/vault/items")) items += 1; });
  await openOverview(page);
  const input = page.locator("#quick-add-title");
  const toggle = page.getByRole("button", { name: "Put in Google Calendar" });
  await input.fill("Gcheck");
  await expect(toggle).toHaveCount(0); // untimed
  await input.fill("Gcheck 11:00-12:00");
  await expect(toggle).toBeVisible();
  // Off: a Niyyah item, no Google event.
  const made = page.waitForResponse((r) => r.url().endsWith("/vault/items") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Add item" }).click();
  await made;
  expect({ events, items }).toEqual({ events: 0, items: 1 });
  // On: a Google event, no Niyyah item.
  await input.fill("Gcheck 13:00-14:00");
  await toggle.click();
  await expect(page.locator("#quick-add-preview")).toContainText("Google Calendar");
  const posted = page.waitForResponse((r) => /\/vault\/day\/[^/]+\/events$/.test(r.url()) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Add item" }).click();
  await posted;
  expect({ events, items }).toEqual({ events: 1, items: 1 });
});

test("Google event: Join, Mark important and Delete Google event are in the item panel", async ({ page }) => {
  const deleted: string[] = [];
  await page.route(/\/vault\/items\?from=/, async (r) => {
    const res = await r.fetch();
    const body = await res.json();
    for (const i of body.items) if (i.title === "Daily standup") i.event_id = "gev-1";
    await r.fulfill({ response: res, json: body });
  });
  await page.route(/\/vault\/events\/[^/]+$/, (r) => {
    if (r.request().method() !== "DELETE") return r.continue();
    deleted.push(decodeURIComponent(new URL(r.request().url()).pathname.split("/").pop()!));
    return r.fulfill({ json: { ok: true } });
  });
  await openOverview(page);
  await grid(page, today).getByText("Daily standup").click();
  const c = panel(page).getByRole("region", { name: "Item details" });
  await expect(c.getByRole("link", { name: /^Join/ })).toBeVisible(); // the fixture event has a Meet link
  await c.getByRole("button", { name: "Mark important" }).click();
  await expect(c.getByRole("button", { name: "Important" })).toHaveAttribute("aria-pressed", "true");
  await c.getByRole("button", { name: "Important" }).click();
  await c.getByRole("button", { name: "Delete Google event" }).click();
  expect(deleted).toEqual([]); // asks first
  await c.getByRole("button", { name: "Confirm delete" }).click();
  await expect.poll(() => deleted).toEqual(["gev-1"]);
  await expect(panel(page)).toHaveCount(0);
});

test("calendar problems: a chip with the count, the text on click, and Reconnect when consent expired", async ({ page }) => {
  await page.route(/\/vault\/items\?from=/, async (r) => {
    const res = await r.fetch();
    const body = await res.json();
    body.errors = ["Work calendar: access expired. Reconnect Google Calendar."];
    await r.fulfill({ response: res, json: body });
  });
  let connect = 0;
  await page.route("**/vault/calendar/google/connect", (r) => { connect += 1; return r.fulfill({ json: { url: "/?reconnected=1" } }); });
  await openOverview(page);
  const chip = bar(page).getByRole("button", { name: /Calendar: 1 problem/ });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole("alert").filter({ hasText: "access expired" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(() => connect).toBe(1);
});

test("public home page without a login: ring and now card, no calendar bar", async ({ browser, request }) => {
  // The run's API stores in the database, where the schedule needs a session; the public page is the vault mode's. So the two
  // public reads are answered with the owner's own schedule and block config, and everything else stays logged out (401).
  const headers = { Authorization: `Bearer ${tokens!.access_token}` };
  const schedule = await (await request.get(`${API}/api/v1/vault/schedule`, { headers })).json();
  const blocks = await (await request.get(`${API}/api/v1/vault/config/blocks`, { headers })).json();
  const ctx = await browser.newContext({ baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3017", timezoneId: "Asia/Dhaka", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route(/\/vault\/schedule$/, (r) => r.fulfill({ json: schedule }));
  await page.route(/\/vault\/config\/blocks$/, (r) => r.fulfill({ json: blocks }));
  await page.goto("/");
  await expect(page.getByRole("group", { name: "24-hour routine ring" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Now" })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("grid", { name: "Week schedule" })).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/home-public-1440.png`, fullPage: true });
  await ctx.close();
});

test("phone 390px: no sideways scroll, the bar wraps, quick add preview sits under the input", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("niy-calendar-view", "week-grid")); // the phone default is the day grid
  await openOverview(page);
  expect(await noPageScrollX(page)).toBeLessThanOrEqual(0);
  await page.locator("#quick-add-title").fill("Phone check tomorrow 14:00-15:00 #work");
  await expect(page.locator("#quick-add-preview")).toBeVisible();
  expect(await noPageScrollX(page)).toBeLessThanOrEqual(0);
  const box = await bar(page).boundingBox();
  expect(box!.height).toBeGreaterThan(56); // wraps to more than one row
  await page.screenshot({ path: `${OUT}/home-390.png`, fullPage: true });
  await page.locator("#quick-add-title").fill("");
  await menu(page);
  await page.screenshot({ path: `${OUT}/home-390-style-menu.png` });
  expect(await noPageScrollX(page)).toBeLessThanOrEqual(0);
});

test("first open with no stored view: day grid on a phone, week grid on a desktop; a stored choice wins", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(view(page)).toHaveAttribute("data-cal-view", "day-grid", { timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem("niy-calendar-view"))).toBeNull(); // the default is not stored
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-grid", { timeout: 30_000 });
  // A stored choice wins on a phone, and a pick on a phone sticks.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("niy-calendar-view", "day-ribbon"));
  await page.reload();
  await expect(view(page)).toHaveAttribute("data-cal-view", "day-ribbon", { timeout: 30_000 });
  // A stored week style is not reopened: the week opens as Grid.
  await page.evaluate(() => localStorage.setItem("niy-calendar-view", "week-agenda"));
  await page.reload();
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-grid", { timeout: 30_000 });
  await page.evaluate(() => localStorage.removeItem("niy-calendar-view"));
  await page.reload();
  await expect(view(page)).toHaveAttribute("data-cal-view", "day-grid", { timeout: 30_000 });
  await pickView(page, "day-agenda");
  await page.reload();
  await expect(view(page)).toHaveAttribute("data-cal-view", "day-agenda", { timeout: 30_000 });
});

// ---- One bar (Overview variant B): the bar in the header, the all-day row as counts, the calendar status. ----

test("one bar: the bar sits in the header from 1280px and above the calendar below it; the grid refits when it moves", async ({ page }) => {
  await page.setViewportSize({ width: 1279, height: 800 });
  await openOverview(page);
  await expect(bar(page)).toHaveAttribute("data-cal-bar", "page");
  await expect(page.locator("header [data-cal-bar]")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("header [data-cal-bar]")).toHaveAttribute("data-cal-bar", "header");
  expect((await bar(page).boundingBox())!.height, "one row in the header at 1280").toBeLessThanOrEqual(44);
  expect(await noPageScrollX(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${OUT}/home-1280.png` });
  // Grid fills the window under the header (bottom gap 16px; whole-pixel hours leave up to one pixel per hour), at 1440x900 too.
  // A fit left from the page placement would end about one bar height (~45px) short.
  await page.setViewportSize({ width: 1440, height: 900 });
  const scroller = page.getByRole("grid", { name: "Week schedule" });
  await expect.poll(async () => Math.round((await scroller.boundingBox())!.y + (await scroller.boundingBox())!.height)).toBeGreaterThanOrEqual(900 - 16 - 26);
  expect(Math.round((await scroller.boundingBox())!.y + (await scroller.boundingBox())!.height)).toBeLessThanOrEqual(900);
  // The all-day row is one 28px row however many items a day has.
  expect(Math.round((await allDay(page, today).boundingBox())!.height)).toBe(28);
});

test("one bar: menus opened from the header paint above the calendar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOverview(page);
  await menu(page);
  const group = page.getByRole("group", { name: "View options" });
  await expect(group).toBeVisible();
  const g = (await group.boundingBox())!;
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role="group"][aria-label="View options"]'), [g.x + g.width / 2, g.y + g.height - 6])).toBe(true);
  await page.keyboard.press("Escape");
  await expect(group).toHaveCount(0);
});

test("one bar: a day with several all-day items shows a count; its list opens on top, inside the window, and closes on Esc", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOverview(page);
  for (const t of ["Lane one", "Lane two"]) await quickAdd(page, `${t} sat #lane`);
  const sat = (await page.locator("[data-allday][data-day]").last().getAttribute("data-day"))!;
  const count = page.locator(`[data-allday-count="${sat}"]`);
  await expect(count).toHaveAccessibleName(/: 2 tasks/);
  await expect(allDayTask(page, sat, "Lane one")).toBeHidden(); // in the DOM, list closed
  await count.click();
  const list = page.locator(`[data-allday-list="${sat}"]`);
  await expect(list).toBeVisible();
  const box = (await list.boundingBox())!;
  expect(box.x + box.width, "the last day's list stays inside the window").toBeLessThanOrEqual(1440);
  expect(await noPageScrollX(page)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-allday-list]"), [box.x + box.width / 2, box.y + 10])).toBe(true);
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  // Drag one out of the list onto the grid: it becomes timed, the drag state resets and the list is closed.
  await count.click();
  const patched = page.waitForResponse((r) => r.url().includes("/vault/items/") && r.request().method() === "PATCH");
  await allDayTask(page, sat, "Lane two").dragTo(grid(page, sat), { targetPosition: { x: 20, y: 200 } });
  await patched;
  await expect(grid(page, sat).locator('[data-item^="t:"]').filter({ hasText: "Lane two" })).toBeVisible();
  await expect(list).toBeHidden();
  // One item left: it shows in the cell itself, and the day still has an add button.
  await expect(count).toHaveCount(0);
  await expect(allDayTask(page, sat, "Lane one")).toBeVisible();
  await allDay(page, sat).getByRole("button", { name: /^Add a task on / }).click();
  const made = page.waitForResponse((r) => r.url().endsWith("/vault/items") && r.request().method() === "POST");
  await page.getByRole("textbox", { name: `New task for ${sat}` }).fill("Lane three");
  await page.getByRole("textbox", { name: `New task for ${sat}` }).press("Enter");
  expect((await made).status()).toBe(201);
  await expect(count).toHaveAccessibleName(/: 2 tasks/);
});

test("one bar: the calendar status says not set up or not connected (amber), and nothing when connected", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let status = { configured: false, connected: false, email: null as string | null };
  await page.route("**/vault/calendar/google/status", (r) => r.fulfill({ json: status }));
  await openOverview(page);
  const notSetUp = bar(page).getByRole("button", { name: "Calendar: not set up" });
  await expect(notSetUp).toBeVisible();
  await notSetUp.click();
  await expect(page.getByRole("group", { name: "Calendar" })).toContainText("not set up on the server");
  await expect(page.getByText("Google Calendar is not set up on the server yet.")).toHaveCount(1); // only in the popover, no footer line
  status = { configured: true, connected: false, email: null };
  await page.reload();
  const notConnected = bar(page).getByRole("button", { name: "Calendar: not connected" });
  await expect(notConnected).toBeVisible({ timeout: 30_000 });
  await notConnected.click();
  await expect(page.getByRole("group", { name: "Calendar" }).getByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
  status = { configured: true, connected: true, email: "me@example.com" };
  await page.reload();
  await expect(grid(page, today).getByText("Daily standup")).toBeVisible({ timeout: 30_000 });
  await expect(bar(page).getByRole("button", { name: /^Calendar/ })).toHaveCount(0);
});
