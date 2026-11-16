import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine } from '../miniapp/node/engine.mjs';
import { Team } from '../miniapp/node/team.mjs';
import { createMcpHandler } from '../miniapp/node/mcp.mjs';
import { setLocale, t as translate } from '../miniapp/node/i18n.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(predicate) {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The expected engine state did not arrive');
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-engine-reliability-'));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  setLocale('en');
  const events = [];
  const engine = new Engine({ store, memory, logger: { warn() {} }, broadcast: (event) => events.push(event), retryDelaysMs: [] });
  const team = new Team({ store, memory, engine, broadcast() {} });
  const handle = createMcpHandler({ team, engine });
  const rpc = async (name, args) => {
    let response;
    await handle({ method: 'POST' }, { writeHead() { return this; }, end(body) { response = JSON.parse(body); } },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    return response.result;
  };
  t.after(async () => {
    engine.dispose();
    await until(() => engine.running.size === 0 && engine.helperRuns.size === 0 && engine.inbox.batches.size === 0 && engine.tasks.runs.size === 0 && engine.tasks.deliveries.size === 0);
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, memory, engine, team, rpc, events };
}

function groupFixture(store) {
  const a = { id: 'bot_a', name: 'Alice', role: 'Writer' };
  const b = { id: 'bot_b', name: 'Bob', role: 'Reviewer' };
  const group = { id: 'grp_review', name: 'Review', adminId: a.id, memberIds: [a.id, b.id], replyMode: 'admin' };
  store.state.bots = [a, b];
  store.state.groups = [group];
  return { a, b, group, chatId: `group:${group.id}` };
}

function started(input, options, sessionId) {
  const session = input.sessionId ?? sessionId;
  options.onEvent({ type: 'turn.started', sessionId: session, turnId: `turn-${session}` });
  return { sessionId: session, turnId: `turn-${session}` };
}

function idle(engine) {
  return engine.running.size === 0 && engine.tickets.size === 0 && engine.groupLoops.size === 0 && engine.inbox.batches.size === 0 && engine.tasks.runs.size === 0 && engine.tasks.deliveries.size === 0;
}

test('post_group is advertised only for private chats and its shared catalog explains the group restriction', async (t) => {
  const { store, engine, team } = await fixture(t);
  const { a, b, chatId } = groupFixture(store);
  a.isMain = true;
  const handle = createMcpHandler({ team, engine });
  for (const language of ['zh', 'en']) {
    setLocale(language);
    const privateInstruction = translate('brief.tool.postGroup');
    const groupRestriction = translate('brief.groupNoPost');
    for (const bot of [a, b]) {
      const groupBrief = engine.buildStandingBrief(bot, chatId);
      assert.ok(groupBrief.includes(groupRestriction));
      assert.ok(!groupBrief.includes(privateInstruction));
      const privateBrief = engine.buildStandingBrief(bot, `bot:${bot.id}`);
      assert.ok(privateBrief.includes(privateInstruction));
      assert.ok(!privateBrief.includes(groupRestriction));
    }
    let catalog;
    await handle({ method: 'POST' }, { writeHead() { return this; }, end(body) { catalog = JSON.parse(body).result; } },
      { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const post = catalog.tools.find((tool) => tool.name === 'post_group');
    assert.match(post.description, language === 'zh' ? /仅限单聊.*群聊回合中禁用/ : /Private chat only.*Disabled during group turns/);
  }
  setLocale('en');
});

test('group post_group calls from Chief and members are rejected while reply mentions still hand off', async (t) => {
  const { store, engine, rpc } = await fixture(t);
  const { a, b, group, chatId } = groupFixture(store);
  a.isMain = true;
  const other = { ...group, id: 'grp_other', name: 'Other', memberIds: [...group.memberIds] };
  store.state.groups.push(other);
  const speakers = [];
  const rejected = [];
  engine.agent = { async run(input, options) {
    const speaker = input.text.includes("It's your turn (Alice).") ? a : b;
    const ids = started(input, options, `session-${speaker.id}`);
    speakers.push(speaker.id);
    for (const target of [group, other]) {
      rejected.push(await rpc('post_group', { caller_bot_id: speaker.id, group: target.id, message: 'Should not be posted' }));
    }
    return { ...ids, status: 'finished', text: speaker.id === a.id ? '@Bob please review' : 'Reviewed' };
  } };
  await engine.sendUserMessage(chatId, 'Please discuss');
  await until(() => idle(engine));
  assert.deepEqual(speakers, [a.id, b.id]);
  assert.equal(rejected.length, 4);
  for (const response of rejected) {
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /only available in a private chat/);
    assert.doesNotMatch(response.content[0].text, /wait for this round/);
  }
  for (const target of [group, other]) {
    assert.equal((await store.getMessages(`group:${target.id}`)).filter((message) => message.role === 'relay').length, 0);
  }
});

test('private post_group keeps main and member access and refuses a non-member', async (t) => {
  for (const role of ['main', 'member', 'outsider']) {
    await t.test(role, async (t) => {
      const { store, engine, rpc } = await fixture(t);
      const { a, b, group, chatId } = groupFixture(store);
      const caller = role === 'member' ? a : { id: `bot_${role}`, name: role, isMain: role === 'main' };
      if (caller !== a) store.state.bots.push(caller);
      let response;
      let replies = 0;
      engine.agent = { async run(input, options) {
        const ids = started(input, options, input.text.endsWith('PRIVATE_POST_REQUEST') ? 'caller-session' : 'group-session');
        if (input.text.endsWith('PRIVATE_POST_REQUEST')) {
          response = await rpc('post_group', { caller_bot_id: caller.id, group: group.id, message: '@Bob review this' });
        } else {
          replies += 1;
          assert.ok(input.text.includes('@Bob review this') || input.text.includes('Task results'));
        }
        return { ...ids, status: 'finished', text: 'Done' };
      } };
      await engine.runBotTurn({ bot: caller, chatId: `bot:${caller.id}`, text: 'PRIVATE_POST_REQUEST', kind: 'private' });
      await until(() => idle(engine));
      const posts = (await store.getMessages(chatId)).filter((message) => message.role === 'relay');
      if (role === 'outsider') {
        assert.equal(response.isError, true);
        assert.match(response.content[0].text, /not a member/);
        assert.equal(posts.length, 0);
        assert.equal(replies, 0);
      } else {
        assert.equal(response.isError, undefined);
        assert.deepEqual(JSON.parse(response.content[0].text).first_speaker, [b.name]);
        assert.equal(posts.length, 1);
        assert.equal(posts[0].fromBotId, caller.id);
        assert.equal(replies, 2);
      }
    });
  }
});

test('an existing group session receives the post_group restriction on its next run', async (t) => {
  const { store, engine } = await fixture(t);
  const { a, chatId } = groupFixture(store);
  await store.setSession(chatId, a.id, { sessionId: 'existing-group-session', stamp: 'before-private-only-post-group' });
  let submitted;
  engine.agent = { async run(input, options) {
    submitted = input;
    return { ...started(input, options, 'unused-new-session'), status: 'finished', text: 'Done' };
  } };
  await engine.runBotTurn({ bot: a, chatId, text: 'Continue', kind: 'group' });
  assert.equal(submitted.sessionId, 'existing-group-session');
  assert.ok(submitted.text.includes(translate('brief.groupNoPost')));
  assert.ok(!submitted.text.includes(translate('brief.tool.postGroup')));
});

test('a Bot in concurrent chats cannot assign a helper or group post to a guessed caller', async (t) => {
  const { store, engine, rpc } = await fixture(t);
  const { a, group, chatId } = groupFixture(store);
  const firstStarted = deferred();
  const secondStarted = deferred();
  const finish = deferred();
  t.after(() => finish.resolve());
  let count = 0;
  engine.agent = { async run(input, options) {
    const ids = started(input, options, `session-${++count}`);
    (count === 1 ? firstStarted : secondStarted).resolve();
    await finish.promise;
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  const privateTurn = engine.runBotTurn({ bot: a, chatId: `bot:${a.id}`, text: 'Private request', kind: 'private' });
  await firstStarted.promise;
  const groupTurn = engine.runBotTurn({ bot: a, chatId, text: 'Group request', kind: 'group' });
  await secondStarted.promise;
  for (const [name, args] of [
    ['start_helper', { task: 'Confidential work' }],
    ['post_group', { group: group.id, message: 'Start work' }],
  ]) {
    const response = await rpc(name, { caller_bot_id: a.id, ...args });
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /multiple chats/);
  }
  assert.equal(store.state.helpers.length, 0);
  assert.equal((await store.getMessages(chatId)).filter((message) => message.role === 'relay').length, 0);
  finish.resolve();
  await Promise.all([privateTurn, groupTurn]);
});

test('a helper from an unambiguous private turn stays in that chat after other turns start', async (t) => {
  const { store, engine } = await fixture(t);
  const { a, chatId } = groupFixture(store);
  const helperStarted = deferred();
  const finishHelper = deferred();
  const finishGroup = deferred();
  t.after(() => { finishHelper.resolve(); finishGroup.resolve(); });
  let helper;
  const reportChats = [];
  engine.agent = { async run(input, options) {
    const ids = started(input, options, `session-${Math.random()}`);
    if (input.text.startsWith('<minimax-bot-helper>')) {
      helperStarted.resolve();
      await finishHelper.promise;
      return { ...ids, status: 'finished', text: 'PRIVATE_RESULT' };
    }
    if (input.text.endsWith('PRIVATE_REQUEST')) {
      helper = await engine.startHelper(a, { task: 'Confidential work' });
    } else if (input.text.endsWith('GROUP_REQUEST')) {
      await finishGroup.promise;
    } else if (input.text.includes('PRIVATE_RESULT')) {
      reportChats.push([...engine.running.values()].find((turn) => turn.message.kind === 'helper').chatId);
    }
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  await engine.runBotTurn({ bot: a, chatId: `bot:${a.id}`, text: 'PRIVATE_REQUEST', kind: 'private' });
  await helperStarted.promise;
  const groupTurn = engine.runBotTurn({ bot: a, chatId, text: 'GROUP_REQUEST', kind: 'group' });
  await until(() => engine.running.has(`${chatId}::${a.id}`));
  finishHelper.resolve();
  await until(() => reportChats.length === 1);
  assert.equal(helper.chatId, `bot:${a.id}`);
  assert.deepEqual(reportChats, [`bot:${a.id}`]);
  finishGroup.resolve();
  await groupTurn;
  await until(() => idle(engine));
});

test('a slow MCP result never attaches activity to a newer turn after its original turn ends', async (t) => {
  const { store, engine, team, rpc } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  const toolEntered = deferred();
  const finishTool = deferred();
  const finishNext = deferred();
  t.after(() => { finishTool.resolve(); finishNext.resolve(); });
  const create = team.createBot.bind(team);
  team.createBot = async (...args) => { toolEntered.resolve(); await finishTool.promise; return create(...args); };
  let request;
  let runs = 0;
  engine.agent = { async run(input, options) {
    const ids = started(input, options, `session-${++runs}`);
    if (runs === 1) {
      request = rpc('create_bot', { caller_bot_id: bot.id, name: 'New teammate' });
      await toolEntered.promise;
    } else {
      await finishNext.promise;
    }
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  await engine.runBotTurn({ bot, chatId, text: 'First', kind: 'private' });
  const next = engine.runBotTurn({ bot, chatId, text: 'Second', kind: 'private' });
  await until(() => runs === 2);
  const current = engine.running.get(`${chatId}::${bot.id}`);
  finishTool.resolve();
  assert.equal((await request).isError, undefined);
  assert.equal(current.message.parts.some((part) => part.type === 'event'), false);
  assert.equal(current.message.live, undefined);
  finishNext.resolve();
  await next;
});

test('a group member receives messages that arrived during its earlier reply', async (t) => {
  const { store, engine } = await fixture(t);
  const { a, b, chatId } = groupFixture(store);
  const firstStarted = deferred();
  const finishFirst = deferred();
  t.after(() => finishFirst.resolve());
  let aliceTurns = 0;
  let finalPrompt;
  engine.agent = { async run(input, options) {
    const isAlice = input.text.includes("It's your turn (Alice).");
    const ids = started(input, options, isAlice ? 'alice-session' : 'bob-session');
    if (isAlice && ++aliceTurns === 1) { firstStarted.resolve(); await finishFirst.promise; }
    else if (isAlice) finalPrompt = input.text;
    return { ...ids, status: 'finished', text: isAlice ? 'Alice finished' : 'Bob correction result' };
  } };
  await engine.sendUserMessage(chatId, '@Alice first-request');
  await firstStarted.promise;
  const correction = await engine.sendUserMessage(chatId, '@Bob second-correction');
  assert.equal(store.getSession(chatId, b.id), undefined, 'a supplement waits for the earlier user round');
  finishFirst.resolve();
  await until(() => idle(engine));
  assert.ok(store.getSession(chatId, a.id).lastSeenSeq < correction.seq);
  await engine.sendUserMessage(chatId, '@Alice third-request');
  await until(() => idle(engine));
  assert.match(finalPrompt, /second-correction/);
  assert.match(finalPrompt, /Bob correction result/);
  assert.doesNotMatch(finalPrompt, /first-request/);
});

test('group snapshots use sequence numbers and preserve unfinished earlier replies', async (t) => {
  const { store, engine } = await fixture(t);
  const { a, b, group, chatId } = groupFixture(store);
  const first = await store.appendMessage(chatId, { role: 'user', text: 'Seen', ts: 7 });
  const pending = await store.appendMessage(chatId, { role: 'bot', botId: b.id, text: '', status: 'streaming', ts: 7 });
  const next = await store.appendMessage(chatId, { role: 'user', text: 'New same-millisecond input', ts: 7 });
  await store.setSession(chatId, a.id, { sessionId: 'alice', lastSeenSeq: first.seq, lastSeen: Date.now() + 100000 });
  const snapshot = await engine.groupPrompt(group, a);
  assert.match(snapshot.text, /New same-millisecond input/);
  assert.equal(snapshot.groupCursor, pending.seq - 1);
  await store.updateMessage(chatId, pending.id, { status: 'done', text: 'Late result' });
  const complete = await engine.groupPrompt(group, a);
  assert.match(complete.text, /Late result/);
  assert.equal(complete.groupCursor, next.seq);
});

test('question answers do not acknowledge group messages the answer API never delivered', async (t) => {
  const { store, engine } = await fixture(t);
  const { a, group, chatId } = groupFixture(store);
  const initial = await store.appendMessage(chatId, { role: 'user', text: 'Initial request' });
  engine.agent = {
    async run(input, options) {
      const ids = started(input, options, 'alice');
      return { ...ids, status: 'finished', text: 'Choose', pendingQuestion: {
        requestId: 'question', mode: 'questionnaire', request: { schemaVersion: 2, id: 'question', steps: [] },
      } };
    },
    async answer(input, options) {
      const ids = started(input, options, 'alice');
      return { ...ids, status: 'finished', text: 'Answer accepted' };
    },
  };
  const result = await engine.runBotTurn({ bot: a, chatId, text: '', kind: 'group' });
  await store.appendMessage(chatId, { role: 'user', text: 'New group context while choosing' });
  await engine.answerQuestion(chatId, result.messageId, []);
  await until(() => idle(engine) && !store.messageCache.get(chatId).find((message) => message.id === result.messageId).question);
  assert.equal(store.getSession(chatId, a.id).lastSeenSeq, initial.seq);
  assert.match((await engine.groupPrompt(group, a)).text, /New group context while choosing/);
});

test('helper report turns consume a group snapshot but leave later messages unread', async (t) => {
  const { store, engine } = await fixture(t);
  const { a, group, chatId } = groupFixture(store);
  const initial = await store.appendMessage(chatId, { role: 'user', text: 'Prior group context' });
  const reportStarted = deferred();
  const finishReport = deferred();
  t.after(() => finishReport.resolve());
  let reportPrompt;
  engine.agent = { async run(input, options) {
    const ids = started(input, options, 'alice');
    reportPrompt = input.text;
    reportStarted.resolve();
    await finishReport.promise;
    return { ...ids, status: 'finished', text: 'Reported' };
  } };
  const delivery = engine.deliverHelperReport({ id: 'helper', botId: a.id, chatId, title: 'Research', status: 'done', report: 'A useful report' });
  await reportStarted.promise;
  await store.appendMessage(chatId, { role: 'user', text: 'Arrived during report' });
  finishReport.resolve();
  await delivery;
  assert.match(reportPrompt, /Prior group context/);
  assert.match(reportPrompt, /A useful report/);
  assert.equal(store.getSession(chatId, a.id).lastSeenSeq, initial.seq);
  assert.match((await engine.groupPrompt(group, a)).text, /Arrived during report/);
});

test('retrying a group reply rejected before dispatch delivers its original and new inputs once accepted', async (t) => {
  const { store, engine } = await fixture(t);
  const { a, chatId } = groupFixture(store);
  await store.appendMessage(chatId, { role: 'user', text: 'Original request' });
  let attempts = 0;
  let accepted;
  engine.agent = { async run(input, options) {
    if (++attempts === 1) throw Object.assign(new Error('Unavailable'), { code: 'AGENT_UNAVAILABLE', retryable: true });
    const ids = started(input, options, 'alice');
    accepted = input.text;
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  const failed = await engine.runBotTurn({ bot: a, chatId, text: '', kind: 'group' });
  assert.equal(failed.status, 'error');
  assert.equal(store.getSession(chatId, a.id)?.lastSeenSeq, undefined);
  const correction = await store.appendMessage(chatId, { role: 'user', text: 'Correction before retry' });
  await engine.retryMessage(chatId, failed.messageId);
  await until(() => idle(engine));
  assert.match(accepted, /Original request/);
  assert.match(accepted, /Correction before retry/);
  assert.equal(store.getSession(chatId, a.id).lastSeenSeq, correction.seq);
});

test('ending a root turn removes approvals raised by its delegated child sessions', async (t) => {
  const { store, engine, events } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  engine.agent = { async run(input, options) {
    const ids = started(input, options, 'root');
    options.onEvent({ type: 'permission.requested', sessionId: 'child', requestId: 'child-ask', toolName: 'shell', reason: 'Approval needed' });
    assert.equal(engine.approvals.size, 1);
    return { ...ids, status: 'aborted' };
  } };
  await engine.runBotTurn({ bot, chatId, text: 'Work', kind: 'private' });
  assert.equal(engine.approvals.size, 0);
  assert.ok(events.some((event) => event.type === 'approval.removed' && event.requestId === 'child-ask'));
  assert.equal(events.filter((event) => event.type === 'chat.summary').at(-1).summary.pending, false);
});

test('ending a helper removes approvals raised by its delegated child sessions', async (t) => {
  const { store, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const helper = { id: 'helper', botId: bot.id, chatId: `bot:${bot.id}`, title: 'Work', task: 'Work', status: 'queued', createdAt: Date.now() };
  store.state.helpers.push(helper);
  engine.agent = { async run(input, options) {
    const ids = started(input, options, 'root');
    if (input.text.startsWith('<minimax-bot-helper>')) {
      options.onEvent({ type: 'permission.requested', sessionId: 'helper-child', requestId: 'helper-ask', toolName: 'shell', reason: 'Approval needed' });
      assert.equal(engine.approvals.get('helper-ask').helperId, helper.id);
      return { ...ids, status: 'aborted' };
    }
    return { ...ids, status: 'finished', text: 'Task was interrupted' };
  } };
  await engine.runHelper(helper);
  assert.equal(helper.status, 'interrupted');
  assert.equal(engine.approvals.size, 0);
  const resultMessage = (await store.getMessages(helper.chatId)).find((message) => message.id === helper.resultMessageId);
  assert.equal(resultMessage.role, 'bot');
  assert.equal(engine.helperView(helper).resultMessageId, resultMessage.id);
});

test('mentions resolve whole longest names in source order without matching email addresses or prefixes', async (t) => {
  const { store, engine } = await fixture(t);
  store.state.bots = [
    { id: 'short', name: '设计' }, { id: 'long', name: '设计师' },
    { id: 'alice', name: 'Alice' }, { id: 'space', name: 'Alice Smith' },
  ];
  const group = { memberIds: store.state.bots.map((bot) => bot.id) };
  assert.deepEqual(engine.mentionsIn('@设计师，请回答。', group), ['long']);
  assert.deepEqual(engine.mentionsIn('@设计 @设计师 @设计', group), ['short', 'long']);
  assert.deepEqual(engine.mentionsIn('mail@Alice.com @ALICE SMITH! @Alice', group), ['space', 'alice']);
  assert.deepEqual(engine.mentionsIn('@Alicex @设计师傅', group), []);
  assert.deepEqual(engine.mentionsIn('@设计师 @设计', group, 'long'), ['short']);
});

test('concurrent and repeated client IDs append and start exactly once, including after reload', async (t) => {
  const { dir, store, memory, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  let runs = 0;
  engine.agent = { async run(input, options) {
    runs += 1;
    return { ...started(input, options, 'bot-session'), status: 'finished', text: 'Done' };
  } };
  const [first, duplicate] = await Promise.all([
    engine.sendUserMessage(chatId, 'Please do this', [], 'submission-1'),
    engine.sendUserMessage(chatId, 'Please do this', [], 'submission-1'),
  ]);
  assert.equal(first.id, duplicate.id);
  await until(() => idle(engine));
  assert.equal(runs, 1);
  assert.equal((await engine.sendUserMessage(chatId, 'Please do this', [], 'submission-1')).id, first.id);
  await assert.rejects(engine.sendUserMessage(chatId, 'Different content', [], 'submission-1'), (error) => error.code === 'invalid');
  const restored = new Store(dir);
  await restored.init();
  const reopened = new Engine({ store: restored, memory, logger: { warn() {} }, broadcast() {}, agent: engine.agent });
  assert.equal((await reopened.sendUserMessage(chatId, 'Please do this', [], 'submission-1')).id, first.id);
  assert.equal((await restored.getMessages(chatId)).filter((message) => message.role === 'user').length, 1);
  assert.equal(runs, 1);
  reopened.dispose();
});

test('a failed durable append can be retried with the same client message ID', async (t) => {
  const { dir, store, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  let runs = 0;
  engine.agent = { async run(input, options) {
    runs += 1;
    return { ...started(input, options, 'bot-session'), status: 'finished', text: 'Done' };
  } };
  const pathFor = store.messagePath.bind(store);
  store.messagePath = () => join(dir, 'missing', 'message.json');
  await assert.rejects(engine.sendUserMessage(chatId, 'Retry me', [], 'submission-2'), { code: 'ENOENT' });
  assert.equal(engine.userMessageRequests.size, 0);
  assert.equal(runs, 0);
  store.messagePath = pathFor;
  await engine.sendUserMessage(chatId, 'Retry me', [], 'submission-2');
  await until(() => idle(engine));
  assert.equal((await store.getMessages(chatId)).filter((message) => message.role === 'user').length, 1);
  assert.equal(runs, 1);
});

test('a different message ID is accepted while the previous reply is busy and conflicting in-flight IDs are refused', async (t) => {
  const { store, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  const finishFirst = deferred();
  t.after(() => finishFirst.resolve());
  let runs = 0;
  engine.agent = { async run(input, options) {
    const ids = started(input, options, 'bot-session');
    if (++runs === 1) await finishFirst.promise;
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  const first = engine.sendUserMessage(chatId, 'First', [], 'submission-a');
  await assert.rejects(engine.sendUserMessage(chatId, 'Conflicting', [], 'submission-a'), (error) => error.code === 'invalid');
  await first;
  await until(() => runs === 1);
  await engine.sendUserMessage(chatId, 'Second', [], 'submission-b');
  assert.equal((await store.getMessages(chatId)).filter((message) => message.role === 'user').length, 2);
  finishFirst.resolve();
  await until(() => idle(engine));
  assert.equal(runs, 2);
});

test('a late group post from a cancelled Bot turn cannot be treated as a user post', async (t) => {
  const { store, engine, rpc } = await fixture(t);
  const { a, group, chatId } = groupFixture(store);
  const finish = deferred();
  t.after(() => finish.resolve());
  let runs = 0;
  engine.agent = { async run(input, options) {
    const ids = started(input, options, 'source');
    runs += 1;
    await finish.promise;
    return { ...ids, status: 'aborted' };
  } };
  const source = engine.runBotTurn({ bot: a, chatId, text: 'Original group work', kind: 'group' });
  await until(() => runs === 1);
  engine.cancelChat(chatId);
  const response = await rpc('post_group', { caller_bot_id: a.id, group: group.id, message: 'Late post after stop' });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /active reply/);
  assert.equal((await store.getMessages(chatId)).filter((message) => message.role === 'relay').length, 0);
  finish.resolve();
  await source;
  assert.equal(runs, 1);
});


test('a helper cancelled while its admission is persisted is marked stopped and never runs', async (t) => {
  const { store, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  const finish = deferred();
  const saveEntered = deferred();
  const finishSave = deferred();
  t.after(() => { finish.resolve(); finishSave.resolve(); });
  let runs = 0;
  engine.agent = { async run(input, options) {
    const ids = started(input, options, 'source');
    runs += 1;
    await finish.promise;
    return { ...ids, status: 'aborted' };
  } };
  const source = engine.runBotTurn({ bot, chatId, text: 'Start background work', kind: 'private' });
  await until(() => runs === 1);
  const save = store.save.bind(store);
  store.save = async () => {
    if (store.state.helpers.some((helper) => helper.status === 'queued')) { saveEntered.resolve(); await finishSave.promise; }
    return save();
  };
  const helper = engine.startHelper(bot, { task: 'A new task' });
  const rejected = assert.rejects(helper, (error) => error.code === 'busy');
  await saveEntered.promise;
  engine.cancelChat(chatId);
  finishSave.resolve();
  await rejected;
  assert.equal(store.state.helpers[0].status, 'stopped');
  assert.equal(engine.helperRuns.size, 0);
  assert.equal(runs, 1);
  finish.resolve();
  await source;
});

for (const kind of ['private', 'group']) test(`a ${kind} message persisted before process death is recovered once when the same submission retries`, async (t) => {
  const { dir, store, memory } = await fixture(t);
  const chatId = kind === 'group' ? groupFixture(store).chatId : store.chatIds()[0];
  await store.save();
  const moduleUrl = (name) => new URL(`../miniapp/node/${name}.mjs`, import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { Store } from ${JSON.stringify(moduleUrl('store'))};
    import { MemoryStore } from ${JSON.stringify(moduleUrl('memory'))};
    import { Engine } from ${JSON.stringify(moduleUrl('engine'))};
    const store = new Store(process.argv[1]);
    const memory = new MemoryStore(process.argv[1]);
    await store.init(); await memory.init();
    const engine = new Engine({ store, memory, broadcast() {}, logger: { warn() {} } });
    engine.runBotTurn = () => process.exit(42);
    await engine.sendUserMessage(process.argv[2], 'Execute once', [], 'durable-crash');
  `, dir, chatId], { encoding: 'utf8' });
  assert.equal(child.status, 42, child.stderr);
  const restored = new Store(dir);
  await restored.init();
  let runs = 0;
  const reopened = new Engine({ store: restored, memory, logger: { warn() {} }, broadcast() {}, agent: {
    async run(input, options) { runs += 1; return { ...started(input, options, 'recovered'), status: 'finished', text: 'Recovered' }; },
  } });
  const [first, duplicate] = await Promise.all([
    reopened.sendUserMessage(chatId, 'Execute once', [], 'durable-crash'),
    reopened.sendUserMessage(chatId, 'Execute once', [], 'durable-crash'),
  ]);
  assert.equal(first.id, duplicate.id);
  await until(() => idle(reopened));
  assert.equal(runs, 1);
  await reopened.sendUserMessage(chatId, 'Execute once', [], 'durable-crash');
  assert.equal(runs, 1);
  const messages = await restored.getMessages(chatId);
  assert.equal(messages.filter((message) => message.role === 'user').length, 1);
  assert.equal(messages.filter((message) => message.sourceMessageId === first.id).length, 1);
  reopened.dispose();
  await restored.writeChain;
});

test('an interrupted associated assistant is reported as uncertain, and legacy messages are never replayed', async (t) => {
  const { dir, store, memory, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  const user = await store.appendMessage(chatId, {
    role: 'user', text: 'Possibly already executed', clientMessageId: 'uncertain-1',
    clientMessageHash: engine.userMessageFingerprint('Possibly already executed', []), dispatchState: 'pending',
  });
  await store.appendMessage(chatId, { role: 'bot', botId: bot.id, sourceMessageId: user.id, status: 'streaming', text: '', sessionId: 'host-session' });
  const legacy = await store.appendMessage(chatId, { role: 'user', text: 'Legacy request', clientMessageId: 'legacy-1' });
  const restored = new Store(dir);
  await restored.init();
  let runs = 0;
  const reopened = new Engine({ store: restored, memory, logger: { warn() {} }, broadcast() {}, agent: { async run() { runs += 1; } } });
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(reopened.sendUserMessage(chatId, 'Possibly already executed', [], 'uncertain-1'), (error) => error.code === 'delivery_uncertain');
  }
  assert.equal((await restored.getMessages(chatId)).find((message) => message.id === user.id).dispatchState, 'uncertain');
  assert.equal((await reopened.sendUserMessage(chatId, 'Legacy request', [], 'legacy-1')).id, legacy.id);
  assert.equal(runs, 0);
  reopened.dispose();
  await restored.writeChain;
});

test('a request whose queue died with the process is still sendable from the page', async (t) => {
  const { dir, store, memory, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  // The process died after the inbox marked the batch processing and before any reply existed.
  const user = await store.appendMessage(chatId, {
    role: 'user', text: 'Ship the hotfix', clientMessageId: 'orphan-1',
    clientMessageHash: engine.userMessageFingerprint('Ship the hotfix', []), dispatchState: 'processing',
  });
  await store.writeChain;

  const restored = new Store(dir);
  await restored.init();
  let runs = 0;
  const reopened = new Engine({ store: restored, memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [], agent: {
    async run(input, options) { runs += 1; return { ...started(input, options, 'resumed'), status: 'finished', text: 'Shipped' }; },
  } });
  reopened.startScheduler();
  reopened.tasks.start();

  // The load-time mapping keeps `pending`, which the client retry path needs. The queue that owned
  // it is gone, so the resume route has to recognise it too or the request is stranded for good.
  const afterRestart = (await restored.getMessages(chatId)).find((message) => message.id === user.id);
  assert.equal(afterRestart.dispatchState, 'pending');
  await until(() => idle(reopened));
  // Nothing replays it on its own: the turn may already have run tools before the process died.
  assert.equal(runs, 0);

  await reopened.inbox.resume(chatId);
  await until(() => idle(reopened));
  assert.equal(runs, 1);
  const messages = await restored.getMessages(chatId);
  assert.equal(messages.find((message) => message.id === user.id).dispatchState, 'delivered');
  assert.equal(messages.filter((message) => message.sourceMessageId === user.id).length, 1);
  reopened.dispose();
  await restored.writeChain;
});

test('repeated pending submissions do not duplicate queued turns or revive a deliberately cancelled queue', async (t) => {
  const { store, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  const finish = deferred();
  t.after(() => finish.resolve());
  let runs = 0;
  engine.agent = { async run(input, options) {
    const ids = started(input, options, 'source');
    runs += 1;
    await finish.promise;
    return { ...ids, status: 'aborted' };
  } };
  await engine.sendUserMessage(chatId, 'First', [], 'queue-1');
  await until(() => runs === 1);
  const queued = await engine.sendUserMessage(chatId, 'Second', [], 'queue-2');
  assert.equal((await engine.sendUserMessage(chatId, 'Second', [], 'queue-2')).id, queued.id);
  assert.equal(engine.isBusy(chatId), true);
  assert.equal(queued.dispatchState, 'pending');
  engine.cancelChat(chatId);
  finish.resolve();
  await until(() => idle(engine));
  assert.equal(queued.dispatchState, 'cancelled');
  await engine.sendUserMessage(chatId, 'Second', [], 'queue-2');
  assert.equal(runs, 1);
});

test('failed retry claims preserve eligibility and a concurrent retry cannot dispatch twice', async (t) => {
  const { dir, store, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  const failed = await store.appendMessage(chatId, { role: 'bot', botId: bot.id, status: 'error', retryable: true, retryInput: 'Original input', text: '' });
  let runs = 0;
  engine.agent = { async run(input, options) { runs += 1; return { ...started(input, options, 'retry'), status: 'finished', text: 'Done' }; } };
  const pathFor = store.messagePath.bind(store);
  store.messagePath = () => join(dir, 'missing', 'message.json');
  await assert.rejects(engine.retryMessage(chatId, failed.id), { code: 'ENOENT' });
  assert.equal(failed.retryable, true);
  assert.equal(failed.retryInput, 'Original input');
  assert.equal(engine.retryRequests.size, 0);
  assert.equal(runs, 0);
  store.messagePath = pathFor;
  const update = store.updateMessage.bind(store);
  const writing = deferred();
  const finish = deferred();
  t.after(() => finish.resolve());
  store.updateMessage = async (chat, id, patch, ...rest) => {
    if (id === failed.id && patch.retryable === false) { writing.resolve(); await finish.promise; }
    return update(chat, id, patch, ...rest);
  };
  const retry = engine.retryMessage(chatId, failed.id);
  await writing.promise;
  await assert.rejects(engine.retryMessage(chatId, failed.id), (error) => error.code === 'busy');
  finish.resolve();
  await retry;
  await until(() => idle(engine));
  assert.equal(runs, 1);
});

test('failed questionnaire claims keep the form answerable and concurrent submissions answer once', async (t) => {
  const { dir, store, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  const question = await store.appendMessage(chatId, { role: 'bot', botId: bot.id, status: 'done', sessionId: 'question-session', text: 'Choose', question: {
    requestId: 'request-1', mode: 'questionnaire', request: { schemaVersion: 2, id: 'request-1', steps: [] },
  } });
  let answers = 0;
  engine.agent = { async answer(input, options) { answers += 1; return { ...started(input, options, 'question-session'), status: 'finished', text: 'Accepted' }; } };
  const pathFor = store.messagePath.bind(store);
  store.messagePath = () => join(dir, 'missing', 'message.json');
  await assert.rejects(engine.answerQuestion(chatId, question.id, []), { code: 'ENOENT' });
  assert.equal(question.answering, undefined);
  assert.ok(question.question);
  assert.equal(engine.answerRequests.size, 0);
  assert.equal(answers, 0);
  store.messagePath = pathFor;
  const update = store.updateMessage.bind(store);
  const writing = deferred();
  const finish = deferred();
  t.after(() => finish.resolve());
  store.updateMessage = async (chat, id, patch, ...rest) => {
    if (id === question.id && patch.answering === true) { writing.resolve(); await finish.promise; }
    return update(chat, id, patch, ...rest);
  };
  const answer = engine.answerQuestion(chatId, question.id, []);
  await writing.promise;
  await assert.rejects(engine.answerQuestion(chatId, question.id, []), (error) => error.code === 'busy');
  finish.resolve();
  await answer;
  await until(() => idle(engine) && question.answered);
  assert.equal(answers, 1);
});

for (const stop of ['chat', 'bot', 'dispose']) test(`cancelling ${stop} while the assistant placeholder is persisted never reaches the Host`, async (t) => {
  const { dir, store, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  const source = await store.appendMessage(chatId, {
    role: 'user', text: 'Do this once', clientMessageId: `cancel-${stop}`, dispatchState: 'pending',
  });
  const written = deferred();
  const finish = deferred();
  t.after(() => finish.resolve());
  const append = store.appendMessage.bind(store);
  store.appendMessage = async (chat, record) => {
    const message = await append(chat, record);
    if (record.role === 'bot') { written.resolve(); await finish.promise; }
    return message;
  };
  let calls = 0;
  engine.agent = { async run() { calls += 1; return { sessionId: 'unexpected', status: 'finished', text: 'Should not run' }; } };
  const run = engine.runBotTurn({ bot, chatId, text: source.text, kind: 'private', sourceMessageId: source.id });
  await written.promise;
  assert.equal(engine.running.size, 0);
  if (stop === 'chat') assert.equal(engine.cancelChat(chatId), 1);
  else if (stop === 'bot') engine.cancelBot(bot.id);
  else engine.dispose();
  finish.resolve();
  const result = await run;
  assert.equal(calls, 0);
  assert.equal(result.status, 'aborted');
  assert.equal(result.skipped, true);
  assert.equal(engine.activeSlots, 0);
  assert.equal(idle(engine), true);
  const reload = new Store(dir);
  await reload.init();
  const placeholder = (await reload.getMessages(chatId)).find((message) => message.id === result.messageId);
  assert.equal(placeholder.status, 'aborted');
  assert.equal(placeholder.sourceMessageId, source.id);
  // A deliberate stop is a settled submission, not a pending or uncertain replay.
  assert.equal((await engine.sendUserMessage(chatId, source.text, [], source.clientMessageId)).id, source.id);
  assert.equal(calls, 0);
});

for (const stage of ['prepareGroupInput', 'buildMemoryBrief', 'turnModel']) test(`cancelling while ${stage} awaits prevents the later Host call`, async (t) => {
  const { store, engine } = await fixture(t);
  const { a: bot, chatId } = groupFixture(store);
  const entered = deferred();
  const finish = deferred();
  t.after(() => finish.resolve());
  const original = engine[stage].bind(engine);
  engine[stage] = async (...args) => { entered.resolve(); await finish.promise; return original(...args); };
  let calls = 0;
  engine.agent = { async run() { calls += 1; return { sessionId: 'unexpected', status: 'finished', text: 'Should not run' }; } };
  const run = engine.runBotTurn({ bot, chatId, text: 'Work', kind: 'group' });
  await entered.promise;
  assert.equal(engine.cancelChat(chatId), 1);
  finish.resolve();
  const result = await run;
  assert.equal(calls, 0);
  assert.equal(result.status, 'aborted');
  assert.equal(result.skipped, true);
  assert.equal((await store.getMessages(chatId)).find((message) => message.id === result.messageId).status, 'aborted');
});

test('cancelling an answer while its placeholder is persisted keeps the questionnaire answerable', async (t) => {
  const { store, engine } = await fixture(t);
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  const question = await store.appendMessage(chatId, { role: 'bot', botId: bot.id, status: 'done', sessionId: 'question-session', text: 'Choose', question: {
    requestId: 'request-1', mode: 'questionnaire', request: { schemaVersion: 2, id: 'request-1', steps: [] },
  } });
  const written = deferred();
  const finish = deferred();
  t.after(() => finish.resolve());
  const append = store.appendMessage.bind(store);
  store.appendMessage = async (chat, record) => {
    const message = await append(chat, record);
    if (record.role === 'bot') { written.resolve(); await finish.promise; }
    return message;
  };
  let calls = 0;
  engine.agent = { async answer() { calls += 1; return { sessionId: 'question-session', status: 'finished', text: 'Should not answer' }; } };
  await engine.answerQuestion(chatId, question.id, []);
  await written.promise;
  assert.equal(engine.cancelChat(chatId), 1);
  finish.resolve();
  await until(() => idle(engine) && !question.answering);
  assert.equal(calls, 0);
  assert.ok(question.question);
  assert.equal(question.answered, undefined);
});

test('pending supplements merge in order into one turn and keep every source ID across reload', async (t) => {
  const { store, engine, dir, memory } = await fixture(t);
  const chatId = store.chatIds()[0];
  const finish = deferred();
  const calls = [];
  engine.agent = { async run(input, options) {
    calls.push(input);
    const ids = started(input, options, 'same-session');
    if (calls.length === 1) await finish.promise;
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  await engine.sendUserMessage(chatId, 'Research', [], 'batch-first');
  await until(() => calls.length === 1);
  const second = await engine.sendUserMessage(chatId, 'Only domestic', [], 'batch-second');
  const third = await engine.sendUserMessage(chatId, 'Budget 100', [], 'batch-third');
  assert.equal(second.dispatchState, 'adjusting');
  assert.equal(third.dispatchState, 'pending');
  assert.equal(calls.length, 1);
  finish.resolve();
  await until(() => idle(engine));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sessionId, 'same-session');
  assert.match(calls[1].text, /Only domestic\n\nBudget 100$/);
  assert.equal(second.dispatchState, 'delivered');
  const reply = (await store.getMessages(chatId)).find((m) => m.sourceMessageIds?.includes(third.id));
  assert.deepEqual(reply.sourceMessageIds, [second.id, third.id]);
  await store.updateMessage(chatId, reply.id, { status: 'interrupted' });
  const restored = new Store(dir); await restored.init();
  const reopened = new Engine({ store: restored, memory, agent: engine.agent, logger: { warn() {} }, broadcast() {} });
  await assert.rejects(reopened.sendUserMessage(chatId, third.text, [], 'batch-third'), { code: 'delivery_uncertain' });
  assert.equal(calls.length, 2);
  reopened.dispose();
});

test('sending a supplement automatically waits for confirmed abort and continues in the same session', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  const stopped = deferred();
  const calls = [];
  let aborts = 0;
  engine.agent = { async run(input, options) {
    calls.push(input);
    const ids = started(input, options, 'adjust-session');
    if (calls.length === 1) {
      options.signal.addEventListener('abort', () => { aborts += 1; });
      await stopped.promise;
      return { ...ids, status: 'aborted' };
    }
    return { ...ids, status: 'finished', text: 'Adjusted' };
  } };
  await engine.sendUserMessage(chatId, 'Original task');
  await until(() => calls.length === 1);
  const supplement = await engine.sendUserMessage(chatId, 'Use the new direction');
  await until(() => aborts === 1);
  assert.equal(supplement.dispatchState, 'adjusting');
  assert.equal(calls.length, 1);
  const another = await engine.sendUserMessage(chatId, 'And keep it brief');
  stopped.resolve();
  await until(() => idle(engine));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sessionId, 'adjust-session');
  assert.match(calls[1].text, /Use the new direction\n\nAnd keep it brief$/);
  assert.equal(another.dispatchState, 'delivered');
  assert.doesNotMatch(calls[1].text, /Original task/);
  assert.equal(aborts, 1);
});

test('an unconfirmed cancellation holds all supplements; explicit concurrent resume submits them once', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  const calls = [];
  engine.agent = { async run(input, options) {
    calls.push(input);
    const ids = started(input, options, 'unknown-session');
    if (calls.length === 1) {
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
      throw Object.assign(new Error('Abort not confirmed'), { code: 'AGENT_OUTCOME_UNKNOWN' });
    }
    return { ...ids, status: 'finished', text: 'Adjusted' };
  } };
  await engine.sendUserMessage(chatId, 'Original task');
  await until(() => calls.length === 1);
  const second = await engine.sendUserMessage(chatId, 'Correction one');
  const third = await engine.sendUserMessage(chatId, 'Correction two');
  await until(() => idle(engine));
  assert.equal(calls.length, 1);
  assert.equal(second.dispatchState, 'held');
  assert.equal(third.dispatchState, 'held');
  await Promise.all([engine.inbox.resume(chatId), engine.inbox.resume(chatId)]);
  await until(() => idle(engine));
  assert.equal(calls.length, 2);
  assert.match(calls[1].text, /Correction one\n\nCorrection two$/);
  assert.doesNotMatch(calls[1].text, /Original task/);
});

test('stopping a chat while adjustment is waiting cancels the supplement instead of restarting work', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  const stopped = deferred();
  let runs = 0;
  let signal;
  engine.agent = { async run(input, options) {
    runs += 1; signal = options.signal;
    const ids = started(input, options, 'stop-session');
    await stopped.promise;
    return { ...ids, status: 'aborted' };
  } };
  await engine.sendUserMessage(chatId, 'Original');
  await until(() => runs === 1);
  const correction = await engine.sendUserMessage(chatId, 'Correction');
  await until(() => signal.aborted);
  engine.cancelChat(chatId);
  stopped.resolve();
  await until(() => idle(engine));
  assert.equal(runs, 1);
  assert.equal(correction.dispatchState, 'cancelled');
});

test('a failed adjustment write never aborts current work or loses the supplement', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  const finish = deferred();
  let signal;
  let runs = 0;
  engine.agent = { async run(input, options) {
    runs += 1; signal = options.signal;
    const ids = started(input, options, 'disk-session');
    if (runs === 1) await finish.promise;
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  await engine.sendUserMessage(chatId, 'Original');
  await until(() => runs === 1);
  const update = store.updateMessages.bind(store);
  store.updateMessages = async (...args) => {
    if (args[2].dispatchState === 'adjusting') throw new Error('disk unavailable');
    return update(...args);
  };
  const correction = await engine.sendUserMessage(chatId, 'Correction');
  assert.equal(signal.aborted, false);
  finish.resolve();
  await until(() => idle(engine));
  assert.equal(correction.dispatchState, 'held');
  assert.equal(runs, 1);
});

test('restart retains a requested adjustment for explicit confirmation instead of replaying it', async (t) => {
  const { store, dir } = await fixture(t);
  const chatId = store.chatIds()[0];
  const correction = await store.appendMessage(chatId, { role: 'user', text: 'Correction', dispatchState: 'adjusting' });
  const restored = new Store(dir); await restored.init();
  assert.equal((await restored.getMessages(chatId)).find((m) => m.id === correction.id).dispatchState, 'held');
});

test('adjusting before the first request reaches the Host preserves that unsubmitted request as context', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  const preparing = deferred();
  const release = deferred();
  const build = engine.buildMemoryBrief.bind(engine);
  let first = true;
  engine.buildMemoryBrief = async (...args) => {
    if (first) { first = false; preparing.resolve(); await release.promise; }
    return build(...args);
  };
  const calls = [];
  engine.agent = { async run(input, options) {
    calls.push(input);
    return { ...started(input, options, 'first-session'), status: 'finished', text: 'Done' };
  } };
  await engine.sendUserMessage(chatId, 'Find a supplier');
  await preparing.promise;
  const correction = await engine.sendUserMessage(chatId, 'Only domestic');
  await until(() => [...engine.tickets].some((ticket) => ticket.controller.signal.aborted));
  release.resolve();
  await until(() => idle(engine));
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /Find a supplier\n\nOnly domestic$/);
});

test('merged supplements preserve each attachment and split large pending batches without reordering', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  const finish = deferred();
  const calls = [];
  engine.resolveAttachments = async (ids = []) => ids.map((id) => ({ id, name: `${id}.txt`, path: `/fixtures/${id}.txt`, kind: 'file' }));
  engine.agent = { async run(input, options) {
    calls.push(input);
    const ids = started(input, options, 'attachments');
    if (calls.length === 1) await finish.promise;
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  await engine.sendUserMessage(chatId, 'Original');
  await until(() => calls.length === 1);
  await engine.sendUserMessage(chatId, 'Supplement A', ['a']);
  await engine.sendUserMessage(chatId, 'Supplement B', ['b']);
  await engine.sendUserMessage(chatId, 'x'.repeat(40000));
  await engine.sendUserMessage(chatId, 'y'.repeat(40000));
  await engine.sendUserMessage(chatId, 'Last condition');
  finish.resolve();
  await until(() => idle(engine));
  assert.equal(calls.length, 3);
  assert.match(calls[1].text, /Supplement A[\s\S]*\/fixtures\/a.txt[\s\S]*Supplement B[\s\S]*\/fixtures\/b.txt/);
  assert.ok(calls[1].text.endsWith('x'.repeat(40000)));
  assert.equal(calls[2].text, 'y'.repeat(40000) + '\n\nLast condition');
});

test('group adjustment stops the old handoff and routes merged supplements by their mentions', async (t) => {
  const { store, engine } = await fixture(t);
  const { a, b, chatId } = groupFixture(store);
  const stopped = deferred();
  let aborted = false;
  const calls = [];
  engine.agent = { async run(input, options) {
    const name = input.text.includes("It's your turn (Alice).") ? a.name : b.name;
    calls.push({ name, text: input.text });
    const ids = started(input, options, `${name}-session`);
    if (calls.length === 1) {
      options.signal.addEventListener('abort', () => { aborted = true; });
      await stopped.promise;
      return { ...ids, status: 'aborted', text: '@Bob obsolete handoff' };
    }
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  await engine.sendUserMessage(chatId, '@Alice initial request');
  await until(() => calls.length === 1);
  const correction = await engine.sendUserMessage(chatId, '@Bob revised request');
  await engine.sendUserMessage(chatId, 'Domestic suppliers only');
  await until(() => aborted);
  stopped.resolve();
  await until(() => idle(engine));
  assert.deepEqual(calls.map((call) => call.name), ['Alice', 'Bob']);
  assert.match(calls[1].text, /revised request/);
  assert.match(calls[1].text, /Domestic suppliers only/);
  assert.doesNotMatch(calls[1].text, /obsolete handoff/);
});

test('a later supplement remains held after an unknown outcome even when the original queue was empty', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  let calls = 0;
  engine.agent = { async run(input, options) {
    calls += 1;
    started(input, options, 'unknown');
    throw Object.assign(new Error('Unobserved turn'), { code: 'AGENT_OUTCOME_UNKNOWN' });
  } };
  await engine.sendUserMessage(chatId, 'Original');
  await until(() => idle(engine));
  const supplement = await engine.sendUserMessage(chatId, 'Correction');
  await until(() => idle(engine));
  assert.equal(calls, 1);
  assert.equal(supplement.dispatchState, 'held');
});

test('a supplement arriving while an earlier batch is being held also receives a durable held state', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  await store.appendMessage(chatId, { role: 'user', text: 'Unknown original', dispatchState: 'uncertain' });
  const writing = deferred();
  const release = deferred();
  const update = store.updateMessages.bind(store);
  let first = true;
  store.updateMessages = async (...args) => {
    if (args[2].dispatchState === 'held' && first) { first = false; writing.resolve(); await release.promise; }
    return update(...args);
  };
  const one = await engine.sendUserMessage(chatId, 'Correction one');
  await writing.promise;
  const two = await engine.sendUserMessage(chatId, 'Correction two');
  release.resolve();
  await until(() => idle(engine));
  assert.equal(one.dispatchState, 'held');
  assert.equal(two.dispatchState, 'held');
});

test('a supplement arriving during cancellation confirmation persistence joins the same continuation', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  const confirming = deferred();
  const release = deferred();
  const calls = [];
  const update = store.updateMessages.bind(store);
  store.updateMessages = async (...args) => {
    if (args[2].dispatchState === 'pending') { confirming.resolve(); await release.promise; }
    return update(...args);
  };
  engine.agent = { async run(input, options) {
    calls.push(input);
    const ids = started(input, options, 'late-supplement');
    if (calls.length === 1) {
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
      return { ...ids, status: 'aborted' };
    }
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  await engine.sendUserMessage(chatId, 'Original');
  await until(() => calls.length === 1);
  const one = await engine.sendUserMessage(chatId, 'Correction one');
  await confirming.promise;
  const two = await engine.sendUserMessage(chatId, 'Correction two');
  release.resolve();
  await until(() => idle(engine));
  assert.equal(calls.length, 2);
  assert.match(calls[1].text, /Correction one\n\nCorrection two$/);
  assert.equal(one.dispatchState, 'delivered');
  assert.equal(two.dispatchState, 'delivered');
  const reply = (await store.getMessages(chatId)).find((m) => m.sourceMessageIds?.includes(two.id));
  assert.deepEqual(reply.sourceMessageIds, [one.id, two.id]);
});

test('sending interrupts existing chat work outside the inbox without interrupting another chat', async (t) => {
  const { store, engine } = await fixture(t);
  const { a, b } = groupFixture(store);
  const chatId = `bot:${a.id}`;
  const finishOther = deferred();
  const calls = [];
  let reportSignal;
  let otherSignal;
  engine.agent = { async run(input, options) {
    calls.push(input);
    const prompt = input.text.split('\n').at(-1);
    const ids = started(input, options, prompt);
    if (prompt === 'Report') {
      reportSignal = options.signal;
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
      return { ...ids, status: 'aborted' };
    }
    if (prompt === 'Other chat') {
      otherSignal = options.signal;
      options.signal.addEventListener('abort', () => finishOther.resolve(), { once: true });
      await finishOther.promise;
    }
    return { ...ids, status: 'finished', text: 'Done' };
  } };
  t.after(() => finishOther.resolve());
  const report = engine.runBotTurn({ bot: a, chatId, text: 'Report', kind: 'private' });
  const other = engine.runBotTurn({ bot: b, chatId: `bot:${b.id}`, text: 'Other chat', kind: 'private' });
  await until(() => calls.length === 2);
  const correction = await engine.sendUserMessage(chatId, 'Use the revised plan');
  await until(() => correction.dispatchState === 'delivered');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].sessionId, 'Report');
  assert.equal(calls[2].text, 'Use the revised plan');
  assert.equal(reportSignal.aborted, true);
  assert.equal(otherSignal.aborted, false);
  finishOther.resolve();
  await Promise.all([report, other]);
  await until(() => idle(engine));
});

test('a new supplement interrupts the active continuation even when an overflow batch is already queued', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  const finishOriginal = deferred();
  const calls = [];
  const signals = [];
  engine.agent = { async run(input, options) {
    calls.push(input); signals.push(options.signal);
    const ids = started(input, options, 'overflow-session');
    if (calls.length === 1) await finishOriginal.promise;
    else if (calls.length === 2) await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
    return { ...ids, status: options.signal.aborted ? 'aborted' : 'finished', text: 'Done' };
  } };
  await engine.sendUserMessage(chatId, 'Original');
  await until(() => calls.length === 1);
  await engine.sendUserMessage(chatId, 'x'.repeat(40000));
  await engine.sendUserMessage(chatId, 'y'.repeat(40000));
  finishOriginal.resolve();
  await until(() => calls.length === 2);
  const latest = await engine.sendUserMessage(chatId, 'Newest correction');
  await until(() => signals[1].aborted);
  await until(() => idle(engine));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].sessionId, 'overflow-session');
  assert.equal(calls[2].text, 'y'.repeat(40000) + '\n\nNewest correction');
  assert.equal(latest.dispatchState, 'delivered');
});

test('sending after Stop does not restore an explicitly cancelled request that never reached the Host', async (t) => {
  const { store, engine } = await fixture(t);
  const chatId = store.chatIds()[0];
  const preparing = deferred();
  const release = deferred();
  const build = engine.buildMemoryBrief.bind(engine);
  let first = true;
  engine.buildMemoryBrief = async (...args) => {
    if (first) { first = false; preparing.resolve(); await release.promise; }
    return build(...args);
  };
  const calls = [];
  engine.agent = { async run(input, options) {
    calls.push(input);
    return { ...started(input, options, 'replacement-session'), status: 'finished', text: 'Done' };
  } };
  const original = await engine.sendUserMessage(chatId, 'Cancelled task');
  await preparing.promise;
  engine.cancelChat(chatId);
  const replacement = await engine.sendUserMessage(chatId, 'Replacement task');
  await until(() => replacement.dispatchState === 'adjusting');
  release.resolve();
  await until(() => idle(engine));
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /Replacement task$/);
  assert.doesNotMatch(calls[0].text, /Cancelled task/);
  assert.equal(original.dispatchState, 'cancelled');
  assert.equal(replacement.dispatchState, 'delivered');
});
