// @ts-check
// The standalone runner: its lock, its refusal to start twice, and its
// independence from the Mini App that prepared the job.
//
// The runner is started here as a child process, exactly the way the Agent is
// told to start it. No browser is needed for these cases: the runner refuses
// before it looks for one.

import test from 'node:test';
import assert from 'node:assert/strict';

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fixtureDir, startApp, PACKAGE_ROOT } from './helpers.mjs';
import { createExportJobs } from '../miniapp/node/export/prepare.mjs';
import { createGate, TOKEN_HEADER } from '../miniapp/node/export/runner.mjs';

const app = await startApp();

/**
 * A data folder with one saved project and one media file.
 *
 * @param {Record<string, any>} [project]
 * @returns {string}
 */
function seedDataDir(project = {}) {
  const dataDir = mkdtempSync(path.join(fixtureDir('export-runner'), 'data-'));
  mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  writeFileSync(path.join(dataDir, 'media', 'clip.mp4'), 'bytes that have to survive the copy');
  const doc = {
    name: 'Fixture',
    width: 320,
    height: 240,
    fps: 15,
    revision: 1,
    media: [{ id: 'm_1', name: 'clip.mp4', kind: 'video', src: '/media/clip.mp4', duration: 2 }],
    clips: [{ id: 'c_1', kind: 'video', track: 'V1', mediaId: 'm_1', start: 0, duration: 2, in: 0 }],
    ...project,
  };
  writeFileSync(path.join(dataDir, 'project.json'), `${JSON.stringify(doc, null, 2)}\n`);
  return dataDir;
}

/**
 * Starts the runner and collects what it says.
 *
 * @param {string} runnerPath
 * @param {string} jobDir
 * @returns {Promise<{ code: number, out: string, err: string }>}
 */
function runRunner(runnerPath, jobDir) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [runnerPath, '--job', jobDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (code) => done({ code: code ?? -1, out, err }));
  });
}

test('the runner refuses a locked job and leaves the state alone', async () => {
  const dataDir = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});

  // An earlier attempt holds the job.
  writeFileSync(
    path.join(job.jobDir, 'runner.lock'),
    `${JSON.stringify({ pid: 4242, attemptId: 'att_old', startedAt: 1 })}\n`,
  );
  const before = readFileSync(path.join(job.jobDir, 'job.json'), 'utf8');

  const result = await runRunner(job.runnerPath, job.jobDir);
  assert.notEqual(result.code, 0, 'the runner does not start');
  assert.match(result.err, /locked/i, 'the runner says why');
  assert.match(result.err, /prepare a new job/i, 'the runner says what to do');
  assert.equal(
    readFileSync(path.join(job.jobDir, 'job.json'), 'utf8'),
    before,
    'a refused attempt does not touch the state',
  );
  assert.equal(
    readFileSync(path.join(job.jobDir, 'runner.lock'), 'utf8').includes('4242'),
    true,
    'the lock of the earlier attempt is left alone',
  );
});

test('the runner refuses a job that already finished', async () => {
  const dataDir = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});
  const stateFile = path.join(job.jobDir, 'job.json');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  writeFileSync(stateFile, `${JSON.stringify({ ...state, status: 'succeeded' }, null, 2)}\n`);

  const result = await runRunner(job.runnerPath, job.jobDir);
  assert.notEqual(result.code, 0, 'the runner does not start');
  assert.match(result.err, /already finished/i);
  assert.match(result.err, /prepare a new job/i);
});

test('the runner refuses a folder that holds no job', async () => {
  const dataDir = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});
  const empty = mkdtempSync(path.join(fixtureDir('export-runner'), 'empty-'));
  const result = await runRunner(job.runnerPath, empty);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /no export job/i);
});

