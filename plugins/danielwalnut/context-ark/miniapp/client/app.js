import { readInput, buildArchive } from './archive.js';
import { distillConversation } from './distill.js';

const state = { conversations: [], imported: new Set(), selected: new Set(), active: null, handoffs: {} };
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function loadState() {
  try {
    const saved = await api('/api/state');
    state.imported = new Set(saved.imported || []);
    state.handoffs = saved.handoffs || {};
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function openFile(file) {
  setStatus('Parsing export locally…');
  const parsed = await readInput(file);
  state.conversations = parsed.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  state.selected = new Set(parsed.filter((item) => !state.imported.has(item.stableId)).map((item) => item.stableId));
  state.active = parsed[0]?.stableId || null;
  $('#workspace').classList.remove('hidden');
  $('#count').textContent = `${parsed.length} conversation${parsed.length === 1 ? '' : 's'}`;
  $('#meta').textContent = `${parsed.filter((item) => state.imported.has(item.stableId)).length} already imported`;
  render();
  setStatus(`Parsed ${parsed.length} conversations. Choose what to keep.`);
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
  if (block.type === 'search') return `<details><summary>Web search · ${(block.results || []).length} results</summary>${(block.results || []).map((result) => `<p><b>${esc(result.title || result.url)}</b><br>${esc(result.snippet)}</p>`).join('')}</details>`;
  if (block.type === 'attachment') return `<details><summary>Attachments · ${(block.files || []).length}</summary>${(block.files || []).map((file) => `<p>${esc(file.name || file.id)} · ${file.size || 0} bytes</p>`).join('')}</details>`;
  return `<details><summary>${esc(block.label || 'Notice')}</summary>${esc(block.text)}</details>`;
}

async function distillSelected() {
  const selected = state.conversations.filter((item) => state.selected.has(item.stableId));
  if (!selected.length) return setStatus('Select at least one new conversation.', true);
  const agent = window.mcode?.miniapp?.agent;
  if (!agent?.run) return setStatus('Agent distillation is unavailable in this MiniMax Code version.', true);
  $('#distill').disabled = true;
  try {
    await api('/api/import', { method: 'POST', body: JSON.stringify({ conversations: selected }) });
    for (let index = 0; index < selected.length; index += 1) {
      const conversation = selected[index];
      const handoff = await distillConversation(conversation, agent, (progress) => setStatus(`${index + 1}/${selected.length} · ${progress}`));
      state.handoffs[conversation.stableId] = handoff;
      await api('/api/handoff', { method: 'POST', body: JSON.stringify({ stableId: conversation.stableId, handoff }) });
      state.imported.add(conversation.stableId);
      showHandoff(conversation, handoff);
    }
    state.selected.clear();
    render();
    setStatus(`Created ${selected.length} handoff document${selected.length === 1 ? '' : 's'}.`);
  } catch (error) {
    const message = error?.message === 'not_permitted' ? 'Agent access is switched off. Enable session.run in plugin settings.' : error.message;
    setStatus(message, true);
  } finally {
    $('#distill').disabled = false;
  }
}

function showHandoff(conversation, handoff) {
  $('#handoff-title').textContent = conversation.title;
  $('#handoff-text').textContent = handoff;
  $('#handoff').showModal();
}

function exportArchive() {
  const chosen = state.conversations.filter((item) => state.selected.has(item.stableId));
  const conversations = chosen.length ? chosen : state.conversations;
  if (!conversations.length) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(buildArchive(conversations, state.handoffs));
  link.download = 'context-ark-archive.zip';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function setStatus(message, error = false) {
  $('#status').textContent = message;
  $('#status').style.color = error ? '#a64232' : '';
}

$('#file').addEventListener('change', (event) => event.target.files[0] && openFile(event.target.files[0]).catch((error) => setStatus(error.message, true)));
$('#search').addEventListener('input', render);
$('#select-new').addEventListener('click', () => {
  state.selected = new Set(state.conversations.filter((item) => !state.imported.has(item.stableId)).map((item) => item.stableId));
  render();
});
$('#distill').addEventListener('click', distillSelected);
$('#archive').addEventListener('click', exportArchive);
$('#copy').addEventListener('click', async () => navigator.clipboard.writeText($('#handoff-text').textContent).catch(() => setStatus('Clipboard write failed.', true)));
$('#append').addEventListener('click', async () => {
  const append = window.mcode?.miniapp?.message?.append;
  if (!append) return setStatus('Adding text to a chat draft is unavailable in this version.', true);
  try {
    await append($('#handoff-text').textContent);
    setStatus('Added to the current chat draft. Review it and press Send.');
    $('#handoff').close();
  } catch (error) {
    setStatus(error.message === 'user_cancelled' ? 'Cancelled.' : `Could not add draft (${error.message}).`, true);
  }
});
for (const eventName of ['dragenter', 'dragover']) $('#drop').addEventListener(eventName, (event) => { event.preventDefault(); $('#drop').classList.add('drag'); });
for (const eventName of ['dragleave', 'drop']) $('#drop').addEventListener(eventName, (event) => { event.preventDefault(); $('#drop').classList.remove('drag'); });
$('#drop').addEventListener('drop', (event) => event.dataTransfer.files[0] && openFile(event.dataTransfer.files[0]).catch((error) => setStatus(error.message, true)));

await loadState();
