// 道闸运维知识助手 — Client logic.
// Every panel talks to the Node service over narrow business routes; no model call
// ever happens in the page.

const state = {
  view: 'kb',
  settings: null,
  routingModes: [],
  writeRoots: [],
  categories: [],
  ollama: null,
  onlineModel: null,
  documents: [],
  backups: [],
  deployLogs: [],
  kbFiles: [],
  kbSelected: null,
  patchFiles: [],
  patchSelected: null,
  patchId: null,
};

const VIEW_META = {
  kb: { title: '知识库', desc: '投喂道闸运维资料，建立可检索的本地知识库' },
  ask: { title: '运维问答', desc: '检索本地知识库，产出带来源的标准答案与解析' },
  patch: { title: 'AI 改代码', desc: '生成 SEARCH/REPLACE 补丁，备份后可回滚' },
  deploy: { title: '部署', desc: '执行已配置的部署命令并保留执行日志' },
  settings: { title: '路由与设置', desc: '切换模型路由模式，配置资料目录与备份位置' },
};

const VIEW_STATE_KEY = 'miniapp-view-state';

const element = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { ok: false, error: 'invalid_response', message: raw.slice(0, 200) };
  }
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || payload.error || `请求失败 (${response.status})`);
    error.code = payload.error || 'request_failed';
    throw error;
  }
  return payload;
}

function toast(message, tone = 'info') {
  const stack = element('toasts');
  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.tone = tone;
  node.textContent = message;
  stack.append(node);
  window.setTimeout(() => node.remove(), 5200);
}

function setNote(id, message, tone = '') {
  const node = element(id);
  if (!node) return;
  node.textContent = message;
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

function describeRoute(route) {
  if (!route) return '未知路由';
  const parts = [`路由：${route.requested}`];
  parts.push(`实际：${route.used === 'local' ? '本地' : '在线'}${route.model ? ` · ${route.model}` : ''}`);
  if (route.degraded) parts.push(`降级自：${route.degradedFrom === 'local' ? '本地' : '在线'}`);
  if (route.reason) parts.push(route.reason);
  return parts.join('｜');
}

/* ------------------------------------------------------------ view switch */

function switchView(name) {
  if (!VIEW_META[name]) return;
  state.view = name;
  for (const panel of document.querySelectorAll('.view-panel')) {
    panel.hidden = panel.id !== `view-${name}`;
  }
  for (const button of document.querySelectorAll('.nav-item')) {
    const active = button.dataset.view === name;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  element('view-title').textContent = VIEW_META[name].title;
  element('view-desc').textContent = VIEW_META[name].desc;
  saveViewState();
}

/* ------------------------------------------------------------ view state */

function saveViewState() {
  try {
    localStorage.setItem(
      VIEW_STATE_KEY,
      JSON.stringify({
        view: state.view,
        askQuestion: element('ask-question').value,
        askTopK: element('ask-topk').value,
        patchRequirement: element('patch-requirement').value,
        patchPath: element('patch-path').value,
      }),
    );
  } catch {
    /* storage may be unavailable */
  }
}

function restoreViewState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || 'null');
  } catch {
    saved = null;
  }
  if (!saved) return;
  if (saved.view && VIEW_META[saved.view]) state.view = saved.view;
  if (typeof saved.askQuestion === 'string') element('ask-question').value = saved.askQuestion;
  if (typeof saved.askTopK === 'string') element('ask-topk').value = saved.askTopK;
  if (typeof saved.patchRequirement === 'string') {
    element('patch-requirement').value = saved.patchRequirement;
  }
  if (typeof saved.patchPath === 'string') element('patch-path').value = saved.patchPath;
}

/* -------------------------------------------------------------- rendering */

function renderSidebarStatus() {
  const dot = element('status-dot');
  const text = element('status-text');
  if (state.ollama && state.ollama.reachable) {
    const chat = state.ollama.models.filter((model) =>
      (model.capabilities || []).includes('completion'),
    );
    const embedding = state.ollama.models.filter((model) =>
      (model.capabilities || []).includes('embedding'),
    );
    dot.dataset.state = chat.length ? 'ok' : 'warn';
    text.textContent = `本地 Ollama ${state.ollama.version || ''} 可用 · 对话模型 ${chat.length} 个 · 嵌入模型 ${embedding.length} 个`;
  } else {
    dot.dataset.state = 'error';
    text.textContent = `本地模型不可用：${(state.ollama && state.ollama.error) || '未知原因'}`;
  }
}

