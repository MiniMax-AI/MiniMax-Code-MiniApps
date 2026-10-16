// @ts-check
/**
 * 蹬王之王 — 积分与重置卡的到期决策看板。
 *
 * 数据源（全部经实测确认，非推测）。两套 API 分属不同域名：
 *
 *   开放平台积分 → www.minimaxi.com
 *     GET  /backend/account/token_plan_credit      → 余额 + 各积分池到期时间
 *     GET  /backend/account/token_plan/remains_percent → 5小时/周额度用量
 *     GET  /backend/account/reset_card/list        → 重置卡与到期时间
 *     POST /backend/account/reset_card/use          → 使用一张重置卡
 *
 *   MiniMax Code 积分 → agent.minimaxi.com
 *     GET  /minimax-cloud/api/v1/credit/details    → 逐笔授予/消耗/到期明细
 *
 * 决策规则：把「最早到期的积分」（平台或 Code 任一）与「最早到期的重置卡」比，
 * 谁先过期先用谁。积分先过期 → 不用卡，让积分先消耗完；重置卡先过期 → 用卡
 * 把额度重置回来，把更耐放的积分留着。
 *
 * 鉴权：与桌面端共用同一登录态，经 OAuth lease socket 取短期 access token。
 * 凭据只在本进程内存中使用，绝不下发给页面、绝不写日志。
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { connect } from 'node:net';
import { homedir } from 'node:os';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */


// ── OAuth lease：与桌面端同一套登录态 ────────────────────────────────────────
const LEASE_SOCK = join(homedir(), '.minimax', 'run', 'mcode-auth-lease-v1.sock');
const LEASE_CAP = join(homedir(), '.minimax', 'run', 'mcode-auth-lease-v1.cap');

function randomId() {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 向桌面端的 lease socket 实时取一个短期 access token。
 * 协议见 packages/oauth-lease-protocol：4 字节大端长度前缀 + JSON。
 * @returns {Promise<string | null>}
 */
function acquireLeaseToken() {
  return new Promise((resolve) => {
    let capability;
    try {
      capability = readFileSync(LEASE_CAP, 'utf8').trim();
    } catch {
      resolve(null);
      return;
    }
    if (!capability) {
      resolve(null);
      return;
    }

    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        requestId: randomId(),
        capability,
        method: 'lease',
        minValidityMs: 120_000,
      }),
      'utf8',
    );
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);

    const socket = connect(LEASE_SOCK);
    const chunks = [];
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(5000);
    socket.on('error', () => finish(null));
    socket.on('timeout', () => finish(null));
    socket.on('connect', () => socket.write(frame));
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (buf.length < 4) return;
      const size = buf.readUInt32BE(0);
      if (buf.length < 4 + size) return;
      try {
        const response = JSON.parse(buf.subarray(4, 4 + size).toString('utf8'));
        const result = response?.result;
        if (response?.ok && result?.method === 'lease' && typeof result.accessToken === 'string') {
          finish(result.accessToken);
          return;
        }
        finish(null);
      } catch {
        finish(null);
      }
    });
  });
}

/**
 * token 复用：lease token 有效期约 40 分钟，没必要每轮都开一次 unix socket。
 * 只在过期前 5 分钟才重新取，且同一个 in-flight 请求会被复用（并发去重）。
 */
const TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
let tokenCache = { value: null, at: 0 };
let tokenPending = null;

function getToken() {
  const now = Date.now();
  if (tokenCache.value && now - tokenCache.at < TOKEN_TTL_MS - TOKEN_REFRESH_MARGIN_MS) {
    return Promise.resolve(tokenCache.value);
  }
  // 并发去重：同一时刻只开一个 lease 连接
  if (tokenPending) return tokenPending;
  tokenPending = acquireLeaseToken()
    .then((token) => {
      if (token) {
        tokenCache = { value: token, at: Date.now() };
      }
      return token;
    })
    .finally(() => {
      tokenPending = null;
    });
  return tokenPending;
}

// ── 账号 API ──────────────────────────────────────────────────────────────────
/**
 * 两套账号 API 分属不同域名，实测确认：
 *   开放平台 / 额度 / 重置卡  → www.minimaxi.com（agent 域对这些路径返回 404 或 HTML）
 *   MiniMax Code 积分明细     → agent.minimaxi.com（platform 域返回非 JSON）
 */
const PLATFORM_BASE = 'https://www.minimaxi.com';
const CODE_BASE = 'https://agent.minimaxi.com';

