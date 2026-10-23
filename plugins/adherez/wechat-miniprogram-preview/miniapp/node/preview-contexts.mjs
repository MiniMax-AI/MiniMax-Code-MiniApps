import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_STATE_BYTES = 512 * 1024;
const MAX_PREVIEWS = 8;
const MAX_PROJECTS = 100;
const MAX_LOGS = 400;
const MAX_OPERATIONS = 64;
const MAX_OPERATION_BYTES = 4 * 1024 * 1024;
const MAX_TOMBSTONE_BYTES = 4 * 1024 * 1024;
const DEVICE_IDS = new Set(['390x844', '375x667', '430x932']);
const LOG_LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug']);

export class PreviewError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'PreviewError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const clone = (value) => structuredClone(value);
const fail = (code, message, details) => { throw new PreviewError(code, message, details); };
const validId = (value) => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const validRoute = (value) => typeof value === 'string' && value.length <= 2048 && !/[\0\r\n]/.test(value);

async function readState(file, required = false) {
  let handle;
  try {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_STATE_BYTES) throw new Error('invalid state file');
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const current = await handle.stat();
    if (current.ino !== before.ino || current.dev !== before.dev) throw new Error('state file changed');
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_STATE_BYTES) throw new Error('oversized state');
    return JSON.parse(buffer.subarray(0, total).toString('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && !required) return null;
    throw new PreviewError('PREVIEW_STATE_INVALID', '预览记录无法读取，未覆盖已有数据。');
  } finally { await handle?.close(); }
}

function normalizeProject(record) {
  if (!record || !validId(record.id) || typeof record.path !== 'string' || !path.isAbsolute(record.path)
    || record.path.includes('\0') || typeof record.name !== 'string') fail('PREVIEW_STATE_INVALID', '工程记录无效。');
  if (record.projectKind !== undefined && !['miniprogram', 'minigame'].includes(record.projectKind)) fail('PREVIEW_STATE_INVALID', '工程类型无效。');
  return { id: record.id, path: record.path, name: record.name.slice(0, 200), projectKind: record.projectKind ?? 'miniprogram', addedAt: Number.isFinite(record.addedAt) ? record.addedAt : Date.now() };
}

function freshContext(descriptor) {
  return {
    ...descriptor, leaseEpoch: 0, lease: null, runtime: { status: 'waiting', details: [] },
    commandSeq: 0, command: null, requestedRoute: null, logs: [], logSeq: 0,
    subscribers: new Set(), pending: Promise.resolve(), operations: new Map(), receipts: new Map(), closed: false,
    recovering: null, reconnectTarget: null, gameState: null,
  };
}

