import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The marketplace keeps regression tests outside the distributed plugin directory.
const pluginRoot = resolve(process.env.BOT_PLUGIN_ROOT ?? resolve(import.meta.dirname, '..'));
const { start } = await import(pathToFileURL(join(pluginRoot, 'miniapp/node/server.mjs')).href);
const { Store } = await import(pathToFileURL(join(pluginRoot, 'miniapp/node/store.mjs')).href);
const { UPLOAD_NAME_RE } = await import(pathToFileURL(join(pluginRoot, 'miniapp/node/engine.mjs')).href);

async function fixture(t, { messages = 0, prepare, agent } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bot-http-reliability-'));
  let app;
  t.after(async () => {
    try { await app?.dispose(); }
    finally { await rm(dataDir, { recursive: true, force: true }); }
  });
  const initial = new Store(dataDir);
  await initial.init();
  const chat = initial.chatIds()[0];
  const history = Array.from({ length: messages }, (_, i) => ({
    id: `msg_history${i}`, chatId: chat, role: i % 2 ? 'bot' : 'user',
    text: `History ${i}`, ts: i + 1, status: 'done',
  }));
  if (history.length) await writeFile(initial.messagePath(chat), JSON.stringify(history));
  await prepare?.(initial, chat);
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const boot = () => start({
    pluginRoot, dataDir, listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
    agent, // Undefined in persistence-only tests.
  });
  app = await boot();
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/api/chats/${chat}/messages`;
  const get = async (query = '') => {
    const response = await fetch(`${url}${query}`);
    return { status: response.status, body: await response.json() };
  };
  const post = async (body) => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const restart = async () => {
    await app.dispose();
    app = undefined;
    app = await boot();
  };
  return { dataDir, chat, history, get, post, restart, base, messagePath: initial.messagePath(chat) };
}

for (const extension of ['html', 'HTM', 'md', 'markdown']) {
  test(`delivered ${extension} files render in the browser instead of downloading`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'bot-preview-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const src = join(dir, `预览 100%.${extension}`);
    const markdown = /^(md|markdown)$/.test(extension);
    const content = markdown ? '# Preview\n\n**Readable**\n\n<script>alert(1)</script>' : '<!doctype html><h1>Preview</h1><button onclick="this.textContent=\'Selected\'">Select</button>';
    await writeFile(src, content);
    const { base, chat } = await fixture(t, { prepare: async (store, chatId) => {
      await writeFile(store.messagePath(chatId), JSON.stringify([{ id: 'msg_preview', role: 'bot', chatId, text: `<media src="${src}" />`, ts: 1, status: 'done' }]));
    } });
    const response = await fetch(`${base}/api/media?chat=${chat}&src=${encodeURIComponent(src)}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html; charset=utf-8$/);
    assert.doesNotMatch(response.headers.get('content-disposition') ?? '', /attachment/);
    const html = await response.text();
    if (markdown) {
      assert.match(html, /<strong>Readable<\/strong>/);
      assert.doesNotMatch(html, /<script>/);
    } else assert.equal(html, content);
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /sandbox(?:;| |$)/);
    assert.doesNotMatch(csp, /allow-same-origin|allow-forms|allow-top-navigation/);
    if (!markdown) assert.match(csp, /sandbox allow-scripts/);
    else {
      assert.doesNotMatch(csp, /allow-scripts/);
      assert.match(csp, /sandbox allow-popups allow-popups-to-escape-sandbox/);
    }
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });
}

