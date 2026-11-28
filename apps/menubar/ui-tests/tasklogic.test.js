'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../ui/tasklogic.js');

test('webLink accepts only plain http(s) links', () => {
  assert.equal(T.webLink('https://example.com/a b'), 'https://example.com/a%20b');
  assert.equal(T.webLink('http://localhost:8080'), 'http://localhost:8080/');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'ftp://h/x', 'mailto:a@b.c',
    'https://user@example.com', 'https://user:pw@example.com', 'example.com', '', 'not a url', undefined, null]) {
    assert.equal(T.webLink(bad), '', String(bad));
  }
});

test('formatStamp: m:ss then h:mm:ss', () => {
  assert.equal(T.formatStamp(0), '0:00');
  assert.equal(T.formatStamp(999), '0:00');
  assert.equal(T.formatStamp(61000), '1:01');
  assert.equal(T.formatStamp(3599000), '59:59');
  assert.equal(T.formatStamp(3600000), '1:00:00');
  assert.equal(T.formatStamp(3 * 3600000 + 7 * 60000 + 9000), '3:07:09');
  assert.equal(T.formatStamp(undefined), '0:00');
  assert.equal(T.formatStamp(-5), '0:00');
});

test('creditDelta: desktop clock counts any positive step, browser clock drops gaps over 2.5 s', () => {
  assert.equal(T.creditDelta(1000, 2000, true), 1000);
  assert.equal(T.creditDelta(1000, 61000, true), 60000);
  assert.equal(T.creditDelta(1000, 61000, false), 0);
  assert.equal(T.creditDelta(1000, 3500, false), 2500);
  assert.equal(T.creditDelta(2000, 2000, true), 0);
  assert.equal(T.creditDelta(3000, 2000, true), 0);
  assert.equal(T.creditDelta(NaN, 2000, true), 0);
  assert.equal(T.creditDelta(1000, undefined, true), 0);
});

test('addTracked accumulates onto the saved total', () => {
  assert.equal(T.addTracked({trackedMs: 12000}, 0, 1000, true), 13000);
  assert.equal(T.addTracked({}, 0, 1000, true), 1000);
  assert.equal(T.addTracked({trackedMs: 5}, 1000, 900, true), 5);
});

test('isDueSoon: inside the last three hours only, never for done or undated tasks', () => {
  const now = 1_000_000_000;
  const h = 3600000;
  assert.equal(T.isDueSoon({deadlineAt: now + 2 * h}, now), true);
  assert.equal(T.isDueSoon({deadlineAt: now + 3 * h}, now), true);
  assert.equal(T.isDueSoon({deadlineAt: now + 3 * h + 1}, now), false);
  assert.equal(T.isDueSoon({deadlineAt: now}, now), true);
  assert.equal(T.isDueSoon({deadlineAt: now - 1}, now), false);
  assert.equal(T.isDueSoon({deadlineAt: now + h, done: true}, now), false);
  assert.equal(T.isDueSoon({deadlineAt: null}, now), false);
  assert.equal(T.isDueSoon({}, now), false);
  assert.equal(T.isDueSoon(undefined, now), false);
});

test('moveTask reorders but never moves or displaces the running task', () => {
  const list = [{id: 'run', startedAt: 1}, {id: 'a'}, {id: 'b'}, {id: 'c'}];
  assert.deepEqual(T.moveTask(list, 'c', 'a').map(t => t.id), ['run', 'c', 'a', 'b']);
  assert.deepEqual(T.moveTask(list, 'a', 'c').map(t => t.id), ['run', 'b', 'c', 'a']);
  assert.equal(T.moveTask(list, 'run', 'b'), list);
  assert.equal(T.moveTask(list, 'a', 'run'), list);
  assert.equal(T.moveTask(list, 'a', 'zzz'), list);
  assert.equal(list.map(t => t.id).join(), 'run,a,b,c', 'input is not mutated');
});

