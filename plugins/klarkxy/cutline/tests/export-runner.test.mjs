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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fixtureDir, sleep, startApp, PACKAGE_ROOT } from './helpers.mjs';
import { createExportJobs } from '../miniapp/node/export/prepare.mjs';
import { createGate, closeBrowser, TOKEN_HEADER, BROWSER_CLOSE_TIMEOUT_MS, BROWSER_LAUNCH_WAIT_MS, TEARDOWN_TIMEOUT_MS } from '../miniapp/node/export/runner.mjs';

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
 * Starts the runner and hands back the child, so a test can act while it
 * works.
 *
 * @param {string} runnerPath
 * @param {string} jobDir
 * @param {Record<string, string>} [env] extra environment for the runner
 * @param {string[]} [args] extra arguments for the runner
 * @returns {{ child: import('node:child_process').ChildProcess, done: Promise<{ code: number, out: string, err: string }> }}
 */
function startRunner(runnerPath, jobDir, env = {}, args = []) {
  const child = spawn(process.execPath, [runnerPath, '--job', jobDir, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (err += chunk));
  const done = new Promise((resolve) => {
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
  });
  return { child, done };
}

/**
 * Starts the runner and collects what it says.
 *
 * @param {string} runnerPath
 * @param {string} jobDir
 * @param {Record<string, string>} [env] extra environment for the runner
 * @param {string[]} [args] extra arguments for the runner
 * @returns {Promise<{ code: number, out: string, err: string }>}
 */
function runRunner(runnerPath, jobDir, env = {}, args = []) {
  return startRunner(runnerPath, jobDir, env, args).done;
}

/**
 * A stand-in for the browser library the runner drives.
 *
 * The test needs a browser that starts late, and one whose close never
 * finishes. The stub writes down what happened to it, so the test can see
 * that the teardown reached the browser.
 *
 * @param {string} file where the stub is written
 */
function writeBrowserStub(file) {
  writeFileSync(
    file,
    [
      '"use strict";',
      '// A stand-in for the browser library the runner drives.',
      'const fs = require("node:fs");',
      'const events = process.env.CUTLINE_TEST_BROWSER_EVENTS || "";',
      'function record(event) {',
      '  if (!events) return;',
      '  try { fs.appendFileSync(events, event + "\\n"); } catch (error) { /* the test reads what is there */ }',
      '}',
      'module.exports = {',
      '  launch: async () => {',
      '    record("launch");',
      '    const delay = Number(process.env.CUTLINE_TEST_BROWSER_DELAY_MS || 0);',
      '    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));',
      '    return {',
      '      close: async () => {',
      '        record("close");',
      '        if (process.env.CUTLINE_TEST_BROWSER_CLOSE_HANGS === "1") {',
      '          // A close that never settles: the runner has to end it.',
      '          await new Promise(() => {});',
      '        }',
      '      },',
      '      process: () => ({',
      '        exitCode: null,',
      '        signalCode: null,',
      '        kill: () => { record("kill"); },',
      '      }),',
      '      newPage: async () => {',
      '        record("newPage");',
      '        if (process.env.CUTLINE_TEST_BROWSER_PAGE_HANGS === "1") {',
      '          // A page that never arrives: the runner waits for it.',
      '          await new Promise(() => {});',
      '        }',
      '        throw new Error("the test stops the render here");',
      '      },',
      '    };',
      '  },',
      '};',
      '',
    ].join('\n'),
  );
}

/**
 * The browser events the stub wrote down.
 *
 * @param {string} file
 * @returns {string[]}
 */
function browserEvents(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean);
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

test('a heartbeat that cannot write the state ends the run cleanly', async () => {
  const dataDir = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});

  const dir = fixtureDir('export-runner');
  const stub = path.join(dir, 'browser-stub.cjs');
  const eventsFile = path.join(dir, `browser-events-heartbeat-${process.pid}-${Date.now()}.txt`);
  writeBrowserStub(stub);
  // The job carries the packaged browser library; this test drives its own.
  rmSync(path.join(job.jobDir, 'runtime', 'puppeteer-core.cjs'), { force: true });

  const { done } = startRunner(job.runnerPath, job.jobDir, {
    // Any file will do: the browser library is the test's own.
    FABLECUT_CHROME: process.execPath,
    FABLECUT_EXPORT_PUPPETEER: stub,
    CUTLINE_TEST_BROWSER_EVENTS: eventsFile,
    // The browser takes longer to start than the first heartbeat.
    CUTLINE_TEST_BROWSER_DELAY_MS: '2500',
  });

  // The runner says it is running; the state file is taken away under it.
  const stateFile = path.join(job.jobDir, 'job.json');
  let running = false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !running) {
    try {
      running = JSON.parse(readFileSync(stateFile, 'utf8')).status === 'running';
    } catch {
      /* it is not written yet */
    }
    if (!running) await sleep(25);
  }
  assert.equal(running, true, 'the runner started');
  rmSync(stateFile, { force: true });

  const result = await done;
  assert.equal(result.code, 4, 'the runner leaves with the failure code');
  assert.match(result.err, /job state could not be read or written/, 'the runner says why it stopped');
  assert.equal(
    /uncaughtException|UnhandledPromiseRejection|ERR_UNHANDLED_REJECTION/i.test(result.err),
    false,
    'the failure is not an uncaught error in a timer',
  );
  assert.match(result.err, /failed/, 'the job is marked failed');

  // The teardown ran: the browser that was still starting is closed, and
  // the profile it was given is gone.
  const events = browserEvents(eventsFile);
  assert.ok(events.includes('close'), 'the browser that was still starting is closed');
  assert.equal(existsSync(path.join(job.jobDir, 'browser-profile')), false, 'the browser profile is gone');
});

