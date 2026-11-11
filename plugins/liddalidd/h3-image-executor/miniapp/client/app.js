'use strict';

// 页面是真正的多轮对话：一轮 = 一句用户消息 → 一段过程 → 一次交付。
// 追问会新开一轮，所以整个线程按轮数重建；重建后所有渲染签名都要作废，
// 否则"这一轮的内容没变"会把刚清空的 DOM 跳过不渲染。

const state = {
  sessionId: null,
  timer: null,
  clockTimer: null,
  refs: [],
  snapshot: null,
  // 轮询每 1.5s 会重建时间线，展开状态必须自己记住，否则一直自动收起。
  openEvents: new Set(),
  clockOffset: 0,
  // 渲染签名。键是 'u0'/'h0'/'s0'/'t0'/'d0' 这种"哪一轮的哪一块"，外加 sessions/interactions/images。
  sigs: {},
  sessionsAll: false,
  // 对话骨架是按"会话 + 轮数"重建的。
  threadFor: '',
  // 每一轮的 DOM 节点：渲染函数都从这里取节点，不再靠全局 id，
  // 因为同一个页面上现在有 N 份"过程 / 交付"。
  turnNodes: [],
  turns: [],
  // 输入口只有一个：底部 composer。mode 决定这次是开新会话，还是接着调已经打开的这张图。
  mode: 'new',
  // 用户主动点了「新建绘画」：这时页面是刻意留白的，不能被"自动打开最新会话"顶掉。
  fresh: false,
  // 滚到哪儿：'auto' 还没决定，'deliver' 钉在交付图上，'bottom' 跟随最新进展。
  anchor: 'auto',
  deliverSeen: false,
  // 需求字符数对不上时的警告：{ expected, actual, prompt }。只在从 MCode 带需求进来时可能非空。
  launchLenWarn: null,
  // 分享页落盘后等 MCode 发布，链接回填要几十秒；交付态已经停轮询，靠这个观察器接住。
  linkTimer: null,
  // 最近一次成功拉到的会话列表：加载失败时靠它保住屏幕上的内容，也是「用时」自增的数据源。
  sessionList: [],
  // 服务端 now 与本机时钟的差值，避免本机时间偏差把「用时」算歪。
  sessionsSkew: 0,
  // 列表加载失败后的自动重试句柄，以及失败提示的去重标记。
  sessionsRetry: null,
  sessionsFailed: false,
  // 列表里有进行中的会话时，才需要每秒刷新那一行的时间。
  sessionsClock: null,
  // 页面被 Host 回收后重新加载时，要回到的那个会话（见文件末尾的「视图状态」）。
  restoreSessionId: null,
};

const el = (id) => document.getElementById(id);

function clearSigs(keepSessions) {
  const sessions = state.sigs.sessions || '';
  state.sigs = keepSessions ? { sessions } : {};
}

// 统一请求封装。这里最重要的一条约束：失败必须让调用方看得见。
// 之前一律 catch 成 {}，于是「Host 网关回了 502 HTML 错误页」「响应体被截断」都被伪装成
// 「服务端返回了一个空对象」；调用方再把空对象读成「一条记录都没有」，侧边栏 24 条历史会被
// 当场清空，而且全程不报错——看起来就像数据被删光了。
function api(path, options) {
  return fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options))
    .then((response) =>
      response.text().then((text) => {
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          parsed = null;
        }
        // 业务错误（404 no_session、409 busy）本来就带 error，原样交回去，调用方的文案才准。
        if (parsed && parsed.error) return parsed;
        if (!response.ok) return { error: 'http_' + response.status, failed: true };
        // 2xx 但 body 不是 JSON：网关错误页或被截断的响应，绝不能当成「空数据」。
        if (!parsed) return { error: 'bad_response', failed: true };
        return parsed;
      }),
    )
    .catch(() => ({ error: 'network', failed: true }));
}

function fileUrl(kind, name, sub) {
  if (!state.sessionId || !name) return '';
  const params = new URLSearchParams({ session: state.sessionId, kind, name });
  if (sub) params.set('sub', sub);
  return '/api/file?' + params.toString();
}

