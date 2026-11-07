import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * The Advisor panel on Plan with every /api/v1/advisor/* call mocked (page.route), so it needs no plugin: hidden when the probe
 * is refused, ask and answer, error messages, approve (reloads the plan) and reject. The rest of Plan runs against the seeded API (run.sh).
 */
const API = process.env.E2E_API_URL ?? "http://localhost:8017";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@niyyah.app";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-pass-123";
const OUT = "e2e/out";

let tokens: { access_token: string; refresh_token: string } | null = null;
test.beforeEach(async ({ context, request }) => {
  if (!tokens) { const r = await request.post(`${API}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } }); expect(r.ok()).toBeTruthy(); tokens = await r.json(); }
  await context.addInitScript((t) => { localStorage.setItem("access_token", t.access_token); localStorage.setItem("refresh_token", t.refresh_token); }, tokens!);
});

const proposal = (id: number, over: Record<string, unknown> = {}) => ({
  id, kind: "note_add", payload: { text: "Call the electrician" }, text: "Call the electrician", summary: "Call the electrician",
  reason: "It blocks the router work", status: "pending", created_at: "2026-11-07T08:00:00", decided_at: null, ...over,
});
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

interface Mock { asks: string[]; pipelinesLoads: number; decisions: string[]; proposalGets: number }

/** Mock the advisor routes; `behave` overrides any route by "METHOD /path". */
async function mockAdvisor(page: Page, behave: Record<string, (route: Route) => Promise<void> | void> = {}): Promise<Mock> {
  const seen: Mock = { asks: [], pipelinesLoads: 0, decisions: [], proposalGets: 0 };
  let list = [proposal(1), proposal(2, { kind: "stream_checkpoint_set", payload: { text: "Router live" }, text: "Router live", summary: "Router live", reason: null }), proposal(9, { status: "rejected", summary: "Old idea", text: "Old idea" })];
  page.on("request", (r) => { if (new URL(r.url()).pathname.endsWith("/vault/pipelines")) seen.pipelinesLoads++; });
  await page.route("**/api/v1/advisor/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/api\/v1\/advisor/, "");
    const key = `${req.method()} ${path}`;
    if (behave[key]) return behave[key](route);
    if (key === "GET /proposals") { seen.proposalGets++; return json(route, 200, list); }
    if (key === "POST /ask") {
      const q = req.postDataJSON().question as string;
      seen.asks.push(q);
      return json(route, 200, { answer: "## Week\n\nYou kept **three** streams moving.\n\n- Router: on track\n- Shop: <script>window.__xss=1</script>\n\n[bad](javascript:void) [ok](https://example.com)", proposals_pending: 2, filtered: true, removed: 2 });
    }
    const m = path.match(/^\/proposals\/(\d+)\/(approve|reject)$/);
    if (req.method() === "POST" && m) {
      seen.decisions.push(`${m[2]} ${m[1]}`);
      const status = m[2] === "approve" ? "approved" : "rejected";
      list = list.map((p) => (p.id === Number(m[1]) ? { ...p, status } : p));
      return json(route, 200, { ...list.find((p) => p.id === Number(m[1])) });
    }
    return json(route, 404, { detail: "Not found" });
  });
  return seen;
}

const panel = (page: Page) => page.getByRole("region", { name: "Advisor" });
const openPlan = async (page: Page) => { await page.goto("/plan"); await expect(page.getByRole("region", { name: "Compass" })).toBeVisible(); };

for (const status of [401, 403, 404, 500]) {
  test(`hidden when the advisor routes answer ${status}`, async ({ page }) => {
    await mockAdvisor(page, { "GET /proposals": (r) => json(r, status, { detail: "nope" }) });
    await openPlan(page);
    await page.waitForTimeout(500);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByText("Advisor", { exact: true })).toHaveCount(0);
  });
}

test("hidden when the network fails", async ({ page }) => {
  await mockAdvisor(page, { "GET /proposals": (r) => r.abort("failed") });
  await openPlan(page);
  await page.waitForTimeout(500);
  await expect(panel(page)).toHaveCount(0);
});

test("ask, answer rendered safely, filtered note, proposals refreshed, chips fill without sending", async ({ page }) => {
  const seen = await mockAdvisor(page);
  await openPlan(page);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("2 waiting")).toBeVisible();
  await expect(panel(page).getByText("Call the electrician")).toBeVisible();
  await expect(panel(page).getByText("Why: It blocks the router work")).toBeVisible();

  await panel(page).getByRole("button", { name: "Review my week" }).click();
  await expect(panel(page).getByLabel("Ask the advisor")).toHaveValue("Review my week");
  expect(seen.asks).toEqual([]);

  await panel(page).getByLabel("Ask the advisor").press("Control+Enter");
  const convo = panel(page).getByRole("list", { name: "Conversation" });
  await expect(convo.getByRole("strong")).toHaveText("three");
  await expect(convo.getByRole("heading", { name: "Week" })).toHaveCount(0); // headings render as styled paragraphs, not h-tags
  await expect(convo.getByText("1 passage")).toHaveCount(0);
  await expect(convo.getByText("2 passages removed: quotes and references are shown only from the verified set")).toBeVisible();
  await expect(convo.getByText("<script>window.__xss=1</script>", { exact: false })).toBeVisible(); // shown as text
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(convo.getByRole("link", { name: "ok" })).toHaveAttribute("href", "https://example.com");
  await expect(convo.getByRole("link", { name: "bad" })).toHaveCount(0);
  expect(seen.asks).toEqual(["Review my week"]);
  await page.screenshot({ path: `${OUT}/advisor-panel.png`, fullPage: false });
});

test("ask errors: 429, 504, 502 each read clearly", async ({ page }) => {
  let status = 429;
  await mockAdvisor(page, { "POST /ask": (r) => json(r, status, { detail: "x" }) });
  await openPlan(page);
  const box = panel(page).getByLabel("Ask the advisor");
  const send = panel(page).getByRole("button", { name: "Send" });
  await box.fill("one"); await send.click();
  await expect(panel(page).getByRole("alert")).toContainText("hourly limit");
  status = 504;
  await box.fill("two"); await send.click();
  await expect(panel(page).getByRole("alert").first()).toContainText("too long");
  await expect(panel(page).getByRole("alert").first()).toContainText("narrower");
  status = 502;
  await box.fill("three"); await send.click();
  await expect(panel(page).getByRole("alert").first()).toContainText("could not answer");
});

test("approve reloads the plan and moves the proposal to decisions; reject does not reload", async ({ page }) => {
  const seen = await mockAdvisor(page);
  await openPlan(page);
  await expect(panel(page).getByText("2 waiting")).toBeVisible();
  const before = seen.pipelinesLoads;
  expect(seen.proposalGets).toBe(1); // the probe, once
  await panel(page).getByRole("button", { name: "Approve" }).first().click();
  await expect(panel(page).getByText("1 waiting")).toBeVisible();
  expect(seen.decisions).toEqual(["approve 1"]);
  await expect.poll(() => seen.proposalGets).toBe(2); // refreshed by the same call, not a new probe on a remounted panel
  await expect.poll(() => seen.pipelinesLoads).toBeGreaterThan(before);
  const after = seen.pipelinesLoads;
  await panel(page).getByRole("button", { name: "Reject" }).click();
  await expect(panel(page).getByText(/^nothing waiting · /)).toBeVisible();
  expect(seen.decisions).toEqual(["approve 1", "reject 2"]);
  await page.waitForTimeout(500);
  expect(seen.pipelinesLoads).toBe(after);
  await panel(page).getByText(/Recent decisions · 3/).click();
  await expect(panel(page).getByText("approved", { exact: true })).toBeVisible();
});

test("approve refusals show the server's detail: 422 stays pending, stale 409 explains", async ({ page }) => {
  let refuse: { status: number; detail: string } = { status: 422, detail: "item not found" };
  await mockAdvisor(page, { "POST /proposals/1/approve": (r) => json(r, refuse.status, { detail: refuse.detail }) });
  await openPlan(page);
  await panel(page).getByRole("button", { name: "Approve" }).first().click();
  await expect(panel(page).getByRole("alert")).toContainText("item not found");
  await expect(panel(page).getByRole("alert")).toContainText("still waiting");
  await expect(panel(page).getByText("2 waiting")).toBeVisible();
  refuse = { status: 409, detail: "stale: the item moved" };
  await panel(page).getByRole("button", { name: "Approve" }).first().click();
  await expect(panel(page).getByRole("alert")).toContainText("the item moved");
  await expect(panel(page).getByRole("alert")).toContainText("not applied");
});

test("collapsed state is remembered", async ({ page }) => {
  await mockAdvisor(page);
  await openPlan(page);
  const toggle = panel(page).getByRole("button", { name: /Advisor/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(panel(page).getByLabel("Ask the advisor")).toHaveCount(0);
  await page.reload();
  await expect(panel(page).getByRole("button", { name: /Advisor/ })).toHaveAttribute("aria-expanded", "false");
  await expect(panel(page).getByLabel("Ask the advisor")).toHaveCount(0);
});

test("one ask at a time: Send is disabled in flight and a second Ctrl+Enter sends nothing", async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  let asks = 0;
  await mockAdvisor(page, { "POST /ask": async (r) => { asks++; await gate; await json(r, 200, { answer: "done", proposals_pending: 0, filtered: false, removed: 0 }); } });
  await openPlan(page);
  const box = panel(page).getByLabel("Ask the advisor");
  await box.fill("first");
  await box.press("Control+Enter");
  await expect(panel(page).getByRole("status")).toContainText("Thinking");
  await expect(panel(page).getByRole("button", { name: "Send" })).toBeDisabled();
  await box.fill("second");
  await box.press("Control+Enter");
  await page.waitForTimeout(300);
  expect(asks).toBe(1);
  release();
  await expect(panel(page).getByText("done", { exact: true })).toBeVisible();
});

test("leaving the page aborts an ask in flight", async ({ page }) => {
  let aborted = false;
  page.on("requestfailed", (r) => { if (r.url().includes("/advisor/ask")) aborted = true; });
  await mockAdvisor(page, { "POST /ask": async () => { await new Promise(() => undefined); } });
  await openPlan(page);
  await panel(page).getByLabel("Ask the advisor").fill("slow");
  await panel(page).getByRole("button", { name: "Send" }).click();
  await expect(panel(page).getByRole("status")).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).first().click();
  await expect.poll(() => aborted).toBe(true);
});
