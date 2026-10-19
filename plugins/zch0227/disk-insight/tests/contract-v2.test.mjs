// @ts-check
// 契约变更：tree 的 diskId、已选清单按分类增删、keep-newest 返回值、rescan 不改状态、disks[].unscannedBytes。
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../miniapp/node/app.mjs';
import { createRouter } from '../miniapp/node/routes.mjs';
import { MB } from '../miniapp/node/util.mjs';
import { PKG_ROOT, age, fakeExec, fakeLogger, fakeRemove, makeTmp, removeTmp, sparseFile, writeFile } from './helpers.mjs';

const TEMP_COUNT = 305;

/** @param {string} dir */
async function fixture(dir) {
  const a = path.join(dir, 'diskA');
  const b = path.join(dir, 'diskB');
  const c = path.join(dir, 'diskC');
  const home = path.join(a, 'home');
  const tmp = path.join(a, 'tmp');
  for (let i = 0; i < TEMP_COUNT; i += 1) {
    const f = path.join(tmp, `t${String(i).padStart(3, '0')}.tmp`);
    await writeFile(f, Buffer.alloc(10 + i));
    await age(f, 5);
  }
  await sparseFile(path.join(home, 'Movies', 'big.mov'), 600 * MB);
  await age(path.join(home, 'Movies', 'big.mov'), 200);
  const dup = randomBytes(2 * MB);
  await writeFile(path.join(home, 'Documents', 'd1.bin'), dup);
  await writeFile(path.join(home, 'Pictures', 'd2.bin'), dup);
  await age(path.join(home, 'Documents', 'd1.bin'), 30);
  await writeFile(path.join(home, 'go', 'pkg', 'mod', 'x.go'), 'package x');
  await sparseFile(path.join(b, 'old.mov'), 600 * MB);
  await age(path.join(b, 'old.mov'), 300);
  await writeFile(path.join(c, 'z.txt'), 'z');
  const disks = [
    { id: 'a', label: 'Disk A', mount: a, totalBytes: 1e12, usedBytes: 2e9, freeBytes: 9e11, kind: 'internal', defaultScan: true, deletable: true },
    { id: 'b', label: 'Disk B', mount: b, totalBytes: 1e12, usedBytes: 5e9, freeBytes: 9e11, kind: 'external', defaultScan: false, deletable: false },
    { id: 'c', label: 'Disk C', mount: c, totalBytes: 1e12, usedBytes: 1e9, freeBytes: 9e11, kind: 'external', defaultScan: false, deletable: false },
  ];
  return { home, tmp, disks };
}

/** @param {string} dir @param {any} fx */
function makeApp(dir, fx) {
  const logger = fakeLogger();
  const app = createApp({
    platform: 'darwin',
    env: {},
    home: fx.home,
    tmpdir: fx.tmp,
    fs: fsp,
    exec: fakeExec(),
    dataDir: path.join(dir, 'data'),
    logger,
    disks: async () => fx.disks,
    remove: fakeRemove(),
    fullDiskAccess: async () => 'granted',
    runningApps: async () => new Set(),
    goModCache: async () => path.join(fx.home, 'go', 'pkg', 'mod'),
    sizeOf: (st) => st.size,
    concurrency: 8,
  });
  return { app, logger };
}

/** @param {any} app @param {string} cat */
const itemsOf = (app, cat) => [...app.getModel().items.values()].filter((it) => it.category === cat).map((it) => app.views.itemJSON(app.views.entityFromItem(it)));

/** @param {() => any} fn @param {string} code */
function throwsCode(fn, code) {
  return assert.rejects(Promise.resolve().then(fn), (e) => /** @type {any} */ (e).code === code);
}