function renderDocuments() {
  element('kb-count').textContent = `${state.documents.length} 份`;
  const container = element('kb-documents');
  if (!state.documents.length) {
    container.innerHTML =
      '<div class="empty-state"><p class="empty-title">知识库还是空的</p><p>投喂一份运维手册或规则文件后即可开始问答。</p></div>';
    return;
  }
  const rows = state.documents
    .map((document) => {
      const route = document.modelRoute ? document.modelRoute.used : '';
      return `<tr>
        <td>
          <p class="cell-title">${escapeHtml(document.title || document.name)}</p>
          <p class="cell-meta">${escapeHtml(document.name)} · ${escapeHtml(document.kind)} · ${document.sizeBytes} 字节</p>
        </td>
        <td class="cell-nowrap">${escapeHtml(document.category)}</td>
        <td class="cell-nowrap">${document.chunkCount} 片段</td>
        <td>
          <p class="cell-title">${escapeHtml(String(document.summary || '').slice(0, 60) || '—')}</p>
          <p class="cell-meta">${escapeHtml(route ? `入库模型：${route}` : '')}</p>
        </td>
        <td class="cell-actions">
          <button type="button" class="btn btn-ghost btn-small" data-delete-document="${escapeHtml(document.id)}">删除</button>
        </td>
      </tr>`;
    })
    .join('');
  container.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>资料</th><th>分类</th><th>索引</th><th>摘要</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

function renderBackups() {
  element('backup-count').textContent = `${state.backups.length} 条`;
  const container = element('patch-backups');
  if (!state.backups.length) {
    container.innerHTML =
      '<div class="empty-state"><p class="empty-title">还没有备份记录</p><p>应用补丁时会自动备份原文并写入 manifest.json。</p></div>';
    return;
  }
  const rows = state.backups
    .map(
      (record) => `<tr>
        <td>
          <p class="cell-title">${escapeHtml(record.targetPath)}</p>
          <p class="cell-meta">${escapeHtml(record.backupDirectory)}</p>
        </td>
        <td class="cell-nowrap">${escapeHtml(record.status === 'rolled_back' ? '已回滚' : '已应用')}</td>
        <td class="cell-meta cell-nowrap">${escapeHtml(String(record.createdAt).replace('T', ' ').slice(0, 19))}</td>
        <td class="cell-actions">
          <button type="button" class="btn btn-ghost btn-small" data-rollback="${escapeHtml(record.id)}">回滚</button>
        </td>
      </tr>`,
    )
    .join('');
  container.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>目标文件</th><th>状态</th><th>时间</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

function renderDeploy() {
  const container = element('deploy-list');
  const commands = (state.settings && state.settings.deployCommands) || [];
  if (!commands.length) {
    container.innerHTML =
      '<div class="empty-state"><p class="empty-title">还没有部署命令</p><p>在左侧添加一条命令，工作目录必须在允许写入的目录之下。</p></div>';
  } else {
    container.innerHTML = `<div class="model-list">${commands
      .map(
        (command) => `<div class="model-row">
          <div>
            <p class="model-name">${escapeHtml(command.name)}</p>
            <p class="model-meta mono">${escapeHtml(command.command)}</p>
            <p class="model-meta">工作目录：${escapeHtml(command.workdir)}</p>
          </div>
          <div class="row-actions">
            <button type="button" class="btn btn-secondary btn-small" data-run-deploy="${escapeHtml(command.id)}">执行</button>
            <button type="button" class="btn btn-ghost btn-small" data-edit-deploy="${escapeHtml(command.id)}">编辑</button>
            <button type="button" class="btn btn-danger btn-small" data-remove-deploy="${escapeHtml(command.id)}">删除</button>
          </div>
        </div>`,
      )
      .join('')}</div>`;
  }

  element('deploy-log-count').textContent = `${state.deployLogs.length} 条`;
  const logs = element('deploy-logs');
  if (!state.deployLogs.length) {
    logs.innerHTML =
      '<div class="empty-state"><p class="empty-title">还没有执行记录</p><p>执行部署命令后这里会保留命令、退出码与输出。</p></div>';
  } else {
    logs.innerHTML = `<div class="model-list">${state.deployLogs
      .map(
        (log) => `<div class="model-row" style="flex-direction:column;align-items:stretch;gap:6px">
          <div class="row-actions" style="justify-content:space-between">
            <span class="model-name">${escapeHtml(log.name)}</span>
            <span class="pill" data-tone="${log.ok ? 'ok' : 'error'}">${log.ok ? '成功' : '失败'} · 退出码 ${log.code ?? '—'}</span>
          </div>
          <p class="model-meta mono">${escapeHtml(log.command)}</p>
          <p class="model-meta">${escapeHtml(log.workdir)} · ${log.durationMs}ms · ${escapeHtml(String(log.at).replace('T', ' ').slice(0, 19))}</p>
          ${log.stdout ? `<pre class="code-block">${escapeHtml(log.stdout.slice(0, 4000))}</pre>` : ''}
          ${log.stderr ? `<pre class="code-block">${escapeHtml(log.stderr.slice(0, 2000))}</pre>` : ''}
        </div>`,
      )
      .join('')}</div>`;
  }
}

function renderSettings() {
  const container = element('routing-modes');
  const current = state.settings ? state.settings.routingMode : 'auto';
  container.innerHTML = state.routingModes
    .map(
      (mode) =>
        `<button type="button" class="segmented-item" role="radio" data-routing="${escapeHtml(mode.id)}" aria-checked="${mode.id === current}">${escapeHtml(mode.label)}</button>`,
    )
    .join('');
  const active = state.routingModes.find((mode) => mode.id === current);
  element('routing-hint').textContent = active ? active.hint : '';

  const local = element('local-models');
  const models = (state.ollama && state.ollama.models) || [];
  if (!models.length) {
    local.innerHTML = `<div class="empty-state"><p class="empty-title">本地模型不可用</p><p>${escapeHtml((state.ollama && state.ollama.error) || '未检测到 Ollama')}</p></div>`;
  } else {
    local.innerHTML = `<div class="model-list">${models
      .map(
        (model) => `<div class="model-row">
          <div>
            <p class="model-name">${escapeHtml(model.name)}</p>
            <p class="model-meta">${escapeHtml(model.parameterSize || '未知规模')} · ${escapeHtml((model.capabilities || []).join(' / '))}</p>
          </div>
        </div>`,
      )
      .join('')}</div>`;
  }

  const online = element('online-model');
  online.innerHTML = `<div class="model-row">
      <div>
        <p class="model-name">${escapeHtml((state.onlineModel && state.onlineModel.label) || '在线模型')}</p>
        <p class="model-meta">${state.onlineModel && state.onlineModel.available ? '通道已就绪，用于本地失败时的降级' : '通道未授权，无法作为降级目标'}</p>
      </div>
      <span class="pill" data-tone="${state.onlineModel && state.onlineModel.available ? 'ok' : 'warn'}">${state.onlineModel && state.onlineModel.available ? '可用' : '不可用'}</span>
    </div>`;

  if (state.settings) {
    element('write-roots').value = (state.settings.writeRoots || []).join('\n');
    element('ingest-roots').value = (state.settings.ingestRoots || []).join('\n');
    element('backup-root').value = state.settings.backupRoot || '';
  }
}

function renderKbRoots() {
  const roots = (state.settings && state.settings.ingestRoots) || [];
  const select = element('kb-root');
  const previous = select.value;
  select.innerHTML = roots
    .map((root) => `<option value="${escapeHtml(root)}">${escapeHtml(root)}</option>`)
    .join('');
  if (roots.includes(previous)) select.value = previous;
}

function renderPatchRoots() {
  const select = element('patch-root');
  const previous = select.value;
  select.innerHTML = state.writeRoots
    .map((root) => `<option value="${escapeHtml(root)}">${escapeHtml(root)}</option>`)
    .join('');
  if (state.writeRoots.includes(previous)) select.value = previous;
  element('patch-roots-label').textContent = state.writeRoots.length
    ? state.writeRoots.join('、')
    : '尚未配置（请先在「路由与设置」中填写允许写入的目录）';
}

function renderCategories() {
  const select = element('kb-category');
  const previous = select.value;
  select.innerHTML = state.categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join('');
  if (state.categories.includes(previous)) select.value = previous;
}

function renderFileList(containerId, files, selectedPath, emptyText) {
  const container = element(containerId);
  if (!files.length) {
    container.innerHTML = `<div class="empty-state"><p>${escapeHtml(emptyText)}</p></div>`;
    return;
  }
  container.innerHTML = files
    .map(
      (file) => `<button type="button" class="picker-item" role="option" aria-selected="${file.path === selectedPath}" data-file="${escapeHtml(file.path)}">
        <span>${escapeHtml(file.name)}</span>
        <span class="picker-meta">${escapeHtml(file.relative)} · ${file.sizeBytes} 字节</span>
      </button>`,
    )
    .join('');
}

/* ---------------------------------------------------------------- actions */

async function loadState() {
  const payload = await api('/api/state');
  state.settings = payload.settings;
  state.routingModes = payload.routingModes || [];
  state.writeRoots = payload.writeRoots || [];
  state.categories = payload.categories || [];
  state.ollama = payload.ollama;
  state.onlineModel = payload.onlineModel;
  state.documents = payload.documents || [];
  state.backups = payload.backups || [];
  state.deployLogs = payload.deployLogs || [];

  renderSidebarStatus();
  renderCategories();
  renderKbRoots();
  renderPatchRoots();
  renderDocuments();
  renderBackups();
  renderDeploy();
  renderSettings();
}

async function loadFiles(kind, root) {
  const query = `kind=${encodeURIComponent(kind)}&root=${encodeURIComponent(root)}`;
  const payload = await api(`/api/files?${query}`);
  if (kind === 'document') {
    state.kbFiles = payload.files;
    state.kbSelected = null;
    renderFileList('kb-file-list', state.kbFiles, null, '该目录下没有可投喂的资料文件');
    element('kb-ingest-path-btn').disabled = true;
  } else {
    state.patchFiles = payload.files;
    state.patchSelected = null;
    renderFileList('patch-file-list', state.patchFiles, null, '该目录下没有可修改的源文件');
  }
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function ingestFromUpload(event) {
  event.preventDefault();
  const input = element('kb-files');
  const category = element('kb-category').value;
  const files = Array.from(input.files || []);
  if (!files.length) {
    setNote('kb-upload-status', '请先选择要投喂的文件', 'error');
    return;
  }
  const button = element('kb-upload-btn');
  button.disabled = true;
  try {
    for (const file of files) {
      setNote('kb-upload-status', `正在解析并索引：${file.name} …`);
      const dataBase64 = await fileToBase64(file);
      const payload = await api('/api/documents', {
        method: 'POST',
        body: { category, name: file.name, dataBase64 },
      });
      setNote(
        'kb-upload-status',
        `已投喂 ${payload.document.name}（${payload.document.chunkCount} 片段，模型：${payload.route.used === 'local' ? '本地' : '在线'}）`,
        'ok',
      );
      toast(`已入库：${payload.document.name}`, 'ok');
    }
    input.value = '';
    await loadState();
  } catch (error) {
    setNote('kb-upload-status', error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function ingestFromPath() {
  if (!state.kbSelected) return;
  const button = element('kb-ingest-path-btn');
  button.disabled = true;
  try {
    setNote('kb-browse-status', '正在解析并索引 …');
    const payload = await api('/api/documents', {
      method: 'POST',
      body: { category: element('kb-category').value, path: state.kbSelected },
    });
    setNote(
      'kb-browse-status',
      `已投喂 ${payload.document.name}（${payload.document.chunkCount} 片段）`,
      'ok',
    );
    toast(`已入库：${payload.document.name}`, 'ok');
    await loadState();
  } catch (error) {
    setNote('kb-browse-status', error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function submitQuestion(event) {
  event.preventDefault();
  const button = element('ask-btn');
  const question = element('ask-question').value.trim();
  if (!question) {
    setNote('ask-status', '请先输入问题', 'error');
    return;
  }
  button.disabled = true;
  setNote('ask-status', '正在检索知识库并生成答案 …');
  try {
    const payload = await api('/api/ask', {
      method: 'POST',
      body: { question, topK: Number(element('ask-topk').value) || undefined },
    });
    renderAnswer(payload);
    setNote('ask-status', '', '');
  } catch (error) {
    setNote('ask-status', error.message, 'error');
    element('ask-result-card').hidden = true;
  } finally {
    button.disabled = false;
  }
}

function renderAnswer(payload) {
  element('ask-result-card').hidden = false;
  element('ask-route-pill').textContent =
    payload.route.used === 'local' ? `本地模型 · ${payload.route.model}` : '在线模型';
  element('ask-route-pill').dataset.tone = payload.route.degraded ? 'warn' : 'ok';

  const confidence =
    typeof payload.answer.confidence === 'number' ? `${payload.answer.confidence} / 100` : '未给出';
  const missing = payload.answer.missing.length
    ? `<div class="answer-block"><p class="answer-label">资料未覆盖</p><p class="answer-text">${payload.answer.missing
        .map((item) => `· ${escapeHtml(item)}`)
        .join('\n')}</p></div>`
    : '';

  const sources = payload.sources.length
    ? `<div class="answer-block">
        <p class="answer-label">检索到的来源（按相关度排序）</p>
        <div class="source-list">${payload.sources
          .map(
            (source) => `<div class="source-item">
              <div class="source-head">
                <span class="source-name">${escapeHtml(source.documentName)}</span>
                <span class="pill">${escapeHtml(source.category)}</span>
                <span class="pill">片段 ${source.chunkIndex + 1}</span>
                <span class="pill">相关度 ${source.score}</span>
              </div>
              <p class="source-text">${escapeHtml(source.preview)}</p>
            </div>`,
          )
          .join('')}</div>
      </div>`
    : `<div class="answer-block"><p class="answer-label">检索到的来源</p><p class="answer-text">知识库中没有匹配的资料片段，请先投喂相关运维资料。</p></div>`;

  element('ask-result').innerHTML = `
    <div class="answer-block">
      <p class="answer-label">标准答案</p>
      <p class="answer-text">${escapeHtml(payload.answer.standardAnswer)}</p>
    </div>
    <div class="answer-block">
      <p class="answer-label">解析</p>
      <p class="answer-text">${escapeHtml(payload.answer.analysis || '模型未单独给出解析')}</p>
    </div>
    <div class="answer-block">
      <p class="answer-label">置信度</p>
      <p class="answer-text">${escapeHtml(confidence)}</p>
    </div>
    ${missing}
    ${sources}
    <div class="answer-block">
      <p class="answer-label">调用路由</p>
      <p class="answer-text">${escapeHtml(describeRoute(payload.route))}</p>
    </div>`;
}

async function submitPatch(event) {
  event.preventDefault();
  const button = element('patch-preview-btn');
  const targetPath = element('patch-path').value.trim();
  const requirement = element('patch-requirement').value.trim();
  if (!targetPath) {
    setNote('patch-status', '请先选择或填写目标文件路径', 'error');
    return;
  }
  if (!requirement) {
    setNote('patch-status', '请先描述修改要求', 'error');
    return;
  }
  button.disabled = true;
  setNote('patch-status', '模型正在定位代码并生成补丁 …');
  try {
    const payload = await api('/api/patch', { method: 'POST', body: { targetPath, requirement } });
    state.patchId = payload.patchId;
    renderPatch(payload);
    setNote('patch-status', '', '');
  } catch (error) {
    setNote('patch-status', error.message, 'error');
    element('patch-result-card').hidden = true;
  } finally {
    button.disabled = false;
  }
}

function renderPatch(payload) {
  element('patch-result-card').hidden = false;
  element('patch-route-pill').textContent =
    payload.route.used === 'local' ? `本地模型 · ${payload.route.model}` : '在线模型';
  element('patch-route-pill').dataset.tone = payload.route.degraded ? 'warn' : 'ok';

  const blocks = payload.blocks
    .map(
      (block, index) => `<div class="answer-block">
        <p class="answer-label">补丁块 ${index + 1} · SEARCH 必须唯一匹配原文</p>
        <pre class="code-block"><span class="diff-del">&lt;&lt;&lt;&lt;&lt;&lt;&lt; SEARCH</span>
${escapeHtml(block.search)}
<span class="diff-hunk">=======</span>
${escapeHtml(block.replace)}
<span class="diff-add">&gt;&gt;&gt;&gt;&gt;&gt;&gt; REPLACE</span></pre>
      </div>`,
    )
    .join('');

  const diff = payload.diff
    .split('\n')
    .map((line) => {
      if (line.startsWith('@@')) return `<span class="diff-hunk">${escapeHtml(line)}</span>`;
      if (line.startsWith('+')) return `<span class="diff-add">${escapeHtml(line)}</span>`;
      if (line.startsWith('-')) return `<span class="diff-del">${escapeHtml(line)}</span>`;
      return escapeHtml(line);
    })
    .join('\n');

  element('patch-result').innerHTML = `
    <div class="answer-block">
      <p class="answer-label">目标文件</p>
      <p class="answer-text mono">${escapeHtml(payload.targetPath)}</p>
      <p class="answer-label" style="margin-top:8px">定位方式</p>
      <p class="answer-text">${escapeHtml(payload.locatedBy)} · 第 ${payload.window.from}-${payload.window.to} 行 · 文件共 ${payload.fileLines} 行${payload.window.truncated ? '（区域已截断）' : ''}</p>
    </div>
    ${blocks}
    <div class="answer-block">
      <p class="answer-label">unified diff</p>
      <pre class="code-block">${diff}</pre>
    </div>
    <div class="answer-block">
      <p class="answer-label">调用路由</p>
      <p class="answer-text">${escapeHtml(describeRoute(payload.route))}</p>
    </div>
    <div class="row-actions">
      <button type="button" class="btn btn-primary" data-apply-patch="${escapeHtml(payload.patchId)}">应用到文件</button>
      <span class="form-note">应用前会自动备份原文并写入 manifest.json。</span>
    </div>`;
}

async function applyPatch(patchId) {
  if (!patchId) return;
  try {
    const payload = await api('/api/patch/apply', { method: 'POST', body: { patchId } });
    toast(`已写入，备份目录：${payload.backupPath}`, 'ok');
    element('patch-result').insertAdjacentHTML(
      'beforeend',
      `<div class="answer-block"><p class="answer-label">应用结果</p>
        <p class="answer-text">备份目录：${escapeHtml(payload.backupPath)}<br>manifest：${escapeHtml(payload.manifestPath)}<br>原文件哈希：${escapeHtml(payload.sha256Before)}<br>新文件哈希：${escapeHtml(payload.sha256After)}</p></div>`,
    );
    await loadState();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function rollbackOperation(operationId) {
  try {
    const payload = await api('/api/rollback', { method: 'POST', body: { operationId } });
    if (payload.ok) toast(`已回滚：${payload.targetPath}`, 'ok');
    else toast('回滚后校验失败，请检查备份文件', 'error');
    await loadState();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function saveDeployCommands() {
  const name = element('deploy-name').value.trim();
  const command = element('deploy-command').value.trim();
  const workdir = element('deploy-workdir').value.trim();
  if (!command) {
    setNote('deploy-config-status', '请填写要执行的命令', 'error');
    return;
  }
  const commands = [...((state.settings && state.settings.deployCommands) || [])];
  const existingIndex = commands.findIndex((item) => item.name === name && name);
  const entry = { id: existingIndex >= 0 ? commands[existingIndex].id : `cmd-${Date.now()}`, name: name || command, command, workdir };
  if (existingIndex >= 0) commands[existingIndex] = entry;
  else commands.push(entry);
  try {
    await api('/api/settings', { method: 'POST', body: { deployCommands: commands } });
    setNote('deploy-config-status', '已保存部署命令', 'ok');
    toast('部署命令已保存', 'ok');
    await loadState();
  } catch (error) {
    setNote('deploy-config-status', error.message, 'error');
  }
}

async function runDeploy(commandId) {
  try {
    const payload = await api('/api/deploy', { method: 'POST', body: { commandId } });
    const log = payload.log;
    if (log.ok) toast(`命令执行成功：${log.name}`, 'ok');
    else toast(`命令执行失败（退出码 ${log.code ?? '—'}）`, 'error');
    await loadState();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeDeploy(commandId) {
  const commands = ((state.settings && state.settings.deployCommands) || []).filter(
    (item) => item.id !== commandId,
  );
  try {
    await api('/api/settings', { method: 'POST', body: { deployCommands: commands } });
    await loadState();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function setRoutingMode(mode) {
  try {
    await api('/api/settings', { method: 'POST', body: { routingMode: mode } });
    await loadState();
    toast(`路由模式已切换为 ${mode}`, 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function saveRoots(event) {
  event.preventDefault();
  const writeRoots = element('write-roots')
    .value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const roots = element('ingest-roots')
    .value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    await api('/api/settings', {
      method: 'POST',
      body: {
        writeRoots,
        ingestRoots: roots,
        backupRoot: element('backup-root').value.trim(),
      },
    });
    setNote('roots-status', '已保存允许写入的目录、资料目录与备份位置', 'ok');
    toast('设置已保存', 'ok');
    await loadState();
  } catch (error) {
    setNote('roots-status', error.message, 'error');
  }
}

async function deleteDocument(documentId) {
  try {
    await api(`/api/documents?id=${encodeURIComponent(documentId)}`, { method: 'DELETE' });
    toast('资料已从知识库移除', 'ok');
    await loadState();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ----------------------------------------------------------------- wiring */

function bindEvents() {
  for (const button of document.querySelectorAll('.nav-item')) {
    button.addEventListener('click', () => switchView(button.dataset.view));
  }

  element('topbar-actions').innerHTML =
    '<button type="button" class="btn btn-secondary btn-small" id="refresh-state">刷新状态</button>';
  element('refresh-state').addEventListener('click', async () => {
    try {
      await loadState();
      toast('状态已刷新', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  element('kb-upload-form').addEventListener('submit', ingestFromUpload);
  element('kb-ingest-path-btn').addEventListener('click', ingestFromPath);
  element('kb-root').addEventListener('change', async () => {
    try {
      await loadFiles('document', element('kb-root').value);
      setNote('kb-browse-status', '');
    } catch (error) {
      setNote('kb-browse-status', error.message, 'error');
    }
  });
  element('kb-file-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-file]');
    if (!button) return;
    state.kbSelected = button.dataset.file;
    renderFileList('kb-file-list', state.kbFiles, state.kbSelected, '');
    element('kb-ingest-path-btn').disabled = false;
  });

  element('ask-form').addEventListener('submit', submitQuestion);

  element('patch-form').addEventListener('submit', submitPatch);
  element('patch-root').addEventListener('change', async () => {
    try {
      await loadFiles('code', element('patch-root').value);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  element('patch-file-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-file]');
    if (!button) return;
    state.patchSelected = button.dataset.file;
    element('patch-path').value = button.dataset.file;
    renderFileList('patch-file-list', state.patchFiles, state.patchSelected, '');
  });

  element('patch-result').addEventListener('click', (event) => {
    const button = event.target.closest('[data-apply-patch]');
    if (button) void applyPatch(button.dataset.applyPatch);
  });
  element('patch-backups').addEventListener('click', (event) => {
    const button = event.target.closest('[data-rollback]');
    if (button) void rollbackOperation(button.dataset.rollback);
  });
  element('kb-documents').addEventListener('click', (event) => {
    const button = event.target.closest('[data-delete-document]');
    if (button) void deleteDocument(button.dataset.deleteDocument);
  });

  element('deploy-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void saveDeployCommands();
  });
  element('deploy-reset-btn').addEventListener('click', () => {
    element('deploy-name').value = '';
    element('deploy-command').value = '';
    element('deploy-workdir').value = '';
    setNote('deploy-config-status', '');
  });
  element('deploy-list').addEventListener('click', (event) => {
    const run = event.target.closest('[data-run-deploy]');
    if (run) {
      void runDeploy(run.dataset.runDeploy);
      return;
    }
    const edit = event.target.closest('[data-edit-deploy]');
    if (edit) {
      const command = ((state.settings && state.settings.deployCommands) || []).find(
        (item) => item.id === edit.dataset.editDeploy,
      );
      if (command) {
        element('deploy-name').value = command.name;
        element('deploy-command').value = command.command;
        element('deploy-workdir').value = command.workdir;
      }
      return;
    }
    const remove = event.target.closest('[data-remove-deploy]');
    if (remove) void removeDeploy(remove.dataset.removeDeploy);
  });

  element('routing-modes').addEventListener('click', (event) => {
    const button = event.target.closest('[data-routing]');
    if (button) void setRoutingMode(button.dataset.routing);
  });
  element('roots-form').addEventListener('submit', saveRoots);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveViewState();
  });
}

function applyHostTheme() {
  const host = window.mcode && window.mcode.miniapp && window.mcode.miniapp.host;
  if (!host || !host.ui || typeof host.ui.subscribe !== 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
    };
    media.addEventListener('change', apply);
    apply();
    return;
  }
  const subscription = host.ui.subscribe(
    ({ theme }) => {
      if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    },
    { onError: () => undefined },
  );
  window.addEventListener('pagehide', () => subscription && subscription.dispose(), { once: true });
}

async function boot() {
  applyHostTheme();
  restoreViewState();
  bindEvents();
  switchView(state.view);
  try {
    await loadState();
    const roots = (state.settings && state.settings.ingestRoots) || [];
    if (roots.length) await loadFiles('document', roots[0]);
    if (state.writeRoots.length) await loadFiles('code', state.writeRoots[0]);
  } catch (error) {
    setNote('kb-upload-status', error.message, 'error');
    toast(error.message, 'error');
  }
}

void boot();
