// @ts-check
// v5 清理改为直接永久删除：真实删除执行器（fs.rm）的结果和错误码、符号链接安全、清理记录的 method 字段和旧记录兼容、删除日志。
// 所有删除都只发生在测试临时目录（helpers.mjs 的 TMP_ROOT）下自建的目录里。
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../miniapp/node/app.mjs';
import { createRemover, deleteErrorCode } from '../miniapp/node/cleaner.mjs';
import { age, fakeExec, fakeLogger, makeTmp, removeTmp, writeFile } from './helpers.mjs';

/** @param {string} p */
const exists = (p) => fsp.lstat(p).then(
  () => true,
  () => false,
);

test('(a)(b) 删除文件和多层目录后都不存在；路径不存在返回 missing', async (t) => {
  const dir = await makeTmp('v5-del-basic');
  t.after(() => removeTmp(dir));
  const logger = fakeLogger();
  const remove = createRemover({ fs: fsp, logger });
  const file = path.join(dir, 'a.bin');
  await writeFile(file, Buffer.alloc(100));
  const tree = path.join(dir, 'node_modules');
  for (const p of ['x/y/z/1.js', 'x/y/2.js', 'x/3.js', 'w/4.js', '.bin/5']) await writeFile(path.join(tree, p), 'x');
  assert.deepEqual(await remove(file), { ok: true, error: null, errno: null });
  assert.deepEqual(await remove(tree), { ok: true, error: null, errno: null });
  assert.equal(await exists(file), false);
  assert.equal(await exists(tree), false);
  assert.deepEqual(await remove(path.join(dir, 'nope'), 'i_nope'), { ok: false, error: 'missing', errno: 'ENOENT' });
  assert.ok(logger.events.some((e) => e.msg === 'clean.delete.error' && e.fields.id === 'i_nope' && e.fields.errno === 'ENOENT' && e.fields.error === 'missing'), 'catch 分支有日志');
  for (const e of logger.events) assert.ok(!JSON.stringify(e.fields || {}).includes(dir), '日志不含路径');
});

test('(c) 子目录或父目录被 chmod 000 锁住：返回 permission_denied，路径仍在', { skip: process.getuid && process.getuid() === 0 && 'root 不受权限位限制' }, async (t) => {
  const dir = await makeTmp('v5-del-perm');
  t.after(() => removeTmp(dir));
  const logger = fakeLogger();
  const remove = createRemover({ fs: fsp, logger });
  // 被删目录里有一个锁住的子目录
  const victim = path.join(dir, 'victim');
  const locked = path.join(victim, 'locked');
  await writeFile(path.join(locked, 'f.txt'), 'x');
  await writeFile(path.join(victim, 'other.txt'), 'x');
  // 被删条目的父目录被锁住
  const parent = path.join(dir, 'parent');
  const inner = path.join(parent, 'inner');
  await writeFile(path.join(inner, 'g.txt'), 'x');
  await fsp.chmod(locked, 0o000);
  await fsp.chmod(parent, 0o000);
  try {
    const r1 = await remove(victim);
    const r2 = await remove(inner);
    assert.equal(r1.ok, false);
    assert.equal(r1.error, 'permission_denied');
    assert.ok(['EACCES', 'EPERM'].includes(String(r1.errno)));
    assert.deepEqual([r2.ok, r2.error], [false, 'permission_denied']);
  } finally {
    // 先恢复权限，再检查和清理
    await fsp.chmod(locked, 0o755);
    await fsp.chmod(parent, 0o755);
  }
  assert.equal(await exists(victim), true, '删到一半失败：路径还在');
  assert.equal(await exists(path.join(locked, 'f.txt')), true);
  assert.equal(await exists(inner), true);
  assert.ok(logger.events.some((e) => e.msg === 'clean.delete.error' && e.fields.error === 'permission_denied'));
  for (const e of logger.events) assert.ok(!JSON.stringify(e.fields || {}).includes(dir), '日志不含路径');
});

