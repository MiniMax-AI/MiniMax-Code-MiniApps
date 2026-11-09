import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { OAUTH_VERIFY_ORIGINS } from '../miniapp/node/auth/constants.mjs';
import { packageRoot } from './helpers.mjs';

async function clientSource() {
  return readFile(join(packageRoot, 'miniapp', 'client', 'index.html'), 'utf8');
}

test('the frameless window declares an OS drag region', async () => {
  const source = await clientSource();
  assert.match(source, /-webkit-app-region: drag/u);

  // The close button sits inside the drag handle and must stay clickable.
  const exit = /\.floatExit \{([\s\S]*?)\n  \}/u.exec(source);
  assert.ok(exit, '.floatExit was not found');
  assert.match(exit[1], /-webkit-app-region: no-drag/u);
});

test('the page can also move the window, because a WebView2 guest ignores the app region', async () => {
  const source = await clientSource();
  // Screen coordinates: the window moves with the pointer, so a client-relative
  // delta would shrink by exactly the distance the window just moved.
  assert.match(source, /startX: event\.screenX/u);
  assert.match(source, /drag\.lastX = event\.screenX/u);
  // One request per frame, and none when the pointer has not moved since the
  // last one.
  assert.match(source, /drag\.sentX === target\.x && drag\.sentY === target\.y/u);
  assert.match(source, /windowHandle\.update\(target\)/u);
});

test('the page and the Node side accept the same verification origins', async () => {
  const source = await clientSource();
  const block = /const VERIFY_ORIGINS = \[([\s\S]*?)\];/.exec(source);
  assert.ok(block, 'VERIFY_ORIGINS not found in the page');
  const pageOrigins = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
  const nodeOrigins = Object.values(OAUTH_VERIFY_ORIGINS).flat().sort();
  assert.deepEqual(pageOrigins, nodeOrigins);
});
