import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkAccessUsage } from '../scripts/lib/rules/usage.mjs';
import { createReport } from '../scripts/lib/report.mjs';
import { codes, copyExample, makeTmpRoot } from './helpers.mjs';

const NONE = { agent: [], tool: false, device: [], host: [] };
const ROOTS = ['miniapp/client', 'miniapp/node'];

async function run(files, { access = NONE, minimum } = {}) {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  for (const [relativePath, source] of Object.entries(files)) {
    const file = path.join(dir, ...relativePath.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
  }
  const report = createReport();
  await checkAccessUsage(report, { packageDir: dir, roots: ROOTS, access, minimum });
  return report.diagnostics;
}

test('usage: the example declares nothing and calls nothing', async () => {
  assert.deepEqual(await run({}), []);
});

test('usage: Agent calls without agentAccess are errors on the page and in Node', async () => {
  const page = await run({ 'miniapp/client/app.js': 'await window.mcode?.miniapp?.agent?.run({ text });\n' });
  assert.deepEqual(codes(page, 'error'), ['ACCESS_UNDECLARED']);
  assert.match(page[0].message, /agentAccess/u);
  const node = await run({ 'miniapp/node/agent.mjs': 'export const go = (context) => context.agent.create({});\n' });
  assert.deepEqual(codes(node, 'error'), ['ACCESS_UNDECLARED']);
  assert.deepEqual(await run({ 'miniapp/node/agent.mjs': 'export const go = (context) => context.agent.run({ text: "x" });\n' }, { access: { ...NONE, agent: ['session.run'] } }), []);
});

test('usage: listing sessions, observing every session, and reading the page chat need session.read', async () => {
  const runOnly = { ...NONE, agent: ['session.run'] };
  for (const source of [
    'const { sessions } = await agent.sessions();\n',
    'agent.observe({ all: true }, { onEvent });\n',
    'agent?.observe({all:!0},{onEvent:e});\n',
    'const chat = await window.mcode.miniapp.agent.session();\n',
  ]) {
    const diagnostics = await run({ 'miniapp/client/app.js': source }, { access: runOnly });
    assert.deepEqual(codes(diagnostics, 'error'), ['ACCESS_UNDECLARED'], source);
    assert.match(diagnostics[0].message, /session\.read/u);
    assert.deepEqual(await run({ 'miniapp/client/app.js': source }, { access: { ...NONE, agent: ['session.read', 'session.run'] } }), [], source);
  }
  for (const source of ['agent.observe({ sessionId }, { onEvent });\n', 'await agent.session(ownSessionId);\n']) {
    assert.deepEqual(await run({ 'miniapp/client/app.js': source }, { access: runOnly }), [], source);
  }
});

test('usage: running turns needs session.run even when session.read is declared', async () => {
  const diagnostics = await run(
    { 'miniapp/node/agent.mjs': 'export const go = (context) => context.agent.run({ text: "x" });\n' },
    { access: { ...NONE, agent: ['session.read'] } },
  );
  assert.deepEqual(codes(diagnostics, 'error'), ['ACCESS_UNDECLARED']);
  assert.match(diagnostics[0].message, /"session\.run"/u);
});

test('usage: one Agent diagnostic per file names every missing agentAccess value', async () => {
  const pageChat = await run({ 'miniapp/client/app.js': 'await window.mcode.miniapp.agent.session();\n' });
  assert.equal(pageChat.length, 1);
  assert.match(pageChat[0].message, /"session\.read"/u);
  const both = await run({ 'miniapp/client/app.js': 'await miniapp.agent.run({ text });\nawait miniapp.agent.sessions();\n' });
  assert.equal(both.length, 1);
  assert.match(both[0].message, /"session\.run" and "session\.read"/u);
});

test('usage: reading or observing its own sessions needs either agentAccess value', async () => {
  const source = 'context.agent.observe({ sessionId }, { onEvent });\n';
  const none = await run({ 'miniapp/node/watch.mjs': source });
  assert.deepEqual(codes(none, 'error'), ['ACCESS_UNDECLARED']);
  assert.match(none[0].message, /"session\.run" or "session\.read"/u);
  for (const agent of [['session.run'], ['session.read']]) {
    assert.deepEqual(await run({ 'miniapp/node/watch.mjs': source }, { access: { ...NONE, agent } }), [], agent[0]);
  }
});

test('usage: tool calls without toolAccess are errors', async () => {
  for (const source of ['await context.tool.call(name, {});\n', 'const { tools } = await context.tool?.list();\n', 'await window.mcode.miniapp.tool.request([name]);\n']) {
    const diagnostics = await run({ 'miniapp/node/tools.mjs': source });
    assert.deepEqual(codes(diagnostics, 'error'), ['ACCESS_UNDECLARED'], source);
    assert.match(diagnostics[0].message, /toolAccess/u);
    assert.deepEqual(await run({ 'miniapp/node/tools.mjs': source }, { access: { ...NONE, tool: true } }), [], source);
  }
});

test('usage: speech.transcribe without the microphone is an error on every version', async () => {
  const diagnostics = await run({ 'miniapp/client/index.html': '<script>speech.transcribe({ audio, format });</script>\n' });
  assert.deepEqual(codes(diagnostics, 'error'), ['ACCESS_UNDECLARED']);
  assert.match(diagnostics[0].message, /deviceAccess/u);
  assert.deepEqual(await run({ 'miniapp/client/index.html': '<script>speech.transcribe({ audio, format });</script>\n' }, { access: { ...NONE, device: ['microphone'] } }), []);
});

test('usage: getUserMedia without its device is an error only when every client that installs the package denies it', async () => {
  const files = { 'miniapp/client/app.js': 'const stream = await navigator.mediaDevices.getUserMedia({ audio: true });\n' };
  const anyVersion = await run(files);
  assert.deepEqual(codes(anyVersion), ['ACCESS_UNDECLARED']);
  assert.equal(anyVersion[0].level, 'warning');
  assert.match(anyVersion[0].message, /"microphone"/u);
  assert.match(anyVersion[0].message, /before 3\.1\.6/u);
  assert.equal((await run(files, { minimum: '3.1.5' }))[0].level, 'warning');
  for (const minimum of ['3.1.6', '3.2.0']) {
    assert.deepEqual(codes(await run(files, { minimum }), 'error'), ['ACCESS_UNDECLARED'], minimum);
  }
  assert.deepEqual(await run(files, { access: { ...NONE, device: ['microphone'] }, minimum: '3.1.6' }), []);
});

test('usage: getUserMedia needs the devices it asks for', async () => {
  const cases = [
    ['getUserMedia({ video: true })', ['microphone'], /"camera"/u],
    ['getUserMedia({audio:!0,video:{width:640}})', ['microphone'], /"camera"/u],
    ['getUserMedia({audio:!0,video:{width:640}})', ['camera'], /"microphone"/u],
    ['getUserMedia(constraints)', [], /"microphone" or "camera"/u],
    ['getUserMedia({ "audio": true })', [], /"microphone"/u],
    ["getUserMedia({ 'video': true })", ['microphone'], /"camera"/u],
    ["getUserMedia({ video: { facingMode: '}' }, audio: true })", ['camera'], /"microphone"/u],
    ['getUserMedia({ ...base })', [], /"microphone" or "camera"/u],
  ];
  for (const [call, device, missing] of cases) {
    const diagnostics = await run({ 'miniapp/client/app.js': `${call};\n` }, { access: { ...NONE, device } });
    assert.deepEqual(codes(diagnostics), ['ACCESS_UNDECLARED'], call);
    assert.match(diagnostics[0].message, missing, call);
  }
  for (const [call, device] of [
    ['getUserMedia({ video: true })', ['camera']],
    ['getUserMedia({ audio: true, video: false })', ['microphone']],
    ['getUserMedia({audio:!1,video:!0})', ['camera']],
    ['getUserMedia(constraints)', ['camera']],
    ['getUserMedia(constraints)', ['microphone']],
  ]) {
    assert.deepEqual(await run({ 'miniapp/client/app.js': `${call};\n` }, { access: { ...NONE, device } }), [], call);
  }
});

test('usage: system notifications need deviceAccess "notifications"', async () => {
  for (const source of ["new Notification('Done', { body });\n", 'await Notification.requestPermission();\n']) {
    const anyVersion = await run({ 'miniapp/client/app.js': source });
    assert.deepEqual(codes(anyVersion), ['ACCESS_UNDECLARED'], source);
    assert.equal(anyVersion[0].level, 'warning');
    assert.match(anyVersion[0].message, /"notifications"/u);
    assert.deepEqual(codes(await run({ 'miniapp/client/app.js': source }, { minimum: '3.1.9' }), 'error'), ['ACCESS_UNDECLARED'], source);
    assert.deepEqual(await run({ 'miniapp/client/app.js': source }, { access: { ...NONE, device: ['notifications'] } }), [], source);
  }
  assert.deepEqual(await run({ 'miniapp/client/app.js': 'const n = new NotificationCenter(); notify.showNotification(x);\n' }), []);
});

test('usage: one browser-permission diagnostic per file names every missing device', async () => {
  const diagnostics = await run({
    'miniapp/client/app.js': "getUserMedia({ audio: true });\ngetUserMedia({ video: true });\nnew Notification('x');\n",
  });
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /"microphone", "camera", and "notifications"/u);
});

