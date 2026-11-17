// @ts-check
/**
 * 「她知道 MCode 在干什么」（`petAware`）的行为场景 —— **判断的唯一实现**。
 *
 * ⚠️ **为什么单独放一个模块**：同一个判断不许写在两个地方（改了这边忘了那边，
 *   两边的结论就会打架）。于是：
 *   - 随包发布的 `tests/petaware-default-off.test.mjs` 用它跑 `node --test`；
 *   - 我们自己的自检（`miniapp/node/selftest.mjs` 第五十一轮）也用它。
 *   两边跑的是**同一份实现**，不会各说各话。
 *
 * 判的是**装配后的行为**：真起一套 server ＋ 模拟宿主，数 API 的**调用次数** ——
 * 不是读源码字面量。
 *
 * 覆盖评审（上游 issue #136）点名的三组：**首次启动**、**切换开关**、**重启**。
 */

import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 包根目录（本文件在 `<包根>/tests/` 下）*/
export const PACKAGE_ROOT = join(HERE, '..');
const NODE_DIR = join(PACKAGE_ROOT, 'miniapp', 'node');

const { start } = await import(pathToFileURL(join(NODE_DIR, 'server.mjs')).href);
const { PetState } = await import(pathToFileURL(join(NODE_DIR, 'state.mjs')).href);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 本次跑出来的临时目录与 server —— 跑完必须清掉，不在 %TEMP% 留垃圾。 */
const tempDirs = [];
const liveServers = [];

async function makeTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** 释放 server + 清临时目录（失败也不该拦住结论）。 */
async function cleanup() {
  while (liveServers.length) {
    const life = liveServers.pop();
    try {
      await life.dispose();
    } catch {
      // 释放失败不影响结论。
    }
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响结论。
    }
  }
}

/**
 * 假的 Agent：只记调用次数与订阅的 signal。
 *
 * ⚠️ `observe` 返回的 promise 永不 resolve —— 订阅本来就是长驻的。
 */
function makeMockAgent({ observeImpl, sessionList = [] } = {}) {
  const calls = { observe: 0, sessions: 0, create: 0, run: 0 };
  const signals = [];
  let emit = null;
  return {
    calls,
    signals,
    emit(event) {
      if (emit) emit(event);
    },
    observe(target, opts) {
      calls.observe += 1;
      emit = opts.onEvent;
      if (opts && opts.signal) signals.push(opts.signal);
      if (observeImpl) return observeImpl(target, opts);
      return new Promise(() => {});
    },
    async sessions() {
      calls.sessions += 1;
      return { sessions: sessionList };
    },
    async create() {
      calls.create += 1;
      return { sessionId: 'sess-mock-1' };
    },
    async run() {
      calls.run += 1;
      return { status: 'finished', text: '好' };
    },
    async reply() {
      return {};
    },
    async answer() {
      return {};
    },
  };
}

/** 起一套独立的 server（独立端口 ＋ 独立 dataDir）。 */
async function startHarness({ agent, dataDir, boardIntervalMs = 200, startFn }) {
  const dir = dataDir || (await makeTempDir('mmx-petaware-'));
  const ctrl = new AbortController();
  const ctx = {
    pluginId: 'mmx-octopus',
    pluginRoot: PACKAGE_ROOT,
    dataDir: dir,
    listen: { host: '127.0.0.1', port: 0 },
    signal: ctrl.signal,
    logger: { info() {}, warn() {}, error() {} },
    capabilities: { has: () => true },
    agent,
  };
  const life = await (startFn || start)(ctx, { boardIntervalMs });
  liveServers.push(life);
  const base = `http://127.0.0.1:${life.port}`;
  return {
    life,
    base,
    dir,
    async state() {
      const r = await fetch(`${base}/api/state`);
      return r.json();
    },
  };
}

/**
 * 把某个生产模块改坏后**独立导入**一份（真源一个字节不动）。
 * ⚠️ **依赖清单自动补齐**：把被测模块 import 的同目录模块都复制过去 ——
 *   手写清单会漏（加一个 import 就漏一个 ⇒ 直接崩，不是判据红）。
 */
async function importBadNode(fileName, mutate) {
  const dir = await makeTempDir('mmx-petaware-bad-');
  const src = await readFile(join(NODE_DIR, fileName), 'utf8');
  const bad = mutate(src);
  if (bad === src) return null;
  const deps = new Set();
  for (const m of src.matchAll(/from\s+'\.\/([\w.-]+\.mjs)'/g)) deps.add(m[1]);
  for (const dep of deps) {
    await writeFile(join(dir, dep), await readFile(join(NODE_DIR, dep), 'utf8'));
  }
  await writeFile(join(dir, fileName), bad);
  return import(pathToFileURL(join(dir, fileName)).href);
}

