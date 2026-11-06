import { expect, test, type Page } from "@playwright/test";

/**
 * Overview week polish against a seeded dev API (run.sh): the range label in the nav's type, the ring's day preview,
 * the week views (no Rings, Grid by default) and the week grid's prayer markers and block bands.
 * Tests run in file order (one worker) and a failure does not skip the rest. Runs after items.spec.ts (same database); it sets its own schedule and puts the seeded one back at the end.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const OUT = "e2e/out";
/** Screenshot name prefix: "before" on the commit that started this work, "after" on the result. */
const TAG = process.env.SHOT_TAG ?? "after";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const sunday = plus(today, -dow(today));
const WEEK = Array.from({ length: 7 }, (_, i) => plus(sunday, i));
/** Fri and Sat are the weekend (the seeded schedule's weekend_days). */
const isWeekend = (iso: string) => dow(iso) === 5 || dow(iso) === 6;

let tokens: { access_token: string; refresh_token: string } | null = null;
test.beforeEach(async ({ page, request }) => {
  if (!tokens) {
    const res = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    tokens = await res.json();
  }
  await page.addInitScript((t) => { localStorage.setItem("access_token", t.access_token); localStorage.setItem("refresh_token", t.refresh_token); }, tokens!);
});

const bar = (page: Page) => page.locator("[data-cal-bar]");
const view = (page: Page) => page.locator("[data-cal-view]");

async function openOverview(page: Page, path = "/") {
  await page.goto(path);
  await expect(view(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`[data-grid-day="${today}"]`).or(page.locator("[data-cal-view]:not([data-cal-view='week-grid'])")).first()).toBeVisible({ timeout: 30_000 });
}

test("screenshots: the Overview week grid and top bar (paper light and dark, admin)", async ({ page }) => {
  await openOverview(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/overview-week-${TAG}-paper-light.png`, fullPage: true });
  await bar(page).screenshot({ path: `${OUT}/overview-topbar-${TAG}-paper.png` });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: `${OUT}/overview-week-${TAG}-paper-dark.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await openOverview(page, "/?skin=admin");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/overview-week-${TAG}-admin.png`, fullPage: true });
  await bar(page).screenshot({ path: `${OUT}/overview-topbar-${TAG}-admin.png` });
});

/* ---------- the schedule these tests use: prayer-anchored, with a night that crosses midnight ---------- */

type Row = { block: string; start: string; end: string; what: string; stream: null };
const row = (block: string, start: string, end: string): Row => ({ block, start, end, what: block, stream: null });
const META = { city: "Dhaka", lat: 23.8, lon: 90.4, tz: "Asia/Dhaka", method: "ISNA", madhab: "hanafi", weekend_days: ["fri", "sat"] };
/** Weekday and weekend differ: the evening block, the morning block and where the night ends (fajr-60 against fajr-90). */
const ROUTINE = {
  meta: META,
  weekday: [row("soul", "fajr-60", "fajr"), row("ot", "fajr", "asr"), row("body", "asr", "maghrib"), row("distribution", "maghrib", "isha"), row("sleep", "isha", "fajr-60")],
  weekend: [row("soul", "fajr-90", "fajr"), row("planning", "fajr", "asr"), row("body", "asr", "maghrib"), row("fnf", "maghrib", "isha"), row("sleep", "isha", "fajr-90")],
};
let seeded: unknown = null;
const auth = () => ({ Authorization: `Bearer ${tokens!.access_token}` });

test("set the schedule these tests read", async ({ request }) => {
  const before = await request.get(`${API}/api/v1/vault/schedule`, { headers: auth() });
  expect(before.ok()).toBeTruthy();
  const s = await before.json();
  seeded = { meta: s.meta, weekday: s.days.weekday, weekend: s.days.weekend };
  const res = await request.put(`${API}/api/v1/vault/config/schedule`, { headers: auth(), data: ROUTINE });
  expect(res.ok(), await res.text()).toBeTruthy();
});

/* ---------- 1. the range label is set in the nav's type ---------- */

for (const skin of ["paper", "admin"]) {
  test(`range label uses the nav's type (${skin})`, async ({ page }) => {
    await openOverview(page, `/?skin=${skin}`);
    const style = (sel: string) => page.locator(sel).first().evaluate((el) => { const c = getComputedStyle(el); return { family: c.fontFamily, upper: c.textTransform, weight: c.fontWeight, spacing: parseFloat(c.letterSpacing) / parseFloat(c.fontSize), color: c.color, size: parseFloat(c.fontSize) }; });
    const nav = await style('a[aria-keyshortcuts^="g "]');
    const range = await style("[data-cal-range]");
    expect(range.family).toBe(nav.family);
    expect(range.upper).toBe("uppercase");
    expect(range.spacing).toBeCloseTo(nav.spacing, 2); // tracking in em, the same as the nav's
    expect(Number(range.weight)).toBeGreaterThanOrEqual(600);
    const size = await page.locator("[data-cal-range]").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(12);
    expect(size).toBeLessThanOrEqual(13);
    await expect(page.locator("[data-cal-range]")).toHaveAttribute("aria-label", /\d{4}$/);
  });
}

