import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyProgressEvent,
  BATCH_SIZE,
  buildMigrationArgs,
  createProgress,
  defaultTargetDataDir,
  defaultWorkspace,
  IMPORTER_SCRIPT,
  importerError,
  parseMigrationReport,
  parseProgressLine,
  runMigrationCommand,
} from '../miniapp/node/migration.mjs';
import { folderOpener, openFolder } from '../miniapp/node/open-folder.mjs';

const python = process.env.PYTHON || 'python3';
const FIXTURE = fileURLToPath(new URL('./python/fixture.py', import.meta.url));
const BRANCHY = '11111111-aaaa-4bbb-8ccc-000000000001';
const FILES = '22222222-aaaa-4bbb-8ccc-000000000002';

test('builds the bundled importer command without a shell or plugin lookup', () => {
  assert.match(IMPORTER_SCRIPT, /miniapp[\\/]python[\\/]import_deepseek\.py$/);
  const args = buildMigrationArgs({
    action: 'plan',
    sourcePath: '/tmp/deepseek export.zip',
    sessionIds: ['session-a', 'session-b'],
    reportPath: '/tmp/job.json',
    targetDataDir: '/home/user/.minimax',
    workspace: '/home/user/DeepSeek',
  });
  assert.deepEqual(args, [
    IMPORTER_SCRIPT,
    'plan',
    '--source', '/tmp/deepseek export.zip',
    '--session', 'session-a',
    '--session', 'session-b',
    '--report', '/tmp/job.json',
    '--data-dir', '/home/user/.minimax',
    '--agent', 'mavis',
    '--workspace', '/home/user/DeepSeek',
    '--batch-size', String(BATCH_SIZE),
    '--restore-projects',
  ]);
  assert.throws(() => buildMigrationArgs({ action: 'apply', sourcePath: '/x', sessionIds: ['a'], reportPath: '/r', targetDataDir: '/t', workspace: '/w', batchSize: 0 }));
  assert.throws(() => buildMigrationArgs({ action: 'plan', sourcePath: '/x', sessionIds: ['--all'], reportPath: '/r', targetDataDir: '/t', workspace: '/w' }));
  assert.equal(defaultTargetDataDir('/home/u'), join('/home/u', '.minimax'));
  assert.equal(defaultWorkspace('/home/u'), join('/home/u', 'DeepSeek'));
});

test('maps importer statuses and reads the target id from the plan', () => {
  const result = parseMigrationReport({
    state: 'completed-with-errors',
    batches: [{ status: 'imported', backup: '/b/runtime-state.before.sqlite' }],
    sessions: [
      { sourceId: 'new', status: 'imported', plan: { targetId: 'mvs_new', title: '[From DeepSeek] a', messageCount: 4, warnings: ['w'] } },
      { sourceId: 'old', status: 'already-imported', plan: { targetId: 'mvs_old' } },
      { sourceId: 'ready', status: 'ready', plan: { targetId: 'mvs_ready' } },
      { sourceId: 'bad', status: 'incompatible', error: 'invalid branch' },
      { sourceId: 'boom', status: 'failed', error: 'disk full' },
    ],
  }, ['new', 'old', 'ready', 'bad', 'boom', 'absent']);
  assert.deepEqual(result.sessions.map((item) => item.status), ['success', 'skipped', 'planned', 'failed', 'failed', 'failed']);
  assert.equal(result.sessions[0].targetSessionId, 'mvs_new');
  assert.equal(result.sessions[0].warnings, 1);
  assert.equal(result.sessions[1].targetSessionId, 'mvs_old');
  assert.equal(result.sessions[3].message, 'invalid branch');
  assert.deepEqual(result.summary, { total: 6, planned: 1, succeeded: 1, skipped: 1, failed: 3 });
  assert.deepEqual(result.backups, ['/b/runtime-state.before.sqlite']);
  // One backup per run even when several batches name it.
  assert.deepEqual(parseMigrationReport({ backup: '/run/b.sqlite', batches: [{ backup: '/run/b.sqlite' }, { backup: '/run/b.sqlite' }], sessions: [] }).backups, ['/run/b.sqlite']);
});

test('parses importer progress lines and folds them into page progress', () => {
  assert.equal(parseProgressLine('{"status":"running","report":"/r"}'), null);
  assert.equal(parseProgressLine('Traceback (most recent call last):'), null);
  assert.equal(parseProgressLine('{"event":"progress","sessions":"nope"}').sessions.length, 0);
  const progress = createProgress();
  applyProgressEvent(progress, parseProgressLine('{"event":"start","total":3}'));
  assert.deepEqual([progress.phase, progress.done, progress.total], ['starting', 0, 3]);
  applyProgressEvent(progress, parseProgressLine('{"event":"backup"}'));
  assert.equal(progress.phase, 'backup');
  applyProgressEvent(progress, parseProgressLine('{"event":"progress","done":2,"total":3,"sessions":[{"sourceId":"a","status":"imported"},{"sourceId":"b","status":"already-imported"}]}'));
  assert.deepEqual([progress.phase, progress.done, progress.total], ['importing', 2, 3]);
  applyProgressEvent(progress, parseProgressLine('{"event":"progress","done":9,"total":3,"sessions":[{"sourceId":"c","status":"failed"}]}'));
  assert.equal(progress.done, 3);
  assert.deepEqual(progress.sessions, { a: 'success', b: 'skipped', c: 'failed' });
});