// 事件详情里的缩略图：后端只给寻址键（cache/xxx.jpg、refs/R1.png），这里翻译成实际请求地址。
function thumbUrl(key) {
  const parts = String(key || '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return '';
  return fileUrl(parts[0], parts[1]);
}

// ---------------------------------------------------------------- 共享渲染原语
const { fmtDuration, fmtSeconds, fmtClock, fmtDateTime, STAGES, renderBlocks, renderPromptCompare } = window.H3Blocks;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// ---------------------------------------------------------------- 引擎状态

async function loadConfig() {
  const config = await api('/api/config');
  const target = el('engine');
  // 请求失败和「没配 Key」是两回事，混在一起会把排查方向带偏。失败就过几秒再问一次。
  if (!config || config.failed) {
    target.textContent = '引擎状态读取失败，稍后自动重试';
    target.className = 'engine bad';
    setTimeout(loadConfig, 5000);
    return;
  }
  if (config.ready) {
    // 侧边栏只放得下一行，Key 明细收进 title：既不挤掉状态，也不丢可排查信息。
    target.textContent = '引擎就绪 · ' + config.model;
    target.title =
      'Key ' + config.keyPreview + '（' + config.keyLength + ' 位）· 来源 ' + sourceLabel(config.source) +
      ' · ' + config.baseUrl + '\n点击可修改接口设置';
    target.className = 'engine ok';
  } else if (config.hasKey && !config.hasBaseUrl) {
    // 只有 Key 没有地址，请求根本发不出去。这两件事要分开说，
    // 混成一句「没配好」会让人反复检查一个本来就没问题的 Key。
    target.textContent = '已取到 Key，但缺少接口地址 · 点击填写';
    target.title = '来源 ' + sourceLabel(config.source) + '\n点击填写接口地址';
    target.className = 'engine bad';
  } else {
    target.textContent = '未配置生图接口 · 点击填写 Key 与地址';
    target.title = '也可以在 shell 配置里导出 MINIMAX_API_KEY 与 MINIMAX_BASE_URL';
    target.className = 'engine bad';
  }
  state.config = config;
}

function sourceLabel(source) {
  const map = { app: '本页面配置', env: '环境变量', none: '未配置' };
  if (!source) return '未配置';
  return map[source] || source;
}

// ---------------------------------------------------------------- 接口设置

const SETTINGS_ERRORS = {
  api_key_required: 'API Key 不能为空',
  api_key_has_space: 'API Key 里不能有空格或换行',
  api_key_too_long: 'API Key 太长了，请确认粘贴完整且没有多余内容',
  base_url_required: '接口地址不能为空',
  base_url_must_be_https: '接口地址必须以 https:// 开头',
  base_url_incomplete: '接口地址不完整，请补上域名',
  base_url_invalid: '接口地址不是合法的 URL',
  clipboard_empty: '剪贴板是空的',
  clipboard_multiline: '剪贴板里有多行或空格，请只复制 Key 本身',
  clipboard_too_long: '剪贴板内容太长了，请只复制 Key 本身',
  clipboard_not_key: '剪贴板里既不像 Key 也不像接口地址，请只复制其中一段',
  clipboard_unavailable: '这台机器上没有可用的剪贴板命令，请手动粘贴（Cmd+V）',
  clipboard_timeout: '读剪贴板超时了，请手动粘贴（Cmd+V）',
  network: '请求没发出去，请检查 Mini App 服务是否还在运行',
  bad_response: '服务端返回了无法解析的内容',
};

function openSettings() {
  const box = el('settings');
  const config = state.config || {};
  el('settings-error').hidden = true;
  el('settings-key').value = '';
  // 地址可以回显，Key 不行：页面上永远只留一个空的密码框。
  el('settings-url').value = config.stored ? config.baseUrl || '' : '';
  el('settings-note').textContent = config.ready
    ? '当前配置可用（来源：' + sourceLabel(config.source) + '）。重新填写会覆盖本页配置。'
    : '还没有可用配置。填好 Key 和接口地址后才能开始生图。';
  box.hidden = false;
  el('settings-key').focus();
}

// 剪贴板按钮：省掉「切到别处复制 → 切回来 Cmd+V」这一圈。
//
// 真正去读的是服务端，不是这里：Mini App 页面的 deviceAccess 不含 clipboard，
// navigator.clipboard.readText() 在面板里必然被拒（实测过，只会拿到 NotAllowedError）。
// 只填进输入框，不替用户点保存——Key 存不存、存哪个，用户自己按。
async function pasteKeyFromClipboard() {
  const button = el('settings-paste');
  button.disabled = true;
  const result = await api('/api/clipboard', { method: 'POST', body: '{}' });
  button.disabled = false;
  if (!result || result.error) {
    showSettingsError(SETTINGS_ERRORS[result && result.error] || '读不到剪贴板，请手动粘贴（Cmd+V）');
    return;
  }
  // 剪贴板里也可能是接口地址，那就填到地址栏去，别让用户自己分辨该放哪。
  const isUrl = result.field === 'baseUrl';
  const target = el(isUrl ? 'settings-url' : 'settings-key');
  target.value = result.value;
  el('settings-error').hidden = true;
  target.focus();
  flash(isUrl ? '已从剪贴板读入接口地址' : '已从剪贴板读入 Key，确认无误后点保存');
}

function closeSettings() {
  el('settings').hidden = true;
}

async function saveSettings() {
  const error = el('settings-error');
  const apiKey = el('settings-key').value.trim();
  const baseUrl = el('settings-url').value.trim();
  error.hidden = true;
  if (!apiKey) return showSettingsError('API Key 不能为空');
  if (!baseUrl) return showSettingsError('接口地址不能为空');
  const save = el('settings-save');
  save.disabled = true;
  const result = await api('/api/config', { method: 'POST', body: JSON.stringify({ apiKey, baseUrl }) });
  save.disabled = false;
  if (!result || result.error) {
    showSettingsError(SETTINGS_ERRORS[result && result.error] || '保存失败：' + ((result && result.error) || '未知错误'));
    return;
  }
  closeSettings();
  await loadConfig();
  flash('接口设置已保存');
}

async function clearSettings() {
  const result = await api('/api/config', { method: 'POST', body: JSON.stringify({ clear: true }) });
  if (!result || result.error) {
    showSettingsError('清除失败：' + ((result && result.error) || '未知错误'));
    return;
  }
  closeSettings();
  await loadConfig();
  flash('已清除本页配置');
}

function showSettingsError(message) {
  const error = el('settings-error');
  error.textContent = message;
  error.hidden = false;
}

// ---------------------------------------------------------------- 参考图

el('refs').addEventListener('change', (event) => {
  const files = Array.from(event.target.files || []).slice(0, 8);
  state.refs = [];
  const box = el('ref-thumbs');
  box.textContent = '';
  box.hidden = files.length === 0;
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      state.refs.push({ name: file.name, dataUrl: String(reader.result) });
      const img = node('img');
      img.src = String(reader.result);
      img.alt = file.name;
      box.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
});

// ---------------------------------------------------------------- 历史会话

const SESSION_PREVIEW = 3;

async function loadSessions() {
  const result = await api('/api/sessions');
  // 只有拿到真的数组才允许动 DOM。一次网关抖动就清空列表，等于告诉用户「你的历史没了」，
  // 而磁盘上一条都没少——这种假象比报错还糟，所以失败时保留上一次渲染的内容并自动重试。
  if (!result || !Array.isArray(result.sessions)) {
    if (!state.sessionsFailed) {
      state.sessionsFailed = true;
      flash('历史列表没加载出来，正在重试…');
    }
    scheduleSessionsRetry();
    return;
  }
  state.sessionsFailed = false;
  const list = result.sessions;
  state.sessionList = list;
  if (typeof result.now === 'number') state.sessionsSkew = result.now - Date.now();
  const box = el('sessions');
  // 签名只认结构变化。elapsedMs 对进行中的会话每秒都在走，让它参与签名会让整张列表每 1.5s
  // 被推倒重建一次，用户刚点开的删除确认条会被一起冲掉。「用时」交给 tickSessionMeta 单独刷新。
  const signature =
    list
      .map((item) => item.id + ':' + item.status + ':' + (item.busy ? 1 : 0) + ':' + item.delivered + ':' + item.images)
      .join('|') +
    '|' + (state.sessionsAll ? 'all' : 'few') + '|' + (state.sessionId || '');
  if (signature === state.sigs.sessions) return;
  state.sigs.sessions = signature;

  el('sessions-count').textContent = list.length ? list.length + ' 条' : '';
  box.textContent = '';
  if (!list.length) {
    box.appendChild(node('p', 'session-empty', '还没有历史会话'));
  }
  const shown = state.sessionsAll ? list : list.slice(0, SESSION_PREVIEW);
  shown.forEach((item) => {
    // 行本身是 button，操作按钮不能嵌在 button 里（HTML 不允许嵌套），所以套一层 wrapper，
    // 操作区绝对定位浮在行右侧，悬停才显形。
    const wrap = node('div', 'session-item');
    const row = node('button', 'session-row' + (item.id === state.sessionId ? ' current' : ''));
    row.type = 'button';
    row.title = item.id;
    const left = node('div', 'session-main');
    left.append(node('strong', null, item.instruction || '（空需求）'), node('span', 'meta', sessionMeta(item)));
    // 已交付是常态，列表里只留异常状态，标题才不会被标签挤掉。
    const quiet = item.status === 'delivered' && !item.busy ? ' quiet' : '';
    const pill = node('span', 'pill ' + statusClass(item.status) + quiet, sessionStatusLabel(item));
    row.append(left, pill);
    row.onclick = () => openSession(item.id);

    const actions = node('div', 'session-actions');
    const rerun = node('button', 'row-icon');
    rerun.type = 'button';
    rerun.title = '用同样的需求重画一次';
    rerun.setAttribute('aria-label', '重跑');
    rerun.appendChild(node('span', 'icon-rerun'));
    rerun.onclick = (event) => {
      event.stopPropagation();
      rerunSession(item.id, rerun);
    };
    const remove = node('button', 'row-icon');
    remove.type = 'button';
    remove.title = '删除这条会话';
    remove.setAttribute('aria-label', '删除');
    remove.appendChild(node('span', 'icon-trash'));
    remove.onclick = (event) => {
      event.stopPropagation();
      askDelete(item, wrap);
    };
    actions.append(rerun, remove);
    wrap.append(row, actions);
    box.appendChild(wrap);
  });

  if (list.length > SESSION_PREVIEW) {
    const more = node('button', 'session-more', state.sessionsAll ? '收起' : '显示全部 ' + list.length + ' 条');
    more.type = 'button';
    more.onclick = () => {
      state.sessionsAll = !state.sessionsAll;
      loadSessions();
    };
    box.appendChild(more);
  }

  if (!state.sessionId && list.length && !state.fresh) {
    // 页面重新加载后回到用户离开时看的那条；它已经被删掉就退回最新一条。
    const wanted = state.restoreSessionId && list.some((item) => item.id === state.restoreSessionId)
      ? state.restoreSessionId
      : list[0].id;
    state.restoreSessionId = null;
    openSession(wanted);
  }
  ensureSessionsClock();
}

// 加载失败不能就这么空着：4s 后自己再试一次，通了就把列表补回来，用户不用手动刷新。
function scheduleSessionsRetry() {
  if (state.sessionsRetry) return;
  state.sessionsRetry = setTimeout(() => {
    state.sessionsRetry = null;
    state.sigs.sessions = '';
    loadSessions();
  }, 4000);
}

// 进行中的会话「用时」一直在走，但不该因此重建整张列表：只改已渲染那一行的时间文本。
// 重建一次就会把用户点开的删除确认条冲掉，那正是「点了删除没反应」的来源。
function tickSessionMeta() {
  const list = state.sessionList;
  if (!list.length) return;
  el('sessions').querySelectorAll('.session-item').forEach((wrap, index) => {
    const item = list[index];
    if (!item || !item.busy) return;
    const meta = wrap.querySelector('.meta');
    if (!meta) return;
    item.elapsedMs = Date.now() + state.sessionsSkew - item.createdAt;
    meta.textContent = sessionMeta(item);
  });
}

// 只有列表里真的有人在跑时才开这个 1s 定时器，全跑完就关掉，不空转。
function ensureSessionsClock() {
  const busy = state.sessionList.some((item) => item.busy);
  if (busy && !state.sessionsClock) {
    state.sessionsClock = setInterval(tickSessionMeta, 1000);
  } else if (!busy && state.sessionsClock) {
    clearInterval(state.sessionsClock);
    state.sessionsClock = null;
  }
}

function sessionMeta(item) {
  const created = Number(item.createdAt) || 0;
  const date = new Date(created);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const when = sameDay ? fmtClock(created) : fmtDateTime(created).slice(5, 16);
  return (
    when + ' · 用时 ' + fmtDuration(item.elapsedMs) + ' · ' + item.delivered + '/' + item.images + ' 张' +
    (item.busy ? ' · 进行中' : '')
  );
}

function sessionStatusLabel(item) {
  if (item.busy) return '进行中';
  const map = { delivered: '已交付', failed: '失败', cancelled: '已取消', running: '进行中' };
  return map[item.status] || item.status;
}

function statusClass(status) {
  if (status === 'delivered') return 'pass';
  if (status === 'failed') return 'fail';
  if (status === 'cancelled') return 'warn';
  return '';
}

function openSession(id) {
  if (!id || id === state.sessionId) return;
  state.sessionId = id;
  state.fresh = false;
  resetThread();
  state.mode = 'followup';
  applyComposerMode();
  startPolling();
}

// 顶部浮一条短提示，复用分享浮层的样式，不再为每种消息各画一个。
function flash(text) {
  const app = document.querySelector('.app') || document.body;
  const old = app.querySelector('.share-toast');
  if (old) old.remove();
  const box = node('div', 'share-toast');
  box.appendChild(node('strong', null, text));
  app.appendChild(box);
  setTimeout(() => { box.remove(); }, 2400);
}

// 重跑：服务端拿原需求和参考图开一个新会话，回来直接切过去，原会话原封不动留着。
async function rerunSession(id, button) {
  if (button) button.disabled = true;
  const result = await api('/api/session/rerun', { method: 'POST', body: JSON.stringify({ id }) });
  if (button) button.disabled = false;
  if (result.error || !result.id) {
    flash(result.error === 'busy' ? '这条还在跑，等它结束再重跑' : '重跑失败');
    return;
  }
  state.sigs.sessions = '';
  await loadSessions();
  openSession(result.id);
}

// 删除要二次确认：目录虽然只是挪进 .trash，但误点一次就得自己去磁盘翻，不值得。
function askDelete(item, wrap) {
  if (wrap.querySelector('.session-confirm')) return;
  const bar = node('div', 'session-confirm');
  bar.appendChild(node('span', null, '删除这条？'));
  const yes = node('button', 'link-btn danger', '删除');
  yes.type = 'button';
  yes.onclick = (event) => {
    event.stopPropagation();
    confirmDelete(item.id);
  };
  const no = node('button', 'link-btn', '取消');
  no.type = 'button';
  no.onclick = (event) => {
    event.stopPropagation();
    bar.remove();
  };
  bar.append(yes, no);
  wrap.appendChild(bar);
}

async function confirmDelete(id) {
  const result = await api('/api/session/delete', { method: 'POST', body: JSON.stringify({ id }) });
  // 请求失败不等于删掉了。以前这里只看 result.error，而失败时拿到的 {} 里没有 error，
  // 于是会弹「已删除」并清空当前页面，服务端其实什么都没做。
  if (!result || result.error) {
    flash(result && result.error === 'busy' ? '这条还在跑，先停掉再删' : '删除没成功，历史还在');
    state.sigs.sessions = '';
    loadSessions();
    return;
  }
  // 删掉的正好是当前打开的这条，就回到空白页，别留着一个已经不存在的会话内容。
  // startNewPainting 内部已经在刷列表，这里不能再刷：两次并发渲染会互相覆盖，还白打一次接口。
  if (state.sessionId === id) {
    startNewPainting();
  } else {
    state.sigs.sessions = '';
    await loadSessions();
  }
  flash('已删除');
}

function resetThread() {
  state.openEvents = new Set();
  state.threadFor = '';
  state.anchor = 'auto';
  state.deliverSeen = false;
  if (state.linkTimer) {
    clearInterval(state.linkTimer);
    state.linkTimer = null;
  }
  clearSigs(true);
}

// 底部输入区是唯一输入口，文案跟着当前意图变，用户不用猜这次是新建还是接着调。
function applyComposerMode() {
  const follow = state.mode === 'followup' && Boolean(state.sessionId);
  el('instruction').placeholder = follow ? '继续调整这张图…' : '描述你要的图…';
  el('brief-hint').textContent = follow ? '接着调 ' + state.sessionId : '默认输出 4K';
}

// 「新建绘画」要给一个真正干净的页面：线程清空、轮询停掉、侧边栏取消选中，
// 而不是只把输入框的提示文案换一下、对话记录还留在屏幕上。
function startNewPainting(options) {
  const opts = options || {};
  // 当前这张还在跑的话，只是页面切走了，服务端不会停：得说清楚，别让人以为白等了。
  const wasRunning = !el('cancel').disabled;
  state.mode = 'new';
  state.fresh = true;
  state.sessionId = null;
  for (const key of ['timer', 'clockTimer', 'linkTimer']) {
    if (state[key]) {
      clearInterval(state[key]);
      state[key] = null;
    }
  }
  // 列表加载失败的重试也要收：否则它会在新页面上再触发一次无意义的刷新。
  if (state.sessionsRetry) {
    clearTimeout(state.sessionsRetry);
    state.sessionsRetry = null;
  }
  resetThread();
  state.threadFor = '';
  state.turns = [];
  state.turnNodes = [];
  showEmptyThread();
  // 参考图也一起清掉：既然是全新一页，就不该带着上一张的输入。
  state.refs = [];
  el('ref-thumbs').textContent = '';
  el('ref-thumbs').hidden = true;
  el('refs').value = '';
  el('topbar-title').textContent = '新建绘画';
  el('cancel').disabled = true;
  el('brief-form').classList.remove('compact');
  applyComposerMode();
  if (wasRunning) el('brief-hint').textContent = '上一张还在后台画，完成后到历史里看';
  // 侧边栏要立刻取消选中态，否则列表里还高亮着上一个会话。
  state.sigs.sessions = '';
  // skipLoad：带着需求启动时，启动代码紧接着就会自己调一次 loadSessions，这里再来一次是白打一个接口。
  if (!opts.skipLoad) loadSessions();
  el('instruction').focus();
}

function showEmptyThread() {
  const thread = el('thread');
  thread.textContent = '';
  const box = node('div', 'empty-state');
  box.id = 'empty-state';
  box.append(
    node('p', 'empty-title', '开始一次新的绘画'),
    node('p', 'empty-desc', '写下你要的图。检索参考图、规划、生成、校验、修正都会自动做完。'),
  );
  thread.appendChild(box);
}

el('new-session').addEventListener('click', startNewPainting);

// ---------------------------------------------------------------- 提交与轮询

el('brief-form').addEventListener('submit', (event) => {
  event.preventDefault();
  sendInstruction();
});

// 已经打开一个会话就接着调它，否则开新会话。同一个输入框，不让用户挑。
async function sendInstruction() {
  const input = el('instruction');
  const instruction = input.value.trim();
  if (!instruction) return;
  const follow = state.mode === 'followup' && Boolean(state.sessionId);
  el('start').disabled = true;
  el('brief-hint').textContent = follow ? '正在提交调整…' : '正在启动…';
  const result = follow
    ? await api('/api/session/followup', { method: 'POST', body: JSON.stringify({ id: state.sessionId, instruction }) })
    : await api('/api/session', { method: 'POST', body: JSON.stringify({ instruction, refs: state.refs }) });
  if (result.error || (!follow && !result.id)) {
    el('start').disabled = false;
    el('brief-hint').textContent = result.error === 'busy' ? '这个会话还在跑，等它结束' : '发送失败，请看引擎状态';
    return;
  }
  if (!follow) {
    state.sessionId = result.id;
    state.refs = [];
    el('ref-thumbs').textContent = '';
    el('ref-thumbs').hidden = true;
    el('refs').value = '';
  }
  input.value = '';
  autoGrow();
  state.mode = 'followup';
  state.fresh = false;
  // 服务端在 POST 返回之前就已经开好了新一轮，所以这里不用做乐观展示：
  // 紧接着的第一次轮询就能拿到新轮次，直接重建线程即可。
  resetThread();
  applyComposerMode();
  startPolling();
}

el('examples').addEventListener('click', (event) => {
  const target = event.target.closest('.example');
  if (!target) return;
  el('instruction').value = target.dataset.text || target.textContent;
  el('instruction').focus();
});

el('cancel').addEventListener('click', async () => {
  if (!state.sessionId) return;
  await api('/api/session/cancel', { method: 'POST', body: JSON.stringify({ id: state.sessionId }) });
});

el('sessions-refresh').addEventListener('click', () => {
  state.sigs.sessions = '';
  loadSessions();
});

// 引擎状态就是设置入口：没配好时它是唯一显眼的红字，点它最直接。
el('engine').addEventListener('click', openSettings);
el('settings-close').addEventListener('click', closeSettings);
el('settings-paste').addEventListener('click', pasteKeyFromClipboard);
// 报错要随输入消失：改完输入框还挂着一句上一次的错误，会让人以为没改对。
const hideSettingsError = () => { el('settings-error').hidden = true; };
el('settings-key').addEventListener('input', hideSettingsError);
el('settings-url').addEventListener('input', hideSettingsError);
el('settings-cancel').addEventListener('click', closeSettings);
el('settings-save').addEventListener('click', saveSettings);
el('settings-clear').addEventListener('click', clearSettings);
el('settings').addEventListener('click', (event) => {
  if (event.target === el('settings')) closeSettings();
});
el('settings-key').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) saveSettings();
});
el('settings-url').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) saveSettings();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el('settings').hidden) closeSettings();
});

