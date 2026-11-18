import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { start } from '../miniapp/node/server.mjs';

const python = process.env.PYTHON || 'python3';
const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./python', import.meta.url));
const BRANCHY = '11111111-aaaa-4bbb-8ccc-000000000001';
const FILES = '22222222-aaaa-4bbb-8ccc-000000000002';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test('apply exposes live progress and landed rows; the project lookup and undo work through the runtime', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-server-'));
  const home = join(root, 'home');
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PATH: process.env.PATH };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const controller = new AbortController();
  context.after(async () => {
    controller.abort();
    Object.assign(process.env, saved);
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(home, '.minimax', 'v2', 'sqlite'), { recursive: true });
  const zip = join(root, 'export.zip');
  execFileSync(python, ['-c', `
import sqlite3, sys
sys.path.insert(0, sys.argv[1])
import fixture
from pathlib import Path
fixture.write_export(Path(sys.argv[2]), fixture.sessions())
db = sqlite3.connect(sys.argv[3]); db.executescript(fixture.TARGET_SCHEMA); db.close()
`, FIXTURES, zip, join(home, '.minimax', 'v2', 'sqlite', 'runtime-state.sqlite')]);

  const port = await freePort();
  const dataDir = join(root, 'miniapp-data');
  const logs = [];
  const runtime = await start({
    dataDir,
    pluginRoot: PACKAGE,
    listen: { host: '127.0.0.1', port },
    signal: controller.signal,
    logger: { info: () => {}, warn: (message) => logs.push(message), error: () => {} },
  });
  context.after(() => runtime.dispose());
  const base = `http://127.0.0.1:${port}`;
  const call = async (path, options = {}) => {
    const response = await fetch(base + path, options);
    return { status: response.status, body: await response.json() };
  };

  const icon = await fetch(`${base}/assets/icon.png`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/png');

  // On a fresh page load, before any upload, the header button already has a target.
  const fresh = await call('/api/project');
  assert.equal(fresh.status, 200);
  assert.deepEqual([fresh.body.sessionCount, fresh.body.latestSessionId, fresh.body.source], [0, null, 'database']);

  assert.equal((await call('/api/source', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: await readFile(zip) })).status, 200);
  const sessions = [{ id: BRANCHY, stableId: 'stable-a' }, { id: FILES, stableId: 'stable-b' }];
  const plan = await call('/api/migration/plan', { method: 'POST', body: JSON.stringify({ sessions }) });
  assert.equal(plan.status, 200);
  assert.equal(plan.body.summary.planned, 2);
  assert.equal((await call(`/api/migration/progress?planId=${plan.body.planId}`)).status, 404);

  const applying = call('/api/migration/apply', { method: 'POST', body: JSON.stringify({ planId: plan.body.planId }) });
  const seen = [];
  let applied;
  applying.then((value) => { applied = value; });
  while (!applied) {
    const progress = await call(`/api/migration/progress?planId=${plan.body.planId}`);
    if (progress.status === 200) seen.push(progress.body.phase);
    const second = await call('/api/migration/apply', { method: 'POST', body: JSON.stringify({ planId: plan.body.planId }) });
    if (!applied) assert.ok(second.status === 409, 'a second apply of a running plan is refused');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(applied.status, 200);
  assert.deepEqual(applied.body.imported.sort(), ['stable-a', 'stable-b']);
  assert.equal(applied.body.summary.succeeded, 2);
  assert.ok(seen.length > 0);
  for (const phase of seen) assert.ok(['starting', 'backup', 'importing', 'done'].includes(phase), phase);

  const final = await call(`/api/migration/progress?planId=${plan.body.planId}`);
  assert.equal(final.body.phase, 'done');
  assert.equal(final.body.done, final.body.total);
  assert.deepEqual(final.body.imported.sort(), ['stable-a', 'stable-b']);
  assert.deepEqual(final.body.sessions.map((item) => item.status), ['success', 'success']);
  const state = JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8'));
  assert.match(state.imported['stable-a'].targetSessionId, /^mvs_[0-9a-f]{32}$/);
  assert.deepEqual((await call('/api/state')).body.imported.sort(), ['stable-a', 'stable-b']);
  assert.ok(applied.body.runId);
  assert.match(applied.body.undo, /undo\.json$/);

  const project = await call('/api/project');
  assert.equal(project.body.sessionCount, 2);
  assert.ok(applied.body.sessions.map((item) => item.targetSessionId).includes(project.body.latestSessionId));

  const undone = await call('/api/migration/undo', { method: 'POST', body: JSON.stringify({ runId: applied.body.runId }) });
  assert.equal(undone.status, 200);
  assert.equal(undone.body.removed, 2);
  assert.deepEqual(undone.body.undone.sort(), ['stable-a', 'stable-b']);
  assert.deepEqual((await call('/api/state')).body.imported, []);
  assert.equal((await call('/api/project')).body.sessionCount, 0);
  const again = await call('/api/migration/undo', { method: 'POST', body: JSON.stringify({ runId: applied.body.runId }) });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'run_not_found');
  assert.deepEqual(logs, []);
});