test('opens the DeepSeek folder with the platform file manager, no shell', async (context) => {
  assert.deepEqual(folderOpener('/Users/u/DeepSeek', 'darwin'), { command: 'open', args: ['/Users/u/DeepSeek'] });
  assert.deepEqual(folderOpener('C:\\Users\\u\\DeepSeek', 'win32'), { command: 'explorer.exe', args: ['C:\\Users\\u\\DeepSeek'] });
  assert.deepEqual(folderOpener('/home/u/DeepSeek', 'linux'), { command: 'xdg-open', args: ['/home/u/DeepSeek'] });
  const root = await mkdtemp(join(tmpdir(), 'deepseek-open-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, shell: options.shell });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  await openFolder(root, { platform: 'darwin', spawnImpl });
  assert.deepEqual(calls, [{ command: 'open', args: [root], shell: false }]);
  await assert.rejects(openFolder(join(root, 'missing'), { platform: 'darwin', spawnImpl }), (error) => error.code === 'folder_missing');
  assert.equal(calls.length, 1);
});

test('extracts the importer JSON error line from stderr', () => {
  assert.equal(importerError('{"status":"running"}\n{"error":"Target agent has no existing session","type":"MigrationError"}'), 'Target agent has no existing session');
  assert.equal(importerError('Traceback\nValueError: x'), 'ValueError: x');
});

test('reports a missing Python interpreter clearly', async () => {
  await assert.rejects(runMigrationCommand({
    python: 'definitely-not-python3-here',
    action: 'plan',
    sourcePath: '/tmp/x.zip',
    sessionIds: ['a'],
    reportPath: '/tmp/never.json',
    targetDataDir: '/tmp',
    workspace: '/tmp',
  }), (error) => error.code === 'python3_not_found' && /Python 3\.9/.test(error.message));
});

test('plans and applies a synthetic export through the bundled importer', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-import-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'upload', 'deepseek-export.zip');
  const targetDataDir = join(root, 'data');
  const workspace = join(root, 'home', 'DeepSeek');
  await mkdir(join(root, 'upload'));
  await mkdir(join(targetDataDir, 'v2', 'sqlite'), { recursive: true });
  execFileSync(python, ['-c', `
import sqlite3, sys
sys.path.insert(0, sys.argv[1])
import fixture
from pathlib import Path
fixture.write_export(Path(sys.argv[2]), fixture.sessions())
db = sqlite3.connect(sys.argv[3]); db.executescript(fixture.TARGET_SCHEMA); db.close()
`, join(FIXTURE, '..'), sourcePath, join(targetDataDir, 'v2', 'sqlite', 'runtime-state.sqlite')]);
  const reportPath = join(root, 'upload', 'job.json');
  const common = { python, sourcePath, sessionIds: [BRANCHY, FILES], reportPath, targetDataDir, workspace };

  const planned = await runMigrationCommand({ ...common, action: 'plan' });
  assert.equal(planned.exitCode, 0);
  assert.deepEqual(planned.summary, { total: 2, planned: 2, succeeded: 0, skipped: 0, failed: 0 });
  assert.equal(planned.sessions[0].title, '[From DeepSeek] 量子计算入门');

  const events = [];
  const applied = await runMigrationCommand({ ...common, action: 'apply', batchSize: 1, onProgress: (event) => events.push(event) });
  assert.equal(applied.ok, true);
  // Each row is reported as soon as its batch commits, after one up-front backup.
  assert.deepEqual(events.map((event) => event.event), ['start', 'backup', 'progress', 'progress']);
  assert.deepEqual(events.slice(2).map((event) => [event.done, event.total]), [[1, 2], [2, 2]]);
  assert.deepEqual(events.slice(2).flatMap((event) => event.sessions.map((item) => item.status)), ['success', 'success']);
  assert.equal(applied.state, 'completed');
  assert.deepEqual(applied.summary, { total: 2, planned: 0, succeeded: 2, skipped: 0, failed: 0 });
  assert.match(applied.sessions[0].targetSessionId, /^mvs_[0-9a-f]{32}$/);
  assert.equal(applied.backups.length, 1);

  // A second upload of the same export gets a fresh report and is skipped, not failed.
  const again = await runMigrationCommand({ ...common, action: 'apply', reportPath: join(root, 'upload', 'job-2.json') });
  assert.equal(again.ok, true);
  assert.deepEqual(again.summary, { total: 2, planned: 0, succeeded: 0, skipped: 2, failed: 0 });
  assert.deepEqual(again.sessions.map((item) => item.targetSessionId), applied.sessions.map((item) => item.targetSessionId));
  assert.match(await readFile(reportPath, 'utf8'), /"state":"completed"/);
});

test('surfaces contract errors as a readable message', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-import-err-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'export.zip');
  execFileSync(python, ['-c', `
import sys
sys.path.insert(0, sys.argv[1])
import fixture
from pathlib import Path
fixture.write_export(Path(sys.argv[2]), fixture.sessions())
`, join(FIXTURE, '..'), sourcePath]);
  await assert.rejects(runMigrationCommand({
    python,
    action: 'plan',
    sourcePath,
    sessionIds: [BRANCHY],
    reportPath: join(root, 'job.json'),
    targetDataDir: join(root, 'missing-data-dir'),
    workspace: join(root, 'DeepSeek'),
  }), (error) => error.code === 'migration_failed' && /data directory/.test(error.message));
});
