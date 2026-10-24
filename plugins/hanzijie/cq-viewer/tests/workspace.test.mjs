// Run: node --test plugins/hanzijie/cq-viewer/tests/*.test.mjs
// Session folders: registration, extra folders, per-folder annotations, AI requests routed to the
// right chat, renders per folder. Real Node entry, throw-away HOME.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STL = Buffer.concat([Buffer.alloc(80), Buffer.from([0, 0, 0, 0])]);

let home = '';
/** @type {{lifecycle: {dispose(): Promise<void>|void}}[]} */
const running = [];

before(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'cqv-ws-')));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  // a session folder in a hidden top-level directory (like ~/.mavis/workspace), two projects, one extra
  for (const d of ['.mavis/workspace/models', 'projA/parts', 'projB', 'shared', 'projA/.cache']) await mkdir(join(home, d), { recursive: true });
  await writeFile(join(home, '.mavis/workspace/models/octopus.stl'), STL);
  await writeFile(join(home, 'projA/parts/bracket.stl'), STL);
  await writeFile(join(home, 'projA/.cache/hidden.stl'), STL);
  await writeFile(join(home, 'projB/lid.stl'), STL);
  await writeFile(join(home, 'shared/common.stl'), STL);
});

after(async () => {
  for (const r of running) await r.lifecycle.dispose();
  await rm(home, { recursive: true, force: true });
});

test('a session folder is registered as-is (hidden folders too) and lists its models; home and / are refused', async () => {
  const { port } = await boot();
  const ws = await post(port, '/viewer/api/workspace', { dir: join(home, '.mavis/workspace') });
  assert.equal(ws.status, 200, ws.text);
  const body = JSON.parse(ws.text);
  assert.equal(body.folder.kind, 'session');
  assert.deepEqual(body.extras, []);
  assert.equal(body.selectionFile, `~/.cqview/selections/${body.folder.id}.json`);
  const files = JSON.parse((await get(port, `/viewer/api/files?root=${body.folder.id}`)).text);
  assert.deepEqual(files.files.map((f) => f.rel), ['models/octopus.stl']);
  assert.equal((await post(port, '/viewer/api/workspace', { dir: home })).status, 400);
  assert.equal((await post(port, '/viewer/api/workspace', { dir: '/' })).status, 400);
  assert.equal((await post(port, '/viewer/api/workspace', { dir: join(home, 'nope') })).status, 400);
  // the global folder list (roots.json) is not touched by session folders
  const roots = JSON.parse((await get(port, '/viewer/api/roots')).text).roots;
  assert.ok(!roots.some((r) => r.id === body.folder.id));
});

test('extra folders belong to one session folder and can be removed again', async () => {
  const { port } = await boot();
  const a = join(home, 'projA');
  const b = join(home, 'projB');
  await post(port, '/viewer/api/workspace', { dir: a });
  await post(port, '/viewer/api/workspace', { dir: b });
  const added = JSON.parse((await post(port, '/viewer/api/workspace/folders', { dir: a, path: join(home, 'shared') })).text);
  assert.deepEqual(added.extras.map((e) => e.label), ['shared']);
  const other = JSON.parse((await post(port, '/viewer/api/workspace', { dir: b })).text);
  assert.deepEqual(other.extras, [], 'projB does not see projA’s extra folder');
  const files = JSON.parse((await get(port, `/viewer/api/files?root=${added.extras[0].id}`)).text);
  assert.deepEqual(files.files.map((f) => f.rel), ['common.stl']);
  const same = await post(port, '/viewer/api/workspace/folders', { dir: a, path: a });
  assert.equal(same.status, 400);
  const removed = JSON.parse((await post(port, '/viewer/api/workspace/folders', { dir: a, remove: added.extras[0].id })).text);
  assert.deepEqual(removed.extras, []);
});

test('annotations are kept per session folder; the last write is mirrored to selection.json', async () => {
  const { port } = await boot();
  const a = JSON.parse((await post(port, '/viewer/api/workspace', { dir: join(home, 'projA') })).text).folder.id;
  const b = JSON.parse((await post(port, '/viewer/api/workspace', { dir: join(home, 'projB') })).text).folder.id;
  assert.equal((await post(port, '/viewer/api/selection', { folder: a, points: [{ x: 1, y: 2, z: 3 }], instruction: 'A' })).status, 200);
  assert.equal((await post(port, '/viewer/api/selection', { folder: b, points: [{ x: 9, y: 9, z: 9 }], instruction: 'B' })).status, 200);
  const sa = JSON.parse((await get(port, `/viewer/api/selection?folder=${a}`)).text);
  const sb = JSON.parse((await get(port, `/viewer/api/selection?folder=${b}`)).text);
  assert.equal(sa.instruction, 'A');
  assert.equal(sb.instruction, 'B');
  assert.equal(JSON.parse(await readFile(join(home, '.cqview/selections', `${a}.json`), 'utf8')).points[0].x, 1);
  const last = JSON.parse(await readFile(join(home, '.cqview/selection.json'), 'utf8'));
  assert.equal(last.instruction, 'B');
  assert.equal(last.folder, b);
  assert.equal((await post(port, '/viewer/api/selection', { folder: 'ffffffffff', points: [] })).status, 400);
});

