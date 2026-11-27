// @ts-check
// The enums this plugin declares are checked at the door, not merely written down.
//
// The point of this file: a value the catalogue does not offer is refused, at every entrance,
// instead of being quietly turned into a different — legal — value. A schedule that becomes
// "daily" is a daily e-mail the user did not ask for; a group whose reply mode flips from
// "all" to "admin" is a group that went quiet; a usage range that becomes NaN is an empty
// chart that reads like a wiped quota.
//
//   1. an unknown schedule kind is refused, and nothing is scheduled in its place;
//   2. a schedule with no kind at all is a daily task — the default, not a fallback;
//   3. an unknown reply mode is refused, and the group keeps the setting it had;
//   4. the usage range is a whole number of days, or the request is refused;
//   5. the MCP entrance and the HTTP entrance agree on all of it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The marketplace keeps the regression tests outside the distributed plugin directory.
const pluginRoot = resolve(process.env.BOT_PLUGIN_ROOT ?? resolve(import.meta.dirname, '..'));
const load = async (relative) => import(pathToFileURL(join(pluginRoot, relative)).href);

const { Store } = await load('miniapp/node/store.mjs');
const { MemoryStore } = await load('miniapp/node/memory.mjs');
const { Engine } = await load('miniapp/node/engine.mjs');
const { Team } = await load('miniapp/node/team.mjs');
const { createMcpHandler } = await load('miniapp/node/mcp.mjs');
const { setLocale } = await load('miniapp/node/i18n.mjs');
const { start } = await load('miniapp/node/server.mjs');

