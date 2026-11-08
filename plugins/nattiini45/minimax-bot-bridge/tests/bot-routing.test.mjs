import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Bridge } from '../miniapp/node/bridge.mjs';
import { createFakeAgent } from './fake-agent.mjs';
import { createFakeTeam, TEAM_TOOL_DESCRIPTORS } from './fake-team.mjs';

/**
 * Talking to the Bot the phone picked.
 *
 * The defect these pin down: selecting a Bot on the phone did not talk to that Bot.
 * The turn went to the Host's general assistant, which has no Bot to become, so every
 * Bot answered alike and none of them was the one on the screen.
 *
 * There are two places a Bot's turn can run, and the phone chooses:
 *
 * - **hosted** — the desktop runs the turn under the bridge, in the Bot's own session,
 *   with the Bot's own instructions, model and effort. The Host only lets the Mini App
 *   that owns a run answer its questions, so this is where a permission check or a
 *   questionnaire the Bot raises can be answered from the phone.
 * - **team** — the team's own engine runs the turn. The Bot answers there, and the
 *   desktop Bot app keeps the whole exchange.
 *
 * A group is always the team's: who speaks first, who the admin is and who hands over
 * to whom are the team's rules.
 */

const BOTS = [
  {
    bot_id: 'bot_b1',
    name: 'Writer',
    role: 'Long-form drafting',
    main: false,
    model: 'minimax/MiniMax-M3.1-Flash',
    effort: 'default',
    instructions: 'Writes the documents the team ships.',
  },
  {
    bot_id: 'bot_b2',
    name: 'Reviewer',
    role: 'Second pair of eyes',
    main: false,
    model: 'minimax/MiniMax-M3.1-Flash',
    effort: 'high',
    instructions: 'Checks the work before it ships.',
  },
];

const GROUPS = [
  {
    group_id: 'grp_g1',
    name: 'Team',
    notice: 'The whole team.',
    admin: 'Writer',
    members: ['Writer', 'Reviewer'],
    reply_mode: 'admin',
  },
];

/**
 * The team, with two Bots that answer differently and in their own sessions.
 *
 * @param {object} [options]
 */
function makeTeam(options = {}) {
  return createFakeTeam({
    bots: BOTS,
    groups: GROUPS,
    replies: {
      bot_b1: 'The Writer answers.',
      bot_b2: 'The Reviewer answers.',
      grp_g1: 'The team answers.',
    },
    ...options,
  });
}

/**
 * @param {{team?: any, agent?: any, desktop?: any, mode?: 'team' | 'hosted'}} [options]
 */
