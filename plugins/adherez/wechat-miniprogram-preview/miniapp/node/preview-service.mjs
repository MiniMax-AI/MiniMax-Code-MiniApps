import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createProjectAccess } from './project-access.mjs';
import { createVersionedProjectStorage } from './project-storage.mjs';
import { createPreviewContexts, PreviewError } from './preview-contexts.mjs';
import { createProjectBuilds } from './project-builds.mjs';
import { resolveProject } from './compiler.mjs';

export const CAPABILITY_VERSION = 4;
const canonical = (value) => {
  let nodes = 0;
  const ancestors = new Set();
  const visit = (item, depth) => {
    if (++nodes > 100100 || depth > 80 || typeof item === 'number' && !Number.isFinite(item)) fail('INVALID_ARGUMENTS', '预览请求过深、过大或包含非法值。');
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) return JSON.stringify(item);
    if (!item || typeof item !== 'object' || ancestors.has(item)) fail('INVALID_ARGUMENTS', '预览请求必须为 JSON。');
    ancestors.add(item);
    let text;
    if (Array.isArray(item)) text = `[${item.map((child) => visit(child, depth + 1)).join(',')}]`;
    else {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const keys = Object.keys(descriptors).sort();
      if (keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in descriptors[key]))) fail('INVALID_ARGUMENTS', '预览请求包含不安全字段。');
      text = `{${keys.filter((key) => descriptors[key].value !== undefined).map((key) => `${JSON.stringify(key)}:${visit(descriptors[key].value, depth + 1)}`).join(',')}}`;
    }
    ancestors.delete(item);
    return text;
  };
  return visit(value, 0);
};
const operationHash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const validId = (value) => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const fail = (code, message, details) => { throw new PreviewError(code, message, details); };
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const identityKeys = ['serverEpoch', 'previewId', 'projectId', 'buildId', 'clientId', 'instanceId', 'leaseEpoch'];
const sameIdentity = (a, b) => a && b && identityKeys.every((key) => a[key] === b[key]);
const clone = (value) => structuredClone(value);
function keysOnly(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail('INVALID_ARGUMENTS', '预览请求包含不支持的字段。');
}
function validateDirty(input) {
  if (typeof input.dirty !== 'boolean' || (input.dirty && (!revision(input.baseRevision) || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)))
    || (!input.dirty && (input.baseRevision !== undefined || input.data !== undefined))) fail('INVALID_ARGUMENTS', 'dirty=true 必须提供快照与 revision；dirty=false 不接受旧快照。');
}
function validateIdentity(input) {
  if (!input || identityKeys.slice(0, -1).some((key) => !validId(input[key])) || !revision(input.leaseEpoch)) fail('INVALID_ARGUMENTS', '预览实例身份无效。');
}