test('document previews retain chat authorization, size bounds, downloads and media byte ranges', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bot-media-access-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const privateFile = join(dir, 'private.html');
  const userFile = join(dir, 'user-only.md');
  const archive = join(dir, 'archive.zip');
  const video = join(dir, 'clip.mp4');
  const large = join(dir, 'large.md');
  await Promise.all([
    writeFile(privateFile, 'private'), writeFile(userFile, 'user'),
    writeFile(archive, 'archive'), writeFile(video, '0123456789'), writeFile(large, 'x'.repeat(2 * 1024 * 1024 + 1)),
  ]);
  const { base, chat } = await fixture(t, { prepare: async (store, chatId) => {
    await writeFile(store.messagePath(chatId), JSON.stringify([
      { id: 'msg_files', role: 'bot', chatId, text: [archive, video, large].map((src) => `<media src="${src}" />`).join('\n'), ts: 1, status: 'done' },
      { id: 'msg_user_file', role: 'user', chatId, text: userFile, ts: 2, status: 'done' },
    ]));
  } });
  const url = (src, chatId = chat) => `${base}/api/media?chat=${chatId}&src=${encodeURIComponent(src)}`;
  for (const src of [privateFile, userFile, join(dir, 'missing.html')]) {
    assert.equal((await fetch(url(src))).status, 404);
  }
  assert.equal((await fetch(url(archive, 'bot:other'))).status, 404);
  const largePreview = await fetch(url(large));
  assert.equal(largePreview.status, 200);
  assert.equal(largePreview.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(largePreview.headers.get('content-disposition'), null);
  assert.equal((await largePreview.text()).length, 2 * 1024 * 1024 + 1);
  const download = await fetch(url(archive));
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.equal(await download.text(), 'archive');
  const range = await fetch(url(video), { headers: { range: 'bytes=2-4' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), '234');
});

test('HTTP messages default to the latest 200 and before pages return chronological non-overlapping history', async (t) => {
  const { chat, history, get } = await fixture(t, { messages: 705 });
  const latest = await get();
  assert.equal(latest.status, 200);
  assert.equal(latest.body.chatId, chat);
  assert.deepEqual(latest.body.messages.map((message) => message.id), history.slice(-200).map((message) => message.id));
  assert.equal(latest.body.hasMore, true);
  assert.equal(latest.body.nextBefore, history[505].id);
  const previous = await get(`?limit=100&before=${latest.body.nextBefore}`);
  assert.equal(previous.status, 200);
  assert.deepEqual(previous.body.messages.map((message) => message.id), history.slice(405, 505).map((message) => message.id));
  assert.equal(previous.body.nextBefore, history[405].id);
  const oldest = await get(`?limit=500&before=${previous.body.nextBefore}`);
  assert.equal(oldest.status, 200);
  assert.deepEqual(oldest.body.messages.map((message) => message.id), history.slice(0, 405).map((message) => message.id));
  assert.equal(oldest.body.hasMore, false);
  assert.equal(oldest.body.nextBefore, null);
});

test('HTTP pagination rejects invalid limits with 400 and an unknown cursor with 404', async (t) => {
  const { get, post } = await fixture(t);
  for (const body of [null, [], 'text']) assert.equal((await post(body)).status, 400);
  for (const limit of ['', '0', '-1', '501', '1.5', 'NaN', 'Infinity', 'abc']) {
    const result = await get(`?limit=${encodeURIComponent(limit)}`);
    assert.equal(result.status, 400, `limit=${limit}`);
    assert.equal(result.body.error, 'invalid');
  }
  const missing = await get('?limit=20&before=msg_missing');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'not_found');
  for (const limit of [1, 500]) assert.equal((await get(`?limit=${limit}`)).status, 200);
});