test('cycleTarget wraps both ways and starts at the ends when nothing runs', () => {
  assert.equal(T.cycleTarget([1, 2, 3], 0, 1), 1);
  assert.equal(T.cycleTarget([1, 2, 3], 2, 1), 0);
  assert.equal(T.cycleTarget([1, 2, 3], 0, -1), 2);
  assert.equal(T.cycleTarget([1, 2, 3], -1, 1), 0);
  assert.equal(T.cycleTarget([1, 2, 3], -1, -1), 2);
  assert.equal(T.cycleTarget([], -1, 1), -1);
});

test('namesFrom: one name in single mode, one per line in bulk mode', () => {
  assert.deepEqual(T.namesFrom('  one  \n two ', true), ['one  \n two']);
  assert.deepEqual(T.namesFrom(' a \n\n b \n  \n', false), ['a', 'b']);
  assert.deepEqual(T.namesFrom('   ', true), []);
});

test('captureFor sends only what Niyyah can store: text, stream, products, client id. No lane.', () => {
  assert.deepEqual(T.captureFor('Call the bank', 'kahf', ['dns', 'cart', 'dns'], 'u1'),
    {text: 'Call the bank', stream: 'kahf', products: ['dns', 'cart'], client_id: 'u1'});
  assert.deepEqual(T.captureFor('x', 'kahf', [], ''), {text: 'x', stream: 'kahf', products: [], client_id: null});
  assert.deepEqual(T.captureFor('x', 'kahf', undefined), {text: 'x', stream: 'kahf', products: [], client_id: null});
  assert.deepEqual(Object.keys(T.captureFor('x', 'kahf', [])).sort(), ['client_id', 'products', 'stream', 'text']);
});

const streams = [
  {value: 'kahf', label: 'Kahf', products: [{slug: 'dns', name: 'DNS'}]},
  {value: 'alisha', label: 'Alisha Noor', products: [{slug: 'dns', name: 'DNS'}, {slug: 'store', name: 'Store'}, {slug: 'cart', name: 'Cart'}]},
  {value: 'solo', label: 'Solo', products: []},
];

test('pickStream: products are optional and follow the stream; nothing preselected', () => {
  assert.deepEqual(T.pickStream(streams, 'kahf', []).products, []);
  assert.deepEqual(T.pickStream(streams, 'alisha', []).available.map(p => p.slug), ['dns', 'store', 'cart']);
  assert.deepEqual(T.pickStream(streams, 'alisha', ['store', 'cart']).products, ['store', 'cart']);
  assert.deepEqual(T.pickStream(streams, 'kahf', ['store', 'dns']).products, ['dns'], 'store is not a Kahf product');
  assert.deepEqual(T.pickStream(streams, 'solo', ['dns']).products, []);
  assert.equal(T.pickStream(streams, 'solo', []).available.length, 0, 'a stream alone is enough');
  assert.equal(T.pickStream(streams, 'missing', []).stream, 'kahf', 'unknown value falls back to the first stream');
  assert.deepEqual(T.pickStream([], 'x', []), {stream: null, products: [], available: []});
});

const task = {id: 't1', name: 'Write the report'};
const safari = {app: 'Safari', bundleId: 'com.apple.Safari', title: 'Quarterly report'};
const notes = {app: 'Notes', bundleId: 'com.apple.Notes', title: 'Outline'};
const slack = {app: 'Slack', bundleId: 'com.tinyspeck', title: ''};

test('session: count-up and countdown', () => {
  const up = T.newSession(task, safari, [], 'up', 25, 1000);
  assert.equal(up.durationMs, 0);
  assert.equal(T.focusShown(T.focusTick(up, 5000)), 5000);
  assert.equal(T.focusFinished(T.focusTick(up, 9e9)), false);
  const down = T.newSession(task, safari, [], 'down', 25, 1000);
  assert.equal(T.focusShown(T.focusTick(down, 60000)), 24 * 60000);
  assert.equal(T.focusFinished(T.focusTick(down, 25 * 60000)), true);
  assert.equal(T.focusShown(T.focusTick(down, 99 * 60000)), 0);
});

