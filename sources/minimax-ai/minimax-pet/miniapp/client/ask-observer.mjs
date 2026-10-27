// Public single-session observers supply live tool lifecycle; all:true supplies none.
// This intentionally cannot recover an ask raised before this tail-only subscription.
let requestSequence = 0;
const idOf = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
const turnOf = (row) => idOf(row?.observedTurnId);

export function createAskObserver({ agent, onChange, maxSubscriptions = 3, askDelayMs = 120 }) {
  // The fourth Host observer slot belongs to the global lifecycle subscription.
  const limit = Number.isSafeInteger(maxSubscriptions) ? Math.min(3, Math.max(0, maxSubscriptions)) : 3;
  const delay = Number.isFinite(askDelayMs) ? Math.max(0, askDelayMs) : 120;
  const watches = new Map(), retiring = new Set(), failed = new Map();
  let disposed = false, ready = false, running = new Map(), selectedId = null;
  let queued = false, emitted = null;

  function getState() {
    return {
      needsAnswerIds: [...watches.values()].filter((watch) => watch.needsAnswer).map((watch) => watch.id),
      watchingIds: [...watches.keys()],
      runningCount: running.size,
    };
  }
  function notify() {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (disposed) return;
      const state = getState(), key = JSON.stringify(state);
      if (key === emitted) return;
      emitted = key;
      onChange?.(state);
    });
  }
  const current = (watch) => !disposed && ready && watches.get(watch.id) === watch;
  function clearAsk(watch) {
    clearTimeout(watch.timer); watch.timer = null;
    watch.askCount = 0; watch.needsAnswer = false;
  }
  function enterTurn(watch, turnId) {
    if (watch.turnId === turnId) return;
    if (watch.turnId) {
      watch.retiredTurns.add(watch.turnId);
      if (watch.retiredTurns.size > 16) watch.retiredTurns.delete(watch.retiredTurns.values().next().value);
    }
    clearAsk(watch); watch.turnId = turnId; watch.terminal = false;
  }
  function retire(watch) {
    watches.delete(watch.id); clearAsk(watch); retiring.add(watch);
    // Admission of a replacement waits for the old observe promise to settle.
    // cancel() is best effort and its acknowledgement need not free the Host slot yet.
    try { Promise.resolve(agent.cancel(watch.requestId)).catch(() => {}); } catch { /* Keep the occupied slot fenced. */ }
  }
  function failedFor(row) {
    const previous = failed.get(row.sessionId);
    if (!previous) return false;
    const turnId = turnOf(row);
    return !turnId || previous.turnIds.has(turnId);
  }
  function reconcile() {
    if (disposed || !ready) return;
    const desired = [];
    const add = (id) => {
      const row = running.get(id);
      if (row && desired.length < limit && !desired.includes(id) && !failedFor(row)) desired.push(id);
    };
    // Never evict a question just because another session became selected.
    for (const watch of watches.values()) if (watch.askCount > 0) add(watch.id);
    add(selectedId);
    for (const id of watches.keys()) add(id);
    const recent = [...running.values()].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0) || a.sessionId.localeCompare(b.sessionId));
    for (const row of recent) add(row.sessionId);
    for (const watch of [...watches.values()]) if (!desired.includes(watch.id)) retire(watch);
    for (const id of desired) {
      if (watches.has(id) || watches.size + retiring.size >= limit) continue;
      start(running.get(id));
    }
    notify();
  }
  function start(row) {
    const watch = {
      id: row.sessionId, requestId: `pet-ask-observer-${Date.now().toString(36)}-${++requestSequence}`,
      turnId: turnOf(row), retiredTurns: new Set(), terminal: false,
      askCount: 0, needsAnswer: false, timer: null,
    };
    watches.set(watch.id, watch);
    const onEvent = (event) => {
      if (!current(watch) || event?.sessionId !== watch.id) return;
      const turnId = idOf(event.turnId);
      if (!turnId || watch.retiredTurns.has(turnId)) return;
      if (event.type === 'turn.started') {
        if (watch.turnId === turnId && watch.terminal) return;
        enterTurn(watch, turnId); notify(); return;
      }
      if (!['tool.started', 'tool.finished', 'turn.finished'].includes(event.type)) return;
      if (!watch.turnId) enterTurn(watch, turnId);
      if (watch.turnId !== turnId || watch.terminal) return;
      if (event.type === 'turn.finished') {
        watch.terminal = true; clearAsk(watch); notify(); return;
      }
      if (event.name !== 'ask_user') return;
      if (event.type === 'tool.started') {
        watch.askCount++;
        if (watch.askCount === 1) {
          watch.timer = setTimeout(() => {
            watch.timer = null;
            if (!current(watch) || !watch.askCount || watch.terminal) return;
            watch.needsAnswer = true; notify();
          }, delay);
        }
      } else {
        watch.askCount = Math.max(0, watch.askCount - 1);
        if (!watch.askCount) clearAsk(watch);
      }
      notify();
    };
    let operation;
    try { operation = agent.observe({ sessionId: watch.id, requestId: watch.requestId }, { onEvent }); }
    catch (error) { operation = Promise.reject(error); }
    void Promise.resolve(operation).then(() => ended(watch), () => ended(watch));
  }
  function ended(watch) {
    const wasCurrent = watches.get(watch.id) === watch;
    retiring.delete(watch);
    if (wasCurrent) {
      watches.delete(watch.id); clearAsk(watch);
      // Do not retry a failing stream on every 5s snapshot of the same turn.
      const turnIds = new Set([watch.turnId, turnOf(running.get(watch.id))].filter(Boolean));
      failed.set(watch.id, { turnIds });
    }
    if (!disposed) reconcile();
  }

  return {
    update(snapshot = {}) {
      if (disposed) return getState();
      const nextReady = snapshot.availability === 'ready'
        && typeof agent?.observe === 'function' && typeof agent?.cancel === 'function';
      selectedId = idOf(snapshot.selectedSessionId);
      running = new Map();
      if (nextReady) for (const row of Array.isArray(snapshot.sessions) ? snapshot.sessions : []) {
        if (idOf(row?.sessionId) && row.status === 'running') running.set(row.sessionId, row);
      }
      if (!nextReady) {
        ready = false; failed.clear();
        for (const watch of [...watches.values()]) retire(watch);
        notify(); return getState();
      }
      ready = true;
      for (const [id, entry] of failed) {
        const row = running.get(id), turnId = turnOf(row);
        if (!row || (turnId && !entry.turnIds.has(turnId))) failed.delete(id);
      }
      for (const watch of [...watches.values()]) {
        const row = running.get(watch.id);
        if (!row) { retire(watch); continue; }
        const turnId = turnOf(row);
        if (turnId && !watch.retiredTurns.has(turnId)) enterTurn(watch, turnId);
      }
      reconcile(); return getState();
    },
    getState,
    dispose() {
      if (disposed) return;
      disposed = true; ready = false; running.clear(); failed.clear();
      for (const watch of [...watches.values()]) retire(watch);
    },
  };
}