class ApiError extends Error {
  constructor(message, kind = 'business', code) {
    super(message);
    this.kind = kind;
    this.code = code;
  }
}

async function apiGet(path, token, base = PLATFORM_BASE) {
  const response = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'MiniMaxCode',
    },
  });
  if (response.status === 401 || response.status === 403) {
    tokenCache = { value: null, at: 0 };
    throw new ApiError('登录态失效，请重新打开 MiniMax Code', 'unauthorized');
  }
  if (!response.ok) throw new ApiError(`HTTP ${response.status}`, 'network', response.status);
  const payload = await response.json();
  const baseResp = payload?.base_resp;
  if (baseResp && baseResp.status_code !== 0) {
    throw new ApiError(baseResp.status_msg || `code=${baseResp.status_code}`, 'business', baseResp.status_code);
  }
  return payload;
}

/** 部分接口（如 get_membership_info）是 POST，桌面端即如此调用。 */
async function apiPost(path, token, base = CODE_BASE, body = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'MiniMaxCode',
    },
    body: JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403) {
    tokenCache = { value: null, at: 0 };
    throw new ApiError('登录态失效，请重新打开 MiniMax Code', 'unauthorized');
  }
  if (!response.ok) throw new ApiError(`HTTP ${response.status}`, 'network', response.status);
  const payload = await response.json();
  const baseResp = payload?.base_resp;
  if (baseResp && baseResp.status_code !== 0) {
    throw new ApiError(baseResp.status_msg || `code=${baseResp.status_code}`, 'business', baseResp.status_code);
  }
  return payload;
}

async function apiUseResetCard(sourceType, outBizNo, token) {
  const response = await fetch(`${PLATFORM_BASE}/backend/account/reset_card/use`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'MiniMaxCode',
    },
    body: JSON.stringify({ source_type: sourceType, out_biz_no: outBizNo }),
  });
  if (!response.ok) throw new ApiError(`HTTP ${response.status}`, 'network', response.status);
  const payload = await response.json();
  const baseResp = payload?.base_resp;
  if (baseResp && baseResp.status_code !== 0) {
    throw new ApiError(baseResp.status_msg || `code=${baseResp.status_code}`, 'business', baseResp.status_code);
  }
  return String(payload?.outcome || 'UNKNOWN');
}

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
async function fetchCodeCredits(token) {
  const pageSize = 100;
  const collected = [];
  let totalCount = 0;
  for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
    const payload = await apiGet(
      `/minimax-cloud/api/v1/credit/details?page_number=${pageNumber}&page_size=${pageSize}&include_expired=1`,
      token,
      CODE_BASE,
    );
    const details = Array.isArray(payload.details) ? payload.details : [];
    totalCount = Number(payload.total_count ?? collected.length);
    collected.push(...details);
    if (collected.length >= totalCount || details.length < pageSize) break;
  }
  return { payload: { total_count: totalCount, details: collected } };
}

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

