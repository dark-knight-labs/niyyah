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

test('captureFor sends only what Niyyah can store', () => {
  assert.deepEqual(T.captureFor('Call the bank', 'next', 'OT', 'alisha'),
    {text: 'Call the bank', lane: 'next', stream: 'OT', product: 'alisha', client_id: null});
  assert.equal(T.captureFor('x', 'now', 'OT', '', 'uuid-1').client_id, 'uuid-1');
  assert.deepEqual(T.captureFor('x', 'now', 'OT', ''), {text: 'x', lane: 'now', stream: 'OT', product: null, client_id: null});
  assert.deepEqual(Object.keys(T.captureFor('x', 'now', 'OT', '')).sort(), ['client_id', 'lane', 'product', 'stream', 'text']);
});

const target = {app: 'Safari', bundleId: 'com.apple.Safari', title: 'Docs'};

test('focus session: count-up and countdown', () => {
  const up = T.newSession({id: 't1', name: 'Write'}, target, 'up', 25, 1000);
  assert.equal(up.durationMs, 0);
  assert.equal(T.focusShown(T.focusTick(up, 5000)), 5000);
  assert.equal(T.focusFinished(T.focusTick(up, 9e9)), false, 'count-up never finishes by itself');
  const down = T.newSession({id: 't1', name: 'Write'}, target, 'down', 25, 1000);
  assert.equal(down.durationMs, 25 * 60000);
  assert.equal(T.focusShown(T.focusTick(down, 60000)), 24 * 60000);
  assert.equal(T.focusFinished(T.focusTick(down, 25 * 60000 - 1)), false);
  assert.equal(T.focusFinished(T.focusTick(down, 25 * 60000)), true);
  assert.equal(T.focusShown(T.focusTick(down, 99 * 60000)), 0, 'never negative');
});

test('focus session: away time and away count', () => {
  let s = T.newSession({id: 't1', name: 'Write'}, target, 'up', 0, 0);
  s = T.focusTick(s, 3000);
  s = T.focusState(s, 'away');
  s = T.focusTick(s, 4000);
  s = T.focusState(s, 'away');
  assert.equal(s.awayCount, 1, 'same state twice counts once');
  s = T.focusState(s, 'on');
  s = T.focusTick(s, 1000);
  s = T.focusState(s, 'lost');
  s = T.focusTick(s, 2000);
  assert.deepEqual([s.elapsedMs, s.awayMs, s.awayCount], [10000, 6000, 2]);
  assert.equal(T.focusTick(s, 0), s);
  assert.equal(T.focusTick(s, -5), s);
});

test('focus record: shape that will sync, countdown capped at its length', () => {
  let s = T.newSession({id: 't1', name: 'Write'}, target, 'down', 1, 100);
  s = T.focusTick(s, 61000);
  assert.deepEqual(T.focusRecord(s, 200), {
    task_id: 't1', client_id: 't1', task: 'Write', app: 'Safari', window: 'Docs', mode: 'down',
    started_at: 100, ended_at: 200, duration_ms: 60000, away_ms: 0, away_count: 0, completed: true,
  });
  const none = T.newSession({id: 't2', name: 'x'}, {app: 'Notes', bundleId: 'n', title: ''}, 'up', 0, 1);
  assert.equal(T.focusRecord(none, 2).window, null);
});

test('trayTitle: timer, away and closed states, long names clipped', () => {
  let s = T.newSession({id: 't1', name: 'Write the quarterly report for finance'}, target, 'up', 0, 0);
  s = T.focusTick(s, 754000);
  assert.equal(T.trayTitle(s, 'x'), '12:34 · Write the quarterly r…');
  assert.equal(T.trayTitle(T.focusState(s, 'away'), 'x').startsWith('Away · 12:34'), true);
  assert.equal(T.trayTitle(T.focusState(s, 'lost'), 'x').startsWith('Window closed · '), true);
  assert.equal(T.trayTitle(null, 'Call the bank'), 'Call the bank');
  assert.equal(T.trayTitle(null, undefined), '');
});

test('pickBlock: block fills its products, product survives only inside its block', () => {
  const blocks = [
    {value: 'soul', tile: 'SOUL', products: [{slug: 'quran', name: 'Quran'}]},
    {value: 'ops', tile: 'OPS', products: [{slug: 'alisha', name: 'Alisha'}, {slug: 'quran', name: 'Quran'}]},
    {value: 'one', tile: 'ONE', products: []},
  ];
  assert.deepEqual(T.pickBlock(blocks, 'ops', null).products.map(p => p.slug), ['alisha', 'quran']);
  assert.equal(T.pickBlock(blocks, 'ops', 'alisha').product, 'alisha');
  assert.equal(T.pickBlock(blocks, 'soul', 'alisha').product, null, 'alisha is not a SOUL product');
  assert.equal(T.pickBlock(blocks, 'ops', 'quran').product, 'quran');
  assert.equal(T.pickBlock(blocks, 'soul', 'quran').product, 'quran', 'kept when the new block has it too');
  assert.equal(T.pickBlock(blocks, 'one', 'quran').products.length, 0);
  assert.equal(T.pickBlock(blocks, 'missing', null).block, 'soul', 'unknown value falls back to the first block');
  assert.deepEqual(T.pickBlock([], 'x', null), {block: null, product: null, products: []});
  assert.deepEqual(T.LANES, ['now', 'next', 'backlog']);
});