test('HTTP export can traverse every message beyond 600 and restart preserves the full history', async (t) => {
  const { history, get, restart, messagePath } = await fixture(t, { messages: 713 });
  const exported = [];
  const cursors = new Set();
  let before;
  for (;;) {
    const page = await get(`?limit=137${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    assert.equal(page.status, 200);
    exported.unshift(...page.body.messages);
    if (!page.body.hasMore) {
      assert.equal(page.body.nextBefore, null);
      break;
    }
    assert.ok(page.body.nextBefore);
    assert.equal(cursors.has(page.body.nextBefore), false, 'pagination cursor must advance');
    cursors.add(page.body.nextBefore);
    before = page.body.nextBefore;
  }
  assert.equal(exported.length, 713);
  assert.equal(new Set(exported.map((message) => message.id)).size, 713);
  assert.deepEqual(exported.map((message) => message.text), history.map((message) => message.text));
  assert.deepEqual(exported.map((message) => message.seq), Array.from({ length: 713 }, (_, i) => i + 1));
  await restart();
  const first = await get('?limit=1&before=msg_history1');
  assert.equal(first.status, 200);
  assert.equal(first.body.messages[0].id, history[0].id);
  assert.equal(JSON.parse(await readFile(messagePath, 'utf8')).length, 713);
});

test('concurrent HTTP retries with one clientMessageId store one user message and reject a changed payload', async (t) => {
  const { get, post, restart } = await fixture(t);
  const request = { text: 'Send this exactly once', clientMessageId: 'http-retry-1' };
  const results = await Promise.all(Array.from({ length: 8 }, () => post(request)));
  assert.ok(results.every((result) => result.status === 200));
  const ids = new Set(results.map((result) => result.body.message.id));
  assert.equal(ids.size, 1);
  let page = await get();
  const users = () => page.body.messages.filter((message) => message.role === 'user');
  assert.equal(users().length, 1);
  assert.equal(users()[0].clientMessageId, request.clientMessageId);
  const conflict = await post({ ...request, text: 'A different instruction' });
  assert.equal(conflict.status, 400);
  assert.equal(conflict.body.error, 'invalid');
  page = await get();
  assert.equal(users().length, 1);
  assert.equal(users()[0].text, request.text);
  await restart();
  const retried = await post(request);
  assert.equal(retried.status, 200);
  assert.ok(ids.has(retried.body.message.id));
  page = await get();
  assert.equal(users().length, 1);
  const changedAttachments = await post({ ...request, attachments: ['different-attachment'] });
  assert.equal(changedAttachments.status, 400);
  assert.equal(changedAttachments.body.error, 'invalid');
});

test('HTTP retry returns 409 for a possibly delivered interrupted request', async (t) => {
  const { post, get } = await fixture(t, { prepare: async (store, chat) => {
    const user = await store.appendMessage(chat, { role: 'user', text: 'May have run', clientMessageId: 'uncertain-http-1', dispatchState: 'pending' });
    await store.appendMessage(chat, { role: 'bot', botId: store.state.bots[0].id, sourceMessageId: user.id, text: '', status: 'interrupted' });
  } });
  const result = await post({ text: 'May have run', clientMessageId: 'uncertain-http-1' });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'delivery_uncertain');
  assert.equal((await get()).body.messages.filter((message) => message.role === 'user').length, 1);
});

test('sending over HTTP automatically adjusts and waits for confirmed abort before the combined supplement', async (t) => {
  let runs = 0;
  let aborted = false;
  let confirm;
  const finished = new Promise((resolve) => { confirm = resolve; });
  const until = async (predicate) => {
    for (let i = 0; i < 300; i += 1) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('HTTP state did not settle');
  };
  const { post, get } = await fixture(t, { agent: {
    async run(input, options) {
      runs += 1;
      const ids = { sessionId: 'http-session', turnId: `turn-${runs}` };
      options.onEvent({ type: 'turn.started', ...ids });
      if (runs === 1) {
        options.signal.addEventListener('abort', () => { aborted = true; });
        await finished;
        return { ...ids, status: 'aborted' };
      }
      assert.equal(input.sessionId, 'http-session');
      assert.match(input.text, /Correction one\n\nCorrection two$/);
      return { ...ids, status: 'finished', text: 'Adjusted' };
    },
  } });
  await post({ text: 'Original', clientMessageId: 'http-original' });
  await until(() => runs === 1);
  const first = await post({ text: 'Correction one', clientMessageId: 'http-one' });
  const second = await post({ text: 'Correction two', clientMessageId: 'http-two' });
  assert.equal(first.body.message.dispatchState, 'pending');
  await until(() => aborted);
  assert.equal(runs, 1);
  let page = await get();
  assert.equal(page.body.messages.find((m) => m.id === first.body.message.id).dispatchState, 'adjusting');
  assert.equal(page.body.messages.find((m) => m.id === second.body.message.id).dispatchState, 'pending');
  confirm();
  await until(async () => (await get()).body.messages.find((m) => m.id === second.body.message.id).dispatchState === 'delivered');
  assert.equal(runs, 2);
});

test('avatar library persists imports, deduplicates concurrent uploads and reuses them across Bots and restarts', async (t) => {
  const { base, restart, dataDir } = await fixture(t);
  const image = await readFile(join(pluginRoot, 'miniapp/client/skins/gold.png'));
  const dataUrl = `data:image/png;base64,${image.toString('base64')}`;
  const request = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  assert.deepEqual((await request('GET', '/api/avatars')).body.avatars, []);
  const imported = await Promise.all(Array.from({ length: 4 }, () => request('POST', '/api/avatars', { avatar: dataUrl })));
  assert.ok(imported.every((r) => r.status === 200));
  const name = imported[0].body.avatar;
  assert.ok(imported.every((r) => r.body.avatar === name));
  assert.deepEqual((await request('GET', '/api/avatars')).body.avatars, [name]);
  const created = await request('POST', '/api/bots', { name: 'Gallery Bot', avatar: name });
  assert.equal(created.status, 200); assert.equal(created.body.bot.avatar, name);
  const botId = created.body.bot.id;
  const mainId = (await request('GET', '/api/state')).body.bots[0].id;
  assert.equal((await request('PATCH', `/api/bots/${mainId}`, { avatar: name })).status, 200);
  // Going back to a built-in look, then deleting a Bot, must not erase the reusable image.
  assert.equal((await request('PATCH', `/api/bots/${botId}`, { skin: 'bubble', avatar: null })).status, 200);
  assert.deepEqual((await request('GET', '/api/avatars')).body.avatars, [name]);
  assert.equal((await request('PATCH', `/api/bots/${botId}`, { avatar: name })).status, 200);
  assert.equal((await request('DELETE', `/api/bots/${botId}`)).status, 200);
  await restart();
  assert.deepEqual((await request('GET', '/api/avatars')).body.avatars, [name]);
  assert.equal((await request('GET', '/api/state')).body.bots.find((b) => b.id === mainId).avatar, name);
  const file = await fetch(`${base}/api/avatars/${name}`);
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), image);
  // Pre-library per-Bot files are immediately discoverable and can be selected without copying.
  const legacy = 'bot_old-0123456789ab.png';
  await writeFile(join(dataDir, 'avatars', legacy), image);
  await writeFile(join(dataDir, 'avatars', '.part-interrupted'), image);
  assert.deepEqual((await request('GET', '/api/avatars')).body.avatars, [name, legacy]);
  assert.equal((await request('PATCH', `/api/bots/${mainId}`, { avatar: legacy })).body.bot.avatar, legacy);
  await restart();
  assert.equal((await fetch(`${base}/api/avatars/${legacy}`)).status, 200);
  assert.deepEqual((await request('GET', '/api/avatars')).body.avatars, [name, legacy]);
});

test('avatar import rejects invalid, oversized and path inputs without polluting the gallery', async (t) => {
  const { base } = await fixture(t);
  for (const body of [null, [], {}, { avatar: 'default' }, { avatar: '/tmp/private.png' }, { avatar: '../private.png' }, { avatar: 'data:image/svg+xml;base64,PHN2Zz4=' }, { avatar: 'data:image/png;base64,YmFk' }, { avatar: `data:image/png;base64,${Buffer.alloc(512 * 1024 + 1).toString('base64')}` }]) {
    const response = await fetch(`${base}/api/avatars`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
  const { bots } = await (await fetch(`${base}/api/state`)).json();
  const missing = await fetch(`${base}/api/bots/${bots[0].id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ avatar: 'missing.png' }) });
  assert.equal(missing.status, 400);
  assert.deepEqual((await (await fetch(`${base}/api/avatars`)).json()).avatars, []);
});

