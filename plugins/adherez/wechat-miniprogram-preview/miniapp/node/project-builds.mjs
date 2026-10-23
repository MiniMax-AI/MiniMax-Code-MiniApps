import { createHash } from 'node:crypto';
import { constants, watch } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertSnapshotIdentity, collectProjectSnapshot, compileProject, COMPILER_FINGERPRINT, resolveProject } from './compiler.mjs';
import { createBuildCache } from './build-cache.mjs';
import { PreviewError } from './preview-contexts.mjs';
import { isWithin } from './project-access.mjs';

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_BUILD_BYTES = 100 * 1024 * 1024;
const DEFAULT_TOTAL_BYTES = 192 * 1024 * 1024;
const DEFAULT_BUILD_COUNT = 16;
const MAX_BUILD_ASSETS = 3000;
const validId = (value) => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const validAssetPath = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !value.includes('\\') && !value.includes('\0') && !path.posix.isAbsolute(value)
  && path.posix.normalize(value) === value && !value.startsWith('../') && value !== '..' && value !== '.';

async function snapshotAsset(root, asset) {
  if (!asset || !validAssetPath(asset.path) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || asset.bytes > MAX_ASSET_BYTES
    || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new PreviewError('INVALID_BUILD_ASSET', '构建资源路径或指纹无效。');
  root = await realpath(root);
  const file = path.resolve(root, ...asset.path.split('/'));
  if (!isWithin(root, file)) throw new PreviewError('INVALID_BUILD_ASSET', '构建资源超出工程目录。');
  const before = await lstat(file);
  const resolved = await realpath(file);
  if (!before.isFile() || before.isSymbolicLink() || !isWithin(root, resolved) || before.size > MAX_ASSET_BYTES) throw new PreviewError('INVALID_BUILD_ASSET', '构建资源不可读取。');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev) throw new PreviewError('PROJECT_CHANGED', '构建期间资源发生变化，请重试。');
    const buffer = Buffer.alloc(Math.min(info.size, MAX_ASSET_BYTES) + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const result = buffer.subarray(0, total);
    if (total !== asset.bytes || total > MAX_ASSET_BYTES || createHash('sha256').update(result).digest('hex') !== asset.sha256) throw new PreviewError('PROJECT_CHANGED', '构建期间资源发生变化，请重试。');
    return result;
  } finally { await handle.close(); }
}

function errorDiagnostic(error) {
  return {
    file: typeof error.file === 'string' ? error.file : '',
    code: typeof error.code === 'string' ? error.code : 'BUILD_FAILED',
    message: error instanceof Error ? error.message : '构建失败。',
    ...(Number.isInteger(error.line) ? { line: error.line } : {}),
    ...(Number.isInteger(error.column) ? { column: error.column } : {}),
    ...(Array.isArray(error.candidates) ? {
      candidates: error.candidates.filter((value) => typeof value === 'string').slice(0, 20),
      candidateCount: Number.isSafeInteger(error.candidateCount) ? error.candidateCount : error.candidates.length,
      truncated: error.truncated === true || error.candidates.length > 20,
    } : {}),
  };
}

