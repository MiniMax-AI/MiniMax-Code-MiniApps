// Public Page Agent adapter. No Host activity projection, private IPC or inferred asks/unread state.
export const STATUS_ANIM = Object.freeze({ idle: 'idle', running: 'running', error: 'failed', aborted: 'idle', completed: 'review' });
const RAW_STATUSES = new Set(['idle', 'running', 'error', 'aborted']);
const PRIORITY = ['error', 'completed', 'running', 'aborted', 'idle'];
const codeOf = (error) => error?.code || error?.message || 'runtime_unavailable';
const invalid = () => Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
const displayStatus = (row) => row.liveCompleted ? 'completed' : row.status;
const emptyCounts = () => ({ total: 0, idle: 0, running: 0, error: 0, aborted: 0, completed: 0 });
const idOf = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;

export function normalizeSession(raw, { detail = false } = {}) {
  if (!raw || typeof raw !== 'object' || !idOf(raw.sessionId) || !RAW_STATUSES.has(raw.status) || !Number.isSafeInteger(raw.updatedAtMs) || raw.updatedAtMs < 0 || (raw.title !== undefined && typeof raw.title !== 'string')) throw invalid();
  const session = { sessionId: raw.sessionId, title: (raw.title || '未命名对话').slice(0, 1000), status: raw.status, updatedAtMs: raw.updatedAtMs };
  if (detail) {
    if (typeof raw.error?.message === 'string') session.error = raw.error.message;
    if (typeof raw.lastAssistantText === 'string') session.lastAssistantText = raw.lastAssistantText;
  }
  return session;
}