async function makeBridge({ team = makeTeam(), agent = createFakeAgent(), desktop, mode } = {}) {
  // The runtime keeps one directory per Mini App, so the Bot app's data sits next to
  // the bridge's, and the code that reads the desktop reads a real layout.
  const root = await mkdtemp(join(tmpdir(), 'bridge-routing-'));
  const dataDir = join(root, 'plugin-data', 'liveboards', 'minimax-bot-bridge');
  await mkdir(dataDir, { recursive: true });
  /** The frames the bridge sent to the room. */
  const sent = [];

  if (desktop) {
    const botDir = join(root, 'plugin-data', 'liveboards', 'minimax-bot');
    await mkdir(botDir, { recursive: true });
    await writeFile(
      join(botDir, 'state.json'),
      JSON.stringify({ bots: [], groups: [], sessions: desktop.sessions ?? {} }),
      'utf8',
    );
  }

  const context = {
    pluginId: 'minimax-bot-bridge',
    pluginRoot: '.',
    dataDir,
    listen: { host: '127.0.0.1', port: 0 },
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    tool: {
      async list() {
        return { tools: TEAM_TOOL_DESCRIPTORS, partial: false };
      },
      async call(name, args) {
        return team.call(name, args);
      },
    },
    agent,
  };

  const bridge = new Bridge(context, {
    config: { bridgeId: 'bridge-1', accountId: 'default', bridgeToken: '', relayUrl: '', bridgeName: 'Desk' },
    logger: context.logger,
  });
  bridge.relay.send = (frame) => {
    sent.push(frame);
    return true;
  };

  await bridge.start();

  // A Bot's turn runs in the team unless the phone says otherwise, so a test that
  // exercises the hosted path asks for it by name.
  if (mode) {
    for (const bot of BOTS) {
      await bridge.dispatch('op.set_bot_mode', { botId: bot.bot_id, mode });
    }
  }

  return {
    bridge,
    sent,
    team,
    agent,
    async dispose() {
      bridge.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** The tool calls the team was asked for, by their short name. */
function teamCalls(team, tool) {
  return team.calls.filter((call) => call.name.endsWith(tool));
}

function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {};
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function within(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('The fake Host did not settle within 2 seconds.')), 2_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function waitingQuestionnaireAgent() {
  const pendingQuestion = {
    requestId: 'q-1',
    mode: 'questionnaire',
    request: {
      schemaVersion: 2,
      id: 'questionnaire-1',
      title: 'Which one?',
      steps: [
        { id: 's1', question: 'Which one?', selectionMode: 'single', allowOther: true,
          options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
        { id: 's2', question: 'Anything else?', selectionMode: 'multiple', allowOther: true,
          options: [{ id: 'detail', label: 'Include details' }] },
        { id: 's3', question: 'Optional follow-up?', selectionMode: 'single', allowOther: true, options: [] },
      ],
    },
  };
  return {
    pendingQuestion,
    agent: createFakeAgent({
      sessionId: 'question-session',
      pendingQuestion,
      script: [
        { type: 'turn.started' },
        { type: 'question.requested', ...pendingQuestion },
        // A questionnaire ends its Host turn, but the result marker keeps the
        // question answerable after that run releases its single-session slot.
        { type: 'turn.finished', status: 'finished' },
      ],
    }),
  };
}

// -- the hosted path ---------------------------------------------------------

test('a hosted turn runs the Bot in its own session, with its own instructions', async () => {
  const agent = createFakeAgent({ text: 'The Writer answers.' });
  const { bridge, agent: fake, dispose } = await makeBridge({
    agent,
    mode: 'hosted',
    desktop: { sessions: { 'bot:bot_b1': { bot_b1: 'sess_writer' } } },
  });

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Draft the notes' });

  assert.equal(fake.runs.length, 1);
  const brief = String(fake.runs[0].input.text);
  // The brief carries what makes the Bot this Bot.
  assert.match(brief, /Writer/);
  assert.match(brief, /Long-form drafting/);
  assert.match(brief, /Writes the documents the team ships\./);
  assert.match(brief, /Draft the notes/);
  // And the turn runs in the phone's own conversation: it does not continue the session
  // the desktop last used, because that session belongs to whatever the user was doing
  // on the desktop, and a phone message dropped into it is answered in the middle of
  // that conversation.
  assert.equal(fake.runs[0].input.sessionId, undefined);
  await dispose();
});

test('the second turn of a phone conversation continues the first', async () => {
  const agent = createFakeAgent({ sessionId: 'sess_phone' });
  const { bridge, agent: fake, dispose } = await makeBridge({
    agent,
    mode: 'hosted',
    desktop: { sessions: { 'bot:bot_b1': { bot_b1: 'sess_writer' } } },
  });

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'one' });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'two' });

  // The conversation the phone has with this Bot is its own, and it grows.
  assert.equal(fake.runs[0].input.sessionId, undefined);
  assert.equal(fake.runs[1].input.sessionId, 'sess_phone');
  await dispose();
});

test('a hosted turn runs on the Bot’s own model, at its own effort', async () => {
  const agent = createFakeAgent({
    text: 'The Writer answers.',
    catalog: {
      default: {
        providerId: 'minimax',
        modelId: 'MiniMax-M3.1-Flash',
        variants: ['thinking'],
        thinking: { default: 'medium', efforts: ['low', 'medium', 'high'] },
      },
      models: [
        {
          providerId: 'minimax',
          modelId: 'MiniMax-M3.1-Flash',
          variants: ['thinking'],
          thinking: { default: 'medium', efforts: ['low', 'medium', 'high'] },
        },
      ],
    },
  });
  const { bridge, agent: fake, dispose } = await makeBridge({ agent, mode: 'hosted' });

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b2', text: 'Review this' });

  // The roster names the model as text; the run takes a selection out of the Host's
  // catalog, at the effort the Bot works at.
  assert.deepEqual(fake.runs[0].input.model, {
    providerId: 'minimax',
    modelId: 'MiniMax-M3.1-Flash',
    variant: 'thinking',
    thinking: { effort: 'high' },
  });
  await dispose();
});

