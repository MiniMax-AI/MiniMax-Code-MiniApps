// @ts-check
// v3：文件夹扫描范围、路径校验、搜索和排序、忽略名单、清理统计、选择文件夹、快速预览。
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../miniapp/node/app.mjs';
import { normalizeUserPath } from '../miniapp/node/scope.mjs';
import { MB, createPathOps } from '../miniapp/node/util.mjs';
import { age, fakeExec, fakeLogger, fakeRemove, makeTmp, removeTmp, sparseFile, writeFile } from './helpers.mjs';

/** @param {string} dir */
async function fixture(dir) {
  const disk = await fsp.realpath(await fsp.mkdir(path.join(dir, 'disk'), { recursive: true }).then(() => path.join(dir, 'disk')));
  const ext = path.join(dir, 'ext');
  const home = path.join(disk, 'home');
  const w = (/** @type {string} */ rel, /** @type {any} */ c = 'x') => writeFile(path.join(home, rel), c);
  await w('.npm/_cacache/content/a', Buffer.alloc(500));
  await w('work/proj/package.json', '{}');
  await w('work/proj/node_modules/x.js', Buffer.alloc(800));
  await age(path.join(home, 'work/proj/package.json'), 120);
  await w('work/notes.txt', 'n');
  await w('Downloads/a.dmg', Buffer.alloc(100));
  await age(path.join(home, 'Downloads/a.dmg'), 40);
  await w('Downloads/b.zip', Buffer.alloc(300));
  await age(path.join(home, 'Downloads/b.zip'), 60);
  await w('Downloads/zz.iso', Buffer.alloc(200));
  await age(path.join(home, 'Downloads/zz.iso'), 35);
  await sparseFile(path.join(home, 'Movies/x.mov'), 600 * MB);
  await sparseFile(path.join(home, 'Movies/y.iso'), 700 * MB);
  await age(path.join(home, 'Movies/y.iso'), 300);
  const dup = randomBytes(2 * MB);
  await w('Pictures/d1.bin', dup);
  await w('Pictures/d2.bin', dup);
  await w('go/pkg/mod/m.go', 'package m');
  await writeFile(path.join(ext, 'backup', 'f.txt'), 'f');
  const disks = [
    { id: 'a', label: 'Disk A', mount: disk, totalBytes: 1e12, usedBytes: 5e9, freeBytes: 9e11, kind: 'internal', defaultScan: true, deletable: true },
    { id: 'b', label: 'Ext', mount: ext, totalBytes: 1e12, usedBytes: 1e9, freeBytes: 9e11, kind: 'external', defaultScan: false, deletable: false },
  ];
  return { disk, ext, home, disks };
}

/** @param {string} dir @param {any} fx @param {any} [extra] */
function makeApp(dir, fx, extra = {}) {
  const exec = fakeExec();
  const app = createApp({
    platform: 'darwin',
    env: {},
    home: fx.home,
    tmpdir: path.join(fx.disk, 'tmp'),
    fs: fsp,
    exec,
    dataDir: path.join(dir, 'data'),
    logger: fakeLogger(),
    disks: async () => fx.disks,
    remove: fakeRemove(),
    fullDiskAccess: async () => 'granted',
    runningApps: async () => new Set(),
    goModCache: async () => path.join(fx.home, 'go', 'pkg', 'mod'),
    sizeOf: (st) => st.size,
    ...extra,
  });
  return { app, exec };
}

/** @param {() => any} fn @param {string} code */
const rejectsCode = (fn, code) => assert.rejects(Promise.resolve().then(fn), (e) => /** @type {any} */ (e).code === code);
/** @param {any} junk @param {string} id */
const cat = (junk, id) => junk.tiers.flatMap((/** @type {any} */ t) => t.categories).find((/** @type {any} */ c) => c.id === id);

