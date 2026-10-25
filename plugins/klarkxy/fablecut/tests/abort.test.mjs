// @ts-check
// The Host's abort signal stops the Mini App. Its own process, so the app it
// stops is the only one there.

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { startApp } from './helpers.mjs';

/**
 * @param {number} port
 */
function isOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (/** @type {boolean} */ open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

test('the abort signal closes the port', async () => {
  const app = await startApp();
  assert.equal(await isOpen(app.port), true);

  app.controller.abort();

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && (await isOpen(app.port))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await isOpen(app.port), false, 'the abort signal closed the port');
});
