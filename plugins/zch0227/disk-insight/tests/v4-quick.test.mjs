// @ts-check
// v4 快速扫描分批出结果：还在统计的位置先出现（computing），统计完一个更新一个，results 最多每秒推一次。
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../miniapp/node/app.mjs';
import { age, fakeExec, fakeLogger, fakeRemove, makeTmp, removeTmp, writeFile } from './helpers.mjs';

/** @param {any} st */
const sizeOf = (st) => (st.isDirectory() ? 0 : st.size);
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {() => boolean} fn @param {number} [ms] */
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(20);
  }
  throw new Error('waitFor timeout');
}

function gate() {
  /** @type {() => void} */
  let open = () => undefined;
  const p = new Promise((r) => {
    open = () => r(undefined);
  });
  return { p, open };
}

/** @param {string} dir */
async function fixture(dir) {
  await fsp.mkdir(path.join(dir, 'disk'), { recursive: true });
  const disk = await fsp.realpath(path.join(dir, 'disk'));
  const home = path.join(disk, 'home');
  const w = (/** @type {string} */ rel, /** @type {any} */ c) => writeFile(path.join(home, rel), c);
  await w('.npm/_cacache/a', Buffer.alloc(500));
  await w('.npm/_npx/b', Buffer.alloc(300));
  await w('.cache/uv/top.bin', Buffer.alloc(1000));
  await w('.cache/uv/sub/s.bin', Buffer.alloc(2000));
  await w('.cache/pip/p', Buffer.alloc(100));
  await w('.cache/pnpm/q', Buffer.alloc(100));
  await w('.gradle/caches/g', Buffer.alloc(100));
  await w('.m2/repository/m', Buffer.alloc(100));
  await w('Library/Logs/l.log', Buffer.alloc(100));
  await w('Library/Caches/com.foo/x', Buffer.alloc(100));
  await w('Downloads/old.dmg', Buffer.alloc(400));
  await age(path.join(home, 'Downloads/old.dmg'), 40);
  const disks = [{ id: 'a', label: 'Disk A', mount: disk, totalBytes: 1e12, usedBytes: 5e9, freeBytes: 9e11, kind: 'internal', defaultScan: true, deletable: true }];
  return { disk, home, disks };
}

/**
 * 遍历时按路径延迟或卡住 opendir，模拟有的位置很慢。
 * @param {Map<string, number>} delays @param {Map<string, Promise<any>>} gates
 */
function slowFs(delays, gates) {
  return {
    ...fsp,
    /** @param {string} p @param {any} o */
    async opendir(p, o) {
      const g = gates.get(p);
      if (g) await g;
      const d = delays.get(p);
      if (d) await sleep(d);
      return fsp.opendir(p, o);
    },
  };
}

/** @param {string} dir @param {any} fx @param {any} fs */
function makeApp(dir, fx, fs) {
  const logger = fakeLogger();
  const app = createApp({
    platform: 'darwin',
    env: {},
    home: fx.home,
    tmpdir: path.join(fx.disk, 'tmp'),
    fs,
    exec: fakeExec(),
    dataDir: path.join(dir, 'data'),
    logger,
    disks: async () => fx.disks,
    remove: fakeRemove(),
    fullDiskAccess: async () => 'granted',
    runningApps: async () => new Set(),
    goModCache: async () => null,
    sizeOf,
    concurrency: 8,
  });
  return { app, logger };
}

/** @param {any} junk @param {string} id */
const cat = (junk, id) => junk.tiers.flatMap((/** @type {any} */ t) => t.categories).find((/** @type {any} */ c) => c.id === id);

