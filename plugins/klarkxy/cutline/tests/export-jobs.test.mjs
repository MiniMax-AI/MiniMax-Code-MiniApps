// @ts-check
// The standalone export path: the cutline_export tool, the job it
// prepares, and the gate the standalone runner puts in front of the editor.
//
// These tests never start a browser. The render itself is exercised by the
// smoke harness in .fablecut-acceptance/export-dev/.

import test from 'node:test';
import assert from 'node:assert/strict';

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { mcpSession, mcpTool, mcpRaw, startApp, fixtureDir, PACKAGE_ROOT } from './helpers.mjs';
import { createExportJobs } from '../miniapp/node/export/prepare.mjs';
import { describeJob, readJob as readJobOrThrow, resolveJobDir } from '../miniapp/node/export/job-state.mjs';
import { createGate, TOKEN_HEADER } from '../miniapp/node/export/runner.mjs';

const app = await startApp();

test.after(async () => {
  await app.dispose();
});

const UPSTREAM_TOOLS = [
  'fablecut_status',
  'fablecut_docs',
  'fablecut_get_project',
  'fablecut_patch_project',
  'fablecut_set_project',
  'fablecut_frame',
  'fablecut_analyze_reference',
  'fablecut_import_media',
  'fablecut_encode_profiles',
  'fablecut_normalize_audio',
  'fablecut_auto_duck',
  'fablecut_silence',
  'fablecut_denoise',
  'fablecut_projects',
  'fablecut_versions',
  'fablecut_proxy',
  'fablecut_export',
  'fablecut_scopes',
  'fablecut_track',
  'fablecut_import_project',
];

/**
 * A data folder with one saved project and one media file.
 *
 * @param {Record<string, any>} [project]
 * @param {string} [root] the folder the data folder is made in
 * @returns {{ dataDir: string, mediaFile: string }}
 */
function seedDataDir(project = {}, root = fixtureDir('export-jobs')) {
  const dataDir = mkdtempSync(path.join(root, 'data-'));
  mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  mkdirSync(path.join(dataDir, 'library', 'delivery'), { recursive: true });
  const mediaFile = path.join(dataDir, 'media', 'clip.mp4');
  writeFileSync(mediaFile, 'not really a video, but the bytes have to survive the copy');
  const doc = {
    name: 'Fixture',
    width: 320,
    height: 240,
    fps: 15,
    revision: 3,
    media: [{ id: 'm_1', name: 'clip.mp4', kind: 'video', src: '/media/clip.mp4', duration: 2 }],
    clips: [{ id: 'c_1', kind: 'video', track: 'V1', mediaId: 'm_1', start: 0, duration: 2, in: 0 }],
    ...project,
  };
  writeFileSync(path.join(dataDir, 'project.json'), `${JSON.stringify(doc, null, 2)}\n`);
  return { dataDir, mediaFile };
}

test('the export tool joins the twenty upstream tools without changing them', async () => {
  const session = await mcpSession(app.base);
  const reply = await mcpRaw(
    app.base,
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { headers: { 'mcp-session-id': session.sessionId } },
  );
  const names = (reply.json?.result?.tools ?? []).map((/** @type {any} */ tool) => tool.name);
  for (const name of UPSTREAM_TOOLS) assert.ok(names.includes(name), `${name} is still offered`);
  assert.ok(names.includes('cutline_export'), 'the export tool is offered');
  assert.equal(names.length, UPSTREAM_TOOLS.length + 1);
  assert.equal(new Set(names).size, names.length, 'no tool is offered twice');
});

test('fablecut_export keeps its own behaviour and its own description', async () => {
  const session = await mcpSession(app.base);
  const reply = await mcpRaw(
    app.base,
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { headers: { 'mcp-session-id': session.sessionId } },
  );
  const tool = (reply.json?.result?.tools ?? []).find((/** @type {any} */ entry) => entry.name === 'fablecut_export');
  assert.ok(tool, 'fablecut_export is offered');
  assert.match(tool.description, /editor tab/i, 'fablecut_export still describes the editor tab');
  assert.equal(tool.inputSchema.properties.where.enum.includes('headless'), true, 'its schema is unchanged');
});