test('a hosted turn on a Host without per-turn models keeps the session’s model', async () => {
  const { bridge, agent: fake, dispose } = await makeBridge({ mode: 'hosted' });

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Draft the notes' });

  assert.equal(fake.runs[0].input.model, undefined);
  await dispose();
});

test('two Bots run as themselves', async () => {
  const { bridge, agent: fake, dispose } = await makeBridge({ mode: 'hosted' });

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'one' });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b2', text: 'two' });

  assert.equal(fake.runs.length, 2);
  assert.match(String(fake.runs[0].input.text), /Writer/);
  assert.match(String(fake.runs[1].input.text), /Reviewer/);
  await dispose();
});

test('a hosted turn publishes the reply in the chat it belongs to', async () => {
  const agent = createFakeAgent({
    script: [{ type: 'message.committed', text: 'The Writer answers.' }],
    text: 'The Writer answers.',
  });
  const { bridge, sent, dispose } = await makeBridge({ agent, mode: 'hosted' });

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'one' });

  const answers = sent.filter(
    (frame) => frame.type === 'evt.message_committed' && frame.payload.message.role === 'assistant',
  );
  assert.equal(answers.length, 1);
  assert.equal(answers[0].payload.message.text, 'The Writer answers.');
  assert.equal(answers[0].payload.message.chatId, 'bot:bot_b1');
  // The author is the Bot the turn was addressed to.
  assert.equal(answers[0].payload.message.authorId, 'bot_b1');
  await dispose();
});

test('a hosted turn raises a permission check the phone can answer while its run is waiting', async () => {
  const permissionRaised = deferred();
  const decision = deferred();
  const agent = createFakeAgent({
    sessionId: 'permission-session',
    script: [
      { type: 'turn.started' },
      {
        type: 'permission.requested',
        requestId: 'perm-1',
        toolName: 'shell',
        toolInput: '{"command":"ls"}',
        reason: 'lists the working directory',
      },
    ],
  });
  const scriptedRun = agent.run.bind(agent);
  const recordReply = agent.reply.bind(agent);
  agent.run = async (input, options) => {
    const result = await scriptedRun(input, options);
    const signal = options?.signal;
    let abort;
    try {
      const status = await new Promise(resolve => {
        abort = () => resolve('aborted');
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
        decision.promise.then(() => resolve('finished'));
        permissionRaised.resolve();
      });
      options?.onEvent?.({ type: 'turn.finished', sessionId: result.sessionId, turnId: result.turnId, status });
      return { ...result, status };
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  };
  agent.reply = async input => {
    assert.deepEqual(input, { sessionId: 'permission-session', requestId: 'perm-1', decision: 'allowOnce' });
    await recordReply(input);
    decision.resolve();
  };
  const { bridge, sent, agent: fake, dispose } = await makeBridge({ agent, mode: 'hosted' });
  let settled = false;
  const running = bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'look around' }).then(result => {
    settled = true;
    return result;
  });
  try {
    await within(permissionRaised.promise);
    const asked = sent.find(frame => frame.type === 'evt.permission_requested');
    assert.ok(asked, 'the phone was told a permission check was raised');
    assert.equal(asked.payload.request.requestId, 'perm-1');
    assert.equal(asked.payload.request.chatId, 'bot:bot_b1');
    assert.equal(asked.payload.request.sessionId, 'permission-session');
    assert.equal(asked.payload.request.toolName, 'shell');
    assert.equal(bridge.pending.size, 1);
    assert.equal(bridge.runner.activeRuns, 1);
    assert.equal(settled, false);
    assert.equal(sent.filter(frame => frame.type === 'evt.turn_finished').length, 0);

    await bridge.dispatch('op.respond_permission', { requestId: 'perm-1', decision: 'allowOnce' });
    await within(running);
    assert.deepEqual(fake.replies, [{ sessionId: 'permission-session', requestId: 'perm-1', decision: 'allowOnce' }]);
    assert.equal(settled, true);
    assert.equal(bridge.pending.size, 0);
    assert.equal(bridge.runner.activeRuns, 0);
    assert.equal(sent.filter(frame => frame.type === 'evt.turn_finished' && frame.payload.status === 'finished').length, 1);
    assert.equal(sent.filter(frame => frame.type === 'evt.permission_resolved').length, 1);
    await assert.rejects(
      () => bridge.dispatch('op.respond_permission', { requestId: 'perm-1', decision: 'allowOnce' }),
      { code: 'REQUEST_NOT_FOUND' },
    );
    assert.equal(fake.replies.length, 1);
  } finally {
    bridge.stop();
    await within(running).catch(() => {});
    await dispose();
  }
});

