// @ts-check
// 端到端：在夹具「磁盘」上跑完整扫描、默认勾选、已选清单、重新扫描、清理（假执行器）、持久化。
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../miniapp/node/app.mjs';
import { MB } from '../miniapp/node/util.mjs';
import { age, fakeExec, fakeLogger, fakeRemove, makeTmp, removeTmp, sparseFile, writeFile } from './helpers.mjs';

/** @param {string} dir */
async function buildFixture(dir) {
  const disk = path.join(dir, 'disk');
  const home = path.join(disk, 'home');
  const tmp = path.join(disk, 'tmp');
  const w = (/** @type {string} */ rel, /** @type {any} */ c = 'x') => writeFile(path.join(home, rel), c);
  await w('.npm/_cacache/content/a', Buffer.alloc(1000));
  await w('Library/Caches/Google/Chrome/data', Buffer.alloc(2000));
  await w('Library/Caches/Google/Other/x', Buffer.alloc(500));
  await sparseFile(path.join(home, 'Library/Caches/Google/Other/pad.bin'), 20 * MB);
  await w('Library/Caches/com.foo/x', Buffer.alloc(300));
  await w('Library/Logs/a.log', Buffer.alloc(100));
  await w('Downloads/old.dmg', Buffer.alloc(400));
  await age(path.join(home, 'Downloads/old.dmg'), 40);
  await w('Downloads/new.dmg', Buffer.alloc(400));
  await w('Downloads/proj/package.json', '{}');
  await w('Downloads/proj/node_modules/x.js', Buffer.alloc(800));
  await age(path.join(home, 'Downloads/proj/package.json'), 120);
  await w('Desktop/readme.txt', 'hi');
  await w('work/app/package.json', '{}');
  await w('work/app/node_modules/y.js', Buffer.alloc(900));
  await w('work/py/.venv/pyvenv.cfg', 'home=/usr');
  await w('work/py/.venv/lib/x.py', Buffer.alloc(600));
  await w('work/py/__pycache__/a.pyc', Buffer.alloc(50));
  await w('work/py/main.py', 'print(1)');
  await sparseFile(path.join(home, 'Movies/big.mov'), 600 * MB);
  await age(path.join(home, 'Movies/big.mov'), 200);
  const dup = randomBytes(2 * MB);
  await w('Documents/dup1.bin', dup);
  await w('Pictures/dup2.bin', dup);
  await age(path.join(home, 'Documents/dup1.bin'), 10);
  await w('go/pkg/mod/github.com/x/y.go', Buffer.alloc(700));
  await w('proj2/.git/HEAD', 'ref');
  await w('proj2/src/a.txt', 'a');
  await writeFile(path.join(tmp, 'old.txt'), Buffer.alloc(10));
  await age(path.join(tmp, 'old.txt'), 5);
  await writeFile(path.join(tmp, 'new.txt'), Buffer.alloc(10));
  await writeFile(path.join(tmp, 'olddir', 'f'), Buffer.alloc(10));
  await age(path.join(tmp, 'olddir', 'f'), 10);
  await age(path.join(tmp, 'olddir'), 10);
  return { disk, home, tmp };
}

/** @param {string} dir @param {{ disk: string, home: string, tmp: string }} fx @param {any} remove */
function makeApp(dir, fx, remove) {
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
    mcodeDataDir: path.join(dir, 'mcode'),
    disks: async () => [{ id: 'mac-data', label: 'Fixture HD', mount: fx.disk, totalBytes: 1e12, usedBytes: 7e8, freeBytes: 1e11, kind: 'internal', defaultScan: true, deletable: true }],
    remove,
    fullDiskAccess: async () => 'missing',
    runningApps: async () => new Set(['chrome']),
    goModCache: async () => path.join(fx.home, 'go', 'pkg', 'mod'),
    sizeOf: (st) => st.size,
    concurrency: 8,
  });
  return { app, logger };
}

/** @param {any} junk @param {string} id */
const category = (junk, id) => junk.tiers.flatMap((/** @type {any} */ t) => t.categories).find((/** @type {any} */ c) => c.id === id);

