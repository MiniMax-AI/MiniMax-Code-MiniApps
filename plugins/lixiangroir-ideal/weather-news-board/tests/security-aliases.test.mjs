/**
 * 指数 / ETF 名称别名的自测。
 *
 * 这张表最容易出的错是市场前缀：000001 在深市是平安银行，在沪市才是上证指数，
 * 所以这里把每个别名的归属都钉死。
 *
 * 运行（仓库根目录下）：
 *   node --test "plugins/lixiangroir-ideal/weather-news-board/tests/*.test.mjs"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SECURITY_ALIASES, resolveSecurityAlias } from '../miniapp/node/security-aliases.mjs';

test('别名都解析成带市场前缀的 6 位代码', () => {
  for (const [name, code] of Object.entries(SECURITY_ALIASES)) {
    assert.match(code, /^(sh|sz|bj)\d{6}$/, name);
  }
});

test('上证指数是沪市 000001，不是深市那家', () => {
  assert.equal(resolveSecurityAlias('上证指数'), 'sh000001');
  assert.equal(resolveSecurityAlias('上证综指'), 'sh000001');
  assert.equal(resolveSecurityAlias('沪指'), 'sh000001');
});

test('000 开头的指数都在沪市', () => {
  assert.equal(resolveSecurityAlias('沪深300'), 'sh000300');
  assert.equal(resolveSecurityAlias('上证50'), 'sh000016');
  assert.equal(resolveSecurityAlias('中证500'), 'sh000905');
  assert.equal(resolveSecurityAlias('中证1000'), 'sh000852');
  assert.equal(resolveSecurityAlias('科创50'), 'sh000688');
});

test('399 开头的指数都在深市', () => {
  assert.equal(resolveSecurityAlias('深证成指'), 'sz399001');
  assert.equal(resolveSecurityAlias('深成指'), 'sz399001');
  assert.equal(resolveSecurityAlias('创业板指'), 'sz399006');
  assert.equal(resolveSecurityAlias('创业板'), 'sz399006');
  assert.equal(resolveSecurityAlias('创业板50'), 'sz399673');
});

test('北证50 在北交所', () => {
  assert.equal(resolveSecurityAlias('北证50'), 'bj899050');
});

test('ETF 别名指向各自的代码', () => {
  assert.equal(resolveSecurityAlias('沪深300ETF'), 'sh510300');
  assert.equal(resolveSecurityAlias('上证50ETF'), 'sh510050');
  assert.equal(resolveSecurityAlias('创业板ETF'), 'sz159915');
  assert.equal(resolveSecurityAlias('科创50ETF'), 'sh588000');
  assert.equal(resolveSecurityAlias('证券ETF'), 'sh512880');
  assert.equal(resolveSecurityAlias('中概互联网ETF'), 'sh513050');
});

test('大小写与空白不影响解析', () => {
  assert.equal(resolveSecurityAlias('沪深300etf'), 'sh510300');
  assert.equal(resolveSecurityAlias(' 上证 指数 '), 'sh000001');
});

test('认不出来的名称返回 null', () => {
  assert.equal(resolveSecurityAlias('不存在的品种'), null);
  assert.equal(resolveSecurityAlias(''), null);
  assert.equal(resolveSecurityAlias(undefined), null);
});
