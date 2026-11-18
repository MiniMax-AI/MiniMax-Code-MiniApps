// @ts-check
import { canOpenSession, guard, h, openSession, t } from './core.js';

/** A receipt can identify a later save of the same topic, never a verbatim retry of its text. */
export function toolFailureInfo(part, parts) {
  const index = parts.indexOf(part);
  const laterSucceeded = index < 0 ? [] : parts.slice(index + 1).filter((next) =>
    next.type === 'tool' && next.name === part.name && next.state === 'ok');
  const issue = part.issue;
  const sameTopic = laterSucceeded.some(({ memoryReceipt: receipt }) =>
    receipt && ['created', 'updated', 'saved', 'unchanged'].includes(receipt.outcome) &&
    typeof receipt.entryId === 'string' && receipt.entryId && typeof receipt.revision === 'string' && receipt.revision &&
    typeof issue?.scope === 'string' && issue.scope && receipt.scope === issue.scope && (
      (typeof issue.key === 'string' && issue.key && receipt.key === issue.key) ||
      (typeof issue.entryId === 'string' && issue.entryId && receipt.entryId === issue.entryId)
    ));
  return { sameTopic, laterSucceeded };
}

export function unresolvedMemoryFailures(message) {
  if (message.status !== 'done') return [];
  const parts = message.parts ?? message.tools?.map((tool) => ({ ...tool, type: 'tool' })) ?? [];
  return parts.filter((part) => part.type === 'tool' && part.state === 'failed' &&
    ['memory_too_long', 'memory_full', 'memory_conflict', 'memory_topic_required'].includes(part.issue?.code) &&
    !toolFailureInfo(part, parts).sameTopic);
}

export function toolFailureNode(part, parts, action, sessionId) {
  const { sameTopic, laterSucceeded } = toolFailureInfo(part, parts);
  const issue = part.issue;
  let reason = t('event.toolErrorUnavailable');
  const knownMemoryFailure = ['memory_too_long', 'memory_full', 'memory_conflict', 'memory_topic_required'].includes(issue?.code);
  if (issue?.code === 'memory_too_long' && Number.isFinite(issue.actual) && Number.isFinite(issue.max)) {
    reason = t('event.memoryTooLong', issue);
  } else if (issue?.code === 'memory_full' && Number.isFinite(issue.entryShortfall) && issue.entryShortfall > 0) {
    reason = t('event.memoryEntryFull', { entryLimit: issue.entryLimit ?? 1000, entryShortfall: issue.entryShortfall });
  } else if (issue?.code === 'memory_full' && Number.isFinite(issue.remaining) && Number.isFinite(issue.needed)) {
    reason = t('event.memoryFull', { ...issue, shortfall: Number.isFinite(issue.shortfall) ? issue.shortfall : Math.max(0, issue.needed - issue.remaining) });
  } else if (issue?.code === 'memory_conflict') {
    reason = t('event.memoryConflict');
  } else if (issue?.code === 'memory_topic_required') {
    reason = t('event.memoryTopicRequired');
  }
  const status = sameTopic ? t('event.memoryTopicSaved') : t(laterSucceeded.length ? 'event.toolLaterSucceeded' : 'event.toolFailed', { action });
  const summary = sameTopic || laterSucceeded.length ? status : knownMemoryFailure ? t('event.memoryAttemptFailed') : status;
  return h('div', { class: 'tool-feedback-entry' },
    h('details', { class: `event tool-feedback${sameTopic ? '' : ' error'}`, dataset: { disclosure: 'tool-failure' } },
      h('summary', null, h('span', { class: 'tool-failure-impact' }, summary),
        knownMemoryFailure && !sameTopic && !laterSucceeded.length ? h('small', { class: 'tool-failure-history' }, reason) : null),
      h('p', null, reason),
      knownMemoryFailure ? h('p', null, t('event.memoryFailureHistory'), ' · ', h('code', null, part.name)) : null,
      sameTopic ? h('p', null, t('event.memoryTopicSavedNote')) : laterSucceeded.length ? h('p', null, t('event.toolLaterNote')) : null,
      sessionId && canOpenSession()
        ? h('button', { type: 'button', class: 'btn sm', onclick: guard(() => openSession(sessionId)) }, t('event.toolOpenSession'))
        : null,
    ),
  );
}
