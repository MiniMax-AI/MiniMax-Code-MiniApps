import { readInput, buildArchive } from './archive.js';

const state = {
  conversations: [],
  imported: new Set(),
  selected: new Set(),
  active: null,
  planId: null,
  busy: false,
  openTarget: null,
  project: null,
  lastRunId: null,
};
const POLL_MS = 500;
const LABELS = { planned: 'ready', success: 'imported', skipped: 'already imported · skipped', failed: 'failed' };
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || `Request failed (${response.status})`);
  return body;
}

async function loadState() {
  try {
    const saved = await api('/api/state');
    state.imported = new Set(saved.imported || []);
    $('#import').disabled = false;
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function openFile(file) {
  setStatus('Parsing DeepSeek export locally…');
  const parsed = await readInput(file);
  setStatus('Saving the DeepSeek ZIP to a private temporary path…');
  const upload = await fetch('/api/source', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: file,
  });
  const uploadResult = await upload.json();
  if (!upload.ok) throw new Error(uploadResult.message || uploadResult.error || 'Could not stage the ZIP.');
  state.conversations = parsed;
  state.selected = new Set(parsed.filter((item) => !state.imported.has(item.stableId)).map((item) => item.stableId));
  state.active = parsed[0]?.stableId || null;
  $('#workspace').classList.remove('hidden');
  $('#count').textContent = `${parsed.length} conversation${parsed.length === 1 ? '' : 's'}`;
  $('#meta').textContent = `${parsed.filter((item) => state.imported.has(item.stableId)).length} already imported`;
  render();
  setStatus(`Parsed ${parsed.length} DeepSeek conversations. Choose what to migrate.`);
}

function filtered() {
  const query = $('#search').value.toLowerCase().trim();
  if (!query) return state.conversations;
  return state.conversations.filter((conversation) => JSON.stringify(conversation).toLowerCase().includes(query));
}

function selectable() {
  return state.conversations.filter((item) => !state.imported.has(item.stableId));
}

function renderSelectAll() {
  const total = selectable().length;
  const count = selectable().filter((item) => state.selected.has(item.stableId)).length;
  const box = $('#select-all');
  box.checked = total > 0 && count === total;
  box.indeterminate = count > 0 && count < total;
  box.disabled = total === 0;
  $('#select-label').textContent = count ? `已选 ${count}` : '全选';
}

function render({ preview = true } = {}) {
  renderSelectAll();
  $('#list').innerHTML = filtered().map((conversation) => {
    const imported = state.imported.has(conversation.stableId);
    const date = conversation.updatedAt ? new Date(conversation.updatedAt).toLocaleDateString() : 'Unknown date';
    return `<label class="row ${state.active === conversation.stableId ? 'active' : ''}" data-id="${esc(conversation.stableId)}">
      <input type="checkbox" ${state.selected.has(conversation.stableId) ? 'checked' : ''} ${imported ? 'disabled' : ''}>
      <span><b>${esc(conversation.title)} ${conversation.branchCount ? `<i class="pill">${conversation.branchCount} branches</i>` : ''} ${imported ? '<i class="pill imported">imported</i>' : ''}</b>
      <small>${date} · ${conversation.turnCount} turns · ${conversation.approxChars.toLocaleString()} chars</small></span>
    </label>`;
  }).join('');
  for (const row of document.querySelectorAll('.row')) {
    row.addEventListener('click', (event) => {
      const id = row.dataset.id;
      state.active = id;
      if (event.target.matches('input')) {
        if (event.target.checked) state.selected.add(id); else state.selected.delete(id);
      }
      render();
    });
  }
  if (preview) renderPreview();
}

function renderPreview() {
  const conversation = state.conversations.find((item) => item.stableId === state.active);
  if (!conversation) return;
  const byParent = new Map();
  for (const message of conversation.messages) {
    const key = message.parentId ?? 'root';
    byParent.set(key, [...(byParent.get(key) || []), message]);
  }
  $('#preview').innerHTML = `<h2>${esc(conversation.title)}</h2><p class="eyebrow">${conversation.messages.length} MESSAGES · ${conversation.branchCount} ALTERNATE BRANCHES</p>` +
    conversation.messages.map((message) => {
      const siblings = byParent.get(message.parentId ?? 'root') || [];
      const blocks = message.blocks.map(renderBlock).join('');
      return `<section class="message ${esc(message.role)}"><h3>${esc(message.role)} ${siblings.length > 1 ? `· VERSION ${siblings.indexOf(message) + 1}/${siblings.length}` : ''}</h3><div class="bubble">${blocks}</div></section>`;
    }).join('');
}

function renderBlock(block) {
  if (block.type === 'text') return `<div>${esc(block.text)}</div>`;
  if (block.type === 'reasoning') return `<details><summary>Reasoning${block.elapsedSecs ? ` · ${block.elapsedSecs}s` : ''}</summary><div>${esc(block.text)}</div></details>`;
  if (block.type === 'search') return `<details><summary>Sources · ${(block.results || []).length} results</summary>${(block.results || []).map((result) => `<p><b>${esc(result.title || result.url)}</b><br>${esc(result.snippet)}</p>`).join('')}</details>`;
  if (block.type === 'attachment') return `<details><summary>Attachments · ${(block.files || []).length}</summary>${(block.files || []).map((file) => `<p>${esc(file.name || file.id)} · ${file.size || 0} bytes · ${file.available ? 'included in export' : 'reference only'}</p>`).join('')}</details>`;
  return `<details><summary>${esc(block.label || 'Notice')}</summary>${esc(block.text)}</details>`;
}

/** Spinner + a short label while a step runs; the original label comes back after. */
function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.label ??= button.textContent;
    button.textContent = label;
  } else if (button.dataset.label !== undefined) {
    button.textContent = button.dataset.label;
    delete button.dataset.label;
  }
  button.classList.toggle('busy', busy);
  button.setAttribute('aria-busy', String(busy));
}

