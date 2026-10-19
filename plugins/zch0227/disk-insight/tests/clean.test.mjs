// @ts-check
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { precheck, runCleanEntries } from '../miniapp/node/cleaner.mjs';
import { createPathOps } from '../miniapp/node/util.mjs';
import { fakeLogger, fakeRemove, makeTmp, removeTmp, writeFile } from './helpers.mjs';

const po = createPathOps('posix');

/** @param {string} p */
async function entryFor(p, extra = {}) {
  const st = await fsp.lstat(p);
  return { id: `i_${path.basename(p)}`, path: p, dev: st.dev, ino: st.ino, mtimeMs: st.mtimeMs, releasableBytes: st.size, lockReason: null, deletable: true, ...extra };
}

test('清理前五项复查：每个失败分支', async (t) => {
  const dir = await makeTmp('precheck');
  t.after(() => removeTmp(dir));
  const ok = path.join(dir, 'ok.txt');
  await writeFile(ok, 'hello');
  const base = { fs: fsp, pathOps: po, lockReason: null, deletable: true };

  assert.equal(await precheck(await entryFor(ok), base), null, '全部通过');

  // 1 路径不存在
  const gone = await entryFor(ok);
  gone.path = path.join(dir, 'missing.txt');
  assert.equal(await precheck(gone, base), 'missing');

  // 2a 是符号链接
  const link = path.join(dir, 'link.txt');
  await fsp.symlink(ok, link);
  assert.equal(await precheck(await entryFor(link), base), 'symlink');

  // 2b 修改时间变了
  const changed = path.join(dir, 'changed.txt');
  await writeFile(changed, 'a');
  const e = await entryFor(changed);
  const later = new Date(Date.now() + 60000);
  await fsp.utimes(changed, later, later);
  assert.equal(await precheck(e, base), 'changed');

  // 2c 被替换成了另一个文件（ino 不同）
  const replaced = path.join(dir, 'replaced.txt');
  await writeFile(replaced, 'a');
  const r1 = await entryFor(replaced);
  await fsp.rename(replaced, path.join(dir, 'replaced.old'));
  await writeFile(replaced, 'a');
  const st2 = await fsp.lstat(replaced);
  assert.equal(await precheck({ ...r1, mtimeMs: st2.mtimeMs }, base), 'changed');

  // 3 真实路径不等于记录的路径（上级目录是链接）
  await fsp.mkdir(path.join(dir, 'real'));
  await writeFile(path.join(dir, 'real', 'f.txt'), 'x');
  await fsp.symlink(path.join(dir, 'real'), path.join(dir, 'alias'));
  const viaAlias = await entryFor(path.join(dir, 'alias', 'f.txt'));
  assert.equal(await precheck(viaAlias, base), 'symlink');

  // 4 被锁定
  assert.equal(await precheck(await entryFor(ok), { ...base, lockReason: '系统目录' }), 'protected');

  // 5 磁盘不允许删除
  assert.equal(await precheck(await entryFor(ok), { ...base, deletable: false }), 'not_deletable_volume');
});

test('清理执行：复查失败的跳过并记日志，执行器失败映射为契约错误码，成功的计入释放大小；逐项推送进度', async (t) => {
  const dir = await makeTmp('clean');
  t.after(() => removeTmp(dir));
  const a = path.join(dir, 'a.bin');
  const b = path.join(dir, 'b.bin');
  const c = path.join(dir, 'c.bin');
  await writeFile(a, Buffer.alloc(100));
  await writeFile(b, Buffer.alloc(200));
  await writeFile(c, Buffer.alloc(300));
  const remove = fakeRemove({ fail: new Set([b]) });
  const logger = fakeLogger();
  const entries = [await entryFor(a), await entryFor(b), await entryFor(c, { lockReason: '系统目录' })];
  /** @type {any[][]} */
  const progress = [];
  const results = await runCleanEntries({ entries, fs: fsp, pathOps: po, remove, logger, onProgress: (chunk) => progress.push(chunk) });
  const by = Object.fromEntries(results.map((r) => [path.basename(r.path), r]));
  assert.deepEqual(by['a.bin'], { id: 'i_a.bin', path: a, ok: true, bytes: 100, error: null });
  assert.equal(by['b.bin'].ok, false);
  assert.equal(by['b.bin'].error, 'in_use');
  assert.equal(by['b.bin'].bytes, 0);
  assert.equal(by['c.bin'].error, 'protected');
  assert.deepEqual(progress.map((ch) => ch.map((/** @type {any} */ r) => r.id)), [['i_a.bin'], ['i_b.bin'], ['i_c.bin']], '按条目顺序逐项推送：每处理完一项（删除或跳过）推送一次');
  assert.deepEqual(remove.calls, [a, b], '锁定的条目不会交给执行器');
  await assert.rejects(fsp.lstat(a), '成功的条目已删除');
  await fsp.lstat(b);
  await fsp.lstat(c);
  assert.ok(logger.events.some((e) => e.msg === 'clean.item.skipped' && e.fields.code === 'protected'));
  const del = logger.events.filter((e) => e.msg === 'clean.delete');
  assert.deepEqual(del.map((e) => [e.fields.id, e.fields.ok, e.fields.error, e.fields.errno]), [['i_a.bin', true, null, null], ['i_b.bin', false, 'in_use', 'EBUSY']]);
  assert.ok(del.every((e) => typeof e.fields.ms === 'number'));
  for (const e of logger.events) assert.ok(!JSON.stringify(e.fields || {}).includes(dir), '日志不含路径');
});

