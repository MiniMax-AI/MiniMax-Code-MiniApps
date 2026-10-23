import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileProject, resolveProject } from '../miniapp/node/compiler.mjs';
import { parseProjectJson } from '../miniapp/node/project-json.mjs';
import { createProjectAccess } from '../miniapp/node/project-access.mjs';

async function fixture(t, sources = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wechat-discovery-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, source) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  };
  for (const [file, source] of Object.entries(sources)) await put(file, source);
  return { root, put };
}

const app = (prefix = '') => Object.fromEntries(Object.entries({
  'app.json': '{"pages":["pages/index"],"lazyCodeLoading":"requiredComponents"}',
  'app.js': 'App({});', 'pages/index.js': 'Page({});', 'pages/index.wxml': '<view/>',
}).map(([file, source]) => [prefix + file, source]));

test('source discovery prefers explicit valid root, then selected directory, then unique direct child', async (t) => {
  const f = await fixture(t, { ...app(), ...app('one/'), ...app('two/'), 'project.config.json': '{"miniprogramRoot":"two","projectname":"Chosen"}' });
  const explicit = await resolveProject(f.root);
  assert.equal(explicit.sourceRoot, path.join(f.root, 'two'));
  assert.equal(explicit.projectDir, f.root);
  assert.equal(explicit.projectRoot, f.root);
  assert.equal(explicit.projectName, 'Chosen');
  await f.put('project.config.json', '{}');
  assert.equal((await resolveProject(f.root)).sourceRoot, f.root);
  const child = await fixture(t, app('one/'));
  assert.equal((await resolveProject(child.root)).sourceRoot, path.join(child.root, 'one'));
});

test('invalid in-bound explicit root warns on fallback without rewriting configuration or authorization', async (t) => {
  const f = await fixture(t, { ...app('source/'), 'project.config.json': '{"miniprogramRoot":"missing"}' });
  const saved = await readFile(path.join(f.root, 'project.config.json'), 'utf8');
  const resolved = await resolveProject(f.root);
  assert.equal(resolved.sourceRoot, path.join(f.root, 'source'));
  assert.equal(resolved.warnings[0].code, 'PROJECT_ROOT_FALLBACK');
  assert.equal(await readFile(path.join(f.root, 'project.config.json'), 'utf8'), saved);
  const plugin = await fixture(t);
  await mkdir(path.join(plugin.root, 'miniapp/node/demo'), { recursive: true });
  const access = await createProjectAccess(plugin.root, path.join(plugin.root, 'state'));
  await access.remember(f.root);
  assert.equal(await access(resolved.sourceRoot), resolved.sourceRoot);
  assert.deepEqual((await access.list()).map((grant) => grant.path), [f.root]);
  const built = await compileProject(f.root);
  assert.deepEqual(built.errors, []);
  assert.equal(built.warnings.some((warning) => warning.code === 'PROJECT_ROOT_FALLBACK'), true);
});

test('multiple roots are a bounded typed ambiguity and deep or sensitive directories are not searched', async (t) => {
  const sources = { ...app('deep/nested/'), ...app('.private/'), ...app('Ignored.app/') };
  for (let index = 0; index < 22; index++) Object.assign(sources, app(`choice-${index}/`));
  const f = await fixture(t, sources);
  await assert.rejects(resolveProject(f.root), (error) => {
    assert.equal(error.code, 'AMBIGUOUS_PROJECT_ROOT');
    assert.equal(error.candidateCount, 22);
    assert.equal(error.candidates.length, 20);
    assert.equal(error.truncated, true);
    assert.equal(error.candidates.every((candidate) => path.dirname(candidate) === f.root), true);
    return true;
  });
  const hidden = await fixture(t, { ...app('deep/nested/'), ...app('.ssh/'), ...app('Hidden.app/') });
  await assert.rejects(resolveProject(hidden.root), { code: 'INVALID_PROJECT' });
});

