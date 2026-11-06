import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolArgumentError, ToolGateway, buildToolArguments } from '../miniapp/node/tools.mjs';

test('passes the payload through when the schema is unknown', () => {
  const args = buildToolArguments({ botId: 'b1', text: 'hi' }, undefined);
  assert.deepEqual(args, { botId: 'b1', text: 'hi' });
});

test('maps operation fields onto schema property names', () => {
  const schema = {
    type: 'object',
    properties: { to: { type: 'string' }, message: { type: 'string' } },
    required: ['to', 'message'],
  };
  const args = buildToolArguments({ botId: 'b1', text: 'hello' }, schema);
  assert.deepEqual(args, { to: 'b1', message: 'hello' });
});

test('keeps a property whose name matches exactly', () => {
  const schema = { type: 'object', properties: { title: { type: 'string' } } };
  const args = buildToolArguments({ title: 'Digest' }, schema);
  assert.deepEqual(args, { title: 'Digest' });
});

/*
 * The schemas below are the ones the real `@minimax-bot` team tools advertise. They
 * are copied from the tool catalogue rather than invented, because the whole point of
 * mapping the payload onto the live schema is that the two agree.
 */

test('a memory tool that names its target bot receives it', () => {
  const schema = {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer' },
      scope: { type: 'string', enum: ['self', 'team', 'bot'] },
      target_bot: { type: 'string' },
    },
  };
  const args = buildToolArguments({ botId: 'bot_b1', query: 'changelog', limit: 5 }, schema);
  assert.deepEqual(args, { query: 'changelog', limit: 5, target_bot: 'bot_b1' });
});

test('a group tool that names its group receives it', () => {
  const schema = {
    type: 'object',
    properties: {
      group: { type: 'string' },
      name: { type: 'string' },
      members: { type: 'array', items: { type: 'string' } },
      reply_mode: { type: 'string', enum: ['admin', 'all'] },
    },
    required: ['group'],
  };
  const args = buildToolArguments(
    { groupId: 'grp_g1', name: 'Studio', memberIds: ['bot_b1'], replyMode: 'admin' },
    schema,
  );
  assert.deepEqual(args, {
    group: 'grp_g1',
    name: 'Studio',
    members: ['bot_b1'],
    reply_mode: 'admin',
  });
});

test('a bot tool that names its bot receives it', () => {
  const schema = {
    type: 'object',
    properties: { bot: { type: 'string' }, name: { type: 'string' }, main: { type: 'boolean' } },
    required: ['bot'],
  };
  const args = buildToolArguments({ botId: 'bot_b1', name: 'Writer', main: true }, schema);
  assert.deepEqual(args, { bot: 'bot_b1', name: 'Writer', main: true });
});

test('the caller the team fills in itself is never a missing argument', () => {
  const schema = {
    type: 'object',
    properties: {
      caller_bot_id: { type: 'string', minLength: 1 },
      task: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['caller_bot_id', 'task'],
  };
  const args = buildToolArguments({ task: 'do the thing', title: 'Thing' }, schema);
  assert.deepEqual(args, { task: 'do the thing', title: 'Thing' });
});

test('a schedule tool receives the time its kind asks for', () => {
  const schema = {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      name: { type: 'string' },
      kind: { type: 'string', enum: ['daily', 'interval', 'once'] },
      time: { type: 'string' },
      every_minutes: { type: 'integer' },
      in_minutes: { type: 'integer' },
      target_bot: { type: 'string' },
    },
    required: ['prompt', 'kind'],
  };
  const args = buildToolArguments(
    { prompt: 'write the notes', name: 'Notes', kind: 'daily', spec: '09:00', targetBotId: 'bot_b1' },
    schema,
  );
  assert.deepEqual(args, {
    prompt: 'write the notes',
    name: 'Notes',
    kind: 'daily',
    time: '09:00',
    target_bot: 'bot_b1',
  });
});

