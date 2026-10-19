// @ts-check
// Page Designer page. Everything here talks only to this Mini App's own routes, plus the
// optional window.mcode.miniapp page APIs (opening a session in the chat side panel, popping
// the page out into its own window).

/// <reference path="./client-api.ts" />

const FX0_URL = 'https://github.com/vercel-labs/fx0';
const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';
const SOURCE_URL = 'https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/tree/main/plugins/yujiachen-y/page-designer';

// ---------------------------------------------------------------------------------------------
// Strings

const LANG = /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';
document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';

/** @type {Record<'en' | 'zh', Record<string, string>>} */
const STRINGS = {
  en: {
    appName: 'Page Designer',
    newPage: 'New page',
    pages: 'Pages',
    noPages: 'No pages yet.',
    versionsCount: '{n} versions',
    versionsOne: '1 version',
    versionsNone: 'No version yet',
    working: 'Working',
    about: 'About & credits',
    menu: 'Pages',
    chatTab: 'Chat',
    previewTab: 'Preview',
    rename: 'Rename',
    renameLabel: 'Page title',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    deleteTitle: 'Delete this page?',
    deleteBody: '“{title}” and all its versions will be removed from Page Designer. The Agent conversation is kept in MiniMax Code.',
    showConversation: 'Show conversation',
    popOut: 'Open in window',
    emptyTitle: 'What should we make?',
    emptyBody: 'Describe a page. Your MiniMax Code Agent writes it as one self-contained HTML file, and it shows up in the preview.',
    examplesLabel: 'Try one',
    example1: 'A landing page for a neighborhood bakery with a weekly menu',
    example2: 'A pomodoro timer with a calm animated background',
    example3: 'An interactive explainer of how a bicycle gear works',
    example4: 'A one-page résumé for a product designer',
    styleLabel: 'Start from a style',
    styleNone: 'No style',
    styleNoneHint: 'Let the Agent choose.',
    styleUpload: 'Your design.md',
    styleUploadHint: 'Upload a design.md file.',
    styleUploaded: 'Using {name}',
    styleTooLarge: 'That file is too large (60,000 characters at most).',
    styleUnreadable: 'That file could not be read as text.',
    styleOnPage: 'Style: {name}',
    credit: 'A MiniMax Code port of fx0 by Vercel Labs.',
    creditLink: 'About',
    placeholderNew: 'Describe the page you want…',
    placeholderFollow: 'Ask for a change…',
    send: 'Send',
    stop: 'Stop',
    model: 'Model',
    modelDefault: 'Default ({name})',
    effort: 'Thinking',
    effortAuto: 'Auto',
    modelsUnavailable: 'Models could not be loaded.',
    agentUnavailable: 'This version of MiniMax Code does not let Page Designer run the Agent. Update to 3.1.2 or later.',
    you: 'You',
    agent: 'Agent',
    answered: 'Answered',
    versionChipPublish: 'Version {n}',
    versionChipEdit: 'Version {n} · edited',
    view: 'View',
    viewing: 'Showing',
    toolsUsed: 'Used {tools}',
    toolFailed: '{tool} failed',
    toolPublish: 'publish',
    toolEdit: 'edit',
    toolRead: 'read the page',
    toolList: 'list pages',
    toolSearch: 'web search',
    toolFetch: 'fetch a page',
    statusThinking: 'Thinking…',
    statusTool: 'Using {tool}…',
    statusPublish: 'Writing the page…',
    statusEdit: 'Editing the page…',
    permissionTitle: 'The Agent wants to use {tool}',
    allowOnce: 'Allow once',
    deny: 'Deny',
    decideInChat: 'Decide in conversation',
    questionTitle: 'The Agent has a question',
    questionOther: 'Other',
    questionOtherPlaceholder: 'Type your answer',
    questionSubmit: 'Answer',
    questionSkip: 'Skip',
    questionUnsupported: 'Answer this in the conversation.',
    previewEmpty: 'The page will appear here.',
    previewLoading: 'Loading preview…',
    previewFailed: 'The preview could not be loaded.',
    latest: 'Latest (v{n})',
    versionOption: 'Version {n}',
    desktop: 'Desktop',
    tablet: 'Tablet',
    phone: 'Phone',
    device: 'Preview width',
    copy: 'Copy HTML',
    copied: 'Copied the HTML.',
    copyFailed: 'Could not copy. Try Download instead.',
    download: 'Download',
    downloaded: 'Downloaded {file}.',
    retry: 'Retry',
    reload: 'Reload preview',
    disconnected: 'Page Designer restarted. Refresh the page to reconnect.',
    refresh: 'Refresh',
    aboutTitle: 'About Page Designer',
    aboutP1: 'Page Designer is a MiniMax Code port of fx0, an open-source design agent by Vercel Labs: you describe a page and an agent writes it as one HTML file.',
    aboutP2: 'The design instructions, the HTML safety rules, the exact-replacement edits and the sandboxed preview are adapted from fx0, under the Apache License 2.0. Thank you to the fx0 authors for building it in the open.',
    aboutP3: 'What is different here: the pages are written by your own MiniMax Code Agent, with the model you pick, through this Mini App’s tools. Pages, versions and chats stay on this computer.',
    aboutP4: 'Page Designer is an independent community project. It is not affiliated with or endorsed by Vercel.',
    aboutFx0: 'fx0 on GitHub',
    aboutLicense: 'Apache License 2.0',
    aboutSource: 'Page Designer source',
    close: 'Close',
    errBUSY: 'The Agent is busy right now. Try again in a moment.',
    errAGENT_UNAVAILABLE: 'The Agent is not available right now. Try again in a moment.',
    errAGENT_OUTCOME_UNKNOWN: 'It is not clear whether that request ran. Check the conversation before trying again.',
    errSESSION_NOT_FOUND: 'The linked conversation no longer exists.',
    errINVALID_ARGUMENTS: 'The selected model cannot be used. Pick another one.',
    errNOT_PERMITTED: 'Page Designer is not allowed to run the Agent.',
    errREQUEST_NOT_FOUND: 'That request has already been handled.',
    errTURN_ERROR: 'The Agent stopped with an error.',
    errABORTED: 'Stopped.',
    errREQUEST_CANCELLED: 'Stopped.',
    errUNKNOWN: 'Something went wrong.',
    errNetwork: 'Page Designer could not be reached.',
  },
  zh: {
    appName: 'Page Designer',
    newPage: '新建页面',
    pages: '页面',
    noPages: '还没有页面。',
    versionsCount: '{n} 个版本',
    versionsOne: '1 个版本',
    versionsNone: '还没有版本',
    working: '进行中',
    about: '关于与致谢',
    menu: '页面列表',
    chatTab: '对话',
    previewTab: '预览',
    rename: '重命名',
    renameLabel: '页面标题',
    save: '保存',
    cancel: '取消',
    delete: '删除',
    deleteTitle: '删除这个页面？',
    deleteBody: '「{title}」和它的所有版本会从 Page Designer 中移除，MiniMax Code 里的 Agent 对话会保留。',
    showConversation: '查看对话',
    popOut: '在窗口中打开',
    emptyTitle: '想做一个什么页面？',
    emptyBody: '描述你想要的页面，MiniMax Code 的 Agent 会把它写成一个独立的 HTML 文件，并显示在预览里。',
    examplesLabel: '试试这些',
    example1: '一家社区面包店的落地页，带每周菜单',
    example2: '一个番茄钟，背景是舒缓的动画',
    example3: '交互式讲解自行车变速器是怎么工作的',
    example4: '一页纸的产品设计师简历',
    styleLabel: '选择一个起始风格',
    styleNone: '不指定',
    styleNoneHint: '让 Agent 自己决定。',
    styleUpload: '自己的 design.md',
    styleUploadHint: '上传一个 design.md 文件。',
    styleUploaded: '使用 {name}',
    styleTooLarge: '文件太大了（最多 60,000 个字符）。',
    styleUnreadable: '这个文件无法作为文本读取。',
    styleOnPage: '风格：{name}',
    credit: '移植自 Vercel Labs 的开源项目 fx0。',
    creditLink: '了解更多',
    placeholderNew: '描述你想要的页面…',
    placeholderFollow: '想怎么改…',
    send: '发送',
    stop: '停止',
    model: '模型',
    modelDefault: '默认（{name}）',
    effort: '思考',
    effortAuto: '自动',
    modelsUnavailable: '无法加载模型列表。',
    agentUnavailable: '当前版本的 MiniMax Code 不支持 Page Designer 运行 Agent，请升级到 3.1.2 或更高版本。',
    you: '你',
    agent: 'Agent',
    answered: '已回答',
    versionChipPublish: '版本 {n}',
    versionChipEdit: '版本 {n} · 修改',
    view: '查看',
    viewing: '预览中',
    toolsUsed: '使用了 {tools}',
    toolFailed: '{tool} 失败',
    toolPublish: '发布',
    toolEdit: '修改',
    toolRead: '读取页面',
    toolList: '列出页面',
    toolSearch: '网页搜索',
    toolFetch: '抓取网页',
    statusThinking: '思考中…',
    statusTool: '正在使用 {tool}…',
    statusPublish: '正在写页面…',
    statusEdit: '正在修改页面…',
    permissionTitle: 'Agent 想使用 {tool}',
    allowOnce: '允许一次',
    deny: '拒绝',
    decideInChat: '去对话里决定',
    questionTitle: 'Agent 有个问题',
    questionOther: '其他',
    questionOtherPlaceholder: '输入你的回答',
    questionSubmit: '回答',
    questionSkip: '跳过',
    questionUnsupported: '请在对话里回答这个问题。',
    previewEmpty: '页面会显示在这里。',
    previewLoading: '正在载入预览…',
    previewFailed: '预览载入失败。',
    latest: '最新（v{n}）',
    versionOption: '版本 {n}',
    desktop: '桌面',
    tablet: '平板',
    phone: '手机',
    device: '预览宽度',
    copy: '复制 HTML',
    copied: '已复制 HTML。',
    copyFailed: '复制失败，可以改用下载。',
    download: '下载',
    downloaded: '已下载 {file}。',
    retry: '重试',
    reload: '重新载入预览',
    disconnected: 'Page Designer 已重启，请刷新页面重新连接。',
    refresh: '刷新',
    aboutTitle: '关于 Page Designer',
    aboutP1: 'Page Designer 是 Vercel Labs 开源设计 Agent fx0 在 MiniMax Code 上的移植版：你描述一个页面，Agent 把它写成一个 HTML 文件。',
    aboutP2: '设计指令、HTML 安全规则、精确替换式修改和沙箱预览都改编自 fx0，遵循 Apache License 2.0。感谢 fx0 的作者们把它开源出来。',
    aboutP3: '不同之处：页面由你自己的 MiniMax Code Agent 用你选择的模型，通过这个 Mini App 的工具写出；页面、版本和对话都保存在这台电脑上。',
    aboutP4: 'Page Designer 是独立的社区项目，与 Vercel 没有隶属或背书关系。',
    aboutFx0: 'GitHub 上的 fx0',
    aboutLicense: 'Apache License 2.0',
    aboutSource: 'Page Designer 源码',
    close: '关闭',
    errBUSY: 'Agent 正忙，请稍后再试。',
    errAGENT_UNAVAILABLE: 'Agent 暂时不可用，请稍后再试。',
    errAGENT_OUTCOME_UNKNOWN: '无法确认这次请求是否已执行，请先查看对话再决定是否重试。',
    errSESSION_NOT_FOUND: '关联的对话已不存在。',
    errINVALID_ARGUMENTS: '所选模型无法使用，请换一个。',
    errNOT_PERMITTED: 'Page Designer 没有运行 Agent 的权限。',
    errREQUEST_NOT_FOUND: '这个请求已经处理过了。',
    errTURN_ERROR: 'Agent 出错停止了。',
    errABORTED: '已停止。',
    errREQUEST_CANCELLED: '已停止。',
    errUNKNOWN: '出了点问题。',
    errNetwork: '无法连接 Page Designer。',
  },
};