test('(d) 安全：被删目录里指向外部文件和外部目录的符号链接只删链接，外部内容完好', async (t) => {
  const dir = await makeTmp('v5-del-link');
  t.after(() => removeTmp(dir));
  const outside = path.join(dir, 'outside');
  const outFile = path.join(outside, 'keep.txt');
  const outDir = path.join(outside, 'keep-dir');
  await writeFile(outFile, 'keep');
  await writeFile(path.join(outDir, 'deep', 'k.txt'), 'deep');
  const victim = path.join(dir, 'victim');
  await writeFile(path.join(victim, 'own.txt'), 'x');
  await fsp.mkdir(path.join(victim, 'sub'), { recursive: true });
  await fsp.symlink(outFile, path.join(victim, 'link-file'));
  await fsp.symlink(outDir, path.join(victim, 'link-dir'));
  await fsp.symlink(outDir, path.join(victim, 'sub', 'link-dir-nested'));
  await fsp.symlink(outside, path.join(victim, 'sub', 'link-outside-root'));
  const remove = createRemover({ fs: fsp, logger: fakeLogger() });
  assert.deepEqual(await remove(victim), { ok: true, error: null, errno: null });
  assert.equal(await exists(victim), false);
  assert.equal(await fsp.readFile(outFile, 'utf8'), 'keep', '外部文件完好');
  assert.equal(await fsp.readFile(path.join(outDir, 'deep', 'k.txt'), 'utf8'), 'deep', '外部目录和里面的内容完好');
  assert.deepEqual((await fsp.readdir(outside)).sort(), ['keep-dir', 'keep.txt']);
});

test('错误码对照：ENOENT / EACCES / EPERM / EBUSY / 其他；删到一半报错但路径已不存在算成功', async (t) => {
  assert.deepEqual(['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'EIO', 'ENOTEMPTY', undefined].map((c) => deleteErrorCode(c)), [
    'missing',
    'permission_denied',
    'permission_denied',
    'in_use',
    'delete_failed',
    'delete_failed',
    'delete_failed',
  ]);
  const dir = await makeTmp('v5-del-codes');
  t.after(() => removeTmp(dir));
  const target = path.join(dir, 't');
  await writeFile(path.join(target, 'a.txt'), 'x');
  const logger = fakeLogger();
  const fail = (/** @type {string} */ code, /** @type {boolean} */ really) => ({
    lstat: fsp.lstat,
    rm: async (/** @type {string} */ p, /** @type {any} */ opts) => {
      if (really) await fsp.rm(p, opts);
      throw Object.assign(new Error(code), { code });
    },
  });
  assert.deepEqual(await createRemover({ fs: fail('EBUSY', false), logger })(target), { ok: false, error: 'in_use', errno: 'EBUSY' });
  assert.deepEqual(await createRemover({ fs: fail('EIO', false), logger })(target), { ok: false, error: 'delete_failed', errno: 'EIO' });
  assert.equal(await exists(target), true);
  // 报错时目录其实已经删掉了：算成功，并记日志（只记 id，不记路径）
  assert.deepEqual(await createRemover({ fs: fail('ENOTEMPTY', true), logger })(target, 'i_t'), { ok: true, error: null, errno: 'ENOTEMPTY' });
  assert.equal(await exists(target), false);
  assert.ok(logger.events.some((e) => e.msg === 'clean.delete.gone_after_error' && e.fields.errno === 'ENOTEMPTY' && e.fields.id === 'i_t'));
  for (const e of logger.events) assert.ok(!JSON.stringify(e.fields || {}).includes(dir), '日志不含路径');
});