// ---------------------------------------------------------------- 侧边栏折叠

// 收起只是视觉偏好，记在本地：下次打开保持用户上次的选择。
const SIDEBAR_KEY = 'h3.sidebar.collapsed';

function applySidebar(collapsed) {
  document.body.classList.toggle('collapsed', collapsed);
  el('sidebar-toggle').hidden = collapsed;
  el('sidebar-open').hidden = !collapsed;
}

function setSidebar(collapsed) {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  } catch (error) {
    // 隐私模式下写不了，那就只在本次生效。
  }
  applySidebar(collapsed);
}

el('sidebar-toggle').addEventListener('click', () => setSidebar(true));
el('sidebar-open').addEventListener('click', () => setSidebar(false));

try {
  applySidebar(localStorage.getItem(SIDEBAR_KEY) === '1');
} catch (error) {
  applySidebar(false);
}

// ---------------------------------------------------------------- 输入框

// 高度跟着内容走，到上限就自己滚，不再让用户拖右下角。
function autoGrow() {
  const input = el('instruction');
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
}

el('instruction').addEventListener('input', autoGrow);
el('instruction').addEventListener('keydown', (event) => {
  // isComposing 必须判：中文输入法选词时按回车不是发送。
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  el('brief-form').requestSubmit();
});

function startPolling() {
  if (state.timer) clearInterval(state.timer);
  poll();
  state.timer = setInterval(poll, 1500);
  startClock();
}

async function poll() {
  if (!state.sessionId) return;
  const snapshot = await api('/api/session?id=' + encodeURIComponent(state.sessionId));
  // render() 是整线程重建，喂它一个空对象等于把对话记录清空。没有 id 的一律不认。
  if (!snapshot || snapshot.error || !snapshot.id) return;
  state.snapshot = snapshot;
  const timing = snapshot.timing || {};
  state.clockOffset = Date.now() - (timing.now || Date.now());
  render(snapshot);
  loadSessions();
  if (!snapshot.busy && snapshot.status !== 'running') {
    clearInterval(state.timer);
    state.timer = null;
    el('start').disabled = false;
    el('cancel').disabled = true;
  } else {
    el('cancel').disabled = false;
  }
}

function startClock() {
  if (state.clockTimer) return;
  state.clockTimer = setInterval(tickClock, 1000);
}

// 发布是异步的：服务端起一个 Agent turn 去部署，量级在分钟级。交付态的会话 poll() 已经停了，
// 所以这里单开一个观察器盯 shareState：
// - 还是 publishing 就继续等
// - 变成 done 就重画（亮出「公开链接」）并把链接自动写进剪贴板——用户点一次「分享」，
//   拿到的就是「剪贴板里已经有链接了」，不用再点第二次复制
// - 变成 failed 就停下，按钮回到可重试状态
function watchSharePublish() {
  if (state.linkTimer) return;
  let tries = 0;
  state.linkTimer = setInterval(async () => {
    tries += 1;
    // 4s 一次、10 分钟为限：一个 turn 加上传 3MB，实测分钟级；给足余量，失败也不至于空转。
    if (tries > 150 || !state.sessionId) {
      clearInterval(state.linkTimer);
      state.linkTimer = null;
      return;
    }
    const snapshot = await api('/api/session?id=' + encodeURIComponent(state.sessionId));
    if (!snapshot || snapshot.error) return;
    if (snapshot.shareState === 'publishing') {
      // 发布要等用户在页面上允许 website_deploy：确认卡片在快照的 permissions 里，必须画出来。
      render(snapshot);
      return;
    }
    clearInterval(state.linkTimer);
    state.linkTimer = null;
    render(snapshot);
    if (snapshot.shareState === 'done' && snapshot.shareUrl) {
      if (snapshot.shareClip === 'ok') {
        // 服务端 pbcopy 已经写好了。页面不用再试一次——试了也要文档聚焦，多半白试。
        toastLinkCopied(snapshot.shareUrl, true);
      } else {
        const ok = await copyLink(snapshot.shareUrl);
        if (ok) toastLinkCopied(snapshot.shareUrl, false);
        else toastCopyFailed(snapshot.shareUrl);
      }
    }
  }, 4000);
}

// 只有最后一轮会跑，计时器只管它；更早的轮次用时是定值，渲染时写一次就行。
function tickClock() {
  const item = lastTurnNode();
  const view = state.turns[state.turns.length - 1];
  if (!item || !view) return;
  const elapsed = view.running ? Date.now() - state.clockOffset - view.at : view.elapsedMs;
  item.head.clock.textContent = fmtDuration(elapsed);
  item.head.clockLabel.textContent = view.running ? '已运行' : '总用时';
  const status = turnStatus(view);
  item.head.status.textContent = status.label;
  item.head.status.className = 'pill ' + status.kind;
}

