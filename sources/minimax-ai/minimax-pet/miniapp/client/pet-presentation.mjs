import { t } from './i18n.mjs';

export function aggregateText(counts, locale) {
  if (!counts) return '';
  // 1,204 in English and 1,204 in Chinese both read fine, but a locale-aware formatter
  // keeps other locales correct if one is added later.
  const number = (value) => new Intl.NumberFormat(locale).format(value ?? 0);
  return t('tasks.summaryText', {
    total: number(counts.total), running: number(counts.running), completed: number(counts.completed),
    error: number(counts.error), aborted: number(counts.aborted), idle: number(counts.idle),
  });
}

export function notificationItems(items) {
  return items.filter((item) => item.needsAnswer === true || ['completed', 'error'].includes(item.displayStatus))
    .sort((a, b) => Number(b.needsAnswer === true) - Number(a.needsAnswer === true)).slice(0, 3);
}

/**
 * Notification cards hide themselves; they never dismiss the reminder. `needsAnswer`
 * cards ignore the timeout because they are the one thing the user must act on.
 * A zero or negative timeout keeps every card until the user closes it.
 */
export function visibleNotices(items, { shownAt = new Map(), now = Date.now(), timeoutSeconds = 0 } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!(timeoutSeconds > 0)) return list;
  const limit = timeoutSeconds * 1000;
  return list.filter((item) => {
    if (item?.needsAnswer === true) return true;
    const since = shownAt instanceof Map ? shownAt.get(item?.sessionId) : shownAt?.[item?.sessionId];
    // An unknown start counts as just shown; the next paint records it.
    return !Number.isFinite(since) || now - since < limit;
  });
}

/** Milliseconds left before `item` hides, or null when it never does. */
export function noticeRemaining(item, { shownAt = new Map(), now = Date.now(), timeoutSeconds = 0 } = {}) {
  if (!(timeoutSeconds > 0) || item?.needsAnswer === true) return null;
  const since = shownAt instanceof Map ? shownAt.get(item?.sessionId) : shownAt?.[item?.sessionId];
  if (!Number.isFinite(since)) return timeoutSeconds * 1000;
  return Math.max(0, timeoutSeconds * 1000 - (now - since));
}

export function notificationText(item, previews = {}) {
  if (item.needsAnswer === true) return t('status.needsAnswer');
  return previews[item.sessionId] || (item.displayStatus === 'error' ? t('desk.noticeError') : t('desk.noticeCompleted'));
}

// A task snapshot may refresh while its animation has already settled into calm idle.
export function createAnimationGate(player, onError = () => {}) {
  let previous = null;
  return {
    apply(state, key, { loop = false } = {}) {
      const identity = `${key}:${state}:${loop}`;
      if (previous === identity && player.state === state) return false;
      previous = identity;
      void player.play(state, { loop }).catch(onError);
      return true;
    },
    invalidate() { previous = null; },
  };
}