test('a browser that never finishes closing is killed, and the teardown ends', async () => {
  const dataDir = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});

  const dir = fixtureDir('export-runner');
  const stub = path.join(dir, 'browser-stub.cjs');
  const eventsFile = path.join(dir, `browser-events-close-${process.pid}-${Date.now()}.txt`);
  writeBrowserStub(stub);
  rmSync(path.join(job.jobDir, 'runtime', 'puppeteer-core.cjs'), { force: true });

  const started = Date.now();
  const result = await runRunner(job.runnerPath, job.jobDir, {
    FABLECUT_CHROME: process.execPath,
    FABLECUT_EXPORT_PUPPETEER: stub,
    CUTLINE_TEST_BROWSER_EVENTS: eventsFile,
    // The close of the browser never finishes.
    CUTLINE_TEST_BROWSER_CLOSE_HANGS: '1',
  });

  assert.equal(result.code, 4, 'the runner leaves with the failure code');
  assert.ok(Date.now() - started < 60_000, 'the runner does not wait for the browser for ever');
  const events = browserEvents(eventsFile);
  assert.ok(events.includes('close'), 'the browser was asked to close');
  assert.ok(events.includes('kill'), 'the browser process was killed');
  assert.equal(existsSync(path.join(job.jobDir, 'browser-profile')), false, 'the browser profile is gone');
});

test('the browser close is bounded, and a browser that hangs is killed', async () => {
  let killed = false;
  const browser = {
    close: () => new Promise(() => {}),
    process: () => ({
      exitCode: null,
      signalCode: null,
      kill: () => {
        killed = true;
      },
    }),
  };

  const started = Date.now();
  const outcome = await closeBrowser(browser);
  assert.equal(outcome, 'timeout', 'the close did not finish');
  assert.equal(killed, true, 'the browser process is killed');
  assert.ok(Date.now() - started < 30_000, 'the close does not wait for ever');
});

test('the teardown bound covers the browser wait and the close', () => {
  assert.ok(
    TEARDOWN_TIMEOUT_MS >= BROWSER_LAUNCH_WAIT_MS + BROWSER_CLOSE_TIMEOUT_MS,
    'the teardown is bounded by at least the launch wait and the close budget together',
  );
});

test('a teardown that hangs still ends the process', async () => {
  const dataDir = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});

  // The runner is copied with three changes, so the test does not have to
  // wait for the real budgets: the overall deadline may fire after a second,
  // the teardown bound is short, and the teardown sticks where the runtime's
  // own processes are stopped. The production code is not touched.
  const runnerSource = readFileSync(path.join(job.jobDir, 'runner', 'runner.mjs'), 'utf8');
  const patched = runnerSource
    .replace('Math.max(30, timeoutSeconds)', 'Math.max(1, timeoutSeconds)')
    .replace(/const TEARDOWN_TIMEOUT_MS = [^;]+;/, 'const TEARDOWN_TIMEOUT_MS = 1500;')
    .replace('await processes.shutdown();', 'await new Promise(() => {});');
  assert.match(patched, /Math\.max\(1, timeoutSeconds\)/, 'the deadline may fire early');
  assert.match(patched, /const TEARDOWN_TIMEOUT_MS = 1500;/, 'the teardown bound is short');
  assert.match(patched, /await new Promise\(\(\) => \{\}\);/, 'the teardown sticks');
  const stuck = path.join(job.jobDir, 'runner', 'runner-stuck.mjs');
  writeFileSync(stuck, patched);

  const dir = fixtureDir('export-runner');
  const stub = path.join(dir, 'browser-stub.cjs');
  const eventsFile = path.join(dir, `browser-events-teardown-${process.pid}-${Date.now()}.txt`);
  writeBrowserStub(stub);
  rmSync(path.join(job.jobDir, 'runtime', 'puppeteer-core.cjs'), { force: true });

  const started = Date.now();
  const result = await runRunner(
    stuck,
    job.jobDir,
    {
      FABLECUT_CHROME: process.execPath,
      FABLECUT_EXPORT_PUPPETEER: stub,
      CUTLINE_TEST_BROWSER_EVENTS: eventsFile,
      // The page never arrives, so the runner is still working when the
      // overall deadline fires.
      CUTLINE_TEST_BROWSER_PAGE_HANGS: '1',
    },
    ['--timeout-seconds', '2'],
  );
  const elapsed = Date.now() - started;

  assert.equal(result.code, 4, 'the runner leaves with the failure code');
  assert.ok(elapsed < 30_000, `the runner did not wait for ever (${elapsed}ms)`);
  assert.match(result.err, /the teardown did not finish in \d+ms/, 'the teardown bound ended the process');
  assert.equal(
    /uncaughtException|UnhandledPromiseRejection|ERR_UNHANDLED_REJECTION/i.test(result.err),
    false,
    'the failure is not an uncaught error',
  );

  const state = JSON.parse(readFileSync(path.join(job.jobDir, 'job.json'), 'utf8'));
  assert.equal(state.status, 'failed', 'the job is marked failed');
});

test.after(async () => {
  await app.dispose();
});
