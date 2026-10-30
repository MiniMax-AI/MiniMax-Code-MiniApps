// The usage ledger must say what the model really did:
//   - a turn a crash or a restart cut off is still a turn: aborted, with no invented duration,
//   - a retried turn stays one turn but says how many times the model was called,
//   - a turn whose bookkeeping failed afterwards is still on the ledger,
//   - the average duration covers the turns that ran, so the panel never shows NaN.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { JSDOM } from 'jsdom';
import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';
import { start } from '../miniapp/node/server.mjs';
import { setLocale } from '../miniapp/node/i18n.mjs';

const dom = new JSDOM('<div class="app"><button id="trigger">Settings</button><main id="main"><textarea></textarea></main><aside id="drawer"></aside></div><div id="overlay-root"></div><div id="toast" hidden></div>', { url: 'http://localhost/bot' });
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'FormData']) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
window.matchMedia = () => ({ matches: false });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
const { state } = await import('../miniapp/client/core.js');
const { setLocale: setClientLocale } = await import('../miniapp/client/i18n.js');
const { openOverlay, closeOverlay } = await import('../miniapp/client/panels.js');
setClientLocale('en');

const tick = () => new Promise((done) => setTimeout(done, 0));

/** A data directory with a bot and no turn of its own. */
async function fixture(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  setLocale('en');
  const engine = new Engine({ store, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [] });
  t.after(async () => {
    engine.dispose();
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, memory, engine };
}

test('a turn a restart cut off is still on the ledger: aborted, with no invented duration', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bot-usage-honest-restart-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const chatId = 'bot:bot_a';
  const store = new Store(dir);
  await store.init();
  store.state.bots = [{ id: 'bot_a', name: 'Alice', role: 'Writer' }];
  // A Bot turn that was still streaming when the process stopped.
  await store.appendMessage(chatId, {
    id: 'msg_stream_1',
    role: 'bot',
    botId: 'bot_a',
    text: 'Half an answer',
    status: 'streaming',
    parts: [
      { type: 'text', text: 'Half an answer' },
      { type: 'tool', name: 'read_file', state: 'running' },
    ],
    kind: 'private',
    startedAt: Date.now() - 90_000,
    modelCalls: 1,
  });
  // A background job that was running when the process stopped.
  store.state.helpers = [{
    id: 'help_1',
    botId: 'bot_a',
    chatId,
    title: 'research',
    task: 'look it up',
    status: 'running',
    createdAt: Date.now() - 118_000,
    startedAt: Date.now() - 118_000,
    turnTools: 2,
  }];
  await store.save();

  // The process restarts: a new Store reads the same data directory.
  const restarted = new Store(dir);
  await restarted.init();
  await restarted.getMessages(chatId);
  const rows = await restarted.readUsage(0);
  assert.equal(rows.length, 2, 'the work that was in flight left no trace in the ledger');

  const turn = rows.find((row) => row.turnId === 'msg_stream_1');
  assert.ok(turn, 'the interrupted turn left no row in the ledger');
  assert.equal(turn.status, 'aborted');
  assert.equal(turn.durationMs, null, 'a turn that died has no known duration');
  assert.equal(turn.chars, 'Half an answer'.length);
  assert.equal(turn.tools, 1);
  assert.equal(turn.attempts, 1);

  const job = rows.find((row) => row.turnId === 'help_1');
  assert.ok(job, 'the interrupted background job left no row in the ledger');
  assert.equal(job.status, 'aborted');
  assert.equal(job.durationMs, null, 'a job that died has no known duration');
  assert.equal(job.tools, 2);
  assert.equal(job.kind, 'helper-run');
});

test('a turn the engine already metered is not counted twice by the recovery', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bot-usage-honest-once-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const chatId = 'bot:bot_a';
  const store = new Store(dir);
  await store.init();
  store.state.bots = [{ id: 'bot_a', name: 'Alice', role: 'Writer' }];
  // The turn was metered, but its message never left the 'streaming' state on disk.
  await store.appendMessage(chatId, {
    id: 'msg_stream_2',
    role: 'bot',
    botId: 'bot_a',
    text: 'Done',
    status: 'streaming',
    parts: [{ type: 'text', text: 'Done' }],
    kind: 'private',
    startedAt: Date.now() - 5000,
  });
  await store.save();
  await writeFile(join(dir, 'usage.jsonl'), `${JSON.stringify({
    ts: Date.now() - 4000,
    turnId: 'msg_stream_2',
    botId: 'bot_a',
    botName: 'Alice',
    chatId,
    kind: 'private',
    status: 'done',
    durationMs: 1200,
    chars: 4,
    tools: 0,
    attempts: 1,
  })}\n`, 'utf8');

  const restarted = new Store(dir);
  await restarted.init();
  await restarted.getMessages(chatId);
  const rows = await restarted.readUsage(0);
  assert.equal(rows.length, 1, 'one turn is one row, however often the process restarts');
  assert.equal(rows[0].status, 'done');
});

