import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { markdownToPlainText, renderMarkdown } from '../miniapp/client/markdown.mjs';
import { t } from '../miniapp/client/i18n.mjs';

let JSDOM;
try { ({ JSDOM } = createRequire(import.meta.url)('jsdom')); } catch { /* Supplied through the existing workspace NODE_PATH. */ }
const domTest = JSDOM ? test : test.skip;

test('plain text passes through with its line structure', () => {
  assert.equal(markdownToPlainText('第一行\n第二行'), '第一行\n第二行');
  assert.equal(markdownToPlainText(''), '');
  assert.equal(markdownToPlainText(null), '');
  assert.equal(markdownToPlainText('   \n  '), '');
});

test('inline markup loses its syntax and keeps its words', () => {
  assert.equal(markdownToPlainText('**粗体** 和 *斜体* 和 ~~删除~~ 和 `code`'), '粗体 和 斜体 和 删除 和 code');
  assert.equal(markdownToPlainText('请查看 [报告](https://example.com/report.md) 后继续'), '请查看 报告 后继续');
  // Inline HTML is inert: the tag text passes through, nothing swallows it.
  assert.equal(markdownToPlainText('行内 <br> 标签'), '行内 <br> 标签');
});

test('headings, lists, code and tables flatten to readable previews', () => {
  const md = [
    '## 结论',
    '',
    '- 新增 1,204',
    '- 留存 41%',
    '  1. 次周 38%',
    '  2. 四周 27%',
    '',
    '```js',
    'const total = 1204',
    '```',
    '',
    '| 指标 | 数值 |',
    '| --- | --- |',
    '| 新增 | 1204 |',
  ].join('\n');
  assert.equal(markdownToPlainText(md), [
    '结论',
    '• 新增 1,204',
    '• 留存 41%',
    '  1. 次周 38%',
    '  2. 四周 27%',
    'const total = 1204',
    '指标\t数值',
    '新增\t1204',
  ].join('\n'));
});

test('task lists and quotes keep a visible marker', () => {
  assert.equal(markdownToPlainText('- [ ] 跑测试\n- [x] 写文档'), '[ ] 跑测试\n[x] 写文档');
  assert.equal(markdownToPlainText('> 引用一句'), '引用一句');
  assert.equal(markdownToPlainText('---'), '—');
});

test('only web targets survive as a hover label', (t) => {
  const dom = new JSDOM('<!doctype html><div id="reply"></div>');
  t.after(() => dom.window.close());
  const target = dom.window.document.getElementById('reply');
  renderMarkdown(target, '[网页](https://example.com/a?b=1) [邮件](mailto:a@b.c) [脚本](javascript:alert(1)) [数据](data:text/html,x)');
  const links = [...target.querySelectorAll('.md-link')];
  assert.deepEqual(links.map((node) => node.title), ['https://example.com/a?b=1', 'mailto:a@b.c', '', '']);
  assert.deepEqual(links.map((node) => node.classList.contains('md-link-blocked')), [false, false, true, true]);
  assert.equal(links[2].textContent, '脚本');
});

test('nested list items align under their marker when flattened', () => {
  assert.equal(markdownToPlainText('- 父项\n  - 子项\n    - 孙项'), '• 父项\n  • 子项\n    • 孙项');
  assert.equal(markdownToPlainText('1. 第一步\n   - 细节'), '1. 第一步\n   • 细节');
});

test('images become a label instead of a remote request', () => {
  assert.equal(markdownToPlainText('![架构图](https://example.com/a.png)'), '［图片：架构图］');
  assert.equal(markdownToPlainText('![](https://example.com/a.png)'), '［图片］');
});

test('raw HTML is never interpreted as markup', () => {
  assert.equal(markdownToPlainText('<script>alert(1)</script>'), '<script>alert(1)</script>');
  assert.equal(markdownToPlainText('前 <b>粗</b> 后'), '前 <b>粗</b> 后');
});

test('malformed markdown falls back to text instead of throwing', () => {
  const cases = ['**未闭合', '| a |\n| ---', '```\n未闭合的代码块', '[链接](', '> ', '#'];
  for (const md of cases) assert.doesNotThrow(() => markdownToPlainText(md), JSON.stringify(md));
});