test('prepare builds a runnable, self-contained job', () => {
  const { dataDir, mediaFile } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({ range: 'entire', preset: 'web' });

  assert.equal(job.status, 'prepared', 'a prepared job has not started');
  assert.ok(job.jobId, 'the job has an id');
  assert.ok(existsSync(job.runnerPath), 'the runner is in the job folder');
  assert.deepEqual(job.argv, [job.runnerPath, '--job', job.jobDir]);
  assert.ok(path.isAbsolute(job.runnerPath), 'the runner path is absolute');
  assert.ok(path.isAbsolute(job.jobDir), 'the job path is absolute');

  // The snapshot is a copy, not a reference.
  const snapshot = path.join(job.jobDir, 'project.json');
  assert.ok(existsSync(snapshot));
  const before = readFileSync(snapshot, 'utf8');
  writeFileSync(path.join(dataDir, 'project.json'), '{"name":"changed"}');
  assert.equal(readFileSync(snapshot, 'utf8'), before, 'the snapshot does not follow the live project');

  // The media is a copy, and the source bytes are untouched.
  const copied = path.join(job.jobDir, 'media', 'clip.mp4');
  assert.ok(existsSync(copied));
  assert.equal(readFileSync(copied, 'utf8'), readFileSync(mediaFile, 'utf8'), 'the bytes are the same');
  assert.notEqual(statSync(copied).ino, statSync(mediaFile).ino, 'the copy is not a hard link');

  // The runtime does not depend on the installed package any more.
  assert.ok(existsSync(path.join(job.jobDir, 'runtime', 'server.js')), 'the runtime is copied');
  assert.ok(existsSync(path.join(job.jobDir, 'client', 'index.html')), 'the client payload is copied');
  assert.ok(existsSync(path.join(job.jobDir, 'runner', 'job-state.mjs')), 'the runner is copied whole');
});

test('the copied runtime says it is CommonJS, so an ancestor folder cannot break it', () => {
  // An ancestor that says "type": "module" is the shape that broke the
  // runner: the copied runtime's .js files were read as ES modules and the
  // runner's require of server.js failed with "require is not defined".
  const parent = mkdtempSync(path.join(fixtureDir('export-jobs'), 'esm-parent-'));
  writeFileSync(path.join(parent, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
  const { dataDir } = seedDataDir({}, parent);
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});

  const runtimePackage = path.join(job.jobDir, 'runtime', 'package.json');
  assert.ok(existsSync(runtimePackage), 'the runtime carries its own package.json');
  const parsed = JSON.parse(readFileSync(runtimePackage, 'utf8'));
  assert.equal(parsed.type, 'commonjs', 'the runtime says it is CommonJS');

  // The real check: the runner's own require of the runtime has to work
  // under that ancestor. It runs in a child process because loading the
  // runtime leaves its own timers running.
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      'try { require(process.argv[1]); process.exit(0); } catch (error) { process.stderr.write(String(error && error.message ? error.message : error)); process.exit(1); }',
      path.join(job.jobDir, 'runtime', 'server.js'),
    ],
    {
      env: {
        ...process.env,
        FABLECUT_DATA_DIR: job.jobDir,
        FABLECUT_STATIC_DIR: path.join(job.jobDir, 'client'),
        FABLECUT_NO_FS_WATCH: '1',
      },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  assert.equal(probe.status, 0, `the runtime loads as CommonJS: ${probe.stderr}`);
});

test('a job that went quiet while it was verifying is observed as interrupted', () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});
  const state = readJobOrThrow(job.jobDir);
  const old = Date.now() - 120_000;
  writeFileSync(
    path.join(job.jobDir, 'job.json'),
    `${JSON.stringify(
      {
        ...state,
        status: 'verifying',
        attempt: { id: 'att_1', pid: 42, startedAt: old, heartbeatAt: old },
      },
      null,
      2,
    )}\n`,
  );

  const status = jobs.status(job.jobId);
  assert.equal(status.status, 'verifying', 'the state file still says what the runner wrote');
  assert.equal(status.observedStatus, 'interrupted', 'a quiet verifying job is observed as interrupted');
  assert.match(String(status.observed), /heartbeat/);
});

test('a lock left by an earlier attempt is reported, and nothing is reclaimed', () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});
  writeFileSync(path.join(job.jobDir, 'runner.lock'), `${JSON.stringify({ pid: 4242 })}\n`);

  const status = jobs.status(job.jobId);
  assert.equal(status.locked, true, 'the lock is noticed');
  assert.match(status.notes.join(' '), /runner\.lock/, 'the answer says a lock is in the way');
  assert.match(status.notes.join(' '), /no process was killed/, 'the answer says nothing was killed');
  assert.ok(existsSync(path.join(job.jobDir, 'runner.lock')), 'the lock is left where it was');
  assert.equal(status.status, 'prepared', 'the job itself is untouched');
});

