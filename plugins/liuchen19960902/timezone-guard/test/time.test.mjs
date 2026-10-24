import { test } from 'node:test';
import assert from 'node:assert/strict';

import time from '../miniapp/client/time.js';

const { STORAGE_KEY, resolveZone, periodOf, bandOf, parseOffset, formatDiff, dayDelta } = time;

/**
 * 这里测的是 miniapp/client/time.js —— 浏览器和 Node 跑的是同一份源码，
 * 不是复制出来的另一份。app.js 用到的档位判定、偏移解析、时差文案
 * 都走这里，改坏了这里就会红。
 */

test('bandOf: 四个阈值都落在整点上，前一分钟归上一档', () => {
  // 深夜 22:00–06:00
  assert.equal(bandOf(0, 0), 'night');
  assert.equal(bandOf(5, 59), 'night');
  assert.equal(bandOf(23, 59), 'night');
  // 清晨 06:00–09:00（归黄）
  assert.equal(bandOf(6, 0), 'dawn');
  assert.equal(bandOf(8, 59), 'dawn');
  // 白天 09:00–18:00
  assert.equal(bandOf(9, 0), 'day');
  assert.equal(bandOf(17, 59), 'day');
  // 傍晚 18:00–22:00
  assert.equal(bandOf(18, 0), 'dusk');
  assert.equal(bandOf(21, 59), 'dusk');
  // 深夜 22:00 起
  assert.equal(bandOf(22, 0), 'night');
});

test('bandOf: 每一分钟都只属于一个档，且四档都出现', () => {
  const seen = new Set();
  for (let minute = 0; minute < 24 * 60; minute++) {
    const band = bandOf(Math.floor(minute / 60), minute % 60);
    assert.ok(['night', 'dawn', 'day', 'dusk'].includes(band), `minute ${minute} -> ${band}`);
    seen.add(band);
  }
  assert.deepEqual([...seen].sort(), ['dawn', 'day', 'dusk', 'night']);
});

test('parseOffset: 整点、非整点与无偏移', () => {
  assert.equal(parseOffset('GMT'), 0);
  assert.equal(parseOffset('UTC'), 0);
  assert.equal(parseOffset(''), 0);
  assert.equal(parseOffset('GMT+08:00'), 480);
  assert.equal(parseOffset('GMT-07:00'), -420);
  assert.equal(parseOffset('GMT+00:00'), 0);
  // 半刻钟时区：印度 +05:30、尼泊尔 +05:45、堪察加 +12:45
  assert.equal(parseOffset('GMT+05:30'), 330);
  assert.equal(parseOffset('GMT+05:45'), 345);
  assert.equal(parseOffset('GMT+12:45'), 765);
  assert.equal(parseOffset('GMT-03:30'), -210);
  // 认不出来的一律按 0，不许抛错
  assert.equal(parseOffset('CST'), 0);
  assert.equal(parseOffset('whatever'), 0);
});

test('formatDiff: 整小时走「约 N 小时」，非整小时给出精确值', () => {
  assert.equal(formatDiff(900), '约 15 小时');
  assert.equal(formatDiff(-900), '约 15 小时');
  assert.equal(formatDiff(0), '约 0 小时');
  assert.equal(formatDiff(60), '约 1 小时');
  assert.equal(formatDiff(345), '5 小时 45 分钟');
  assert.equal(formatDiff(-345), '5 小时 45 分钟');
  assert.equal(formatDiff(45), '45 分钟');
  assert.equal(formatDiff(-45), '45 分钟');
});

test('formatDiff: 纯文本，不替调用方做排版', () => {
  // 前导/尾随空格属于拼接现场的事，纯函数不该掺进去，
  // 否则调用方想按别的方式排版就得先 trim。
  const inputs = [0, 1, 45, 60, 90, 345, 720, 900, 1035, -1, -45, -345, -900];
  for (const diff of inputs) {
    const text = formatDiff(diff);
    assert.equal(text, text.trim(), `formatDiff(${diff}) 不该带首尾空白：${JSON.stringify(text)}`);
    assert.ok(text.length > 0, `formatDiff(${diff}) 不该为空`);
  }
});

test('dayDelta: 只看日历日，不看时刻', () => {
  const day = (year, month, day_) => ({ year, month, day: day_ });
  assert.equal(dayDelta(day(2026, 10, 23), day(2026, 10, 23)), 0);
  // 对方还在昨天
  assert.equal(dayDelta(day(2026, 10, 22), day(2026, 10, 23)), -1);
  // 对方那边已是明天
  assert.equal(dayDelta(day(2026, 10, 24), day(2026, 10, 23)), 1);
  // 跨月、跨年
  assert.equal(dayDelta(day(2026, 10, 1), day(2026, 9, 30)), 1);
  assert.equal(dayDelta(day(2027, 1, 1), day(2026, 12, 31)), 1);
});

test('periodOf: 中文时段替代 AM/PM', () => {
  assert.equal(periodOf(0), '凌晨');
  assert.equal(periodOf(5), '凌晨');
  assert.equal(periodOf(6), '上午');
  assert.equal(periodOf(11), '上午');
  assert.equal(periodOf(12), '下午');
  assert.equal(periodOf(17), '下午');
  assert.equal(periodOf(18), '晚上');
  assert.equal(periodOf(23), '晚上');
});

test('resolveZone: 同一个时区的不同写法归一到同一个 ID', () => {
  assert.equal(resolveZone('Asia/Shanghai'), 'Asia/Shanghai');
  // 大小写不同也算同一个时区，否则「是否同城」的比较会失准
  assert.equal(resolveZone('asia/shanghai'), resolveZone('Asia/Shanghai'));
  assert.equal(resolveZone('  Asia/Shanghai  '), 'Asia/Shanghai');
});

test('resolveZone: 不存在或空的名字返回 null，不抛错', () => {
  assert.equal(resolveZone('Not/AZone'), null);
  assert.equal(resolveZone(''), null);
  assert.equal(resolveZone('   '), null);
  assert.equal(resolveZone(null), null);
  assert.equal(resolveZone(undefined), null);
  assert.equal(resolveZone(42), null);
});

test('resolveZone: 新旧 IANA 名称都能拿到可用时区', () => {
  for (const zone of ['Europe/Kyiv', 'Asia/Ho_Chi_Minh', 'Asia/Kolkata', 'America/Montreal']) {
    const resolved = resolveZone(zone);
    assert.ok(typeof resolved === 'string' && resolved.length > 0, `${zone} should resolve`);
    // 拿到的必须是运行时真的认识的那个时区
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: resolved }));
  }
});

test('STORAGE_KEY: 界面偏好的键名不变', () => {
  assert.equal(STORAGE_KEY, 'timezone-guard.prefs.v1');
});