/* ---------- 3. 4. week views: no Rings, Grid by default ---------- */

async function openWith(page: Page, stored: string | null) {
  if (stored) await page.addInitScript((v) => { if (!sessionStorage.getItem("ow-set")) { localStorage.setItem("niy-calendar-view", v); sessionStorage.setItem("ow-set", "1"); } }, stored);
  await page.goto("/");
  await expect(view(page)).toBeVisible({ timeout: 30_000 });
}
const style = (page: Page) => bar(page).getByRole("button", { name: /^View options/ });

test("the week styles have no Rings; V skips it", async ({ page }) => {
  await openWith(page, "week-grid");
  await style(page).click();
  const ids = await page.locator("[data-view-button^='week-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-view-button")));
  expect(ids).toEqual(["week-grid", "week-agenda", "week-strips", "week-blocks"]);
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 600 } });
  const seen: string[] = [];
  for (let n = 0; n < 8; n++) { await page.keyboard.press("v"); seen.push((await view(page).getAttribute("data-cal-view")) as string); }
  expect(seen).not.toContain("week-rings");
  expect(seen).toEqual(["week-agenda", "week-strips", "week-blocks", "day-grid", "day-agenda", "day-ribbon", "day-ring", "week-grid"]);
});

test("a fresh visit opens the week as Grid", async ({ page }) => {
  await openWith(page, null);
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-grid");
});

for (const stored of ["week-rings", "week-agenda", "week-strips", "week-blocks", "not-a-view"]) {
  test(`a stored ${stored} opens the week as Grid`, async ({ page }) => {
    await openWith(page, stored);
    await expect(view(page)).toHaveAttribute("data-cal-view", "week-grid");
  });
}

test("a stored day style is kept; Week always opens Grid, other week styles stay for the session", async ({ page }) => {
  await openWith(page, "day-ring");
  await expect(view(page)).toHaveAttribute("data-cal-view", "day-ring");
  await bar(page).getByRole("group", { name: "Scope" }).getByRole("button", { name: "Week", exact: true }).click();
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-grid");
  await style(page).click();
  await page.locator('[data-view-button="week-agenda"]').click();
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-agenda");
  await bar(page).getByRole("group", { name: "Scope" }).getByRole("button", { name: "Day", exact: true }).click();
  await bar(page).getByRole("group", { name: "Scope" }).getByRole("button", { name: "Week", exact: true }).click();
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-grid");
});

/* ---------- 5. the week grid: prayer markers and block bands ---------- */

const col = (page: Page, day: string) => page.locator(`[data-grid-day="${day}"]`);
const minOf = async (page: Page, day: string, prayer: string) => Number(await col(page, day).locator(`[data-prayer="${prayer}"]`).getAttribute("data-min"));

