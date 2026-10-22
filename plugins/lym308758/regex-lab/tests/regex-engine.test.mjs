// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compile, runMatch, runReplace } from '../miniapp/node/regex-engine.mjs';

test('compile rejects an invalid pattern with an error string', () => {
  const { regex, error } = compile('(', '');
  assert.equal(regex, null);
  assert.ok(typeof error === 'string' && error.length > 0);
});

test('compile accepts a valid pattern', () => {
  const { regex, error } = compile('\\d+', 'g');
  assert.ok(regex instanceof RegExp);
  assert.equal(error, null);
});

test('runMatch finds one match without the global flag', () => {
  const result = runMatch('abc 123 def', '\\d+', '');
  assert.equal(result.ok, true);
  assert.equal(result.global, false);
  assert.equal(result.count, 1);
  assert.equal(result.matches[0].value, '123');
  assert.equal(result.matches[0].index, 4);
  assert.equal(result.matches[0].end, 7);
});

test('runMatch finds every match with the global flag', () => {
  const result = runMatch('a1 b2 c3', '\\d', 'g');
  assert.equal(result.count, 3);
  assert.deepEqual(
    result.matches.map((m) => m.value),
    ['1', '2', '3'],
  );
});

test('runMatch reports numbered and named capture groups', () => {
  const result = runMatch('2024-01', '(?<year>\\d{4})-(\\d{2})', '');
  assert.equal(result.count, 1);
  const m = result.matches[0];
  assert.equal(m.groups[0].value, '2024');
  assert.equal(m.groups[1].value, '01');
  assert.deepEqual(m.namedGroups, { year: '2024' });
});

test('runMatch handles a zero-width match without looping forever', () => {
  const result = runMatch('abc', '\\b', 'g'); // matches at positions 0, 3
  assert.equal(result.ok, true);
  assert.ok(result.count <= 4, `expected a bounded count, got ${result.count}`);
});

test('runMatch returns an error for an invalid regex', () => {
  const result = runMatch('x', '(', 'g');
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
});

test('runReplace applies a numbered-group replacement', () => {
  const result = runReplace('a1 b2', '(\\d)', 'g', '[$1]');
  assert.equal(result.ok, true);
  assert.equal(result.result, 'a[1] b[2]');
});

test('runReplace applies a named-group replacement', () => {
  const result = runReplace('y2024 y2025', '(?<y>\\d{4})', 'g', '[$<y>]');
  assert.equal(result.ok, true);
  assert.equal(result.result, 'y[2024] y[2025]');
});

test('runReplace reports an invalid regex', () => {
  const result = runReplace('x', '(', '', 'y');
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string');
});