test('a hosted questionnaire survives its finished turn and preserves every answer step', async () => {
  const { agent, pendingQuestion } = waitingQuestionnaireAgent();
  const { bridge, sent, agent: fake, dispose } = await makeBridge({ agent, mode: 'hosted' });
  try {
    await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'which one?' });
    const asked = sent.find(frame => frame.type === 'evt.question_requested');
    assert.ok(asked);
    assert.equal(asked.payload.request.requestId, 'q-1');
    assert.equal(asked.payload.request.chatId, 'bot:bot_b1');
    assert.equal(asked.payload.request.sessionId, 'question-session');
    assert.equal(asked.payload.request.mode, 'questionnaire');
    assert.equal(asked.payload.request.title, pendingQuestion.request.title);
    assert.deepEqual(asked.payload.request.steps, pendingQuestion.request.steps);
    assert.equal(bridge.runner.activeRuns, 0);
    assert.equal(bridge.pending.size, 1);
    assert.equal(sent.filter(frame => frame.type === 'evt.turn_finished' && frame.payload.status === 'finished').length, 1);
    assert.equal(sent.filter(frame => frame.type === 'evt.question_answered').length, 0);

    const answers = [
      { stepId: 's1', selectedOptionIds: ['a'], selectedOther: false },
      { stepId: 's2', selectedOptionIds: [], selectedOther: true, otherText: 'Use footnotes' },
      { stepId: 's3', selectedOptionIds: [], selectedOther: false, skipped: true },
    ];
    await bridge.dispatch('op.answer_question', { requestId: 'q-1', answers });
    // Options, free text, and an explicit skip all reach the Host, not only the
    // first step or the label of its selected option.
    assert.deepEqual(fake.answers, [{ sessionId: 'question-session', requestId: 'q-1', answers }]);
    assert.equal(bridge.pending.size, 0);
    assert.equal(bridge.runner.activeRuns, 0);
    assert.equal(sent.filter(frame => frame.type === 'evt.question_answered' && frame.payload.requestId === 'q-1').length, 1);
    await assert.rejects(
      () => bridge.dispatch('op.answer_question', { requestId: 'q-1', answers }),
      { code: 'REQUEST_NOT_FOUND' },
    );
    assert.equal(fake.answers.length, 1);
  } finally {
    await dispose();
  }
});

test('a phone that answers in the older shape preserves options, free text and skipped steps', async () => {
  const { agent } = waitingQuestionnaireAgent();
  const { bridge, agent: fake, dispose } = await makeBridge({ agent, mode: 'hosted' });
  try {
    await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'which one?' });
    assert.equal(bridge.pending.size, 1);
    await bridge.dispatch('op.answer_question', {
      requestId: 'q-1',
      answers: [
        { stepId: 's1', value: 'A', optionId: 'a' },
        { stepId: 's2', value: 'Use footnotes' },
        { stepId: 's3', skipped: true },
      ],
    });
    assert.deepEqual(fake.answers, [{
      sessionId: 'question-session', requestId: 'q-1', answers: [
        { stepId: 's1', selectedOptionIds: ['a'], selectedOther: false },
        { stepId: 's2', selectedOptionIds: [], selectedOther: true, otherText: 'Use footnotes' },
        { stepId: 's3', selectedOptionIds: [], selectedOther: false, skipped: true },
      ],
    }]);
    assert.equal(bridge.pending.size, 0);
    assert.equal(bridge.runner.activeRuns, 0);
  } finally {
    await dispose();
  }
});