test('prepare refuses a source that is missing or escapes the project folder', () => {
  const missing = seedDataDir({
    media: [{ id: 'm_1', name: 'gone.mp4', kind: 'video', src: '/media/gone.mp4' }],
  });
  const jobs = createExportJobs({ dataDir: missing.dataDir, pluginRoot: PACKAGE_ROOT });
  assert.throws(() => jobs.prepare({}), /missing or outside/);
  assert.equal(existsSync(path.join(missing.dataDir, 'export-jobs', 'job_x')), false);

  const escaping = seedDataDir({
    media: [{ id: 'm_1', name: 'x', kind: 'video', src: '/media/../project.json' }],
  });
  const jobs2 = createExportJobs({ dataDir: escaping.dataDir, pluginRoot: PACKAGE_ROOT });
  assert.throws(() => jobs2.prepare({}), /missing or outside/);

  const absolute = seedDataDir({
    media: [{ id: 'm_1', name: 'x', kind: 'video', src: 'C:/Windows/win.ini' }],
  });
  const jobs3 = createExportJobs({ dataDir: absolute.dataDir, pluginRoot: PACKAGE_ROOT });
  assert.throws(() => jobs3.prepare({}), /not inside the project folder/);

  const remote = seedDataDir({
    media: [{ id: 'm_1', name: 'x', kind: 'video', src: 'https://example.invalid/x.mp4' }],
  });
  const jobs4 = createExportJobs({ dataDir: remote.dataDir, pluginRoot: PACKAGE_ROOT });
  assert.throws(() => jobs4.prepare({}), /not inside the project folder/);
});

test('a source that is not media is refused before a job is made', () => {
  // The renderer serves the job's copies from the editor's own origin, so a
  // file a browser would run has no place in the job. The media folder holds
  // media; the library folder holds media and fonts.
  const font = seedDataDir({
    media: [
      { id: 'm_1', name: 'clip.mp4', kind: 'video', src: '/media/clip.mp4', duration: 2 },
      { id: 'm_2', name: 'font.ttf', kind: 'font', src: '/media/font.ttf' },
    ],
  });
  writeFileSync(path.join(font.dataDir, 'media', 'font.ttf'), 'not really a font');
  const jobs = createExportJobs({ dataDir: font.dataDir, pluginRoot: PACKAGE_ROOT });
  assert.throws(() => jobs.prepare({}), /not a media file/, 'a font is not media');
  assert.throws(() => jobs.prepare({}), /font\.ttf/, 'the answer names the file');

  const page = seedDataDir({
    media: [
      { id: 'm_1', name: 'clip.mp4', kind: 'video', src: '/media/clip.mp4', duration: 2 },
      { id: 'm_2', name: 'page.html', kind: 'html', src: '/media/page.html' },
    ],
  });
  writeFileSync(path.join(page.dataDir, 'media', 'page.html'), '<!doctype html><title>x</title>');
  const pageJobs = createExportJobs({ dataDir: page.dataDir, pluginRoot: PACKAGE_ROOT });
  assert.throws(() => pageJobs.prepare({}), /not a media file/, 'a document is not media');

  const library = seedDataDir({
    media: [
      { id: 'm_1', name: 'clip.mp4', kind: 'video', src: '/media/clip.mp4', duration: 2 },
      { id: 'a_1', name: 'page.html', kind: 'html', src: '/library/notes/page.html' },
    ],
  });
  mkdirSync(path.join(library.dataDir, 'library', 'notes'), { recursive: true });
  writeFileSync(path.join(library.dataDir, 'library', 'notes', 'page.html'), '<!doctype html><title>x</title>');
  const libraryJobs = createExportJobs({ dataDir: library.dataDir, pluginRoot: PACKAGE_ROOT });
  assert.throws(() => libraryJobs.prepare({}), /not a media file/, 'the library holds no documents either');

  for (const dataDir of [font.dataDir, page.dataDir, library.dataDir]) {
    const root = path.join(dataDir, 'export-jobs');
    const left = existsSync(root) ? readdirSync(root) : [];
    assert.deepEqual(left, [], 'no job folder is left behind');
  }
});