test("week grid: five prayer markers a day, at that date's own times", async ({ page }) => {
  await openOverview(page);
  for (const day of WEEK) {
    await expect(col(page, day).locator("[data-prayer]")).toHaveCount(5);
    const names = await col(page, day).locator("[data-prayer]").evaluateAll((els) => els.map((e) => e.getAttribute("data-prayer")));
    expect(names).toEqual(["fajr", "dhuhr", "asr", "maghrib", "isha"]);
  }
  const fajr = await Promise.all(WEEK.map((d) => minOf(page, d, "fajr")));
  expect(new Set(fajr).size).toBeGreaterThan(1);
  // a marker is labelled with its initial and its time
  await expect(col(page, today).locator('[data-prayer="asr"]')).toHaveAttribute("title", /^Asr \d\d:\d\d$/);
  await expect(col(page, today).locator('[data-prayer="asr"]')).toContainText("A");
});

test("week grid: block bands follow the weekday and weekend templates, overnight ends in the morning", async ({ page }) => {
  await openOverview(page);
  for (const day of WEEK) {
    const bands = col(page, day).locator("[data-band]");
    await expect(bands).toHaveCount(6); // five rows of the day, plus the night carried in from the evening before
    const keys = await bands.evaluateAll((els) => els.map((e) => e.getAttribute("data-band")));
    if (isWeekend(day)) { expect(keys).toContain("fnf"); expect(keys).toContain("planning"); expect(keys).not.toContain("ot"); }
    else { expect(keys).toContain("distribution"); expect(keys).toContain("ot"); expect(keys).not.toContain("fnf"); }
    // the morning band: the night of the evening before, ended by this date's fajr with the row of that evening's template
    const morning = col(page, day).locator('[data-band="sleep"][data-band-from="0"]');
    await expect(morning).toHaveCount(1);
    const prevWeekend = isWeekend(plus(day, -1));
    expect(Number(await morning.getAttribute("data-band-to"))).toBe((await minOf(page, day, "fajr")) - (prevWeekend ? 90 : 60));
    // the evening band runs from isha to the end of the day
    const evening = col(page, day).locator('[data-band="sleep"]:not([data-band-from="0"])');
    expect(Number(await evening.getAttribute("data-band-from"))).toBe(await minOf(page, day, "isha"));
    expect(Number(await evening.getAttribute("data-band-to"))).toBe(1440);
  }
});

test("week grid: bands and prayer lines sit under the items and never take a click", async ({ page }) => {
  await openOverview(page);
  await col(page, today).getByText("Daily standup").click();
  await expect(page.getByRole("region", { name: "Item details" })).toBeVisible();
  for (const sel of ["[data-band]", "[data-prayer]", "[data-prayer] > span"]) {
    const all = await col(page, today).locator(sel).evaluateAll((els) => els.map((e) => getComputedStyle(e).pointerEvents));
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all)).toEqual(new Set(["none"]));
  }
  // Painted below: no z-index, and earlier in the column than every item.
  const order = await col(page, today).evaluate((c) => {
    const items = [...c.querySelectorAll("[data-item]")];
    const under = [...c.querySelectorAll("[data-band], [data-prayer]")];
    return {
      items: items.length,
      before: under.every((u) => items.every((i) => u.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING)),
      z: under.map((u) => getComputedStyle(u).zIndex),
      // an item's centre is hit by the item, not by a line or band drawn under it
      hit: items.every((i) => { const r = i.getBoundingClientRect(); return !!document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 10))?.closest("[data-item]"); }),
    };
  });
  expect(order.items).toBeGreaterThan(0);
  expect(order.before).toBe(true);
  expect(new Set(order.z)).toEqual(new Set(["auto"]));
  expect(order.hit).toBe(true);
});

/* ---------- 2. the ring steps through other days ---------- */

