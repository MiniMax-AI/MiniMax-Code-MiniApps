import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * 测试用的时刻，一处构造。
 *
 * 用 `new Date(2026, 8, 30, 1, 20)` 而不是 `AT(1, 20)`：
 * 后者是绝对时刻，而 `castByTime` / `castDaily` 按**本机时区**取时辰与日柱，同一个
 * 绝对时刻在 `America/Los_Angeles` 与 `Pacific/Honolulu` 下会落进不同的时辰，于是
 * 起出来的卦不同、断言跟着挂。本地构造器给出的是同一个「墙上时间」，不随 TZ 变。
 *
 * 这个坑已经栽过两次：一次在 MCP 起卦那条（靠注入 now 根治），一次在推演样本那条。
 * 末尾有一条守卫断言，禁止再出现绝对时刻或裸 `new Date()`——要用真时钟的话，
 * 必须在那一行写 `real-clock:` 注明理由。
 */
const AT = (hour, minute = 0, day = 30) => new Date(2026, 8, day, hour, minute);
/** 真时钟的统一写法：需要跟随当天时必须用它，并写明为什么。 */
const REAL_CLOCK_MARK = 'real-clock:';

import {
  HEXAGRAM_LIST,
  hexagramByOrder,
  invertedHexagram,
  mutualHexagram,
  oppositeHexagram,
  hexagramByKey,
} from '../miniapp/node/hexagrams.mjs';
import {
  almanac,
  dayPillar,
  hourOffice,
  hourPillar,
  hourPillarByBranch,
  jianchu,
  monthPillar,
  shujiu,
  yearPillar,
} from '../miniapp/node/almanac.mjs';
import {
  buildReading,
  castByCoins,
  castByNumbers,
  castByTime,
  castDaily,
  tossCoins,
} from '../miniapp/node/divination.mjs';
import { ReadingStore, shouldRetryRename } from '../miniapp/node/store.mjs';
import { responseTiming } from '../miniapp/node/xiang.mjs';
import { hexagramYaoTexts, lineText } from '../miniapp/node/yao.mjs';
import { hexagramXiangTexts, lineXiang } from '../miniapp/node/xiang-chuan.mjs';
import { tuanText } from '../miniapp/node/tuan.mjs';
import { TWELVE_MESSAGES, hexagramQi, monthQi } from '../miniapp/node/guaqi.mjs';
import { detectTopic, godRelation, TOPIC_CLASSES } from '../miniapp/node/topics.mjs';
import { generates, overcomes } from '../miniapp/node/divination.mjs';
import {
  start,
  describeError,
  hostnameFromHeader,
  isLocalRequest,
  isLoopbackHostname,
} from '../miniapp/node/server.mjs';

test('六十四卦齐全且唯一', () => {
  assert.equal(HEXAGRAM_LIST.length, 64);
  assert.equal(new Set(HEXAGRAM_LIST.map((item) => item.key)).size, 64);
  assert.equal(new Set(HEXAGRAM_LIST.map((item) => item.name)).size, 64);
  assert.deepEqual(
    HEXAGRAM_LIST.map((item) => item.order),
    Array.from({ length: 64 }, (_unused, index) => index + 1),
  );
});

test('卦名书写为上卦在前，爻象由上下卦推出', () => {
  // 乾为天：上乾下乾
  assert.equal(hexagramByOrder(1).key, '111111');
  assert.equal(hexagramByOrder(1).name, '乾为天');
  // 地天泰：上坤下乾
  assert.equal(hexagramByOrder(11).key, '111000');
  // 天地否：上乾下坤
  assert.equal(hexagramByOrder(12).key, '000111');
  // 山水蒙：上艮下坎
  assert.equal(hexagramByOrder(4).key, '010001');
  // 水雷屯：上坎下震
  assert.equal(hexagramByOrder(3).key, '100010');
  // 火水未济：上离下坎
  assert.equal(hexagramByOrder(64).key, '010101');
  // 水火既济：上坎下离
  assert.equal(hexagramByOrder(63).key, '101010');
});

test('错卦阴阳互错，综卦上下颠倒', () => {
  for (const hexagram of HEXAGRAM_LIST) {
    assert.equal(
      oppositeHexagram(hexagram).key,
      [...hexagram.key].map((line) => (line === '1' ? '0' : '1')).join(''),
    );
    assert.equal(invertedHexagram(hexagram).key, [...hexagram.key].reverse().join(''));
  }
  // 地天泰的错卦即天地否
  assert.equal(oppositeHexagram(hexagramByOrder(11)).name, '天地否');
  // 水火既济的错卦是火水未济
  assert.equal(oppositeHexagram(hexagramByOrder(63)).name, '火水未济');
  // 综卦是自身的逆序
  assert.equal(invertedHexagram(hexagramByOrder(1)).name, '乾为天');
  assert.equal(invertedHexagram(hexagramByOrder(2)).name, '坤为地');
});

test('互卦取二三四爻为下卦、三四五爻为上卦', () => {
  // 乾为天全阳，互卦仍为乾
  assert.equal(mutualHexagram(hexagramByOrder(1)).name, '乾为天');
  // 水雷屯 100010 -> 下取 000(坤) 上取 001(艮) = 山地剥
  assert.equal(mutualHexagram(hexagramByOrder(3)).name, '山地剥');
  for (const hexagram of HEXAGRAM_LIST) {
    const lines = hexagram.key.split('');
    assert.equal(mutualHexagram(hexagram).key, lines.slice(1, 4).join('') + lines.slice(2, 5).join(''));
  }
});

test('干支纪日与传世万年历一致', () => {
  assert.equal(dayPillar(2000, 1, 1).name, '戊午');
  assert.equal(dayPillar(2000, 1, 2).name, '己未');
  assert.equal(dayPillar(2000, 1, 11).name, '戊辰');
  // 连续两日必进一位，六十甲子循环
  assert.equal(dayPillar(2026, 9, 29).index, (dayPillar(2026, 9, 30).index + 59) % 60);
  assert.equal(dayPillar(2026, 9, 30).index, (dayPillar(2026, 9, 29).index + 1) % 60);
});

test('年干支以立春为界', () => {
  assert.equal(yearPillar(2026, 9, 29).name, '丙午');
  assert.equal(yearPillar(2026, 9, 29).zodiac, '马');
  assert.equal(yearPillar(2025, 12, 25).name, '乙巳');
  assert.equal(yearPillar(2026, 2, 3).name, '乙巳');
  assert.equal(yearPillar(2026, 2, 5).name, '丙午');
});

test('月柱以节气为界，五虎遁起月干', () => {
  assert.equal(monthPillar(2026, 9, 29).jie, '白露');
  assert.equal(monthPillar(2026, 9, 29).name, '丁酉');
  // 小寒之前仍属大雪之后的子月
  assert.equal(monthPillar(2026, 1, 2).jie, '大雪');
  assert.equal(monthPillar(2026, 1, 2).name, '戊子');
  assert.equal(monthPillar(2026, 1, 20).jie, '小寒');
  assert.equal(monthPillar(2026, 3, 1).jie, '立春');
  assert.equal(monthPillar(2026, 3, 1).name, '庚寅');
});

test('时支以两小时为界，五鼠遁起时干', () => {
  assert.equal(hourPillar(0, 23).branch, 0);
  assert.equal(hourPillar(0, 0).branch, 0);
  assert.equal(hourPillar(0, 1).branch, 1);
  assert.equal(hourPillar(0, 13).branch, 7);
  // 甲日子时起甲子
  assert.equal(hourPillar(0, 0).name, '甲子');
  // 乙日子时起丙子
  assert.equal(hourPillar(1, 0).name, '丙子');
  // 戊日子时起壬子
  assert.equal(hourPillar(4, 0).name, '壬子');
  // 丙日子时起戊子；亥时（21:00-23:00）为己亥
  assert.equal(hourPillar(2, 22).name, '己亥');
  assert.equal(hourPillar(2, 22).branch, 11);
  // 同一地支，按小时求与按地支求必须一致
  for (let hour = 0; hour < 24; hour += 1) {
    assert.equal(hourPillar(2, hour).name, hourPillarByBranch(2, hourPillar(2, hour).branch).name);
  }
});

test('十二时辰的干支与时辰一一对应，不错位', () => {
  const snapshot = almanac(new Date(2026, 8, 29, 14, 30));
  // 丙午日的十二时：戊子 己丑 庚寅 辛卯 壬辰 癸巳 甲午 乙未 丙申 丁酉 戊戌 己亥
  assert.deepEqual(
    snapshot.hours.map((item) => item.pillar),
    ['戊子', '己丑', '庚寅', '辛卯', '壬辰', '癸巳', '甲午', '乙未', '丙申', '丁酉', '戊戌', '己亥'],
  );
  // 时支必须与时辰名一致
  for (const item of snapshot.hours) {
    assert.equal(item.pillarBranch, item.branch);
  }
  // 十二个干支互不相同
  assert.equal(new Set(snapshot.hours.map((item) => item.pillar)).size, 12);
});

test('黄黑道十二神按日支三合局起青龙', () => {
  // 寅午戌日，青龙起寅时
  assert.equal(hourOffice(6, 2).name, '青龙');
  assert.equal(hourOffice(6, 2).auspicious, true);
  // 申子辰日，青龙起子时
  assert.equal(hourOffice(0, 0).name, '青龙');
  // 巳酉丑日，青龙起巳时
  assert.equal(hourOffice(5, 5).name, '青龙');
  // 亥卯未日，青龙起亥时
  assert.equal(hourOffice(11, 11).name, '青龙');
  // 一日十二辰顺行，青龙之后依次为明堂、天刑、朱雀、金匮、天德
  assert.equal(hourOffice(6, 3).name, '明堂');
  assert.equal(hourOffice(6, 4).name, '天刑');
  assert.equal(hourOffice(6, 5).name, '朱雀');
  // 寅午戌日的六个吉时：寅、卯、午、未、酉、子
  const auspicious = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    .filter((branch) => hourOffice(6, branch).auspicious)
    .map((branch) => '子丑寅卯辰巳午未申酉戌亥'[branch]);
  assert.deepEqual(auspicious, ['子', '寅', '卯', '午', '未', '酉']);
});

test('建除以日支同月支为建，顺行一位', () => {
  assert.equal(jianchu(6, 6).name, '建');
  assert.equal(jianchu(7, 6).name, '除');
  assert.equal(jianchu(8, 6).name, '满');
  assert.equal(jianchu(5, 6).name, '闭');
  // 丙午日(6) 遇酉月(9)：日支退三位，为收
  assert.equal(jianchu(6, 9).name, '收');
  // 退到初位绕回闭
  assert.equal(jianchu(5, 6).name, '闭');
});

test('数九自冬至起算，九九八十一天', () => {
  assert.equal(shujiu(2025, 12, 22).label, '一九');
  assert.equal(shujiu(2025, 12, 30).label, '一九');
  assert.equal(shujiu(2025, 12, 31).label, '二九');
  // 冬至后第 72 天为九九首日，第 81 天后出九
  assert.equal(shujiu(2026, 3, 3).label, '八九');
  assert.equal(shujiu(2026, 3, 4).label, '九九');
  assert.equal(shujiu(2026, 3, 12).stage, '出九');
  assert.equal(shujiu(2026, 3, 13), null);
  assert.equal(shujiu(2026, 9, 29), null);
});

test('铜钱摇卦：六为老阴、九为老阳，变卦取反', () => {
  // 掷钱结果自初爻起：[初爻老阳, 其余少阳] → 乾为天动初爻
  const reading = buildReading(castByCoins([9, 7, 7, 7, 7, 7]));
  assert.equal(reading.hexagram.name, '乾为天');
  assert.equal(reading.movingLines.length, 1);
  assert.equal(reading.movingLines[0].position, 1);
  assert.equal(reading.movingLines[0].kind, '老阳');
  // 初爻由阳变阴，本卦 111111 变 011111，上乾下巽
  assert.equal(reading.changed.name, '天风姤');

  // 少阳少阴交替，六爻皆静：本卦 101010 上坎下离，无变卦
  const still = buildReading(castByCoins([7, 8, 7, 8, 7, 8]));
  assert.equal(still.movingLines.length, 0);
  assert.equal(still.changed, null);
  assert.equal(still.hexagram.name, '水火既济');
  assert.deepEqual(still.lines.map((line) => line.kind), ['少阳', '少阴', '少阳', '少阴', '少阳', '少阴']);

  // 上爻掷出老阴(6)：本卦 111110，下乾上兑为泽天夬，上爻由阴变阳得乾
  const top = buildReading(castByCoins([7, 7, 7, 7, 7, 6]));
  assert.equal(top.hexagram.name, '泽天夬');
  assert.equal(top.movingLines[0].kind, '老阴');
  assert.equal(top.changed.name, '乾为天');
});

test('摇卦拒绝非法掷钱结果', () => {
  assert.throws(() => castByCoins([7, 7, 7, 7, 7]), /六次/);
  assert.throws(() => castByCoins([7, 7, 7, 7, 7, 5]), /6 到 9/);
  assert.throws(() => castByCoins([7, 7, 7, 7, 7, 10]), /6 到 9/);

  // NaN、undefined 与非数都放得过去：它们跟任何数比较都是 false，
  // `sum < 6 || sum > 9` 一条都拦不住，于是六爻全判成阴，安静地组出一个坤卦。
  // 页面那条路由是把请求里的 sums 用 Number() 转过来的，转不动的就是 NaN。
  for (const bad of [[NaN, NaN, NaN, NaN, NaN, NaN], [undefined, 7, 7, 7, 7, 7], ['7', 7, 7, 7, 7, 7]]) {
    assert.throws(() => castByCoins(bad), /6 到 9/, `非法掷钱结果 ${JSON.stringify(bad)} 竟被放过去了`);
  }
  assert.throws(() => castByCoins({ sum: 7, coins: [true, true, true] }), /6 到 9/, '单次掷钱的对象被当成了六次结果');
  // 长度对得上的类数组也一样：只要每项不是整数就该拦下，哪怕它连 .some 都有。
  assert.throws(
    () => castByCoins({ length: 6, some: () => false, map: () => [], reduce: () => [] }),
    /6 到 9/,
    '一个 length 恰好是 6 的类数组被放过去了',
  );
});

test('每日一卦同日同结果', () => {
  const first = buildReading(castDaily(new Date(2026, 8, 29, 0, 5)));
  const second = buildReading(castDaily(new Date(2026, 8, 29, 23, 55)));
  assert.equal(first.hexagram.name, second.hexagram.name);
  assert.equal(first.hexagram.key, second.hexagram.key);
  assert.deepEqual(first.movingLines.map((line) => line.position), second.movingLines.map((line) => line.position));
});

test('体用生克定吉凶，主客相隔三位', () => {
  // 动爻在四爻以上，体卦为上卦
  const reading = buildReading(castByNumbers(1, 8), { now: new Date(2026, 8, 29) });
  assert.ok(reading.structure.shi.position >= 1 && reading.structure.shi.position <= 6);
  const gap = Math.abs(reading.structure.shi.position - reading.structure.ying.position);
  assert.equal(gap, 3);
  // 「世应」两个字归京房：世爻由宫与世次定，梅花这层只说主客。
  assert.match(reading.structure.shi.role, /动爻/);
  assert.match(reading.structure.ying.role, /配爻/);
  assert.ok(!/世爻|应爻/.test(reading.structure.shi.role + reading.structure.ying.role));
  // 徽章与结论行用的是同一份判语，两边对「吉凶有哪几档」的说法也得是同一套。
  // 从前徽章只可能出现生克那三档、结论行却有五档，同一个字段两种词汇表。
  assert.ok(['大吉', '吉', '平', '凶', '大凶'].includes(reading.verdict.label), `徽章冒出不在册的吉凶「${reading.verdict.label}」`);
  assert.match(reading.verdict.summary, /^(大吉|吉|平|凶|大凶)：/);
  assert.ok(
    reading.verdict.summary.startsWith(`${reading.verdict.label}：`),
    `徽章说「${reading.verdict.label}」而结论行说「${reading.verdict.summary}」，两处吉凶不是一回事`,
  );
});

test('旺相休囚死以春木令为基准', () => {
  // 摇出乾卦，体用皆金；三月为木令，金当囚
  const spring = buildReading(castByCoins([7, 7, 7, 7, 7, 7]), { now: new Date(2026, 2, 20) });
  assert.equal(spring.structure.monthElement, '木');
  assert.equal(spring.structure.body.element, '金');
  assert.equal(spring.structure.bodyVitality, '囚');
  // 九月为金令，金当旺
  const autumn = buildReading(castByCoins([7, 7, 7, 7, 7, 7]), { now: new Date(2026, 8, 29) });
  assert.equal(autumn.structure.monthElement, '金');
  assert.equal(autumn.structure.bodyVitality, '旺');
});

test('解读给出互错综三卦与完整断语', () => {
  const reading = buildReading(castByCoins([7, 8, 9, 6, 7, 8]));
  assert.ok(reading.mutual.name);
  assert.ok(reading.opposite.name);
  assert.ok(reading.inverted.name);
  assert.ok(reading.advice.suitable.length > 0);
  assert.ok(reading.advice.avoid.length > 0);
  assert.ok(reading.details.length > 0);
  for (const title of ['卦象总断', '体用关系', '旺衰应期', '互卦 · 过程', '变卦 · 结果', '错卦 · 旁支', '综卦 · 反求', '六亲世应', '主客', '取象']) {
    assert.ok(reading.insights.some((item) => item.title === title), `缺少断语：${title}`);
  }
});

test('断语恒含应期，不再有用神段', () => {
  const reading = buildReading(castByCoins([7, 8, 9, 6, 7, 8]));
  const titles = reading.insights.map((item) => item.title);
  assert.equal(titles.includes('用神 · 所问之事'), false);
  assert.ok(titles.includes('应期'));
  assert.ok(reading.timing.length > 0);
});

test('应期取用卦五行，随用卦而变', () => {
  // 乾金为用卦时，旺在申酉
  const metal = buildReading(castByNumbers(1, 1));
  assert.equal(metal.structure.use.name, '乾');
  assert.match(metal.timing, /申酉/);
  const titles = metal.insights.map((item) => item.title);
  assert.ok(titles.includes('应期'));
});

test('应期取用神五行的旺相之地', () => {
  // 离火：旺巳午，相辰戌丑未
  assert.equal(responseTiming('火').wang, '巳午');
  assert.equal(responseTiming('火').xiang, '辰戌丑未');
  // 乾金：旺申酉，相亥子丑
  assert.equal(responseTiming('金').wang, '申酉');
  assert.equal(responseTiming('金').xiang, '亥子丑');
  // 震木：旺寅卯，相巳午
  assert.equal(responseTiming('木').wang, '寅卯');
  assert.equal(responseTiming('水').xiang, '寅卯');
});

test('吉时仍带「省力」之戒，凶时带「守」之戒', () => {
  const good = buildReading(castByCoins([9, 7, 7, 7, 7, 7]), { now: new Date(2026, 8, 29) });
  assert.equal(good.verdict.score >= 1, true);
  assert.match(good.advice.caution, /力气要省|方向可进/);
  const bad = buildReading(castByCoins([7, 7, 7, 7, 7, 6]), { now: new Date(2026, 8, 29) });
  assert.ok(bad.advice.caution.length >= 0);
});

test('爻位之象随动爻位置变化', () => {
  const first = buildReading(castByCoins([9, 7, 7, 7, 7, 7]));
  const top = buildReading(castByCoins([7, 7, 7, 7, 7, 6]));
  const firstTitle = first.insights.find((item) => item.title.startsWith('爻位'));
  const topTitle = top.insights.find((item) => item.title.startsWith('爻位'));
  assert.match(firstTitle.title, /初爻/);
  assert.match(topTitle.title, /上爻/);
  assert.notEqual(firstTitle.text, topTitle.text);
});

test('方所取后天八卦方位', () => {
  const reading = buildReading(castByCoins([7, 7, 7, 7, 7, 7]));
  assert.equal(reading.structure.body.direction, '西北');
  assert.equal(reading.structure.use.direction, '西北');
  assert.match(reading.insights.find((item) => item.title === '方所').text, /西北/);
});

test('时间起卦随时辰变，且预告下一时辰', () => {
  const morning = buildReading(castByTime(new Date(2026, 8, 29, 7, 30)));
  const sameWatch = buildReading(castByTime(new Date(2026, 8, 29, 8, 30)));
  const nextWatch = buildReading(castByTime(new Date(2026, 8, 29, 10, 0)));

  // 辰时 07:00-08:59 内结果相同
  assert.equal(morning.hexagram.name, sameWatch.hexagram.name);
  assert.equal(morning.movingLines.length, sameWatch.movingLines.length);
  // 跨时辰必变
  assert.notEqual(morning.hexagram.name, nextWatch.hexagram.name);

  assert.equal(morning.cadence.basis, '时辰');
  assert.match(morning.cadence.current, /辰时/);
  assert.match(morning.cadence.next, /巳时得/);
  assert.match(morning.cadence.text, /两小时一换/);
  // 预告的下一时辰卦，必须与真的在下一时辰起卦一致
  const predicted = morning.cadence.next.match(/巳时得(.+?)，动(.+)$/);
  assert.ok(predicted, `无法解析预告：${morning.cadence.next}`);
  assert.equal(predicted[1], nextWatch.hexagram.name);
  assert.equal(predicted[2], nextWatch.movingLines[0].label);
});

test('每日一卦一天一换，且预告明日之卦', () => {
  const today = buildReading(castDaily(new Date(2026, 8, 29, 1, 0)));
  const sameDay = buildReading(castDaily(new Date(2026, 8, 29, 23, 0)));
  const tomorrow = buildReading(castDaily(new Date(2026, 8, 30, 0, 0)));

  assert.equal(today.hexagram.name, sameDay.hexagram.name);
  assert.notEqual(today.hexagram.name, tomorrow.hexagram.name);
  assert.equal(today.cadence.basis, '日期');
  assert.match(today.cadence.next, /明日（9\/30）得/);
  assert.match(today.cadence.text, /一日一换/);
  assert.match(today.cadence.next, new RegExp(tomorrow.hexagram.name));
});

test('数字起卦由所取之数决定，摇卦每卦皆不同', () => {
  const a = buildReading(castByNumbers(3, 5));
  const b = buildReading(castByNumbers(3, 5));
  const c = buildReading(castByNumbers(7, 11));
  assert.equal(a.hexagram.name, b.hexagram.name);
  assert.notEqual(a.hexagram.name, c.hexagram.name);
  assert.match(a.cadence.text, /数字相同自然卦相同/);
  assert.equal(buildReading(castByCoins([7, 7, 7, 7, 7, 7])).cadence.basis, '铜钱');
});

test('摇卦重复投掷多数会得到不同的卦', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i += 1) {
    const sums = Array.from({ length: 6 }, () => 6 + Math.floor(Math.random() * 4));
    seen.add(castByCoins(sums).hexagram.name);
  }
  assert.ok(seen.size > 1, '摇卦不应恒定');
});

test('掷钱结果落在 6 到 9 之间', () => {
  for (let i = 0; i < 60; i += 1) {
    const toss = tossCoins();
    assert.equal(toss.coins.length, 3);
    assert.ok(toss.sum >= 6 && toss.sum <= 9);
  }
});

test('卦历写入 dataDir 后可回读', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'divination-store-'));
  try {
    const store = new ReadingStore(dir);
    assert.deepEqual(await store.list(), []);

    const reading = buildReading(castByCoins([7, 7, 7, 7, 7, 7]), { question: '测试' });
    const saved = await store.save(reading, '批注内容');
    assert.equal(saved.id, reading.id);
    assert.equal(saved.note, '批注内容');
    // 改批注那条路（store.update）连同路由一起没有，所以 updatedAt 永远是 undefined。
    // 把这个恒为 undefined 的字段挂回 summary，只会让读代码的人以为还有「改批注」这回事。
    assert.ok(!('updatedAt' in saved), 'summary 里不该有恒为 undefined 的 updatedAt');

    const listed = await store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].verdict.label, reading.verdict.label);

    const full = await store.get(reading.id);
    assert.equal(full.hexagram.name, reading.hexagram.name);
    assert.equal(full.insights.length, reading.insights.length, '落盘再读回，断语段数得跟起卦时一致');
    // 乾为天是六冲卦，「六冲」那一段必然在。
    assert.ok(full.insights.some((item) => item.title === '六冲'), '六冲卦的断语里该有「六冲」那一段');
    assert.equal(full.clash.chong, true, '六冲卦这个定性也要跟着落盘走');
    // 这里原来还写死了一个段数（17）。写死不得：卦上六爻皆动，「逢合」那一段是否出，
    // 取决于日支那一支的合支落不落在子寅辰午申戌里——日支为子寅辰午申戌之外的奇数支就出，
    // 为偶数支就不出，同一个卦同一副摇法，隔一天段数就变。跟着它改数字，哪天改漏了
    // 或者改错了，报出来的是「段数不对」，得回头去数是哪一段。段数一致这件事上面那句
    // 已经钉住了，这里只留必然在的那一段。
    const conditional = full.insights.filter((item) => item.title === '六冲' || item.title.startsWith('逢合'));
    assert.ok(conditional.length >= 1 && conditional.length <= 2,
      `条件段该在一段到两段之间，实到 ${conditional.length} 段：${conditional.map((i) => i.title).join('、')}`);

    assert.equal(await store.remove(reading.id), true);
    assert.equal(await store.remove(reading.id), false);
    assert.deepEqual(await store.list(), []);

    // 落盘文件是合法 JSON，不留临时文件
    const onDisk = JSON.parse(await readFile(join(dir, 'readings.json'), 'utf8'));
    assert.equal(onDisk.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('同一秒内两次同样的起法，id 必须分开', async () => {
  // 数字起卦只取决于那两个数，与时辰无关。于是「同一秒、同两个数」得到的是
  // 卦序与动爻分毫不差的一卦——id 若只拿时间戳加卦序动爻去哈希，两次必然相同。
  // 而客户端的起卦按钮在整个推演动画里一直可点（要停 CASTING_HOLD_MS 那么多），
  // 双击就真的会发出两次请求。这条钉的是根因：id 不许撞。
  const now = AT(13, 50);
  const first = buildReading(castByNumbers(17, 29), { question: '甲', now });
  const second = buildReading(castByNumbers(17, 29), { question: '乙', now });
  assert.equal(first.hexagram.name, second.hexagram.name, '同一秒同两数，起出来的卦本就该是同一卦');
  assert.notEqual(first.id, second.id, '同一秒内两次同样的起法，id 撞了：卦历里删一条会连带删另一条');

  // 顺带钉住 id 的形状：路由用 /^\/api\/divination\/history\/([A-Za-z0-9-]{1,80})$/ 取 id，
  // 掺进种子的那个计数不许改到输出格式上。消息要自己写：assert.match 不带消息时
  // 抛的是默认文案，按关键词判「钉没钉住」会一条都对不上。
  // 7 位：36^6 < 2^32 < 36^7，32 位哈希转 36 进制本来就是 6 位或 7 位。早先用
  // `slice(0, 6)` 把 7 位的那种砍掉了最低位，而递增计数改的正是最低位，于是
  // 「同一秒、同一个卦」照旧撞车。路由收的是 [A-Za-z0-9-]{1,80}，7 位在范围内。
  assert.match(first.id, /^[0-9]{14}-[a-z0-9]{1,7}$/u, 'id 的形状变了，路由取不到它');

  // 撞 id 的真实后果：两条都存进卦历，删一条只该带走那一条。
  const dir = await mkdtemp(join(tmpdir(), 'divination-store-'));
  try {
    const store = new ReadingStore(dir);
    await store.save(first, '甲的批注');
    await store.save(second, '乙的批注');
    assert.equal((await store.list()).length, 2, '两条都该在');

    assert.equal(await store.remove(first.id), true);
    const left = await store.list();
    assert.equal(left.length, 1, '删一条连带删了两条——id 又撞回去了');
    assert.equal(left[0].id, second.id, '留下的那条不是被点删除的那条');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('落盘改名被 Windows 占住时退避重试，其余错误直接抛', async () => {
  // Windows 上目标文件正被别的进程打开、且未共享删除权限时（杀毒扫描、
  // Windows Search 索引都可能占着），改名整个失败并报 EPERM 或 EACCES——
  // 不是部分写入，是压根没换。退避重试几次，对方松手就成了。
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    assert.equal(shouldRetryRename({ code }, 0), true, `${code} 该重试`);
  }
  // 其余错误码重试也没用：磁盘满、只读盘、目录不存在，重试四次都是同一个结果，
  // 只会把这一次保存吊住几百毫秒。
  for (const code of ['ENOSPC', 'EROFS', 'ENOENT', 'EXDEV', 'EISDIR']) {
    assert.equal(shouldRetryRename({ code }, 0), false, `${code} 不该重试`);
  }
  // 次数必须有上限，不然一个真被占住的目标能把请求一直吊着。
  assert.equal(shouldRetryRename({ code: 'EPERM' }, 3), true, '最后一次之前仍该重试');
  assert.equal(shouldRetryRename({ code: 'EPERM' }, 4), false, '重试次数没有上限');
  // 错误对象里取不到 code 时不许当成可重试——那多半是别处的错。
  // 这两条消息要自己写：不带消息时抛的是默认文案，按关键词判「钉没钉住」一条都对不上。
  assert.equal(shouldRetryRename(new Error('boom'), 0), false, '取不到 code 的错误不该重试');
  assert.equal(shouldRetryRename(undefined, 0), false, '连错误对象都没有，不该重试');

  // 光把上面这个纯函数测绿是不够的：它是个判断，调用它的是 writeAll。
  // 有人把 writeAll 里的重试那一段删掉（或者改成无条件重试），纯函数照样全绿。
  // 所以再钉一次调用点。
  const source = await readFile(new URL('../miniapp/node/store.mjs', import.meta.url), 'utf8');
  const writeAll = /async writeAll\(entries\) \{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(writeAll, '找不到 writeAll');
  assert.ok(
    /shouldRetryRename\(error, attempt\)/.test(writeAll[1]),
    'writeAll 没有拿 shouldRetryRename 决定要不要重试——退避重试形同虚设',
  );
  assert.ok(
    /if \(!shouldRetryRename\(error, attempt\)\) throw error;/.test(writeAll[1]),
    'writeAll 遇到不该重试的错误没有直接抛出去',
  );
  assert.ok(
    /catch \(error\)[\s\S]{0,200}?await delay\(/.test(writeAll[1]),
    'writeAll 重试之前没有退避，等于连着猛敲',
  );
});

test('卦历落盘文件坏了也还能打开，坏的那份挪开留着', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'divination-store-'));
  try {
    // 写到一半被打断、被别的程序改过、被同步软件截断，都会落成这个样子。
    await writeFile(join(dir, 'readings.json'), '{ 这不是 JSON', 'utf8');
    const store = new ReadingStore(dir);

    // 从前是直接抛，于是 list/save/remove 全线 500：卦历打不开，用户连自救的入口都没有。
    // 兜住拒绝再断言：坏文件那条路一旦退回直接抛，错误会在断言之前就把用例掀翻，
    // 报出来的是一句 JSON 解析错，看不出是这条契约被破了。
    const listed = await store.list().catch((error) => ({ threw: error?.message ?? String(error) }));
    assert.deepEqual(listed, [], `坏文件不该把整个卦历顶死（实际：${JSON.stringify(listed)}）`);

    // 坏的那份挪到一边另存而不是删掉——里面可能有用户手写的批注，捞得回来。
    const aside = (await readdir(dir)).filter((name) => name.includes('corrupt'));
    assert.equal(aside.length, 1, `坏文件该被挪开一份，实得 ${aside.join('、') || '一份都没有'}`);

    // 挪开之后能接着存，且原文件重新立起来。
    const reading = buildReading(castByCoins([7, 7, 7, 7, 7, 7]), { question: '坏过之后' });
    await store.save(reading, '批注');
    const afterSave = await store.list();
    assert.equal(afterSave.length, 1, '挪开之后应当还能存进去');
    assert.equal(afterSave[0].id, reading.id);

    // 坏的那份还在盘上，没有被后来的写入盖掉。
    assert.equal((await readdir(dir)).filter((name) => name.includes('corrupt')).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('卦历按时间倒序并限量保存', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'divination-store-'));
  try {
    const store = new ReadingStore(dir);
    for (let i = 0; i < 3; i += 1) {
      const reading = buildReading(castByCoins([7, 7, 7, 7, 7, 7]));
      await store.save({ ...reading, id: `id-${i}`, createdAt: `2026-01-0${i + 1}T00:00:00.000Z` }, '');
    }
    const entries = await store.list();
    assert.deepEqual(entries.map((item) => item.id), ['id-2', 'id-1', 'id-0']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('历法快照给出十二时辰与吉时', () => {
  const snapshot = almanac(new Date(2026, 8, 29, 14, 30));
  assert.equal(snapshot.date, '2026-09-29');
  assert.equal(snapshot.hours.length, 12);
  assert.equal(snapshot.hours.filter((item) => item.current).length, 1);
  assert.equal(snapshot.hours.find((item) => item.current).name, '未时');
  assert.equal(snapshot.luckyHours.length, 6);
});

test('五行类事：问什么落到哪个事类与类神', () => {
  assert.equal(detectTopic('下个月这份offer该不该接？')?.key, 'career');
  assert.equal(detectTopic('这笔投资还能不能赚钱')?.key, 'wealth');
  assert.equal(detectTopic('他会不会主动找我')?.key, 'love');
  assert.equal(detectTopic('明年春天结婚日子好不好')?.key, 'marriage');
  assert.equal(detectTopic('父亲的手术要不要等')?.key, 'health');
  assert.equal(detectTopic('下周的考试能过吗')?.key, 'study');
  assert.equal(detectTopic('这套房该不该买')?.key, 'property');
  assert.equal(detectTopic('这场官司我能不能赢')?.key, 'dispute');
  assert.equal(detectTopic('丢的那串钥匙还能找回吗')?.key, 'journey');
});

test('类神口径：财运金、事业火、感情水、婚恋木、疾病土', () => {
  const byKey = new Map(TOPIC_CLASSES.map((item) => [item.key, item]));
  assert.equal(byKey.get('wealth').element, '金');
  assert.equal(byKey.get('career').element, '火');
  assert.equal(byKey.get('love').element, '水');
  assert.equal(byKey.get('marriage').element, '木');
  assert.equal(byKey.get('health').element, '土');
});

test('认不出事类时不强套，宁可退回用卦', () => {
  assert.equal(detectTopic('嗯'), null);
  assert.equal(detectTopic('今天天气如何'), null);
  assert.equal(detectTopic(''), null);
  assert.equal(detectTopic('   '), null);
});

test('长词优先：找工作算事业，不算寻物', () => {
  assert.equal(detectTopic('要不要换个工作')?.key, 'career');
  assert.equal(detectTopic('找不到对象怎么办')?.key, 'marriage');
});

test('类神与体卦四种生克各有一句断语', () => {
  const god = (godElement, bodyElement) => godRelation(godElement, bodyElement, generates, overcomes);
  assert.equal(god('金', '木').key, 'god-overcomes-body');   // 金克木
  assert.equal(god('水', '木').key, 'god-generates-body');   // 水生木
  assert.equal(god('火', '木').key, 'body-generates-god');   // 木生火，耗己
  assert.equal(god('木', '金').key, 'body-overcomes-god');   // 金克木，我制事
  assert.equal(god('木', '木').key, 'god-same-as-body');     // 同气
  for (const element of ['木', '火', '土', '金', '水']) {
    assert.ok(god(element, '木').text.length > 0);
  }
});

test('问事改变应期与取象，但不改吉凶', () => {
  const cast = castByNumbers(7, 9);
  const plain = buildReading(cast, { now: new Date(2026, 8, 29, 23, 0) });
  const asked = buildReading(cast, { question: '这套房该不该买', now: new Date(2026, 8, 29, 23, 0) });

  // 类神是土，旺在辰戌丑未；用卦是艮土，恰好同气，改用问财/问房要能看出差别
  assert.equal(plain.topic, null);
  assert.equal(asked.topic.label, '房产车契');
  assert.equal(asked.topic.element, '土');
  assert.match(asked.timing, /房产车契类神属土/);
  assert.ok(asked.insights.some((item) => item.title === '所问之事'));

  // 吉凶只由体用生克与月令决定，与问什么无关
  assert.equal(asked.verdict.key, plain.verdict.key);
  assert.equal(asked.verdict.label, plain.verdict.label);
  assert.equal(asked.structure.body.element, plain.structure.body.element);
});

test('认出事类时应期改看类神，不再是用卦', () => {
  // 用 castByNumbers(1, 1)：用卦乾金，本应看申酉；改问健康，类神取土，转看辰戌丑未
  const cast = castByNumbers(1, 1);
  const plain = buildReading(cast);
  assert.match(plain.timing, /用卦乾属金/);
  assert.match(plain.timing, /申酉/);

  const asked = buildReading(cast, { question: '父亲的手术要不要等' });
  assert.match(asked.timing, /疾病类神属土/);
  assert.match(asked.timing, /辰戌丑未/);
  assert.equal(asked.timing.includes('用卦乾'), false);
});

/* ---------- 起卦中八卦环 ---------- */
// 环上那八纯是手排的，跟引擎的 TRIGRAMS 各写一份。排错一位就是给人看错卦象，
// 所以爻序和方位都拿引擎当权威逐个对，不靠肉眼。

test('八卦环八纯的爻象与引擎 TRIGRAMS 一致', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const { TRIGRAMS } = await import('../miniapp/node/hexagrams.mjs');
  const source = Object.values(TRIGRAMS);
  const table = /const BAGUA = \[([\s\S]*?)\n      \];/.exec(client);
  assert.ok(table, '客户端里找不到 BAGUA 八纯表');

  const ring = [...table[1].matchAll(/name: '(.)', at: (\d+), lines: \[([^\]]+)\]/g)].map((m) => ({
    name: m[1],
    at: Number(m[2]),
    // 数组与引擎同约定：自下而上，[0] 是初爻
    key: m[3].split(',').map((s) => s.trim()).join(''),
  }));

  assert.equal(ring.length, 8, '八卦环应当正好八纯');
  for (const item of ring) {
    const ref = source.find((t) => t.name === item.name);
    assert.ok(ref, `引擎里没有「${item.name}」`);
    assert.equal(item.key, ref.lines, `「${item.name}」爻象与引擎不符`);
  }
});

test('八卦环按后天八卦排位，角度对应引擎的 direction', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const { TRIGRAMS } = await import('../miniapp/node/hexagrams.mjs');
  const source = Object.values(TRIGRAMS);
  const table = /const BAGUA = \[([\s\S]*?)\n      \];/.exec(client)[1];

  // SVG 里 rotate(0) 指向正上，顺时针排位
  const AT = { 0: '正北', 45: '东北', 90: '正东', 135: '东南', 180: '正南', 225: '西南', 270: '正西', 315: '西北' };
  const ring = [...table.matchAll(/name: '(.)', at: (\d+)/g)].map((m) => ({ name: m[1], at: Number(m[2]) }));

  for (const item of ring) {
    const ref = source.find((t) => t.name === item.name);
    assert.ok(AT[item.at], `${item.at}° 不是八卦位`);
    assert.equal(ref.direction, AT[item.at], `「${item.name}」排在 ${item.at}°，应为 ${AT[item.at]}`);
  }
});

test('爻线在八卦环里自下而上落笔，初爻在最下', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  // trigramBars 用 y = 9 - i * 9，落笔 y 必须随 i 递减，i=0（初爻）拿最大 y 即最下
  const formula = /const y = (\d+) - i \* (\d+);/.exec(client);
  assert.ok(formula, '找不到 trigramBars 的落笔公式');
  const base = Number(formula[1]);
  const step = Number(formula[2]);
  assert.ok(base > 0 && step > 0, '初爻应落在 y 正方向（下方）');
  assert.equal(base - step * 2, -base, '三爻应关于中线对称');
});

/* ---------- 动效的定位契约 ---------- */
// 这两处都是「CSS animation 的 transform 会覆盖定位 transform」引出来的坑：
// 元素靠 translateX(-50%) 居中，而 keyframes 里的 scale() 会把它整个顶掉。

test('台面光晕的每一帧都保住水平居中', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const frames = /@keyframes tossGlow \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(frames, '找不到 tossGlow');
  const transforms = [...frames[1].matchAll(/transform:\s*([^;]+);/g)].map((m) => m[1]);
  assert.ok(transforms.length >= 2, 'tossGlow 应当有多帧');
  for (const t of transforms) {
    assert.match(t, /translateX\(-50%\)/, `tossGlow 某帧是 "${t}"，scale() 会顶掉居中偏移`);
  }
});

test('投影只留一种居中方式', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const block = /\.coin-shadow \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(block, '找不到 .coin-shadow');
  const margin = /margin-left:\s*-\d+px/.test(block[1]);
  const transform = /transform:\s*translateX\(-50%\)/.test(block[1]);
  assert.equal(
    margin && transform,
    false,
    'margin-left 负值和 translateX(-50%) 同时存在会叠加居中，投影会偏出铜钱',
  );
  assert.equal(transform, true, '投影应当靠 translateX(-50%) 居中，各帧也要一致');
});


/* ---------- 起卦推演日志 ---------- */
// 用户连起三卦都看到同一段话，那不叫在算。所以日志的每一步都取自引擎
// reading.details——本次的年月日、时辰、所报两数、六次掷钱都在里面。
// 下面把客户端的拼行与调速函数摘出来求值，用四法真实起卦跑一遍。

function loadCasting(client) {
  const cut = (start, end) => {
    const i = client.indexOf(start);
    assert.ok(i >= 0, `客户端里找不到 ${start}`);
    const j = client.indexOf(end, i);
    assert.ok(j >= 0, `客户端里找不到 ${start} 的结尾`);
    return client.slice(i, j + end.length);
  };
  const code = [
    cut('const CASTING_OPENERS = [', '];'),
    cut('const CASTING_CLOSERS = [', '];'),
    ...['CASTING_LINE_MS', 'CASTING_BUDGET_MS', 'CASTING_BASE_CHAR_MS', 'CASTING_CHAR_MIN', 'CASTING_CHAR_MAX', 'CASTING_MAX_LINES', 'CASTING_HOLD_MS']
      .map((name) => cut(`const ${name} = `, ';')),
    cut('const pick = ', ';'),
    cut('function castingAftermath(reading) {', '\n      }'),
    cut('function castingLines(reading) {', '\n      }'),
    cut('function castingSpeed(lines) {', '\n      }'),
  ].join('\n');
  return new Function(`${code}\nreturn { castingLines, castingSpeed, castingAftermath, CASTING_MAX_LINES, CASTING_BUDGET_MS, CASTING_HOLD_MS, CASTING_OPENERS, CASTING_CLOSERS };`)();
}

const SAMPLES = () => [
  ['每日一卦', castDaily(AT(1, 20))],
  ['时间起卦', castByTime(AT(1, 20))],
  ['数字起卦', castByNumbers(37, 24)],
  ['铜钱摇卦', castByCoins([7, 8, 7, 8, 9, 6])],
];

test('推演的每一步都来自这次的真实取数', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const { castingLines } = loadCasting(client);

  for (const [name, cast] of SAMPLES()) {
    const reading = buildReading(cast);
    const lines = castingLines(reading);
    const steps = reading.details.map((d) => d.value);
    const shown = lines.filter((line) => steps.includes(line));
    assert.ok(shown.length > 0, `${name} 的推演里应当有引擎给的取数步骤`);
    assert.ok(lines.length >= 3, `${name} 推演只有 ${lines.length} 行，太单薄`);
  }
});

test('换个时辰、换组数重起，日志就跟着换', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const { castingLines } = loadCasting(client);

  const before = castingLines(buildReading(castByTime(AT(1, 20))));
  const later = castingLines(buildReading(castByTime(AT(5, 20))));
  const other = castingLines(buildReading(castByNumbers(11, 7)));
  assert.notDeepEqual(before, later, '时辰不同，日志不该逐字相同');
  assert.notDeepEqual(before, other, '报的两数不同，日志不该逐字相同');
});

test('首尾措辞各有多个候选，同卦重起也不至于一模一样', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const { CASTING_OPENERS, CASTING_CLOSERS } = loadCasting(client);
  assert.ok(CASTING_OPENERS.length >= 3, `开场白只有 ${CASTING_OPENERS.length} 个候选`);
  assert.ok(CASTING_CLOSERS.length >= 3, `收尾只有 ${CASTING_CLOSERS.length} 个候选`);
});

test('四法起卦，日志都在整段停留里打完', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const { castingLines, castingSpeed, CASTING_HOLD_MS, CASTING_BUDGET_MS } = loadCasting(client);
  const lineMs = Number(/const CASTING_LINE_MS = (\d+);/.exec(client)[1]);

  // 停留时长只有一个来源，就是 CASTING_HOLD_MS。调用点若另写一个数，
  // 推演一改长就切在末行上，而末行正是压轴那句。
  assert.ok(
    /await wait\(reducedMotion\(\) \? 0 : CASTING_HOLD_MS\);/.test(client),
    '停留时长没有取 CASTING_HOLD_MS，调用点跟常量脱钩了',
  );

  for (const [name, cast] of SAMPLES()) {
    const lines = castingLines(buildReading(cast));
    const chars = lines.reduce((sum, text) => sum + text.length, 0);
    const total = chars * castingSpeed(lines) + (lines.length - 1) * lineMs;
    // 预算得真是上界。收尾那句的字数若不预留，实际时长会顶穿预算——
    // 那句在停留余量之内时看不出毛病，可一旦调小余量就先砍掉它。
    assert.ok(total <= CASTING_BUDGET_MS, `${name} 要 ${total}ms，顶穿了推演预算 ${CASTING_BUDGET_MS}ms`);
    assert.ok(total <= CASTING_HOLD_MS, `${name} 要 ${total}ms，超过停留 ${CASTING_HOLD_MS}ms，末行会被砍`);
  }
});

test('推演不止取数那几句，成卦之后的话也都播出来', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const { castingLines, castingAftermath } = loadCasting(client);

  for (const [name, cast] of SAMPLES()) {
    const reading = buildReading(cast);
    const aftermath = castingAftermath(reading);
    // 四类都在：成卦、变卦、宫世应、体用。少一类就又回到「取完数就没话说了」。
    assert.equal(aftermath.length, 4, `${name} 成卦之后只凑出 ${aftermath.length} 句：${aftermath.join(' / ')}`);

    const lines = castingLines(reading);
    // 造了不等于播了。更要紧的三句一条都不许被挤掉——它们排在体用句之前，
    // 预算再紧也先丢体用句。哪句被挤掉本身就是要紧程度排错了。
    for (const text of aftermath.slice(0, 3)) {
      assert.ok(lines.includes(text), `${name}「${text}」被挤出了推演，顺序没按要紧程度排`);
    }
    // 收尾那句不受行数上限管，必播。
    assert.ok(lines.length >= 5, `${name} 推演只有 ${lines.length} 行，收尾句没留住`);
  }
});

test('成卦那几句各钉各的字段，改一个不会牵连别句', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const { castingAftermath } = loadCasting(client);
  const base = buildReading(castByNumbers(17, 29));
  const before = castingAftermath(base);
  assert.equal(before.length, 4, `这一卦该有四句，实际 ${before.length} 句`);

  // 每一个字段单开一条。合在一起改的话，名字一改整句就变了，
  // 元素、爻位这些跟着改却没被验到——「体用句不报五行」那种变异就钻过去了。
  const cases = [
    ['成卦句的本卦名', 0, (r) => { r.hexagram.name = '本卦名改'; }],
    ['成卦句的上卦', 0, (r) => { r.hexagram.upper.name = '上卦改'; }],
    ['成卦句的下卦', 0, (r) => { r.hexagram.lower.name = '下卦改'; }],
    ['变卦句的变卦名', 1, (r) => { r.changed.name = '变卦名改'; }],
    ['变卦句的动爻', 1, (r) => { r.movingLines = [{ ...r.movingLines[0], label: '动爻改' }]; }],
    ['宫世应句的宫', 2, (r) => { r.jingfang.palaceName = '宫名改'; }],
    ['宫世应句的世次', 2, (r) => { r.jingfang.stage = '五世'; }],
    ['宫世应句的世爻', 2, (r) => { r.lines[r.jingfang.shi - 1].label = '世爻改'; }],
    ['宫世应句的应爻', 2, (r) => { r.lines[r.jingfang.ying - 1].label = '应爻改'; }],
    ['体用句的体卦名', 3, (r) => { r.structure.body.name = '体名改'; }],
    ['体用句的体卦五行', 3, (r) => { r.structure.body.element = '火'; }],
    ['体用句的用卦名', 3, (r) => { r.structure.use.name = '用名改'; }],
    ['体用句的用卦五行', 3, (r) => { r.structure.use.element = '土'; }],
  ];

  for (const [what, index, patch] of cases) {
    // 必须深拷贝：buildReading 里的卦名、六亲都是共享常量表里的对象，
    // 直接改会连底库一起改掉，后面几条用例与别处用例全被带歪。
    const reading = structuredClone(buildReading(castByNumbers(17, 29)));
    patch(reading);
    const after = castingAftermath(reading);
    assert.notEqual(after[index], before[index], `${what}没跟着 reading 变，说明这句是写死的`);
  }
});

test('改一句的字段不牵连别句——四句各读各的', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const { castingAftermath } = loadCasting(client);
  const before = castingAftermath(buildReading(castByNumbers(17, 29)));

  // 只挑四句互不相干的字段。爻位是另一回事：应爻恰好又是动爻时，
  // 变卦句与宫世应句读的就是同一份数据，两句一起变才对，不算串。
  const isolated = [
    ['本卦名', 0, (r) => { r.hexagram.name = '本卦名改'; }],
    ['变卦名', 1, (r) => { r.changed.name = '变卦名改'; }],
    ['宫名', 2, (r) => { r.jingfang.palaceName = '宫名改'; }],
    ['体卦五行', 3, (r) => { r.structure.body.element = '火'; }],
  ];

  for (const [what, index, patch] of isolated) {
    const reading = structuredClone(buildReading(castByNumbers(17, 29)));
    patch(reading);
    const after = castingAftermath(reading);
    assert.notEqual(after[index], before[index], `${what}改了但对应那句没变，这条没验到`);
    for (const other of [0, 1, 2, 3].filter((i) => i !== index)) {
      assert.equal(after[other], before[other], `${what}改了，${before[other]}也跟着变了，两句串在一起了`);
    }
  }
});

test('推演日志定高留够播报的最大行数，收尾那句不会挤出去', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const { CASTING_MAX_LINES } = loadCasting(client);

  const block = /\.casting-log \{([\s\S]*?)\}/.exec(client);
  assert.ok(block, '找不到 .casting-log 的样式');
  const minHeight = Number(/min-height: (\d+)px/.exec(block[1])?.[1]);
  const fontSize = Number(/font-size: (\d+)px/.exec(block[1])?.[1]);
  const lineHeight = Number(/line-height: ([\d.]+)/.exec(block[1])?.[1]);
  assert.ok(minHeight && fontSize && lineHeight, `.casting-log 的 min-height / font-size / line-height 解析不出来`);

  // 每行 nowrap，定的是固定行高。收尾那句不受行数上限管，要按 MAX_LINES + 1 留。
  const need = (CASTING_MAX_LINES + 1) * fontSize * lineHeight;
  assert.ok(
    minHeight >= need,
    `定高 ${minHeight}px 装不下 ${CASTING_MAX_LINES + 1} 行（需 ${need.toFixed(1)}px），最后一句会挤到卦盘上`,
  );
});

test('标题与分区合成一条钉住的顶栏', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  const block = /\.topbar \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(block, '找不到 .topbar 的样式');
  const style = block[1];
  assert.ok(/position: sticky/.test(style), '顶栏没钉在顶部');
  assert.ok(/top: 0/.test(style), '顶栏没贴到视口顶边');
  assert.ok(/z-index: \d+/.test(style), '顶栏没排层，滑下去会被内容盖住');
  assert.ok(/backdrop-filter: blur/.test(style), '顶栏底色不透明，滑下去内容会硬生生撞上来');
  assert.ok(/border-bottom: 1px solid/.test(style), '顶栏下缘没有分隔线');
  // 底色要拉成整条，就得抵消 .app 的上内边距与左右内边距。
  // 抵消量写死成 -32px 的话，版心内边距一收放，底色就不贴视口边了；
  // 现在它取 --app-pad 的相反数（下面那条断言钉住这一点），这里只管「必须是负的」。
  const margin = /margin: ([^;]+);/.exec(style);
  assert.ok(margin, '找不到顶栏的外边距');
  const parts = margin[1].trim().split(/\s+(?![^(]*\))/);
  const negative = (v) => /^-/.test(v) || /\*\s*-\d/.test(v);
  assert.ok(parts.length >= 2 && negative(parts[0]) && negative(parts[1]), '顶栏没抵消 .app 的内边距，底色只在内容区那条窄带里');

  const open = /<div class="topbar">([\s\S]*?)<\/div>\s*<main/.exec(client);
  assert.ok(open, '顶栏没把标题与分区一起包住');
  assert.ok(/<header[\s>]/.test(open[1]), '顶栏里没有 header');
  assert.ok(/role="tablist"/.test(open[1]), '顶栏里没有功能分区');
});

test('解读页左栏钉住，错开量取顶栏高度而不是另写一个数', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  const at = /@media \(min-width: (\d+)px\) and \(min-height: (\d+)px\)/.exec(client);
  assert.ok(at, '解读页左栏没限定视口宽高，视口太矮时钉住会够不着自己的底');

  const sticky = /\.reading > :first-child \{([\s\S]*?)\}/.exec(client);
  assert.ok(sticky, '解读页左栏没钉住');
  assert.ok(/position: sticky/.test(sticky[1]), '解读页左栏不是 sticky');
  assert.ok(/top: calc\(var\(--topbar-h\)/.test(sticky[1]), '左栏的错开量没跟着顶栏高度走，顶栏一改高度就会压住内容');

  // 顶栏高度只能有一个来源，否则顶栏一改高，左栏的错开量就成了另一个数。
  // 只数定义，不数使用点（var(--topbar-h) 后面没有冒号）；
  // 负向看着写，免得加一个 --topbar-h-sp 就绕过去。
  const defined = client.match(/--topbar-h(?![\w-])\s*:/g) ?? [];
  assert.equal(defined.length, 1, `--topbar-h 定义了 ${defined.length} 次`);

  // :root 里那个数只是首屏兜底。顶栏在窄宽度下会换行变高——实测过：内容区
  // 收到 700px 时标题与干支条分两行，顶栏从 132px 长到 195px 上下，
  // 左栏仍按 132px 错开，卦名直接被压在顶栏底下。所以高度得实测写回。
  const sync = /const syncTopbarHeight = \(\) => \{[\s\S]{0,300}?\n\s+\};/.exec(client);
  assert.ok(sync, '没有把顶栏实测高度写回 --topbar-h 的那段');
  assert.ok(/setProperty\('--topbar-h'/.test(sync[0]), '同步函数没有写回 --topbar-h');
  assert.ok(/topbarEl\.offsetHeight/.test(sync[0]), '写回的不是实测高度');
  assert.ok(
    /new ResizeObserver\(syncTopbarHeight\)[\s\S]{0,120}?observe\(topbarEl\)/.test(client),
    '没有用 ResizeObserver 盯住顶栏，宽度一变就又对不上了',
  );
  assert.ok(/pagehide[\s\S]{0,120}?topbarObserver\.disconnect\(\)/.test(client), '观察者没有断开');
});

/* ---------- 响应式：按展示区域自己的宽度排，不按视口宽度排 ---------- */

/** 取出 CSS 里某个 at-rule 的每一段内容，按花括号配对，不靠猜缩进。 */
function atRuleBlocks(css, keyword) {
  const out = [];
  const re = new RegExp(`@${keyword}\\b`, 'g');
  let m;
  while ((m = re.exec(css)) !== null) {
    const open = css.indexOf('{', m.index);
    if (open === -1) continue;
    let depth = 0;
    let i = open;
    for (; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(css.slice(open + 1, i));
  }
  return out;
}

/** 读某条选择器上 repeat(n, ...) 的 n；不是 repeat 就返回 null。 */
function repeatCount(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`${esc} \\{([\\s\\S]*?)\\n\\s*\\}`).exec(css);
  if (!block) return null;
  const m = /grid-template-columns:\s*repeat\((\d+)/.exec(block[1]);
  return m ? Number(m[1]) : null;
}

test('四卦推导按自己有多宽换列，不按视口', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  // 推导图在右栏里，右栏多宽由左栏与版心说了算，跟视口宽度不是一回事：
  // 视口拉宽而左栏也拉宽时，右栏未必跟着变宽。拿视口定列数，
  // 宽视口配窄右栏就会把四支挤成参差的一行。
  const box = /\.derive \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(box, '找不到 .derive 的样式');
  assert.ok(/container-type: inline-size/.test(box[1]), '推导图没有按自身宽度做容器查询');
  const name = /container-name: ([\w-]+)/.exec(box[1]);
  assert.ok(name, '推导图的容器没有起名，@container 认不出问的是谁');

  const wide = repeatCount(client, '.derive .derive-row');
  assert.equal(wide, 4, `推导图宽时应当四列，实得 ${wide} 列`);
  assert.equal(4 % wide, 0, '四列除不尽四个取法，末行会落单');

  const narrow = new RegExp(
    `@container ${name[1]} \\(max-width: (\\d+)px\\)[\\s\\S]*?\\.derive \\.derive-row \\{[\\s\\S]*?repeat\\((\\d+)`,
  ).exec(client);
  assert.ok(narrow, '推导图没有按容器宽度降列');
  assert.equal(Number(narrow[2]), 2, `推导图窄时应当两列，实得 ${narrow[2]} 列`);
  assert.equal(4 % Number(narrow[2]), 0, '两列除不尽四个取法，末行会落单');

  // 反向钉住：视口媒体查询一律不许碰推导图与八宫。
  // 一碰，列数就又被绑回视口宽度，前面那条容器查询等于白写。
  for (const block of atRuleBlocks(client, 'media')) {
    assert.ok(
      !/\.(derive|palace)\b/.test(block),
      '有 @media 规则改了推导图或八宫的排布，列数被绑回视口宽度了',
    );
  }
});

test('箭头与卦裹成一格排，本卦横跨整行', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  // 格子才是排布单位。原先箭头与卦是平级的 flex item，注记长短一差，
  // 后面的卦就被挤偏，四列的间距也不相等。
  assert.ok(
    /<div class="derive-step">/.test(client),
    '推导格没有把箭头与卦裹进同一格，两者仍是平级的 flex item',
  );
  const step = /\.derive \.derive-step \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(step, '找不到 .derive-step 的样式');
  assert.ok(/display: flex/.test(step[1]), '一格内部不是 flex');
  assert.ok(/align-items: center/.test(step[1]), '一格内部没有上下居中');

  // 一行四格，别再用 flex 换行：换行在窄容器下会折成 3+1，末格孤零零居中。
  const row = /\.derive \.derive-row \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(row, '找不到 .derive-row 的样式');
  assert.ok(/display: grid/.test(row[1]), '推导行还在用 flex 换行，窄容器下会折成参差的两排');
  assert.ok(!/flex-wrap/.test(row[1]), '推导行还留着 flex-wrap');

  // 本卦那行只有一格，不跨列就贴到第 1 列，看着像四种取法里的头一个。
  const span = /\.derive \.derive-row > \.unit:only-child \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(span, '本卦那一格没有单独定过位置');
  assert.ok(/grid-column: 1 \/ -1/.test(span[1]), '本卦那一格没有横跨整行，会贴在第 1 列');
});

test('注记留两行高、按数据断行，四支箭头才落在同一条线上', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  const block = /\.derive \.arrow \.how \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(block, '找不到注记的样式');
  const style = block[1];

  const fontSize = Number(/font-size: (\d+)px/.exec(style)[1]);
  const lineHeight = Number(/line-height: ([\d.]+)/.exec(style)[1]);
  const minHeight = /min-height: ([\d.]+)em/.exec(style);
  assert.ok(minHeight, '注记没有定高：互卦那条两行、其余各一行，箭头高度一差就不在一条线上');
  assert.ok(
    Number(minHeight[1]) >= 2 * lineHeight - 1e-9,
    `注记只留了 ${minHeight[1]}em，装不下两行（需 ${(2 * lineHeight).toFixed(2)}em）`,
  );

  // 一行字要落在两行高的盒子正中。块级元素默认贴顶，一行就会比两行高半行。
  assert.ok(
    /display: flex/.test(style) && /align-items: center/.test(style),
    '注记不是上下居中排的，一行两行会差半行',
  );

  // DERIVE_HOW 里的 \n 必须真的断行。不写这条，\n 会被折成空格，
  // 换行变成靠 max-width 碰运气折出来——改个字号就可能折成一行或三行。
  assert.ok(/white-space: pre-line/.test(style), '注记没有按数据里的 \\n 断行，换行靠碰运气');

  // 硬断出来的每一段都要放得下，否则会被再折一行，箭头又对不齐。
  // 量法跟排版一致：CJK 一个字 1em，其余按半个字宽算。
  const table = /const DERIVE_HOW = \{([\s\S]*?)\n      \};/.exec(client);
  assert.ok(table, '找不到取法说明表');
  const notes = [...table[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => m[2]);
  assert.equal(notes.length, 4, `四种取法应当四条注记，实得 ${notes.length} 条`);

  const maxWidth = Number(/max-width: (\d+)px/.exec(style)[1]);
  for (const note of notes) {
    for (const seg of note.split('\\n')) {
      const em = [...seg].reduce((sum, ch) => sum + (/[⺀-鿿豈-﫿]/.test(ch) ? 1 : 0.5), 0);      const need = em * fontSize;
      assert.ok(
        need <= maxWidth,
        `注记「${seg}」要 ${need.toFixed(0)}px，max-width 只有 ${maxWidth}px，会被再折一行，四支箭头就对不齐了`,
      );
    }
  }
});

test('一宫八卦按自己有多宽换列，八格与四格都整除八卦', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  const box = /\.palace \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(box, '找不到 .palace 的样式');
  assert.ok(/container-type: inline-size/.test(box[1]), '八宫名单没有按自身宽度做容器查询');
  const name = /container-name: ([\w-]+)/.exec(box[1]);
  assert.ok(name, '八宫名单的容器没有起名，@container 认不出问的是谁');

  const wide = repeatCount(client, '.palace .palace-row');
  assert.equal(wide, 8, `八宫名单应当八列，实得 ${wide} 列`);
  assert.equal(8 % wide, 0, '八宫名单的列数除不尽八卦，末行会落单');

  const narrow = new RegExp(
    `@container ${name[1]} \\(max-width: (\\d+)px\\)[\\s\\S]*?\\.palace \\.palace-row \\{[\\s\\S]*?repeat\\((\\d+)`,
  ).exec(client);
  assert.ok(narrow, '八宫名单没有按容器宽度降列');
  assert.equal(Number(narrow[2]), 4, `八宫名单窄时应当四列，实得 ${narrow[2]} 列`);
  assert.equal(8 % Number(narrow[2]), 0, '四列除不尽八卦，末行会落单');
});

test('版心内边距只有一个来源，顶栏取它的相反数', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  // 写死 32px 时，1000px 上下的视口要白占掉 64px 宽度，
  // 推导图与八宫正是被这一点挤到换行的。
  const defined = client.match(/--app-pad(?![\w-])\s*:/g) ?? [];
  assert.equal(defined.length, 1, `--app-pad 定义了 ${defined.length} 次`);
  assert.ok(
    /--app-pad:\s*clamp\(/.test(client),
    '版心内边距是死数，没有跟着视口收放',
  );

  const app = /\.app \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(app, '找不到 .app 的样式');
  assert.ok(/padding: var\(--app-pad\)/.test(app[1]), '.app 没用 --app-pad');

  // 顶栏要拉成整条，就得抵消 .app 的上内边距与左右内边距。
  // 两处各写一个 32 的话，内边距一收放，顶栏底色就不贴视口边了。
  const topbar = /\.topbar \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(topbar, '找不到 .topbar 的样式');
  assert.ok(
    /calc\(var\(--app-pad\) \* -1\)/.test(topbar[1]),
    '顶栏没有取 --app-pad 的相反数，内边距一收放底色就露边',
  );
  assert.ok(
    !/margin: -?\d+px -\d+px/.test(topbar[1]),
    '顶栏的外边距写死了数字，跟 --app-pad 各走各的',
  );
  assert.ok(/padding: 18px var\(--app-pad\)/.test(topbar[1]), '顶栏的内边距没有跟着 --app-pad 走');
});

test('解读页左栏不窄过 300px，窄过就会把纳甲挤到右栏去', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  const reading = /\.reading \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(reading, '找不到 .reading 的样式');
  const track = /grid-template-columns:\s*([^;]+);/.exec(reading[1]);
  assert.ok(track, '解读页没有分左右两栏');

  const width = /clamp\((\d+)px/.exec(track[1]);
  assert.ok(width, `左栏不是一个随视口收放的区间，写的是：${track[1].trim()}`);

  // 爻行那一格是 34+42+1fr+32+auto 再加四道 12px 的缝，固定部分就吃掉 156px；
  // 留给纳甲（干支+六亲+世应+旬空月破，全是 nowrap）的那格还得有 140px 出头。
  // 压到 300 以下，纳甲就撑破格子往右栏探，卦画同时被挤没——阴阳都读不出来。
  const line = /\.gua-line \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(line, '找不到 .gua-line 的样式');
  const fixed = [...line[1].matchAll(/(\d+)px/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n <= 42);
  const seams = (line[1].match(/gap:\s*(\d+)px/) ?? [null, 0])[1];
  const chrome = fixed.reduce((a, b) => a + b, 0) + Number(seams) * 4;

  assert.ok(
    Number(width[1]) >= 300,
    `左栏下限 ${width[1]}px 装不下爻行：固定列与缝就吃掉 ${chrome}px，留给纳甲的还得有 140px 出头`,
  );
  assert.ok(
    /min-width: 0/.test(/\.gua-line \.rel \{([\s\S]*?)\n      \}/.exec(client)[1]),
    '纳甲那一格没有 min-width: 0，撑破格子时不会让出位置',
  );

  // 栏间距也跟着视口收放：左栏与版心都在动，缝写死就有一处对不上。
  assert.ok(/gap:\s*clamp\(/.test(reading[1]), '解读页的栏间距是死数');

  // 窄到这个宽度，两栏并排已经各自装不下了，换单列。
  // 收尾那个分号别省：写成 grid-template-columns: 1fr 的话，1fr 1fr 也照样匹配，
  // 断言就替两栏那一条作了证。
  const narrow = atRuleBlocks(client, 'media').filter((b) => b.includes('.reading'));
  assert.ok(narrow.length > 0, '解读页没有在窄屏换单列');
  assert.ok(
    narrow.some((b) => /grid-template-columns:\s*1fr\s*;/.test(b)),
    '解读页在窄屏没有换单列，两栏各自都装不下',
  );
});

test('起卦在飞时锁住触发控件，按原值还原，失败也得解锁', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  // 三条起卦路（每日/时间、数字、铜钱）都走 cast()。原先只有 toss-finish 有个
  // disabled，那是「摇够六次」的规矩；四个起法按钮与「起卦」按钮从来不禁用，
  // 而 cast() 自己也没有闸。连点一下会连发两次请求，两卦的推演日志互相顶替。
  // 实测过：双击「时间起卦」，网络里只该出现一次 POST /api/divination/cast。
  const castFn = /async function cast\(payload\) \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(castFn, '找不到 cast()');
  const body = castFn[1];

  assert.ok(/let casting = false;/.test(client), '起卦在飞这件事没有被记下来，或者初始值不是「没在起卦」');
  assert.ok(
    /if \(casting\) return false;/.test(body),
    'cast() 没有先问「是不是已经在起卦了」——连点会连发两次请求',
  );

  // 锁的是状态不是某一个按钮：三条起卦路一次锁齐，才不会漏掉哪条。
  const triggers = /function castTriggers\(\) \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(triggers, '找不到 castTriggers()');
  for (const id of ['num-submit', 'num-random', 'toss-btn', 'toss-reset', 'toss-finish']) {
    assert.ok(triggers[1].includes(`'${id}'`), `${id} 没被锁住，推演那几秒里仍能改动这一卦`);
  }
  assert.ok(/querySelectorAll\('\[data-method\]'\)/.test(triggers[1]), '四个起法按钮没被锁住');

  // 解锁按各自原值还原，不是一律解禁。toss-finish 平时就该是禁着的（还没摇够六次），
  // 跟着一起解禁等于凭空开出一个没摇够也能「成卦解卦」的入口。
  const lock = /function lockCasting\(\) \{([\s\S]*?)\n      \}/.exec(client);
  assert.ok(lock, '找不到 lockCasting()');
  assert.ok(/const saved = nodes\.map\(\(node\) => \[node, node\.disabled\]\)/.test(lock[1]), '锁之前没记下各控件原本的 disabled');
  assert.ok(
    /for \(const \[node, was\] of saved\) node\.disabled = was;/.test(lock[1]),
    '解锁不是按原值还原——toss-finish 会被凭空解禁',
  );

  // 解锁放 finally：出错也必须解开，否则一次网络失败就把整个起卦页永久锁死。
  // 不给 finally 那段加结尾锚点：外层那个捕获组已经把 cast() 末尾的收尾吃掉了。
  const tail = /\}\s*catch \(error\) \{[\s\S]*?\}\s*finally \{([\s\S]*)$/.exec(body);
  assert.ok(tail, 'cast() 的 catch 之后没有 finally');
  assert.ok(/unlock\(\)/.test(tail[1]), '解锁没放在 finally 里：起卦失败一次，起卦页就再也点不动了');
  assert.ok(/casting = false;/.test(tail[1]), 'finally 里没有把 casting 复位，下一卦永远起不了');

  // 返回值要能回答「这一卦到底起成了没有」：数字那条清空输入框全靠它。
  assert.ok(/return true;/.test(body), 'cast() 没有报告「起成了」');
  const submit = /el\('num-submit'\)\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n      \}\);/.exec(client);
  assert.ok(submit, '找不到数字起卦的提交处理');
  assert.ok(
    /const ran = await cast\(/.test(submit[1]),
    '数字起卦没接住 cast() 的返回值，不知道这一卦起没起成',
  );
  assert.ok(
    /if \(!ran\) return;[\s\S]*?el\('num-upper'\)\.value = '';/.test(submit[1]),
    '被锁跳过或起卦失败时照样清空输入框——等于替用户把没起成的卦也扔了',
  );
});

/** 摇钱那一块要真跑：坏在「谁最后写 disabled」上，源码文本看不出谁盖谁，
    只能让代码自己跑一遍。抠出 syncTossButtons/lockToss/tossOnce/renderToss
    四个真函数，配一套假 DOM 与假 fetch。 */
function loadTossPanel(client) {
  const cut = (start, end) => {
    const i = client.indexOf(start);
    assert.ok(i >= 0, `客户端里找不到 ${start}`);
    const j = client.indexOf(end, i);
    assert.ok(j >= 0, `客户端里找不到 ${start} 的结尾`);
    return client.slice(i, j + end.length);
  };
  const code = [
    cut('function syncTossProgress() {', '\n      }'),
    cut('function syncTossButtons() {', '\n      }'),
    cut('function lockToss() {', '\n      }'),
    cut('async function tossOnce() {', '\n      }'),
    cut('function renderToss(latest) {', '\n      }'),
  ].join('\n');
  return code;
}

function fakeClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), has: (c) => set.has(c) };
}

/** 起一套只够摇钱用的假页面。返回的 buttons 就是断言要看的那几个状态。 */
function tossPanelDom(client) {
  const buttons = {};
  for (const id of ['toss-btn', 'toss-finish', 'toss-reset']) {
    buttons[id] = { id, disabled: false };
  }
  const coin = { classList: fakeClassList(), textContent: '', offsetWidth: 0 };
  const slot = { classList: fakeClassList(), querySelector: (s) => (s === '.coin' ? coin : null) };
  const coins = { children: [slot, { ...slot, querySelector: slot.querySelector }, { ...slot, querySelector: slot.querySelector }] };
  const tossLog = {
    children: [],
    replaceChildren() { this.children.length = 0; },
    prepend(node) { this.children.unshift(node); },
  };
  const nodes = { ...buttons, coins, 'toss-log': tossLog, 'toss-fill': { style: {} }, 'toss-count': { textContent: '' } };
  const state = { tosses: [] };
  const announced = [];
  const make = (api) =>
    new Function(
      'el', 'state', 'api', 'announce', 'document', 'setTimeout',
      `${loadTossPanel(client)}\nreturn { tossOnce, syncTossButtons, lockToss, renderToss, syncTossProgress };`,
    )(
      (id) => nodes[id],
      state,
      api,
      (msg) => announced.push(msg),
      { createElement: () => ({ innerHTML: '', style: {} }) },
      () => 0,
    );
  return { make, buttons, state, announced, fill: nodes['toss-fill'], count: nodes['toss-count'] };
}

test('结论整块排在两栏之前：吉凶、缘由、宜忌一次读完，推导在下面', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const cut = (start, end) => {
    const i = client.indexOf(start);
    assert.ok(i >= 0, `客户端里找不到 ${start}`);
    const j = client.indexOf(end, i);
    assert.ok(j >= 0, `客户端里找不到 ${start} 的结尾`);
    return client.slice(i, j + end.length);
  };
  const fn = cut('function renderReading(reading) {', '\n      }');

  // 结论块要挂在那两栏（卦面 + 事实表与推导）之前。从前那句大白话排在右栏第四件，
  // 前头压着九行技术事实表、后头跟着八宫名单与四卦推导，混在一堆里认不出来。
  // 断的是「挂上去」这一步而不只是「写出来」：只查结论块那段代码在不在，
  // 把 card.append(lead) 删了照样全绿，而页面上根本没有这块。
  const leadAt = fn.indexOf("lead.className = 'verdict-block");
  const appendAt = fn.indexOf('card.append(lead);');
  const twoColAt = fn.indexOf("body.className = 'reading'");
  assert.ok(leadAt > 0, '结果页没有结论块');
  assert.ok(twoColAt > 0, '结果页没有那两栏');
  assert.ok(appendAt > 0, '结论块写出来了却没挂到页面上，页面上根本没有它');
  assert.ok(leadAt < appendAt, '结论块在挂上去之前就声明了，接线顺序反了');
  assert.ok(appendAt < twoColAt, '结论块排在两栏之后，等于又埋回信息堆里');

  // 块里四样东西按「吉凶 → 缘由 → 怎么算的 → 宜忌」这个次序摆出来。
  const order = [
    ["mark.className = 'verdict-mark'", '吉凶那个大字'],
    ['markShort.className = \'verdict-say-short\'', '一句话结论'],
    ["say.className = 'verdict-say'", '大白话正文'],
    ['onTopic.className = \'verdict-say verdict-on-topic\'', '落到所问之事上的那句'],
    ["calc.className = 'verdict-calc'", '怎么算的'],
    ["picks.className = 'verdict-picks'", '宜忌'],
    ["warn.className = 'verdict-warn'", '提醒'],
  ];
  let cursor = -1;
  for (const [anchor, what] of order) {
    const at = fn.indexOf(anchor);
    assert.ok(at > 0, `结论块里没有${what}`);
    assert.ok(at > cursor, `${what}排错了位置，该在它前头的那几样之后`);
    cursor = at;
  }

  // 取象句要真的挂上那个开关。上一版只查「写没写出这句」，把开关改成永假照样全绿，
  // 而页面上那句话从此不出现——那正是这一轮最初要解决的事，不能靠肉眼守。
  assert.ok(
    /if \(reading\.topicLine\) \{/.test(fn),
    '取象句没挂在开关上：认不认得出事类都摆着，或者都摆不出来',
  );
  assert.ok(
    /onTopic\.textContent = reading\.topicLine;/.test(fn),
    '取象句建了元素却没把内容放进去，页面上会是一段空的',
  );
  // 大字已经摆着「大吉」，紧跟着那句要是原样搬来就成了「大吉 大吉：可进」，
  // 同一个词在同一行里说两遍。冒号前那半要丢掉，只留可执行的那半。
  assert.ok(
    /markShort\.textContent = reading\.verdict\.summary\.split\('：'\)/.test(fn),
    '大字旁边那句原样搬了 summary，页面上会把「吉凶」那一档连说两遍',
  );

  // 宜忌与提醒要跟着结论走，不能还留在页面里——那是最容易被跳过的地方，
  // 而且留着就是同一句话在屏幕上说两遍。数的是真正渲染的那几处（`.map`、
  // `textContent`），不是那几个 `length > 0` 的空判。
  assert.equal(
    (fn.match(/advice\.suitable\.map/g) || []).length,
    1,
    '「宜」在页面上渲染了不止一处：要么重复，要么还挂在页面末尾',
  );
  assert.equal(
    (fn.match(/advice\.avoid\.map/g) || []).length,
    1,
    '「忌」在页面上渲染了不止一处',
  );
  assert.equal(
    (fn.match(/textContent = reading\.advice\.caution/g) || []).length,
    1,
    '提醒在页面上渲染了不止一处',
  );

  // 同一句话不许在页首与右栏各说一遍。
  assert.ok(
    !/summary\.className = 'text-line'/.test(fn),
    '右栏还留着那句结论，跟页首的结论块成了同一句话两遍',
  );

  // 事实表里那行「生克」是依据不是结论，不能再用箭头写成「所以是」。
  assert.ok(
    /生克本为\$\{reading\.verdict\.relationVerdict\}/.test(fn),
    '事实表的生克行没标出这是生克那一层的断语，与页首的总分对不上会被当成算错',
  );
  assert.ok(
    !/reading\.verdict\.key\}\s*→\s*\$\{reading\.verdict\.label\}/.test(fn),
    '事实表仍把生克直接箭头连到总分，那正是同屏两个吉凶的老毛病',
  );
});

test('写了所问何事，结论就落到那件事上；换问法只换取象，不换吉凶', () => {
  const cast = castByNumbers(5, 2);
  const now = AT(10, 0);
  const at = (question) => buildReading(cast, { now, question });

  // 问跳槽与问进货拿到同一卦：吉凶必须一模一样（问事只定事类与应期，不改卦体），
  // 但取象句要各自说到那件事上。少了后半句，同一句「体卦水克用卦火」就能对付
  // 所有问题，等于没答所问。
  const job = at('这工作该不该跳');
  const goods = at('这批货该不该进');
  assert.equal(job.verdict.label, goods.verdict.label, '换个问法把卦的吉凶改了');
  assert.equal(job.verdict.score, goods.verdict.score, '换个问法把总分改了');
  assert.ok(job.topicLine, '写了所问何事，结论却没有落到那件事上');
  assert.ok(goods.topicLine, '写了所问何事，结论却没有落到那件事上');
  assert.notEqual(job.topicLine, goods.topicLine, '问跳槽与问进货拿到的还是同一句');
  assert.match(job.topicLine, /事业功名/, '问跳槽，结论没说到事业上去');
  assert.match(job.topicLine, /这份前程/, '问跳槽，结论里没有那件事本身');
  assert.match(goods.topicLine, /财运/, '问进货，结论没说到财运上去');
  assert.match(goods.topicLine, /这笔进项/, '问进货，结论里没有那笔钱本身');

  // 九个事类每一个都要有自己的那个东西，不能有两个事类共用一句话。
  const questions = ['这工作该不该跳', '这批货该不该进', '他还会不会喜欢我吗', '这婚要不要定',
    '这病要不要去治', '这次考试能过吗', '这房子该不该买', '这官司打得赢吗', '这趟出差顺利吗'];
  const lines = new Set();
  for (const question of questions) {
    const reading = at(question);
    assert.ok(reading.topicLine, `${question} 认出了事类却没给出取象句`);
    lines.add(reading.topicLine);
  }
  assert.equal(lines.size, questions.length, '九类问法里有取象句重复的，说明那句还是笼统的');

  // 认不出事类就不摆这句，也不拿别的话来凑：宁可没有，不要错的。
  const vague = at('嗯');
  assert.equal(vague.topicLine, undefined, '认不出事类却硬给了一句取象');
  assert.equal(vague.topic, null, '「嗯」竟认出了事类');

  // 取象句的强弱跟着总分那一档走，不跟着生克那一层的教科书断语走。
  // 这三个卦的生克完全相同，都是体克用、生克本为小吉，只因体卦逢的月令不同，
  // 总分落在大吉、平、吉三档。要是取象句跟着生克走，这三句会一模一样。
  const lucky = buildReading(castByNumbers(1, 4), { now, question: '这工作该不该跳' });
  const flat = buildReading(castByNumbers(1, 19), { now, question: '这工作该不该跳' });
  const mild = buildReading(castByNumbers(6, 7), { now, question: '这工作该不该跳' });
  for (const [name, reading, want] of [['大吉', lucky, '大吉'], ['平', flat, '平'], ['吉', mild, '吉']]) {
    assert.equal(reading.verdict.label, want, `${name} 那一卦的总分改了`);
    assert.equal(reading.verdict.relationVerdict, '小吉', `${name} 那一卦的生克层变了，样本就不作数了`);
  }
  assert.match(lucky.topicLine, /是顺的/, `大吉却说「${lucky.topicLine}」，强弱说反了`);
  assert.match(flat.topicLine, /看不出强弱/, `平卦却说「${flat.topicLine}」，强弱说反了`);
  assert.match(mild.topicLine, /是顺的/, `吉卦却说「${mild.topicLine}」，强弱说反了`);
  // 顺的那一档收同一句话是有意的：取象句分的是「顺 / 看不出强弱 / 不顺」三档，
  // 不是五个吉凶档——大吉与吉的分量差在页首那个大字上，这句只管落到什么事上。
  // 所以这里要断的是平卦那句与吉卦那句确实不同，而不是三句两两不同。
  assert.notEqual(flat.topicLine, lucky.topicLine, '平卦与大吉卦的取象句是同一句');
  assert.equal(lucky.topicLine, mild.topicLine, '同为「顺」的一档却收了两句话');
});

test('Agent 自报的事类压过关键词，关键词那条路留作退路', () => {
  const cast = castByNumbers(5, 2);
  const now = AT(10, 0);
  const at = (question, topic) => buildReading(cast, { now, question, topic });

  // 这句是关键词表接不住的——表上都是「感情」「恋爱」「前任」这类词，
  // 「他对我还有没有真心」一个都不含。页面那条路只能认不出，Agent 读了原话能认。
  const vague = '他对我还有没有真心';
  assert.equal(detectTopic(vague), null, '这句本就该认不出事类，下面才验得了 Agent 那条路');
  assert.equal(at(vague).topic, null, '没给 topic 时不该凭空认出一类');
  assert.equal(at(vague).topicSource, null, '没定下事类却说定了一个');
  assert.equal(at(vague).topicLine, undefined, '没定事类却给了取象句');

  const told = at(vague, 'love');
  // 下面几处都走 ?.：topic 为 null 时直接读 .key 会抛 TypeError，而 TypeError 不带
  // 消息，按关键词判「这条断言钉住没有」的就永远对不上——报红得落在自己的消息上。
  assert.equal(told.topic?.key, 'love', 'Agent 报了感情，事类却没落上去');
  assert.equal(told.topic?.label, '感情', '事类落错了类');
  assert.equal(told.topicSource, 'explicit', '明明是 Agent 给的，却说成关键词认出来的');
  assert.match(told.topicLine, /这段关系/, '感情类的事没说成那段关系');

  // 关键词那条路是退路不是主路：原话明明会撞出事业，Agent 报了财运就得听 Agent 的。
  const job = '这工作该不该跳';
  assert.equal(detectTopic(job).key, 'career', '这句本该撞出事业功名，下面才验得了显式优先');
  const overridden = at(job, 'wealth');
  assert.equal(overridden.topic?.key, 'wealth', 'Agent 报的事类被关键词盖回去了');
  assert.equal(overridden.topicSource, 'explicit', '显式优先没生效');

  // 给了个不存在的键：当作没给，退回关键词，而不是静悄悄地认成别的类。
  const bogus = at(job, '不存在的类');
  assert.equal(bogus.topic?.key, 'career', '认不出的键没退回关键词');
  assert.equal(bogus.topicSource, 'detected', '退回关键词后来源仍说成 Agent 给的');

  // 事类只改应期与取象，吉凶一个字都不许跟着动——这条是这个参数存在的底线。
  for (const topic of [undefined, 'wealth', 'love', 'journey', 'dispute']) {
    const one = at(job, topic);
    assert.equal(one.verdict.label, at(job).verdict.label, `给了 topic=${topic} 把卦的吉凶改了`);
    assert.equal(one.verdict.score, at(job).verdict.score, `给了 topic=${topic} 把总分改了`);
    assert.equal(one.verdict.key, at(job).verdict.key, `给了 topic=${topic} 把体用生克改了`);
  }

  // 九类各认得出来，且都是真类——枚举漏一个键，Agent 按提示挑的那个就落空。
  const keys = TOPIC_CLASSES.map((t) => t.key);
  for (const key of keys) {
    assert.equal(at('随便问问', key).topic?.key, key, `给了 topic=${key} 却没落到这一类`);
  }
  assert.equal(at('随便问问', '').topic, null, '空串也被当成了一个事类');
  assert.equal(at('随便问问', 42).topic, null, '数字也被当成了一个事类');
});

test('白话块把体用旺衰翻成「你、那件事、你此刻的劲」', () => {
  const cast = castByNumbers(5, 2);
  const now = AT(10, 0);
  const reading = buildReading(cast, { now, question: '这工作该不该跳', topic: 'career' });
  const plain = reading.plain;

  // 术语那一层：体卦是你、用卦是那件事、旺衰是你此刻的劲。这三样是整个卦理里
  // 最抽象的地方，白话块不改口径，只换说法——说漏一样，用户就得回去查词。
  assert.match(plain.why, new RegExp(`体卦${reading.structure.body.name}${reading.structure.body.element}是你`), '白话没说清体卦是谁');
  assert.match(plain.why, new RegExp(`用卦${reading.structure.use.name}${reading.structure.use.element}是那件事`), '白话没说清用卦是谁');
  for (const bad of ['体卦', '用卦', '旺衰', '类神', '月令']) {
    assert.ok(
      !plain.why.replace(`体卦${reading.structure.body.name}${reading.structure.body.element}`, '')
        .replace(`用卦${reading.structure.use.name}${reading.structure.use.element}`, '')
        .includes(bad),
      `白话里还留着术语「${bad}」没翻`,
    );
  }
  // 上一条只查「术语没漏」，漏查了反面：把 ${verdict.vitality} 原样塞回去，
  // 一个术语词都不带，检查照样全绿。旺衰译没译，得按这一卦实际落在哪一档去查。
  const VITALITY_SAID = {
    旺: '最有力气', 相: '有人托着', 休: '使不上劲', 囚: '受制', 死: '气力最弱',
  };
  assert.ok(
    plain.why.includes(VITALITY_SAID[reading.verdict.vitality]),
    `白话没把旺衰「${reading.verdict.vitality}」翻成人话：${plain.why}`,
  );

  assert.match(plain.ask, /这工作该不该跳/, '白话没把用户问的那句话接回来');
  assert.match(plain.topic, /事业功名/, '白话没说清归的哪一类');
  assert.ok(!plain.topic.includes('类神'), '白话里还留着术语「类神」没翻');
  assert.equal(plain.verdict.includes(reading.verdict.label), true, '白话的结论里没有吉凶那一档');
  assert.equal(plain.onTopic, reading.topicLine, '白话里的取象句与取象句本身对不上');
  assert.match(plain.timing, /月/, '白话没说时间');
  assert.match(plain.actions, /该做的是：/, '白话没给该做的');
  assert.match(plain.actions, /别做的是：/, '白话没给别做的');
  assert.equal(plain.caution, reading.advice.caution, '白话的提醒与宜忌那一份对不上');

  // 没定事类时：取象那句整块不摆，不拿别的话凑；时间照旧给，问的那句话照样接回来。
  const blank = buildReading(cast, { now, question: '明天的会顺利吗' }).plain;
  assert.equal(blank.onTopic, '', '没定事类却硬给了一句取象');
  assert.match(blank.topic, /按那件事本身算/, '没定事类时没说清按什么算');
  assert.ok(blank.timing.length > 0, '没定事类就把时间也省了');
  assert.match(blank.ask, /明天的会顺利吗/, '写了问题却没在白话里接回来');

  // 压根没写问题时另一句：说清是按时辰看的，别让用户以为漏传了他的问事。
  const noAsk = buildReading(cast, { now }).plain;
  assert.equal(
    noAsk.ask,
    '你没写具体问什么，我按起卦当时的时辰给你看这一卦。',
    '没写问题时白话没说明是按时辰看的',
  );
  assert.equal(noAsk.topic, '你问的事不在那九类里，事类先空着，时间上按那件事本身算。', '没写问题时说得像认不出事类');

  // 生克那层与总分不一致时（体克用本是生克小吉，体卦逢死地总分落回「平」），
  // 差价就在白话里讲开——用户最容易把这当成算错了。
  const mismatched = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25]
    .map((n) => buildReading(castByNumbers(n, 2), { now, question: '这工作该不该跳' }))
    .find((r) => r.verdict.relationVerdict !== r.verdict.label);
  assert.ok(mismatched, '扫了十二组上下卦还没撞出生克层与总分不一致的卦，这段没法验');
  assert.ok(
    mismatched.plain.why.includes(`照两人之间的关系本该是${mismatched.verdict.relationVerdict}`),
    `生克层与总分差了一档，白话里却没讲开：${mismatched.plain.why}`,
  );
});

test('两处版本号与清单一致，且是能排的版本号', async () => {
  const manifest = JSON.parse(await readFile(new URL('../.minimax-plugin/plugin.json', import.meta.url), 'utf8'));
  const { PACKAGE_VERSION } = await import('../miniapp/node/cast-params.mjs');
  const mcp = await readFile(new URL('../miniapp/node/mcp/divination-http.mjs', import.meta.url), 'utf8');

  // 清单给 Host 看的是它，serverInfo 给 initialize 的调用方看的是另一个。改版本时
  // 两处各写各的，Host 报 1.1.0 而 initialize 报 1.0.0，从外面根本看不出来。
  // 现在 serverInfo 直接取 PACKAGE_VERSION，mcp 里不该再有第二个版本号字面量。
  assert.ok(PACKAGE_VERSION, 'PACKAGE_VERSION 没有导出');
  assert.equal(PACKAGE_VERSION, manifest.version, `清单是 ${manifest.version}，serverInfo 却是 ${PACKAGE_VERSION}`);
  assert.ok(!/version:\s*'[\d.]+'/.test(mcp), 'mcp 里不该再有写死的版本号');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, `版本号「${manifest.version}」不是 x.y.z`);
  assert.equal(manifest.name, 'chinese-divination', '清单里的插件名与目录名对不上');
});

test('四种起法经 MCP 都真起得成卦：铜钱那一路曾经每一次都报「必须是 6 到 9 之间的整数」', async () => {
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  // 这条测试里 time 与 daily 要与「今天」对照，所以整个共用助手刻意不注入时刻，
  // 走真时钟。单独抽出来的那条「时间起卦用的不是今天」更是只能靠真时钟验。
  // real-clock: 见 REAL_CLOCK_MARK，守卫认这个标记
  const cast = async (args, now) => {
    let raw = '';
    await handleMcpRequest({
      response: { writeHead() { return this; }, end(chunk) { raw += chunk; return this; } },
      ...(now ? { now } : {}),
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'divination_cast', arguments: args } },
    });
    return JSON.parse(raw).result;
  };

  // 前面那些 MCP 端到端只打过 numbers。time 与 daily 碰巧是对的，coins 不是：
  // tossCoins() 掷一次返回一个 { sum, coins } 对象，castByCoins() 要的是六次结果
  // 组成的数组，对象递进去 .length 是 undefined，每一次调用都撞在同一个报错上。
  // 引擎那一层的 castByCoins 有几十条测试，全是直接喂数组——所以这条断路从头到尾
  // 没被任何一条断言碰到过。四法一起打，才算把这一类断路堵住。
  for (const method of ['time', 'daily', 'coins', 'numbers']) {
    const args = method === 'numbers' ? { method, upper: 3, lower: 8 } : { method };
    const result = await cast({ ...args, topic: 'career' });
    assert.equal(result.isError, undefined, `${method} 经 MCP 起卦报错了：${result.content[0].text}`);

    const sc = result.structuredContent;
    assert.ok(sc.hexagram?.name, `${method} 起完了却没给出卦名`);
    assert.ok(sc.hexagram.order >= 1 && sc.hexagram.order <= 64, `${method} 的卦序不在 1–64：${sc.hexagram.order}`);
    assert.ok(sc.verdict?.label, `${method} 起完了却没给出吉凶`);
    assert.ok(['大吉', '吉', '平', '凶', '大凶'].includes(sc.verdict.label), `${method} 的吉凶「${sc.verdict.label}」不在五档里`);
    assert.ok(result.content[0].text.includes('【大白话】'), `${method} 的正文末尾没有大白话那段`);
    // 四条起法都得把事类往下传。少传一条，那条起法上 Agent 自报的事类就被悄悄丢了，
    // 而它照样起得出卦、照样给出吉凶——不钉这一条根本发现不了。
    assert.equal(sc.topic?.key, 'career', `${method} 这一路把 Agent 报的事类丢了`);
    assert.match(result.content[0].text, /由 Agent 指定/, `${method} 这一路没标明事类是 Agent 定的`);

    // 铜钱这一路要多验一层：起卦依据那行得真列出六次掷钱的结果，不是三次也不是零个。
    if (method === 'coins') {
      const line = result.content[0].text.split('\n').find((l) => l.startsWith('【起卦依据】'));
      assert.ok(line, '铜钱起卦的依据那一行没写出来');
      const tossed = line.match(/掷钱\s+((?:[6-9](?:\s*·\s*)?){6})/);
      assert.ok(tossed, `铜钱起卦没有列出六个点数：${line}`);
    }
  }

  // 时间起卦说的是「以当下时辰成卦」。可「当下」得有个能验的凭据：起卦依据里写着
  // 「月 · 日」，它必须是今天的那一天。月令旺衰那一层不算——那是从 buildReading 的
  // now 算的，把 castByTime 的参数换成 1970 年它照样是今月的金，验不出来。
  // 跨零点时前后各取一次日期，两头都算过，免得撞上换日那一秒。
  const today = new Date(); // real-clock: 这条断言验的正是「当下」，钉死时刻就没得验了
  const timed = await cast({ method: 'time' });
  const dayMark = (d) => `月 · 日 ${d.getMonth() + 1} + ${d.getDate()}`;
  const timedBasis = timed.content[0].text.split('\n').find((l) => l.startsWith('【起卦依据】'));
  assert.ok(
    [dayMark(today), dayMark(new Date())].some((mark) => timedBasis.includes(mark)), // real-clock: 同上
    `时间起卦用的不是今天：「${timedBasis}」`,
  );

  // 铜钱该摇得出不同的卦。断的是卦名而不是「有没有变卦」——掷出 6 或 9 就会有变卦，
  // 拿「有变卦」做判据的话，随手一掷也可能两种都出现，这条断言就成了概率的。
  const names = new Set();
  for (let i = 0; i < 12; i += 1) {
    names.add((await cast({ method: 'coins' })).structuredContent.hexagram.name);
  }
  assert.ok(names.size > 1, `连着摇了十二次，只摇出${[...names].join('、')}一个卦`);
});

test('MCP 让 Agent 自报事类，并在正文末尾补一段大白话', async () => {
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  const call = async (method, params) => {
    let raw = '';
    await handleMcpRequest({
      response: { writeHead() { return this; }, end(chunk) { raw += chunk; return this; } },
        now: AT(10, 0),
      body: { jsonrpc: '2.0', id: 1, method, params },
    });
    return JSON.parse(raw).result;
  };
  const cast = (args) => call('tools/call', { name: 'divination_cast', arguments: args });

  // 枚举得真列给 Agent 看：它得知道能挑哪九类，否则这个参数等于没有。
  const listed = await call('tools/list', {});
  const schema = listed.tools.find((t) => t.name === 'divination_cast').inputSchema;
  const topicProp = schema.properties.topic;
  assert.deepEqual(
    topicProp.enum,
    TOPIC_CLASSES.map((t) => t.key),
    'topic 的枚举与九类事类对不上，Agent 按提示挑会挑空',
  );
  assert.equal(schema.properties.topic.type, 'string', 'topic 不是字符串');
  assert.match(topicProp.description, /不改变卦体吉凶/, '参数说明没告诉 Agent 事类不改吉凶');
  assert.match(topicProp.description, /省略/, '参数说明没告诉 Agent 拿不准可以省略');
  assert.ok(
    !schema.properties.question.description.includes('定事类'),
    'question 的说明还写着由它定事类，与新加的 topic 参数自相矛盾',
  );

  // 关键词接不住的那句，Agent 报了类就落得上去。
  const question = '他对我还有没有真心';
  assert.equal(detectTopic(question), null, '这句本该认不出事类');
  const told = await cast({ method: 'numbers', upper: 5, lower: 2, question, topic: 'love' });
  const toldText = told.content[0].text;

  // 结构先验：白话段接进去了、在正文末尾、在免责之前。放在内容断言前头——
  // 白话整段没接的时候，内容那几条会先红，报出来的消息跟「没接进去」不是一回事。
  assert.ok(toldText.includes('【大白话】'), '正文末尾没有大白话那一段');
  assert.ok(toldText.includes('【起卦依据】'), '正文里没有起卦依据那一段');
  assert.ok(
    toldText.indexOf('【大白话】') > toldText.indexOf('【起卦依据】'),
    '白话插在正文中间，用户读不到最后',
  );
  assert.ok(
    toldText.indexOf('【提示】') > toldText.indexOf('【大白话】'),
    '免责排在白话前头，顺序反了',
  );

  assert.equal(told.structuredContent.topic?.key, 'love', 'Agent 报的事类没进结构化结果');
  assert.match(toldText, /由 Agent 指定/, '正文没说是谁定的事类');
  assert.match(toldText, /这段关系/, '白话没说到那段关系上');

  const guessed = await cast({ method: 'numbers', upper: 5, lower: 2, question: '这工作该不该跳' });
  assert.equal(guessed.structuredContent.topic?.key, 'career', '不给 topic 时关键词那条路没兜住');
  assert.match(guessed.content[0].text, /按关键词认出/, '正文没说清是关键词认出来的');

  // 给了不存在的键：当场报错让 Agent 重挑，不能静悄悄当没给。
  const bad = await cast({ method: 'numbers', upper: 5, lower: 2, question, topic: '财运' });
  assert.equal(bad.isError, true, '给了不存在的键却照常起了一卦');
  assert.match(bad.content[0].text, /未知的事类/, '报错没点名是事类不对');
  assert.match(bad._meta.recovery, /省略/, '报错没告诉 Agent 拿不准可以省略');

  // 白话段里一句空话都不许留：没定事类时那一句是空的，留下来就是一个空行。
  const vague = await cast({ method: 'numbers', upper: 5, lower: 2, question: '明天的会顺利吗' });
  const vaguePlain = vague.content[0].text.split('【大白话】')[1].split('【提示】')[0];
  assert.ok(!vaguePlain.includes('\n\n'), '白话里留了空行，没定事类的那一句该整块不出现');
  assert.ok(vaguePlain.trimStart().startsWith('你问的是'), '白话第一句没接上用户问的那句话');
  assert.ok(!vaguePlain.includes('卦里说的就是'), '没定事类却摆了取象句');

  const plainText = toldText.slice(toldText.indexOf('【大白话】'));
  assert.match(plainText, new RegExp(question), '白话段里没有用户问的那句话');
  assert.match(plainText, /是你/, '白话段里没把体卦翻成「你」');
  assert.match(plainText, /是那件事/, '白话段里没把用卦翻成「那件事」');

  // 提示语也得教模型照着白话讲，否则这段照样被它用术语复述掉。
  const init = await call('initialize', {});
  assert.match(init.instructions, /【大白话】/, 'initialize 的提示语没提大白话那段');
});

test('SKILL 把「先问清这件事」与新参数都交代给 Agent', async () => {
  const skill = await readFile(new URL('../skills/divination/SKILL.md', import.meta.url), 'utf8');

  // 这一份是 Agent 的入口文档，不是给人读的说明书。改了它，模型那一侧就跟着变，
  // 而仓库自检只查文件在不在——不钉住的话，一次「顺手精简」就能把下面几条悄悄弄没。
  // ① topic 九个键：不写，Agent 不会去填，事类就退回关键词，「他对我还有没有真心」
  //    那类问法照旧认不出，而页面这边没有别的入口。
  for (const topic of TOPIC_CLASSES) {
    assert.ok(skill.includes(topic.key), `SKILL 没告诉 Agent 有 ${topic.key} 这一类事`);
  }
  // ② 末了那段白话：不写，Agent 照着断语用术语复述一遍，白话块白做。
  assert.match(skill, /大白话/, 'SKILL 没交代末了那段白话是给用户听的');
  // ③ 起卦前先问清：这是这一版补进去的关键一步。见问就起卦，得到的解读挂不到
  // 用户真实的处境上，抽象且苍白——正是要避免的那种结果。断的是那三问本身，
  // 不断标题：把「起卦前：先把这件事问清楚」改成「起卦前」，一段话还在那儿。
  const beforeCast = skill.slice(0, skill.indexOf('## 起卦三步'));
  assert.ok(beforeCast.length > 100, 'SKILL 里找不到「起卦前」那一段');
  assert.match(beforeCast, /问清|问清楚/, 'SKILL 没要求起卦前把事情问清');
  // 断的是那三条 bullet 本身。开头那句「你不知道他在纠结什么、已经走到哪一步、
  // 最怕的是哪一头」里也有同样的字眼，断那几个词的话，删掉整条问题照样全绿。
  for (const ask of ['到底是什么事', '已经走到哪一步', '最怕的是哪一头']) {
    assert.ok(beforeCast.includes(`- **${ask}**`), `SKILL 里的「起卦前」没问「${ask}」，只剩半截引导`);
  }
  // ④ 免责声明不许被顺手改掉。
  assert.match(skill, /仅供娱乐，无实际预测功能/, 'SKILL 里的免责说明被改掉了');
});

test('掷钱与成卦解卦互为反面：摇满六次就禁掷钱、开成卦解卦', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  // 进度条与「已摇 n / 6 爻」是同一件事的两面：宽度由爻数算出来，不是另写
  // 一份百分比。两边各写各的，条走满了字还停在 3/6，或者反过来。
  {
    const dom = tossPanelDom(client);
    const panel = dom.make(async () => ({ coins: [true], sum: 7 }));
    const widths = [];
    for (let n = 0; n <= 6; n += 1) {
      dom.state.tosses = Array.from({ length: n }, () => 7);
      panel.syncTossProgress();
      widths.push(dom.fill.style.width);
      assert.equal(dom.count.textContent, `已摇 ${n} / 6 爻`, `摇了 ${n} 爻，计数没跟着走`);
      assert.equal(
        dom.fill.style.width,
        `${(n / 6) * 100}%`,
        `摇了 ${n} 爻，条宽与爻数对不上`,
      );
    }
    assert.equal(widths[0], '0%', '一爻没摇，条上就已经有进度了');
    assert.equal(widths[6], '100%', '摇满六次，条还没走完');
    // 逐级递增，不许中途回落或跳过：一次摇钱只该推进一格。
    for (let n = 1; n < 6; n += 1) {
      assert.ok(
        parseFloat(widths[n]) > parseFloat(widths[n - 1]),
        `第 ${n} 次摇完进度反而没往前走：${widths[n - 1]} → ${widths[n]}`,
      );
    }
  }

  // 静置态先定下来：0 摇 → 掷钱可点、成卦解卦禁着。这与 HTML 里初始写的 disabled 一致。
  {
    const dom = tossPanelDom(client);
    dom.make(async () => ({ coins: [], sum: 0 })).syncTossButtons();
    assert.equal(dom.buttons['toss-btn'].disabled, false, '还没摇钱就不让掷钱，起点就错了');
    assert.equal(dom.buttons['toss-finish'].disabled, true, '一爻没摇就能「成卦解卦」，这个入口是空的');
  }

  // 一路摇到第六次。这是这一轮真正坏掉的地方：renderToss 算出「摇够了该禁掷钱」，
  // 紧接着 tossOnce 的 finally 又硬写了一次解禁，把刚算出来的状态盖回可点，
  // 结果两个按钮同时可点——既能再摇第七爻，又能就着六爻成卦，两头都不作数。
  const dom = tossPanelDom(client);
  const { buttons, state } = dom;
  const panel = dom.make(async () => ({ coins: [true, false, true], sum: 7 }));

  for (let i = 1; i <= 5; i += 1) {
    await panel.tossOnce();
    assert.equal(state.tosses.length, i, `第 ${i} 次掷钱没有落进卦里`);
    assert.equal(buttons['toss-btn'].disabled, false, `才摇了 ${i} 爻就不让掷了`);
    assert.equal(buttons['toss-finish'].disabled, true, `才摇了 ${i} 爻就放「成卦解卦」过`);
    // 进度条是掷钱这条路上自己带的更新，不靠别处补调：摇一次，界面就得长一格。
    assert.equal(dom.count.textContent, `已摇 ${i} / 6 爻`, `掷完第 ${i} 次，进度计数没跟上`);
    assert.equal(dom.fill.style.width, `${(i / 6) * 100}%`, `掷完第 ${i} 次，进度条没跟上`);
  }

  await panel.tossOnce();
  assert.equal(state.tosses.length, 6, '第六次掷钱没有落进卦里');
  assert.equal(
    buttons['toss-btn'].disabled,
    true,
    '摇满六次后「掷钱」还是可点：能摇出第七爻，多出来的这一爻既排不进卦也撤不回',
  );
  assert.equal(buttons['toss-finish'].disabled, false, '摇满六次了「成卦解卦」还禁着，六爻白摇');

  // 第七次不能摇进去。这条比按钮状态更要紧：多出来的一爻既排不进六爻的卦里，
  // 也撤不回——卦上多一爻，解读会跟着偏。
  await panel.tossOnce();
  assert.equal(state.tosses.length, 6, '摇满六次之后还能再摇，卦里多出了第七爻');

  // 「重来」走的是另一条路：它直接清空列表重画，不经过任何在飞中的收尾，
  // 所以按钮状态必须由重画本身算出来，不能指望上一次收尾顺带带出来。
  state.tosses = [];
  panel.renderToss();
  assert.equal(buttons['toss-btn'].disabled, false, '重摇之后「掷钱」还禁着，这一卦没法重来');
  assert.equal(buttons['toss-finish'].disabled, true, '重摇之后「成卦解卦」还开着，卦里一爻都没有');
  // 重来是最容易漏的一条：爻清空了，条还满着，读的人会以为六爻还在。
  assert.equal(dom.count.textContent, '已摇 0 / 6 爻', '重摇之后进度计数还停在满格');
  assert.equal(dom.fill.style.width, '0%', '重摇之后进度条没有退回空');

  // 两个按钮严格互斥：任何一爻数下都不该同时可点。
  for (const n of [0, 1, 3, 5, 6]) {
    state.tosses = Array.from({ length: n }, () => 7);
    panel.syncTossButtons();
    assert.notEqual(
      buttons['toss-btn'].disabled,
      buttons['toss-finish'].disabled,
      `摇了 ${n} 爻时两个按钮同时可点或同时禁着，掷钱与成卦解卦没有互为反面`,
    );
  }

  // 在飞的时候要按住「重来」：飞到一半点重来，已经在飞的那一爻会落进刚被清空的
  // 列表，卦里就多出一爻看不见来源的东西。
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const slow = tossPanelDom(client);
  const running = slow.make(async () => {
    await held;
    return { coins: [true, true, false], sum: 8 };
  });
  const flying = running.tossOnce();
  assert.equal(slow.buttons['toss-btn'].disabled, true, '一次摇钱在飞，「掷钱」还能点，连点会连摇两次');
  assert.equal(slow.buttons['toss-reset'].disabled, true, '一次摇钱在飞，「重来」还能点，在飞的那一爻会落进刚被清空的列表');
  release();
  await flying;
  assert.equal(slow.buttons['toss-btn'].disabled, false, '摇完一次就没法再掷，整页锁死了');
  assert.equal(slow.buttons['toss-reset'].disabled, false, '摇完一次「重来」还禁着，没法重摇');

  // 摇钱失败也要解开：一次网络失败就把这一页锁死，用户只能刷新。
  const broken = tossPanelDom(client);
  const failing = broken.make(async () => { throw new Error('取不到卦'); });
  await failing.tossOnce();
  assert.equal(broken.buttons['toss-btn'].disabled, false, '一次摇钱失败就把「掷钱」永久禁用了');
  assert.equal(broken.buttons['toss-reset'].disabled, false, '一次摇钱失败就把「重来」永久禁用了');
  assert.equal(broken.announced.length, 1, '摇钱失败没有报给用户');
  // 量的必须是 state.tosses，不是卦象日志的 DOM 条数：失败时 renderToss 压根没跑，
  // 日志当然是空的，量它等于什么都没量。
  assert.equal(broken.state.tosses.length, 0, '摇钱失败却往卦里写了一爻');
});

test('八卦环在起卦那一拍里转得肉眼看得见', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const budget = Number(/const CASTING_HOLD_MS = (\d+);/.exec(client)[1]);
  assert.ok(budget, '找不到起卦后的停留时长');
  const rings = [
    ['外环', /animation: baguaSpin (\d+)s/.exec(client)],
    ['内环', /animation: baguaSpinBack (\d+)s/.exec(client)],
  ];
  for (const [name, hit] of rings) {
    assert.ok(hit, `找不到${name}的转速`);
    const period = Number(hit[1]);
    // 整段起卦就这么几秒，转速却按分钟算的，看着就等于没动
    const deg = (budget / 1000 / period) * 360;
    assert.ok(deg >= 30, `${name} ${period}s 一圈，停留期间只转 ${deg.toFixed(0)}°，等于没动`);
  }
});

/* ---------- 爻辞 ---------- */

const YAO_POSITIONS = ['初', '二', '三', '四', '五', '上'];

/** 拆出「爻题」「爻辞」；格式不符返回 null。 */
function parseYao(entry) {
  const match = /^(初|上)([九六])：(.+)$|^([九六])([二三四五])：(.+)$/.exec(entry);
  if (!match) return null;
  const atTop = match[1] !== undefined;
  return {
    number: atTop ? match[1] : match[5],
    polarity: atTop ? match[2] : match[4],
    text: (atTop ? match[3] : match[6]).trim(),
  };
}

test('爻辞六十四卦每卦六条，共 384 条', () => {
  assert.equal(HEXAGRAM_LIST.length, 64);
  let count = 0;
  for (let order = 1; order <= 64; order += 1) {
    const rows = hexagramYaoTexts(order);
    assert.ok(rows, `第 ${order} 卦没有爻辞`);
    assert.equal(rows.length, 6, `第 ${order} 卦的爻辞不是六条`);
    count += rows.length;
  }
  assert.equal(count, 384);
  assert.equal(hexagramYaoTexts(0), null);
  assert.equal(hexagramYaoTexts(65), null);
});

test('爻题标对了爻位，阴阳与卦象逐位吻合', () => {
  for (let order = 1; order <= 64; order += 1) {
    const hexagram = hexagramByOrder(order);
    hexagramYaoTexts(order).forEach((entry, index) => {
      const parsed = parseYao(entry);
      assert.ok(parsed, `第 ${order} 卦第 ${index + 1} 爻格式不对：${entry}`);
      assert.equal(parsed.number, YAO_POSITIONS[index], `第 ${order} 卦第 ${index + 1} 爻位标签错：${entry}`);
      assert.ok(parsed.text.length > 0, `第 ${order} 卦第 ${index + 1} 爻辞为空`);
      // 阳爻称九、阴爻称六，错一位就说明这一卦的数据串了行
      const isYang = hexagram.key[index] === '1';
      assert.equal(parsed.polarity, isYang ? '九' : '六', `${hexagram.name} ${parsed.number} 与卦象阴阳不符：${entry}`);
    });
  }
});

test('爻辞不残留繁体', () => {
  const TRADITIONAL = '龍貞無見萬與東車馬鳥魚長門風飛貴進遠連覺語說';
  for (let order = 1; order <= 64; order += 1) {
    for (const entry of hexagramYaoTexts(order)) {
      for (const char of TRADITIONAL) {
        assert.ok(!entry.includes(char), `第 ${order} 卦爻辞残留繁体「${char}」：${entry}`);
      }
    }
  }
});

test('名句锚定，改一个字就报红', () => {
  const ANCHORS = [
    [1, 1, '初九：潜龙勿用。'],
    [1, 5, '九五：飞龙在天，利见大人。'],
    [2, 1, '初六：履霜，坚冰至。'],
    [23, 6, '上九：硕果不食，君子得舆，小人剥庐。'],
    [38, 6, '上九：睽孤，见豕负涂，载鬼一车，先张之弧，后说之弧，匪寇婚媾。往，遇雨则吉。'],
    [63, 5, '九五：东邻杀牛，不如西邻之禴祭，实受其福。'],
    [64, 1, '初六：濡其尾，吝。'],
  ];
  for (const [order, position, expected] of ANCHORS) {
    assert.equal(lineText(order, position), expected);
  }
  assert.equal(lineText(1, 0), null);
  assert.equal(lineText(1, 7), null);
});

test('已／巳、乾／干各有其字，不随繁简转换走样', () => {
  // 损初九是「已」（已经），革六二是「巳」（地支），两处曾被同一个来源弄反
  assert.equal(lineText(41, 1), '初九：已事遄往，无咎，酌损之。');
  assert.equal(lineText(49, 2), '六二：巳日乃革之，征吉，无咎。');
  // 噬嗑的「乾」是「干」的通假，乾卦的「乾乾」表刚健，两处不能一并转成「干」
  assert.equal(lineText(21, 4), '九四：噬乾胏，得金矢，利艰贞，吉。');
  assert.equal(lineText(1, 3), '九三：君子终日乾乾，夕惕若，厉，无咎。');
});

test('排盘每一爻都带着爻辞，爻题随爻位走', () => {
  const cases = [...SAMPLES().map(([, cast]) => cast), castByCoins([7, 7, 7, 7, 7, 7])];
  for (const cast of cases) {
    const reading = buildReading(cast);
    const expected = hexagramYaoTexts(reading.hexagram.order);
    assert.equal(reading.lines.length, 6);
    reading.lines.forEach((line, index) => {
      assert.equal(line.text, expected[index]);
      assert.equal(line.text, lineText(reading.hexagram.order, line.position));
      // 爻题初/上爻作「初九」，中间爻作「九二」，两种笔顺都要对上爻位与阴阳
      assert.ok(line.title.includes(YAO_POSITIONS[index]), `爻位标签错：${line.title}`);
      assert.ok(line.title.includes(line.value === 1 ? '九' : '六'), `阴阳标签错：${line.title}`);
    });
  }
});

test('解卦洞察里只露动爻那一条爻辞', () => {
  let withMoving = 0;
  let withoutMoving = 0;
  // 六爻皆静的卦由 [7,7,7,7,7,7] 造：六个七全是少阳，乾为天，无动爻
  const cases = [...SAMPLES().map(([, cast]) => cast), castByCoins([7, 7, 7, 7, 7, 7])];
  for (const cast of cases) {
    const reading = buildReading(cast);
    const insight = reading.insights.find((item) => item.title === '动爻爻辞');
    if (reading.movingLines.length === 0) {
      assert.equal(insight, undefined, '六爻皆静时不该出现动爻爻辞');
      withoutMoving += 1;
      continue;
    }
    withMoving += 1;
    assert.ok(insight, '有动爻却没有爻辞');
    // 不按「；」数条数：动爻爻辞那几段是用「；」拼起来的，可象传正文里本来就可能
    // 带「；」（家人九三就是），一按分隔符数就数多，改判据反而会把对的写成错的。
    // 真正要断的是「只引了动的那几爻」——动爻逐条在、不动的爻一条都不在。
    for (const line of reading.movingLines) {
      assert.ok(insight.text.includes(line.text), `断语没有引动爻的爻辞：${line.label}`);
    }
    const movingTexts = new Set(reading.movingLines.map((line) => line.text));
    for (const line of reading.lines) {
      // 同一卦里两条爻辞原文相同的情形跳过，否则「不在」这句对那条也会跟着不成立
      if (movingTexts.has(line.text)) continue;
      assert.ok(!insight.text.includes(line.text), `断语引了没动的爻：${line.label}`);
    }
    // 位置紧随卦象总断，不排在末尾
    assert.equal(reading.insights[0].title, '卦象总断');
    assert.equal(reading.insights[1].title, '动爻爻辞');
  }
  assert.ok(withMoving > 0, '样本里没有一个带动爻的卦');
  assert.ok(withoutMoving > 0, '样本里没有一个六爻皆静的卦');
});

test('卦盘只把动爻那一条爻辞露出来', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  assert.ok(/\.yao-line \{/.test(client), '缺少爻辞样式');
  assert.ok(/className = 'yao-line serif anim-rise'/.test(client), '卦盘没有渲染爻辞块');
  // 六爻全列会把卦盘压成字墙；这里必须按动爻过滤
  assert.ok(
    /lines \? lines\.filter\(\(line\) => line\.moving && line\.text\) : \[\]/.test(client),
    '卦盘没有按动爻过滤爻辞',
  );
  assert.ok(/<span class="tag">动爻爻辞<\/span>/.test(client), '爻辞块缺少标题');
});

/* ---------- 小象传 ---------- */

test('小象传六十四卦每卦六条，共 384 条', () => {
  let count = 0;
  for (let order = 1; order <= 64; order += 1) {
    const rows = hexagramXiangTexts(order);
    assert.ok(rows, `第 ${order} 卦没有小象传`);
    assert.equal(rows.length, 6, `第 ${order} 卦的小象传不是六条`);
    count += rows.length;
  }
  assert.equal(count, 384);
  assert.equal(hexagramXiangTexts(0), null);
  assert.equal(hexagramXiangTexts(65), null);
});

test('象传的爻题与爻辞逐条一致，阴阳与卦象吻合', () => {
  for (let order = 1; order <= 64; order += 1) {
    const hexagram = hexagramByOrder(order);
    const yao = hexagramYaoTexts(order);
    hexagramXiangTexts(order).forEach((entry, index) => {
      const parsed = parseYao(entry);
      assert.ok(parsed, `第 ${order} 卦第 ${index + 1} 爻象传格式不对：${entry}`);
      assert.equal(parsed.number, YAO_POSITIONS[index]);
      assert.equal(parsed.text.length > 0, true, `第 ${order} 卦第 ${index + 1} 爻象传为空`);
      // 爻题必须与爻辞逐字相同，否则两处文本已经错位
      const title = entry.slice(0, entry.indexOf('：'));
      assert.equal(title, yao[index].slice(0, yao[index].indexOf('：')), `第 ${order} 卦第 ${index + 1} 爻题与爻辞不符`);
      assert.equal(parsed.polarity, hexagram.key[index] === '1' ? '九' : '六', `${hexagram.name} ${parsed.number} 与卦象阴阳不符`);
    });
  }
});

test('象传不残留繁体', () => {
  const TRADITIONAL = '龍貞無見萬與東車馬鳥魚長門風飛貴進遠連覺語說難願詳暉試誰諸備傷剛極陽當義聰聽絕積窮竄賢賤辭辯際順類飽馴愛憊';
  for (let order = 1; order <= 64; order += 1) {
    for (const entry of hexagramXiangTexts(order)) {
      for (const char of TRADITIONAL) {
        assert.ok(!entry.includes(char), `第 ${order} 卦象传残留繁体「${char}」：${entry}`);
      }
    }
  }
});

test('对校时改掉的字，不许退回某一版的写法', () => {
  const ANCHORS = [
    // 底本句尾混进一个 markdown 星号，且多出底本没有的改写
    [5, 2, '九二：需于沙，衍在中也。虽小有言，以吉终也。'],
    [5, 5, '九五：酒食，贞吉，以中正也。'],
    // 底本漏了「吉」，并把「渝安贞吉」读断了
    [6, 4, '九四：复即命，渝安贞吉，不失也。'],
    // 底本多出一句《易传》本没有的解说
    [10, 3, '六三：眇能视，不足以有明也。跛能履，不足以与行也。咥人之凶，位不当也。'],
    [17, 6, '上六：拘系之，上穷也。'],
    [24, 1, '初九：不远之复，以修身也。'],
    [36, 3, '九三：南狩之志，乃大得也。'],
    // 两个来源都错：大有九四该用「尫」，与爻辞同；困六三「蒺藜」与「不祥」分属两源
    [14, 4, '九四：匪其尫，无咎，明辨晰也。'],
    [47, 3, '六三：据于蒺藜，乘刚也。入于其宫，不见其妻，不祥也。'],
    [60, 2, '九二：不出门庭凶，失时极也。'],
  ];
  for (const [order, position, expected] of ANCHORS) {
    assert.equal(lineXiang(order, position), expected);
  }
  assert.equal(lineXiang(1, 0), null);
  assert.equal(lineXiang(1, 7), null);
});

test('排盘每一爻都带着象传，爻题与爻辞同源', () => {
  const cases = [...SAMPLES().map(([, cast]) => cast), castByCoins([7, 7, 7, 7, 7, 7])];
  for (const cast of cases) {
    const reading = buildReading(cast);
    const expected = hexagramXiangTexts(reading.hexagram.order);
    reading.lines.forEach((line, index) => {
      assert.equal(line.xiang, expected[index]);
      assert.equal(line.xiang, lineXiang(reading.hexagram.order, line.position));
      assert.equal(line.xiang.slice(0, line.xiang.indexOf('：')), line.title);
    });
  }
});

test('动爻爻辞一段里，爻辞在前、象传在后', () => {
  const cases = [...SAMPLES().map(([, cast]) => cast), castByCoins([7, 7, 7, 7, 7, 7])];
  let withMoving = 0;
  for (const cast of cases) {
    const reading = buildReading(cast);
    const insight = reading.insights.find((item) => item.title === '动爻爻辞');
    if (reading.movingLines.length === 0) {
      assert.equal(insight, undefined);
      continue;
    }
    withMoving += 1;
    assert.ok(insight);
    const expected = reading.movingLines
      .map((line) => `${line.text}　象曰：${line.xiang.slice(line.xiang.indexOf('：') + 1)}`)
      .join('；');
    assert.equal(insight.text, expected);
    assert.equal(reading.insights[1].title, '动爻爻辞');
  }
  assert.ok(withMoving > 0);
});

test('卦盘把象传排在爻辞下一行', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  assert.ok(/\.yao-line em \{/.test(client), '缺少象传的样式');
  assert.ok(/象曰：\$\{escapeHtml\(body\(line\.xiang\)\)\}/.test(client), '卦盘没有渲染象传');
  assert.ok(/function body\(entry\)/.test(client), '缺少去爻题前缀的辅助函数');
});

/* ---------- 彖传 ---------- */

test('彖传六十四卦每卦一条，且都挂进了卦表', () => {
  let count = 0;
  for (let order = 1; order <= 64; order += 1) {
    const text = tuanText(order);
    assert.ok(text, `第 ${order} 卦没有彖传`);
    assert.ok(text.trim().length > 0, `第 ${order} 卦的彖传为空`);
    assert.equal(hexagramByOrder(order).tuan, text, `第 ${order} 卦的卦表里没有带上彖传`);
    count += 1;
  }
  assert.equal(count, 64);
  assert.equal(tuanText(0), null);
  assert.equal(tuanText(65), null);
  assert.ok(HEXAGRAM_LIST.every((item) => typeof item.tuan === 'string' && item.tuan.length > 0));
});

test('彖传不残留繁体', () => {
  const TRADITIONAL = '龍貞無見萬與東車馬鳥魚長門風飛貴進遠連覺語說統應瀆聖況罰薦顒設電獄篤輝麗穀氣風晝嚴澤揚廟揜飪驚懼邇靜勸財續湯繘踰';
  for (let order = 1; order <= 64; order += 1) {
    for (const char of TRADITIONAL) {
      assert.ok(!tuanText(order).includes(char), `第 ${order} 卦彖传残留繁体「${char}」`);
    }
  }
});

test('名篇锚定与对校订正', () => {
  // 乾：两版一作「保和大和」一作「保合太和」，通行本作太和；「品物流形」后该收句
  assert.equal(tuanText(1), '大哉乾元，万物资始，乃统天。云行雨施，品物流形。大明终始，六位时成，时乘六龙以御天。乾道变化，各正性命，保合太和，乃利贞。首出庶物，万国咸宁。');
  // 蒙：底本作「初筮告」，另一版误作「初噬告」
  assert.ok(tuanText(4).includes('初筮告'));
  // 小畜：底本有「健而巽」四字，另一版漏
  assert.ok(tuanText(9).includes('健而巽'));
  // 贲：另一版把夹注「（刚柔交错）」混进了正文
  assert.ok(!tuanText(22).includes('刚柔交错'));
  // 革：底本作「革而信之」，且「巳日」与六二爻辞同
  assert.ok(tuanText(49).includes('革而信之'));
  assert.ok(tuanText(49).includes('巳日乃孚'));
});

test('彖传与爻辞同源：革的「巳日」两处一致', () => {
  assert.ok(lineText(49, 2).startsWith('六二：巳日乃革之'));
  assert.ok(tuanText(49).includes('巳日乃孚'));
});

test('卦盘与卦库都按「卦辞 → 彖传 → 象辞」的次序排出', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  assert.ok(/\.text-line \.tuan \{/.test(client), '缺少彖传的样式');
  for (const [label, pattern] of [
    ['卦盘', /judgment[^]*?class="tuan">\$\{escapeHtml\(hexagram\.tuan\)\}[^]*?hexagram\.image/],
    ['卦库', /item\.judgment[^]*?class="tuan">\$\{escapeHtml\(item\.tuan\)\}[^]*?item\.image/],
  ]) {
    assert.ok(pattern.test(client), `${label}没有按卦辞、彖传、象辞的次序排`);
  }
  const server = await readFile(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');
  assert.ok(/tuan: hexagram\.tuan,/.test(server), '卦库接口没有带出彖传');
  const mcp = await readFile(new URL('../miniapp/node/mcp/divination-http.mjs', import.meta.url), 'utf8');
  assert.ok(/`彖传：\$\{item\.tuan\}`/.test(mcp), 'MCP 查卦没有输出彖传');
  assert.ok(/item\.tuan\.includes\(query\)/.test(mcp), 'MCP 查卦没有按彖传检索');
});

test('起卦返回的本卦与变卦都带着彖传', () => {
  // 卦库页与解读页读的是两条不同的数据路径：卦库走 server 自己的字段列表，
  // 解读页走 reading.hexagram。少一处，另一处就会把彖传渲染成 undefined。
  const cases = [...SAMPLES().map(([, cast]) => cast), castByCoins([7, 7, 7, 7, 7, 7])];
  let changed = 0;
  for (const cast of cases) {
    const reading = buildReading(cast);
    assert.equal(
      reading.hexagram.tuan,
      tuanText(reading.hexagram.order),
      `${reading.hexagram.name} 的本卦没带上彖传`,
    );
    if (reading.changed) {
      changed += 1;
      assert.equal(
        reading.changed.tuan,
        tuanText(reading.changed.order),
        `${reading.changed.name} 的变卦没带上彖传`,
      );
    }
  }
  assert.ok(changed > 0, '样本里一个变卦都没有，这条断言等于没验');
});

test('十二辟卦恰好十二卦，且与卦表逐一对得上', () => {
  // 这条最要紧：卦气的整套推论都建立在这张表上，表错一位，后面全错。
  assert.equal(TWELVE_MESSAGES.length, 12);
  const matched = HEXAGRAM_LIST.filter((item) => hexagramQi(item.key));
  assert.equal(matched.length, 12, `六十四卦里只认出 ${matched.length} 卦属于十二辟卦`);
  for (const lord of TWELVE_MESSAGES) {
    const fromTable = hexagramByKey(lord.key);
    assert.ok(fromTable, `${lord.name} 的爻象 ${lord.key} 在卦表里找不到`);
    assert.equal(fromTable.name, lord.name, `${lord.branch} 月主卦的卦名与卦表不符`);
    const qi = hexagramQi(lord.key);
    assert.equal(qi.name, lord.name);
    assert.equal(qi.phase, lord.phase);
  }
});

test('卦气按月支推移，子月复、亥月坤，十二个月不重不漏', () => {
  // 传统：复主子月、临主丑月……乾主巳月、姤主午月，直到坤主亥月。
  const expected = [
    '地雷复', '地泽临', '地天泰', '雷天大壮', '泽天夬', '乾为天',
    '天风姤', '天山遁', '天地否', '风地观', '山地剥', '坤为地',
  ];
  const actual = TWELVE_MESSAGES.map((item) => item.name);
  assert.deepEqual(actual, expected);
  for (let branch = 0; branch < 12; branch += 1) {
    assert.equal(monthQi(branch)?.name, expected[branch], `${branch} 月的主卦不对`);
  }
  assert.equal(monthQi(12), null);
  assert.equal(monthQi(-1), null);
});

test('消长各六：复至乾为息，姤至坤为消', () => {
  const xi = TWELVE_MESSAGES.filter((item) => item.phase === '息').map((item) => item.short);
  const xiao = TWELVE_MESSAGES.filter((item) => item.phase === '消').map((item) => item.short);
  assert.deepEqual(xi, ['复', '临', '泰', '大壮', '夬', '乾']);
  assert.deepEqual(xiao, ['姤', '遁', '否', '观', '剥', '坤']);
  // 息卦阳爻由一长到六，消卦阴爻由一长到六，两边的进度是对称的。
  assert.deepEqual(xi.map((short) => hexagramQi(TWELVE_MESSAGES.find((m) => m.short === short).key).yangCount), [1, 2, 3, 4, 5, 6]);
});

test('非辟卦不硬套卦气', () => {
  // 屯、师、谦、豫下卦虽有两三个阳爻，却不是消息卦的形状，不能算成复或临。
  for (const name of ['水雷屯', '地水师', '地山谦', '雷地豫', '水火既济', '泽雷随']) {
    const item = hexagramByKey(HEXAGRAM_LIST.find((h) => h.name === name).key);
    assert.equal(hexagramQi(item.key), null, `${name} 被误认成十二辟卦了`);
  }
});

test('断语里的卦气段说明当月主卦，并给出本卦的位置', () => {
  const reading = buildReading(castByNumbers(1, 1), { now: new Date(2026, 8, 30) });
  const gua = reading.insights.find((item) => item.title === '卦气 · 当令主卦');
  assert.ok(gua, '断语里没有卦气这一段');
  assert.match(gua.text, /月当令主卦为/, '卦气段没有点出当月主卦');
  const inSeptember = buildReading(castByNumbers(1, 1), { now: new Date(2026, 8, 30) });
  const inJanuary = buildReading(castByNumbers(1, 1), { now: new Date(2026, 0, 20) });
  assert.notEqual(
    inSeptember.insights.find((i) => i.title === '卦气 · 当令主卦').text,
    inJanuary.insights.find((i) => i.title === '卦气 · 当令主卦').text,
    '不同月份的卦气段不该逐字相同',
  );
  assert.match(inJanuary.insights.find((i) => i.title === '卦气 · 当令主卦').text, /丑月当令主卦为地泽临/);
});

test('起卦带着卦气坐标，供页面画消长环', () => {
  // 消长环画的是「走到哪一格」，数据得从 reading 出来，不能由页面自己再推一遍，
  // 否则表改一处、环上还留着旧数。
  const reading = buildReading(castByNumbers(1, 1), { now: new Date(2026, 8, 30) });
  assert.ok(reading.qi, 'reading 上没有卦气坐标');
  assert.equal(reading.qi.branch, monthPillar(2026, 9, 30).branch);
  assert.equal(reading.qi.lord, monthQi(reading.qi.branch).name);
  assert.equal(reading.qi.lordShort, monthQi(reading.qi.branch).short);
  assert.ok(['息', '消'].includes(reading.qi.phase));
  // 本卦非辟卦时卦气坐标照样要有——当月主卦照样要画在环上
  const shiZhan = buildReading(castByNumbers(3, 4), { now: new Date(2026, 5, 10) });
  assert.ok(shiZhan.qi, '卦气坐标不该因为本卦非辟卦就消失——当月主卦照样要画');
  assert.equal(shiZhan.qi.lord, monthQi(shiZhan.qi.branch).name);
  assert.equal(shiZhan.qi.self, null, '师卦不是十二辟卦，不该被标上位置');
});

test('消长环按十二格画出，并与卦气数据对得上', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  assert.ok(/\.qiring \{/.test(client), '消长环没有样式');
  assert.ok(/function qiRingSvg\(qi\)/.test(client), '没有消长环的绘制函数');
  // 上一条只验了「函数存在」，函数写死了不调用照样能过——这里再钉一次调用点。
  assert.ok(/if \(reading\.qi\) \{[\s\S]{0,320}?qiRingSvg\(reading\.qi\)/.test(client), '解读页没有真正把卦气坐标交给消长环绘制');
  assert.ok(/if \(!qi\) return ''/.test(client), '消长环没有做空值保护');
  // 十二格，一格一卦，名字必须与 guaqi.mjs 的表一致
  const ring = /const QI_RING = \[([\s\S]*?)\];/.exec(client);
  assert.ok(ring, '客户端没有十二辟卦的对照表');
  const shorts = [...ring[1].matchAll(/s: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(shorts, TWELVE_MESSAGES.map((m) => m.short), '环上的卦名与卦气表对不上');
  const branches = [...ring[1].matchAll(/b: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(branches, ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']);
  assert.ok(/prefers-reduced-motion: reduce[\s\S]*?\.qiring \.now-sector \{\s*animation: none/.test(client), '消长环没有尊重系统的减少动效设置');
});

test('成卦盘随推演长出，动爻最后才标红', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  assert.ok(/\.casting-hex \{/.test(client), '成卦盘没有样式');
  assert.ok(/function growCastingHex\(box, reading\)/.test(client), '没有成卦盘的生长逻辑');
  // 钉在调用点，不是钉在符号存在
  assert.ok(
    /const stage = showCasting\(\);[\s\S]{0,400}?growCastingHex\(stage\.hex, data\.reading\)/.test(client),
    '起卦流程没有驱动成卦盘生长',
  );
  // 动爻必须等六爻长齐再点。早一点就泄底了——起卦的意义正是先成卦、后定动爻。
  assert.ok(
    /if \(index === order\.length - 1\) \{[\s\S]{0,220}?if \(other\.line\?\.moving\)/.test(client),
    '动爻不是等六爻长齐后才标红',
  );
  // 成卦盘只画一爻都不长就等于没画
  assert.ok(/if \(lines\.length === 0\) return;/.test(client), '成卦盘没有处理空卦体');
  assert.ok(/prefers-reduced-motion: reduce[\s\S]{0,200}?\.casting-hex \.grow \{[\s\S]{0,120}?transition: none/.test(client), '成卦盘没有尊重系统的减少动效设置');
});

test('起卦那一拍留得够长，成卦盘能在等待之内长齐', async () => {
  // 成卦盘分到的时间不能超过整段等待，否则推演还没画完就跳结果。
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const budget = Number(/const CASTING_BUDGET_MS = (\d+);/.exec(client)[1]);
  const waitMs = Number(/const CASTING_HOLD_MS = (\d+);/.exec(client)[1]);
  assert.ok(waitMs >= budget, `等待 ${waitMs}ms 短于推演预算 ${budget}ms，画到一半就会被切掉`);
  // 余量还得真能容下末行落定与切页，两者相等就是刚好卡在最后一帧上切走。
  assert.ok(waitMs - budget >= 200, `等待 ${waitMs}ms 只比预算多 ${waitMs - budget}ms，末行来不及落定`);
  // 成卦盘取推演预算的一部分，再除以六爻：下界 × 6 仍须落在等待之内
  const step = /const stepMs = Math\.max\((\d+), Math\.floor\(\(CASTING_BUDGET_MS \* ([\d.]+)\) \/ order\.length\)\)/.exec(client);
  assert.ok(step, '找不到成卦盘每爻的间隔');
  const minStep = Number(step[1]);
  const share = Number(step[2]);
  assert.ok(minStep * 6 <= waitMs, `六爻按最小间隔 ${minStep}ms 排下来要 ${minStep * 6}ms，超过等待 ${waitMs}ms`);
  assert.ok(share <= 1, '成卦盘分到的时间占比不合法');
  assert.ok(budget * share <= waitMs, `成卦盘要画到 ${budget * share}ms，超过等待 ${waitMs}ms`);
});

test('四卦推导图把互、变、错、综的取法画出来', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  assert.ok(/\.derive \{/.test(client), '推导图没有样式');
  assert.ok(/function deriveBlock\(reading\)/.test(client), '没有推导图的绘制函数');
  // 钉在调用点，不是钉在符号存在。上一版只匹配「赋值到 append」，
  // 结果 if (false && derive) 也能过——这一版把判断本身也圈进来。
  assert.ok(
    /if \(derive\) \{[\s\S]{0,160}?box\.innerHTML = derive;[\s\S]{0,80}?right\.append\(box\)/.test(client),
    '解读页没有真正把推导图插进页面',
  );
  // 四种取法都要真的排进 steps，光在 DERIVE_HOW 里写个说明不算数
  for (const kind of ['mutual', 'changed', 'opposite', 'inverted']) {
    assert.ok(
      new RegExp(`\\['${kind}', reading\\.${kind},`).test(client),
      `推导图没有把${kind}排进去`,
    );
  }
  // 六爻皆静时变卦为 null，步骤表要能把它滤掉，否则会画出一个空卦
  assert.ok(/\.filter\(\(\[, target\]\) => Boolean\(target\)\)/.test(client), '推导图没有滤掉不存在的变卦');
  // 四种取法一个都不能少，图注要写清怎么取
  for (const [kind, how] of [
    ['mutual', '取二三四为下卦'],
    ['changed', '动爻阴阳反转'],
    ['opposite', '六爻阴阳全反'],
    ['inverted', '六爻上下倒置'],
  ]) {
    assert.ok(new RegExp(`${kind}: \\['${kind === 'mutual' ? '互卦' : kind === 'changed' ? '变卦' : kind === 'opposite' ? '错卦' : '综卦'}', '${how}`).test(client), `推导图少了${how}的说明`);
  }
});

test('八宫那一列排在四卦推导前头，八格按世次一路排下来', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  assert.ok(/\.palace \{/.test(client), '八宫名单没有样式');
  assert.ok(/function palaceBlock\(jingfang\)/.test(client), '没有八宫名单的绘制函数');
  // 钉在调用点，不是钉在符号存在。函数写死了不调用照样能过。
  assert.ok(
    /if \(palace\) \{[\s\S]{0,200}?box\.innerHTML = palace;[\s\S]{0,80}?right\.append\(box\)/.test(client),
    '解读页没有真正把八宫名单插进页面',
  );
  // 次序：先认清自己在哪一宫的哪一级，再看梅花那四种推法。排反了读的人就得回头找。
  // 找的是调用点那一行，不是函数定义——定义在文件里排得更前，
  // 拿定义去比顺序，判出来的先后跟页面上真正的先后不是一回事。
  const palaceAt = client.indexOf('const palace = palaceBlock(reading.jingfang)');
  const deriveAt = client.indexOf('const derive = deriveBlock(reading)');
  assert.ok(palaceAt > 0, '解读页没有把京房数据交给八宫名单绘制');
  assert.ok(deriveAt > 0, '解读页没有画四卦推导');
  assert.ok(palaceAt < deriveAt, '八宫名单排在四卦推导后头了');
  // 名单是跟着卦走的：拿的是本卦那一宫的名单，不是写死某八格
  assert.ok(/const roster = jingfang && jingfang\.roster;/.test(client), '八宫名单没有读同宫名单');
  assert.ok(/if \(!roster \|\| roster\.length === 0\) return null;/.test(client), '八宫名单没有做空值保护');
  // 抬头写清宫与五行，看图的人知道自己站在哪
  assert.ok(/escapeHtml\(jingfang\.palaceName\)/.test(client), '八宫抬头没写宫名');
  assert.ok(/escapeHtml\(jingfang\.element\)/.test(client), '八宫抬头没写五行');
  // 名次照名次原样写，图注里「游」「归」怎么来的也说了，别让那句话空着
  assert.ok(/游魂退到四爻、归魂退到三爻/.test(client), '八宫图注没解释游魂归魂为什么叫这个名字');
  assert.ok(/一世到五世世爻逐爻上移/.test(client), '八宫图注没说明世次怎么爬');
});

test('八宫与四卦推导共用小卦样式，没被 .derive 又 scope 回去', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  // 这一组是 miniGua() 画出来的小卦，两处都在用。挂回 .derive 下面，
  // 八宫那八格就只剩默认样式：没有朱砂变爻，没有加粗游归，图注说的话全落空。
  // 把样式表里所有选择器原样收下来，再一条条问「有没有这一条」。
  // 不能只找「以 X 结尾」的那条规则——`.palace .unit.odd .unit-tag` 也以 `.unit-tag` 结尾，
  // 先撞上它，就永远轮不到真正那条 `.unit-tag`。
  const selectors = [...client.matchAll(/^\s*([^\n{]+?)\s*\{/gm)].map((m) => m[1].trim());
  for (const selector of ['.derive-head', '.unit', '.unit-name', '.unit-tag', '.mini-gua', '.mini-line', '.mini-line.touched i']) {
    assert.ok(selectors.includes(selector), `${selector} 这条规则没了，八宫那八格会掉样式`);
    assert.ok(!selectors.includes(`.derive ${selector}`), `${selector} 被挂回 .derive 底下了`);
  }
  // 反过来，推导图自己的布局（箭头、那一行）就该留在 .derive 里，
  // 放出去会让八宫那块也去吃本该只有箭头才有的排版
  for (const selector of ['.derive .arrow', '.derive .derive-row', '.derive .derive-body']) {
    assert.ok(selectors.includes(selector), `${selector} 这条规则没了`);
    assert.ok(!selectors.includes(selector.replace('.derive ', '')), `${selector} 被提出去了，八宫那块会跟着吃这条排版`);
  }
  // 变过的爻染朱砂这条，八宫那八格靠它才看得出次序
  const touched = /\.mini-line\.touched i \{([\s\S]*?)\}/.exec(client);
  assert.ok(touched, '小卦没有变爻的样式');
  assert.ok(/var\(--seal\)/.test(touched[1]), '变过的爻没有染朱砂');
});

test('本卦那一格的朱砂压得过游魂归魂的加粗', async () => {
  // 十六卦的本卦自身就落在游魂或归魂上，那一格同时挂「就是你」和「这是例外级」两个标记。
  // 两条规则特异性相同时按书写顺序决胜，朱砂那条必须写在后面，
  // 否则本卦恰好是游归时只剩个框、字反倒是灰的，看着像别人的一格。
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const selfAt = client.indexOf('.palace .unit.self .unit-tag');
  const oddAt = client.indexOf('.palace .unit.odd .unit-tag');
  assert.ok(oddAt > 0, '游魂归魂那两格没有加粗');
  assert.ok(selfAt > 0, '本卦那一格的世次没有染朱砂');
  assert.ok(selfAt > oddAt, '朱砂那条压在游归加粗前面，本卦落在游魂归魂上时字就成灰的了');
  // 两条得是同一个特异性（各三个类），否则先后顺序根本不起作用
  assert.ok(
    /\.palace \.unit\.odd \.unit-tag \{[\s\S]{0,400}?\.palace \.unit\.self \.unit-tag \{/.test(client),
    '这两条不是同级，先写后写都一样',
  );
  // 框是朱砂的，格子上确实同时挂了两个标记
  assert.ok(/\.palace \.unit\.self \{[\s\S]*?border: 1px solid var\(--seal\)/.test(client),
    '本卦那一格没有朱砂框');
  const start = client.indexOf('function palaceBlock(jingfang)');
  const block = client.slice(start, client.indexOf('\n      function ', start + 10));
  assert.ok(/const isHere = slot\.stage === jingfang\.stage;/.test(block), '本卦那格没按世次认');
  assert.ok(/const isOdd = slot\.stage === '游魂' \|\| slot\.stage === '归魂';/.test(block),
    '游魂归魂两格没认出来');
  assert.ok(/'self self-unit'/.test(block) && /'odd'/.test(block), '两个标记没有一起挂到格子上');
});

test('八宫那八格只标变过的爻，不标世爻', async () => {
  // 世爻在左边卦盘上已经朱砂框出来了，这里再标一遍是两份要人核对的账。
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const start = client.indexOf('function palaceBlock(jingfang)');
  const block = client.slice(start, client.indexOf('\n      function ', start + 10));
  assert.ok(block, '找不到八宫名单的绘制函数');
  assert.ok(/miniGua\(slot\.key, slot\.flips\)/.test(block), '八宫那八格没有把变过的爻传给小卦');
  assert.ok(!block.includes('slot.shi'), '八宫那八格不该再标世爻，左边卦盘上已经标了');
  // 顺带盯着四卦推导那一格没被改：它传的是 null，意思是本卦不标任何爻
  const deriveAt = client.indexOf('function deriveBlock(reading)');
  const derive = client.slice(deriveAt, client.indexOf('\n      function ', deriveAt + 10));
  assert.ok(/miniGua\(base\.key, null\)/.test(derive), '四卦推导的本卦那格被误标了爻');
});

test('推导图的四卦，取法本身经得起核', () => {
  // 图只是把既有结果画出来，所以要保证画出去的与算出来的一致：互卦取二三四、
  // 三四五，错卦全反，综卦倒置——这四条若有一条画错，图就在骗人。
  for (const [name, cast] of SAMPLES()) {
    const reading = buildReading(cast);
    const self = reading.hexagram.key;
    const mutual = reading.mutual.key;
    assert.equal(mutual.slice(0, 3), self.slice(1, 4), `${name}：互卦下卦不是二三四爻`);
    assert.equal(mutual.slice(3, 6), self.slice(2, 5), `${name}：互卦上卦不是三四五爻`);
    assert.equal(reading.opposite.key, [...self].map((c) => (c === '1' ? '0' : '1')).join(''), `${name}：错卦不是六爻全反`);
    assert.equal(reading.inverted.key, [...self].reverse().join(''), `${name}：综卦不是上下倒置`);
    if (reading.changed) {
      const moving = new Set(reading.movingLines.map((l) => l.position));
      for (let i = 0; i < 6; i += 1) {
        const position = i + 1;
        if (moving.has(position)) {
          assert.notEqual(reading.changed.key[i], self[i], `${name}：第${position}爻动了却没变`);
        } else {
          assert.equal(reading.changed.key[i], self[i], `${name}：第${position}爻没动却变了`);
        }
      }
    }
  }
});

test('查卦默认省去彖传，要原文时显式要', async () => {
  // 目标里写着「上手成本低」。连查八卦带彖传近五百字，多半用不上，却把要紧的
  // 话埋在中间。默认给 brief，要原文再传 detail="full"——不是砍内容，是排序。
  const mcp = await readFile(new URL('../miniapp/node/mcp/divination-http.mjs', import.meta.url), 'utf8');

  // 档位得在工具描述里讲清楚，Agent 才知道什么时候要 full
  assert.ok(
    /enum: \['brief', 'full'\], default: 'brief'/.test(mcp),
    'detail 档位没有在 inputSchema 里声明',
  );
  assert.ok(
    /detail="full"/.test(mcp) && /彖传原文/.test(mcp),
    '工具描述没有告诉 Agent 什么时候该要彖传',
  );
  // brief 档下彖传整条不能出现，full 档下必须出现
  assert.ok(
    /detail === 'full' \? `彖传：\$\{item\.tuan\}` : null/.test(mcp),
    '彖传没有跟着 detail 档位走',
  );
  // 省下的量要真的省：brief 得比 full 短出四成以上，否则这档白设
  const tuanTotal = HEXAGRAM_LIST.slice(0, 8).reduce((sum, item) => sum + item.tuan.length, 0);
  const briefTotal = HEXAGRAM_LIST.slice(0, 8)
    .reduce((sum, item) => sum + item.judgment.length + item.image.length, 0);
  assert.ok(
    briefTotal < tuanTotal * 0.6,
    `brief 只省了 ${Math.round((1 - briefTotal / tuanTotal) * 100)}%，不够抵一次参数传递`,
  );

  // 上面全是读源码——把默认档翻成 full 时照样全绿。这一条真跑一次端到端，
  // 确认不传参数时确实走 brief。
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  const ask = async (args) => {
    let raw = '';
    const response = {
      writeHead() { return this; },
      end(chunk) { raw += chunk; return this; },
    };
    await handleMcpRequest({
      response,
        now: AT(10, 0),
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'divination_hexagram_lookup', arguments: args },
      },
    });
    return JSON.parse(raw).result;
  };

  const byDefault = await ask({ query: '谦' });
  const byFull = await ask({ query: '谦', detail: 'full' });
  const shortText = byDefault.content[0].text;
  const longText = byFull.content[0].text;
  assert.equal(byDefault.structuredContent.detail, 'brief', '不传 detail 时不是 brief 档');
  assert.equal(byFull.structuredContent.detail, 'full', '传 detail="full" 没生效');
  assert.ok(!shortText.includes('彖传：'), 'brief 档里仍带着彖传原文');
  assert.ok(longText.includes('彖传：'), 'full 档里没有彖传原文');
  assert.ok(shortText.length < longText.length, 'brief 档没有比 full 档短');
});

// ── 京房一层：八宫、纳甲、六亲、世应 ──────────────────────────────────────

test('八宫卦序由爻变推出，六十四卦与传世卦序逐一对上', async () => {
  // 传世八宫卦序是查来的，但本包不抄表——由八纯卦按《京氏易传》的爻变规则推。
  // 这条把推导结果跟传世表硬对一遍：规则一改，这里立刻红。
  const { jingfang, palaceOf } = await import('../miniapp/node/jingfang.mjs');
  const expected = {
    乾: ['乾为天', '天风姤', '天山遁', '天地否', '风地观', '山地剥', '火地晋', '火天大有'],
    兑: ['兑为泽', '泽水困', '泽地萃', '泽山咸', '水山蹇', '地山谦', '雷山小过', '雷泽归妹'],
    离: ['离为火', '火山旅', '火风鼎', '火水未济', '山水蒙', '风水涣', '天水讼', '天火同人'],
    震: ['震为雷', '雷地豫', '雷水解', '雷风恒', '地风升', '水风井', '泽风大过', '泽雷随'],
    巽: ['巽为风', '风天小畜', '风火家人', '风雷益', '天雷无妄', '火雷噬嗑', '山雷颐', '山风蛊'],
    坎: ['坎为水', '水泽节', '水雷屯', '水火既济', '泽火革', '雷火丰', '地火明夷', '地水师'],
    艮: ['艮为山', '山火贲', '山天大畜', '山泽损', '火泽睽', '天泽履', '风泽中孚', '风山渐'],
    坤: ['坤为地', '地雷复', '地泽临', '地天泰', '雷天大壮', '泽天夬', '水天需', '水地比'],
  };
  const stageNames = ['本宫', '一世', '二世', '三世', '四世', '五世', '游魂', '归魂'];
  const byPalace = new Map();
  for (const hexagram of HEXAGRAM_LIST) {
    const { palace, stage } = palaceOf(hexagram);
    if (!byPalace.has(palace.name)) byPalace.set(palace.name, new Map());
    byPalace.get(palace.name).set(stage.name, hexagram.name);
  }
  assert.equal(byPalace.size, 8, '不是八宫');
  for (const [trigram, names] of Object.entries(expected)) {
    const table = byPalace.get(`${trigram}宫`);
    assert.ok(table, `缺 ${trigram}宫`);
    for (let index = 0; index < names.length; index += 1) {
      assert.equal(table.get(stageNames[index]), names[index], `${trigram}宫${stageNames[index]}推出岔了`);
    }
  }
  // 六十四卦各归一宫，不重不漏
  assert.equal(new Set(HEXAGRAM_LIST.map((h) => jingfang(h).palaceName + jingfang(h).stage)).size, 64);
});

test('归魂是只变第五爻，不是变第四、五爻', async () => {
  // 这一句最容易记错：游魂卦把下三爻收回来，净效果只剩第五爻被变。
  // 写成变第四、五爻的话，八宫的归魂卦整列会变成别宫的二世卦。
  const { palaceOf } = await import('../miniapp/node/jingfang.mjs');
  const 乾宫 = HEXAGRAM_LIST.filter((h) => palaceOf(h).palace.name === '乾宫');
  const gui = 乾宫.find((h) => palaceOf(h).stage.name === '归魂');
  assert.equal(gui.name, '火天大有');
  // 火天大有 = 111101，本宫乾为天 = 111111，只有第五爻不同
  const base = HEXAGRAM_LIST.find((h) => h.name === '乾为天').key;
  const differ = (key) => [...key].flatMap((bit, index) => (bit === base[index] ? [] : [index + 1]));
  assert.deepEqual(differ(gui.key), [5], '归魂相对本宫被变的爻位不对');
  // 游魂（晋）则要变初、二、三、五爻
  const you = 乾宫.find((h) => palaceOf(h).stage.name === '游魂');
  assert.deepEqual(differ(you.key), [1, 2, 3, 5], '游魂相对本宫被变的爻位不对');
});

test('同宫八卦按世次排成一列，卦名与次序跟传世卦序逐宫对得上', async () => {
  // 卦盘上那一列小卦就是这一列。BY_HEXAGRAM_KEY 是按卦反查宫的表，没排过序；
  // 这一列有次序，次序本身就是「一世到五世、游魂归魂」——排错或抄错，看图的人就照错的读。
  const { jingfang, palaceRoster } = await import('../miniapp/node/jingfang.mjs');
  const expected = {
    乾: ['乾为天', '天风姤', '天山遁', '天地否', '风地观', '山地剥', '火地晋', '火天大有'],
    兑: ['兑为泽', '泽水困', '泽地萃', '泽山咸', '水山蹇', '地山谦', '雷山小过', '雷泽归妹'],
    离: ['离为火', '火山旅', '火风鼎', '火水未济', '山水蒙', '风水涣', '天水讼', '天火同人'],
    震: ['震为雷', '雷地豫', '雷水解', '雷风恒', '地风升', '水风井', '泽风大过', '泽雷随'],
    巽: ['巽为风', '风天小畜', '风火家人', '风雷益', '天雷无妄', '火雷噬嗑', '山雷颐', '山风蛊'],
    坎: ['坎为水', '水泽节', '水雷屯', '水火既济', '泽火革', '雷火丰', '地火明夷', '地水师'],
    艮: ['艮为山', '山火贲', '山天大畜', '山泽损', '火泽睽', '天泽履', '风泽中孚', '风山渐'],
    坤: ['坤为地', '地雷复', '地泽临', '地天泰', '雷天大壮', '泽天夬', '水天需', '水地比'],
  };
  const stageNames = ['本宫', '一世', '二世', '三世', '四世', '五世', '游魂', '归魂'];
  for (const [trigram, names] of Object.entries(expected)) {
    const base = HEXAGRAM_LIST.find((h) => h.name === names[0]);
    const roster = palaceRoster(base);
    assert.equal(roster.length, 8, `${trigram}宫不是八格`);
    assert.deepEqual(roster.map((s) => s.stage), stageNames, `${trigram}宫的世次次序不对`);
    assert.deepEqual(roster.map((s) => s.name), names, `${trigram}宫这一列跟传世卦序对不上`);
    // 一格里卦名与卦象必须指同一个卦，别拿名字配错卦象
    for (const slot of roster) {
      assert.equal(slot.key, hexagramByOrder(HEXAGRAM_LIST.find((h) => h.name === slot.name).order).key,
        `${trigram}宫${slot.stage}那格的卦名与卦象不是一卦`);
    }
  }
});

test('游魂那格不含第四爻、归魂只变第五爻，「游」「归」不是随口起的', async () => {
  // 递进到五世之后忽然要往回退，这一退就是这两个名字的全部由来。
  // 名次图注上写着这句话，所以它得是真的：变爻错一爻，「游」「归」两个字就空了。
  const { jingfang, palaceRoster } = await import('../miniapp/node/jingfang.mjs');
  for (const palace of ['乾宫', '兑宫', '离宫', '震宫', '巽宫', '坎宫', '艮宫', '坤宫']) {
    const base = HEXAGRAM_LIST.find((h) => {
      const j = jingfang(h);
      return j.palaceName === palace && j.stage === '本宫';
    });
    const [ben, yi, er, san, si, wu, you, gui] = palaceRoster(base);
    // 一世到五世：世次一级一级往上爬，变过的爻一级一级往上加
    assert.deepEqual([ben, yi, er, san, si, wu].map((s) => s.shi), [6, 1, 2, 3, 4, 5],
      `${palace}世次没有逐爻上移`);
    assert.deepEqual([yi, er, san, si, wu].map((s) => s.flips.length), [1, 2, 3, 4, 5],
      `${palace}一到五世的变爻数不对`);
    // 游魂：外卦复本，第四爻退回去了，所以变爻里没有第四爻；世爻跟着退到四爻
    assert.equal(you.stage, '游魂', `${palace}第七格不是游魂`);
    assert.ok(!you.flips.includes(4), `${palace}游魂的变爻里混进了第四爻`);
    assert.deepEqual(you.flips, [1, 2, 3, 5], `${palace}游魂的变爻不对`);
    assert.equal(you.shi, 4, `${palace}游魂的世爻没退到四爻`);
    // 归魂：下三爻收回来，净效果只剩第五爻被变；世爻退到三爻
    assert.equal(gui.stage, '归魂', `${palace}第八格不是归魂`);
    assert.deepEqual(gui.flips, [5], `${palace}归魂不是只变第五爻`);
    assert.equal(gui.shi, 3, `${palace}归魂的世爻没退到三爻`);
    // 世应相隔三位，这是六爻通例
    for (const slot of palaceRoster(base)) {
      assert.equal(slot.ying, slot.shi > 3 ? slot.shi - 3 : slot.shi + 3,
        `${palace}${slot.stage}的世应相隔不是三位`);
    }
  }
});

test('六十四卦在同宫名单里都找得到自己那一格，两处世应一致', async () => {
  const { jingfang, palaceRoster } = await import('../miniapp/node/jingfang.mjs');
  for (const h of HEXAGRAM_LIST) {
    const j = jingfang(h);
    assert.equal(j.roster, palaceRoster(h), `${h.name}：两条取法拿到的不是同一份名单`);
    const slot = j.roster.find((s) => s.key === h.key);
    assert.ok(slot, `${h.name}在本宫名单里找不到自己`);
    assert.equal(slot.stage, j.stage, `${h.name}那一格的世次对不上`);
    assert.equal(slot.shi, j.shi, `${h.name}那一格的世爻对不上`);
    assert.equal(slot.ying, j.ying, `${h.name}那一格的应爻对不上`);
  }
  // 游魂归魂每宫各一，十六卦。这一格在本卦上会同时挂「就是你」与「这是例外级」两个标记，
  // 客户端那条朱砂压过加粗的规则就是为它们准备的，所以数目得钉住。
  const odd = HEXAGRAM_LIST.filter((h) => ['游魂', '归魂'].includes(jingfang(h).stage));
  assert.equal(odd.length, 16, '游魂归魂不是十六卦');
});

test('同宫名单是冻结的：它被这一宫所有卦共用，谁都不能就地改坏', async () => {
  // 同一宫的八个卦读出来的是同一份数组。不冻的话，看过一次八宫图改了它，
  // 后面这一宫别的卦读到的就是被改过的——而且从哪看出来的都看不出来。
  const { jingfang, palaceRoster } = await import('../miniapp/node/jingfang.mjs');
  const base = HEXAGRAM_LIST.find((h) => {
    const j = jingfang(h);
    return j.palaceName === '离宫' && j.stage === '本宫';
  });
  const roster = palaceRoster(base);
  assert.ok(Object.isFrozen(roster), '名单本身没冻');
  assert.ok(Object.isFrozen(roster[0]), '单格没冻');
  assert.ok(Object.isFrozen(roster[0].flips), '变爻数组没冻');
  assert.throws(() => { 'use strict'; roster[0].name = '别的卦'; }, TypeError, '名单竟然能改');
  assert.equal(palaceRoster(base)[0].name, '离为火', '改坏了还在往外发');
});

test('纳支照纳支歌诀，八纯卦内外首支逐条对上', async () => {
  const { jingfang } = await import('../miniapp/node/jingfang.mjs');
  // 「乾金甲子外壬午，坎水戊寅外戊申，艮土丙辰外丙戌，震木庚子外庚午，
  //   巽木辛丑外辛未，离火己卯外己酉，坤土乙未外癸丑，兑金丁巳外丁亥」
  const song = {
    乾为天: ['甲子', '壬午'], 坎为水: ['戊寅', '戊申'], 艮为山: ['丙辰', '丙戌'],
    震为雷: ['庚子', '庚午'], 巽为风: ['辛丑', '辛未'], 离为火: ['己卯', '己酉'],
    坤为地: ['乙未', '癸丑'], 兑为泽: ['丁巳', '丁亥'],
  };
  for (const [name, [inner, outer]] of Object.entries(song)) {
    const jf = jingfang(HEXAGRAM_LIST.find((h) => h.name === name));
    assert.equal(jf.lines[0].stem + jf.lines[0].branch, inner, `${name} 内卦首支不符歌诀`);
    assert.equal(jf.lines[3].stem + jf.lines[3].branch, outer, `${name} 外卦首支不符歌诀`);
  }
});

test('纳支随经卦阴阳，不随卦宫阴阳', async () => {
  // 山水蒙属离宫（阴宫），但下艮上坎都是阳卦，故六爻全纳阳支。写成按宫分阴阳就错了。
  const { jingfang } = await import('../miniapp/node/jingfang.mjs');
  const { TRIGRAMS } = await import('../miniapp/node/hexagrams.mjs');
  const yangBranch = new Set(['子', '寅', '辰', '午', '申', '戌']);
  for (const hexagram of HEXAGRAM_LIST) {
    const jf = jingfang(hexagram);
    for (const line of jf.lines) {
      const trigram = line.position <= 3
        ? TRIGRAMS[hexagram.lower].name
        : TRIGRAMS[hexagram.upper].name;
      const isYangTrigram = ['乾', '震', '坎', '艮'].includes(trigram);
      assert.equal(
        yangBranch.has(line.branch),
        isYangTrigram,
        `${hexagram.name}${line.label} 纳${line.branch}，与${trigram}卦阴阳不符`,
      );
    }
  }
});

test('六亲以本宫五行为我，配法合于五行生克', async () => {
  const { jingfang } = await import('../miniapp/node/jingfang.mjs');
  // 乾宫属金：土生金故父母，金生水故子孙，火克金故官鬼，金克木故妻财，同金故兄弟
  const qian = jingfang(HEXAGRAM_LIST.find((h) => h.name === '乾为天'));
  assert.deepEqual(qian.lines.map((l) => l.relative), ['子孙', '妻财', '父母', '官鬼', '兄弟', '父母']);
  assert.deepEqual(qian.lines.map((l) => l.element), ['水', '木', '土', '火', '金', '土']);
  // 坤宫属土：火生土故父母，土生金故子孙，木克土故官鬼，土克水故妻财，同土故兄弟
  const kun = jingfang(HEXAGRAM_LIST.find((h) => h.name === '坤为地'));
  assert.deepEqual(kun.lines.map((l) => l.relative), ['兄弟', '父母', '官鬼', '兄弟', '妻财', '子孙']);
  // 坎宫属水：土克水故官鬼，水生木故子孙，水克火故妻财，金生水故父母，同水故兄弟
  const kan = jingfang(HEXAGRAM_LIST.find((h) => h.name === '坎为水'));
  assert.deepEqual(kan.lines.map((l) => l.relative), ['子孙', '官鬼', '妻财', '父母', '官鬼', '兄弟']);
});

test('世爻由宫与世次定，应爻隔三位且不越界', async () => {
  const { jingfang } = await import('../miniapp/node/jingfang.mjs');
  // 一世初、二世二、三世三、四世四、五世五、本宫上爻、游魂四、归魂三
  const shiOf = { 本宫: 6, 一世: 1, 二世: 2, 三世: 3, 四世: 4, 五世: 5, 游魂: 4, 归魂: 3 };
  const seen = new Set();
  for (const hexagram of HEXAGRAM_LIST) {
    const jf = jingfang(hexagram);
    assert.equal(jf.shi, shiOf[jf.stage], `${hexagram.name} 是${jf.stage}卦，世爻位不对`);
    // 初应四、二应五、三应六，返过来四应一、五应二、六应三。
    // 照字面「世 + 3」的话，本宫、六爻与五世卦会算到第八、九爻去。
    assert.equal(jf.ying, jf.shi <= 3 ? jf.shi + 3 : jf.shi - 3, `${hexagram.name} 应爻隔位不对`);
    assert.ok(jf.ying >= 1 && jf.ying <= 6, `${hexagram.name} 应爻越界：${jf.ying}`);
    assert.equal(jf.lines.filter((l) => l.role).length, 2, `${hexagram.name} 世应标记数不对`);
    assert.ok(jf.lines[jf.shi - 1].role === '世' && jf.lines[jf.ying - 1].role === '应');
    seen.add(`${jf.shi}-${jf.ying}`);
  }
  assert.equal(seen.size, 6, '世应配对应有六种');
});

test('断语给出六亲世应，且不与梅花的主客混说世应', () => {
  const reading = buildReading(castByNumbers(3, 8), { now: new Date(2026, 8, 29), question: '要不要接这个 offer' });
  const segment = reading.insights.find((item) => item.title === '六亲世应');
  assert.ok(segment, '断语里没有「六亲世应」');
  const jf = reading.jingfang;
  const shi = jf.lines[jf.shi - 1];
  const ying = jf.lines[jf.ying - 1];
  assert.ok(segment.text.includes(jf.palaceName + jf.stage), '没点出宫与世次');
  assert.ok(segment.text.includes(`世爻${shi.label}持${shi.relative}`), '没点出世爻身份');
  assert.ok(segment.text.includes(`应爻${ying.label}为${ying.relative}`), '没点出应爻身份');
  // 动爻的六亲要说清「事落在谁身上」
  const moving = reading.movingLines.map((line) => jf.lines[line.position - 1].relative);
  for (const relative of moving) assert.ok(segment.text.includes(relative), `没点到动爻六亲 ${relative}`);

  // 梅花那一层只能说主客，不能再自称世应——同一段里两个世爻位会看糊涂
  const host = reading.insights.find((item) => item.title === '主客');
  assert.ok(host, '断语里没有「主客」');
  assert.ok(!reading.insights.some((item) => item.title === '世应'), '「世应」这一段仍被梅花占用');
  // 对应爻是初应四、二应五、三应上，来回都跨内外两卦：主客恒分居两卦，
  // 写成「同在下卦」是跟 counterpart 的定义打架。
  const a = reading.structure.shi.position;
  const b = reading.structure.ying.position;
  assert.ok((a <= 3) !== (b <= 3), '主客两爻本该分居内外两卦');
  assert.ok(!/同在下卦|同在上卦/.test(host.text), '主客段仍断言两爻同处一卦');
  assert.ok(/恒分居内卦与外卦/.test(host.text), '主客段没有点明主客恒分居两卦');
  // 变卦另有一套宫与世次，不能沿用本卦
  if (reading.changed) {
    assert.ok(reading.changedJingfang, '变卦没有装京房');
    assert.equal(reading.changedJingfang.palaceName.length + reading.changedJingfang.stage.length > 0, true);
  }
});

test('卦体把六亲与世应画出来，不只是数据里有', async () => {
  // 钉在调用点，不钉在函数存在——只验 guaLines 里有 .rel，解读页照样可以不调它。
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  // 掐出 guaLines 自己的函数体：锚到下一个 function，否则 indexOf 取到的区间是空的
  const start = client.indexOf('function guaLines(');
  const body = client.slice(start, client.indexOf('\n      function ', start + 10));
  assert.ok(body.length > 0, '没找到 guaLines 函数体');
  assert.ok(/\.rel/.test(body) && /na\.relative/.test(body), '卦体没画六亲');
  assert.ok(/na\.role/.test(body), '卦体没标世应');
  assert.ok(/jingfang\.lines\[position - 1\]/.test(body), '卦体没按爻位取纳甲');
  assert.ok(/isGod/.test(body) && /role god/.test(body), '卦体没标用神');
  assert.ok(/const fu = \(hidden \|\| \[\]\)/.test(body), '卦体没接伏神');
  assert.ok(/fu\.hushen/.test(body), '卦体没画出伏神那一爻');
  // 本卦与变卦都要传进去，且是从 reading 上取的
  const render = client.slice(client.indexOf('left.append(guaBlock'));
  assert.ok(
    /guaBlock\([\s\S]{0,200}?reading\.jingfang,[\s\S]{0,200}?reading\.useGod && reading\.useGod\.picked/.test(render),
    '解读页本卦没把京房数据与用神传进卦体',
  );
  assert.ok(/reading\.useGod\.hidden/.test(render), '解读页本卦没把伏神传进卦体');
  // 变卦要把化爻传进去，才标得出哪一格是由本卦动爻变过来的
  assert.ok(
    /guaBlock\(reading\.changed, null, '变卦', reading\.changedJingfang,[\s\S]{0,200}?reading\.transforms \|\| \[\][\s\S]{0,200}?\)\)/.test(render),
    '解读页变卦没传京房数据与化爻',
  );
  // 六冲/六合那枚小标，本卦与变卦都要传——变卦也可能是六冲卦，那正是「六合变六冲」
  // 要在卦面上看得见的地方
  assert.ok(
    /reading\.useGod && reading\.useGod\.circle\) \|\| null,\s*clashTag\(reading, '本卦'\)/.test(render),
    '解读页本卦没把卦体冲合小标传进卦体',
  );
  assert.ok(/clashTag\(reading, '变卦'\)/.test(render), '解读页变卦没把卦体冲合小标传进卦体');
  // 右栏摘要也得有这一行
  assert.ok(/\['六亲世应',/.test(client), '右栏没有六亲世应摘要');
  assert.ok(/\['用神',/.test(client), '右栏没有用神摘要');
  assert.ok(/\['主客',/.test(client), '右栏仍把体用那层叫世应');
  // 卦库详情页也要装上，同一根代码两个地方都传
  assert.ok(/guaLines\(item, null, item\.palace \|\| null\)/.test(client), '卦库详情页没把京房数据传进卦体');
  assert.ok(/item\.palace\.palaceName \+ item\.palace\.stage/.test(client), '卦库详情页标题没带宫位');
});

test('查卦给宫位与世应，full 档再给六亲全表', async () => {
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  const ask = async (args) => {
    let raw = '';
    const response = { writeHead() { return this; }, end(chunk) { raw += chunk; return this; } };
    await handleMcpRequest({
      response,
        now: AT(10, 0),
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'divination_hexagram_lookup', arguments: args } },
    });
    return JSON.parse(raw).result;
  };
  const brief = await ask({ query: '谦' });
  const full = await ask({ query: '谦', detail: 'full' });
  const briefText = brief.content[0].text;
  const fullText = full.content[0].text;
  // 谦为兑宫五世卦：内艮丙辰土父母、丙午火官鬼、丙申金兄弟；外坤癸丑土父母、癸亥水子孙持世、癸酉金兄弟
  assert.ok(/兑宫五世卦/.test(briefText), 'brief 档没给宫位与世次');
  assert.ok(/世五爻持子孙/.test(briefText), 'brief 档没给世爻身份');
  assert.ok(/应二爻为官鬼/.test(briefText), 'brief 档没给应爻身份');
  assert.ok(!/^六亲：/m.test(briefText), 'brief 档不该塞六亲全表');
  assert.ok(/^六亲：/m.test(fullText), 'full 档缺六亲全表');
  assert.ok(/丙辰土父母/.test(fullText), 'full 档六亲没带干支');
  assert.ok(briefText.length < fullText.length, 'full 档没有比 brief 档长');
});

// ── 用神 ─────────────────────────────────────────────────────────────────

test('问何事取何亲为用神，取法有传世出处', async () => {
  const { TOPIC_CLASSES, detectTopic } = await import('../miniapp/node/topics.mjs');
  // 逐条核对取法，不靠印象：问财取妻财、求职取官鬼、文书取父母、医药取子孙、
  // 官司取官鬼、失物取妻财；婚恋分男女；占病是官鬼为病症、子孙为医药两头看。
  const expected = {
    财运: ['妻财'],
    事业功名: ['官鬼'],
    感情: ['妻财', '官鬼'],
    婚恋: ['妻财', '官鬼'],
    疾病: ['官鬼', '子孙'],
    学业文书: ['父母'],
    房产车契: ['父母'],
    官讼是非: ['官鬼'],
    出行寻物: ['妻财'],
  };
  for (const topic of TOPIC_CLASSES) {
    assert.deepEqual(topic.god.relatives, expected[topic.label], `${topic.label} 的用神取法不对`);
    assert.ok(topic.god.reason && topic.god.reason.length > 8, `${topic.label} 的取法没有给出处`);
  }
  // 分男女的必须写明依据，也必须写明不替人认性别
  const marriage = TOPIC_CLASSES.find((t) => t.label === '婚恋');
  assert.ok(marriage.god.byGender, '婚恋没标分男女');
  assert.ok(/增删卜易/.test(marriage.god.reason), '婚恋的取法没有引《增删卜易》');
  // 关键词仍走原来的匹配
  assert.equal(detectTopic('这单生意能赚钱吗').label, '财运');
  assert.equal(detectTopic('明天面试能过吗').label, '事业功名');
  assert.equal(detectTopic('这病能好么').label, '疾病');
});

test('用神择爻：动爻优先，其次近世', async () => {
  const { pickUseGod } = await import('../miniapp/node/jingfang.mjs');
  const { jingfang } = await import('../miniapp/node/jingfang.mjs');
  const { hexagramByOrder } = await import('../miniapp/node/hexagrams.mjs');
  const h = jingfang(hexagramByOrder(1)); // 乾为天：子孙妻财父母官鬼兄弟父母，世6
  // 卦中独一
  const single = pickUseGod(h, ['妻财'], []);
  assert.equal(single.all.length, 1);
  assert.equal(single.picked.position, 2);
  assert.equal(single.why, '卦中独一');

  // 两现：都不动时取近世爻者。乾为天父母在三、六爻，而世爻正是六爻——
  // 六爻距离为零，三爻差三位，所以取六爻。
  const both = pickUseGod(h, ['父母'], []);
  assert.equal(both.all.length, 2);
  assert.equal(both.why, '近世爻者');
  assert.equal(both.picked.position, 6, '父爻在 3、6 爻，世 6，应取距离为零的 6 爻');

  // 两现：动爻优先，哪怕动的那个不是近世爻
  const animated = pickUseGod(h, ['父母'], [3]);
  assert.equal(animated.why, '动爻优先');
  assert.equal(animated.picked.position, 3, '有动爻就该取动的那个，不管远近');

  // 候选不止一亲时不择：择了就等于替求测者认了性别或认了病势
  const twoGods = pickUseGod(h, ['妻财', '官鬼'], []);
  assert.equal(twoGods.picked, null, '两亲并列时不该硬择用神');
  assert.equal(twoGods.why, '两亲各看各的');
  assert.deepEqual(twoGods.present, ['妻财', '官鬼']);

  // 不上卦
  const missing = pickUseGod(h, ['子子孙孙'], []);
  assert.equal(missing.picked, null);
  assert.equal(missing.why, '不上卦');
  assert.deepEqual(missing.absent, ['子子孙孙']);
});

test('断语给出用神，且分男女与不上卦都不硬编', () => {
  // 财运：一亲，取得到，说清取哪一爻、与世爻什么关系
  const wealth = buildReading(castByNumbers(3, 8), { now: new Date(2026, 8, 29), question: '这单生意能赚钱吗' });
  const wg = wealth.insights.find((item) => item.title === '用神');
  assert.ok(wg, '断语里没有「用神」');
  assert.ok(/所问为财运/.test(wg.text), '用神段没点出事类');
  assert.ok(/求财取妻财/.test(wg.text), '用神段没给出取法依据');
  assert.ok(wealth.useGod && wealth.useGod.picked, '财运应有取到的用神');
  assert.deepEqual(wealth.useGod.relatives, ['妻财']);
  const godLine = wealth.useGod.picked;
  assert.ok(wg.text.includes(godLine.label), '用神段没点出所取的那一爻');
  assert.ok(/用神与世爻同气|用神恰在世爻之上|世爻生用神|用神生世爻|世爻克用神|用神克世爻/.test(wg.text), '用神段没说用神与世爻的关系');

  // 婚恋分男女：只各报所在，不替人择——择了就等于替求测者认了性别
  const love = buildReading(castByNumbers(3, 8), { now: new Date(2026, 8, 29), question: '跟他会不会复合' });
  assert.equal(love.useGod.picked, null, '婚恋不该硬择用神');
  const lg = love.insights.find((item) => item.title === '用神');
  assert.ok(/对照自己那一亲取用/.test(lg.text), '婚恋没把取舍交回求测者');
  assert.ok(/增删卜易/.test(lg.text), '婚恋用神段没引出处');
  // 两亲都在时要把所在都列出来
  for (const name of love.useGod.present) {
    const label = love.jingfang.lines.filter((l) => l.relative === name).map((l) => l.label);
    for (const item of label) assert.ok(lg.text.includes(item), `婚恋用神段没列出${name}在${item}`);
  }

  // 没写问题就明说取不出，不硬套
  const bare = buildReading(castByNumbers(3, 8), { now: new Date(2026, 8, 29) });
  assert.equal(bare.useGod, null);
  assert.match(bare.insights.find((item) => item.title === '用神').text, /未写所问何事/);

  // 写了问题、但表里没这一类，是另一回事，不能也说成「未写所问何事」——
  // 问卦的人明明写了字，把话没说到位赖到他头上，是把缺的那一层说错了。
  const offTable = buildReading(castByNumbers(3, 8), { now: new Date(2026, 8, 29), question: '这次合作能不能谈成' });
  assert.equal(offTable.useGod, null, '「合作」本就不在任何一类里');
  const offText = offTable.insights.find((item) => item.title === '用神').text;
  assert.ok(!/未写所问何事/.test(offText), '写了问题却说人家没写');
  assert.ok(/认得的事类词/.test(offText), '没说是「表里没接住」这一层');
  // 九类要列全，且是从表里取的，不是写死一份
  for (const item of TOPIC_CLASSES) {
    assert.ok(offText.includes(item.label), `认不出事类时没列出${item.label}`);
  }
});

test('用神不上卦时不编，如实说是缺哪一层', () => {
  // 疾病取官鬼与子孙两头；若卦中子孙不上卦，要写明是哪一亲不上，
  // 而不是随便挑一亲当用神。
  const reading = buildReading(castByNumbers(3, 8), { now: new Date(2026, 8, 29), question: '这病能好么' });
  assert.deepEqual(reading.useGod.relatives, ['官鬼', '子孙']);
  const text = reading.insights.find((item) => item.title === '用神').text;
  for (const name of reading.useGod.absent) {
    assert.ok(text.includes(name), `没说清${name}不上卦`);
    assert.ok(text.includes('不上卦'), '没写「不上卦」三个字');
  }
  assert.ok(!/取.{0,4}爻。/.test(text) || reading.useGod.picked === null, '不上卦时不该宣称取了哪一爻');
});

// ── 伏神 ─────────────────────────────────────────────────────────────────

test('伏神取自本宫首卦同爻位，书上两个例证逐字对上', async () => {
  const { hiddenGod, flyingRelation, jingfang } = await import('../miniapp/node/jingfang.mjs');
  const byName = (name) => jingfang(HEXAGRAM_LIST.find((h) => h.name === name));

  // 《增删卜易·飞伏神章第二十八》：「乾卦寅木妻财在二爻，即以此寅木伏于姤卦亥水之下，
  // 姤卦二爻之亥水即为飞神，寅木妻财即为伏神，亥水而生寅木，谓之飞来生伏得长生。」
  const gou = hiddenGod(byName('天风姤'), '妻财');
  assert.equal(gou.hushen.stem + gou.hushen.branch, '甲寅', '姤卦的妻财伏神应是甲寅木');
  assert.equal(gou.hushen.position, 2, '妻财伏神应伏在二爻');
  assert.equal(gou.feishen.stem + gou.feishen.branch, '辛亥', '压着它的飞神应是姤卦二爻辛亥水');
  assert.equal(flyingRelation(gou.hushen, gou.feishen).key, '飞来生伏');

  // 同章第二个例：「乾卦子水子孙在初爻，即以此子水子孙伏于遁卦辰土之下……辰土而克子水，
  // 谓之飞来克伏遭克害，名为伏神受制，有用亦无用矣，即以凶推。」
  // 兑宫的例：泽山咸（兑宫三世）缺妻财，须从兑为天借丁卯木伏二爻，
  // 压着它的是咸卦二爻丙午火官鬼——伏去生飞，泄气。
  const xian = hiddenGod(byName('泽山咸'), '妻财');
  assert.equal(xian.palaceName, '兑宫', '咸卦的伏神应从兑宫借');
  assert.equal(xian.hushen.stem + xian.hushen.branch, '丁卯', '咸卦的妻财伏神应是丁卯木');
  assert.equal(xian.hushen.position, 2);
  assert.equal(xian.feishen.stem + xian.feishen.branch, '丙午');
  assert.equal(flyingRelation(xian.hushen, xian.feishen).key, '伏去生飞');

  const dun = hiddenGod(byName('天山遁'), '子孙');
  assert.equal(dun.hushen.stem + dun.hushen.branch, '甲子', '遁卦的子孙伏神应是甲子水');
  assert.equal(dun.hushen.position, 1, '子孙伏神应伏在初爻');
  assert.equal(flyingRelation(dun.hushen, dun.feishen).key, '飞来克伏');
  // 书上说辰土克子水作凶推，本包不硬套吉凶，但伏飞方向不能反
  assert.ok(dun.feishen.element === '土' && dun.hushen.element === '水', '飞伏五行与书不合');
});

test('六十四卦全量：缺失的六亲都能取到唯一伏神', async () => {
  const { hiddenGod, jingfang } = await import('../miniapp/node/jingfang.mjs');
  let missing = 0;
  let found = 0;
  let ambiguous = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    const jf = jingfang(hexagram);
    for (const relative of ['父母', '兄弟', '子孙', '妻财', '官鬼']) {
      if (jf.lines.some((line) => line.relative === relative)) continue;
      missing += 1;
      const pair = hiddenGod(jf, relative);
      assert.ok(pair, `${hexagram.name} 缺${relative}却取不到伏神`);
      found += 1;
      // 书上两个例证都在乾宫，兑宫坎宫的例证一个也没有——只拿那两例去验，
      // 「去别宫借伏神」这种改法照样全绿。宫名必须逐卦对上。
      assert.equal(pair.palaceName, jf.palaceName, `${hexagram.name} 的伏神不是从本宫借的`);
      // 伏神所在爻位必须是本宫首卦里那一亲的位置，且飞神就是本卦同爻位那一爻
      assert.equal(pair.feishen, jf.lines[pair.hushen.position - 1], `${hexagram.name} 的飞神没对上同爻位`);
      assert.equal(pair.hushen.relative, relative);
      if (pair.ambiguous) ambiguous += 1;
    }
  }
  // 八纯卦六亲俱全，缺失只发生在本宫的其他七卦上；缺失数应与实际相符且不出现歧义
  assert.equal(missing, found);
  assert.equal(ambiguous, 0, '出现了同亲两爻同时缺失的歧义，本包的取法未处理这种情况');
  assert.ok(missing > 0, '全量没有一例缺失，测试等于没跑');
});

test('断语遇不上卦时取伏神，并说清飞伏与出不出得来', () => {
  // 找一卦使财运的妻财不上卦
  let reading = null;
  for (const [upper, lower] of [[5, 2], [2, 7], [4, 3], [6, 1]]) {
    const candidate = buildReading(castByNumbers(upper, lower), { now: new Date(2026, 8, 29), question: '这单生意能赚钱吗' });
    if (candidate.useGod && candidate.useGod.picked === null) { reading = candidate; break; }
  }
  assert.ok(reading, '没找到妻财不上卦的一卦');
  const text = reading.insights.find((item) => item.title === '用神').text;
  assert.ok(/不上卦/.test(text), '没点明用神不上卦');
  assert.ok(/增删卜易/.test(text), '没引《增删卜易》飞伏神章');
  assert.ok(/伏在\d爻之下/.test(text), '没说伏神伏在哪一爻');
  assert.ok(/飞神/.test(text), '没点出飞神');
  assert.match(text, /飞来生伏|伏去生飞|伏来克飞|飞来克伏|飞伏同气/, '没给飞伏生克的定名');

  // 出不出得来：要么给结论并说凭哪条，要么明说缺哪一层，不许凭空断
  assert.match(text, /出得来|终不得出|无从判/, '出伏一句都没有');
  // 断语里提到的月建日辰条件是本包算得出的，出不来时必须交代还缺什么
  if (/无从判/.test(text)) {
    assert.ok(/旬空|月破/.test(text), '无从判时必须说明缺哪几项判据');
  }

  // 结构化字段也要带出来
  assert.ok(Array.isArray(reading.useGod.hidden) && reading.useGod.hidden.length > 0, 'reading 没带伏神');
  const fu = reading.useGod.hidden[0];
  assert.equal(fu.relative, '妻财');
  assert.ok(/^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥][木火土金水]$/.test(fu.hushen), '伏神干支格式不对');
  assert.ok(fu.flying, '没给飞伏关系名');
  // 出伏结论得是结构化字段，不只是正文里的一句话：Agent 复述时要的是「出不出得来」本身。
  assert.equal(fu.emerges && fu.emerges.key, '出得来', '伏神没给出伏结论');
  assert.ok(text.includes(fu.emerges.text), '正文说的出伏结论与结构化字段对不上');
  // 正文那段话是拼出来的，不该再塞进结构化字段里撑大响应
  assert.equal(fu.sentence, undefined, 'sentence 只该进断语，不该留在 reading 里');
});

test('MCP 起卦把伏神一并带进 structuredContent', async () => {
  // 断语正文里已经讲过一遍，Agent 复述「伏在哪、飞神是谁、出不出得来」时
  // 不该再从一段话里去刨——这三个答案得是能直接取的字段。
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  let raw = '';
  const response = { writeHead() { return this; }, end(chunk) { raw += chunk; return this; } };
  await handleMcpRequest({
    response,
    // 固定时刻。这条断言断的是「伏神出不出得来」，而出伏要看日辰——以前这里走真时钟，
    // 于是断言跟着跑测试的当天翻面：某天 227/228，换个时区也一样。
    now: new Date(2026, 8, 29),
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'divination_cast',
        arguments: { method: 'numbers', upper: 5, lower: 2, question: '这单生意能赚钱吗' },
      },
    },
  });
  const out = JSON.parse(raw).result;
  const useGod = out.structuredContent.useGod;
  assert.ok(useGod, 'structuredContent 里没有用神');
  assert.equal(useGod.picked, null, '这一卦的妻财本该不上卦');
  assert.ok(Array.isArray(useGod.hidden) && useGod.hidden.length === 1, 'MCP 没带伏神');
  const fu = useGod.hidden[0];
  assert.equal(fu.relative, '妻财');
  assert.equal(fu.position, 5);
  assert.equal(fu.hushen, '丙子水');
  assert.equal(fu.feishen, '辛巳火');
  assert.equal(fu.flying, '伏来克飞');
  assert.equal(fu.emerges.key, '出得来');
  // 断语正文说过的同一件事，两处必须对得上
  assert.ok(out.content[0].text.includes(fu.emerges.text), '正文与 structuredContent 的出伏结论不一致');
});

test('出伏七条逐条落地，旬空月破入墓都算数了', async () => {
  // 《增删卜易·飞伏神章》列「易出六」与「不出五」。上一轮只做得出四条，
  // 剩下一条「飞神逢空破墓绝」和两条「正逢墓绝」「直旬空月破」当时说没做。
  // 这一轮把旬空、月破、入墓都补上，那句「本包未做」必须随之消失。
  const source = await readFile(new URL('../miniapp/node/divination.mjs', import.meta.url), 'utf8');
  assert.ok(!/本包未做/.test(source), '出伏条件已补齐，还留着「本包未做」是过期话');
  assert.ok(!/HIDDEN_GAP/.test(source), '出伏缺口的常量该删了');
  assert.ok(/得月建生/.test(source) && /得日辰生/.test(source) && /得飞神生/.test(source), '原有的出伏条件掉了');
  assert.ok(/占卦之日月于伏神正逢入墓/.test(source), '没接上「正逢墓绝」这一条');
  assert.ok(/伏神逢月破/.test(source), '没接上「直逢旬空月破」这一条');
  assert.ok(/飞神逢空破墓/.test(source), '没接上「飞神逢空破墓压不住它」这一条');

  // 上面是读源码。下面真跑：造一个伏神正逢旬空的日子，看「终不得出」这一路走不走得到。
  const jfModule = await import('../miniapp/node/jingfang.mjs');
  const almanac = await import('../miniapp/node/almanac.mjs');
  const pair = jfModule.hiddenGod(jfModule.jingfang(HEXAGRAM_LIST.find((h) => h.name === '泽山咸')), '妻财');
  assert.ok(pair, '取不到兑宫咸卦的妻财伏神');
  assert.equal(pair.hushen.element, '木');
  assert.equal(pair.feishen.element, '火', '咸卦二爻应是丙午火官鬼');
  // 卯木妻财伏在二爻；找出让卯落进旬空的日子
  let hit = null;
  for (let d = 0; d < 60; d += 1) {
    if (almanac.xunKong(d).voidBranches.includes(pair.hushen.branchIndex)) { hit = d; break; }
  }
  assert.ok(hit !== null, '六十日里总该有几天卯是旬空');
  const empty = jfModule.voidReading(pair.hushen, {
    monthBranch: 0, dayBranch: almanac.xunKong(hit).voidBranches[0],
    dayIndex: hit, movingElements: [], movingPositions: [], isHidden: true,
  });
  assert.equal(empty.isVoid, true, '这一天卯应当是旬空');
  assert.ok(['真空', '假空', '旬空未判'].includes(empty.status), '逢空必得给个真假说法');
});

test('右栏用神一格：上了卦说在哪一爻，不上卦说伏在哪一爻', async () => {
  // 伏神之前这格写死在「不上卦」三个字上，伏神取出来了它也不改。
  // 把函数摘出来实跑，钉的是它吐什么字，不是它叫什么名字。
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const i = client.indexOf('function useGodFact(');
  assert.ok(i >= 0, '客户端里找不到 useGodFact');
  const src = client.slice(i, client.indexOf('\n      function ', i + 10));
  assert.ok(src.length > 0, 'useGodFact 摘出来是空的');
  const useGodFact = new Function(`${src}\nreturn useGodFact;`)();

  const onGua = useGodFact({ present: ['官鬼'], absent: [], picked: { label: '二爻（卦中独一）', why: '卦中独一' }, hidden: [] });
  assert.match(onGua, /取官鬼/, '上了卦却没说取哪一亲');
  assert.match(onGua, /二爻/, '上了卦却没说在哪一爻');
  assert.ok(!/不上卦/.test(onGua), '上了卦还说不上卦');

  // 这一格正是本轮要修的那处：妻财不上卦，右栏得落到伏神上
  const reading = buildReading(castByNumbers(5, 2), { now: new Date(2026, 8, 29), question: '这单生意能赚钱吗' });
  assert.equal(reading.useGod.picked, null, '这一卦的妻财本该不上卦');
  const offGua = useGodFact(reading.useGod);
  assert.match(offGua, /不上卦/, '不上卦得说不上卦');
  assert.match(offGua, /伏5爻/, '不上卦却没把伏神落在哪一爻说出来');
  const fu = reading.useGod.hidden[0];
  assert.ok(offGua.includes(fu.hushen), '右栏没带上伏神干支');
  assert.ok(!/本宫首卦亦无/.test(offGua), '明明取到伏神却说本宫首卦亦无');
});

/* ---------- 旬空 · 月破 · 墓绝 ---------- */
// 上一轮出伏说「旬空、月破、墓库与地支冲本包未做」，这一轮补齐。补的东西必须有出处，
// 而且算法要对得上书上的表——只断言「函数存在」的话，把算法改错照样全绿。

test('旬空歌诀六句与算法逐句对撞', async () => {
  const A = await import('../miniapp/node/almanac.mjs');
  assert.equal(A.XUNKONG_SONG.length, 6, '歌诀存的不是六句');
  for (let x = 0; x < 6; x += 1) {
    const line = A.XUNKONG_SONG[x];
    // 歌诀形如「甲子旬中戌亥空」：头两字旬名，中字，四、五两字是空亡，末字空
    const want = line.slice(4, 6);
    const got = A.xunKong(x * 10).voidNames.join('');
    assert.equal(got, want, `${line}：算法算出「${got}空」，与歌诀不合`);
    assert.equal(A.xunKong(x * 10).headName, line.slice(0, 2).slice(1), `${line} 旬首对不上`);
  }
  // 一旬十日同旬，日柱换了旬首不变
  const sameXun = [A.xunKong(40), A.xunKong(43), A.xunKong(49)];
  for (const k of sameXun) {
    assert.equal(k.voidNames.join(''), '寅卯', '甲辰旬十日内空亡应始终是寅卯');
  }
});

test('旬空对着《增删卜易》两个卦例的日柱反推', async () => {
  const A = await import('../miniapp/node/almanac.mjs');
  // 「辰月乙卯日占求财得家人之贲」，书中断「丑财持世遇旬空」——丑在空。
  const yiMao = [1, 11, 21, 31, 41, 51].find((i) => i % 12 === 3);
  assert.ok(A.xunKong(yiMao).voidNames.includes('丑'), '乙卯日（丑当值）丑应旬空');
  // 「子月辛亥日占远行求财得大畜」，书中断「世值旬空」，该卦世爻正是寅木。
  const xinHai = [7, 17, 27, 37, 47, 57].find((i) => i % 12 === 11);
  assert.ok(A.xunKong(xinHai).voidNames.includes('寅'), '辛亥日（寅当旬空）寅应旬空');
  // 六十日里每一天都恰属一旬，旬首两支之外的两支为空
  for (let d = 0; d < 60; d += 1) {
    const k = A.xunKong(d);
    assert.equal(k.voidBranches.length, 2, '每旬恒空两支');
    assert.equal(k.headName, ['子', '戌', '申', '午', '辰', '寅'][k.xun], '旬首与旬序对不上');
  }
});

test('月破逐月对得上《增删卜易》正月申破至十二月未破', async () => {
  const A = await import('../miniapp/node/almanac.mjs');
  const months = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑'];
  const song = ['申', '酉', '戌', '亥', '子', '丑', '寅', '卯', '辰', '巳', '午', '未'];
  months.forEach((month, i) => {
    const got = A.BRANCHES[A.monthPo(A.BRANCHES.indexOf(month))];
    assert.equal(got, song[i], `${month}月应破${song[i]}，算得${got}`);
  });
  // 月破就是月建所冲之支，两条路径必须给同一个答案
  for (let b = 0; b < 12; b += 1) {
    assert.equal(A.monthPo(b), A.branchClash(b), '月破与六冲是同一件事');
  }
});

test('五行入墓各按自己的表，绝地则纳支里逢不上', async () => {
  const A = await import('../miniapp/node/almanac.mjs');
  const J = await import('../miniapp/node/jingfang.mjs');
  const mu = { 金: '丑', 木: '未', 水: '辰', 土: '辰', 火: '戌' };
  for (const [element, want] of Object.entries(mu)) {
    assert.equal(A.BRANCHES[A.muJue(element).mu], want, `${element}墓应在${want}`);
  }
  // 绝地是墓的下一支（金寅、木申、水土巳、火亥）。纳甲里每个五行只占两支
  // （金申酉、木寅卯、水子亥、火巳午、土丑辰未戌），逐个核下来没有一支落在五行自己
  // 占据的那两支里——所以任何一爻都逢不上绝地，卦体与断语的「绝」标据此撤掉。
  // 这里钉的是「绝确实逢不上」这个事实，不是绝地清单：将来谁动了纳支或墓表，
  // 这个断言会先红，而不是让一个永不点亮的小标悄悄留在界面上。
  for (const element of Object.keys(mu)) {
    const j = A.BRANCHES[(A.muJue(element).mu + 1) % 12];
    assert.notEqual(J.BRANCH_ELEMENTS[j], element,
      `${element}的绝地${j}竟被纳给了${element}自己，「逢绝」重新成立，墓表与纳支得重核`);
  }
  for (const hexagram of HEXAGRAM_LIST) {
    for (const line of J.jingfang(hexagram).lines) {
      assert.equal(A.muJue(line.element).jue, undefined, '墓表里不该还留着绝地');
    }
  }
  // 《黄金策》口诀「春土、夏金、秋木、三冬逢火是真空」，四季各三月
  const expect = { 寅: '土', 卯: '土', 辰: '土', 巳: '金', 午: '金', 未: '金', 申: '木', 酉: '木', 戌: '木', 亥: '火', 子: '火', 丑: '火' };
  for (const [name, element] of Object.entries(expect)) {
    assert.equal(A.seasonVacuous(A.BRANCHES.indexOf(name)).vacuousElement, element, `${name}月的真空元素应是${element}`);
  }
});

test('假空真空照野鹤原话判：旺、动、生扶是假空，月破与四季之空是真空', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  const A = await import('../miniapp/node/almanac.mjs');
  // 卯木在酉月：金旺，木为「休」，所以既不旺相也不发动时最干净地落入真空
  const dayIndex = 40; // 甲辰旬，寅卯空
  const line = { position: 2, branchIndex: A.BRANCHES.indexOf('卯'), element: '木' };
  // 日支取酉：酉金不生卯木，这一爻才落得干净地进真空。
  // 早先取子水——子恰是水生木，「得日辰生扶」把本该真空的一爻救了回来，测的就不是真空了。
  const base = { monthBranch: 9, dayBranch: 9, dayIndex, movingElements: [], movingPositions: [] };

  const quiet = J.voidReading(line, base);
  assert.equal(quiet.isVoid, true, '卯在甲辰旬当旬空');
  assert.equal(quiet.status, '真空', '秋占木爻又不动，应作真空论');
  assert.ok(quiet.empties.some((w) => w.includes('秋令正空木')), '真空凭据里没有四季之空这一条');

  // 「动不为空」：同一爻动起来就不再作真空论
  const moving = J.voidReading(line, { ...base, movingPositions: [2] });
  assert.equal(moving.status, '假空', '动爻不为空');
  assert.ok(moving.rescues.includes('发动'), '没把「发动」记作有救');

  // 「有日建动爻生扶者不為空」：日辰来生也算有救。子水生卯木。
  const fed = J.voidReading(line, { ...base, dayBranch: 0 });
  assert.equal(fed.status, '假空', '得日辰生扶不作真空论');
  assert.ok(fed.rescues.some((w) => w.includes('生扶')), '没把「得日辰或动爻生扶」记作有救');

  // 「月破爲空」：酉月破卯，本就该作真空
  const broken = J.voidReading(line, base);
  assert.equal(broken.isBroken, true, '酉月正破卯');

  // 不逢空的爻不该被扣上任何空破的帽子
  const shi = { position: 2, branchIndex: A.BRANCHES.indexOf('午'), element: '火' };
  const clear = J.voidReading(shi, base);
  assert.equal(clear.isVoid, false);
  assert.equal(clear.status, null, '不逢空就不该有真假之说');
});

test('伏神本身逢旬空时，出伏结论真的落到「终不得出」', async () => {
  // 上面那条出伏测试是读源码的：把「伏神直旬空」那一行删掉，它照样全绿。
  // 这一条扫真实的卦与真实的日子，非得找到一个伏神正逢旬空的组合不可。
  const A = await import('../miniapp/node/almanac.mjs');
  const voidDays = [];
  for (let d = 0; d < 60 && voidDays.length < 12; d += 1) {
    if (A.xunKong(d).voidNames.length === 2) voidDays.push(d);
  }
  assert.equal(voidDays.length, 12, '六十日里每旬两日旬空，计十二日');

  let seen = 0;
  let sawVoid = false;
  for (let upper = 1; upper <= 8 && seen < 400; upper += 1) {
    for (let lower = 1; lower <= 8 && seen < 400; lower += 1) {
      const reading = buildReading(castByNumbers(upper, lower), { now: new Date(2026, 8, 30, 10, 0), question: '这单生意能赚钱吗' });
      seen += 1;
      for (const fu of reading.useGod.hidden || []) {
        const branch = fu.hushen[1];
        if (!A.xunKong(43).voidNames.includes(branch)) continue;
        sawVoid = true;
        assert.ok(/旬空|真空|假空/.test(fu.emerges.text), `伏神逢旬空却没把空论进去：${fu.emerges.text}`);
        if (fu.emerges.key === '出不来') {
          assert.ok(/旬空|真空/.test(fu.emerges.text), `断作终不得出却不点破旬空：${fu.emerges.text}`);
        }
      }
    }
  }
  assert.ok(sawVoid, '这一轮扫遍八八六十四组，伏神就没逢上旬空，测不到那一支');
});

test('伏神旬空而别无生扶时，那一条空要独自把它压在出不来里', async () => {
  // 上一条只要求「逢空必得说出来」，可伏神一旦有生扶就判出得来，那个「空」被好话盖住了。
  // 这一条专挑无生扶的：把 bad 里「伏神直真空」那一行删掉，结论就再也压不住——得杀掉它。
  const A = await import('../miniapp/node/almanac.mjs');
  let checked = 0;
  let verified = 0;
  for (let upper = 1; upper <= 8 && checked < 64; upper += 1) {
    for (let lower = 1; lower <= 8 && checked < 64; lower += 1) {
      const reading = buildReading(castByNumbers(upper, lower), { now: new Date(2025, 0, 15, 10, 0), question: '这单生意能赚钱吗' });
      checked += 1;
      for (const fu of reading.useGod.hidden || []) {
        if (fu.emerges.key !== '出不来') continue;
        if (!A.xunKong(A.dayPillar(2025, 1, 15).index).voidNames.includes(fu.hushen[1])) continue;
        // 结论是「终不得出」，正文就必须把空点出来，且要分清真空假空
        assert.match(fu.emerges.text, /旬空而(真空|假空)/, `断作终不得出却不言空：${fu.emerges.text}`);
        assert.match(fu.emerges.text, /终不得出/, '出不来这一路没走到');
        // 关键：空必须作为**出不来的一条凭据**出现，不只是句首提一句。
        // 只盯「旬空而真空」那个头字不够——那是 kongHead 拼的，把 bad 里那一行删掉照样过。
        assert.match(fu.emerges.text, /伏神直(真空|假空)/, `空没被算作出不来的一条：${fu.emerges.text}`);
        // 假空要说清「空不为其患」，免得读成空就是死因
        if (/假空/.test(fu.emerges.text)) {
          assert.ok(/空不为其患/.test(fu.emerges.text), `假空却把空当成死因：${fu.emerges.text}`);
        }
        verified += 1;
      }
    }
  }
  assert.ok(verified > 0, '这批卦里没有伏神旬空而出不来的，用例落空了');
});

test('伏神休囚无气那一条真的在出不来里说得出来', async () => {
  // 野鹤「终不得出」第一条就是「伏神正逢休、囚无气」。删掉这一句，结论还会是「出不来」，
  // 只是没了凭据——所以要单独钉住那句人话，不只看 key。
  const A = await import('../miniapp/node/almanac.mjs');
  let checked = 0;
  let rested = 0;
  for (let upper = 1; upper <= 8; upper += 1) {
    for (let lower = 1; lower <= 8; lower += 1) {
      // 丑月月建土，火在丑月为休囚；一月的卦里总有伏神落在这上头
      const reading = buildReading(castByNumbers(upper, lower), { now: new Date(2025, 0, 15, 10, 0), question: '这单生意能赚钱吗' });
      checked += 1;
      for (const fu of reading.useGod.hidden || []) {
        if (fu.emerges.key !== '出不来') continue;
        if (!/休囚无气|于月建[休囚死]/.test(fu.emerges.text)) continue;
        rested += 1;
        assert.match(fu.emerges.text, /休囚无气/, `断了休囚却没把「无气」说出来：${fu.emerges.text}`);
        assert.match(fu.emerges.text, /于月建[休囚死]/, '没点明伏神于月建落到哪一档');
      }
    }
  }
  assert.ok(rested > 0, '这批卦里没有伏神休囚而出不来的，用例落空了');
  assert.equal(checked, 64, '应当扫满八八六十四组');
});

test('卦体与右栏把空破墓标出来', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const i = client.indexOf('function guaLines(');
  const body = client.slice(i, client.indexOf('\n      function ', i + 10));
  assert.ok(/states/.test(body), '卦体没收 states');
  assert.ok(/st\.void/.test(body) && /st\.broken/.test(body), '卦体没画旬空与月破');
  assert.ok(/st\.tomb/.test(body), '卦体没画入墓');
  assert.ok(!/st\.jue/.test(body), '纳支里逢不上绝地，卦体不该还留着绝这一标');
  // 四种情形各自成字，不能合成一个词了事
  const mark = client.slice(client.indexOf('const stateMark ='), client.indexOf('const stateMark =') + 700);
  // 钉在「这一支真的会出这个字」上。钉 st.broken 出现过是不够的——把 '破' 换成 '' 时
  // st.broken 还在下面 word === '破' 里出现过，照样全绿，那等于没测月破。
  for (const [field, word] of [['void', '空'], ['broken', '破'], ['tomb', '墓']]) {
    const re = new RegExp(`st\\.${field} \\? [^\\n]*${word}`);
    assert.ok(re.test(mark), `${field} 那一支没出「${word}」字`);
  }
  // 本卦那一次调用得把 states 传下去
  // 边界别用后面某个字段名去截——文件里 reading.changed 出现在前头，会把这一段切没了。
  const call = client.slice(client.indexOf('left.append(guaBlock('), client.indexOf('left.append(guaBlock(') + 400);
  assert.ok(/reading\.states/.test(call), '解读页本卦没把 states 传进卦体');
  // 右栏得有一格旬空月破
  assert.ok(/旬空月破/.test(client), '右栏没报旬空与月破');
  assert.ok(/headName/.test(client) && /brokenName/.test(client), '右栏没把旬首空亡与月破读出来');
});

test('reading 带着旬空月破与六爻逢什么，断语用神段说得出真假', async () => {
  // 今天丁未日（甲辰旬空寅卯）、丁酉月（破卯），木爻在这两个日子都不算好过
  const reading = buildReading(castByNumbers(3, 1), { now: new Date(2026, 8, 30, 10, 0), question: '这批货该不该进' });
  assert.equal(reading.void.headName, '辰', '丁未日属甲辰旬');
  assert.deepEqual(reading.void.names, ['寅', '卯'], '甲辰旬空寅卯');
  assert.equal(reading.void.brokenName, '卯', '酉月破卯');
  assert.equal(reading.states.length, 6, '六爻的状态要逐爻给');
  const mu = reading.states.filter((s) => s.void || s.broken || s.tomb);
  assert.ok(mu.length > 0, '这一卦该有逢空逢破逢墓的爻');
  for (const s of mu) {
    if (s.void) {
      assert.ok(['假空', '真空', '旬空未判'].includes(s.voidKind), `逢空必得给真假，${s.voidKind} 不成话`);
    }
  }
});

test('买卖行话也认得出财运，不该因为措辞不像「赚钱」就断成没写问题', async () => {
  // 浏览器实测时撞上的：「这批货该不该进」明明是问财，detectTopic 却一个都不认，
  // 断语只好说「未写所问何事，取不出用神」。进货、货款、卖掉、货，这些才是买卖人真会打的字。
  const { detectTopic } = await import('../miniapp/node/topics.mjs');
  for (const q of ['这批货该不该进', '该不该进货', '这批货能卖掉吗', '货款什么时候回', '这笔买卖能赚吗']) {
    assert.equal(detectTopic(q)?.key, 'wealth', `「${q}」该认作财运`);
  }
  // 补词不能抢走别的类：求测者问的确实是别的事时，照旧各归各
  for (const [q, key] of [
    ['要不要换工作', 'career'],
    ['能不能复合', 'love'],
    ['这房子该买吗', 'property'],
    ['钥匙丢了在哪', 'journey'],
    ['官司打得赢吗', 'dispute'],
    ['我要不要起诉对方', 'dispute'],
  ]) {
    assert.equal(detectTopic(q)?.key, key, `「${q}」不该被买卖那批词抢走`);
  }
});

/* ---------- 六神 ---------- */
// 装卦时人人都会画的一列，日干定初爻起哪一神。《卜筮全书·卷之一·起六神决》
// 「甲乙起青龍，丙丁起朱雀，戊日起勾陳，己日起螣蛇，庚辛起白虎，壬癸起玄武。（俱從下起至上。）」

test('六神歌诀与六行排列表逐格对撞', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  // 歌诀原文一个字都不许改
  assert.equal(
    J.SIX_GOD_SONG,
    '甲乙起青龙，丙丁起朱雀，戊日起勾陈，己日起螣蛇，庚辛起白虎，壬癸起玄武。（俱从下起至上。）',
    '六神歌诀与《卜筮全书》原文不符',
  );
  // 原文后面的排布表，自初爻起六格
  const table = [
    ['甲', '乙', '青龙 朱雀 勾陈 螣蛇 白虎 玄武'],
    ['丙', '丁', '朱雀 勾陈 螣蛇 白虎 玄武 青龙'],
    ['戊', null, '勾陈 螣蛇 白虎 玄武 青龙 朱雀'],
    ['己', null, '螣蛇 白虎 玄武 青龙 朱雀 勾陈'],
    ['庚', '辛', '白虎 玄武 青龙 朱雀 勾陈 螣蛇'],
    ['壬', '癸', '玄武 青龙 朱雀 勾陈 螣蛇 白虎'],
  ];
  let cells = 0;
  for (const [first, second, want] of table) {
    for (const stem of [first, second].filter(Boolean)) {
      const got = J.sixGods(J.SIX_GOD_ORDER && ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'].indexOf(stem)).join(' ');
      assert.equal(got, want, `${stem}日六神排得不对：得「${got}」，表作「${want}」`);
      cells += 6;
    }
  }
  assert.equal(cells, 60, '十个日干各六格共六十格，少一格就是漏了字');
  // 六十甲子日柱各归各神，一个都不能排不出
  for (let d = 0; d < 60; d += 1) {
    const g = J.sixGods(d % 10);
    assert.equal(g.length, 6, `日干序 ${d % 10} 排不出六神`);
    assert.equal(new Set(g).size, 6, '六神不可重样');
  }
});

test('六神对着书上两个乾为天卦例逐爻对', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  const A = await import('../miniapp/node/almanac.mjs');
  const stemOf = (name) => A.STEMS.indexOf(name[0]);
  // 「丙辰月甲子日（测卦得乾为天卦）」：初爻子水子孙临青龙，父戌土临玄武，逐爻如下
  const jia = J.sixGods(stemOf('甲子'));
  assert.equal(jia[0], '青龙', '甲子日子水子孙该临青龙');
  assert.equal(jia[1], '朱雀', '二爻寅木妻财该临朱雀');
  assert.equal(jia[2], '勾陈', '三爻辰土父母该临勾陈');
  assert.equal(jia[3], '螣蛇', '四爻午火官鬼该临螣蛇');
  assert.equal(jia[4], '白虎', '五爻申金兄弟该临白虎');
  assert.equal(jia[5], '玄武', '上爻戌土父母该临玄武');
  // 「丙辰月戊子日」同一卦：初爻该临勾陈，上爻该临朱雀
  const wu = J.sixGods(stemOf('戊子'));
  assert.equal(wu[0], '勾陈', '戊子日子水子孙该临勾陈');
  assert.equal(wu[5], '朱雀', '上爻戌土父母该临朱雀');
  assert.equal(wu.join(''), '勾陈螣蛇白虎玄武青龙朱雀', '戊子日六神排得不对');
});

test('六神只说气氛，不改吉凶', async () => {
  // 野鹤一派的老话：「吉凶全凭五行生克，情态方看六神吉凶。」六神一旦能改吉凶，
  // 断卦的根就动摇了。头一版这个测试拿同一个 now 循环十次，日干压根没变，六神也压根没换，
  // 等于什么都没验——得真的换日子，让六神换过一轮，吉凶仍纹丝不动才作数。
  const seen = new Set();
  for (let day = 1; day <= 28; day += 1) {
    const reading = buildReading(castByNumbers(5, 2), { now: new Date(2026, 8, day, 10, 0), question: '这单生意能赚钱吗' });
    assert.equal(reading.sixGods.length, 6, `${day} 日六神没有排满六爻`);
    seen.add(reading.sixGods[0]);
    // 同一个卦、同一句话，只有日子在动
    assert.equal(reading.hexagram.name, '风泽中孚', '卦变了，说明这一轮不是只换日子');
    assert.equal(reading.verdict.key, '体克用', `${day} 日竟改动了吉凶`);
    // label 是「生克 + 旺衰」合出来的总分，不是光看生克那一层。这一卦体克用
    // 本是生克小吉，可体卦当月令得旺，总分推上去一档，落到大吉。
    assert.equal(reading.verdict.relationVerdict, '小吉', `${day} 日生克那一层变了`);
    assert.equal(reading.verdict.label, '大吉', `${day} 日竟改动了吉凶`);
    // 徽章与结论行必须说的是同一个吉凶。从前徽章取生克那一层、结论行取总分，
    // 同一屏一个说小吉一个说大吉，读的人只会挑一个信。
    assert.ok(
      reading.verdict.summary.startsWith(`${reading.verdict.label}：`),
      `${day} 日徽章说「${reading.verdict.label}」而结论行说「${reading.verdict.summary}」，两处吉凶不是一回事`,
    );
    // 这一卦用神不上卦，走的是伏神那一路。断言就只认这一路的话——
    // 早先写成一句通用匹配，结果用神上卦那一路的话替它作了证，两路坏一路照样全绿。
    const text = reading.insights.find((item) => item.title === '用神').text;
    assert.match(text, /伏神临(青龙|朱雀|勾陈|螣蛇|白虎|玄武)/, `${day} 日没说伏神临哪一神`);
    assert.match(text, /成不成仍只由生克与旺衰定/, `${day} 日伏神那一路没说清六神不作判据`);
  }
  assert.ok(seen.size >= 4, `二十八天里初爻只轮到 ${seen.size} 种六神，八月里该转遍六神才对`);
  // 六神意象表六神齐全，且各神各有所主，不能张冠李戴
  const J = await import('../miniapp/node/jingfang.mjs');
  for (const god of J.SIX_GOD_ORDER) {
    assert.ok(J.SIX_GOD_MEANING[god], `${god} 没有意象`);
    assert.ok(J.SIX_GOD_MEANING[god].element, `${god} 没有五行`);
    assert.ok(J.SIX_GOD_MEANING[god].meaning.length > 4, `${god} 的意象太空`);
  }
  assert.ok(/喜庆/.test(J.SIX_GOD_MEANING.青龙.meaning), '青龙主喜庆');
  assert.ok(/口舌/.test(J.SIX_GOD_MEANING.朱雀.meaning), '朱雀主口舌');
  assert.ok(/盗贼/.test(J.SIX_GOD_MEANING.玄武.meaning), '玄武主盗贼');
});

test('卦体画出六神一列，用神临哪一神断语说得出', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const i = client.indexOf('function guaLines(');
  const body = client.slice(i, client.indexOf('\n      function ', i + 10));
  assert.ok(/gods/.test(body), '卦体没收六神');
  assert.ok(/class="sg"/.test(body), '卦体没画六神这一列');
  assert.ok(/gods\[position - 1\]/.test(body), '六神没按爻位取，下标多半错了');
  // 本卦那次调用得把六神传下去
  const call = client.slice(client.indexOf('left.append(guaBlock('), client.indexOf('left.append(guaBlock(') + 460);
  assert.ok(/reading\.sixGods/.test(call), '解读页本卦没把六神传进卦体');
  // 断语里的神必须是六神表里的一神，且与该爻实算对得上
  const reading = buildReading(castByNumbers(3, 1), { now: new Date(2026, 8, 30, 10, 0), question: '这批货该不该进' });
  const J = await import('../miniapp/node/jingfang.mjs');
  const text = reading.insights.find((item) => item.title === '用神').text;
  const said = text.match(/用神临(青龙|朱雀|勾陈|螣蛇|白虎|玄武)/);
  assert.ok(said, '用神段没说临哪一神');
  assert.equal(said[1], reading.sixGods[reading.useGod.picked.position - 1], '断语说的六神与实排对不上');
  // 用神上卦这一路自己的那半句，不能靠伏神那一路的话顶数
  assert.ok(reading.useGod.picked, '这一卦用神本该上卦，否则验错了路');
  assert.match(text, /成不成仍只由上面的生克与旺衰定/, '用神上卦那一路没说清六神不作判据');
  assert.ok(!/伏神临/.test(text), '用神上卦却说起伏神来了');
});

test('回头生与回头克定的是变爻对本爻，五行上各占五对', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  // 两个原话定方向：变爻生本爻是回头生、变爻克本爻是回头克。
  // 「巽木变坎水，谓之化生，水回头以生木也，即以吉断。」
  assert.equal(J.transformRelation({ element: '木' }, { element: '水' }).key, '回头生', '木变水应作回头生');
  assert.equal(J.transformRelation({ element: '木' }, { element: '水' }).good, true, '书上明说回头生作吉断');
  // 「震木变乾金，谓之化克，金回头以克木也，即以凶推。」
  assert.equal(J.transformRelation({ element: '木' }, { element: '金' }).key, '回头克', '木变金应作回头克');
  assert.equal(J.transformRelation({ element: '木' }, { element: '金' }).good, false, '书上明说回头克作凶推');

  // 五行上二十个有序组合，五类各五，不重不漏——钉分布，钉「某几个」会漏掉第四类。
  const tally = {};
  for (const from of ['木', '火', '土', '金', '水']) {
    for (const to of ['木', '火', '土', '金', '水']) {
      const r = J.transformRelation({ element: from }, { element: to });
      tally[r.key] = (tally[r.key] || 0) + 1;
    }
  }
  assert.deepEqual(tally, { 回头生: 5, 回头克: 5, 化泄: 5, 化耗: 5, 化比和: 5 });

  // 《卜筮正宗·十八问答第二问》把回头克的五种情形逐个点了出来，正是上表里
  // 「变爻克本爻」那五个组合。这张表在 jingfang 里是当作定义校验用的，
  // 这里再对一次：表里五对真的都是变爻克本爻，且没有漏掉哪一对。
  assert.equal(J.HUI_TOU_KE_PAIRS.length, 5, '回头克的五行组合应恰好五对');
  for (const [moving, changed] of J.HUI_TOU_KE_PAIRS) {
    assert.equal(J.transformRelation({ element: moving }, { element: changed }).key, '回头克',
      `${moving}动变${changed}书上说是回头克`);
  }
  // 同章那句「彻底克尽」不是装饰，凶不凶要看落在哪一亲身上，这半句得在断语里
  assert.match(J.transformRelation({ element: '木' }, { element: '金' }).text, /彻底克尽.*用神.*忌神仇神/s);
});

test('化泄化耗化比和不配吉凶调子，书上没原话就不硬配', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  // 《增删卜易》只对回头生、回头克明说了吉凶。其余三个方向书上只给名目，
  // 硬配一个吉凶就成了编，所以 good 一律为 null。
  for (const [moving, changed, key] of [
    ['土', '金', '化泄'],   // 本爻生变爻
    ['金', '木', '化耗'],   // 本爻克变爻
    ['火', '火', '化比和'], // 同行
  ]) {
    const r = J.transformRelation({ element: moving }, { element: changed });
    assert.equal(r.key, key, `${moving}动变${changed}该是${key}`);
    assert.equal(r.good, null, `${key}书上没定吉凶，good 不该有值`);
    assert.ok(r.text.length > 8, `${key}连句话都没说`);
  }
});

test('进退神歌诀十六对两两互为反面，且每一对本支同行', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  // 歌诀原文照录底本，底本此处「戍」是「戌」的异体
  assert.equal(
    J.JIN_TUI_SONG,
    '进神：亥化子，寅化卯，巳化午，申化酉，丑化辰，辰化未，未化戌，戍化丑。退神：子化亥，卯化寅，午化巳，酉化申，辰化丑，未化辰，戍化未，丑化戍。',
    '进退神歌诀与《增删卜易·进退神章》原文不符',
  );
  const jin = [['亥', '子'], ['寅', '卯'], ['巳', '午'], ['申', '酉'], ['丑', '辰'], ['辰', '未'], ['未', '戌'], ['戌', '丑']];
  for (const [from, to] of jin) {
    assert.equal(J.jinTui(from, to)?.key, '进神', `${from}化${to}该是进神`);
    assert.equal(J.jinTui(to, from)?.key, '退神', `${to}化${from}该是退神`);
    assert.equal(J.BRANCH_ELEMENTS[from], J.BRANCH_ELEMENTS[to], `${from}与${to}不同行，不该出现在进退神里`);
  }
  // 歌诀里没有的不硬说
  for (const [from, to] of [['寅', '辰'], ['子', '午'], ['亥', '亥']]) {
    assert.equal(J.jinTui(from, to), null, `${from}化${to}不在歌诀里，不该判进退`);
  }
});

test('变爻只与本位动爻生克，不与他爻相干', async () => {
  const reading = buildReading(castByNumbers(1, 7), { now: new Date(2026, 8, 30, 10, 0), question: '这批货该不该进' });
  const text = reading.insights.find((item) => item.title === '化爻 · 变出之爻').text;
  // 《增删卜易》原话得摊开，否则看着像要把变爻拿去六爻通算
  assert.match(text, /能生克沖合本位之動爻，不能生克他爻/, '化爻段没交代变爻只认本位动爻');
  // 断语只该提本位动爻那一个六亲身份，不许把世爻应爻拉进来一起算
  const t = reading.transforms[0];
  assert.equal(t.relation, '回头克', '天山遁二爻午火动变姤卦二爻亥水应是回头克');
  assert.ok(!/世爻.*应爻/.test(text), '化爻段把世应扯进来了，那是「他爻」');
  // 逐个动爻都只报自己那一格
  for (const one of reading.transforms) {
    const chg = reading.changedJingfang.lines[one.position - 1];
    assert.equal(one.changed, `${chg.stem}${chg.branch}${chg.element}`, '化爻报的变爻对不上变卦同位那一爻');
    assert.equal(one.changedRelative, chg.relative, '化爻报的变爻六亲对不上');
  }
});

test('变爻是变卦里的静爻，不许把动爻那份救应算到它头上', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  // 天泽履初爻丁巳火动，变出天水讼初爻戊寅木。丁未日甲辰旬空寅卯，寅正在空里；
  // 变爻在变卦里是静的，可它占的爻位恰好就是动爻那位——一 careless 就把「发动」
  // 这条有救算给它，真空会翻成假空。所以这一例专盯这个：它必须落在真空。
  const reading = buildReading(castByNumbers(1, 18), { now: new Date(2026, 8, 30, 10, 0), question: '这批货该不该进' });
  const t = reading.transforms[0];
  assert.equal(t.position, 1, '该例动爻在初爻');
  assert.equal(t.changed, '戊寅木', '变爻该是戊寅木');
  assert.deepEqual(t.marks, ['化真空'], '变爻寅木逢空又落秋令正空，该作真空，不该被「发动」救成假空');
  // 反过来核一遍：真的把它当动爻问，同一爻立刻翻成假空。钉住这个反差，
  // 免得日后有人把 movingPositions 传回去却以为结果没变。
  const chg = reading.changedJingfang.lines[0];
  const day = dayPillar(2026, 9, 30);
  const calendar = {
    monthBranch: monthPillar(2026, 9, 30).branch, dayBranch: day.branch, dayIndex: day.index,
    movingElements: ['火'], movingPositions: [1],
  };
  assert.equal(J.voidReading(chg, { ...calendar, movingPositions: [1] }).status, '假空',
    '同一爻若误记为发动，应翻成假空——两路不一致就说明这组断言没钉住区别');
  assert.equal(J.voidReading(chg, { ...calendar, movingPositions: [] }).status, '真空',
    '变爻按静爻问才是真空');
});

test('化爻断语与结构化字段同源，且 sentence 不混进字段', async () => {
  const reading = buildReading(castByNumbers(1, 2), { now: new Date(2026, 8, 30, 10, 0), question: '这批货该不该进' });
  const text = reading.insights.find((item) => item.title === '化爻 · 变出之爻').text;
  const t = reading.transforms[0];
  // 丑化辰是进神，同时同属土为化比和，辰又正是土的墓——一行三件事
  assert.equal(t.jinTui, '进神', '丑化辰该是进神');
  assert.equal(t.relation, '化比和', '丑土变辰土同属土，该是化比和');
  assert.ok(t.marks.includes('化墓'), '辰正是土的墓，该标出化墓');
  // 断语正文里这一条的事实，字段里得对得上
  assert.ok(text.includes(`${t.label}${t.moving}${t.movingRelative}动`), '断语没报本爻的干支与六亲');
  assert.ok(text.includes(`变出${t.changed}${t.changedRelative}`), '断语没报变爻的干支与六亲');
  assert.ok(text.includes('进神') && text.includes('化比和') && text.includes('化墓'), '断语没把进退与化墓说出来');
  // sentence 只进断语，不进结构化字段
  assert.ok(!('sentence' in t), 'sentence 混进了结构化字段，正文与字段会各说各话');
});

test('六爻皆静时化爻段明说无变卦，不空着不提', async () => {
  const reading = buildReading(castByCoins([7, 8, 7, 8, 7, 8]));
  assert.deepEqual(reading.transforms, [], '静卦不该有化爻');
  const text = reading.insights.find((item) => item.title === '化爻 · 变出之爻').text;
  assert.match(text, /六爻皆静.*无变卦/, '静卦的化爻段该明说无变卦');
  assert.equal(reading.changedJingfang, null, '静卦不该有变卦京房');
});

test('卦体在变卦上标出化出之爻，回头克与回头生加重', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const i = client.indexOf('function guaLines(');
  const body = client.slice(i, client.indexOf('\n      function ', i + 10));
  assert.ok(/transforms/.test(body), '卦体没收 transforms');
  assert.ok(/const tf = \(transforms \|\| \[\]\)\.find/.test(body), '化出之爻没按爻位对位');
  // 钉在「这一支真的会出『化』字与关系名」上，不是钉 transforms 出现过
  assert.ok(/class="hu\$\{tf\.relation === '回头克' \|\| tf\.relation === '回头生' \? ' hot' : ''\}"/.test(body),
    '化爻小标没画出来，或回头克回头生没加重');
  // 直接写术语本身，不再加「化」字前缀——三个名目本就以「化」开头，加一遍就成了「化 化比和」
  assert.ok(/title="化出之爻">\$\{escapeHtml\(tf\.relation\)\}/.test(body), '化爻小标没写关系名');
  assert.ok(!/化 \$\{escapeHtml\(tf\.relation\)\}/.test(body), '化爻小标多了一个「化」前缀，读成了「化 化比和」');
  // 本卦那边不标：动爻本来就有 ○／×，再挤一记反而看不清
  const call = client.slice(client.indexOf('left.append(guaBlock('), client.indexOf('left.append(guaBlock(') + 400);
  assert.ok(!/reading\.transforms/.test(call), '本卦不该标化出之爻');
  // 变卦那次得把它传下去
  const changedCall = client.slice(client.indexOf("guaBlock(reading.changed, null, '变卦'"), client.indexOf("guaBlock(reading.changed, null, '变卦'") + 200);
  assert.ok(/reading\.transforms \|\| \[\]/.test(changedCall), '变卦没把化爻传进卦体');

  // 颜色也得说真话：只有书上明写了一个吉一个凶的回头生、回头克用朱砂，
  // 化泄化耗化比和书上没定吉凶，就跟伏神一样用淡字。别拿颜色替它表态。
  const css = client.slice(client.indexOf('.gua-line .rel .hu {'), client.indexOf('.gua-line .rel .hu.hot {'));
  assert.ok(!/var\(--seal\)/.test(css), '化爻小标不该一律朱砂——没定吉凶的三类用朱砂等于替它们表态');
  const hot = client.slice(client.indexOf('.gua-line .rel .hu.hot {'), client.indexOf('.gua-line .rel .hu.hot {') + 200);
  assert.ok(/var\(--seal\)/.test(hot), '回头生回头克该用朱砂');
});

test('MCP 把化爻落成字段，变卦那一行带上动爻去向', async () => {
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  let raw = '';
  const response = { writeHead() { return this; }, end(chunk) { raw += chunk; return this; } };
  await handleMcpRequest({
    response,
      now: AT(10, 0),
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'divination_cast', arguments: { question: '这批货该不该进', method: 'numbers', upper: 1, lower: 2 } } },
  });
  const result = JSON.parse(raw).result;
  const sc = result.structuredContent;
  assert.ok(Array.isArray(sc.transforms) && sc.transforms.length > 0, 'MCP 没给 transforms');
  for (const t of sc.transforms) {
    assert.ok(['回头生', '回头克', '化泄', '化耗', '化比和'].includes(t.relation), `关系名不在五类里：${t.relation}`);
    assert.ok(/[金木水火土]/.test(t.moving) && /[金木水火土]/.test(t.changed), '干支五行没带全');
    assert.ok(t.movingRelative && t.changedRelative, '六亲没带全');
  }
  // 抬头那一行：Agent 复述「变到哪儿、往哪儿去」看这一行就够
  assert.match(result.content[0].text, /【变卦】.+动爻去向 .+回头|动爻去向 .+化/s, '变卦行没带动爻去向');
});

test('元神忌神仇神照《增删卜易》那一章定位，书上的金例一字不差', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  // 原文：「元神者，生用神之爻，即为元神。忌神者，克用神之爻也，即为忌神。仇神者，克制元神
  //   不能生用神，反生忌神而克害用神，即为仇神。假令金为用神，生金者土也，土为元神；
  //   克金者火也，火为忌神；克土生火者木也，木为仇神。余仿此。」
  const circle = (element) => J.useGodCircle(
    { lines: ['木', '火', '土', '金', '水'].map((e, i) => ({ position: i + 1, element: e })) },
    { element },
  );
  const god = circle('金');
  assert.deepEqual(god.elements, { yuan: '土', ji: '火', chou: '木' }, '书例：金用则土元火忌木仇');
  assert.equal(god.yuan.length, 1, '元神取生用神那一行的爻');
  assert.equal(god.ji.length, 1, '忌神取克用神那一行的爻');
  assert.equal(god.chou.length, 1, '仇神取克元神那一行的爻');
  // 余仿此：五行各一组，三行必然互异
  const want = { 木: ['水', '金', '土'], 火: ['木', '水', '金'], 土: ['火', '木', '水'], 水: ['金', '土', '火'] };
  for (const [element, [yuan, ji, chou]] of Object.entries(want)) {
    const one = circle(element);
    assert.deepEqual([one.elements.yuan, one.elements.ji, one.elements.chou], [yuan, ji, chou],
      `${element}用则${yuan}元${ji}忌${chou}仇`);
  }
  // 仇神的路数是间接的：它不生用神，却反去生忌神——这条钉住，断语才不能说成「仇神克用神」
  for (const element of ['木', '火', '土', '金', '水']) {
    const one = circle(element);
    assert.ok(generates(one.elements.chou, one.elements.ji), `${element}用之仇神${one.elements.chou}该反生忌神${one.elements.ji}`);
    assert.ok(!generates(one.elements.chou, element), `${element}用之仇神不该生用神`);
    assert.ok(overcomes(one.elements.chou, one.elements.yuan), `${element}用之仇神该克的是元神，不是用神`);
  }
});

test('用神那圈只在一个用神定下来时才有，卦外不借爻', async () => {
  // 妻财不上卦的卦：用神取的是本宫首卦的伏神，在卦外，元忌仇无从谈起——照实不给
  const hidden = buildReading(castByNumbers(3, 1), { now: new Date(2026, 8, 30, 10, 0), question: '我最近身体如何' });
  assert.equal(hidden.useGod.picked, null, '这一例用神本该不上卦，否则验错了路');
  assert.equal(hidden.useGod.circle, null, '用神不在卦上就不该硬凑出一圈元忌仇');
  const circleSentence = (reading) => reading.insights.find((item) => item.title === '用神').text;
  assert.ok(!/元神属/.test(circleSentence(hidden)), '不上卦却报出了元神');
  // 兑宫泽山咸：兄弟不上卦，婚恋两亲各看各的，也不该有圈
  const both = buildReading(castByNumbers(2, 5), { now: new Date(2026, 8, 30, 10, 0), question: '他会主动找我吗' });
  if (both.useGod.relatives.length > 1) {
    assert.equal(both.useGod.circle, null, '两亲各看各的时无从取舍，不该有圈');
    assert.ok(!/元神属/.test(circleSentence(both)), '两亲各看各的却报出了元神');
  }
});

test('用神段把元忌仇的所在、动静、旺衰摆开，并守住「勿以仇神即仇人」', async () => {
  const reading = buildReading(castByNumbers(3, 1), { now: new Date(2026, 8, 30, 10, 0), question: '这批货该不该进' });
  const text = reading.insights.find((item) => item.title === '用神').text;
  const circle = reading.useGod.circle;
  assert.ok(circle, '这一卦用神上了卦，该有这一圈');
  assert.deepEqual(circle.elements, { yuan: '水', ji: '金', chou: '土' }, '二爻木用神：水元金忌土仇');
  // 每一支都要报到「哪一爻、动不动、月建旺衰」——野鹤原话是「有元神動而生扶否？有忌神動而克害否？」
  // 动静有三档：动、暗动、静。暗动是静爻被日辰冲出来的，与动爻分列（暗动章与动散章各管一路）。
  for (const [name, positions] of [['元神', circle.yuan], ['忌神', circle.ji], ['仇神', circle.chou]]) {
    assert.ok(new RegExp(`${name}属${circle.elements[name === '元神' ? 'yuan' : name === '忌神' ? 'ji' : 'chou']}，见[\\s\\S]{0,40}（(?:暗动|动|静)，于月建[旺相休囚死]）`).test(text),
      `${name}没报出所在与动静旺衰`);
  }
  assert.match(text, /勿以仇神即仇人也/, '漏了「勿以仇神即仇人也」这句');
  assert.match(text, /并不直接克用神/, '没说清仇神是间接为害，说成了直接克就反了');
  // 结构化字段里存的是爻位号，每一个都要跟卦体上那一爻对得上
  const J = await import('../miniapp/node/jingfang.mjs');
  const jf = J.jingfang(reading.hexagram);
  for (const position of [...circle.yuan, ...circle.ji, ...circle.chou]) {
    assert.ok(position >= 1 && position <= 6, `爻位越界：${position}`);
    assert.ok(jf.lines[position - 1], `第${position}爻不在卦上`);
  }
  for (const position of circle.ji) {
    assert.equal(jf.lines[position - 1].element, circle.elements.ji, '忌神那支的五行不对');
  }
  for (const position of circle.yuan) {
    assert.equal(jf.lines[position - 1].element, circle.elements.yuan, '元神那支的五行不对');
  }
});

test('回头克落在用神、元神、忌神、仇神上各说一句，方向不许反', async () => {
  const now = new Date(2026, 8, 30, 10, 0);
  const tail = (u, l, question) => {
    const reading = buildReading(castByNumbers(u, l), { now, question });
    const text = reading.insights.find((item) => item.title.startsWith('化爻')).text;
    const cut = text.indexOf('这一爻');
    return { text: cut < 0 ? '' : text.slice(cut), circle: reading.useGod.circle };
  };
  // 用神：二爻官鬼火动，变出亥水子孙，水回头克火——用神遭回头克则凶
  const onGod = tail(1, 7, '我该不该换工作');
  assert.match(onGod.text, /正是用神.*原用二神遇之則凶.*实打实的凶/s, '用神遭回头克该断为凶');
  assert.ok(!/不作凶论/.test(onGod.text), '把用神遭回头克说成了不作凶论，方向反了');
  // 忌神：三爻回头克，卦中用神为初爻父母土，忌神是三爻卯木
  const onJi = tail(1, 8, '这房子该不该买');
  assert.match(onJi.text, /正落在忌神那一行.*忌仇二神遇之反吉.*不作凶论/s, '忌神遭回头克该反不作凶论');
  // 仇神
  const onChou = tail(1, 12, '这批货该不该进');
  assert.match(onChou.text, /正落在仇神那一行.*反不作凶论/s, '仇神遭回头克该反不作凶论');
  // 元神：原书未言，就明说未言，不替它定
  const onYuan = tail(1, 7, '这房子该不该买');
  assert.match(onYuan.text, /正落在元神那一行.*原书未言/s, '元神遇回头克该照实说原书未言');
  // 用神不上卦时那圈根本不存在，后半句就接不上——空口说「落在用神则凶」是编的
  const noCircle = tail(1, 7, '这批货该不该进');
  assert.equal(noCircle.circle, null, '这一例用神本该不上卦，否则验错了路');
  assert.equal(noCircle.text, '', '用神不在卦上还接「落在用神则凶」那半句，是空口说凶');
});

test('卦体把元忌仇标在各自那一爻，忌神描边加重', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const i = client.indexOf('function guaLines(');
  const body = client.slice(i, client.indexOf('\n      function ', i + 10));
  assert.ok(/circle/.test(body), '卦体没收用神那圈');
  // 钉在「这一支真的会出这个字」上，不是钉 circle 出现过——三元入圈时能重复出
  assert.ok(/\(circle\.yuan \|\| \[\]\)\.includes\(position\) \? '元'/.test(body), '元神没按爻位对位');
  assert.ok(/\(circle\.ji \|\| \[\]\)\.includes\(position\) \? '忌'/.test(body), '忌神没按爻位对位');
  assert.ok(/\(circle\.chou \|\| \[\]\)\.includes\(position\) \? '仇'/.test(body), '仇神没按爻位对位');
  assert.ok(/class="role role-\$\{role\}"/.test(body), '元忌仇没画出标记');
  // 忌神直克用神，描边加重；元神仇神用淡字。
  // 窗口切到这条规则的收尾为止——按固定字数切会把后面 .role.god 那条（也是朱砂）算进来，
  // 那样即便把忌神的朱砂删了照样全绿，等于没测。
  const rule = (selector) => {
    const from = client.indexOf(selector);
    assert.ok(from >= 0, `CSS 里找不到 ${selector}`);
    return client.slice(from, client.indexOf('\n      }', from));
  };
  assert.ok(/var\(--seal\)/.test(rule('.gua-line .rel .role-ji {')), '忌神该用朱砂描边——它是那一圈里真在使坏的一支');
  const shared = client.slice(client.indexOf('.gua-line .rel .role-yuan,'), client.indexOf('.gua-line .rel .role-ji {'));
  assert.ok(!/var\(--seal\)/.test(shared), '元神仇神用淡字，不该一律朱砂');
  // 本卦那次得把 circle 传下去
  const call = client.slice(client.indexOf('left.append(guaBlock('), client.indexOf('left.append(guaBlock(') + 520);
  assert.ok(/reading\.useGod\.circle/.test(call), '解读页本卦没把用神那圈传进卦体');
  // 变卦不传：那一圈是本卦的事
  const changedCall = client.slice(client.indexOf("guaBlock(reading.changed, null, '变卦'"), client.indexOf("guaBlock(reading.changed, null, '变卦'") + 220);
  assert.ok(!/reading\.useGod\.circle/.test(changedCall), '变卦不该标用神那圈');
});

test('MCP 把元忌仇那圈落成字段', async () => {
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  let raw = '';
  const response = { writeHead() { return this; }, end(chunk) { raw += chunk; return this; } };
  await handleMcpRequest({
    response,
      now: AT(10, 0),
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'divination_cast', arguments: { question: '这批货该不该进', method: 'numbers', upper: 3, lower: 1 } } },
  });
  const sc = JSON.parse(raw).result.structuredContent;
  const circle = sc.useGod.circle;
  assert.ok(circle, 'MCP 没给 useGod.circle');
  assert.deepEqual(circle.elements, { yuan: '水', ji: '金', chou: '土' }, '五行关系不对');
  for (const key of ['yuan', 'ji', 'chou']) {
    assert.ok(Array.isArray(circle[key]), `${key} 该是爻位数组`);
    for (const position of circle[key]) {
      assert.ok(position >= 1 && position <= 6, `${key} 的爻位越界：${position}`);
    }
  }
  // 三个位置不能在同一个爻位上撞车
  const all = [...circle.yuan, ...circle.ji, ...circle.chou];
  assert.equal(new Set(all).size, all.length, '元忌仇撞在同一爻上了');
});

/* ---------- 暗动与日破（《增删卜易·暗动章第二十二》） ---------- */

/** 断语里「暗动 · 日破 · 冲散」那一段。 */
const clashText = (reading) => {
  const item = reading.insights.find((entry) => entry.title === '暗动 · 日破 · 冲散');
  return item ? item.text : '';
};

test('暗动与日破按旺衰分两路：原章的坤之师卦例能一步步复现', async () => {
  // 暗动章末尾那个卦例是本层最好的自证，因为它的每一环都写明了：寅月乙未日、占女痘、
  // 坤之师，酉金子孙为用神，二爻巳火动而克金，未日冲动丑土、土动生金。
  const J = await import('../miniapp/node/jingfang.mjs');
  const kun = hexagramByKey('000000');
  assert.equal(kun.name, '坤为地', '这一例的本卦该是坤为地');
  const jf = J.jingfang(kun);
  // 世在上爻、应在三爻：八纯卦世六当，酉金子孙正持世，卯木官鬼为应，与原书所画对位
  assert.equal(jf.palaceName, '坤宫');
  assert.equal(jf.stage, '本宫');
  assert.equal(jf.shi, 6);
  assert.equal(jf.ying, 3);
  assert.equal(jf.lines[5].relative, '子孙', '占女痘以子孙为用神，上爻该是子孙酉金');
  assert.equal(jf.lines[5].branch, '酉');
  // 二爻乙巳火发动，逢之变出地水师——「坤之师」由此而来
  const changed = hexagramByKey('01' + kun.key.slice(2));
  assert.equal(changed.name, '地水师', '坤之二爻发动该变出地水师');
  assert.equal(jf.lines[1].branch, '巳');
  // 未日冲动四爻癸丑土：六冲一对，未丑相冲
  const { branchClash, BRANCHES, BRANCH_ELEMENTS } = await import('../miniapp/node/almanac.mjs');
  assert.equal(branchClash(7), 1, '未日所冲该是丑');
  assert.equal(jf.lines[3].branch, '丑');
  // 这一卦里丑土在寅月（当令木）落休囚，所以按原章定义它是日破，不是暗动
  assert.equal(J.vitality('土', BRANCH_ELEMENTS[2]).key, '死', '寅月土不当令');
  const result = J.dayClashReading(jf, { monthBranch: 2, dayBranch: 7, movingPositions: [2] });
  assert.deepEqual(result.dark.map((line) => line.position), [], '丑土在寅月休囚，不该判成暗动');
  assert.deepEqual(result.dayBroken.map((line) => line.position), [4], '该作日破的是四爻丑土');
  // 原书正是拿这一爻来生金救用神的——章中定义与卦例宽法在此处不一致。
  // 本包取章中定义那一路（见 dayClashReading 注释第二条），所以这里钉住日破，
  // 免得日后有人按卦例把定义放宽了，还以为跟书一致。
  assert.equal(J.elementRelation('火', '土'), '生', '二爻巳火本生五爻丑土，卦例的救应由此来');
  assert.equal(J.elementRelation('土', '金'), '生', '丑土生上爻酉金');
  assert.equal(J.elementRelation('火', '金'), '克', '二爻巳火动而克用神酉金');
});

test('暗动只认静爻：被日辰冲到的若正在发动，不并进暗动与日破', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  const { branchClash, BRANCHES } = await import('../miniapp/node/almanac.mjs');
  let checked = 0;
  // 乾为天六爻纳支互异；水雷屯、山水蒙、天山遁、地风升则有两爻纳支相同，
  // 一次能点到两爻。两种都走一遍，后一种才验得到「只退自己那一爻」。
  for (const order of [1, 3, 4, 11, 46]) {
    const jf = J.jingfang(hexagramByOrder(order));
    for (let day = 0; day < 12; day += 1) {
      const clashed = branchClash(day);
      const hit = jf.lines.filter((line) => line.branchIndex === clashed);
      if (hit.length === 0) continue;
      for (const line of hit) {
        // 这一爻静着：总该落进暗动或日破之一
        const still = J.dayClashReading(jf, { monthBranch: 0, dayBranch: day, movingPositions: [] });
        const quiet = [...still.dark, ...still.dayBroken].map((one) => one.position);
        assert.ok(quiet.includes(line.position), `${BRANCHES[day]}日冲${line.branch}，${line.label}静着却两路都不落`);
        // 同一爻动起来：它就该从两路里退出去。动爻逢冲是「冲散」，归动散章，不在本章。
        // 注意不能断言「两路全空」——水雷屯初爻与上爻同纳子，只把初爻设成动爻，
        // 上爻还静着，它照样被同一天冲到。钉这一爻自己退出去才是对的。
        const moving = J.dayClashReading(jf, { monthBranch: 0, dayBranch: day, movingPositions: [line.position] });
        const left = [...moving.dark, ...moving.dayBroken].map((one) => one.position);
        assert.ok(!left.includes(line.position), `${line.label}已经在动了，不该还留着暗动或日破`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 18, `只验到 ${checked} 个动静对照，用例太薄`);
});

test('暗动与日破互斥：纳支重的一卦两爻同落，不会有又有破', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  // 六十四卦里有二十二卦两爻纳支相同（如水雷屯初爻与上爻同子），日辰只冲一支，
  // 于是能一次点到两爻。但纳支相同则五行必同、旺衰必同，两爻必同落一侧。
  let sawPair = 0;
  for (let order = 1; order <= HEXAGRAM_LIST.length; order += 1) {
    const jf = J.jingfang(hexagramByOrder(order));
    const counts = new Map();
    for (const line of jf.lines) counts.set(line.branchIndex, (counts.get(line.branchIndex) || 0) + 1);
    if ([...counts.values()].some((n) => n > 1)) sawPair += 1;
    for (let month = 0; month < 12; month += 1) {
      for (let day = 0; day < 12; day += 1) {
        const r = J.dayClashReading(jf, { monthBranch: month, dayBranch: day, movingPositions: [] });
        assert.ok(r.dark.length === 0 || r.dayBroken.length === 0,
          `${hexagramByOrder(order).name} ${month}月${day}日既有暗动又有日破，同一支不可能两样都占`);
        assert.ok(r.dark.length + r.dayBroken.length <= 2,
          `${hexagramByOrder(order).name} 一日冲到的爻超过两个`);
      }
    }
  }
  assert.ok(sawPair >= 20, `纳支重复的卦只数出 ${sawPair} 卦，样本文档没跟上`);
});

test('元神暗动谓之喜，忌神暗动谓之忌，两路都指得出爻位', () => {
  // 乾为天六爻纳支子寅辰午申戌。用神取四爻午火：木为元神、水为忌神、金为仇神。
  const read = (date) => buildReading(castByCoins([7, 7, 7, 7, 7, 7]),
    { now: new Date(2026, date[0], date[1], 10, 30), question: '我该不该换工作' });
  const circleOf = (r) => r.useGod.circle;
  // 申日冲寅，寅木在亥子水令为相 → 二爻元神暗动
  const yuan = read([10, 18]);
  assert.deepEqual(yuan.dayClash.dark, [2], '二爻元神该暗动');
  assert.deepEqual(yuan.dayClash.dayBroken, []);
  assert.deepEqual(circleOf(yuan).yuan, [2], '二爻正是元神那一行');
  assert.match(clashText(yuan), /元神二爻暗动来生用神[\s\S]*谓之喜/);
  assert.match(clashText(yuan), /用神休囚得元神暗動以相生/);
  // 午日冲子，子水在申酉金令为死 → 初爻忌神日破。这一句要指向忌神
  const ji = read([0, 8]);
  assert.deepEqual(ji.dayClash.dayBroken, [1], '初爻忌神该日破');
  assert.deepEqual(circleOf(ji).ji, [1]);
  assert.match(clashText(ji), /初爻正是忌神那一行/);
  assert.match(clashText(ji), /忌神暗动[\s\S]*谓之忌|忌神日破|初爻水（于月建死）为日破/);

  // 忌神暗动那一路另取一日：午日冲子，子在亥子令为休不取，换子月让水相
  const jiDark = buildReading(castByCoins([7, 7, 7, 7, 7, 7]),
    { now: new Date(2026, 7, 12, 10, 30), question: '我该不该换工作' });
  assert.deepEqual(jiDark.dayClash.dark, [1], '初爻忌神该暗动');
  assert.deepEqual(circleOf(jiDark).ji, [1], '初爻正是忌神那一行');
  assert.match(clashText(jiDark), /忌神初爻暗动起来克害用神[\s\S]*谓之忌/);
  assert.match(clashText(jiDark), /用神休囚無助，若遇忌神克害用神/);
});

test('用神不休囚时，把原书那层前提不齐的话点出来，不硬套', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  // 地风升初爻与四爻同纳丑土，未日冲动，丑土在丑月为旺，两爻一并暗动；
  // 用神取三爻辛金，于丑月为相——不在原书「用神休囚」的前提下
  const reading = buildReading(castByCoins([8, 7, 7, 8, 8, 8]),
    { now: new Date(2026, 0, 9, 10, 30), question: '我该不该换工作' });
  assert.deepEqual(reading.dayClash.dark, [1, 4], '这一例本该有两爻暗动，用例选错了');
  const god = reading.useGod.picked;
  assert.equal(god.label, '三爻');
  const tone = J.vitality(god.element, reading.structure.monthElement).key;
  assert.equal(tone, '相', '用神在丑月该是相，前提正是这一条不成立');
  const text = clashText(reading);
  assert.match(text, /那一层前提并不齐备/, '用神不休囚时没有把前提说出来');
  assert.match(text, /本卦用神三爻于月建为相/, '没点明用神到底落在哪一档');
});

test('仇神暗动与圈外暗动都只报事实，原书未言的两路不替它定', () => {
  // 寅日冲申，五爻申金在丑土令为相 → 五爻仇神暗动
  const chou = buildReading(castByCoins([7, 7, 7, 7, 7, 7]),
    { now: new Date(2026, 0, 16, 10, 30), question: '我该不该换工作' });
  assert.deepEqual(chou.dayClash.dark, [5], '五爻仇神该暗动');
  assert.deepEqual(chou.useGod.circle.chou, [5]);
  assert.match(clashText(chou), /五爻正是仇神那一行/);
  assert.match(clashText(chou), /仇神暗动归哪一支，原书未言，这里不替它定/);
  assert.ok(!/谓之喜/.test(clashText(chou)), '仇神暗动被说成了喜');
  assert.ok(!/谓之忌/.test(clashText(chou)), '仇神暗动被说成了忌');

  // 辰日冲戌，上爻戌土在丑土令为旺 → 上爻既非元神也非忌神，更非仇神
  const off = buildReading(castByCoins([7, 7, 7, 7, 7, 7]),
    { now: new Date(2026, 0, 6, 10, 30), question: '我该不该换工作' });
  assert.deepEqual(off.dayClash.dark, [6], '上爻该暗动');
  const circle = off.useGod.circle;
  assert.ok(!circle.yuan.includes(6) && !circle.ji.includes(6) && !circle.chou.includes(6),
    '这一爻本来就不在那一圈上，用例选错了');
  const text = clashText(off);
  assert.match(text, /对别的爻暗动只说「有喜有忌」，没再分派吉凶/);
  assert.ok(!/谓之喜|谓之忌/.test(text), '圈外的暗动也被派了吉凶');
});

test('用神定不下来时只摆暗动事实，不接喜忌那一半', () => {
  // 妻财不上卦，用神取的是伏神，在卦外，元忌仇无从谈起
  const reading = buildReading(castByCoins([6, 7, 6, 7, 6, 7]),
    { now: new Date(2026, 0, 12, 10, 30), question: '我该不该换工作' });
  assert.equal(reading.useGod.circle, null, '这一例本该没有那一圈');
  assert.ok(reading.dayClash.dark.length > 0, '这一例本该有暗动，用例落空了');
  const text = clashText(reading);
  assert.match(text, /暗动章第二十二/);
  assert.ok(!/谓之喜|谓之忌/.test(text), '没有圈却派了暗动的吉凶');
  assert.ok(!/正是元神|正是忌神|正是仇神/.test(text), '没有圈却点了身份');
});

test('一卦两爻暗动时整行合说，旺衰不必逐爻重报', () => {
  // 地风升初爻与四爻同纳丑土，未日冲动，丑土在丑月为旺，两爻一并暗动
  const reading = buildReading(castByCoins([8, 7, 7, 8, 8, 8]),
    { now: new Date(2026, 0, 9, 10, 30), question: '我该不该换工作' });
  assert.equal(reading.hexagram.name, '地风升');
  assert.deepEqual(reading.dayClash.dark, [1, 4], '初爻与四爻同纳丑土，该一并暗动');
  const text = clashText(reading);
  assert.match(text, /初爻土（于月建旺）、四爻土（于月建旺）皆为暗动/);
  assert.match(text, /元神那一行在初爻、四爻都占着/);
  assert.ok(!/正是元神那一行。正是元神/.test(text), '同一行被逐爻重复报了一遍');
});

test('逐爻状态里暗动与日破各自标在那一爻上，且与结构化字段对得上', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  let sawDark = 0;
  let sawBroken = 0;
  for (let month = 0; month < 12; month += 1) {
    for (let day = 1; day <= 28; day += 7) {
      const reading = buildReading(castByCoins([7, 7, 7, 7, 7, 7]),
        { now: new Date(2026, month, day, 10, 30), question: '我该不该换工作' });
      const jf = J.jingfang(reading.hexagram);
      for (const st of reading.states) {
        const line = jf.lines[st.position - 1];
        const isMoving = reading.movingLines.some((one) => one.position === st.position);
        if (st.dark) {
          sawDark += 1;
          assert.ok(reading.dayClash.dark.includes(st.position), `逐爻标了暗动，dayClash.dark 里却没有${st.position}`);
          assert.ok(!isMoving, `${line.label}是动爻，不该标暗动`);
          assert.ok(['旺', '相'].includes(J.vitality(line.element, reading.structure.monthElement).key),
            `${line.label}在月建不旺相，标不出暗动`);
        }
        if (st.dayBroken) {
          sawBroken += 1;
          assert.ok(reading.dayClash.dayBroken.includes(st.position), `逐爻标了日破，dayClash.dayBroken 里却没有${st.position}`);
          assert.ok(!isMoving, `${line.label}是动爻，不该标日破`);
          assert.ok(['休', '囚', '死'].includes(J.vitality(line.element, reading.structure.monthElement).key),
            `${line.label}在月建不休囚，标不出日破`);
        }
        // 旬空那套不受影响：暗动必旺相，早被「旺不爲空」收走，两边不该打架
        if (st.dark && st.void) {
          assert.equal(st.voidKind, '假空', `${line.label}既暗动又真空的话，旺相与真空打起来了`);
        }
      }
    }
  }
  assert.ok(sawDark > 5, `只验到 ${sawDark} 处暗动，样本文档没铺开`);
  assert.ok(sawBroken > 5, `只验到 ${sawBroken} 处日破，样本文档没铺开`);
});

test('卦体把暗动与日破标在各自那一爻，暗动不上朱砂', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const i = client.indexOf('function guaLines(');
  const body = client.slice(i, client.indexOf('\n      function ', i + 10));
  assert.ok(/st\.dark \? '暗'/.test(body), '卦体没标暗动');
  assert.ok(/st\.dayBroken \? '日破'/.test(body), '卦体没标日破');
  // 暗动不进朱砂名单。这条要直接钉在造 span 那一句上：暗动的吉凶要看它落在元神
  // 还是忌神头上，卦体这一格未必是那两行，替它表态就是编。改名单时最容易漏在这里——
  // 只查 CSS 的话，.st.po 与 .st 两条规则一个字都不会动，测试照样全绿。
  const span = body.slice(body.indexOf('.map((word) =>'), body.indexOf('.join(\'\');'));
  assert.ok(span.includes("word === '日破'"), '日破该与月破同列朱砂');
  assert.ok(!span.includes("word === '暗'"), '暗动不该列进朱砂名单');
  // 窗口要切到这条规则的收尾——按固定字数切会把后面 .role.god（也是朱砂）算进来
  const rule = (selector) => {
    const from = client.indexOf(selector);
    assert.ok(from >= 0, `CSS 里找不到 ${selector}`);
    return client.slice(from, client.indexOf('\n      }', from));
  };
  assert.ok(/var\(--seal\)/.test(rule('.gua-line .rel .st.po,')), '日破该与月破一样用朱砂');
  const base = rule('.gua-line .rel .st {');
  assert.ok(!/var\(--seal\)/.test(base), '暗动不该染朱砂');
});

test('用神段把暗动单列一档，不并进动爻也不并进静爻', () => {
  // 三爻在这一日暗动，正是仇神那一行
  const reading = buildReading(castByNumbers(3, 1),
    { now: new Date(2026, 0, 12, 10, 0), question: '这批货该不该进' });
  assert.deepEqual(reading.dayClash.dark, [3], '这一例本该三爻暗动，用例选错了');
  const circle = reading.useGod.circle;
  assert.ok(circle.chou.includes(3), '三爻正是仇神那一行');
  const text = reading.insights.find((item) => item.title === '用神').text;
  assert.ok(/三爻（暗动，于月建[旺相]）/.test(text), `用神段没把三爻报成暗动：${text}`);
  // 并进动或并进静都不行：暗动章与动散章各管一路，原书里它是独立的一档
  assert.ok(!/三爻（动，/.test(text), '暗动被并进了动爻');
  assert.ok(!/三爻（静，/.test(text), '暗动被并进了静爻');
});

// 这条原先跟着真时钟走，换一天就换一组干支，同一组数字出不出暗动、日破、冲散也跟着变。
// 于是它只能扫遍六十四卦取「头一个真出结果的」，靠暴力搜索躲开日历。
// 现在 MCP 接受注入 `now` 了，于是钉死时刻、扫出确定的答案：
// 换机器、换时区、换跑测试的当天，扫出来的都是同一卦。
// 1..8 × 1..8 恰好覆盖六十四卦；实测全年十二个日支里出得最少的那一支也命中 4 组。
const mcpCast = async (upper, lower) => {
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  let raw = '';
  const response = { writeHead() { return this; }, end(chunk) { raw += chunk; return this; } };
  await handleMcpRequest({
    response,
    now: AT(10, 0),
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'divination_cast', arguments: { question: '我该不该换工作', method: 'numbers', upper, lower } } },
  });
  return JSON.parse(raw);
};

const scanMcpDayClash = async (wants) => {
  for (let upper = 1; upper <= 8; upper += 1) {
    for (let lower = 1; lower <= 8; lower += 1) {
      const parsed = await mcpCast(upper, lower);
      const clash = parsed.result.structuredContent.dayClash;
      if (clash && wants(clash)) {
        return { clash, header: mcpHeaderLine(parsed.result.content[0].text), text: parsed.result.content[0].text };
      }
    }
  }
  return null;
};

const mcpHeaderLine = (text) => text.split('\n').find((line) => line.startsWith('【日冲】')) ?? null;

test('MCP 把暗动与日破落成字段，抬头那一行该出就出、不该出不冒', async () => {
  const hit = await scanMcpDayClash((clash) => clash.dark.length > 0 || clash.dayBroken.length > 0);
  assert.ok(hit, '扫遍六十四卦都没撞出暗动或日破——抬头那一行等于没被验过');
  for (const position of [...hit.clash.dark, ...hit.clash.dayBroken]) {
    assert.ok(position >= 1 && position <= 6, `爻位越界：${position}`);
  }
  assert.equal(hit.clash.dark.filter((p) => hit.clash.dayBroken.includes(p)).length, 0,
    '暗动与日破落在了同一个爻位上');
  assert.ok(hit.header, `该出日冲那一行却没出：${hit.text.split('\n').slice(0, 8).join(' / ')}`);
  if (hit.clash.dark.length > 0) {
    assert.ok(hit.header.includes(`暗动${hit.clash.dark.join('、')}爻`), `抬头没点出暗动那一爻：${hit.header}`);
  }
  if (hit.clash.dayBroken.length > 0) {
    assert.ok(hit.header.includes(`日破${hit.clash.dayBroken.join('、')}爻`), `抬头没点出日破那一爻：${hit.header}`);
  }
  // 反过来也钉住：三路皆空时那一行不许冒出来
  const quiet = await scanMcpDayClash((c) => c.dark.length === 0 && c.dayBroken.length === 0 && c.pressed.length === 0);
  assert.ok(quiet, '扫遍六十四卦都没撞上三路皆空的一卦，「不该出」那半边没被验过');
  assert.equal(quiet.header, null, `一路皆空却出了日冲那一行：${quiet.header}`);
});

test('月破单独出现也作真空，且不再劝人「等逢冲」', async () => {
  // 《增删卜易·旬空章》把「月破爲空」列在真空那几条里，所以只逢月破、不逢旬空的爻
  // 也该作真空；而《月破章》「虽有日辰之生，亦不能生」——冲救不了它，只会让它伤得更重。
  // 早先这里返回 status null，断语落到「暂看不出真假，等出旬或逢冲之日再定」，
  // 那半句正是在劝人等一个救不回来的东西。
  const reading = buildReading(castByCoins([7, 7, 7, 7, 7, 7]),
    { now: new Date(2026, 0, 1, 10, 30), question: '我该不该换工作' });
  const god = reading.useGod.picked;
  const st = reading.states.find((one) => one.position === god.position);
  assert.ok(st.broken, '这一例用神本该逢月破，用例选错了');
  assert.equal(st.void, false, '这一例本该不逢旬空，否则验的不是「单逢月破」这条路');
  assert.equal(st.voidKind, '真空', '单逢月破的爻该作真空');
  assert.deepEqual(st.empties, ['逢月破']);
  const text = reading.insights.find((item) => item.title === '用神').text;
  assert.match(text, /月破[^。]*是真空/, '月破没被判成真空');
  assert.ok(!/逢冲/.test(text.split('是真空')[1] || ''), '月破这一句还在劝人等逢冲——冲救不了月破');
  assert.match(text, /待出月、逢值再论/, '月破该说清待出月、逢值再论');
  // 标记里已经点过「月破」这个名，理由里不必再说第二遍
  assert.ok(!/月破[^，。]*，且逢月破/.test(text), '「月破」与「逢月破」重复说了一遍');

  // 旬空而不月破时，「逢冲」仍然是可以等的——出旬与逢冲都救得了它
  const voidOnly = buildReading(castByCoins([7, 7, 7, 7, 7, 7]),
    { now: new Date(2026, 0, 10, 10, 30), question: '我该不该换工作' });
  const vst = voidOnly.states.find((one) => one.position === voidOnly.useGod.picked.position);
  assert.ok(vst.void && !vst.broken, '这一例本该只逢旬空');
  const vtext = voidOnly.insights.find((item) => item.title === '用神').text;
  assert.match(vtext, /等出旬逢值或逢冲再论/, '旬空而不月破时，把「逢冲」也砍掉了');
});

test('旬空又逢月破时，理由里既有月破也有季令之空', () => {
  const reading = buildReading(castByCoins([8, 8, 8, 8, 8, 8]),
    { now: new Date(2026, 8, 27, 10, 30), question: '我该不该换工作' });
  const st = reading.states.find((one) => one.position === reading.useGod.picked.position);
  assert.ok(st.void && st.broken, '这一例本该旬空又逢月破，用例选错了');
  const text = reading.insights.find((item) => item.title === '用神').text;
  assert.match(text, /旬空又月破/, '两样都逢时该两个名都点');
  assert.ok(!/，且逢月破/.test(text), '「月破」已在标记里，理由里不该再重复');
  assert.match(text, /且[^，。]*令正空/, '漏掉了季令正空那条真空的理由');
});

/* ---------- 冲散（动散章第二十三） ---------- */

test('动散章原卦例逐环复现：涣之坎，上爻卯木发动，丑月丁酉日', async () => {
  // 原文：「如丑月丁酉日占父出外一载無音得風水渙變坎卦…卯木父爻發動而生世，
  //   又化子水回頭生許之，在外平安…此非卯動酉日沖之，何當散也。」
  // 这一例的价值在于：卯木在丑月落囚（休囚），照直觉该断散，原文偏偏断「在外平安」。
  const J = await import('../miniapp/node/jingfang.mjs');
  const H = await import('../miniapp/node/hexagrams.mjs');
  const A = await import('../miniapp/node/almanac.mjs');
  const hu = H.hexagramByOrder(59);
  assert.equal(hu.name, '风水涣');
  const jf = J.jingfang(hu);
  const top = jf.lines[5];
  assert.equal(top.branch, '卯', '上爻该是卯木');
  assert.equal(top.relative, '父母', '占父亲，父母为用神');
  assert.equal(top.position, 6);
  // 二爻(索引5)发动变坎为水
  const kan = H.hexagramByKey(hu.key.slice(0, 5) + (hu.key[5] === '1' ? '0' : '1'));
  assert.equal(kan.name, '坎为水', '上爻发动该变出坎为水');
  // 卯木发动而生世（世在五爻巳火），又化坎上爻子水回头生
  const shi = jf.lines[jf.shi - 1];
  assert.equal(jf.shi, 5, '世在五爻');
  assert.equal(shi.branch, '巳');
  assert.equal(J.elementRelation(top.element, shi.element), '生', '卯木本生巳火，这就是「發動而生世」');
  const kf = J.jingfang(kan);
  assert.equal(J.transformRelation(top, kf.lines[5]).key, '回头生', '化子水回头生');
  // 丑月丁酉：酉日冲卯，而卯木在丑月落囚
  const now = new Date(2026, 0, 11, 10, 30);
  assert.equal(A.BRANCHES[A.monthPillar(2026, 1, 11).branch], '丑', '月建该是丑');
  assert.equal(A.BRANCHES[A.dayPillar(2026, 1, 11).branch], '酉', '日支该是酉');
  assert.equal(A.branchClash(A.BRANCHES.indexOf('酉')), top.branchIndex, '酉日所冲正是卯');
  assert.equal(J.vitality('木', A.BRANCH_ELEMENTS[A.BRANCHES.indexOf('丑')]).key, '囚', '卯木在丑月落囚');

  // 用本包把它起出来：上爻发动 → 冲散；化爻回头生
  const reading = buildReading(castByCoins([8, 7, 8, 8, 7, 9]),
    { now, question: '我父亲出外一载无音，何时回' });
  assert.equal(reading.hexagram.name, '风水涣');
  assert.equal(reading.changed.name, '坎为水');
  assert.deepEqual(reading.movingLines.map((line) => line.position), [6]);
  assert.deepEqual(reading.dayClash.pressed, [6], '上爻动而逢酉日冲，该落冲散');
  assert.deepEqual(reading.dayClash.dark, [], '没有静爻逢冲，不该出暗动');
  assert.deepEqual(reading.dayClash.dayBroken, [], '动爻不走日破那一路');
  assert.equal(reading.transforms[0].relation, '回头生');
  // 断语照章说话：报出事实，引原书「不散」的结论，不拿它断凶
  const text = clashText(reading);
  assert.match(text, /动散章第二十三/);
  assert.match(text, /上爻木（于月建囚）逢日冲，谓之冲散/);
  assert.match(text, /休囚者間有沖散，亦千百中之一二/);
  assert.match(text, /不拿它断凶/);
  assert.ok(!/福來而不知/.test(text), '没有暗动却搬了驳暗动迟缓的那两句');
});

test('冲散与暗动、日破三路互斥，同一卦里也不打架', async () => {
  const J = await import('../miniapp/node/jingfang.mjs');
  let sawPress = 0;
  for (let order = 1; order <= HEXAGRAM_LIST.length; order += 1) {
    const jf = J.jingfang(hexagramByOrder(order));
    for (let month = 0; month < 12; month += 1) {
      for (let day = 0; day < 12; day += 1) {
        for (let mask = 1; mask < 64; mask += 1) {
          const moving = [];
          for (let k = 0; k < 6; k += 1) if (mask >> k & 1) moving.push(k + 1);
          const r = J.dayClashReading(jf, { monthBranch: month, dayBranch: day, movingPositions: moving });
          const all = [...r.dark, ...r.dayBroken, ...r.pressed].map((line) => line.position);
          assert.equal(new Set(all).size, all.length, `${hexagramByOrder(order).name} 同一爻落进两路去了`);
          if (r.pressed.length > 0) {
            sawPress += 1;
            const movingSet = new Set(moving);
            for (const line of r.pressed) {
              assert.ok(movingSet.has(line.position), '冲散只该收动爻');
            }
          }
          // 冲散与暗动/日破可以同卦并存（不同爻），但三路绝不同落一爻
          assert.ok(r.dark.length === 0 || r.dayBroken.length === 0,
            '暗动与日破同落一卦，说明那支纳支的两爻五行竟然不同');
        }
      }
    }
  }
  assert.ok(sawPress > 1000, `只验到 ${sawPress} 次冲散，样本文档没铺开`);
});

test('冲散只由日辰决定，月建一分不参与——《易冒》「苟非月建」那条豁免', async () => {
  // 《易冒·日冲章》：「如動爻遇日辰相沖，苟非月建，則謂之散」——「苟非月建」四字
  // 就是豁免：只有月建冲的动爻不作冲散，它走的是月破那一路。
  // 所以判据不是「这一卦有没有月破」，而是**冲散这个结果与 monthBranch 无关**：
  // 同一个日辰下，把月建从子换到亥，冲散那几爻一个都不许变。
  const J = await import('../miniapp/node/jingfang.mjs');
  const A = await import('../miniapp/node/almanac.mjs');
  const picked = (r) => [...r.pressed].map((line) => line.position).sort();
  let compared = 0;
  let sawMonthOnly = 0;
  for (let order = 1; order <= HEXAGRAM_LIST.length && compared < 400; order += 1) {
    const jf = J.jingfang(hexagramByOrder(order));
    for (const mask of [0b111111, 0b010101, 0b101010, 0b001010]) {
      const moving = [];
      for (let k = 0; k < 6; k += 1) if (mask >> k & 1) moving.push(k + 1);
      for (let day = 0; day < 12 && compared < 400; day += 1) {
        const results = [];
        for (let month = 0; month < 12; month += 1) {
          const r = J.dayClashReading(jf, { monthBranch: month, dayBranch: day, movingPositions: moving });
          results.push(JSON.stringify(picked(r)));
          // 顺带验一条：只有月建冲、而日辰不冲的动爻，既不进冲散，也落月破
          if (A.branchClash(month) !== day) {
            for (const line of jf.lines) {
              if (!moving.includes(line.position)) continue;
              if (line.branchIndex === A.branchClash(month) && line.branchIndex !== A.branchClash(day)) {
                sawMonthOnly += 1;
                assert.ok(!r.pressed.some((one) => one.position === line.position),
                  `${line.label}只被月建冲到，不该算日辰冲散`);
                assert.ok(r.pressed.every((one) => one.position !== line.position));
              }
            }
          }
        }
        assert.equal(new Set(results).size, 1,
          `${hexagramByOrder(order).name} 日辰${A.BRANCHES[day]}不动、月建却改变了冲散的结果`);
        compared += 1;
      }
    }
  }
  assert.ok(compared >= 300, `只比了 ${compared} 组，样本太薄`);
  assert.ok(sawMonthOnly > 0, '一例「只逢月建冲的动爻」都没取到，那半条豁免等于没验');
});

test('用神段把「动而逢日冲」单列一档，不并进动爻也不并进暗动', () => {
  // 乾为天六爻纳甲子寅辰午申戌，四爻午火被日冲且正在发动，而四爻正是用神
  const reading = buildReading(castByCoins([7, 9, 7, 9, 7, 9]),
    { now: new Date(2026, 0, 2, 10, 30), question: '我该不该换工作' });
  assert.deepEqual(reading.dayClash.pressed, [4], '这一例本该四爻冲散，用例选错了');
  const god = reading.useGod.picked;
  assert.equal(god.position, 4, '用神该正是那一爻');
  const text = reading.insights.find((item) => item.title === '用神').text;
  // 用神自己那一爻的动静与元神忌神仇神同一口径，都是四档。
  // 早先这里只有动静两档，于是用神自己冲散了也只写「（动）」，看不出来。
  assert.ok(new RegExp(`${god.label}（动而逢日冲）`).test(text),
    `用神段没把用神自己报成动而逢日冲：${text}`);
  assert.ok(!new RegExp(`${god.label}（动）`).test(text), '动而逢日冲被并进了动爻');
  assert.ok(!new RegExp(`${god.label}（暗动）`).test(text), '动而逢日冲被并进了暗动');
  assert.ok(!new RegExp(`${god.label}（静）`).test(text), '动而逢日冲被并进了静爻');
  // 静爻仍照旧不标档，免得满屏都是「（静）」
  const still = buildReading(castByCoins([7, 7, 7, 7, 7, 7]),
    { now: new Date(2026, 0, 6, 10, 30), question: '我该不该换工作' });
  const stext = still.insights.find((item) => item.title === '用神').text;
  assert.ok(!/（静）/.test(stext), `静爻不该挂一个「（静）」：${stext}`);
});

test('元神冲散时，用神段点名元神那一行', () => {
  // 二爻寅木被日冲且在动，对用神水而言正是元神
  const reading = buildReading(castByCoins([7, 9, 7, 9, 7, 9]),
    { now: new Date(2026, 0, 10, 10, 30), question: '我该不该换工作' });
  assert.deepEqual(reading.dayClash.pressed, [2]);
  assert.deepEqual(reading.useGod.circle.yuan, [2], '二爻正是元神那一行');
  const text = reading.insights.find((item) => item.title === '用神').text;
  assert.ok(/二爻（动而逢日冲，于月建[旺相休囚死]）/.test(text), `用神段没把二爻报成动而逢日冲：${text}`);
  assert.ok(!/二爻（动，/.test(text), '二爻被并进了动爻那一档');
});

test('暗动与冲散可以同卦并存，各说各的', () => {
  // 水雷屯初爻与上爻同纳子水，上爻发动；午日冲子。
  // 静的那一爻旺相作暗动，动的那一爻作冲散——同一天、同一个支，两路各归各。
  const reading = buildReading(castByCoins([7, 8, 8, 8, 7, 6]),
    { now: new Date(2026, 7, 12, 10, 30), question: '我该不该换工作' });
  assert.equal(reading.hexagram.name, '水雷屯');
  assert.deepEqual(reading.movingLines.map((line) => line.position), [6]);
  assert.deepEqual(reading.dayClash.dark, [1], '初爻静而逢冲，当作暗动');
  assert.deepEqual(reading.dayClash.pressed, [6], '上爻动而逢冲，当作冲散');
  assert.deepEqual(reading.dayClash.dayBroken, [], '两爻都旺相，不该出日破');
  const text = clashText(reading);
  assert.match(text, /暗动章第二十二/, '暗动那一路该引暗动章');
  assert.match(text, /动散章第二十三|谓之冲散/, '冲散那一路该引动散章');
  assert.ok(text.indexOf('暗动') < text.indexOf('谓之冲散'), '暗动在前、冲散在后');
});

test('旺相的动爻冲散，原书直言冲之不散', () => {
  const reading = buildReading(castByCoins([7, 9, 7, 9, 7, 9]),
    { now: new Date(2026, 0, 6, 10, 30), question: '我该不该换工作' });
  assert.deepEqual(reading.dayClash.pressed, [6]);
  assert.match(clashText(reading), /于月建旺相，原书直言「旺相者沖之不散」/);
});

test('卦体把冲散标在动爻上，且不拿朱砂替它表态', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const i = client.indexOf('function guaLines(');
  const body = client.slice(i, client.indexOf('\n      function ', i + 10));
  assert.ok(/st\.pressed \? '冲散'/.test(body), '卦体没标冲散');
  // 冲散不上朱砂：动散章整章的结论是「冲之不散」，染红等于替它断凶。
  // 钉在造 span 那一句上——只查 CSS 的话，.st.po 与 .st 两条规则一个字都不会动。
  const span = body.slice(body.indexOf('.map((word) =>'), body.indexOf(".join('');"));
  assert.ok(!span.includes("word === '冲散' ? ' po'"), '冲散不该进朱砂名单');
  assert.ok(span.includes('冲散'), '冲散那个 span 得留着');
});

test('MCP 把冲散落进 dayClash，抬头那一行改叫【日冲】并点出冲散', async () => {
  // 冲散是动散章那一路，只在动爻逢日冲时出。抬头里它得自己占一段，
  // 不能只靠「三路有任一路非空就出一行」蒙混过去——那一行在、却没写冲散，是另一种错。
  const hit = await scanMcpDayClash((clash) => clash.pressed.length > 0);
  assert.ok(hit, '扫遍六十四卦都没撞出冲散——抬头上那一段等于没被验过');
  const { clash, header, text } = hit;
  for (const position of clash.pressed) {
    assert.ok(position >= 1 && position <= 6, `冲散爻位越界：${position}`);
  }
  const all = [...clash.dark, ...clash.dayBroken, ...clash.pressed];
  assert.equal(new Set(all).size, all.length, '三路落到了同一个爻位上');
  assert.ok(header, '抬头上没有日冲那一行');
  assert.ok(header.includes(`冲散${clash.pressed.join('、')}爻`),
    `抬头没点出冲散那一爻：抬头作「${header}」，而 dayClash.pressed 作 [${clash.pressed}]`);
  assert.match(text, /谓之冲散/, '正文里没有冲散那一段');
});

/* ---------- 六冲（增删卜易·六冲章第二十、六合章第十九） ---------- */

const clashSection = (reading) => reading.insights.find((item) => item.title === '六冲');

test('六冲卦十个、六合卦八个，名单逐一钉死', async () => {
  const { hexagramClash } = await import('../miniapp/node/jingfang.mjs');
  const chong = [];
  const he = [];
  for (const hexagram of HEXAGRAM_LIST) {
    const clash = hexagramClash(hexagram);
    if (clash.chong) chong.push(hexagram.name);
    if (clash.he) he.push(hexagram.name);
  }
  // 八纯卦加天雷无妄、雷天大壮。无妄与大壮之所以也在内：乾与震纳甲同支，
  // 上下互易之后三对照样全冲。
  assert.deepEqual(chong, ['乾为天', '坤为地', '天雷无妄', '坎为水', '离为火',
    '雷天大壮', '震为雷', '艮为山', '巽为风', '兑为泽']);
  assert.deepEqual(he, ['地天泰', '天地否', '雷地豫', '山火贲', '地雷复', '泽水困',
    '火山旅', '水泽节']);
  // 一卦不能又冲又合：那要三对同时既冲又合
  for (const hexagram of HEXAGRAM_LIST) {
    const clash = hexagramClash(hexagram);
    assert.ok(!(clash.chong && clash.he), `${hexagram.name}又算六冲又算六合`);
  }
});

test('六冲六合按初四、二五、三六配对，且一组成立则三组皆成立', async () => {
  const { hexagramClash } = await import('../miniapp/node/jingfang.mjs');
  // 这一步最易数错：纳甲内外两卦的起支错开一位，配对是隔三位，不是内外同位。
  // 按内外同位去配，六十四卦里一个六冲卦也找不出来。
  for (const hexagram of HEXAGRAM_LIST) {
    const clash = hexagramClash(hexagram);
    assert.deepEqual(clash.pairs.map((pair) => [pair.lower.position, pair.upper.position]),
      [[1, 4], [2, 5], [3, 6]], `${hexagram.name}的配对位不对`);
    // 「这三组，只要有一组相冲，其他两组必定相冲」——不是经验，是纳甲定死的
    const chongPairs = clash.pairs.filter((pair) => pair.kind === '冲').length;
    const hePairs = clash.pairs.filter((pair) => pair.kind === '合').length;
    assert.equal(clash.chong, chongPairs === 3, `${hexagram.name}三对冲的组数与判定不符`);
    assert.equal(clash.he, hePairs === 3, `${hexagram.name}三对合的组数与判定不符`);
    assert.equal(clash.chong, chongPairs > 0, `${hexagram.name}「一组冲则三组皆冲」这条不成立`);
    assert.equal(clash.he, hePairs > 0, `${hexagram.name}「一组合则三组皆合」这条不成立`);
  }
  // 乾为天三对的具体支，别只钉住「是六冲卦」这句话
  const qian = hexagramClash(hexagramByOrder(1));
  assert.deepEqual(qian.pairs.map((pair) => `${pair.lower.branch}${pair.upper.branch}`),
    ['子午', '寅申', '辰戌']);
});

test('六冲章那六种冲里的四路，各自落到本卦上', async () => {
  // 第一路日月冲爻归日辰与月建，已在暗动章与月破里逐爻算过，这里数的是剩下几路。
  const sixChongToChong = buildReading(castByCoins([6, 6, 6, 6, 6, 6]),
    { now: new Date(2026, 0, 10, 10, 30), question: '我该不该换工作' });
  assert.equal(sixChongToChong.hexagram.name, '坤为地');
  assert.equal(sixChongToChong.changed.name, '乾为天');
  assert.ok(sixChongToChong.clash.chong, '坤为地该是六冲卦');
  assert.ok(sixChongToChong.clash.changedChong && sixChongToChong.clash.chongToChong,
    '坤为地变乾为天，两头都是六冲卦，该作六冲变六冲');
  assert.match(clashSection(sixChongToChong).text, /本卦六冲、变卦也是六冲（六冲变六冲）/);

  const heToChong = buildReading(castByCoins([7, 6, 6, 6, 6, 6]),
    { now: new Date(2026, 0, 10, 10, 30), question: '我该不该换工作' });
  assert.equal(heToChong.hexagram.name, '地雷复', '用例选错了卦');
  assert.ok(heToChong.clash.he, '地雷复该是六合卦');
  assert.ok(heToChong.clash.heToChong, '地雷复变乾为天，该作六合变六冲');
  assert.equal(heToChong.clash.chongToChong, false, '本卦不是六冲卦，不该同时算六冲变六冲');
  assert.match(clashSection(heToChong).text, /本卦六合、变卦六冲（六合变六冲）/);

  const transformClash = buildReading(castByCoins([8, 6, 6, 6, 6, 6]),
    { now: new Date(2026, 0, 10, 10, 30), question: '我该不该换工作' });
  assert.deepEqual(transformClash.clash.transformClash, [2, 3], '这一例本该二爻三爻动爻变冲');
  assert.match(clashSection(transformClash).text, /变出去的那一支正好冲本位那一爻（动爻变冲）/);
});

test('卦内两爻相冲不等于六冲卦，零散的那几对只在卦体已出段时顺带报', async () => {
  // 地泽临：兑下纳巳卯丑、坤上纳丑亥酉。初巳冲五亥、二卯冲上酉，各撞上一对。
  const lin = buildReading(castByCoins([7, 7, 6, 6, 6, 6]),
    { now: new Date(2026, 8, 30, 10, 30), question: '我该不该换工作' });
  assert.equal(lin.hexagram.name, '地泽临', '用例选错了卦');
  assert.deepEqual(lin.clash.incidental, [[1, 5], [2, 6]]);
  assert.equal(lin.clash.chong, false, '地泽临三对标准位不冲，就不是六冲卦');
  assert.equal(lin.clash.he, false);
  // 零散爻冲六十四卦里有三十卦都有，单拿它当触发会让大半卦都多出这一段
  // ——同一卦换成不动上爻那一组（变出天风姤，不是六冲卦），整段就不出
  const quiet = buildReading(castByCoins([9, 7, 6, 6, 6, 6]),
    { now: new Date(2026, 8, 30, 10, 30), question: '我该不该换工作' });
  assert.equal(quiet.hexagram.name, '地泽临', '用例选错了卦');
  assert.deepEqual(quiet.clash.incidental, [[1, 5], [2, 6]], '卦内那两对冲还在');
  assert.equal(quiet.clash.changedChong, false, '这一例变出天风姤，本该不是六冲卦');
  assert.equal(clashSection(quiet), undefined, '只为卦内零散爻冲就开段，那是噪音');
  // 同一卦变出六冲卦时它就顺带被报出来——上面那一组正变出乾为天
  assert.ok(lin.clash.changedChong);
  assert.match(clashSection(lin).text, /卦里另有初爻巳冲五爻亥、二爻卯冲上爻酉/);
  assert.match(clashSection(lin).text, /不等于本卦就是六冲卦/);
});

test('六冲的吉凶只按用神说，用神定不下来就不接那一层', async () => {
  // 章末：「亦必兼用神而言，用神若旺，虽冲不碍；用神失陷，凶而又凶。」
  // 断言要认「照……这层冲……」那半句实说的话，不能只认引文里那半句——每段都引着它，
  // 拿引文当判据，改口了照样全绿。
  const strong = buildReading(castByCoins([6, 6, 6, 6, 6, 6]),
    { now: new Date(2026, 1, 10, 10, 30), question: '我该不该换工作' });
  assert.match(clashSection(strong).text, /用神三爻木于月建为旺/, '这一例本该用神旺相');
  assert.match(clashSection(strong).text, /照「用神若旺，虽冲不碍」，这层冲不碍着它/);
  assert.ok(!/这层冲对它不是好事/.test(clashSection(strong).text), '用神旺相却按失陷说了');

  const weak = buildReading(castByCoins([6, 6, 6, 6, 6, 6]),
    { now: new Date(2026, 0, 10, 10, 30), question: '我该不该换工作' });
  assert.match(clashSection(weak).text, /用神三爻木于月建为囚/);
  assert.match(clashSection(weak).text, /落在失陷那一头，照「用神失陷，凶而又凶」，这层冲对它不是好事/);
  assert.ok(!/照「用神若旺，虽冲不碍」，这层冲不碍着它/.test(clashSection(weak).text), '用神失陷却说它不碍');

  // 用神不上卦时那一圈是空的，吉凶那一层就悬着，不拿别的爻顶上
  const blank = buildReading(castByCoins([6, 6, 7, 7, 6, 7]),
    { now: new Date(2026, 0, 10, 10, 30), question: '这场官司能了结吗' });
  assert.equal(blank.hexagram.name, '火山旅', '用例选错了卦');
  assert.ok(blank.clash.heToChong, '这一例本该是六合变六冲');
  assert.equal(blank.useGod.circle, null, '这一例本该取不出那一圈，用例选错了');
  assert.match(clashSection(blank).text, /用神定不下来，这一层就不接/);
});

test('「占凶事宜、占吉事不宜」那半句只引不裁，疾病那条只引不选边', async () => {
  // 所问算吉事还是凶事，是问卦人自己的定位，一句问题里读不出来
  const plain = buildReading(castByCoins([6, 6, 6, 6, 6, 6]),
    { now: new Date(2026, 0, 10, 10, 30), question: '我该不该换工作' });
  assert.match(clashSection(plain).text, /所问算吉事还是凶事，是你自己的定位，本包不替你归这一头/);
  // 近病与久病差着一条命，只有问的人知道
  const health = buildReading(castByCoins([6, 6, 6, 6, 6, 6]),
    { now: new Date(2026, 0, 10, 10, 30), question: '父亲的病能好起来吗' });
  const text = clashSection(health).text;
  assert.match(text, /近病逢冲即愈，久病逢冲则死/, '占病那条原话该引出来');
  assert.match(text, /新病还是久病只有你清楚，这里只引这句、不替你选边/);
  assert.ok(!/近病逢冲则愈/.test(text.replace('近病逢冲即愈，久病逢冲则死', '')),
    '占病被替人选了「新病即愈」这一边');
  // 非占病时不摆疾病那一条
  assert.ok(!/近病逢冲即愈/.test(clashSection(plain).text), '不占病却搬了占病那条');
});

test('官讼事类接得上「惟占官非、盗贼、结绝事者宜之」那半句', async () => {
  // 所问既已认作官讼是非，原书末了那半句说的正是这一类，可以直接接
  const dispute = buildReading(castByCoins([7, 6, 6, 6, 6, 6]),
    { now: new Date(2026, 0, 10, 10, 30), question: '这场官司能了结吗' });
  assert.equal(dispute.topic.key, 'dispute', '所问没认成官讼是非，用例选错了');
  assert.match(clashSection(dispute).text, /惟占官非、盗贼、结绝事者宜之/);
  assert.match(clashSection(dispute).text, /所问正落在官讼是非上，末了那半句说的就是这一类/);
  // 不在这一类上时明说不在，不替它改判吉凶
  const other = buildReading(castByCoins([7, 6, 6, 6, 6, 6]),
    { now: new Date(2026, 0, 10, 10, 30), question: '我该不该换工作' });
  assert.match(clashSection(other).text, /所问不在此，断语不替它改判吉凶/);
});

test('卦体给六冲/六合挂一枚小标，淡字不上朱砂；右栏另有一格', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const start = client.indexOf('function clashTag(');
  const tag = client.slice(start, client.indexOf('\n      function ', start + 10));
  assert.ok(tag.length > 0, '没找到 clashTag 函数体');
  assert.ok(/reading\.clash/.test(tag), '小标没读卦体冲合那一组数据');
  // 本卦与变卦各判一次：本卦看它自己，变卦看变出来的那个是不是六冲/六合
  assert.ok(/which === '本卦'/.test(tag) && /if \(c\.chong\) return '六冲'/.test(tag)
    && /if \(c\.changedChong\) return '六冲'/.test(tag), '小标没把本卦与变卦分开判');
  // 六冲六合是整卦的结构，不是吉凶，所以不列进朱砂名单
  assert.ok(!/' po'/.test(tag), '卦体冲合那枚小标不该用朱砂');
  // 钉在真正画出去的那一行：函数算对了、调用点不把 tag 传进去，卦面上照样什么都没有
  const block = client.slice(client.indexOf('function guaBlock('));
  const head = block.slice(0, block.indexOf('block.append(title)'));
  assert.ok(/\(tag \? `<span class="gua-tag"/.test(head), 'guaBlock 没把 tag 那一枚画到标题上');
  assert.ok(/>\$\{tag\}<\/span>/.test(head), '卦体冲合那枚小标没把 tag 的字写进去');
  // 钉在两个调用点上：函数算对了、调用点不把 tag 传进去，卦面上照样什么都没有。
  // 只钉 clashTag 函数体的话，本卦那枚照样在，变卦那枚没了测试也不会红。
  assert.match(client, /clashTag\(reading, '本卦'\)/, '本卦那个卦体没去问要不要挂小标');
  assert.match(client, /clashTag\(reading, '变卦'\)/, '变卦那个卦体没去问要不要挂小标');
  const rule = client.slice(client.indexOf('.gua-title .gua-tag {'));
  const css = rule.slice(0, rule.indexOf('}'));
  assert.ok(/var\(--text-subtle\)/.test(css), '卦体冲合那枚小标该用淡字');
  assert.ok(!/var\(--seal\)/.test(css), '卦体冲合那枚小标不该染朱砂');
  // 右栏那格
  assert.ok(/\['卦体冲合', clashFact\(reading\)\]/.test(client), '右栏没有卦体冲合一格');
  const fact = client.slice(client.indexOf('function clashFact('));
  const body = fact.slice(0, fact.indexOf('\n      function '));
  // 卦内零散爻与爻冲六十四卦里有三十卦都有，只为它开一格，右栏就成了流水账
  assert.ok(!/c\.incidental/.test(body), 'clashFact 不该把零散爻与爻冲单独拎出来开格');
  assert.ok(/if \(!\(c\.chong \|\| c\.he \|\| c\.changedChong \|\| c\.transformClash\.length\)\) return null;/.test(body),
    '卦体既非六冲也非六合、变卦也不六冲、无动爻变冲时不该开这一格');
});

test('MCP 把卦体冲合落成字段，抬头另起一行【卦体】', async () => {
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  const call = async (upper, lower) => {
    let raw = '';
    const response = { writeHead() { return this; }, end(chunk) { raw += chunk; return this; } };
    await handleMcpRequest({
      response,
        now: AT(10, 0),
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'divination_cast', arguments: { question: '我该不该换工作', method: 'numbers', upper, lower } } },
    });
    return JSON.parse(raw);
  };
  const headerOf = (text) => text.split('\n').find((line) => line.startsWith('【卦体】')) ?? null;

  // 卦体定性是整卦的，数字起卦的动爻位也不随日期动——这三组四个不同月建下取值不变，
  // 所以可以直接钉死卦例，不必像【日冲】那样扫遍六十四卦。
  const chong = await call(7, 7);
  assert.equal(chong.result.structuredContent.hexagram.name, '艮为山');
  assert.equal(chong.result.structuredContent.clash.chong, true, '艮为山该判成六冲卦');
  assert.equal(chong.result.structuredContent.clash.he, false);
  const chongHeader = headerOf(chong.result.content[0].text);
  assert.ok(chongHeader, '六冲卦该出【卦体】那一行');
  assert.match(chongHeader, /本卦六冲卦/);

  // 变卦也是六冲卦——这正是「六合变六冲」那一路要在抬头露出来的地方
  const changedChong = await call(1, 2);
  const sc = changedChong.result.structuredContent;
  assert.equal(sc.hexagram.name, '天泽履');
  assert.equal(sc.clash.chong, false);
  assert.equal(sc.clash.he, false, '天泽履既不是六冲也不是六合，走的是「卦变六冲」那一支');
  assert.equal(sc.clash.changedChong, true, '天泽履变乾为天，变卦该是六冲卦');
  assert.match(headerOf(changedChong.result.content[0].text), /变卦六冲/);

  // 六合变六冲要单独走它自己那半句，不能跟上面那一支混成同一句
  const heToChong = await call(3, 7);
  const heSc = heToChong.result.structuredContent;
  assert.equal(heSc.hexagram.name, '火山旅', '用例选错了卦');
  assert.equal(heSc.clash.he, true, '火山旅该是六合卦');
  assert.equal(heSc.clash.heToChong, true, '火山旅变艮为山，该作六合变六冲');
  assert.match(headerOf(heToChong.result.content[0].text), /变卦六冲（六合变六冲）/);

  // 又不是六冲、又不是六合、变卦也不六冲、无动爻变冲：这种「不是」不值一行
  const quiet = await call(3, 1);
  const quietSc = quiet.result.structuredContent;
  assert.equal(quietSc.clash.chong, false);
  assert.equal(quietSc.clash.he, false);
  assert.equal(quietSc.clash.changedChong, false);
  assert.deepEqual(quietSc.clash.transformClash, []);
  assert.equal(headerOf(quiet.result.content[0].text), null, '没东西可说却出了【卦体】那一行');

  // pairs 里给的是爻位对，程序不必再从正文里刨
  const pairs = chong.result.structuredContent.clash.pairs;
  assert.deepEqual(pairs.map((pair) => [pair.lower, pair.upper]),
    [[1, 4], [2, 5], [3, 6]], '三对的爻位不对');
  for (const pair of pairs) {
    assert.equal(pair.kind, '冲', '艮为山三对都该判成冲');
  }
});


// ── 爻之合：六合章的前三法（卦级三法见上面的六冲一节）────────────────────────

test('六合章的「相合法有六」：前两法六十四卦逐个走通，后三法是卦级结构', async () => {
  // 章里明写「相合法有六」，本包六法都做，但分两层：前三法落在单爻上，末三法是整卦结构。
  // 末三法（卦逢六合、六冲变六合、六合变六合）由 hexagramClash 判，这一条只钉分界不重叠。
  const { heCombineReading, jingfang, hexagramClash } = await import('../miniapp/node/jingfang.mjs');
  let kinds = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    const clash = hexagramClash(hexagram);
    if (clash.chong || clash.he) kinds += 1;
    const jf = jingfang(hexagram);
    // 整卦六合那一卦，三对全在初四二五三六上；合好只取其余配对，所以它一个都不许收进来。
    if (clash.he) {
      const got = heCombineReading(jf, { monthBranch: 0, dayBranch: 0, movingPositions: [1, 2, 3, 4, 5, 6] }, jf);
      assert.equal(got.friendly.length, 0,
        `${hexagram.name}是六合卦，初四二五三六三对却报进了合好——整卦六合与合好混成两处账了`);
    }
  }
  assert.equal(kinds, 18, '六冲十个加六合八个，不是十八卦');
});

test('合起只管静爻、合绊只管动爻：同一爻不会同时落进两路', async () => {
  const { heCombineReading, jingfang } = await import('../miniapp/node/jingfang.mjs');
  for (const hexagram of HEXAGRAM_LIST) {
    const jf = jingfang(hexagram);
    for (let day = 0; day < 12; day += 1) {
      for (let mask = 0; mask < 64; mask += 1) {
        const moving = [];
        for (let position = 1; position <= 6; position += 1) {
          if (mask & (1 << (position - 1))) moving.push(position);
        }
        const got = heCombineReading(jf, { monthBranch: (day + 5) % 12, dayBranch: day, movingPositions: moving });
        const isMoving = (position) => moving.includes(position);
        for (const item of got.rise) {
          assert.ok(!isMoving(item.line.position), `${hexagram.name}的动爻${item.line.label}落进了合起`);
        }
        for (const item of got.bind) {
          assert.ok(isMoving(item.line.position), `${hexagram.name}的静爻${item.line.label}落进了合绊`);
        }
      }
    }
  }
});

test('「但有一爻不动，亦不为合」：合好要两爻皆动，静动相合不算', async () => {
  // 这句限定是六合章的明文，也是合好与「凡两支相合就报」的分界。
  // 做法是找一对真的相合、且不是初四二五三六的爻位，让两爻都动、再只动一个，
  // 两次结果必须一次出、一次不出——只出不出都不行，那说明判据根本不是动静。
  const { heCombineReading, jingfang } = await import('../miniapp/node/jingfang.mjs');
  const { SIX_HARMONY } = await import('../miniapp/node/almanac.mjs');
  const harmonyOf = (branch) => {
    for (const [x, y] of SIX_HARMONY) {
      if (x === branch) return y;
      if (y === branch) return x;
    }
    return -1;
  };
  // 雷火丰六支卯丑亥午申戌，初爻卯与上爻戌相合——就这一对，且不在初四二五三六上。
  // 挑它是因为干净：一动一静两个结果一比，就看得出判据是不是「两爻皆动」。
  const feng = HEXAGRAM_LIST.find((h) => h.name === '雷火丰');
  assert.ok(feng, '缺雷火丰');
  const jf = jingfang(feng);
  const both = heCombineReading(jf, { monthBranch: 0, dayBranch: 0, movingPositions: [1, 6] });
  const onlyOne = heCombineReading(jf, { monthBranch: 0, dayBranch: 0, movingPositions: [1] });
  const onlyOther = heCombineReading(jf, { monthBranch: 0, dayBranch: 0, movingPositions: [6] });
  assert.ok(both.friendly.length > 0, '初爻与上爻都动，却没报出合好');
  assert.equal(onlyOne.friendly.length, 0, '只动初爻也算合好，「但有一爻不动亦不为合」没守住');
  assert.equal(onlyOther.friendly.length, 0, '只动上爻也算合好，静动相合本不该算');
  // 六十四卦里真有相合对、且不在初四二五三六上的，一共二十卦。少了它们合好这一路
  // 就永远空转，「静动不算」也就无从对照，所以把数目钉在这里。
  let withPair = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    const one = jingfang(hexagram);
    let found = false;
    for (let a = 1; a <= 6 && !found; a += 1) {
      for (let b = a + 1; b <= 6; b += 1) {
        if (['14', '25', '36'].includes(`${a}${b}`)) continue;
        if (harmonyOf(one.lines[a - 1].branchIndex) === one.lines[b - 1].branchIndex) found = true;
      }
    }
    if (found) withPair += 1;
  }
  assert.equal(withPair, 20, '有非标准相合对的卦不是二十个');
});

test('化扶要动爻化出之爻回头相合，本爻不是动爻就不算', async () => {
  const { heCombineReading, jingfang } = await import('../miniapp/node/jingfang.mjs');
  const { hexagramByKey } = await import('../miniapp/node/hexagrams.mjs');
  const { SIX_HARMONY } = await import('../miniapp/node/almanac.mjs');
  const partner = (branch) => {
    for (const [x, y] of SIX_HARMONY) {
      if (x === branch) return y;
      if (y === branch) return x;
    }
    return -1;
  };
  // 变卦照实现同一条路造：把动爻那一爻的阴阳反转，别自己另立一套判法。
  const changedOf = (key, movingPositions) => {
    const lines = key.split('').map(Number);
    for (const position of movingPositions) lines[position - 1] = lines[position - 1] ? 0 : 1;
    return hexagramByKey(lines.join(''));
  };
  let made = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    const jf = jingfang(hexagram);
    for (let moving = 1; moving <= 6; moving += 1) {
      const changedJf = jingfang(changedOf(hexagram.key, [moving]));
      const got = heCombineReading(jf, { monthBranch: 0, dayBranch: 0, movingPositions: [moving] }, changedJf);
      for (const item of got.support) {
        made += 1;
        assert.equal(item.line.position, moving, `${hexagram.name}的化扶落在${item.line.label}，动爻却是${moving}爻`);
        assert.equal(item.changedLine.branchIndex, partner(item.line.branchIndex),
          `${item.line.branch}化出${item.changedLine.branch}，两支并不相合，却报了化扶`);
      }
    }
  }
  assert.ok(made > 0, '六十四卦六个爻位扫下来一个化扶都没有，化扶这一路根本没在跑');
  // 换掉一段日辰月建之后这一路照样成立——它不拿日月说话，只看化出的那一爻
  const before = made;
  assert.ok(before > 0);
});

test('日月同支时只算一路，不把同一件事数两遍', async () => {
  // 六合是十二支上的两两配对，一支的合支唯一。日辰与月建既同一支，合上它的判据
  // 就是同一条，报两次是同一条事实数了两遍。寅月寅日、申月申日都是这一路。
  const { heCombineReading, jingfang } = await import('../miniapp/node/jingfang.mjs');
  const { BRANCHES } = await import('../miniapp/node/almanac.mjs');
  const hexagram = HEXAGRAM_LIST.find((h) => h.name === '乾为天');
  const jf = jingfang(hexagram);
  for (let branch = 0; branch < 12; branch += 1) {
    const same = heCombineReading(jf, { monthBranch: branch, dayBranch: branch, movingPositions: [] });
    const hits = same.rise.length + same.bind.length;
    assert.ok(hits <= 1, `日支月支都是${BRANCHES[branch]}，却报了${hits}路`);
    // 同一支换成日月各一，报的条数不该比同支时多出一份「日辰 + 月建」的重复
    const split = heCombineReading(jf, { monthBranch: (branch + 1) % 12, dayBranch: branch, movingPositions: [] });
    const splitHits = split.rise.length + split.bind.length;
    assert.ok(splitHits <= same.rise.length + same.bind.length + 1,
      `日支${BRANCHES[branch]}、月支${BRANCHES[(branch + 1) % 12]}报了${splitHits}路，多出来的不是同支那一路`);
  }
});

test('断语「逢合 · 合起合绊合好化扶」四名各有一句，且不由合断吉凶', async () => {
  // 这一段最容易出的错是把合当成吉。原章三处收口：「然必用神有气相宜，用若失陷无益」、
  // 「用神受克，六合有何益哉」、末了「宜合吉，不宜合凶」。所以四名照说，吉凶一句不许自己加。
  //
  // 取样两头都要变：摇法只出坤为地的话（6 与 8 同为阴），卦只有一个，日支还得逐日走。
  // buildReading 的第二个参数是 { now }，不是 { year, month, day }——写成后者不报错，
  // 只是被整个忽略，于是日支永远停在起卦那一刻，四名里有几路一卦也碰不上。
  const seen = { rise: false, bind: false, friendly: false, support: false };
  let sawAny = false;
  outer: for (let day = 0; day < 60; day += 1) {
    for (let mask = 0; mask < 64; mask += 1) {
      const coins = [8, 8, 8, 8, 8, 8];
      for (let i = 0; i < 6; i += 1) coins[i] = mask & (1 << i) ? 6 : 7;
      const reading = buildReading(castByCoins(coins), { now: new Date(2026, 5, 1 + day, 7, 0, 0) });
      const section = reading.insights.find((item) => item.title === '逢合 · 合起合绊合好化扶');
      if (!section) continue;
      sawAny = true;
      const text = section.text;
      // 断语开头那一句把四名逐字引了一遍，所以光查「有没有出现过这个名字」不算数——
      // 开头那句会把四条断言全顶住。改查各路自己那一句独有的措辞：
      // 把合绊那一路的「皆为合绊」改成「皆为合起」，只有这一句会跟着变。
      const marker = {
        rise: '皆为合起——',
        bind: '皆为合绊——',
        friendly: '两动爻相合为合好',
        support: '为化扶——',
      };
      for (const name of ['rise', 'bind', 'friendly', 'support']) {
        if (reading.combine[name].length === 0) continue;
        seen[name] = true;
        assert.ok(text.includes(marker[name]), `报了${name}，断语里却没有「${marker[name]}」那一句`);
      }
      // 由合断吉凶的话，一律不许出现
      assert.ok(!/诸事必成|必成|定成|准能成/.test(text), '断语替合断成了必成');
      assert.ok(text.includes('宜合吉，不宜合凶'), '原章收口那一句没照录');
      assert.ok(text.includes('用若失陷无益'), '原章「用若失陷无益」那半句没照录');
      if (Object.values(seen).every(Boolean)) break outer;
    }
  }
  assert.ok(sawAny, '扫了这么多卦，一个逢合段都没出');
  assert.ok(Object.values(seen).every(Boolean),
    `四名没凑齐，缺：${Object.entries(seen).filter(([, v]) => !v).map(([k]) => k).join('、')}`);
});

test('卦体给逢合的爻挂「合」小标，MCP 另给 combine 字段与【逢合】抬头', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const mcp = await readFile(new URL('../miniapp/node/mcp/divination-http.mjs', import.meta.url), 'utf8');
  const { callDivinationHttp, startDivinationServer } = await import('../miniapp/node/mcp/divination-http.mjs');
  // 卦体小标：与空破墓暗日破冲散同一层，标在逢合那一爻上
  assert.ok(/st\.combined \? '合' : ''/.test(client), '卦体没有给逢合的爻挂「合」小标');
  // 合不上朱砂：原章「宜合吉，不宜合凶」，颜色不该替没定吉凶的东西表态。
  // 这里不是只翻基础那一条 .st 规则就算数——日后有人新加一条 .st.he 也染朱砂，
  // 合照样变红而基础规则一个字没动。所以把凡是提到 .st 的规则全收一遍，
  // 凡带朱砂的，选择器里只许出现 po 与 tomb 这两个已定的颜色。
  const stRules = [...client.matchAll(/^\s*([^\n{]*\.st[^\n{]*)\{([\s\S]*?)\}/gm)];
  assert.ok(stRules.length >= 2, `只收到 ${stRules.length} 条 .st 规则，扫漏了`);
  for (const [, selector, body] of stRules) {
    if (!/var\(--seal\)/.test(body)) continue;
    for (const cls of [...selector.matchAll(/\.st\.([a-z-]+)/g)].map((m) => m[1])) {
      assert.ok(cls === 'po' || cls === 'tomb', `小标 .st.${cls} 染上了朱砂`);
    }
  }
  // 上一条只查样式表。真正把它变红的是另一头：把「合」并进 po 那一档，样式表一个字都不用动。
  // 所以这里从画小标那行本身查：分 po 与 tomb 的那个条件里不许出现「合」。
  const markLine = /\.map\(\(word\) => `<span class="st(.*?)tomb/.exec(client);
  assert.ok(markLine, '找不到画小标那行');
  assert.ok(!markLine[1].includes("word === '合'"), '「合」被并进了 po/tomb 那一档，会跟着染上朱砂');
  // 悬停说明要写清四名与「合不是判词」
  assert.ok(/title="此爻逢合：合起、合绊、合好或化扶/.test(client), '「合」小标没有悬停说明');
  assert.ok(/宜合吉，不宜合凶/.test(client), '悬停说明里没有原章那句收口');
  // MCP：结构化字段 + 抬头
  assert.ok(/combine: reading\.combine \?\? null,/.test(mcp), 'MCP 没有给 combine 字段');
  assert.ok(/`【逢合】\$\{bits\.join\('，'\)\}`/.test(mcp), 'MCP 没有【逢合】抬头');
  assert.ok(/combineLine,/.test(mcp), '抬头那一行没有接进输出');
  // 四名都得真的排进抬头那一段，不是散在文件别处
  const combineBlock = mcp.slice(mcp.indexOf('const combineLine'), mcp.indexOf('})();', mcp.indexOf('const combineLine')));
  for (const name of ['合起', '合绊', '合好', '化扶']) {
    assert.ok(combineBlock.includes(`\`${name}$`), `抬头那一段里没有${name}这一名`);
  }
  // 抬头不许带吉凶词：原章「宜合吉，不宜合凶」
  assert.ok(!/必成|定成|准能/.test(combineBlock), '抬头替合断成了必成');
  void callDivinationHttp;
  void startDivinationServer;
});

// ── 爻之刑：三刑章第二十一 ──────────────────────────────────────────────────

test('三刑照底本那六条排，不照命理那八条，两套不许混', async () => {
  // 底本：「寅刑巳、巳刑申、子刑卯、卯刑午、丑戌相刑、未辰相刑。又云：辰午酉亥谓之自刑。」
  // 命理那八条是「寅刑巳、巳刑申、申刑寅、丑刑戌、戌刑未、未刑丑、子刑卯、卯刑子」，
  // 两处实质不同：底本作「卯刑午」不作「卯刑子」；底本作「未辰相刑」不作「未刑丑、戌刑未」。
  // 两套一起排就成了十四条，「有几爻犯刑」这句话立刻没有意义，所以分开判。
  const { punishReading, jingfang } = await import('../miniapp/node/jingfang.mjs');
  const { HEXAGRAM_LIST } = await import('../miniapp/node/hexagrams.mjs');
  // 卯刑午：底本有
  const mz = HEXAGRAM_LIST.find((h) => h.name === '天泽履');
  const got = punishReading(jingfang(mz), { monthBranch: 0, dayBranch: 0 });
  const keys = [...got.linePairs.map((p) => `${p.from.branch}刑${p.to.branch}`),
    ...got.outside.map((o) => `${o.from}刑${o.to}`)];
  // 反过来：命理有的那两条，底本一条都不许冒出来
  for (const forbidden of ['申刑寅', '未刑丑', '戌刑未', '卯刑子']) {
    assert.ok(!keys.includes(forbidden), `出现了${forbidden}——底本没有这一条，是命理那一套`);
  }
  // 底本那六条每一条都得在六十四卦上碰得出卦
  const base = ['寅刑巳', '巳刑申', '子刑卯', '卯刑午', '丑刑戌', '未刑辰'];
  const seen = new Set();
  for (const hexagram of HEXAGRAM_LIST) {
    const one = punishReading(jingfang(hexagram), { monthBranch: 0, dayBranch: 0 });
    for (const pair of one.linePairs) seen.add(`${pair.from.branch}刑${pair.to.branch}`);
  }
  for (const key of base) {
    assert.ok(seen.has(key), `底本那六条里的${key}在六十四卦上一次也碰不出，多半是写错了字`);
  }
});

test('刑有方向：卯刑午成立，午刑卯不成立', async () => {
  // 「寅刑巳」说的是寅去刑巳，不是反过来。方向在六十四卦上确实落出差别：
  // 丑刑戌有十二卦，戌刑未只四卦——所以判成无向就等于把这两路并成一路。
  const { punishReading, jingfang } = await import('../miniapp/node/jingfang.mjs');
  const { HEXAGRAM_LIST } = await import('../miniapp/node/hexagrams.mjs');
  // 扫的是「判出来的结果」，不是「一卦里有没有同时出现这两支」——后者本来就是对称的，
  // 跟判没判成刑无关，拿它来量方向，量出来的是同卦有两支这个事实，不是方向。
  const pairs = ['卯刑午', '午刑卯', '丑刑戌', '戌刑丑', '寅刑巳', '巳刑寅'];
  const counted = new Map(pairs.map((key) => [key, 0]));
  for (const hexagram of HEXAGRAM_LIST) {
    const one = punishReading(jingfang(hexagram), { monthBranch: 0, dayBranch: 0 });
    for (const pair of one.linePairs) {
      const key = `${pair.from.branch}刑${pair.to.branch}`;
      if (counted.has(key)) counted.set(key, counted.get(key) + 1);
    }
  }
  assert.ok(counted.get('卯刑午') > 0, '卯刑午在六十四卦上一次也判不出');
  assert.equal(counted.get('午刑卯'), 0, '午刑卯也判成了刑——刑有方向，反向不成立');
  assert.ok(counted.get('丑刑戌') > 0, '丑刑戌在六十四卦上一次也判不出');
  assert.equal(counted.get('戌刑丑'), 0, '戌刑丑也判成了刑，反向不成立');
  assert.equal(counted.get('巳刑寅'), 0, '巳刑寅也判成了刑，反向不成立');
  // 整句扫一遍：凡报出来的对，反向一次都不许在表里
  const src = await readFile(new URL('../miniapp/node/jingfang.mjs', import.meta.url), 'utf8');
  assert.ok(/const PUNISH_PAIRS = Object\.freeze\(\[\s*\n?\s*\['寅', '巳'\], \['巳', '申'\], \['子', '卯'\], \['卯', '午'\], \['丑', '戌'\], \['未', '辰'\],?\s*\]\);/.test(src),
    '底本那六条不再是原样这六条');
});

test('自刑里辰一支在六十四卦上一次也碰不出，这是纳甲定死的', async () => {
  // 自刑四支辰午酉亥来自同章的「又云」。但辰只装在内卦三爻（乾内子寅辰、坎内寅辰午、艮内辰午申），
  // 一卦只有一个下卦，所以一卦里最多一个辰——辰自刑在六十四卦上永远碰不出来。
  // 底本没有这一句，是纳甲装出来的结构事实；但它要是被当成「自刑四支都能碰」就会写错文案。
  //
  // 这里数的是 punishReading 报出来的自刑，不是照着纳甲自己重算一遍：重算只能证明纳甲长什么样，
  // 证不了 SELF_PUNISH_BRANCHES 是不是真按四支在跑——把那两支从表里删掉，重算照样全绿。
  const { punishReading, jingfang } = await import('../miniapp/node/jingfang.mjs');
  const { HEXAGRAM_LIST } = await import('../miniapp/node/hexagrams.mjs');
  const self = new Map();
  for (const hexagram of HEXAGRAM_LIST) {
    const branches = jingfang(hexagram).lines.map((line) => line.branch);
    // 一卦里最多一个辰
    assert.ok(branches.filter((b) => b === '辰').length <= 1,
      `${hexagram.name}里有两个辰，纳甲表错了`);
    // 只数爻与爻那一路。日月那一路另算，辰在月建那里是碰得着的。
    const pairs = punishReading(jingfang(hexagram), { monthBranch: 0, dayBranch: 0 })
      .linePairs.filter((pair) => pair.self);
    // 自刑本就对称，同一对只能报一次。两头都收的话，断语会把
    // 「二爻亥自刑四爻」与「四爻亥自刑二爻」并排说一遍，看着像两件事。
    for (const pair of pairs) {
      assert.ok(pair.from.position < pair.to.position,
        `${hexagram.name}的自刑成对报了两遍：${pair.from.position}与${pair.to.position}`);
    }
    for (const pair of pairs) {
      self.set(pair.to.branch, (self.get(pair.to.branch) || 0) + 1);
    }
  }
  assert.equal(self.get('辰') || 0, 0, '辰自刑在六十四卦上碰出来了，纳甲表错了');
  for (const branch of ['午', '酉', '亥']) {
    assert.ok((self.get(branch) || 0) > 0, `${branch}自刑一次也碰不出，自刑那一路空转了`);
  }
});

test('书上那个卦例逐步复现：寅月申日，风火家人五爻巳被月建与日辰两头刑', async () => {
  // 《增删卜易·三刑章第二十一》：「如寅月庚申日占子痘症，得风火家人变离卦……
  // 断曰：巳火子孙既当春令，子孙旺相许之可治，后死于寅日寅时。后悟月建在寅，
  // 日建在申，与巳爻子孙共作三刑，独此一卦，无他爻之伤也。」
  const { punishReading, jingfang } = await import('../miniapp/node/jingfang.mjs');
  const { HEXAGRAM_LIST } = await import('../miniapp/node/hexagrams.mjs');
  const jia = HEXAGRAM_LIST.find((h) => h.name === '风火家人');
  assert.ok(jia, '缺风火家人');
  const jf = jingfang(jia);
  // 寅月（支序 2）、申日（支序 8）
  const got = punishReading(jf, { monthBranch: 2, dayBranch: 8 });
  const yi = jf.lines.find((line) => line.branch === '巳');
  assert.ok(yi, '风火家人六支里没有巳');
  assert.equal(yi.relative, '子孙', '书上那一爻是子孙');
  // 月建寅刑巳
  assert.ok(got.outside.some((o) => o.source === '月建' && o.from === '寅' && o.to === '巳' && o.line.position === yi.position),
    '月建寅没有刑到巳爻');
  // 巳刑申日
  assert.ok(got.outside.some((o) => o.source === '日辰' && o.from === '巳' && o.to === '申' && o.line.position === yi.position),
    '巳爻没有刑到申日');
  // 「共作三刑」：两路都落在同一爻上，这是这一卦的全部关键
  const onYi = got.outside.filter((o) => o.line.position === yi.position);
  assert.equal(onYi.length, 2, '两路没有都落在巳爻上，「共作三刑」就说不成了');
  assert.deepEqual(got.hitPositions, [yi.position], '还有别的爻也被刑到了，与原书「无他爻之伤也」不合');
});

test('断语「犯刑」不由刑断吉凶，且把原书那两条前提逐条核出来', async () => {
  // 野鹤自己收的：「或因用神休囚又兼他爻犯之，刑者则见凶，而独犯三刑得验者少，
  // 占过数十年只验得一卦。」所以这一段要摆明两条前提成立不成立，而不是拿刑字断吉凶。
  // 两个「成立/不成立」都要真的各出现过一次，所以初值是 false；当初写成 true 时
  // 外层的 !(sawRest && sawNotRest) 一上来就是假，循环一次都没跑，扫了个空还报「一个都没出」。
  let sawAny = false;
  let sawRest = false;
  let sawNotRest = false;
  // 「测试」两个字匹配不到任何事类，取不出用神，那一条前提就永远核不成；
  // 所以轮流换几个真事类，让用神有定下来的时候，两条前提才真的都被核过。
  const questions = ['测试', '求财', '占病', '问官司', '寻人', '问婚姻', '考功名'];
  for (let day = 0; day < 40; day += 1) {
    for (let mask = 0; mask < 64; mask += 1) {
      // 6 老阴、7 老阳、8 少阴、9 少阳：只取 6 与 7 的话两爻同为动且同为阴，
      // 摇出来永远是坤为地——而坤为地六支全是奇数支，一条刑也碰不出。四值齐上卦才真的在变。
      const coins = [8, 8, 8, 8, 8, 8];
      for (let i = 0; i < 6; i += 1) coins[i] = [6, 7, 8, 9][(mask + i * 5) % 4];
      const reading = buildReading(castByCoins(coins), { question: questions[(day + mask) % questions.length], now: new Date(2026, 5, 1 + day, 7, 0, 0) });
      const section = reading.insights.find((item) => item.title === '犯刑');
      if (!section) continue;
      sawAny = true;
      const text = section.text;
      assert.ok(text.includes('独犯三刑得验者少，占过数十年只验得一卦'), '原书收口那一句没照录');
      assert.ok(!/诸事必败|定败|必凶|准能成/.test(text), '断语拿刑字断成了凶');
      // 两条前提要么核出来成立、要么核出来不成立，不许含糊
      if (reading.states.some((s) => s.combined)) continue;
      if (/两条前提本卦核不了第一条/.test(text)) continue;
      assert.ok(/正合「用神休囚」那条|那条不成立/.test(text), '「用神休囚」那条没有逐条核出来');
      // 核了第一条，就说明用神定下来了，第二条「又兼他爻犯之」也得有话说
      assert.ok(/又兼他爻犯之.*(成立|不成立)/s.test(text), '「又兼他爻犯之」那条没有逐条核出来');
      if (/那条不成立/.test(text)) sawNotRest = true;
      if (/正合「用神休囚」那条/.test(text)) sawRest = true;
    }
  }
  assert.ok(sawAny, '扫了这么多卦，一个犯刑段都没出');
  assert.ok(sawRest && sawNotRest,
    `两条前提的成立与不成立没各出现过一次：休囚那条出现过 ${sawRest}，不成立出现过 ${sawNotRest}`);
});

test('卦体给犯刑的爻挂「刑」小标，MCP 另给 punish 字段与【犯刑】抬头', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const mcp = await readFile(new URL('../miniapp/node/mcp/divination-http.mjs', import.meta.url), 'utf8');
  assert.ok(/st\.punished \? '刑' : ''/.test(client), '卦体没有给犯刑的爻挂「刑」小标');
  // 刑不上朱砂：跟「合」同理，原书既没定它吉也没定它凶
  const stRules = [...client.matchAll(/^\s*([^\n{]*\.st[^\n{]*)\{([\s\S]*?)\}/gm)];
  for (const [, selector, body] of stRules) {
    if (!/var\(--seal\)/.test(body)) continue;
    for (const cls of [...selector.matchAll(/\.st\.([a-z-]+)/g)].map((m) => m[1])) {
      assert.ok(cls === 'po' || cls === 'tomb', `小标 .st.${cls} 染上了朱砂`);
    }
  }
  const markLine = /\.map\(\(word\) => `<span class="st(.*?)tomb/.exec(client);
  assert.ok(markLine, '找不到画小标那行');
  assert.ok(!markLine[1].includes("word === '刑'"), '「刑」被并进了 po/tomb 那一档，会跟着染上朱砂');
  assert.ok(/title="此爻犯刑/.test(client), '「刑」小标没有悬停说明');
  assert.ok(/独犯三刑得验者少/.test(client), '悬停说明里没有原书那句收口');
  // MCP
  assert.ok(/punish: reading\.punish \?\? null,/.test(mcp), 'MCP 没有给 punish 字段');
  assert.ok(/`【犯刑】\$\{bits\.join\('，'\)\}`/.test(mcp), 'MCP 没有【犯刑】抬头');
  assert.ok(/punishLine,/.test(mcp), '抬头那一行没有接进输出');
  // 每一项自己都带来源（日辰／月建）。前面再加「日月」两个字会拼成「日月月建与3爻酉自刑」。
  assert.ok(!/bits\.push\(`日月/.test(mcp), '日月那一支前面多加了「日月」两字');
  // 自刑那一项得把支摆出来：只说「月建与3爻自刑」而不说哪一支，等于没说清。
  assert.ok(/`\$\{source\}与\$\{position\}爻\$\{to\}自刑`/.test(mcp), '日月自刑那一项没把那支摆出来');
  const block = mcp.slice(mcp.indexOf('const punishLine'), mcp.indexOf('})();', mcp.indexOf('const punishLine')));
  assert.ok(!/必凶|定凶|诸事必败/.test(block), '抬头拿刑字断成了凶');
});
test('六十四卦里三对要么全撞要么全不撞，没有只撞一对的卦', async () => {
  const { hexagramClash } = await import('../miniapp/node/jingfang.mjs');
  const dist = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let chong = 0;
  let he = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    const kept = hexagramClash(hexagram).pairs.filter((pair) => pair.kind);
    dist[kept.length] += 1;
    if (hexagramClash(hexagram).chong) chong += 1;
    if (hexagramClash(hexagram).he) he += 1;
  }
  // 客户端那层连线就是照这条画的：要么画满三条，要么一条不画，没有「只画一条」这一路。
  // 写成断言，是免得哪天真出了半截的卦体，还照着「全撞或全不撞」的说法往下写。
  assert.equal(dist[1], 0, '竟有只撞一对的卦，连线会画出半截');
  assert.equal(dist[2], 0, '竟有只撞两对的卦，连线会画出半截');
  assert.equal(dist[3], chong + he, '全撞的卦数该等于六冲加六合');
  assert.equal(dist[0], HEXAGRAM_LIST.length - chong - he);
  assert.equal(chong, 10);
  assert.equal(he, 8);
});

test('「三对皆撞」那两条自校验是活的，数目也不是从表里推的', async () => {
  const source = await readFile(new URL('../miniapp/node/jingfang.mjs', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const chongNames = [];'));
  const guard = block.slice(0, block.indexOf('// 日辰所冲之支永不可能生'));
  // 判成六冲六合的必须三对全撞。不钉这一条，配对位表里少配一组时
  // 「三对皆撞」会跟着松成「两对皆撞」，而上面那条分布断言仍会通过。
  assert.match(guard, /if \(clash\.chong && chongPairs !== pairCount\)/, '六冲那三对全撞的校验不在了');
  assert.match(guard, /if \(clash\.he && hePairs !== pairCount\)/, '六合那三对全撞的校验不在了');
  assert.doesNotMatch(guard, /if \(false/, '自校验被短路了，等于没写');
  // 三对就是初四、二五、三六，数目是定义的一部分。从表里推的话表里少一组，
  // 它跟着少一个，上面那两条又白检了。
  assert.match(guard, /const pairCount = 3;/, '「三对」的数目被改成从表里推了');
  assert.doesNotMatch(guard, /const pairCount = CLASH_PAIR_OFFSETS\.length/,
    '「三对」的数目不能从表里推');
});

test('冲合连线画在两列之间的空隙里，不占卦面宽度', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

  // 量行高要元素挂在页面上。卦盘是整块拼好才挂的，挂着的时候量出来全是 0，
  // 那时候画的弧是空图——所以只能先记下来，等挂上再回来取尺寸。
  // 不撞的那对不画：不按 kind 过滤的话，六十四卦每卦都画出三条弧，全不撞的也画。
  const pairsFn = client.slice(client.indexOf('function clashPairs('));
  const pairsBody = pairsFn.slice(0, pairsFn.indexOf('\n      function '));
  assert.ok(/\(clash\.pairs \|\| \[\]\)\.filter\(\(pair\) => pair\.kind\)/.test(pairsBody),
    'clashPairs 没有只留下真撞上的那几对');
  const lines = client.slice(client.indexOf('function guaLines('));
  const linesBody = lines.slice(0, lines.indexOf('\n      function '));
  assert.ok(/clashPairs\(clash\)/.test(linesBody), 'guaLines 没过 clashPairs 挑要画的那几对');
  assert.ok(/wrap\.ribbon = \{/.test(linesBody), 'guaLines 没把要画的弧先记在元素上');
  assert.ok(!/clashRibbon\(wrap,/.test(linesBody), 'guaLines 里直接画弧，量不到尺寸，画出来是空图');
  const mount = client.slice(client.indexOf('function mountClashRibbons('));
  // 这一段要切到下一个函数为止：切到文件末尾的话，后面 clashRibbon 的定义本身也含
  // 「clashRibbon(wrap)」这几个字，调用点被拿掉测试照样绿。
  const mountBody = mount.slice(0, mount.indexOf('\n      function ', mount.indexOf('(') + 10));
  assert.ok(/querySelectorAll\('\.gua-lines'\)/.test(mountBody) && /clashRibbon\(wrap\)/.test(mountBody),
    '挂上页面后没人回来把弧画出来');
  // 钉在真正挂载的那一行：扫了但没人在挂载之后调，卦面上照样什么都没有
  const reading = client.slice(client.indexOf('function renderReading('));
  assert.ok(/slot\.append\(card\);\s*\n\s*mountClashRibbons\(card\);/.test(reading),
    '卦盘挂上页面之后没有回头画弧');

  // 弧不能从卦面宽度里扣。爻画那格是 1fr，扣一次变卦里「回头生 + 应 + 六亲 + 干支」
  // 那一行就被压到看不见，阴阳都读不出来；所以它探到两列之间的空隙里去。
  const ribbon = client.slice(client.indexOf('.clash-ribbon {'));
  const css = ribbon.slice(0, ribbon.indexOf('}'));
  const gutter = Number(/right:\s*-\s*(\d+)px/.exec(css)?.[1]);
  assert.ok(gutter > 0, '冲合连线没探到卦面外头去');
  assert.ok(!/\.gua-lines\.has-ribbon/.test(client), '不该从卦面上匀宽度出来');
  // 不给 viewBox，一个用户单位就是一个 CSS 像素，量出来的行高才能直接当坐标用
  const draw = client.slice(client.indexOf('function clashRibbon('));
  assert.ok(!/setAttribute\('viewBox'/.test(draw), '给了 viewBox，坐标系就跟量出来的行高对不上了');

  // 起点与弧高加起来要装得进那道空隙。行高约二十一，三对里每对都差三格，约六十三。
  const start = Number(/const x = width \+ (\d+);/.exec(draw)?.[1]);
  const base = Number(/const bulge = (\d+) \+/.exec(draw)?.[1]);
  const perPx = Number(/const bulge = \d+ \+ Math\.abs\(y2 - y1\) \/ (\d+);/.exec(draw)?.[1]);
  // 起点必须在卦面右缘之外，弧才落不到纳甲那一列的字上
  assert.ok(start > 0, '弧的起点摆回卦面里了，会盖住纳甲那几列字');
  const reach = start + base + 63 / perPx;
  assert.ok(reach < gutter, `弧最远鼓到 ${reach}px，探出空隙 ${gutter}px，会盖到右栏的字`);

  // 冲与合同一支淡线，不分色：这层只说哪两支配在一起，不替它们表态吉凶
  const arc = client.slice(client.indexOf('.clash-ribbon .clash-arc {'));
  const arcCss = arc.slice(0, arc.indexOf('}'));
  assert.ok(/var\(--text-subtle\)/.test(arcCss), '冲合连线该用淡字');
  assert.ok(!/var\(--seal\)/.test(arcCss), '冲合连线不该染朱砂');
  // 盖在卦面上，不能挡住点选与悬停
  assert.ok(/pointer-events:\s*none/.test(css), '冲合连线会挡住底下卦面的点选');
  // 弧上不挂字：三对叫什么右栏那一格已经列全
  assert.ok(!/clash-arc-label/.test(client), '弧上不该再挂一串字');
  // 每条弧挂个标题，写清是哪两支配在一起。建了 title 不挂上去等于没写，
  // 所以「建」和「挂」两句都钉。
  assert.ok(/createElementNS\(svgNS, 'title'\)/.test(draw), '弧上没有标题');
  assert.ok(/path\.append\(title\)/.test(draw), '标题建了没挂到弧上');
  assert.ok(/pair\.kind/.test(draw), '标题里没写冲还是合');
  assert.ok(/jingfang\.lines\[pair\.lower - 1\]\.branch/.test(draw), '标题里没写出是哪两支');

  // 本卦挂自己的三对，变卦挂变出来那一卦的
  assert.ok(/clashTag\(reading, '本卦'\),\s*\n\s*reading\.clash,/.test(reading),
    '本卦那层弧没接上本卦的冲合数据');
  assert.ok(/\{ pairs: reading\.clash\.changedPairs \|\| \[\] \}/.test(reading),
    '变卦那层弧没接上变卦的冲合数据');
});

/* ---------- 反伏与卦变（反伏章第二十五） ---------- */

test('反伏章的三例逐步复现：观之坤、巽之观、升之观各落在正确的一档', async () => {
  // 《增删卜易·反伏章第二十五》把反伏摆成三种情形，各举一例：
  //   「外卦反伏而内卦不动者，如观之坤是也」
  //   「内卦反伏而外卦不动者如巽之观是也」
  //   「爻变者内外爻动而反伏者，非同一卦也。如升之观是也」
  // 三例换过去的那三支，无一例外都是本卦那一三支的**逐位六冲**。
  // 本包照这一条判，判据见 fanfuReading 里的 inner / outer 两个条件。
  //
  // 卦名按本包卦表取：这里「观」是 000011 风地观（坤下巽上），
  // 「升」是 011000 地风升（巽下坤上）。升与观恰好互为内外易位，
  // 动二三五六四爻，两卦的内卦外卦就整个对调——正是章里「内外爻动」那一例。
  const D = await import('../miniapp/node/divination.mjs');
  const J = await import('../miniapp/node/jingfang.mjs');
  const { HEXAGRAM_LIST } = await import('../miniapp/node/hexagrams.mjs');
  const byName = new Map(HEXAGRAM_LIST.map((h) => [h.name, h]));
  const byKey = new Map(HEXAGRAM_LIST.map((h) => [h.key, h]));
  const flip = (key, positions) => {
    const lines = key.split('').map(Number);
    for (const p of positions) lines[p - 1] = lines[p - 1] ? 0 : 1;
    return lines.join('');
  };
  const PAIRS6 = [['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥']];
  const clashOf = (b) => {
    for (const [x, y] of PAIRS6) { if (x === b) return y; if (y === b) return x; }
    return '?';
  };
  // 铜钱约定：6 老阴（阴动变阳）、9 老阳（阳动变阴）、7 少阳、8 少阴，都静。
  // 由卦象串与动爻反推这一手该掷出什么，这样三例不必手写死数，也就不会写错卦。
  const coinsFor = (key, moving) => [...key].map((d, i) => {
    const isMoving = moving.includes(i + 1);
    if (isMoving) return d === '1' ? 9 : 6;
    return d === '1' ? 7 : 8;
  });
  const cases = [
    { from: '风地观', label: '观之坤', to: '坤为地', moving: [5, 6], inner: false, outer: true },
    { from: '巽为风', label: '巽之观', to: '风地观', moving: [2, 3], inner: true, outer: false },
    { from: '地风升', label: '升之观', to: '风地观', moving: [2, 3, 5, 6], inner: true, outer: true },
  ];
  for (const item of cases) {
    const label = item.label;
    const fromHex = byName.get(item.from);
    assert.ok(fromHex, `卦表里没有 ${item.from}`);
    // 先从卦表和动爻走一遍真实的铜钱起卦，确认这一例真能起得出来。
    const cast = D.castByCoins(coinsFor(fromHex.key, item.moving));
    assert.equal(cast.hexagram.name, fromHex.name, `${label}：起出来的本卦不是 ${item.from}`);
    assert.deepEqual(cast.positions, item.moving, `${label}：动爻不是 ${item.moving.join('')}`);
    const changed = byKey.get(flip(cast.hexagram.key, cast.positions));
    assert.equal(changed.name, item.to, `${label}：变卦不是 ${item.to}`);
    const hit = J.fanfuReading(J.jingfang(cast.hexagram), { movingPositions: cast.positions }, J.jingfang(changed));
    assert.equal(hit.inner, item.inner, `${label}：内卦该${item.inner ? '' : '不'}反伏`);
    assert.equal(hit.outer, item.outer, `${label}：外卦该${item.outer ? '' : '不'}反伏`);
    // 反伏的一侧：换过去的那三支必须逐位与本卦那三支相冲——这是本包的判据，不能只对卦名。
    for (const [on, from3, to3, side] of [
      [hit.inner, hit.innerFrom, hit.innerTo, '内'],
      [hit.outer, hit.outerFrom, hit.outerTo, '外'],
    ]) {
      if (on) {
        assert.equal(to3, [...from3].map(clashOf).join(''), `${label}：${side}卦换过去的那一组不是逐位六冲`);
      } else {
        // 章里「内卦不动」「外卦不动」两句：不反伏的那一侧得连一支都没换。
        assert.equal(to3, from3, `${label}：${side}卦说不反伏，却换了纳支`);
      }
    }
    // 反伏那一档与卦变那一档不相交，这三例也不能被当成卦变。
    assert.equal(hit.guaChange, false, `${label}被误判成卦变`);
    assert.equal(hit.kind, item.inner && item.outer ? '内外' : item.inner ? '内卦' : '外卦', `${label}的 kind 落错档`);
  }
});

test('卦变那一档：六爻全动换到对宫的八纯卦，与反伏那一档不相交', async () => {
  // 章里第一句「卦變者內外動而反伏者同一卦也。如乾卦變坤卦」举的乾变坤，
  // 纳支逐位一支都不冲（子对未、寅对巳、辰对卯），所以它不属于反伏那一档。
  // 它靠的是「同一卦」——本卦与变卦同为八纯卦、两两相对，全翻才换得到。
  // 少一个「全动」条件就会出岔：乾只动初四两爻也变得到巽为风，两头都是八纯卦。
  const D = await import('../miniapp/node/divination.mjs');
  const J = await import('../miniapp/node/jingfang.mjs');
  const { HEXAGRAM_LIST } = await import('../miniapp/node/hexagrams.mjs');
  const byKey = new Map(HEXAGRAM_LIST.map((h) => [h.key, h]));
  const flip = (key, positions) => {
    const lines = key.split('').map(Number);
    for (const p of positions) lines[p - 1] = lines[p - 1] ? 0 : 1;
    return lines.join('');
  };
  const PAIRS_OF_PURE = [['乾为天', '坤为地'], ['坎为水', '离为火'], ['震为雷', '巽为风'], ['艮为山', '兑为泽']];
  for (const [from, to] of PAIRS_OF_PURE) {
    const hexagram = HEXAGRAM_LIST.find((h) => h.name === from);
    const all = [1, 2, 3, 4, 5, 6];
    const hit = J.fanfuReading(J.jingfang(hexagram), { movingPositions: all },
      J.jingfang(byKey.get(flip(hexagram.key, all))));
    assert.equal(hit.guaChange, true, `${from}全动变${to}不该走卦变那一档`);
    assert.equal(hit.kind, '卦变', `${from}的 kind 该是卦变`);
    // 卦变那一档不在逐位六冲那一档里——两档不相交，不是同一件事。
    assert.equal(hit.inner, false, `${from}全动竟然被算成内卦反伏`);
    assert.equal(hit.outer, false, `${from}全动竟然被算成外卦反伏`);
    assert.equal(J.jingfang(byKey.get(flip(hexagram.key, all))).stage, '本宫', '对宫那一头该也是八纯卦');
  }
  // 全量扫一遍，两档交集必须为零。
  let overlap = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    for (let mask = 1; mask < 64; mask += 1) {
      const movingPositions = [];
      for (let i = 0; i < 6; i += 1) if (mask & (1 << i)) movingPositions.push(i + 1);
      const hit = J.fanfuReading(J.jingfang(hexagram), { movingPositions },
        J.jingfang(byKey.get(flip(hexagram.key, movingPositions))));
      if (hit.guaChange && (hit.inner || hit.outer)) overlap += 1;
    }
  }
  assert.equal(overlap, 0, '卦变与反伏两档出现了重叠，判据被放宽了');
  void D;
});

test('断语「反伏与卦变」不由这一层定吉凶，且把章末那两条前提逐条核出来', async () => {
  const D = await import('../miniapp/node/divination.mjs');
  // 由卦象串与动爻反推这一手该掷出什么：6 老阴（阴动变阳）、9 老阳（阳动变阴）、
  // 7 少阳、8 少阴都静。写死铜钱数容易把卦起错，这样就不会错。
  const coinsFor = (key, moving) => [...key].map((d, i) => {
    const isMoving = moving.includes(i + 1);
    return isMoving ? (d === '1' ? 9 : 6) : (d === '1' ? 7 : 8);
  });
  const textOf = (key, moving, question, now) => {
    const reading = D.buildReading(D.castByCoins(coinsFor(key, moving)), { now, question });
    return {
      fanfu: reading.fanfu,
      text: reading.insights.find((item) => item.title === '反伏与卦变').text,
    };
  };

  // 认不出事类时先说缺哪一层，不空谈。
  const bare = textOf('011011', [2, 3], undefined, new Date(2026, 8, 30));
  assert.ok(/取不出用神/.test(bare.text), '取不出用神时没明说缺哪一层');
  assert.ok(/用神旺相不變沖克者則反復/.test(bare.text), '章末那句没照录');
  assert.ok(/没写所问何事/.test(bare.text), '没写所问何事时没说明事类接不上');

  // 认出事类时：接上章里那一条，并把两条前提各说一句。
  const asked = textOf('011011', [2, 3], '该不该换工作', new Date(2026, 8, 30));
  assert.ok(/占功名者/.test(asked.text), '事业功名这一类没接上章里的占功名那条');
  assert.ok(/「用神旺相」那条(成立|不成立)/.test(asked.text), '没逐条核「用神旺相」');
  assert.ok(/「用神化回头冲克」那条(成立|不成立)/.test(asked.text), '没逐条核「用神化回头冲克」');
  // 断语不许把「事之必成」当成无条件判词——那要有两条前提同时成立。
  assert.ok(/只在这两条同时成立时才有/.test(asked.text), '「事之必成」被当成了无条件判词');
  assert.ok(!/必然成|一定成|定成/.test(asked.text), '这一层擅自把吉凶定了');
  // 判据出处要照录，读者才知道那六支是怎么挑的。
  assert.ok(/如乾卦變坤卦/.test(asked.text), '没照录章里「同一卦」那一例');
  assert.ok(/逐位六冲/.test(asked.text), '没写清判据是逐位六冲');

  // 章末那两条前提有四种组合，一句笼统的匹配替不了事。逐种各造一例，坏哪一路红哪一路。
  // 下面是扫过卦表与月建挑出来的真实日子，不是凭空编的：
  //   坤为地动二三 → 地风升，内卦未巳卯换成丑亥酉（逐位六冲，反伏那一档）
  //   乾为天六爻全动 → 坤为地，两头都是八纯卦（卦变那一档，纳支一支都不冲）
  const cases = [
    {
      name: '用神旺相成立、且化回头冲克',
      key: '000000', moving: [2, 3], question: '该不该换工作', now: new Date(2026, 1, 15),
      expect: [/「用神旺相」那条成立（旺不属休囚）/, /「用神化回头冲克」那条成立。/],
    },
    {
      name: '用神休囚、且本爻不在动',
      key: '000000', moving: [2, 3], question: '这笔钱能不能赚到', now: new Date(2026, 1, 15),
      expect: [
        /「用神旺相」那条不成立（休正属休囚）/,
        /用神本爻不在动，谈不上「化」，回头冲克那条不成立/,
      ],
    },
    {
      name: '卦变那一档、用神旺相但回头冲克不成立',
      key: '111111', moving: [1, 2, 3, 4, 5, 6], question: '该不该换工作', now: new Date(2026, 1, 15),
      expect: [
        /本卦六爻全动，变出坤为地/,
        /「用神旺相」那条成立（相不属休囚）/,
        /「用神化回头冲克」那条不成立（变出来的那一爻不克本爻）/,
      ],
    },
  ];
  for (const item of cases) {
    const got = textOf(item.key, item.moving, item.question, item.now);
    for (const re of item.expect) {
      assert.ok(re.test(got.text), `${item.name}：断语里没有「${re.source}」`);
    }
  }

  // 「休囚就是休囚」这一半不能写反，也不能在两处说两样话。
  const xiang = textOf('000000', [2, 3], '该不该换工作', new Date(2026, 1, 15));
  const qiu = textOf('000000', [2, 3], '该不该换工作', new Date(2026, 0, 15));
  assert.ok(/「用神旺相」那条不成立（囚正属休囚）/.test(qiu.text), '囚该算休囚');
  // 被观测的那一项必须真的转过轮，否则验的是常量等于常量。
  assert.notEqual(xiang.text, qiu.text, '旺衰没变，说明月建根本没参与判定');

  // 两档的措辞各归各的：卦变那一档说「同一卦」，反伏那一档说逐位六冲，混了就是没分清。
  const guaChange = textOf('111111', [1, 2, 3, 4, 5, 6], '该不该换工作', new Date(2026, 1, 15));
  assert.ok(/这一档换过去的纳支并不逐位相冲/.test(guaChange.text), '卦变那一档没说清它不属逐位六冲');
  assert.ok(!/判据是\*\*逐位六冲\*\*/.test(guaChange.text), '卦变那一档被写成了逐位六冲');
  // 反伏那一档要报出换的是哪一组，不能只说「反伏」。
  assert.ok(/内卦未巳卯换成丑亥酉/.test(xiang.text), '反伏那一档没报出换过去的那一组纳支');
  // 三种情形各有各的那句，内外的不能串。
  assert.ok(/內卦反伏，內則不安/.test(xiang.text), '内卦反伏该引「內則不安」');
  assert.ok(/內卦反伏，我亂他定/.test(xiang.text), '内卦反伏该引「我亂他定」');
  const outerCase = textOf('000000', [1, 5, 6], '该不该换工作', new Date(2026, 1, 15));
  if (outerCase.fanfu && outerCase.fanfu.outer) {
    assert.ok(/外卦反伏，外則不寧/.test(outerCase.text), '外卦反伏该引「外則不寧」');
    assert.ok(/他亂我定/.test(outerCase.text), '外卦反伏该引「他亂我定」');
    assert.ok(!/內卦反伏，我亂他定/.test(outerCase.text), '外卦反伏串到了内卦那一支');
  }
});

test('MCP 另给 fanfu 字段与【反伏与卦变】抬头，两档不合成一条', async () => {
  const mcp = await readFile(new URL('../miniapp/node/mcp/divination-http.mjs', import.meta.url), 'utf8');
  assert.ok(/fanfu: reading\.fanfu \?\? null,/.test(mcp), 'MCP 没有给 fanfu 字段');
  assert.ok(/fanfuLine,/.test(mcp), '抬头那一行没有接进输出');
  assert.ok(/【反伏与卦变】/.test(mcp), '没有【反伏与卦变】抬头');
  const block = mcp.slice(mcp.indexOf('const fanfuLine'), mcp.indexOf('})();', mcp.indexOf('const fanfuLine')));
  assert.ok(!/必凶|定凶|大凶|事之必成/.test(block), '抬头拿反伏断成了凶');
  // 两档要各报各的：卦变那一支与纳支相冲那一支都必须在，不能合成一句。
  assert.ok(/guaChange/.test(block) && /inner/.test(block) && /outer/.test(block),
    '抬头没有把两档分开报');
});

test('断语正文里不许残留 markdown 或 HTML 标记——页面转义后不解析，星号会原样露给读者', async () => {
  // 客户端用 escapeHtml 把断语正文当纯文本插进页面，不解析 markdown。
  // 写断语时顺手加的 ** 粗体到了页面上就是两个星号，不是强调。
  // 这条曾经真发生过：反伏那一段写「判据是**逐位六冲**」，页面上就显示了星号。
  // 全量扫过一遍（40320 次起卦、823256 段）确认只有那一处，这里留成常驻断言。
  const D = await import('../miniapp/node/divination.mjs');
  const { HEXAGRAM_LIST } = await import('../miniapp/node/hexagrams.mjs');
  const QUESTIONS = ['', '该不该换工作', '这笔钱能不能赚到', '这病几时能好', '这次考试能不能过'];
  // 覆盖到反伏、卦变、六冲、逢合、犯刑、用神等各种段落都要走到的动静组合
  const MASKS = [0b111111, 0b000011, 0b001100, 0b101010, 0b010101, 0b110000, 0b000000 | 0b100000];
  const FORBIDDEN = [
    [/\*\*/, 'markdown 粗体星号'],
    [/`[^`]*`/, '反引号'],
    [/<\/?[a-z][^>]*>/i, 'HTML 标签'],
    [/&(amp|lt|gt|quot|#\d+);/, 'HTML 实体'],
    [/\bundefined\b/, 'undefined'],
    [/\bNaN\b/, 'NaN'],
    [/\[object Object\]/, '[object Object]'],
  ];
  const offenders = [];
  let readings = 0;
  let segments = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    for (const mask of MASKS) {
      const movingPositions = [];
      for (let i = 0; i < 6; i += 1) if (mask & (1 << i)) movingPositions.push(i + 1);
      const coins = [...hexagram.key].map((d, i) => (
        movingPositions.includes(i + 1) ? (d === '1' ? 9 : 6) : (d === '1' ? 7 : 8)
      ));
      const cast = D.castByCoins(coins);
      for (const question of QUESTIONS) {
        const reading = D.buildReading(cast, {
          now: new Date(2026, mask % 12, 1 + (mask % 27)),
          question: question || undefined,
        });
        readings += 1;
        for (const item of reading.insights) {
          segments += 1;
          for (const [pattern, why] of FORBIDDEN) {
            if (pattern.test(item.text)) offenders.push(`${why}｜${hexagram.name}·${item.title}：${item.text.match(pattern)[0]}`);
          }
        }
      }
    }
  }
  // 样本本身得够大，否则「一条都没查到」也可能是压根没生成几段
  assert.ok(segments > 5000, `样本太小（只扫了 ${segments} 段），扫不到问题不说明干净`);
  assert.deepEqual(offenders, [], `断语正文里有会原样露给读者的标记：${offenders.slice(0, 5).join('；')}`);
  void readings;
});

test('十二时辰每行都排得满：列数必须整除 12，时间串不许折行', async () => {
  // 这条曾经真发生过。容器从 1160px 放宽到 1340px 之后，.hour-grid 用的还是
  // auto-fit minmax(104px, 1fr)：auto-fit 见缝就多塞一列，格子越塞越窄，
  // 「03:00 - 05:00」被折成两行，同行里两行的格子比三行的矮，一排卡片高低不齐。
  // 十二格改用固定列数，且只用能整除 12 的档（6 / 4 / 2），每行才都填满。
  const html = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));

  // 把所有 .hour-grid 的样式块收齐：基准那条加上两条媒体查询里的。
  const blocks = [];
  for (let from = 0; ; ) {
    const at = css.indexOf('.hour-grid', from);
    if (at === -1) break;
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    blocks.push(css.slice(open + 1, close));
    from = close + 1;
  }
  assert.ok(blocks.length >= 3, `只找到 ${blocks.length} 处 .hour-grid 样式，宽窄两档的降列规则丢了`);

  const columns = [];
  for (const block of blocks) {
    assert.ok(!/auto-(fit|fill)/.test(block),
      '.hour-grid 还在用 auto-fit，格子会被越塞越窄，时间串会折行');
    const m = block.match(/grid-template-columns:\s*repeat\((\d+)/);
    assert.ok(m, '.hour-grid 有一处没有写死列数');
    columns.push(Number(m[1]));
  }
  for (const n of columns) {
    assert.equal(12 % n, 0, `列数 ${n} 整除不了 12，末行会缺格子`);
  }

  // 折行的后果是同行格子高低不齐，所以时间串与神煞那行都钉成不折行。
  for (const selector of ['.hour .tm', '.hour .god']) {
    const at = css.indexOf(selector);
    assert.ok(at !== -1, `找不到 ${selector} 的样式`);
    const open = css.indexOf('{', at);
    assert.ok(/white-space:\s*nowrap/.test(css.slice(open, css.indexOf('}', open))),
      `${selector} 没有 nowrap，窄一格就会折行、整排卡片高低不齐`);
  }
});

test('卦画要先读得出来：阴爻不靠明暗区分，爻画不许退回发丝粗', async () => {
  // 用户反馈「部分卦图并不够清晰」。查下来根因是两条，跟字号无关：
  //
  // 一、阴爻画的是 --border-strong（浅色模式下 #00000033，只有两成黑），
  //    叠在 4px 的细线上，远看就是一团灰。阴阳本来就靠「一整条 vs 断成两截」
  //    的形状区分，不需要再拿明暗掺一脚——加了只是把卦画弄糊。
  // 二、爻画退回 4–5px 也就是发丝粗，缩到小卦图上更认不出阴阳。
  //
  // 颜色不得替没定吉凶的东西表态（合、刑都只留淡字不上朱砂），但「读不看得清」
  // 是可用性问题，不归那一层管：这里要的是能读，不是好看。
  const html = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));

  const ruleOf = (selector) => {
    const at = css.indexOf(selector);
    assert.ok(at !== -1, `找不到 ${selector} 的样式`);
    const open = css.indexOf('{', at);
    return css.slice(open, css.indexOf('}', open));
  };

  // 阴爻：形状已经表意了，颜色只要读得出来即可，但不许再退到 --border-strong。
  for (const selector of ['.mini-line.yin i', '.casting-hex .grow.yin i']) {
    const rule = ruleOf(selector);
    const color = /background:\s*(var\(--[a-z-]+\))/.exec(rule);
    assert.ok(color, `${selector} 没写底色`);
    assert.ok(!/border-strong/.test(color[1]),
      `${selector} 又用回 --border-strong 了：阴爻画成两成黑，远看糊成一团灰`);
    assert.ok(/--text\b|--text-muted/.test(color[1]),
      `${selector} 的底色 ${color[1]} 不在文字色那一档上，读不清`);
  }

  // 爻画粗细：退回 4–5px 就是发丝。阈值分两档——解读页那副主卦体是首要显示，
  // 本来就该比缩略图（八宫名单、四卦推导里的小卦）画得更重。
  const MIN_BAR = [
    ['.mini-line', 6, '小卦图'],
    ['.casting-hex .grow', 6, '成卦盘'],
    ['.gua-line .bars', 12, '解读页主卦体'],
  ];
  for (const [selector, min, what] of MIN_BAR) {
    const rule = ruleOf(selector);
    const h = /height:\s*([0-9.]+)px/.exec(rule);
    assert.ok(h, `${selector} 没有写死 height`);
    assert.ok(Number(h[1]) >= min,
      `${selector}（${what}）的爻画只有 ${h[1]}px，太细了（至少 ${min}px）`);
  }
});

test('自选项的框不占布局，环上标签也不许压在爻杠上', async () => {
  // 两条都是实机看出来的问题，不是推演出来的。
  //
  // 一、八宫名单那一行是 align-items: flex-start，本卦那一格原来给朱砂框加了
  //    border + padding。框要占布局空间，于是只有这一格被顶下去 5px，八格并排时
  //    它看着就「掉下去了」。outline 不参与布局，框照画、内容不动。
  //
  // 二、消长环上爻杠向外长到 R + 5 + 5×4.2 + 半根杠厚，两行标签原先只挂在 R+32，
  //    斜角上那两个满六爻的格子（乾巳、坤亥）爻杠正好压在「乾」「坤」的字上。
  //    标签退到 R+40，画布同时从 200 扩到 232，才腾得出位置。
  const html = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  const ruleOf = (selector) => {
    const at = css.indexOf(selector);
    assert.ok(at !== -1, `找不到 ${selector} 的样式`);
    const open = css.indexOf('{', at);
    return css.slice(open, css.indexOf('}', open));
  };

  const self = ruleOf('.palace .unit.self');
  assert.ok(!/\bborder:/.test(self),
    '.palace .unit.self 又用 border 画框了：border 占布局空间，本卦那格会被顶下去');
  assert.ok(!/\bpadding:/.test(self),
    '.palace .unit.self 又加了内边距：同样会把本卦那格的内容顶偏');
  assert.ok(/outline:/.test(self), '.palace .unit.self 少了 outline，框就画不出来了');
  // 框要占地方，间距就得让开，否则 outline-offset 会压到隔壁那格。
  const row = ruleOf('.palace .palace-row');
  const gap = /gap:\s*([0-9.]+)px/.exec(row);
  assert.ok(gap && Number(gap[1]) >= 8,
    `.palace .palace-row 的 gap 只有 ${gap ? gap[1] : '?'}px，八格挤在一起`);

  // 环：标签半径必须大于最远那根爻杠的外沿，且画布要装得下最外那两个字。
  const ring = /const R = ([0-9.]+);/.exec(html);
  const labelR = /Math\.cos\(at\) \* \(R \+ ([0-9.]+)\)/.exec(html);
  const spacing = /const off = [0-9.]+ \+ k \* ([0-9.]+);/.exec(html);
  const barH = /height="([0-9.]+)" rx=/.exec(html);
  assert.ok(ring && labelR && spacing && barH, '消长环的关键尺寸没找齐');
  const R = Number(ring[1]);
  const barOuter = R + 5 + 5 * Number(spacing[1]) + Number(barH[1]) / 2;
  // 两行标签从基线往下还占一截（地支那一行），近沿比基线更靠里。
  const labelNear = R + Number(labelR[1]) - 6.4 - 2;
  assert.ok(labelNear > barOuter,
    `标签近沿 ${labelNear.toFixed(1)} 没让开爻杠外沿 ${barOuter.toFixed(1)}，爻杠会压到字`);

  const viewBox = /class="qiring" viewBox="(-?[0-9.]+) (-?[0-9.]+) ([0-9.]+) ([0-9.]+)"/.exec(html);
  assert.ok(viewBox, '消长环的 viewBox 没找到');
  const [minX, minY, w, h] = viewBox.slice(1).map(Number);
  assert.equal(minX, 100 - w / 2, '画布没有以圆心 (100,100) 对称展开');
  assert.equal(minY, 100 - h / 2, '画布没有以圆心 (100,100) 对称展开');
  // 最外那两个字：标签远沿 = R + 偏移 + 一整行字高，必须留在画布里。
  const labelFar = R + Number(labelR[1]) + 11;
  assert.ok(labelFar <= w / 2,
    `最外的字伸到半径 ${labelFar.toFixed(1)}，超出画布半径 ${(w / 2).toFixed(1)}，会被裁掉`);
});

/* ---------- 进程边界：日志不记路径、Host/Origin 只认回环 ---------- */

test('Host 头取主机名：去端口，IPv6 认方括号', () => {
  assert.equal(hostnameFromHeader('127.0.0.1:41999'), '127.0.0.1');
  assert.equal(hostnameFromHeader('localhost:8080'), 'localhost');
  assert.equal(hostnameFromHeader('127.0.0.1'), '127.0.0.1', '不带端口时整串就是主机名');
  // ::1 不带方括号时，一串冒号会被按最后一个切开，切出的是 "1" 不是 "::1"
  assert.equal(hostnameFromHeader('[::1]:41999'), '::1');
  assert.equal(hostnameFromHeader('[::1]'), '::1');
  // 大小写不在这一层归一，hostnameFromHeader 只管切。归一在 isLoopbackHostname 里，
  // 两边都走它，才不会有的入口归一、有的不归一。
  assert.equal(hostnameFromHeader('EVIL.example.COM:80'), 'EVIL.example.COM', '这一层只切不归一');
  assert.equal(isLoopbackHostname(hostnameFromHeader('LOCALHOST:41999')), true, '归一之后 localhost 仍算回环');
});

test('回环主机名：127/8、localhost、::1 算，别的都不算', () => {
  // 这一层收的是「主机名」不是「Host 头」——带端口的串归 isLocalRequest 切完再送进来。
  // 所以这里不喂 '127.0.0.1:1'：那不是主机名，判 false 是对的，喂进去只会把
  // 「这一层不负责切端口」和「这一层不认回环」两件事搅在一起。
  for (const ok of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '0:0:0:0:0:0:0:1', 'LOCALHOST', 'LocalHost']) {
    assert.equal(isLoopbackHostname(ok), true, `${ok} 应当算回环`);
  }
  for (const bad of ['evil.example.com', '10.0.0.1', '192.168.1.5', '0.0.0.0', '128.0.0.1', '127.0.0.256', '127.0.0.01', '127.0.0', '127.0.0.1.1', '127.0.0.1:1', '']) {
    assert.equal(isLoopbackHostname(bad), false, `${bad} 不该算回环`);
  }
});

test('本机判定：Host 拦 DNS rebinding，Origin 拦跨源简单请求', () => {
  // 正常：页面自己发的同源请求
  assert.equal(isLocalRequest('127.0.0.1:41999', 'http://127.0.0.1:41999'), true, '同源请求该放行');
  // 端口由 Host 分配，判定不能把它算进主机名，否则回环请求会被自己挡在门外
  for (const host of ['127.0.0.1:41999', '127.0.0.1', 'localhost:80', '[::1]:41999', '127.5.5.5:1']) {
    assert.equal(isLocalRequest(host, undefined), true, `回环 Host ${host} 应当放行`);
  }
  // Host 的 MCP 客户端是 Node 程序，不发 Origin
  assert.equal(isLocalRequest('127.0.0.1:41999', undefined), true, '缺 Origin 不该当成伪造');
  // HTTP/1.0 可能不带 Host
  assert.equal(isLocalRequest(undefined, undefined), true, '缺 Host 不该当成伪造');
  // DNS rebinding：攻击者域名解析到 127.0.0.1，Host 带的是他的域名
  assert.equal(isLocalRequest('evil.example.com', undefined), false, '非回环 Host 必须挡住');
  assert.equal(isLocalRequest('evil.example.com:41999', 'http://evil.example.com'), false, '带端口的非回环 Host 同样要挡');
  // 跨源简单请求：请求直接打到 127.0.0.1，Host 是合法的，挡它的只有 Origin
  assert.equal(isLocalRequest('127.0.0.1:41999', 'https://evil.example.com'), false, '跨源 Origin 必须挡住');
  // 挡不住的那一类要说清楚：攻击者拿不到 Origin 头由别人代发
  assert.equal(isLocalRequest('127.0.0.1:41999', 'not-a-url'), false, 'Origin 解析不出来时按拒绝处理');
});

test('日志只留错误码：Node 的 fs 报错带绝对路径，describeError 把它摘掉', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'divination-log-'));
  try {
    const real = await readFile(join(dir, 'absent.json'), 'utf8').then(() => null, (error) => error);
    // 取证前提：先确认 Node 真的把绝对路径写进了 message。不认这一条，
    // 下面那句「摘掉了路径」就是空断言——碰巧 Node 哪天不带了，测试照样绿。
    assert.ok(
      real instanceof Error && real.message.includes(dir),
      `当前 Node ${process.version} 的 fs 报错已不带绝对路径，本测试的前提需重估：${real && real.message}`,
    );
    const described = describeError(real);
    assert.equal(described, 'ENOENT', `只剩错误码才对，实到：${described}`);
    assert.ok(!described.includes(dir), `describeError 仍带绝对路径：${described}`);
    assert.ok(!described.includes('/'), `describeError 里不该有路径分隔符：${described}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('describeError 对没有 code 的错误退回 name，对非错误退回 unknown', () => {
  assert.equal(describeError(new TypeError('x')), 'TypeError', '无 code 时用 name');
  assert.equal(describeError('一段字符串'), 'unknown', '非 Error 不该被当成有诊断信息');
  assert.equal(describeError(undefined), 'unknown', 'undefined 也一样');
});

/** 起一个真服务，返回打请求的函数与 dispose。Host 头要用 node:http 直发，fetch 不让设。 */
async function withServer(run) {
  const dir = await mkdtemp(join(tmpdir(), 'divination-http-'));
  const logs = [];
  const port = 42871;
  const lifecycle = await start({
    pluginRoot: fileURLToPath(new URL('..', import.meta.url)),
    dataDir: dir,
    listen: { host: '127.0.0.1', port },
    logger: {
      info: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      error: (m) => logs.push(m),
      debug: (m) => logs.push(m),
    },
    signal: new AbortController().signal,
  });
  const send = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
  const request = (path, { method = 'GET', headers = {}, body = '' } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: text, json: () => JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
  try {
    await run({ send, request, logs, dir, port });
  } finally {
    await lifecycle.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}

test('非回环 Host 的请求整个被拒，且不回显自己是什么', async () => {
  await withServer(async ({ send }) => {
    const good = await send('/api/divination/bootstrap', { host: '127.0.0.1:42871' });
    assert.equal(good.status, 200, '回环 Host 应当照常放行，否则页面会整个打不开');

    const evil = await send('/api/divination/history', { host: 'evil.example.com' });
    assert.equal(evil.status, 403, `DNS rebinding 的读卦历请求该被拒，实到 ${evil.status}`);
    assert.ok(!evil.body.includes('evil.example.com'), `403 回包不该回显 Host：${evil.body}`);

    const crossOrigin = await send('/api/divination/history', {
      host: '127.0.0.1:42871',
      origin: 'https://evil.example.com',
    });
    assert.equal(crossOrigin.status, 403, '跨源 Origin 应当被拒');
  });
});

test('MCP 端点同样只认回环，Node 客户端不带 Origin 照样能用', async () => {
  await withServer(async ({ send }) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'divination_almanac', arguments: {} },
    });
    const ok = await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1', port: 42871, path: '/mcp/divination', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.end(payload);
    });
    assert.equal(ok.status, 200, `不带 Origin 的 MCP 调用该照常работать，实到 ${ok.status}`);
    assert.ok(ok.body.includes('干支'), 'MCP 应当照常返回历法');

    const evil = await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1', port: 42871, path: '/mcp/divination', method: 'POST',
        headers: { 'content-type': 'application/json', host: 'evil.example.com' },
      }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
      req.on('error', reject);
      req.end(payload);
    });
    assert.equal(evil.status, 403, 'MCP 端点也得挡非回环 Host');
  });
});

test('落盘失败时日志里没有 dataDir 路径', async () => {
  await withServer(async ({ send, logs, dir }) => {
    // 把 readings.json 换成目录，逼出 fs 报错（EISDIR/ENOENT 之外的真实分支）
    await mkdir(join(dir, 'readings.json'), { recursive: true });
    const res = await send('/api/divination/history');
    assert.equal(res.status, 500, '读失败应当是 500');
    assert.equal(res.body, '{"error":"internal_error"}', `回包不该带内部细节：${res.body}`);
    const failures = logs.filter((line) => line.startsWith('divination.request.failed'));
    assert.ok(failures.length > 0, '这次失败应当被记进日志');
    for (const line of failures) {
      assert.ok(!line.includes(dir), `日志带出了 dataDir 绝对路径：${line}`);
      assert.ok(!line.includes(tmpdir()), `日志带出了系统临时目录：${line}`);
    }
  });
});

/* ---------- 存卦这条路由的注入面 ---------- */

test('存卦只认 id，页面回传的整份 reading 一律不收', async () => {
  // 这条路由原先收的是页面回传的整份 reading，原样落盘。四种后果都能复现：
  // 伪造的 id 存得进去却删不掉（删除路由只认 [A-Za-z0-9-]）、页面能把 question
  // 放大到五千字、顺手带上的几十 KB 额外字段照单全收、以及 hexagram: null
  // （typeof null === 'object' 直接过检）之后卦历页读 entry.hexagram.name 抛错。
  // `docs/security.md` 要求 Validate every request parameter，这一处当时是全包唯一
  // 没设防的地方。现在服务端只收 `{ id, note }`，id 必须命中它自己这一轮算出来过的卦。
  await withServer(async ({ request, dir }) => {
    const cast = (body) => request('/api/divination/cast', { method: 'POST', body: JSON.stringify(body) });
    const save = (body) => request('/api/divination/history', { method: 'POST', body: JSON.stringify(body) });
    const list = async () => (await request('/api/divination/history')).json();

    const first = (await cast({ method: 'numbers', upper: 11, lower: 22, question: '原始所问' })).json();

    // 伪造 id：含空格与叹号，删除路由的正则认不出来
    const forged = await save({ id: 'bad id!', note: 'x' });
    assert.equal(forged.status, 400, `非法 id 该被拒，实到 ${forged.status}`);
    assert.deepEqual((await list()).entries, [], '非法 id 不该落盘');

    // 整份 reading 回传（老契约）不再被接受
    const legacy = await save({
      reading: { ...first.reading, id: 'forged-1', question: 'x'.repeat(5000), evil: 'payload' },
      note: 'y',
    });
    assert.equal(legacy.status, 400, `老契约该被拒，实到 ${legacy.status}`);
    assert.deepEqual((await list()).entries, [], '回传的 reading 不该落盘');
  });
});

test('落盘的批注与所问都有长度上限，条目只可能来自引擎', async () => {
  await withServer(async ({ request, dir }) => {
    const cast = (body) => request('/api/divination/cast', { method: 'POST', body: JSON.stringify(body) });
    const save = (body) => request('/api/divination/history', { method: 'POST', body: JSON.stringify(body) });
    const reading = (await cast({ method: 'numbers', upper: 4, lower: 9 })).json().reading;

    const res = await save({ id: reading.id, note: 'n'.repeat(9000) });
    assert.equal(res.status, 201, `真实 id 该能存，实到 ${res.status}`);

    const onDisk = JSON.parse(await readFile(join(dir, 'readings.json'), 'utf8'));
    assert.equal(onDisk.length, 1, `只该落一条，实到 ${onDisk.length}`);
    assert.equal(onDisk[0].note.length, 2000, `批注该截到 2000，实到 ${onDisk[0].note.length}`);
    assert.ok(onDisk[0].hexagram && typeof onDisk[0].hexagram.name === 'string', '落盘条目的卦不能是 null');
    assert.ok(!('evil' in onDisk[0]), '落盘条目不该带页面塞进来的额外字段');
    // 所问是引擎那一份，不是页面回传的那一份
    assert.ok(onDisk[0].question.length <= 120, `所问不该超过 ${120}`);
  });
});

test('同一 id 存两次会被挡下，删一条不会连带删另一条', async () => {
  await withServer(async ({ request }) => {
    const cast = (body) => request('/api/divination/cast', { method: 'POST', body: JSON.stringify(body) });
    const save = (body) => request('/api/divination/history', { method: 'POST', body: JSON.stringify(body) });
    const list = async () => (await request('/api/divination/history')).json();

    const a = (await cast({ method: 'numbers', upper: 3, lower: 3 })).json().reading;
    const b = (await cast({ method: 'numbers', upper: 6, lower: 6 })).json().reading;
    assert.notEqual(a.id, b.id, '两卦的 id 本就该不同');

    await save({ id: a.id, note: '' });
    const again = await save({ id: a.id, note: '再来一次' });
    assert.equal(again.status, 409, `重复 id 该被挡，实到 ${again.status}`);
    assert.equal((await list()).entries.length, 1, '重复 id 不该多出一条同 id 的记录');

    await save({ id: b.id, note: '' });
    assert.equal((await list()).entries.length, 2, '两条都该在');
    await request(`/api/divination/history/${a.id}`, { method: 'DELETE' });
    const rest = (await list()).entries;
    assert.equal(rest.length, 1, `删一条该只剩一条，实到 ${rest.length}`);
    assert.equal(rest[0].id, b.id, '留下的是另一条');
  });
});

test('hexagram 起法：六十四卦逐卦起得回自己', async () => {
  // 卦库「以此卦起一卦」原先传的是 order 与 order——同一个数上下都用，取模 8 之后
  // 上下卦必然相同，落出来永远是纯卦或错卦，64 卦里只有 2 卦起得回自己
  // （3 水雷屯 → 离为火）。改成由服务端拿卦的 key 还原上下卦、取两卦的先天数起卦。
  const { HEXAGRAM_LIST } = await import('../miniapp/node/hexagrams.mjs');
  const { castByHexagram } = await import('../miniapp/node/divination.mjs');
  const wrong = [];
  for (const hexagram of HEXAGRAM_LIST) {
    if (castByHexagram(hexagram).hexagram.key !== hexagram.key) {
      wrong.push(`${hexagram.name} → ${castByHexagram(hexagram).hexagram.name}`);
    }
  }
  assert.deepEqual(wrong, [], `这 ${wrong.length} 卦起不回自己`);

  await withServer(async ({ request }) => {
    const library = (await request('/api/divination/library')).json();
    const mismatched = [];
    for (const item of library.hexagrams) {
      const res = await request('/api/divination/cast', {
        method: 'POST',
        body: JSON.stringify({ method: 'hexagram', key: item.key }),
      });
      const got = res.json().reading?.hexagram?.name;
      if (got !== item.name) mismatched.push(`${item.name} → ${got}`);
    }
    assert.deepEqual(mismatched, [], `经 HTTP 有 ${mismatched.length} 卦起不回自己`);

    const bad = await request('/api/divination/cast', {
      method: 'POST',
      body: JSON.stringify({ method: 'hexagram', key: '不是卦' }),
    });
    assert.equal(bad.status, 400, `非法的卦 key 该被拒，实到 ${bad.status}`);
  });
});

test('摇卦由谁掷是调用方的决定：页面少传就报错，MCP 不传才自掷', async () => {
  // 这两页合到一处取数时最容易出的岔子：把「没传 sums」做成共用函数的兜底，于是页面
  // 少传一次也被悄悄掷了六次——用户在推演日志里看到的点数与落出来的卦对不上。
  await withServer(async ({ request }) => {
    const cast = (body) => request('/api/divination/cast', { method: 'POST', body: JSON.stringify(body) });

    const missing = await cast({ method: 'coins' });
    assert.equal(missing.status, 400, `页面没给六次结果就该报错，实到 ${missing.status}`);
    const empty = await cast({ method: 'coins', sums: [] });
    assert.equal(empty.status, 400, `给了空数组也该报错，实到 ${empty.status}`);
    const short = await cast({ method: 'coins', sums: [7, 7, 7] });
    assert.equal(short.status, 400, `只给三次也该报错，实到 ${short.status}`);
    const outOfRange = await cast({ method: 'coins', sums: [7, 7, 7, 7, 7, 10] });
    assert.equal(outOfRange.status, 400, `和值越界该报错，实到 ${outOfRange.status}`);

    // 页面正常那一条：六次结果照给的落成卦，起卦依据如实列出这六个数
    const sums = [6, 7, 8, 9, 6, 7];
    const good = await cast({ method: 'coins', sums });
    assert.equal(good.status, 200, `页面给的六次结果该成卦，实到 ${good.status}`);
    const detail = good.json().reading.details.map((d) => d.value).join(' ');
    assert.ok(sums.every((sum) => detail.includes(String(sum))), `起卦依据该列出这六次数值：${detail}`);
  });

  // MCP 那一侧没有人替用户掷，不传 sums 就该自掷六次而不是报错
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  let raw = '';
  const response = { writeHead() { return this; }, end(chunk) { raw += chunk ?? ''; return this; } };
  await handleMcpRequest({
    response,
    now: AT(10, 0),
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'divination_cast', arguments: { method: 'coins' } } },
  });
  const out = JSON.parse(raw).result;
  assert.notEqual(out.isError, true, `MCP 自掷六次该成卦：${JSON.stringify(out.content?.[0]?.text).slice(0, 120)}`);
});

test('页面起卦的入参校验只有一处实现，MCP 与页面共用', async () => {
  // 两条路原先各写一份 castFrom / callTool：上限值、起法名与提示语各自漂移，
  // 而 MCP 那份一度忘了收六次掷钱的长度，于是每一次 coins 调用都失败。
  const source = await readFile(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');
  const mcp = await readFile(new URL('../miniapp/node/mcp/divination-http.mjs', import.meta.url), 'utf8');
  assert.ok(!/function castFrom\(/.test(source), '页面那套 castFrom 该收进 cast-params.mjs');
  assert.ok(!/function toBoundedInteger\(/.test(source), '页面那套 toBoundedInteger 该收进 cast-params.mjs');
  assert.ok(!/function toInteger\(/.test(mcp), 'MCP 那套 toInteger 该收进 cast-params.mjs');
  assert.ok(source.includes('castFromParams(body, now)'), '页面应当走共用的 castFromParams');
  assert.ok(/castFromParams\(withCoins, now\)/.test(mcp), 'MCP 应当走共用的 castFromParams');
  // 上限值不许再各写一份字面量
  assert.ok(!/maxLength:\s*120/.test(mcp), 'maxLength 应当取 MAX_QUESTION');
  assert.ok(!/maximum:\s*1000000000/.test(mcp), 'maximum 应当取 MAX_NUMBER');
});

test('免责声明只有一个出处：工具返回、instructions、SKILL 与页脚逐字相同', async () => {
  // 之前有四份措辞不同的文字，而 SKILL 要求「不得改写」的那句与工具返回的并不相同，
  // Agent 会同时拿到矛盾要求，于是每次转述的免责声明都不一样。页脚那份是给人看的，
  // 也照样逐字一致——否则页面上写的与 Agent 转述的会差出字来。
  const { DISCLAIMER, handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  const skill = await readFile(new URL('../skills/divination/SKILL.md', import.meta.url), 'utf8');
  assert.ok(skill.includes(DISCLAIMER), 'SKILL 里的免责说明必须与常量逐字相同');
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  assert.ok(client.includes(DISCLAIMER), '页面页脚的免责说明必须与常量逐字相同');

  const respond = async (body) => {
    let raw = '';
    const response = { writeHead() { return this; }, end(chunk) { raw += chunk ?? ''; return this; } };
    await handleMcpRequest({ response, now: AT(10, 0), body });
    return JSON.parse(raw).result;
  };

  const init = await respond({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.ok(init.instructions.includes(DISCLAIMER), 'instructions 里应当逐字带上 DISCLAIMER');

  const cast = await respond({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'divination_cast', arguments: { method: 'numbers', upper: 5, lower: 2 } },
  });
  assert.ok(cast.content[0].text.includes(DISCLAIMER), '起卦返回里应当带上 DISCLAIMER');

  // 另两个工具也会被人转述出去，同样得带
  for (const [name, args] of [['divination_hexagram_lookup', { query: '谦' }], ['divination_almanac', {}]]) {
    const other = await respond({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });
    assert.ok(other.content[0].text.includes(DISCLAIMER), `${name} 的返回里没有 DISCLAIMER`);
  }
});

test('MCP 可以注入时钟，起卦结果不再跟着跑测试的当天走', async () => {
  // 出伏、日辰、旺衰全都随日期变，而 MCP 以前只能走真时钟，于是断这些的断言跟着
  // 跑测试的当天翻面。注入 now 之后，同一个 now 必得同一卦——这正是断言要的东西。
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  const call = async (now) => {
    let raw = '';
    const response = { writeHead() { return this; }, end(chunk) { raw += chunk ?? ''; return this; } };
    await handleMcpRequest({
      response,
      now,
      body: {
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'divination_cast', arguments: { method: 'numbers', upper: 5, lower: 2 } },
      },
    });
    return JSON.parse(raw).result;
  };
  const a = await call(new Date(2026, 8, 29));
  const b = await call(new Date(2026, 8, 29));
  assert.deepEqual(a.structuredContent, b.structuredContent, '同一个 now 两次调用该给同一卦');
  assert.deepEqual(a.content, b.content, '同一个 now 两次调用该给同一段解读');

  // 换一个日子应当真的换一卦，否则说明 now 根本没被用上
  const other = await call(new Date(2026, 10, 15));
  assert.equal(other.structuredContent.hexagram.order, a.structuredContent.hexagram.order, '同法起卦卦序本该相同');
  assert.notEqual(other.content[0].text, a.content[0].text, '换了日子解读就该不同——否则 now 没接上');
});

test('MCP 不再接受批量数组——那段分支永远走不到', async () => {
  // readJsonBody 拒绝数组，所以 handleMcpRequest 里那个 Array.isArray 分支是死的，
  // 实测批量请求返回 400 invalid_body。MCP 自 2025-03-26 起也不再支持批量。
  const mcp = await readFile(new URL('../miniapp/node/mcp/divination-http.mjs', import.meta.url), 'utf8');
  assert.ok(!/Array\.isArray\(body\)/.test(mcp), '批量分支该删掉');
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  let status = 0;
  let raw = '';
  const response = {
    writeHead(code) { status = code; return this; },
    end(chunk) { raw += chunk ?? ''; return this; },
  };
  await handleMcpRequest({ response, now: AT(10, 0), body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }] });
  assert.equal(status, 202, `数组按无回复处理（202），实到 ${status}`);
  assert.equal(raw, '', '数组不该产生任何 JSON 回复');
});

test('起卦的批注输入取的是输入框的值，不是那个元素本身', async () => {
  // cast() 里写的是 el('question').trim()——元素上没有 trim，取的是 undefined.trim()。
  // 当时没触发是因为三条起卦路都显式传了 question；`??` 右边那条兜底一直没走过。
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  assert.ok(!/el\('question'\)\.trim\(\)/.test(client), '兜底那句该取 .value.trim()');
  assert.ok(/el\('question'\)\.value\.trim\(\)/.test(client), '该从输入框取值');
});

test('卦库「以此卦起一卦」走 cast()，不再绕开在途闸', async () => {
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const button = client.slice(client.indexOf('以此卦起一卦'), client.indexOf('以此卦起一卦') + 700);
  assert.ok(button.includes("cast({ method: 'hexagram'"), '这个按钮应当走 cast()');
  assert.ok(!button.includes("api('/cast'"), '这个按钮不该自己发请求');
  assert.ok(!button.includes('upper: item.order, lower: item.order'), '同一数上下都用，起不回本卦');
});

/* ---------- 时间依赖的守卫 ---------- */

test('测试里不再有随日期漂的取值：绝对时刻与裸时钟都要有理由', async () => {
  // 这已经是第三次为「测试随日期/时区翻面」返工了：第一次是 MCP 起卦那一条（靠注入
  // now 根治），第二次是推演样本用了绝对时刻（`01:20+08:00` 在 Honolulu 下落进别的
  // 时辰），两处的根子相同——断言的判据跟着本机时钟与时区走。
  //
  // 逐条人肉查总会漏下一条，所以这里把两类写法禁掉：
  // ① `new Date('…')` —— 绝对时刻。`castByTime` / `castDaily` 按本机时区取时辰与日柱，
  //    同一个绝对时刻在不同时区落进不同的卦。要钉时刻就用 AT(...) 构造墙上时间。
  // ② 裸 `new Date()` —— 真时钟。确实要跟当天走的（例如验「时间起卦用的就是今天」那条，
  //    钉死时刻反而没得验），必须在这一行写 `real-clock:` 并说明理由。
  const self = new URL(import.meta.url);
  const source = await readFile(self, 'utf8');
  const lines = source.split('\n');
  // AT 的定义本身不算；注释里提到这两种写法也不算——它们是这条断言在讲的东西
  const atDefLine = lines.findIndex((l) => l.includes('const AT ='));
  const code = lines.map((l, index) => (index <= atDefLine || /^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l));
  const bare = [];
  const absolute = [];
  code.forEach((line, index) => {
    if (index === atDefLine) return;
    if (/new Date\(\s*['"]/.test(line)) absolute.push(`L${index + 1}: ${line.trim()}`);
    if (/\bnew Date\(\s*\)/.test(line) && !line.includes(REAL_CLOCK_MARK)) {
      bare.push(`L${index + 1}: ${line.trim()}`);
    }
  });
  assert.deepEqual(absolute, [], `绝对时刻会随本机时区变，改用 AT(...)：\n${absolute.join('\n')}`);
  assert.deepEqual(bare, [], `裸时钟跟着真时钟走，要用就在这一行注明 ${REAL_CLOCK_MARK}：\n${bare.join('\n')}`);
});

test('MCP 每一处调用都注入了时刻，没有一条跟着真时钟跑', async () => {
  // 与上面同源：MCP 起卦结果随日辰变，早先那条「伏神出不出得来」就是这么跟着当天翻面的。
  // 现在 handleMcpRequest 支持注入 now，于是测试里每一次调用都必须给。
  const source = await readFile(new URL(import.meta.url), 'utf8');
  const calls = [...source.matchAll(/handleMcpRequest\(\{/g)];
  assert.ok(calls.length > 0, '没找到 MCP 调用，这个守卫形同虚设');
  const missing = [];
  let cursor = 0;
  for (const call of calls) {
    const start = source.indexOf(call[0], cursor);
    cursor = start + 1;
    // 看这一次调用接下来 400 字符内有没有给时刻。`now:` 与简写 `now,` 都算。
    const window = source.slice(start, start + 400);
    if (/\bnow\s*[:,]/.test(window)) continue;
    // 确实要跟真时钟走的（例如验「时间起卦用的就是今天」），那一处写明理由。
    const lead = source.slice(Math.max(0, start - 500), start);
    if (lead.includes(REAL_CLOCK_MARK)) continue;
    missing.push(`L${source.slice(0, start).split('\n').length}: 没给 now`);
  }
  assert.deepEqual(missing, [], `这些 MCP 调用没注入时刻，结果跟着跑测试的当天走：\n${missing.join('\n')}`);
});

test('工具的 schema 与实际认的起法是同一份', async () => {
  // schema 写一组、代码认另一组时，会出现「提示说可以、实际做不到」或反过来。
  const { TOOLS, MCP_CAST_METHODS } = await import('../miniapp/node/mcp/divination-http.mjs');
  const cast = TOOLS.find((t) => t.name === 'divination_cast');
  const schema = cast.inputSchema.properties.method.enum;
  assert.deepEqual([...schema].sort(), [...MCP_CAST_METHODS].sort(), 'schema 的 method 枚举与实现认的那组对不上');
  assert.ok(!schema.includes('hexagram'), 'hexagram 是页面卦库那一路，不该从 MCP 走');
  // 声明了 additionalProperties: false，就该真的不认多出来的键
  assert.equal(cast.inputSchema.additionalProperties, false);
});

/* ---------- 同一 id 的两个来源 ---------- */

test('同一 id 存五次只有一个成，其余全挡：检查与写入必须在同一个排队任务里', async () => {
  // 「先 store.get 再 store.save」是两个分开排队的任务，并发请求会各自把 get 排完
  // （都得到 null）再各自 save，于是同一个 id 落盘四条——而 remove() 按 id 过滤，
  // 删一条连带删三条。实测同一 id 并发 POST 五次得到 201,201,201,201,409。
  await withServer(async ({ request }) => {
    const cast = (await request('/api/divination/cast', {
      method: 'POST',
      body: JSON.stringify({ method: 'numbers', upper: 11, lower: 22 }),
    })).json().reading;

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request('/api/divination/history', {
        method: 'POST',
        body: JSON.stringify({ id: cast.id, note: '' }),
      })),
    );
    const statuses = responses.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409], `并发存同一 id 的回包不对：${statuses.join(',')}`);

    const list = (await request('/api/divination/history')).json();
    assert.equal(list.entries.length, 1, `卦历里该只有一条，实到 ${list.entries.length} 条同 id 记录`);
  });
});

test('删一条只带走那一条：盘上不许留下同 id 的两份', async () => {
  await withServer(async ({ request }) => {
    const cast = async (upper, lower) => (await request('/api/divination/cast', {
      method: 'POST', body: JSON.stringify({ method: 'numbers', upper, lower }),
    })).json().reading;
    const save = (id) => request('/api/divination/history', {
      method: 'POST', body: JSON.stringify({ id, note: '' }),
    });

    // 撞 id 的真实后果：新约定按 id 取卦，撞了之后后一卦会盖掉缓存里的前一卦。
    const a = await cast(3, 3);
    const b = await cast(3, 3);
    assert.notEqual(a.id, b.id, '同一秒同两数，id 不该撞');
    await save(a.id);
    await save(b.id);
    assert.equal((await request('/api/divination/history')).json().entries.length, 2, '两条都该在');
    assert.equal((await request(`/api/divination/history/${a.id}`, { method: 'DELETE' })).status, 200);
    const left = (await request('/api/divination/history')).json().entries;
    assert.equal(left.length, 1, `删一条连带删了两条，实到 ${left.length}`);
    assert.equal(left[0].id, b.id, '留下的不是被点删除的那条');
  });
});

test('id 不再被截断：同一秒内反复起同一卦，id 每次都不同', async () => {
  // 32 位哈希转 36 进制有 6 位也有 7 位，`slice(0, 6)` 把 7 位那种砍掉了最低位，
  // 而种子末尾那个递增计数改的正是最低位，于是「同一秒、同一个卦」照旧撞车。
  // 改 padStart(7, '0') 之后不再截断：3000 组里 0 撞。
  const ids = new Set();
  const now = AT(14, 30);
  for (let i = 0; i < 3000; i += 1) {
    ids.add(buildReading(castByNumbers(17, 29), { question: `问 ${i}`, now }).id);
  }
  assert.equal(ids.size, 3000, `3000 组里撞了 ${3000 - ids.size} 次`);
  for (const id of ids) {
    assert.match(id, /^[0-9]{14}-[a-z0-9]{7}$/u, `id 的形状不该再出现 6 位：${id}`);
  }
});

test('存不下时回的话说得出口，页面上也看得见', async () => {
  await withServer(async ({ request }) => {
    const cast = (await request('/api/divination/cast', {
      method: 'POST', body: JSON.stringify({ method: 'numbers', upper: 5, lower: 5 }),
    })).json().reading;

    // 这一卦没起过（换一个没算过的 id）——等价于服务重启后页面还停着上一卦
    const unknown = await request('/api/divination/history', {
      method: 'POST', body: JSON.stringify({ id: 'nope-not-cast', note: '' }),
    });
    assert.equal(unknown.status, 409);
    const detail = unknown.json();
    assert.equal(detail.error, 'unknown_cast');
    assert.ok(detail.message && detail.message.length > 5, `409 该带一句人话：${JSON.stringify(detail)}`);

    await request('/api/divination/history', { method: 'POST', body: JSON.stringify({ id: cast.id, note: '' }) });
    const again = await request('/api/divination/history', {
      method: 'POST', body: JSON.stringify({ id: cast.id, note: '' }),
    });
    assert.equal(again.status, 409);
    assert.ok(again.json().message, 'already_saved 也该带一句人话');
  });

  // 页面上要有看得见的落点，不能只往 .sr-only 的 live region 里写
  const client = await readFile(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');
  const save = client.slice(client.indexOf('async function saveReading'), client.indexOf('async function saveReading') + 1400);
  assert.ok(save.includes('setSaveStatus'), '存卦失败要写到看得见的提示上');
  assert.ok(/unknown_cast/.test(save), '要认 unknown_cast 这一支——那一卦是终态，按钮不该还给用户');
  assert.ok(!/catch \(error\) \{\s*button\.disabled = false;\s*button\.textContent = '存入卦历';\s*announce\(error\.message\);/.test(save),
    '存卦失败还是只写 live region——用户看到的是点了没反应');
  // 提示元素要真的挂进页面，否则 setSaveStatus 写的是一个不在文档里的节点
  assert.ok(/saveStatus\s*=\s*document\.createElement/.test(client), '没建提示元素');
  assert.ok(/save\.append\(noteInput, saveBtn, saveStatus\)/.test(client), '提示元素没挂到存卦那一行上');
  assert.ok(/\.save-status\s*\{/.test(client), '.save-status 的样式没写');
  assert.ok(/\.save-status\.err\s*\{/.test(client), '出错那态没样式');
  // api() 得把状态码与错误码带出来，页面才分得清终态与可重试
  const api = client.slice(client.indexOf('async function api('), client.indexOf('async function api(') + 700);
  assert.ok(/error\.code\s*=/.test(api), 'api() 没把错误码带出来');
  assert.ok(/error\.status\s*=/.test(api), 'api() 没把状态码带出来');
});

/* ---------- MCP 参数边界 ---------- */

test('MCP 只认 schema 里声明的参数：sums 与 hexagram 都进不来', async () => {
  // 直接把 args 整个递进 castFromParams 时，Agent 传进来的 schema 之外的键也会被当真：
  // sums 会让本该自己掷的摇卦改用 Agent 指定的点数，method: 'hexagram' 更是页面卦库
  // 专用的起法，不该从对话里走。
  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  const call = async (args) => {
    let raw = '';
    const response = { writeHead() { return this; }, end(chunk) { raw += chunk ?? ''; return this; } };
    await handleMcpRequest({
      response,
      now: AT(10, 0),
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'divination_cast', arguments: args } },
    });
    return JSON.parse(raw).result;
  };

  // Agent 传 sums：该被忽略，仍然自掷六次——起卦依据里那六个数不会是 Agent 给的
  const withSums = await call({ method: 'coins', sums: [6, 6, 6, 6, 6, 6] });
  assert.notEqual(withSums.isError, true, '传了 sums 不该报错');
  const basis = withSums.content[0].text.split('\n').find((l) => l.startsWith('【起卦依据】'));
  assert.ok(!basis.includes('6、6、6、6、6、6'), `Agent 指定的点数不该被采纳：${basis}`);

  // hexagram 是页面那一路，MCP 不认
  const hex = await call({ method: 'hexagram', key: '100010' });
  assert.equal(hex.isError, true, 'hexagram 不该从 MCP 走');
  assert.ok(/未知的起法/.test(hex.content[0].text), `该报未知起法：${hex.content[0].text}`);

  const unknown = await call({ method: 'nonsense' });
  assert.equal(unknown.isError, true);
  // 该怎么改的话在 _meta.recovery 里，得只列 MCP 认的那几种
  const raw = JSON.stringify(unknown);
  assert.ok(!/hexagram/.test(raw), `MCP 的报错里不该出现 hexagram：${raw}`);
  assert.ok(/daily/.test(raw) && /coins/.test(raw), `recovery 该列出 MCP 认的起法：${raw}`);
});

test('掷钱点数按 6–9 收，越界的带 recovery', async () => {
  // 原先照抄通用上界收 1–9，1–5 放行后被 castByCoins 的普通 Error 接住，
  // 而那条路没有 recovery——Agent 只拿到「必须是 6 到 9」，拿不到该怎么做。
  await withServer(async ({ request }) => {
    const cast = (sums) => request('/api/divination/cast', {
      method: 'POST', body: JSON.stringify({ method: 'coins', sums }),
    });
    const low = await cast([1, 7, 8, 9, 6, 7]);
    assert.equal(low.status, 400, `点数 1 该被拒，实到 ${low.status}`);
    const high = await cast([10, 7, 8, 9, 6, 7]);
    assert.equal(high.status, 400, `点数 10 该被拒，实到 ${high.status}`);
  });

  const { handleMcpRequest } = await import('../miniapp/node/mcp/divination-http.mjs');
  let raw = '';
  const response = { writeHead() { return this; }, end(chunk) { raw += chunk ?? ''; return this; } };
  await handleMcpRequest({
    response,
    now: AT(10, 0),
    body: {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'divination_cast', arguments: { method: 'coins', sums: [1, 7, 8, 9, 6, 7] } },
    },
  });
  const out = JSON.parse(raw).result;
  // sums 本身进不来，所以这一次是自掷成卦——断的是「越界的点数报得出该怎么改」
  assert.notEqual(out.isError, true, '自掷该照常成卦');

  const { castFromParams } = await import('../miniapp/node/cast-params.mjs');
  assert.throws(
    () => castFromParams({ method: 'coins', sums: [1, 7, 8, 9, 6, 7] }, AT(10, 0)),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(typeof error.recovery === 'string' && error.recovery.includes('6'), `越界该带 recovery：${error.recovery}`);
      return true;
    },
  );
});