/**
 * 把整个 node 目录复制一份并改坏其中一个模块，然后**独立导入**那一份 server。
 *
 * ⚠️ **为什么复制整个目录**：负向注入要落在**装配后的行为**上 ——
 *   只复制一个模块的话，server 还在用真模块跑，注入根本碰不到真实路径。
 *   目录里的模块都按 pluginRoot 找资源（不按自身目录找），所以复制一份
 *   照样能跑起来（context.pluginRoot 仍然指真包）。
 */
async function importBadServer(mutate) {
  const dir = await makeTempDir('mmx-petaware-badserver-');
  for (const name of await readdir(NODE_DIR)) {
    if (!name.endsWith('.mjs')) continue;
    await writeFile(join(dir, name), await readFile(join(NODE_DIR, name), 'utf8'));
  }
  const src = await readFile(join(NODE_DIR, 'state.mjs'), 'utf8');
  const bad = mutate(src);
  if (bad === src) return null;
  await writeFile(join(dir, 'state.mjs'), bad);
  return import(pathToFileURL(join(dir, 'server.mjs')).href);
}

/**
 * **旧规则**（1.9.0 之前的写法）：读回存档里存着的值就算数。
 * 负向注入用它替换真规则 ⇒ 判据必须红。
 */
const LEGACY_MIGRATION = [
  'export function migratePetAware(saved) {',
  '  return { petAware: !!(saved && saved.petAware === true), petAwareOptIn: false, petAwareReset: false };',
  '}',
].join('\n');

const SESSIONS = [{ sessionId: 's-other', title: '别人的活', status: 'running' }];

/**
 * 跑一遍全部场景，返回逐条结果。
 *
 * @returns {Promise<Array<{name: string, ok: boolean, detail: string}>>}
 */