async function planImport() {
  const selected = state.conversations.filter((item) => state.selected.has(item.stableId));
  if (!selected.length) return setStatus('Select at least one conversation to import.', true);
  if (state.busy) return;
  state.busy = true;
  $('#import').disabled = true;
  setBusy($('#import'), true, '生成预览中…');
  showOpenProject(false);
  try {
    setStatus(`生成预览中… · ${selected.length} 个会话`);
    const result = await api('/api/migration/plan', {
      method: 'POST',
      body: JSON.stringify({
        sessions: selected.map((conversation) => ({ id: conversation.sourceId, stableId: conversation.stableId })),
      }),
    });
    state.planId = result.planId;
    renderMigrationResult('Import plan', result);
    renderProgress(null);
    $('#confirm-import').disabled = !result.summary.planned;
    $('#confirm-import').hidden = false;
    showUndo(false);
    $('#migration-result').showModal();
    setStatus(result.summary.planned
      ? `${result.summary.planned} ready to import. Review the plan before importing.`
      : 'Nothing new to import in this selection.', result.summary.failed > 0);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.busy = false;
    setBusy($('#import'), false);
    $('#import').disabled = false;
  }
}

function progressLabel(progress) {
  if (progress.phase === 'importing' || progress.phase === 'done') return `导入中 ${progress.done}/${progress.total}`;
  return '准备导入…';
}

/** Dialog bar + footer status while apply runs; null hides both bars. */
function renderProgress(progress) {
  for (const id of ['#progress', '#footer-progress']) $(id).hidden = !progress;
  if (!progress) return;
  const ratio = progress.total ? progress.done / progress.total : 0;
  const waiting = progress.phase !== 'importing' && progress.phase !== 'done';
  for (const bar of document.querySelectorAll('.progress')) {
    bar.classList.toggle('waiting', waiting);
    bar.querySelector('i').style.width = waiting ? '' : `${Math.round(ratio * 100)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  }
  const label = progressLabel(progress);
  $('#progress-label').textContent = label;
  setStatus(label);
}

function markLanded(progress) {
  for (const item of progress.sessions || []) {
    const row = document.querySelector(`#result-list li[data-id="${CSS.escape(item.sessionId)}"]`);
    if (!row || row.classList.contains(item.status)) continue;
    row.className = item.status;
    row.querySelector('span').textContent = LABELS[item.status] || item.status;
  }
  let changed = false;
  for (const stableId of progress.imported || []) {
    if (state.imported.has(stableId)) continue;
    state.imported.add(stableId);
    state.selected.delete(stableId);
    changed = true;
  }
  if (changed) render({ preview: false });
}

