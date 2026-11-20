// @ts-check
/**
 * Client harness: executes miniapp/client/app.js against a minimal DOM stub.
 *
 * It catches the failures that only show up at runtime in the browser:
 *  - referencing an undeclared variable (a ReferenceError);
 *  - an event handler that is never wired;
 *  - a request that never reaches the Node service;
 *  - a screen that never renders after the response arrives.
 *
 * Run: node tests/client-harness.mjs
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve the package root from this file so the harness works from any cwd.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'miniapp');
const html = await readFile(join(root, 'client/index.html'), 'utf8');
const clientPath = join(root, 'client/app.js');

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {boolean} condition
 * @param {string} [detail]
 */
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

// ---- HTML structure checks (regex on markup is legitimate here) ----
for (const tag of ['main', 'header', 'section', 'form', 'label', 'select', 'textarea']) {
  check(`HTML contains <${tag}>`, html.includes(`<${tag}`));
}
check('HTML declares lang="zh-CN"', html.includes('lang="zh-CN"'));
check('HTML has a title', /<title>[^<]+<\/title>/.test(html));

const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const clientSource = await readFile(clientPath, 'utf8');
for (const match of clientSource.matchAll(/getElementById\('([^']+)'\)/g)) {
  check(`script id "${match[1]}" exists in HTML`, htmlIds.has(match[1]));
}

// ---- DOM stub ----
/** @type {Map<string, any>} */
const elements = new Map();

/**
 * @param {string} id
 * @param {string} [tag]
 */
function makeElement(id, tag = 'div') {
  /** @type {Record<string, Function[]>} */
  const handlers = {};
  /** @type {any[]} */
  const children = [];
  /** @type {any[]} */
  const options = [];
  let ownText = '';

  const element = {
    id,
    tagName: tag.toUpperCase(),
    value: '',
    hidden: false,
    checked: false,
    disabled: false,
    dataset: {},
    files: [],
    children,
    options,
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    get textContent() {
      return ownText + children.map((child) => child.textContent ?? '').join('');
    },
    set textContent(value) {
      ownText = String(value);
      children.length = 0;
    },
    append(...nodes) {
      for (const node of nodes) {
        children.push(node);
        if (node && node.tagName === 'OPTION') options.push(node);
      }
    },
    remove() {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener(type, handler) {
      (handlers[type] ??= []).push(handler);
    },
    removeEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    focus() {},
    click() {
      for (const handler of handlers.click ?? []) handler({ type: 'click' });
    },
    /** test helper */
    fire(type) {
      for (const handler of handlers[type] ?? []) handler({ type });
    },
  };
  return element;
}

/**
 * @param {string} id
 */
function element(id) {
  let found = elements.get(id);
  if (!found) {
    found = makeElement(id);
    elements.set(id, found);
  }
  return found;
}

const form = element('draft-form');
form.elements = {
  namedItem: (name) => element(name),
};

const documentListeners = {};
globalThis.document = /** @type {any} */ ({
  getElementById: (id) => element(id),
  createElement: (tag) => makeElement('', tag),
  createTextNode: (text) => ({ tagName: '#text', textContent: String(text) }),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener(type, handler) {
    (documentListeners[type] ??= []).push(handler);
  },
  body: makeElement('body', 'body'),
  documentElement: makeElement('html', 'html'),
});

globalThis.window = /** @type {any} */ ({
  addEventListener() {},
  removeEventListener() {},
});

// ---- fetch stub ----
const calls = [];
const fakeMeta = {
  categories: ['Office', 'Studio', 'Code', 'Business', 'Productivity', 'Other'],
  guideUrl: 'https://code.minimax.cn/docs/code/agents/plugin-submission.md',
  surfacePath: '/dashboard',
};
const fakeState = { draft: {}, assets: [], packages: [] };
const fakeValidation = {
  issues: [],
  manifest: { name: 'acme-research', version: '1.0.0' },
  preview: {
    marketName: 'Acme 研究助手',
    summary: '检索研究资料并生成结构化综述。',
    version: '1.0.0',
    category: 'Science & Healthcare',
    author: 'Acme',
    regions: ['CN'],
    enabledEnds: ['desktop'],
    exampleQueries: ['检索近期研究并总结主要结论'],
    screenshotCount: 1,
    capabilityFiles: [],
  },
  channel: {
    findings: [],
    requiredPermissions: [],
    conclusion: '未发现官方市场的程序化提交接口。',
  },
  assets: [],
  summary: { errors: 0, warnings: 1, infos: 0, missing: 0 },
};

globalThis.fetch = /** @type {any} */ (async (url, init) => {
  calls.push({ url: String(url), method: init?.method ?? 'GET' });
  const payload = String(url).endsWith('/api/meta')
    ? fakeMeta
    : String(url).endsWith('/api/state')
      ? fakeState
      : fakeValidation;
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  };
});

let importError = null;
try {
  await import(pathToFileURL(clientPath).href);
} catch (error) {
  importError = error;
}
check('client module evaluates without a ReferenceError', importError === null, String(importError));

await new Promise((resolve) => setTimeout(resolve, 50));

check('boot requested /api/meta', calls.some((call) => call.url.endsWith('/api/meta')));
check('boot requested /api/state', calls.some((call) => call.url.endsWith('/api/state')));
check(
  'category select was populated from /api/meta',
  element('category').options.length === fakeMeta.categories.length,
  `options=${element('category').options.length}`,
);

// ---- the primary action must actually call the Node service ----
element('manifest-text').value = '{"schemaVersion":1,"name":"acme-research"}';
element('market-name').value = 'Acme 研究助手';
element('category').value = 'Science & Healthcare';
element('summary').value = '检索研究资料并生成结构化综述。';
element('documentation').value = '# Acme 研究助手\n\n正式说明文档。';
element('submit-email').value = 'a@example.com';
element('submit-account').value = '宋昊';
element('organization').value = 'Acme';

const before = calls.length;
element('validate-button').fire('click');
await new Promise((resolve) => setTimeout(resolve, 50));

check(
  'clicking 运行检查 posts to /api/validate',
  calls.slice(before).some((call) => call.url.endsWith('/api/validate') && call.method === 'POST'),
  JSON.stringify(calls.slice(before)),
);
check(
  'no ReferenceError surfaced in the status banner',
  !element('status-banner').textContent.includes('is not defined'),
  element('status-banner').textContent,
);
check(
  'check results rendered into the summary bar',
  element('summary-bar').textContent.includes('错误'),
  element('summary-bar').textContent,
);
check(
  'market preview rendered',
  element('preview-body').textContent.includes('Acme 研究助手'),
  element('preview-body').textContent.slice(0, 120),
);
check(
  'channel conclusion rendered',
  element('channel-body').textContent.includes('未发现官方市场的程序化提交接口'),
  element('channel-body').textContent.slice(0, 120),
);

// ---- the package action must reach the Node service too ----
const beforePackage = calls.length;
element('package-button').fire('click');
await new Promise((resolve) => setTimeout(resolve, 50));
check(
  'clicking 生成上架材料包 posts to /api/package',
  calls.slice(beforePackage).some((call) => call.url.endsWith('/api/package') && call.method === 'POST'),
  JSON.stringify(calls.slice(beforePackage)),
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
