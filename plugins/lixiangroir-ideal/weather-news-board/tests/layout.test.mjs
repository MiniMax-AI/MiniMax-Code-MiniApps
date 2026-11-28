/**
 * 布局算法的自测。
 *
 * 客户端把纯计算部分单独放在 <script id="wnb-layout"> 里，这里直接把那一段
 * 原样取出来，在 Node 的 vm 里跑——测的就是页面上真正执行的那份代码，
 * 不复制一份实现，也不会出现两边不同步。
 *
 * 运行（仓库根目录下）：
 *   node --test "plugins/lixiangroir-ideal/weather-news-board/tests/*.test.mjs"
 *
 * 用 Node 内置的 node:test 与 node:assert，不引入任何依赖。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const clientPath = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = await readFile(clientPath, 'utf8');

const match = html.match(/<script id="wnb-layout">([\s\S]*?)<\/script>/);
assert.ok(match, 'index.html 里缺少 <script id="wnb-layout">');
const layoutSource = match[1];

/* 在当前 realm 里跑这段脚本：返回的对象和测试断言用的是同一套原型，
   deepStrictEqual 才能直接比较。 */
vm.runInThisContext(layoutSource, { filename: 'wnb-layout.js' });
const layout = globalThis.WNB_LAYOUT;
assert.ok(layout, '布局脚本没有导出 WNB_LAYOUT');
// 与客户端一致的常量
const MIN_CARD_W = 260;
const BOARD_GAP = 16;

test('布局脚本是纯计算，不碰浏览器 API', () => {
  assert.doesNotMatch(layoutSource, /\bdocument\b/);
  assert.doesNotMatch(layoutSource, /\bwindow\b/);
  assert.doesNotMatch(layoutSource, /\blocation\b/);
});

test('页面主脚本确实用到了这一段布局代码', () => {
  const main = html.slice(html.indexOf('<script id="wnb-layout">'));
  assert.match(main, /WNB_LAYOUT\.layoutColumnsFor/);
  assert.match(main, /WNB_LAYOUT\.shrinkRowToFit/);
});

test('看板宽度决定列数', () => {
  assert.equal(layout.layoutColumnsFor(320), 1);
  assert.equal(layout.layoutColumnsFor(559), 1);
  assert.equal(layout.layoutColumnsFor(560), 2);
  assert.equal(layout.layoutColumnsFor(899), 2);
  assert.equal(layout.layoutColumnsFor(900), 3);
  assert.equal(layout.layoutColumnsFor(1440), 3);
});

test('列数决定每一行放哪些卡片', () => {
  assert.deepEqual(layout.layoutRowsFor(1), [['weather'], ['stocks'], ['news']]);
  assert.deepEqual(layout.layoutRowsFor(2), [['weather', 'stocks'], ['news']]);
  assert.deepEqual(layout.layoutRowsFor(3), [['weather', 'stocks', 'news']]);
});

test('单卡独占一行时宽度上限就是看板宽度', () => {
  assert.equal(layout.maxCardWidthFor(1052, ['weather'], 'weather', MIN_CARD_W, BOARD_GAP), 1052);
  assert.equal(layout.maxCardWidthFor(719, ['news'], 'news', MIN_CARD_W, BOARD_GAP), 719);
});

test('同一行的宽度上限与处理顺序无关', () => {
  const row = ['weather', 'stocks', 'news'];
  const first = layout.maxCardWidthFor(1052, row, 'weather', MIN_CARD_W, BOARD_GAP);
  const last = layout.maxCardWidthFor(1052, row, 'news', MIN_CARD_W, BOARD_GAP);
  assert.equal(first, 500);
  assert.equal(last, 500);
});

test('两栏时按兄弟卡留出的最小宽度算上限', () => {
  assert.equal(
    layout.maxCardWidthFor(719, ['weather', 'stocks'], 'weather', MIN_CARD_W, BOARD_GAP),
    443,
  );
});