test('a hosted turn publishes the tool activity it really saw', async () => {
  const agent = createFakeAgent({
    script: [
      { type: 'tool.started', name: 'bash' },
      { type: 'tool.finished', name: 'bash', ok: true },
    ],
  });
  const { bridge, sent, dispose } = await makeBridge({ agent, mode: 'hosted' });

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'run it' });

  assert.equal(sent.filter((frame) => frame.type === 'evt.tool_started').length, 1);
  assert.equal(sent.filter((frame) => frame.type === 'evt.tool_finished').length, 1);
  await dispose();
});

test('a hosted turn keeps the session it ran in', async () => {
  const agent = createFakeAgent({ sessionId: 'sess_writer' });
  const { bridge, dispose } = await makeBridge({ agent, mode: 'hosted' });

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'one' });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'two' });

  assert.equal(bridge.runner.sessionFor('bot:bot_b1'), 'sess_writer');
  await dispose();
});

// -- the team path -----------------------------------------------------------

test('a team turn reaches the Bot the chat names', async () => {
  const { bridge, team, dispose } = await makeBridge();

  await bridge.dispatch('op.set_bot_mode', { botId: 'bot_b1', mode: 'team' });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'Draft the notes' });

  const asked = teamCalls(team, 'message_bot');
  assert.equal(asked.length, 1);
  // The Bot is addressed by its own id: that is what the team resolves.
  assert.equal(asked[0].arguments.to, 'bot_b1');
  assert.equal(asked[0].arguments.message, 'Draft the notes');
  await dispose();
});

test('a group turn reaches the group, and only the group', async () => {
  const { bridge, team, agent: fake, dispose } = await makeBridge();

  await bridge.dispatch('op.send_message', { chatId: 'group:grp_g1', text: 'Ship it' });

  const posted = teamCalls(team, 'post_group');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].arguments.group, 'grp_g1');
  assert.equal(posted[0].arguments.message, 'Ship it');
  // A group is not a Bot, so no Bot is addressed, and the group is not run locally.
  assert.equal(teamCalls(team, 'message_bot').length, 0);
  assert.equal(fake.runs.length, 0);
  await dispose();
});

test('a mention is named the way the team reads it', async () => {
  const { bridge, team, dispose } = await makeBridge();

  await bridge.dispatch('op.send_message', {
    chatId: 'group:grp_g1',
    text: 'go',
    mentions: ['bot_b2'],
  });

  const posted = teamCalls(team, 'post_group');
  // The team matches a mention against a member's name, so an id would mean nothing.
  assert.equal(posted[0].arguments.message, '@Reviewer\ngo');
  await dispose();
});

test('a team turn that the team cannot start is refused, not answered by the Host', async () => {
  const { bridge, agent: fake, dispose } = await makeBridge();

  await bridge.dispatch('op.set_bot_mode', { botId: 'bot_b1', mode: 'team' });
  await bridge.dispatch('op.set_bot_mode', { botId: 'bot_ghost', mode: 'team' });
  await assert.rejects(
    () => bridge.dispatch('op.send_message', { chatId: 'bot:bot_ghost', text: 'anyone there?' }),
    (error) => {
      assert.equal(/** @type {{code?: string}} */ (error).code, 'TEAM_ERROR');
      return true;
    },
  );
  // The bridge did not fall back to the general assistant to have something to say.
  assert.equal(fake.runs.length, 0);
  await dispose();
});

test('a team turn that the team fails is reported as a failure', async () => {
  const team = makeTeam({
    onTask(task) {
      if (task.kind === 'bot') task.status = 'failed';
    },
  });
  const { bridge, sent, dispose } = await makeBridge({ team });

  await bridge.dispatch('op.set_bot_mode', { botId: 'bot_b1', mode: 'team' });
  await assert.rejects(
    () => bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'do it' }),
    (error) => {
      assert.equal(/** @type {{code?: string}} */ (error).code, 'TURN_FAILED');
      return true;
    },
  );

  // A failed turn is finished, with an error, and no reply was made up.
  const finished = sent.find((frame) => frame.type === 'evt.turn_finished');
  assert.equal(finished.payload.status, 'error');
  assert.equal(
    sent.filter(
      (frame) => frame.type === 'evt.message_committed' && frame.payload.message.role === 'assistant',
    ).length,
    0,
  );
  await dispose();
});

