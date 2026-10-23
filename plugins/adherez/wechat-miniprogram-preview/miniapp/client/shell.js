'use strict';
const $ = (id) => document.getElementById(id);
const devices = window.__WX_PREVIEW_DEVICES__;
const uid = (prefix) => prefix + '-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
const clientId = uid('client');
const registrationId = uid('shell-registration');
let previewId = new URLSearchParams(location.search).get('previewId') || '';
let frame = $('simulator');
let state = null;
let identity = null;
let selectionGeneration = 0;
let route = '';
let requestedRoute = '';
let commandSeq = 0;
let pendingCommand = null;
let loadedKey = '';
let ready = false;
let started = false;
let startupTimer = null;
let failedStartupBuild = '';
let connected = true;
let closed = false;
let ownershipLost = false;
let bindingRetired = false;
let quiescing = false;
let busy = false;
let automaticBlocked = false;
let mutationPending = false;
let pendingLoadKey = '';
let pendingClosed = false;
let rebuildBusy = false;
let storage = {};
let acknowledgedStorage = '{}';
let ackRevision = 0;
let storageWrites = Promise.resolve();
let storageProblem = null;
let uncertainOperation = null;
let pendingDocument = null;
let reconnectRequired = false;
let runtimeStatus = { status: 'idle', details: [] };
let frameKind = 'miniprogram';
let frameLayout = null;
let gameState = null;
let gameDisposed = false;
let retirement = null;
let retirementIncomplete = false;
let storageWarnings = [];
let lifecycle = Promise.resolve();
const storageFlushes = new Map();
const gameDisposals = new Map();
let recoveryChannel = null;
let recoveryEvents = null;
let recoveryBinding = '';
let recoveryRevision = 0;
let recoveryFingerprint = '';
let recoveryReport = null;
let recoveryWrites = Promise.resolve();
let recoveryRegistration = null;
let connectionProbe = null;
const recoveryReceipts = new Map();
const theme = matchMedia('(prefers-color-scheme: dark)');
const syncTheme = () => { document.documentElement.dataset.theme = theme.matches ? 'dark' : 'light'; };
syncTheme();
theme.addEventListener('change', syncTheme);

