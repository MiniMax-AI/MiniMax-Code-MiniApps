import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { SAMPLE_PAGE, createFakeAgent, projectIdIn, startApp } from './helpers.mjs';

/** The default Agent: publishes a page through the MCP endpoint, like MiniMax Code's Agent would. */
function publishingAgent(app) {
  return async ({ type, input, options }) => {
    const id = projectIdIn(input.text);
    options.onEvent({ type: 'turn.started', sessionId: input.sessionId, turnId: 't1', model: { providerId: 'minimax', modelId: 'm-1' } });
    options.onEvent({ type: 'text.delta', sessionId: input.sessionId, turnId: 't1', text: 'Building it.' });
    options.onEvent({ type: 'tool.started', sessionId: input.sessionId, turnId: 't1', name: 'mcp__page-designer__publish_design' });
    const result = await app.mcp('publish_design', { project_id: id, html: SAMPLE_PAGE, title: 'Bakery page' });
    options.onEvent({ type: 'tool.finished', sessionId: input.sessionId, turnId: 't1', name: 'mcp__page-designer__publish_design', ok: !result.isError });
    // As observed on MiniMax Code 3.1.3: the text before a tool call is committed after the call.
    options.onEvent({ type: 'message.committed', sessionId: input.sessionId, turnId: 't1', text: 'Building it.\n' });
    options.onEvent({ type: 'message.committed', sessionId: input.sessionId, turnId: 't1', text: 'Here is the bakery page.' });
    return { sessionId: input.sessionId, turnId: 't1', status: 'finished', text: 'Here is the bakery page.', model: { providerId: 'minimax', modelId: 'm-1' } };
  };
}

test('describing a page creates a project, runs one Agent turn and keeps the published version', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  app.agent.script = publishingAgent(app);

  const page = await app.request('GET', '/studio');
  assert.equal(page.status, 200);
  assert.match(page.data, /<script type="module" src="\/assets\/app.js">/);

  const created = await app.request('POST', '/api/projects', {
    text: 'A landing page for a bakery',
    style: { preset: 'soft' },
    model: { providerId: 'minimax', modelId: 'm-1', thinking: { effort: 'high' } },
  });
  assert.equal(created.status, 201);
  const id = created.data.id;
  const project = await app.settled(id);

  assert.equal(project.title, 'Bakery page');
  assert.deepEqual(project.versions.map((v) => [v.n, v.via]), [[1, 'publish']]);
  // The text before the publish call sits above the version it produced, and is not repeated.
  assert.deepEqual(
    project.messages.map((m) => [m.kind, m.text ?? m.n ?? m.name]),
    [
      ['user', 'A landing page for a bakery'],
      ['assistant', 'Building it.'],
      ['version', 1],
      ['tool', 'mcp__page-designer__publish_design'],
      ['assistant', 'Here is the bakery page.'],
    ],
  );
  assert.deepEqual(project.style, { id: 'soft', name: 'Soft & friendly' });

  const run = app.agent.calls.find((call) => call.type === 'run');
  assert.equal(run.input.sessionId, 's-1');
  assert.deepEqual(run.input.model, { providerId: 'minimax', modelId: 'm-1', thinking: { effort: 'high' } });
  assert.match(run.input.text, /You are designing in Page Designer/);
  assert.match(run.input.text, new RegExp(`Project id: ${id}`));
  assert.match(run.input.text, /<design_md>\n# Soft & friendly/);
  assert.match(run.input.text, /<user_message>\nA landing page for a bakery\n<\/user_message>/);

  const preview = await app.request('GET', `/api/projects/${id}/preview/1`);
  assert.equal(preview.status, 200);
  assert.ok(preview.data.html.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
  assert.ok(preview.data.html.includes(preview.data.token));

  const raw = await app.request('GET', `/api/projects/${id}/versions/1`);
  assert.equal(raw.data, SAMPLE_PAGE);
  assert.match(raw.headers.get('content-security-policy'), /^sandbox;/);

  const state = await app.request('GET', '/api/state');
  assert.equal(state.data.agentAvailable, true);
  assert.deepEqual(state.data.projects.map((p) => [p.id, p.versions, p.running]), [[id, 1, false]]);
  assert.equal(state.data.styles.length, 6);
});

test('a follow-up continues the same session with a short reminder, and edit_design adds a version', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  app.agent.script = publishingAgent(app);
  const { data } = await app.request('POST', '/api/projects', { text: 'A bakery page' });
  const id = data.id;
  await app.settled(id);

  app.agent.script = async ({ input, options }) => {
    options.onEvent({ type: 'turn.started', sessionId: input.sessionId, turnId: 't2', model: { providerId: 'minimax', modelId: 'm-1' } });
    const failed = await app.mcp('edit_design', { project_id: id, edits: [{ old_string: 'nowhere', new_string: 'x' }] });
    assert.equal(failed.isError, true);
    assert.match(failed.value, /matched 0 times/);
    const edited = await app.mcp('edit_design', { project_id: id, edits: [{ old_string: 'Open daily.', new_string: 'Open daily from 7am.' }] });
    assert.deepEqual(edited.value, { ok: true, project_id: id, revision: 2, changed: true, open_path: `/studio?p=${id}` });
    return { sessionId: input.sessionId, turnId: 't2', status: 'finished', text: 'Updated the hours.' };
  };
  const sent = await app.request('POST', `/api/projects/${id}/messages`, { text: 'Say we open at 7am' });
  assert.equal(sent.status, 202);
  const project = await app.settled(id);

  const runs = app.agent.calls.filter((call) => call.type === 'run');
  assert.equal(runs.length, 2);
  assert.equal(runs[1].input.sessionId, 's-1');
  assert.doesNotMatch(runs[1].input.text, /You are designing in Page Designer/);
  assert.match(runs[1].input.text, new RegExp(`page ${id}: the user sent a follow-up`));
  assert.equal(app.agent.calls.filter((call) => call.type === 'create').length, 1);

  assert.deepEqual(project.versions.map((v) => [v.n, v.via]), [[1, 'publish'], [2, 'edit']]);
  assert.equal(project.messages.at(-1).text, 'Updated the hours.', 'a reply without a committed event is still kept');
  const v2 = await app.request('GET', `/api/projects/${id}/versions/2`);
  assert.match(v2.data, /Open daily from 7am\./);

  // Publishing identical HTML does not create a version.
  const same = await app.mcp('publish_design', { project_id: id, html: v2.data });
  assert.deepEqual(same.value, { ok: true, project_id: id, revision: 2, changed: false, open_path: `/studio?p=${id}` });
});

