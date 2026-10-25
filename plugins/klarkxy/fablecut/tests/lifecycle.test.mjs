// @ts-check
// Stopping the Mini App: dispose() closes the port and leaves the state on
// disk.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import net from 'node:net';

import { startApp } from './helpers.mjs';

/**
 * Whether something still listens on the port.
 *
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

test('the app answers before it is stopped', async () => {
  const app = await startApp();
  const response = await fetch(`${app.base}/api/project`);
  assert.equal(response.status, 200);
});

test('the state is on disk while the app runs', async () => {
  const app = await startApp();
  assert.ok(existsSync(`${app.dataDir}/project.json`), 'the project file is in the data directory');
  assert.ok(existsSync(`${app.dataDir}/media`), 'the media folder is there');
});

test('dispose closes the port and keeps the state', async () => {
  const app = await startApp();
  assert.equal(await isOpen(app.port), true);

  await app.lifecycle.dispose();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await isOpen(app.port), false, 'nothing listens on the port any more');

  assert.ok(existsSync(`${app.dataDir}/project.json`), 'the project file is still there');
  assert.ok(existsSync(`${app.dataDir}/media`), 'the media folder is still there');
});

test('dispose is safe to call twice', async () => {
  const app = await startApp();
  await app.lifecycle.dispose();
  await app.lifecycle.dispose();
});