test('文件夹扫描范围：roots、rootId、只统计文件夹里的规则位置、unscannedBytes 为 0、去重和合并', async (t) => {
  const dir = await makeTmp('v3-scope');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const { app } = makeApp(dir, fx);
  t.after(() => app.dispose());
  const work = path.join(fx.home, 'work');

  await app.startScan({ paths: [`${work}/`] });
  await app.waitIdle();
  await app.refreshPlaces();
  const s = app.stateJSON();
  assert.deepEqual(s.roots, [{ id: 'r_1', kind: 'folder', label: 'work', path: work, diskId: 'a' }]);
  assert.deepEqual(s.scan.paths, [work]);
  assert.deepEqual(s.scan.diskIds, []);
  assert.ok(s.disks.every((d) => d.unscannedBytes === 0), '只扫文件夹时不计算未扫描部分');
  assert.equal(s.unscanned.bytes, 0);
  assert.deepEqual(s.places.map((p) => p.id), ['home', 'downloads'], '常用位置只列存在的目录');
  const junk = app.views.junkJSON();
  assert.equal(cat(junk, 'pkg-cache').itemCount, 0, '文件夹外的规则位置不统计');
  assert.equal(cat(junk, 'installers').itemCount, 0);
  assert.equal(cat(junk, 'build-artifacts').items[0].name, 'proj/node_modules');
  const tree = app.views.treeJSON(null, null, null, '1');
  assert.equal(tree.node.name, 'work');
  assert.equal(app.views.treeJSON(null, 'r_1', null, '1').node.name, 'work');
  await rejectsCode(() => app.views.treeJSON(null, 'r_9', null, '1'), 'root_not_found');
  await rejectsCode(() => app.views.treeJSON(null, null, 'a', '1'), 'disk_not_scanned');
  assert.ok(app.views.typesJSON(null, 'r_1').types.length > 0);
  await rejectsCode(() => app.views.typesJSON(null, 'r_9'), 'root_not_found');

  // 文件夹位于所选磁盘之内时按磁盘处理
  await app.startScan({ diskIds: ['a'], paths: [work] });
  await app.waitIdle();
  assert.deepEqual(app.stateJSON().roots.map((r) => r.kind), ['disk']);
  assert.ok(app.stateJSON().disks.find((d) => d.id === 'a')?.unscannedBytes > 0, '扫描整个磁盘时才计算未扫描部分');

  // 嵌套文件夹只留外层；外层包含的规则位置照常统计
  await app.startScan({ paths: [work, fx.home] });
  await app.waitIdle();
  assert.deepEqual(app.stateJSON().roots.map((r) => r.path), [fx.home]);
  assert.equal(cat(app.views.junkJSON(), 'pkg-cache').itemCount, 1);

  // 文件夹本身就是规则位置
  await app.startScan({ paths: [path.join(fx.home, '.npm', '_cacache')] });
  await app.waitIdle();
  assert.equal(app.views.treeJSON(null, null, null, '1').node.name, '_cacache');
  assert.equal(cat(app.views.junkJSON(), 'pkg-cache').itemCount, 1);

  // 外接盘上的文件夹只扫描、不删除
  await app.startScan({ paths: [path.join(fx.ext, 'backup')] });
  await app.waitIdle();
  assert.equal(app.stateJSON().roots[0].diskId, 'b');

  await rejectsCode(() => app.startScan({ paths: Array.from({ length: 21 }, () => work) }), 'invalid_path');
  await rejectsCode(() => app.startScan({ paths: ['relative/dir'] }), 'invalid_path');
  await rejectsCode(() => app.startScan({ paths: [path.join(work, 'notes.txt')] }), 'invalid_path');
  await rejectsCode(() => app.startScan({ paths: 'x' }), 'invalid_path');
});