async function runScenariosInner() {
  const out = [];
  const push = (name, ok, detail) => out.push({ name, ok: !!ok, detail: detail || '' });

  // ---------- ① 首启：开关是关的 ⇒ 一个 observe / sessions 都不该发生 ----------
  //
  // ⚠️ 每个 harness 的 server 都会在收尾时 dispose（见 cleanup）——
  //   server 不关，端口和计时器就一直占着，进程退不出去。
  const agentOff = makeMockAgent({ sessionList: SESSIONS });
  const hOff = await startHarness({ agent: agentOff });
  await fetch(`${hOff.base}/api/state`);
  await sleep(1200);
  push(
    '关着时一次 observe 都不订阅（不是「收了不用」）',
    agentOff.calls.observe === 0,
    `observe 被调 ${agentOff.calls.observe} 次`
  );
  push(
    '关着时一次 sessions() 都不调（看板不采集）',
    agentOff.calls.sessions === 0,
    `sessions 被调 ${agentOff.calls.sessions} 次`
  );
  await hOff.life.dispose();

  // ---------- ② 打开之后才采 ----------
  const agentOn = makeMockAgent({ sessionList: SESSIONS });
  const hOn = await startHarness({ agent: agentOn });
  await fetch(`${hOn.base}/api/state`);
  await sleep(300);
  const onRes = await fetch(`${hOn.base}/api/petaware`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  const onJson = await onRes.json();
  push(
    '打开后接口回 petAware=true',
    onJson.petAware === true,
    `返回=${JSON.stringify(onJson.petAware)}`
  );
  await sleep(1200);
  push(
    '打开之后才订阅 observe',
    agentOn.calls.observe >= 1,
    `observe 被调 ${agentOn.calls.observe} 次`
  );
  push(
    '打开之后才列会话 sessions()',
    agentOn.calls.sessions >= 1,
    `sessions 被调 ${agentOn.calls.sessions} 次`
  );

  // ---------- ③ 关掉之后立刻停 ----------
  const offRes = await fetch(`${hOn.base}/api/petaware`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  const offJson = await offRes.json();
  push(
    '关掉后接口回 petAware=false',
    offJson.petAware === false,
    `返回=${JSON.stringify(offJson.petAware)}`
  );
  const lastSignal = agentOn.signals[agentOn.signals.length - 1];
  push(
    '关掉之后订阅被掐断（observe 的 signal aborted）',
    !!lastSignal && lastSignal.aborted === true,
    `signal=${lastSignal ? String(lastSignal.aborted) : '没有订阅过'}`
  );
  const sessionsAtOff = agentOn.calls.sessions;
  await sleep(900);
  push(
    '关掉之后不再轮询 sessions()（看板计时器停了）',
    agentOn.calls.sessions === sessionsAtOff,
    `关掉后又调了 ${agentOn.calls.sessions - sessionsAtOff} 次`
  );
  const snapOff = await hOn.state();
  push(
    '关掉之后看板里的跨会话信息被清空',
    Array.isArray(snapOff.board?.running) && snapOff.board.running.length === 0,
    `board=${JSON.stringify(snapOff.board)}`
  );
  await hOn.life.dispose();

  // ---------- ④ 重启后仍然是关的（同一个 dataDir） ----------
  const dirRestart = await makeTempDir('mmx-petaware-restart-');
  const agentR1 = makeMockAgent({ sessionList: SESSIONS });
  const hR1 = await startHarness({ agent: agentR1, dataDir: dirRestart });
  await fetch(`${hR1.base}/api/state`);
  await fetch(`${hR1.base}/api/petaware`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  await hR1.life.dispose();
  const agentR2 = makeMockAgent({ sessionList: SESSIONS });
  const hR2 = await startHarness({ agent: agentR2, dataDir: dirRestart });
  await fetch(`${hR2.base}/api/state`);
  await sleep(1200);
  push(
    '重启后仍然是关的（设置被记住，采集不再发生）',
    agentR2.calls.observe === 0 && agentR2.calls.sessions === 0,
    `observe=${agentR2.calls.observe} sessions=${agentR2.calls.sessions}`
  );
  await hR2.life.dispose();

  // ---------- ⑤ 负向注入①：拆掉 observe.mjs 的开关守卫 ⇒ 判据必须红 ----------
  {
    const mod = await importBadNode('observe.mjs', (s) =>
      s.split('    if (!state.petAware) return;\n').join('')
    );
    if (!mod) {
      push('负向注入｜把 observe.mjs 的开关守卫拆掉时判据必须红', false, '注入没生效');
    } else {
      const badState = new PetState(await makeTempDir('mmx-petaware-badstate-'));
      await badState.setPetAware(false);
      const badAgent = makeMockAgent({ sessionList: SESSIONS });
      const badObserve = mod.createObserve({
        context: {
          agent: badAgent,
          signal: new AbortController().signal,
          capabilities: { has: () => true },
          logger: { warn() {}, info() {}, error() {} },
        },
        state: badState,
        boardIntervalMs: 200,
      });
      badObserve.scheduleObserve();
      badObserve.scheduleBoard();
      await sleep(1200);
      push(
        '负向注入｜把 observe.mjs 的开关守卫拆掉时判据必须红',
        badAgent.calls.observe > 0 || badAgent.calls.sessions > 0,
        `坏副本在关着的时候仍然采集了（observe=${badAgent.calls.observe}` +
          ` sessions=${badAgent.calls.sessions}）⇒ 真判据会红`
      );
      // ⚠️ **坏副本也得收尾**：它的看板轮询是个 `setInterval` —— 不关掉的话
      //   进程退不出去（`node --test` 会一直挂着，内部自检末尾有 process.exit 才没暴露）。
      badObserve.dispose();
      badState.dispose();
    }
  }

  // ---------- ⑥ 负向注入②：把默认关改回默认开 ⇒ 判据必须红 ----------
  {
    const mod = await importBadNode('state.mjs', (s) =>
      s.replace('this.petAware = false;', 'this.petAware = true;')
    );
    if (!mod) {
      push('负向注入｜把默认关改回默认开时判据必须红', false, '注入没生效');
    } else {
      const badFresh = new mod.PetState(await makeTempDir('mmx-petaware-badstate2-'));
      badFresh.dispose();
      push(
        '负向注入｜把默认关改回默认开时判据必须红',
        badFresh.petAware === true,
        `坏副本默认是开的（petAware=${String(badFresh.petAware)}）⇒ 真判据会红`
      );
    }
  }

  // ---------- ⑦ 升级迁移：旧存档里那个「开」不算用户同意过 ----------
  //
  // ⚠️ **评审原话**（官方插件市场 2026-11-17，PR #138）：
  //   "an existing state.json with petAware: true retains that value after
  //    upgrading, so cross-session collection continues without a new opt-in"
  //   → 旧存档没有 opt-in 标记 ⇒ **一律重置为关**，并请用户重新打开。
  const legacyDir = await makeTempDir('mmx-petaware-legacy-');
  await writeFile(
    join(legacyDir, 'state.json'),
    JSON.stringify({ mood: 'idle', petAware: true, heart: 50, intimacy: 0 }),
    'utf8'
  );
  const agentLegacy = makeMockAgent({ sessionList: SESSIONS });
  const hLegacy = await startHarness({ agent: agentLegacy, dataDir: legacyDir });
  const legacySnap = await hLegacy.state();
  push(
    '旧存档里的 petAware:true 升级后被重置为关（1.9.0 的默认值不算用户同意）',
    legacySnap.petAware === false,
    'petAware=' + String(legacySnap.petAware)
  );
  await sleep(1200);
  push(
    '旧存档升级后一个 observe 都不订阅',
    agentLegacy.calls.observe === 0,
    'observe 被调 ' + agentLegacy.calls.observe + ' 次'
  );
  push(
    '旧存档升级后一次 sessions() 都不调',
    agentLegacy.calls.sessions === 0,
    'sessions 被调 ' + agentLegacy.calls.sessions + ' 次'
  );
  push(
    '旧存档升级后面板留着「请重新打开」的提示',
    legacySnap.petAwareReset === true,
    'petAwareReset=' + String(legacySnap.petAwareReset)
  );
  // 用户明确打开 ⇒ 采集恢复
  await fetch(hLegacy.base + '/api/petaware', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  await sleep(1200);
  push(
    '用户明确打开之后订阅恢复了',
    agentLegacy.calls.observe >= 1,
    'observe 被调 ' + agentLegacy.calls.observe + ' 次'
  );
  push(
    '用户明确打开之后看板恢复了',
    agentLegacy.calls.sessions >= 1,
    'sessions 被调 ' + agentLegacy.calls.sessions + ' 次'
  );
  await hLegacy.life.dispose();

  // 重启：明确 opt-in 过 ⇒ 仍然是开的
  const agentLegacy2 = makeMockAgent({ sessionList: SESSIONS });
  const hLegacy2 = await startHarness({ agent: agentLegacy2, dataDir: legacyDir });
  const legacySnap2 = await hLegacy2.state();
  push(
    '明确打开过之后重启仍然是开的（opt-in 被记住）',
    legacySnap2.petAware === true,
    'petAware=' + String(legacySnap2.petAware)
  );
  await sleep(1200);
  push(
    '明确打开过之后重启继续采集',
    agentLegacy2.calls.observe >= 1,
    'observe 被调 ' + agentLegacy2.calls.observe + ' 次'
  );
  await hLegacy2.life.dispose();

  // ---------- ⑧ 旧存档压根没这个字段 ⇒ 仍然是关的 ----------
  {
    const oldDir = await makeTempDir('mmx-petaware-old-');
    await writeFile(join(oldDir, 'state.json'), JSON.stringify({ mood: 'idle' }), 'utf8');
    const agentOld = makeMockAgent({ sessionList: SESSIONS });
    const hOld = await startHarness({ agent: agentOld, dataDir: oldDir });
    const oldSnap = await hOld.state();
    push(
      '旧存档里压根没有这个字段时仍然是关的',
      oldSnap.petAware === false,
      'petAware=' + String(oldSnap.petAware)
    );
    await sleep(1200);
    push(
      '旧存档里没有这个字段时也不采集',
      agentOld.calls.observe === 0 && agentOld.calls.sessions === 0,
      'observe=' + agentOld.calls.observe + ' sessions=' + agentOld.calls.sessions
    );
    await hOld.life.dispose();
  }

  // ---------- ⑨ 负向注入③：把迁移规则改回「读回旧值」⇒ 判据必须红 ----------
  {
    const bad = await importBadServer((s) => {
      const m = s.match(/export function migratePetAware\(saved\) \{[\s\S]*?\n\}/);
      if (!m) return s;
      return s.replace(m[0], LEGACY_MIGRATION);
    });
    if (!bad) {
      push('负向注入｜把迁移规则改回「读回旧值」时判据必须红', false, '注入没生效');
    } else {
      const badDir = await makeTempDir('mmx-petaware-badlegacy-');
      await writeFile(
        join(badDir, 'state.json'),
        JSON.stringify({ mood: 'idle', petAware: true }),
        'utf8'
      );
      const badAgent = makeMockAgent({ sessionList: SESSIONS });
      const badH = await startHarness({
        agent: badAgent,
        dataDir: badDir,
        startFn: bad.start,
      });
      const badSnap = await badH.state();
      await sleep(1200);
      push(
        '负向注入｜把迁移规则改回「读回旧值」时判据必须红',
        badSnap.petAware === true && badAgent.calls.observe > 0,
        '坏副本把旧值读回来了（petAware=' + String(badSnap.petAware)
          + ' observe=' + badAgent.calls.observe + '）⇒ 真判据会红'
      );
      await badH.life.dispose();
    }
  }

  return out;
}

/**
 * 跑一遍全部场景，返回逐条结果。
 *
 * ⚠️ **收尾放在 finally**：中途抛异常也必须把 server 与临时目录收干净 ——
 *   漏一个定时器，进程就退不出去（`node --test` 会一直挂着）。
 */
export async function runPetAwareScenarios() {
  try {
    return await runScenariosInner();
  } finally {
    await cleanup();
  }
}
