/**
 * 指数与常见 ETF 的名称别名。
 *
 * 指数代码不能靠 6 位数字推市场：000001 在深市是平安银行，在沪市才是上证指数；
 * 000300、000688 这些同理。所以这里把市场前缀显式写出来，用户直接打名称即可。
 *
 * ETF 走 6 位数字就够了（510xxx / 588xxx 在沪市，159xxx / 15xxxx 在深市），
 * 这里只收最常被提到的那几只，作为「名称 → 代码」的快捷方式。
 */

/** @type {Record<string, string>} */
export const SECURITY_ALIASES = {
  // 指数
  上证指数: 'sh000001',
  上证综指: 'sh000001',
  沪指: 'sh000001',
  深证成指: 'sz399001',
  深成指: 'sz399001',
  沪深300: 'sh000300',
  上证50: 'sh000016',
  中证500: 'sh000905',
  中证1000: 'sh000852',
  创业板指: 'sz399006',
  创业板: 'sz399006',
  创业板50: 'sz399673',
  科创50: 'sh000688',
  北证50: 'bj899050',
  // ETF
  沪深300ETF: 'sh510300',
  上证50ETF: 'sh510050',
  创业板ETF: 'sz159915',
  科创50ETF: 'sh588000',
  证券ETF: 'sh512880',
  中概互联网ETF: 'sh513050',
};

/** @type {Map<string, string>} */
const LOOKUP = new Map(
  Object.entries(SECURITY_ALIASES).map(([name, code]) => [name.toLowerCase(), code]),
);

/**
 * 名称 → 带市场前缀的代码。大小写不敏感，忽略中间空白。
 * @param {string} text
 * @returns {string|null}
 */
export function resolveSecurityAlias(text) {
  const value = String(text ?? '').replace(/\s+/g, '').toLowerCase();
  if (!value) return null;
  return LOOKUP.get(value) ?? null;
}