test('refuses when a required property cannot be satisfied', () => {
  const schema = {
    type: 'object',
    properties: { to: { type: 'string' }, message: { type: 'string' } },
    required: ['to', 'message'],
  };
  assert.throws(
    () => buildToolArguments({ text: 'hello' }, schema),
    (error) => {
      assert.ok(error instanceof ToolArgumentError);
      assert.equal(error.code, 'INVALID_ARGUMENTS');
      // `text` satisfies `message`; only the recipient is missing.
      assert.deepEqual(error.details.missing, ['to']);
      return true;
    },
  );
});

test('drops payload fields the schema does not know', () => {
  const schema = { type: 'object', properties: { title: { type: 'string' } } };
  const args = buildToolArguments({ title: 'Digest', extra: 'ignored' }, schema);
  assert.deepEqual(args, { title: 'Digest' });
});

test('the gateway only exposes the team tools', async () => {
  const context = {
    tool: {
      async list() {
        return {
          tools: [
            { name: 'mcp__minimax-bot__message_bot', server: 'minimax-bot', tool: 'message_bot' },
            { name: 'mcp__other-server__thing', server: 'other-server', tool: 'thing' },
          ],
          partial: false,
        };
      },
      async call() {
        return { kind: 'mcp', isError: false, content: [] };
      },
    },
  };
  const gateway = new ToolGateway(context);
  await gateway.refresh();

  assert.equal(gateway.available, true);
  assert.equal(gateway.catalog.length, 1);
  assert.equal(gateway.find('message_bot')?.name, 'mcp__minimax-bot__message_bot');
  assert.equal(gateway.find('thing'), undefined);
});

test('the gateway reports an unavailable team instead of throwing', async () => {
  const gateway = new ToolGateway({
    tool: {
      async list() {
        throw new Error('MCP_SERVER_LIST_FAILED');
      },
    },
  });
  await gateway.refresh();

  assert.equal(gateway.available, false);
  assert.equal(gateway.catalog.length, 0);
  // The room is told a sentence, not the Host's own text: this travels to every phone
  // in the account.
  assert.doesNotMatch(gateway.reason, /MCP_SERVER_LIST_FAILED/);
  assert.match(gateway.reason, /could not be read/i);
  // The detail is kept for the desktop.
  assert.equal(gateway.detail, 'MCP_SERVER_LIST_FAILED');
});

test('the gateway reports a missing tool grant', async () => {
  const gateway = new ToolGateway({});
  await gateway.refresh();

  assert.equal(gateway.available, false);
  assert.match(gateway.reason, /tool access/i);
});