test('failed avatar writes leave no gallery item and retry succeeds after storage recovers', async (t) => {
  const { base, dataDir } = await fixture(t);
  const image = await readFile(join(pluginRoot, 'miniapp/client/skins/gold.png'));
  const upload = () => fetch(`${base}/api/avatars`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ avatar: `data:image/png;base64,${image.toString('base64')}` }) });
  const directory = join(dataDir, 'avatars');
  await writeFile(directory, 'unavailable storage');
  assert.equal((await upload()).status, 500);
  await rm(directory);
  assert.deepEqual((await (await fetch(`${base}/api/avatars`)).json()).avatars, []);
  const retry = await upload(); assert.equal(retry.status, 200);
  const { avatar } = await retry.json();
  assert.deepEqual((await (await fetch(`${base}/api/avatars`)).json()).avatars, [avatar]);
});

test('HTTP task snapshot and stop endpoint control an admitted MCP delegation', async (t) => {
  let started = false;
  const { base, chat } = await fixture(t, { agent: { async run(input, options) {
    started = true;
    const ids = { sessionId: 'task-session', turnId: 'task-turn' };
    options.onEvent({ type: 'turn.started', ...ids });
    await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
    return { ...ids, status: 'aborted', text: '' };
  } } });
  const reply = await fetch(`${base}/mcp/minimax-bot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'dispatch_tasks', arguments:{ request_id:'http-task', tasks:[{to:chat.slice(4),message:'Review'}] } } }) });
  const receipt = JSON.parse((await reply.json()).result.content[0].text);
  for (let i=0; !started && i<100; i++) await new Promise((resolve)=>setTimeout(resolve,5));
  assert.equal(started,true);
  const taskId=receipt.tasks[0].task_id;
  assert.equal((await (await fetch(`${base}/api/state`)).json()).tasks[0].id,taskId);
  const stopped=await fetch(`${base}/api/tasks/${taskId}/stop`,{method:'POST'});assert.equal(stopped.status,200);
  let status;
  for(let i=0;i<100;i++){ status=(await (await fetch(`${base}/api/state`)).json()).tasks[0].status;if(status==='cancelled')break;await new Promise((resolve)=>setTimeout(resolve,5)); }
  assert.equal(status,'cancelled');
});

test('an upload whose name carries .. still produces an id the attachment reader accepts', async (t) => {
  const { base } = await fixture(t);
  // The attachment reader refuses any id containing `..`, so the stored name must not carry it.
  const response = await fetch(`${base}/api/uploads?name=${encodeURIComponent('report..final.txt')}`, {
    method: 'POST', body: 'hello', headers: { 'content-type': 'application/octet-stream' },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.upload.id.includes('..'), false, body.upload.id);
  assert.equal(UPLOAD_NAME_RE.test(body.upload.id), true, body.upload.id);
  // A normal name is left alone.
  const plain = await fetch(`${base}/api/uploads?name=notes.txt`, {
    method: 'POST', body: 'hello', headers: { 'content-type': 'application/octet-stream' },
  });
  assert.equal((await plain.json()).upload.name, 'notes.txt');
});