async function teamFixture(t, locale = 'en') {
  const dir = await mkdtemp(join(tmpdir(), 'bot-enum-validation-'));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  setLocale(locale);
  const engine = new Engine({
    store, memory, logger: { warn() {} }, broadcast: () => {}, retryDelaysMs: [],
  });
  const team = new Team({ store, memory, engine, broadcast: () => {} });
  const handle = createMcpHandler({ team, engine });
  const rpc = async (name, args) => {
    let response;
    await handle({ method: 'POST' }, { writeHead() { return this; }, end(body) { response = JSON.parse(body); } },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    return response.result;
  };
  t.after(async () => {
    engine.dispose();
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, memory, engine, team, rpc };
}

async function httpFixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bot-enum-http-'));
  const probe = createServer();
  await new Promise((res, rej) => { probe.once('error', rej); probe.listen(0, '127.0.0.1', res); });
  const port = probe.address().port;
  await new Promise((res, rej) => probe.close((error) => (error ? rej(error) : res())));
  const app = await start({
    pluginRoot, dataDir, listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
  });
  const base = `http://127.0.0.1:${port}`;
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const patch = async (path, body) => {
    const response = await fetch(`${base}${path}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const get = async (path) => {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => {
    try { await app.dispose(); }
    finally { await rm(dataDir, { recursive: true, force: true }); }
  });
  return { base, post, patch, get };
}

const writer = (team) => team.createBot(undefined, { name: 'Writer', role: 'writer', isMain: true });

// ---------------------------------------------------------------- 1. the schedule kind

test('an unknown schedule kind is refused instead of becoming another kind', async (t) => {
  const { team, store } = await teamFixture(t);
  const bot = await writer(team);
  await assert.rejects(
    () => team.saveSchedule({ botId: bot.id, prompt: 'Send the weekly report', kind: 'weekly' }),
    (error) => {
      assert.equal(error.code, 'invalid');
      // The message names the values the catalogue offers, so the model can correct itself.
      assert.match(error.message, /daily/);
      assert.match(error.message, /interval/);
      assert.match(error.message, /once/);
      return true;
    },
  );
  assert.deepEqual(store.state.schedules, [], 'no task was scheduled in its place');
});

test('every other unknown kind is refused the same way', async (t) => {
  const { team, store } = await teamFixture(t);
  const bot = await writer(team);
  for (const kind of ['weekly', 'Daily', 'daily ', 'every', '', 'null']) {
    await assert.rejects(
      () => team.saveSchedule({ botId: bot.id, prompt: 'Report', kind }),
      (error) => { assert.equal(error.code, 'invalid', `kind=${JSON.stringify(kind)}`); return true; },
    );
  }
  assert.deepEqual(store.state.schedules, []);
});

test('the MCP schedule tool refuses an unknown kind and leaves no task behind', async (t) => {
  const { team, store, rpc } = await teamFixture(t);
  const bot = await writer(team);
  const result = await rpc('create_schedule', { prompt: 'Send the weekly report', kind: 'weekly', target_bot: bot.id });
  assert.equal(result.isError, true, 'the tool call failed');
  assert.match(result.content[0].text, /daily/);
  assert.deepEqual(store.state.schedules, []);
});

test('the HTTP schedule entry refuses an unknown kind too', async (t) => {
  const { post } = await httpFixture(t);
  const bot = (await post('/api/bots', { name: 'Writer', role: 'writer', isMain: true })).body.bot;
  const schedule = await post('/api/schedules', { botId: bot.id, prompt: 'Send the weekly report', kind: 'weekly' });
  assert.equal(schedule.status, 400);
  assert.equal(schedule.body.error, 'invalid');
  assert.ok(schedule.body.message, 'the refusal says why');
});

// ---------------------------------------------------------------- 2. the default kind

test('a schedule without a kind is a daily task — the default, not a fallback', async (t) => {
  const { team, store } = await teamFixture(t);
  const bot = await writer(team);
  const schedule = await team.saveSchedule({ botId: bot.id, prompt: 'Daily digest' });
  assert.equal(schedule.kind, 'daily');
  assert.equal(schedule.time, '09:00');
  assert.equal(store.state.schedules.length, 1);
  assert.equal(store.state.schedules[0].kind, 'daily');
});

test('the declared kinds are still accepted', async (t) => {
  const { team } = await teamFixture(t);
  const bot = await writer(team);
  assert.equal((await team.saveSchedule({ botId: bot.id, prompt: 'Daily', kind: 'daily' })).kind, 'daily');
  assert.equal((await team.saveSchedule({ botId: bot.id, prompt: 'Hourly', kind: 'interval', everyMinutes: 30 })).kind, 'interval');
  assert.equal((await team.saveSchedule({ botId: bot.id, prompt: 'Once', kind: 'once', inMinutes: 10 })).kind, 'once');
});

// ---------------------------------------------------------------- 3. the reply mode

test('an unknown reply mode is refused when a group is created', async (t) => {
  const { team, store } = await teamFixture(t);
  const bot = await writer(team);
  await assert.rejects(
    () => team.createGroup(undefined, { name: 'Crew', members: [bot.id], replyMode: 'ALL' }),
    (error) => {
      assert.equal(error.code, 'invalid');
      assert.match(error.message, /admin/);
      assert.match(error.message, /all/);
      return true;
    },
  );
  assert.deepEqual(store.state.groups, [], 'no group was created');
});

test('a refused reply mode leaves the group with the setting it had', async (t) => {
  const { team, store } = await teamFixture(t);
  const bot = await writer(team);
  const group = await team.createGroup(undefined, { name: 'Crew', members: [bot.id], replyMode: 'all' });
  assert.equal(group.replyMode, 'all');
  for (const replyMode of ['ALL', 'everyone', ' all', 'Admin', '']) {
    await assert.rejects(
      () => team.updateGroup(undefined, group.id, { replyMode }),
      (error) => { assert.equal(error.code, 'invalid', `replyMode=${JSON.stringify(replyMode)}`); return true; },
    );
  }
  assert.equal(store.state.groups.find((g) => g.id === group.id)?.replyMode, 'all', 'the group kept "all"');
  assert.equal(group.replyMode, 'all');
});

test('the MCP group tools refuse an unknown reply mode', async (t) => {
  const { team, store, rpc } = await teamFixture(t);
  const bot = await writer(team);
  const created = await rpc('create_group', { name: 'Crew', members: [bot.id], reply_mode: 'ALL' });
  assert.equal(created.isError, true, 'create_group failed');
  assert.match(created.content[0].text, /admin/);
  assert.deepEqual(store.state.groups, []);

  const group = await team.createGroup(undefined, { name: 'Crew', members: [bot.id], replyMode: 'all' });
  const updated = await rpc('update_group', { group: group.id, reply_mode: 'ALL' });
  assert.equal(updated.isError, true, 'update_group failed');
  assert.equal(store.state.groups.find((g) => g.id === group.id)?.replyMode, 'all', 'the group kept "all"');
});

test('the HTTP group entries refuse an unknown reply mode too', async (t) => {
  const { post, patch } = await httpFixture(t);
  const bot = (await post('/api/bots', { name: 'Writer', role: 'writer', isMain: true })).body.bot;
  const created = await post('/api/groups', { name: 'Crew', members: [bot.id], replyMode: 'ALL' });
  assert.equal(created.status, 400);
  assert.equal(created.body.error, 'invalid');

  const group = (await post('/api/groups', { name: 'Crew', members: [bot.id], replyMode: 'all' })).body.group;
  const updated = await patch(`/api/groups/${group.id}`, { replyMode: 'ALL' });
  assert.equal(updated.status, 400);
  assert.equal(updated.body.error, 'invalid');
  assert.equal(updated.body.group, undefined, 'the group was not written to');
});

// ---------------------------------------------------------------- 4. the usage range

test('the usage range is a whole number of days, or the request is refused', async (t) => {
  const { get } = await httpFixture(t);
  for (const days of ['abc', '0', '91', '2.5', '-3', '', '1e999']) {
    const response = await get(`/api/usage?days=${encodeURIComponent(days)}`);
    assert.equal(response.status, 400, `days=${JSON.stringify(days)}`);
    assert.equal(response.body.error, 'invalid', `days=${JSON.stringify(days)}`);
    assert.ok(response.body.message, `days=${JSON.stringify(days)} says why`);
    assert.equal(response.body.buckets, undefined, 'no empty chart is handed out');
  }
});

test('a legal usage range still draws its chart', async (t) => {
  const { get } = await httpFixture(t);
  for (const days of [1, 7, 30, 90]) {
    const response = await get(`/api/usage?days=${days}`);
    assert.equal(response.status, 200, `days=${days}`);
    assert.equal(response.body.days, days === 1 ? 1 : days);
    assert.ok(response.body.buckets.length > 0, `days=${days} has buckets`);
  }
  // No range at all is the default range, not a mistake.
  const fallback = await get('/api/usage');
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.days, 7);
  assert.equal(fallback.body.buckets.length, 7);
});

// ---------------------------------------------------------------- 5. the messages are localised

test('the refusals are written in the user\'s language', async (t) => {
  const { team } = await teamFixture(t, 'zh');
  const bot = await writer(team);
  await assert.rejects(
    () => team.saveSchedule({ botId: bot.id, prompt: '周报', kind: 'weekly' }),
    (error) => {
      assert.equal(error.code, 'invalid');
      assert.match(error.message, /daily/);
      assert.match(error.message, /interval/);
      assert.match(error.message, /once/);
      return true;
    },
  );
  await assert.rejects(
    () => team.createGroup(undefined, { name: '小组', members: [bot.id], replyMode: 'ALL' }),
    (error) => { assert.equal(error.code, 'invalid'); assert.match(error.message, /admin/); return true; },
  );
});

test('a value that is not there at all is left out, not refused', async (t) => {
  const { team } = await teamFixture(t);
  const bot = await writer(team);
  // A model that leaves an optional field out often writes it as null. That is the same as
  // leaving it out, so the default applies. A value that is there but wrong is still refused.
  const group = await team.createGroup(undefined, { name: 'NullMode', members: [bot.id], replyMode: null });
  assert.equal(group.replyMode, 'admin', 'the default applies to a reply mode sent as null');
  const schedule = await team.saveSchedule({ botId: bot.id, prompt: 'Daily digest', kind: null });
  assert.equal(schedule.kind, 'daily', 'the default applies to a kind sent as null');

  // A value that is there but not one of the allowed ones is still refused.
  await assert.rejects(
    () => team.createGroup(undefined, { name: 'WrongMode', members: [bot.id], replyMode: 'everyone' }),
    (error) => { assert.equal(error.code, 'invalid'); return true; },
  );
  await assert.rejects(
    () => team.saveSchedule({ botId: bot.id, prompt: 'Report', kind: 'hourly' }),
    (error) => { assert.equal(error.code, 'invalid'); return true; },
  );
});

test('a reply mode sent as null leaves an existing group with the setting it had', async (t) => {
  const { team } = await teamFixture(t);
  const bot = await writer(team);
  const group = await team.createGroup(undefined, { name: 'Crew', members: [bot.id], replyMode: 'all' });
  const updated = await team.updateGroup(undefined, group.id, { replyMode: null });
  assert.equal(updated.replyMode, 'all', 'the mode the group had is kept');
});