test('the prepared job does not depend on the Mini App that made it', async () => {
  const dataDir = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});

  // Nothing in the job folder names the Mini App's port: the runner opens a
  // port of its own and never asks the Host for one.
  const needle = `:${app.port}`;
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(mjs|js|json|html|css)$/u.test(entry.name)) continue;
      const text = readFileSync(full, 'utf8');
      assert.equal(text.includes(needle), false, `${entry.name} does not name the Mini App's port`);
    }
  };
  walk(job.jobDir);

  // The Mini App goes away; the job still serves its own snapshot.
  await app.dispose();

  const secret = 'd'.repeat(64);
  const snapshot = readFileSync(path.join(job.jobDir, 'project.json'), 'utf8');
  const gate = createGate({
    upstream: {
      handleRequest: async (req, res) => {
        if ((req.url ?? '').startsWith('/api/project')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(snapshot);
          return;
        }
        res.writeHead(500);
        res.end();
      },
    },
    secret,
    job: JSON.parse(readFileSync(path.join(job.jobDir, 'job.json'), 'utf8')),
    roots: {
      client: path.join(job.jobDir, 'client'),
      media: path.join(job.jobDir, 'media'),
      library: path.join(job.jobDir, 'library'),
      exports: path.join(job.jobDir, 'exports'),
    },
    onReport: () => {},
    onClaim: () => true,
  });
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => void gate(req, res));
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/api/project`, {
      headers: { [TOKEN_HEADER]: secret },
    });
    assert.equal(reply.status, 200);
    const doc = await reply.json();
    assert.equal(doc.name, 'Fixture', 'the snapshot is still there');
  } finally {
    await new Promise((done) => server.close(() => done(undefined)));
    server.closeAllConnections?.();
  }
});

test('a large media file is served in parts, not read whole', async () => {
  // 24 MiB of media: a whole-file read would show up in the process.
  const big = path.join(fixtureDir('export-runner'), 'big.mp4');
  const chunk = Buffer.alloc(1024 * 1024, 7);
  const handle = await import('node:fs/promises').then((fs) => fs.open(big, 'w'));
  try {
    for (let i = 0; i < 24; i += 1) await handle.write(chunk);
  } finally {
    await handle.close();
  }
  assert.equal(statSync(big).size, 24 * 1024 * 1024);

  const dataDir = seedDataDir({
    media: [{ id: 'm_1', name: 'big.mp4', kind: 'video', src: '/media/big.mp4', duration: 2 }],
  });
  writeFileSync(path.join(dataDir, 'media', 'big.mp4'), readFileSync(big));
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});

  const secret = 'e'.repeat(64);
  const gate = createGate({
    upstream: { handleRequest: async (req, res) => { res.writeHead(500); res.end(); } },
    secret,
    job: JSON.parse(readFileSync(path.join(job.jobDir, 'job.json'), 'utf8')),
    roots: {
      client: path.join(job.jobDir, 'client'),
      media: path.join(job.jobDir, 'media'),
      library: path.join(job.jobDir, 'library'),
      exports: path.join(job.jobDir, 'exports'),
    },
    onReport: () => {},
    onClaim: () => true,
  });
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => void gate(req, res));
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const before = process.memoryUsage().external;
    const reply = await fetch(`http://127.0.0.1:${port}/media/big.mp4`, {
      headers: { [TOKEN_HEADER]: secret, range: 'bytes=1048576-2097151' },
    });
    assert.equal(reply.status, 206);
    assert.equal(reply.headers.get('content-range'), `bytes 1048576-2097151/${24 * 1024 * 1024}`);
    const body = Buffer.from(await reply.arrayBuffer());
    assert.equal(body.length, 1024 * 1024, 'exactly the requested range arrives');
    const after = process.memoryUsage().external;
    assert.equal(after - before < 16 * 1024 * 1024, true, 'the whole file was not read into memory');
  } finally {
    await new Promise((done) => server.close(() => done(undefined)));
    server.closeAllConnections?.();
  }
});

test.after(async () => {
  await app.dispose();
});