test('rejected HTML reaches the Agent as an error and is stored nowhere', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  const outside = await app.mcp('publish_design', { html: '<!doctype html><html><head></head><body><iframe></iframe></body></html>' });
  assert.equal(outside.isError, true);
  assert.match(outside.value, /must not contain <iframe> elements/);
  // An outside chat that publishes a valid page starts a new project.
  const ok = await app.mcp('publish_design', { html: SAMPLE_PAGE, title: 'From chat' });
  assert.equal(ok.isError, false);
  const listed = await app.mcp('list_designs', {});
  assert.equal(listed.value.length, 1, 'the rejected publish created no project');
  const fromChat = listed.value.find((item) => item.title === 'From chat');
  assert.equal(fromChat.revision, 1);
  const read = await app.mcp('read_design', { project_id: fromChat.project_id });
  assert.equal(read.value.html, SAMPLE_PAGE);
  assert.equal(read.value.next_offset, undefined);
  const unknown = await app.mcp('read_design', { project_id: 'p-00000000' });
  assert.equal(unknown.isError, true);
});

test('read_design pages long documents by character offset', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  const long = SAMPLE_PAGE.replace('<p>Open daily.</p>', `<p>${'a'.repeat(90_000)}</p>`);
  const published = await app.mcp('publish_design', { html: long });
  const id = published.value.project_id;
  const first = await app.mcp('read_design', { project_id: id });
  assert.equal(first.value.html.length, 60_000);
  assert.equal(first.value.next_offset, 60_000);
  const second = await app.mcp('read_design', { project_id: id, offset: first.value.next_offset });
  assert.equal(first.value.html + second.value.html, long);
  assert.equal(second.value.next_offset, undefined);
});