test('路径校验：每个错误码、~ 展开、去掉末尾斜杠、Windows 盘符大写', async (t) => {
  const dir = await makeTmp('v3-validate');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const { app } = makeApp(dir, fx);
  t.after(() => app.dispose());
  await rejectsCode(() => app.validatePath({ path: 'relative/x' }), 'not_absolute');
  await rejectsCode(() => app.validatePath({ path: '' }), 'not_absolute');
  await rejectsCode(() => app.validatePath({ path: 42 }), 'not_absolute');
  await rejectsCode(() => app.validatePath({ path: path.join(fx.home, 'nope') }), 'not_found');
  await rejectsCode(() => app.validatePath({ path: path.join(fx.home, 'work', 'notes.txt') }), 'not_dir');
  await rejectsCode(() => app.validatePath({ path: dir }), 'unknown_disk');
  assert.deepEqual(await app.validatePath({ path: '~' }), { path: fx.home, diskId: 'a', deletable: true });
  assert.deepEqual(await app.validatePath({ path: `${fx.home}/work/` }), { path: path.join(fx.home, 'work'), diskId: 'a', deletable: true });
  assert.deepEqual(await app.validatePath({ path: '~/work' }), { path: path.join(fx.home, 'work'), diskId: 'a', deletable: true });
  assert.deepEqual(await app.validatePath({ path: path.join(fx.ext, 'backup') }), { path: path.join(fx.ext, 'backup'), diskId: 'b', deletable: false });
  const w = createPathOps('win32');
  assert.equal(normalizeUserPath('c:\\users\\a\\', w, 'C:\\Users\\a'), 'C:\\users\\a');
  assert.equal(normalizeUserPath('d:/data/x/', w, 'C:\\Users\\a'), 'D:\\data\\x');
  assert.equal(normalizeUserPath('~\\Docs', w, 'C:\\Users\\a'), 'C:\\Users\\a\\Docs');
  assert.equal(normalizeUserPath('c:', w, 'C:\\Users\\a'), null, '没有反斜杠的盘符不算绝对路径');
  assert.equal(normalizeUserPath('data\\x', w, 'C:\\Users\\a'), null);
});

test('搜索和排序：在全部条目里搜索，matchedFrom，没有匹配的分类不返回', async (t) => {
  const dir = await makeTmp('v3-search');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const { app } = makeApp(dir, fx);
  t.after(() => app.dispose());
  await app.startScan({ diskIds: ['a'] });
  await app.waitIdle();
  const names = (/** @type {any} */ c) => c.items.map((/** @type {any} */ i) => i.name);
  assert.deepEqual(names(cat(app.views.junkJSON(), 'installers')), ['b.zip', 'zz.iso', 'a.dmg'], '默认按大小从大到小');
  assert.deepEqual(names(cat(app.views.junkJSON(new URLSearchParams('sort=name')), 'installers')), ['a.dmg', 'b.zip', 'zz.iso']);
  assert.deepEqual(names(cat(app.views.junkJSON(new URLSearchParams('sort=mtime')), 'installers')), ['b.zip', 'a.dmg', 'zz.iso'], '从旧到新');
  const q = app.views.junkJSON(new URLSearchParams('q=ZIP'));
  const inst = cat(q, 'installers');
  assert.deepEqual(names(inst), ['b.zip'], '不区分大小写');
  assert.equal(inst.itemCount, 1);
  assert.equal(inst.matchedFrom, 3);
  assert.equal(inst.totalBytes, 300);
  assert.equal(cat(q, 'pkg-cache'), undefined, '没有匹配条目的分类不返回');
  assert.equal(cat(app.views.junkJSON(), 'installers').matchedFrom, undefined, '不带 q 时没有 matchedFrom');
  assert.ok(cat(app.views.junkJSON(new URLSearchParams(`q=${encodeURIComponent('/Downloads/')}`)), 'installers'), '也匹配路径');
  const large = app.views.largeJSON(new URLSearchParams('q=y.iso'), Date.now());
  assert.equal(large.total, 1);
  assert.deepEqual(app.views.largeJSON(new URLSearchParams('sort=name'), Date.now()).items.map((/** @type {any} */ i) => i.name), ['x.mov', 'y.iso']);
  assert.deepEqual(app.views.largeJSON(new URLSearchParams('sort=mtime'), Date.now()).items.map((/** @type {any} */ i) => i.name), ['y.iso', 'x.mov']);
  await rejectsCode(() => app.views.junkJSON(new URLSearchParams('sort=bad')), 'bad_request');
  await rejectsCode(() => app.views.largeJSON(new URLSearchParams('sort=bad'), Date.now()), 'bad_request');
});