function turnStatus(view) {
  if (view.running || view.status === 'running') return { label: '运行中', kind: 'running' };
  if (view.delivery || view.status === 'delivered') return { label: '已交付', kind: 'pass' };
  if (view.status === 'cancelled') return { label: '已取消', kind: 'warn' };
  if (view.status === 'failed') return { label: '失败', kind: 'fail' };
  return { label: '已结束', kind: '' };
}

// ---------------------------------------------------------------- 对话骨架

function lastTurnNode() {
  return state.turnNodes.length ? state.turnNodes[state.turnNodes.length - 1] : null;
}

// 老服务端或者异常快照没有 turns，退化成单轮，页面不至于空白。
function turnsOf(snapshot) {
  if (Array.isArray(snapshot.turns) && snapshot.turns.length) return snapshot.turns;
  return [
    {
      index: 0,
      instruction: snapshot.instruction || '',
      at: snapshot.createdAt || Date.now(),
      running: Boolean(snapshot.busy),
      status: snapshot.busy ? 'running' : snapshot.status,
      elapsedMs: (snapshot.timing || {}).elapsedMs || 0,
      cost: snapshot.cost || {},
      delivery: snapshot.delivery || null,
      events: snapshot.events || [],
      stageStats: snapshot.stageStats || [],
    },
  ];
}

// 骨架按"会话 + 轮数"重建一次，之后只更新各轮的内容，展开状态和滚动位置才不会丢。
function buildThread(turns) {
  const thread = el('thread');
  thread.textContent = '';
  state.turnNodes = turns.map((view, index) => buildTurn(view, index, index === turns.length - 1));
  state.turnNodes.forEach((item) => thread.appendChild(item.section));
  state.anchor = 'auto';
  state.deliverSeen = false;
  // DOM 刚被清空，签名必须一起作废。
  clearSigs(true);

}

// 分享页在当前页面里全屏预览。这个页面的每个请求都要带 Host 授权：
// window.open 新标签拿不到授权上下文，只会被 401 挡成一片空白；
// <a download> 在面板里落点不可控，点了也不知道文件去哪了。
// iframe 用 blob URL 渲染，既不走网络也不依赖下载，是唯一稳定能看的路径；
// 想发给别人就用预览条上的「另存为文件」。
function openSharePreview(url, sessionId) {
  const app = document.querySelector('.app');
  if (!app) return;
  const old = app.querySelector('.share-overlay');
  if (old) old.remove();
  if (state.shareUrl) URL.revokeObjectURL(state.shareUrl);
  state.shareUrl = url;

  const overlay = node('div', 'share-overlay');
  const bar = node('div', 'share-bar');
  bar.appendChild(node('span', 'share-title', '分享页预览 · ' + sessionId));
  const save = node('a', 'btn tiny share-save', '另存为文件');
  save.href = url;
  save.download = 'h3-' + sessionId + '.html';
  const close = node('button', 'btn tiny', '关闭预览');
  close.type = 'button';
  bar.appendChild(save);
  bar.appendChild(close);

  const frame = node('iframe', 'share-frame');
  frame.src = url;
  frame.title = '分享页预览';
  overlay.appendChild(bar);
  overlay.appendChild(frame);
  app.appendChild(overlay);

  const destroy = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') destroy();
  };
  close.addEventListener('click', destroy);
  document.addEventListener('keydown', onKey);
  close.focus();
}

function buildTurn(view, index, isLast) {
  const item = {
    index,
    isLast,
    section: node('section', 'turn' + (isLast ? ' current' : '')),
    touched: false,
    desired: null,
  };
  item.section.dataset.turn = String(index);

  const user = node('div', 'msg user');
  const userBubble = node('div', 'bubble');
  item.userText = node('div', 'msg-text', '');
  item.userRefs = node('div', 'msg-refs');
  item.userRefs.hidden = true;
  // 需求在传输里被改坏时挂在这里：错字会一路画到交付，必须紧挨着原文说清楚。
  item.userWarn = node('div', 'msg-warn');
  item.userWarn.hidden = true;
  userBubble.append(item.userText, item.userRefs, item.userWarn);
  user.appendChild(userBubble);

  const process = node('div', 'msg assistant');
  const processBubble = node('div', 'bubble');
  const head = node('div', 'msg-head');
  const status = node('span', 'pill', '运行中');
  const clockLabel = node('span', 'clock-label', '已运行');
  const clock = node('span', 'clock', '00:00');
  const summary = node('span', 'msg-summary', '');
  head.append(status, clockLabel, clock, summary);
  item.head = { status, clockLabel, clock, summary };

  const processBox = node('details', 'process');
  const processSummary = node('summary');
  item.summaryLabel = node('span', null, '过程详情');
  processSummary.appendChild(item.summaryLabel);
  const body = node('div', 'process-body');
  const stages = node('ol', 'pipeline');
  stages.setAttribute('aria-label', '流程阶段');
  const tools = node('div', 'timeline-tools');
  const expandAll = node('button', 'btn tiny', '全部展开');
  expandAll.type = 'button';
  const collapseAll = node('button', 'btn tiny', '全部收起');
  collapseAll.type = 'button';
  tools.append(expandAll, collapseAll, node('span', 'hint', '点任意一行展开，能看到这一步实际发给模型的提示词、工具调用和判定依据。'));
  const timeline = node('ul', 'timeline');
  body.append(stages, tools, timeline);
  // 候选与校验只反映"当前这一轮"的图，所以只建在最后一轮上。
  if (isLast) {
    item.imagesWrap = node('div', 'process-images');
    item.imagesWrap.hidden = true;
    item.imagesWrap.appendChild(node('h3', null, '候选与校验'));
    item.imagesBox = node('div');
    item.imagesWrap.appendChild(item.imagesBox);
    body.appendChild(item.imagesWrap);
  }
  processBox.append(processSummary, body);
  processBubble.append(head, processBox);
  process.appendChild(processBubble);
  item.process = processBox;
  item.headBox = head;
  item.stages = stages;
  item.timeline = timeline;

  const interact = node('div', 'msg assistant');
  interact.hidden = true;
  const interactBubble = node('div', 'bubble');
  item.interactions = node('div');
  interactBubble.appendChild(item.interactions);
  interact.appendChild(interactBubble);
  item.interact = interact;

  const deliver = node('div', 'msg assistant deliver');
  deliver.hidden = true;
  const deliverBubble = node('div', 'bubble');
  item.delivery = node('div');
  deliverBubble.appendChild(item.delivery);
  deliver.appendChild(deliverBubble);
  item.deliver = deliver;

  // 顺序：需求 → 交互 → 过程 → 交付。面板保持「过程在中间」的原顺序：有交付图之后
  // 靠折叠 + 降权把过程压成一行，而不是把交付提到过程前面——那是分享页才做的事。
  // 交付和交互平时都是 hidden，所以运行中看起来仍然是「需求 → 过程」，和以前一样。
  item.section.append(user, interact, process, deliver);

  expandAll.onclick = () => timeline.querySelectorAll('details.event-detail').forEach((one) => (one.open = true));
  collapseAll.onclick = () => timeline.querySelectorAll('details.event-detail').forEach((one) => (one.open = false));
  processBox.addEventListener('toggle', () => {
    // 程序自己设的 open 不算用户操作，否则运行中展开一次就永远收不起来。
    if (processBox.open !== item.desired) item.touched = true;
    applyProcessWeight(item);
  });
  return item;
}

// 交付完成之后，过程就该退到背景里。
// 状态、用时、生图数在交付头上都写着，过程头再摆一遍是重复，所以收起时整条头都藏掉，
// 只留一条低调的「过程详情」入口：想看的人点一下就行，但它不该和交付图抢视觉权重。
function applyProcessWeight(item) {
  const light = Boolean(item.hasDelivery) && !item.process.open;
  item.process.classList.toggle('compact', light);
  if (item.headBox) item.headBox.hidden = light;
}

// ---------------------------------------------------------------- 渲染

function render(snapshot) {
  const turns = turnsOf(snapshot);
  state.turns = turns;
  const key = snapshot.id + ':' + turns.length;
  if (state.threadFor !== key) {
    state.threadFor = key;
    buildThread(turns);
  }
  // 打开会话后输入区收窄：对话本身才是主体。
  el('brief-form').classList.add('compact');
  // 顶栏标题就是这一轮的需求原文：侧边栏收起后也能知道自己在看哪个会话。
  el('topbar-title').textContent = snapshot.instruction || 'H3-Image-Executor';
  const thread = el('thread');
  const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
  turns.forEach((view, index) => {
    const item = state.turnNodes[index];
    if (!item) return;
    renderUserMessage(view, item, snapshot);
    renderProcessHead(view, item, snapshot);
    renderStages(view, item);
    renderTimeline(view, item);
    renderDelivery(view, item, snapshot);
  });
  tickClock();
  renderInteractions(snapshot);
  renderImages(snapshot);
  followThread(thread, nearBottom, snapshot);
}

// 交付图是异步加载的，而且"滚到底"会把最该看的这张图切掉一截，
// 所以交付一出现就钉在图顶；运行中才跟随底部，且只在你本来就在看最新进展时跟。
function followThread(thread, nearBottom, snapshot) {
  const item = lastTurnNode();
  const delivered = Boolean(item) && !item.deliver.hidden && !snapshot.busy;
  if (delivered && !state.deliverSeen) {
    state.deliverSeen = true;
    state.anchor = 'deliver';
    alignDeliver(thread);
    return;
  }
  if (!delivered) state.anchor = 'bottom';
  if (state.anchor === 'bottom' && nearBottom) thread.scrollTop = thread.scrollHeight;
}

// 对齐到交付图本身：卡片头部只有一句"交付 N 张"，为它牺牲图的完整性不划算。
function alignDeliver(thread) {
  const item = lastTurnNode();
  if (!item || item.deliver.hidden) return;
  const target = item.deliver.querySelector('.deliver-item img') || item.deliver;
  const top = target.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop;
  thread.scrollTop = Math.max(0, top - 8);
}

