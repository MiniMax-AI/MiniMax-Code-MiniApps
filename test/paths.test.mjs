import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCoveredBy,
  normalizePluginPath,
  normalizeRoutePath,
  portablePathIssue,
} from '../scripts/lib/paths.mjs';

test('normalizePluginPath strips ./ and rejects non-canonical input', () => {
  assert.deepEqual(normalizePluginPath('./miniapp/client'), { ok: true, value: 'miniapp/client' });
  assert.equal(normalizePluginPath('miniapp//client').ok, false);
  assert.equal(normalizePluginPath('miniapp\\client').ok, false);
  assert.equal(normalizePluginPath('../x').ok, false);
  assert.equal(normalizePluginPath('').ok, false);
  assert.equal(normalizePluginPath(42).ok, false);
});

test('portablePathIssue mirrors the Host rules', () => {
  assert.equal(portablePathIssue('miniapp/node/server.mjs'), undefined);
  assert.equal(portablePathIssue('.minimax-plugin/plugin.json'), undefined);
  assert.match(portablePathIssue('docs/预览.png'), /ASCII/);
  assert.match(portablePathIssue('con.txt'), /reserved on Windows/);
  assert.match(portablePathIssue('a/b.'), /not portable/);
  assert.match(portablePathIssue('a b.txt'), /not portable/);
  assert.match(portablePathIssue(`${'x'.repeat(129)}.txt`), /segment limit/);
  assert.match(portablePathIssue(Array.from({ length: 17 }, () => 'a').join('/')), /too many segments/);
});

test('normalizeRoutePath adds the leading slash and rejects transport syntax', () => {
  assert.deepEqual(normalizeRoutePath('dashboard'), { ok: true, value: '/dashboard' });
  assert.deepEqual(normalizeRoutePath('/dashboard'), { ok: true, value: '/dashboard' });
  assert.equal(normalizeRoutePath('https://x/y').ok, false);
  assert.equal(normalizeRoutePath('/a?b').ok, false);
  assert.equal(normalizeRoutePath('/a#b').ok, false);
  assert.equal(normalizeRoutePath('/a/../b').ok, false);
  assert.equal(normalizeRoutePath('  ').ok, false);
});

test('isCoveredBy matches a root itself and its descendants only', () => {
  assert.equal(isCoveredBy('miniapp/node/server.mjs', ['miniapp/node']), true);
  assert.equal(isCoveredBy('miniapp/node', ['miniapp/node']), true);
  assert.equal(isCoveredBy('miniapp/nodejs/x.mjs', ['miniapp/node']), false);
});
