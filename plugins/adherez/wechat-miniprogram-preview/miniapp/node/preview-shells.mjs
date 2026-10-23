import { randomUUID } from 'node:crypto';

const IDENTITY_KEYS = ['serverEpoch', 'previewId', 'projectId', 'buildId', 'clientId', 'instanceId', 'leaseEpoch'];
const MAX_CHANNELS = 32;
const MAX_LIVE_CHANNELS = 4;
const CONNECT_RESERVATION_MS = 30000;
const IDLE_TTL_MS = 30 * 60 * 1000;
const COMMAND_TTL_MS = 15000;
const MAX_RECEIPTS = 32;
const RETRY_STATUSES = new Set(['storage_timeout', 'outcome_unknown', 'document_failed', 'reconnect_required', 'disconnected']);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const sameIdentity = (a, b) => !!a && !!b && IDENTITY_KEYS.every((key) => a[key] === b[key]);
const clone = (value) => structuredClone(value);

/** Metadata-only channel to the still-live Shell; business snapshots never enter MCP. */
export function createPreviewShells(service, { now = Date.now } = {}) {
  const channels = new Map();
  let disposed = false;
  const current = (channel) => {
    try { return service.snapshot(channel.previewId); }
    catch (error) { if (error.code === 'PREVIEW_CONTEXT_NOT_FOUND') return null; throw error; }
  };
  const liveIdentity = (state) => state?.lease ? { ...state.lease, previewId: state.previewId, projectId: state.projectId, serverEpoch: state.serverEpoch } : null;
  const expireCommand = (channel) => {
    const pending = channel.pending;
    if (pending?.status === 'pending' && now() >= pending.deadline) {
      pending.status = 'unconfirmed'; pending.message = 'Shell 未确认操作结果；请查询状态，不要自动重复操作。';
    }
  };
  const prune = () => {
    for (const [id, channel] of channels) {
      expireCommand(channel);
      if (!channel.connected && now() - channel.touchedAt > IDLE_TTL_MS) channels.delete(id);
    }
  };
  const get = (id) => {
    if (disposed) fail('PREVIEW_STOPPING', '预览服务正在停止。');
    prune();
    const channel = channels.get(id);
    if (!channel) fail('SHELL_UNAVAILABLE', '预览页面已离开或恢复通道失效。');
    channel.touchedAt = now();
    return channel;
  };
  const occupying = (channel) => channel.connected || channel.reservedUntil > now();
  const reserve = (channel) => {
    if (occupying(channel)) return;
    if ([...channels.values()].filter(occupying).length >= MAX_LIVE_CHANNELS) fail('SHELL_CAPACITY_REACHED', '最多同时连接四个预览页面，请先关闭不使用的 Mini App 标签页，再重新打开。');
    channel.reservedUntil = now() + CONNECT_RESERVATION_MS;
  };
  const actions = (channel) => {
    if (!channel.connected || !channel.state) return [];
    const report = channel.state;
    const result = report.exportAvailable ? ['export_local'] : [];
    const state = current(channel);
    if (!state) {
      if (report.status === 'outcome_unknown' && report.operationId) result.push('retry');
      return result;
    }
    if (state.serverEpoch !== channel.serverEpoch || state.projectId !== channel.projectId) return result;
    const owned = sameIdentity(report.identity, liveIdentity(state));
    const target = state.recovering?.targetClientId === channel.clientId || state.reconnectTarget?.clientId === channel.clientId;
    // A committed handoff can advance the lease before its HTTP response arrives.
    // Only reconcile the same operation; destructive actions still need the new epoch.
    if (report.status === 'outcome_unknown' && report.operationId && (target || state.lease?.clientId === channel.clientId)) result.push('retry');
    if (report.contextLeaseEpoch !== state.leaseEpoch) return result;
    if (!result.includes('retry') && RETRY_STATUSES.has(report.status) && (owned || target || state.lease?.clientId === channel.clientId)) result.push('retry');
    if (owned && report.status === 'storage_conflict') result.push('discard_local');
    if (!state.recovering && !owned && (state.lease ? ['ownership_lost', 'waiting'].includes(report.status)
      : ['ownership_lost', 'reconnect_required', 'disconnected'].includes(report.status))) result.push('takeover');
    if (!state.recovering && (!state.lease || owned) && !['outcome_unknown', 'document_failed', 'reconnect_required'].includes(report.status)) result.push('close');
    return result;
  };
  const summary = (channel) => {
    expireCommand(channel);
    return { clientId: channel.clientId, previewId: channel.previewId, projectId: channel.projectId, serverEpoch: channel.serverEpoch,
      connected: channel.connected, state: channel.state ? clone(channel.state) : null, availableActions: actions(channel),
      lastCommand: channel.pending ? { requestId: channel.pending.requestId, action: channel.pending.action, stateRevision: channel.pending.stateRevision,
        status: channel.pending.status, ...(channel.pending.message ? { message: channel.pending.message } : {}) } : null };
  };
  return {
    register(input) {
      if (disposed) fail('PREVIEW_STOPPING', '预览服务正在停止。');
      prune();
      const state = service.snapshot(input.previewId);
      if (state.serverEpoch !== input.serverEpoch) fail('STALE_FRAME', '预览服务身份已变化。');
      for (const [id, previous] of channels) {
        if (previous.previewId !== input.previewId || previous.clientId !== input.clientId) continue;
        if (previous.registrationId !== input.registrationId) fail('SHELL_ALREADY_REGISTERED', '页面已经登记恢复通道。');
        if (previous.projectId === state.projectId && previous.serverEpoch === input.serverEpoch) {
          reserve(previous);
          previous.touchedAt = now();
          return { ok: true, channelId: id, replayed: true };
        }
        previous.send?.('channel-retired', { reason: 'project_changed' });
        channels.delete(id);
      }
      if (channels.size >= MAX_CHANNELS) fail('PREVIEW_CAPACITY_REACHED', '恢复通道数量达到上限。');
      if ([...channels.values()].filter(occupying).length >= MAX_LIVE_CHANNELS) fail('SHELL_CAPACITY_REACHED', '最多同时连接四个预览页面，请先关闭不使用的 Mini App 标签页，再重新打开。');
      const channelId = randomUUID();
      channels.set(channelId, { previewId: input.previewId, projectId: state.projectId, clientId: input.clientId, serverEpoch: input.serverEpoch, registrationId: input.registrationId,
        state: null, connected: false, reservedUntil: now() + CONNECT_RESERVATION_MS, send: null, touchedAt: now(), pending: null, receipts: new Map() });
      return { ok: true, channelId };
    },
    subscribe(channelId, callback) {
      const channel = get(channelId);
      if (channel.connected) fail('SHELL_IN_USE', '恢复通道已连接。');
      reserve(channel); channel.connected = true; channel.reservedUntil = 0; channel.send = callback;
      if (channel.pending && ['pending', 'unconfirmed'].includes(channel.pending.status)) callback('recovery-command', clone(channel.pending.command));
      return () => { channel.connected = false; channel.reservedUntil = 0; channel.send = null; channel.touchedAt = now(); };
    },
    binding(channelId) { const channel = get(channelId); return { previewId: channel.previewId, projectId: channel.projectId, serverEpoch: channel.serverEpoch }; },
    report(channelId, input) {
      const channel = get(channelId), state = current(channel);
      if (input.identity && (input.identity.previewId !== channel.previewId || input.identity.projectId !== channel.projectId
        || input.identity.clientId !== channel.clientId || input.identity.serverEpoch !== channel.serverEpoch)) fail('STALE_FRAME', '页面状态不属于该恢复通道。');
      const old = channel.state;
      const retired = ['ownership_lost', 'closed'].includes(input.status);
      if (input.identity && !sameIdentity(input.identity, liveIdentity(state)) && !sameIdentity(input.identity, old?.identity)
        && !(retired && (!state || input.identity.leaseEpoch <= state.leaseEpoch))) fail('STALE_FRAME', '不接收未知或其他窗口的页面身份。');
      // Retired reports only preserve the original Shell's export route. They
      // never establish a lease or let its old snapshot write to a new project.
      if (state && (state.serverEpoch !== channel.serverEpoch || input.contextLeaseEpoch > state.leaseEpoch
        || state.projectId !== channel.projectId && !retired)) fail('STALE_FRAME', '预览工程或服务身份已变化。');
      if (old && input.revision <= old.revision) {
        if (input.revision === old.revision && JSON.stringify(input) === JSON.stringify(old)) return { ok: true, revision: old.revision };
        fail('STALE_SHELL_STATE', '页面恢复状态已更新。');
      }
      channel.state = clone(input);
      return { ok: true, revision: input.revision };
    },
    list(previewId) {
      prune();
      return [...channels.values()].filter((channel) => channel.previewId === previewId).map(summary);
    },
    request(input) {
      prune();
      const channel = [...channels.values()].find((item) => item.previewId === input.preview_id && item.clientId === input.client_id);
      if (!channel?.connected || !channel.send) fail('SHELL_UNAVAILABLE', '目标页面未连接，无法操作它的本地快照；请先打开已有预览。');
      if (disposed) fail('PREVIEW_STOPPING', '预览服务正在停止。');
      channel.touchedAt = now();
      const signature = JSON.stringify({ action: input.action, state_revision: input.state_revision, confirmed: input.confirmed === true });
      if (input.request_id && channel.receipts.has(input.request_id)) {
        const previous = channel.receipts.get(input.request_id);
        if (previous.signature !== signature) fail('OPERATION_ID_REUSED', '恢复请求标识已用于不同操作。');
        if (['pending', 'unconfirmed'].includes(previous.status)) channel.send('recovery-command', clone(previous.command));
        return { ok: true, accepted: true, replayed: true, requestId: input.request_id, status: previous.status };
      }
      if (!channel.state || channel.state.revision !== input.state_revision) fail('STALE_SHELL_STATE', '页面状态已更新，请重新读取 preview_status。');
      expireCommand(channel);
      if (channel.pending && ['pending', 'unconfirmed'].includes(channel.pending.status)) fail('RECOVERY_IN_PROGRESS', '已有恢复指令等待页面确认；不要用新请求重复执行。');
      if (['discard_local', 'takeover', 'close'].includes(input.action) && input.confirmed !== true) fail('CONFIRMATION_REQUIRED', '该操作需要用户明确确认数据或窗口影响。');
      if (!actions(channel).includes(input.action)) fail('RECOVERY_NOT_AVAILABLE', '当前状态不允许此恢复操作，请重新读取 preview_status。');
      const requestId = input.request_id || randomUUID();
      const command = { requestId, action: input.action, stateRevision: input.state_revision, serverEpoch: channel.serverEpoch,
        previewId: channel.previewId, clientId: channel.clientId, identity: clone(channel.state.identity), contextLeaseEpoch: channel.state.contextLeaseEpoch };
      const receipt = { requestId, action: input.action, stateRevision: input.state_revision, status: 'pending', signature, command, deadline: now() + COMMAND_TTL_MS };
      channel.pending = receipt; channel.receipts.set(requestId, receipt);
      while (channel.receipts.size > MAX_RECEIPTS) channel.receipts.delete(channel.receipts.keys().next().value);
      channel.send('recovery-command', clone(command));
      return { ok: true, accepted: true, requestId, status: 'pending', nextStep: 'read_preview_status', note: '已下发不代表已执行；导出也须核对实际下载结果。' };
    },
    acknowledge(channelId, input) {
      const channel = get(channelId), receipt = channel.receipts.get(input.requestId);
      if (!receipt || receipt.stateRevision !== input.stateRevision) fail('STALE_SHELL_STATE', '没有匹配的恢复请求。');
      if (!['pending', 'unconfirmed'].includes(receipt.status)) {
        if (receipt.status === input.status && (receipt.message || '') === (input.message || '')) return { ok: true, replayed: true };
        fail('OPERATION_ID_REUSED', '恢复结果已确定，不能改写。');
      }
      receipt.status = input.status; receipt.message = String(input.message || '').slice(0, 1000);
      return { ok: true };
    },
    dispose() { disposed = true; channels.clear(); },
  };
}
