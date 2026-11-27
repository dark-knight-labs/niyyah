import { expect, test } from "@playwright/test";

/** The weekly report on /progress: By day groups the week day -> block -> product, and items can be edited and ticked from it. */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());

let tokens: { access_token: string; refresh_token: string } | null = null;
const errors: string[] = [];
test.beforeEach(async ({ context, request, page }) => {
  errors.length = 0;
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  if (!tokens) { const r = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } }); expect(r.ok()).toBeTruthy(); tokens = await r.json(); }
  await context.addInitScript((t) => { localStorage.setItem("access_token", t.access_token); localStorage.setItem("refresh_token", t.refresh_token); }, tokens!);
});
test.afterEach(() => { expect(errors, "browser console errors").toEqual([]); });

test("weekly report: By day groups the week by day, block and product, and an item can be edited and reopened there", async ({ page, request }) => {
  const key = Date.now().toString(36);
  const text = `Report item ${key}`, product = `repprod${key}`;
  const h = { Authorization: `Bearer ${tokens!.access_token}` };
  const made = await request.post(`${API}/api/v1/vault/day/${today}/tasks`, { headers: h, data: { text: `${text} #${product}`, stream: "studio" } });
  expect(made.ok()).toBeTruthy();
  const listed = await (await request.get(`${API}/api/v1/vault/day/${today}/tasks`, { headers: h })).json();
  const task = listed.find((t: { text: string }) => t.text === text);
  expect(task).toBeTruthy();
  const done = await request.put(`${API}/api/v1/vault/tasks`, { headers: h, data: { path: task.path, line: task.line, hash: task.hash, done: true } });
  expect(done.ok()).toBeTruthy();

  await page.goto("/progress");
  const report = page.getByRole("region", { name: "Weekly report" });
  await expect(report).toBeVisible();
  await expect(report.getByRole("group", { name: "Group by" }).getByRole("button", { name: "By block" })).toHaveAttribute("aria-pressed", "true");
  await report.getByRole("button", { name: "By day", exact: true }).click();

  // day -> block -> product -> item
  const item = report.locator(`[data-report-day="${today}"] [data-report-block="studio"] [data-report-product="${product}"] [data-report-item]`).filter({ hasText: text });
  await expect(item).toBeVisible();
  await expect(report.locator(`[data-report-day="${today}"] [data-report-block="studio"] [data-report-product="${product}"]`)).toContainText(`#${product}`);
  await page.reload();                                   // the choice is remembered
  await expect(page.getByRole("region", { name: "Weekly report" }).getByRole("button", { name: "By day", exact: true })).toHaveAttribute("aria-pressed", "true");

  // edit: rename keeps the product (the #tag is in the field), then Enter saves
  const edited = `${text} renamed`;
  await item.getByRole("button", { name: `Edit: ${text}` }).click();
  const field = page.getByRole("textbox", { name: `Edit: ${text}` });
  await expect(field).toHaveValue(`${text} #${product}`);
  await field.fill(`${edited} #${product}`);
  await field.press("Enter");
  const renamed = report.locator(`[data-report-product="${product}"] [data-report-item]`).filter({ hasText: edited });
  await expect(renamed).toBeVisible();
  const after = await (await request.get(`${API}/api/v1/vault/day/${today}/tasks`, { headers: h })).json();
  expect(after.find((t: { text: string }) => t.text === edited)?.products).toEqual([product]);

  // Esc cancels an edit without saving
  await renamed.getByRole("button", { name: `Edit: ${edited}` }).click();
  await page.getByRole("textbox", { name: `Edit: ${edited}` }).fill("never saved");
  await page.getByRole("textbox", { name: `Edit: ${edited}` }).press("Escape");
  await expect(renamed).toBeVisible();

  // reopen: the task goes back to open, so it stays in the report (open, shown after done ones)
  await renamed.getByRole("button", { name: `Reopen: ${edited}` }).click();
  await expect(renamed.getByRole("button", { name: `Done: ${edited}` })).toBeVisible();
  const reopened = await (await request.get(`${API}/api/v1/vault/day/${today}/tasks`, { headers: h })).json();
  expect(reopened.find((t: { text: string }) => t.text === edited)?.done).toBe(false);

  // By block still shows the same week
  await report.getByRole("button", { name: "By block", exact: true }).click();
  await expect(report.getByText(edited)).toBeVisible();
});
