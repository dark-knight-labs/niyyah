import { expect, test, type Page } from "@playwright/test";

/** Settings > Devices: list, create (token shown once), revoke with a confirm, and the raw token is never persisted. */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";

let tokens: { access_token: string; refresh_token: string } | null = null;
const errors: string[] = [];
const logged: string[] = [];
const urls: string[] = [];
test.beforeEach(async ({ context, request, page }) => {
  errors.length = 0; logged.length = 0; urls.length = 0;
  page.on("console", (m) => { logged.push(m.text()); if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => urls.push(r.url()));
  if (!tokens) { const r = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } }); expect(r.ok()).toBeTruthy(); tokens = await r.json(); }
  await context.addInitScript((t) => { localStorage.setItem("access_token", t.access_token); localStorage.setItem("refresh_token", t.refresh_token); }, tokens!);
});
test.afterEach(() => { expect(errors, "browser console errors").toEqual([]); });

const section = (page: Page) => page.locator("#devices");

/** Everything a page can keep: storage, cookies, IndexedDB names, the URL, the DOM text and input values. */
async function pageHolds(page: Page, needle: string) {
  const inPage = await page.evaluate(async (n) => {
    const dump = (s: Storage) => JSON.stringify(Object.fromEntries(Object.keys(s).map((k) => [k, s.getItem(k)])));
    const dbs = indexedDB.databases ? JSON.stringify(await indexedDB.databases()) : "";
    const values = [...document.querySelectorAll("input,textarea")].map((e) => (e as HTMLInputElement).value).join("\n");
    const cacheNames = "caches" in window ? JSON.stringify(await window.caches.keys()) : "";
    return [localStorage, sessionStorage].map(dump).concat([document.cookie, location.href, dbs, cacheNames, document.documentElement.outerHTML, values]).some((x) => x.includes(n));
  }, needle);
  return inPage || (await page.context().cookies()).some((c) => JSON.stringify(c).includes(needle));
}

