// @ts-check
//
// Regression tests for the plain body.
//
// An interface that builds the article itself takes the images as files and
// the body as text, with each image named on a line of its own. The plain
// body is what the app hands to such an interface and what 「复制正文」 copies.

import test from 'node:test';
import assert from 'node:assert/strict';

import { toPlainBody } from '../miniapp/node/content.mjs';

const body = [
  '开篇一段。',
  '',
  '## 第一小节',
  '',
  '第一小节的正文。',
  '',
  '> 一句引用。',
  '',
  '## 第二小节',
  '',
  '- 要点一',
  '- **要点二**',
  '',
  '结尾一段。',
].join('\n');

const draft = { title: '标题', body };

test('the plain body keeps the order of the sections', () => {
  const text = toPlainBody(draft, {});
  const lines = text.split('\n\n');
  assert.equal(lines[0], '开篇一段。');
  assert.equal(lines[1], '第一小节');
  assert.equal(lines[2], '第一小节的正文。');
  assert.equal(lines[3], '一句引用。');
  assert.equal(lines[4], '第二小节');
  assert.equal(lines[5], '要点一');
  assert.equal(lines[6], '要点二');
  assert.equal(lines[7], '结尾一段。');
});

test('the plain body names every illustration by its local path', () => {
  const text = toPlainBody(draft, {
    illustrations: {
      'illustration-1': 'C:\\assets\\one.jpg',
      'illustration-2': 'C:\\assets\\two.jpg',
    },
  });
  const blocks = text.split('\n\n');
  assert.equal(blocks[1], '第一小节');
  assert.equal(blocks[2], '![](C:\\assets\\one.jpg)');
  assert.equal(blocks[5], '第二小节');
  assert.equal(blocks[6], '![](C:\\assets\\two.jpg)');
  // The marker line holds nothing but the image.
  for (const line of text.split('\n')) {
    if (line.startsWith('![](')) assert.match(line, /^!\[\]\(.+\)$/);
  }
});

test('the plain body carries no markdown emphasis', () => {
  const text = toPlainBody(draft, {});
  assert.equal(text.includes('**'), false);
  assert.match(text, /要点二/);
});

test('a body without illustrations has no markers', () => {
  const text = toPlainBody(draft, {});
  assert.equal(text.includes('![]('), false);
});

test('the plain body of an empty draft is empty', () => {
  assert.equal(toPlainBody({ body: '' }, {}), '');
});

test('an image reference in the body is kept only when it is inside the assets directory', () => {
  const root = 'C:\\plugin\\data\\assets';
  const withImages = {
    title: '标题',
    body: [
      '正常一段。',
      '',
      '![](C:\\plugin\\data\\assets\\6f1c.jpg)',
      '',
      '![](file:///C:/Windows/win.ini)',
      '',
      '![](https://example.com/x.png)',
      '',
      '<img src="file:///D:/secret.png" />',
      '',
      '继续。',
      '',
      '[[img:C:\\Windows\\win.ini]]',
      '',
      '结尾。',
    ].join('\n'),
  };

  const text = toPlainBody(withImages, { assetsRoot: root, illustrations: {} });
  assert.match(text, /正常一段/);
  assert.match(text, /!\[\]\(C:\\plugin\\data\\assets\\6f1c\.jpg\)/);
  assert.equal(text.includes('win.ini'), false, 'a path outside the assets directory was named');
  assert.equal(text.includes('example.com'), false);
  assert.equal(text.includes('secret.png'), false);
  assert.match(text, /继续/);
  assert.match(text, /结尾/);
});

test('without a known assets directory no image reference from the body survives', () => {
  const draftWithImage = { body: '一段。\n\n![](file:///C:/Windows/win.ini)\n\n又一段。' };
  const text = toPlainBody(draftWithImage, {});
  assert.equal(text.includes('win.ini'), false);
  assert.equal(text.includes('![]('), false);
  assert.match(text, /一段/);
  assert.match(text, /又一段/);
});

test('an illustration path outside the assets directory is not named either', () => {
  const text = toPlainBody(draft, {
    assetsRoot: 'C:\\plugin\\data\\assets',
    illustrations: {
      'illustration-1': 'C:\\Windows\\win.ini',
      'illustration-2': 'C:\\plugin\\data\\assets\\two.jpg',
    },
  });
  assert.equal(text.includes('win.ini'), false);
  assert.match(text, /!\[\]\(C:\\plugin\\data\\assets\\two\.jpg\)/);
});
