import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Plan week/month rules (derived from existing fields, no API change). The real seeded API answers; this spec patches three
 * GET responses (pipelines, objectives, quarter) so the week is 2026-W46 and the month is Nov, with synthetic items, and mocks
 * the focus endpoint. Any browser console error fails the spec.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const WEEK = "2026-W46";

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

const item = (line: number, text: string, over: Record<string, unknown>) => ({
  line, hash: `h${line}`, text, description: "", blocked_by: [], lane: "next", checkpoint: null, added: "2026-10-01", done_on: null,
  focus: null, products: [], done: false, age_days: 3, stale: false, ...over,
});

async function mockPlan(page: Page): Promise<{ focus: { stream: string; line: number; hash: string }[]; stream: string }> {
  const seen = { focus: [] as { stream: string; line: number; hash: string }[], stream: "" };
  // No advisor plugin in the seeded API: its probe would 404 and log a console error, so answer it with an empty list.
  await page.route("**/api/v1/advisor/**", (route) => route.fulfill({ json: [] }));
  const real = async (route: Route) => (await route.fetch()).json();
  await page.route("**/api/v1/vault/pipelines", async (route) => {
    const data = await real(route);
    const s = data.streams.find((x: { weekly: boolean }) => x.weekly) ?? data.streams[0];
    seen.stream = s.stream;
    s.items = [
      item(1, "Synthetic next item", { lane: "next", checkpoint: "dec" }),
      item(2, "Synthetic old carried", { lane: "now", focus: "2026-W43" }),
      item(3, "Synthetic late checkpoint", { lane: "backlog", checkpoint: "jun" }),
      item(4, "Synthetic carried latest", { lane: "now", focus: "2026-W45" }),
      item(5, "Synthetic this month", { lane: "next", checkpoint: "nov" }),
      item(6, "Synthetic done", { lane: "done", done: true, checkpoint: "jun" }),
      item(7, "Synthetic old next", { lane: "next", focus: "2026-W40" }),
      item(8, "Synthetic focused this week", { lane: "next", focus: WEEK }),
    ];
    await route.fulfill({ json: { ...data, week: WEEK, streams: data.streams.map((x: { stream: string }) => (x.stream === s.stream ? s : { ...x, items: [] })) } });
  });
  await page.route("**/api/v1/vault/objectives", async (route) => {
    const data = await real(route);
    await route.fulfill({ json: { ...data, week: WEEK, items: data.items.map((o: object) => ({ ...o, text: "", done: false })) } });
  });
  await page.route("**/api/v1/vault/quarter", async (route) => route.fulfill({ json: { ...(await real(route)), current_month: "nov" } }));
  await page.route("**/api/v1/vault/pipeline/focus", async (route) => {
    seen.focus.push(route.request().postDataJSON());
    await route.fulfill({ json: { commit: "x", day: null } });
  });
  return seen;
}

test("carried chip, Keep for W46 calls the focus endpoint", async ({ page }) => {
  const seen = await mockPlan(page);
  await page.goto("/plan");
  const rows = page.getByRole("listbox", { name: "Work items" });
  await expect(rows.getByRole("option")).toHaveCount(2);
  await expect(rows.getByText("From W43")).toBeVisible();
  await expect(rows.getByText("From W45")).toBeVisible();
  await expect(page.getByText("Carried from W45: Synthetic carried latest").first()).toBeVisible();
  await page.getByRole("button", { name: "Keep for W46" }).first().click();
  await expect.poll(() => seen.focus.length).toBeGreaterThan(0);
  expect(seen.focus[0]).toMatchObject({ stream: seen.stream, line: 4, hash: "h4" });
});

test("Month tab lists overdue first, then this month's checkpoint", async ({ page }) => {
  await mockPlan(page);
  await page.goto("/plan");
  await page.getByRole("tab", { name: /^Month/ }).click();
  const opts = page.getByRole("listbox", { name: "Work items" }).getByRole("option");
  await expect(page.getByRole("tab", { name: /^Month\s*3$/ })).toBeVisible();
  await expect(opts).toHaveCount(3);
  await expect(opts.nth(0)).toContainText("Synthetic late checkpoint");
  await expect(opts.nth(0)).toContainText("Jun · overdue");
  await expect(opts.nth(1)).toContainText("Synthetic this month");
  await expect(opts.nth(1)).not.toContainText("overdue");
  await expect(opts.nth(2)).toContainText("Synthetic focused this week");   // lane next, focus = this week, no checkpoint: after overdue and this-month items
});

test("a Next item with an old focus gets no From chip", async ({ page }) => {
  await mockPlan(page);
  await page.goto("/plan");
  await page.getByRole("tab", { name: /^Next/ }).click();
  const old = page.getByRole("listbox", { name: "Work items" }).getByRole("option", { name: /Synthetic old next/ });
  await expect(old).toBeVisible();
  await expect(old).not.toContainText("From W");
});