/** Service owns the preview -> project queue order; HTTP handlers only validate transport. */
export async function createPreviewService(context, options = {}) {
  const access = await createProjectAccess(context.pluginRoot, context.dataDir);
  const storage = await createVersionedProjectStorage(context.dataDir);
  const previews = await createPreviewContexts(context.dataDir, { ...options.contexts, validateProject: (projectPath) => access.remember(projectPath) });
  const builds = createProjectBuilds({ ...options.builds, dataDir: context.dataDir, assertProjectAccess: access,
    onEvent: (projectId, build) => previews.emitProject(projectId, 'build', { build }) });
  for (const project of previews.projects()) builds.register(project);
  const connections = new Map();
  const demoPath = await access(path.join(context.pluginRoot, 'miniapp/node/demo'));
  const demoPaths = new Map([['miniprogram', demoPath]]);
  for (const [name, directory] of [['minigame-2d', 'demo-game-2d'], ['minigame-webgl', 'demo-game-webgl']]) {
    try { demoPaths.set(name, await access(path.join(context.pluginRoot, 'miniapp/node', directory))); }
    catch (error) { if (error.code !== 'PROJECT_NOT_FOUND') throw error; }
  }
  const isDemo = (projectPath) => [...demoPaths.values()].includes(projectPath);
  let disposed = false;

  const projectFor = (ctx) => {
    const project = previews.project(ctx.projectId);
    if (!project) fail('PROJECT_NOT_FOUND', '工程未登记。');
    return project;
  };
  const pinned = (ctx, buildId) => builds.hasPin(ctx.projectId, buildId, ctx.previewId);
  const currentIdentity = (ctx) => ctx.lease ? { serverEpoch: previews.serverEpoch, previewId: ctx.previewId, projectId: ctx.projectId, ...ctx.lease } : null;
  const assertReady = (ctx) => {
    if (ctx.recovering) fail('PREVIEW_RECOVERING', '交接已经提交，请由原目标窗口恢复。', { committed: true, operationId: ctx.recovering.operationId });
  };
  const snapshot = (previewId) => {
    const ctx = previews.get(previewId);
    const project = projectFor(ctx);
    const state = previews.snapshot(previewId);
    const build = builds.snapshot(project.id);
    const surfacePath = `/preview?previewId=${encodeURIComponent(ctx.previewId)}`;
    const nextStep = ctx.recovering || ctx.reconnectTarget ? 'recover_preview' : build.status === 'error' ? 'inspect_build'
      : !ctx.lease || !ctx.subscribers.size ? 'open_miniapp'
        : ['rendered', 'limited'].includes(state.runtime.status) ? 'preview_ready'
          : state.runtime.status === 'error' ? 'inspect_runtime' : 'wait_for_render';
    return { ok: true, capabilityVersion: CAPABILITY_VERSION, ...state,
      projectKind: project.projectKind ?? 'miniprogram',
      capabilities: project.projectKind === 'minigame' ? { pageNavigation: false, gameControls: true, canvas2d: true, webgl: true } : { pageNavigation: true, gameControls: false },
      activeId: project.id, activeProject: { ...project, bundledExample: isDemo(project.path) },
      projects: previews.projects().map(({ id, name, path: projectPath, projectKind }) => ({ id, name, projectKind: projectKind ?? 'miniprogram', bundledExample: isDemo(projectPath) })),
      build, preview: state.runtime,
      currentRoute: state.route ? { projectId: ctx.projectId, route: state.route } : null,
      surfacePath, nextStep,
      hostOpenAction: { action: 'open', pluginId: 'wechat-miniprogram-preview', path: surfacePath },
      previewSurfaceConnected: ctx.subscribers.size > 0,
      recentRuntimeErrors: previews.logs(previewId, { level: 'error', limit: 5 }),
      note: 'H5 approximation only; native WeChat, cloud, phone preview and publishing are not provided.',
    };
  };
  const emitState = (ctx) => previews.emit(ctx.previewId, 'state', snapshot(ctx.previewId));
  const requireProjectAccess = async (ctx) => {
    const project = projectFor(ctx);
    await access(project.path);
    return project;
  };
  const register = async (projectPath, projectKind) => {
    const initial = await access.identity(projectPath);
    const resolved = await resolveProject(initial.path, { projectKind });
    await access.remember(projectPath, initial);
    await access.remember(resolved.projectDir, initial);
    const kind = resolved.projectKind ?? 'miniprogram';
    const id = createHash('sha1').update(resolved.projectDir + (kind === 'minigame' ? '\0minigame' : '')).digest('hex').slice(0, 12);
    const project = await previews.registerProject({ id, path: resolved.projectDir, name: resolved.projectName, projectKind: kind, addedAt: Date.now() });
    builds.register(project);
    return project;
  };
  const checkEpoch = (input) => {
    if (input.serverEpoch !== previews.serverEpoch) fail('STALE_FRAME', '预览服务已重启，请重新登记。');
  };
  const checkCurrent = (input, latest = true) => {
    validateIdentity(input);
    const ctx = previews.assertLease(input);
    if (latest && builds.snapshot(ctx.projectId).buildId !== input.buildId) fail('STALE_BUILD', '构建已更新，旧页面只能完成显式存储 drain。');
    return ctx;
  };
  const assertArtifactAccess = async (previewId, projectId, buildId) => {
    const ctx = previews.get(previewId);
    const expected = currentIdentity(ctx);
    if (ctx.projectId !== projectId || ctx.lease?.buildId !== buildId || !pinned(ctx, buildId)) fail('STALE_FRAME', '页面没有引用此构建。');
    await requireProjectAccess(ctx);
    if (!sameIdentity(expected, currentIdentity(ctx))) fail('STALE_FRAME', '页面引用已经改变。');
  };
  const validateOperation = (input) => {
    if (!input || !validId(input.previewId) || !validId(input.projectId) || !validId(input.operationId)) fail('INVALID_ARGUMENTS', '预览操作身份无效。');
    checkEpoch(input);
  };
  const storageOperation = (input) => `preview:${operationHash([previews.serverEpoch, input.previewId, input.operationId])}`;
  const normalizePage = (ctx, page, query) => {
    if (projectFor(ctx).projectKind === 'minigame') fail('UNSUPPORTED_PROJECT_ACTION', '小游戏没有小程序页面栈，请使用暂停、继续或重新启动。');
    if (typeof page !== 'string' || !page.trim() || page.length > 2048) fail('INVALID_ARGUMENTS', '请提供页面地址。');
    const clean = page.trim().replace(/^\//, '');
    const pages = builds.snapshot(ctx.projectId).manifest?.pages ?? [];
    if (!pages.includes(clean.split('?')[0])) fail('UNKNOWN_PAGE', '页面不属于当前工程。', { pages });
    if (query !== undefined && (!query || typeof query !== 'object' || Array.isArray(query)
      || Object.values(query).some((value) => !['string', 'number', 'boolean'].includes(typeof value)))) fail('INVALID_ARGUMENTS', '页面参数只能包含字符串、数字或布尔值。');
    const suffix = query ? new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString() : '';
    return suffix ? clean.split('?')[0] + '?' + suffix : clean;
  };
  const announceStorage = (ctx, ack) => {
    if (ack.changed && !ack.replayed) previews.emitProject(ctx.projectId, 'storage-updated', { revision: ack.committedRevision, originPreviewId: ctx.previewId });
  };
  const migrationWarnings = async (projectPath) => {
    const migration = await storage.migration(projectPath);
    return ['changed', 'unavailable'].includes(migration.legacyStatus) ? [{ code: 'LEGACY_STORAGE_DIVERGED', message: '旧版 Storage 已变化或无法检查；当前继续使用 v2 数据，不自动合并或覆盖。' }] : [];
  };
  const remember = (ctx, input, requestHash, result, receipt) => {
    previews.rememberReceipt(ctx, input.operationId, { requestHash, projectId: input.projectId, committed: true, ...receipt });
    previews.rememberOperation(ctx, input.operationId, requestHash, result);
  };
  const replay = (ctx, input, requestHash) => {
    const known = previews.receipt(ctx, input.operationId);
    if (known && known.requestHash !== requestHash) fail('OPERATION_ID_REUSED', '操作标识已用于不同请求。');
    const result = previews.operation(ctx, input.operationId, requestHash);
    if (result) {
      if (result.identity && !sameIdentity(result.identity, currentIdentity(ctx))) fail('STALE_FRAME', '此交接已完成，但该实例已被后续操作替换。', { committed: true, operationId: input.operationId });
      if (result.state && (result.state.projectId !== ctx.projectId || result.state.leaseEpoch !== ctx.leaseEpoch)) fail('STALE_FRAME', '此操作已完成，预览随后已继续运行。', { committed: true, operationId: input.operationId });
      return result;
    }
    if (known) fail('TRANSITION_OUTCOME_UNKNOWN', '操作已提交，但精确响应已过期。请确认当前所有权后恢复。', { committed: true, operationId: input.operationId, currentIdentity: currentIdentity(ctx), ...known });
    return null;
  };
  const closedReplay = async (input, requestHash) => {
    const tombstone = previews.tombstone(input.previewId);
    if (!tombstone) return null;
    const project = previews.project(tombstone.projectId);
    if (!project) fail('PREVIEW_CONTEXT_NOT_FOUND', '预览已经关闭。');
    if (tombstone.managementOnly !== true) await access(project.path);
    if (tombstone.operationId !== input.operationId) fail('PREVIEW_CONTEXT_NOT_FOUND', '预览已经关闭。');
    if (tombstone.requestHash !== requestHash) fail('OPERATION_ID_REUSED', '关闭操作标识已用于不同请求。');
    return clone(tombstone.result);
  };
  const markRecovering = (ctx, recovery, error) => {
    ctx.recovering = recovery;
    ctx.runtime = { status: 'error', details: [{ code: 'PREVIEW_RECOVERING', message: '数据已提交，等待完成交接恢复。' }] };
    emitState(ctx);
    fail('PREVIEW_RECOVERING', '数据已经提交，内存交接尚未完成。', { committed: true, operationId: recovery.operationId, committedRevision: recovery.revision, cause: error.code ?? 'HANDOFF_FAILED' });
  };
  const checkLedger = (tx, input, requestHash) => {
    const prior = tx.getOperation(storageOperation(input));
    if (!prior) return;
    if (prior.metadata?.requestHash !== requestHash) fail('OPERATION_ID_REUSED', '操作标识已用于不同请求。');
    fail('TRANSITION_OUTCOME_UNKNOWN', '此操作已提交，请查询结果；禁止再次写入旧快照。', { committed: true, operationId: input.operationId, committedRevision: prior.committedRevision, targetIdentity: prior.result?.identity });
  };

  async function openProject({ project_path: projectPath, project_id: projectId, project_kind: projectKind, preview_id: previewId, create_new: createNew = false, page, query } = {}) {
    if (createNew && previewId !== undefined || projectPath !== undefined && projectId !== undefined) fail('INVALID_ARGUMENTS', '工程选择与预览选择参数冲突。');
    if (projectKind !== undefined && !['miniprogram', 'minigame'].includes(projectKind)) fail('INVALID_ARGUMENTS', '工程类型无效。');
    let ctx = null;
    if (!createNew && (previewId !== undefined || previews.list().length)) ctx = previews.resolve(previewId);
    const project = projectId !== undefined ? previews.project(projectId) : await register(projectPath, projectKind);
    if (!project) fail('PROJECT_NOT_FOUND', '工程未登记。');
    if (projectKind !== undefined && projectKind !== project.projectKind) fail('PROJECT_KIND_MISMATCH', '已登记的工程类型与请求不符。', { requestedKind: projectKind, configuredKind: project.projectKind, choices: [project.projectKind] });
    if (project.projectKind === 'minigame' && (page !== undefined || query !== undefined)) fail('UNSUPPORTED_PROJECT_ACTION', '小游戏不接受 page/query 导航参数。');
    await access(project.path);
    const capacityDetails = (error) => {
      if (!['PROJECT_CAPACITY_REACHED', 'PREVIEW_CAPACITY_REACHED', 'BUILD_CAPACITY_REACHED'].includes(error.code)) return error;
      error.details = { ...error.details, previews: previews.list().map(({ previewId, projectId, name, projectKind, surfacePath, connected }) => ({ previewId, projectId, name, projectKind, surfacePath, connected })) };
      return error;
    };
    const reserve = async (reservation) => {
      const build = await builds.acquire(project.id, reservation);
      const capacity = build.errors?.find((error) => ['PROJECT_CAPACITY_REACHED', 'BUILD_CAPACITY_REACHED'].includes(error.code));
      if (capacity) fail(capacity.code, capacity.message, capacity.details);
      if (page !== undefined) normalizePage({ projectId: project.id }, page, query);
      return build;
    };
    const apply = async (current) => {
      assertReady(current);
      const changing = current.projectId !== project.id;
      if (changing && current.reconnectTarget) fail('PREVIEW_REQUIRES_DRAIN', '当前预览仍等待原窗口恢复，请先完成恢复或明确关闭，再切换工程。');
      if (changing && current.lease) fail('PREVIEW_REQUIRES_DRAIN', '请先完成当前预览存储交接再切换工程。');
      const reservation = `opening_${randomUUID()}`;
      let targetReference = false;
      let committed = false;
      try {
        await reserve(reservation);
        await access(project.path);
        if (changing) {
          if (connections.has(current.previewId)) { await builds.acquire(project.id, current.previewId); targetReference = true; }
          const oldProjectId = current.projectId;
          await previews.saveDescriptor(current, { projectId: project.id, route: '' });
          committed = true;
          builds.release(oldProjectId, current.previewId);
          current.runtime = { status: 'waiting', details: [] }; current.gameState = null; current.logs = []; current.command = null; current.requestedRoute = null;
        }
        if (page) previews.command(current.previewId, 'navigate', normalizePage(current, page, query), builds.snapshot(project.id).buildId);
        emitState(current);
        return snapshot(current.previewId);
      } finally {
        if (targetReference && !committed) builds.release(project.id, current.previewId);
        builds.release(project.id, reservation);
      }
    };
    try {
      if (ctx) return await previews.queue(ctx.previewId, apply);
      const reservation = `opening_${randomUUID()}`;
      try {
        await reserve(reservation);
        await access(project.path);
        ctx = await previews.create(project.id);
        if (page) previews.command(ctx.previewId, 'navigate', normalizePage(ctx, page, query), builds.snapshot(project.id).buildId);
        emitState(ctx);
        return snapshot(ctx.previewId);
      } finally { builds.release(project.id, reservation); }
    } catch (error) { throw capacityDetails(error); }
  }

  const validateTransition = (ctx, input) => {
    keysOnly(input, ['action', 'serverEpoch', 'previewId', 'projectId', 'expectedLeaseEpoch', 'operationId', 'next', 'previous', 'dirty', 'baseRevision', 'data']);
    validateOperation(input); validateDirty(input);
    keysOnly(input.next, ['buildId', 'clientId', 'instanceId']);
    if (!['attach', 'reload', 'takeover'].includes(input.action) || !revision(input.expectedLeaseEpoch)
      || input.projectId !== ctx.projectId || Object.values(input.next).length !== 3 || Object.values(input.next).some((value) => !validId(value))) fail('INVALID_ARGUMENTS', '预览交接参数无效。');
    previews.assertExpectedLease(ctx, input);
    if (input.action === 'reload') {
      keysOnly(input.previous, identityKeys); validateIdentity(input.previous);
      if (!sameIdentity(input.previous, currentIdentity(ctx)) || input.next.clientId !== input.previous.clientId) fail('STALE_FRAME', '旧快照不属于当前预览。');
    } else {
      if (input.previous !== undefined || input.dirty) fail('INVALID_ARGUMENTS', '首次连接和接管不能携带旧窗口快照。');
      if (input.action === 'attach' && ctx.lease) fail('PREVIEW_IN_USE', '此预览已有窗口，请明确选择接管。');
      if (input.action === 'attach' && ctx.reconnectTarget && input.next.clientId !== ctx.reconnectTarget.clientId) fail('PREVIEW_IN_USE', '恢复连接仅限原交接目标窗口，其他窗口请明确接管。');
      if (input.action === 'takeover' && !ctx.lease && !ctx.reconnectTarget) fail('INVALID_ARGUMENTS', '没有可接管的预览。');
    }
    const build = builds.snapshot(ctx.projectId);
    if (build.status !== 'ok' || build.buildId !== input.next.buildId) fail('STALE_BUILD', '目标构建已更新。');
    builds.artifact(ctx.projectId, input.next.buildId);
  };

  async function transition(input) {
    validateOperation(input);
    const requestHash = operationHash(input);
    return previews.queue(input.previewId, async (ctx) => {
      assertReady(ctx);
      await requireProjectAccess(ctx);
      const remembered = replay(ctx, input, requestHash);
      if (remembered) return remembered;
      validateTransition(ctx, input);
      const project = projectFor(ctx);
      const warnings = await migrationWarnings(project.path);
      const identity = { serverEpoch: previews.serverEpoch, previewId: ctx.previewId, projectId: ctx.projectId, ...input.next, leaseEpoch: ctx.leaseEpoch + 1 };
      const reservation = `transition:${randomUUID()}`;
      builds.pin(ctx.projectId, input.next.buildId, reservation);
      let value; let ack;
      const recovery = { operationId: input.operationId, input: clone(input), requestHash, action: input.action, identity, targetClientId: input.next.clientId, reservation, revision: null };
      try {
        await storage.withProjectTransaction(project.path, (tx) => {
          validateTransition(ctx, input); checkLedger(tx, input, requestHash);
          const current = tx.read();
          ack = tx.commit({ baseRevision: input.dirty ? input.baseRevision : current.revision, operationId: storageOperation(input), data: input.dirty ? input.data : current.data,
            metadata: { requestHash, previewId: ctx.previewId, serverEpoch: previews.serverEpoch, action: input.action }, result: { identity } });
          value = tx.read(); recovery.revision = value.revision; recovery.value = value;
          tx.afterCommit(() => {
            options.afterStorageCommit?.(input.action);
            builds.pin(ctx.projectId, identity.buildId, ctx.previewId);
            previews.installLease(ctx, identity);
          });
        }, { validate: () => access(project.path) });
      } catch (error) {
        if (error.code === 'STORAGE_AFTER_COMMIT_FAILED') markRecovering(ctx, recovery, error);
        builds.unpin(reservation); throw error;
      }
      builds.unpin(reservation);
      const result = { ok: true, operationId: input.operationId, identity, storage: value, ...(warnings.length ? { warnings } : {}) };
      remember(ctx, input, requestHash, result, { identity, revision: value.revision });
      announceStorage(ctx, ack);
      return result;
    });
  }

  async function commitStorage(input) {
    keysOnly(input, [...identityKeys, 'operationId', 'baseRevision', 'data', 'drain']);
    validateOperation(input);
    if (input.drain !== undefined && typeof input.drain !== 'boolean') fail('INVALID_ARGUMENTS', 'drain 必须为布尔值。');
    const requestHash = operationHash({ action: 'storage', ...input });
    return previews.queue(input.previewId, async (ctx) => {
      checkCurrent(input, input.drain !== true);
      const project = await requireProjectAccess(ctx);
      const prior = previews.receipt(ctx, input.operationId);
      if (prior && prior.requestHash !== requestHash) fail('STORAGE_OPERATION_CONFLICT', '此操作标识已经用于不同请求。');
      if (prior?.ack) return { ...clone(prior.ack), replayed: true };
      const ack = await storage.withProjectTransaction(project.path, (tx) => {
        checkCurrent(input, input.drain !== true);
        return tx.commit({ baseRevision: input.baseRevision, operationId: storageOperation(input), data: input.data,
          metadata: { action: 'storage', requestHash, previewId: ctx.previewId, serverEpoch: previews.serverEpoch, leaseEpoch: ctx.leaseEpoch, clientId: input.clientId, instanceId: input.instanceId } });
      }, { validate: () => access(project.path) });
      announceStorage(ctx, ack);
      const result = { ok: true, operationId: input.operationId, ...ack };
      remember(ctx, input, requestHash, result, { ack: result });
      return result;
    });
  }

  const releaseLease = (ctx, epoch) => {
    ctx.leaseEpoch = epoch; ctx.lease = null; builds.unpin(ctx.previewId);
    ctx.runtime = { status: 'waiting', details: [] }; ctx.command = null; ctx.gameState = null;
  };
  const validateDrain = (ctx, input, action) => {
    validateOperation(input); validateDirty(input); assertReady(ctx);
    if (input.projectId !== ctx.projectId) fail('STALE_FRAME', '预览工程已改变。');
    if (ctx.lease) checkCurrent(input, false);
    else {
      if (input.dirty || !revision(input.expectedLeaseEpoch) || input.expectedLeaseEpoch !== ctx.leaseEpoch) fail('STALE_FRAME', '无运行窗口的预览只能无修改关闭或切换。');
      if (action === 'detach') fail('STALE_FRAME', '预览已经脱离运行窗口。');
    }
  };
  const finishDrain = async (ctx, recovery) => {
    const { input, action, nextProjectId, value, requestHash, nextEpoch } = recovery;
    if (action === 'project') {
      await access(previews.project(nextProjectId).path);
      await previews.saveDescriptor(ctx, { projectId: nextProjectId, route: '' });
      builds.release(input.projectId, ctx.previewId);
      if (connections.has(ctx.previewId)) await builds.acquire(nextProjectId, ctx.previewId);
      ctx.logs = [];
      ctx.requestedRoute = null;
    }
    releaseLease(ctx, nextEpoch);
    const result = { ok: true, operationId: input.operationId, previewId: ctx.previewId, closed: action === 'close' || action === 'forceClose',
      saved: action !== 'forceClose', ...(action === 'detach' ? { detached: true } : {}), ...(value ? { storage: value } : {}) };
    if (result.closed) {
      await previews.close(ctx.previewId, { operationId: input.operationId, requestHash, result, managementOnly: action === 'forceClose' });
      builds.release(input.projectId, ctx.previewId); connections.delete(ctx.previewId);
    } else {
      remember(ctx, input, requestHash, result, { revision: value?.revision, detached: action === 'detach', nextProjectId });
      ctx.recovering = null;
      result.state = snapshot(ctx.previewId);
      previews.rememberOperation(ctx, input.operationId, requestHash, result);
      emitState(ctx);
    }
    return result;
  };

  async function drain(input, { close = false, detach = false, nextProjectId } = {}) {
    keysOnly(input, [...identityKeys, 'expectedLeaseEpoch', 'operationId', 'dirty', 'baseRevision', 'data', 'targetProjectId']);
    validateOperation(input);
    const action = close ? 'close' : detach ? 'detach' : 'project';
    const target = nextProjectId ?? input.targetProjectId;
    if (nextProjectId !== undefined && input.targetProjectId !== undefined && nextProjectId !== input.targetProjectId) fail('INVALID_ARGUMENTS', '目标工程标识不匹配。');
    if (Number(close) + Number(detach) + Number(target !== undefined) !== 1) fail('INVALID_ARGUMENTS', '关闭、脱离和切工程只能选择一种。');
    const requestHash = operationHash({ action, ...input, nextProjectId: target });
    const tombstone = await closedReplay(input, requestHash);
    if (tombstone) return tombstone;
    return previews.queue(input.previewId, async (ctx) => {
      assertReady(ctx); await requireProjectAccess(ctx);
      const originalProject = previews.project(input.projectId);
      if (originalProject) await access(originalProject.path);
      const remembered = replay(ctx, input, requestHash);
      if (remembered) return remembered;
      validateDrain(ctx, input, action);
      let targetReservation;
      if (action === 'project') {
        if (!validId(target)) fail('INVALID_ARGUMENTS', '目标工程标识无效。');
        const next = previews.project(target);
        if (!next) fail('PROJECT_NOT_FOUND', '目标工程未登记。');
        await access(next.path);
        targetReservation = `target_${randomUUID()}`;
        const build = await builds.acquire(target, targetReservation);
        if (build.status !== 'ok') { builds.release(target, targetReservation); fail('TARGET_BUILD_FAILED', '目标工程无法预览，当前页面保持不变。', { build }); }
      }
      const project = projectFor(ctx);
      const recovery = { operationId: input.operationId, input: clone(input), action, requestHash, nextProjectId: target,
        nextEpoch: ctx.leaseEpoch + 1, targetClientId: input.clientId ?? null, value: null, revision: null };
      let ack;
      try {
        await storage.withProjectTransaction(project.path, (tx) => {
          validateDrain(ctx, input, action); checkLedger(tx, input, requestHash);
          const current = tx.read();
          ack = tx.commit({ baseRevision: input.dirty ? input.baseRevision : current.revision, operationId: storageOperation(input), data: input.dirty ? input.data : current.data,
            metadata: { previewId: ctx.previewId, action, requestHash, serverEpoch: previews.serverEpoch },
            result: { action, nextProjectId: target ?? null, leaseEpoch: recovery.nextEpoch } });
          recovery.value = tx.read(); recovery.revision = recovery.value.revision;
          tx.afterCommit(() => {
            ctx.recovering = recovery;
            options.afterStorageCommit?.(action);
            releaseLease(ctx, recovery.nextEpoch);
          });
        }, { validate: async () => {
          await access(project.path);
          if (target) await access(previews.project(target).path);
        } });
        announceStorage(ctx, ack);
        return await finishDrain(ctx, recovery);
      } catch (error) {
        if (recovery.value && (ctx.recovering || error.details?.committed)) markRecovering(ctx, recovery, error);
        throw error;
      } finally { if (targetReservation) builds.release(target, targetReservation); }
    });
  }

  async function forceClose(input) {
    keysOnly(input, ['serverEpoch', 'previewId', 'projectId', 'expectedLeaseEpoch', 'operationId', 'confirmed']);
    validateOperation(input);
    if (input.confirmed !== true || !revision(input.expectedLeaseEpoch)) fail('INVALID_ARGUMENTS', '强制关闭必须明确确认未保存数据风险。');
    const requestHash = operationHash({ action: 'forceClose', ...input });
    const remembered = await closedReplay(input, requestHash);
    if (remembered) return remembered;
    return previews.queue(input.previewId, async (ctx) => {
      checkEpoch(input);
      if (input.expectedLeaseEpoch !== ctx.leaseEpoch) fail('STALE_FRAME', '预览已被更新或接管。');
      if (ctx.projectId !== input.projectId) fail('STALE_FRAME', '工程已经改变。');
      if (previews.receipt(ctx, input.operationId) || previews.operation(ctx, input.operationId)
        || ctx.recovering?.operationId === input.operationId) {
        fail('OPERATION_ID_REUSED', '强制关闭必须使用未被其他操作使用的标识。');
      }
      if (ctx.recovering?.reservation) builds.unpin(ctx.recovering.reservation);
      const recovery = { operationId: input.operationId, input: clone(input), action: 'forceClose', requestHash, nextEpoch: ctx.leaseEpoch + 1, targetClientId: null, revision: null };
      ctx.recovering = recovery; releaseLease(ctx, recovery.nextEpoch);
      try { return await finishDrain(ctx, recovery); } catch (error) { markRecovering(ctx, recovery, error); }
    });
  }

  async function operation(previewId, operationId) {
    if (!validId(operationId)) fail('INVALID_ARGUMENTS', '操作标识无效。');
    const tombstone = previews.tombstone(previewId);
    if (tombstone) {
      if (tombstone.managementOnly !== true) await access(previews.project(tombstone.projectId).path);
      if (tombstone.operationId !== operationId) return { ok: true, status: 'unknown', closed: true };
      return { ok: true, status: 'committed', committed: true, closed: true, result: tombstone.result };
    }
    return previews.queue(previewId, async (ctx) => {
      const project = await requireProjectAccess(ctx);
      if (ctx.recovering?.operationId === operationId) return { ok: true, status: 'recovering', committed: true, operationId, currentIdentity: currentIdentity(ctx), targetIdentity: ctx.recovering.identity ?? null };
      const receipt = previews.receipt(ctx, operationId);
      if (receipt?.projectId && receipt.projectId !== ctx.projectId) await access(previews.project(receipt.projectId).path);
      const result = previews.operation(ctx, operationId);
      if (result) return { ok: true, status: 'committed', committed: true, result: receipt?.ack ? { ...result, replayed: true } : result, currentIdentity: currentIdentity(ctx), currentState: {
        previewId: ctx.previewId, projectId: ctx.projectId, leaseEpoch: ctx.leaseEpoch, serverEpoch: previews.serverEpoch,
      } };
      const ledger = receipt ?? await storage.getOperation(project.path, storageOperation({ previewId, operationId }));
      if (receipt?.ack) return { ok: true, status: 'committed', committed: true, currentIdentity: currentIdentity(ctx), result: { ...receipt.ack, replayed: true } };
      if (ledger?.metadata?.action === 'storage') return { ok: true, status: 'committed', committed: true, currentIdentity: currentIdentity(ctx), result: {
        ok: true, operationId, committedRevision: ledger.committedRevision, changed: ledger.changed, replayed: true,
      } };
      return { ok: true, status: 'unknown', committed: Boolean(ledger), operationId, currentIdentity: currentIdentity(ctx), ...(ledger ? { targetIdentity: receipt?.identity ?? ledger.result?.identity ?? null } : {}) };
    });
  }

  async function recover(input) {
    keysOnly(input, ['serverEpoch', 'previewId', 'operationId', 'clientId']);
    checkEpoch(input);
    if (!validId(input.operationId) || !validId(input.clientId)) fail('INVALID_ARGUMENTS', '恢复参数无效。');
    return previews.queue(input.previewId, async (ctx) => {
      const recovery = ctx.recovering;
      if (!recovery || recovery.operationId !== input.operationId) fail('NO_RECOVERY_PENDING', '没有待恢复的交接。');
      if (recovery.targetClientId && input.clientId !== recovery.targetClientId) fail('STALE_FRAME', '仅交接目标窗口可以恢复。');
      await requireProjectAccess(ctx);
      if (!recovery.identity) {
        try { return await finishDrain(ctx, recovery); } catch (error) { markRecovering(ctx, recovery, error); }
      }
      try {
        builds.artifact(ctx.projectId, recovery.identity.buildId);
        builds.pin(ctx.projectId, recovery.identity.buildId, ctx.previewId);
        previews.installLease(ctx, recovery.identity);
        ctx.recovering = null; builds.unpin(recovery.reservation);
        const result = { ok: true, operationId: input.operationId, identity: recovery.identity, storage: recovery.value };
        remember(ctx, recovery.input, recovery.requestHash, result, { identity: recovery.identity, revision: recovery.revision });
        emitState(ctx);
        return result;
      } catch (error) {
        builds.unpin(recovery.reservation); releaseLease(ctx, Math.max(ctx.leaseEpoch, recovery.identity.leaseEpoch) + 1);
        ctx.reconnectTarget = { clientId: recovery.targetClientId, operationId: recovery.operationId };
        ctx.recovering = null;
        previews.rememberReceipt(ctx, input.operationId, { requestHash: recovery.requestHash, committed: true, projectId: ctx.projectId, identity: recovery.identity, revision: recovery.revision });
        emitState(ctx);
        return { ok: true, operationId: input.operationId, status: 'reconnect_required', committed: true, state: snapshot(ctx.previewId) };
      }
    });
  }

  return {
    previews, builds, access, storage, serverEpoch: previews.serverEpoch,
    list: () => ({ ok: true, capabilityVersion: CAPABILITY_VERSION, serverEpoch: previews.serverEpoch, previews: previews.list(), projects: previews.projects().map(({ id, name, projectKind }) => ({ id, name, projectKind: projectKind ?? 'miniprogram' })) }),
    snapshot: (previewId) => snapshot(previews.resolve(previewId).previewId),
    registerProject: register, openProject, transition, commitStorage, drain, forceClose, operation, recover,
    async closeIdle(previewId, input) {
      keysOnly(input, ['serverEpoch', 'expectedLeaseEpoch', 'confirmed']);
      checkEpoch(input);
      if (input.confirmed !== true || !revision(input.expectedLeaseEpoch)) fail('INVALID_ARGUMENTS', '关闭空闲预览需要明确确认和当前租约代际。');
      return previews.queue(previewId, async (ctx) => {
        assertReady(ctx);
        if (ctx.leaseEpoch !== input.expectedLeaseEpoch) fail('STALE_FRAME', '预览已发生变化，请读取最新状态。');
        if (ctx.lease) fail('PREVIEW_REQUIRES_DRAIN', '预览仍有运行页面，必须先由对应页面同步状态，不能直接关闭。');
        await previews.close(ctx.previewId);
        builds.unpin(ctx.previewId); builds.release(ctx.projectId, ctx.previewId); connections.delete(ctx.previewId);
        return { ok: true, previewId, closed: true, storageTouched: false };
      });
    },
    async registerProjectResult(projectPath, projectKind) {
      const project = await register(projectPath, projectKind);
      return { ok: true, projectId: project.id, project };
    },
    demo: ({ example = 'miniprogram', ...opts } = {}) => {
      const projectPath = demoPaths.get(example);
      if (!projectPath) fail('INVALID_ARGUMENTS', '示例不存在。');
      const kind = example === 'miniprogram' ? 'miniprogram' : 'minigame';
      if (opts.project_kind !== undefined && opts.project_kind !== kind) fail('PROJECT_KIND_MISMATCH', '示例类型与请求的工程类型不符。', { requestedKind: opts.project_kind, configuredKind: kind, choices: [kind] });
      return openProject({ ...opts, project_path: projectPath });
    },
    async readStorage(previewId, input, expected) {
      const selected = previews.resolve(previewId);
      return previews.queue(selected.previewId, async (ctx) => {
        if (expected) {
          keysOnly(expected, ['projectId', 'serverEpoch']); checkEpoch(expected);
          if (expected.projectId !== ctx.projectId) fail('STALE_FRAME', '工程已切换，请重新选择要导出的已确认数据。');
        }
        assertReady(ctx); if (input) checkCurrent(input, false);
        const project = await requireProjectAccess(ctx);
        const value = await storage.read(project.path);
        const warnings = await migrationWarnings(project.path);
        await access(project.path);
        return { ok: true, ...value, ...(warnings.length ? { warnings } : {}), ...(expected ? {
          previewId: ctx.previewId, projectId: ctx.projectId, serverEpoch: previews.serverEpoch,
        } : {}) };
      });
    },
    async setDevice(previewId, input) {
      keysOnly(input, ['previewId', 'deviceId', 'serverEpoch', 'expectedLeaseEpoch', 'clientId']);
      if (input.previewId !== undefined && input.previewId !== previewId) fail('INVALID_ARGUMENTS', '预览标识不匹配。');
      return previews.queue(previewId, async (ctx) => {
        await requireProjectAccess(ctx); previews.assertExpectedLease(ctx, input);
        if (ctx.lease && input.clientId !== ctx.lease.clientId) fail('STALE_FRAME', '设备设置不属于当前窗口。');
        await previews.saveDescriptor(ctx, { deviceId: input.deviceId }); emitState(ctx);
        return snapshot(ctx.previewId);
      });
    },
    async subscribe(previewId, callback) {
      const selected = previews.resolve(previewId);
      return previews.queue(selected.previewId, async (ctx) => {
        await requireProjectAccess(ctx); await builds.acquire(ctx.projectId, ctx.previewId);
        const unsubscribe = previews.subscribe(ctx.previewId, callback);
        connections.set(ctx.previewId, (connections.get(ctx.previewId) ?? 0) + 1);
        let closed = false;
        return { state: snapshot(ctx.previewId), dispose() {
          if (closed) return; closed = true; unsubscribe();
          const remaining = (connections.get(ctx.previewId) ?? 1) - 1;
          if (remaining > 0) connections.set(ctx.previewId, remaining);
          else { connections.delete(ctx.previewId); builds.release(ctx.projectId, ctx.previewId); }
        } };
      });
    },
    logs(previewId, opts) { const ctx = previews.resolve(previewId); return { ok: true, previewId: ctx.previewId, entries: previews.logs(ctx.previewId, opts), lastSeq: ctx.logSeq }; },
    async navigate(previewId, page, query) {
      const selected = previews.resolve(previewId);
      return previews.queue(selected.previewId, async (ctx) => {
        assertReady(ctx); await requireProjectAccess(ctx);
        const url = normalizePage(ctx, page, query); const command = previews.command(ctx.previewId, 'navigate', url, builds.snapshot(ctx.projectId).buildId);
        return { ok: true, accepted: true, previewId: ctx.previewId, commandSeq: command.seq, page: url, previewSurfaceConnected: ctx.subscribers.size > 0 };
      });
    },
    async controlGame(previewId, action, expected) {
      if (!['pause', 'resume', 'restart'].includes(action)) fail('INVALID_ARGUMENTS', '小游戏操作无效。');
      const selected = previews.resolve(previewId);
      const admitted = expected ?? currentIdentity(selected);
      return previews.queue(selected.previewId, async (ctx) => {
        assertReady(ctx); await requireProjectAccess(ctx);
        if (admitted) checkCurrent(admitted);
        if (projectFor(ctx).projectKind !== 'minigame') fail('UNSUPPORTED_PROJECT_ACTION', '此操作仅适用于小游戏。');
        if (!admitted) fail('NO_ACTIVE_FRAME', '请先打开小游戏预览页面。');
        const command = previews.command(ctx.previewId, action === 'restart' ? 'reload' : 'game-control', action === 'restart' ? undefined : action, builds.snapshot(ctx.projectId).buildId);
        return { ok: true, accepted: true, previewId: ctx.previewId, action, commandSeq: command.seq };
      });
    },
    async gameState(input, state) {
      return previews.queue(input.previewId, async (ctx) => {
        checkCurrent(input); await requireProjectAccess(ctx); checkCurrent(input);
        if (projectFor(ctx).projectKind !== 'minigame') fail('UNSUPPORTED_PROJECT_ACTION', '当前工程不是小游戏。');
        previews.reportGameState(input, state); return { ok: true };
      });
    },
    async rebuild(previewId, input = {}) {
      const selected = previews.resolve(previewId);
      return previews.queue(selected.previewId, async (ctx) => {
        if (input.serverEpoch !== undefined) checkEpoch(input);
        assertReady(ctx); await requireProjectAccess(ctx); await builds.rebuild(ctx.projectId);
        previews.command(ctx.previewId, 'reload', undefined, builds.snapshot(ctx.projectId).buildId); return snapshot(ctx.previewId);
      });
    },
    async route(input, route, title) {
      return previews.queue(input.previewId, async (ctx) => {
        checkCurrent(input); await requireProjectAccess(ctx); checkCurrent(input);
        const normalized = normalizePage(ctx, route); await previews.saveDescriptor(ctx, { route: normalized });
        ctx.requestedRoute = null; return { ok: true, title: String(title ?? '').slice(0, 200) };
      });
    },
    async appendLogs(input, entries) {
      return previews.queue(input.previewId, async (ctx) => { checkCurrent(input); await requireProjectAccess(ctx); checkCurrent(input); previews.appendLogs(input, entries); return { ok: true }; });
    },
    async status(input, status, details) {
      return previews.queue(input.previewId, async (ctx) => { checkCurrent(input); await requireProjectAccess(ctx); checkCurrent(input); previews.reportStatus(input, status, details); return { ok: true }; });
    },
    async artifact(previewId, projectId, buildId) {
      await assertArtifactAccess(previewId, projectId, buildId);
      return builds.artifact(projectId, buildId);
    },
    async asset(previewId, projectId, buildId, relative) {
      await assertArtifactAccess(previewId, projectId, buildId);
      return builds.asset(projectId, buildId, relative);
    },
    async snapshotDocument(input) {
      keysOnly(input, identityKeys); validateIdentity(input);
      return previews.queue(input.previewId, async (ctx) => {
        checkCurrent(input, false); await requireProjectAccess(ctx); checkCurrent(input, false);
        if (!pinned(ctx, input.buildId)) fail('BUILD_NOT_AVAILABLE', '页面构建引用已失效。');
        const artifact = builds.artifact(ctx.projectId, input.buildId);
        const assets = [];
        let bytes = Buffer.byteLength(JSON.stringify(artifact));
        if ((artifact.assets?.length ?? 0) > 3000 || bytes > 100 * 1024 * 1024) fail('BUILD_TOO_LARGE', '预览文档超过大小上限。');
        for (const item of artifact.assets ?? []) {
          const content = builds.asset(ctx.projectId, input.buildId, item.path);
          if (!content) fail('BUILD_NOT_AVAILABLE', '预览资源快照不可用。');
          bytes += content.length;
          if (bytes > 100 * 1024 * 1024) fail('BUILD_TOO_LARGE', '预览文档超过大小上限。');
          assets.push({ path: item.path, bytes: content });
        }
        return { identity: clone(input), artifact, assets };
      });
    },
    async dispose() {
      if (disposed) return; disposed = true;
      await previews.dispose(); await builds.dispose();
    },
  };
}
