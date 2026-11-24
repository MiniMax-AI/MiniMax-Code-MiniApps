// @ts-check
import { botById, canOpenSession, clockLabel, guard, h, nav, openSession, state, t } from './core.js';
import { locale } from './i18n.js';
import { reconcileChildren } from './view-state.js';
import { toolFailureNode, unresolvedMemoryFailures } from './tool-feedback.js';

const partsOf = (message) => message.parts ?? (message.tools ?? []).map((tool) => ({ ...tool, type: 'tool' }));

/** Only the latest reply from each participant can mark the current conversation. */
export function executionNeedsAttention(messages) {
  const seen = new Set();
  for (const message of [...messages].reverse()) {
    if (message.role !== 'bot' || seen.has(message.botId)) continue;
    seen.add(message.botId);
    if (message.status === 'error' || unresolvedMemoryFailures(message).length) return true;
  }
  return false;
}

function turnError(message) {
  const key = `agentError.${message.errorCode}`;
  const localized = message.errorCode ? t(key) : key;
  const error = localized !== key ? localized : message.error || t('note.unknownError');
  return message.retried ? t('note.errorAfterRetry', { n: message.retried, error }) : error;
}

function updateRecord(node, message) {
  const parts = partsOf(message);
  const tools = parts.filter((part) => part.type === 'tool');
  const failed = tools.filter((part) => part.state === 'failed').length;
  const status = message.status === 'streaming' ? t('execution.running') : message.status === 'error' ? t('execution.turnFailed') : t('execution.ended');
  const summary = node.querySelector(':scope > summary');
  summary.textContent = `${botById(message.botId)?.name ?? t('bot.deleted')} · ${clockLabel(message.ts)} · ${status}`;
  node.dataset.recordId = message.id;
  const groups = new Map();
  for (const part of tools) {
    const group = groups.get(part.name) ?? [];
    group.push(part);
    groups.set(part.name, group);
  }
  const views = [];
  if (message.status === 'error') views.push({ key: 'error', signature: turnError(message), create: () => h('p', { class: 'execution-error' }, turnError(message)) });
  for (const [name, calls] of groups) {
    const key = `tool:${name}`;
    const count = calls.filter((part) => part.state === 'failed').length;
    const renderGroup = (group = h('details', { class: 'execution-tool', dataset: { disclosure: key } }, h('summary'), h('div', { class: 'execution-attempts' }))) => {
      group.querySelector('summary').textContent = `${name} · ${t('execution.calls', { n: calls.length })}${count ? ` · ${t('execution.failures', { n: count })}` : ''}`;
      reconcileChildren(group.querySelector('.execution-attempts'), calls.map((part) => ({
        key: String(parts.indexOf(part)),
        signature: JSON.stringify([part, part.state === 'failed' ? tools : null, message.status, message.sessionId, locale()]),
        create: () => {
          const attempt = part.state === 'failed'
            ? toolFailureNode(part, parts, name)
            : h('p', { class: 'muted' }, t(part.state === 'ok' ? 'execution.succeeded' : part.state === 'running' && message.status === 'streaming' ? 'execution.running' : 'execution.unknown'));
          attempt.dataset.attemptIndex = String(parts.indexOf(part));
          return attempt;
        },
      })));
      return group;
    };
    views.push({ key, signature: JSON.stringify([calls, tools, message.status, message.sessionId, locale()]), create: () => renderGroup(), update: renderGroup });
  }
  if (message.sessionId && canOpenSession()) views.push({ key: 'session', signature: JSON.stringify([message.sessionId, locale()]), create: () => h('button', { type: 'button', class: 'btn sm', onclick: guard(() => openSession(message.sessionId)) }, t('event.toolOpenSession')) });
  reconcileChildren(node.querySelector('.execution-record-body'), views);
  node.setAttribute('aria-label', `${summary.textContent}${failed ? ` · ${t('execution.failures', { n: failed })}` : ''}`);
  return node;
}

/** Preserve disclosures, keyboard focus and scroll position as records stream in. */
export function renderExecutionRecords(drawer, header, chatId) {
  const active = document.activeElement;
  const recordId = active?.closest('[data-record-id]')?.dataset.recordId;
  const attemptIndex = active?.closest('[data-attempt-index]')?.dataset.attemptIndex;
  let body = drawer.querySelector('.execution-body');
  if (!body || body.dataset.chatId !== chatId || body.dataset.locale !== locale()) {
    body = h('div', { class: 'drawer-body execution-body', dataset: { chatId, locale: locale() } },
      h('p', { class: 'muted' }, t('execution.description')),
      h('div', { class: 'execution-list' }),
      h('button', { type: 'button', class: 'btn execution-earlier', onclick: guard(async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try { await nav.loadEarlier(chatId); }
        finally { button.disabled = false; }
      }) }, t('execution.earlier')),
    );
    drawer.replaceChildren(header, body);
  }
  const messages = (state.messages.get(chatId) ?? []).filter((message) => message.role === 'bot' && (partsOf(message).some((part) => part.type === 'tool') || message.status === 'error'));
  reconcileChildren(body.querySelector('.execution-list'), messages.length ? [...messages].reverse().map((message) => ({
    key: message.id,
    signature: JSON.stringify([partsOf(message).filter((part) => part.type === 'tool'), message.status, message.error, message.errorCode, message.retried, message.sessionId, message.ts, botById(message.botId)?.name, locale(), canOpenSession()]),
    create: () => updateRecord(h('details', { class: 'execution-record' }, h('summary'), h('div', { class: 'execution-record-body' })), message),
    update: (node) => updateRecord(node, message),
  })) : [{ key: 'empty', signature: locale(), create: () => h('p', { class: 'muted' }, t('execution.empty')) }]);
  if (recordId && !active.isConnected) {
    const record = [...body.querySelectorAll('[data-record-id]')].find((node) => node.dataset.recordId === recordId);
    const attempt = [...(record?.querySelectorAll('[data-attempt-index]') ?? [])].find((node) => node.dataset.attemptIndex === attemptIndex);
    const control = active.tagName === 'SUMMARY' ? attempt?.querySelector('summary')
      : [...(attempt?.querySelectorAll('button') ?? [])].find((node) => node.textContent === active.textContent);
    (control ?? record?.querySelector('summary'))?.focus({ preventScroll: true });
  }
  body.querySelector('.execution-earlier').hidden = !state.messagePages.get(chatId)?.hasMore;
}