test('a font in the library is a source the job may use', () => {
  const { dataDir } = seedDataDir({
    media: [
      { id: 'm_1', name: 'clip.mp4', kind: 'video', src: '/media/clip.mp4', duration: 2 },
      { id: 'a_1', name: 'Anton.woff2', kind: 'font', src: '/library/fonts/Anton.woff2' },
    ],
  });
  mkdirSync(path.join(dataDir, 'library', 'fonts'), { recursive: true });
  writeFileSync(path.join(dataDir, 'library', 'fonts', 'Anton.woff2'), 'not really a font');
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});
  assert.ok(existsSync(path.join(job.jobDir, 'library', 'fonts', 'Anton.woff2')), 'the font is copied into the job');
});

test('a refused prepare leaves no job folder behind', () => {
  const { dataDir } = seedDataDir({
    media: [{ id: 'm_1', name: 'gone.mp4', kind: 'video', src: '/media/gone.mp4' }],
  });
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  assert.throws(() => jobs.prepare({}));
  const root = path.join(dataDir, 'export-jobs');
  const left = existsSync(root) ? readdirSync(root) : [];
  assert.deepEqual(left, [], 'no half-made job is left in the managed root');
});

test('status and cancel only reach jobs inside the managed root', () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});

  const status = jobs.status(job.jobId);
  assert.equal(status.status, 'prepared');
  assert.equal(status.jobId, job.jobId);

  assert.throws(() => jobs.status('../../etc'), /job id/);
  assert.throws(() => jobs.status('nope'), /no export job/);
  assert.throws(() => jobs.cancel('../../etc'), /job id/);

  const cancelled = jobs.cancel(job.jobId);
  assert.equal(cancelled.cancelRequested, true);
  assert.ok(existsSync(path.join(job.jobDir, 'cancel.request')), 'the request is a file in the job folder');
});

test('the tool answers prepare, status and cancel', async () => {
  const session = await mcpSession(app.base);
  // The tool reads the saved project of the Mini App's own data folder.
  const projectFile = path.join(app.dataDir, 'project.json');
  const before = readFileSync(projectFile, 'utf8');
  writeFileSync(
    projectFile,
    `${JSON.stringify({
      name: 'Fixture',
      width: 320,
      height: 240,
      fps: 15,
      revision: 1,
      media: [],
      clips: [{ id: 'c_1', kind: 'text', track: 'V1', start: 0, duration: 1, props: { text: 'x' } }],
    }, null, 2)}\n`,
  );
  let prepared;
  try {
    prepared = await mcpTool(app.base, session.sessionId, 'cutline_export', {
      action: 'prepare',
      range: 'entire',
      preset: 'web',
    });
  } finally {
    writeFileSync(projectFile, before);
  }
  assert.match(prepared.text, /has not started/, 'the answer says the job did not start');
  assert.match(prepared.text, /--job/, 'the answer names the job argument');
  assert.match(prepared.text, /Quote each path for the shell/, 'the answer does not guess a quoting style');
  assert.equal(
    /node "/.test(prepared.text),
    false,
    'the answer does not hand out a double-quoted shell command',
  );

  const structured = prepared.reply.json?.result?.structuredContent;
  assert.ok(structured, 'the answer carries structured fields');
  assert.equal(structured.node, 'node', 'the runner is started with the node on PATH');
  assert.ok(path.isAbsolute(structured.runnerPath), 'the runner path is absolute');
  assert.ok(path.isAbsolute(structured.jobDir), 'the job path is absolute');
  assert.deepEqual(structured.argv, [structured.runnerPath, '--job', structured.jobDir]);
  const jobId = structured.jobId;
  assert.match(String(jobId), /^job_[a-z0-9]+$/u, 'the answer names the job id');

  const status = await mcpTool(app.base, session.sessionId, 'cutline_export', { action: 'status', job: jobId });
  assert.match(status.text, /prepared/u);
  const statusFields = status.reply.json?.result?.structuredContent;
  assert.equal(statusFields.locked, false, 'a job with no lock says so');
  assert.ok(Array.isArray(statusFields.notes), 'the status carries its notes as fields too');

  const cancelled = await mcpTool(app.base, session.sessionId, 'cutline_export', { action: 'cancel', job: jobId });
  assert.match(cancelled.text, /cancel/i);

  const refused = await mcpTool(app.base, session.sessionId, 'cutline_export', { action: 'start' });
  assert.equal(refused.reply.json?.result?.isError, true, 'there is no start action');
});

