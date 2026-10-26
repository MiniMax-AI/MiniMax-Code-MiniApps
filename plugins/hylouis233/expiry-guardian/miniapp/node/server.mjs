// @ts-check
/**
 * 蹬王之王 — 积分与重置卡的到期决策看板（v2.0 只读版）。
 *
 * 数据源：**本地账本** `~/.config/mcode-reset-card/ledger.json`（用户自己维护）。
 *
 * ⚠️ v2.0 为什么不再自己调接口（2026-10-20 管理员 review）：
 * 社区插件不能读取 MiniMax Code 的登录凭据，也不能读写宿主的内部数据库、
 * 不能读其它插件的数据目录 ⇒ 额度/积分/重置卡的信息改由本地账本提供。
 * 本插件**只读**，不做任何写操作（不扣卡、不暂停目标）。
 *
 * 决策规则：把「最早到期的积分」（平台或 Code 任一）与「最早到期的重置卡」比，
 * 谁先过期先用谁。积分先过期 → 不用卡，让积分先消耗完；重置卡先过期 → 用卡
 * 把额度重置回来，把更耐放的积分留着。
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createMcpHandler } from './mcp.mjs';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { connect } from 'node:net';
import { homedir } from 'node:os';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */


// ── 解析 ──────────────────────────────────────────────────────────────────────
/** 百分数字符串（如 "71%"）转数字。接口就是这种格式，直接 Number() 会得到 0。 */
function percent(value) {
  if (typeof value === 'string') value = value.trim().replace(/%/g, '');
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 金额字符串（可能带千分位）转数字。 */
function amount(value) {
  if (typeof value === 'string') value = value.replace(/,/g, '').trim();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const BUCKET_LABEL = { 2: '充值', 3: '赠送' };
/** Code 积分 credit_type：1=购买，2=赠送（取自桌面端 Purchased / Free 判定）。 */
const CODE_CREDIT_LABEL = { 1: '购买', 2: '赠送' };

/** 开放平台积分池（/backend/account/token_plan_credit）。 */
function parsePlatformPools(credit) {
  const buckets = credit?.balance_breakdown?.buckets ?? [];
  return buckets
    .filter((b) => b && typeof b.balance === 'number')
    .map((b) => ({
      kind: 'platform',
      source: 'platform',
      label: BUCKET_LABEL[b.source] ?? `来源${b.source}`,
      balance: b.balance,
      expireTimeMs: typeof b.expire_time_ms === 'number' ? b.expire_time_ms : null,
    }))
    .sort((a, b) => (a.expireTimeMs ?? Infinity) - (b.expireTimeMs ?? Infinity));
}

/**
 * MiniMax Code 积分明细（/minimax-cloud/api/v1/credit/details）。
 *
 * 分页参数是 `page_number` / `page_size`（下划线命名），且必须带
 * `include_expired=1` 才会返回历史记录——桌面端就是这么调的
 * （见 app.asar 中 open-platform-commerce 的 fetch 函数）。
 *
 * 不带 include_expired 时接口只返回当前有效的最近 20 条，据此判断「已过期多少」
 * 会得出完全错误的结论（曾经据此误答「0 过期」）。page_size 上限 100。
 */
function parseCodeCredits(payload) {
  const details = Array.isArray(payload?.details) ? payload.details : [];
  const now = Date.now();
  const items = details
    .filter((d) => d && (d.credit_type === 1 || d.credit_type === 2))
    .map((d) => ({
      kind: 'code-credit',
      source: 'code',
      label: CODE_CREDIT_LABEL[d.credit_type] ?? `类型${d.credit_type}`,
      granted: amount(d.granted_amount),
      consumed: amount(d.consumed_amount),
      balance: amount(d.remaining_amount),
      expireTimeMs: typeof d.expire_at_ms === 'number' ? d.expire_at_ms : null,
      grantedAtMs: typeof d.granted_at_ms === 'number' ? d.granted_at_ms : null,
      // 过期时仍有余额 = 真实损失；过期但已用尽不算损失
      lost: typeof d.expire_at_ms === 'number' && d.expire_at_ms < now && amount(d.remaining_amount) > 0,
      expired: typeof d.expire_at_ms === 'number' && d.expire_at_ms < now,
    }))
    .sort((a, b) => (a.expireTimeMs ?? Infinity) - (b.expireTimeMs ?? Infinity));

  const live = items.filter((d) => !d.expired);
  return {
    items,
    totalCount: Number(payload?.total_count ?? items.length),
    truncated: Number(payload?.total_count ?? 0) > items.length,
    liveBalance: live.reduce((sum, d) => sum + d.balance, 0),
    lostBalance: items.filter((d) => d.lost).reduce((sum, d) => sum + d.balance, 0),
    lostCount: items.filter((d) => d.lost).length,
    expiredCount: items.filter((d) => d.expired).length,
  };
}

/**
 * 未来 N 天内将过期的积分子集。
 * 这是整个看板最有价值的数字：签到分按天逐笔到账、各自 30 天到期，
 * 所以到期是连续排队的滚动流失，不是一次性清算。
 */
function expiringWithin(items, days, now = Date.now()) {
  const limit = now + days * 86_400_000;
  return items.filter(
    (d) => !d.expired && d.balance > 0 && d.expireTimeMs !== null && d.expireTimeMs <= limit,
  );
}

/**
 * 账户积分汇总（POST /matrix/api/v1/commerce/get_membership_info）。
 *
 * 这是 MCode 用量页上「积分」那一栏的权威口径：
 *   total_remaining_amount     总余额（截图里的 30947）
 *   purchased_remaining_amount 购入部分
 *   free_remaining_amount      赠送部分
 *
 * 与另两个口径的关系（已实测核对，不要混算）：
 *   purchased ≈ token_plan_credit 的 remaining_credits（6487.506 vs 6487，小数为精度差）
 *   free      ≥ credit/details 明细之和（24460 vs 17400，因该接口只返回最近 20 笔）
 * 因此这里只作为「总余额」展示，**不参与**到期排序，避免与明细重复计数。
 */
function parseCreditSummary(payload) {
  const s = payload?.op_credit_summary;
  if (!s) return null;
  const total = amount(s.total_remaining_amount);
  const purchased = amount(s.purchased_remaining_amount);
  const free = amount(s.free_remaining_amount);
  if (!total && !purchased && !free) return null;
  return { total, purchased, free };
}

// ── 本地账本：数据来源 ─────────────────────────────────────────────────────────
//
// 社区插件不能读取 MiniMax Code 的登录凭据（2026-10-20 管理员 review），
// 所以这里**不再**调账号接口 ⇒ 额度/积分/重置卡的信息改由用户自己维护的
// 本地账本提供：`~/.config/mcode-reset-card/ledger.json`。
//
// ⚠️ 账本形状与 Rust 守护进程（`daemon/rust/src/ledger.rs`）**必须逐字一致**。
const LEDGER_PATH = join(homedir(), '.config', 'mcode-reset-card', 'ledger.json');

/**
 * 读账本。
 *
 * @returns {{ok: true, ledger: any}|{ok: false, error: string}}
 *   ⚠️ 「读不到」与「读到但内容是空的」必须分开：
 *   读不到 ⇒ 数据不完整 ⇒ 决策走 wait（绝不能当成「没有积分」⇒ 结论翻转成「用卡」）。
 */
function readLedger() {
  let raw;
  try {
    raw = readFileSync(LEDGER_PATH, 'utf8');
  } catch (e) {
    return { ok: false, error: `读不到账本 ${LEDGER_PATH}（${e?.message ?? e}）` };
  }
  try {
    return { ok: true, ledger: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: `账本 ${LEDGER_PATH} 解析失败（${e?.message ?? e}）` };
  }
}

/** 账本里的额度 → 与 `parseQuota` 同构的对象。 */
function ledgerQuota(q, triggerPercent) {
  const mk = (o, fallbackUnlimited) => {
    const used = Number(o?.usedPercent ?? 0);
    const total = Number(o?.totalPercent ?? 100) || 100;
    const unlimited = Boolean(o?.unlimited ?? fallbackUnlimited);
    return {
      usedPercent: used,
      totalPercent: total,
      remainingPercent: Math.max(0, (total - used) / total) * 100,
      exhausted: !unlimited && total > 0 && used >= total,
      unlimited,
      triggered: isTriggered(used, total, unlimited, triggerPercent),
      resetTimeMs: Number(o?.resetTimeMs ?? 0) || null,
    };
  };
  return {
    fiveHour: mk(q?.fiveHour, false),
    weekly: mk(q?.weekly, true),
  };
}

/**
 * 账本 → 决策引擎的输入（形状与之前从账号接口拿到时**完全一致**）。
 *
 * ⇒ 决策逻辑、三方一致性校验（Rust / Mini App / Python 逐字比对）原样保留。
 */
function ledgerInputs(v, now) {
  const rawCredits = Array.isArray(v?.credits) ? v.credits : null;
  const items = (rawCredits ?? []).map((c) => {
    const balance = Number(c?.balance ?? 0);
    const expireTimeMs = Number(c?.expireTimeMs ?? 0) || null;
    const expired = expireTimeMs !== null && expireTimeMs < now;
    return {
      kind: c?.source === 'platform' ? 'platform' : 'code-credit',
      source: c?.source === 'platform' ? 'platform' : 'code',
      label: String(c?.label ?? '积分'),
      granted: Number(c?.granted ?? 0),
      consumed: Number(c?.used ?? 0),
      balance,
      expireTimeMs,
      grantedAtMs: null,
      // 过期时仍有余额 = 真实损失；过期但已用尽不算损失
      lost: expired && balance > 0,
      expired,
    };
  });
  const codeItems = items.filter((i) => i.source === 'code');
  const platformPools = items.filter((i) => i.source === 'platform');
  const live = codeItems.filter((i) => !i.expired);
  const codeCredits = {
    items: codeItems,
    totalCount: codeItems.length,
    truncated: false,
    liveBalance: live.reduce((sum, d) => sum + d.balance, 0),
    lostBalance: codeItems.filter((d) => d.lost).reduce((sum, d) => sum + d.balance, 0),
    lostCount: codeItems.filter((d) => d.lost).length,
    expiredCount: codeItems.filter((d) => d.expired).length,
  };
  const cards = (Array.isArray(v?.cards) ? v.cards : []).map((c) => {
    const expireTimeMs = Number(c?.expireTimeMs ?? 0) || null;
    return {
      cardId: String(c?.cardId ?? ''),
      label: String(c?.label ?? '重置卡'),
      sourceType: String(c?.sourceType ?? ''),
      outBizNo: String(c?.outBizNo ?? ''),
      expireTimeMs,
      createTimeMs: null,
      expired: expireTimeMs !== null && expireTimeMs <= now,
    };
  });
  return {
    platformPools,
    codeCredits,
    cards,
    // ⚠️ `credits` 字段缺失 ⇒ 数据不完整（不是「没有积分」）。
    creditDataComplete: rawCredits !== null,
  };
}

// ── 共享配置（与 Rust 守护进程 / Python 读同一个文件）─────────────────────────
// 这是三份实现不漂移的前提：Node / Rust / Python 都从这里取阈值，
// 谁都不许再把 99 写死在自己代码里。
// 路径 ~/.config/mcode-reset-card/config.json 与 Rust config.rs 一致。
const CONFIG_PATH = join(homedir(), '.config', 'mcode-reset-card', 'config.json');
const CONFIG_DIR = dirname(CONFIG_PATH);

/**
 * 下列常量只是**默认值**，仅在配置文件缺失或非法时兜底。
 * 实际生效值一律来自 loadConfig()。
 *
 * 为什么默认 99：等额度耗尽再处理，中间那次请求已经失败，会打断
 * 当前目标正在跑的自动执行。提前一个百分点介入，代价几乎为零
 * （剩余 1% 本来也用不完），但能避免任务被硬中断。
 */
const DEFAULT_QUOTA_TRIGGER_PERCENT = 99;
const DEFAULT_TIGHT_PERCENT = 80;
const DEFAULT_LOW_PERCENT = 95;
/**
 * 距 5 小时额度刷新不足这么多分钟时，不消耗重置卡（额度马上就自己回来了）。
 * 实际生效值来自 config.json 的 cardSkipBeforeResetMinutes。
 */
const DEFAULT_CARD_SKIP_BEFORE_RESET_MINUTES = 60;

function defaultConfig() {
  return {
    schemaVersion: 1,
    cardTriggerPercent: DEFAULT_QUOTA_TRIGGER_PERCENT,
    cardSkipBeforeResetMinutes: DEFAULT_CARD_SKIP_BEFORE_RESET_MINUTES,
    quotaLevels: { tight: DEFAULT_TIGHT_PERCENT, low: DEFAULT_LOW_PERCENT },
  };
}

function clampNumber(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 逐字段校验并夹紧，返回 (配置, 问题列表)。
 *
 * 非法组合**整体回退默认并报出来**，绝不静默纠正 ——
 * 静默纠正会让人以为自己设的生效了。字段与 Rust config.rs 保持同名同义。
 */
export function normalizeConfig(raw) {
  const d = defaultConfig();
  const issues = [];
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const rawCard = src.cardTriggerPercent;
  const cardTriggerPercent = clampNumber(rawCard, 1, 100, d.cardTriggerPercent);
  if (rawCard != null && Number(rawCard) !== cardTriggerPercent) {
    issues.push(`cardTriggerPercent=${rawCard} 超出 1..100，已夹到 ${cardTriggerPercent}`);
  }

  const lv = src.quotaLevels && typeof src.quotaLevels === 'object' ? src.quotaLevels : {};
  let tight = clampNumber(lv.tight, 1, 100, d.quotaLevels.tight);
  let low = clampNumber(lv.low, 1, 100, d.quotaLevels.low);
  // 分界点必须 0 < tight < low；非法组合整体回退默认，而不是悄悄调序。
  if (!(tight < low)) {
    if (Object.keys(lv).length > 0) {
      issues.push(`quotaLevels 需满足 tight < low（收到 tight=${tight} low=${low}），已整体回退默认`);
    }
    tight = d.quotaLevels.tight;
    low = d.quotaLevels.low;
  }

  const rawSkip = src.cardSkipBeforeResetMinutes;
  const cardSkipBeforeResetMinutes = clampNumber(rawSkip, 0, 1440, d.cardSkipBeforeResetMinutes);
  if (rawSkip != null && Number(rawSkip) !== cardSkipBeforeResetMinutes) {
    issues.push(`cardSkipBeforeResetMinutes=${rawSkip} 超出 0..1440，已夹到 ${cardSkipBeforeResetMinutes}`);
  }

  const config = {
    schemaVersion: 1,
    cardTriggerPercent,
    cardSkipBeforeResetMinutes,
    quotaLevels: { tight, low },
  };
  return { config, issues };
}

/** 读配置。文件不存在是正常情况（首次运行），返回默认值且不记 issue。 */
function readConfig() {
  let text;
  try {
    text = readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { config: defaultConfig(), issues: [] };
    return { config: defaultConfig(), issues: [`配置读取失败（${e.message}），正在用默认值`] };
  }
  try {
    return normalizeConfig(JSON.parse(text));
  } catch (e) {
    return { config: defaultConfig(), issues: [`配置解析失败（${e.message}），正在用默认值`] };
  }
}

function loadConfig() {
  return readConfig().config;
}

/** 原子写：写 tmp 再 rename。同目录 rename 在 POSIX 上是原子的。 */
function writeConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  renameSync(tmp, CONFIG_PATH);
}

/**
 * 等级 → 中文。**属于 parity 契约的一部分**，改一个字三方都要改。
 * 与 Rust decision.rs 的 LEVEL_LABEL 逐字对应。
 */
const LEVEL_LABEL = {
  comfortable: '额度充足',
  tight: '额度紧张',
  low: '额度不足',
  burned: '额度燃尽',
};

/**
 * 距 5 小时额度刷新还有多少分钟。取不到刷新时间时返回 null。
 *
 * 与 Rust `minutes_to_reset()`、Python `_minutes_to_reset()` 同一口径：
 * 已过去的时间按 0 算。
 */
function minutesToReset(fiveHour, nowMs) {
  const reset = fiveHour?.resetTimeMs;
  if (typeof reset !== 'number' || !Number.isFinite(reset)) return null;
  return Math.max(0, (reset - nowMs) / 60_000);
}

/**
 * 四档红绿灯分档。与 Rust `quota_level()` 逐行对应。
 *
 * 燃尽档由 used >= total 判定，**不可配** —— 它是事实，不是阈值。
 */
function quotaLevel(used, total, unlimited, tight, low) {
  if (unlimited || total <= 0) return 'comfortable';
  if (used >= total) return 'burned';
  const ratio = (used / total) * 100;
  if (ratio >= low) return 'low';
  if (ratio >= tight) return 'tight';
  return 'comfortable';
}

/** 是否达到触发线。不限量和总量为 0 都不触发。 */
function isTriggered(used, total, unlimited, triggerPercent = DEFAULT_QUOTA_TRIGGER_PERCENT) {
  if (unlimited || total <= 0) return false;
  return used >= (total * triggerPercent) / 100;
}

function parseQuota(payload, triggerPercent = DEFAULT_QUOTA_TRIGGER_PERCENT) {
  const models = payload?.model_remains ?? [];
  const general =
    models.find((m) => m?.model_name === 'general') ?? models.find((m) => m?.model_name) ?? null;
  if (!general) return null;
  const total = percent(general.current_interval_total_percent) || 100;
  const used = percent(general.current_interval_used_percent);
  const weeklyTotal = percent(general.current_weekly_total_percent) || 100;
  const weeklyUsed = percent(general.current_weekly_used_percent);
  const weeklyUnlimited = general.current_weekly_status === 3;
  return {
    fiveHour: {
      usedPercent: used,
      totalPercent: total,
      remainingPercent: Math.max(0, (total - used) / total) * 100,
      exhausted: general.current_interval_status !== 3 && total > 0 && used >= total,
      unlimited: general.current_interval_status === 3,
      // 决策用：到触发线（默认 99%）即视为「该动手了」
      triggered: isTriggered(used, total, general.current_interval_status === 3, triggerPercent),
      resetTimeMs: general.end_time ?? null,
    },
    weekly: {
      usedPercent: weeklyUsed,
      totalPercent: weeklyTotal,
      unlimited: weeklyUnlimited,
      exhausted: !weeklyUnlimited && weeklyTotal > 0 && weeklyUsed >= weeklyTotal,
      // 周限额此前没有这个字段，导致 Node 侧忽略了周限额耗尽 —— 与 Rust/Python 不一致
      triggered: isTriggered(weeklyUsed, weeklyTotal, weeklyUnlimited, triggerPercent),
      resetTimeMs: general.weekly_end_time ?? null,
    },
  };
}

/**
 * 重置卡的使用流水。
 *
 * 关键点：`create_time` 是**必填**参数，桌面端就是那样调的。
 * 传 `create_time=0` 表示不限起始时间；传一个具体时间戳反而会返回
 * 2013 invalid params —— 那是一条**错误**，不是「没有记录」。
 * 曾经把这条错误读成 total=0，因而误判「一张卡都没用过」。
 */
// ── 决策：先过期先用 ──────────────────────────────────────────────────────────
const SOURCE_NAME = { platform: '平台积分', code: 'Code 积分', card: '重置卡' };

/**
 * 跨三类来源比较到期时间：平台积分池、Code 积分明细、重置卡。
 *
 * 只有「最早到期的积分」与「最早到期的重置卡」直接可比——
 * 决定用不用卡，看的是哪一边更快作废：
 *   卡先过期 → 用卡把额度重置回来，把更耐放的积分留着；
 *   积分先过期 → 不用卡，让积分自然消耗完，卡留到以后更划算的时候。
 */
/**
 * @param creditDataComplete 积分数据是否**完整读到**。
 *
 * ⚠️ 2026-10-19 PR #28 review 修：读不到 ≠ 没有。
 * 之前 `credit/details` 失败会返回 null ⇒ codeCredits 为空 ⇒
 * `decide` 看到「没有积分」⇒ 结论从「留卡」翻转成「用卡」。
 * 而扣卡是**真实写操作** —— 把网络故障当成业务状态会误扣真卡。
 * ⇒ 数据不完整时一律**不做写操作**（动作降为 wait），只如实报出来。
 */
function decide(
  { platformPools, codeCredits, cards, quota, creditDataComplete = true },
  nowMs = Date.now(),
) {
  const now = nowMs;
  const liveCards = cards.filter((c) => !c.expired && c.outBizNo && c.sourceType);
  const liveCredits = [...platformPools, ...codeCredits].filter(
    (c) => c.balance > 0 && c.expireTimeMs && c.expireTimeMs > now,
  );

  const earliestCard = liveCards[0] ?? null;
  const earliestCredit = liveCredits.sort(
    (a, b) => (a.expireTimeMs ?? Infinity) - (b.expireTimeMs ?? Infinity),
  )[0] ?? null;

  const cardExpire = earliestCard?.expireTimeMs ?? null;
  const creditExpire = earliestCredit?.expireTimeMs ?? null;
  const creditName = earliestCredit ? SOURCE_NAME[earliestCredit.source] : '积分';

  let action = 'wait';
  let reason = '';
  let usedCard = false;

  // 「等级」与「动作」是两个独立维度：动作说**该做什么**，等级说**额度还剩多少**。
  // 混在一起的话，93% 已经紧张时页面徽章仍会写「额度充足」——那就是误导。
  // 等级必须在这里算一次并随判定一起下发，页面才有依据上色。
  const cfg = loadConfig();
  const { quotaLevels } = cfg;
  const level = quota
    ? quotaLevel(
        quota.fiveHour.usedPercent,
        quota.fiveHour.totalPercent,
        quota.fiveHour.unlimited,
        quotaLevels.tight,
        quotaLevels.low,
      )
    : 'comfortable';

  // ── 5 小时额度即将自己刷新 → 不烧重置卡（纯浪费）──
  // 与 Rust `minutes_to_reset()` 同一口径。
  const resetInMin = minutesToReset(quota?.fiveHour, now);
  const skipMinutes = Number(cfg.cardSkipBeforeResetMinutes ?? DEFAULT_CARD_SKIP_BEFORE_RESET_MINUTES);
  const skipCardReason =
    skipMinutes > 0 && resetInMin !== null && resetInMin <= skipMinutes
      ? `5 小时额度 ${resetInMin.toFixed(0)} 分钟后刷新，暂不消耗重置卡`
      : null;

  if (!quota) {
    reason = '未获取到额度状态';
  } else if (!quota.fiveHour.triggered && !quota.weekly.triggered) {
    action = 'idle';
    // 等级词随分档走，而不是永远写「额度充足」——
    // 否则用量 92% 时页面上仍显示「额度充足」，是误导。
    // 把触发线也说进来：否则「额度不足但暂不需要处理」看起来自相矛盾。
    // burned 永远不会出现在这里：它必然已 triggered，走的是下面用卡/留卡分支。
    reason = `${LEVEL_LABEL[level]}（5 小时已用 ${quota.fiveHour.usedPercent.toFixed(0)}%），未到 ${cfg.cardTriggerPercent}% 触发线，暂不动用重置卡`;
  } else if (!creditDataComplete) {
    // 积分数据没读全 ⇒ 无法判断「卡先过期还是积分先过期」
    // ⇒ 绝不做写操作（扣卡是真实消耗，宁可等下一轮）。
    action = 'wait';
    reason = '积分数据读取不完整，本轮不执行写操作（等下一轮重新判定）';
  } else if (!earliestCredit) {
    // 没有可消耗的积分，只能靠卡把额度重置回来
    if (earliestCard) {
      // 额度马上要自己刷新了，就别烧卡了
      if (skipCardReason) {
        action = 'wait';
        reason = skipCardReason;
      } else {
        action = 'use-card';
        usedCard = true;
        reason = '没有可用积分，使用重置卡重置额度';
      }
    } else {
      action = 'wait';
      reason = '额度已耗尽，既没有积分也没有可用的重置卡';
    }
  } else if (!earliestCard) {
    action = 'use-credit';
    reason = `没有可用的重置卡，让${creditName}（${fmtDay(creditExpire)}到期）先消耗`;
  } else if (cardExpire < creditExpire) {
    // 额度马上要自己刷新了，就别烧卡了
    if (skipCardReason) {
      action = 'wait';
      reason = skipCardReason;
    } else {
      action = 'use-card';
      usedCard = true;
      reason = `重置卡（${fmtDay(cardExpire)}）比${creditName}（${fmtDay(creditExpire)}）先过期，先用卡保住积分`;
    }
  } else {
    action = 'use-credit';
    reason = `${creditName}（${fmtDay(creditExpire)}）比重置卡（${fmtDay(cardExpire)}）先过期，不用卡，让积分先消耗`;
  }

  return {
    action,
    usedCard,
    reason,
    // 等级随判定一起下发：页面据此给徽章上色，不再自己猜。
    level,
    // 距 5 小时额度刷新的倒计时（分钟）。页面直接显示，不用自己算。
    resetInMinutes: resetInMin,
    // 距刷新不足这个分钟数时**不建议用卡** —— 页面要说出来，
    // 否则用户看到「额度快没了却不建议用卡」会以为坏了。
    cardSkipBeforeResetMinutes: skipMinutes,
    skipCardActive: Boolean(skipCardReason),
    target:
      usedCard && earliestCard
        ? {
            cardId: earliestCard.cardId,
            sourceType: earliestCard.sourceType,
            outBizNo: earliestCard.outBizNo,
            expireTimeMs: cardExpire,
          }
        : null,
    earliestCardExpireMs: cardExpire,
    earliestCreditExpireMs: creditExpire,
    earliestCreditSource: earliestCredit?.source ?? null,
    earliestCreditLabel: earliestCredit?.label ?? null,
    triggered: Boolean(quota && (quota.fiveHour.triggered || quota.weekly.triggered)),
    exhausted: Boolean(quota && (quota.fiveHour.exhausted || quota.weekly.exhausted)),
  };
}

function fmtDay(ms) {
  if (!ms) return '未知';
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ── 分层缓存 ──────────────────────────────────────────────────────────────────
/**
 * 按接口的「变化速度」分层缓存，直接砍掉无谓的网络往返。
 *
 * 实测依据（单轮 5 个接口共 ~19.8 KB / ~1.05s，其中 5 个串行等待是大头）：
 *   额度用量   每轮必取 —— 消耗在变，是所有联动的触发源
 *   积分明细   60s      —— 81 笔里绝大多数只在被消耗时才动
 *   重置卡     300s     —— 按天签到产生，变化极慢
 *   平台积分池 300s     —— 同上
 *   账户汇总   600s     —— 只在签到/充值后变
 *
 * 过期未取数时回落到上一次成功结果，宁可显示略旧的数据，也不让看板空白。
 */
const TTL = {
  quota: 0,
  codeCredits: 60_000,
  cards: 300_000,
  platform: 300_000,
  membership: 600_000,
  cardFlows: 120_000,
};

const cache = {
  quota: { value: null, at: 0 },
  codeCredits: { value: null, at: 0 },
  cards: { value: null, at: 0 },
  platform: { value: null, at: 0 },
  membership: { value: null, at: 0 },
  cardFlows: { value: null, at: 0 },
};

/** 带 TTL 与陈旧回落的取值：命中则零网络，未命中才请求。 */
async function cached(slot, loader) {
  const entry = cache[slot];
  const now = Date.now();
  if (entry.value !== null && now - entry.at < TTL[slot]) {
    return { value: entry.value, fromCache: true };
  }
  try {
    const value = await loader();
    if (value !== null && value !== undefined) {
      entry.value = value;
      entry.at = now;
      return { value, fromCache: false };
    }
    // 本轮失败：用旧值兜底，别把上次的正常数据清掉
    return { value: entry.value, fromCache: true };
  } catch {
    return { value: entry.value, fromCache: true };
  }
}

function invalidateCache(slot) {
  if (slot) cache[slot].at = 0;
  else for (const key of Object.keys(cache)) cache[key].at = 0;
}

// ── 快照 ──────────────────────────────────────────────────────────────────────
/**
 * 同一时刻只允许一次真实取数。
 *
 * SSE 轮询与自动判定会各自调用 buildSnapshot，若不合并就会把
 * 每轮的接口数翻倍。这里让并发的调用共享同一个 in-flight Promise。
 */
let inflightSnapshot = null;
/** 上一次成功的快照：取数失败时回退用，避免整页被打空。 */
let lastGoodSnapshot = null;

function buildSnapshot() {
  if (inflightSnapshot) return inflightSnapshot;
  inflightSnapshot = doBuildSnapshot().finally(() => {
    inflightSnapshot = null;
  });
  return inflightSnapshot;
}

async function doBuildSnapshot() {
  // 数据来源：**本地账本**（不读宿主凭据、不调账号接口、不碰宿主数据库）。
  const read = readLedger();
  if (!read.ok) {
    // ⚠️ 读不到账本 ⇒ 数据不完整 ⇒ 决策走 wait。
    //    绝不能当成「没有积分、没有卡」⇒ 那会把结论翻转成「用卡」。
    const err = new Error(read.error);
    err.ledgerUnavailable = true;
    throw err;
  }
  const now = Date.now();
  const triggerPercent = loadConfig().cardTriggerPercent;
  const { platformPools, codeCredits, cards, creditDataComplete } = ledgerInputs(read.ledger, now);
  const quota = ledgerQuota(read.ledger?.quota, triggerPercent);

  const decision = decide({
    platformPools,
    codeCredits: codeCredits.items,
    cards,
    quota,
    creditDataComplete,
  });

  const soon7 = expiringWithin(codeCredits.items, 7, now);
  const soon30 = expiringWithin(codeCredits.items, 30, now);
  const sumBalance = (list) => list.reduce((s, d) => s + d.balance, 0);

  return {
    fetchedAtMs: now,
    // 数据来自本地账本，没有「接口缓存」这一层 ⇒ 恒为新鲜。
    fresh: {
      quota: true,
      codeCredits: true,
      cards: true,
      platform: true,
      membership: true,
    },
    // 账本自带的时间戳：用户最后一次更新账本是什么时候。
    ledgerUpdatedAtMs: Number(read.ledger?.updatedAtMs ?? 0) || null,
    creditSummary: null,
    platformCredits: {
      total: sumBalance(platformPools),
      used: 0,
      remaining: sumBalance(platformPools),
      fallbackEnabled: false,
      pools: platformPools,
    },
    codeCredits: {
      available: creditDataComplete,
      totalCount: codeCredits.totalCount,
      liveBalance: codeCredits.liveBalance,
      lostBalance: codeCredits.lostBalance,
      active: codeCredits.items.filter((d) => !d.expired && d.balance > 0),
      lost: codeCredits.items.filter((d) => d.expired && d.balance > 0),
      usedUp: (() => {
        const zero = codeCredits.items.filter((d) => d.balance <= 0);
        return {
          count: zero.length,
          consumed: zero.reduce((sum, d) => sum + d.consumed, 0),
          expiredCount: zero.filter((d) => d.expired).length,
        };
      })(),
    },
    expiry: {
      soon7Count: soon7.length,
      soon7Balance: sumBalance(soon7),
      soon30Count: soon30.length,
      soon30Balance: sumBalance(soon30),
      nextExpireMs: codeCredits.items.find((d) => !d.expired && d.balance > 0)?.expireTimeMs ?? null,
    },
    quota,
    cards: {
      total: cards.length,
      live: cards.filter((c) => !c.expired).length,
      items: cards
        .filter((c) => !c.expired)
        .slice(0, 12)
        .map((c, i) => ({ index: i + 1, expireTimeMs: c.expireTimeMs })),
      raw: cards
        .filter((c) => !c.expired)
        .map((c) => ({
          cardId: c.cardId,
          sourceType: c.sourceType,
          outBizNo: c.outBizNo,
          expireTimeMs: c.expireTimeMs,
        })),
    },
    cardUsage: { available: false, usedCount: null, grantedCount: null, lastUsedAtMs: null },
    decision,
  };
}

// ── 自动刷新（只读：重算结论并推给页面，不做任何写操作）─────────────────────────
/** 自动判定间隔的允许范围：最快 5 秒（够灵敏），最慢 60 分钟（够省心）。 */
const AUTO_MIN_MS = 5_000;
const AUTO_MAX_MS = 60 * 60 * 1000;
const AUTO_DEFAULT_MS = 15_000;

function clampAutoInterval(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return AUTO_DEFAULT_MS;
  return Math.min(AUTO_MAX_MS, Math.max(AUTO_MIN_MS, Math.round(n)));
}

const state = {
  autoEnabled: true,   // 默认开启：定时把最新结论推到页面上
  autoIntervalMs: AUTO_DEFAULT_MS,
  lastResult: null,
  autoRuns: [],
  lastAutoAtMs: 0,
};

/**
 * 自动刷新一轮：重算结论 → 推给页面 → 记一笔。
 *
 * ⚠️ v2.0（裁剪版）：**只读**。它不扣卡、不暂停任何东西 ——
 * 扣卡是不可逆的真实消耗，必须由用户在面板上点确认。
 * 这里只负责把「现在该怎么做」的结论及时送到页面上。
 */
async function autoTick(reason) {
  const snapshot = await buildSnapshot();
  state.lastAutoAtMs = Date.now();
  broadcast(snapshot, { incremental: true });
  const entry = {
    outcome: 'OK',
    atMs: state.lastAutoAtMs,
    reason,
    action: snapshot?.decision?.action ?? null,
    decisionReason: snapshot?.decision?.reason ?? null,
  };
  state.autoRuns = [entry, ...state.autoRuns].slice(0, 8);
  return entry;
}


// ── 后台守护进程管理（launchd）────────────────────────────────────────────────
/**
 * 后台服务由 launchd 常驻，关闭本页面后仍会运行 ——
 * 这正是它与页面内 SSE 自动判定的区别。
 */
const DAEMON_LABEL = 'com.local.mcode-reset-card';
const DAEMON_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${DAEMON_LABEL}.plist`);

async function run(cmd, args) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', (e) => resolve({ code: -1, out: String(e) }));
  });
}

/** 后台服务当前是否在跑（读 launchd 已加载的作业表）。 */
async function daemonStatus() {
  const { existsSync } = await import('node:fs');
  const installed = existsSync(DAEMON_PLIST);
  if (!installed) return { installed: false, running: false, pid: null, label: DAEMON_LABEL };

  // 注意：`launchctl list <label>` 返回的是 plist 文本（含 "PID" = 123;），
  // 只有不带参数才是表格行（PID<TAB>STATUS<TAB>LABEL）。这里要表格形式。
  const r = await run('launchctl', ['list']);
  const line = r.out
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.endsWith(DAEMON_LABEL));
  const running = Boolean(line);
  const pid = running ? Number.parseInt(line.split(/\s+/)[0], 10) || null : null;
  return { installed: true, running, pid, label: DAEMON_LABEL };
}

/** 启停后台服务。launchctl 的动词是 load / unload。 */
async function controlDaemon(action) {
  const status = await daemonStatus();
  if (!status.installed) {
    return { ok: false, message: `未安装后台服务（缺少 ${DAEMON_PLIST}）`, ...status };
  }

  if (action === 'start') {
    if (status.running) return { ok: true, message: '后台服务已在运行', ...(await daemonStatus()) };
    const r = await run('launchctl', ['load', DAEMON_PLIST]);
    if (r.code !== 0) {
      return { ok: false, message: `启动失败：${r.out.trim() || `launchctl exit ${r.code}`}`, ...(await daemonStatus()) };
    }
  } else if (action === 'stop') {
    if (!status.running) return { ok: true, message: '后台服务本就未运行', ...(await daemonStatus()) };
    const r = await run('launchctl', ['unload', DAEMON_PLIST]);
    if (r.code !== 0) {
      return { ok: false, message: `停止失败：${r.out.trim() || `launchctl exit ${r.code}`}`, ...(await daemonStatus()) };
    }
  } else {
    const verb = status.running ? 'unload' : 'load';
    const r = await run('launchctl', [verb, DAEMON_PLIST]);
    if (r.code !== 0) {
      return { ok: false, message: `重启失败：${r.out.trim()}`, ...(await daemonStatus()) };
    }
  }

  // 给 launchd 一点时间拉起/回收
  await new Promise((r) => setTimeout(r, 600));
  const after = await daemonStatus();
  const label = { start: '已启动', stop: '已停止', restart: '已重启' }[action];
  return {
    ok: action === 'stop' ? !after.running : after.running,
    message: action === 'stop'
      ? (after.running ? '停止未生效' : '后台服务已停止')
      : (after.running ? `${label}（PID ${after.pid}）` : `${label}失败`),
    ...after,
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
const json = (response, status, body) => {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  response.end(text);
};

// ── SSE 实时推送 ─────────────────────────────────────────────────────────────
/**
 * 只在有页面连接时轮询，且只在数据**真的变化**时推送。
 *
 * 为什么不直接高频轮询：每次快照要打 5 个接口，高频轮询既浪费也容易被限流。
 * 这里用一个轻量签名（关键数字 + 决策）比对，没变就不打扰页面。
 */
const sseClients = new Set();
let sseTimer = null;
let lastSignature = null;
/** 上次推给页面的明细分区签名，用来只发变化的部分 */
let lastParts = { lostSig: '', activeSig: '', usedSig: '' };

/** 分区签名：只取会影响展示的字段，忽略顺序。 */
function partSignature(list) {
  return list
    .map((d) => `${d.expireTimeMs}:${d.balance}:${d.granted}:${d.consumed}`)
    .join(',');
}

/** 构造比对签名：只取会影响展示的关键字段，忽略时间戳。 */
function signatureOf(s) {
  const d = s.decision || {};
  const e = s.expiry || {};
  const c = s.codeCredits || {};
  return [
    Math.round(c.liveBalance ?? 0),
    Math.round(c.lostBalance ?? 0),
    c.expiredCount ?? 0,
    e.soon7Count ?? 0,
    Math.round(e.soon7Balance ?? 0),
    Math.round(s.quota?.fiveHour?.remainingPercent ?? 0),
    s.quota?.fiveHour?.triggered ?? null,
    s.quota?.fiveHour?.usedPercent ?? null,
    s.cards.live ?? 0,
    d.action ?? '',
    // 等级跨档时徽章颜色会变，即使动作没变也要推一帧
    d.level ?? '',
    d.target?.cardId ?? '',
    s.autoEnabled ?? state.autoEnabled,
  ].join('|');
}

/**
 * 裁掉本轮没有变化的明细分区。
 * 已过期记录（通常占整包 60%+）一旦推过就不再重发。
 */
function withIncremental(snapshot) {
  const c = snapshot.codeCredits;
  if (!c) return snapshot;
  const lostSig = partSignature(c.lost ?? []);
  const activeSig = partSignature(c.active ?? []);
  const usedSig = c.usedUp ? `${c.usedUp.count}:${Math.round(c.usedUp.consumed)}` : '';
  const out = { ...snapshot, codeCredits: { ...c } };
  if (lostSig === lastParts.lostSig) delete out.codeCredits.lost;
  if (activeSig === lastParts.activeSig) delete out.codeCredits.active;
  if (usedSig === lastParts.usedSig) delete out.codeCredits.usedUp;
  return out;
}

function rememberParts(snapshot) {
  const c = snapshot.codeCredits;
  if (!c) return;
  lastParts = {
    lostSig: partSignature(c.lost ?? []),
    activeSig: partSignature(c.active ?? []),
    usedSig: c.usedUp ? `${c.usedUp.count}:${Math.round(c.usedUp.consumed)}` : '',
  };
}

function broadcast(snapshot, { incremental = false } = {}) {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(incremental ? withIncremental(snapshot) : snapshot)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

async function pollOnce() {
  try {
    const snapshot = await buildSnapshot();
    snapshot.autoEnabled = state.autoEnabled;
    snapshot.lastResult = state.lastResult;
    snapshot.autoRuns = state.autoRuns.slice(0, 8);
    // SSE 推送也要带 config —— 否则页面上的进度条只能退回写死的分界点，
    // 出现「徽章按新阈值上色、进度条按旧阈值上色」的自相矛盾。
    const { config, issues } = readConfig();
    snapshot.config = config;
    snapshot.configIssues = issues;
    const sig = signatureOf(snapshot);
    if (sig !== lastSignature) {
      lastSignature = sig;
      broadcast(snapshot, { incremental: true });
      rememberParts(snapshot);
    }
  } catch {
    // 单轮失败不终止轮询；下一轮继续
  }
}

function startSsePolling() {
  if (sseTimer) return;
  void pollOnce(); // 立刻来一次，让页面马上拿到当前状态
  // 有了分层缓存，每轮只打「额度用量」一个接口（TTL=0），
  // 15 秒一轮的开销远小于原来 30 秒打 5 个接口。
  sseTimer = setInterval(() => void pollOnce(), 15_000);
  sseTimer.unref?.();
}

function stopSsePolling() {
  if (!sseTimer) return;
  clearInterval(sseTimer);
  sseTimer = null;
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  // 注入 Host 日志出口，供模块级的重试辅助函数使用（见 hostLogger 注释）。
  hostLogger = context.logger ?? null;
  const clientHtml = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));

  // ── local MCP 端点 ──
  //
  // 声明了 `mcpEndpoints` 就必须真的实现它：Host 发布时会用
  // `initialize` + `tools/list` 探活，探不通就发布失败。
  //
  // ⚠️ 两个工具都只读：v2.0 不扣卡、不做任何写操作，MCP 也只给状态和建议。
  const handleMcp = createMcpHandler({
    status: async () => {
      // 账本读不到时不让整个工具失败：额度与判定置 null，原因放进 quotaError。
      let snapshot = null;
      let quotaError = null;
      try {
        snapshot = await buildSnapshot();
      } catch (e) {
        quotaError = String(e?.message ?? e);
      }
      return {
        quota: snapshot?.quota ?? null,
        decision: snapshot?.decision ?? null,
        cards: snapshot?.cards ?? null,
        quotaError,
        ledgerUpdatedAtMs: snapshot?.ledgerUpdatedAtMs ?? null,
      };
    },
    decide: async () => {
      const snapshot = await buildSnapshot();
      return {
        action: snapshot.decision?.action,
        reason: snapshot.decision?.reason,
        target: snapshot.decision?.target ?? null,
      };
    },
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');

    if (request.method === 'GET' && url.pathname === '/dashboard') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(clientHtml);
      return;
    }

    // ⚠️ 两条路径都挂同一个 handler。
    //
    // 原因：Host 的「已发布快照」是粘的 —— 它记着**上一版**声明的
    // `mcpEndpoints.path`，发布时会用**旧 path** 拼 URL 去探活
    // （`rewriteManagedMcpServers` 里 `new URL(replacement.path, replacement.origin)`，
    // path 来自 accepted，不来自新 manifest）。
    // ⇒ 新旧路径都得能响应，否则发布会被 `MCP_PUBLICATION_INVALID` 挡下。
    // ⚠️ 端点只保留一个（`expiry-guardian`）。
    // 旧版本还挂过 `/mcp/minimax-bot` 这条路径（当时的 manifest 声明过它），
    // 现在 manifest 与 `servers.mcp.json` 都只声明 `expiry-guardian` 一个端点，
    // 留着旧路径只会让人以为本插件抢了官方插件的名字 ⇒ 删掉。
    if (url.pathname === '/mcp/expiry-guardian') {
      const bodyPromise = request.method === 'POST' ? readJsonBody(request) : Promise.resolve(undefined);
      bodyPromise
        .then((body) => handleMcp(request, response, body))
        .catch(() => {
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'mcp handler failed' }));
        });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/stream') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      sseClients.add(response);
      startSsePolling();
      const cleanup = () => {
        sseClients.delete(response);
        if (sseClients.size === 0) stopSsePolling();
      };
      request.on('close', cleanup);
      request.on('error', cleanup);
      // 先补一次当前状态，页面无需再单独请求 /api/state
      buildSnapshot()
        .then((snapshot) => {
          snapshot.autoEnabled = state.autoEnabled;
          snapshot.autoIntervalMs = state.autoIntervalMs;
          snapshot.lastResult = state.lastResult;
          snapshot.autoRuns = state.autoRuns.slice(0, 8);
          const { config, issues } = readConfig();
          snapshot.config = config;
          snapshot.configIssues = issues;
          lastSignature = signatureOf(snapshot);
          rememberParts(snapshot);
          response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
        })
        .catch((error) => {
          response.write(`data: ${JSON.stringify({ error: describe(error) })}\n\n`);
        });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      buildSnapshot()
        .then((snapshot) => {
          snapshot.autoEnabled = state.autoEnabled;
          snapshot.autoIntervalMs = state.autoIntervalMs;
          snapshot.lastResult = state.lastResult;
          snapshot.autoRuns = state.autoRuns.slice(0, 8);
          // 共享配置原样下发，页面据此回显真实的阈值设置。
          // 实际生效由 Rust 守护进程每轮重读同一文件决定，这里只负责读写与展示。
          const { config, issues } = readConfig();
          snapshot.config = config;
          snapshot.configIssues = issues;
          lastGoodSnapshot = snapshot;
          json(response, 200, snapshot);
        })
        .catch((error) => {
          // 一次取数失败不该把整个看板打空。
          // 回退到**上一次成功的快照**，并把错误作为 staleError 附带上去 ——
          // 页面据此显示一条提示，而不是整页变成「连接失败」。
          const degraded = lastGoodSnapshot
            ? { ...lastGoodSnapshot, staleError: describe(error) }
            : { error: describe(error) };
          json(response, 200, degraded);
        });
      return;
    }

    // ── 本地账本：插件的唯一数据源 ──
    //
    // 社区插件不能读宿主凭据、不碰宿主数据库 ⇒ 额度/积分/重置卡的信息
    // 全部来自这份**用户自己维护**的账本。面板在这里读/写它。
    if (url.pathname === '/api/ledger') {
      if (request.method === 'GET') {
        const read = readLedger();
        if (!read.ok) {
          json(response, 200, { ok: false, path: LEDGER_PATH, error: read.error, ledger: null });
          return;
        }
        json(response, 200, { ok: true, path: LEDGER_PATH, ledger: read.ledger });
        return;
      }
      if (request.method === 'POST') {
        readJsonBody(request)
          .then((body) => {
            const ledger = body?.ledger ?? body;
            if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
              throw new Error('账本必须是一个 JSON 对象');
            }
            // 写入前做最基本的形状校验：宁可拒绝，也不要存一份坏账本
            // （坏账本会让决策得出错误结论）。
            if (ledger.credits !== undefined && !Array.isArray(ledger.credits)) {
              throw new Error('credits 必须是数组');
            }
            if (ledger.cards !== undefined && !Array.isArray(ledger.cards)) {
              throw new Error('cards 必须是数组');
            }
            const next = { ...ledger, updatedAtMs: Date.now() };
            const dir = dirname(LEDGER_PATH);
            mkdirSync(dir, { recursive: true });
            // 原子写：先写临时文件再 rename ⇒ 不会读到半份账本。
            const tmp = `${LEDGER_PATH}.${process.pid}.tmp`;
            writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
            renameSync(tmp, LEDGER_PATH);
            json(response, 200, { ok: true, path: LEDGER_PATH, ledger: next });
          })
          .catch((error) => json(response, 200, { ok: false, error: describe(error) }));
        return;
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      const { config, issues } = readConfig();
      json(response, 200, { config, issues });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/config') {
      // 改共享配置。守护进程每轮重读该文件，所以改完下一轮（约 1 分钟内）就生效，
      // 不需要重启 —— 但仍如实告诉用户「是否需要重启才生效」由谁决定。
      const { config, issues } = readConfig();
      const next = { ...config };

      const rawSkip = url.searchParams.get('cardSkipBeforeResetMinutes');
      if (rawSkip !== null) next.cardSkipBeforeResetMinutes = Number(rawSkip);
      const rawCardTrigger = url.searchParams.get('cardTriggerPercent');
      if (rawCardTrigger !== null) next.cardTriggerPercent = Number(rawCardTrigger);
      const rawTight = url.searchParams.get('tight');
      if (rawTight !== null) next.quotaLevels = { ...next.quotaLevels, tight: Number(rawTight) };
      const rawLow = url.searchParams.get('low');
      if (rawLow !== null) next.quotaLevels = { ...next.quotaLevels, low: Number(rawLow) };

      const { config: saved, issues: saveIssues } = normalizeConfig(next);
      try {
        writeConfig(saved);
      } catch (e) {
        json(response, 500, { error: `写入配置失败：${e.message}` });
        return;
      }
      json(response, 200, {
        config: saved,
        cardTriggerPercent: saved.cardTriggerPercent,
        issues: [...issues, ...saveIssues],
        note: '配置已写入，Rust 守护进程每轮重读，通常 1 分钟内生效',
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/daemon') {
      // 启停后台守护进程（launchd 常驻）。关掉本页面后它照常运行。
      const action = url.searchParams.get('action');
      if (action !== 'start' && action !== 'stop' && action !== 'restart') {
        json(response, 400, { error: 'invalid_action' });
        return;
      }
      controlDaemon(action)
        .then((result) => json(response, 200, result))
        .catch((error) => json(response, 200, { ok: false, message: describe(error) }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/daemon') {
      daemonStatus()
        .then((result) => json(response, 200, result))
        .catch((error) => json(response, 200, { installed: false, running: false, message: describe(error) }));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auto-interval') {
      // 手动调整检测间隔：立即生效并重建定时器，无需重启
      state.autoIntervalMs = clampAutoInterval(url.searchParams.get('ms'));
      scheduleAuto();
      json(response, 200, {
        autoIntervalMs: state.autoIntervalMs,
        minMs: AUTO_MIN_MS,
        maxMs: AUTO_MAX_MS,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auto') {
      // 开关只切换本地状态；开启时立刻跑一轮判定，不直接扣卡
      state.autoEnabled = url.searchParams.get('enabled') === '1';
      const rawMs = url.searchParams.get('intervalMs');
      if (rawMs !== null) state.autoIntervalMs = clampAutoInterval(rawMs);
      scheduleAuto();
      if (state.autoEnabled) {
        autoTick('开关开启')
          .then((entry) =>
            json(response, 200, {
              autoEnabled: state.autoEnabled,
              autoIntervalMs: state.autoIntervalMs,
              firstRun: entry,
            }),
          )
          .catch((error) =>
            json(response, 200, {
              autoEnabled: state.autoEnabled,
              autoIntervalMs: state.autoIntervalMs,
              firstRun: { outcome: 'ERROR', message: describe(error) },
            }),
          );
        return;
      }
      json(response, 200, { autoEnabled: false, autoIntervalMs: state.autoIntervalMs });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auto-run') {
      autoTick('手动触发')
        .then((entry) => json(response, 200, entry))
        .catch((error) => json(response, 200, { outcome: 'ERROR', message: describe(error) }));
      return;
    }

    json(response, 404, { error: 'not_found' });
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('expiryGuardian.listening');

  let disposed = false;
  let autoTimer = null;

  /**
   * 自动判定定时器：间隔可由页面设置，随时重建。
   * 关闭时不启动定时器，避免无意义唤醒。
   */
  function scheduleAuto() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
    if (!state.autoEnabled || disposed) return;
    autoTimer = setInterval(() => {
      autoTick('定时').catch((error) => context.logger.warn('autoTick failed', { error: describe(error) }));
    }, state.autoIntervalMs);
    autoTimer.unref?.();
  }

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (autoTimer) clearInterval(autoTimer);
    stopSsePolling();
    // 结束所有 SSE 长连接，否则 server.close() 会一直等它们断开
    for (const res of sseClients) {
      try {
        res.end();
      } catch {
        // 已断开的连接忽略
      }
    }
    sseClients.clear();
    context.signal.removeEventListener('abort', onAbort);
    await close(server);
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  const disposeAll = () => {
    void dispose();
  };
  context.signal.removeEventListener('abort', onAbort);
  context.signal.addEventListener('abort', disposeAll, { once: true });

  return { dispose: disposeAll };
}

/**
 * 读一个 JSON 请求体。
 *
 * MCP 的 `tools/call` 会带参数；解析失败时返回 undefined（让上层按
 * 「Invalid Request」处理，而不是把整个连接搞崩）。
 *
 * @param {any} request
 * @returns {Promise<any>}
 */
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      // MCP 请求很小；给个上限防止被撑爆。
      if (size > 1_000_000) return undefined;
      chunks.push(chunk);
    }
  } catch {
    return undefined;
  }
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

function describe(error) {
  if (error?.message) return String(error.message);
  return '请求失败，请稍后重试';
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
