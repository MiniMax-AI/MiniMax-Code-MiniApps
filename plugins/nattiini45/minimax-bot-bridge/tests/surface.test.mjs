import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SURFACE = new URL('../miniapp/client/index.html', import.meta.url);

test('the desktop surface never builds markup from a value', async () => {
  // The surface runs in the bridge's own origin, where the per-process secret and
  // the relay configuration live. Anything it renders as markup is script in that
  // origin, so it may not render markup at all.
  const source = await readFile(SURFACE, 'utf8');

  /** @type {Array<[RegExp, string]>} */
  const forbidden = [
    [/\.innerHTML\s*=/, 'innerHTML'],
    [/\.outerHTML\s*=/, 'outerHTML'],
    [/\.insertAdjacentHTML\s*\(/, 'insertAdjacentHTML'],
    [/document\.write\s*\(/, 'document.write'],
    [/new\s+Function\s*\(/, 'new Function'],
  ];

  for (const [pattern, name] of forbidden) {
    assert.equal(pattern.test(source), false, `the surface uses ${name}`);
  }
});

test('the desktop surface puts remote values into the DOM as text', async () => {
  const source = await readFile(SURFACE, 'utf8');

  // The device name is whatever the phone typed when it paired.
  assert.match(source, /nameLine\.textContent = device\.deviceName/);
  assert.match(source, /versionLine\.textContent = device\.clientVersion/);
  // The error message is whatever the relay or the browser said.
  assert.match(source, /failed\.textContent = error\.message/);
});
