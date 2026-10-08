// @ts-check

/**
 * 起卦参数的单一出处：页面（`server.mjs`）与 MCP（`mcp/divination-http.mjs`）两条路
 * 都要把外部传进来的参数校验一遍再交给引擎，逻辑原本各写了一份，于是上限值、
 * 起法名与提示语会各自漂移。这里把校验、取数与常量收到一处，两条路都调它。
 *
 * 为什么值得多一个文件：`docs/security.md` 要求「Validate every request parameter」，
 * 而这份校验是防线的全部——引擎本身不校验（它是被测对象，不是防线）。
 * 校验散在两处时，任何一处的漏项都直接等于一个洞。
 */

import {
  castByCoins,
  castByHexagram,
  castByNumbers,
  castByTime,
  castDaily,
  tossCoins,
} from './divination.mjs';
import { hexagramByKey } from './hexagrams.mjs';

/** 所问的长度上限。页面输入框与 MCP 工具描述里的 maxLength 都以此为准。 */
export const MAX_QUESTION = 120;
/** 数字起卦两个数的上限。 */
export const MAX_NUMBER = 1_000_000_000;

/**
 * 认得的起法。顺序即 `plugin.json` 与 README 里列出的顺序。
 * `hexagram` 是卦库「以此卦起一卦」用的：由卦的 key 直接成卦。
 */
export const CAST_METHODS = Object.freeze(['time', 'daily', 'numbers', 'coins', 'hexagram']);

/** 铜钱摇卦的次数，由古法定的，不给改。 */
const COIN_TOSSES = 6;

/**
 * 包版本。`.minimax-plugin/plugin.json` 不在运行时载荷里（载荷只有 `artifacts` 下的
 * client 与 node），所以这里必须另有一份；`tests/divination.test.mjs` 有一条断言把
 * 两处钉在一起，改一处忘了另一处会红。
 */
export const PACKAGE_VERSION = '1.1.0';

/**
 * 参数没过时的错。带上 `recovery`，好让 MCP 把它回给 Agent 当重试提示。
 */
export class CastParamError extends Error {
  /**
   * @param {string} message
   * @param {string} [recovery]
   */
  constructor(message, recovery) {
    super(message);
    this.name = 'CastParamError';
    this.recovery = recovery;
  }
}

/**
 * 把外部传来的任意值收成一个有上限的非负整数。
 * @param {unknown} value
 * @param {number} max
 * @param {string} label 出错时给人看的名字
 * @returns {number}
 */
function toBoundedInteger(value, max, label) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new CastParamError(`${label}需要是整数。`, `把${label}换成一个 1 到 ${max} 之间的整数重试。`);
  }
  if (parsed < 1 || parsed > max) {
    throw new CastParamError(`${label}需在 1 到 ${max} 之间。`, `把${label}改到 1 到 ${max} 之间。`);
  }
  return parsed;
}

/**
 * 收文本：非字符串一律当空，过长截断，前后空白去掉。
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
export function clampText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * 摇卦的六次结果。页面把六次掷钱结果收齐了传上来，页面没传（也就是 MCP 那条路，
 * 没有人替用户掷）就自己掷六次。
 *
 * 这两条路的差别是真实的：页面上用户看得见每一次掷出的点数，能自己重来；MCP 那边
 * 用户只看到 Agent 替他掷的六次。之前两边各写一份，页面那份忘了校验长度，
 * 而 MCP 那份曾经把 `tossCoins()` 的对象整个递进 `castByCoins()`，`.length` 是
 * undefined，于是一次都成不了卦。
 *
 * @param {unknown} sums
 * @returns {number[]}
 */
function coinSumsFrom(sums) {
  if (!Array.isArray(sums) || sums.length !== COIN_TOSSES) {
    throw new CastParamError(
      `摇卦要 ${COIN_TOSSES} 次掷钱结果。`,
      `传 ${COIN_TOSSES} 个 6 到 9 之间的整数。`,
    );
  }
  return sums.map((sum, index) => toBoundedInteger(sum, 9, `第 ${index + 1} 次掷钱结果`));
}

/**
 * 自己掷六次，给「没有人替用户掷」的那条路用（MCP）。页面那条路不用这个：
 * 用户在页面上看得见每一次掷出的点数并能自己重来，所以页面把六次结果收齐了传上来，
 * 少一次就该报错——悄悄替他重掷六次，落出来的卦与他在推演日志里看到的点数对不上。
 *
 * @returns {number[]}
 */
export function tossCoinSums() {
  return Array.from({ length: COIN_TOSSES }, () => tossCoins().sum);
}

/**
 * 校验参数并取出一个 Cast。这是页面与 MCP 唯一的取数入口。
 *
 * @param {Record<string, unknown>} params 未校验的外部参数
 * @param {Date} now 这一次起卦的时刻，由调用方给，便于注入固定时钟
 * @returns {ReturnType<typeof castByTime>}
 */
export function castFromParams(params, now) {
  const method = typeof params.method === 'string' && params.method !== '' ? params.method : 'time';
  if (!CAST_METHODS.includes(method)) {
    throw new CastParamError(
      `未知的起法：${method}`,
      `method 只能是 ${CAST_METHODS.join('、')}。`,
    );
  }

  if (method === 'time') return castByTime(now);
  if (method === 'daily') return castDaily(now);
  if (method === 'coins') return castByCoins(coinSumsFrom(params.sums));
  if (method === 'numbers') {
    const upper = toBoundedInteger(params.upper, MAX_NUMBER, '第一数');
    const lower = toBoundedInteger(params.lower, MAX_NUMBER, '第二数');
    return castByNumbers(upper, lower);
  }

  // hexagram：卦库里的「以此卦起一卦」。key 形如 '010011'，即自下而上六爻。
  const key = params.key;
  if (typeof key !== 'string' || !/^[01]{6}$/.test(key)) {
    throw new CastParamError(
      '指定卦需要六爻的卦 key。',
      'key 形如 010011，自下而上六爻，1 为阳、0 为阴；省略 key 即按当下时辰起卦。',
    );
  }
  return castByHexagram(hexagramByKey(key));
}