/** @param {string} key @param {Record<string, string | number>} [vars] */
function t(key, vars) {
  const text = STRINGS[LANG][key] ?? STRINGS.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? '')) : text;
}

/** @param {string} code */
function errorText(code) {
  return STRINGS[LANG][`err${code}`] ?? STRINGS.en[`err${code}`] ?? t('errUNKNOWN');
}

// ---------------------------------------------------------------------------------------------
// DOM helpers

/**
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...(Node | string | null | undefined | false | (Node | string | null | undefined | false)[])} children
 * @returns {HTMLElement}
 */
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node && typeof value !== 'string') /** @type {any} */ (node)[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

const ICONS = {
  plus: '<path d="M8 3v10M3 8h10"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  send: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  pencil: '<path d="M10.5 2.5 13.5 5.5 6 13H3v-3z"/>',
  desktop: '<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 13.5h4M8 11v2.5"/>',
  tablet: '<rect x="3.5" y="2" width="9" height="12" rx="1.5"/><path d="M7 12h2"/>',
  phone: '<rect x="5" y="2" width="6" height="12" rx="1.5"/><path d="M7.5 12h1"/>',
  chat: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>',
  window: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6h12"/>',
  reload: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
  info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.5v3.5M8 5.2v.1"/>',
  check: '<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>',
  external: '<path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5"/>',
  upload: '<path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 13.5h10"/>',
};

/** @param {keyof typeof ICONS} name */
function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

const LOGO_SVG =
  '<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#FF7A59"/><path d="M10 8h8.5L23 12.5V24H10z" fill="#fff"/><path d="M18.5 8v4.5H23" fill="#FFD9CF"/><path d="M13 16.5l-1.8 1.8L13 20M20 16.5l1.8 1.8L20 20M17.2 15.5l-1.4 5.6" stroke="#16A39A" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** @param {number} ms */
function formatDate(ms) {
  const date = new Date(ms);
  const sameDay = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(LANG === 'zh' ? 'zh-CN' : 'en', sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' }).format(date);
}

/** @param {string} url */
function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return;
    // With noopener, window.open returns null even when it worked; MiniMax Code decides where it opens.
    window.open(parsed.href, '_blank', 'noopener,noreferrer');
  } catch {
    // not a URL: nothing to open
  }
}

/** @param {string} href @param {string} label */
function externalLink(href, label) {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'link' }, label, icon('external'));
}

// ---------------------------------------------------------------------------------------------
// Markdown (a safe subset: paragraphs, lists, headings, code, bold, italics, https links)

