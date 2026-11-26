// @ts-check
//
// Regression tests for the page.
//
// The page renders the board's own notice and states what the polish run
// really did. Both are checked here with a small DOM stub, so a null state
// can never take the detail view down again.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = join(here, '..', 'miniapp', 'client');

/**
 * A DOM stub with just enough of the API for the client script.
 *
 * @param {any} snapshot
 * @param {any} tools
 */
function makeDom(snapshot, tools = { tools: [], partial: false, error: '' }) {
  /** @type {Map<string, any>} */
  const elements = new Map();
  /** @type {Record<string, any>} */
  const listeners = {};

  /**
   * @returns {any}
   */
  const createElement = () => ({
    innerHTML: '',
    textContent: '',
    className: '',
    hidden: false,
    srcdoc: '',
    value: '',
    dataset: {},
    style: {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    focus() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  });

  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    querySelectorAll: () => [],
    createElement,
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    body: createElement(),
    documentElement: createElement(),
  };

  const window = {
    addEventListener() {},
    confirm: () => true,
    mcode: undefined,
  };

  const context = {
    document,
    window,
    navigator: { language: 'zh-CN' },
    console,
    fetch: async (path) => {
      const payload = String(path).startsWith('/api/tools') ? tools : snapshot;
      return { ok: true, status: 200, json: async () => payload };
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    AbortController,
    URL,
    JSON,
    Date,
    Math,
    Promise,
    Error,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Map,
    Set,
  };
  context.globalThis = context;

  return { context, elements, listeners, document, window };
}

/**
 * @param {any} snapshot
 * @param {any} [tools]
 */
async function bootClient(snapshot, tools) {
  const source = await readFile(join(clientDir, 'app.js'), 'utf8');
  const dom = makeDom(snapshot, tools);
  vm.createContext(dom.context);
  vm.runInContext(source, dom.context, { filename: 'app.js' });
  // Let boot() finish its awaits.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return dom;
}

/**
 * @param {any} snapshot
 * @returns {any}
 */
function draftFixture(snapshot) {
  return {
    ...snapshot,
    drafts: [
      {
        id: 'draft-1',
        articleId: 'article-1',
        version: 1,
        title: '测试文章',
        topic: '测试文章',
        body: '## 小节\n\n正文',
        styleId: 'style-minimal',
        coverRatio: 'wide',
        coverWithTitle: false,
        status: 'draft',
        publish: null,
        assets: { cover: null, illustrations: {} },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        versionSource: 'manual',
        derived: { digest: '摘要', titleCandidates: ['测试文章'], outline: ['小节'], keyPoints: ['正文'] },
        plan: { cover: null, illustrations: [] },
        duplicate: { score: 0, verdict: '没有和往期文章重复', tone: 'ok', compared: [] },
      },
    ],
  };
}

test('the board notice is rendered on the page', async () => {
  const snapshot = draftFixture({
    drafts: [],
    styles: [],
    statusLabels: { draft: '草稿' },
    notice: '本地状态文件不是有效的 JSON，原文件已完整保留为 state.corrupt-x.json，工作台已重置为空白。',
    updatedAt: '',
  });
  const dom = await bootClient(snapshot);
  const main = dom.elements.get('app-main');
  assert.match(main.innerHTML, /原文件已完整保留为 state\.corrupt-x\.json/);
  assert.match(main.innerHTML, /data-action="dismiss-notice"/);
});

test('no notice means no banner', async () => {
  const snapshot = draftFixture({
    drafts: [],
    styles: [],
    statusLabels: { draft: '草稿' },
    notice: '',
    updatedAt: '',
  });
  const dom = await bootClient(snapshot);
  const main = dom.elements.get('app-main');
  assert.doesNotMatch(main.innerHTML, /dismiss-notice/);
});

test('the detail view renders when no polish run happened', async () => {
  const snapshot = draftFixture({
    drafts: [],
    styles: [],
    statusLabels: { draft: '草稿' },
    notice: '',
    updatedAt: '',
  });
  const dom = await bootClient(snapshot);

  const action = { dataset: { action: 'open-draft', id: 'draft-1' } };
  await dom.listeners.click({
    target: {
      closest: (/** @type {string} */ selector) => (selector === '[data-action]' ? action : null),
    },
  });

  const main = dom.elements.get('app-main');
  assert.match(main.innerHTML, /测试文章/);
  assert.match(main.innerHTML, /发布前检查/);
});

test('the page does not claim a version was saved when none was', async () => {
  const snapshot = draftFixture({
    drafts: [],
    styles: [],
    statusLabels: { draft: '草稿' },
    notice: '',
    updatedAt: '',
  });
  const dom = await bootClient(snapshot);

  const action = { dataset: { action: 'open-draft', id: 'draft-1' } };
  await dom.listeners.click({
    target: {
      closest: (/** @type {string} */ selector) => (selector === '[data-action]' ? action : null),
    },
  });
  const main = dom.elements.get('app-main');
  assert.doesNotMatch(main.innerHTML, /润色完成，已保存为新版本/);
});