async function applyImport() {
  if (!state.planId || state.busy) return;
  const planId = state.planId;
  state.busy = true;
  $('#confirm-import').disabled = true;
  $('#import').disabled = true;
  setBusy($('#confirm-import'), true, '导入中…');
  $('#result-title').textContent = 'Importing…';
  renderProgress({ phase: 'starting', done: 0, total: 0 });
  let polling = true;
  const poll = async () => {
    while (polling) {
      try {
        const progress = await api(`/api/migration/progress?planId=${encodeURIComponent(planId)}`);
        if (polling) {
          renderProgress(progress);
          markLanded(progress);
        }
      } catch {
        // Not started yet or already finished; the apply response is authoritative.
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  };
  const poller = poll();
  try {
    const result = await api('/api/migration/apply', {
      method: 'POST',
      body: JSON.stringify({ planId }),
    });
    polling = false;
    await poller;
    for (const stableId of result.imported || []) state.imported.add(stableId);
    state.selected = new Set([...state.selected].filter((stableId) => !state.imported.has(stableId)));
    state.planId = null;
    render({ preview: false });
    renderMigrationResult('Import result', result);
    renderProgress(null);
    $('#confirm-import').hidden = true;
    const landed = (result.sessions || []).find((item) => item.status === 'success' && item.targetSessionId)
      || (result.sessions || []).find((item) => item.status === 'skipped' && item.targetSessionId);
    state.openTarget = landed?.targetSessionId || null;
    showOpenProject(Boolean(landed));
    state.lastRunId = result.runId || null;
    showUndo(Boolean(state.lastRunId), result.summary.succeeded);
    void refreshProject();
    const skipped = result.summary.skipped ? `, ${result.summary.skipped} already imported` : '';
    setStatus(result.summary.failed
      ? `Imported ${result.summary.succeeded}${skipped}, ${result.summary.failed} failed.`
      : `Imported ${result.summary.succeeded} MCode session${result.summary.succeeded === 1 ? '' : 's'}${skipped}.`, result.summary.failed > 0);
  } catch (error) {
    polling = false;
    await poller;
    renderProgress(null);
    $('#confirm-import').disabled = false;
    setStatus(error.message, true);
  } finally {
    state.busy = false;
    setBusy($('#confirm-import'), false);
    $('#import').disabled = false;
  }
}

function showUndo(visible, count = 0) {
  $('#undo-import').hidden = !visible;
  $('#undo-confirm').hidden = true;
  $('#undo-import').dataset.count = String(count);
}

function askUndo() {
  const count = Number($('#undo-import').dataset.count || 0);
  $('#undo-text').textContent = `会从 MiniMax Code 里删掉这次导入的 ${count} 个会话，其他会话不受影响。确定撤销吗？`;
  $('#undo-force').hidden = true;
  $('#undo-yes').hidden = false;
  $('#undo-confirm').hidden = false;
  $('#undo-import').hidden = true;
}

async function undoImport(force = false) {
  if (!state.lastRunId || state.busy) return;
  state.busy = true;
  const button = force ? $('#undo-force') : $('#undo-yes');
  setBusy(button, true, '撤销中…');
  button.disabled = true;
  try {
    const response = await fetch('/api/migration/undo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: state.lastRunId, force }),
    });
    const body = await response.json();
    if (response.status === 409 && body.error === 'undo_refused') {
      $('#undo-text').textContent = `${body.message}仍然撤销会把这些会话导入后的新内容一起删掉（新增的文件会另存在撤销记录里）。`;
      $('#undo-yes').hidden = true;
      $('#undo-force').hidden = false;
      return;
    }
    if (!response.ok) throw new Error(body.message || body.error || `Request failed (${response.status})`);
    for (const stableId of body.undone || []) state.imported.delete(stableId);
    state.lastRunId = null;
    state.openTarget = null;
    render({ preview: false });
    $('#undo-confirm').hidden = true;
    showOpenProject(false);
    $('#result-title').textContent = 'Import undone';
    $('#result-summary').textContent = `已撤销本次导入：删除了 ${body.removed} 个会话`;
    for (const row of document.querySelectorAll('#result-list li.success')) {
      row.className = 'undone';
      row.querySelector('span').textContent = 'undone';
    }
    setStatus(`已撤销本次导入（${body.removed} 个会话）。`);
    void refreshProject();
  } catch (error) {
    setStatus(error.message, true);
    $('#undo-text').textContent = error.message;
  } finally {
    setBusy(button, false);
    button.disabled = false;
    state.busy = false;
  }
}

function showOpenProject(visible) {
  for (const id of ['#open-project', '#footer-open']) $(id).hidden = !visible;
}

async function openWorkspaceFolder() {
  try {
    const result = await api('/api/workspace/open', { method: 'POST' });
    setStatus(`已在文件管理器中打开 ${result.path}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

/**
 * Opens an imported conversation, which lives in the DeepSeek project, through the
 * Host (MiniMax Code 3.1.11+). Must run straight from the click: the Host checks the
 * user gesture. Older clients, or a Host that cannot open it, get ~/DeepSeek in the
 * file manager instead.
 */
async function refreshProject() {
  try {
    state.project = await api('/api/project');
  } catch {
    state.project = null;
  }
  const count = state.project?.sessionCount || 0;
  const hostCanOpen = typeof window.mcode?.miniapp?.host?.navigation?.open === 'function';
  $('#header-count').textContent = count ? String(count) : '';
  $('#header-count').hidden = !count;
  $('#header-open').title = count && hostCanOpen
    ? `在 MiniMax Code 里打开 DeepSeek 项目中最近的会话（共 ${count} 个）`
    : `在文件管理器里打开 ${state.project?.workspace || '~/DeepSeek'}`;
}

/**
 * Opens the DeepSeek project, from the header at any time or after an import: the
 * Host (MiniMax Code 3.1.11+) opens the latest imported session, which lives in that
 * project. Must run straight from the click: the Host checks the user gesture. With
 * nothing imported, an older client, or a Host that cannot open it, ~/DeepSeek opens
 * in the file manager instead.
 */
function openProject() {
  const host = window.mcode?.miniapp?.host;
  const sessionId = state.openTarget || state.project?.latestSessionId || null;
  if (typeof host?.navigation?.open !== 'function' || !sessionId) return void openWorkspaceFolder();
  host.navigation.open({ id: 'session', sessionId, source: 'local' }).then((result) => {
    if (result?.status === 'opened') {
      if ($('#migration-result').open) $('#migration-result').close();
      setStatus('已打开 DeepSeek 项目里导入的会话。');
    }
  }, (error) => {
    // result_unknown: the Host may still open it; do not open a second place.
    if (error?.code === 'result_unknown') return setStatus('MiniMax Code 没有回应打开请求，请在侧栏的 DeepSeek 项目里查看。', true);
    return openWorkspaceFolder();
  });
}

function renderMigrationResult(title, result) {
  $('#result-title').textContent = title;
  const { total, planned, succeeded, skipped, failed } = result.summary;
  const parts = [`${total} total`];
  if (planned) parts.push(`${planned} ready`);
  if (succeeded) parts.push(`${succeeded} imported`);
  if (skipped) parts.push(`${skipped} already imported`);
  if (failed) parts.push(`${failed} failed`);
  $('#result-summary').textContent = parts.join(' · ');
  $('#result-list').innerHTML = (result.sessions || []).map((item) => {
    const conversation = state.conversations.find((entry) => entry.sourceId === item.sessionId);
    return `<li class="${esc(item.status)}" data-id="${esc(item.sessionId)}"><b>${esc(conversation?.title || item.sessionId)}</b><span>${esc(LABELS[item.status] || item.status)}${item.message ? ` · ${esc(item.message)}` : ''}</span></li>`;
  }).join('');
  $('#result-stderr').textContent = result.error || '';
  $('#result-stderr').hidden = !result.error;
}

function exportArchive() {
  const chosen = state.conversations.filter((item) => state.selected.has(item.stableId));
  const conversations = chosen.length ? chosen : state.conversations;
  if (!conversations.length) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(buildArchive(conversations));
  link.download = 'deepseek-chat-archive.zip';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function setStatus(message, error = false) {
  $('#status').textContent = message;
  $('#status').style.color = error ? '#a64232' : '';
}

$('#file').addEventListener('change', (event) => event.target.files[0] && openFile(event.target.files[0]).catch((error) => setStatus(error.message, true)));
$('#search').addEventListener('input', render);
$('#select-all').addEventListener('change', (event) => {
  state.selected = event.target.checked
    ? new Set(selectable().map((item) => item.stableId))
    : new Set();
  render();
});
$('#import').addEventListener('click', planImport);
$('#archive').addEventListener('click', exportArchive);
$('#confirm-import').addEventListener('click', applyImport);
$('#open-project').addEventListener('click', openProject);
$('#footer-open').addEventListener('click', openProject);
$('#header-open').addEventListener('click', openProject);
$('#undo-import').addEventListener('click', askUndo);
$('#undo-yes').addEventListener('click', () => undoImport(false));
$('#undo-force').addEventListener('click', () => undoImport(true));
$('#undo-no').addEventListener('click', () => showUndo(true, Number($('#undo-import').dataset.count || 0)));
for (const eventName of ['dragenter', 'dragover']) $('#drop').addEventListener(eventName, (event) => { event.preventDefault(); $('#drop').classList.add('drag'); });
for (const eventName of ['dragleave', 'drop']) $('#drop').addEventListener(eventName, (event) => { event.preventDefault(); $('#drop').classList.remove('drag'); });
$('#drop').addEventListener('drop', (event) => event.dataTransfer.files[0] && openFile(event.dataTransfer.files[0]).catch((error) => setStatus(error.message, true)));

await loadState();
await refreshProject();