function parseQuota(payload) {
  const models = payload?.model_remains ?? [];
  const general =
    models.find((m) => m?.model_name === 'general') ?? models.find((m) => m?.model_name) ?? null;
  if (!general) return null;
  const total = percent(general.current_interval_total_percent) || 100;
  const used = percent(general.current_interval_used_percent);
  return {
    fiveHour: {
      usedPercent: used,
      totalPercent: total,
      remainingPercent: Math.max(0, (total - used) / total) * 100,
      exhausted: general.current_interval_status !== 3 && total > 0 && used >= total,
      unlimited: general.current_interval_status === 3,
      resetTimeMs: general.end_time ?? null,
    },
    weekly: {
      usedPercent: percent(general.current_weekly_used_percent),
      totalPercent: percent(general.current_weekly_total_percent) || 100,
      unlimited: general.current_weekly_status === 3,
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
async function fetchCardFlows(token) {
  try {
    const payload = await apiGet('/backend/account/reset_card/flows?page=1&size=20&create_time=0', token);
    const flows = Array.isArray(payload.flows) ? payload.flows : [];
    const used = flows.filter((f) => f?.event_type === 'USE');
    return {
      available: true,
      total: Number(payload.total ?? flows.length),
      usedCount: used.length,
      grantedCount: flows.filter((f) => f?.event_type === 'GRANT').length,
      lastUsedAtMs: used.length ? Math.max(...used.map((f) => Number(f.create_time) || 0)) : null,
    };
  } catch {
    // 读不到流水时不编数字，交给页面显示「未知」
    return { available: false, total: 0, usedCount: null, grantedCount: null, lastUsedAtMs: null };
  }
}

async function fetchCards(token) {
  const now = Date.now();
  const seen = new Map();
  for (let page = 1; page <= 10; page += 1) {
    const payload = await apiGet(`/backend/account/reset_card/list?page=${page}&size=20`, token);
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    for (const card of cards) {
      if (card && card.card_id) seen.set(String(card.card_id), card);
    }
    if (cards.length < 20) break;
  }
  return [...seen.values()]
    .map((c) => ({
      cardId: String(c.card_id),
      sourceType: String(c.source_type ?? ''),
      outBizNo: String(c.out_biz_no ?? ''),
      expireTimeMs: typeof c.expire_time === 'number' ? c.expire_time : null,
      createTimeMs: typeof c.create_time === 'number' ? c.create_time : null,
      expired: typeof c.expire_time === 'number' && c.expire_time <= now,
    }))
    .sort((a, b) => (a.expireTimeMs ?? Infinity) - (b.expireTimeMs ?? Infinity));
}

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
function decide({ platformPools, codeCredits, cards, quota }) {
  const now = Date.now();
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

  if (!quota) {
    reason = '未获取到额度状态';
  } else if (!quota.fiveHour.exhausted && !quota.weekly.exhausted) {
    action = 'idle';
    reason = '额度充足，暂不需要处理';
  } else if (!earliestCredit) {
    // 没有可消耗的积分，只能靠卡把额度重置回来
    if (earliestCard) {
      action = 'use-card';
      usedCard = true;
      reason = '没有可用积分，使用重置卡重置额度';
    } else {
      action = 'wait';
      reason = '额度已耗尽，既没有积分也没有可用的重置卡';
    }
  } else if (!earliestCard) {
    action = 'use-credit';
    reason = `没有可用的重置卡，让${creditName}（${fmtDay(creditExpire)}到期）先消耗`;
  } else if (cardExpire < creditExpire) {
    action = 'use-card';
    usedCard = true;
    reason = `重置卡（${fmtDay(cardExpire)}）比${creditName}（${fmtDay(creditExpire)}）先过期，先用卡保住积分`;
  } else {
    action = 'use-credit';
    reason = `${creditName}（${fmtDay(creditExpire)}）比重置卡（${fmtDay(cardExpire)}）先过期，不用卡，让积分先消耗`;
  }

  return {
    action,
    usedCard,
    reason,
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

function buildSnapshot() {
  if (inflightSnapshot) return inflightSnapshot;
  inflightSnapshot = doBuildSnapshot().finally(() => {
    inflightSnapshot = null;
  });
  return inflightSnapshot;
}

async function doBuildSnapshot() {
  const token = await getToken();
  if (!token) {
    throw new ApiError('未获取到登录态，请确认 MiniMax Code 桌面端正在运行且已登录', 'unauthorized');
  }

  // 四路并发放大并行收益；积分明细与账户汇总失败不拖垮看板
  const [platform, quotaRes, cardsRes, codeRes, membershipRes, cardFlowsRes] = await Promise.all([
    cached('platform', () => apiGet('/backend/account/token_plan_credit', token)),
    cached('quota', () => apiGet('/backend/account/token_plan/remains_percent', token)),
    cached('cards', () => fetchCards(token)),
    cached('codeCredits', () =>
      fetchCodeCredits(token)
        .then((r) => r.payload)
        .catch(() => null),
    ),
    cached('membership', () =>
      apiPost('/matrix/api/v1/commerce/get_membership_info', token, CODE_BASE).catch(() => null),
    ),
    cached('cardFlows', () => fetchCardFlows(token)),
  ]);

  const platformRaw = platform.value;
  const quotaRaw = quotaRes.value;
  const cards = cardsRes.value ?? [];
  const codePage = codeRes.value;
  const membership = membershipRes.value;
  const cardUsage = cardFlowsRes.value ?? { available: false, usedCount: null, grantedCount: null, lastUsedAtMs: null };

  const platformPools = platformRaw ? parsePlatformPools(platformRaw) : [];
  const codeCredits = parseCodeCredits(codePage);
  const quota = quotaRaw ? parseQuota(quotaRaw) : null;
  const decision = decide({ platformPools, codeCredits: codeCredits.items, cards, quota });

  const now = Date.now();
  const soon7 = expiringWithin(codeCredits.items, 7, now);
  const soon30 = expiringWithin(codeCredits.items, 30, now);
  const sumBalance = (list) => list.reduce((s, d) => s + d.balance, 0);

  return {
    fetchedAtMs: now,
    // 哪些来自缓存 —— 页面据此判断数据新鲜度，不必假装每轮都是最新的
    fresh: {
      quota: !quotaRes.fromCache,
      codeCredits: !codeRes.fromCache,
      cards: !cardsRes.fromCache,
      platform: !platform.fromCache,
      membership: !membershipRes.fromCache,
    },
    creditSummary: parseCreditSummary(membership),
    platformCredits: {
      total: Number(platformRaw?.total_credits ?? 0),
      used: Number(platformRaw?.used_credits ?? 0),
      remaining: Number(platformRaw?.remaining_credits ?? 0),
      fallbackEnabled: Boolean(platformRaw?.token_plan_credit_fallback_enabled),
      pools: platformPools,
    },
    codeCredits: {
      available: codePage !== null,
      totalCount: codeCredits.totalCount,
      liveBalance: codeCredits.liveBalance,
      lostBalance: codeCredits.lostBalance,
      /**
       * 明细按「会不会再变 / 有没有意义」分区传输：
       *   active —— 仍有效、余额可能随消耗变化，主表格展示这个
       *   lost   —— 已过期但**仍有余额**，即「没来得及蹬完」，单独一块展示
       * 余额为 0 的笔既不展示也不传输，已折算进 usedUp 汇总。
       * lost 分区只增不减（过期只会增加），因此适合增量推送：
       * 它没变就不重发。
       */
      active: codeCredits.items.filter((d) => !d.expired && d.balance > 0),
      lost: codeCredits.items.filter((d) => d.expired && d.balance > 0),
      /**
       * 余额为 0 的笔（已用尽）不进表格 —— 45 行零余额对用户没有信息量，
       * 只把它折算成一句可读的成果汇总。口径是 consumed 之和，
       * 依据是 granted - consumed == balance 在全部明细上恒成立。
       */
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
      /** 序号 + 到期日即可识别，不再下发卡号。 */
      items: cards
        .filter((c) => !c.expired)
        .slice(0, 12)
        .map((c, i) => ({ index: i + 1, expireTimeMs: c.expireTimeMs })),
    },
    cardUsage,
    decision,
  };
}

// ── 扣卡与自动执行（唯一写路径，先记账再请求）─────────────────────────────────
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
  autoEnabled: false,
  autoIntervalMs: AUTO_DEFAULT_MS,
  spent: new Map(),
  lastResult: null,
  autoRuns: [],
  lastAutoAtMs: 0,
};

/**
 * 不再设时间节流。
 * 重复扣卡的防护由两道更硬的机制承担：
 *   1. state.spent —— 同一张卡在本进程生命周期内只尝试一次
 *   2. out_biz_no —— 服务端幂等键，即使跨进程重试也不会重复扣除
 * 额度耗尽时可以立即再次判定并执行，不必等固定间隔。
 */

async function useCard(reasonLabel) {
  const token = await getToken();
  if (!token) throw new ApiError('未获取到登录态', 'unauthorized');

  const snapshot = await buildSnapshot();
  const target = snapshot.decision.target;
  if (!target) {
    return { ok: false, message: snapshot.decision.reason, action: snapshot.decision.action };
  }

  const fingerprint = `${target.cardId}:${target.outBizNo}`;
  if (state.spent.has(fingerprint)) {
    // skipped=true 表示「去重保护生效」，不是扣卡失败，调用方不应记入失败日志
    return { ok: false, skipped: true, message: '这张卡已尝试过，避免重复扣卡', action: snapshot.decision.action };
  }

  /**
   * 不依赖时间节流，改用「卡是否还在可用列表」判断。
   * 用掉之后服务端会把它移出可用列表，下一轮自然不会再选到它——
   * 这比固定时间窗更准确：额度真正恢复前不会误扣，恢复了也不会漏扣。
   * 进程重启后 spent 清空也没关系，列表判定依然成立。
   */
  const stillListed = (snapshot.cards.items ?? []).some(
    (c) => c.cardId === target.cardId && !c.expired,
  );
  if (!stillListed) {
    state.spent.set(fingerprint, { cardId: target.cardId, sourceType: target.sourceType, atMs: Date.now() });
    return { ok: false, skipped: true, message: '这张卡已不在可用列表中，跳过', action: snapshot.decision.action };
  }

  // 先记账：进程中途崩溃也不会把这张卡再扣一次
  state.spent.set(fingerprint, { cardId: target.cardId, sourceType: target.sourceType, atMs: Date.now() });

  try {
    const outcome = await apiUseResetCard(target.sourceType, target.outBizNo, token);
    const success = outcome === 'SUCCESS' || outcome === 'REPLAYED';
    // 卡已消耗，立刻让列表缓存失效，下一轮重新取。
    // 否则 5 分钟内列表里还留着这张已用掉的卡，「是否还在列表」的判断会失真。
    if (success) {
      invalidateCache('cards');
      invalidateCache('cardFlows');
    }
    state.lastResult = {
      atMs: Date.now(),
      cardId: target.cardId,
      outcome,
      ok: success,
      label: reasonLabel,
    };
    return {
      ok: success,
      outcome,
      cardId: target.cardId,
      message: success
        ? `已使用重置卡 ${target.cardId}，额度已重置`
        : `重置卡不可用（${outcome}）`,
      action: snapshot.decision.action,
    };
  } catch (error) {
    state.lastResult = {
      atMs: Date.now(),
      cardId: target.cardId,
      ok: false,
      outcome: 'ERROR',
      label: reasonLabel,
    };
    throw error;
  }
}

/**
 * 自动执行一轮：额度耗尽时按「先过期先用」的结论决定用卡还是留卡。
 *
 * 只有结论是 use-card 时才真正扣卡；结论是 use-credit（积分先过期）时
 * 只记录一条决策，不做任何写操作——我们无法指定服务端扣哪一笔积分。
 */
async function autoTick(trigger) {
  const now = Date.now();
  // 提前返回的分支也要带 outcome，否则页面会渲染成 undefined
  if (!state.autoEnabled) {
    return { atMs: now, trigger, outcome: 'AUTO_OFF', reason: '自动执行未开启', message: '' };
  }
  state.lastAutoAtMs = now;

  let snapshot;
  try {
    snapshot = await buildSnapshot();
  } catch (error) {
    const entry = { atMs: now, trigger, outcome: 'ERROR', message: describe(error) };
    state.autoRuns.unshift(entry);
    state.autoRuns.length = Math.min(state.autoRuns.length, 20);
    return entry;
  }

  const d = snapshot.decision;
  let entry;
  if (d.action === 'use-card') {
    entry = { atMs: now, trigger, outcome: 'USE_CARD', reason: d.reason, message: '' };
    try {
      const result = await useCard('自动执行');
      // 「这张卡已尝试过」是去重保护在正常工作，不是失败。
      // 记成 CARD_FAILED 会让同一页日志被这条刷屏，反而淹没真正的扣卡失败。
      if (result.skipped) {
        return { skipped: 'already-spent', outcome: 'SKIPPED_DUPLICATE' };
      }
      entry.outcome = result.ok ? 'CARD_USED' : 'CARD_FAILED';
      entry.message = result.message;
      entry.cardId = result.cardId;
    } catch (error) {
      entry.outcome = 'CARD_ERROR';
      entry.message = describe(error);
    }
  } else if (d.action === 'use-credit') {
    entry = {
      atMs: now,
      trigger,
      outcome: 'KEEP_CREDIT',
      reason: d.reason,
      message: '积分先过期，保留重置卡，未执行任何写操作',
    };
  } else {
    entry = { atMs: now, trigger, outcome: 'NO_ACTION', reason: d.reason, message: '' };
  }
  state.autoRuns.unshift(entry);
  state.autoRuns.length = Math.min(state.autoRuns.length, 20);
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
    s.quota?.fiveHour?.exhausted ?? null,
    s.cards.live ?? 0,
    d.action ?? '',
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
  const clientHtml = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');

    if (request.method === 'GET' && url.pathname === '/dashboard') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(clientHtml);
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
          json(response, 200, snapshot);
        })
        .catch((error) => {
          json(response, 200, { error: describe(error) });
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

    if (request.method === 'POST' && url.pathname === '/api/use-card') {
      useCard('手动使用')
        .then((result) => json(response, 200, result))
        .catch((error) => json(response, 200, { ok: false, message: describe(error) }));
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

  return { dispose };
}

function describe(error) {
  if (error instanceof ApiError) return error.message;
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