test('very long input is truncated with a visible note', () => {
  const flat = markdownToPlainText('字'.repeat(250_000));
  assert.ok(flat.endsWith(t('markdown.truncated')), flat.slice(-40));
  assert.ok(flat.length < 210_000);
});

domTest('a reply renders real DOM nodes and never injects HTML', (t) => {
  const dom = new JSDOM('<!doctype html><div id="reply"></div>');
  t.after(() => dom.window.close());
  const target = dom.window.document.getElementById('reply');
  const md = [
    '# 标题',
    '',
    '**粗** 和 [链接](https://example.com)',
    '',
    '- 一',
    '  - 一.1',
    '',
    '```js',
    'const a = 1',
    '```',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '<img src=x onerror=alert(1)>',
  ].join('\n');
  assert.equal(renderMarkdown(target, md), true);
  assert.equal(target.querySelector('h1, h2, h3, script, img'), null);
  assert.equal(target.querySelector('.md-heading').textContent, '标题');
  assert.equal(target.querySelector('.md-heading').getAttribute('aria-level'), '3');
  assert.equal(target.querySelector('strong').textContent, '粗');
  assert.equal(target.querySelector('.md-link').textContent, '链接');
  assert.equal(target.querySelector('.md-link').title, 'https://example.com');
  assert.equal(target.querySelectorAll('.md-list').length, 2);
  assert.equal(target.querySelector('.md-pre code').textContent, 'const a = 1');
  assert.equal(target.querySelector('.md-pre').dataset.lang, 'js');
  assert.equal(target.querySelectorAll('.md-table th').length, 2);
  assert.equal(target.querySelectorAll('.md-table tbody td').length, 2);
  assert.equal(target.querySelector('.md-table').getAttribute('tabindex'), '0');
  // Raw HTML survives as inert text; nothing in it becomes an element or a handler.
  assert.equal(target.querySelector('.md-raw').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(target.querySelector('[onerror]'), null);
  assert.equal(target.innerHTML.includes('onerror=alert'), true);
  assert.equal(target.querySelector('.md-raw').children.length, 0);
  // The same text renders once; a new text replaces the old nodes.
  const first = target.firstChild;
  assert.equal(renderMarkdown(target, md), false);
  assert.equal(target.firstChild, first);
  assert.equal(renderMarkdown(target, '只有一句话'), true);
  assert.equal(target.childNodes.length, 1);
  assert.equal(target.textContent, '只有一句话');
});

domTest('a task list keeps its checked state without form controls', (t) => {
  const dom = new JSDOM('<!doctype html><div id="reply"></div>');
  t.after(() => dom.window.close());
  const target = dom.window.document.getElementById('reply');
  renderMarkdown(target, '- [ ] 未完成\n- [x] 已完成');
  assert.equal(target.querySelector('input, checkbox'), null);
  assert.deepEqual([...target.querySelectorAll('.md-task')].map((node) => node.dataset.checked), ['false', 'true']);
});

domTest('table alignment comes from the column spec and a streaming re-render keeps the scroll', (t) => {
  const dom = new JSDOM('<!doctype html><div id="reply"></div>');
  t.after(() => dom.window.close());
  const target = dom.window.document.getElementById('reply');
  renderMarkdown(target, '| 名称 | 数量 | 备注 |\n| :--- | ---: | :---: |\n| 新增 | 1204 | 含游客 |');
  const cells = [...target.querySelectorAll('.md-table tbody td')];
  assert.deepEqual(cells.map((cell) => cell.dataset.align), ['left', 'right', 'center']);
  assert.deepEqual([...target.querySelectorAll('.md-table th')].map((cell) => cell.dataset.align), ['left', 'right', 'center']);
  // A longer reply replaces the nodes; the reader's scroll offset survives.
  target.scrollTop = 90;
  assert.equal(renderMarkdown(target, '| 名称 | 数量 | 备注 |\n| :--- | ---: | :---: |\n| 新增 | 1204 | 含游客 |\n| 留存 | 41% | 次周 |'), true);
  assert.equal(target.scrollTop, 90);
  assert.equal(target.dataset.mdSource.length < 30, true, 'the marker is a short key, not the reply');
});