test('session: the timer runs on primary and allowed windows, away time is counted separately, pause freezes it', () => {
  let s = T.newSession(task, safari, [notes], 'up', 0, 0);
  s = T.focusTick(s, 3000);                       // primary
  s = T.focusTick(T.focusState(s, 'allowed'), 4000);   // secondary: still the session, not away
  s = T.focusTick(T.focusState(s, 'away'), 2000); // other window
  s = T.focusTick(T.focusState(s, 'primary'), 1000);
  assert.deepEqual([s.elapsedMs, s.awayMs, s.awayCount], [10000, 2000, 1]);
  assert.equal(T.focusState(s, 'primary'), s, 'same state is a no-op');
  const paused = T.focusPause(s, true);
  assert.equal(T.focusTick(paused, 5000), paused);
  assert.equal(T.focusTick(T.focusPause(paused, false), 5000).elapsedMs, 15000);
  assert.equal(T.focusTick(s, 0), s);
  assert.equal(T.focusTick(s, -5), s);
  const lost = T.focusState(s, 'lost');
  assert.equal(lost.awayCount, 2, 'a closed primary counts as an away event');
});

test('taskEarns: the task is credited on primary and allowed windows only', () => {
  const s = T.newSession(task, safari, [notes], 'up', 0, 0);
  assert.equal(T.taskEarns(null), true, 'no session: the task timer is its own business');
  assert.equal(T.taskEarns(s), true);
  assert.equal(T.taskEarns(T.focusState(s, 'allowed')), true);
  assert.equal(T.taskEarns(T.focusState(s, 'away')), false);
  assert.equal(T.taskEarns(T.focusState(s, 'lost')), false);
  assert.equal(T.taskEarns(T.focusPause(s, true)), false);
});

test('setPrimary: one click; the old primary becomes allowed, so going back and forth is quiet', () => {
  let s = T.newSession(task, safari, [notes], 'up', 0, 0);
  s = T.setPrimary(s, notes);
  assert.deepEqual([s.primary.app, s.allowed.map(w => w.app)], ['Notes', ['Safari']]);
  assert.equal(s.state, 'primary');
  s = T.setPrimary(s, slack);
  assert.deepEqual([s.primary.app, s.allowed.map(w => w.app).sort()], ['Slack', ['Notes', 'Safari']]);
  assert.equal(T.setPrimary(s, slack), s, 'already primary');
});

test('toggleAllowed: add, remove, never the primary', () => {
  let s = T.newSession(task, safari, [], 'up', 0, 0);
  s = T.toggleAllowed(s, notes);
  assert.deepEqual(s.allowed.map(w => w.app), ['Notes']);
  s = T.toggleAllowed(s, notes);
  assert.deepEqual(s.allowed, []);
  assert.equal(T.toggleAllowed(s, safari), s, 'the primary is not an allowed window');
  assert.deepEqual(T.newSession(task, safari, [safari, notes], 'up', 0, 0).allowed.map(w => w.app), ['Notes'], 'primary is dropped from allowed at start');
});

test('windowRows: primary first, then allowed, then the other open windows; vanished ones are closed', () => {
  const s = T.newSession(task, safari, [notes], 'up', 0, 0);
  const listed = [
    {app: 'Safari', bundle_id: 'com.apple.Safari', title: 'Quarterly report'},
    {app: 'Slack', bundle_id: 'com.tinyspeck', title: ''},
  ];
  const rows = T.windowRows(s, listed);
  assert.deepEqual(rows.map(r => [r.app, r.kind, r.closed]), [['Safari', 'primary', false], ['Notes', 'allowed', true], ['Slack', 'other', false]]);
});

test('state mapping: primary, allowed, other -> tray and popup', () => {
  assert.deepEqual(T.presentFor('primary', false), {tray: 'off', shake: false});
  assert.deepEqual(T.presentFor('allowed', false), {tray: 'tint', shake: false});
  assert.deepEqual(T.presentFor('away', false), {tray: 'blink', shake: true});
  assert.deepEqual(T.presentFor('lost', false), {tray: 'blink', shake: true});
});

