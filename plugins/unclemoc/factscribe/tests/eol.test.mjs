// 行尾保真模块的单元测试（纯函数，不碰磁盘、不需要 Python）。
//
// 跑法（包目录下）：
//   node --test tests/*.test.mjs
//
// 为什么行尾要单独管：
//   引擎读文件用 Python 文本模式（通用换行翻译：CRLF→LF），写文件用二进制写，
//   一次保存就会把 CRLF 的稿子整篇改成 LF。行尾的真相只在磁盘上的原文件里，
//   所以 Node 代理在保存时把原行尾读下来、写完再按它摆回去。

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyEnding, detectEol, dominantEnding, lineContents, restoreOriginalEndings,
  sameContent, splitKeepEnds, toLfOnly,
} from '../miniapp/node/eol.mjs';

// ---------------------------------------------------------------- 切分与识别

test('切分：行尾单独摘出来，行内容一字不动', () => {
  const parts = splitKeepEnds('甲\r\n乙\n丙');
  assert.deepEqual(parts.map((p) => p.content), ['甲', '乙', '丙']);
  assert.deepEqual(parts.map((p) => p.ending), ['\r\n', '\n', '']);
});

test('切分：落单的 \r 是正文里的字符，不当行尾', () => {
  const parts = splitKeepEnds('甲\r乙\n丙');
  assert.deepEqual(parts.map((p) => p.content), ['甲\r乙', '丙']);
  assert.deepEqual(parts.map((p) => p.ending), ['\n', '']);
});

test('切分：空文本与末尾无换行的文本', () => {
  assert.deepEqual(splitKeepEnds(''), []);
  assert.deepEqual(splitKeepEnds('单行'), [{ content: '单行', ending: '' }]);
  assert.deepEqual(splitKeepEnds('a\n'), [
    { content: 'a', ending: '\n' },
  ]);
});

test('识别：认出 CRLF / LF / 混合三种文件', () => {
  assert.equal(detectEol('a\r\nb\r\nc').style, 'crlf');
  assert.equal(detectEol('a\nb\nc').style, 'lf');
  assert.equal(detectEol('a\r\nb\nc').style, 'mixed');
  assert.equal(detectEol('单行没有换行').style, 'none');
  assert.equal(detectEol('').style, 'none');
});

test('主导行尾：取多数，计数相同取 CRLF', () => {
  assert.equal(dominantEnding('a\r\nb\r\nc\n'), '\r\n');
  assert.equal(dominantEnding('a\nb\nc\r\n'), '\n');
  assert.equal(dominantEnding('a\r\nb\n'), '\r\n');
  assert.equal(dominantEnding('没有换行'), '\n');
  assert.equal(dominantEnding('没有换行', '\r\n'), '\r\n');
});

test('换行尾不动内容，末行有没有换行也照旧', () => {
  const source = '第一段\n第二段\n第三段';
  const out = applyEnding(source, '\r\n');
  assert.equal(out, '第一段\r\n第二段\r\n第三段');
  assert.equal(out.endsWith('\r\n'), false, '原来末尾没换行，换完还是没有');
  assert.equal(applyEnding('a\n', '\r\n'), 'a\r\n', '原来末尾有换行，换完还是有');
});

test('传给引擎的形态一律 LF，不带 \r', () => {
  assert.equal(toLfOnly('a\r\nb\r\nc'), 'a\nb\nc');
  assert.equal(toLfOnly('a\r\nb\nc'), 'a\nb\nc');
});

test('内容一致只看行内容，行尾不同不算内容不同', () => {
  assert.equal(sameContent('a\r\nb', 'a\nb'), true);
  assert.equal(sameContent('a\r\nb', 'a\nb\nc'), false);
  assert.equal(sameContent('a\r\nb', 'a\nxb'), false);
  assert.deepEqual(lineContents('a\r\nb\nc'), ['a', 'b', 'c']);
});

// ------------------------------------------------- 按原文件风格摆回行尾

test('摆回：CRLF 稿子存一次，CRLF 一个不少地回来', () => {
  const before = '第一行\r\n第二行\r\n第三行\r\n';
  // 引擎写出来的样子：整篇被换成 LF，第二行被改过。
  const after = '第一行\n第二行改过\n第三行\n';
  const restored = restoreOriginalEndings(before, after);
  assert.equal(restored, '第一行\r\n第二行改过\r\n第三行\r\n');
});

test('摆回：LF 稿子不会被改成 CRLF', () => {
  const before = '第一行\n第二行\n';
  const after = '第一行\n第二行改过\n';
  const restored = restoreOriginalEndings(before, after);
  assert.equal(restored, '第一行\n第二行改过\n');
});

test('摆回：混合行尾的稿子，没被碰到的行连原来的行尾都留着', () => {
  const before = '甲\r\n乙\n丙\r\n';
  const after = '甲\n乙\n丙改过\n';
  const restored = restoreOriginalEndings(before, after);
  assert.equal(restored, '甲\r\n乙\n丙改过\r\n');
});

test('摆回：内容一个字都不动（只差行尾）', () => {
  const before = '甲\r\n乙\r\n丙';
  const after = '甲\n乙\n丙';
  const restored = restoreOriginalEndings(before, after);
  assert.equal(toLfOnly(String(restored)), toLfOnly(after));
  assert.equal(restored, '甲\r\n乙\r\n丙');
});

test('摆回：末尾没有换行的文件，末尾还是没有', () => {
  const before = '甲\r\n乙';
  const after = '甲\n乙';
  const restored = restoreOriginalEndings(before, after);
  assert.equal(restored, '甲\r\n乙');
});

test('摆回：新增的行用原文件的主导行尾', () => {
  const before = '甲\r\n乙\r\n';
  const after = '甲\n新行\n乙\n';
  const restored = restoreOriginalEndings(before, after);
  assert.equal(restored, '甲\r\n新行\r\n乙\r\n');
});

test('摆回：内容被别处改过时，只还原本来的那几行，不覆盖别人的改动', () => {
  const before = '甲\r\n乙\r\n丙\r\n';
  const after = '甲\n别人改的\n乙\n丙\n';
  const restored = restoreOriginalEndings(before, after);
  assert.equal(toLfOnly(String(restored)), toLfOnly(after), '内容必须原样');
  assert.equal(restored, '甲\r\n别人改的\r\n乙\r\n丙\r\n');
});

test('摆回：空文件与空内容不炸', () => {
  assert.equal(restoreOriginalEndings('', ''), '');
  assert.equal(restoreOriginalEndings('', '新\n'), '新\n');
});