function renderUserMessage(view, item, snapshot) {
  // 这条气泡只放用户自己上传的图。系统检索到的参考图属于执行过程，出现在轨迹里，
  // 混进这里会让用户以为"我给过这张图"。追问不带参考图，所以只有第一轮有。
  const mine = view.index === 0 ? (snapshot.refs || []).filter((ref) => ref.origin === 'user') : [];
  // 传输损坏警告只在「气泡里的原文正好是那条被改坏的 prompt」时出现。
  const warn = state.launchLenWarn && state.launchLenWarn.prompt === (view.instruction || '')
    ? state.launchLenWarn
    : null;
  const signature = (view.instruction || '') + ':' + mine.length + ':'
    + (warn ? warn.expected + '/' + warn.actual : '-');
  const key = 'u' + view.index;
  if (state.sigs[key] === signature) return;
  state.sigs[key] = signature;
  item.userText.textContent = view.instruction || '（空需求）';
  const box = item.userRefs;
  box.textContent = '';
  mine.forEach((ref) => {
    const img = node('img');
    img.src = fileUrl('refs', String(ref.file || '').split('/').pop());
    img.alt = ref.note || ref.id;
    img.onclick = () => openLightbox(img.src);
    box.appendChild(img);
  });
  box.hidden = !mine.length;
  if (item.userWarn) {
    item.userWarn.textContent = '';
    item.userWarn.hidden = !warn;
    if (warn) {
      item.userWarn.append(
        node('strong', null, '需求可能在传输中损坏'),
        node('span', null, 'Agent 说是 ' + warn.expected + ' 字，实际收到 ' + warn.actual
          + ' 字。已经开始画了，但请先核对上面这句话有没有错字。'),
      );
    }
  }
}

// 折叠起来时也要一眼看到"干了什么"，不然收起来就等于什么都没说。
function turnSummary(view, snapshot) {
  const parts = [];
  if (view.index === 0 && (snapshot.refs || []).length) parts.push('参考图 ' + snapshot.refs.length + ' 张');
  const cost = view.cost || {};
  if (cost.ditImages) parts.push('生图 ' + cost.ditImages + ' 张');
  if (cost.agentCalls) parts.push('Agent ' + cost.agentCalls + ' 次');
  return parts.join(' · ');
}

function renderProcessHead(view, item, snapshot) {
  state.shareLink = snapshot.shareUrl || '';
  // 交付完成后分享页已经自动落盘，公开链接随时可能被 MCode 回填。
  // 交付态的 poll 已经停了，这里主动盯着：链接一到，「分享」就直接变成可复制的状态，
  // 用户不用先点一次分享才知道有链接。
  // 刷新页面 / 切回会话时，如果服务端那一轮发布还在跑，观察器要重新挂上，不然按钮永远停在「发布中」。
  if (snapshot.shareState === 'publishing' && view.delivery && !view.running) watchSharePublish();
  const summary = turnSummary(view, snapshot);
  const signature = summary + ':' + (view.status || '') + ':' + view.running;
  const key = 'h' + view.index;
  if (state.sigs[key] !== signature) {
    state.sigs[key] = signature;
    item.head.summary.textContent = summary;
  }
  // 最后一轮的头部由 tickClock 每秒刷新，这里只写已经定格的更早轮次。
  if (!item.isLast) {
    item.head.clock.textContent = fmtDuration(view.elapsedMs);
    item.head.clockLabel.textContent = '用时';
    const status = turnStatus(view);
    item.head.status.textContent = status.label;
    item.head.status.className = 'pill ' + status.kind;
  }
  // 运行时展开看进度，交付后自动收起只看结果；用户手动开合过就不再自动接管。
  // 已经过去的轮次一律默认收起，没人想看三轮之前的流水账。
  const hasError = (view.events || []).some((event) => event.level === 'error');
  // 「有交付图」才算拿到结果——这时过程是背景材料，收起。
  // 注意不能只看 hasError：一次跑里出过 error 但图照样交付出来了（选优交付），
  // 这种会话结果已经在手，失败原因在交付卡的「选优交付」标签和 reason 里都写着，
  // 没必要为了它把整个过程摊开。
  const deliveredCount = view.delivery
    ? (view.delivery.items || []).filter((entry) => entry.file).length
    : 0;
  const hasResult = deliveredCount > 0;
  // 唯一必须展开的例外：交付 0 张的失败会话。错误事件只存在于过程详情里，
  // 折叠着等于把唯一的失败线索藏起来——用户只会看到「交付 0 张」，不知道失败在哪。
  const desired = (hasError && !hasResult) || (item.isLast ? Boolean(snapshot.busy) : false);
  if (item.desired !== desired) {
    item.desired = desired;
    if (!item.touched) item.process.open = desired;
  }
  item.hasDelivery = hasResult;
  applyProcessWeight(item);
}

function renderStages(view, item) {
  const stats = new Map((view.stageStats || []).map((entry) => [entry.stage, entry]));
  const events = view.events || [];
  const seen = new Set(events.map((event) => event.stage));
  const signature = JSON.stringify(view.stageStats || []) + view.running;
  const key = 's' + view.index;
  if (state.sigs[key] === signature) return;
  state.sigs[key] = signature;
  const list = item.stages;
  list.textContent = '';
  STAGES.forEach(([stage, label]) => {
    const entry = document.createElement('li');
    entry.append(node('span', 'step-dot'), node('span', 'step-name', label));
    const hit = stats.get(stage);
    if (hit && hit.spanMs > 0) entry.appendChild(node('span', 'step-dur', fmtSeconds(hit.spanMs)));
    if (seen.has(stage)) entry.className = view.running ? 'active' : 'done';
    list.appendChild(entry);
  });
}

function renderTimeline(view, item) {
  const events = view.events || [];
  const last = events.length ? events[events.length - 1] : null;
  const signature = events.length + ':' + (last ? last.seq + ':' + last.t : '') + ':' + view.running;
  const key = 't' + view.index;
  if (state.sigs[key] === signature) return;
  state.sigs[key] = signature;

  const list = item.timeline;
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const stats = window.H3Blocks.renderTimeline(list, events, {
    openSet: state.openEvents,
    image: thumbUrl,
    onImage: openLightbox,
  });
  item.summaryLabel.textContent = '过程详情（' + stats.events + ' 条 · ' + stats.groups + ' 步）';
  if (nearBottom) list.scrollTop = list.scrollHeight;
}

// 这一栏有按钮和选中态，1.5s 一次的轮询不能把它重建掉，否则用户点好的选项会被抹掉。
// 闸门和权限确认只可能出现在正在跑的那一轮，所以只渲染最后一轮。
function renderInteractions(snapshot) {
  const item = lastTurnNode();
  if (!item) return;
  const gate = snapshot.gate;
  const signature = JSON.stringify([
    (snapshot.permissions || []).map((record) => record.requestId),
    gate ? gate.id : '',
    snapshot.pendingQuestion ? snapshot.pendingQuestion.requestId : '',
  ]);
  if (state.sigs.interactions === signature) return;
  state.sigs.interactions = signature;

  const box = item.interactions;
  box.textContent = '';
  let count = 0;

  if (gate && (gate.questions || []).length) {
    count += 1;
    box.appendChild(buildGateCard(gate));
  }
  (snapshot.permissions || []).forEach((record) => {
    count += 1;
    const card = node('div', 'prompt-card');
    card.append(node('h3', null, '需要确认工具调用：' + record.toolName), node('p', 'meta', record.reason || ''));
    const allow = node('button', 'btn primary', '允许一次');
    allow.onclick = () => decide(record.requestId, 'allowOnce');
    const deny = node('button', 'btn danger', '拒绝');
    deny.onclick = () => decide(record.requestId, 'deny');
    card.append(allow, deny);
    box.appendChild(card);
  });

  const pending = snapshot.pendingQuestion;
  if (pending && pending.request) {
    count += 1;
    box.appendChild(buildQuestionCard(pending));
  }
  item.interact.hidden = count === 0;
}

// Agent 的问卷：每一步都要选（单选或多选），全部选完才提交。没有选项的步骤按跳过处理。
// 回答的形状见 docs/agent.md：每步一条 { stepId, selectedOptionIds, selectedOther }。
function buildQuestionCard(pending) {
  const request = pending.request || {};
  const steps = Array.isArray(request.steps) ? request.steps : [];
  const card = node('div', 'prompt-card gate-card');
  card.appendChild(node('h3', null, request.title || 'Agent 需要你补充信息'));
  const picks = new Map();
  const submit = node('button', 'btn primary', '提交回答');
  submit.type = 'button';
  const needsPick = (step) => Array.isArray(step.options) && step.options.length > 0;
  const refresh = () => {
    submit.disabled = steps.some((step) => needsPick(step) && !(picks.get(step.id) || new Set()).size);
  };
  steps.forEach((step) => {
    const block = node('div', 'gate-item');
    block.appendChild(node('p', 'gate-q', step.question || step.header || ''));
    if (step.description) block.appendChild(node('p', 'meta', step.description));
    const row = node('div', 'gate-options');
    const multiple = step.selectionMode === 'multiple';
    (step.options || []).forEach((option) => {
      const button = node('button', 'btn tiny', option.label);
      button.type = 'button';
      button.dataset.optionId = option.id;
      if (option.description) button.title = option.description;
      button.onclick = () => {
        const chosen = picks.get(step.id) || new Set();
        if (!multiple) chosen.clear();
        if (multiple && chosen.has(option.id)) chosen.delete(option.id);
        else chosen.add(option.id);
        picks.set(step.id, chosen);
        Array.from(row.children).forEach((one) => one.classList.toggle('picked', chosen.has(one.dataset.optionId)));
        refresh();
      };
      row.appendChild(button);
    });
    block.appendChild(row);
    card.appendChild(block);
  });
  submit.onclick = () => {
    submit.disabled = true;
    const answers = steps.map((step) => {
      const selected = Array.from(picks.get(step.id) || []);
      return needsPick(step)
        ? { stepId: step.id, selectedOptionIds: selected, selectedOther: false }
        : { stepId: step.id, selectedOptionIds: [], selectedOther: false, skipped: true };
    });
    submitAnswers(pending.requestId, answers);
  };
  refresh();
  const actions = node('div', 'gate-actions');
  actions.appendChild(submit);
  card.appendChild(actions);
  return card;
}

