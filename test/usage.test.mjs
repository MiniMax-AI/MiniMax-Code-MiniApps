import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkAccessUsage } from '../scripts/lib/rules/usage.mjs';
import { createReport } from '../scripts/lib/report.mjs';
import { codes, copyExample, makeTmpRoot } from './helpers.mjs';

const NONE = { agent: [], tool: false, microphone: false };
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
  assert.deepEqual(await run({ 'miniapp/client/index.html': '<script>speech.transcribe({ audio, format });</script>\n' }, { access: { ...NONE, microphone: true } }), []);
});

test('usage: getUserMedia without the microphone is an error only when every client that installs the package denies it', async () => {
  const files = { 'miniapp/client/app.js': 'const stream = await navigator.mediaDevices.getUserMedia({ audio: true });\n' };
  const anyVersion = await run(files);
  assert.deepEqual(codes(anyVersion), ['ACCESS_UNDECLARED']);
  assert.equal(anyVersion[0].level, 'warning');
  assert.match(anyVersion[0].message, /before 3\.1\.5/u);
  const older = await run(files, { minimum: '3.1.4' });
  assert.equal(older[0].level, 'warning');
  for (const minimum of ['3.1.5', '3.2.0']) {
    const gated = await run(files, { minimum });
    assert.deepEqual(codes(gated, 'error'), ['ACCESS_UNDECLARED'], minimum);
  }
  assert.deepEqual(await run(files, { access: { ...NONE, microphone: true }, minimum: '3.1.5' }), []);
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