test('清理执行：每一项在删除前当场复查——删前一项期间后一项被改了，后一项按 changed 跳过、不删', async (t) => {
  const dir = await makeTmp('clean-recheck');
  t.after(() => removeTmp(dir));
  const a = path.join(dir, 'a.bin');
  const b = path.join(dir, 'b.bin');
  await writeFile(a, Buffer.alloc(10));
  await writeFile(b, Buffer.alloc(20));
  const entries = [await entryFor(a), await entryFor(b)];
  const logger = fakeLogger();
  const inner = fakeRemove();
  /** @type {string[]} */
  const order = [];
  // 删 a 的这段时间里，b 被别的程序改了（修改时间变化）
  const remove = async (/** @type {string} */ p) => {
    order.push(`remove:${path.basename(p)}`);
    const r = await inner(p);
    const later = new Date(Date.now() + 60000);
    await fsp.utimes(b, later, later);
    return r;
  };
  /** @type {any[][]} */
  const progress = [];
  const results = await runCleanEntries({ entries, fs: fsp, pathOps: po, remove, logger, onProgress: (chunk) => progress.push(chunk) });
  assert.deepEqual(results.map((r) => [r.id, r.ok, r.error]), [['i_a.bin', true, null], ['i_b.bin', false, 'changed']]);
  assert.deepEqual(order, ['remove:a.bin'], 'b 复查没通过，没有交给执行器');
  await fsp.lstat(b);
  assert.deepEqual(progress.map((ch) => ch.map((/** @type {any} */ r) => r.id)), [['i_a.bin'], ['i_b.bin']]);
  assert.ok(logger.events.some((e) => e.msg === 'clean.item.skipped' && e.fields.code === 'changed'));
  for (const e of logger.events) assert.ok(!JSON.stringify(e.fields || {}).includes(dir), '日志不含路径');
});

test('清理执行：执行器抛错按 delete_failed；取消后没轮到的条目不删', async (t) => {
  const dir = await makeTmp('clean-abort');
  t.after(() => removeTmp(dir));
  const files = ['a', 'b', 'c'].map((n) => path.join(dir, `${n}.bin`));
  for (const f of files) await writeFile(f, Buffer.alloc(10));
  const entries = await Promise.all(files.map((f) => entryFor(f)));
  const ac = new AbortController();
  const logger = fakeLogger();
  /** @type {string[]} */
  const calls = [];
  const remove = async (/** @type {string} */ p) => {
    calls.push(p);
    // 删第一项时用户点了取消：这一项照常结束，之后的不再删除
    ac.abort();
    throw Object.assign(new Error('boom'), { code: 'EIO' });
  };
  const results = await runCleanEntries({ entries, fs: fsp, pathOps: po, remove, logger, signal: ac.signal, onProgress: () => {} });
  assert.deepEqual(calls, [files[0]]);
  assert.deepEqual(results.map((r) => [r.ok, r.error]), [[false, 'delete_failed'], [false, 'delete_failed'], [false, 'delete_failed']]);
  for (const f of files) await fsp.lstat(f);
  assert.ok(logger.events.some((e) => e.msg === 'clean.delete.threw' && e.fields.errno === 'EIO' && e.fields.id === entries[0].id));
  for (const e of logger.events) assert.ok(!JSON.stringify(e.fields || {}).includes(dir), '日志不含路径');
});