// 出图前的关键确认：不定也能继续，会按规划时选的默认方案出图。
function buildGateCard(gate) {
  const card = node('div', 'prompt-card gate-card');
  card.append(
    node('h3', null, '出图前需要你定 ' + gate.questions.length + ' 件事'),
    node('p', 'meta', '选完点「按这个出图」；不想选就按默认方案继续。'),
  );
  const picks = new Map();
  const submit = node('button', 'btn primary', '按这个出图');
  submit.disabled = true;
  gate.questions.forEach((item, index) => {
    const block = node('div', 'gate-item');
    block.appendChild(node('p', 'gate-q', item.text));
    const row = node('div', 'gate-options');
    const options = item.options && item.options.length ? item.options : [item.default || '按默认方案'];
    options.forEach((option) => {
      const button = node('button', 'btn tiny', option);
      if (option === item.default) button.classList.add('suggested');
      button.onclick = () => {
        picks.set(index, option);
        Array.from(row.children).forEach((one) => one.classList.toggle('picked', one === button));
        submit.disabled = picks.size < gate.questions.length;
      };
      row.appendChild(button);
    });
    block.appendChild(row);
    card.appendChild(block);
  });
  const actions = node('div', 'gate-actions');
  submit.onclick = () => answerGate(gate.questions.map((item, index) => ({ question: item.text, answer: picks.get(index) })));
  const skip = node('button', 'btn', '按默认方案继续');
  skip.onclick = () => answerGate([]);
  actions.append(submit, skip);
  card.appendChild(actions);
  return card;
}

async function answerGate(answers) {
  await api('/api/session/answer', { method: 'POST', body: JSON.stringify({ id: state.sessionId, answers }) });
  state.sigs.interactions = '';
  poll();
}

async function decide(requestId, decision) {
  const result = await api('/api/session/permission', {
    method: 'POST',
    body: JSON.stringify({ id: state.sessionId, requestId, decision }),
  });
  // 回复没送到也要说话：用户关掉了 Agent 权限时，Host 会拒绝这次回复。
  if (result && result.ok === false) {
    flash(result.code === 'NOT_PERMITTED'
      ? 'Agent 权限已关闭：在插件详情里重新打开 session.run 后再试'
      : '确认没有送达（' + (result.code || '未知原因') + '），这次请求可能已经结束');
  }
  poll();
}

async function submitAnswers(requestId, answers) {
  const result = await api('/api/session/answer', {
    method: 'POST',
    body: JSON.stringify({ id: state.sessionId, requestId, answers }),
  });
  if (result && result.error === 'no_question') flash('这份问卷已经结束了，回答没有提交');
  state.sigs.interactions = '';
  poll();
}

