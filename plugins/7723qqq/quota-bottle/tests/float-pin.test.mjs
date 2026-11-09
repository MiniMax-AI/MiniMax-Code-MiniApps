import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { packageRoot } from './helpers.mjs';

async function clientSource() {
  return readFile(join(packageRoot, 'miniapp', 'client', 'index.html'), 'utf8');
}

/** The body of one `addEventListener('click', ...)` handler. */
function handlerBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} not found`);
  const end = source.indexOf('\n    });', start);
  assert.notEqual(end, -1, `${marker} has no closing line`);
  return source.slice(start, end);
}

test('the panel offers one click to pin the bottle to the desktop', async () => {
  const source = await clientSource();
  assert.equal(source.includes('id="pinBtn"'), true);
  assert.equal(source.includes('id="pin"'), true);
});

test('the pin handler calls update in the same turn as the click', async () => {
  const source = await clientSource();
  const handler = handlerBlock(source, "byId('pinBtn').addEventListener('click'");
  assert.match(handler, /windowHandle\.update\(\{ mode: 'window' \}\)/u);
  // The Host accepts a mode change only inside a user gesture; an `await`
  // before `update` would spend it.
  assert.equal(handler.includes('await'), false);
});

test('the pin offer disappears once the window is up', async () => {
  const source = await clientSource();
  assert.match(source, /byId\('pin'\)\.hidden = next === 'window' \|\| !windowHandle/u);
});

test('the window layout is applied when update resolves, not only through the subscription', async () => {
  const source = await clientSource();
  const pin = handlerBlock(source, "byId('pinBtn').addEventListener('click'");
  assert.match(pin, /\.then\(\(\) => applyMode\('window'\)\)/u);
  const exit = handlerBlock(source, "byId('floatExit').addEventListener('click'");
  assert.match(exit, /\.then\(\(\) => applyMode\('inline'\)\)/u);
});

test('click-through is not offered at all, so a window cannot become unclickable', async () => {
  const source = await clientSource();
  // The Host refuses a flag change from the side panel (inline mode), so a
  // window that turned click-through on had no way back. The feature is gone.
  assert.equal(source.includes('clickThrough'), false);
  assert.equal(source.includes('floatToggle'), false);
  assert.equal(source.includes('passThrough'), false);
});

test('polling follows the mode: five seconds pinned, ten in the panel, one minute hidden', async () => {
  const source = await clientSource();
  assert.match(source, /POLL_WINDOW_MS = 5000/u);
  assert.match(source, /POLL_PANEL_MS = 10000/u);
  assert.match(source, /POLL_HIDDEN_MS = 60000/u);
  assert.match(source, /mode === 'window' \? POLL_WINDOW_MS : POLL_PANEL_MS/u);
  // The old fixed start-up interval would override the mode-aware one.
  assert.equal(source.includes('startPolling(60000)'), false);
});

test('pinning refreshes at once instead of waiting for the first poll', async () => {
  const source = await clientSource();
  assert.match(source, /if \(next === 'window'\) refresh\(false\);/u);
});

test('pinning sends the mode alone, and a size repair only to a resizable window', async () => {
  const source = await clientSource();
  const manifest = JSON.parse(await readFile(join(packageRoot, 'miniapp', 'miniapp.json'), 'utf8'));
  const window = manifest.surface.window;
  assert.equal(window.transparent, true);
  assert.equal(window.frame, false);
  // A non-resizable window is what keeps the transparency on Windows, and the
  // Host refuses a mode switch that carries width/height in that case.
  assert.equal(window.resizable, false);
  assert.equal(window.width, 220);
  assert.equal(window.height, 300);
  assert.match(source, /windowHandle\.update\(\{ mode: 'window' \}\)/u);
  // Repairing a remembered size needs a resizeable window, so it is gated.
  assert.match(source, /win\.resizable === true/u);
  assert.match(source, /windowHandle\.update\(windowPatch\(\)\)/u);
  assert.match(source, /x: Math\.round\(left \+ Math\.max\(0, availWidth - width - 24\)\)/u);
});