test('契约变更：tree 的 diskId、按分类增删、keep-newest、rescan 不改状态、unscannedBytes', async (t) => {
  const dir = await makeTmp('contract-v2');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const { app, logger } = makeApp(dir, fx);
  t.after(() => app.dispose());

  // 扫描前：所有磁盘 unscannedBytes 为 0；指定 diskId 返回 disk_not_scanned
  await app.ensureLoaded();
  const s0 = app.stateJSON();
  assert.deepEqual(s0.disks.map((d) => d.unscannedBytes), [0, 0, 0]);
  assert.equal(s0.unscanned.bytes, 0);
  await throwsCode(() => app.views.treeJSON(null, null, 'a', '1'), 'disk_not_scanned');

  await app.startScan({ diskIds: ['a', 'b'] });
  await app.waitIdle();
  assert.equal(app.stateJSON().scan.status, 'done');

  // ---- disks[].unscannedBytes
  const s1 = app.stateJSON();
  const byId = Object.fromEntries(s1.disks.map((d) => [d.id, d]));
  assert.equal(byId.c.unscannedBytes, 0, '没扫描过的磁盘为 0');
  assert.ok(byId.a.unscannedBytes > 0 && byId.a.unscannedBytes <= byId.a.usedBytes);
  assert.ok(byId.b.unscannedBytes >= 0);
  assert.equal(s1.unscanned.bytes, byId.a.unscannedBytes + byId.b.unscannedBytes + byId.c.unscannedBytes, 'unscanned.bytes 是各磁盘之和');

  // ---- GET /api/tree 的 diskId
  const first = app.views.treeJSON(null, null, null, '1');
  assert.equal(first.diskId, 'a', '两者都省略时返回第一个已扫描磁盘的根');
  assert.equal(first.node.name, 'Disk A');
  const treeB = app.views.treeJSON(null, null, 'b', '1');
  assert.equal(treeB.diskId, 'b', '没有 id 时返回 diskId 指定磁盘的根');
  assert.equal(treeB.node.name, 'Disk B');
  assert.deepEqual(treeB.breadcrumbs.map((/** @type {any} */ x) => x.name), ['Disk B']);
  const homeNode = first.node.children.find((/** @type {any} */ x) => x.name === 'home');
  const viaId = app.views.treeJSON(homeNode.id, null, 'b', '1');
  assert.equal(viaId.node.name, 'home', 'id 优先于 diskId');
  assert.equal(viaId.diskId, 'a');
  await throwsCode(() => app.views.treeJSON(null, null, 'c', '1'), 'disk_not_scanned');
  await throwsCode(() => app.views.treeJSON(null, null, 'zzz', '1'), 'disk_not_scanned');
  await throwsCode(() => app.views.treeJSON('n_missing', null, 'a', '1'), 'not_found');

  // 经 HTTP 路由验证参数接线
  const server = createServer((req, res) => void createRouter(app, { fs: fsp, pluginRoot: PKG_ROOT, logger: fakeLogger() })(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  const r404 = await fetch(`${base}/api/tree?diskId=c`);
  assert.equal(r404.status, 404);
  assert.equal((await r404.json()).error, 'disk_not_scanned');
  const rB = await (await fetch(`${base}/api/tree?diskId=b&depth=1`)).json();
  assert.equal(rB.diskId, 'b');
  const rState = await (await fetch(`${base}/api/state`)).json();
  assert.ok(rState.disks.every((/** @type {any} */ d) => typeof d.unscannedBytes === 'number'));

  // ---- 按分类增删：作用于全部条目，不受 300 条上限影响
  const junkTemp = app.views.junkJSON().tiers[0].categories.find((/** @type {any} */ c) => c.id === 'temp');
  assert.equal(junkTemp.itemCount, TEMP_COUNT);
  assert.equal(junkTemp.items.length, 300, '/api/junk 每类最多返回 300 条');
  assert.ok(itemsOf(app, 'temp').every((i) => i.selected), 'temp 默认全部勾选');
  const base0 = app.getSelection().count;

  const r1 = await app.updateSelection({ removeCategories: ['temp'] });
  assert.deepEqual(Object.keys(r1).sort(), ['bytes', 'count']);
  assert.equal(r1.count, base0 - TEMP_COUNT);
  assert.ok(itemsOf(app, 'temp').every((i) => !i.selected), '305 条全部取消，包括第 300 条以后的');

  const r2 = await app.updateSelection({ addCategories: ['temp'] });
  assert.equal(r2.count, base0);
  assert.ok(itemsOf(app, 'temp').every((i) => i.selected));

  // 锁定条目照样跳过：磁盘 B 不可删除，它的大文件被锁定
  const largeOld = itemsOf(app, 'large-old');
  assert.equal(largeOld.length, 2);
  await app.updateSelection({ addCategories: ['large-old'] });
  const lo = itemsOf(app, 'large-old');
  const onA = lo.find((i) => i.path.endsWith('big.mov'));
  const onB = lo.find((i) => i.path.endsWith('old.mov'));
  assert.equal(onA?.selected, true);
  assert.equal(onB?.locked, true);
  assert.equal(onB?.selected, false, '锁定条目不加入');
  assert.ok(logger.events.some((e) => e.msg === 'selection.category.skipped' && e.fields.locked === 1));

  // info 分类、duplicates、未知分类返回 invalid_category，且请求整体不生效
  const beforeInvalid = app.getSelection().count;
  for (const body of [{ addCategories: ['go-mod-cache'] }, { removeCategories: ['duplicates'] }, { addCategories: ['nope'] }, { clear: true, addCategories: ['trash'] }]) {
    await throwsCode(() => app.updateSelection(body), 'invalid_category');
  }
  assert.equal(app.getSelection().count, beforeInvalid, '校验失败时不做任何修改');
  await throwsCode(() => app.updateSelection({ addCategories: 'temp' }), 'bad_request');

  // 执行顺序：clear、removeCategories、addCategories、remove、add
  const temps = itemsOf(app, 'temp');
  const t1 = temps[0].id;
  const t2 = temps[1].id;
  const o1 = await app.updateSelection({ clear: true, removeCategories: ['temp'], addCategories: ['temp'], remove: [t1], add: [t1] });
  assert.equal(o1.count, TEMP_COUNT, 'clear 之后按分类加入全部 temp，remove 再 add 同一条，结果仍在');
  const o2 = await app.updateSelection({ addCategories: ['temp'], remove: [t1] });
  assert.equal(o2.count, TEMP_COUNT - 1, 'remove 在 addCategories 之后执行');
  assert.equal(itemsOf(app, 'temp').find((i) => i.id === t1)?.selected, false);
  const o3 = await app.updateSelection({ removeCategories: ['temp'], add: [t2] });
  assert.equal(o3.count, 1, 'add 在 removeCategories 之后执行');
  assert.equal(itemsOf(app, 'temp').filter((i) => i.selected).map((i) => i.id).join(), t2);

  // ---- keep-newest 返回整个已选清单的合计，和 POST /api/selection 一致
  const k = await app.keepNewest();
  assert.deepEqual(Object.keys(k).sort(), ['bytes', 'count']);
  const sel = app.getSelection();
  assert.deepEqual(k, { count: sel.count, bytes: sel.bytes });
  assert.equal(k.count, 2, 't2 加上较旧的一份重复文件');
  const viaSelection = await app.updateSelection({});
  assert.deepEqual(viaSelection, k);

  // ---- rescan 不改变 scan.status，也不清空已选清单
  const before = app.stateJSON();
  const movies = app.views.treeJSON(homeNode.id, null, null, '1').node.children.find((/** @type {any} */ x) => x.name === 'Movies');
  await app.startRescan({ id: movies.id });
  const during = app.stateJSON();
  assert.equal(during.scan.status, before.scan.status, '进行中也不改变 scan.status');
  assert.equal(during.scan.phase, null);
  assert.deepEqual(during.scan.progress, before.scan.progress, '进度显示的仍是上次完整扫描');
  await throwsCode(() => app.startScan({}), 'scan_running');
  await app.waitIdle();
  const after = app.stateJSON();
  assert.equal(after.scan.status, 'done');
  assert.equal(after.scan.finishedAt, before.scan.finishedAt);
  assert.equal(after.selection.count, before.selection.count, '不清空已选清单');
  assert.ok(logger.events.some((e) => e.msg === 'rescan.done'));
});