/** Owns explicit project history and preview leases; legacy grants are unrelated. */
export async function createPreviewContexts(dataDir, { validateProject, maxPreviews = MAX_PREVIEWS,
  maxOperations = MAX_OPERATIONS, maxOperationBytes = MAX_OPERATION_BYTES, maxTombstones = 64 } = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const directory = await realpath(dataDir);
  const identity = await lstat(directory);
  if (!identity.isDirectory() || identity.isSymbolicLink()) fail('PREVIEW_STATE_INVALID', '预览数据目录无效。');
  const stateFile = path.join(directory, 'preview-state-v2.json');
  const serverEpoch = randomUUID();
  const projects = new Map();
  const contexts = new Map();
  const tombstones = new Map();
  let metadataQueue = Promise.resolve();
  let disposed = false;
  const assertDirectory = async () => {
    const now = await lstat(directory);
    if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== identity.dev || now.ino !== identity.ino || await realpath(dataDir) !== directory) fail('PREVIEW_STATE_INVALID', '预览数据目录已被替换。');
  };
  const serializeMetadata = (operation) => {
    const result = metadataQueue.then(async () => {
      if (disposed) fail('PREVIEW_STOPPING', '预览服务正在停止。');
      await assertDirectory();
      return operation();
    });
    metadataQueue = result.catch(() => undefined);
    return result;
  };
  const descriptor = (ctx) => ({
    previewId: ctx.previewId, projectId: ctx.projectId, route: ctx.route,
    deviceId: ctx.deviceId, createdAt: ctx.createdAt, updatedAt: ctx.updatedAt,
  });
  const persist = async (nextProjects = projects, nextContexts = contexts) => {
    const encoded = JSON.stringify({ schemaVersion: 2, projects: [...nextProjects.values()], previews: [...nextContexts.values()].filter((ctx) => !ctx.closed).map(descriptor) });
    if (Buffer.byteLength(encoded) > MAX_STATE_BYTES) fail('PREVIEW_CAPACITY_REACHED', '预览记录已达到容量上限。');
    const temporary = `${stateFile}.${randomUUID()}.tmp`;
    try {
      await assertDirectory();
      try {
        const target = await lstat(stateFile);
        if (!target.isFile() || target.isSymbolicLink()) fail('PREVIEW_STATE_INVALID', '预览记录不能是符号链接或目录。');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeFile(temporary, encoded, { flag: 'wx', mode: 0o600 });
      await assertDirectory();
      await rename(temporary, stateFile);
    } finally { await unlink(temporary).catch(() => undefined); }
  };

  const stored = await readState(stateFile);
  const legacy = stored ? null : await readState(path.join(directory, 'state.json'));
  const source = stored ?? legacy;
  if (stored && (stored.schemaVersion !== 2 || !Array.isArray(stored.projects) || !Array.isArray(stored.previews))) fail('PREVIEW_STATE_INVALID', '预览记录版本或结构不支持。');
  if (source) {
    if (!Array.isArray(source.projects) || source.projects.length > MAX_PROJECTS) fail('PREVIEW_STATE_INVALID', '工程记录数量或结构无效。');
    for (const input of source.projects) {
      const record = normalizeProject(input);
      try {
        if (validateProject) record.path = await validateProject(record.path);
        projects.set(record.id, record);
      } catch { /* Missing, unsafe, or substituted project roots do not restore. */ }
    }
    const previews = stored ? stored.previews : projects.has(legacy.activeId) ? [{ previewId: `pv_${randomUUID()}`, projectId: legacy.activeId, route: '', deviceId: '390x844', createdAt: Date.now(), updatedAt: Date.now() }] : [];
    if (previews.length > maxPreviews) fail('PREVIEW_CAPACITY_REACHED', '已保存的预览数量超过当前上限。');
    for (const input of previews) {
      if (!input || !validId(input.previewId) || !validId(input.projectId) || !validRoute(input.route ?? '') || !DEVICE_IDS.has(input.deviceId)) fail('PREVIEW_STATE_INVALID', '预览上下文记录无效。');
      if (!projects.has(input.projectId)) continue;
      if (contexts.has(input.previewId)) fail('PREVIEW_STATE_INVALID', '存在重复的预览标识。');
      contexts.set(input.previewId, freshContext({
        previewId: input.previewId, projectId: input.projectId, route: input.route ?? '', deviceId: input.deviceId,
        createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(), updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
      }));
    }
    // The v2 file itself is the commit marker; a restart never reimports legacy data.
    if (!stored) await persist();
  }

  const get = (previewId) => {
    if (!validId(previewId)) fail('INVALID_ARGUMENTS', 'preview_id 无效。');
    const ctx = contexts.get(previewId);
    if (!ctx || ctx.closed) fail('PREVIEW_CONTEXT_NOT_FOUND', '预览上下文不存在。');
    return ctx;
  };
  const summaries = () => [...contexts.values()].filter((ctx) => !ctx.closed).map((ctx) => ({
    ...descriptor(ctx), name: projects.get(ctx.projectId)?.name ?? '', projectKind: projects.get(ctx.projectId)?.projectKind ?? 'miniprogram', connected: ctx.subscribers.size > 0,
    surfacePath: `/preview?previewId=${encodeURIComponent(ctx.previewId)}`,
  }));
  const resolve = (previewId) => {
    if (previewId !== undefined) return get(previewId);
    const available = summaries();
    if (!available.length) fail('NO_PREVIEW_CONTEXT', '尚未打开预览。');
    if (available.length !== 1) fail('AMBIGUOUS_PREVIEW_CONTEXT', '存在多个预览，请传入 preview_id。', { previews: available });
    return get(available[0].previewId);
  };
  const emit = (ctx, event, data) => {
    const envelope = { commandSeq: ctx.commandSeq, leaseEpoch: ctx.leaseEpoch, ...(ctx.lease?.buildId ? { buildId: ctx.lease.buildId } : {}), ...data, previewId: ctx.previewId, projectId: ctx.projectId, serverEpoch };
    for (const subscriber of ctx.subscribers) {
      try { subscriber(event, clone(envelope)); } catch { ctx.subscribers.delete(subscriber); }
    }
  };
  const queue = (previewId, operation) => {
    const ctx = get(previewId);
    const result = ctx.pending.then(() => {
      if (disposed || ctx.closed) fail('PREVIEW_CONTEXT_NOT_FOUND', '预览已经关闭。');
      return operation(ctx);
    });
    ctx.pending = result.catch(() => undefined);
    return result;
  };
  const assertLease = (input) => {
    const ctx = get(input.previewId);
    if (ctx.recovering) fail('PREVIEW_RECOVERING', '交接已提交，预览正在等待受控恢复。', { committed: true, operationId: ctx.recovering.operationId });
    const lease = ctx.lease;
    if (input.serverEpoch !== serverEpoch || !lease || input.projectId !== ctx.projectId
      || input.clientId !== lease.clientId || input.instanceId !== lease.instanceId
      || input.buildId !== lease.buildId || input.leaseEpoch !== lease.leaseEpoch) fail('STALE_FRAME', '预览实例已失效，请重新打开。');
    return ctx;
  };
  const assertExpectedLease = (ctx, input) => {
    if (ctx.recovering) fail('PREVIEW_RECOVERING', '交接已提交，预览正在等待受控恢复。', { committed: true, operationId: ctx.recovering.operationId });
    if (input.serverEpoch !== serverEpoch || input.expectedLeaseEpoch !== ctx.leaseEpoch) fail('STALE_FRAME', '预览已被更新或接管。');
  };

  return {
    serverEpoch, get, resolve, queue, assertLease, assertExpectedLease, list: summaries,
    project: (projectId) => projects.get(projectId),
    projects: () => [...projects.values()].map(clone),
    async registerProject(input) {
      return serializeMetadata(async () => {
        const record = normalizeProject(input);
        const prior = projects.get(record.id);
        if (prior && (prior.path !== record.path || prior.projectKind !== record.projectKind)) fail('PROJECT_CHANGED', '工程标识不能重新绑定到其他目录或类型。');
        if (!projects.has(record.id) && projects.size >= MAX_PROJECTS) fail('PREVIEW_CAPACITY_REACHED', '工程数量已达到上限。');
        const next = new Map(projects); next.set(record.id, record);
        await persist(next); projects.set(record.id, record);
        return clone(record);
      });
    },
    async create(projectId, { route = '', deviceId = '390x844' } = {}) {
      return serializeMetadata(async () => {
        if (!projects.has(projectId)) fail('PROJECT_NOT_FOUND', '工程未登记。');
        if (contexts.size >= maxPreviews) fail('PREVIEW_CAPACITY_REACHED', '活动预览数量已达到上限，请先明确选择已有预览或关闭空闲预览。', { resource: 'preview_contexts', limit: maxPreviews, current: contexts.size });
        if (!validRoute(route) || !DEVICE_IDS.has(deviceId)) fail('INVALID_ARGUMENTS', '页面或设备参数无效。');
        const ctx = freshContext({ previewId: `pv_${randomUUID()}`, projectId, route, deviceId, createdAt: Date.now(), updatedAt: Date.now() });
        const next = new Map(contexts); next.set(ctx.previewId, ctx);
        await persist(projects, next); contexts.set(ctx.previewId, ctx);
        return ctx;
      });
    },
    async saveDescriptor(ctx, patch) {
      return serializeMetadata(async () => {
        if (get(ctx.previewId) !== ctx) fail('PREVIEW_CONTEXT_NOT_FOUND', '预览已经关闭。');
        if (patch.route !== undefined && !validRoute(patch.route)) fail('INVALID_ARGUMENTS', '页面地址无效。');
        if (patch.deviceId !== undefined && !DEVICE_IDS.has(patch.deviceId)) fail('INVALID_ARGUMENTS', '设备无效。');
        if (patch.projectId !== undefined && !projects.has(patch.projectId)) fail('PROJECT_NOT_FOUND', '工程未登记。');
        const nextDescriptor = { ...descriptor(ctx), ...patch, updatedAt: Date.now() };
        const next = new Map(contexts); next.set(ctx.previewId, { ...ctx, ...nextDescriptor });
        await persist(projects, next); Object.assign(ctx, nextDescriptor);
      });
    },
    async close(previewId, closure) {
      const ctx = get(previewId);
      return serializeMetadata(async () => {
        const next = new Map(contexts); next.delete(previewId);
        await persist(projects, next); ctx.closed = true; contexts.delete(previewId);
        if (closure) {
          const entry = { previewId, projectId: ctx.projectId, serverEpoch, closed: true, ...clone(closure) };
          entry.bytes = Buffer.byteLength(JSON.stringify(entry));
          tombstones.set(previewId, entry);
          let total = [...tombstones.values()].reduce((sum, value) => sum + value.bytes, 0);
          while (tombstones.size > maxTombstones || total > MAX_TOMBSTONE_BYTES) {
            const oldest = tombstones.keys().next().value;
            total -= tombstones.get(oldest).bytes; tombstones.delete(oldest);
          }
        }
        emit(ctx, 'closed', { operationId: closure?.operationId }); ctx.subscribers.clear(); ctx.lease = null; ctx.gameState = null; ctx.operations.clear(); ctx.receipts.clear();
      });
    },
    tombstone(previewId) { const value = tombstones.get(previewId); return value ? clone(value) : null; },
    subscribe(previewId, callback) {
      const ctx = get(previewId); ctx.subscribers.add(callback);
      return () => ctx.subscribers.delete(callback);
    },
    emit(previewId, event, data) { emit(get(previewId), event, data); },
    emitProject(projectId, event, data) {
      for (const ctx of contexts.values()) if (ctx.projectId === projectId && !ctx.closed) emit(ctx, event, data);
    },
    installLease(ctx, input) {
      if (!validId(input.clientId) || !validId(input.instanceId) || !validId(input.buildId)) fail('INVALID_ARGUMENTS', '预览实例参数无效。');
      const nextEpoch = input.leaseEpoch ?? ctx.leaseEpoch + 1;
      if (!Number.isSafeInteger(nextEpoch) || nextEpoch < ctx.leaseEpoch) fail('STALE_FRAME', '目标租约已经过期。');
      ctx.leaseEpoch = nextEpoch;
      ctx.lease = { clientId: input.clientId, instanceId: input.instanceId, buildId: input.buildId, leaseEpoch: ctx.leaseEpoch };
      ctx.reconnectTarget = null;
      ctx.runtime = { status: 'starting', details: [] };
      ctx.gameState = null;
      emit(ctx, 'frame-active', ctx.lease);
      return { ...ctx.lease, previewId: ctx.previewId, projectId: ctx.projectId, serverEpoch };
    },
    rememberOperation(ctx, operationId, requestHash, result) {
      if (!validId(operationId)) fail('INVALID_ARGUMENTS', '操作标识无效。');
      const value = { requestHash, result: clone(result), bytes: Buffer.byteLength(JSON.stringify(result)) };
      ctx.operations.set(operationId, value);
      let total = [...ctx.operations.values()].reduce((sum, item) => sum + item.bytes, 0);
      while (ctx.operations.size > maxOperations || total > maxOperationBytes) {
        const first = ctx.operations.keys().next().value;
        total -= ctx.operations.get(first).bytes; ctx.operations.delete(first);
      }
    },
    operation(ctx, operationId, requestHash) {
      const prior = ctx.operations.get(operationId);
      if (!prior) return null;
      if (requestHash !== undefined && prior.requestHash !== requestHash) fail('OPERATION_ID_REUSED', '操作标识已用于不同请求。');
      return clone(prior.result);
    },
    rememberReceipt(ctx, operationId, value) {
      ctx.receipts.set(operationId, clone(value));
      while (ctx.receipts.size > 128) ctx.receipts.delete(ctx.receipts.keys().next().value);
    },
    receipt(ctx, operationId) { const value = ctx.receipts.get(operationId); return value ? clone(value) : null; },
    command(previewId, type, url, buildId) {
      const ctx = get(previewId);
      if (!['navigate', 'reload', 'game-control'].includes(type) || (type === 'navigate' && !validRoute(url))
        || (type === 'game-control' && !['pause', 'resume'].includes(url))) fail('INVALID_ARGUMENTS', '预览指令无效。');
      const command = { seq: ++ctx.commandSeq, type, previewId: ctx.previewId, projectId: ctx.projectId, serverEpoch, leaseEpoch: ctx.leaseEpoch,
        ...(buildId ?? ctx.lease?.buildId ? { buildId: buildId ?? ctx.lease.buildId } : {}), ...(url ? { url } : {}) };
      ctx.command = command; if (type === 'navigate') ctx.requestedRoute = url;
      emit(ctx, 'command', command); return command;
    },
    logs(previewId, { limit = 50, level = 'all', afterSeq } = {}) {
      const ctx = get(previewId);
      const count = Math.max(1, Math.min(200, limit));
      const selected = ctx.logs.filter((item) => item.seq > (afterSeq ?? 0) && (level === 'all' || (level === 'warn' ? ['warn', 'error'].includes(item.level) : item.level === level)));
      return (afterSeq === undefined ? selected.slice(-count) : selected.slice(0, count)).map(clone);
    },
    appendLogs(input, entries) {
      const ctx = assertLease(input);
      if (!Array.isArray(entries)) fail('INVALID_ARGUMENTS', '日志格式无效。');
      for (const raw of entries.slice(0, 100)) {
        if (!raw || typeof raw !== 'object') continue;
        const item = { seq: ++ctx.logSeq, at: Date.now(), level: LOG_LEVELS.has(raw.level) ? raw.level : 'log', message: String(raw.message ?? '').slice(0, 4000), source: ['runtime', 'build'].includes(raw.source) ? raw.source : 'console',
          ...(typeof raw.route === 'string' ? { route: raw.route.slice(0, 2048) } : {}) };
        ctx.logs.push(item); emit(ctx, 'log', item);
      }
      if (ctx.logs.length > MAX_LOGS) ctx.logs.splice(0, ctx.logs.length - MAX_LOGS);
    },
    reportStatus(input, status, details) {
      const ctx = assertLease(input);
      if (!['rendered', 'limited', 'error'].includes(status) || !Array.isArray(details)) fail('INVALID_ARGUMENTS', '运行状态无效。');
      ctx.runtime = { status, details: details.slice(0, 100).filter((item) => item && typeof item.message === 'string').map((item) => ({ code: String(item.code ?? 'runtime').slice(0, 100), message: item.message.slice(0, 2000), ...(typeof item.route === 'string' ? { route: item.route.slice(0, 2048) } : {}) })) };
      emit(ctx, 'runtime', ctx.runtime);
    },
    reportGameState(input, state) {
      const ctx = assertLease(input);
      if (typeof state.paused !== 'boolean' || (state.reason !== undefined && (typeof state.reason !== 'string' || state.reason.length > 100))
        || (state.framesPerSecond !== undefined && (!Number.isFinite(state.framesPerSecond) || state.framesPerSecond < 1 || state.framesPerSecond > 60))) fail('INVALID_ARGUMENTS', '小游戏状态无效。');
      ctx.gameState = { paused: state.paused, reason: String(state.reason ?? '').slice(0, 100),
        ...(state.framesPerSecond !== undefined ? { framesPerSecond: state.framesPerSecond } : {}) };
      emit(ctx, 'game-state', ctx.gameState);
    },
    snapshot(previewId) {
      const ctx = get(previewId);
      return { ...descriptor(ctx), serverEpoch, leaseEpoch: ctx.leaseEpoch, lease: ctx.lease ? clone(ctx.lease) : null,
        recovering: ctx.recovering ? { operationId: ctx.recovering.operationId, committed: true, targetClientId: ctx.recovering.targetClientId } : null,
        reconnectTarget: ctx.reconnectTarget ? clone(ctx.reconnectTarget) : null,
        runtime: clone(ctx.runtime), gameState: clone(ctx.gameState), command: ctx.command ? clone(ctx.command) : null, requestedRoute: ctx.requestedRoute, connected: ctx.subscribers.size > 0 };
    },
    async dispose() {
      await Promise.allSettled([...contexts.values()].map((ctx) => ctx.pending));
      await metadataQueue; disposed = true;
      for (const ctx of contexts.values()) ctx.subscribers.clear();
    },
  };
}