test('忽略名单：从结果和已选清单里移除、恢复、持久化，下次扫描不再默认勾选', async (t) => {
  const dir = await makeTmp('v3-ignore');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const { app } = makeApp(dir, fx);
  t.after(() => app.dispose());
  await app.startScan({ diskIds: ['a'] });
  await app.waitIdle();
  const bzip = cat(app.views.junkJSON(), 'installers').items.find((/** @type {any} */ i) => i.name === 'b.zip');
  assert.equal(bzip.selected, true);
  const before = app.getSelection().count;
  assert.deepEqual(await app.addIgnore({ id: bzip.id }), { ok: true });
  assert.equal(cat(app.views.junkJSON(), 'installers').items.some((/** @type {any} */ i) => i.name === 'b.zip'), false, '从垃圾清理里移除');
  assert.equal(app.getSelection().count, before - 1, '从已选清单里移除');
  const list = (await app.listIgnore()).entries;
  assert.equal(list.length, 1);
  assert.equal(list[0].path, path.join(fx.home, 'Downloads', 'b.zip'));
  assert.ok(list[0].id.startsWith('g_') && list[0].at > 0);

  // 忽略一个目录：里面的大文件和重复文件都不再出现，空间地图照常统计
  const homeNode = app.views.treeJSON(null, null, null, '1').node.children.find((/** @type {any} */ c) => c.name === 'home');
  const homeKids = app.views.treeJSON(homeNode.id, null, null, '1').node.children;
  const movies = homeKids.find((/** @type {any} */ c) => c.name === 'Movies');
  const pictures = homeKids.find((/** @type {any} */ c) => c.name === 'Pictures');
  await rejectsCode(() => app.addIgnore({ id: movies.id }), 'not_ignorable');
  const largeBefore = app.views.largeJSON(new URLSearchParams(), Date.now()).total;
  const mov = app.views.largeJSON(new URLSearchParams('q=x.mov'), Date.now()).items[0];
  await app.addIgnore({ id: mov.id });
  assert.equal(app.views.largeJSON(new URLSearchParams(), Date.now()).total, largeBefore - 1, '大文件里移除');
  assert.equal(app.views.duplicatesJSON().groups.length, 1);
  await rejectsCode(() => app.addIgnore({ id: pictures.id }), 'not_ignorable');
  const dupFile = app.views.duplicatesJSON().groups[0].files[0];
  await app.addIgnore({ id: dupFile.id });
  assert.equal(app.views.duplicatesJSON().groups.length, 0, '只剩一份的分组不再显示');
  assert.equal(cat(app.views.junkJSON(), 'duplicates').totalBytes, 0);
  assert.ok(app.views.treeJSON(homeNode.id, null, null, '1').node.sizeBytes >= 600 * MB, '空间地图照常统计');

  // 锁定和只提示的条目不能忽略
  const gm = cat(app.views.junkJSON(), 'go-mod-cache').items[0];
  await rejectsCode(() => app.addIgnore({ id: gm.id }), 'not_ignorable');
  await rejectsCode(() => app.addIgnore({ id: 'i_nope' }), 'not_found');

  // 持久化：新实例读到同一份名单；下次扫描时被忽略的条目不再默认勾选
  await app.flush();
  const { app: app2 } = makeApp(dir, fx);
  t.after(() => app2.dispose());
  await app2.ensureLoaded();
  assert.equal((await app2.listIgnore()).entries.length, 3);
  await app2.startScan({ diskIds: ['a'] });
  await app2.waitIdle();
  assert.equal(cat(app2.views.junkJSON(), 'installers').itemCount, 2);
  const hidden = /** @type {any} */ ([...(/** @type {any} */ (app2.getModel())).items.values()].find((it) => it.name === 'b.zip'));
  assert.equal(app2.views.itemJSON(app2.views.entityFromItem(hidden)).selected, false, '忽略的条目不再默认勾选');
  await app2.updateSelection({ addCategories: ['installers'] });
  assert.equal(app2.views.itemJSON(app2.views.entityFromItem(hidden)).selected, false, '按分类勾选也跳过忽略的条目');

  // 恢复
  const entry = (await app2.listIgnore()).entries.find((e) => e.path.endsWith('b.zip'));
  assert.deepEqual(await app2.removeIgnore({ id: entry?.id }), { ok: true });
  assert.equal(cat(app2.views.junkJSON(), 'installers').itemCount, 3);
  await rejectsCode(() => app2.removeIgnore({ id: 'g_999' }), 'not_found');
  await app2.flush();
  const saved = JSON.parse(await fsp.readFile(path.join(dir, 'data', 'ignore-v1.json'), 'utf8'));
  assert.equal(saved.version, 1);
  assert.equal(saved.entries.length, 2);
});