test('a retried turn stays one turn, and says how many times the model was called', async (t) => {
  const { store, engine } = await fixture(t, 'bot-usage-honest-retry-');
  engine.retryDelays = [1, 1];
  const calls = { count: 0 };
  engine.agent = {
    async run(input, options) {
      calls.count += 1;
      if (calls.count < 3) throw Object.assign(new Error('Unavailable'), { code: 'AGENT_UNAVAILABLE', retryable: true });
      options.onEvent({ type: 'turn.started', sessionId: 's1' });
      return { sessionId: 's1', status: 'finished', text: 'Done' };
    },
  };
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  await engine.runBotTurn({ bot, chatId, text: 'Hello', kind: 'private' });
  assert.equal(calls.count, 3, 'the model was called three times');
  const rows = await store.readUsage(0);
  assert.equal(rows.length, 1, 'a retried turn is still one turn');
  assert.equal(rows[0].attempts, 3, 'the ledger does not say how often the model ran');
  assert.equal(rows[0].status, 'done');
});

test('a turn whose bookkeeping fails afterwards is still on the ledger', async (t) => {
  const { store, engine } = await fixture(t, 'bot-usage-honest-late-');
  const calls = { count: 0 };
  engine.agent = {
    async run(input, options) {
      calls.count += 1;
      options.onEvent({ type: 'turn.started', sessionId: 's1' });
      return { sessionId: 's1', status: 'finished', text: 'Done' };
    },
  };
  // The turn's own bookkeeping fails after the model ran: the message cannot be stored.
  store.updateMessage = async () => { throw Object.assign(new Error('disk full'), { code: 'EIO' }); };
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  await assert.rejects(() => engine.runBotTurn({ bot, chatId, text: 'Hello', kind: 'private' }), /disk full/);
  assert.equal(calls.count, 1, 'the model ran once');
  const rows = await store.readUsage(0);
  assert.equal(rows.length, 1, 'the turn the model ran left no row in the ledger');
  assert.equal(rows[0].attempts, 1);
});

test('the average duration covers the turns that ran, and the panel never shows NaN', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bot-usage-honest-avg-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const now = Date.now();
  const chatId = 'bot:bot_a';
  const rows = [
    { ts: now, turnId: 'm1', botId: 'bot_a', botName: 'Alice', chatId, kind: 'private', status: 'done', durationMs: 1000, chars: 10, tools: 1, attempts: 1 },
    { ts: now, turnId: 'm2', botId: 'bot_a', botName: 'Alice', chatId, kind: 'private', status: 'done', durationMs: 3000, chars: 10, tools: 0, attempts: 3 },
    { ts: now, turnId: 'm3', botId: 'bot_a', botName: 'Alice', chatId, kind: 'private', status: 'aborted', durationMs: null, chars: 0, tools: 1, attempts: 1 },
  ];
  await writeFile(join(dir, 'usage.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const app = await start({
    pluginRoot: resolve(import.meta.dirname, '..'),
    dataDir: dir,
    listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
  });
  t.after(async () => { await app.dispose(); });
  const usage = await (await fetch(`http://127.0.0.1:${port}/api/usage?days=1`)).json();
  assert.equal(usage.totals.turns, 3);
  assert.equal(usage.totals.durationSamples, 2, 'the cut-off turn has no duration to average');
  assert.equal(usage.totals.durationMs, 4000);
  // (1000 + 3000) / 2: the average of the turns that ran, not 4000 / 3 and not NaN.
  assert.equal(usage.totals.avgDurationMs, 2000);
  assert.ok(Number.isFinite(usage.totals.avgDurationMs));
  assert.equal(usage.totals.modelCalls, 5, 'the model really ran five times');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/usage')) return { ok: true, json: async () => usage };
    return { ok: true, json: async () => ({}) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  openOverlay({ kind: 'settings', page: 'usage' });
  await tick();
  await tick();
  const panel = document.querySelector('.kpis')?.textContent ?? '';
  assert.doesNotMatch(panel, /NaN|undefined/);
  assert.match(panel, /2s/, 'the panel shows the average of the turns that ran');
  assert.match(panel, /5 model calls/, 'the panel says how often the model really ran');
  closeOverlay();
});
