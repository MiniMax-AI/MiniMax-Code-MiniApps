import { readInput, buildArchive } from './archive.js';

const state = {
  conversations: [],
  imported: new Set(),
  selected: new Set(),
  active: null,
  planId: null,
  migrationPluginInstalled: false,
};
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
    state.migrationPluginInstalled = Boolean(saved.migrationPlugin?.installed);
    $('#plugin-status').textContent = saved.migrationPlugin?.installed
      ? `agent-session-migration: ${saved.migrationPlugin.path}`
      : saved.migrationPlugin?.message || 'agent-session-migration is not installed.';
    $('#import').disabled = !state.migrationPluginInstalled;
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

function render() {
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
  renderPreview();
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

async function planImport() {
  const selected = state.conversations.filter((item) => state.selected.has(item.stableId));
  if (!selected.length) return setStatus('Select at least one conversation to import.', true);
  if (!state.migrationPluginInstalled) return setStatus('Install agent-session-migration first.', true);
  $('#import').disabled = true;
  try {
    setStatus(`Planning ${selected.length} native MCode session import${selected.length === 1 ? '' : 's'}…`);
    const result = await api('/api/migration/plan', {
      method: 'POST',
      body: JSON.stringify({
        sessions: selected.map((conversation) => ({ id: conversation.sourceId, stableId: conversation.stableId })),
      }),
    });
    state.planId = result.planId;
    renderMigrationResult('Import plan', result);
    $('#confirm-import').disabled = !result.ok;
    $('#migration-result').showModal();
    setStatus(result.ok ? 'Plan ready. Review it before importing.' : 'The migration plan contains errors.', !result.ok);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    $('#import').disabled = !state.migrationPluginInstalled;
  }
}

async function applyImport() {
  if (!state.planId) return;
  $('#confirm-import').disabled = true;
  try {
    setStatus('Importing native MCode sessions…');
    const result = await api('/api/migration/apply', {
      method: 'POST',
      body: JSON.stringify({ planId: state.planId }),
    });
    for (const stableId of result.imported || []) state.imported.add(stableId);
    state.selected = new Set([...state.selected].filter((stableId) => !state.imported.has(stableId)));
    state.planId = null;
    render();
    renderMigrationResult('Import result', result);
    setStatus(result.ok
      ? `Imported ${result.summary.succeeded} MCode session${result.summary.succeeded === 1 ? '' : 's'}.`
      : `Import finished with ${result.summary.failed} failure${result.summary.failed === 1 ? '' : 's'}.`, !result.ok);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderMigrationResult(title, result) {
  $('#result-title').textContent = title;
  $('#result-summary').textContent = `${result.summary.total} total · ${result.summary.planned || result.summary.succeeded} ready/succeeded · ${result.summary.failed} failed`;
  $('#result-list').innerHTML = (result.sessions || []).map((item) => {
    const conversation = state.conversations.find((entry) => entry.sourceId === item.sessionId);
    return `<li class="${esc(item.status)}"><b>${esc(conversation?.title || item.sessionId)}</b><span>${esc(item.status)}${item.message ? ` · ${esc(item.message)}` : ''}</span></li>`;
  }).join('');
  $('#result-stderr').textContent = result.stderr || '';
  $('#result-stderr').hidden = !result.stderr;
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
$('#select-all').addEventListener('click', () => {
  state.selected = new Set(state.conversations.filter((item) => !state.imported.has(item.stableId)).map((item) => item.stableId));
  render();
});
$('#select-none').addEventListener('click', () => {
  state.selected = new Set();
  render();
});
$('#import').addEventListener('click', planImport);
$('#archive').addEventListener('click', exportArchive);
$('#confirm-import').addEventListener('click', applyImport);
for (const eventName of ['dragenter', 'dragover']) $('#drop').addEventListener(eventName, (event) => { event.preventDefault(); $('#drop').classList.add('drag'); });
for (const eventName of ['dragleave', 'drop']) $('#drop').addEventListener(eventName, (event) => { event.preventDefault(); $('#drop').classList.remove('drag'); });
$('#drop').addEventListener('drop', (event) => event.dataTransfer.files[0] && openFile(event.dataTransfer.files[0]).catch((error) => setStatus(error.message, true)));

await loadState();