test('清理统计：每次清理任务结束后累计，持久化，重新扫描不清零', async (t) => {
  const dir = await makeTmp('v3-stats');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const { app } = makeApp(dir, fx);
  t.after(() => app.dispose());
  await app.ensureLoaded();
  assert.deepEqual(app.stateJSON().stats, { last: null, totalFreedBytes: 0, cleanCount: 0 });
  await app.startScan({ diskIds: ['a'] });
  await app.waitIdle();
  const inst = cat(app.views.junkJSON(), 'installers').items;
  const zz = inst.find((/** @type {any} */ i) => i.name === 'zz.iso');
  const ad = inst.find((/** @type {any} */ i) => i.name === 'a.dmg');
  await app.startClean({ itemIds: [zz.id] });
  await app.waitIdle();
  const s1 = app.stateJSON().stats;
  assert.equal(s1.cleanCount, 1);
  assert.equal(s1.totalFreedBytes, 200);
  assert.deepEqual({ ...s1.last, at: 0 }, { at: 0, freedBytes: 200, okCount: 1, failedCount: 0 });
  await fsp.writeFile(path.join(fx.home, 'Downloads', 'a.dmg'), 'changed');
  await app.startClean({ itemIds: [ad.id] });
  await app.waitIdle();
  const s2 = app.stateJSON().stats;
  assert.equal(s2.cleanCount, 2);
  assert.equal(s2.totalFreedBytes, 200);
  assert.deepEqual({ ...s2.last, at: 0 }, { at: 0, freedBytes: 0, okCount: 0, failedCount: 1 });
  await app.startScan({ diskIds: ['a'] });
  await app.waitIdle();
  assert.equal(app.stateJSON().stats.cleanCount, 2, '重新扫描不清零');
  await app.flush();
  const { app: app2 } = makeApp(dir, fx);
  t.after(() => app2.dispose());
  await app2.ensureLoaded();
  assert.deepEqual(app2.stateJSON().stats, s2);
});

