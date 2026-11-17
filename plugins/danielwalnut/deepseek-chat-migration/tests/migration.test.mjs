import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildMigrationArgs,
  defaultTargetDataDir,
  findMigrationPlugin,
  normalizeTargetDataDir,
  parseMigrationReport,
  runMigrationCommand,
} from '../miniapp/node/migration.mjs';

test('constructs the migration command without a shell', () => {
  const args = buildMigrationArgs({
    scriptPath: '/plugins/agent-session-migration/scripts/migrate.py',
    action: 'plan',
    sourcePath: '/tmp/deepseek export.zip',
    sessionIds: ['session-a', 'session-b'],
    reportPath: '/tmp/plan.json',
    targetDataDir: '/home/user/.minimax',
    agentName: 'code-agent',
  });
  assert.deepEqual(args, [
    '/plugins/agent-session-migration/scripts/migrate.py',
    'plan',
    '--source', 'deepseek',
    '--source-db', '/tmp/deepseek export.zip',
    '--session', 'session-a',
    '--session', 'session-b',
    '--report', '/tmp/plan.json',
    '--target-data-dir', '/home/user/.minimax',
    '--agent', 'code-agent',
  ]);
});

test('parses per-session successes and failures from reports', () => {
  const result = parseMigrationReport({
    sessions: [
      { session_id: 'good', status: 'imported', target_session_id: 'mcode-good' },
      { session_id: 'bad', status: 'failed', error: 'invalid branch' },
    ],
  }, ['good', 'bad'], 'apply');
  assert.deepEqual(result.summary, { total: 2, succeeded: 1, planned: 0, failed: 1 });
  assert.equal(result.sessions[0].targetSessionId, 'mcode-good');
  assert.equal(result.sessions[1].message, 'invalid branch');
});

test('runs plan and apply against a stub migration script', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-migration-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'source.zip');
  const targetDataDir = join(root, 'target');
  await writeFile(sourcePath, 'synthetic zip placeholder');
  const scriptPath = new URL('./fixtures/stub-migrate.py', import.meta.url).pathname;

  for (const action of ['plan', 'apply']) {
    const reportPath = join(root, `${action}.json`);
    const result = await runMigrationCommand({
      scriptPath,
      action,
      sourcePath,
      sessionIds: ['session-a', 'session-b'],
      reportPath,
      targetDataDir,
      agentName: 'code-agent',
    });
    assert.equal(result.ok, true);
    assert.equal(result.report.source, 'deepseek');
    assert.equal(result.report.agent, 'code-agent');
    assert.equal(result.sessions.length, 2);
    assert.equal(result.summary[action === 'plan' ? 'planned' : 'succeeded'], 2);
  }
});

test('finds installed and marketplace-cached migration plugins', async (context) => {
  const home = await mkdtemp(join(tmpdir(), 'deepseek-plugin-home-'));
  context.after(() => rm(home, { recursive: true, force: true }));
  const cached = join(home, '.minimax', 'marketplace-cache', 'versions', 'agent-session-migration');
  await mkdir(join(cached, 'scripts'), { recursive: true });
  await copyFile(new URL('./fixtures/stub-migrate.py', import.meta.url), join(cached, 'scripts', 'migrate.py'));
  assert.equal(await findMigrationPlugin(home), cached);
  assert.equal(defaultTargetDataDir(home), join(home, '.minimax'));
  assert.equal(normalizeTargetDataDir('~/.minimax-alt', home), join(home, '.minimax-alt'));
});