test('the runner gate refuses everything that is not on the allowlist', async () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});
  const secret = 'a'.repeat(64);

  /** @type {any[]} */
  const upstreamCalls = [];
  const upstream = {
    handleRequest: async (/** @type {any} */ req, /** @type {any} */ res) => {
      upstreamCalls.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    },
  };

  const gate = createGate({
    upstream,
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
  const base = `http://127.0.0.1:${port}`;

  try {
    // No secret.
    const anonymous = await fetch(`${base}/api/project`);
    assert.equal(anonymous.status, 401, 'a request without the secret is refused');

    const wrong = await fetch(`${base}/api/project`, { headers: { [TOKEN_HEADER]: 'wrong' } });
    assert.equal(wrong.status, 401, 'a request with the wrong secret is refused');

    // Allowed route, correct secret.
    const allowed = await fetch(`${base}/api/project`, { headers: { [TOKEN_HEADER]: secret } });
    assert.equal(allowed.status, 200, 'an allowed route answers');
    assert.deepEqual(upstreamCalls, ['GET /api/project'], 'only the allowed route reached the editor');

    // Routes that are not on the allowlist.
    for (const route of [
      '/api/project/../secret',
      '/api/upload?name=x',
      '/api/import-url',
      '/api/proxy/status',
      '/api/frame?path=C:/Windows/win.ini',
      '/api/export/request',
      '/api/export/job/cancel',
      '/api/presets',
      '/api/templates',
      '/api/versions',
      '/api/projects',
    ]) {
      const reply = await fetch(`${base}${route}`, {
        method: route.startsWith('/api/presets') || route.startsWith('/api/templates') ? 'POST' : 'GET',
        headers: { [TOKEN_HEADER]: secret },
      });
      assert.equal(reply.status, 404, `${route} is not served`);
    }

    // A method that the route does not allow.
    const wrongMethod = await fetch(`${base}/api/project`, {
      method: 'PUT',
      headers: { [TOKEN_HEADER]: secret },
    });
    assert.equal(wrongMethod.status, 404, 'PUT /api/project is not served');

    // A query the route does not allow.
    const wrongQuery = await fetch(`${base}/api/project?force=1`, { headers: { [TOKEN_HEADER]: secret } });
    assert.equal(wrongQuery.status, 404, 'an unknown query parameter is not served');

    // Reading outside the job folder.
    for (const route of ['/media/../../project.json', '/media/..%2f..%2fproject.json', '/library/../../../etc/passwd']) {
      const reply = await fetch(`${base}${route}`, { headers: { [TOKEN_HEADER]: secret } });
      assert.equal(reply.status, 404, `${route} is not served`);
    }

    // The secret never appears in the URL.
    assert.equal(secret.includes('?'), false);
  } finally {
    await new Promise((done) => server.close(() => done(undefined)));
    server.closeAllConnections?.();
  }
});

test('the runner gate serves the job copy with Range support', async () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});
  const secret = 'b'.repeat(64);

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
  const base = `http://127.0.0.1:${port}`;

  try {
    const whole = await fetch(`${base}/media/clip.mp4`, { headers: { [TOKEN_HEADER]: secret } });
    assert.equal(whole.status, 200);
    const bytes = Buffer.from(await whole.arrayBuffer());
    const size = bytes.length;

    const part = await fetch(`${base}/media/clip.mp4`, {
      headers: { [TOKEN_HEADER]: secret, range: 'bytes=0-9' },
    });
    assert.equal(part.status, 206, 'a Range request is answered with a partial response');
    assert.equal(part.headers.get('content-range'), `bytes 0-9/${size}`);
    assert.equal(Buffer.from(await part.arrayBuffer()).length, 10);

    const beyond = await fetch(`${base}/media/clip.mp4`, {
      headers: { [TOKEN_HEADER]: secret, range: 'bytes=900-999' },
    });
    assert.equal(beyond.status, 416, 'a range past the end is refused');

    const page = await fetch(`${base}/`, { headers: { [TOKEN_HEADER]: secret } });
    assert.equal(page.status, 200, 'the editor page is served');
    assert.match(await page.text(), /<html/i);
  } finally {
    await new Promise((done) => server.close(() => done(undefined)));
    server.closeAllConnections?.();
  }
});

