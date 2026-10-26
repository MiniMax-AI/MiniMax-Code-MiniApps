import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPackageName, validatePackage } from '../scripts/lib/package.mjs';
import { hasErrors } from '../scripts/lib/report.mjs';
import { codes, copyExample, editJson, makeTmpRoot } from './helpers.mjs';

test('package: the example is a clean baseline', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  assert.deepEqual(await validatePackage(dir), []);
  assert.equal(await readPackageName(dir), 'hello-miniapp');
});

test('package: a UTF-8 BOM in plugin.json is reported by name', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  const file = path.join(dir, '.minimax-plugin', 'plugin.json');
  await writeFile(file, `\uFEFF${await readFile(file, 'utf8')}`);
  const diagnostics = await validatePackage(dir);
  assert.deepEqual(codes(diagnostics), ['MANIFEST_UNREADABLE']);
  assert.match(diagnostics[0].message, /UTF-8 BOM/u);
});

test('package: directory renamed away from the manifest name', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root, { dirName: 'renamed' });
  assert.deepEqual(codes(await validatePackage(dir)), ['LAYOUT_NAME_MISMATCH']);
});

test('package: a missing miniapp.json is reported once by layout, not twice', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  await rm(path.join(dir, 'miniapp', 'miniapp.json'));
  assert.deepEqual(codes(await validatePackage(dir)), ['LAYOUT_FILE_MISSING']);
});

test('package: warnings alone do not make hasErrors true', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  await mkdir(path.join(dir, 'miniapp', 'node', 'vendor'));
  await writeFile(path.join(dir, 'miniapp', 'node', 'vendor', 'lib.mjs'), "console.log('vendored');\n");
  const diagnostics = await validatePackage(dir);
  assert.deepEqual(codes(diagnostics), ['ENTRY_STDOUT']);
  assert.equal(hasErrors(diagnostics), false);
});

test('package: an example is not subject to the lowercase-author rule', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root, { author: 'Examples' });
  assert.deepEqual(await validatePackage(dir, { requireLowercaseAuthor: false }), []);
});

test('package: features from plugin.json and miniapp.json reach the README minimum-version check', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  await editJson(path.join(dir, 'miniapp', 'miniapp.json'), (m) => ({ ...m, agentAccess: ['session.run'] }));
  await editJson(path.join(dir, '.minimax-plugin', 'plugin.json'), (m) => ({ ...m, agents: ['agents/helper.md'] }));
  await mkdir(path.join(dir, 'agents'));
  await writeFile(path.join(dir, 'agents', 'helper.md'), '# helper\n');
  const diagnostics = await validatePackage(dir);
  assert.deepEqual(codes(diagnostics), ['README_MIN_VERSION_MISSING']);
  assert.match(diagnostics[0].message, /agents, agentAccess/u);
  const readme = path.join(dir, 'README.md');
  await writeFile(readme, (await readFile(readme, 'utf8')).replace('MiniMax Code 3.0.73', 'MiniMax Code 3.1.2'));
  assert.deepEqual(await validatePackage(dir), []);
});

test('package: getUserMedia without the microphone turns from warning to error once the package needs 3.1.5', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  await writeFile(path.join(dir, 'miniapp', 'client', 'record.js'), 'export const open = () => navigator.mediaDevices.getUserMedia({ audio: true });\n');
  const anyVersion = await validatePackage(dir);
  assert.deepEqual(codes(anyVersion), ['ACCESS_UNDECLARED']);
  assert.equal(anyVersion[0].level, 'warning');

  await editJson(path.join(dir, 'miniapp', 'miniapp.json'), (m) => ({ ...m, agentAccess: ['session.run', 'session.read'] }));
  const gated = await validatePackage(dir);
  assert.deepEqual(codes(gated, 'error'), ['ACCESS_UNDECLARED']);
  assert.deepEqual(codes(gated, 'warning'), ['README_MIN_VERSION_MISSING']);

  await editJson(path.join(dir, 'miniapp', 'miniapp.json'), (m) => ({ ...m, deviceAccess: ['microphone'] }));
  const readme = path.join(dir, 'README.md');
  await writeFile(readme, (await readFile(readme, 'utf8')).replace('MiniMax Code 3.0.73', 'MiniMax Code 3.1.5'));
  assert.deepEqual(await validatePackage(dir), []);
});

test('package: an engines bound decides the minimum version for both the README and getUserMedia', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  await editJson(path.join(dir, 'miniapp', 'miniapp.json'), (m) => ({ ...m, engines: { mcode: '>=3.2.0' } }));
  await writeFile(path.join(dir, 'miniapp', 'client', 'record.js'), 'navigator.mediaDevices.getUserMedia({ audio: true });\n');
  const diagnostics = await validatePackage(dir);
  assert.deepEqual(codes(diagnostics, 'error'), ['ACCESS_UNDECLARED']);
  const [readme] = diagnostics.filter((d) => d.code === 'README_MIN_VERSION_MISSING');
  assert.match(readme.message, /MiniMax Code 3\.2\.0/u);
});