test('完整扫描 → 规则结果 → 已选清单 → 重新扫描 → 清理 → 持久化', async (t) => {
  const dir = await makeTmp('app');
  t.after(() => removeTmp(dir));
  const fx = await buildFixture(dir);
  const remove = fakeRemove();
  const { app, logger } = makeApp(dir, fx, remove);
  t.after(() => app.dispose());

  await app.startScan({ diskIds: ['mac-data'] });
  await app.waitIdle();
  await app.refreshFda();
  const state = app.stateJSON();
  assert.equal(state.scan.status, 'done');
  assert.equal(state.platform, 'darwin');
  assert.equal(state.fullDiskAccess, 'missing');
  assert.ok(state.lastScanAt);
  assert.ok(state.scan.progress.files > 20);

  const junk = app.views.junkJSON();
  const names = (/** @type {string} */ id) => category(junk, id).items.map((/** @type {any} */ i) => i.name);
  assert.deepEqual(names('pkg-cache'), ['npm 缓存']);
  const chrome = category(junk, 'browser-cache').items[0];
  assert.equal(chrome.name, 'Chrome 缓存');
  assert.ok(chrome.tags.includes('in-use'), '正在运行的浏览器加 in-use 标签');
  assert.deepEqual(names('app-cache').sort(), ['Other', 'com.foo']);
  assert.deepEqual(names('logs'), ['用户日志和崩溃报告']);
  assert.deepEqual(names('temp').sort(), ['old.txt', 'olddir']);
  assert.deepEqual(names('installers'), ['old.dmg']);
  const ba = category(junk, 'build-artifacts').items;
  const projNm = ba.find((/** @type {any} */ i) => i.name === 'proj/node_modules');
  const appNm = ba.find((/** @type {any} */ i) => i.name === 'app/node_modules');
  assert.ok(projNm.selected, '90 天以上没改动的项目默认勾选');
  assert.match(projNm.note, /项目 1\d\d 天未改动/);
  assert.equal(appNm.selected, false, '最近改动的项目不勾');
  assert.ok(ba.some((/** @type {any} */ i) => i.name === 'py/__pycache__'));
  assert.deepEqual(names('python-venv'), ['py/.venv']);
  assert.deepEqual(names('large-old'), ['big.mov']);
  const dupCat = category(junk, 'duplicates');
  assert.equal(dupCat.totalBytes, 2 * MB);
  assert.equal(dupCat.itemCount, 1);
  const gm = category(junk, 'go-mod-cache').items[0];
  assert.ok(gm.locked, 'Go 模块缓存锁定');
  assert.equal(category(junk, 'go-mod-cache').selectable, false);
  assert.equal(category(junk, 'go-mod-cache').name, 'Go 模块缓存');
  assert.match(category(junk, 'go-mod-cache').effect, /go clean -modcache/, '提示用 go clean -modcache 清理');
  assert.match(gm.note, /go clean -modcache/);
  assert.match(gm.lockReason, /go clean -modcache/);
  assert.equal(category(junk, 'system-junk').action.id, 'mac-storage-settings');
  for (const id of ['temp', 'pkg-cache', 'browser-cache', 'logs', 'installers']) {
    assert.ok(category(junk, id).items.every((/** @type {any} */ i) => i.selected), `${id} 默认勾选`);
  }
  assert.ok(category(junk, 'app-cache').items.every((/** @type {any} */ i) => !i.selected), '需要确认的不勾');

  // 目录树
  const tree = app.views.treeJSON(null, null, null, '3');
  assert.equal(tree.node.name, 'Fixture HD');
  assert.equal(tree.node.locked, true);
  assert.equal(tree.node.lockReason, '磁盘根目录');
  const homeNode = tree.node.children.find((/** @type {any} */ c) => c.name === 'home');
  assert.equal(homeNode.lockReason, '用户主目录');
  const homeLevel = app.views.treeJSON(homeNode.id, null, null, '1');
  const proj2 = homeLevel.node.children.find((/** @type {any} */ c) => c.name === 'proj2');
  assert.ok(proj2.tags.includes('git'));
  assert.ok(homeLevel.node.children.length <= 61);
  assert.ok(homeNode.children.some((/** @type {any} */ c) => c.kind === 'others' && c.id === ''), '太小的深层子项合并成「其他小文件」');
  const sub = app.views.treeJSON(homeNode.id, null, null, '1');
  assert.deepEqual(sub.breadcrumbs.map((/** @type {any} */ b) => b.name), ['Fixture HD', 'home']);

  // 大文件、类型、无权限
  const large = app.views.largeJSON(new URLSearchParams('kind=video&minAgeDays=100'), Date.now());
  assert.equal(large.total, 1);
  assert.equal(large.items[0].kind, 'video');
  assert.equal(app.views.largeJSON(new URLSearchParams('minAgeDays=365'), Date.now()).total, 0);
  const types = app.views.typesJSON('mac-data').types;
  assert.equal(types[0].kind, 'video');
  assert.ok(types.some((/** @type {any} */ x) => x.kind === 'dev-cache'));

  // 重复文件：每组只保留最新的一份
  const dups = app.views.duplicatesJSON();
  assert.equal(dups.status, 'done');
  assert.equal(dups.groups.length, 1);
  await app.keepNewest();
  const afterKeep = app.views.duplicatesJSON().groups[0].files;
  const selDup = afterKeep.filter((/** @type {any} */ f) => f.selected);
  assert.equal(selDup.length, 1);
  assert.equal(path.basename(selDup[0].path), 'dup1.bin', '较旧的一份被勾选');

  // 已选清单只算外层：勾选 Google 目录（目录树节点），Chrome 条目已在清单里
  const lib = homeLevel.node.children.find((/** @type {any} */ c) => c.name === 'Library');
  const caches = app.views.treeJSON(lib.id, null, null, '1').node.children.find((/** @type {any} */ c) => c.name === 'Caches');
  const google = app.views.treeJSON(caches.id, null, null, '1').node.children.find((/** @type {any} */ c) => c.name === 'Google');
  const before = app.getSelection();
  const r = await app.updateSelection({ add: [google.id, gm.id, 'n_unknown'] });
  assert.deepEqual(r.skipped, [{ id: gm.id, reason: 'locked' }, { id: 'n_unknown', reason: 'unknown' }]);
  assert.equal(r.count, before.count + 1);
  const googleRel = /** @type {any} */ (app.views.resolve(google.id)).releasableBytes;
  assert.equal(r.bytes, before.bytes - chrome.releasableBytes + googleRel, '只算外层目录');
  assert.ok(logger.events.some((e) => e.msg === 'selection.add.skipped'));

  // 取消勾选后，同一次扫描里重新扫描也不会自动勾回
  await app.updateSelection({ remove: [google.id, chrome.id] });
  await app.startRescan({ id: caches.id });
  await app.waitIdle();
  const junk2 = app.views.junkJSON();
  const chrome2 = category(junk2, 'browser-cache').items[0];
  assert.equal(chrome2.name, 'Chrome 缓存');
  assert.equal(chrome2.selected, false, '用户取消勾选后不再自动勾回');
  assert.equal(app.stateJSON().scan.status, 'done');

  // 清理：一项成功、一项扫描后被修改
  const oldDmg = category(junk2, 'installers').items[0];
  const log = category(junk2, 'logs').items[0];
  await writeFile(path.join(fx.home, 'Library/Logs/b.log'), 'new');
  await app.updateSelection({ add: [oldDmg.id, log.id] });
  await assert.rejects(app.startClean({ itemIds: [appNm.id] }), (e) => /** @type {any} */ (e).code === 'not_selected');
  const homeBefore = app.views.treeJSON(homeNode.id, null, null, '1').node.sizeBytes;
  const { jobId } = await app.startClean({ itemIds: [oldDmg.id, log.id] });
  await app.waitIdle();
  const job = app.getClean(jobId);
  assert.equal(job.finished, true);
  const res = Object.fromEntries(job.results.map((/** @type {any} */ x) => [x.id, x]));
  assert.equal(res[oldDmg.id].ok, true);
  assert.equal(res[log.id].error, 'changed', '扫描后被修改的目录被拒绝');
  assert.equal(job.freedBytes, 400);
  assert.equal(remove.calls.length, 1);
  const junk3 = app.views.junkJSON();
  assert.equal(category(junk3, 'installers').items.length, 0, '清理成功的条目从结果里移除');
  assert.equal(app.views.treeJSON(homeNode.id, null, null, '1').node.sizeBytes, homeBefore - 400, '祖先目录扣减大小');
  assert.ok(!app.getSelection().items.some((/** @type {any} */ i) => i.id === oldDmg.id));
  const hist = app.history().entries;
  assert.equal(hist.length, 2);
  assert.ok(hist.some((/** @type {any} */ h) => h.ok && h.path.endsWith('old.dmg') && h.bytes === 400));

  // 问 Agent
  const ask = await app.askContext(projNm.id);
  assert.equal(ask.title, 'proj/node_modules');
  assert.ok(ask.prompt.includes(`\n路径：${JSON.stringify(path.join(fx.home, 'Downloads/proj/node_modules'))}\n`), '路径以 JSON 字符串放在数据段里');
  assert.ok(ask.prompt.includes('<<<条目信息\n') && ask.prompt.includes('\n条目信息>>>\n'));
  assert.ok(ask.prompt.includes('扫描分类：开发构建产物'));
  assert.ok(ask.prompt.includes('- "x.js"'));

  // 日志不含路径
  for (const e of logger.events) assert.ok(!JSON.stringify(e.fields || {}).includes(dir), `日志 ${e.msg} 不含路径`);
  assert.ok(logger.events.some((e) => e.msg === 'scan.started'));
  assert.ok(logger.events.some((e) => e.msg === 'scan.done'));
  assert.ok(logger.events.some((e) => e.msg === 'clean.item.skipped' && e.fields.code === 'changed'));

  // 持久化：新实例首次请求时加载
  await app.flush();
  await new Promise((r) => setTimeout(r, 400));
  await app.flush();
  const { app: app2 } = makeApp(dir, fx, remove);
  t.after(() => app2.dispose());
  await app2.ensureLoaded();
  const j2 = app2.views.junkJSON();
  assert.equal(j2.scannedAt, junk3.scannedAt);
  assert.equal(category(j2, 'temp').items.length, 2);
  assert.equal(app2.getSelection().count, app.getSelection().count);
  assert.equal(app2.history().entries.length, 2);
  assert.equal(app2.views.treeJSON(homeNode.id, null, null, '1').node.name, 'home', '目录树节点编号持久化');
  const files = await fsp.readdir(path.join(dir, 'data'));
  assert.deepEqual(files.sort(), ['history-v1.json', 'scan-v4.ndjson.gz', 'scope-v1.json', 'selection-v1.json', 'stats-v1.json']);
});

test('扫描中再次开始返回 409，未知磁盘返回 400，取消后状态为 cancelled', async (t) => {
  const dir = await makeTmp('app2');
  t.after(() => removeTmp(dir));
  const fx = await buildFixture(dir);
  for (let i = 0; i < 300; i += 1) await writeFile(path.join(fx.home, 'bulk', `d${i}`, 'f.txt'), 'x');
  const { app } = makeApp(dir, fx, fakeRemove());
  t.after(() => app.dispose());
  await assert.rejects(app.startScan({ diskIds: ['nope'] }), (e) => /** @type {any} */ (e).code === 'invalid_disk');
  await app.startScan({ diskIds: ['mac-data'] });
  await assert.rejects(app.startScan({}), (e) => /** @type {any} */ (e).code === 'scan_running');
  await assert.rejects(app.startClean({ itemIds: ['x'] }), (e) => /** @type {any} */ (e).code === 'scan_running');
  app.cancelScan();
  await app.waitIdle();
  const s = app.stateJSON().scan;
  assert.ok(s.status === 'cancelled' || s.status === 'done');
  await assert.rejects(app.systemAction({ action: 'win-disk-cleanup' }), (e) => /** @type {any} */ (e).code === 'invalid_action');
});