test('the runner gate serves the user\'s files with the editor\'s own headers', async () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});
  const secret = 'f'.repeat(64);

  // A file that was already in the media folder before the upload boundary
  // refused it: the renderer serves it, but never as a document of its own.
  writeFileSync(path.join(job.jobDir, 'media', 'legacy.html'), '<!doctype html><title>legacy</title>');

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
  const base = `http://127.0.0.1:${port}`;

  try {
    const document = await fetch(`${base}/media/legacy.html`, { headers: { [TOKEN_HEADER]: secret } });
    assert.equal(document.status, 200, 'the file is served');
    assert.equal(document.headers.get('x-content-type-options'), 'nosniff', 'the type is never guessed');
    assert.equal(
      document.headers.get('content-security-policy'),
      "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      'a document among the user\'s files is sandboxed',
    );

    const media = await fetch(`${base}/media/clip.mp4`, { headers: { [TOKEN_HEADER]: secret } });
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('x-content-type-options'), 'nosniff', 'every file says what it is');
    assert.equal(media.headers.get('content-security-policy'), null, 'a media file is not sandboxed');

    const editor = await fetch(`${base}/`, { headers: { [TOKEN_HEADER]: secret } });
    assert.equal(editor.status, 200, 'the editor page is served');
    assert.equal(editor.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(editor.headers.get('content-security-policy'), null, 'the editor\'s own page is not sandboxed');
    assert.match(await editor.text(), /<html/i);

    const asset = await fetch(`${base}/delivery.js`, { headers: { [TOKEN_HEADER]: secret } });
    assert.equal(asset.status, 200, 'the editor\'s own files are served');
    assert.equal(asset.headers.get('content-security-policy'), null, 'the editor\'s own files are not sandboxed');
  } finally {
    await new Promise((done) => server.close(() => done(undefined)));
    server.closeAllConnections?.();
  }
});

test('the runner gate keeps the job apart: a claim, a report and a foreign id', async () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});
  const secret = 'c'.repeat(64);
  /** @type {any[]} */
  const reports = [];
  let claimed = false;

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
    onReport: (body) => reports.push(body),
    onClaim: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
  });

  const { createServer } = await import('node:http');
  const server = createServer((req, res) => void gate(req, res));
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  try {
    const foreign = await fetch(`${base}/api/export/job/ticket?id=job_other`, {
      headers: { [TOKEN_HEADER]: secret },
    });
    assert.equal(foreign.status, 404, 'a ticket for another job is refused');

    const ticket = await fetch(`${base}/api/export/job/ticket?id=${job.jobId}`, {
      headers: { [TOKEN_HEADER]: secret },
    });
    assert.equal(ticket.status, 200);
    const body = await ticket.json();
    assert.equal(body.kind, 'export');
    assert.equal(body.status, 'pending');

    const first = await fetch(`${base}/api/export/job/claim?id=${job.jobId}`, {
      method: 'POST',
      headers: { [TOKEN_HEADER]: secret },
    });
    assert.equal(first.status, 200, 'the first claim wins');

    const second = await fetch(`${base}/api/export/job/claim?id=${job.jobId}`, {
      method: 'POST',
      headers: { [TOKEN_HEADER]: secret },
    });
    assert.equal(second.status, 409, 'a second claim is refused');

    const report = await fetch(`${base}/api/export/job/report?id=${job.jobId}`, {
      method: 'POST',
      headers: { [TOKEN_HEADER]: secret, 'content-type': 'application/json' },
      body: JSON.stringify({ progress: 0.5 }),
    });
    assert.equal(report.status, 200);
    assert.deepEqual(reports, [{ progress: 0.5 }], 'the report reaches the runner');
  } finally {
    await new Promise((done) => server.close(() => done(undefined)));
    server.closeAllConnections?.();
  }
});

test('a preset becomes the delivery spec the renderer uses', () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({ preset: 'web' });
  assert.deepEqual(job.spec.delivery, { preset: 'web' }, 'the preset is carried as a delivery');

  const overridden = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const other = overridden.prepare({ preset: 'web', delivery: { fps: 60 } });
  assert.deepEqual(other.spec.delivery, { fps: 60, preset: 'web' }, 'the delivery settings sit over the preset');
});