test('escape, source/app symlinks, and sensitive explicit roots cannot become fallback authorizations', async (t) => {
  const other = await fixture(t, app());
  const f = await fixture(t, { ...app('local/'), 'project.config.json': JSON.stringify({ miniprogramRoot: other.root }) });
  await assert.rejects(resolveProject(f.root), /escapes/);
  await symlink(other.root, path.join(f.root, 'linked'), 'dir');
  await f.put('project.config.json', '{"miniprogramRoot":"linked"}');
  await assert.rejects(resolveProject(f.root), /escapes/);
  await f.put('project.config.json', '{"miniprogramRoot":".ssh"}');
  await assert.rejects(resolveProject(f.root), { code: 'PROJECT_PATH_FORBIDDEN' });
  await f.put('project.config.json', '{}');
  assert.equal((await resolveProject(f.root)).sourceRoot, path.join(f.root, 'local'));
  const bad = await fixture(t);
  await symlink(path.join(other.root, 'app.json'), path.join(bad.root, 'app.json'));
  await assert.rejects(resolveProject(bad.root), { code: 'INVALID_PROJECT' });
});

test('all consumed config and JSON modules accept legal comments once with original line/column', async (t) => {
  const f = await fixture(t, {
    ...app(),
    'project.config.json': '{\r\n  // project\r\n  "miniprogramRoot":"."\r\n}',
    'app.json': '{\n  /* app\n     comment */\n  "pages":["pages/index"],"lazyCodeLoading":"requiredComponents"\n}',
    'pages/index.json': '{"usingComponents":{/* component */"child":"../components/child"}}',
    'pages/index.js': 'const value=require("../data.json"); Page({data:value});',
    'components/child.json': '{"component":true // config\n}',
    'components/child.js': 'Component({});', 'components/child.wxml': '<view/>',
    'data.json': '{\n // data\n "url":"https://example.test//path/*literal*/", "text":"\\\"/*also literal*/"\n}',
  });
  const build = await compileProject(f.root);
  assert.deepEqual(build.errors, []);
  const warnings = build.warnings.filter((warning) => warning.code === 'NONSTANDARD_JSON_COMMENT');
  assert.equal(warnings.length, 5);
  assert.deepEqual(warnings.find((warning) => warning.file === 'project.config.json'), {
    code: 'NONSTANDARD_JSON_COMMENT', file: 'project.config.json', line: 2, column: 3,
    message: 'JSON comments are accepted for local preview only; official compilation or publishing may reject them.',
  });
  assert.match(build.payload.modules['data.json'], /https:\/\/example.test\/\/path\/\*literal\*\//);
});

test('comment parser preserves strict JSON syntax and reports original positions for invalid input', async (t) => {
  const source = '{\r\n // comment\r\n "ok":1,\r\n}';
  assert.throws(() => parseProjectJson(source, 'strict.json'), (error) => {
    assert.equal(error.code, 'INVALID_JSON');
    assert.equal(error.line, 4);
    assert.equal(error.column, 1);
    return true;
  });
  assert.throws(() => parseProjectJson('{"ok":1} /* unfinished', 'strict.json'), /Unterminated/);
  assert.throws(() => parseProjectJson('{"missing":', 'strict.json'), { line: 1, column: 12 });
  assert.throws(() => parseProjectJson('  bad', 'strict.json'), { line: 1, column: 3 });
  assert.throws(() => parseProjectJson('{\n "value":NaN\n}', 'strict.json'), { line: 2, column: 10 });
  assert.throws(() => parseProjectJson('[0,]', 'strict.json'), { line: 1, column: 4 });
  assert.deepEqual(parseProjectJson('{"url":"https://example.test"}', 'strict.json').warnings, []);
  const f = await fixture(t, { ...app(), 'pages/index.js': 'Page({data:require("../data.json")});', 'data.json': source });
  const build = await compileProject(f.root);
  assert.equal(build.errors.length, 1);
  assert.deepEqual([build.errors[0].file, build.errors[0].line, build.errors[0].column], ['data.json', 4, 1]);
  assert.equal(Object.hasOwn(build.payload.modules, 'data.json'), false);
  await f.put('project.config.json', source);
  await assert.rejects(resolveProject(f.root), { code: 'INVALID_PROJECT', line: 4, column: 1 });
});

test('nonobject configs produce structured build diagnostics rather than uncaught exceptions', async (t) => {
  const f = await fixture(t, { ...app(), 'app.json': '[]', 'pages/index.json': 'false' });
  const build = await compileProject(f.root);
  assert.equal(build.errors.some((error) => error.file === 'app.json' && error.code === 'INVALID_CONFIG'), true);
  await f.put('app.json', app()['app.json']);
  const page = await compileProject(f.root);
  assert.equal(page.errors.some((error) => error.file === 'pages/index.json' && error.code === 'INVALID_CONFIG'), true);
  await f.put('project.config.json', '[]');
  await assert.rejects(resolveProject(f.root), { code: 'INVALID_PROJECT' });
});