test('Reduce Motion: static highlights only, no blink, no shake', () => {
  for (const state of ['primary', 'allowed', 'away', 'lost']) {
    const p = T.presentFor(state, true);
    assert.notEqual(p.tray, 'blink', state);
    assert.equal(p.shake, false, state);
  }
  assert.equal(T.presentFor('away', true).tray, 'steady');
  assert.equal(T.presentFor('allowed', true).tray, 'tint');
});

test('record: countdown capped at its length; window names only in the local fields', () => {
  let s = T.newSession(task, safari, [notes], 'down', 1, 100);
  s = T.focusTick(s, 61000);
  const rec = T.focusRecord(s, 200);
  assert.deepEqual(rec, {
    task_id: 't1', client_id: 't1', task: 'Write the report', app: 'Safari', window: 'Quarterly report', allowed_count: 1,
    mode: 'down', started_at: 100, ended_at: 200, duration_ms: 60000, away_ms: 0, away_count: 0, completed: true,
  });
  assert.equal(T.focusRecord(T.newSession(task, slack, [], 'up', 0, 1), 2).window, null);
});

test('no window name leaves the Mac: syncable record and capture payload carry none', () => {
  let s = T.newSession(task, safari, [notes], 'up', 0, 0);
  s = T.focusTick(s, 5000);
  const wire = JSON.stringify([T.syncable(T.focusRecord(s, 9)), T.captureFor(task.name, 'kahf', ['dns'], task.id)]);
  for (const secret of ['Safari', 'Quarterly report', 'Notes', 'Outline', 'com.apple', 'window', '"app"', 'title', 'bundle']) {
    assert.equal(wire.includes(secret), false, secret + ' leaked: ' + wire);
  }
  assert.ok(wire.includes('Write the report') && wire.includes('duration_ms'));
});

test('trayTitle: only a timer while a session runs, never a window title or task text', () => {
  let s = T.newSession({id: 't1', name: 'Secret client work'}, {app: 'Safari', bundleId: 'b', title: 'chorki.net invalid response'}, [], 'up', 0, 0);
  s = T.focusTick(s, 754000);
  assert.equal(T.trayTitle(s), '12:34');
  assert.equal(T.trayTitle(T.focusState(s, 'away')), '12:34', 'the nudge is the icon, not text');
  assert.equal(T.trayTitle(null), '');
  const down = T.focusTick(T.newSession(task, safari, [], 'down', 25, 0), 60000);
  assert.equal(T.trayTitle(down), '24:00');
  assert.equal(/chorki|Secret|Safari/.test(T.trayTitle(s)), false);
});

test('readFocusOptions: one primary, allowed never includes it, minutes clamped, countdown only when asked', () => {
  const windows = [
    {app: 'Safari', bundle_id: 'com.apple.Safari', title: 'Quarterly report'},
    {app: 'Notes', bundle_id: 'com.apple.Notes', title: 'Outline'},
    {app: 'Slack', bundle_id: 'com.tinyspeck', title: ''},
  ];
  const o = T.readFocusOptions(windows, 0, [0, 1, 1, 2, 9, -1], 'down', 500);
  assert.deepEqual(o.primary, {app: 'Safari', bundleId: 'com.apple.Safari', title: 'Quarterly report'});
  assert.deepEqual(o.allowed.map(w => w.app), ['Notes', 'Slack'], 'no primary, no duplicates, no out-of-range');
  assert.deepEqual([o.mode, o.minutes], ['down', 240]);
  assert.deepEqual([T.readFocusOptions(windows, 1, [], 'up', 5).mode, T.readFocusOptions(windows, 1, [], 'up', 5).minutes], ['up', 0]);
  assert.equal(T.readFocusOptions(windows, 0, [], 'down', 'x').minutes, 25, 'a bad number falls back to 25');
  assert.equal(T.readFocusOptions(windows, 7, [], 'up', 1), null, 'no valid primary, no focus');
  assert.equal(T.readFocusOptions([], 0, [], 'up', 1), null);
});