function renderImages(snapshot) {
  const item = lastTurnNode();
  if (!item || !item.imagesBox) return;
  const wrap = item.imagesWrap;
  const box = item.imagesBox;
  const signature = snapshot.id + ':' + JSON.stringify(snapshot.images).length + ':' + snapshot.busy;
  if (state.sigs.images === signature) return;
  state.sigs.images = signature;
  box.textContent = '';
  if (!snapshot.images.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  snapshot.images.forEach((image) => {
    const block = node('div', 'image-block');
    const head = node('div', 'image-head');
    head.append(
      node('h3', null, image.id + ' · ' + image.title),
      node('span', 'pill ' + image.status, statusLabel(image)),
      node(
        'span',
        'meta',
        image.spec.area + ' · ' + image.spec.aspectRatio + ' · ' + (image.spec.entry === 'edit' ? '带参考图' : '文生图'),
      ),
    );
    block.appendChild(head);

    if (image.blocked) block.appendChild(node('p', 'meta', '缺用户信息，未生成：' + (image.blockReason || '')));

    image.rounds.forEach((round) => {
      const wrapRound = node('div', 'round');
      const actionText = round.action && round.action.type === 'edit' ? '局部编辑' : '生成';
      wrapRound.appendChild(
        node(
          'div',
          'round-title',
          '第 ' + (round.index + 1) + ' 轮 · ' + actionText +
            (round.verdict ? ' · ' + round.verdict.note : '') +
            (round.error ? ' · ' + round.error : ''),
        ),
      );
      const grid = node('div', 'candidates');
      (round.candidates || []).forEach((candidate) => {
        grid.appendChild(renderCandidate(candidate, image.chosenId === candidate.id));
      });
      wrapRound.appendChild(grid);
      renderPromptCompare(
        wrapRound,
        (round.candidates || []).map((candidate) => ({
          id: candidate.id,
          prompt: candidate.prompt,
          revisedPrompt: candidate.revisedPrompt,
        })),
      );
      block.appendChild(wrapRound);
    });

    box.appendChild(block);
  });
}

function statusLabel(image) {
  if (image.blocked) return '阻塞';
  const map = { pending: '待生成', running: '进行中', passed: '通过', unpassed: '未通过（已选优交付）', failed: '失败' };
  return map[image.status] || image.status;
}

function renderCandidate(candidate, chosen) {
  const card = node('div', 'candidate' + (chosen ? ' chosen' : ''));
  const img = node('img');
  img.src = fileUrl('preview', candidate.previewFile || candidate.file);
  img.alt = candidate.id;
  img.onclick = () => openLightbox(fileUrl('image', candidate.file));
  card.appendChild(img);

  const body = node('div', 'candidate-body');
  body.appendChild(node('div', null, candidate.id + ' · ' + (candidate.size || '')));

  const chips = node('div', 'chips');
  if (candidate.verdict) {
    chips.appendChild(chip('hard ' + candidate.verdict.hardPassed + '/' + candidate.verdict.hardTotal, candidate.verdict.hardFailed.length ? 'fail' : 'pass'));
    chips.appendChild(chip('质量 ' + candidate.verdict.quality, ''));
  }
  const hasCastCheck = (candidate.checks || []).some((check) => check.id === 'P-cast');
  if (candidate.program && candidate.program.redCast) {
    chips.appendChild(chip('偏红 · 已打回重画', 'fail'));
  } else if (!hasCastCheck && candidate.program && candidate.program.drift) {
    chips.appendChild(chip(candidate.program.drift.label, candidate.program.drift.cast === 'none' ? 'pass' : 'warn'));
  }
  if (candidate.program && candidate.program.sharpness && candidate.program.sharpness.overSharpened) {
    chips.appendChild(chip('锐度 ' + candidate.program.sharpness.ratio + '×', 'warn'));
  }
  (candidate.checks || []).forEach((check) => {
    if (check.result === 'pass' && check.id.indexOf('P-text') !== 0) return;
    chips.appendChild(chip(check.text, check.result));
  });
  body.appendChild(chips);

  if (candidate.verdict && candidate.verdict.checks) {
    const detailBox = node('details', 'candidate-detail');
    detailBox.appendChild(node('summary', null, '评审逐项判定'));
    const inner = node('div', 'detail-body');
    renderBlocks(
      [
        {
          kind: 'list',
          label: '验收清单',
          items: Object.keys(candidate.verdict.checks).map((key) => {
            const entry = candidate.verdict.checks[key];
            const result = entry.result || '未评';
            return {
              tag: result === 'pass' ? 'pass' : result === 'fail' ? 'fail' : 'warn',
              text: key,
              note: (entry.note || '') + (result === 'uncertain' ? '（拿不准，放行）' : ''),
            };
          }),
        },
        candidate.verdict.summary ? { kind: 'text', label: '总评', text: candidate.verdict.summary } : null,
      ].filter(Boolean),
      inner,
    );
    detailBox.appendChild(inner);
    body.appendChild(detailBox);
  }

  card.appendChild(body);
  return card;
}

function chip(text, kind) {
  return node('span', 'chip' + (kind ? ' ' + kind : ''), text);
}

// 复制公开链接：clipboard API 在没有授权时会抛，降级到 execCommand，保证按钮永远有反馈。
async function copyLink(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    try {
      const box = node('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.style.position = 'fixed';
      box.style.top = '-1000px';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand('copy');
      box.remove();
      return ok;
    } catch (fallbackError) {
      return false;
    }
  }
}

// 复制成功的明确反馈：按钮文案会变，但用户未必盯着按钮，再给一条浮层把网址摆出来。
// viaServer 决定措辞：服务端 pbcopy 写进去的不依赖文档聚焦，页面自己写的依赖——
// 两者可靠性不一样，说法也不该一样。
function toastLinkCopied(text, viaServer) {
  const app = document.querySelector('.app') || document.body;
  const old = app.querySelector('.share-toast');
  if (old) old.remove();
  const box = node('div', 'share-toast');
  box.append(
    node('strong', null, viaServer ? '链接已放进剪贴板' : '链接已复制到剪贴板'),
    node('span', 'share-toast-url', text),
  );
  app.appendChild(box);
  setTimeout(() => { box.remove(); }, 2600);
}

// 复制失败也必须说话：静默失败最糟——用户以为剪贴板里有东西，粘出去是别的内容。
// 停留时间比成功提示长得多，用户要来得及手动选中那串地址。
function toastCopyFailed(text) {
  const app = document.querySelector('.app') || document.body;
  const old = app.querySelector('.share-toast');
  if (old) old.remove();
  const box = node('div', 'share-toast fail');
  box.append(node('strong', null, '没能自动复制，请手动复制'), node('span', 'share-toast-url', text));
  app.appendChild(box);
  setTimeout(() => { box.remove(); }, 9000);
}

// 分享控件。三件事分开，别挤在一个按钮里：
// - 预览：在本页全屏看自包含分享页。不发布、不联网、别人看不到。
// - 分享：没链接就发布成公开链接（服务端起一个 Agent turn 去部署），有链接就只是复制。
// - 公开链接：新标签打开已经发出去的页面。
//
// 发布要用户明确知道「会公开」，所以没链接时按钮文案写全称，并在下方挂一行常驻提示——
// 只放 title 里不够，title 要 hover 才看得到。
function buildShareTools(snapshot) {
  const tools = node('div', 'share-tools');
  const link = snapshot.shareUrl || '';
  const shareState = snapshot.shareState || 'idle';
  const shareError = snapshot.shareError || '';
  const publishing = shareState === 'publishing';

  // 预览：走 fetch 拿回 HTML 再开 object URL。不能用 window.open——这个页面的每个请求都要带
  // Host 授权，新标签拿不到授权上下文，只会被 401 挡成一片空白。
  const preview = node('button', 'btn tiny', '预览');
  preview.type = 'button';
  preview.title = '在本页全屏预览分享页。不发布、不联网，只有你自己能看到';
  preview.addEventListener('click', async () => {
    if (!state.sessionId) return;
    const label = preview.textContent;
    preview.disabled = true;
    preview.textContent = '生成中…';
    try {
      const query = '?id=' + encodeURIComponent(state.sessionId);
      const saved = await fetch('/api/session/share' + query + '&save=1');
      if (!saved.ok) throw new Error('HTTP ' + saved.status);
      state.shareSaved = await saved.json();
      const page = await fetch('/api/session/share' + query);
      if (!page.ok) throw new Error('HTTP ' + page.status);
      openSharePreview(URL.createObjectURL(await page.blob()), state.sessionId);
      preview.textContent = label;
    } catch (error) {
      preview.textContent = '预览失败';
      setTimeout(() => { preview.textContent = label; }, 2000);
    }
    preview.disabled = false;
  });

  const share = node('button', 'btn tiny', publishing ? '发布中…' : (link ? '分享' : '发布公开链接'));
  share.type = 'button';
  share.disabled = publishing;
  share.title = link
    ? '复制公开链接，任何人拿到都能打开'
    : '发布成公开链接：任何拿到链接的人都能打开这个页面。'
      + '发布会起一个 Agent 会话去部署，部署前需要你在页面上允许 website_deploy；'
      + '大约 1–3 分钟，好了自动把链接放进剪贴板';
  if (!link && shareState === 'failed') {
    share.title = '上次发布失败：' + (shareError || '未知原因') + '（点一下重试）';
  }

  const shareLink = node('a', 'share-link', '公开链接');
  shareLink.target = '_blank';
  shareLink.rel = 'noreferrer';
  shareLink.hidden = !link;
  if (link) {
    shareLink.href = link;
    shareLink.title = link;
  }

  share.addEventListener('click', async () => {
    if (!state.sessionId) return;
    // 链接已经在手：这一步就是「复制 + 告诉用户复制好了」，不再重新部署。
    if (link) {
      let ok = await copyLink(link);
      let viaServer = false;
      if (!ok) {
        // 页面侧写不进去（面板没焦点 / 没有用户激活）：退回服务端 pbcopy，它不看焦点。
        try {
          const res = await fetch('/api/session/share/copy', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: state.sessionId }),
          });
          ok = res.ok;
          viaServer = res.ok;
        } catch (error) {
          ok = false;
        }
      }
      share.textContent = ok ? '链接已复制' : '复制失败';
      if (ok) toastLinkCopied(link, viaServer);
      else toastCopyFailed(link);
      setTimeout(() => { share.textContent = '分享'; }, 2000);
      return;
    }
    // 点火：202 立刻返回，真正的部署在服务端后台跑；观察器负责把结果和剪贴板收尾。
    share.disabled = true;
    share.textContent = '发布中…';
    try {
      const res = await fetch('/api/session/share/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: state.sessionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
      watchSharePublish();
    } catch (error) {
      const reason = String(error && error.message ? error.message : error);
      share.disabled = false;
      share.textContent = '发布失败';
      share.title = reason + '（点一下重试）';
      setTimeout(() => { share.textContent = '发布公开链接'; }, 2600);
    }
  });

  tools.append(preview, share, shareLink);
  // 没链接时把「会公开」和「会公开什么」摆在明面上：这是用户点发布前唯一能看到的告知。
  if (!link) {
    tools.appendChild(node(
      'div',
      'share-note' + (shareState === 'failed' ? ' fail' : ''),
      publishing
        ? '正在部署：出现 website_deploy 确认时点「允许一次」才会发布，好了会自动把链接放进剪贴板'
        : (shareState === 'failed'
          ? '上次发布失败：' + (shareError || '未知原因')
          : '发布后任何拿到链接的人都能打开。页面包含你的需求、你上传和检索到的参考图、'
            + '生成图与评审图、发给模型的完整提示词和执行记录'),
    ));
  }
  return tools;
}
// 交付是这一整轮的结论：图要大、信息要少，细节全部收进折叠里。
function renderDelivery(view, item, snapshot) {
  const card = item.deliver;
  const box = item.delivery;
  const delivery = view.delivery;
  const key = 'd' + view.index;
  // shareUrl 也要进签名：发布完把链接回填之后，这块必须重画才能亮出「公开链接」。
  // 跨图结论同样要进签名，否则它变了这一块不会重画。
  const crossSig = delivery && delivery.crossCheck
    ? (delivery.crossCheck.consistent ? 'ok' : 'x' + (delivery.crossCheck.issues || []).length)
    : '-';
  // 失败原因也要进签名：追问改完 prompt 后 reason 会变，这块不重画就还显示旧报错。
  const failSig = delivery
    ? (delivery.items || []).filter((entry) => !entry.file).map((entry) => entry.id + '=' + (entry.reason || '')).join('|')
    : '';
  const signature =
    (delivery ? delivery.version : 0) + ':' +
    (delivery ? (delivery.items || []).length : 0) + ':' +
    crossSig + ':' +
    failSig + ':' +
    (snapshot.shareUrl || '') + ':' +
    // 发布状态也要进签名：publishing → done / failed 时按钮文案和提示行都得跟着重画，
    // 否则用户会盯着一个永远不变的「发布中」。
    (snapshot.shareState || 'idle') + ':' +
    (snapshot.shareError || '') + ':' +
    (snapshot.shareClip || '');
  if (state.sigs[key] === signature) return;
  state.sigs[key] = signature;
  box.textContent = '';
  if (!delivery) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const items = delivery.items || [];
  const done = items.filter((entry) => entry.file);
  const head = node('div', 'deliver-head');
  head.append(
    node('strong', null, '交付 ' + done.length + ' 张'),
    node(
      'span',
      'meta',
      'v' + delivery.version +
        ' · 生图 ' + ((view.cost || {}).ditImages || 0) + ' 张 · 用时 ' + fmtDuration(view.elapsedMs),
    ),
  );
  // 分享按钮放交付头，不放过程头：交付后视图会自动对齐到交付图，过程头早被滚出屏幕，
  // 用户想分享时根本找不到按钮。分享的是整个会话，所以只有最后一轮有。
  if (item.isLast && done.length) head.appendChild(buildShareTools(snapshot));
  // 跨图一致性：过了只给一个低调标记，没过才展开讲清楚哪里对不上。
  // 逐图评审看不到别的图，这一条是唯一能发现「同一个主体被画成两个样子」的地方。
  const cross = delivery.crossCheck || null;
  if (cross && cross.consistent) head.appendChild(node('span', 'pill pass', '主体一致'));
  const failed = items.filter((entry) => !entry.file);
  if (failed.length) head.appendChild(node('span', 'pill fail', failed.length + ' 张失败'));
  box.appendChild(head);

  // 有图没画出来时，失败原因必须顶到交付区最前面，而且要带接口原文。
  // 以前这里只有一句灰色「未生成」——用户看到「交付 0 张」，完全不知道发生了什么，
  // 报错全藏在折叠的「过程详情」里，等于没有。
  if (failed.length) {
    const failBox = node('div', 'deliver-fail');
    failBox.appendChild(
      node('strong', null, done.length ? failed.length + ' 张图没有生成出来' : '这一轮一张图都没生成出来'),
    );
    const failList = node('ul', 'fail-list');
    failed.forEach((entry) => {
      const row = node('li', 'fail-item');
      row.appendChild(node('div', 'fail-title', entry.id + ' · ' + entry.title));
      row.appendChild(node('div', 'fail-reason', entry.reason || '未生成'));
      if (entry.contentPolicy) {
        row.appendChild(
          node(
            'div',
            'fail-hint',
            '内容安全审核拒绝，重画不会过。请修改需求本身（例如换成原创角色或别的题材）后再重新发起。',
          ),
        );
      }
      failList.appendChild(row);
    });
    failBox.appendChild(failList);
    box.appendChild(failBox);
  }

  if (cross && !cross.consistent) {
    const issues = cross.issues || [];
    const warn = node('div', 'cross-warn');
    warn.appendChild(node('strong', null, '跨图主体不一致（' + issues.length + ' 处）'));
    if (cross.summary) warn.appendChild(node('p', 'cross-summary', cross.summary));
    if (issues.length) {
      const list = node('ul', 'cross-issues');
      for (const issue of issues.slice(0, 4)) {
        list.appendChild(
          node(
            'li',
            null,
            (issue.image ? issue.image + ' · ' : '') + (issue.subject ? issue.subject + '：' : '') + issue.problem,
          ),
        );
      }
      warn.appendChild(list);
    }
    box.appendChild(warn);
  }

  // 待确认项默认收起，而且放在图下面：一长串"需要你确认"排在图前面会把交付图整个挤出屏幕，
  // 而这一轮真正的结论是图，不是这些没定的细节。
  let ask = null;
  if (delivery.questions && delivery.questions.length) {
    ask = node('details', 'deliver-questions');
    ask.appendChild(node('summary', null, '需要你确认（' + delivery.questions.length + ' 项）'));
    ask.appendChild(node('p', null, delivery.questions.join('；')));
  }

  const shots = [];
  const grid = node('div', 'deliver-grid');
  items.forEach((entry) => {
    const cell = node('div', 'deliver-item');
    if (!entry.file) {
      cell.appendChild(node('p', 'meta', entry.id + ' · ' + entry.title + '：' + (entry.reason || '未生成')));
      grid.appendChild(cell);
      return;
    }
    // 用后端给的真实文件名，不要自己拼 .png：接口回 JPEG 时交付文件就是 .jpg。
    const src = fileUrl('deliver', String(entry.file).split('/').pop(), 'v' + delivery.version);
    const img = node('img');
    img.src = src;
    img.alt = entry.title;
    img.onclick = () => openLightbox(src);
    cell.appendChild(img);
    shots.push(img);

    const cap = node('div', 'deliver-cap');
    const title = node('div', 'deliver-title');
    title.append(
      node('strong', null, entry.id + ' · ' + entry.title),
      node('span', 'pill ' + (entry.status === 'passed' ? 'pass' : 'unpassed'), entry.status === 'passed' ? '通过' : '选优交付'),
    );
    cap.appendChild(title);
    const meta = node('div', 'meta', [entry.size || '-', entry.rounds + ' 轮', entry.verdict ? 'hard ' + entry.verdict.hardPassed + '/' + entry.verdict.hardTotal : ''].filter(Boolean).join(' · '));
    cap.appendChild(meta);
    // 交付后「过程详情」会自动收起，请求号不能跟着一起消失：
    // 反馈问题时要报的就是它，必须在交付图旁边常驻。
    if (entry.requestId) cap.appendChild(window.H3Blocks.reqChip(entry.requestId));

    const actions = node('div', 'deliver-actions');
    const open = node('button', 'btn tiny', '看大图');
    open.onclick = () => openLightbox(src);
    const download = node('a', 'btn tiny', '下载 4K');
    download.href = src;
    download.download = String(entry.file).split('/').pop();
    actions.append(open, download);
    cap.appendChild(actions);
    cell.appendChild(cap);
    grid.appendChild(cell);
  });
  // 一张都没出来时网格里全是同一批失败项的灰色重复文案，
  // 失败块已经讲清楚了，这里再铺一遍只是噪音。
  if (done.length) box.appendChild(grid);
  if (ask) box.appendChild(ask);

  const extra = node('details', 'deliver-extra');
  extra.appendChild(node('summary', null, '交付详情与 Prompt 对照'));
  const extraBody = node('div', 'detail-body');
  // 尺寸和轮次图下面已经写了，这里只留图上看不到的东西。
  items.forEach((entry) => {
    const rows = [
      entry.program && entry.program.redCast ? { kind: 'kv', label: entry.id + ' 色彩判定', value: '偏红，已打回重画' } : null,
      { kind: 'kv', label: entry.id + ' request_id', value: (entry.requestId || '').slice(0, 16) },
      entry.reason ? { kind: 'text', label: entry.id + ' 说明', text: entry.reason } : null,
    ].filter(Boolean);
    if (rows.length) renderBlocks(rows, extraBody);
  });
  extra.appendChild(extraBody);
  renderPromptCompare(
    extra,
    items.map((entry) => ({ id: entry.id + ' · ' + entry.title, prompt: entry.prompt, revisedPrompt: entry.revisedPrompt })),
    false,
    '张交付图',
  );
  box.appendChild(extra);

  // 交付图是异步加载的：加载完才占住高度，而对齐那一刻 scrollTop 会被当时的内容高度截断，
  // 结果就是图出来了、按钮和详情还在屏幕外。每张加载完再对齐一次，全加载完就停止接管。
  let pending = shots.length;
  const settled = () => {
    pending -= 1;
    if (state.anchor === 'deliver') alignDeliver(el('thread'));
    if (pending <= 0 && state.anchor === 'deliver') state.anchor = 'idle';
  };
  shots.forEach((img) => {
    if (img.complete && img.naturalWidth) settled();
    else img.addEventListener('load', settled, { once: true });
  });
}