class ApiError extends Error {
  constructor(message, code, details, uncertain = false) { super(message); this.code = code; this.details = details; this.uncertain = uncertain; }
}
async function api(endpoint, body, userAction) {
  let response;
  let value;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    response = await fetch('/api/' + endpoint, body === undefined ? { signal: abort.signal } : {
      method: 'POST', headers: { 'content-type': 'application/json', ...(userAction ? { 'x-preview-user-action': userAction } : {}) }, body: JSON.stringify(body),
      signal: abort.signal,
    });
    value = await response.json().catch(() => null);
  } catch { throw new ApiError('连接中断或请求超时，操作结果尚未确认。', 'OUTCOME_UNKNOWN', null, body !== undefined); }
  finally { clearTimeout(timer); }
  if (!response.ok || value?.ok === false) throw new ApiError(value?.message || '操作失败（' + response.status + '）', value?.code || 'REQUEST_FAILED', value?.details,
    response.status >= 500 || value?.details?.committed === true || ['TRANSITION_OUTCOME_UNKNOWN', 'PREVIEW_RECOVERING'].includes(value?.code));
  if (!value) throw new ApiError('服务返回无法解析的结果，请重新确认操作状态。', 'OUTCOME_UNKNOWN', null, body !== undefined);
  return value;
}
const endpoint = (name, id = previewId) => 'previews/' + encodeURIComponent(id) + '/' + name;
const sameIdentity = (a, b) => !!a && !!b && ['previewId', 'projectId', 'serverEpoch', 'buildId', 'clientId', 'instanceId', 'leaseEpoch'].every((key) => a[key] === b[key]);
const dirty = () => JSON.stringify(storage) !== acknowledgedStorage;
function selectedDevice() { return devices.get(state?.deviceId || devices.defaultId); }
function requireReadyBuild(value = state) { if (value?.build?.status !== 'ok') throw new ApiError('当前构建不可用，请先在聊天中修复并重新构建；本地快照保持不变。', 'BUILD_NOT_AVAILABLE'); }
function isGame() { return (state?.projectKind || state?.activeProject?.projectKind || state?.build?.manifest?.projectKind) === 'minigame'; }
function layoutForBuild(deviceId = selectedDevice().id) {
  return { deviceId, projectKind: isGame() ? 'minigame' : 'miniprogram', landscape: isGame() && state?.build?.manifest?.game?.deviceOrientation === 'landscape' };
}
function displayedLayout() { return frameLayout || layoutForBuild(); }
function notice(message) { $('notice').textContent = message || ''; $('notice').hidden = !message; }
function setEmpty(title, message) {
  $('empty').hidden = false;
  $('empty').querySelector('h2').textContent = title;
  $('empty').querySelector('p').textContent = message;
}
function syncControls() {
  const own = !!identity && !ownershipLost;
  $('refresh-preview').disabled = !previewId || !state || closed || busy || rebuildBusy || !connected
    || !recoveryChannel || ownershipLost || !!uncertainOperation || !!pendingDocument || !!storageProblem
    || (!!state.lease && !own) || state.build?.status === 'building';
  reportRecovery();
}
function recoveryState() {
  const code = storageProblem?.code;
  const status = bindingRetired ? 'ownership_lost' : pendingDocument ? 'document_failed' : uncertainOperation ? 'outcome_unknown' : closed ? 'closed'
    : reconnectRequired ? 'reconnect_required' : ownershipLost ? 'ownership_lost' : !connected ? 'disconnected'
    : code === 'STORAGE_CONFLICT' ? 'storage_conflict' : code === 'STORAGE_FLUSH_TIMEOUT' ? 'storage_timeout'
    : failedStartupBuild ? 'startup_error' : started ? 'ready' : 'waiting';
  return {
    identity: identity?.serverEpoch === state?.serverEpoch ? identity : null,
    contextLeaseEpoch: state?.leaseEpoch || 0, status, dirty: dirty() || retirementIncomplete,
    exportAvailable: !!identity || started || Object.keys(storage).length > 0 || !!uncertainOperation || !!retirementIncomplete,
    ...(uncertainOperation?.body?.operationId || storageProblem?.details?.operationId ? { operationId: uncertainOperation?.body?.operationId || storageProblem.details.operationId } : {}),
    ...(closed && uncertainOperation ? { message: '预览已关闭，操作结果待确认。' } : storageProblem?.message ? { message: storageProblem.message.slice(0, 1000) } : {}),
  };
}
function reportRecovery(force = false) {
  if (!recoveryChannel || !state) return;
  const value = recoveryState();
  const fingerprint = JSON.stringify([value, storage]);
  if (fingerprint === recoveryFingerprint) {
    if (force && recoveryReport) {
      const channel = recoveryChannel, report = recoveryReport;
      recoveryWrites = recoveryWrites.catch(() => {}).then(() => channel === recoveryChannel && api('shells/' + encodeURIComponent(channel) + '/state', report)).catch(() => {});
    }
    return;
  }
  recoveryFingerprint = fingerprint;
  recoveryReport = { ...value, revision: ++recoveryRevision };
  const report = recoveryReport, channel = recoveryChannel;
  recoveryWrites = recoveryWrites.catch(() => {}).then(() => {
    if (channel !== recoveryChannel) return;
    return api('shells/' + encodeURIComponent(channel) + '/state', report);
  }).catch(() => { notice('预览恢复通道暂时不可用，本地快照仍保留；请在聊天中重试。'); });
}
function registerRecovery() {
  const binding = state?.serverEpoch + ':' + previewId + ':' + state?.projectId;
  if (recoveryChannel && recoveryBinding === binding) { reportRecovery(true); return recoveryWrites; }
  if (recoveryRegistration?.binding === binding) return recoveryRegistration.promise;
  const registration = { binding, promise: null };
  registration.promise = establishRecovery(binding).finally(() => { if (recoveryRegistration === registration) recoveryRegistration = null; });
  recoveryRegistration = registration;
  return registration.promise;
}
async function establishRecovery(binding) {
  recoveryEvents?.close(); recoveryChannel = null; recoveryBinding = binding;
  recoveryRevision = 0; recoveryFingerprint = ''; recoveryReport = null; recoveryReceipts.clear();
  const input = { previewId, clientId, registrationId, serverEpoch: state.serverEpoch };
  let result;
  try { result = await api('shells', input); }
  catch (error) { if (!error.uncertain) throw error; result = await api('shells', input); }
  if (binding !== recoveryBinding || typeof result.channelId !== 'string') throw new ApiError('恢复通道登记失败。', 'INVALID_RESPONSE');
  recoveryChannel = result.channelId;
  openRecoveryEvents(recoveryChannel);
  reportRecovery(true);
  await recoveryWrites;
}
function openRecoveryEvents(channel) {
  recoveryEvents?.close();
  recoveryEvents = new EventSource('/api/shells/' + encodeURIComponent(channel) + '/events');
  listen(recoveryEvents, previewId, state.serverEpoch, selectionGeneration, channel);
  recoveryEvents.addEventListener('connected', () => {
    if (channel !== recoveryChannel) return;
    reportRecovery(true);
    for (const receipt of recoveryReceipts.values()) if (!receipt.acknowledged) acknowledgeRecovery(receipt, channel);
  });
  recoveryEvents.addEventListener('recovery-command', (event) => {
    if (channel !== recoveryChannel) return;
    let command; try { command = JSON.parse(event.data); } catch { return; }
    receiveRecovery(command, channel);
  });
}
function matchesRecovery(command, channel) {
  reportRecovery();
  const report = recoveryReport;
  return channel === recoveryChannel && command.previewId === previewId && command.serverEpoch === state?.serverEpoch
    && command.clientId === clientId && command.stateRevision === report?.revision
    && command.contextLeaseEpoch === state?.leaseEpoch
    && command.contextLeaseEpoch === report.contextLeaseEpoch
    && (command.identity === null && report.identity === null || sameIdentity(command.identity, report.identity));
}
async function acknowledgeRecovery(receipt, channel) {
  if (receipt.acking) return;
  receipt.acking = true;
  try {
    const result = await receipt.result;
    for (let attempt = 0; attempt < 2 && channel === recoveryChannel; attempt++) {
      try { await api('shells/' + encodeURIComponent(channel) + '/ack', result); receipt.acknowledged = true; return; }
      catch (error) { if (!error.uncertain) return; }
    }
  } finally { receipt.acking = false; }
}
function receiveRecovery(command, channel) {
  if (!command || typeof command.requestId !== 'string' || !Number.isSafeInteger(command.stateRevision)) return;
  const receiptKey = channel + ':' + command.requestId;
  const signature = JSON.stringify(command);
  const previous = recoveryReceipts.get(receiptKey);
  if (previous) {
    if (previous.signature !== signature) return;
    acknowledgeRecovery(previous, channel); return;
  }
  const result = schedule(async () => {
    const revalidate = () => { if (!matchesRecovery(command, channel)) throw new ApiError('恢复请求已过期，未执行。', 'STALE_FRAME'); };
    revalidate();
    if (bindingRetired && command.action !== 'export_local') throw new ApiError('此窗口只保留旧工程快照，不能操作新工程。', 'STALE_FRAME');
    if (command.action === 'retry') await retryRecovery(revalidate);
    else if (command.action === 'export_local') {
      if (!recoveryState().exportAvailable) throw new ApiError('当前窗口没有可导出的本地快照。', 'LOCAL_SNAPSHOT_UNAVAILABLE');
      downloadStorage(storage, 'miniapp-storage-unsaved.json');
      notice('已发起本地快照导出；保存结果请在下载位置确认。');
      return { requestId: command.requestId, stateRevision: command.stateRevision, status: 'export_requested' };
    } else if (command.action === 'discard_local') {
      if (closed || ownershipLost || !identity || uncertainOperation || pendingDocument) throw new ApiError('当前归属不能放弃并重载，请先确认操作结果。', 'STALE_FRAME');
      requireReadyBuild();
      if (!window.confirm('将放弃当前未保存修改并载入服务端数据。建议先在聊天中请求导出。确定继续吗？')) throw new ApiError('已取消放弃本地修改。', 'CANCELED');
      revalidate();
      await api(endpoint('storage'));
      revalidate(); requireReadyBuild();
      await transitionFrame({ discard: true });
    } else if (command.action === 'takeover') {
      if (closed || uncertainOperation || pendingDocument) throw new ApiError('先确认未完成操作，不能接管。', 'OUTCOME_UNKNOWN');
      if (!window.confirm('接管会使当前运行窗口失去写入权限，未提交数据不会自动带入。确定接管吗？')) throw new ApiError('已取消接管。', 'CANCELED');
      revalidate();
      const latest = await api(endpoint('state'));
      revalidate();
      if (latest.serverEpoch !== command.serverEpoch || latest.projectId !== state.projectId || latest.leaseEpoch !== command.contextLeaseEpoch) throw new ApiError('预览归属已变化，未接管。', 'STALE_FRAME');
      requireReadyBuild(latest);
      state = latest;
      if (!latest.lease && identity) { await disposeGameFrame(); revalidate(); resetFrame(); }
      await transitionFrame({ takeover: !!latest.lease });
    } else if (command.action === 'close') {
      if (closed) throw new ApiError('此预览已经关闭。', 'PREVIEW_CONTEXT_NOT_FOUND');
      if (!window.confirm('保存可提交的数据并关闭此预览？')) throw new ApiError('已取消关闭。', 'CANCELED');
      revalidate();
      await drainCurrent('close');
    } else throw new ApiError('不支持的恢复操作。', 'INVALID_ARGUMENTS');
    return { requestId: command.requestId, stateRevision: command.stateRevision, status: 'completed' };
  }).catch((error) => {
    notice(error.message);
    return { requestId: command.requestId, stateRevision: command.stateRevision, status: 'failed', message: error.message.slice(0, 1000) };
  });
  const receipt = { signature, result, acknowledged: false, acking: false };
  recoveryReceipts.set(receiptKey, receipt);
  while (recoveryReceipts.size > 64) recoveryReceipts.delete(recoveryReceipts.keys().next().value);
  acknowledgeRecovery(receipt, channel);
}
function post(message, target = frame, targetIdentity = identity) {
  if (targetIdentity && target?.contentWindow) target.contentWindow.postMessage({ source: 'wx-shell', ...message, ...targetIdentity }, '*');
}
async function disposeGameFrame() {
  if (!identity || frameKind !== 'minigame' || gameDisposed) return;
  const owner = identity, source = frame.contentWindow, requestId = uid('dispose');
  await new Promise((resolve) => {
    const finish = (acknowledged) => {
      const pending = gameDisposals.get(requestId); if (!pending) return;
      clearTimeout(pending.timer); gameDisposals.delete(requestId);
      if (sameIdentity(owner, identity)) gameDisposed = true;
      if (!acknowledged) notice('小游戏清理确认超时；将销毁旧 iframe，不继续执行旧页面。');
      resolve();
    };
    gameDisposals.set(requestId, { owner, source, finish, timer: setTimeout(() => finish(false), 800) });
    post({ type: 'dispose', requestId });
  });
}
function resetFrame() {
  if (frameKind === 'minigame' && !gameDisposed) post({ type: 'dispose', requestId: uid('dispose') });
  clearTimeout(startupTimer); startupTimer = null;
  failedStartupBuild = '';
  for (const pending of storageFlushes.values()) { clearTimeout(pending.timer); pending.reject(new ApiError('页面归属已经改变。', 'STALE_FRAME')); }
  storageFlushes.clear();
  frame.removeAttribute('src'); frame.hidden = true; frame.setAttribute('aria-busy', 'false');
  identity = null; ready = false; started = false; loadedKey = ''; quiescing = false;
  frameKind = 'miniprogram'; frameLayout = null; gameState = null; gameDisposed = false;
}
function retireCurrentFrame() {
  if (!identity) return;
  const owner = identity;
  if (retirement && sameIdentity(retirement.owner, owner)) return retirement.promise;
  const current = { owner, promise: null }; retirement = current;
  current.promise = (async () => {
    try { const value = await quiesceCurrent(); if (sameIdentity(owner, identity)) storage = validStorage(value); }
    catch { retirementIncomplete = true; }
    if (!sameIdentity(owner, identity)) return;
    if (frameKind === 'minigame') {
      await disposeGameFrame();
      if (sameIdentity(owner, identity) && (closed || ownershipLost)) resetFrame();
    }
    renderDetails();
  })().finally(() => { if (retirement === current) retirement = null; });
  return current.promise;
}
function storageFailure(error) {
  storageProblem = error; automaticBlocked = true;
  notice(error.code === 'STORAGE_CONFLICT' ? 'Storage 与其他预览冲突。当前页面与未保存快照已保留，请导出或明确放弃本地修改。' : error.message);
  syncControls();
}
function validStorage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('Storage 快照必须是 JSON 对象。', 'INVALID_STORAGE');
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > 1024 * 1024) throw new ApiError('Storage 超过 1 MiB，未提交。', 'STORAGE_TOO_LARGE');
  return JSON.parse(encoded);
}
function downloadStorage(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
    link.href = url; link.download = filename; document.body.append(link); link.click();
  } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
}
async function checkedOutcome(outcome, request) {
  const result = outcome.result;
  let stale = result?.identity && Object.hasOwn(outcome, 'currentIdentity') && !sameIdentity(result.identity, outcome.currentIdentity);
  if (result?.state && !result.closed) {
    const current = await api(endpoint('state', request.previewId));
    stale ||= current.serverEpoch !== result.state.serverEpoch || current.projectId !== result.state.projectId || current.leaseEpoch !== result.state.leaseEpoch;
  }
  if (stale) { uncertainOperation = null; loseOwnership(); throw new ApiError('此前操作已完成，但预览已再次变更。不会应用旧响应或抢回租约。', 'STALE_FRAME'); }
  return result;
}
async function operationRequest(name, body, userAction, resolveOutcome = true) {
  const id = body.previewId;
  try { return await api(endpoint(name, id), body, userAction); }
  catch (first) {
    if (!first.uncertain) throw first;
    try { return await api(endpoint(name, id), body, userAction); }
    catch (second) {
      let committed = first.details?.committed === true || second.details?.committed === true;
      if (!second.uncertain && !['TRANSITION_OUTCOME_UNKNOWN', 'STALE_FRAME', 'PREVIEW_CONTEXT_NOT_FOUND'].includes(second.code)) throw second;
      if (resolveOutcome) {
        const outcome = await api(endpoint('operations/' + encodeURIComponent(body.operationId), id)).catch(() => null);
        committed ||= outcome?.committed === true;
        if (outcome?.status === 'committed' && outcome.result) {
          return checkedOutcome(outcome, body);
        }
      }
      if (committed) throw new ApiError('数据已经提交，页面交接尚待恢复。请确认操作结果；不会重复提交本地快照。', 'PREVIEW_RECOVERING', { committed: true, operationId: body.operationId }, true);
      throw new ApiError('操作响应丢失，尚不能确定是否提交。请重新确认操作结果；当前快照没有被丢弃。', 'OUTCOME_UNKNOWN', null, true);
    }
  }
}
function enqueueStorage(value) {
  const owner = identity;
  storageWrites = storageWrites.then(async () => {
    if (!sameIdentity(owner, identity) || (storageProblem && storageProblem.code !== 'STORAGE_FLUSH_TIMEOUT') || uncertainOperation || pendingDocument || ownershipLost || closed) return;
    const encoded = JSON.stringify(value);
    if (encoded === acknowledgedStorage) return;
    const body = { ...owner, operationId: uid('write'), baseRevision: ackRevision, data: value, ...(quiescing ? { drain: true } : {}) };
    const accept = (result) => {
      if (!sameIdentity(owner, identity)) return;
      if (!Number.isSafeInteger(result.committedRevision)) throw new ApiError('Storage 确认缺少 revision。', 'OUTCOME_UNKNOWN', null, true);
      ackRevision = result.committedRevision; acknowledgedStorage = encoded;
      if (storageProblem?.code === 'STORAGE_FLUSH_TIMEOUT') {
        storageProblem = null;
        notice('之前的刷新未完成；当前页面已恢复，后续 Storage 修改已保存。可手动重试刷新。');
        renderDetails();
      }
      reportRecovery();
    };
    try { accept(await operationRequest('storage', body)); }
    catch (error) {
      if (error.uncertain) uncertainOperation = { name: 'storage', body, accept };
      storageFailure(error);
    }
  });
}
function quiesceCurrent() {
  if (!identity || !ready || !started) return Promise.resolve(storage);
  const requestId = uid('quiesce');
  const owner = identity;
  quiescing = true;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      storageFlushes.delete(requestId);
      reject(new ApiError('页面未响应 Storage 同步；当前页面没有被替换。', 'STORAGE_FLUSH_TIMEOUT'));
    }, 2000);
    storageFlushes.set(requestId, { owner, source: frame.contentWindow, timer, resolve, reject });
    post({ type: 'quiesce-storage', requestId });
  });
}
function resumeCurrent() {
  if (identity && quiescing) post({ type: 'resume-storage' });
  quiescing = false;
}
function renderPreviewStatus() {
  const build = state?.build;
  const needsRecovery = !!storageProblem || !!uncertainOperation || !!pendingDocument || ownershipLost;
  let status = !connected || needsRecovery ? 'error' : build?.status === 'error' ? 'error' : build?.status === 'building' ? 'building' : runtimeStatus.status;
  let message = !previewId ? '请在聊天中让 Agent 打开工程' : bindingRetired ? '工程已切换，此窗口仅保留旧工程快照'
    : closed ? '预览已关闭，请在聊天中继续'
    : !connected ? '连接中断，正在重连' : needsRecovery ? '预览需要处理，请在聊天中让 Agent 继续'
    : build?.status === 'error' ? '构建未通过，原页面保持不变；详情可在聊天中查看'
    : status === 'building' ? '正在构建' : status === 'starting' ? '正在启动预览'
    : status === 'error' ? '预览运行异常，请在聊天中查看原因'
    : isGame() && gameState?.paused ? '小游戏已暂停，可在聊天中继续'
    : status === 'limited' || build?.warnings?.length || storageWarnings.length ? '部分能力受限，详情可在聊天中查看'
    : status === 'rendered' ? '' : '等待预览';
  if (closed && !needsRecovery) status = 'idle';
  $('preview-status').textContent = message;
  $('preview-status').dataset.status = status;
  $('preview-status').hidden = !message;
}
function renderDetails() {
  const project = state?.activeProject || state?.projects?.find((item) => item.id === state?.projectId);
  $('project-name').textContent = project?.name || '微信小程序开发者';
  $('project-name').title = $('project-name').textContent;
  $('project-kind-label').textContent = project ? isGame() ? '小游戏 · 本地' : '小程序 · 本地' : '本地预览';
  renderPreviewStatus(); syncControls(); sizeDevice();
}
async function mountFrame(result, deviceId, layout = layoutForBuild(deviceId)) {
  if (!result.identity || result.identity.previewId !== previewId || result.identity.clientId !== clientId
    || !result.storage || !Number.isSafeInteger(result.storage.revision)) throw new ApiError('交接响应身份或 Storage 无效。', 'OUTCOME_UNKNOWN', null, true);
  if (closed || bindingRetired || result.identity.serverEpoch !== state?.serverEpoch || result.identity.projectId !== state?.projectId) throw new ApiError('已确认页面不再属于当前预览，未加载旧文档。', 'STALE_FRAME');
  const pending = { result, deviceId, layout };
  pendingDocument = pending;
  // The new lease is already committed. If document transfer fails, the old DOM
  // may stay visible but can never resume writing under its obsolete identity.
  ownershipLost = true;
  const snapshot = validStorage(result.storage.data);
  if (state) { state.lease = result.identity; state.leaseEpoch = result.identity.leaseEpoch; }
  const assertCurrent = () => {
    if (pendingDocument !== pending || closed || pendingClosed || bindingRetired || state?.serverEpoch !== result.identity.serverEpoch
      || state?.projectId !== result.identity.projectId || state?.leaseEpoch !== result.identity.leaseEpoch) throw new ApiError('文档加载期间预览归属已变化，旧文档没有重新挂载。', 'STALE_FRAME');
  };
  const query = new URLSearchParams(Object.fromEntries(['instanceId', 'buildId', 'leaseEpoch', 'serverEpoch', 'clientId'].map((key) => [key, String(result.identity[key])])));
  let documentResult;
  try {
    documentResult = await api(endpoint('document', result.identity.previewId) + '?' + query);
    assertCurrent();
    if (!sameIdentity(documentResult.identity, result.identity) || typeof documentResult.html !== 'string' || documentResult.html.length > 160 * 1024 * 1024) throw new ApiError('预览文档身份或大小无效。', 'INVALID_DOCUMENT');
  } catch (error) {
    if (['STALE_FRAME', 'PREVIEW_CONTEXT_NOT_FOUND', 'PROJECT_ACCESS_REQUIRED', 'PROJECT_ACCESS_CHANGED', 'PROJECT_NOT_FOUND', 'PROJECT_NOT_DIRECTORY', 'PROJECT_PATH_FORBIDDEN'].includes(error.code)) {
      pendingDocument = null;
      const latest = await api(endpoint('state', result.identity.previewId)).catch(() => null);
      if (latest) applyState(latest);
      if (error.code === 'PREVIEW_CONTEXT_NOT_FOUND') markClosed();
      storageProblem = new ApiError('已确认页面的租约或工程身份已失效。保留本地快照供导出；请在聊天中选择其他预览或明确接管，不会自动抢回。', error.code);
      notice(storageProblem.message); syncControls(); throw storageProblem;
    }
    automaticBlocked = true; storageProblem = new ApiError('新页面交接已确认，但文档加载失败。旧页面不可再写入；请重新加载已确认页面。' + error.message, 'DOCUMENT_LOAD_FAILED');
    notice(storageProblem.message); syncControls(); throw storageProblem;
  }
  const bytes = new TextEncoder().encode(documentResult.html);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 16384) binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
  const documentUrl = 'data:text/html;base64,' + btoa(binary);
  await disposeGameFrame();
  assertCurrent();
  resetFrame();
  const replacement = frame.cloneNode(false); replacement.removeAttribute('src'); frame.replaceWith(replacement); frame = replacement;
  identity = result.identity; storage = snapshot; ackRevision = result.storage.revision; acknowledgedStorage = JSON.stringify(storage);
  frameKind = layout.projectKind; frameLayout = layout;
  frame.title = isGame() ? '微信小游戏 H5 预览' : '微信小程序 H5 预览';
  storageWarnings = Array.isArray(result.warnings) ? result.warnings.slice(0, 20).filter((item) => item && typeof item.message === 'string') : [];
  storageProblem = null; uncertainOperation = null; pendingDocument = null; reconnectRequired = false; automaticBlocked = false; ownershipLost = false; retirementIncomplete = false;
  if (state) { state.lease = identity; state.leaseEpoch = identity.leaseEpoch; state.deviceId = deviceId; }
  loadedKey = identity.projectId + '/' + identity.buildId + '/' + deviceId;
  // Only the latest confirmed context snapshot can carry a pre-attach target
  // across a lease change; late events from the old lease cannot navigate it.
  const carry = state?.command;
  if (!isGame() && carry?.type === 'navigate' && carry.seq > commandSeq && (!carry.projectId || carry.projectId === identity.projectId)
    && (!carry.serverEpoch || carry.serverEpoch === identity.serverEpoch) && (!carry.buildId || carry.buildId === identity.buildId)) {
    requestedRoute = state.requestedRoute || carry.url;
    commandSeq = carry.seq;
  }
  if (pendingCommand?.leaseEpoch !== undefined && pendingCommand.leaseEpoch !== identity.leaseEpoch) pendingCommand = null;
  if (pendingCommand?.type === 'reload' && pendingCommand.buildId === identity.buildId) { commandSeq = Math.max(commandSeq, pendingCommand.seq); pendingCommand = null; }
  if (state?.command?.type === 'reload' && state.command.buildId === identity.buildId) commandSeq = Math.max(commandSeq, state.command.seq);
  frame.hidden = false; frame.setAttribute('aria-busy', 'true'); runtimeStatus = { status: 'starting', details: [] };
  setEmpty('正在启动预览', '正在加载页面与运行环境…'); notice('');
  const owner = identity;
  frame.src = documentUrl;
  startupTimer = setTimeout(() => { if (sameIdentity(owner, identity) && !started) startupFailure('预览未能完成启动，请在聊天中查看原因后刷新。'); }, 10000);
  renderDetails();
}
function startupFailure(message) {
  clearTimeout(startupTimer); startupTimer = null; automaticBlocked = true;
  failedStartupBuild = identity?.buildId || '';
  runtimeStatus = { status: 'error', details: [{ code: 'startup', message }] };
  frame.setAttribute('aria-busy', 'false'); setEmpty('预览启动失败', message); notice(message); renderDetails();
}
async function transitionFrame({ takeover = false, discard = false } = {}) {
  if (!state || state.build?.status !== 'ok' || closed) return;
  if (uncertainOperation || pendingDocument) throw new ApiError('请先确认上一次操作或重新加载已确认页面。', 'OUTCOME_UNKNOWN');
  if (state.lease && !identity && !takeover) { showOtherOwner(); return; }
  const oldIdentity = identity;
  const deviceId = selectedDevice().id;
  const action = takeover ? 'takeover' : oldIdentity ? 'reload' : 'attach';
  let finalStorage = storage;
  mutationPending = true;
  try {
    if (oldIdentity && !takeover) finalStorage = await quiesceCurrent();
    await storageWrites;
    if (uncertainOperation) throw new ApiError('Storage 写入结果尚未确定，请先确认。', 'OUTCOME_UNKNOWN', null, true);
    if (!discard && !takeover && storageProblem?.code === 'STORAGE_CONFLICT') throw storageProblem;
    storage = validStorage(finalStorage);
    reportRecovery();
    const changed = !!oldIdentity && !discard && !takeover && dirty();
    const nextLayout = layoutForBuild(deviceId);
    const body = { action, serverEpoch: state.serverEpoch, previewId, projectId: state.projectId, expectedLeaseEpoch: state.leaseEpoch,
      operationId: uid('frame'), next: { buildId: state.build.buildId, clientId, instanceId: uid('instance') },
      ...(oldIdentity && !takeover ? { previous: oldIdentity } : {}), dirty: changed,
      ...(changed ? { baseRevision: ackRevision, data: storage } : {}) };
    const accept = async (result) => {
      const expected = { ...body.next, previewId: body.previewId, projectId: body.projectId, serverEpoch: body.serverEpoch, leaseEpoch: body.expectedLeaseEpoch + 1 };
      if (!sameIdentity(result.identity, expected) || result.operationId !== body.operationId) throw new ApiError('交接响应与请求身份不一致。', 'OUTCOME_UNKNOWN', null, true);
      await mountFrame(result, deviceId, nextLayout);
    };
    try { await accept(await operationRequest('frame', body)); }
    catch (error) { if (error.uncertain) uncertainOperation = { name: 'frame', body, accept }; throw error; }

  } catch (error) {
    automaticBlocked = true;
    if (!error.uncertain && !pendingDocument && !ownershipLost) resumeCurrent();
    storageFailure(error); throw error;
  } finally { mutationPending = false; if (pendingClosed) markClosed(); syncControls(); }
}
function showOtherOwner() {
  automaticBlocked = true; runtimeStatus = { status: 'waiting', details: [] };
  setEmpty('预览已在另一窗口打开', '请在聊天中选择其他预览，或明确请求接管。不会自动带入其他窗口的未保存数据。'); renderDetails();
}
function markClosed() {
  pendingClosed = false; closed = true; automaticBlocked = true;
  pendingDocument = null;
  connectionStatus('已关闭', 'idle');
  if (identity) { ownershipLost = true; retireCurrentFrame(); }
  runtimeStatus = { status: 'idle', details: [] };
  setEmpty('预览已关闭', '请在聊天中让 Agent 选择或打开工程；此链接不会自动新建预览。');
  if (dirty()) storageFailure(new ApiError('预览已关闭。本地未确认数据仍可导出，但不能再提交。', 'PREVIEW_CONTEXT_NOT_FOUND'));
  renderDetails();
}
function schedule(work) {
  const next = lifecycle.then(async () => { busy = true; syncControls(); try { await retirement?.promise; return await work(); } finally { busy = false; renderDetails(); queueMicrotask(() => { runCommand(state?.command); maybeLoad(); }); } });
  lifecycle = next.catch((error) => { notice(error.message); });
  return next;
}
function maybeLoad() {
  if (automaticBlocked && failedStartupBuild && state?.build?.status === 'ok' && state.build.buildId !== failedStartupBuild
    && !ownershipLost && !closed && !storageProblem && !uncertainOperation && !pendingDocument) {
    automaticBlocked = false; failedStartupBuild = '';
  }
  if (!state || !recoveryChannel || closed || automaticBlocked || uncertainOperation || pendingDocument || busy || state.build?.status !== 'ok') return;
  const key = state.projectId + '/' + state.build.buildId + '/' + selectedDevice().id;
  if (loadedKey !== key && pendingLoadKey !== key) {
    pendingLoadKey = key;
    schedule(() => transitionFrame()).catch(() => {}).finally(() => {
      if (pendingLoadKey === key) pendingLoadKey = '';
      maybeLoad();
    });
  }
}
function applyState(next) {
  if (!next || next.previewId !== previewId || closed || bindingRetired) return;
  if (state && next.serverEpoch === state.serverEpoch && next.leaseEpoch < state.leaseEpoch) return;
  if (state && next.serverEpoch === state.serverEpoch && next.projectId === state.projectId
    && Number.isFinite(next.build?.generation) && (next.build.generation < (state.build?.generation || 0)
      || next.build.generation === state.build?.generation && ['ok', 'error'].includes(state.build.status) && ['idle', 'building'].includes(next.build.status))) next = { ...next, build: state.build };
  if (state && next.projectId !== state.projectId && (identity || started || pendingDocument || uncertainOperation || retirementIncomplete || Object.keys(storage).length)) {
    bindingRetired = true; ownershipLost = true; automaticBlocked = true;
    ++selectionGeneration; pendingDocument = null;
    retireCurrentFrame();
    storageFailure(new ApiError('预览已切换到另一工程。此窗口保留原工程标题与本地快照，聊天中仍可导出；请让 Agent 打开新工程预览。', 'PROJECT_CONTEXT_CHANGED'));
    setEmpty('工程已切换', '此窗口只保留旧工程快照，不会把它写入新工程。请在聊天中继续。');
    renderDetails(); return;
  }
  if (state && next.serverEpoch !== state.serverEpoch && (identity || pendingDocument || uncertainOperation)) {
    state = next; ownershipLost = true; automaticBlocked = true;
    pendingDocument = null; uncertainOperation = null; reconnectRequired = false;
    retireCurrentFrame();
    storageFailure(new ApiError('预览服务已重启，旧页面身份失效，未确认操作不能继续重放。请先导出本地快照，再在聊天中明确重新连接。', 'SERVER_RESTARTED'));
    setEmpty('预览服务已重启', '旧页面不能继续提交，请在聊天中让 Agent 导出快照并恢复预览。');
    registerRecovery().catch((error) => notice(error.message));
    return;
  }
  if (identity && !sameIdentity(identity, next.lease && { ...next.lease, previewId, projectId: next.projectId, serverEpoch: next.serverEpoch }) && !mutationPending && !ownershipLost) {
    loseOwnership();
  }
  const changedBinding = state && (state.projectId !== next.projectId || state.serverEpoch !== next.serverEpoch);
  if (state?.projectId !== next.projectId) route = '';
  state = next;
  if (changedBinding) registerRecovery().catch((error) => notice(error.message));
  if (!identity && !busy) sizeDevice();
  if (!route) route = next.route || '';
  runtimeStatus = identity ? runtimeStatus : next.preview || next.runtime || runtimeStatus;
  if (next.build?.status === 'error') { automaticBlocked = !!storageProblem; if (!identity) setEmpty('构建未通过', '修复诊断后会重新构建。'); }
  if (!identity && next.lease) showOtherOwner();
  renderDetails(); runCommand(next.command); maybeLoad();
}
function loseOwnership() {
  ownershipLost = true; automaticBlocked = true;
  if (identity) retireCurrentFrame();
  storageFailure(new ApiError('此预览已被另一个窗口接管。当前未保存快照只可导出，不会自动抢回。', 'STALE_FRAME'));
  setEmpty('预览已被接管', '当前页面已停止提交，请在聊天中请求导出本地快照或选择其他预览。');
  syncControls();
}
function runCommand(command) {
  command ||= pendingCommand;
  if (!command || !identity || ownershipLost || closed) return;
  if ((command.previewId && command.previewId !== previewId) || (command.projectId && command.projectId !== identity.projectId)
    || (command.serverEpoch && command.serverEpoch !== identity.serverEpoch) || (command.leaseEpoch !== undefined && command.leaseEpoch !== identity.leaseEpoch)
    || (command.buildId && command.buildId !== identity.buildId)) return;
  if (command.seq > commandSeq && (!pendingCommand || command.seq > pendingCommand.seq)) { pendingCommand = command; if (command.type === 'navigate') requestedRoute = command.url; }
  if (!pendingCommand || (!started && pendingCommand.type !== 'reload') || busy || storageProblem || uncertainOperation || pendingDocument) return;
  command = pendingCommand; pendingCommand = null; commandSeq = command.seq;
  if (command.type === 'navigate' && !isGame()) post({ type: 'navigate', url: command.url });
  if (command.type === 'game-control' && isGame()) post({ type: 'game-control', action: command.url, requestId: 'command-' + command.seq });
  if (command.type === 'reload') {
    if (state?.build?.status !== 'ok') return;
    automaticBlocked = false; schedule(() => transitionFrame()).catch(() => {});
  }
}
function listen(events, id, epoch, generation, channel) {
  const current = () => channel === recoveryChannel && generation === selectionGeneration && id === previewId && !closed && !bindingRetired;
  const receive = (callback) => (event) => {
    if (!current()) return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.previewId !== id || (data.serverEpoch !== (state?.serverEpoch || epoch) && callback !== applyState)) return;
    callback(data);
  };
  events.addEventListener('open', () => {
    if (!current()) return;
    connectionStatus('已连接', 'ok');
    api(endpoint('state', id)).then(async (next) => {
      if (!current()) return;
      applyState(next);
      if (!current()) return;
      await registerRecovery();
      if (current()) { renderDetails(); maybeLoad(); }
    }).catch((error) => { if (error.code === 'PREVIEW_CONTEXT_NOT_FOUND') markClosed(); });
  });
  events.addEventListener('error', () => {
    if (!current()) return;
    connectionStatus('连接中断 · 正在重连', 'error');
    if (connectionProbe) return;
    connectionProbe = api(endpoint('state', id)).then(async (next) => {
      if (!current()) return;
      applyState(next);
      if (current()) await registerRecovery();
    }).catch((error) => { if (error.code === 'PREVIEW_CONTEXT_NOT_FOUND') markClosed(); }).finally(() => { connectionProbe = null; });
  });
  events.addEventListener('state', receive(applyState));
  events.addEventListener('build', receive((data) => {
    if (data.projectId !== state?.projectId || (Number.isFinite(data.build?.generation) && data.build.generation < (state?.build?.generation || 0))) return;
    state = { ...state, build: data.build }; renderDetails(); maybeLoad();
  }));
  events.addEventListener('command', receive(runCommand));
  events.addEventListener('runtime', receive((data) => {
    if (!identity || ownershipLost || (data.buildId && data.buildId !== identity.buildId) || (data.leaseEpoch && data.leaseEpoch !== identity.leaseEpoch)) return;
    runtimeStatus = { status: data.status, details: data.details }; renderDetails();
  }));
  events.addEventListener('frame-active', receive((data) => {
    if (mutationPending || data.leaseEpoch <= (state?.leaseEpoch || 0)) return;
    state = { ...state, lease: data, leaseEpoch: data.leaseEpoch };
    if (identity && !sameIdentity(identity, data)) loseOwnership();
    else if (!identity) showOtherOwner();
  }));
  events.addEventListener('closed', receive(() => { if (mutationPending) pendingClosed = true; else markClosed(); }));
  events.addEventListener('storage-updated', receive((data) => { if (data.originPreviewId !== id && data.revision > ackRevision) notice('其他预览已更新此工程 Storage。当前运行内存保持不变，下一次写入可能需要处理冲突。'); }));

}
async function openCurrentPreview() {
  if (!previewId) {
    setEmpty('等待预览工程', '请在聊天中让 Agent 打开要预览的小程序或小游戏。');
    renderDetails(); return;
  }
  const generation = ++selectionGeneration;
  try {
    const next = await api(endpoint('state'));
    if (generation !== selectionGeneration) return;
    state = next; sizeDevice();
    await registerRecovery();
    if (generation !== selectionGeneration || closed || bindingRetired) return;
    renderDetails();
    if (state.lease) showOtherOwner();
    else if (state.build?.status === 'ok') await transitionFrame();
  } catch (error) {
    if (error.code === 'PREVIEW_CONTEXT_NOT_FOUND') markClosed();
    else { connected = false; setEmpty('无法打开预览', '请在聊天中让 Agent 检查工程与预览状态。'); notice(error.message); renderDetails(); }
  }
}
async function drainCurrent(name, targetProjectId) {
  if (uncertainOperation || pendingDocument) throw new ApiError('请先确认未完成操作或重新加载已确认页面。', 'OUTCOME_UNKNOWN');
  const owner = identity;
  mutationPending = true;
  try {
    const finalStorage = owner ? await quiesceCurrent() : storage;
    await storageWrites;
    if (uncertainOperation) throw new ApiError('Storage 写入结果尚未确定。', 'OUTCOME_UNKNOWN', null, true);
    if (storageProblem?.code === 'STORAGE_CONFLICT') throw storageProblem;
    storage = validStorage(finalStorage);
    const changed = !!owner && dirty();
    const body = { ...(owner || { previewId, projectId: state.projectId, serverEpoch: state.serverEpoch, expectedLeaseEpoch: state.leaseEpoch }), operationId: uid(name), dirty: changed,
      ...(changed ? { baseRevision: ackRevision, data: storage } : {}), ...(targetProjectId ? { targetProjectId } : {}) };
    const accept = async (result) => {
      if (result.storage) { storage = validStorage(result.storage.data); ackRevision = result.storage.revision; acknowledgedStorage = JSON.stringify(storage); }
      await disposeGameFrame();
      resetFrame(); storageProblem = null; uncertainOperation = null; automaticBlocked = false;
      if (result.closed) { pendingClosed = false; closed = true; markClosed(); }
      else if (result.state) { state = result.state; route = result.state.route || ''; }
      else if (result.previewId) { state = result; route = result.route || ''; }
    };
    try { const result = await operationRequest(name, body); await accept(result); return result; }
    catch (error) { if (error.uncertain) uncertainOperation = { name, body, accept }; throw error; }
  } catch (error) { if (!error.uncertain && !ownershipLost) resumeCurrent(); storageFailure(error); throw error; }
  finally { mutationPending = false; if (pendingClosed) markClosed(); }
}
function connectionStatus(_message, status) {
  connected = status === 'ok'; renderPreviewStatus(); syncControls();
}
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== 'wx-sim' || event.origin !== 'null') return;
  if (data.type === 'game-disposed') {
    const pending = gameDisposals.get(data.requestId);
    if (pending && event.source === pending.source && sameIdentity(data, pending.owner)) pending.finish(true);
    return;
  }
  if (data.type === 'storage-flushed') {
    const pending = storageFlushes.get(data.requestId);
    if (!pending || event.source !== pending.source || data.projectId !== pending.owner.projectId || data.instanceId !== pending.owner.instanceId) return;
    if (frameKind === 'minigame' && !sameIdentity(data, pending.owner)) return;
    try { const value = validStorage(data.storage ?? data.data); clearTimeout(pending.timer); storageFlushes.delete(data.requestId); pending.resolve(value); } catch (error) { pending.reject(error); }
    return;
  }
  if (!identity || event.source !== frame.contentWindow || data.projectId !== identity.projectId || data.instanceId !== identity.instanceId || closed || ownershipLost) return;
  if (frameKind === 'minigame' && !sameIdentity(data, identity)) return;
  if (data.type === 'ready' && !ready) {
    ready = true; post({ type: 'init', storage, ...(!isGame() ? { route: requestedRoute || route || state?.route || state?.command?.url } : {}), device: frameLayout?.deviceId || selectedDevice().id, visible: !document.hidden });
  } else if (data.type === 'started' && ready && !started) {
    clearTimeout(startupTimer); started = true; frame.setAttribute('aria-busy', 'false'); $('empty').hidden = true; syncControls(); runCommand(state?.command);
  } else if (data.type === 'game-state' && isGame() && typeof data.paused === 'boolean') {
    gameState = { paused: data.paused, reason: String(data.reason || '').slice(0, 100), ...(Number.isFinite(data.framesPerSecond) ? { framesPerSecond: Math.max(1, Math.min(60, data.framesPerSecond)) } : {}) };
    api(endpoint('game-state'), { ...identity, ...gameState }).catch(() => {}); syncControls();
  } else if (data.type === 'storage') {
    try { storage = validStorage(data.data); reportRecovery(); enqueueStorage(storage); } catch (error) { storageFailure(error); }
  } else if (data.type === 'preview-status' && ['rendered', 'limited', 'error'].includes(data.status) && Array.isArray(data.details)) {
    runtimeStatus = { status: data.status, details: data.details.slice(0, 100).filter((item) => item && typeof item.message === 'string').map((item) => ({ code: String(item.code || 'runtime').slice(0, 100), message: item.message.slice(0, 2000), ...(typeof item.route === 'string' ? { route: item.route } : {}) })) };
    api(endpoint('preview-status'), { ...identity, ...runtimeStatus }).catch(() => {}); renderDetails();
  } else if (data.type === 'startup-error') startupFailure('预览启动失败，请在聊天中查看原因后刷新。');
  else if (data.type === 'log' && Array.isArray(data.entries)) api(endpoint('logs'), { ...identity, entries: data.entries.slice(0, 100).filter((item) => item && typeof item === 'object').map((item) => ({
    level: ['log', 'info', 'warn', 'error', 'debug'].includes(item.level) ? item.level : 'log',
    message: String(item.message || '').slice(0, 4000),
    source: item.source === 'startup' ? 'runtime' : ['console', 'runtime', 'build'].includes(item.source) ? item.source : 'console',
    ...(typeof item.route === 'string' ? { route: item.route.slice(0, 2048) } : {}),
  })) }).catch(() => {});
  else if (data.type === 'route' && !isGame() && typeof data.route === 'string' && !quiescing) {
    if (requestedRoute && data.route.replace(/^\//, '') !== requestedRoute.replace(/^\//, '')) return;
    route = data.route.slice(0, 2048); requestedRoute = '';
    api(endpoint('route'), { ...identity, route, title: typeof data.title === 'string' ? data.title : '' }).catch(() => {});
  }
});
async function refreshPreview() {
  if (!previewId || !state || closed || busy || rebuildBusy || ownershipLost || uncertainOperation || pendingDocument || storageProblem) return;
  rebuildBusy = true;
  return schedule(async () => {
    const current = { previewId, projectId: state.projectId, serverEpoch: state.serverEpoch };
    const next = await api(endpoint('rebuild'), { previewId, serverEpoch: state.serverEpoch });
    if (closed || current.previewId !== previewId || current.projectId !== state?.projectId || current.serverEpoch !== state?.serverEpoch || ownershipLost) throw new ApiError('刷新期间预览归属已变化，未替换页面。', 'STALE_FRAME');
    applyState(next);
    if (state.build?.status !== 'ok') {
      notice('构建未通过，原页面与数据保持不变；请在聊天中查看具体错误。');
      return;
    }
    automaticBlocked = false;
    await transitionFrame();
  }).catch((error) => notice(error.message)).finally(() => { rebuildBusy = false; syncControls(); });
}
async function retryRecovery(revalidate) {
  if (reconnectRequired) {
    if (!window.confirm('交接已提交，但旧构建不可用。请先导出本地快照；确定从服务端最新 Storage 连接最新构建吗？')) throw new ApiError('已取消连接最新构建。', 'CANCELED');
    revalidate();
    const latest = await api(endpoint('state'));
    revalidate();
    if (latest.serverEpoch !== state.serverEpoch || latest.lease || latest.reconnectTarget?.clientId !== clientId) throw new ApiError('恢复目标已改变，请重新选择预览或明确接管。', 'STALE_FRAME');
    requireReadyBuild(latest);
    await disposeGameFrame(); revalidate();
    state = latest; reconnectRequired = false; resetFrame(); ownershipLost = false; automaticBlocked = false;
    await transitionFrame(); return;
  }
  if (pendingDocument) { const pending = pendingDocument; await mountFrame(pending.result, pending.deviceId, pending.layout); return; }
  const pending = uncertainOperation;
  if (!pending) {
    if (storageProblem?.code === 'STORAGE_FLUSH_TIMEOUT' && identity && !ownershipLost && !closed) {
      requireReadyBuild();
      storageProblem = null; automaticBlocked = false; await transitionFrame(); return;
    }
    if (!connected && !closed) {
      const previousEpoch = state.serverEpoch;
      const latest = await api(endpoint('state')); applyState(latest);
      if (latest.serverEpoch !== previousEpoch || !latest.lease || ownershipLost) throw new ApiError('请在聊天中明确重新连接或接管预览；不会自动提交旧快照。', 'RECOVERY_NOT_AVAILABLE');
      openRecoveryEvents(recoveryChannel); return;
    }
    throw new ApiError('当前状态没有可重试的同一操作，请在聊天中重新读取预览状态。', 'RECOVERY_NOT_AVAILABLE');
  }
  let result;
  const outcome = await api(endpoint('operations/' + pending.body.operationId, pending.body.previewId));
  if (outcome.status === 'committed' && outcome.result) {
    result = await checkedOutcome(outcome, pending.body);
  }
  else if (outcome.status === 'recovering') {
    const recovery = await api(endpoint('operations/' + pending.body.operationId + '/recover', pending.body.previewId), { serverEpoch: pending.body.serverEpoch, previewId: pending.body.previewId, operationId: pending.body.operationId, clientId });
    if (recovery.status === 'reconnect_required') {
      if (recovery.state?.previewId !== pending.body.previewId || recovery.state.serverEpoch !== pending.body.serverEpoch || recovery.state.reconnectTarget?.clientId !== clientId) throw new ApiError('恢复响应不属于当前窗口。', 'STALE_FRAME');
      state = recovery.state; uncertainOperation = null; ownershipLost = true; automaticBlocked = true; reconnectRequired = true;
      storageFailure(new ApiError('交接已提交，但目标构建无法恢复。本地快照可导出；请明确连接最新构建，不会自动重放旧快照。', 'RECONNECT_REQUIRED'));
      return;
    }
    const recovered = await api(endpoint('operations/' + pending.body.operationId, pending.body.previewId));
    if (recovered.status !== 'committed' || !recovered.result) throw new ApiError('恢复尚未完成，页面和快照继续保留。', 'OUTCOME_UNKNOWN');
    result = await checkedOutcome(recovered, pending.body);
  } else if (!outcome.committed && !outcome.closed) result = await operationRequest(pending.name, pending.body, pending.userAction);
  else {
    uncertainOperation = null; automaticBlocked = true; ownershipLost = true;
    if (outcome.closed) markClosed();
    else {
      try { applyState(await api(endpoint('state'))); }
      catch (error) { if (error.code === 'PREVIEW_CONTEXT_NOT_FOUND') markClosed(); }
    }
    const expired = new ApiError('原数据已提交，但精确响应已过期。请先在聊天中导出快照，再明确接管或关闭；不会自动重放、抢回租约或复活已关闭预览。', 'TRANSITION_OUTCOME_UNKNOWN', { committed: true, operationId: pending.body.operationId });
    storageFailure(expired);
    throw expired;
  }
  await pending.accept(result); uncertainOperation = null; storageProblem = null; automaticBlocked = false; resumeCurrent(); renderDetails();
}
$('refresh-preview').addEventListener('click', refreshPreview);
function sizeDevice() {
  const layout = displayedLayout(), device = devices.get(layout.deviceId), landscape = layout.landscape;
  const screenWidth = landscape ? device.height : device.width, screenHeight = landscape ? device.width : device.height;
  const width = screenWidth + 16, height = screenHeight + 16;
  const scale = Math.min(1, Math.max(1, $('device-stage').clientWidth) / width, Math.max(1, $('device-stage').clientHeight) / height);
  const phone = $('phone-frame'); phone.dataset.legacy = String(device.safeAreaBottom === 0); phone.style.width = width + 'px'; phone.style.height = height + 'px'; phone.style.transform = 'scale(' + scale + ')';
  phone.dataset.landscape = String(landscape); phone.dataset.game = String(isGame());
  phone.querySelector('.phone-notch').hidden = !device.hasNotch;
  const screen = phone.querySelector('.phone-screen'); screen.style.width = screenWidth + 'px'; screen.style.height = screenHeight + 'px';
  $('device-wrap').style.width = Math.round(width * scale) + 'px'; $('device-wrap').style.height = Math.round(height * scale) + 'px';
}
window.addEventListener('beforeunload', (event) => { if (dirty() || retirementIncomplete || uncertainOperation || pendingDocument || busy) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (frameKind === 'minigame' && identity && !ownershipLost && !closed) post({ type: 'visibility', visible: !document.hidden }); });
window.addEventListener('pagehide', () => { if (frameKind === 'minigame') post({ type: 'dispose', requestId: uid('pagehide') }); clearTimeout(startupTimer); recoveryEvents?.close(); });
new ResizeObserver(sizeDevice).observe($('device-stage')); sizeDevice();
schedule(openCurrentPreview).catch((error) => notice(error.message));
