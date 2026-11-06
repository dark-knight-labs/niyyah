#!/usr/bin/env node
// Canvas fps probe (planner v2 B5). Usage: node fps.mjs <url> [runs=5]
// Drives a React Flow page with a scripted path (20 pan steps of 200 px, then zoom 0.3 -> 1.5 via ctrl+wheel),
// samples frame deltas from requestAnimationFrame, prints per-run mean fps plus median and p10 across runs.
// Pass bar: median >= 50 AND p10 >= 30. Needs `playwright` resolvable (NODE_PATH or local install).
import os from "node:os";
import { createRequire } from "node:module";
// ESM ignores NODE_PATH; require() honours it.
const { chromium } = createRequire(import.meta.url)("playwright");

const url = process.argv[2];
const runs = Number(process.argv[3] ?? 5);
const throttle = Number(process.env.CPU_THROTTLE ?? 1); // e.g. CPU_THROTTLE=4 for the 4x stress variant
if (!url) { console.error("usage: fps.mjs <url> [runs]"); process.exit(2); }

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; };

// Pages behind login: pass E2E_TOKENS='{"access_token":"..","refresh_token":".."}'.
const tokens = process.env.E2E_TOKENS ? JSON.parse(process.env.E2E_TOKENS) : null;
const browser = await chromium.launch();
const results = [];
for (let r = 0; r < runs; r++) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  if (throttle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle }); }
  if (tokens) await page.addInitScript((t) => { localStorage.setItem("access_token", t.access_token); localStorage.setItem("refresh_token", t.refresh_token); }, tokens);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node");
  await page.mouse.move(800, 500);
  await page.evaluate(() => {
    window.__d = [];
    let last = performance.now();
    const tick = (t) => { window.__d.push(t - last); last = t; window.__raf = requestAnimationFrame(tick); };
    window.__raf = requestAnimationFrame(tick);
  });
  // pan: wheel scroll (React Flow panOnScroll) is not enabled by default, so drag the pane instead.
  await page.mouse.move(800, 500);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(800 - i * 10, 500 - i * 10, { steps: 2 }); await page.waitForTimeout(16); }
  await page.mouse.up();
  for (let i = 0; i < 20; i++) { await page.mouse.wheel(-200, 0); await page.waitForTimeout(16); } // horizontal wheel: ignored if pan off, harmless
  // zoom 0.3 -> 1.5: ctrl+wheel steps (deltaY < 0 zooms in)
  await page.keyboard.down("Control");
  for (let i = 0; i < 60; i++) {
    const k = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform).a);
    if (k >= 1.5) break;
    await page.mouse.wheel(0, -30); await page.waitForTimeout(16);
  }
  await page.keyboard.up("Control");
  const d = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__d.slice(2); });
  const zoom = await page.evaluate(() => getComputedStyle(document.querySelector(".react-flow__viewport")).transform);
  const fps = d.map((x) => 1000 / x);
  const total = d.reduce((a, b) => a + b, 0);
  results.push({ mean: (d.length / total) * 1000, p10: pct(fps, 0.1), frameFps: fps, frames: d.length, nodes: await page.locator(".react-flow__node").count(), zoom });
  await page.close();
}
const means = results.map((x) => x.mean);
const out = {
  url, throttle, runs: results,
  median_fps: +pct(means, 0.5).toFixed(1),          // median of per-run mean fps
  p10_fps: +pct(means, 0.1).toFixed(1),             // 10th percentile of per-run mean fps (with 5 runs: the slowest run)
  p10_frame_fps_pooled: +pct(results.flatMap((x) => x.frameFps), 0.1).toFixed(1), // informational: slowest-decile frames
  host: `${os.cpus()[0]?.model} x${os.cpus().length}, ${os.type()} ${os.release()}`,
  chromium: browser.version(),
};
console.log(JSON.stringify(out, (k, v) => (k === "frameFps" ? undefined : v), 2));
await browser.close();