const ring = (page: Page) => page.locator("[data-ring-preview]");
const next = (page: Page) => page.getByRole("button", { name: "Next day schedule" });
const prev = (page: Page) => page.getByRole("button", { name: "Previous day schedule" });
const todayBtn = (page: Page) => page.locator("[data-ring-today]");

test("ring: arrows step by one date and Today comes back; the preview carries no now marker or countdown", async ({ page }) => {
  await openOverview(page);
  await expect(ring(page)).toHaveAttribute("data-date", today);
  await expect(todayBtn(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Now" })).toBeVisible();
  await expect(page.locator("[data-now-preview]")).toHaveCount(0);
  await next(page).click();
  await expect(ring(page)).toHaveAttribute("data-date", plus(today, 1));
  await expect(page.getByRole("region", { name: "Now" })).toHaveCount(0);
  const card = page.locator("[data-now-preview]");
  await expect(card).toHaveAttribute("aria-label", `Preview, ${await ring(page).getAttribute("data-label")}`);
  await expect(card).toContainText("Preview");
  await expect(card).not.toContainText("Next");
  await expect(ring(page).locator("[data-now-marker]")).toHaveCount(0);
  await next(page).click();
  await expect(ring(page)).toHaveAttribute("data-date", plus(today, 2));
  await prev(page).click();
  await prev(page).click();
  await expect(ring(page)).toHaveAttribute("data-date", today);
  await expect(todayBtn(page)).toHaveCount(0);
  await prev(page).click();
  await expect(ring(page)).toHaveAttribute("data-date", plus(today, -1));
  await todayBtn(page).click();
  await expect(ring(page)).toHaveAttribute("data-date", today);
  await expect(ring(page).locator("[data-now-marker]")).toHaveCount(1);
  // the calendar's own day did not move
  await expect(view(page)).toHaveAttribute("data-cal-view", "week-grid");
  await expect(page.locator("[data-cal-range]")).toHaveText(/\d/);
});

test("ring: each date shows its own template, prayer times and events (compared with the week grid)", async ({ page }) => {
  await openOverview(page);
  // go to the start of the week, then walk it
  for (let n = 0; n < 7; n++) if ((await ring(page).getAttribute("data-date")) !== WEEK[0]) await prev(page).click();
  await expect(ring(page)).toHaveAttribute("data-date", WEEK[0]);
  const counts: number[] = [];
  for (const day of WEEK) {
    await expect(ring(page)).toHaveAttribute("data-date", day);
    await expect(ring(page)).toHaveAttribute("data-day-type", isWeekend(day) ? "weekend" : "weekday");
    expect(Number(await ring(page).getAttribute("data-fajr"))).toBe(await minOf(page, day, "fajr"));
    expect(Number(await ring(page).getAttribute("data-isha"))).toBe(await minOf(page, day, "isha"));
    const slices = await ring(page).locator("[data-slice]").evaluateAll((els) => els.map((e) => e.getAttribute("data-slice")));
    expect(slices).toEqual(isWeekend(day) ? ["soul", "planning", "body", "fnf", "sleep"] : ["soul", "ot", "body", "distribution", "sleep"]);
    const timed = await col(page, day).locator('[data-item^="e:"]').count();
    await expect(ring(page)).toHaveAttribute("data-events", String(timed));
    counts.push(timed);
    if (day !== WEEK[6]) await next(page).click();
  }
  // the seeded calendar has days with and without timed events, so the ring really switches data
  expect(new Set(counts).size).toBeGreaterThan(1);
});

test("ring: stepping over the week's edge works on ISO dates (a month and a year boundary)", async ({ page }) => {
  await openOverview(page);
  for (let n = 1; n <= 40; n++) await next(page).click();
  await expect(ring(page)).toHaveAttribute("data-date", plus(today, 40));
  const label = await ring(page).getAttribute("data-label");
  expect(label).toBe(new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${plus(today, 40)}T12:00:00Z`)));
  await todayBtn(page).click();
  await expect(ring(page)).toHaveAttribute("data-date", today);
});

test("ring: the stepper has labelled buttons and no keyboard shortcut of its own", async ({ page }) => {
  await openOverview(page);
  await expect(prev(page)).toBeVisible();
  await expect(next(page)).toBeVisible();
  await expect(next(page)).not.toHaveAttribute("aria-keyshortcuts", /.+/);
  const rangeBefore = await page.locator("[data-cal-range]").textContent();
  await page.locator("body").click({ position: { x: 5, y: 600 } });
  await page.keyboard.press("]"); // still the calendar's: next week
  await expect(page.locator("[data-cal-range]")).not.toHaveText(rangeBefore!);
  await expect(ring(page)).toHaveAttribute("data-date", today);
});

/* ---------- screenshots of the result ---------- */

test("screenshots: after (week grid with bands, ring on a weekend day, top bar)", async ({ page }) => {
  await openOverview(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/overview-week-${TAG}-bands-paper-light.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: `${OUT}/overview-week-${TAG}-bands-paper-dark.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await openOverview(page, "/?skin=admin");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/overview-week-${TAG}-bands-admin.png`, fullPage: true });
  await bar(page).screenshot({ path: `${OUT}/overview-topbar-${TAG}-bands-admin.png` });
  // the ring stepped to the next weekend day
  await next(page).click(); // off today, onto the next weekend day
  while (!isWeekend((await ring(page).getAttribute("data-date")) as string)) await next(page).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/overview-ring-weekend-${TAG}-admin.png`, fullPage: true });
  await openOverview(page, "/?skin=paper");
  await next(page).click(); // off today, onto the next weekend day
  while (!isWeekend((await ring(page).getAttribute("data-date")) as string)) await next(page).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/overview-ring-weekend-${TAG}-paper-light.png`, fullPage: true });
});

/* ---------- zones at UTC+12 and beyond: the date is the date, not the next one ---------- */

for (const zone of [
  { tz: "Pacific/Auckland", lat: -36.85, lon: 174.76 },
  { tz: "Pacific/Kiritimati", lat: 1.87, lon: -157.4 },
]) {
  test(`${zone.tz}: Saturday uses its own weekend template and Friday's night row`, async ({ page, request }) => {
    const res = await request.put(`${API}/api/v1/vault/config/schedule`, { headers: auth(), data: { ...ROUTINE, meta: { ...META, ...zone } } });
    expect(res.ok(), await res.text()).toBeTruthy();
    await openOverview(page);
    const days = await page.locator("[data-grid-day]").evaluateAll((els) => els.map((e) => e.getAttribute("data-grid-day") as string));
    expect(days).toHaveLength(7);
    // the week is Sunday to Saturday: the grid's own dates, whatever day it is in this zone now
    expect(days.map(dow)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const day of days) {
      const keys = await col(page, day).locator("[data-band]").evaluateAll((els) => els.map((e) => e.getAttribute("data-band")));
      expect(keys, day).toContain(isWeekend(day) ? "fnf" : "distribution");
      expect(keys, day).not.toContain(isWeekend(day) ? "distribution" : "fnf");
      const morning = col(page, day).locator('[data-band="sleep"][data-band-from="0"]');
      expect(Number(await morning.getAttribute("data-band-to")), day).toBe((await minOf(page, day, "fajr")) - (isWeekend(plus(day, -1)) ? 90 : 60));
    }
    // the ring agrees on the template of the date it shows
    for (let n = 0; n < 7; n++) {
      const d = (await ring(page).getAttribute("data-date")) as string;
      await expect(ring(page)).toHaveAttribute("data-day-type", isWeekend(d) ? "weekend" : "weekday");
      await next(page).click();
    }
  });
}

test("put the seeded schedule back", async ({ request }) => {
  test.skip(!seeded, "the schedule was not read in this worker");
  const res = await request.put(`${API}/api/v1/vault/config/schedule`, { headers: auth(), data: seeded });
  expect(res.ok(), await res.text()).toBeTruthy();
});
