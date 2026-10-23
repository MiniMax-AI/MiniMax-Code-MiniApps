import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProjectAccess, isWithin, ProjectAccessError } from '../miniapp/node/project-access.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wechat-project-access-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pluginRoot = path.join(root, 'plugin');
  const demo = path.join(pluginRoot, 'miniapp/node/demo');
  const dataDir = path.join(root, 'data');
  const project = path.join(root, 'project');
  await Promise.all([mkdir(demo, { recursive: true }), mkdir(project), mkdir(dataDir)]);
  return { root, pluginRoot, demo, dataDir, project };
}
const errorCode = (code) => (error) => error instanceof ProjectAccessError && error.code === code;

test('ordinary explicit paths need no grant, read-only validation adds no project history or grant file', async (t) => {
  const f = await fixture(t);
  const access = await createProjectAccess(f.pluginRoot, f.dataDir);
  assert.equal(await access(f.project), f.project);
  assert.deepEqual(await access.list(), []);
  assert.equal(await access.remember(f.project), f.project);
  assert.deepEqual(await access.list(), [{ path: f.project }]);
  await assert.rejects(stat(path.join(f.dataDir, 'project-access.json')), { code: 'ENOENT' });
  assert.equal(access.grant, undefined); assert.equal(access.revoke, undefined);
});

test('legacy grants and package roots are never read, rewritten, deleted, or converted to project history', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.dataDir, 'project-access.json');
  await writeFile(path.join(f.pluginRoot, 'miniapp/node/project-roots.json'), JSON.stringify({ allowedProjectRoots: [f.root] }));
  for (const legacy of ['{broken', '{}', JSON.stringify({ version: 1, grants: [{ path: os.homedir(), grantedAt: 1, dev: '1', ino: '1' }] })]) {
    await writeFile(file, legacy);
    const access = await createProjectAccess(f.pluginRoot, f.dataDir);
    assert.equal(await access(f.project), f.project);
    assert.deepEqual(await access.list(), []);
    await access.remember(f.project);
    assert.equal(await readFile(file, 'utf8'), legacy);
    await assert.rejects(access(os.homedir()), errorCode('PROJECT_PATH_FORBIDDEN'));
  }
  await unlink(file); await symlink(path.join(f.root, 'nonexistent-secret'), file);
  const linked = await createProjectAccess(f.pluginRoot, f.dataDir);
  assert.equal(await linked(f.project), f.project);
  await assert.rejects(stat(path.join(f.root, 'nonexistent-secret')), { code: 'ENOENT' });
});

test('only exact bundled project roots bypass package restrictions, never newly copied descendants', async (t) => {
  const f = await fixture(t);
  const nested = path.join(f.demo, 'miniprogram');
  const copied = path.join(f.demo, 'copied-user-project');
  const game = path.join(f.pluginRoot, 'miniapp/node/demo-game-2d');
  await Promise.all([mkdir(nested), mkdir(copied), mkdir(game)]);
  const access = await createProjectAccess(f.pluginRoot, f.dataDir);
  assert.equal(await access(f.demo), f.demo); assert.equal(await access(game), game);
  for (const denied of [nested, copied, f.pluginRoot]) await assert.rejects(access(denied), errorCode('PROJECT_PATH_FORBIDDEN'));
  const alias = path.join(f.root, 'demo-alias'); await symlink(f.demo, alias, 'dir');
  assert.equal(await access(alias), f.demo);
  await rename(f.demo, path.join(f.root, 'old-demo')); await mkdir(f.demo);
  await assert.rejects(access(f.demo), errorCode('PROJECT_ACCESS_CHANGED'));
});

