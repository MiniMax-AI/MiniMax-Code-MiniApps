// 决策与聚合逻辑测试：不触网、不扣卡。
// fixture 来自真实接口（2026-10-17 实测，page_number/page_size/include_expired）。
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = readFileSync(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');
const body = src.replace(/export async function start[\s\S]*$/, '');
// ⚠️ 不能用 data: URL 导入 —— server.mjs 有相对 import，
//    data: URL 解析不了相对路径（ERR_UNSUPPORTED_RESOLVE_REQUEST）。
// ⇒ 复制成临时 .mjs 文件再 import。
const modDir = mkdtempSync(join(tmpdir(), 'expiry-test-'));
const modFile = join(modDir, 'server-under-test.mjs');
writeFileSync(
  modFile,
  body +
    '\nexport { percent, amount, parsePlatformPools, parseCodeCredits, parseQuota, expiringWithin, decide };',
);
// server.mjs 还 import 了 ./mcp.mjs —— 一并复制（相对 import 才能解析）。
copyFileSync(new URL('../miniapp/node/mcp.mjs', import.meta.url), join(modDir, 'mcp.mjs'));
const mod = await import(modFile);

const { decide, percent, amount, parsePlatformPools, parseCodeCredits, parseQuota, expiringWithin } = mod;

// 用真实当前时间：写死日期会让整组用例随日历推移而失效
const NOW = Date.now();
const D = 86400000;
const day = (y, mo, d) => Date.UTC(y, mo - 1, d);

const plat = (d, balance = 500) => ({ source: 'platform', balance, expireTimeMs: NOW + d * D });
const code = (d, balance = 500) => ({ source: 'code', balance, expireTimeMs: NOW + d * D });
const card = (d, extra = {}) => ({
  expired: false,
  outBizNo: 'biz:' + d,
  sourceType: 'mcode_signin',
  expireTimeMs: NOW + d * D,
  ...extra,
});
/** 构造额度对象：五小时用百分比，周限额用布尔（不限量时传 false）。 */
const quota = (fivePercent, weekExhausted = false) => ({
  fiveHour: {
    usedPercent: fivePercent,
    exhausted: fivePercent >= 100,
    triggered: fivePercent >= 99, // 决策触发线
    unlimited: false,
  },
  weekly: { usedPercent: weekExhausted ? 100 : 0, exhausted: weekExhausted, triggered: weekExhausted, unlimited: false },
});

let pass = 0;
let total = 0;
function check(name, got, want) {
  total += 1;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name} -> ${got}${ok ? '' : ` (want ${want})`}`);
}
const run = (i) => decide({ platformPools: [], codeCredits: [], cards: [], quota: quota(50), ...i });

console.log('=== 决策矩阵 ===');
check('quota available -> idle', run({ quota: quota(50) }).action, 'idle');
check('card expires first -> use card', run({ platformPools: [plat(13)], cards: [card(7)], quota: quota(100) }).action, 'use-card');
check('platform credit first -> use credit', run({ platformPools: [plat(5)], cards: [card(20)], quota: quota(100) }).action, 'use-credit');
check('code credit first -> use credit', run({ codeCredits: [code(5)], cards: [card(20)], quota: quota(100) }).action, 'use-credit');
check('earliest across BOTH credit sources', run({ platformPools: [plat(30)], codeCredits: [code(2)], cards: [card(10)], quota: quota(100) }).action, 'use-credit');
check('no cards -> use credit', run({ platformPools: [plat(5)], cards: [], quota: quota(100) }).action, 'use-credit');
check('all cards expired -> use credit', run({ platformPools: [plat(5)], cards: [card(-1, { expired: true })], quota: quota(100) }).action, 'use-credit');
check('no credit, has card -> use card', run({ cards: [card(7)], quota: quota(100) }).action, 'use-card');
check('neither credit nor card -> wait', run({ quota: quota(100) }).action, 'wait');
check('98% below trigger line', run({ platformPools: [plat(13)], cards: [card(7)], quota: quota(98) }).action, 'idle');
check('99% triggers early action', run({ platformPools: [plat(13)], cards: [card(7)], quota: quota(99) }).action, 'use-card');
check('weekly exhausted also triggers', run({ platformPools: [plat(5)], cards: [card(20)], quota: quota(50, true) }).action, 'use-credit');
check('zero balance ignored', run({ platformPools: [plat(1, 0)], codeCredits: [code(30)], cards: [card(7)], quota: quota(100) }).action, 'use-card');
check('expired credit ignored', run({ platformPools: [plat(-1)], cards: [card(7)], quota: quota(100) }).action, 'use-card');

console.log('\n=== 真实场景回归：积分先到期 vs 卡后到期 ===');
// 积分 1 天后过期，卡 7 天后过期 → 积分先过期，应保留卡
const realCredit = { source: 'code', balance: 260, expireTimeMs: NOW + 1 * D };
const realCard = { expired: false, outBizNo: 'x', sourceType: 'mcode_signin', expireTimeMs: NOW + 7 * D };
const realDecision = run({ codeCredits: [realCredit], cards: [realCard], quota: quota(100) });
check('真实场景 -> use credit', realDecision.action, 'use-credit');
console.log('  理由:', realDecision.reason);
check('use-credit 时不给扣卡目标', realDecision.target, null);

console.log('\n=== percent / amount ===');
check('percent("71%")', percent('71%'), 71);
check('percent("100%")', percent('100%'), 100);
check('amount("17400.00")', amount('17400.00'), 17400);
check('amount("1,200.50")', amount('1,200.50'), 1200.5);

console.log('\n=== quota parse ===');
check('5h used 72%', parseQuota({ model_remains: [{ model_name: 'general', current_interval_total_percent: '100%', current_interval_used_percent: '72%', current_interval_status: 1, current_weekly_total_percent: '100%', current_weekly_used_percent: '0%', current_weekly_status: 3 }] }).fiveHour.usedPercent, 72);
check('100% used -> exhausted', parseQuota({ model_remains: [{ model_name: 'general', current_interval_total_percent: '100%', current_interval_used_percent: '100%', current_interval_status: 1, current_weekly_total_percent: '100%', current_weekly_used_percent: '0%', current_weekly_status: 3 }] }).fiveHour.exhausted, true);

console.log('\n=== platform pools ===');
const pools = parsePlatformPools({ balance_breakdown: { buckets: [
  { source: 2, balance: 3000, expire_time_ms: day(2026, 12, 17), order_id_prefix: 'ORD-CR' },
  { source: 3, balance: 3488, expire_time_ms: day(2026, 10, 30), order_id_prefix: 'GIFT' },
] } });
check('pool count', pools.length, 2);
check('earliest first', pools[0].label, '赠送');

console.log('\n=== code credits: 已过期 vs 仍有效 ===');
// 用相对当前时间生成到期日，避免 fixture 随日历推移而失效
const soonMs = NOW + 3 * D;      // 3 天后过期
const midMs = NOW + 20 * D;      // 20 天后过期
const farMs = NOW + 60 * D;      // 60 天后过期
const pastMs = NOW - 5 * D;      // 已过期
const cc = parseCodeCredits({
  total_count: 4,
  details: [
    // 已过期但仍有余额 → 真实损失
    { credit_type: 1, granted_amount: '33000.00', remaining_amount: '19634.00', consumed_amount: '13366.00', granted_at_ms: pastMs - 30 * D, expire_at_ms: pastMs },
    // 已过期且已用尽 → 不算损失
    { credit_type: 2, granted_amount: '1000.00', remaining_amount: '0.00', consumed_amount: '1000.00', granted_at_ms: pastMs - 30 * D, expire_at_ms: pastMs },
    // 3 天后过期
    { credit_type: 2, granted_amount: '1000.00', remaining_amount: '260.00', consumed_amount: '740.00', granted_at_ms: soonMs - 30 * D, expire_at_ms: soonMs },
    // 20 天后过期
    { credit_type: 2, granted_amount: '400.00', remaining_amount: '400.00', consumed_amount: '0.00', granted_at_ms: midMs - 30 * D, expire_at_ms: midMs },
    // 60 天后过期
    { credit_type: 2, granted_amount: '2000.00', remaining_amount: '2000.00', consumed_amount: '0.00', granted_at_ms: farMs - 30 * D, expire_at_ms: farMs },
  ],
});
check('totalCount', cc.totalCount, 4);
check('expiredCount', cc.expiredCount, 2);
check('lostCount (过期时还有余额)', cc.lostCount, 1);
check('lostBalance', cc.lostBalance, 19634);
check('liveBalance', cc.liveBalance, 2660);
check('earliest sorted first', cc.items[0].expireTimeMs, pastMs);

console.log('\n=== expiringWithin ===');
const items = cc.items;
const soon7 = expiringWithin(items, 7, NOW);
check('7 天内到期笔数', soon7.length, 1);
check('7 天内到期余额', soon7.reduce((s, d) => s + d.balance, 0), 260);
const soon30 = expiringWithin(items, 30, NOW);
check('30 天内到期余额', soon30.reduce((s, d) => s + d.balance, 0), 660);
check('已过期的不计入', expiringWithin(items, 3650, NOW).length, 3);

console.log('\n=== PR #28 review 回归：读不到 ≠ 没有 ===');
// 建议 2：`credit/details` 失败时，decide 必须**不做写操作**。
// 之前失败被当成「没有积分」⇒ 结论从「留卡」翻转成「用卡」，
// 而扣卡是真实写操作 ⇒ 网络故障会导致误扣真卡。
{
  const now = Date.now();
  const soon = now + 3 * D;
  const far = now + 40 * D;
  const quotaUsed = {
    fiveHour: {
      usedPercent: 100,
      totalPercent: 100,
      unlimited: false,
      triggered: true,
      exhausted: true,
      // 远离「临近刷新不烧卡」的阈值（默认 60 分钟），
      // 否则这条用例测到的是 skip 分支而不是「卡先过期」分支。
      resetTimeMs: now + 6 * 60 * 60_000,
    },
    weekly: {
      usedPercent: 100,
      totalPercent: 100,
      unlimited: false,
      triggered: true,
      exhausted: true,
      resetTimeMs: now + 6 * 60 * 60_000,
    },
  };
  const card = { cardId: 'c1', sourceType: 'st', outBizNo: 'ob1', expireTimeMs: soon, expired: false };
  const credit = {
    kind: 'code-credit',
    source: 'code',
    label: 'Code 积分·赠送',
    granted: 100,
    consumed: 0,
    balance: 100,
    expireTimeMs: far,
    expired: false,
  };
  // 完整数据：卡比积分先过期 ⇒ use-card
  const full = decide(
    { platformPools: [], codeCredits: [credit], cards: [card], quota: quotaUsed, creditDataComplete: true },
    now,
  );
  total += 1;
  if (full.action === 'use-card') pass += 1;
  console.log(`${full.action === 'use-card' ? '  PASS' : '  FAIL'}  数据完整时：卡先过期 ⇒ use-card`);

  // 数据不完整（积分读失败）：即使有卡也不能执行写操作
  const partial = decide(
    { platformPools: [], codeCredits: [], cards: [card], quota: quotaUsed, creditDataComplete: false },
    now,
  );
  total += 1;
  if (partial.action === 'wait' && partial.usedCard === false) pass += 1;
  console.log(
    `${partial.action === 'wait' && partial.usedCard === false ? '  PASS' : '  FAIL'}  积分数据不完整 ⇒ wait（不做写操作）`,
  );
  total += 1;
  if (partial.reason.includes('读取不完整')) pass += 1;
  console.log(`${partial.reason.includes('读取不完整') ? '  PASS' : '  FAIL'}  理由如实说明「读取不完整」`);
}

console.log('\n=== PR #28 review 回归：cards.raw 带 cardId ===');
// 建议 1：页面用的 cards.items 是脱敏视图（无 cardId），
// 拿它做「卡还在不在列表里」的判断 ⇒ 恒为 false ⇒ 扣卡永远被跳过。
{
  const src3 = readFileSync(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');
  total += 1;
  const hasRaw = /raw:\s*cards[\s\S]{0,200}cardId:\s*c\.cardId/.test(src3);
  if (hasRaw) pass += 1;
  console.log(`${hasRaw ? '  PASS' : '  FAIL'}  快照里带 cardId 的原始列表 cards.raw`);

  // ⚠️ v2.0（裁剪版）：不再有「扣卡」这条写路径 ⇒ 没有 stillListed 判定了。
  // 但 `cards.raw` 仍然保留（带 cardId），将来若要恢复自动执行，它是判据来源。
}



console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
