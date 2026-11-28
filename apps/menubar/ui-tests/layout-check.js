// Layout check for the popup on short screens. A Playwright function: `async (page) => {...}`.
// Run it with the Playwright MCP `browser_run_code_unsafe` (filename = this file, inside the repo), with
// ui/ served at http://localhost:8802 (a static server; `Cache-Control: no-store`). It stubs the Tauri bridge
// with 20 streams and 30 windows and, for window heights 600, 480 and (a stress case) 300, asserts:
//   - the dialogs and the widget never exceed the window; the Save row and the "New Task" footer are visible;
//   - the content scrolls to its last child; a dropdown menu scrolls to its last option and fits the window;
//   - Tab reaches the Save button; Esc closes an open dropdown before the popup.
// Returns { results: [{name, ok, detail}] }; every `ok` must be true.
async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  const FIXED = new Date('2026-11-28T09:00:00Z').getTime();
  const streams = Array.from({length: 20}, (_, i) => ({value: 's' + i, label: ['Soul', 'Body', 'Kahf', 'Alisha Noor', 'Distribution', 'FnF', 'Finance', 'One Thing'][i % 8] + (i >= 8 ? ' ' + i : ''), color: 'violet',
    products: i % 3 === 0 ? [{slug: 'p1', name: 'Product one'}, {slug: 'p2', name: 'Product two'}, {slug: 'p3', name: 'Product three'}] : []}));
  const windows = Array.from({length: 30}, (_, i) => ({app: ['Safari', 'Notes', 'Slack', 'Terminal', 'Xcode'][i % 5], bundle_id: 'com.x.' + (i % 5), title: 'Window title number ' + i + ' with a fairly long name to force an ellipsis in the list'}));
  const tasks = Array.from({length: 6}, (_, i) => ({id: 't' + i, name: 'Task number ' + i + ' with some words', done: false, trackedMs: i * 61000}));
  await page.addInitScript(`(() => {
    const h = { load_tasks: () => ${JSON.stringify(tasks)}, save_tasks: () => null, awake_millis: () => 0,
      load_options: () => ({picker: ${JSON.stringify(streams)}}),
      list_focus_windows: () => ({trusted: true, windows: ${JSON.stringify(windows)}}),
      load_focus_state: () => null, pending: () => [], get_settings: () => ({server_url: 'https://niyyah.example', has_token: true}) };
    window.__TAURI__ = { core: { invoke: async (c, a) => (h[c] ? h[c](a) : null) }, event: { listen: async () => () => {} } };
    localStorage.setItem('niyyah-focus-welcomed', '1');
  })();`);
  const results = [];
  const ok = (name, cond, detail) => results.push({name, ok: Boolean(cond), detail: detail ?? ''});
  const inside = (r, H, W = 440) => r.top >= -0.5 && r.left >= -0.5 && r.bottom <= H + 0.5 && r.right <= W + 0.5;
  const rect = async (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return {top: r.top, left: r.left, bottom: r.bottom, right: r.right, height: r.height}; }, sel);

  for (const H of [600, 480, 300]) {
    await page.setViewportSize({width: 440, height: H});
    const open = async () => {
      await page.clock.setFixedTime(FIXED);
      await page.goto('http://localhost:8802/panel.html');
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('niyyah-focus-welcomed', '1'); });
      await page.goto('http://localhost:8802/panel.html');
      await page.waitForTimeout(600);
    };
    const tag = H + 'px: ';

    // A. composer with the stream dropdown open
    await open();
    await page.click('#different');
    await page.waitForTimeout(500);
    ok(tag + 'composer within the window', inside(await rect(page, '#voice'), H), JSON.stringify(await rect(page, '#voice')));
    ok(tag + 'Save visible (sticky footer)', inside(await rect(page, '#save'), H), JSON.stringify(await rect(page, '#save')));
    await page.click('.pk-row:nth-child(1) .dd-trigger');
    await page.waitForTimeout(300);
    const menu = await rect(page, '.dd-open .dd-menu');
    ok(tag + 'stream menu fits the window', menu && inside(menu, H), JSON.stringify(menu));
    ok(tag + 'stream menu has a search box (20 > 8)', await page.evaluate(() => !document.querySelector('.dd-open .dd-search').hidden));
    const last = await page.evaluate(() => { const list = document.querySelector('.dd-open .dd-list'); list.scrollTop = list.scrollHeight; const items = list.querySelectorAll('.dd-option'); const l = list.getBoundingClientRect(), r = items[items.length - 1].getBoundingClientRect(); return {n: items.length, visible: r.top >= l.top - 1 && r.bottom <= l.bottom + 1}; });
    ok(tag + 'stream menu scrolls to its last option (' + last.n + ' options)', last.n === 20 && last.visible, JSON.stringify(last));
    await page.keyboard.press('Escape');
    ok(tag + 'Esc closes the dropdown, not the dialog', await page.evaluate(() => !document.querySelector('.dd-open') && document.getElementById('voice').open));
    // keyboard: pick by typing, Tab to Save
    await page.focus('.pk-row:nth-child(1) .dd-trigger');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    ok(tag + 'keyboard picks a stream', await page.evaluate(() => /Body|Kahf|Soul/.test(document.querySelector('.pk-row .dd-value').textContent)));
    await page.fill('#transcript', 'A task');
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement && document.activeElement.id === 'save'); }
    ok(tag + 'Tab reaches Save', reached);
    ok(tag + 'Save still in the window after Tab', inside(await rect(page, '#save'), H));

    // B. composer with Focus on, allowed-windows dropdown open
    await open();
    await page.click('#different');
    await page.click('#focus-toggle');
    await page.waitForTimeout(500);
    const dialog = await rect(page, '#voice');
    ok(tag + 'composer + Focus within the window', inside(dialog, H), JSON.stringify(dialog));
    ok(tag + 'Save visible with Focus on', inside(await rect(page, '#save'), H), JSON.stringify(await rect(page, '#save')));
    await page.evaluate(() => { const d = document.getElementById('voice'); d.scrollTop = d.scrollHeight; });
    const scrolledToEnd = await page.evaluate(() => { const d = document.getElementById('voice'); return Math.abs(d.scrollTop + d.clientHeight - d.scrollHeight) < 2 || d.scrollHeight <= d.clientHeight; });
    ok(tag + 'composer scrolls to its last child', scrolledToEnd);
    await page.click('.focus-options .pk-row:nth-child(2) .dd-trigger');
    await page.waitForTimeout(300);
    const amenu = await rect(page, '.dd-open .dd-menu');
    ok(tag + 'allowed-windows menu fits the window', amenu && inside(amenu, H), JSON.stringify(amenu));
    const alast = await page.evaluate(() => { const list = document.querySelector('.dd-open .dd-list'); list.scrollTop = list.scrollHeight; const items = list.querySelectorAll('.dd-option'); const l = list.getBoundingClientRect(), r = items[items.length - 1].getBoundingClientRect(); return {n: items.length, visible: r.top >= l.top - 1 && r.bottom <= l.bottom + 1, multi: list.getAttribute('aria-multiselectable')}; });
    ok(tag + 'allowed menu is multi-select and scrolls to its last option (' + alast.n + ')', alast.n === 30 && alast.visible && alast.multi === 'true', JSON.stringify(alast));
    await page.keyboard.press('Escape');
    ok(tag + 'Esc closes the allowed dropdown first', await page.evaluate(() => !document.querySelector('.dd-open') && document.getElementById('voice').open));

    // C. a focused task row with 30 windows
    await open();
    await page.hover('#widget'); await page.waitForTimeout(500); await page.click('#expand'); await page.mouse.move(5, 5);
    await page.click('#tasks li:nth-child(1) .task-playback'); await page.waitForTimeout(500);
    const picker = await rect(page, '.row-picker');
    ok(tag + 'row picker within the window', picker && picker.bottom <= H + 0.5, JSON.stringify(picker));
    await page.click('.row-picker .primary'); await page.waitForTimeout(800);
    const widget = await rect(page, '#widget');
    ok(tag + 'widget within the window with a focused row', inside(widget, H), JSON.stringify(widget));
    ok(tag + 'New Task footer visible', inside(await rect(page, '#different'), H), JSON.stringify(await rect(page, '#different')));
    const body = await page.evaluate(() => { const b = document.querySelector('.widget-body'); b.scrollTop = b.scrollHeight; const rows = b.querySelectorAll('#tasks > li.task'); const l = b.getBoundingClientRect(), r = rows[rows.length - 1].getBoundingClientRect(); return {scrolls: b.scrollHeight > b.clientHeight, lastVisible: r.top >= l.top - 1 && r.bottom <= l.bottom + 1}; });
    ok(tag + 'task list scrolls to its last row', body.lastVisible, JSON.stringify(body));
    const fw = await page.evaluate(() => { const l = document.querySelector('.focus-windows'); return {h: l.getBoundingClientRect().height, scrolls: l.scrollHeight > l.clientHeight}; });
    ok(tag + 'window list is capped and scrolls (30 windows)', fw.h <= 125 && fw.scrolls, JSON.stringify(fw));
  }
  return {results, failed: results.filter(r => !r.ok).length};
}
