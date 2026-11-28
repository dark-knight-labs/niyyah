import { expect, test } from "@playwright/test";

/** A task captured by a device token under a stream shows in the Plan page's Weekly log, on today, under that stream. */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  // The Plan page's advisor panel asks for /advisor/proposals, which this seeded account answers with 404 (not part of this section):
  // failed requests are listed by URL so that one is skipped and any other, the weekly log's own included, still fails the test.
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("status of 404")) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/advisor/proposals")) errors.push(`${r.status()} ${r.url()}`); });
});
test.afterEach(() => { expect(errors, "browser console errors").toEqual([]); });

test("weekly log: a captured task appears under its stream, and finishing it counts", async ({ page, context, request }) => {
  const login = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const tokens = await login.json();
  const as = { Authorization: `Bearer ${tokens.access_token}` };
  const made = await request.post(`${API}/api/v1/devices/tokens`, { headers: as, data: { name: `e2e weekly log ${Date.now().toString(36)}` } });
  expect(made.status()).toBe(201);
  const device = await made.json();
  const asDevice = { Authorization: `Bearer ${device.token}` };
  try {
    const options = await (await request.get(`${API}/api/v1/capture/options`, { headers: asDevice })).json();
    const stream = options.streams[0];
    test.skip(!stream, "the e2e account has no stream to file under");
    const text = `weekly log e2e ${Date.now().toString(36)}`;
    const key = crypto.randomUUID();
    const created = await request.post(`${API}/api/v1/vault/items`, { headers: asDevice, data: { text, stream: stream.slug, client_id: key } });
    expect(created.status()).toBe(201);

    await context.addInitScript((t) => { localStorage.setItem("access_token", t.access_token); localStorage.setItem("refresh_token", t.refresh_token); }, tokens);
    await page.goto("/plan");
    const log = page.locator("#plan-weekly-log");
    await expect(log.getByRole("heading", { name: /Weekly log/ })).toBeVisible();
    await expect(log.getByText(text)).toBeVisible();
    await expect(log.getByRole("list", { name: "Finished per stream" })).toContainText(stream.name);

    const patched = await request.patch(`${API}/api/v1/capture/tasks/${key}`, { headers: asDevice, data: { done: true } });
    expect(patched.ok()).toBeTruthy();
    await page.reload();
    await expect(log.getByText(text)).toBeVisible();
    await expect(log.locator("li:has(> .sr-only)", { hasText: text }).getByText("Finished:")).toHaveCount(1);
  } finally {
    await request.delete(`${API}/api/v1/devices/tokens/${device.id}`, { headers: as });
  }
});