test('a team turn can be stopped', async () => {
  // A team that keeps the turn running, so the phone has something to stop.
  const { bridge, sent, team, dispose } = await makeBridge({ team: makeTeam({ hold: true }) });

  await bridge.dispatch('op.set_bot_mode', { botId: 'bot_b1', mode: 'team' });
  // The turn is in flight while the phone learns its id from the event.
  const running = bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'long one' });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const started = sent.find((frame) => frame.type === 'evt.turn_started');
  assert.ok(started, 'the phone was told the turn started');

  const stopped = await bridge.dispatch('op.abort_turn', { turnId: started.payload.turnId });
  assert.equal(stopped.aborted, true);

  // The team's work is not a Host run the bridge owns, so stopping it means telling
  // the team to stop.
  const cancelled = teamCalls(team, 'cancel_tasks');
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].arguments.task_id, started.payload.turnId);

  // The turn ends as stopped, not as a failure: the phone is told the turn is over.
  await running.catch(() => {});
  const finished = sent.find((frame) => frame.type === 'evt.turn_finished');
  assert.equal(finished.payload.status, 'aborted');
  await dispose();
});

test('a team turn that is waiting for the user says where the answer is given', async () => {
  const team = makeTeam({
    onTask(task) {
      if (task.kind === 'bot') task.status = 'waiting_for_user';
    },
  });
  const { bridge, sent, dispose } = await makeBridge({ team });

  await bridge.dispatch('op.set_bot_mode', { botId: 'bot_b1', mode: 'team' });
  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'which one?' });

  // The turn is over until the user acts, and the phone is told what to do about it.
  const notes = sent.filter(
    (frame) => frame.type === 'evt.message_committed' && frame.payload.message.role === 'system',
  );
  assert.equal(notes.length, 1);
  assert.match(notes[0].payload.message.text, /MiniMax Bot/);
  await dispose();
});

test('the bridge invents nothing a run did not report', async () => {
  const { bridge, sent, dispose } = await makeBridge();

  await bridge.dispatch('op.send_message', { chatId: 'bot:bot_b1', text: 'do it' });

  // A run that reported nothing about tools or approvals produced no tool events and
  // no approval requests. A phone that showed them would be showing something that
  // never happened.
  assert.equal(sent.filter((frame) => frame.type === 'evt.tool_started').length, 0);
  assert.equal(sent.filter((frame) => frame.type === 'evt.permission_requested').length, 0);
  assert.equal(sent.filter((frame) => frame.type === 'evt.question_requested').length, 0);
  await dispose();
});

test('a chat that belongs to neither a Bot nor a group is refused', async () => {
  const { bridge, agent: fake, dispose } = await makeBridge();

  await assert.rejects(
    () => bridge.dispatch('op.send_message', { chatId: 'general', text: 'hello?' }),
    (error) => {
      assert.equal(/** @type {{code?: string}} */ (error).code, 'INVALID_ARGUMENTS');
      return true;
    },
  );
  assert.equal(fake.runs.length, 0);
  await dispose();
});

test('the run mode is remembered, and the roster carries it', async () => {
  const { bridge, dispose } = await makeBridge();

  // A Bot's turn runs in the team unless the phone says otherwise, so the exchange
  // is in the desktop Bot app's own conversation.
  assert.equal(bridge.runModeFor('bot:bot_b1'), 'team');

  const result = await bridge.dispatch('op.set_bot_mode', { botId: 'bot_b1', mode: 'hosted' });
  assert.equal(result.mode, 'hosted');
  assert.equal(bridge.runModeFor('bot:bot_b1'), 'hosted');
  // A group is always the team's, whatever a Bot is set to.
  assert.equal(bridge.runModeFor('group:grp_g1'), 'team');

  const team = await bridge.dispatch('op.list_team', {});
  const writer = /** @type {any} */ (team).bots.find((bot) => bot.botId === 'bot_b1');
  assert.equal(writer.runMode, 'hosted');
  // Another Bot keeps the default.
  const reviewer = /** @type {any} */ (team).bots.find((bot) => bot.botId === 'bot_b2');
  assert.equal(reviewer.runMode, 'team');
  await dispose();
});
