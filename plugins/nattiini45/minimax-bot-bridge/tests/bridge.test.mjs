import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Bridge } from '../miniapp/node/bridge.mjs';
import { createFakeTeam } from './fake-team.mjs';

/**
 * `Bridge.dispatch` returns whatever the matching operation produces, so the inferred type
 * is the union of every branch. Each call site narrows it to the shape it asserts on.
 *
 * @typedef {{bots: any[], groups: any[], diagnostics: any}} TeamResult
 * @typedef {{messageId: string, turnId?: string, sessionId: string}} SendResult
 * @typedef {{messages: any[]}} HistoryResult
 * @typedef {{buckets: any[], byBot: any[], totals: {turns: number, chars: number, tools: number, durationMs: number, errors: number}}} UsageResult
 */

/**
 * The team tools the bridge talks to.
 *
 * The schemas are the ones the real `@minimax-bot` team tools advertise, copied from
 * the tool catalogue rather than invented: the whole point of mapping an operation
 * payload onto the live schema is that the two agree.
 */
const TEAM_TOOLS = [
  { name: 'mcp__minimax-bot__list_team', server: 'minimax-bot', tool: 'list_team' },
  {
    name: 'mcp__minimax-bot__message_bot',
    server: 'minimax-bot',
    tool: 'message_bot',
    inputSchema: {
      type: 'object',
      properties: {
        caller_bot_id: { type: 'string', minLength: 1 },
        request_id: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$' },
        to: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['to', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcp__minimax-bot__post_group',
    server: 'minimax-bot',
    tool: 'post_group',
    inputSchema: {
      type: 'object',
      properties: {
        caller_bot_id: { type: 'string', minLength: 1 },
        request_id: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$' },
        group: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['group', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcp__minimax-bot__dispatch_tasks',
    server: 'minimax-bot',
    tool: 'dispatch_tasks',
    inputSchema: {
      type: 'object',
      properties: {
        caller_bot_id: { type: 'string', minLength: 1 },
        request_id: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$' },
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['to', 'message'],
            properties: {
              to: { type: 'string' },
              message: { type: 'string', minLength: 1, maxLength: 20000 },
              title: { type: 'string', maxLength: 80 },
            },
          },
        },
      },
      required: ['request_id', 'tasks'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcp__minimax-bot__get_tasks',
    server: 'minimax-bot',
    tool: 'get_tasks',
    inputSchema: {
      type: 'object',
      properties: {
        caller_bot_id: { type: 'string', minLength: 1 },
        task_id: { type: 'string' },
        batch_id: { type: 'string' },
        wait_ms: { type: 'integer', minimum: 0, maximum: 20000 },
        result_offset: { type: 'integer', minimum: 0 },
      },
      required: [],
      additionalProperties: false,
      oneOf: [{ required: ['task_id'] }, { required: ['batch_id'] }],
    },
  },
  {
    name: 'mcp__minimax-bot__cancel_tasks',
    server: 'minimax-bot',
    tool: 'cancel_tasks',
    inputSchema: {
      type: 'object',
      properties: {
        caller_bot_id: { type: 'string', minLength: 1 },
        task_id: { type: 'string' },
        batch_id: { type: 'string' },
      },
      required: [],
      additionalProperties: false,
      oneOf: [{ required: ['task_id'] }, { required: ['batch_id'] }],
    },
  },
  {
    name: 'mcp__minimax-bot__remember',
    server: 'minimax-bot',
    tool: 'remember',
    inputSchema: {
      type: 'object',
      properties: {
        caller_bot_id: { type: 'string', minLength: 1 },
        text: { type: 'string', minLength: 1, maxLength: 1200 },
        key: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' },
        scope: { type: 'string', enum: ['self', 'team', 'bot'] },
        target_bot: { type: 'string' },
        replace_id: { type: 'string', pattern: '^[a-f0-9]{8}$' },
        expected_revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        pinned: { type: 'boolean' },
        source: { type: 'string' },
      },
      required: ['text'],
      additionalProperties: false,
      anyOf: [{ required: ['key'] }, { required: ['replace_id'] }],
    },
  },
  { name: 'mcp__minimax-bot__list_helpers', server: 'minimax-bot', tool: 'list_helpers' },
  { name: 'mcp__minimax-bot__list_schedules', server: 'minimax-bot', tool: 'list_schedules' },
];

/**
 * One event the fake desktop emits during a turn.
 *
 * @typedef {{type: string, name?: string, ok?: boolean, text?: string, status?: string}} AgentEvent
 */

/** The events the fake desktop emits during a turn, in the order it emits them. */
/** @type {AgentEvent[]} */
const DEFAULT_AGENT_SCRIPT = [
  { type: 'turn.started' },
  { type: 'tool.started', name: 'bash' },
  { type: 'tool.finished', name: 'bash', ok: true },
  { type: 'text.delta', text: 'Hello' },
  { type: 'message.committed', text: 'Hello' },
  { type: 'turn.finished', status: 'finished', text: 'Hello' },
];

/**
 * A one pixel PNG, used as the artwork a look points at.
 *
 * The bytes are the point, not the picture: what travels to the phone has to be the
 * desktop's own bytes.
 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Writes the desktop's own Bot data into a test root.
 *
 * The runtime keeps one directory per Mini App, so the Bot app's data sits next to the
 * bridge's, and the artwork sits in the runtime's cache of official plugins. The tests
 * lay the desktop out the same way, so the code that reads it reads a real layout.
 *
 * @param {string} root
 * @param {{bots?: any[], groups?: any[], skins?: Record<string, Buffer>, sessions?: Record<string, any>, messages?: Record<string, any[]>}} desktop
 */
async function writeDesktop(root, desktop) {
  const botDir = join(root, 'plugin-data', 'liveboards', 'minimax-bot');
  await mkdir(botDir, { recursive: true });
  await writeFile(
    join(botDir, 'state.json'),
    JSON.stringify({
      bots: desktop.bots ?? [],
      groups: desktop.groups ?? [],
      sessions: desktop.sessions ?? {},
    }),
    'utf8',
  );

  // The desktop keeps each conversation in a file of its own, named after the
  // conversation.
  for (const [chatId, messages] of Object.entries(desktop.messages ?? {})) {
    const file = join(botDir, 'messages', `${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    await mkdir(join(botDir, 'messages'), { recursive: true });
    await writeFile(file, JSON.stringify(messages), 'utf8');
  }

  const plugin = join(root, 'plugin-cache', 'official', 'sha256-tree-v1-test');
  await mkdir(join(plugin, 'miniapp', 'client', 'skins'), { recursive: true });
  await writeFile(
    join(plugin, 'miniapp', 'miniapp.json'),
    JSON.stringify({
      schemaVersion: 1,
      mcpEndpoints: [{ server: 'minimax-bot', path: '/mcp/minimax-bot' }],
      surface: { path: '/bot' },
    }),
    'utf8',
  );
  for (const [skin, bytes] of Object.entries(desktop.skins ?? {})) {
    await writeFile(join(plugin, 'miniapp', 'client', 'skins', `${skin}.png`), bytes);
  }
}

/**
 * @param {{tools?: typeof TEAM_TOOLS, agent?: boolean, agentScript?: AgentEvent[], desktop?: {bots?: any[], groups?: any[], skins?: Record<string, Buffer>, sessions?: Record<string, any>, messages?: Record<string, any[]>}}} options
 */
async function makeBridge({
  tools = TEAM_TOOLS,
  agent = true,
  agentScript = DEFAULT_AGENT_SCRIPT,
  desktop,
} = {}) {
  // The runtime keeps one directory per Mini App, so the bridge's data and the Bot
  // app's data are siblings under one root.
  const root = await mkdtemp(join(tmpdir(), 'bridge-test-'));
  const dataDir = join(root, 'plugin-data', 'liveboards', 'minimax-bot-bridge');
  await mkdir(dataDir, { recursive: true });
  const sent = [];
  const agentRuns = [];
  const agentReplies = [];

  if (desktop) await writeDesktop(root, desktop);

  // The team answers the way the real one does: a durable receipt when a turn is
  // admitted, and the settled result when it is asked for.
  const team = createFakeTeam({
    bots: [
      {
        bot_id: 'bot_b1',
        name: 'Writer',
        role: 'Long-form drafting',
        main: false,
        model: 'minimax/MiniMax-M3.1-Flash',
        effort: 'default',
      },
    ],
    groups: [
      {
        group_id: 'grp_g1',
        name: 'Team',
        notice: 'The whole team.',
        admin: 'Writer',
        members: ['Writer'],
        reply_mode: 'admin',
      },
    ],
    replies: { bot_b1: 'Hello' },
  });
  const toolCalls = team.calls;

  const context = {
    pluginId: 'minimax-bot-bridge',
    pluginRoot: '.',
    dataDir,
    listen: { host: '127.0.0.1', port: 0 },
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    tool: {
      async list() {
        return { tools, partial: false };
      },
      async call(name, args) {
        return team.call(name, args);
      },
    },
  };

  if (agent) {
    context.agent = {
      async run(input, options) {
        agentRuns.push(input);
        for (const event of agentScript) {
          options?.onEvent?.({ sessionId: 'sess-1', turnId: 'turn-1', ...event });
          // The tool takes a moment, so the duration the bridge measures is a real
          // measurement rather than zero.
          if (event.type === 'tool.started') {
            await new Promise((resolve) => setTimeout(resolve, 12));
          }
        }
        return { sessionId: 'sess-1', turnId: 'turn-1', status: 'finished', text: 'Hello' };
      },
      async reply(input) {
        agentReplies.push(input);
      },
      async answer() {
        return { sessionId: 'sess-1', status: 'finished' };
      },
    };
  }

  const bridge = new Bridge(context, {
    config: { bridgeId: 'bridge-1', accountId: 'default', bridgeToken: '', relayUrl: '', bridgeName: 'Desk' },
    logger: context.logger,
  });
  bridge.relay.send = (frame) => {
    sent.push(frame);
    return true;
  };

  await bridge.start();

  return {
    bridge,
    sent,
    toolCalls,
    team,
    agentRuns,
    agentReplies,
    async dispose() {
      bridge.stop();
      await bridge.ledger.writeQueue;
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('the bridge links the team on start', async () => {
  const { bridge, dispose } = await makeBridge();
  assert.equal(bridge.tools.available, true);
  assert.equal(bridge.tools.catalog.length, TEAM_TOOLS.length);
  assert.equal(bridge.diagnostics().teamToolsAvailable, true);
  assert.equal(bridge.diagnostics().agentAvailable, true);
  await dispose();
});

test('list_team returns the roster and the diagnostics', async () => {
  const { bridge, dispose } = await makeBridge();
  const result = /** @type {TeamResult} */ (await bridge.dispatch('op.list_team', {}));

  assert.equal(result.bots.length, 1);
  assert.equal(result.bots[0].name, 'Writer');
  assert.equal(result.groups.length, 1);
  assert.equal(result.diagnostics.toolCount, TEAM_TOOLS.length);
  await dispose();
});

test('the roster is mapped into the shape the protocol speaks', async () => {
  const { bridge, dispose } = await makeBridge();
  const result = /** @type {TeamResult} */ (await bridge.dispatch('op.list_team', {}));

  // The team tool answers in its own shape; the phone must only ever see the
  // protocol's shape, whatever the tool said.
  assert.equal(result.bots[0].botId, 'bot_b1');
  assert.equal(result.bots[0].isMain, false);
  assert.equal(result.bots[0].role, 'Long-form drafting');
  assert.equal(result.bots[0].model, 'minimax/MiniMax-M3.1-Flash');

  assert.equal(result.groups[0].groupId, 'grp_g1');
  assert.equal(result.groups[0].notice, 'The whole team.');
  assert.equal(result.groups[0].replyMode, 'admin');
  // The tool names the admin and the members; the protocol carries ids.
  assert.equal(result.groups[0].admin, 'bot_b1');
  assert.deepEqual(result.groups[0].memberIds, ['bot_b1']);
  await dispose();
});

test('a main Bot is marked as the main one', async () => {
  const { bridge, dispose } = await makeBridge();
  bridge.tools.call = async () => ({
    ok: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          bots: [{ bot_id: 'bot_b1', name: 'Writer', main: true }],
          groups: [],
        }),
      },
    ],
  });

  const result = /** @type {TeamResult} */ (await bridge.dispatch('op.list_team', {}));
  assert.equal(result.bots[0].isMain, true);
  await dispose();
});

test('a member the roster does not know is kept rather than dropped', async () => {
  const { bridge, dispose } = await makeBridge();
  bridge.tools.call = async () => ({
    ok: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          bots: [{ bot_id: 'bot_b1', name: 'Writer' }],
          groups: [{ group_id: 'grp_g1', name: 'Team', admin: 'Ghost', members: ['Writer', 'Ghost'] }],
        }),
      },
    ],
  });

  const result = /** @type {TeamResult} */ (await bridge.dispatch('op.list_team', {}));
  assert.deepEqual(result.groups[0].memberIds, ['bot_b1', 'Ghost']);
  assert.equal(result.groups[0].admin, 'Ghost');
  await dispose();
});

/**
 * Puts a request into the bridge's hands, the way the Host does when it asks about a
 * run the bridge started.
 *
 * A Bot's own approval lives in the Bot's session, which the team owns, so it is
 * answered in MiniMax Bot and not from the phone. What the bridge holds is the Host's
 * question about the bridge's own run.
 *
 * @param {any} bridge
 * @param {'permission' | 'question'} kind
 * @param {{requestId: string, toolName?: string, reason?: string, mode?: string, request?: any}} request
 */
function holdRequest(bridge, kind, request) {
  bridge.runner.handleAgentEvent(
    'bot:bot_b1',
    {
      type: kind === 'permission' ? 'permission.requested' : 'question.requested',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      ...request,
    },
    new AbortController(),
  );
}

test('send_message runs a turn and commits the user message', async () => {
  const { bridge, sent, toolCalls, dispose } = await makeBridge();
  const result = /** @type {SendResult} */ (await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Hi there' }));

  // The turn runs in the team, where the desktop Bot app keeps the exchange.
  const asked = toolCalls.find((call) => call.name.endsWith('message_bot'));
  assert.ok(asked, 'the team was asked to run the turn');
  assert.equal(asked.arguments.to, 'bot_b1');
  assert.ok(result.messageId);

  const committed = sent.filter(
    (frame) => frame.type === 'evt.message_committed' && frame.payload.message.role === 'user',
  );
  assert.equal(committed.length, 1);
  assert.equal(committed[0].payload.message.text, 'Hi there');
  await dispose();
});

test('a hosted turn runs on the desktop, in the Bot’s own session, with the Bot’s brief', async () => {
  const { bridge, agentRuns, dispose } = await makeBridge();
  // The phone can ask for a Bot’s turn to run on the desktop instead, so that a
  // permission check or a questionnaire the Bot raises can be answered from the phone.
  await bridge.dispatch('op.set_bot_mode', { botId: 'bot_b1', mode: 'hosted' });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Hi there' });

  assert.equal(agentRuns.length, 1);
  assert.match(String(agentRuns[0].text), /Writer/);
  assert.match(String(agentRuns[0].text), /Hi there/);
  await dispose();
});

test('a group message reaches the group, and a mention is named the way the team reads it', async () => {
  const { bridge, toolCalls, dispose } = await makeBridge();
  await bridge.dispatch('op.send_message', { chatId: 'group:grp_g1', text: 'go', mentions: ['bot_b1'] });

  // A group turn is posted to the group, not to a Bot.
  const posted = toolCalls.find((call) => call.name.endsWith('post_group'));
  assert.ok(posted, 'the team was asked to post to the group');
  assert.equal(posted.arguments.group, 'grp_g1');
  // The team reads a mention as a name, so an id would mean nothing to it.
  assert.equal(posted.arguments.message, '@Writer\ngo');
  await dispose();
});

test('a mention of a Bot the team does not know is dropped rather than sent as an id', async () => {
  const { bridge, toolCalls, dispose } = await makeBridge();
  await bridge.dispatch('op.send_message', { chatId: 'group:grp_g1', text: 'go', mentions: ['ghost_bot'] });

  const posted = toolCalls.find((call) => call.name.endsWith('post_group'));
  assert.ok(posted);
  assert.equal(posted.arguments.message, 'go');
  await dispose();
});

test('send_message keeps the id the phone chose, so the bubble is replaced in place', async () => {
  const { bridge, sent, dispose } = await makeBridge();
  const result = /** @type {SendResult} */ (
    await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Hi there', clientMessageId: 'local_abc' })
  );

  assert.equal(result.messageId, 'local_abc');
  const committed = sent.find(
    (frame) => frame.type === 'evt.message_committed' && frame.payload.message.role === 'user',
  );
  assert.equal(committed.payload.message.messageId, 'local_abc');
  await dispose();
});

test('send_message ignores an id the phone may not choose', async () => {
  const { bridge, sent, dispose } = await makeBridge();
  const result = /** @type {SendResult} */ (
    await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Hi', clientMessageId: 'has space' })
  );

  assert.notEqual(result.messageId, 'has space');
  assert.ok(result.messageId.startsWith('msg_'));
  const committed = sent.find(
    (frame) => frame.type === 'evt.message_committed' && frame.payload.message.role === 'user',
  );
  assert.equal(committed.payload.message.messageId, result.messageId);
  await dispose();
});

test("the team's reply is published as a chunk and a commit, under the Bot that answered", async () => {
  const { bridge, sent, dispose } = await makeBridge();
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Hi' });

  const chunks = sent.filter((frame) => frame.type === 'evt.message_chunk');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].payload.text, 'Hello');

  const assistant = sent.filter(
    (frame) => frame.type === 'evt.message_committed' && frame.payload.message.role === 'assistant',
  );
  assert.equal(assistant.length, 1);
  // The author is the Bot the team ran, not a guess from the chat id.
  assert.equal(assistant[0].payload.message.authorId, 'bot_b1');
  await dispose();
});

test('the turn lifecycle is published', async () => {
  const { bridge, sent, dispose } = await makeBridge();
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Hi' });

  assert.ok(sent.some((frame) => frame.type === 'evt.turn_started'));
  const finished = sent.find((frame) => frame.type === 'evt.turn_finished');
  assert.equal(finished.payload.status, 'finished');
  await dispose();
});

test('the conversation survives a reload, with the team replies in it', async () => {
  const { bridge, dispose } = await makeBridge({
    desktop: {
      messages: {
        'bot:bot_b1': [
          { id: 'msg_d1', chatId: 'bot:bot_b1', ts: 1, role: 'relay', text: 'Hi' },
          { id: 'msg_d2', chatId: 'bot:bot_b1', ts: 2, role: 'bot', botId: 'bot_b1', text: 'Hello' },
        ],
      },
    },
  });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Hi' });

  const history = /** @type {any} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));
  const roles = history.messages.map((/** @type {any} */ message) => message.role);
  // A phone that opens the chat later must see the whole thread, not only what it sent.
  assert.ok(roles.includes('user'));
  assert.ok(roles.includes('assistant'));
  // And it is the desktop's own thread: the reply the desktop holds, with the desktop's
  // own id, so that a reaction on it means the same thing on both sides.
  const reply = history.messages.find((/** @type {any} */ message) => message.role === 'assistant');
  assert.equal(reply.messageId, 'msg_d2');
  assert.equal(reply.authorId, 'bot_b1');
  await dispose();
});

test('every tool the team runs is published with how long it took', async () => {
  const { bridge, sent, dispose } = await makeBridge();
  const controller = new AbortController();

  // A Host run the bridge owns reports its tool calls; the translation is what the
  // phone sees.
  bridge.runner.handleAgentEvent('bot:bot_b1', { type: 'tool.started', name: 'bash', turnId: 'turn-1' }, controller);
  // The call takes a moment, so the bridge has a real duration to report.
  await new Promise((resolve) => setTimeout(resolve, 2));
  bridge.runner.handleAgentEvent('bot:bot_b1', { type: 'tool.finished', name: 'bash', ok: true, turnId: 'turn-1' }, controller);

  const started = sent.find((frame) => frame.type === 'evt.tool_started');
  assert.ok(started);
  assert.equal(started.payload.toolName, 'bash');
  assert.equal(started.payload.turnId, 'turn-1');
  assert.equal(typeof started.payload.callId, 'string');

  const finished = sent.find((frame) => frame.type === 'evt.tool_finished');
  assert.ok(finished);
  assert.equal(finished.payload.toolName, 'bash');
  assert.equal(finished.payload.ok, true);
  // The finish belongs to the call it started.
  assert.equal(finished.payload.callId, started.payload.callId);
  // The host does not report a duration, so the bridge times the call itself. The
  // call really took time, so the number has to be more than zero.
  assert.equal(typeof finished.payload.usage.durationMs, 'number');
  assert.ok(finished.payload.usage.durationMs > 0);
  await dispose();
});

test('the bridge does not invent tool activity for a turn that reported none', async () => {
  const { bridge, sent, dispose } = await makeBridge({ agentScript: [{ type: 'turn.started' }] });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Hi' });

  // A run that reported nothing about tools produced no tool events. A phone that
  // showed a tool call here would be showing one that never happened.
  assert.equal(sent.filter((frame) => frame.type === 'evt.tool_started').length, 0);
  assert.equal(sent.filter((frame) => frame.type === 'evt.tool_finished').length, 0);
  await dispose();
});

test('two calls of the same tool in one turn are told apart', async () => {
  const { bridge, sent, dispose } = await makeBridge();
  const controller = new AbortController();

  // A Host run the bridge owns reports its tool calls; the translation is what the
  // phone sees.
  bridge.runner.handleAgentEvent('bot:bot_b1', { type: 'tool.started', name: 'bash', turnId: 'turn-1' }, controller);
  bridge.runner.handleAgentEvent('bot:bot_b1', { type: 'tool.started', name: 'bash', turnId: 'turn-1' }, controller);
  // The calls take a moment, so the bridge has a real duration to report.
  await new Promise((resolve) => setTimeout(resolve, 2));
  bridge.runner.handleAgentEvent('bot:bot_b1', { type: 'tool.finished', name: 'bash', ok: true, turnId: 'turn-1' }, controller);
  await new Promise((resolve) => setTimeout(resolve, 2));
  bridge.runner.handleAgentEvent('bot:bot_b1', { type: 'tool.finished', name: 'bash', ok: true, turnId: 'turn-1' }, controller);

  const started = sent.filter((frame) => frame.type === 'evt.tool_started');
  const finished = sent.filter((frame) => frame.type === 'evt.tool_finished');
  assert.equal(started.length, 2);
  assert.equal(finished.length, 2);
  // The two calls have different ids, and each finish belongs to one of them.
  assert.notEqual(started[0].payload.callId, started[1].payload.callId);
  assert.equal(finished[0].payload.callId, started[0].payload.callId);
  assert.equal(finished[1].payload.callId, started[1].payload.callId);
  // Both durations were measured.
  assert.ok(finished[0].payload.usage.durationMs > 0);
  assert.ok(finished[1].payload.usage.durationMs > 0);
  await dispose();
});

test('a tool that never reported back leaves nothing behind', async () => {
  const { bridge, sent, dispose } = await makeBridge();
  const controller = new AbortController();

  bridge.runner.handleAgentEvent('bot:bot_b1', { type: 'tool.started', name: 'bash', turnId: 'turn-1' }, controller);
  // The turn ends without the tool reporting.
  bridge.runner.handleAgentEvent('bot:bot_b1', { type: 'turn.finished', status: 'finished', turnId: 'turn-1' }, controller);
  // A late finish for that tool has no start to measure.
  bridge.runner.handleAgentEvent('bot:bot_b1', { type: 'tool.finished', name: 'bash', ok: true, turnId: 'turn-1' }, controller);

  const finished = sent.filter((frame) => frame.type === 'evt.tool_finished');
  assert.equal(finished.length, 1);
  // The bookkeeping was cleared with the turn, so there is no duration to report.
  assert.equal(finished[0].payload.usage, undefined);
  await dispose();
});

test('the same opId is executed once', async () => {
  const { bridge, agentRuns, toolCalls, dispose } = await makeBridge();
  const frame = { v: 1, id: 'f1', ts: 1, type: 'op.send_message', source: 'app', payload: { chatId: 'bot:bot_b1', text: 'Hi' }, opId: 'op-1' };

  await bridge.handleFrame(frame);
  await bridge.handleFrame(frame);

  // The turn was run once, not twice.
  assert.equal(toolCalls.filter((call) => call.name.endsWith('message_bot')).length, 1);
  // And it ran in the team, not in the Host's assistant.
  assert.equal(agentRuns.length, 0);
  await dispose();
});

test('an unknown operation is refused', async () => {
  const { bridge, sent, dispose } = await makeBridge();
  await bridge.handleFrame({ v: 1, id: 'f1', ts: 1, type: 'op.nope', source: 'app', payload: {} });

  const error = sent.find((frame) => frame.type === 'err');
  assert.ok(error);
  assert.equal(error.payload.code, 'UNKNOWN_OP');
  await dispose();
});

test('a task list without a selector covers the batches the bridge knows', async () => {
  const { bridge, toolCalls, team, dispose } = await makeBridge();
  bridge.ledger.rememberBatch('batch_1');
  team.seedTask({ task_id: 't1', batch_id: 'batch_1', status: 'running' });

  const result = /** @type {any} */ (await bridge.dispatch('op.list_tasks', {}));

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].taskId, 't1');
  assert.deepEqual(result.batchIds, ['batch_1']);
  // The team's task tool answers for one batch at a time, so the list is never
  // complete, and the answer says so rather than pretending otherwise.
  assert.equal(result.partial, true);
  assert.equal(toolCalls[0].arguments.batch_id, 'batch_1');
  await dispose();
});

test('a task list without a selector and without a batch is empty', async () => {
  const { bridge, sent, dispose } = await makeBridge();
  await bridge.handleFrame({ v: 1, id: 'f1', ts: 1, type: 'op.list_tasks', source: 'app', payload: {} });

  const ack = sent.find((frame) => frame.type === 'ack');
  assert.ok(ack);
  assert.deepEqual(ack.payload.result.tasks, []);
  assert.equal(ack.payload.result.partial, true);
  await dispose();
});

test('a task list that names a batch asks the team about that batch', async () => {
  const { bridge, toolCalls, team, dispose } = await makeBridge();
  team.seedTask({ task_id: 't9', batch_id: 'batch_9', status: 'running' });
  const result = /** @type {any} */ (await bridge.dispatch('op.list_tasks', { batchId: 'batch_9' }));

  assert.equal(result.tool, 'get_tasks');
  assert.equal(toolCalls[0].arguments.batch_id, 'batch_9');
  await dispose();
});

test('a dispatched batch is remembered, so the task list can be rebuilt', async () => {
  const { bridge, dispose } = await makeBridge();
  bridge.context.tool.call = async (name, args) => ({
    kind: 'mcp',
    isError: false,
    content: [],
    structuredContent: {
      batch_id: 'batch_7',
      request_id: 'phone-1',
      complete: false,
      tasks: [{ task_id: 't7', kind: 'bot', bot_id: 'bot_b1', status: 'queued', created_at: 10 }],
    },
  });

  const result = /** @type {any} */ (await bridge.dispatch('op.dispatch', { botIds: ['bot_b1'], prompt: 'go' }));

  assert.equal(result.batchId, 'batch_7');
  assert.deepEqual(bridge.ledger.batches(), ['batch_7']);
  // The task list is in the protocol's shape, not the tool's.
  assert.equal(result.tasks[0].taskId, 't7');
  assert.equal(result.tasks[0].state, 'queued');
  assert.deepEqual(result.tasks[0].botIds, ['bot_b1']);
  assert.equal(result.tasks[0].createdAt, 10);
  await dispose();
});

test('the helper list is in the shape the protocol speaks', async () => {
  const { bridge, dispose } = await makeBridge();
  bridge.tools.call = async () => ({
    ok: true,
    content: [],
    // The real team tool answers with a bare array of helpers.
    structuredContent: [
      { helper_id: 'hlp_1', bot: 'Writer', title: 'Research', status: 'done', seconds: 42, report: 'done' },
    ],
  });

  const result = /** @type {any} */ (await bridge.dispatch('op.list_helpers', {}));

  assert.equal(result.helpers.length, 1);
  assert.equal(result.helpers[0].helperId, 'hlp_1');
  assert.equal(result.helpers[0].state, 'done');
  assert.equal(result.helpers[0].seconds, 42);
  assert.equal(result.helpers[0].detail, 'done');
  await dispose();
});

test('the schedule list is in the shape the protocol speaks', async () => {
  const { bridge, dispose } = await makeBridge();
  bridge.tools.call = async () => ({
    ok: true,
    content: [],
    // The real team tool answers with a bare array of schedules.
    structuredContent: [
      {
        schedule_id: 'sch_1',
        name: 'Standup',
        bot_id: 'bot_b1',
        kind: 'daily',
        time: '09:00',
        prompt: 'summarise',
        enabled: true,
        next_run: '2026-10-29T09:00:00.000Z',
        last_run: null,
      },
    ],
  });

  const result = /** @type {any} */ (await bridge.dispatch('op.list_schedules', {}));

  assert.equal(result.schedules.length, 1);
  assert.equal(result.schedules[0].scheduleId, 'sch_1');
  assert.equal(result.schedules[0].spec, '09:00');
  assert.equal(result.schedules[0].targetBotId, 'bot_b1');
  assert.equal(result.schedules[0].nextRunAt, Date.parse('2026-10-29T09:00:00.000Z'));
  await dispose();
});

test('a memory the phone asks for is filed under a topic of its own', async () => {
  const { bridge, toolCalls, dispose } = await makeBridge();

  const result = /** @type {any} */ (await bridge.dispatch('op.remember', { botId: 'bot_b1', text: 'note' }));

  // The team's memory tool refuses a memory with neither a topic nor an entry to
  // replace, so the bridge gives the note a topic.
  assert.match(result.key, /^[a-z0-9][a-z0-9._-]{0,63}$/);
  assert.equal(toolCalls[0].arguments.key, result.key);
  assert.equal(toolCalls[0].arguments.target_bot, 'bot_b1');
  assert.equal(toolCalls[0].arguments.text, 'note');
  await dispose();
});

test('a memory the phone files under a topic keeps that topic', async () => {
  const { bridge, toolCalls, dispose } = await makeBridge();

  await bridge.dispatch('op.remember', { botId: 'bot_b1', text: 'note', key: 'launch.date' });

  assert.equal(toolCalls[0].arguments.key, 'launch.date');
  await dispose();
});

test('history accumulates the messages of a chat', async () => {
  const { bridge, dispose } = await makeBridge();
  // A turn the bridge runs itself is not in the desktop's transcript, so the bridge
  // keeps it: the phone's own thread is the one it is looking at.
  await bridge.dispatch('op.set_bot_mode', { botId: 'bot_b1', mode: 'hosted' });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'one' });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'two' });

  const history = /** @type {HistoryResult} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));
  const mine = history.messages.filter((message) => message.role === 'user');
  assert.equal(mine.length, 2);
  assert.equal(mine[0].text, 'one');
  assert.equal(mine[1].text, 'two');
  // The Bot's replies are part of the thread as well.
  assert.ok(history.messages.some((message) => message.role === 'assistant'));
  // The thread reads in the order it happened, which is the order the phone renders.
  const times = history.messages.map((message) => message.ts);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  await dispose();
});

test('a turn the team runs is not kept twice', async () => {
  const { bridge, dispose } = await makeBridge({
    desktop: {
      messages: {
        'bot:bot_b1': [
          { id: 'msg_d1', chatId: 'bot:bot_b1', ts: 1, role: 'relay', text: 'Hi' },
          { id: 'msg_d2', chatId: 'bot:bot_b1', ts: 2, role: 'bot', botId: 'bot_b1', text: 'Hello' },
        ],
      },
    },
  });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Hi' });

  const history = /** @type {any} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));
  const ids = history.messages.map((/** @type {any} */ message) => message.messageId);
  // The desktop's record and the bridge's own copy of the same exchange are one
  // message, not two.
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 2);
  await dispose();
});

test('the bridge keeps the note that says where the answer goes', async () => {
  const { bridge, dispose } = await makeBridge({
    desktop: {
      messages: {
        'bot:bot_b1': [
          { id: 'msg_d1', chatId: 'bot:bot_b1', ts: 1, role: 'relay', text: 'Hi' },
          { id: 'msg_d2', chatId: 'bot:bot_b1', ts: 2, role: 'bot', botId: 'bot_b1', text: 'Hello' },
        ],
      },
    },
  });

  // The team stopped for a reason the phone has to know about. The desktop's transcript
  // never held that note, so the bridge keeps it: a phone that opens the chat later must
  // still be told where the answer goes.
  bridge.handleEvent('evt.message_committed', {
    message: {
      messageId: 'msg_t1_note',
      chatId: 'bot:bot_b1',
      role: 'system',
      text: 'The Bot is waiting for an answer. Open MiniMax Bot on the desktop to answer it.',
      ts: 3,
    },
  });

  const history = /** @type {any} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));
  const note = history.messages.find((/** @type {any} */ message) => message.role === 'system');

  assert.ok(note, 'the note is in the thread');
  assert.match(note.text, /Open MiniMax Bot on the desktop/);
  await dispose();
});

test('the reactions of a chat come back with the thread', async () => {
  const { bridge, dispose } = await makeBridge({
    desktop: {
      messages: {
        'bot:bot_b1': [
          { id: 'msg_d1', chatId: 'bot:bot_b1', ts: 1, role: 'relay', text: 'Hi' },
          { id: 'msg_d2', chatId: 'bot:bot_b1', ts: 2, role: 'bot', botId: 'bot_b1', text: 'Hello' },
        ],
      },
    },
  });
  const history = /** @type {any} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));
  const message = history.messages.find((/** @type {any} */ entry) => entry.role === 'assistant');

  await bridge.dispatch('op.react', { messageId: message.messageId, emoji: '🔥' });
  await bridge.dispatch('op.react', { messageId: message.messageId, emoji: '🔥' });

  const reloaded = /** @type {any} */ (await bridge.dispatch('op.list_history', { chatId: 'bot:bot_b1' }));
  // The counts belong to the message the phone can see, so a phone that opens the chat
  // later reads them here.
  assert.deepEqual(reloaded.reactions, [{ messageId: 'msg_d2', emoji: '🔥', count: 2 }]);
  await dispose();
});

test('reactions are counted per message', async () => {
  const { bridge, sent, dispose } = await makeBridge();
  await bridge.dispatch('op.react', { messageId: 'm1', emoji: '🔥' });
  await bridge.dispatch('op.react', { messageId: 'm1', emoji: '🔥' });

  assert.ok(sent.some((frame) => frame.type === 'evt.reaction_added'));
  assert.equal(bridge.reactions.get('m1').get('🔥'), 2);
  await dispose();
});

test('usage is reported from the ledger', async () => {
  const { bridge, dispose } = await makeBridge();
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Hi' });

  const usage = /** @type {UsageResult} */ (await bridge.dispatch('op.get_usage', { days: 7 }));
  assert.ok(usage.buckets.length > 0);
  assert.ok(usage.totals.turns >= 1);
  await dispose();
});

test('a permission request is held and can be answered', async () => {
  const { bridge, sent, agentReplies, dispose } = await makeBridge();

  // The Host asks the bridge about a run the bridge owns. A Bot's own approval lives
  // in the Bot's session, which the team owns, so it is answered in MiniMax Bot.
  holdRequest(bridge, 'permission', { requestId: 'req-1', toolName: 'shell', reason: 'writes a file' });

  const asked = sent.find((frame) => frame.type === 'evt.permission_requested');
  assert.ok(asked);
  assert.equal(asked.payload.request.requestId, 'req-1');
  assert.equal(bridge.pending.size, 1);

  await bridge.dispatch('op.respond_permission', { requestId: 'req-1', decision: 'allowOnce' });
  assert.equal(agentReplies.length, 1);
  assert.equal(agentReplies[0].decision, 'allowOnce');
  assert.equal(bridge.pending.size, 0);
  assert.ok(sent.some((frame) => frame.type === 'evt.permission_resolved'));
  await dispose();
});

test('a permission decision is recorded against the phone that made it', async () => {
  const { bridge, dispose } = await makeBridge();

  holdRequest(bridge, 'permission', { requestId: 'req-1', toolName: 'shell', reason: 'writes a file' });

  // The relay names the phone that sent the frame: it is the only thing that
  // knows which socket the frame came from.
  await bridge.dispatch('op.respond_permission', { requestId: 'req-1', decision: 'allowOnce' }, 'phone_1');

  const decisions = bridge.ledger.recent().filter((entry) => entry.kind === 'permission');
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].requestId, 'req-1');
  assert.equal(decisions[0].toolName, 'shell');
  assert.equal(decisions[0].deviceId, 'phone_1');
  assert.equal(decisions[0].decision, 'allowOnce');
  assert.ok(decisions[0].ts > 0);
  await dispose();
});

test('a permission decision is not counted as usage', async () => {
  const { bridge, dispose } = await makeBridge();

  holdRequest(bridge, 'permission', { requestId: 'req-2', toolName: 'shell', reason: 'writes a file' });

  await bridge.dispatch('op.respond_permission', { requestId: 'req-2', decision: 'deny' }, 'phone_1');

  // A decision is a record, not a tool call: counting it as one would put it
  // into the usage totals and into a bot that is not there.
  const usage = /** @type {UsageResult} */ (await bridge.dispatch('op.get_usage', { days: 7 }));
  assert.equal(usage.totals.tools, 0);
  assert.ok(usage.byBot.every((bot) => bot.botId !== 'unknown'));
  await dispose();
});

test('a revoked phone is recorded', async () => {
  const { bridge, dispose } = await makeBridge();
  bridge.relay.revokeDevice = async () => true;

  await bridge.revokeDevice('phone_1');

  const changes = bridge.ledger.recent().filter((entry) => entry.kind === 'access');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'device-revoked');
  assert.equal(changes[0].subject, 'phone_1');
  await dispose();
});

test('a rotated bridge token is recorded', async () => {
  const { bridge, dispose } = await makeBridge();
  bridge.relay.rotateToken = async () => 'the-new-token';

  await bridge.rotateToken();

  const changes = bridge.ledger.recent().filter((entry) => entry.kind === 'access');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'bridge-token-rotated');
  assert.equal(changes[0].subject, 'bridge-1');
  await dispose();
});

test('a ledger that cannot be written does not make the decision look failed', async () => {
  const { bridge, agentReplies, dispose } = await makeBridge();

  holdRequest(bridge, 'permission', { requestId: 'req-3', toolName: 'shell', reason: 'writes a file' });

  // The disk is full.
  bridge.ledger.persist = async () => {
    throw new Error('the disk is full');
  };

  const result = await bridge.dispatch(
    'op.respond_permission',
    { requestId: 'req-3', decision: 'allowOnce' },
    'phone_1',
  );

  // The Host was told the decision, so the phone must not be told it failed.
  assert.equal(agentReplies.length, 1);
  assert.equal(result.decision, 'allowOnce');
  // And the record is still there for the session.
  const decisions = bridge.ledger.recent().filter((entry) => entry.kind === 'permission');
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].deviceId, 'phone_1');
  await dispose();
});

test('a pending approval is replayed when a phone resumes', async () => {
  const { bridge, sent, dispose } = await makeBridge();

  holdRequest(bridge, 'permission', { requestId: 'req-2', toolName: 'shell', reason: 'writes a file' });
  sent.length = 0;

  bridge.replayPending();
  const replayed = sent.find((frame) => frame.type === 'evt.permission_requested');
  assert.ok(replayed);
  assert.equal(replayed.payload.request.requestId, 'req-2');
  await dispose();
});

test('the bridge reports an unavailable team instead of failing to start', async () => {
  const { bridge, dispose } = await makeBridge({ tools: [] });
  assert.equal(bridge.tools.available, false);
  assert.equal(bridge.diagnostics().teamToolsAvailable, false);
  assert.ok(bridge.diagnostics().reason);
  await dispose();
});

test("a Bot's look and picture travel with the roster", async () => {
  const { bridge, dispose } = await makeBridge();
  bridge.tools.call = async () => ({
    ok: true,
    content: [
      {
        type: 'text',
        // The fields are spelled differently by different writers of a Bot's record:
        // `look` here, `skin` there, `colour` and `color`.
        text: JSON.stringify({
          bots: [
            { bot_id: 'bot_b1', name: 'Writer', look: 'fuzzy', colour: 'ocean' },
            { bot_id: 'bot_b2', name: 'Reviewer', skin: 'moon', avatar: 'https://cdn.example.com/reviewer.png' },
            { bot_id: 'bot_b3', name: 'Engineer', avatar: '/Users/someone/avatar.png' },
          ],
          groups: [],
        }),
      },
    ],
  });

  const result = /** @type {TeamResult} */ (await bridge.dispatch('op.list_team', {}));

  // The phone draws the same octopus the desktop draws.
  assert.equal(result.bots[0].skin, 'fuzzy');
  assert.equal(result.bots[0].color, 'ocean');
  assert.equal(result.bots[1].skin, 'moon');
  assert.equal(result.bots[1].avatar, 'https://cdn.example.com/reviewer.png');
  // A path on the desktop is not something the phone can load, so it is left out and
  // the app falls back to the octopus rather than showing a broken frame.
  assert.equal(result.bots[2].avatar, undefined);
  await dispose();
});

test("the desktop's own record of the team reaches the phone", async () => {
  // The team tools answer with a summary. What a Bot *looks* like is not in that
  // summary, so it is read from the desktop's own record of the team.
  const { bridge, dispose } = await makeBridge({
    desktop: {
      bots: [
        {
          id: 'bot_b1',
          name: 'Writer',
          role: 'Long-form drafting',
          skin: 'fuzzy',
          color: 'ocean',
          face: 'happy',
          instructions: 'Writes the documents the team ships.',
          isMain: true,
        },
      ],
      groups: [{ id: 'grp_g1', name: 'Team', adminId: 'bot_b1', memberIds: ['bot_b1'], replyMode: 'admin' }],
    },
  });

  const result = /** @type {TeamResult} */ (await bridge.dispatch('op.list_team', {}));

  // The look, the face and what the Bot is for come from the desktop.
  assert.equal(result.bots[0].skin, 'fuzzy');
  assert.equal(result.bots[0].color, 'ocean');
  assert.equal(result.bots[0].face, 'happy');
  assert.equal(result.bots[0].instructions, 'Writes the documents the team ships.');
  assert.equal(result.bots[0].isMain, true);
  // The summary still says what the team tools say.
  assert.equal(result.bots[0].model, 'minimax/MiniMax-M3.1-Flash');
  assert.equal(result.bots[0].effort, 'default');
  // The group keeps the notice the tool reported and gains the member ids the phone
  // needs to open a group chat.
  assert.equal(result.groups[0].notice, 'The whole team.');
  assert.deepEqual(result.groups[0].memberIds, ['bot_b1']);
  await dispose();
});

test('the roster is still the summary when the desktop keeps no Bot app', async () => {
  const { bridge, dispose } = await makeBridge();

  const result = /** @type {TeamResult} */ (await bridge.dispatch('op.list_team', {}));

  // No desktop record, no crash: the phone shows what the tool reported.
  assert.equal(result.bots.length, 1);
  assert.equal(result.bots[0].name, 'Writer');
  assert.equal(result.bots[0].skin, undefined);
  await dispose();
});

test("a Bot's picture travels from the desktop", async () => {
  const { bridge, dispose } = await makeBridge({
    desktop: {
      bots: [{ id: 'bot_b1', name: 'Writer', skin: 'fuzzy' }],
      skins: { fuzzy: TINY_PNG },
    },
  });

  const result = /** @type {{botId: string, mime: string, data: string, source: string}} */ (
    await bridge.dispatch('op.bot_avatar', { botId: 'bot_b1' })
  );

  // The bytes are the desktop's own: the phone draws the artwork the desktop draws.
  assert.equal(result.botId, 'bot_b1');
  assert.equal(result.mime, 'image/png');
  assert.equal(result.source, 'skin');
  assert.deepEqual(Buffer.from(result.data, 'base64'), TINY_PNG);
  await dispose();
});

test('a Bot the desktop has no picture for has none', async () => {
  const { bridge, dispose } = await makeBridge({
    desktop: { bots: [{ id: 'bot_b1', name: 'Writer' }] },
  });

  await assert.rejects(
    () => bridge.dispatch('op.bot_avatar', { botId: 'bot_b1' }),
    /picture/i,
  );
  await dispose();
});

test('a picture is asked for by Bot, not by file name', async () => {
  const { bridge, dispose } = await makeBridge({
    desktop: {
      bots: [{ id: 'bot_b1', name: 'Writer', skin: '../../secrets' }],
      skins: { fuzzy: TINY_PNG },
    },
  });

  // A look that tries to walk out of the artwork folder finds nothing.
  await assert.rejects(
    () => bridge.dispatch('op.bot_avatar', { botId: 'bot_b1' }),
    /picture/i,
  );
  await dispose();
});