test('a permission request waits for the user and relays exactly the chosen decision', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  app.agent.script = async ({ input, options }) => {
    options.onEvent({ type: 'turn.started', sessionId: input.sessionId, turnId: 't1', model: { providerId: 'minimax', modelId: 'm-1' } });
    options.onEvent({
      type: 'permission.requested',
      sessionId: input.sessionId,
      turnId: 't1',
      requestId: 'perm-1',
      toolName: 'bash',
      reason: 'Run a command',
      toolInput: 'ls',
    });
    const decision = await app.agent.waitForReply('perm-1');
    return { sessionId: input.sessionId, turnId: 't1', status: 'finished', text: `decision was ${decision}` };
  };
  const { data } = await app.request('POST', '/api/projects', { text: 'Make something' });
  const id = data.id;

  let live;
  for (let i = 0; i < 100 && !live?.permissions?.length; i++) {
    live = (await app.request('GET', `/api/projects/${id}`)).data.live;
    await new Promise((done) => setTimeout(done, 10));
  }
  assert.deepEqual(live.permissions, [{ requestId: 'perm-1', toolName: 'bash', reason: 'Run a command', toolInput: 'ls' }]);
  assert.deepEqual(app.agent.replies, [], 'nothing is answered before the user clicks');

  const bad = await app.request('POST', `/api/projects/${id}/permissions`, { requestId: 'perm-1', decision: 'allowAlways' });
  assert.equal(bad.status, 400);
  const denied = await app.request('POST', `/api/projects/${id}/permissions`, { requestId: 'perm-1', decision: 'deny' });
  assert.equal(denied.status, 200);
  const project = await app.settled(id);
  assert.deepEqual(app.agent.replies, [{ sessionId: 's-1', requestId: 'perm-1', decision: 'deny' }]);
  assert.equal(project.messages.at(-1).text, 'decision was deny');
});

test('a questionnaire blocks new messages until it is answered, and the answer continues the session', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  const request = {
    schemaVersion: 2,
    id: 'q',
    title: 'Pick a mood',
    steps: [{ id: 'mood', question: 'Which mood?', selectionMode: 'single', allowOther: true, options: [{ id: 'calm', label: 'Calm' }, { id: 'loud', label: 'Loud' }] }],
  };
  app.agent.script = async ({ type, input }) => {
    if (type === 'run') {
      return { sessionId: input.sessionId, turnId: 't1', status: 'finished', pendingQuestion: { requestId: 'q-1', mode: 'questionnaire', request } };
    }
    return { sessionId: input.sessionId, turnId: 't2', status: 'finished', text: 'Going calm.' };
  };
  const { data } = await app.request('POST', '/api/projects', { text: 'A poster' });
  const id = data.id;
  let project = await app.settled(id);
  assert.deepEqual(project.pendingQuestion, { mode: 'questionnaire', request });

  const blocked = await app.request('POST', `/api/projects/${id}/messages`, { text: 'hello?' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error, 'question_pending');

  const answered = await app.request('POST', `/api/projects/${id}/answer`, {
    answers: [{ stepId: 'mood', selectedOptionIds: ['calm'], selectedOther: false }],
  });
  assert.equal(answered.status, 202);
  project = await app.settled(id);
  const answer = app.agent.calls.find((call) => call.type === 'answer');
  assert.deepEqual(answer.input, { sessionId: 's-1', requestId: 'q-1', answers: [{ stepId: 'mood', selectedOptionIds: ['calm'], selectedOther: false }] });
  assert.equal(project.pendingQuestion, null);
  assert.deepEqual(project.messages.filter((m) => m.kind === 'answer').map((m) => m.text), ['Calm']);
  assert.equal(project.messages.at(-1).text, 'Going calm.');
});

test('a lost session is replaced once and the new session gets the full brief again', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  app.agent.script = publishingAgent(app);
  const { data } = await app.request('POST', '/api/projects', { text: 'A bakery page' });
  const id = data.id;
  await app.settled(id);

  let first = true;
  app.agent.script = async ({ input, options }) => {
    if (first) {
      first = false;
      throw Object.assign(new Error('gone'), { code: 'SESSION_NOT_FOUND', retryable: false });
    }
    options.onEvent({ type: 'turn.started', sessionId: input.sessionId, turnId: 't9', model: { providerId: 'minimax', modelId: 'm-1' } });
    return { sessionId: input.sessionId, turnId: 't9', status: 'finished', text: 'Back.' };
  };
  await app.request('POST', `/api/projects/${id}/messages`, { text: 'Make it blue' });
  const project = await app.settled(id);
  const runs = app.agent.calls.filter((call) => call.type === 'run');
  const last = runs.at(-1);
  assert.equal(last.input.sessionId, 's-2');
  assert.match(last.input.text, /You are designing in Page Designer/);
  assert.match(last.input.text, /already has 1 version\(s\).*Call read_design/s);
  assert.equal(project.sessionId, 's-2');
  assert.equal(project.messages.at(-1).text, 'Back.');
});

