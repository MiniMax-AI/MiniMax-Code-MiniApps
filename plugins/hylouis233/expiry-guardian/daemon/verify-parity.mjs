#!/usr/bin/env node
/**
 * 三方一致性校验器：确保三处扣卡决策永远一致。
 *
 *   Mini App（Node）   packages/expiry-guardian/miniapp/node/server.mjs → decide()
 *   后台旧版（Python） ~/mcode-reset-card-autouse/reset_card_autouse.py   → decide_background()
 *   后台新版（Rust）   ~/mcode-reset-card-autouse/rust/src/decision.rs    → decide()
 *
 * 三者是三门语言、两套运行路径。任何一侧改动都可能悄悄漂移，
 * 扣卡决策漂移 = 真金白银的损失，必须逐字比对「动作 + 理由文本」。
 *
 * 用法：
 *   node verify-parity.mjs           # 比对三者
 *   node verify-parity.mjs --write   # 顺便刷新快照
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// 路径解析：优先用**插件包内**的副本（自包含），找不到再回落到本机开发目录。
//
// 2026-10-19 修：这个校验器原先硬编码 `~/Desktop/mmx/miniapps/...`，
// 于是「把插件复制到别处」就完全跑不起来 —— 违反 CONTRIBUTING 里
// 「插件应能独立复制使用，不依赖仓库里的其他目录」这条约定。
const WORKSPACE = process.env.MCODE_WORKSPACE ?? join(homedir(), 'Desktop', 'mmx');
const PLUGIN_MINIAPP = join(HERE, '..', 'miniapp', 'node', 'server.mjs');
const WORKSPACE_MINIAPP = join(
  WORKSPACE, 'miniapps', 'expiry-guardian', 'miniapp', 'node', 'server.mjs',
);
const MINIAPP_SERVER = existsSync(PLUGIN_MINIAPP) ? PLUGIN_MINIAPP : WORKSPACE_MINIAPP;
// ⚠️ **必须支持 `MCODE_BG_SCRIPT` 覆盖**（2026-10-20 实测发现）：
// `check-parity.sh` 的第 3 步是「校验器自检」——它把后台脚本改成一份**注入漂移**的
// 副本，再跑校验器，要求校验器**必须报不一致**（否则说明校验器自己已经失效了）。
// 而这里原本把路径**写死**了 ⇒ 校验器永远读的是原脚本 ⇒ 永远报一致
// ⇒ 自检**从建立起就一直是坏的**（一直在报「校验器本身已失效」）。
const BG_PY = process.env.MCODE_BG_SCRIPT || join(HERE, 'reset_card_autouse.py');
const RUST_DAEMON = join(HERE, 'rust', 'target', 'release', 'reset-card-daemon');
const SNAPSHOT = join(HERE, 'bg_parity.json');

for (const [label, p] of [
  ['Mini App 服务端', MINIAPP_SERVER],
  ['后台服务（Python）', BG_PY],
  ['后台守护（Rust 二进制）', RUST_DAEMON],
]) {
  if (!existsSync(p)) {
    console.error(`✗ 找不到 ${label}: ${p}`);
    console.error('  Rust 版需先执行: cd rust && cargo build --release');
    process.exit(2);
  }
}

// ── 0. 固定配置：三方必须读同一份阈值 ──
// 否则校验结果会随**用户自己的 config.json** 漂移：改一次配置，
// 这个校验器就从「验一致」变成「验谁赢」了。
// Node / Python 都用 $HOME 定位配置，所以给它们一个临时 HOME 即可。
const TMP_HOME = mkdtempSync(join(tmpdir(), 'mcode-parity-'));
mkdirSync(join(TMP_HOME, '.config', 'mcode-reset-card'), { recursive: true });
writeFileSync(
  join(TMP_HOME, '.config', 'mcode-reset-card', 'config.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      cardTriggerPercent: 99,
      cardSkipBeforeResetMinutes: 60,
      quotaLevels: { tight: 80, low: 95 },
    },
    null,
    2,
  ),
);
process.env.HOME = TMP_HOME;

// ── 1. Mini App ──────────────────────────────────────────────────────────────
const src = readFileSync(MINIAPP_SERVER, 'utf8').replace(/export async function start[\s\S]*$/, '');
// ⚠️ 不能用 data: URL 导入 —— Mini App 的 server.mjs 现在有相对 import
//    （./bot_wakeup.mjs、./mcp.mjs），data: URL 里解析不了相对路径
//    （ERR_UNSUPPORTED_RESOLVE_REQUEST）。
// ⇒ 改成把 server.mjs 复制成一份「只保留导出前部分」的临时 .mjs 文件再 import。
//
// ⚠️ **必须把同目录的兄弟模块一起复制过去**（2026-10-20 实测踩到）：
// 原来只复制了 `bot_wakeup.mjs`，而 server.mjs 后来又 import 了 `./mcp.mjs`
// ⇒ ERR_MODULE_NOT_FOUND ⇒ **这道三方一致性校验一直在报错、根本没在跑**
// （文档里「一致性是测出来的，不是声称的」就成了空话）。
// ⇒ 改成：把 MiniApp 目录下的**所有 .mjs** 都复制过去，server.mjs 再 import 哪个都找得到。
const modDir = mkdtempSync(join(tmpdir(), 'expiry-parity-'));
const modFile = join(modDir, 'server-under-test.mjs');
writeFileSync(modFile, src + '\nexport { decide };');
// 依赖文件跟 server.mjs 同目录（server.mjs 用相对路径 import 它们）。
for (const f of readdirSync(dirname(MINIAPP_SERVER))) {
  if (f.endsWith('.mjs') && f !== 'server.mjs') {
    copyFileSync(join(dirname(MINIAPP_SERVER), f), join(modDir, f));
  }
}
const mod = await import(modFile);
const miniDecide = mod.decide;

// ── 2. Python ────────────────────────────────────────────────────────────────
const pyScript = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bg", ${JSON.stringify(BG_PY)})
m = importlib.util.module_from_spec(spec); sys.modules["bg"] = m; spec.loader.exec_module(m)
payload = json.load(sys.stdin)
NOW, DAY = payload["now"], payload["day"]
out = []
for c in payload["cases"]:
    def qs(t, u, tot=100.0, ul=False):
        return m.QuotaState(quota_type=t, total=tot, used=u, is_unlimited=ul)  # triggered 是 property
    quotas = [qs(1, c["five"])]
    quotas.append(qs(2, 0, 100.0, True) if c["week"] is None else qs(2, c["week"]))
    if c.get("resetInMinutes") is not None:
        quotas[0].reset_time = NOW + int(c["resetInMinutes"] * 60_000)
    cards = [{"card_id": f"C{d}", "out_biz_no": f"b{d}", "source_type": "mcode_signin",
              "expire_time": NOW + d * DAY} for d in c["cards"]]
    exp = None if c["credit"] is None else NOW + c["credit"] * DAY
    cfg, _issues = m.load_config()
    action, reason = m.decide_background(
        quotas, cards, exp, "平台积分", cfg, NOW, c.get("creditDataComplete", True)
    )
    out.append({"n": c["n"], "action": action, "reason": reason})
json.dump(out, sys.stdout, ensure_ascii=False)
`;

// ── 3. Rust：用一个隐藏的 --selftest 模式跑同一组用例 ────────────────────────
const DAY = 86_400_000;
const NOW = Date.now();

const TRIGGER = 99;
const mq = (type, used, total = 100, unlimited = false) => ({
  quota_type: type,
  total,
  used,
  is_unlimited: unlimited,
  // decide() 的 idle 分支会读 usedPercent 生成理由文案
  usedPercent: used,
  totalPercent: total,
  remainingPercent: Math.max(0, (total - used) / total) * 100,
  exhausted: !unlimited && total > 0 && used >= total,
  unlimited,
  triggered: !unlimited && total > 0 && used >= (total * TRIGGER) / 100,
  resetTimeMs: NOW + 30 * DAY,
});
const mcard = (d) => ({ cardId: `C${d}`, sourceType: 'mcode_signin', outBizNo: `b${d}`, expireTimeMs: NOW + d * DAY, expired: false });
const mcredit = (d) => ({ source: 'platform', label: '平台积分', balance: 500, expireTimeMs: NOW + d * DAY });

/** 覆盖 decide() 每一个分支 */
const CASES = [
  { n: '未耗尽 / 卡7 / 积13',      five: 50,  week: null, cards: [7],  credit: 13 },
  { n: '未耗尽 / 无卡 / 积13',     five: 0,   week: null, cards: [],   credit: 13 },
  { n: '耗尽 / 卡先过期',          five: 100, week: null, cards: [7],  credit: 13 },
  { n: '耗尽 / 积分先过期',        five: 100, week: null, cards: [20], credit: 5 },
  { n: '耗尽 / 无卡 / 有积分',     five: 100, week: null, cards: [],   credit: 13 },
  { n: '耗尽 / 有卡 / 无积分',     five: 100, week: null, cards: [7],  credit: null },
  { n: '耗尽 / 无卡 / 无积分',     five: 100, week: null, cards: [],   credit: null },
  { n: '周限额耗尽 / 5h未耗尽',    five: 50,  week: 100,   cards: [7],  credit: 13 },
  { n: '周限额耗尽 / 积分先过期',  five: 50,  week: 100,   cards: [20], credit: 5 },
  { n: '周限额未耗尽 / 5h未耗尽',  five: 50,  week: 50,    cards: [7],  credit: 13 },
  { n: '5h 98% 未到触发线',       five: 98,  week: null,   cards: [7],  credit: 13 },
  { n: '5h 99% 触发提前动作',     five: 99,  week: null,   cards: [7],  credit: 13 },
  { n: '5h 100% 边界算耗尽',      five: 100, week: null,   cards: [1],  credit: 60 },
  // 「额度马上要刷新就不烧卡」这一组：三方必须给出同一个结论
  { n: '5h 99% / 2小时后刷新',    five: 99,  week: null,   cards: [7],  credit: 13, resetInMinutes: 120 },
  { n: '5h 99% / 10分钟后刷新',   five: 99,  week: null,   cards: [7],  credit: 13, resetInMinutes: 10 },
  { n: '5h 99% / 恰好60分钟后刷新', five: 99, week: null,   cards: [7],  credit: 13, resetInMinutes: 60 },
  { n: '5h 99% / 61分钟后刷新',   five: 99,  week: null,   cards: [7],  credit: 13, resetInMinutes: 61 },
  // 「读不到 ≠ 没有」：积分数据不完整时，三方都必须**不做写操作**。
  // ⚠️ 2026-10-19 PR #28 review 修：以前读失败被当成「没有积分」，
  // 结论会从「留卡」翻转成「用卡」——而扣卡是真实写操作。
  { n: '积分数据不完整 / 耗尽 / 有卡', five: 100, week: null, cards: [7], credit: null, creditDataComplete: false },
  { n: '积分数据不完整 / 耗尽 / 有卡有积分', five: 100, week: null, cards: [7], credit: 13, creditDataComplete: false },
];