export function createActivitySource({ agent, onChange, pollIntervalMs = 5000, now = Date.now, makeRequestId = () => `pet-observe-${globalThis.crypto.randomUUID()}` }) {
  let generation = 0;
  let sequence = 0;
  let detailSequence = 0;
  let inFlight = null;
  let observer = null;
  let started = false;
  let disposed = false;
  let timer = null;
  let desiredId = null;
  let rows = new Map();
  const activity = new Map();
  const removedAt = new Map();
  let snapshotIds = new Set();
  let state = { availability: 'connecting', sessions: [], originSession: null, selectedSessionId: null, detail: null, detailLoading: false, detailError: null, error: null };
  const releaseWaiters = new Set();
  const current = (epoch) => !disposed && generation === epoch;
  const eventSequence = (id) => activity.get(id)?.eventSequence ?? 0;
  const order = (a, b) => b.updatedAtMs - a.updatedAtMs || eventSequence(b.sessionId) - eventSequence(a.sessionId) || a.sessionId.localeCompare(b.sessionId);

  function meta(id) {
    if (!activity.has(id)) activity.set(id, { revision: 0, eventSequence: 0, turnId: null, outcome: null, retiredTurns: [], retainOutsideList: false });
    return activity.get(id);
  }
  function withIdentity(row) {
    const value = meta(row.sessionId);
    return { ...row, observedTurnId: value.turnId, activityRevision: value.revision, animationKey: JSON.stringify([generation, row.sessionId, value.turnId, value.revision, displayStatus(row)]) };
  }
  function aggregate(sessions) {
    const counts = emptyCounts();
    for (const row of sessions) { counts.total++; counts[displayStatus(row)]++; }
    const status = state.availability === 'ready' ? PRIORITY.find((name) => counts[name] > 0) ?? 'idle' : null;
    const primarySession = status ? sessions.find((row) => displayStatus(row) === status) ?? null : null;
    return { status, primarySession, counts, animationKey: primarySession?.animationKey ?? JSON.stringify([generation, status]) };
  }
  function emit(patch) {
    if (disposed) return;
    state = { ...state, ...patch, sessions: [...rows.values()].sort(order).map(withIdentity) };
    const combined = aggregate(state.sessions);
    onChange({ ...state, sessions: state.sessions.map((s) => ({ ...s })), originSession: state.originSession ? { ...state.originSession } : null, detail: state.detail ? { ...state.detail } : null, aggregate: { ...combined, counts: { ...combined.counts }, primarySession: combined.primarySession ? { ...combined.primarySession } : null } });
  }
  function advanceGeneration() {
    generation++;
    for (const stop of [...releaseWaiters]) stop();
    return generation;
  }
  function cancelObserver() {
    const previous = observer;
    if (previous && (!previous.cancelled || previous.cancelFailed)) {
      previous.cancelled = true;
      previous.cancelFailed = false;
      try { Promise.resolve(agent.cancel(previous.requestId)).catch(() => { previous.cancelFailed = true; }); }
      catch { previous.cancelFailed = true; /* Keep its slot occupied until observe settles. */ }
    }
    return previous;
  }
  function waitForObserver(previous, epoch) {
    return new Promise((resolve) => {
      const finish = (released) => { releaseWaiters.delete(stop); resolve(released && current(epoch)); };
      const stop = () => finish(false);
      releaseWaiters.add(stop);
      previous.done.then(() => finish(true));
    });
  }
  function clear(availability, error = null) {
    rows.clear(); activity.clear(); removedAt.clear(); snapshotIds.clear(); detailSequence++;
    emit({ availability, originSession: null, selectedSessionId: null, detail: null, detailLoading: false, detailError: null, error });
  }
  function fail(error, epoch) {
    if (!current(epoch)) return;
    advanceGeneration();
    cancelObserver();
    clear(codeOf(error) === 'not_permitted' ? 'not_permitted' : 'unavailable', codeOf(error));
  }
  function removeRow(id) { rows.delete(id); activity.delete(id); }
  function mergeSnapshot(row) {
    const previous = rows.get(row.sessionId);
    const liveCompleted = row.status === 'idle' && previous?.liveCompleted === true;
    if (previous && (previous.status !== row.status || previous.liveCompleted !== liveCompleted)) meta(row.sessionId).revision++;
    return { ...row, liveCompleted };
  }
  async function readDetail(epoch = generation) {
    const id = state.selectedSessionId;
    const ticket = ++detailSequence;
    if (!id || !current(epoch)) return;
    // A background refresh of the same visible task must not replace its long
    // reply with a short loading placeholder, which collapses native scrollTop.
    // Selection changes and visibility/error paths still clear the old detail.
    const previous = rows.has(id) && state.detail?.sessionId === id ? state.detail : null;
    emit({ detail: previous, detailLoading: true, detailError: null });
    try {
      const raw = await agent.session(id);
      if (!current(epoch) || ticket !== detailSequence || state.selectedSessionId !== id) return;
      if (!raw) throw Object.assign(new Error('session_not_found'), { code: 'session_not_found' });
      const detail = normalizeSession(raw, { detail: true });
      if (detail.sessionId !== id) throw invalid();
      const row = rows.get(id);
      if (!row) return;
      emit({ detail: { ...detail, title: row.title, status: row.status, updatedAtMs: row.updatedAtMs }, detailLoading: false, detailError: null });
    } catch (error) {
      if (!current(epoch) || ticket !== detailSequence) return;
      if (codeOf(error) === 'session_not_found') {
        removeRow(id);
        removedAt.set(id, ++sequence);
        if (desiredId === id) desiredId = null;
        emit({ selectedSessionId: null, detail: null, detailLoading: false, detailError: 'session_not_found', ...(state.originSession?.sessionId === id ? { originSession: null } : {}) });
      } else if (['not_permitted', 'runtime_unavailable'].includes(codeOf(error))) fail(error, epoch);
      else emit({ detail: null, detailLoading: false, detailError: codeOf(error) });
    }
  }
  function onEvent(event, epoch) {
    if (!current(epoch) || !event || !idOf(event.sessionId)) return;
    if (!['turn.started', 'turn.finished'].includes(event.type)) return; // Never retain message text from observer events.
    if (event.type === 'turn.finished' && !['finished', 'error', 'aborted'].includes(event.status)) return;
    const value = meta(event.sessionId);
    const turnId = idOf(event.turnId);
    const outcome = event.type === 'turn.started' ? 'running' : event.status;
    if (turnId && value.retiredTurns.includes(turnId)) return;
    if (turnId && value.turnId === turnId && value.outcome && value.outcome !== 'running') return;
    // A delayed terminal event from another turn cannot finish the current running turn.
    if (event.type === 'turn.finished' && turnId && value.turnId && value.turnId !== turnId && value.outcome === 'running') return;
    if (value.turnId === turnId && value.outcome === outcome) return;
    if (turnId !== value.turnId && value.turnId) {
      value.retiredTurns.push(value.turnId);
      if (value.retiredTurns.length > 8) value.retiredTurns.shift();
    }
    value.turnId = turnId;
    value.outcome = outcome;
    value.revision++;
    value.eventSequence = ++sequence;
    value.retainOutsideList = true;
    removedAt.delete(event.sessionId);
    const previous = rows.get(event.sessionId);
    const status = outcome === 'finished' ? 'idle' : outcome;
    rows.set(event.sessionId, { sessionId: event.sessionId, title: typeof event.title === 'string' && event.title ? event.title.slice(0, 1000) : previous?.title || '未命名对话', status, updatedAtMs: now(), liveCompleted: outcome === 'finished' });
    emit({});
    if (state.selectedSessionId === event.sessionId) void readDetail(epoch);
  }
  function startObserver(epoch) {
    const next = { requestId: makeRequestId(), cancelled: false, done: null };
    observer = next;
    let subscription;
    try { subscription = agent.observe({ all: true, requestId: next.requestId }, { onEvent: (event) => onEvent(event, epoch) }); }
    catch (error) { if (observer === next) observer = null; fail(error, epoch); return false; }
    const ended = (error) => {
      if (observer === next) observer = null;
      if (!next.cancelled) fail(error, epoch);
    };
    next.done = Promise.resolve(subscription).then(
      () => ended({ code: 'runtime_unavailable' }),
      (error) => ended(error),
    );
    return true;
  }
  // The SDK list is only the latest 50. Revalidate previously observed off-list roots with
  // session(id), which checks current visibility/deletion. Never retain its reply text here.
  async function readOutsideList(ids, epoch) {
    const results = new Map();
    let cursor = 0;
    async function worker() {
      while (current(epoch) && cursor < ids.length) {
        const id = ids[cursor++];
        const before = eventSequence(id);
        try {
          const raw = await agent.session(id);
          if (!current(epoch)) return;
          if (!raw) { results.set(id, { row: null, before }); continue; }
          const row = normalizeSession(raw);
          if (row.sessionId !== id) throw invalid();
          results.set(id, { row, before });
        } catch (error) {
          if (!current(epoch)) return;
          if (codeOf(error) === 'session_not_found') results.set(id, { row: null, before });
          else throw error;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    return results;
  }
  async function readSnapshot(epoch) {
    const before = sequence;
    try {
      const [result, originRaw] = await Promise.all([agent.sessions(), agent.session().catch((error) => {
        if (codeOf(error) === 'session_not_found') return null;
        throw error;
      })]);
      if (!current(epoch)) return;
      if (!result || !Array.isArray(result.sessions)) throw invalid();
      const incoming = result.sessions.map((raw) => normalizeSession(raw));
      if (new Set(incoming.map((s) => s.sessionId)).size !== incoming.length) throw invalid();
      const origin = originRaw ? normalizeSession(originRaw) : null;
      if (origin && !incoming.some((s) => s.sessionId === origin.sessionId)) incoming.push(origin);
      const incomingIds = new Set(incoming.map((row) => row.sessionId));
      const outsideIds = [...rows.keys()].filter((id) => !incomingIds.has(id) && activity.get(id)?.retainOutsideList);
      const outside = await readOutsideList(outsideIds, epoch);
      if (!current(epoch)) return;
      const next = new Map();
      for (const row of incoming) {
        if ((removedAt.get(row.sessionId) ?? 0) > before) continue;
        const previous = rows.get(row.sessionId);
        next.set(row.sessionId, eventSequence(row.sessionId) > before && previous ? previous : mergeSnapshot(row));
      }
      for (const [id, checked] of outside) {
        if (!rows.has(id)) continue;
        if (eventSequence(id) > checked.before) next.set(id, rows.get(id));
        else if (checked.row && activity.get(id)?.retainOutsideList) next.set(id, mergeSnapshot(checked.row));
      }
      // Events that arrived after the list was requested may introduce entirely new roots.
      for (const [id, row] of rows) if (eventSequence(id) > before && !incomingIds.has(id) && !outside.has(id)) next.set(id, row);
      rows = next;
      snapshotIds = incomingIds;
      for (const id of activity.keys()) if (!rows.has(id)) activity.delete(id);
      for (const [id, serial] of removedAt) if (serial <= before) removedAt.delete(id);
      if (desiredId && !rows.has(desiredId)) desiredId = null;
      const selected = desiredId ?? (origin && rows.has(origin.sessionId) ? origin.sessionId : null);
      const matchingDetail = selected && state.detail?.sessionId === selected;
      emit({ availability: 'ready', originSession: origin && rows.has(origin.sessionId) ? rows.get(origin.sessionId) : null, selectedSessionId: selected, error: null,
        ...(!matchingDetail ? { detail: null, detailLoading: false, detailError: null } : {}) });
      if (selected) void readDetail(epoch);
      else { detailSequence++; emit({ detail: null, detailLoading: false, detailError: null }); }
    } catch (error) { fail(error, epoch); }
  }
  function refresh() {
    if (disposed) return Promise.resolve();
    if (!agent || ['sessions', 'session', 'observe', 'cancel'].some((name) => typeof agent[name] !== 'function')) {
      advanceGeneration(); cancelObserver(); clear('unavailable', 'unsupported'); return Promise.resolve();
    }
    if (inFlight?.epoch === generation) {
      // A later refresh can retry a failed cancel, while preserving the release barrier.
      if (observer?.cancelled && observer.cancelFailed) cancelObserver();
      return inFlight.promise;
    }
    const reconnect = state.availability !== 'ready';
    let previous = null;
    if (reconnect) {
      advanceGeneration();
      previous = cancelObserver();
      clear('connecting');
    }
    const epoch = generation;
    const operation = { epoch, promise: null };
    operation.promise = (async () => {
      // cancel() acknowledges a request, not release of the Host observer slot.
      // Admit the global observer before publishing ready to detailed followers.
      if (previous && !await waitForObserver(previous, epoch)) return;
      if (!current(epoch) || (reconnect && !startObserver(epoch))) return;
      // A synchronously failing observer must not be followed by a reviving snapshot.
      if (!observer) return;
      await readSnapshot(epoch);
    })().finally(() => { if (inFlight === operation) inFlight = null; });
    inFlight = operation;
    return operation.promise;
  }
  return {
    start() { if (started || disposed) return inFlight?.promise ?? Promise.resolve(); started = true; emit({}); if (pollIntervalMs > 0) timer = setInterval(() => { void refresh(); }, pollIntervalMs); return refresh(); },
    refresh,
    selectSession(id) {
      if (state.availability !== 'ready' || !rows.has(id)) throw Object.assign(new Error('session_not_found'), { code: 'session_not_found' });
      desiredId = id;
      emit({ selectedSessionId: id, detail: null, detailLoading: false, detailError: null });
      return readDetail();
    },
    clearCompleted() {
      if (disposed) return;
      for (const [id, row] of rows) {
        if (!row.liveCompleted) continue;
        const value = meta(id);
        value.revision++;
        value.retainOutsideList = false;
        if (snapshotIds.has(id)) rows.set(id, { ...row, liveCompleted: false });
        else removeRow(id);
      }
      if (state.selectedSessionId && !rows.has(state.selectedSessionId)) {
        desiredId = null;
        detailSequence++;
        emit({ selectedSessionId: null, detail: null, detailLoading: false, detailError: null });
      } else emit({});
    },
    dispose() { if (disposed) return; disposed = true; advanceGeneration(); detailSequence++; clearInterval(timer); cancelObserver(); rows.clear(); activity.clear(); removedAt.clear(); snapshotIds.clear(); },
  };
}