test('选择文件夹和快速预览：用假执行器，不弹出真实窗口', async (t) => {
  const dir = await makeTmp('v3-picker');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  /** @type {(v: any) => void} */
  let release = () => {};
  let next = /** @type {any} */ ({ path: '/Users/x/code/' });
  const pickFolder = async () => {
    if (next === 'wait') return new Promise((r) => (release = r));
    return next;
  };
  const { app, exec } = makeApp(dir, fx, { pickFolder });
  t.after(() => app.dispose());
  assert.deepEqual(await app.pickFolder(), { path: '/Users/x/code' }, '去掉末尾斜杠');
  next = { cancelled: true };
  assert.deepEqual(await app.pickFolder(), { cancelled: true });
  next = null;
  await rejectsCode(() => app.pickFolder(), 'picker_unavailable');
  next = 'wait';
  const first = app.pickFolder();
  await rejectsCode(() => app.pickFolder(), 'picker_open');
  release({ cancelled: true });
  assert.deepEqual(await first, { cancelled: true });

  await app.startScan({ diskIds: ['a'] });
  await app.waitIdle();
  const file = app.views.largeJSON(new URLSearchParams('q=x.mov'), Date.now()).items[0];
  assert.deepEqual(await app.preview({ id: file.id }), { ok: true });
  assert.deepEqual(exec.calls.at(-1), { cmd: '/usr/bin/qlmanage', args: ['-p', file.path] });
  const homeNode = app.views.treeJSON(null, null, null, '1').node.children.find((/** @type {any} */ c) => c.name === 'home');
  await rejectsCode(() => app.preview({ id: homeNode.id }), 'not_file');
  await rejectsCode(() => app.preview({ id: 'i_nope' }), 'not_found');
  const { app: winApp } = makeApp(path.join(dir, 'w'), fx, { platform: 'win32' });
  t.after(() => winApp.dispose());
  await rejectsCode(() => winApp.preview({ id: file.id }), 'unsupported');
});

test('扫描范围必须显式选择：都为空返回 scope_required；lastScope 记录上一次实际开始扫描的范围并持久化', async (t) => {
  const dir = await makeTmp('v3-scope-required');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const { app } = makeApp(dir, fx);
  t.after(() => app.dispose());
  const work = path.join(fx.home, 'work');
  await app.ensureLoaded();
  assert.equal(app.stateJSON().lastScope, null, '从来没有扫描过时为 null');
  for (const body of [{}, { diskIds: [], paths: [] }, { diskIds: null }, { paths: [] }, { diskIds: [] }]) {
    await rejectsCode(() => app.startScan(body), 'scope_required');
  }
  await rejectsCode(() => app.startScan({ paths: ['relative'] }), 'invalid_path');
  await rejectsCode(() => app.startScan({ diskIds: ['zzz'] }), 'invalid_disk');
  assert.equal(app.stateJSON().lastScope, null, '没有开始的扫描不记录');

  await app.startScan({ diskIds: ['a'], paths: [work] });
  assert.deepEqual(app.stateJSON().lastScope, { diskIds: ['a'], paths: [] }, '记录实际扫描的范围（磁盘里的文件夹按磁盘处理）');
  await app.waitIdle();
  await app.startScan({ paths: [`${work}/`] });
  await app.waitIdle();
  assert.deepEqual(app.stateJSON().lastScope, { diskIds: [], paths: [work] }, '路径是规范化后的');

  await app.flush();
  const { app: app2 } = makeApp(dir, fx);
  t.after(() => app2.dispose());
  await app2.ensureLoaded();
  assert.deepEqual(app2.stateJSON().lastScope, { diskIds: [], paths: [work] }, '持久保存');
  const saved = JSON.parse(await fsp.readFile(path.join(dir, 'data', 'scope-v1.json'), 'utf8'));
  assert.equal(saved.version, 1);
});