const miniResults = CASES.map((c) => {

  const five = mq(1, c.five);
  five.triggered = !five.is_unlimited && five.total > 0 && five.used >= five.total * TRIGGER / 100;
  if (c.resetInMinutes !== undefined) five.resetTimeMs = NOW + c.resetInMinutes * 60_000;
  const week = c.week === null ? mq(2, 0, 100, true) : mq(2, c.week);
  week.triggered = !week.is_unlimited && week.total > 0 && week.used >= week.total * TRIGGER / 100;
  const d = miniDecide({
    platformPools: c.credit === null ? [] : [mcredit(c.credit)],
    codeCredits: [],
    cards: c.cards.map(mcard),
    quota: { fiveHour: five, weekly: week },
    creditDataComplete: c.creditDataComplete !== false,
  }, NOW);
  return { n: c.n, action: d.action, reason: d.reason };
});

const payload = JSON.stringify({
  now: NOW, day: DAY,
  trigger: TRIGGER, tight: 80, low: 95, skipBeforeResetMinutes: 60,
  cases: CASES.map((c) => ({
    n: c.n, five: c.five, week: c.week, cards: c.cards, credit: c.credit,
    resetInMinutes: c.resetInMinutes, creditDataComplete: c.creditDataComplete !== false,
  })),
});