test('usage: reading Host navigation needs hostAccess; Host UI state and opening entries need nothing', async () => {
  for (const source of [
    'await window.mcode?.miniapp?.host?.navigation.getState();\n',
    'host.navigation.subscribe(render, { onError });\n',
    'miniAppHost.navigation.subscribe(render);\n',
    'host?.navigation?.getState?.();\n',
  ]) {
    const diagnostics = await run({ 'miniapp/client/app.js': source });
    assert.deepEqual(codes(diagnostics, 'error'), ['ACCESS_UNDECLARED'], source);
    assert.match(diagnostics[0].message, /hostAccess/u);
    assert.deepEqual(await run({ 'miniapp/client/app.js': source }, { access: { ...NONE, host: ['navigation.read'] } }), [], source);
  }
  for (const source of ["host.navigation.open({ id: 'home' });\n", 'host.ui.subscribe(apply);\nawait host.ui.getState();\n', 'const state = navigation.getState();\n']) {
    assert.deepEqual(await run({ 'miniapp/client/app.js': source }), [], source);
  }
});

test('usage: one diagnostic per rule per file, and only payload scripts are scanned', async () => {
  const repeated = await run({ 'miniapp/client/app.js': 'context.tool.call(a);\ncontext.tool.call(b);\n' });
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].path, 'miniapp/client/app.js');
  assert.deepEqual(
    await run({
      'miniapp/client/client-api.ts': '// context.tool.call(name)\n',
      'miniapp/node/node_modules/lib/index.js': 'context.tool.call(name);\n',
      'tests/agent.test.mjs': 'context.agent.run({ text });\n',
      'miniapp/client/notes.md': 'speech.transcribe(audio)\n',
    }),
    [],
  );
});
