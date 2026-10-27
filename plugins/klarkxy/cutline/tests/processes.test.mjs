import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const processes = require('../miniapp/node/vendor/fablecut/processes.js');

test('shutdown waits for owned child processes and refuses later work', async () => {
  const child = processes.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  const pid = child.pid;
  const closed = once(child, 'close');
  await processes.shutdown();
  await closed;
  assert.throws(() => process.kill(pid, 0));
  assert.throws(() => processes.spawn(process.execPath, ['-v']), /stopping/);
  await processes.shutdown();
});