const pyResults = JSON.parse(
  execFileSync('/usr/bin/python3', ['-c', pyScript], {
    input: payload,
    encoding: 'utf8',
    maxBuffer: 8 << 20,
    env: { ...process.env, HOME: TMP_HOME },
  }),
);

// Rust：用 --selftest 读同一份 JSON，打印同样结构
const rustResults = JSON.parse(
  execFileSync(RUST_DAEMON, ['--selftest'], { input: payload, encoding: 'utf8', maxBuffer: 8 << 20 }),
);

// Mini App 用 use-credit，Python 用 keep-credit —— 语义相同，仅命名不同
const NORMALIZE = { 'use-credit': 'keep-credit' };
const norm = (a) => NORMALIZE[a] ?? a;

let failed = 0;
console.log(
  '用例'.padEnd(28) + 'MiniApp'.padEnd(13) + 'Python'.padEnd(13) + 'Rust'.padEnd(13) + '一致',
);
console.log('-'.repeat(80));
for (let i = 0; i < CASES.length; i += 1) {
  const a = miniResults[i];
  const b = pyResults[i];
  const c = rustResults[i];
  const actionOk = norm(a.action) === norm(b.action) && norm(a.action) === norm(c.action);
  const reasonOk = a.reason === b.reason && a.reason === c.reason;
  const ok = actionOk && reasonOk;
  if (!ok) failed += 1;
  console.log(a.n.padEnd(26) + a.action.padEnd(13) + b.action.padEnd(13) + c.action.padEnd(13) + (ok ? '✓' : '✗'));
  if (!ok) {
    if (!actionOk) console.log(`   动作不一致: MiniApp=${a.action} Python=${b.action} Rust=${c.action}`);
    if (!reasonOk) {
      console.log(`   MiniApp: ${a.reason}`);
      console.log(`   Python : ${b.reason}`);
      console.log(`   Rust   : ${c.reason}`);
    }
  }
}
console.log('-'.repeat(80));
console.log(`${CASES.length - failed}/${CASES.length} 三方完全一致（动作 + 理由文本逐字）`);

if (process.argv.includes('--write')) {
  writeFileSync(SNAPSHOT, JSON.stringify({ at: new Date().toISOString(), results: miniResults }, null, 2));
  console.log(`快照已刷新: ${SNAPSHOT}`);
}

process.exit(failed === 0 ? 0 : 1);