// ---------------------------------------------------------------- 大图

function openLightbox(src) {
  el('lightbox-img').src = src;
  el('lightbox').hidden = false;
}
el('lightbox-close').addEventListener('click', () => {
  el('lightbox').hidden = true;
  el('lightbox-img').src = '';
});
el('lightbox').addEventListener('click', (event) => {
  if (event.target === el('lightbox')) {
    el('lightbox').hidden = true;
    el('lightbox-img').src = '';
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') el('lightbox').hidden = true;
});

// ---------------------------------------------------------------- 从 MCode 带着需求进来
// Agent 在聊天里收到画图需求时，不该自己在外面调生图工具，而应该把需求原样递进这里：
//   miniapp({ action: 'open', pluginId: 'h3-image-executor',
//             path: '/dashboard?prompt=' + encodeURIComponent(需求) + '&auto=1' })
// 页面读到 query 就自动填入并提交，用户看到的是「面板打开 → 已经在画」。
//
//   prompt / q  需求原文，交给输入框，一个字都不改写
//   auto        默认 1（填完直接提交）；auto=0 只填不提交，留给用户自己按发送
//   session     会话 ID（20261109-877482 这种）。带上它就是接着调那张图，不带就是开新的一张
function launchParams() {
  const search = location.search || '';
  if (!search || search === '?') return null;
  let params;
  try {
    params = new URLSearchParams(search);
  } catch (error) {
    return null;
  }
  const prompt = String(params.get('prompt') || params.get('q') || '').trim();
  const rawSession = String(params.get('session') || '').trim();
  // 只认 20261109-877482 这种形状。乱传的 id 会让页面停在一个根本不存在的会话上，
  // 轮询一直 404，而地址栏上还看不出问题在哪。
  const session = /^\d{8}-[a-z0-9]{4,}$/i.test(rawSession) ? rawSession : '';
  if (!prompt && !session) return null;
  const raw = params.get('auto');
  const auto = raw === null ? true : !/^(0|false|no|off)$/i.test(String(raw).trim());
  // len：Agent 声明的字符数，只用来做软校验。传了坏值就当没传，不能因此把整条需求挡掉。
  const rawLen = params.get('len');
  const numLen = rawLen === null ? NaN : Number(String(rawLen).trim());
  const len = Number.isInteger(numLen) && numLen > 0 ? numLen : null;
  return { prompt: prompt, session: session, auto: auto, len: len };
}

// 处理完立刻把 query 从地址栏抹掉，否则用户刷新一次就会把同一条需求再提交一遍。
// 只删自己认识的四个键，地址栏上别的参数原样留着。
function stripLaunchParams() {
  try {
    const keep = new URLSearchParams(location.search || '');
    ['prompt', 'q', 'auto', 'session', 'len'].forEach((key) => keep.delete(key));
    const rest = keep.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + (location.hash || ''));
  } catch (error) {
    // 宿主不让改 history 就算了：留着 query 只是刷新会重复提交，本次不受影响。
  }
}

async function applyLaunchParams() {
  const launch = launchParams();
  if (!launch) return false;
  // 先抹地址栏再干活：中途任何一步失败都不会让刷新重复提交。
  stripLaunchParams();

  // 没有 session 就是全新一张。必须先把页面切到空态：loadSessions 结尾会自动打开上一次的
  // 会话，那会把 mode 变成 followup，这条需求就被当成「追问上一张图」提交了。
  if (launch.session) {
    openSession(launch.session);
  } else {
    // skipLoad：启动代码紧接着就会自己调一次 loadSessions。
    startNewPainting({ skipLoad: true });
  }

  if (!launch.prompt) return true;
  const input = el('instruction');
  input.value = launch.prompt;
  autoGrow();
  input.focus();

  // 字符数软校验：Agent 传了 len 就比一下，对不上说明需求在传输里被改坏了。
  // 最常见的原因是模型自己做了 percent 编码又算错了字节：实测出现过需求里的字被换成别的字，
  // 整张图白画，页面上还看不出任何异常。
  // 只提示不拦截：用户可能自己改过字。但必须紧挨着原文说清楚，错字会一路画到交付。
  // 码点数和 UTF-16 长度都认，emoji 这类代理对不该误报。
  const actual = Array.from(launch.prompt).length;
  state.launchLenWarn =
    launch.len !== null && launch.len !== actual && launch.len !== launch.prompt.length
      ? { expected: launch.len, actual: actual, prompt: launch.prompt }
      : null;

  if (!launch.auto) {
    el('brief-hint').textContent = '已收到需求，确认后按发送';
    return true;
  }

  // 没配 Key 就别自动开跑：跑起来也只会立刻失败，用户还以为是自己需求写得不好。
  const config = await api('/api/config');
  // 读不到就当它就绪：接口抖动不该把用户的需求挡在门外，真没配 Key 服务端会当场报错，看得见。
  if (config && !config.failed && config.ready === false) {
    el('brief-hint').textContent = '先在左下角配好生图接口，再按发送';
    flash('需求已填好，先配置生图接口');
    return true;
  }
  flash('已从 MCode 收到需求，开始作画');
  await sendInstruction();
  return true;
}

// ---------------------------------------------------------------- 视图状态
// 页面隐藏时 Host 可能直接销毁它，用户回来时再重新加载，中间不保证有任何回调
// （docs/runtime.md「Lifecycle」）。所以 visibilitychange 变成 hidden 时把视图状态记到本地：
// 打开的是哪个会话、是不是「新建绘画」空白页、输入框里没发出去的字。
// 只存视图状态，不存业务数据：会话本身都在服务端的 dataDir 里。没发出去的参考图太大存不下，
// 只记张数，回来时提示重新添加。
const VIEW_KEY = 'h3.view';
const VIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function saveViewState() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      at: Date.now(),
      sessionId: state.sessionId || '',
      fresh: Boolean(state.fresh) && !state.sessionId,
      draft: el('instruction').value.slice(0, 4000),
      refCount: state.refs.length,
    }));
  } catch (error) {
    // 存储写不了（配额、隐私模式）就算了：回来时只是少恢复一点。
  }
}

function readViewState() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return null;
    if (Date.now() - Number(saved.at || 0) > VIEW_TTL_MS) return null;
    return saved;
  } catch (error) {
    return null;
  }
}

function restoreViewState() {
  const saved = readViewState();
  if (!saved) return;
  if (saved.fresh) {
    // skipLoad：启动代码紧接着就会调一次 loadSessions。
    startNewPainting({ skipLoad: true });
    if (Number(saved.refCount) > 0) {
      el('brief-hint').textContent = '页面重新加载过，之前选的 ' + saved.refCount + ' 张参考图需要重新添加';
    }
  } else if (/^\d{8}-[a-z0-9]{4,}$/i.test(String(saved.sessionId || ''))) {
    // 不直接 openSession：会话可能已经被删了。交给 loadSessions，列表里还有它才打开。
    state.restoreSessionId = saved.sessionId;
  }
  if (saved.draft && !el('instruction').value) {
    el('instruction').value = String(saved.draft);
    autoGrow();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveViewState();
});

applyComposerMode();
loadConfig();
// 从 MCode 带着需求进来时，以这次的需求为准，不恢复上一次的视图状态。
if (!launchParams()) restoreViewState();
// 顺序其实不敏感：applyLaunchParams 里的 startNewPainting / openSession 会把 mode 和
// sessionId 整个重置掉，不管 loadSessions 是不是已经自动打开了上一次的会话。
// 真正不能省的是那一步——不切空态就直接提交，这条需求会被当成「追问上一张图」
// 发到 /api/session/followup，用户会以为上一张白画了。
applyLaunchParams();
loadSessions();
