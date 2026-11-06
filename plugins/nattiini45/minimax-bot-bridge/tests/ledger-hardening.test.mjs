import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { Ledger } from '../miniapp/node/ledger.mjs';

// The scratch root lives in the operating system's temporary directory, so the suite
// runs the same way in the workspace, in a published package and in an installed one.
const root = join(tmpdir(), 'minimax-bot-bridge-tests', 'bridge-execution');
async function fixture() {
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'ledger-'));
  const ledger = await new Ledger(dir).init();
  ledger.recordPermission({ requestId: 'durable', decision: 'deny', toolName: 'shell', deviceId: 'phone' });
  await ledger.persist();
  return { dir, ledger, path: join(dir, 'ledger.json') };
}

test('ledger serializes concurrent admitted records on the real filesystem', async () => {
  const { dir, ledger, path } = await fixture();
  const writes = [];
  for (let i = 0; i < 30; i += 1) {
    ledger.recordPermission({ requestId: `p${i}`, decision: 'deny', toolName: 'x'.repeat(i % 2 ? 8 : 20000), deviceId: 'phone' });
    writes.push(ledger.persist());
  }
  await Promise.all(writes);
  const disk = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(disk.entries.length, 31);
  assert.deepEqual(disk.entries.map(e => e.requestId), ledger.entries.map(e => e.requestId));
  assert.deepEqual(await readdir(dir), ['ledger.json']);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('a blocked first write cannot overlap or overwrite a newer admitted snapshot', async () => {
  const { ledger, path } = await fixture();
  const original = fs.promises.writeFile;
  /** @type {(value?: any) => void} */
  let release = () => {};
  /** @type {(value?: any) => void} */
  let entered = () => {};
  const blocked = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const writes = [];
  fs.promises.writeFile = async (...args) => {
    calls += 1;
    if (calls === 1) { entered(); await gate; }
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    ledger.recordPermission({ requestId: 'first', toolName: 'shell', deviceId: 'phone', decision: 'deny' });
    writes.push(ledger.persist());
    await blocked;
    ledger.recordPermission({ requestId: 'second', toolName: 'shell', deviceId: 'phone', decision: 'deny' });
    writes.push(ledger.persist());
    await new Promise(setImmediate);
    assert.equal(calls, 1, 'the second filesystem write must wait for the first replacement');
  } finally {
    release();
    await Promise.all(writes);
    fs.promises.writeFile = original;
    syncBuiltinESMExports();
  }
  assert.equal(JSON.parse(await readFile(path, 'utf8')).entries.length, 3);
});

test('partial ENOSPC and rename failures preserve the previous valid ledger and do not poison the queue', async () => {
  for (const operation of ['writeFile', 'rename']) {
    const { ledger, path, dir } = await fixture();
    const previous = await readFile(path, 'utf8');
    ledger.recordPermission({ requestId: 'new', decision: 'allowOnce', toolName: 'shell', deviceId: 'phone' });
    const original = fs.promises[operation];
    /** @type {any} */ (fs.promises)[operation] = async (...args) => {
      if (operation === 'writeFile') {
        await original(args[0], String(args[1]).slice(0, 20), args[2]);
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      }
      throw Object.assign(new Error('rename refused'), { code: 'EACCES' });
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(ledger.persist(), { code: operation === 'writeFile' ? 'ENOSPC' : 'EACCES' });
    } finally {
      fs.promises[operation] = original;
      syncBuiltinESMExports();
    }
    assert.equal(await readFile(path, 'utf8'), previous);
    assert.deepEqual(await readdir(dir), ['ledger.json']);
    await ledger.persist();
    assert.equal((await new Ledger(dir).init()).entries.length, 2);
  }
});

test('process death before atomic replacement leaves the previous ledger readable', async () => {
  const { dir, path } = await fixture();
  const previous = await readFile(path, 'utf8');
  const moduleUrl = new URL('../miniapp/node/ledger.mjs', import.meta.url).href;
  const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    import {Ledger} from ${JSON.stringify(moduleUrl)};
    const l = await new Ledger(${JSON.stringify(dir)}).init(); l.recordPermission({requestId:'new'});
    const original = fs.promises.writeFile;
    fs.promises.writeFile = async (path, text, options) => {
      await original(path, text.slice(0, 20), options); process.exit(73);
    }; syncBuiltinESMExports(); await l.persist();`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
  assert.equal(await readFile(path, 'utf8'), previous);
  assert.equal((await new Ledger(dir).init()).entries.length, 1);
});
