import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { ERROR_CODES, LOGIN_FIXABLE_CODES } from '../miniapp/node/errors.mjs';
import { packageRoot } from './helpers.mjs';

async function clientSource() {
  return readFile(join(packageRoot, 'miniapp', 'client', 'index.html'), 'utf8');
}

/** The `errors` tables, English first and Chinese second. */
function errorTables(source) {
  const blocks = [...source.matchAll(/errors: \{([\s\S]*?)\n      \},/gu)].map((match) => match[1]);
  assert.equal(blocks.length, 2, 'expected one errors table per language');
  return blocks.map((block) => [...block.matchAll(/(\w+):\s*'/gu)].map((match) => match[1]));
}

function loginCodes(source) {
  const block = /const LOGIN_CODES = new Set\(\[([\s\S]*?)\]\);/.exec(source);
  assert.ok(block, 'LOGIN_CODES block not found');
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('every code the Node side can report has a message in both languages', async () => {
  const [en, zh] = errorTables(await clientSource());
  for (const code of ERROR_CODES) {
    assert.ok(en.includes(code), `English has no message for ${code}`);
    assert.ok(zh.includes(code), `Chinese has no message for ${code}`);
  }
});

test('the two message tables stay in step', async () => {
  const [en, zh] = errorTables(await clientSource());
  assert.deepEqual([...en].sort(), [...zh].sort());
});

test('the page offers the login for every failure a login can clear', async () => {
  const codes = new Set(loginCodes(await clientSource()));
  for (const code of LOGIN_FIXABLE_CODES) {
    assert.ok(codes.has(code), `page does not offer the login for ${code}`);
  }
});

test('the interface follows the client locale and can be switched', async () => {
  const source = await clientSource();
  assert.match(source, /navigator\.language/u);
  assert.match(source, /data-lang-choice="zh"/u);
  assert.match(source, /data-lang-choice="en"/u);
  assert.match(source, /function localize\(\)/u);
  assert.match(source, /localize\(\);/u);
});

/** The whole STRINGS literal, evaluated: it holds nothing but strings. */
function stringTables(source) {
  const block = /const STRINGS = (\{[\s\S]*?\n  \});/u.exec(source);
  assert.ok(block, 'STRINGS not found');
  return new Function(`return (${block[1]});`)();
}

test('every key the page asks for exists in both languages', async () => {
  const source = await clientSource();
  const tables = stringTables(source);
  const used = new Set([...source.matchAll(/\bt\('([^']+)'/gu)].map((match) => match[1]));
  // These three are reached through THEME_KEYS rather than a literal call.
  for (const key of ['themeAuto', 'themeLight', 'themeDark']) used.add(key);
  for (const key of used) {
    assert.ok(key in tables.en, `English is missing ${key}`);
    assert.ok(key in tables.zh, `Chinese is missing ${key}`);
  }
});
