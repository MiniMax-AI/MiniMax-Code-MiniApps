import { readInput, buildArchive } from './archive.js';
import { APPEND_LIMIT, buildDraft } from './handoff.js';

const state = {
  conversations: [],
  selected: new Set(),
  added: new Set(),
  active: null,
  busy: false,
};
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const APPEND_ERRORS = {
  user_cancelled: '已取消，没有改动输入框。',
  target_unavailable: '这个 Mini App 没有打开在可写的对话里。请在一个对话里打开它，或用「复制」。',
  not_allowed: 'MiniMax Code 不允许这次添加。可以用「复制」后自己粘贴。',
  text_too_large: '文本超过输入框上限，请少选几个对话。',
  result_unknown: '不确定是否已经添加。请先看一下输入框，再决定要不要重试。',
};

function appendApi() {
  const append = window.mcode?.miniapp?.message?.append;
  return typeof append === 'function' ? append.bind(window.mcode.miniapp.message) : null;
}

async function openFile(file) {
  setStatus('Parsing DeepSeek export locally…');
  const parsed = await readInput(file);
  state.conversations = parsed;
  state.selected = new Set();
  state.added = new Set();
  state.active = parsed[0]?.stableId || null;
  $('#workspace').classList.remove('hidden');
  $('#count').textContent = `${parsed.length} conversation${parsed.length === 1 ? '' : 's'}`;
  $('#meta').textContent = `${parsed.reduce((sum, item) => sum + item.branchCount, 0)} alternate branches`;
  render();
  setStatus(`Parsed ${parsed.length} DeepSeek conversations. Pick one or more to continue here.`);
}

function filtered() {
  const query = $('#search').value.toLowerCase().trim();
  if (!query) return state.conversations;
  return state.conversations.filter((conversation) => JSON.stringify(conversation).toLowerCase().includes(query));
}

/** The checked conversations, or the one being previewed when none is checked. */
function chosen() {
  const checked = state.conversations.filter((item) => state.selected.has(item.stableId));
  if (checked.length) return checked;
  const active = state.conversations.find((item) => item.stableId === state.active);
  return active ? [active] : [];
}

function draft() {
  return buildDraft(chosen(), { reasoning: $('#with-reasoning').checked, sources: $('#with-sources').checked });
}

function renderSelectAll() {
  const total = state.conversations.length;
  const count = state.selected.size;
  const box = $('#select-all');
  box.checked = total > 0 && count === total;
  box.indeterminate = count > 0 && count < total;
  box.disabled = total === 0;
  $('#select-label').textContent = count ? `已选 ${count}` : '全选';
}

function renderActions({ describe = true } = {}) {
  const items = chosen();
  const canAppend = Boolean(appendApi());
  $('#append').disabled = state.busy || !items.length || !canAppend;
  $('#append').title = canAppend ? '' : 'This MiniMax Code version cannot add text to the chat input; use Copy instead.';
  $('#copy').disabled = state.busy || !items.length;
  $('#archive').disabled = state.busy || !state.conversations.length;
  if (!describe || !items.length || state.busy) return;
  const { text, omitted } = draft();
  const label = items.length === 1 ? `「${items[0].title}」` : `${items.length} 个对话`;
  setStatus(`${label} · ${text.length.toLocaleString()} 字符${omitted ? ` · 超出输入框上限，省略了中间 ${omitted} 条消息` : ''}`);
}

function render({ preview = true, describe = true } = {}) {
  renderSelectAll();
  $('#list').innerHTML = filtered().map((conversation) => {
    const added = state.added.has(conversation.stableId);
    const date = conversation.updatedAt ? new Date(conversation.updatedAt).toLocaleDateString() : 'Unknown date';
    return `<label class="row ${state.active === conversation.stableId ? 'active' : ''}" data-id="${esc(conversation.stableId)}">
      <input type="checkbox" ${state.selected.has(conversation.stableId) ? 'checked' : ''}>
      <span><b>${esc(conversation.title)} ${conversation.branchCount ? `<i class="pill">${conversation.branchCount} branches</i>` : ''} ${added ? '<i class="pill added">added</i>' : ''}</b>
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
  renderActions({ describe });
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

/** Asks MiniMax Code to append the draft; the Host shows its own confirmation first. */
async function appendToChat() {
  const append = appendApi();
  const items = chosen();
  if (!append || !items.length || state.busy) return;
  const { text, omitted } = draft();
  if (text.length > APPEND_LIMIT) return setStatus(APPEND_ERRORS.text_too_large, true);
  state.busy = true;
  renderActions();
  setStatus('等待你在 MiniMax Code 的确认框里确认…');
  try {
    await append(text);
    for (const item of items) state.added.add(item.stableId);
    setStatus(`已添加到输入框${omitted ? `（省略了中间 ${omitted} 条消息）` : ''}。在输入框里检查后按发送。`);
  } catch (error) {
    const code = error?.message;
    setStatus(APPEND_ERRORS[code] || `没有添加（${code || 'unknown error'}）。`, code !== 'user_cancelled');
  } finally {
    state.busy = false;
    render({ preview: false, describe: false });
  }
}

async function copyDraft() {
  if (!chosen().length) return;
  try {
    await navigator.clipboard.writeText(draft().text);
    setStatus('已复制。粘贴到任意对话的输入框即可。');
  } catch {
    setStatus('无法写入剪贴板。', true);
  }
}

function exportArchive() {
  const checked = state.conversations.filter((item) => state.selected.has(item.stableId));
  const conversations = checked.length ? checked : state.conversations;
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
$('#search').addEventListener('input', () => render());
$('#select-all').addEventListener('change', (event) => {
  state.selected = event.target.checked ? new Set(state.conversations.map((item) => item.stableId)) : new Set();
  render({ preview: false });
});
$('#with-reasoning').addEventListener('change', () => renderActions());
$('#with-sources').addEventListener('change', () => renderActions());
$('#append').addEventListener('click', appendToChat);
$('#copy').addEventListener('click', copyDraft);
$('#archive').addEventListener('click', exportArchive);
for (const eventName of ['dragenter', 'dragover']) $('#drop').addEventListener(eventName, (event) => { event.preventDefault(); $('#drop').classList.add('drag'); });
for (const eventName of ['dragleave', 'drop']) $('#drop').addEventListener(eventName, (event) => { event.preventDefault(); $('#drop').classList.remove('drag'); });
$('#drop').addEventListener('drop', (event) => event.dataTransfer.files[0] && openFile(event.dataTransfer.files[0]).catch((error) => setStatus(error.message, true)));