test('remembered canonical roots and alias identities cannot follow replacement directories within a process', async (t) => {
  const f = await fixture(t);
  const sibling = path.join(f.root, 'other'); await mkdir(sibling);
  const alias = path.join(f.root, 'alias'); await symlink(f.project, alias, 'dir');
  const access = await createProjectAccess(f.pluginRoot, f.dataDir);
  await access.remember(alias);
  await unlink(alias); await symlink(sibling, alias, 'dir');
  await assert.rejects(access(alias), errorCode('PROJECT_ACCESS_CHANGED'));
  assert.equal(await access(sibling), sibling);
  await rename(f.project, path.join(f.root, 'moved')); await mkdir(f.project);
  await assert.rejects(access(f.project), errorCode('PROJECT_ACCESS_CHANGED'));
  await assert.rejects(access.remember(f.project), errorCode('PROJECT_ACCESS_CHANGED'));
  const restarted = await createProjectAccess(f.pluginRoot, f.dataDir);
  assert.equal(await restarted.remember(f.project), f.project);
});

test('selecting a project captures identity without recording it and refuses a replacement before admission', async (t) => {
  const f = await fixture(t), access = await createProjectAccess(f.pluginRoot, f.dataDir);
  const captured = await access.identity(f.project);
  assert.deepEqual(await access.list(), []);
  await rename(f.project, path.join(f.root, 'selected-before')); await mkdir(f.project);
  await assert.rejects(access.remember(f.project, captured), errorCode('PROJECT_ACCESS_CHANGED'));
  assert.deepEqual(await access.list(), []);
  assert.equal(await access.remember(f.project), f.project);
});

test('specific ordinary children and siblings open directly, while private/broad roots remain forbidden', async (t) => {
  const f = await fixture(t);
  const access = await createProjectAccess(f.pluginRoot, f.dataDir);
  const child = path.join(f.project, 'miniprogram'), sibling = path.join(f.root, 'project-other');
  await Promise.all([mkdir(child), mkdir(sibling)]);
  await access.remember(f.project);
  assert.equal(await access(child), child); assert.equal(await access(sibling), sibling);
  assert.equal(isWithin(f.project, sibling), false);
  for (const name of ['.ssh', '.aws', '.git', '.minimax', 'Utility.app', '.codex/sessions']) {
    const sensitive = path.join(f.project, name); await mkdir(sensitive, { recursive: true });
    await assert.rejects(access(sensitive), errorCode('PROJECT_PATH_FORBIDDEN'));
  }
  for (const broad of [path.parse(f.root).root, os.homedir(), os.tmpdir()]) await assert.rejects(access(broad), errorCode('PROJECT_PATH_FORBIDDEN'));
  const alias = path.join(f.root, 'private-alias'); await symlink(path.join(f.project, '.ssh'), alias, 'dir');
  await assert.rejects(access(alias), errorCode('PROJECT_PATH_FORBIDDEN'));
  const checkout = path.join(f.root, '.codex/worktrees/example/project'); await mkdir(checkout, { recursive: true });
  assert.equal(await access(checkout), checkout);
});

test('invalid paths retain typed errors without writes or side-effectful path probing', async (t) => {
  const f = await fixture(t), access = await createProjectAccess(f.pluginRoot, f.dataDir);
  for (const value of ['', './project', null, 42, '/a\0b']) await assert.rejects(access(value), errorCode('INVALID_PROJECT_PATH'));
  await assert.rejects(access(path.join(f.root, 'missing')), errorCode('PROJECT_NOT_FOUND'));
  const file = path.join(f.root, 'file'); await writeFile(file, 'not directory');
  await assert.rejects(access(file), errorCode('PROJECT_NOT_DIRECTORY'));
  assert.deepEqual(await access.list(), []);
});

test('identity storage is process-bounded and concurrent admissions do not bypass the limit', async (t) => {
  const f = await fixture(t), access = await createProjectAccess(f.pluginRoot, f.dataDir);
  const targets = Array.from({ length: 101 }, (_, index) => path.join(f.root, 'project-' + index));
  await Promise.all(targets.map((target) => mkdir(target)));
  const results = await Promise.allSettled(targets.map((target) => access.remember(target)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 100);
  assert.equal(results.filter((result) => result.status === 'rejected')[0].reason.code, 'PROJECT_ACCESS_LIMIT');
  assert.equal((await access.list()).length, 100);
  await assert.rejects(stat(path.join(f.dataDir, 'project-access.json')), { code: 'ENOENT' });
});