test('宽度上限不会低于最小宽度', () => {
  const row = ['weather', 'stocks', 'news'];
  assert.equal(layout.maxCardWidthFor(300, row, 'weather', MIN_CARD_W, BOARD_GAP), MIN_CARD_W);
  assert.equal(layout.maxCardWidthFor(0, row, 'weather', MIN_CARD_W, BOARD_GAP), MIN_CARD_W);
});

test('放得下的时候不收回任何宽度', () => {
  const sizes = { weather: { w: 300 }, stocks: { w: 300 } };
  const measured = { weather: 300, stocks: 300 };
  const result = layout.shrinkRowToFit(sizes, measured, ['weather', 'stocks'], 1052, BOARD_GAP, 260, null);
  assert.equal(result, null);
});

test('三张卡各 900px 放在 1052px 的栏里等比收成 340px', () => {
  const sizes = { weather: { w: 900 }, stocks: { w: 900 }, news: { w: 900 } };
  const measured = { weather: 900, stocks: 900, news: 900 };
  const result = layout.shrinkRowToFit(
    sizes,
    measured,
    ['weather', 'stocks', 'news'],
    1052,
    BOARD_GAP,
    260,
    null,
  );
  assert.deepEqual(result, { weather: 340, stocks: 340, news: 340 });
});

test('收回时按各自宽度分摊，不偏向行里的第一张', () => {
  const sizes = { weather: { w: 900 }, stocks: { w: 600 }, news: { w: 300 } };
  const measured = { weather: 900, stocks: 600, news: 300 };
  const result = layout.shrinkRowToFit(
    sizes,
    measured,
    ['weather', 'stocks', 'news'],
    1052,
    BOARD_GAP,
    260,
    null,
  );
  assert.deepEqual(result, { weather: 510, stocks: 340, news: 260 });
});

test('拖动中的那张卡先不动，让兄弟卡片让出空间', () => {
  const sizes = { weather: { w: 900 }, stocks: { w: 900 }, news: { w: 900 } };
  const measured = { weather: 900, stocks: 900, news: 900 };
  const result = layout.shrinkRowToFit(
    sizes,
    measured,
    ['weather', 'stocks', 'news'],
    1052,
    BOARD_GAP,
    260,
    'weather',
  );
  assert.deepEqual(result, { stocks: 260, news: 260 });
});

test('兄弟卡片都到底了才动正在拖动的那张', () => {
  const sizes = { weather: { w: 900 }, stocks: { w: 260 }, news: { w: 260 } };
  const measured = { weather: 900, stocks: 260, news: 260 };
  const result = layout.shrinkRowToFit(
    sizes,
    measured,
    ['weather', 'stocks', 'news'],
    1052,
    BOARD_GAP,
    260,
    'weather',
  );
  assert.deepEqual(result, { weather: 500 });
});

test('已经到最小宽度的卡片不参与分摊', () => {
  const sizes = { weather: { w: 260 }, stocks: { w: 900 } };
  const measured = { weather: 260, stocks: 900 };
  const result = layout.shrinkRowToFit(
    sizes,
    measured,
    ['weather', 'stocks'],
    719,
    BOARD_GAP,
    260,
    null,
  );
  assert.deepEqual(Object.keys(result), ['stocks']);
});

test('没有手动指定宽度的卡片不参与收回', () => {
  const sizes = { weather: { w: null }, stocks: { w: 900 } };
  const measured = { weather: 900, stocks: 900 };
  const result = layout.shrinkRowToFit(
    sizes,
    measured,
    ['weather', 'stocks'],
    719,
    BOARD_GAP,
    260,
    null,
  );
  assert.deepEqual(Object.keys(result), ['stocks']);
});

test('宽度夹在上下限之间并取整', () => {
  assert.equal(layout.clampWidth(500, 260, 450), 450);
  assert.equal(layout.clampWidth(100, 260, 450), 260);
  assert.equal(layout.clampWidth(300, 260, 450), 300);
  assert.equal(layout.clampWidth(300.4, 260, 450), 300);
  assert.equal(layout.clampWidth(300.6, 260, 450), 301);
  assert.equal(layout.clampWidth('x', 260, 450), null);
  assert.equal(layout.clampWidth(Number.NaN, 260, 450), null);
});