test("devices: create shows the token once, it is usable, never persisted, and revoke stops it", async ({ page, request }) => {
  const name = `Work MacBook ${Date.now().toString(36)}`;
  await page.goto("/settings");
  const devices = section(page);
  await expect(devices.getByRole("heading", { name: "Devices" })).toBeVisible();

  await devices.getByLabel("Device name").fill(name);
  await devices.getByRole("button", { name: "Create device token" }).click();

  // Shown once, with a warning, in a copyable box.
  const box = devices.getByRole("status", { name: "New device token" });
  await expect(box).toBeVisible();
  await expect(box).toContainText("Shown once");
  const raw = await box.getByLabel("Device token", { exact: true }).inputValue();
  expect(raw).toMatch(/^nyd_[A-Za-z0-9_-]{30,}$/);
  await expect(box.getByRole("button", { name: "Copy" })).toBeVisible();

  // The new row lists name, created, last used, state, and only the prefix of the token.
  const row = devices.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText("last used never");
  await expect(row).toContainText("active");
  await expect(row).not.toContainText(raw);
  await expect(row).toContainText(raw.slice(0, 8));

  // While it is shown it is still not in storage, cookies or the URL.
  expect(await page.evaluate((n) => JSON.stringify([localStorage, sessionStorage].map((s) => Object.fromEntries(Object.keys(s).map((k) => [k, s.getItem(k)])))).includes(n), raw)).toBe(false);
  expect(page.url()).not.toContain(raw);

  // It works as a device token on the capture route.
  const ok = await request.get(`${API}/api/v1/capture/options`, { headers: { Authorization: `Bearer ${raw}` } });
  expect(ok.status(), "device token works before revoke").toBe(200);

  // Positive control: the detector does see the token while it is on screen.
  expect(await pageHolds(page, raw), "detector finds the shown token").toBe(true);

  // Dismiss: gone from the page and from every place a page keeps data.
  await box.getByRole("button", { name: "I have copied it" }).click();
  await expect(box).toHaveCount(0);
  expect(await pageHolds(page, raw), "token anywhere in page state after dismiss").toBe(false);

  // Navigate away and back: the list is there, the token is not. Reload too.
  await page.goto("/progress");
  await page.goto("/settings");
  await expect(section(page).getByRole("listitem").filter({ hasText: name })).toBeVisible();
  expect(await pageHolds(page, raw), "token anywhere after navigation").toBe(false);
  await page.reload();
  expect(await pageHolds(page, raw), "token anywhere after reload").toBe(false);
  expect(logged.join("\n")).not.toContain(raw);
  expect(urls.filter((u) => u.includes(raw))).toEqual([]);

  // Revoke asks first; Cancel keeps it, confirming removes it and the token stops working.
  const again = section(page).getByRole("listitem").filter({ hasText: name });
  await again.getByRole("button", { name: `Revoke ${name}` }).click();
  await expect(again.getByText("Revoke now?")).toBeVisible();
  await again.getByRole("button", { name: "Cancel" }).click();
  await expect(again.getByRole("button", { name: `Revoke ${name}` })).toBeVisible();
  expect((await request.get(`${API}/api/v1/capture/options`, { headers: { Authorization: `Bearer ${raw}` } })).status()).toBe(200);

  await again.getByRole("button", { name: `Revoke ${name}` }).click();
  await again.getByRole("button", { name: "Yes, revoke" }).click();
  await expect(section(page).getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
  const dead = await request.get(`${API}/api/v1/capture/options`, { headers: { Authorization: `Bearer ${raw}` } });
  expect(dead.status(), "revoked token is refused").toBeGreaterThanOrEqual(401);
  expect(dead.status()).toBeLessThan(404);
  expect(logged.join("\n")).not.toContain(raw);
});

test("devices: leaving the page drops an undismissed token, and a server refusal shows a plain message", async ({ page }) => {
  const name = `Leaver ${Date.now().toString(36)}`;
  await page.goto("/settings");
  const devices = section(page);
  await devices.getByLabel("Device name").fill(name);
  await devices.getByRole("button", { name: "Create device token" }).click();
  const raw = await devices.getByLabel("Device token", { exact: true }).inputValue();
  expect(raw).toMatch(/^nyd_/);

  // Never dismissed: navigate within the app (client-side) and come back.
  await page.getByRole("link", { name: /progress/i }).first().click();
  await expect(page).toHaveURL(/progress/);
  await page.goBack();
  await expect(section(page).getByRole("listitem").filter({ hasText: name })).toBeVisible();
  await expect(section(page).getByLabel("Device token", { exact: true })).toHaveCount(0);
  expect(await pageHolds(page, raw)).toBe(false);

  // Clean up the row through the UI.
  const row = section(page).getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: `Revoke ${name}` }).click();
  await row.getByRole("button", { name: "Yes, revoke" }).click();
  await expect(row).toHaveCount(0);

  // A failing create shows a fixed message, not the response.
  await page.route("**/api/v1/devices/tokens", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "boom secret-detail" }) }) : route.continue());
  await section(page).getByLabel("Device name").fill("x");
  await section(page).getByRole("button", { name: "Create device token" }).click();
  await expect(section(page).getByRole("alert")).toHaveText("Could not create the device token");
  expect(logged.join("\n")).not.toContain("secret-detail");
  errors.length = 0; // the stubbed 500 is logged by the browser on purpose
});

const create = async (page: Page, name: string) => {
  await section(page).getByLabel("Device name").fill(name);
  await section(page).getByRole("button", { name: "Create device token" }).click();
};
const rowOf = (page: Page, name: string) => section(page).getByRole("listitem").filter({ hasText: name });
const cleanUp = async (page: Page, name: string) => {
  await page.unroute("**/api/v1/devices/tokens");
  await page.reload();
  await rowOf(page, name).getByRole("button", { name: `Revoke ${name}` }).click();
  await rowOf(page, name).getByRole("button", { name: "Yes, revoke" }).click();
  await expect(rowOf(page, name)).toHaveCount(0);
};

test("devices: a hidden tab keeps the token; it hides itself after 5 minutes with a visible message", async ({ page }) => {
  const name = `Timer ${Date.now().toString(36)}`;
  await page.clock.install();
  await page.goto("/settings");
  await create(page, name);
  const box = section(page).getByRole("status", { name: "New device token" });
  const raw = await box.getByLabel("Device token", { exact: true }).inputValue();

  // Another window covering the browser must not cost the owner the token.
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.fastForward(4 * 60 * 1000);
  await expect(box).toBeVisible();

  await page.clock.fastForward(61 * 1000);
  await expect(box).toHaveCount(0);
  await expect(section(page).getByText("Token hidden after 5 minutes. Revoke this device and create a new one if you did not copy it.")).toBeVisible();
  expect(await pageHolds(page, raw), "token anywhere after auto-hide").toBe(false);

  // A new create clears the message.
  await create(page, `${name} b`);
  await expect(section(page).getByText(/Token hidden after 5 minutes/)).toHaveCount(0);
  for (const n of [`${name} b`, name]) {
    await rowOf(page, n).getByRole("button", { name: `Revoke ${n}` }).click();
    await rowOf(page, n).getByRole("button", { name: "Yes, revoke" }).click();
    await expect(rowOf(page, n)).toHaveCount(0);
  }
});

