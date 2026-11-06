import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';
import { setLocale } from '../miniapp/node/i18n.mjs';

// The ledger is metering, not the turn's outcome: a failed write (a full disk) must not fail a
// turn that already ran, stop a group round, or keep a finished background job from reporting.

async function until(predicate) {
  for (let i = 0; i < 400; i += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The expected state did not arrive');
}

async function fixture(t, { stub = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-ledger-failure-'));
  const warnings = [];
  const logger = { warn: (...args) => warnings.push(args), info() {}, error() {} };
  const store = new Store(dir, logger);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  setLocale('en');
  const engine = new Engine({ store, memory, logger, broadcast() {}, retryDelaysMs: [] });
  t.after(async () => {
    engine.dispose();
    await until(() => engine.running.size === 0 && engine.helperRuns.size === 0 && engine.tickets.size === 0);
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  if (stub) {
    // The whole ledger write fails, exactly like a full disk; the guard must live at the call site.
    store.recordUsage = async () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
  }
  return { dir, store, engine, warnings };
}

const loggedMiss = (warnings) => warnings.some(([event]) => event === 'minimax_bot.usage_write_failed');

test('a full ledger does not fail the turn that already ran', async (t) => {
  const { store, engine, warnings } = await fixture(t);
  const bot = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  store.state.bots = [bot];
  engine.agent = { async run(input, options) {
    const ids = { sessionId: 's-ledger', turnId: 't-ledger' };
    options.onEvent({ type: 'turn.started', ...ids });
    return { ...ids, status: 'finished', text: 'All done' };
  } };
  const result = await engine.runBotTurn({ bot, chatId: `bot:${bot.id}`, text: 'hi', kind: 'private' });
  assert.equal(result.status, 'done', 'the reply keeps its outcome');
  const messages = await store.getMessages(`bot:${bot.id}`);
  assert.equal(messages.find((m) => m.id === result.messageId)?.status, 'done');
  assert.ok(loggedMiss(warnings), 'the miss goes to the log');
});

test('a full ledger does not stop the group round before the next member', async (t) => {
  const { store, engine, warnings } = await fixture(t);
  const a = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  const b = { id: 'bot_b', name: 'Bob', role: 'Reviewer' };
  const group = { id: 'grp_round', name: 'Round', adminId: a.id, memberIds: [a.id, b.id], replyMode: 'all' };
  store.state.bots = [a, b];
  store.state.groups = [group];
  const calls = [];
  engine.agent = { async run(input, options) {
    calls.push(input.text);
    const ids = { sessionId: `s-${calls.length}`, turnId: `t-${calls.length}` };
    options.onEvent({ type: 'turn.started', ...ids });
    return { ...ids, status: 'finished', text: `Reply ${calls.length}` };
  } };
  await engine.driveGroup(group, engine.groupQueue(group, 'hi'));
  assert.equal(calls.length, 2, 'the round continues with the next member');
  assert.ok(loggedMiss(warnings), 'the miss goes to the log');
});

test('a full ledger does not keep a finished background job from saving and reporting', async (t) => {
  const { dir, store, engine, warnings } = await fixture(t);
  const bot = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  store.state.bots = [bot];
  const chatId = `bot:${bot.id}`;
  const calls = [];
  engine.agent = { async run(input, options) {
    calls.push(input.text);
    const ids = { sessionId: `s-${calls.length}`, turnId: `t-${calls.length}` };
    options.onEvent({ type: 'turn.started', ...ids });
    if (input.text.startsWith('<minimax-bot-helper>')) return { ...ids, status: 'finished', text: 'BACKGROUND_ANSWER' };
    if (input.text.endsWith('START_BACKGROUND')) {
      await engine.startHelper(bot, { task: 'Look this up' });
      return { ...ids, status: 'finished', text: 'Started' };
    }
    return { ...ids, status: 'finished', text: 'Relay' };
  } };
  await engine.runBotTurn({ bot, chatId, text: 'START_BACKGROUND', kind: 'private' });
  await until(() => store.state.helpers[0]?.status === 'done');
  const messages = await store.getMessages(chatId);
  assert.ok(messages.some((m) => m.role === 'helper'), 'the finished job delivers its report');
  const onDisk = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  assert.equal(onDisk.helpers.find((h) => h.id === store.state.helpers[0].id)?.status, 'done', 'the status is saved, not left running');
  assert.ok(loggedMiss(warnings), 'the miss goes to the log');
});

test('a real failing ledger append is logged, not silently dropped', async (t) => {
  // No stub: the real Store.recordUsage must survive the failed append AND log the miss,
  // which is what the README promises for a full disk in production.
  const { dir, store, engine, warnings } = await fixture(t, { stub: false });
  const bot = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  store.state.bots = [bot];
  // appendFile onto a directory fails (EISDIR) the way a full disk fails the append.
  store.usagePath = dir;
  engine.agent = { async run(input, options) {
    const ids = { sessionId: 's-real', turnId: 't-real' };
    options.onEvent({ type: 'turn.started', ...ids });
    return { ...ids, status: 'finished', text: 'All done' };
  } };
  const result = await engine.runBotTurn({ bot, chatId: `bot:${bot.id}`, text: 'hi', kind: 'private' });
  assert.equal(result.status, 'done', 'the reply keeps its outcome');
  const messages = await store.getMessages(`bot:${bot.id}`);
  assert.equal(messages.find((m) => m.id === result.messageId)?.status, 'done');
  assert.ok(loggedMiss(warnings), 'the real store path must log the lost row');
  assert.equal(store.usageIds.size, 0, 'a failed append must not claim the turn id, so a retry can still write');
});