test('快速扫描分批：computing 条目和分类、当前已统计的大小、每秒最多推一次、结束后没有 computing', async (t) => {
  const dir = await makeTmp('v4-quick');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const h = (/** @type {string} */ rel) => path.join(fx.home, rel);
  // 其余位置依次在 0～1.2 秒里完成；uv 的子目录和 Downloads 卡住，等测试放行。
  const delays = new Map([
    [h('.npm/_npx'), 150],
    [h('.cache/pip'), 300],
    [h('.cache/pnpm'), 450],
    [h('.gradle/caches'), 600],
    [h('.m2/repository'), 750],
    [h('Library/Logs'), 900],
    [h('Library/Caches'), 1050],
  ]);
  const uvGate = gate();
  const dlGate = gate();
  const gates = new Map([
    [h('.cache/uv/sub'), uvGate.p],
    [h('Downloads'), dlGate.p],
  ]);
  const { app, logger } = makeApp(dir, fx, slowFs(delays, gates));
  t.after(() => {
    uvGate.open();
    dlGate.open();
    return app.dispose();
  });
  /** @type {{ kinds: string[], at: number }[]} */
  const pushes = [];
  const broadcast = app.hub.broadcast.bind(app.hub);
  app.hub.broadcast = (ev, data) => {
    if (ev === 'results') pushes.push({ kinds: data.kinds, at: Date.now() });
    broadcast(ev, data);
  };

  await app.startScan({ paths: [fx.home] });
  // 先出现：uv 还在统计（只算到了 top.bin），npm 已经统计完
  await waitFor(() => {
    const pkg = cat(app.views.junkJSON(), 'pkg-cache');
    const npm = pkg && pkg.items.find((/** @type {any} */ i) => i.name === 'npm 缓存');
    return !!npm && !npm.computing;
  });
  let junk = app.views.junkJSON();
  const pkg = cat(junk, 'pkg-cache');
  const uv = pkg.items.find((/** @type {any} */ i) => i.name === 'uv 缓存');
  assert.equal(app.stateJSON().scan.phase, 'quick');
  assert.equal(pkg.computing, true, '分类里还有条目在统计');
  assert.equal(uv.computing, true);
  assert.equal(uv.sizeBytes, 1000, 'sizeBytes 是当前已统计的部分');
  assert.equal(uv.releasableBytes, 1000);
  assert.equal(cat(junk, 'installers').computing, true, 'Downloads 还没统计完');
  assert.equal(cat(junk, 'installers').items.length, 0);
  assert.equal(cat(junk, 'trash').computing, undefined, '没有统计中的分类不带 computing');
  assert.ok(logger.events.some((e) => e.msg === 'scan.quick.first_results' && typeof e.fields.ms === 'number'));

  // 等其余位置都完成，再放行 Downloads
  await waitFor(() => !!cat(app.views.junkJSON(), 'logs').items.length && cat(app.views.junkJSON(), 'app-cache').computing === undefined);
  dlGate.open();
  await waitFor(() => cat(app.views.junkJSON(), 'installers').computing === undefined);
  junk = app.views.junkJSON();
  assert.deepEqual(cat(junk, 'installers').items.map((/** @type {any} */ i) => i.name), ['old.dmg']);
  assert.equal(cat(junk, 'pkg-cache').computing, true, 'uv 还在统计');
  await sleep(1200);
  uvGate.open();
  await app.waitIdle();

  junk = app.views.junkJSON();
  assert.ok(!JSON.stringify(junk).includes('"computing"'), '统计完成后去掉标记');
  const uvDone = cat(junk, 'pkg-cache').items.find((/** @type {any} */ i) => i.name === 'uv 缓存');
  assert.equal(uvDone.sizeBytes, 3000);
  assert.equal(uvDone.selected, true, '统计完成后照常默认勾选');
  const npmDone = cat(junk, 'pkg-cache').items.find((/** @type {any} */ i) => i.name === 'npm 缓存');
  assert.equal(npmDone.selected, true);

  // results 推送：快速扫描开始时一次（显示统计中的位置），之后统计完就推，但间隔不小于 1 秒
  const quick = pushes.filter((p) => p.kinds.join() === 'junk,large');
  assert.ok(quick.length >= 3, `快速扫描期间分批推送，实际 ${quick.length} 次`);
  for (let i = 2; i < quick.length; i += 1) assert.ok(quick[i].at - quick[i - 1].at >= 950, `第 ${i} 次推送间隔 ${quick[i].at - quick[i - 1].at} ms`);
  assert.ok(pushes.some((p) => p.kinds.includes('types') && p.kinds.includes('denied')), '快速扫描结束照常推送');
});

test('快速扫描中途取消：没有 computing 残留，已统计的部分保留', async (t) => {
  const dir = await makeTmp('v4-quick-cancel');
  t.after(() => removeTmp(dir));
  const fx = await fixture(dir);
  const uvGate = gate();
  const { app } = makeApp(dir, fx, slowFs(new Map(), new Map([[path.join(fx.home, '.cache/uv/sub'), uvGate.p]])));
  t.after(() => {
    uvGate.open();
    return app.dispose();
  });
  await app.startScan({ paths: [fx.home] });
  await waitFor(() => {
    const pkg = cat(app.views.junkJSON(), 'pkg-cache');
    return !!pkg && pkg.items.some((/** @type {any} */ i) => i.name === 'npm 缓存' && !i.computing);
  });
  app.cancelScan();
  uvGate.open();
  await app.waitIdle();
  assert.equal(app.stateJSON().scan.status, 'cancelled');
  const junk = app.views.junkJSON();
  assert.ok(!JSON.stringify(junk).includes('"computing"'));
  const uv = cat(junk, 'pkg-cache').items.find((/** @type {any} */ i) => i.name === 'uv 缓存');
  assert.ok(!uv || uv.sizeBytes <= 3000);
});