test('stop aborts the running turn, and Host errors are kept as notices', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  app.agent.script = ({ input, options }) =>
    new Promise((done, fail) => {
      if (options.signal.aborted) return fail(Object.assign(new Error('cancelled'), { code: 'REQUEST_CANCELLED' }));
      options.signal.addEventListener('abort', () => done({ sessionId: input.sessionId, turnId: 't1', status: 'aborted' }), { once: true });
    });
  const { data } = await app.request('POST', '/api/projects', { text: 'Something slow' });
  const id = data.id;
  // Wait until the turn has reached the Agent, so Stop aborts a running turn.
  for (let i = 0; i < 100 && !app.agent.calls.some((call) => call.type === 'run'); i++) await new Promise((done) => setTimeout(done, 10));
  const busy = await app.request('POST', `/api/projects/${id}/messages`, { text: 'again' });
  assert.equal(busy.status, 409);
  const deleting = await app.request('DELETE', `/api/projects/${id}`);
  assert.equal(deleting.status, 409);
  assert.equal((await app.request('POST', `/api/projects/${id}/cancel`, {})).status, 202);
  let project = await app.settled(id);
  assert.deepEqual(project.messages.at(-1), { ...project.messages.at(-1), kind: 'notice', code: 'ABORTED' });

  app.agent.script = async () => {
    throw Object.assign(new Error('model'), { code: 'INVALID_ARGUMENTS', retryable: false });
  };
  await app.request('POST', `/api/projects/${id}/messages`, { text: 'with a bad model', model: { providerId: 'x', modelId: 'y' } });
  project = await app.settled(id);
  assert.equal(project.messages.at(-1).code, 'INVALID_ARGUMENTS');
  assert.equal(project.messages.at(-1).tone, 'error');
});

test('stop before the turn reaches the Host runs nothing', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  const create = app.agent.create;
  app.agent.create = async () => {
    await new Promise((done) => setTimeout(done, 60));
    return create();
  };
  const { data } = await app.request('POST', '/api/projects', { text: 'Never mind' });
  assert.equal((await app.request('POST', `/api/projects/${data.id}/cancel`, {})).status, 202);
  const project = await app.settled(data.id);
  assert.equal(app.agent.calls.filter((call) => call.type === 'run').length, 0);
  assert.equal(project.messages.at(-1).code, 'REQUEST_CANCELLED');
  assert.equal(project.messages.at(-1).tone, 'info');
  // The page can run again afterwards.
  app.agent.script = async ({ input }) => ({ sessionId: input.sessionId, turnId: 't2', status: 'finished', text: 'Sure.' });
  await app.request('POST', `/api/projects/${data.id}/messages`, { text: 'Go on' });
  assert.equal((await app.settled(data.id)).messages.at(-1).text, 'Sure.');
});

test('writes from other origins or without JSON are refused', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  const evil = await app.request('POST', '/api/projects', { text: 'x' }, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const site = await app.request('POST', '/api/projects', { text: 'x' }, { 'sec-fetch-site': 'cross-site' });
  assert.equal(site.status, 403);
  const plain = await fetch(`${app.base}/api/projects`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"text":"x"}' });
  assert.equal(plain.status, 415);
  const empty = await app.request('POST', '/api/projects', { text: '   ' });
  assert.equal(empty.status, 400);
  const tooLong = await app.request('POST', '/api/projects', { text: 'x'.repeat(20_001) });
  assert.equal(tooLong.status, 413);
  const badStyle = await app.request('POST', '/api/projects', { text: 'x', style: { preset: 'brand-x' } });
  assert.equal(badStyle.status, 400);
  assert.equal((await app.request('GET', '/api/state')).data.projects.length, 0);
  assert.equal((await app.request('GET', '/api/projects/p-12345678')).status, 404);
  assert.equal((await app.request('GET', '/__mavis/anything')).status, 404);
});

