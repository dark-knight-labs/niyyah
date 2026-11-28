'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../ui/dropdown.js');

const opts = ['Soul', 'Body', 'Kahf', 'Alisha Noor', 'Distribution', 'FnF', 'Finance', 'One Thing', 'Operations', 'Plan']
  .map(label => ({value: label.toLowerCase(), label}));

test('filterOptions: case-insensitive contains, keeps order, empty query keeps all', () => {
  assert.equal(D.filterOptions(opts, '').length, 10);
  assert.deepEqual(D.filterOptions(opts, 'fin').map(i => opts[i].label), ['Finance']);
  assert.deepEqual(D.filterOptions(opts, 'O').map(i => opts[i].label), ['Soul', 'Body', 'Alisha Noor', 'Distribution', 'One Thing', 'Operations']);
  assert.deepEqual(D.filterOptions(opts, 'zzz'), []);
  assert.deepEqual(D.filterOptions(opts, '  kahf  ').length, 1);
});

test('needsSearch: only above eight options', () => {
  assert.equal(D.needsSearch(8), false);
  assert.equal(D.needsSearch(9), true);
  assert.equal(D.needsSearch(20), true);
});

test('stepActive: clamps at the ends, starts at an end when nothing is active', () => {
  const visible = [2, 4, 7];
  assert.equal(D.stepActive(visible, -1, 1), 2);
  assert.equal(D.stepActive(visible, -1, -1), 7);
  assert.equal(D.stepActive(visible, 2, 1), 4);
  assert.equal(D.stepActive(visible, 7, 1), 7, 'no wrap past the last');
  assert.equal(D.stepActive(visible, 2, -1), 2, 'no wrap before the first');
  assert.equal(D.stepActive([], 0, 1), -1);
  assert.equal(D.stepActive(visible, 3, 1), 2, 'an active option that is filtered out restarts at the first');
});

test('typeahead: next label starting with what you typed; the same letter cycles', () => {
  const all = opts.map((_, i) => i);
  assert.equal(opts[D.typeahead(opts, all, 'k', -1)].label, 'Kahf');
  assert.equal(opts[D.typeahead(opts, all, 'di', -1)].label, 'Distribution');
  assert.equal(opts[D.typeahead(opts, all, 'f', -1)].label, 'FnF');
  assert.equal(opts[D.typeahead(opts, all, 'f', 5)].label, 'Finance', 'pressing f again moves on');
  assert.equal(opts[D.typeahead(opts, all, 'f', 6)].label, 'FnF', 'and wraps');
  assert.equal(opts[D.typeahead(opts, all, 'ff', 5)].label, 'Finance', 'a repeated letter is a cycle, not a prefix');
  assert.equal(D.typeahead(opts, all, 'q', -1), -1);
  assert.equal(D.typeahead(opts, [], 'k', -1), -1);
  assert.equal(D.typeahead(opts, all, '', -1), -1);
});

test('summarize: placeholder, one, two, and +N for more', () => {
  const sel = values => new Set(values);
  assert.equal(D.summarize(opts, sel([]), 'No stream', false), 'No stream');
  assert.equal(D.summarize(opts, sel(['kahf']), 'x', false), 'Kahf');
  assert.equal(D.summarize(opts, sel(['kahf', 'soul']), 'None', true), 'Soul, Kahf');
  assert.equal(D.summarize(opts, sel(['kahf', 'soul', 'body', 'plan']), 'None', true), 'Soul, Body +2');
  assert.equal(D.summarize(opts, sel(['nope']), 'None', true), 'None');
});