/** One compiler/watcher per project, immutable artifacts pinned by live preview frames. */
export function createProjectBuilds({ assertProjectAccess, onEvent = () => {}, maxProjects = 4,
  maxBytes = DEFAULT_TOTAL_BYTES, maxBuilds = DEFAULT_BUILD_COUNT, debounceMs = 200, releaseGraceMs = 30000,
  maxBuildBytes = MAX_BUILD_BYTES, maxAssets = MAX_BUILD_ASSETS, compile = compileProject,
  dataDir, cacheMaxBytes, cacheMaxEntries, collectSnapshot = compile === compileProject ? collectProjectSnapshot : null,
  compilerFingerprint = COMPILER_FINGERPRINT } = {}) {
  for (const value of [maxProjects, maxBytes, maxBuilds, maxBuildBytes, maxAssets]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new PreviewError('INVALID_ARGUMENTS', '预览构建容量必须为正整数。');
  }
  const records = new Map();
  const pendingBuilds = new Set();
  const artifacts = new Map();
  const pins = new Map();
  let cache = null;
  let cacheError = null;
  const cacheReady = dataDir && collectSnapshot ? createBuildCache(dataDir, {
    ...(cacheMaxBytes === undefined ? {} : { maxBytes: cacheMaxBytes }),
    ...(cacheMaxEntries === undefined ? {} : { maxEntries: cacheMaxEntries }),
  }).then((value) => { cache = value; }, (error) => { cacheError = error.code ?? 'BUILD_CACHE_UNAVAILABLE'; }) : Promise.resolve();
  let disposed = false;
  const artifactKey = (projectId, buildId) => `${projectId}/${buildId}`;
  const getRecord = (projectId) => {
    const record = records.get(projectId);
    if (!record) throw new PreviewError('PROJECT_NOT_FOUND', '工程未登记。');
    return record;
  };
  const ensureActive = () => {
    if (disposed) throw new PreviewError('PREVIEW_STOPPING', '预览服务正在停止。');
  };
  const emit = (record) => {
    if (!disposed && records.get(record.project.id) === record) onEvent(record.project.id, snapshot(record.project.id));
  };
  const snapshot = (projectId) => {
    const record = getRecord(projectId);
    return structuredClone(record.state);
  };
  const liveKeys = () => new Set([...records.values()].filter((record) => record.references.size && record.state.buildId).map((record) => artifactKey(record.project.id, record.state.buildId)));
  const evictFor = (incomingKey, incomingBytes) => {
    const existingBytes = artifacts.get(incomingKey)?.bytes ?? 0;
    let total = [...artifacts.values()].reduce((sum, artifact) => sum + artifact.bytes, 0) - existingBytes;
    let count = artifacts.size - (artifacts.has(incomingKey) ? 1 : 0);
    const current = liveKeys();
    const incomingProject = incomingKey.split('/')[0];
    const candidates = [...artifacts.entries()].filter(([key, artifact]) => key !== incomingKey && artifact.owners.size === 0 && !artifact.reservations && (!current.has(key) || key.startsWith(incomingProject + '/'))).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const deletions = [];
    for (const [key, artifact] of candidates) {
      if (total + incomingBytes <= maxBytes && count + 1 <= maxBuilds) break;
      deletions.push(key); total -= artifact.bytes; count--;
    }
    if (total + incomingBytes > maxBytes || count + 1 > maxBuilds) throw new PreviewError('BUILD_CAPACITY_REACHED', '旧预览仍引用构建产物，容量已满。请处理未保存状态或关闭旧预览后重试。');
    for (const key of deletions) artifacts.delete(key);
  };
  const stopWatch = (record) => {
    for (const watcher of record.watchers) watcher.close();
    record.watchers = []; record.watchKey = '';
    clearTimeout(record.debounce); record.debounce = null;
  };
  const ensureWatch = (record) => {
    if (!record.references.size || disposed || records.get(record.project.id) !== record) return;
    const projectRoot = record.projectRoot ?? record.project.path;
    const root = record.sourceRoot ?? projectRoot;
    const key = `${projectRoot}:${root}`;
    if (record.watchers.length && record.watchKey === key) return;
    stopWatch(record);
    const watchFailed = (error) => {
      stopWatch(record);
      record.watchError = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
      record.state.warnings = [...(record.state.warnings ?? []).filter((warning) => warning.code !== 'WATCH_UNAVAILABLE'), {
        code: 'WATCH_UNAVAILABLE', file: '', message: `文件监听不可用（${record.watchError}），请手动重新构建。`, details: { cause: record.watchError },
      }];
      emit(record);
    };
    const schedule = (file) => {
      if (file && /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(String(file))) return;
      clearTimeout(record.debounce);
      record.debounce = setTimeout(() => {
        record.debounce = null;
        if (!disposed && record.references.size && records.get(record.project.id) === record) void rebuild(record.project.id).catch(() => undefined);
      }, debounceMs);
    };
    try {
      const sourceWatcher = watch(root, { recursive: true }, (_event, file) => schedule(file));
      sourceWatcher.on('error', watchFailed);
      record.watchers.push(sourceWatcher);
      if (root !== projectRoot) {
        const configWatcher = watch(projectRoot, (_event, file) => { if (String(file) === 'project.config.json') schedule(file); });
        configWatcher.on('error', watchFailed); record.watchers.push(configWatcher);
      }
      record.watchKey = key;
      record.watchError = null;
      record.state.warnings = (record.state.warnings ?? []).filter((warning) => warning.code !== 'WATCH_UNAVAILABLE');
    } catch (error) { watchFailed(error); }
  };
  const rebuild = async (projectId) => {
    const record = getRecord(projectId);
    ensureActive();
    if (record.running) { record.dirty = true; return record.running; }
    record.running = (async () => {
      do {
        record.dirty = false;
        const generation = ++record.generation;
        const startedAt = Date.now();
        record.state = { ...record.state, status: 'building', generation, startedAt };
        emit(record);
        let reservedArtifact;
        try {
          if (assertProjectAccess) await assertProjectAccess(record.project.path);
          record.projectRoot = await realpath(record.project.path);
          if (record.references.size) {
            // Subscribe before collecting a build snapshot. Registering only
            // after publication misses writes in the watcher startup window.
            if (compile === compileProject) record.sourceRoot = (await resolveProject(record.project.path, { projectKind: record.project.projectKind })).sourceRoot;
            ensureWatch(record);
          }
          await cacheReady;
          let compiled;
          let source;
          let cacheKey = null;
          let cacheState = { status: cacheError ? 'unavailable' : 'disabled', ...(cacheError ? { cause: cacheError } : {}) };
          let request;
          if (cache && collectSnapshot) {
            source = await collectSnapshot(record.project.path, { projectKind: record.project.projectKind });
            request = { projectPath: record.project.path, compilerFingerprint, sourceHash: source.sourceHash };
            cacheState = await cache.lookup(request);
            cacheKey = cacheState.key ?? null;
            if (cacheState.status === 'hit') compiled = { ...cacheState.artifact, project: source.project };
            else compiled = await compile(record.project.path, { snapshot: source, projectKind: record.project.projectKind });
          } else if (collectSnapshot) {
            source = await collectSnapshot(record.project.path, { projectKind: record.project.projectKind });
            compiled = await compile(record.project.path, { snapshot: source, projectKind: record.project.projectKind });
          } else compiled = await compile(record.project.path, { projectKind: record.project.projectKind });
          if (source?.identities) await assertSnapshotIdentity(source);
          const result = structuredClone(compiled);
          if (disposed || records.get(projectId) !== record) return record.state;
          if (!result || !validId(result.buildId) || !Array.isArray(result.errors) || !Array.isArray(result.warnings)
            || typeof result.css !== 'string' || !result.payload || typeof result.payload !== 'object'
            || !Array.isArray(result.assets ?? [])) throw new PreviewError('INVALID_BUILD_RESULT', '编译器返回了无效构建结果。');
          record.sourceRoot = await realpath(result.project.sourceRoot);
          const projectRoot = await realpath(record.project.path);
          if (!isWithin(projectRoot, record.sourceRoot)) throw new PreviewError('INVALID_BUILD_ASSET', '编译器源码目录超出授权工程。');
          const summary = {
            status: result.errors.length ? 'error' : 'ok', generation, startedAt, finishedAt: Date.now(),
            buildId: result.buildId, errors: result.errors, warnings: result.warnings, manifest: result.manifest,
            projectKind: result.project.projectKind ?? record.project.projectKind ?? 'miniprogram',
            cache: { status: cacheState.status, ...(cacheState.cause ? { cause: cacheState.cause } : {}) },
          };
          if (!result.errors.length) {
            const key = artifactKey(projectId, result.buildId);
            const assets = new Map();
            let bytes = Buffer.byteLength(JSON.stringify(result)) + Buffer.byteLength(JSON.stringify([...(result.project.configuration ?? [])]));
            if (bytes > maxBuildBytes || (result.assets?.length ?? 0) > maxAssets) throw new PreviewError('BUILD_TOO_LARGE', '构建产物超过单工程预览上限。');
            for (const asset of result.assets ?? []) {
              if (assets.has(asset.path)) throw new PreviewError('INVALID_BUILD_ASSET', '构建资源路径重复。');
              const content = await snapshotAsset(result.project.sourceRoot, asset);
              bytes += content.length;
              if (bytes > maxBuildBytes) throw new PreviewError('BUILD_TOO_LARGE', '构建产物超过单工程预览上限。');
              assets.set(asset.path, content);
            }
            if (assertProjectAccess) await assertProjectAccess(record.project.path);
            if (source?.identities) await assertSnapshotIdentity(source);
            if (disposed || records.get(projectId) !== record) return record.state;
            const previous = artifacts.get(key);
            const signature = createHash('sha256').update(JSON.stringify(result.payload)).update('\0').update(result.css)
              .update('\0').update(JSON.stringify((result.assets ?? []).slice().sort((a, b) => a.path.localeCompare(b.path)))).digest('hex');
            if (previous && previous.signature !== signature) throw new PreviewError('BUILD_ID_COLLISION', '同一构建标识对应不同内容，已保留原预览产物。');
            if (!previous) {
              evictFor(key, bytes);
              artifacts.set(key, { result, assets, bytes, signature, owners: new Set(), cacheKeys: new Set(), reservations: 0, lastUsed: Date.now() });
            }
            reservedArtifact = artifacts.get(key);
            reservedArtifact.reservations++;
            if (cache && request && cacheState.status !== 'hit') {
              const { project: _project, ...cacheArtifact } = result;
              const stored = await cache.store(request, cacheArtifact);
              summary.cache.storeStatus = stored.status;
              if (stored.status === 'stored' || stored.status === 'exists') cacheKey = stored.key;
              else cacheKey = null;
            }
            const artifact = artifacts.get(key);
            for (const previousKey of artifact?.cacheKeys ?? []) {
              if (!cache?.has(previousKey)) artifact.cacheKeys.delete(previousKey);
            }
            if (cache && cacheKey && artifact && artifact.cacheKeys.size === 0) {
              // Several source hashes can produce one immutable build. Pin one
              // equivalent cache copy, not every unrelated source-file edit.
              artifact.cacheKeys.add(cacheKey);
              for (const owner of artifact.owners) cache.pin(cacheKey, `${owner}:${cacheKey}`);
            }
          }
          if (disposed || records.get(projectId) !== record) return record.state;
          record.state = summary;
        } catch (error) {
          if (disposed || records.get(projectId) !== record) return record.state;
          record.state = { ...record.state, status: 'error', generation, startedAt, finishedAt: Date.now(), errors: [errorDiagnostic(error)], warnings: [], manifest: null };
        } finally { if (reservedArtifact) reservedArtifact.reservations--; }
        ensureWatch(record);
        emit(record);
      } while (record.dirty && !disposed && records.get(projectId) === record);
      return record.state;
    })().finally(() => { pendingBuilds.delete(record.running); record.running = null; });
    pendingBuilds.add(record.running);
    return record.running;
  };

  return {
    register(project) {
      ensureActive();
      if (!project || !validId(project.id) || typeof project.path !== 'string' || !path.isAbsolute(project.path) || project.path.includes('\0')
        || (project.projectKind !== undefined && !['miniprogram', 'minigame'].includes(project.projectKind))) throw new PreviewError('INVALID_ARGUMENTS', '工程记录无效。');
      const existing = records.get(project.id);
      if (existing) {
        if (path.resolve(existing.project.path) !== path.resolve(project.path) || (existing.project.projectKind ?? 'miniprogram') !== (project.projectKind ?? 'miniprogram')) throw new PreviewError('PROJECT_CHANGED', '工程标识不能被重新绑定到其他目录或类型。');
        existing.project = { ...project }; return;
      }
      records.set(project.id, { project: { ...project }, projectRoot: null, references: new Set(), watchers: [], watchKey: '', watchError: null, debounce: null, releaseTimer: null, sourceRoot: null, running: null, dirty: false, generation: 0, state: { status: 'idle', buildId: null, errors: [], warnings: [], manifest: null } });
    },
    snapshot, rebuild,
    async acquire(projectId, previewId) {
      ensureActive();
      if (!validId(previewId)) throw new PreviewError('INVALID_ARGUMENTS', '预览标识无效。');
      const record = getRecord(projectId);
      const activeProjects = [...records.values()].filter((item) => item.references.size).length;
      if (!record.references.size && activeProjects >= maxProjects) throw new PreviewError('PROJECT_CAPACITY_REACHED', '同时预览的工程已达到上限。', { resource: 'active_projects', limit: maxProjects, current: activeProjects });
      const reconnecting = record.references.size === 0;
      clearTimeout(record.releaseTimer); record.releaseTimer = null;
      record.references.add(previewId);
      if (record.running) await record.running;
      else if (record.state.status === 'idle' || reconnecting) await rebuild(projectId);
      else ensureWatch(record);
      return snapshot(projectId);
    },
    release(projectId, previewId) {
      const record = records.get(projectId);
      if (!record) return;
      record.references.delete(previewId);
      if (!record.references.size && !record.releaseTimer) record.releaseTimer = setTimeout(() => {
        record.releaseTimer = null;
        if (!record.references.size) stopWatch(record);
      }, releaseGraceMs);
    },
    pin(projectId, buildId, owner) {
      ensureActive();
      if (typeof owner !== 'string' || !owner || owner.length > 500) throw new PreviewError('INVALID_ARGUMENTS', '构建引用标识无效。');
      const key = artifactKey(projectId, buildId);
      const artifact = artifacts.get(key);
      if (!artifact) throw new PreviewError('BUILD_NOT_AVAILABLE', '构建产物已不可用，请重新构建。');
      const previous = pins.get(owner);
      if (previous && previous !== key) {
        const old = artifacts.get(previous);
        old?.owners.delete(owner);
        for (const cacheKey of old?.cacheKeys ?? []) cache?.unpin(`${owner}:${cacheKey}`);
      }
      pins.set(owner, key); artifact.owners.add(owner); artifact.lastUsed = Date.now();
      for (const cacheKey of artifact.cacheKeys) cache?.pin(cacheKey, `${owner}:${cacheKey}`);
    },
    unpin(owner) {
      const key = pins.get(owner);
      if (key) {
        const artifact = artifacts.get(key);
        artifact?.owners.delete(owner);
        for (const cacheKey of artifact?.cacheKeys ?? []) cache?.unpin(`${owner}:${cacheKey}`);
      }
      pins.delete(owner);
    },
    hasPin(projectId, buildId, owner) {
      const key = artifactKey(projectId, buildId);
      return pins.get(owner) === key && artifacts.get(key)?.owners.has(owner) === true;
    },
    artifact(projectId, buildId) {
      const artifact = artifacts.get(artifactKey(projectId, buildId));
      if (!artifact) throw new PreviewError('BUILD_NOT_AVAILABLE', '构建产物已不可用，请重新构建。');
      artifact.lastUsed = Date.now();
      return structuredClone(artifact.result);
    },
    asset(projectId, buildId, relative) {
      if (!validAssetPath(relative)) return null;
      const artifact = artifacts.get(artifactKey(projectId, buildId));
      const content = artifact?.assets.get(relative);
      if (!content) return null;
      artifact.lastUsed = Date.now();
      return Buffer.from(content);
    },
    remove(projectId) {
      const record = records.get(projectId);
      if (record) { clearTimeout(record.releaseTimer); stopWatch(record); records.delete(projectId); }
      for (const [key, artifact] of artifacts) {
        if (!key.startsWith(projectId + '/')) continue;
        for (const owner of artifact.owners) {
          pins.delete(owner);
          for (const cacheKey of artifact.cacheKeys) cache?.unpin(`${owner}:${cacheKey}`);
        }
        artifacts.delete(key);
      }
    },
    inspect() {
      return { projects: [...records.values()].map((record) => ({ projectId: record.project.id, references: record.references.size, watching: record.watchers.length > 0, watcherCount: record.watchers.length, watchError: record.watchError, generation: record.generation })),
        artifacts: [...artifacts.entries()].map(([key, artifact]) => ({ key, bytes: artifact.bytes, pins: artifact.owners.size })),
        cache: cache ? cache.inspect() : { status: cacheError ? 'unavailable' : 'disabled', cause: cacheError } };
    },
    async dispose() {
      disposed = true;
      for (const record of records.values()) { clearTimeout(record.releaseTimer); stopWatch(record); }
      await Promise.allSettled([...pendingBuilds]);
      await cacheReady;
      await cache?.dispose();
      records.clear(); artifacts.clear(); pins.clear();
    },
  };
}