/** @param {string} text */
function inline(text) {
  /** @type {(Node | string)[]} */
  const parts = [];
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\(https:\/\/[^\s)]+\))|(https:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const token = match[0];
    if (match[1]) parts.push(h('code', null, token.slice(1, -1)));
    else if (match[2]) parts.push(h('strong', null, token.slice(2, -2)));
    else if (match[3]) parts.push(h('em', null, token.slice(1, -1)));
    else if (match[4]) {
      const label = token.slice(1, token.indexOf(']('));
      const href = token.slice(token.indexOf('](') + 2, -1);
      parts.push(h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label));
    } else parts.push(h('a', { href: token, target: '_blank', rel: 'noopener noreferrer' }, token));
    last = index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** @param {string} source */
function markdown(source) {
  const root = h('div', { class: 'md' });
  const chunks = source.replace(/\r\n?/g, '\n').split(/^```[^\n]*\n?/m);
  chunks.forEach((chunk, index) => {
    if (index % 2 === 1) {
      root.append(h('pre', null, h('code', null, chunk.replace(/\n$/, ''))));
      return;
    }
    for (const block of chunk.split(/\n{2,}/)) {
      const lines = block.split('\n').filter((line) => line.trim() !== '');
      if (lines.length === 0) continue;
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        root.append(h('ul', null, lines.map((line) => h('li', null, inline(line.replace(/^\s*[-*]\s+/, ''))))));
      } else if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
        root.append(h('ol', null, lines.map((line) => h('li', null, inline(line.replace(/^\s*\d+[.)]\s+/, ''))))));
      } else if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) {
        root.append(h('p', { class: 'md-heading' }, inline(lines[0].replace(/^#{1,6}\s+/, ''))));
      } else {
        const paragraph = h('p');
        lines.forEach((line, lineIndex) => {
          if (lineIndex > 0) paragraph.append(h('br'));
          paragraph.append(...inline(line));
        });
        root.append(paragraph);
      }
    }
  });
  return root;
}

// ---------------------------------------------------------------------------------------------
// API

class ApiError extends Error {
  /** @param {string} code @param {string} [message] @param {number} [status] */
  constructor(code, message, status) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

/** @param {string} method @param {string} path @param {unknown} [body] */
async function api(method, path, body) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined && method === 'GET' ? {} : { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('network', t('errNetwork'));
  }
  if (response.status === 401) {
    showDisconnected();
    throw new ApiError('unauthorized', t('disconnected'), 401);
  }
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();
  if (!response.ok) {
    const code = typeof data === 'object' && data?.error ? String(data.error) : 'UNKNOWN';
    const message = typeof data === 'object' && data?.message ? String(data.message) : errorText(code);
    throw new ApiError(code, /^[A-Z_]+$/.test(code) ? errorText(code) : message, response.status);
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// State

const MODEL_KEY = 'page-designer.model';
const DEVICE_KEY = 'page-designer.device';

const state = {
  agentAvailable: true,
  /** @type {any[]} */ projects: [],
  /** @type {any[]} */ styles: [],
  /** @type {any} */ models: null,
  modelsFailed: false,
  /** model choice: '' means the runtime default, otherwise providerId + '\u0000' + modelId */
  modelKey: '',
  effort: '',
  /** @type {string | null} */ currentId: null,
  /** @type {any} */ project: null,
  /** @type {any} */ live: null,
  /** @type {number | null} */ viewing: null,
  device: localStorage.getItem(DEVICE_KEY) || 'desktop',
  tab: 'chat',
  /** @type {{ preset: string } | { name: string, text: string } | null} */ newStyle: null,
  sending: false,
  /** the next render of a project opens at its latest message */
  scrollToEnd: false,
};

try {
  const saved = JSON.parse(localStorage.getItem(MODEL_KEY) || 'null');
  if (saved && typeof saved.modelKey === 'string') {
    state.modelKey = saved.modelKey;
    state.effort = typeof saved.effort === 'string' ? saved.effort : '';
  }
} catch {
  // a broken preference is ignored
}

/** @param {any} selection */
function keyOf(selection) {
  return selection && selection.providerId && selection.modelId ? `${selection.providerId}\u0000${selection.modelId}` : '';
}

function currentModelOption() {
  if (!state.models || !state.modelKey) return null;
  return state.models.models.find((/** @type {any} */ item) => keyOf(item) === state.modelKey) ?? null;
}

/** The selection to send with a request, or null to keep the session's model. */
function modelSelection() {
  if (!state.models) return null;
  if (!state.modelKey) return state.models.default ?? null;
  const option = currentModelOption();
  if (!option) return state.models.default ?? null;
  /** @type {Record<string, any>} */
  const selection = { providerId: option.providerId, modelId: option.modelId };
  if (state.effort && option.thinking?.efforts?.includes(state.effort)) selection.thinking = { effort: state.effort };
  return selection;
}

/** @param {any} model */
function modelName(model) {
  if (!model) return '';
  const option = state.models?.models?.find((/** @type {any} */ item) => item.providerId === model.providerId && item.modelId === model.modelId);
  return option?.displayName ?? model.modelId ?? '';
}

// ---------------------------------------------------------------------------------------------
// Layout

const root = /** @type {HTMLElement} */ (document.getElementById('app'));
const els = /** @type {Record<string, HTMLElement>} */ ({});

function buildShell() {
  root.replaceChildren();
  root.removeAttribute('aria-busy');

  els.projectList = h('ul', { class: 'project-list' });
  els.sidebar = h(
    'aside',
    { class: 'sidebar', id: 'sidebar', 'aria-label': t('pages') },
    h('div', { class: 'brand' }, logo(), h('span', null, t('appName'))),
    h('button', { type: 'button', class: 'btn primary block', onclick: () => selectProject(null) }, icon('plus'), t('newPage')),
    h('nav', { class: 'project-nav', 'aria-label': t('pages') }, els.projectList),
    h('div', { class: 'sidebar-foot' }, h('button', { type: 'button', class: 'btn ghost small', onclick: openAbout }, icon('info'), t('about'))),
  );
  els.scrim = h('div', { class: 'scrim', onclick: () => toggleSidebar(false) });

  els.title = h('h1', { class: 'title' });
  els.titleActions = h('div', { class: 'title-actions' });
  els.tabs = h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': t('appName') },
    h('button', { type: 'button', role: 'tab', id: 'tab-chat', 'aria-controls': 'chat-panel', onclick: () => setTab('chat') }, t('chatTab')),
    h('button', { type: 'button', role: 'tab', id: 'tab-preview', 'aria-controls': 'preview-panel', onclick: () => setTab('preview') }, t('previewTab')),
  );
  els.menuButton = h('button', { type: 'button', class: 'btn icon-only ghost menu-button', 'aria-label': t('menu'), 'aria-controls': 'sidebar', 'aria-expanded': 'false', onclick: () => toggleSidebar() }, icon('menu'));
  els.banner = h('div', { class: 'banner', role: 'alert', hidden: true });
  els.thread = h('div', { class: 'thread', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  els.live = h('div', { class: 'live' });
  els.question = h('div', { class: 'question-slot' });
  els.composer = buildComposer();

  els.chat = h(
    'section',
    { class: 'chat', id: 'chat-panel', role: 'tabpanel', 'aria-labelledby': 'tab-chat' },
    h('header', { class: 'chat-head' }, els.menuButton, h('div', { class: 'title-wrap' }, els.title, els.titleActions)),
    els.banner,
    h('div', { class: 'thread-scroll' }, els.thread, els.live),
    els.question,
    els.composer,
  );

  els.preview = buildPreview();
  els.toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });

  root.append(
    els.sidebar,
    els.scrim,
    h('main', { class: 'main' }, h('div', { class: 'tabs-bar' }, els.tabs), h('div', { class: 'panes' }, els.chat, els.preview)),
    els.toast,
  );
  setTab(state.tab);
}

function logo() {
  const span = h('span', { class: 'logo' });
  span.innerHTML = LOGO_SVG;
  return span;
}

/** @param {boolean} [open] */
function toggleSidebar(open) {
  const next = open ?? !root.classList.contains('sidebar-open');
  root.classList.toggle('sidebar-open', next);
  els.menuButton.setAttribute('aria-expanded', String(next));
}

/** @param {'chat' | 'preview'} tab */
function setTab(tab) {
  state.tab = tab;
  root.dataset.tab = tab;
  for (const button of els.tabs.querySelectorAll('[role="tab"]')) {
    const selected = button.id === `tab-${tab}`;
    button.setAttribute('aria-selected', String(selected));
    button.setAttribute('tabindex', selected ? '0' : '-1');
  }
  if (tab === 'preview') preview.ensureShown();
}

let toastTimer = 0;
/** @param {string} text @param {'info' | 'error'} [tone] */
function toast(text, tone = 'info') {
  els.toast.textContent = text;
  els.toast.dataset.tone = tone;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 3200);
}

function showDisconnected() {
  els.banner.hidden = false;
  els.banner.replaceChildren(
    h('span', null, t('disconnected')),
    h('button', { type: 'button', class: 'btn small', onclick: () => location.reload() }, t('refresh')),
  );
}

// ---------------------------------------------------------------------------------------------
// Sidebar

function renderProjects() {
  if (state.projects.length === 0) {
    els.projectList.replaceChildren(h('li', { class: 'muted empty-list' }, t('noPages')));
    return;
  }
  els.projectList.replaceChildren(
    ...state.projects.map((project) => {
      const current = project.id === state.currentId;
      const meta = project.running
        ? h('span', { class: 'pill working' }, t('working'))
        : h('span', null, project.versions === 0 ? t('versionsNone') : project.versions === 1 ? t('versionsOne') : t('versionsCount', { n: project.versions }), ' · ', formatDate(project.updatedAt));
      return h(
        'li',
        null,
        h(
          'button',
          { type: 'button', class: `project${current ? ' current' : ''}`, 'aria-current': current ? 'page' : undefined, onclick: () => selectProject(project.id) },
          h('span', { class: 'project-title' }, project.title),
          h('span', { class: 'project-meta' }, meta),
        ),
      );
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Header

function renderHeader() {
  const project = state.project;
  els.titleActions.replaceChildren();
  if (!project) {
    els.title.textContent = t('newPage');
    return;
  }
  els.title.textContent = project.title;
  els.title.title = project.title;
  els.titleActions.append(h('button', { type: 'button', class: 'btn icon-only ghost', 'aria-label': t('rename'), title: t('rename'), onclick: startRename }, icon('pencil')));
  const agentApi = window.mcode?.miniapp?.agent;
  if (agentApi?.open && project.sessionId) {
    els.titleActions.append(
      h('button', { type: 'button', class: 'btn icon-only ghost', 'aria-label': t('showConversation'), title: t('showConversation'), onclick: () => openConversation() }, icon('chat')),
    );
  }
  els.titleActions.append(
    h('button', { type: 'button', class: 'btn icon-only ghost danger-hover', 'aria-label': t('delete'), title: t('delete'), disabled: !!state.live, onclick: confirmDelete }, icon('trash')),
  );
}

function startRename() {
  const project = state.project;
  if (!project) return;
  const input = /** @type {HTMLInputElement} */ (h('input', { class: 'input', value: project.title, 'aria-label': t('renameLabel'), maxlength: '80' }));
  // Enter or Escape removes the input, which also fires blur: only the first one counts, so
  // Escape really cancels and Enter saves once.
  let finished = false;
  const finish = async (/** @type {boolean} */ save) => {
    if (finished) return;
    finished = true;
    const title = input.value.trim();
    if (save && title && title !== project.title) {
      try {
        await api('PATCH', `/api/projects/${project.id}`, { title });
      } catch (error) {
        toast(/** @type {Error} */ (error).message, 'error');
      }
    }
    renderHeader();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) void finish(true);
    if (event.key === 'Escape') void finish(false);
  });
  input.addEventListener('blur', () => void finish(true), { once: true });
  els.title.replaceChildren(input);
  els.titleActions.replaceChildren();
  input.focus();
  input.select();
}

async function openConversation() {
  const sessionId = state.project?.sessionId;
  const agentApi = window.mcode?.miniapp?.agent;
  if (!sessionId || !agentApi?.open) return;
  try {
    await agentApi.open(sessionId);
  } catch (error) {
    toast(errorText(String(/** @type {Error} */ (error)?.message || 'UNKNOWN').toUpperCase()), 'error');
  }
}

/** @param {string} title @param {string} body @param {string} confirmLabel */
function confirmDialog(title, body, confirmLabel) {
  return new Promise((resolve) => {
    const dialog = /** @type {HTMLDialogElement} */ (
      h(
        'dialog',
        { class: 'dialog', 'aria-labelledby': 'confirm-title' },
        h('h2', { id: 'confirm-title' }, title),
        h('p', null, body),
        h(
          'div',
          { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => dialog.close('cancel') }, t('cancel')),
          h('button', { type: 'button', class: 'btn danger', onclick: () => dialog.close('confirm') }, confirmLabel),
        ),
      )
    );
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

async function confirmDelete() {
  const project = state.project;
  if (!project) return;
  if (!(await confirmDialog(t('deleteTitle'), t('deleteBody', { title: project.title }), t('delete')))) return;
  try {
    await api('DELETE', `/api/projects/${project.id}`);
    await refreshState();
    selectProject(null);
  } catch (error) {
    toast(/** @type {Error} */ (error).message, 'error');
  }
}

function openAbout() {
  const dialog = /** @type {HTMLDialogElement} */ (
    h(
      'dialog',
      { class: 'dialog about', 'aria-labelledby': 'about-title' },
      h('div', { class: 'about-head' }, logo(), h('h2', { id: 'about-title' }, t('aboutTitle'))),
      h('p', null, t('aboutP1')),
      h('p', null, t('aboutP2')),
      h('p', null, t('aboutP3')),
      h('p', { class: 'muted' }, t('aboutP4')),
      h('ul', { class: 'about-links' }, h('li', null, externalLink(FX0_URL, t('aboutFx0'))), h('li', null, externalLink(LICENSE_URL, t('aboutLicense'))), h('li', null, externalLink(SOURCE_URL, t('aboutSource')))),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => dialog.close() }, t('close'))),
    )
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

// ---------------------------------------------------------------------------------------------
// Thread

/** @param {string} name */
function toolLabel(name) {
  const n = name.toLowerCase();
  if (n.includes('publish_design')) return t('toolPublish');
  if (n.includes('edit_design')) return t('toolEdit');
  if (n.includes('read_design')) return t('toolRead');
  if (n.includes('list_designs')) return t('toolList');
  if (n.includes('search')) return t('toolSearch');
  if (n.includes('fetch')) return t('toolFetch');
  return name.replace(/^mcp__/, '').replace(/__/g, ' · ');
}

/** Successful page writes already show as version chips. */
function quietTool(/** @type {any} */ message) {
  return message.ok && /publish_design|edit_design/i.test(message.name);
}

function renderThread() {
  const project = state.project;
  const scroller = els.thread.parentElement;
  const nearBottom = state.scrollToEnd || !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  if (!project) {
    if (scroller) scroller.scrollTop = 0;
    els.thread.replaceChildren(emptyState());
    return;
  }
  /** @type {HTMLElement[]} */
  const items = [];
  if (project.style) items.push(h('p', { class: 'style-note muted' }, t('styleOnPage', { name: project.style.name })));
  /** @type {any[]} */
  let tools = [];
  const flushTools = () => {
    const shown = tools.filter((item) => !quietTool(item));
    tools = [];
    if (shown.length === 0) return;
    const failed = shown.filter((item) => !item.ok);
    const used = [...new Set(shown.filter((item) => item.ok).map((item) => toolLabel(item.name)))];
    if (used.length) items.push(h('p', { class: 'activity' }, icon('check'), t('toolsUsed', { tools: used.join(LANG === 'zh' ? '、' : ', ') })));
    for (const item of failed) items.push(h('p', { class: 'activity failed' }, icon('info'), t('toolFailed', { tool: toolLabel(item.name) })));
  };
  for (const message of project.messages) {
    if (message.kind === 'tool') {
      tools.push(message);
      continue;
    }
    flushTools();
    items.push(renderMessage(message));
  }
  flushTools();
  els.thread.replaceChildren(...items);
  state.scrollToEnd = false;
  if (nearBottom && scroller) scroller.scrollTop = scroller.scrollHeight;
}

/** @param {any} message */
function renderMessage(message) {
  switch (message.kind) {
    case 'user':
      return h('div', { class: 'msg user' }, h('span', { class: 'sr-only' }, `${t('you')}: `), h('div', { class: 'bubble' }, message.text));
    case 'answer':
      return h('div', { class: 'msg user' }, h('div', { class: 'bubble' }, h('span', { class: 'bubble-label' }, t('answered')), message.text || ''));
    case 'assistant':
      return h('div', { class: 'msg assistant' }, h('span', { class: 'sr-only' }, `${t('agent')}: `), markdown(message.text));
    case 'version': {
      const shown = (state.viewing ?? latestVersion()) === message.n;
      return h(
        'div',
        { class: `version-chip${shown ? ' shown' : ''}` },
        h('span', { class: 'version-dot', 'aria-hidden': 'true' }),
        h('span', null, t(message.via === 'edit' ? 'versionChipEdit' : 'versionChipPublish', { n: message.n })),
        shown
          ? h('span', { class: 'muted small' }, t('viewing'))
          : h('button', { type: 'button', class: 'btn ghost small', onclick: () => showVersion(message.n) }, t('view')),
      );
    }
    case 'notice': {
      const detail = message.text ? `${errorText(message.code)} ${message.text}` : errorText(message.code);
      return h('p', { class: `notice ${message.tone === 'error' ? 'error' : ''}`, role: message.tone === 'error' ? 'alert' : undefined }, detail);
    }
    default:
      return h('span');
  }
}

function latestVersion() {
  return state.project?.versions?.at(-1)?.n ?? 0;
}

function emptyState() {
  const examples = ['example1', 'example2', 'example3', 'example4'].map((key) =>
    h('button', { type: 'button', class: 'chip', onclick: () => fillComposer(t(key)) }, t(key)),
  );
  const styleCards = [
    styleCard('none', t('styleNone'), t('styleNoneHint'), []),
    ...state.styles.map((style) => styleCard(style.id, style.name[LANG] ?? style.name.en, style.description[LANG] ?? style.description.en, style.swatches)),
    uploadCard(),
  ];
  return h(
    'section',
    { class: 'empty', 'aria-labelledby': 'empty-title' },
    h('h2', { id: 'empty-title' }, t('emptyTitle')),
    h('p', { class: 'muted' }, t('emptyBody')),
    state.agentAvailable ? null : h('p', { class: 'notice error', role: 'alert' }, t('agentUnavailable')),
    h('h3', null, t('examplesLabel')),
    h('div', { class: 'chips' }, examples),
    h('h3', { id: 'style-label' }, t('styleLabel')),
    h('div', { class: 'style-grid', role: 'radiogroup', 'aria-labelledby': 'style-label' }, styleCards),
    h('p', { class: 'credit muted small' }, t('credit'), ' ', h('button', { type: 'button', class: 'link-button', onclick: openAbout }, t('creditLink'))),
  );
}

function selectedStyleId() {
  if (!state.newStyle) return 'none';
  return 'preset' in state.newStyle ? state.newStyle.preset : 'upload';
}

/** @param {string} id @param {string} name @param {string} hint @param {string[]} swatches */
function styleCard(id, name, hint, swatches) {
  const checked = selectedStyleId() === id;
  return h(
    'button',
    {
      type: 'button',
      role: 'radio',
      'aria-checked': String(checked),
      class: `style-card${checked ? ' selected' : ''}`,
      onclick: () => {
        state.newStyle = id === 'none' ? null : { preset: id };
        renderThread();
      },
    },
    h('span', { class: 'swatches', 'aria-hidden': 'true' }, swatches.length ? swatches.map((color) => h('span', { class: 'swatch', style: `background:${color}` })) : h('span', { class: 'swatch none' })),
    h('span', { class: 'style-name' }, name),
    h('span', { class: 'style-hint' }, hint),
  );
}

function uploadCard() {
  const checked = selectedStyleId() === 'upload';
  const custom = state.newStyle && 'text' in state.newStyle ? state.newStyle : null;
  const input = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' }));
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 400_000) return toast(t('styleTooLarge'), 'error');
    try {
      const text = await file.text();
      if (text.includes('\u0000')) return toast(t('styleUnreadable'), 'error');
      if (text.length > 60_000) return toast(t('styleTooLarge'), 'error');
      state.newStyle = { name: file.name.slice(0, 80), text };
      renderThread();
    } catch {
      toast(t('styleUnreadable'), 'error');
    }
  });
  return h(
    'button',
    { type: 'button', role: 'radio', 'aria-checked': String(checked), class: `style-card${checked ? ' selected' : ''}`, onclick: () => input.click() },
    h('span', { class: 'swatches', 'aria-hidden': 'true' }, icon('upload')),
    h('span', { class: 'style-name' }, t('styleUpload')),
    h('span', { class: 'style-hint' }, custom ? t('styleUploaded', { name: custom.name }) : t('styleUploadHint')),
    input,
  );
}

// ---------------------------------------------------------------------------------------------
// Live run

function renderLive() {
  const live = state.live;
  els.live.replaceChildren();
  if (!live) return;
  const scroller = els.live.parentElement;
  const nearBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  if (live.text) els.live.append(h('div', { class: 'msg assistant streaming' }, markdown(live.text)));
  let status = t('statusThinking');
  if (live.tool) {
    if (/publish_design/i.test(live.tool)) status = t('statusPublish');
    else if (/edit_design/i.test(live.tool)) status = t('statusEdit');
    else status = t('statusTool', { tool: toolLabel(live.tool) });
  }
  if (live.permissions.length === 0) {
    els.live.append(
      h('p', { class: 'working-line', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), status, live.model ? h('span', { class: 'muted small' }, ` · ${modelName(live.model)}`) : null),
    );
  }
  for (const permission of live.permissions) els.live.append(permissionCard(permission));
  if (nearBottom && scroller) scroller.scrollTop = scroller.scrollHeight;
}

/** @param {any} permission */
function permissionCard(permission) {
  const agentApi = window.mcode?.miniapp?.agent;
  const decide = async (/** @type {'allowOnce' | 'deny'} */ decision, /** @type {HTMLElement} */ card) => {
    for (const button of card.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (button).disabled = true;
    try {
      await api('POST', `/api/projects/${state.currentId}/permissions`, { requestId: permission.requestId, decision });
    } catch (error) {
      toast(/** @type {Error} */ (error).message, 'error');
      for (const button of card.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (button).disabled = false;
    }
  };
  const card = h(
    'section',
    { class: 'card permission', 'aria-label': t('permissionTitle', { tool: permission.toolName }) },
    h('h3', null, t('permissionTitle', { tool: toolLabel(permission.toolName) })),
    permission.reason ? h('p', null, permission.reason) : null,
    permission.toolInput ? h('pre', { class: 'tool-input' }, permission.toolInput) : null,
  );
  card.append(
    h(
      'div',
      { class: 'card-actions' },
      agentApi?.open && state.project?.sessionId ? h('button', { type: 'button', class: 'btn ghost', onclick: () => openConversation() }, t('decideInChat')) : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: () => decide('deny', card) }, t('deny')),
      h('button', { type: 'button', class: 'btn primary', onclick: () => decide('allowOnce', card) }, t('allowOnce')),
    ),
  );
  return card;
}

// ---------------------------------------------------------------------------------------------
// Questionnaire

function renderQuestion() {
  const pending = state.project?.pendingQuestion;
  els.question.replaceChildren();
  els.composer.hidden = !!pending;
  if (!pending) return;
  const request = pending.request ?? {};
  const steps = Array.isArray(request.steps) ? request.steps : [];
  const form = h('form', { class: 'card question', 'aria-labelledby': 'question-title' });
  form.append(h('h3', { id: 'question-title' }, request.title || t('questionTitle')));
  if (pending.mode !== 'questionnaire' || steps.length === 0) {
    form.append(h('p', null, t('questionUnsupported')));
  }
  steps.forEach((/** @type {any} */ step, index) => {
    const name = `step-${index}`;
    const type = step.selectionMode === 'multiple' ? 'checkbox' : 'radio';
    const otherInput = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'text', placeholder: t('questionOtherPlaceholder'), 'aria-label': t('questionOther'), dataset: { otherFor: name } }));
    form.append(
      h(
        'fieldset',
        { class: 'q-step', dataset: { stepId: step.id, name } },
        h('legend', null, step.header ? h('span', { class: 'q-header' }, step.header) : null, step.question),
        step.description ? h('p', { class: 'muted small' }, step.description) : null,
        ...(step.options ?? []).map((/** @type {any} */ option) =>
          h('label', { class: 'q-option' }, h('input', { type, name, value: option.id }), h('span', null, h('span', null, option.label), option.description ? h('span', { class: 'muted small q-desc' }, option.description) : null)),
        ),
        h('label', { class: 'q-option other' }, h('input', { type, name, value: '__other__' }), h('span', null, t('questionOther'))),
        otherInput,
      ),
    );
    otherInput.addEventListener('input', () => {
      const other = /** @type {HTMLInputElement | null} */ (form.querySelector(`input[name="${name}"][value="__other__"]`));
      if (other && otherInput.value.trim()) other.checked = true;
    });
  });
  const agentApi = window.mcode?.miniapp?.agent;
  form.append(
    h(
      'div',
      { class: 'card-actions' },
      agentApi?.open && state.project?.sessionId ? h('button', { type: 'button', class: 'btn ghost', onclick: () => openConversation() }, t('decideInChat')) : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: () => void submitAnswers(steps, null) }, t('questionSkip')),
      steps.length ? h('button', { type: 'submit', class: 'btn primary' }, t('questionSubmit')) : null,
    ),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitAnswers(steps, form);
  });
  els.question.append(form);
}

/** @param {any[]} steps @param {HTMLFormElement | null} form */
async function submitAnswers(steps, form) {
  const answers = steps.map((step, index) => {
    if (!form) return { stepId: step.id, selectedOptionIds: [], selectedOther: false, skipped: true };
    const name = `step-${index}`;
    const checked = [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => /** @type {HTMLInputElement} */ (input).value);
    const otherText = /** @type {HTMLInputElement | null} */ (form.querySelector(`input[data-other-for="${name}"]`))?.value.trim() ?? '';
    const selectedOther = checked.includes('__other__') && !!otherText;
    const selectedOptionIds = checked.filter((value) => value !== '__other__');
    if (selectedOptionIds.length === 0 && !selectedOther) return { stepId: step.id, selectedOptionIds: [], selectedOther: false, skipped: true };
    return { stepId: step.id, selectedOptionIds, selectedOther, ...(selectedOther ? { otherText } : {}) };
  });
  if (answers.length === 0) return;
  try {
    await api('POST', `/api/projects/${state.currentId}/answer`, { answers, model: modelSelection() });
    await loadProject();
  } catch (error) {
    toast(/** @type {Error} */ (error).message, 'error');
  }
}

// ---------------------------------------------------------------------------------------------
// Composer

function buildComposer() {
  const textarea = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'composer-input', rows: '3', 'aria-label': t('placeholderNew'), maxlength: '20000' }));
  const modelSelect = /** @type {HTMLSelectElement} */ (h('select', { class: 'select', 'aria-label': t('model') }));
  const effortSelect = /** @type {HTMLSelectElement} */ (h('select', { class: 'select', 'aria-label': t('effort') }));
  const sendButton = /** @type {HTMLButtonElement} */ (h('button', { type: 'submit', class: 'btn primary icon-only send', 'aria-label': t('send'), title: t('send') }, icon('send')));
  const stopButton = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn danger icon-only', 'aria-label': t('stop'), title: t('stop'), hidden: true, onclick: stopRun }, icon('stop')));
  els.textarea = textarea;
  els.modelSelect = modelSelect;
  els.effortSelect = effortSelect;
  els.sendButton = sendButton;
  els.stopButton = stopButton;

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  });
  modelSelect.addEventListener('change', () => {
    state.modelKey = modelSelect.value;
    state.effort = '';
    saveModelPreference();
    renderModelControls();
  });
  effortSelect.addEventListener('change', () => {
    state.effort = effortSelect.value;
    saveModelPreference();
  });

  const form = /** @type {HTMLFormElement} */ (
    h(
      'form',
      { class: 'composer' },
      textarea,
      h('div', { class: 'composer-row' }, h('div', { class: 'model-controls' }, modelSelect, effortSelect), h('span', { class: 'spacer' }), stopButton, sendButton),
    )
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });
  return form;
}

function saveModelPreference() {
  localStorage.setItem(MODEL_KEY, JSON.stringify({ modelKey: state.modelKey, effort: state.effort }));
}

function renderModelControls() {
  const select = /** @type {HTMLSelectElement} */ (els.modelSelect);
  const effort = /** @type {HTMLSelectElement} */ (els.effortSelect);
  if (!state.models) {
    select.replaceChildren(h('option', { value: '' }, state.modelsFailed ? t('modelsUnavailable') : '…'));
    select.disabled = true;
    effort.hidden = true;
    return;
  }
  select.disabled = false;
  const defaultName = modelName(state.models.default) || state.models.default?.modelId || '';
  select.replaceChildren(
    h('option', { value: '' }, t('modelDefault', { name: defaultName })),
    ...state.models.models.map((/** @type {any} */ option) => h('option', { value: keyOf(option) }, option.displayName || option.modelId)),
  );
  if (state.modelKey && !currentModelOption()) state.modelKey = '';
  select.value = state.modelKey;
  const option = currentModelOption();
  const efforts = option?.thinking?.efforts ?? [];
  effort.hidden = efforts.length === 0;
  effort.replaceChildren(h('option', { value: '' }, t('effortAuto')), ...efforts.map((/** @type {string} */ value) => h('option', { value }, value)));
  if (!efforts.includes(state.effort)) state.effort = '';
  effort.value = state.effort;
}

function renderComposer() {
  const busy = !!state.live || state.sending;
  const textarea = /** @type {HTMLTextAreaElement} */ (els.textarea);
  textarea.placeholder = state.project ? t('placeholderFollow') : t('placeholderNew');
  textarea.setAttribute('aria-label', textarea.placeholder);
  /** @type {HTMLButtonElement} */ (els.sendButton).hidden = !!state.live;
  /** @type {HTMLButtonElement} */ (els.sendButton).disabled = busy || !state.agentAvailable;
  /** @type {HTMLButtonElement} */ (els.stopButton).hidden = !state.live;
}

/** @param {string} text */
function fillComposer(text) {
  const textarea = /** @type {HTMLTextAreaElement} */ (els.textarea);
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
  textarea.focus();
}

async function send() {
  const textarea = /** @type {HTMLTextAreaElement} */ (els.textarea);
  const text = textarea.value.trim();
  if (!text || state.live || state.sending || !state.agentAvailable) return;
  state.sending = true;
  renderComposer();
  try {
    if (!state.currentId) {
      const style = state.newStyle ? ('preset' in state.newStyle ? { preset: state.newStyle.preset } : state.newStyle) : null;
      const created = await api('POST', '/api/projects', { text, style, model: modelSelection() });
      textarea.value = '';
      textarea.dispatchEvent(new Event('input'));
      state.newStyle = null;
      await refreshState();
      await selectProject(created.id);
    } else {
      await api('POST', `/api/projects/${state.currentId}/messages`, { text, model: modelSelection() });
      textarea.value = '';
      textarea.dispatchEvent(new Event('input'));
      await loadProject();
    }
  } catch (error) {
    toast(/** @type {Error} */ (error).message, 'error');
  } finally {
    state.sending = false;
    renderComposer();
  }
}

async function stopRun() {
  if (!state.currentId) return;
  try {
    await api('POST', `/api/projects/${state.currentId}/cancel`, {});
  } catch (error) {
    toast(/** @type {Error} */ (error).message, 'error');
  }
}

// ---------------------------------------------------------------------------------------------
// Preview

function buildPreview() {
  const frame = /** @type {HTMLIFrameElement} */ (h('iframe', { class: 'preview-frame', sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', title: t('previewTab') }));
  const overlay = h('div', { class: 'preview-overlay', role: 'status' });
  const empty = h('div', { class: 'preview-empty' }, logo(), h('p', { class: 'muted' }, t('previewEmpty')));
  const versionSelect = /** @type {HTMLSelectElement} */ (h('select', { class: 'select', 'aria-label': t('versionOption', { n: '' }).trim() }));
  versionSelect.addEventListener('change', () => {
    const value = Number(versionSelect.value);
    showVersion(value === latestVersion() ? null : value);
  });
  const deviceGroup = h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': t('device') },
    ...(/** @type {const} */ (['desktop', 'tablet', 'phone'])).map((device) =>
      h('button', { type: 'button', class: 'seg', 'aria-label': t(device), title: t(device), dataset: { device }, onclick: () => setDevice(device) }, icon(device)),
    ),
  );
  const windowHandle = window.mcode?.miniapp?.window;
  const popButton = windowHandle
    ? h(
        'button',
        {
          type: 'button',
          class: 'btn icon-only ghost',
          'aria-label': t('popOut'),
          title: t('popOut'),
          onclick: () => void windowHandle.update({ mode: 'window' }).catch(() => {}),
        },
        icon('window'),
      )
    : null;
  els.popButton = popButton ?? h('span');
  els.versionSelect = versionSelect;
  els.deviceGroup = deviceGroup;
  els.frame = frame;
  els.overlay = overlay;
  els.previewEmpty = empty;
  els.previewActions = h(
    'div',
    { class: 'preview-actions' },
    h('button', { type: 'button', class: 'btn icon-only ghost', 'aria-label': t('reload'), title: t('reload'), onclick: () => preview.reload() }, icon('reload')),
    h('button', { type: 'button', class: 'btn icon-only ghost', 'aria-label': t('copy'), title: t('copy'), onclick: copyHtml }, icon('copy')),
    h('button', { type: 'button', class: 'btn icon-only ghost', 'aria-label': t('download'), title: t('download'), onclick: downloadHtml }, icon('download')),
    popButton,
  );
  els.stage = h('div', { class: 'stage' }, h('div', { class: 'device-frame' }, frame, overlay));
  return h(
    'section',
    { class: 'preview', id: 'preview-panel', role: 'tabpanel', 'aria-labelledby': 'tab-preview' },
    h('header', { class: 'preview-head' }, deviceGroup, versionSelect, h('span', { class: 'spacer' }), els.previewActions),
    h('div', { class: 'preview-body' }, els.stage, empty),
  );
}

/** @param {string} device */
function setDevice(device) {
  state.device = ['desktop', 'tablet', 'phone'].includes(device) ? device : 'desktop';
  localStorage.setItem(DEVICE_KEY, state.device);
  renderPreviewChrome();
}

function renderPreviewChrome() {
  const project = state.project;
  const latest = latestVersion();
  const shown = state.viewing ?? latest;
  els.preview.dataset.device = state.device;
  for (const button of els.deviceGroup.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (button).dataset.device === state.device));
  }
  const hasVersion = !!project && latest > 0;
  els.previewEmpty.hidden = hasVersion;
  els.stage.hidden = !hasVersion;
  const select = /** @type {HTMLSelectElement} */ (els.versionSelect);
  select.hidden = !hasVersion;
  els.previewActions.hidden = !hasVersion;
  if (hasVersion) {
    const versions = [...project.versions].reverse();
    select.replaceChildren(...versions.map((/** @type {any} */ v) => h('option', { value: String(v.n) }, v.n === latest ? t('latest', { n: v.n }) : t('versionOption', { n: v.n }))));
    select.value = String(shown);
  }
}

/** @param {number | null} n */
function showVersion(n) {
  state.viewing = n;
  renderPreviewChrome();
  renderThread();
  preview.sync();
  if (root.dataset.tab === 'chat' && window.matchMedia('(max-width: 759px)').matches) setTab('preview');
}

const preview = (() => {
  let loadedKey = '';
  let token = '';
  let html = '';
  let request = 0;
  let readySignals = 0;
  let consumedSignals = 0;
  let restores = 0;
  let watching = false;

  window.addEventListener('message', (event) => {
    const frame = /** @type {HTMLIFrameElement} */ (els.frame);
    if (!frame || event.source !== frame.contentWindow || !event.data || event.data.token !== token) return;
    if (event.data.type === 'ready') readySignals += 1;
    if (event.data.type === 'painted' || event.data.type === 'ready') els.overlay.hidden = true;
    // The design cannot open popups; a clicked https link is opened here, during the click.
    if (event.data.type === 'open' && typeof event.data.url === 'string') openExternal(event.data.url);
  });

  // Every document the design loads reports "ready" with this preview's token. A load that
  // does not is the design navigating itself away, so the design is put back (as fx0 does).
  // Timing alone is not used: a hidden panel throttles the design's timers.
  function watchLoads() {
    if (watching) return;
    watching = true;
    /** @type {HTMLIFrameElement} */ (els.frame).addEventListener('load', () => {
      setTimeout(() => {
        if (!html) return;
        if (readySignals > consumedSignals) {
          consumedSignals = readySignals;
          restores = 0;
          return;
        }
        // A design that is only slow to load must not reload forever.
        if (restores >= 2) return;
        restores += 1;
        restore();
      }, 600);
    });
  }

  function restore() {
    /** @type {HTMLIFrameElement} */ (els.frame).srcdoc = html;
  }

  async function sync() {
    const project = state.project;
    const n = state.viewing ?? latestVersion();
    if (!project || n === 0) {
      loadedKey = '';
      html = '';
      return;
    }
    const key = `${project.id}:${n}`;
    if (key === loadedKey) return;
    loadedKey = key;
    const mine = ++request;
    els.overlay.hidden = false;
    els.overlay.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), t('previewLoading'));
    try {
      const data = await api('GET', `/api/projects/${project.id}/preview/${n}`);
      if (mine !== request) return;
      watchLoads();
      token = data.token;
      html = data.html;
      consumedSignals = readySignals;
      restores = 0;
      /** @type {HTMLIFrameElement} */ (els.frame).srcdoc = html;
      // A document that never reports (scripts blocked by an error) still shows after a moment.
      setTimeout(() => {
        if (mine === request) els.overlay.hidden = true;
      }, 1500);
    } catch (error) {
      if (mine !== request) return;
      loadedKey = '';
      els.overlay.replaceChildren(
        h('span', null, t('previewFailed')),
        h('button', { type: 'button', class: 'btn small', onclick: () => void sync() }, t('retry')),
      );
    }
  }

  return {
    sync,
    reload() {
      loadedKey = '';
      void sync();
    },
    ensureShown() {
      void sync();
    },
    reset() {
      loadedKey = '';
      html = '';
      token = '';
      /** @type {HTMLIFrameElement} */ (els.frame).removeAttribute('srcdoc');
    },
  };
})();

async function currentHtml() {
  const project = state.project;
  const n = state.viewing ?? latestVersion();
  if (!project || n === 0) throw new Error('no version');
  const text = await api('GET', `/api/projects/${project.id}/versions/${n}`);
  return { text: String(text), n, project };
}

async function copyHtml() {
  try {
    const { text } = await currentHtml();
    await navigator.clipboard.writeText(text);
    toast(t('copied'));
  } catch {
    toast(t('copyFailed'), 'error');
  }
}

/** @param {string} title */
function fileSlug(title) {
  const slug = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .slice(0, 48);
  return slug || 'page';
}

async function downloadHtml() {
  try {
    const { text, n, project } = await currentHtml();
    const file = `${fileSlug(project.title)}-v${n}.html`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }));
    const link = h('a', { href: url, download: file, hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(t('downloaded', { file }));
  } catch {
    toast(t('errUNKNOWN'), 'error');
  }
}

// ---------------------------------------------------------------------------------------------
// Data flow

async function refreshState() {
  const data = await api('GET', '/api/state');
  state.agentAvailable = data.agentAvailable;
  state.projects = data.projects;
  state.styles = data.styles;
  renderProjects();
}

async function loadModels() {
  if (!state.agentAvailable) return;
  try {
    state.models = await api('GET', '/api/models');
    state.modelsFailed = false;
  } catch {
    state.modelsFailed = true;
  }
  renderModelControls();
  renderLive();
}

async function loadProject() {
  const id = state.currentId;
  if (!id) return;
  try {
    const project = await api('GET', `/api/projects/${id}`);
    if (state.currentId !== id) return;
    const grew = (project.versions.at(-1)?.n ?? 0) !== latestVersion();
    state.project = project;
    state.live = project.live;
    if (state.viewing !== null && !project.versions.some((/** @type {any} */ v) => v.n === state.viewing)) state.viewing = null;
    renderAll();
    if (grew && state.viewing === null) preview.sync();
  } catch (error) {
    if (/** @type {ApiError} */ (error).code === 'not_found') {
      await refreshState().catch(() => {});
      selectProject(null);
    }
  }
}

/** @param {string | null} id */
async function selectProject(id) {
  if (state.currentId !== id) {
    state.viewing = null;
    preview.reset();
  }
  state.currentId = id;
  state.project = null;
  state.live = null;
  state.scrollToEnd = true;
  history.replaceState(null, '', id ? `${location.pathname}?p=${id}` : location.pathname);
  toggleSidebar(false);
  renderAll();
  if (id) {
    await loadProject();
    const saved = state.project?.model;
    if (saved && state.models) {
      const option = state.models.models.find((/** @type {any} */ item) => keyOf(item) === keyOf(saved));
      if (option) {
        state.modelKey = keyOf(saved);
        state.effort = saved.thinking?.effort ?? '';
        renderModelControls();
      }
    }
  } else {
    setTab('chat');
    /** @type {HTMLTextAreaElement} */ (els.textarea).focus();
  }
}

function renderAll() {
  renderProjects();
  renderHeader();
  renderThread();
  renderLive();
  renderQuestion();
  renderComposer();
  renderPreviewChrome();
}

let projectTimer = 0;
let listTimer = 0;
function connectEvents() {
  const source = new EventSource('/api/events');
  let dropped = false;
  source.addEventListener('message', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === 'live' && data.id === state.currentId) {
      state.live = data.live;
      renderLive();
      renderComposer();
      renderHeader();
    } else if (data.type === 'project' && data.id === state.currentId) {
      clearTimeout(projectTimer);
      projectTimer = window.setTimeout(() => void loadProject(), 80);
    } else if (data.type === 'projects') {
      clearTimeout(listTimer);
      listTimer = window.setTimeout(() => void refreshState().catch(() => {}), 120);
    }
  });
  source.addEventListener('error', () => {
    dropped = true;
  });
  source.addEventListener('open', () => {
    if (!dropped) return;
    dropped = false;
    void refreshState().catch(() => {});
    void loadProject();
  });
}

function watchTheme() {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    document.documentElement.dataset.theme = query.matches ? 'dark' : 'light';
  };
  apply();
  query.addEventListener('change', apply);
}

async function boot() {
  watchTheme();
  buildShell();
  setDevice(state.device);
  renderModelControls();
  try {
    await refreshState();
  } catch (error) {
    els.banner.hidden = false;
    els.banner.textContent = /** @type {Error} */ (error).message;
  }
  connectEvents();
  void loadModels();
  // A page link is /studio?p=<id>; MiniMax Code can open it directly.
  const linked = new URLSearchParams(location.search).get('p') ?? '';
  await selectProject(/^p-[0-9a-f]{8}$/.test(linked) && state.projects.some((project) => project.id === linked) ? linked : null);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root.classList.contains('sidebar-open')) toggleSidebar(false);
  });
}

void boot();