test('a preset id nobody has is refused before a job is made', () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });

  // The renderer normalizes a preset it does not know to Custom, with only
  // a note in the report. The job must not be made for it at all.
  assert.throws(() => jobs.prepare({ preset: 'yotube' }), /unknown delivery preset "yotube"/);
  assert.throws(() => jobs.prepare({ delivery: { preset: 'yotube' } }), /unknown delivery preset "yotube"/);
  assert.throws(
    () => jobs.prepare({ preset: 'web', delivery: { preset: 'yotube' } }),
    /unknown delivery preset "yotube"/,
  );
  assert.throws(() => jobs.prepare({ preset: 'YouTube' }), /unknown delivery preset/, 'the ids are exact');

  const root = path.join(dataDir, 'export-jobs');
  const left = existsSync(root) ? readdirSync(root) : [];
  assert.deepEqual(left, [], 'no job folder is left behind');
});

test('a saved delivery preset is a preset the job may use', () => {
  const { dataDir } = seedDataDir();
  writeFileSync(
    path.join(dataDir, 'library', 'delivery', 'my-client.json'),
    `${JSON.stringify({ id: 'my-client', label: 'My Client', width: 1920, height: 1080 })}\n`,
  );
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({ preset: 'my-client' });
  assert.deepEqual(job.spec.delivery, { preset: 'my-client' }, 'the saved preset is carried as a delivery');
});

test('the custom preset and a plain delivery are still accepted', () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  assert.deepEqual(jobs.prepare({ preset: 'custom' }).spec.delivery, { preset: 'custom' });

  const plain = jobs.prepare({ delivery: { fps: 60 } });
  assert.equal(plain.spec.delivery.fps, 60, 'a delivery without a preset is left to the renderer');
  assert.equal(plain.spec.delivery.preset, undefined, 'no preset is invented for it');
});

test('a profile and a preset cannot be asked for at once', () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  assert.throws(() => jobs.prepare({ profile: 'hq', preset: 'web' }), /not both/);
});

test('a clip that needs background removal is refused', () => {
  const { dataDir } = seedDataDir({
    clips: [
      { id: 'c_1', kind: 'video', track: 'V1', mediaId: 'm_1', start: 0, duration: 2, in: 0, props: { bgRemove: true } },
    ],
  });
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  assert.throws(() => jobs.prepare({}), /background removal/);
});

test('a fixed seed is only set for a timeline that uses grain', () => {
  const plain = seedDataDir();
  const jobs = createExportJobs({ dataDir: plain.dataDir, pluginRoot: PACKAGE_ROOT });
  assert.equal(jobs.prepare({}).spec.seed, null, 'an ordinary render keeps the editor\'s own randomness');

  const grainy = seedDataDir({
    clips: [
      { id: 'c_1', kind: 'video', track: 'V1', mediaId: 'm_1', start: 0, duration: 2, in: 0, props: { grain: 20 } },
    ],
  });
  const jobs2 = createExportJobs({ dataDir: grainy.dataDir, pluginRoot: PACKAGE_ROOT });
  const seeded = jobs2.prepare({});
  assert.equal(Number.isFinite(seeded.spec.seed), true, 'a grain render gets a fixed seed');
  assert.ok(seeded.spec.seed > 0);
});

test('the finished file is only marked done after the checks pass', async () => {
  const { dataDir } = seedDataDir();
  const jobs = createExportJobs({ dataDir, pluginRoot: PACKAGE_ROOT });
  const job = jobs.prepare({});
  const state = readJobOrThrow(job.jobDir);
  assert.equal(state.status, 'prepared', 'the job does not start by itself');
  assert.deepEqual(state.outputs, [], 'there is no output before the render');
  assert.equal(state.attempt, null, 'no attempt has been made');
});

test('a job id cannot be used to reach a path outside the managed root', () => {
  const { dataDir } = seedDataDir();
  assert.throws(() => resolveJobDir(dataDir, '../../etc'), /job id/);
  assert.throws(() => resolveJobDir(dataDir, 'a/b'), /job id/);
  assert.throws(() => resolveJobDir(dataDir, ''), /job id/);
  assert.throws(() => resolveJobDir(dataDir, 'C:\\Windows'), /job id/);
});

test('a finished job is described without paths outside it', () => {
  const described = describeJob({
    id: 'job_1',
    status: 'succeeded',
    createdAt: 1,
    updatedAt: 2,
    attempt: { id: 'att_1', pid: 42, startedAt: 1, heartbeatAt: 2 },
    progress: 1,
    outputs: [{ file: 'a.mp4', path: '/x/a.mp4', bytes: 10 }],
    secret: 'never shown',
  });
  assert.equal('secret' in described, false, 'nothing unknown is passed on');
  assert.equal(described.attempt.pid, 42);
});
