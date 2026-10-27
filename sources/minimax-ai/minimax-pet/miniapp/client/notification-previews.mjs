// Notification copy is an optional, bounded detail read; activity facts stay in the observer.
export function createNotificationPreviews({ agent, onChange = () => {} }) {
  let entries = new Map();
  let disposed = false;
  let notificationPending = false;

  function getState() {
    return { previews: Object.fromEntries([...entries].filter(([, entry]) => entry.text).map(([id, entry]) => [id, entry.text])) };
  }
  function notify() {
    if (notificationPending || disposed) return;
    notificationPending = true;
    queueMicrotask(() => {
      notificationPending = false;
      if (!disposed) onChange(getState());
    });
  }
  function snippet(raw, status) {
    const reply = typeof raw.lastAssistantText === 'string' ? raw.lastAssistantText : '';
    const error = typeof raw.error?.message === 'string' ? raw.error.message : '';
    // An errored turn may still expose the preceding turn's reply. Prefer its actual error.
    const text = status === 'error' ? (error.trim() ? error : reply) : reply;
    return text.trim() ? text.slice(0, 4000) : '';
  }
  function load(id, entry) {
    Promise.resolve().then(async () => {
      if (disposed || entries.get(id) !== entry) return;
      const raw = await agent.session(id);
      if (disposed || entries.get(id) !== entry || raw?.sessionId !== id) return;
      const text = snippet(raw, entry.status);
      if (text && text !== entry.text) { entry.text = text; notify(); }
    }).catch(() => { /* A failed optional read must not change the task's observed state. */ });
  }
  function update({ availability, items } = {}) {
    if (disposed) return;
    const previous = getState().previews;
    const next = new Map();
    const pending = [];
    if (availability === 'ready' && typeof agent?.session === 'function' && Array.isArray(items)) {
      for (const item of items.slice(0, 3)) {
        const id = item?.sessionId;
        const status = item?.displayStatus ?? (item?.status === 'error' ? 'error' : null);
        if (typeof id !== 'string' || !id || id.length > 256 || !['completed', 'error'].includes(status) || next.has(id)) continue;
        const key = item.reminderKey ?? item.animationKey;
        // The reminder controller supplies a per-turn identity. Missing identity must not
        // accidentally reuse a preceding turn's reply or turn polling into repeated reads.
        if (typeof key !== 'string' || !key) continue;
        const old = entries.get(id);
        const entry = old?.key === key && old.status === status ? old : { key, status, text: '' };
        next.set(id, entry);
        if (entry !== old) pending.push([id, entry]);
      }
    }
    entries = next;
    const current = getState().previews;
    if (Object.keys(previous).length !== Object.keys(current).length || Object.keys(previous).some((id) => previous[id] !== current[id])) notify();
    for (const [id, entry] of pending) load(id, entry);
  }
  return {
    update,
    getState,
    dispose() { if (disposed) return; disposed = true; entries.clear(); },
  };
}