/** A raw request with a chosen Host header, which fetch does not let a caller set. */
function rawRequest(base, method, path, headers, body) {
  return new Promise((done, fail) => {
    const url = new URL(path, base);
    const request = httpRequest({ host: url.hostname, port: url.port, method, path: url.pathname, headers }, (response) => {
      response.resume();
      response.on('end', () => done(response.statusCode));
    });
    request.once('error', fail);
    request.end(body);
  });
}

test('a DNS-rebound hostname is refused on every route, including the MCP endpoint', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  const port = new URL(app.base).port;
  // What a page on rebind.example sees after its name starts resolving to 127.0.0.1: the browser
  // treats the request as same-origin, so only the Host header gives it away.
  const rebound = { host: `rebind.example:${port}`, origin: `http://rebind.example:${port}`, 'sec-fetch-site': 'same-origin' };
  const json = { ...rebound, 'content-type': 'application/json' };
  const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_designs', arguments: {} } });
  assert.equal(await rawRequest(app.base, 'GET', '/studio', rebound), 403);
  assert.equal(await rawRequest(app.base, 'GET', '/api/state', rebound), 403);
  assert.equal(await rawRequest(app.base, 'POST', '/api/projects', json, '{"text":"x"}'), 403);
  assert.equal(await rawRequest(app.base, 'POST', '/mcp/page-designer', { host: `rebind.example:${port}`, 'content-type': 'application/json' }, rpc), 403);
  // An Origin on another port of this machine is another listener, not this page.
  assert.equal(await rawRequest(app.base, 'POST', '/api/projects', { 'content-type': 'application/json', origin: 'http://127.0.0.1:1' }, '{"text":"x"}'), 403);
  // Loopback names keep working, with or without an Origin.
  assert.equal(await rawRequest(app.base, 'GET', '/api/state', { host: `localhost:${port}` }), 200);
  assert.equal(await rawRequest(app.base, 'GET', '/api/state', { host: `127.0.0.1:${port}`, origin: `http://localhost:${port}` }), 200);
  assert.equal(await rawRequest(app.base, 'POST', '/mcp/page-designer', { host: `127.0.0.1:${port}`, 'content-type': 'application/json' }, rpc), 200);
  assert.equal(app.agent.calls.length, 0);
  assert.equal((await app.request('GET', '/api/state')).data.projects.length, 0);
});

test('projects survive a restart; a run cut off by the restart is marked interrupted', async (t) => {
  const agent = createFakeAgent();
  let app = await startApp({ agent });
  const dataDir = app.dataDir;
  app.agent.script = publishingAgent(app);
  const { data } = await app.request('POST', '/api/projects', { text: 'A bakery page' });
  const id = data.id;
  await app.settled(id);
  await app.stop();

  // Simulate a process that died mid-run.
  const file = join(dataDir, 'projects', id, 'project.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.runs.push({ id: 'r-dead', kind: 'message', startedAt: Date.now(), status: 'running' });
  await writeFile(file, JSON.stringify(saved));

  app = await startApp({ dataDir, agent });
  t.after(() => app.cleanup());
  const project = (await app.request('GET', `/api/projects/${id}`)).data;
  assert.equal(project.title, 'Bakery page');
  assert.equal(project.versions.length, 1);
  const reread = JSON.parse(await readFile(file, 'utf8'));
  // The interrupted mark is applied in memory and written with the next change.
  await app.request('PATCH', `/api/projects/${id}`, { title: 'Renamed' });
  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(reread.runs.at(-1).status, 'running');
  assert.equal(after.runs.at(-1).status, 'interrupted');
  assert.equal(after.title, 'Renamed');

  assert.equal((await app.request('DELETE', `/api/projects/${id}`)).status, 200);
  assert.equal((await app.request('GET', `/api/projects/${id}`)).status, 404);
});

test('models come straight from the Host, and a missing agent grant is reported', async (t) => {
  const app = await startApp();
  t.after(() => app.cleanup());
  const models = await app.request('GET', '/api/models');
  assert.equal(models.data.models[0].displayName, 'Model One');

  const bare = await startApp({ agent: null });
  t.after(() => bare.cleanup());
  assert.equal((await bare.request('GET', '/api/state')).data.agentAvailable, false);
  const refused = await bare.request('POST', '/api/projects', { text: 'x' });
  assert.equal(refused.status, 503);
  assert.equal(refused.data.error, 'agent_unavailable');
});
