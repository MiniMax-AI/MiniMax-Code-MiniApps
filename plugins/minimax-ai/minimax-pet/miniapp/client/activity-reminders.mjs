// Page-local reminders are independent of task facts and Host read/unread state.
const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;
const STATUSES = new Set(['idle', 'running', 'error', 'aborted']);
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function identity(row) {
  let parts;
  try { parts = JSON.parse(row.animationKey); } catch { /* Older adapters need not expose an animation key. */ }
  const valid = Array.isArray(parts) && parts.length >= 5 && parts[1] === row.sessionId;
  return {
    epoch: valid ? parts[0] : null,
    turnId: valid && typeof parts[2] === 'string' && parts[2] ? parts[2] : null,
    revision: Number.isSafeInteger(row.activityRevision) ? row.activityRevision : valid && Number.isSafeInteger(parts[3]) ? parts[3] : 0,
  };
}

function normalize(row) {
  if (!row || typeof row !== 'object' || typeof row.sessionId !== 'string' || !row.sessionId || !STATUSES.has(row.status) || !Number.isSafeInteger(row.updatedAtMs) || row.updatedAtMs < 0) return null;
  const displayStatus = row.liveCompleted === true && row.status === 'idle' ? 'completed' : row.status;
  return { ...row, displayStatus };
}

export function createReminderStore({ now = Date.now } = {}) {
  const history = new Map();
  const dismissed = new Set();
  const muted = new Set();
  let visible = new Map();
  let sequence = 0;

  function newRound(previous, row, next) {
    if (!previous) return true;
    // A known new turn is the authoritative boundary. Revisions are local to the
    // observer connection, so comparing them alone would replay after reconnect.
    if (next.turnId && previous.turnId) return next.turnId !== previous.turnId;
    if (row.displayStatus === 'running' && previous.status !== 'running') return true;
    // A running snapshot can acquire its turn ID when the observer catches up.
    // Treat that as the same round rather than reviving a dismissed reminder.
    if (next.turnId) return false;
    if (next.epoch !== previous.epoch) return false;
    // A snapshot-only error has no turn ID. On a stable connection a later
    // persisted timestamp is evidence of new activity; repeated 5s snapshots are
    // identical. Across reconnect this is ambiguous and deliberately suppressed.
    return row.displayStatus === 'error' && previous.status === 'error'
      && !previous.turnId && row.updatedAtMs > previous.updatedAtMs;
  }

  function getState() {
    const timestamp = now();
    const items = [];
    for (const [id, value] of visible) {
      if (muted.has(id) || dismissed.has(value.reminderKey)) continue;
      if (!['running', 'error', 'completed'].includes(value.row.displayStatus)) continue;
      const expiresAtMs = value.row.displayStatus === 'running' ? null : value.row.updatedAtMs + (value.row.displayStatus === 'error' ? HOUR_MS : WEEK_MS);
      if (expiresAtMs !== null && expiresAtMs <= timestamp) continue;
      items.push({ ...value.row, reminderKey: value.reminderKey, expiresAtMs });
    }
    items.sort((a, b) => Number(b.needsAnswer === true) - Number(a.needsAnswer === true) || b.updatedAtMs - a.updatedAtMs || compareId(a.sessionId, b.sessionId));
    const primary = items[0] ? { ...items[0] } : null;
    return {
      items,
      primary,
      // Status changes within a round can change pose; epoch/refresh changes
      // cannot. Removing the primary has one stable idle animation identity.
      animationKey: primary ? JSON.stringify([primary.reminderKey, primary.displayStatus, primary.needsAnswer === true]) : JSON.stringify(['idle']),
      mutedIds: [...muted].sort(compareId),
    };
  }

  return {
    update(sessions) {
      const nextVisible = new Map();
      for (const raw of Array.isArray(sessions) ? sessions : []) {
        const row = normalize(raw);
        if (!row) continue;
        const next = identity(row);
        const previous = history.get(row.sessionId);
        const fresh = newRound(previous, row, next);
        const reminderKey = fresh ? JSON.stringify([row.sessionId, ++sequence]) : previous.reminderKey;
        const value = {
          ...next,
          // Keep a known turn across snapshot-only reconnects. Losing it would
          // let a late observation of the same turn bypass a local dismissal.
          turnId: next.turnId || (!fresh ? previous?.turnId : null),
          status: row.displayStatus,
          updatedAtMs: row.updatedAtMs,
          reminderKey,
        };
        history.set(row.sessionId, value);
        nextVisible.set(row.sessionId, { row, reminderKey });
      }
      visible = nextVisible;
      return getState();
    },
    getState,
    dismiss(sessionId) {
      const current = visible.get(sessionId);
      if (current) dismissed.add(current.reminderKey);
      return getState();
    },
    dismissAll() {
      for (const item of getState().items) dismissed.add(item.reminderKey);
      return getState();
    },
    mute(sessionId) {
      if (typeof sessionId === 'string' && sessionId) muted.add(sessionId);
      return getState();
    },
    unmute(sessionId) { muted.delete(sessionId); return getState(); },
  };
}