test("devices: a failed list call shows the error, not the empty state, and keeps the known rows", async ({ page }) => {
  const name = `Keep ${Date.now().toString(36)}`;
  // First load fails: unknown list, no "No devices yet."
  await page.route("**/api/v1/devices/tokens", (r) => r.request().method() === "GET" ? r.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : r.continue());
  await page.goto("/settings");
  await expect(section(page).getByRole("alert")).toContainText("Could not load the device list");
  await expect(section(page).getByText("No devices yet.")).toHaveCount(0);
  await page.unroute("**/api/v1/devices/tokens");
  await page.reload();
  await create(page, name);
  await section(page).getByRole("button", { name: "I have copied it" }).click();
  await expect(rowOf(page, name)).toBeVisible();

  // A later reload fails: the row stays, the error shows.
  await page.route("**/api/v1/devices/tokens", (r) => r.request().method() === "GET" ? r.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : r.continue());
  await create(page, `${name} 2`);
  await expect(section(page).getByRole("alert")).toContainText("Could not load the device list");
  await expect(rowOf(page, name)).toBeVisible();
  await expect(section(page).getByText("No devices yet.")).toHaveCount(0);
  errors.length = 0;
  await page.unroute("**/api/v1/devices/tokens");
  await page.reload();
  for (const n of [`${name} 2`, name]) {
    await rowOf(page, n).getByRole("button", { name: `Revoke ${n}` }).click();
    await rowOf(page, n).getByRole("button", { name: "Yes, revoke" }).click();
    await expect(rowOf(page, n)).toHaveCount(0);
  }
});

test("devices: revoking a row that is already gone (404) reloads the list so the stale row disappears", async ({ page, request }) => {
  const name = `Stale ${Date.now().toString(36)}`;
  await page.goto("/settings");
  await create(page, name);
  await section(page).getByRole("button", { name: "I have copied it" }).click();
  const list = await (await request.get(`${API}/api/v1/devices/tokens`, { headers: { Authorization: `Bearer ${tokens!.access_token}` } })).json();
  const mine = list.find((t: { name: string }) => t.name === name);
  expect((await request.delete(`${API}/api/v1/devices/tokens/${mine.id}`, { headers: { Authorization: `Bearer ${tokens!.access_token}` } })).status()).toBe(204);

  await rowOf(page, name).getByRole("button", { name: `Revoke ${name}` }).click();
  await rowOf(page, name).getByRole("button", { name: "Yes, revoke" }).click();
  await expect(section(page).getByRole("alert")).toHaveText("Could not revoke the device token");
  await expect(rowOf(page, name)).toHaveCount(0);
  errors.length = 0; // the 404 is logged by the browser
});

test("devices: revoking the just-created device clears the shown token", async ({ page }) => {
  const name = `Fresh ${Date.now().toString(36)}`;
  await page.goto("/settings");
  await create(page, name);
  const box = section(page).getByRole("status", { name: "New device token" });
  const raw = await box.getByLabel("Device token", { exact: true }).inputValue();
  await rowOf(page, name).getByRole("button", { name: `Revoke ${name}` }).click();
  await rowOf(page, name).getByRole("button", { name: "Yes, revoke" }).click();
  await expect(rowOf(page, name)).toHaveCount(0);
  await expect(box).toHaveCount(0);
  expect(await pageHolds(page, raw)).toBe(false);
});

test("devices: Enter submits, Copy puts the token on the clipboard, and the 422 rule text is shown", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const name = `Enter ${Date.now().toString(36)}`;
  await page.goto("/settings");
  await section(page).getByLabel("Device name").fill(name);
  await section(page).getByLabel("Device name").press("Enter");
  const box = section(page).getByRole("status", { name: "New device token" });
  const raw = await box.getByLabel("Device token", { exact: true }).inputValue();
  await box.getByRole("button", { name: "Copy" }).click();
  await expect(box.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);

  await page.route("**/api/v1/devices/tokens", (r) => r.request().method() === "POST"
    ? r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ detail: "at most 20 device tokens; revoke one first" }) }) : r.continue());
  await create(page, "one more");
  await expect(section(page).getByRole("alert")).toHaveText("at most 20 device tokens; revoke one first");
  errors.length = 0;
  await cleanUp(page, name);
});