test('tree 返回 rootId；junk、large、duplicates 的条目带 entryKind，大文件的 kind 仍是文件类型', async (t) => {
  const dir = await makeTmp('v3-entry');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const { app } = makeApp(dir, fx);
  t.after(() => app.dispose());

  await app.startScan({ diskIds: ['a'] });
  await app.waitIdle();
  const junk = app.views.junkJSON();
  assert.deepEqual(cat(junk, 'pkg-cache').items.map((/** @type {any} */ i) => i.entryKind), ['dir']);
  assert.deepEqual(cat(junk, 'build-artifacts').items.map((/** @type {any} */ i) => i.entryKind), ['dir']);
  const inst = cat(junk, 'installers').items;
  assert.ok(inst.length >= 2 && inst.every((/** @type {any} */ i) => i.entryKind === 'file'));
  const large = app.views.largeJSON(new URLSearchParams(), Date.now()).items;
  const kinds = Object.fromEntries(large.map((i) => [i.name, [i.entryKind, i.kind]]));
  assert.deepEqual(kinds['x.mov'], ['file', 'video'], 'kind 仍然表示文件类型');
  assert.deepEqual(kinds['y.iso'], ['file', 'disk-image']);
  const dups = app.views.duplicatesJSON().groups;
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0].files.map((/** @type {any} */ f) => f.entryKind), ['file', 'file']);
  assert.ok(app.getSelection().items.every((/** @type {any} */ i) => i.entryKind === 'dir' || i.entryKind === 'file'));

  // 磁盘扫描：默认、按 diskId、按条目编号都返回磁盘对应的扫描根
  const diskRoot = app.stateJSON().roots[0].id;
  const t0 = app.views.treeJSON(null, null, null, '1');
  assert.equal(t0.rootId, diskRoot);
  assert.equal(app.views.treeJSON(null, null, 'a', '1').rootId, diskRoot);
  const homeNode = t0.node.children.find((/** @type {any} */ c) => c.name === 'home');
  assert.equal(app.views.treeJSON(homeNode.id, null, null, '1').rootId, diskRoot);

  // 已选清单的 source：junk（带 categoryId）> worktree > large > duplicates > manual
  const byLarge = Object.fromEntries(large.map((i) => [i.name, i]));
  const npm = cat(junk, 'pkg-cache').items[0];
  const workNode = app.views.treeJSON(homeNode.id, null, null, '1').node.children.find((/** @type {any} */ c) => c.name === 'work');
  await app.updateSelection({ clear: true });
  const added = await app.updateSelection({ add: [npm.id, byLarge['x.mov'].id, byLarge['y.iso'].id, dups[0].files[0].id, workNode.id] });
  assert.equal(/** @type {any} */ (added).skipped, undefined);
  const src = Object.fromEntries(app.getSelection().items.map((/** @type {any} */ i) => [i.name, i.source]));
  assert.deepEqual(src, {
    'npm 缓存': { type: 'junk', categoryId: 'pkg-cache' },
    'x.mov': { type: 'large' },
    'y.iso': { type: 'junk', categoryId: 'large-old' },
    [dups[0].files[0].name]: { type: 'duplicates' },
    work: { type: 'manual' },
  });

  // 两个文件夹：按 rootId 取、按里面的条目编号取，都返回它所属的扫描根
  await app.startScan({ paths: [path.join(fx.home, 'work'), path.join(fx.home, 'Movies')] });
  await app.waitIdle();
  const roots = app.stateJSON().roots;
  const rw = roots.find((r) => r.label === 'work');
  const rm = roots.find((r) => r.label === 'Movies');
  assert.ok(rw && rm && rw.id !== rm.id);
  assert.equal(app.views.treeJSON(null, null, null, '1').rootId, roots[0].id);
  assert.equal(app.views.treeJSON(null, rw.id, null, '1').rootId, rw.id);
  const tm = app.views.treeJSON(null, rm.id, null, '1');
  assert.equal(tm.rootId, rm.id);
  const mov = tm.node.children.find((/** @type {any} */ c) => c.name === 'x.mov');
  assert.equal(app.views.treeJSON(mov.id, null, null, '1').rootId, rm.id);
  const movItem = app.views.largeJSON(new URLSearchParams('q=x.mov'), Date.now()).items[0];
  assert.equal(app.views.treeJSON(movItem.id, null, null, '1').rootId, rm.id, '规则条目编号同样能取到扫描根');
});