test('AI requests with a workspace reach only that chat; without one they go where the file lies', async () => {
  const { port } = await boot();
  const a = join(home, 'projA');
  const b = join(home, 'projB');
  const hidden = join(home, '.mavis/workspace');
  for (const dir of [a, b, hidden]) await post(port, '/viewer/api/workspace', { dir });
  // in a hidden session folder: allowed because it is the caller's own folder
  const inHidden = await mcp(port, 'add_model_file', { path: join(hidden, 'models/octopus.stl'), workspace: hidden });
  assert.equal(inHidden.isError, undefined, JSON.stringify(inHidden));
  // projA's file, asked for by projA
  await mcp(port, 'add_model_file', { path: join(a, 'parts/bracket.stl'), workspace: a });
  // a file outside projA, asked for by projA: its folder becomes projA's extra folder
  await mcp(port, 'add_model_file', { path: join(home, 'shared/common.stl'), workspace: a });
  // no workspace: routed by location
  await mcp(port, 'add_model_file', { path: join(b, 'lid.stl') });
  const forA = JSON.parse((await get(port, `/viewer/api/requests?dir=${encodeURIComponent(a)}`)).text).items;
  const forB = JSON.parse((await get(port, `/viewer/api/requests?dir=${encodeURIComponent(b)}`)).text).items;
  const forHidden = JSON.parse((await get(port, `/viewer/api/requests?dir=${encodeURIComponent(hidden)}`)).text).items;
  assert.deepEqual(forA.map((i) => i.rel), ['parts/bracket.stl', 'common.stl']);
  assert.deepEqual(forB.map((i) => i.rel), ['lid.stl']);
  assert.deepEqual(forHidden.map((i) => i.rel), ['models/octopus.stl']);
  const wsA = JSON.parse((await post(port, '/viewer/api/workspace', { dir: a })).text);
  assert.deepEqual(wsA.extras.map((e) => e.label), ['shared']);
  assert.equal(forA[1].root, wsA.extras[0].id, 'points at the extra folder');
  // a hidden subfolder inside the session folder is still not listed
  const nope = await mcp(port, 'add_model_file', { path: join(a, '.cache/hidden.stl'), workspace: a });
  assert.equal(nope.isError, true);
  // the legacy log (no ?dir) keeps root/rel for older pages
  const legacy = JSON.parse((await get(port, '/viewer/api/requests')).text).items;
  assert.ok(legacy.every((i) => typeof i.root === 'string'));
});

test('viewer_connected reflects a page of that session folder', async () => {
  const { port } = await boot();
  const a = join(home, 'projA');
  await post(port, '/viewer/api/workspace', { dir: a });
  const closed = await mcp(port, 'add_model_file', { path: join(a, 'parts/bracket.stl'), workspace: a });
  assert.equal(closed.structuredContent.viewer_connected, false);
  const stream = await openEvents(port, a);
  const open = await mcp(port, 'add_model_file', { path: join(a, 'parts/bracket.stl'), workspace: a });
  assert.equal(open.structuredContent.viewer_connected, true);
  const elsewhere = await mcp(port, 'add_model_file', { path: join(home, 'projB/lid.stl'), workspace: join(home, 'projB') });
  assert.equal(elsewhere.structuredContent.viewer_connected, false, 'a page of another folder does not count');
  stream.destroy();
});

test('renders are listed per session folder', async () => {
  const agent = {
    async run(input) {
      const dir = /upload_temp_url "([^"]+)\/input\.png"/.exec(input.text)[1];
      const id = /cq-render-([a-f0-9]{12})/.exec(input.text)[1];
      await writeFile(join(dir, `cq-render-${id}.jpg`), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(600)]));
      return { sessionId: 's', status: 'finished', text: 'RENDER_DONE x' };
    },
    async reply() {},
  };
  const { port } = await boot(agent);
  const png = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600)]).toString('base64')}`;
  const r1 = await post(port, '/viewer/api/renders', { image: png, aspect: '1:1', folder: 'aaaaaaaaaa' });
  const r2 = await post(port, '/viewer/api/renders', { image: png, aspect: '1:1', folder: 'bbbbbbbbbb' });
  assert.equal(r1.status, 202, r1.text);
  assert.equal(r2.status, 202, r2.text);
  const onlyA = JSON.parse((await get(port, '/viewer/api/renders?folder=aaaaaaaaaa')).text).jobs;
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].folder, 'aaaaaaaaaa');
  assert.equal((await post(port, '/viewer/api/renders', { image: png, aspect: '1:1', folder: '../x' })).status, 400);
});

// ---------------------------------------------------------------- helpers

async function boot(agent) {
  const port = await freePort();
  const { start } = await import(new URL('../miniapp/node/server.mjs', import.meta.url).href);
  const noop = () => {};
  const lifecycle = await start({
    pluginId: 'cq-viewer',
    pluginRoot: PLUGIN_ROOT,
    dataDir: await mkdtemp(join(home, 'data-')),
    listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: { debug: noop, info: noop, warn: noop, error: noop },
    ...(agent ? { agent } : {}),
  });
  running.push({ lifecycle });
  return { port };
}

let rpcId = 0;
async function mcp(port, name, args) {
  const res = await post(port, '/mcp/cq-viewer', { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } });
  return JSON.parse(res.text).result;
}

function openEvents(port, dir) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: `/viewer/api/events?dir=${encodeURIComponent(dir)}` }, (res) => {
      res.on('data', (chunk) => {
        if (String(chunk).includes('"hello"')) resolve(res);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const get = (port, path) => raw(port, 'GET', path);
const post = (port, path, body) => raw(port, 'POST', path, JSON.stringify(body));

/** @returns {Promise<{status: number, text: string}>} */
function raw(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method, path, headers: body !== undefined ? { 'content-type': 'application/json' } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port: p } = /** @type {import('node:net').AddressInfo} */ (s.address());
      s.close(() => resolve(p));
    });
  });
}