test('calling an unavailable tool is refused, not dispatched', async () => {
  const gateway = new ToolGateway({});
  await gateway.refresh();

  const result = await gateway.call('message_bot', { botId: 'b1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TOOL_NOT_AVAILABLE');
  assert.equal(result.disposition, 'not_dispatched');
});

test('team tool routing requires consistent canonical metadata, independent of catalogue order', async (t) => {
  const canonical = { name: 'mcp__minimax-bot__message_bot', server: 'minimax-bot', tool: 'message_bot' };
  const helper = { name: 'mcp__minimax-bot-helper__message_bot', server: 'minimax-bot-helper', tool: 'message_bot' };
  for (const tools of [[helper, canonical], [canonical, helper]]) {
    await t.test(tools[0].server, async () => {
      const called = [];
      const gateway = new ToolGateway({ tool: {
        list: async () => ({ tools }),
        call: async (name) => { called.push(name); return { kind: 'mcp', isError: false }; },
      } });
      await gateway.refresh();
      assert.equal((await gateway.call('message_bot', { botId: 'b1', text: 'hello' })).ok, true);
      assert.deepEqual(called, [canonical.name]);
      assert.equal(gateway.catalog.length, 1);
    });
  }
});

test('helper-only, missing or contradictory tool identities are never dispatched', async () => {
  const tools = [
    { name: 'mcp__minimax-bot-helper__message_bot', server: 'minimax-bot-helper', tool: 'message_bot' },
    { name: 'mcp__minimax-bot__message_bot', server: 'other', tool: 'message_bot' },
    { name: 'mcp__other__message_bot', server: 'minimax-bot', tool: 'message_bot' },
    { name: 'mcp__minimax-bot__message_bot', tool: 'message_bot' },
    { name: 'mcp__minimax-bot__other_tool', server: 'minimax-bot', tool: 'message_bot' },
  ];
  let calls = 0;
  const gateway = new ToolGateway({ tool: {
    list: async () => ({ tools }),
    call: async () => { calls += 1; return { kind: 'mcp', isError: false }; },
  } });
  await gateway.refresh();
  assert.equal(gateway.available, false);
  assert.equal((await gateway.call('message_bot', {})).disposition, 'not_dispatched');
  assert.equal(calls, 0);
});

test('duplicate eligible short tool names fail closed instead of selecting the first schema', async () => {
  const descriptor = { name: 'mcp__minimax-bot__message_bot', server: 'minimax-bot', tool: 'message_bot' };
  let calls = 0;
  const gateway = new ToolGateway({ tool: {
    list: async () => ({ tools: [descriptor, { ...descriptor, description: 'another descriptor' }] }),
    call: async () => { calls += 1; return { kind: 'mcp', isError: false }; },
  } });
  await gateway.refresh();
  assert.equal((await gateway.call('message_bot', {})).disposition, 'not_dispatched');
  assert.equal(calls, 0);
});

test('calling a tool forwards the mapped arguments', async () => {
  const seen = [];
  const gateway = new ToolGateway({
    tool: {
      async list() {
        return {
          tools: [
            {
              name: 'mcp__minimax-bot__message_bot',
              server: 'minimax-bot',
              tool: 'message_bot',
              inputSchema: {
                type: 'object',
                properties: { to: { type: 'string' }, message: { type: 'string' } },
                required: ['to', 'message'],
              },
            },
          ],
          partial: false,
        };
      },
      async call(name, args) {
        seen.push({ name, arguments: args });
        return { kind: 'mcp', isError: false, content: [{ type: 'text', text: '{"ok":true}' }] };
      },
    },
  });
  await gateway.refresh();

  const result = await gateway.call('message_bot', { botId: 'b1', text: 'hello' });
  assert.equal(result.ok, true);
  assert.deepEqual(seen[0].arguments, { to: 'b1', message: 'hello' });
  assert.equal(seen[0].name, 'mcp__minimax-bot__message_bot');
});

test('a tool that reports an error is surfaced as a failure', async () => {
  const gateway = new ToolGateway({
    tool: {
      async list() {
        return {
          tools: [{ name: 'mcp__minimax-bot__list_team', server: 'minimax-bot', tool: 'list_team' }],
          partial: false,
        };
      },
      async call() {
        return { kind: 'mcp', isError: true, content: [] };
      },
    },
  });
  await gateway.refresh();

  const result = await gateway.call('list_team', {});
  assert.equal(result.ok, true);
  assert.equal(result.isError, true);
});

/*
 * The three tools below take arguments that are not a flat mapping of the operation
 * payload. Their schemas are the ones the real `@minimax-bot` team tools advertise.
 */

const DISPATCH_SCHEMA = {
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
};

const TASK_QUERY_SCHEMA = {
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
};

const REMEMBER_SCHEMA = {
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
};

test('a dispatch becomes the list of tasks the team asks for', () => {
  const args = buildToolArguments(
    { botIds: ['bot_b1', 'bot_b2'], prompt: 'write the changelog', title: 'Changelog' },
    DISPATCH_SCHEMA,
    'dispatch_tasks',
  );

  assert.match(String(args.request_id), /^[A-Za-z0-9_.-]{1,128}$/);
  assert.deepEqual(args.tasks, [
    { to: 'bot_b1', message: 'write the changelog', title: 'Changelog' },
    { to: 'bot_b2', message: 'write the changelog', title: 'Changelog' },
  ]);
});

test('a dispatch without a Bot is refused before it is sent', () => {
  assert.throws(
    () => buildToolArguments({ prompt: 'write the changelog' }, DISPATCH_SCHEMA, 'dispatch_tasks'),
    (error) => {
      assert.ok(error instanceof ToolArgumentError);
      assert.equal(error.code, 'INVALID_ARGUMENTS');
      assert.equal(error.details.field, 'botIds');
      return true;
    },
  );
});

test('a dispatch without a message is refused before it is sent', () => {
  assert.throws(
    () => buildToolArguments({ botIds: ['bot_b1'] }, DISPATCH_SCHEMA, 'dispatch_tasks'),
    (error) => {
      assert.ok(error instanceof ToolArgumentError);
      assert.equal(error.details.field, 'prompt');
      return true;
    },
  );
});

test('a dispatch keeps the idempotency key the client chose', () => {
  const args = buildToolArguments(
    { botIds: ['bot_b1'], prompt: 'go', requestId: 'phone-1' },
    DISPATCH_SCHEMA,
    'dispatch_tasks',
  );
  assert.equal(args.request_id, 'phone-1');
});

test('a task query names the batch it asks about', () => {
  const args = buildToolArguments({ batchId: 'batch_1', waitMs: 500 }, TASK_QUERY_SCHEMA, 'get_tasks');
  assert.deepEqual(args, { batch_id: 'batch_1', wait_ms: 500 });
});

test('a task query without a selector is refused', () => {
  assert.throws(
    () => buildToolArguments({}, TASK_QUERY_SCHEMA, 'get_tasks'),
    (error) => {
      assert.ok(error instanceof ToolArgumentError);
      assert.equal(error.code, 'INVALID_ARGUMENTS');
      assert.match(error.message, /Exactly one of task_id, batch_id/);
      return true;
    },
  );
});

test('a task query that names both a task and a batch is refused', () => {
  assert.throws(
    () => buildToolArguments({ taskId: 't1', batchId: 'b1' }, TASK_QUERY_SCHEMA, 'get_tasks'),
    (error) => {
      assert.ok(error instanceof ToolArgumentError);
      assert.match(error.message, /Exactly one of task_id, batch_id/);
      return true;
    },
  );
});

test('a memory is filed under the topic it names', () => {
  const args = buildToolArguments(
    { botId: 'bot_b1', text: 'the launch is on friday', key: 'launch.date' },
    REMEMBER_SCHEMA,
    'remember',
  );
  assert.deepEqual(args, {
    text: 'the launch is on friday',
    target_bot: 'bot_b1',
    key: 'launch.date',
  });
});

test('a memory without a topic or an entry to replace is refused', () => {
  assert.throws(
    () => buildToolArguments({ botId: 'bot_b1', text: 'note' }, REMEMBER_SCHEMA, 'remember'),
    (error) => {
      assert.ok(error instanceof ToolArgumentError);
      assert.equal(error.code, 'INVALID_ARGUMENTS');
      assert.match(error.message, /One of key, replace_id/);
      return true;
    },
  );
});

test('a memory that replaces an entry carries the entry id', () => {
  const args = buildToolArguments(
    { botId: 'bot_b1', text: 'note', replaceId: 'a1b2c3d4' },
    REMEMBER_SCHEMA,
    'remember',
  );
  assert.deepEqual(args, {
    text: 'note',
    target_bot: 'bot_b1',
    replace_id: 'a1b2c3d4',
  });
});

test('a memory without a text is refused', () => {
  assert.throws(
    () => buildToolArguments({ botId: 'bot_b1', key: 'topic' }, REMEMBER_SCHEMA, 'remember'),
    (error) => {
      assert.ok(error instanceof ToolArgumentError);
      assert.deepEqual(error.details.missing, ['text']);
      return true;
    },
  );
});

test('the gateway dispatches a dispatch with the task list', async () => {
  const seen = [];
  const gateway = new ToolGateway({
    tool: {
      async list() {
        return {
          tools: [
            {
              name: 'mcp__minimax-bot__dispatch_tasks',
              server: 'minimax-bot',
              tool: 'dispatch_tasks',
              inputSchema: DISPATCH_SCHEMA,
            },
          ],
          partial: false,
        };
      },
      async call(name, args) {
        seen.push({ name, arguments: args });
        return { kind: 'mcp', isError: false, content: [] };
      },
    },
  });
  await gateway.refresh();

  const result = await gateway.call('dispatch_tasks', {
    botIds: ['bot_b1'],
    prompt: 'write the changelog',
  });

  assert.equal(result.ok, true);
  assert.equal(seen[0].arguments.tasks.length, 1);
  assert.equal(seen[0].arguments.tasks[0].to, 'bot_b1');
});