test('(e) 走真实删除执行器清理：新记录带 method: "delete"，旧格式记录原样读出；clean.delete 和 clean.done 日志', async (t) => {
  const dir = await makeTmp('v5-del-app');
  t.after(() => removeTmp(dir));
  await fsp.mkdir(path.join(dir, 'disk'), { recursive: true });
  const disk = await fsp.realpath(path.join(dir, 'disk'));
  const home = path.join(disk, 'home');
  const zip = path.join(home, 'Downloads', 'old.zip');
  await writeFile(zip, Buffer.alloc(1234));
  await age(zip, 45);
  await writeFile(path.join(home, 'Documents', 'keep.txt'), 'keep');
  const dataDir = path.join(dir, 'data');
  // 旧格式的清理记录：没有 method 字段（当时是移到废纸篓）
  const old = [
    { at: 2000, path: '/old/a.zip', bytes: 10, ok: true, error: null },
    { at: 1000, path: '/old/b', bytes: 0, ok: false, error: 'trash_failed' },
  ];
  await writeFile(path.join(dataDir, 'history-v1.json'), JSON.stringify({ version: 1, entries: old }));
  const logger = fakeLogger();
  // 不注入 remove：用默认的真实删除执行器（被删的只有临时目录里的夹具）
  const app = createApp({
    platform: 'darwin',
    env: {},
    home,
    tmpdir: path.join(disk, 'tmp'),
    fs: fsp,
    exec: fakeExec(),
    dataDir,
    logger,
    disks: async () => [{ id: 'a', label: 'Disk A', mount: disk, totalBytes: 1e12, usedBytes: 5e9, freeBytes: 9e11, kind: 'internal', defaultScan: true, deletable: true }],
    fullDiskAccess: async () => 'granted',
    runningApps: async () => new Set(),
    goModCache: async () => null,
    sizeOf: (st) => st.size,
  });
  t.after(() => app.dispose());
  await app.ensureLoaded();
  assert.deepEqual(app.history().entries, old, '旧格式记录原样读出');

  await app.startScan({ diskIds: ['a'] });
  await app.waitIdle();
  const inst = app.views.junkJSON().tiers.flatMap((/** @type {any} */ x) => x.categories).find((/** @type {any} */ c) => c.id === 'installers').items[0];
  assert.equal(inst.path, zip);
  await app.updateSelection({ add: [inst.id] });
  const { jobId } = await app.startClean({ itemIds: [inst.id] });
  await app.waitIdle();
  const job = app.getClean(jobId);
  assert.deepEqual(job.results.map((/** @type {any} */ r) => [r.path, r.ok, r.bytes, r.error]), [[zip, true, 1234, null]]);
  assert.equal(job.freedBytes, 1234);
  assert.equal(await exists(zip), false, '文件被直接删除');
  assert.equal(await exists(path.join(home, 'Documents', 'keep.txt')), true);
  await assert.rejects(fsp.readdir(path.join(home, '.Trash')), '没有移到废纸篓');

  const hist = app.history().entries;
  assert.deepEqual(hist[0], { at: hist[0].at, path: zip, bytes: 1234, ok: true, error: null, method: 'delete' });
  assert.deepEqual(hist.slice(1), old, '旧记录不变');
  // 持久化后再读一遍
  await app.flush();
  const saved = JSON.parse(await fsp.readFile(path.join(dataDir, 'history-v1.json'), 'utf8'));
  assert.equal(saved.entries[0].method, 'delete');
  assert.deepEqual(saved.entries.slice(1), old);

  const del = logger.events.filter((e) => e.msg === 'clean.delete');
  assert.equal(del.length, 1);
  assert.deepEqual([del[0].fields.id, del[0].fields.ok, del[0].fields.error, del[0].fields.errno], [inst.id, true, null, null]);
  assert.equal(typeof del[0].fields.ms, 'number');
  const done = logger.events.find((e) => e.msg === 'clean.done');
  assert.ok(done);
  assert.deepEqual([done.fields.ok, done.fields.failed, done.fields.freedBytes, typeof done.fields.ms], [1, 0, 1234, 'number']);
  for (const e of logger.events) assert.ok(!JSON.stringify(e.fields || {}).includes(dir), `日志 ${e.msg} 不含路径`);
});
