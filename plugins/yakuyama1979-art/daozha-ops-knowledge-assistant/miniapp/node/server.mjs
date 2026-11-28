// @ts-check

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { complete, LlmError, parseJsonObject } from './lib/llm.mjs';
import { ROUTING_MODES, isRoutingMode } from './lib/router.mjs';
import { DEFAULT_OLLAMA_BASE, listModels, ollamaVersion } from './lib/ollama.mjs';
import { CATEGORIES, deleteDocument, listDocuments, retrieve, saveDocument } from './lib/kb.mjs';
import {
  SUPPORTED_EXTENSIONS,
  extensionOf,
  isSupportedFile,
  parseDocument,
} from './lib/parse/index.mjs';
import {
  applyBlocks,
  buildOutline,
  extractWindow,
  locateByKeywords,
  parsePatchBlocks,
  unifiedDiff,
} from './lib/patch.mjs';
import {
  EDITABLE_EXTENSIONS,
  assertWritable,
  configureWriteRoots,
  getWriteRoots,
  isUnderAny,
} from './lib/paths.mjs';
import { createBackup, listBackups, rollback, sha256 } from './lib/backup.mjs';
import { runDeploy, stopActiveDeploys } from './lib/deploy.mjs';
import { ensureDir, readJson, writeFileAtomic, writeJsonAtomic } from './lib/store.mjs';
import {
  analyzeDocumentPrompt,
  answerQuestionPrompt,
  generatePatchPrompt,
  locateChangePrompt,
  refinePatchPrompt,
} from './lib/prompts.mjs';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const LARGE_FILE_CHARS = 12000;
const MAX_WINDOW_CHARS = 7000;
const DEPLOY_LOG_LIMIT = 50;
const FILE_LIST_LIMIT = 400;

const DEFAULT_SETTINGS = {
  routingMode: 'auto',
  ollamaBase: DEFAULT_OLLAMA_BASE,
  backupRoot: '',
  ingestRoots: [],
  writeRoots: [],
  topK: 6,
  deployCommands: [],
};

/**
 * @param {import('./miniapp-api.js').MiniAppContext} context
 */
export async function start(context) {
  const dataDir = context.dataDir;
  const kbDir = path.join(dataDir, 'kb');
  const patchesDir = path.join(dataDir, 'patches');
  const settingsFile = path.join(dataDir, 'settings.json');
  const deployLogFile = path.join(dataDir, 'deploy-logs.json');
  await ensureDir(kbDir);
  await ensureDir(patchesDir);

  const stored = await readJson(settingsFile, null);
  let settings = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
  if (!isRoutingMode(settings.routingMode)) settings.routingMode = DEFAULT_SETTINGS.routingMode;
  if (!Array.isArray(settings.deployCommands)) settings.deployCommands = DEFAULT_SETTINGS.deployCommands;
  if (!Array.isArray(settings.ingestRoots)) settings.ingestRoots = DEFAULT_SETTINGS.ingestRoots;
  if (!Array.isArray(settings.writeRoots)) settings.writeRoots = DEFAULT_SETTINGS.writeRoots;
  configureWriteRoots(settings.writeRoots);

  const modelContext = {
    ollamaBase: settings.ollamaBase,
    agent: context.agent,
    logger: context.logger,
  };

  /* ------------------------------------------------------------- utilities */

  const sendJson = (response, status, payload) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  };

  const readBody = (request, limit = MAX_UPLOAD_BYTES) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(new Error('payload_too_large'));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
    });

  const readJsonBody = async (request) => {
    const raw = await readBody(request);
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      throw new Error('invalid_json_body');
    }
  };

  const serveAsset = async (response, fileName, contentType) => {
    try {
      const content = await readFile(path.join(context.pluginRoot, 'miniapp/client', fileName));
      response.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'no-store',
        'content-length': content.length,
      });
      response.end(content);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('asset not found');
    }
  };

  /* ----------------------------------------------------------------- state */

  const readState = async () => {
    let ollama = { reachable: false, version: null, models: [], error: null };
    try {
      const [version, models] = await Promise.all([
        ollamaVersion(settings.ollamaBase),
        listModels(settings.ollamaBase),
      ]);
      ollama = {
        reachable: true,
        version,
        error: null,
        models: models.map((model) => ({
          name: model.name,
          capabilities: model.capabilities || [],
          parameterSize: (model.details && model.details.parameter_size) || '',
        })),
      };
    } catch (error) {
      ollama = { ...ollama, error: error instanceof Error ? error.message : String(error) };
    }
    return {
      ok: true,
      settings,
      routingModes: ROUTING_MODES,
      writeRoots: getWriteRoots(),
      categories: CATEGORIES,
      supportedExtensions: SUPPORTED_EXTENSIONS,
      codeExtensions: EDITABLE_EXTENSIONS,
      ollama,
      onlineModel: {
        available: Boolean(context.agent),
        label: 'MiniMax 在线模型（Agent 通道）',
      },
      documents: await listDocuments(kbDir),
      backups: await listBackups(settings.backupRoot),
      deployLogs: (await readJson(deployLogFile, [])) || [],
    };
  };

  const saveSettings = async (patch) => {
    const next = { ...settings };
    if (patch.routingMode !== undefined) {
      if (!isRoutingMode(patch.routingMode)) throw new Error('invalid_routing_mode');
      next.routingMode = patch.routingMode;
    }
    if (patch.ollamaBase !== undefined) {
      const base = String(patch.ollamaBase).trim().replace(/\/+$/, '');
      if (!/^https?:\/\/.+/i.test(base)) throw new Error('invalid_ollama_base');
      next.ollamaBase = base;
    }
    if (patch.backupRoot !== undefined) {
      const root = String(patch.backupRoot).trim();
      if (root && !path.isAbsolute(root)) throw new Error('invalid_backup_root');
      next.backupRoot = root;
    }
    if (patch.ingestRoots !== undefined) {
      if (!Array.isArray(patch.ingestRoots)) throw new Error('invalid_ingest_roots');
      next.ingestRoots = patch.ingestRoots
        .map((root) => String(root).trim())
        .filter(Boolean)
        .map((root) => {
          if (!path.isAbsolute(root)) throw new Error('invalid_ingest_root');
          return root;
        });
    }
    if (patch.writeRoots !== undefined) {
      if (!Array.isArray(patch.writeRoots)) throw new Error('invalid_write_roots');
      next.writeRoots = patch.writeRoots
        .map((root) => String(root).trim())
        .filter(Boolean)
        .map((root) => {
          if (!path.isAbsolute(root)) throw new Error('invalid_write_root');
          return root;
        });
    }
    if (patch.topK !== undefined) {
      const topK = Number(patch.topK);
      if (!Number.isInteger(topK) || topK < 1 || topK > 20) throw new Error('invalid_top_k');
      next.topK = topK;
    }
    if (patch.deployCommands !== undefined) {
      if (!Array.isArray(patch.deployCommands)) throw new Error('invalid_deploy_commands');
      next.deployCommands = patch.deployCommands.map((entry) => {
        const command = String(entry.command || '').trim();
        const workdir = String(entry.workdir || '').trim();
        if (!command) throw new Error('deploy_command_required');
        if (command.length > 500) throw new Error('deploy_command_too_long');
        if (!path.isAbsolute(workdir)) throw new Error('invalid_deploy_workdir');
        const resolved = path.resolve(workdir);
        if (!getWriteRoots().some((root) => isUnderAny(resolved, [root]))) {
          throw new Error('deploy_workdir_outside_allowed_roots: 工作目录必须在允许写入的目录之下');
        }
        return {
          id: String(entry.id || randomUUID()).trim(),
          name: String(entry.name || command).trim(),
          command,
          workdir: resolved,
        };
      });
    }
    settings = next;
    modelContext.ollamaBase = settings.ollamaBase;
    configureWriteRoots(settings.writeRoots);
    await writeJsonAtomic(settingsFile, settings);
    return settings;
  };

  /* -------------------------------------------------------------- documents */

  const ingestDocument = async (body) => {
    const category = String(body.category || '').trim();
    if (!CATEGORIES.includes(category)) throw new Error('invalid_category');

    let name = String(body.name || '').trim();
    let buffer;
    let sourcePath = null;

    if (typeof body.dataBase64 === 'string' && body.dataBase64) {
      buffer = Buffer.from(body.dataBase64, 'base64');
      if (!buffer.length) throw new Error('uploaded_file_empty');
      if (!name) throw new Error('uploaded_file_name_required');
      if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('uploaded_file_too_large');
    } else if (body.path) {
      const requested = path.resolve(String(body.path).trim());
      if (!isUnderAny(requested, settings.ingestRoots)) {
        throw new Error('source_path_outside_ingest_roots: 资料只能从已配置的资料目录读取');
      }
      const info = await stat(requested).catch(() => null);
      if (!info || !info.isFile()) throw new Error('source_file_not_found');
      if (info.size > MAX_UPLOAD_BYTES) throw new Error('source_file_too_large');
      buffer = await readFile(requested);
      sourcePath = requested;
      name = path.basename(requested);
    } else {
      throw new Error('document_source_required');
    }

    if (!isSupportedFile(name)) throw new Error(`unsupported_file_type:${extensionOf(name) || '未知'}`);
    const parsed = parseDocument(name, buffer);

    const prompt = analyzeDocumentPrompt({ name, category, text: parsed.text });
    const analysis = await complete(modelContext, {
      task: 'analyze',
      mode: settings.routingMode,
      system: prompt.system,
      prompt: prompt.prompt,
      signal: context.signal,
    });
    const parsedAnalysis = parseJsonObject(analysis.text) || {};

    const document = await saveDocument({
      kbDir,
      ollamaBase: settings.ollamaBase,
      name,
      category,
      kind: parsed.kind,
      sourcePath,
      sizeBytes: buffer.length,
      text: parsed.text,
      analysis: {
        title: parsedAnalysis.title,
        summary: parsedAnalysis.summary,
        keyPoints: Array.isArray(parsedAnalysis.keyPoints) ? parsedAnalysis.keyPoints : [],
        suggestedCategory: parsedAnalysis.suggestedCategory,
        suggestedCategoryReason: parsedAnalysis.suggestedCategoryReason,
        route: analysis.route,
      },
    });

    return {
      ok: true,
      document,
      analysis: {
        title: parsedAnalysis.title || document.title,
        summary: parsedAnalysis.summary || '',
        keyPoints: document.keyPoints,
        suggestedCategory: parsedAnalysis.suggestedCategory || '',
        suggestedCategoryReason: parsedAnalysis.suggestedCategoryReason || '',
      },
      parseMeta: parsed.meta,
      route: analysis.route,
    };
  };

  /* ------------------------------------------------------------------ files */

  const listFiles = async (url) => {
    const kind = url.searchParams.get('kind') === 'code' ? 'code' : 'document';
    const root = String(url.searchParams.get('root') || '').trim();
    const relative = String(url.searchParams.get('path') || '').trim();
    const allowed = kind === 'code' ? getWriteRoots() : settings.ingestRoots;
    if (!allowed.length) {
      throw new Error(
        kind === 'code'
          ? 'write_roots_not_configured: 请先在「路由与设置」里填写允许写入的目录'
          : 'ingest_roots_not_configured: 请先在「路由与设置」里填写资料目录',
      );
    }
    if (!allowed.some((entry) => isUnderAny(root, [entry]))) {
      throw new Error('directory_not_allowed');
    }
    const base = path.resolve(root);
    const directory = relative ? path.resolve(base, relative) : base;
    if (!isUnderAny(directory, [base])) throw new Error('directory_not_allowed');

    const allowedExtensions = kind === 'code' ? EDITABLE_EXTENSIONS : SUPPORTED_EXTENSIONS;
    const results = [];
    const walk = async (current, depth) => {
      if (depth > 3 || results.length >= FILE_LIST_LIMIT) return;
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (results.length >= FILE_LIST_LIMIT) return;
        if (entry.name.startsWith('.')) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const extension = extensionOf(entry.name);
        if (!allowedExtensions.includes(extension)) continue;
        const info = await stat(full).catch(() => null);
        results.push({
          name: entry.name,
          path: full,
          relative: path.relative(base, full),
          extension,
          sizeBytes: info ? info.size : 0,
        });
      }
    };
    await walk(directory, 0);
    return { ok: true, root: base, kind, files: results };
  };

  /* -------------------------------------------------------------------- ask */

  const ask = async (body) => {
    const question = String(body.question || '').trim();
    if (!question) throw new Error('question_required');
    const topK = body.topK ? Number(body.topK) : settings.topK;
    const { matches } = await retrieve({
      kbDir,
      ollamaBase: settings.ollamaBase,
      question,
      topK,
      signal: context.signal,
    });

    const prompt = answerQuestionPrompt({ question, contexts: matches });
    const result = await complete(modelContext, {
      task: 'answer',
      mode: settings.routingMode,
      system: prompt.system,
      prompt: prompt.prompt,
      signal: context.signal,
    });
    const parsed = parseJsonObject(result.text) || {};
    const citedLabels = Array.isArray(parsed.cited) ? parsed.cited.map(String) : [];
    const cited = citedLabels
      .map((label) => {
        const index = Number.parseInt(label.replace(/^[^0-9]*/, ''), 10) - 1;
        return Number.isFinite(index) ? matches[index] : undefined;
      })
      .filter(Boolean);

    return {
      ok: true,
      question,
      matched: matches.length > 0,
      answer: {
        standardAnswer: parsed.standardAnswer || result.text,
        analysis: parsed.analysis || '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        missing: Array.isArray(parsed.missing) ? parsed.missing : [],
        structured: Boolean(parsed.standardAnswer),
      },
      cited,
      sources: matches.map((match) => ({
        documentId: match.documentId,
        documentName: match.documentName,
        category: match.category,
        chunkIndex: match.chunkIndex,
        score: match.score,
        similarity: match.similarity,
        preview: match.preview,
      })),
      route: result.route,
    };
  };

  /* ------------------------------------------------------------------ patch */

  const createPatch = async (body) => {
    const requirement = String(body.requirement || '').trim();
    if (!requirement) throw new Error('requirement_required');
    const target = await assertWritable(body.targetPath);
    const originalBuffer = await readFile(target.path);
    const original = originalBuffer.toString('utf8');
    const fileName = path.basename(target.path);
    const outline = buildOutline(original);

    let window;
    let locatedBy = 'whole-file';
    if (original.length > LARGE_FILE_CHARS) {
      let region = null;
      const locatePrompt = locateChangePrompt({ fileName, outline, requirement });
      const locateResult = await complete(modelContext, {
        task: 'locate',
        mode: settings.routingMode,
        system: locatePrompt.system,
        prompt: locatePrompt.prompt,
        signal: context.signal,
      });
      const located = parseJsonObject(locateResult.text) || {};
      const startLine = Number(located.startLine);
      const endLine = Number(located.endLine);
      if (
        Number.isFinite(startLine) &&
        Number.isFinite(endLine) &&
        startLine >= 1 &&
        endLine >= startLine &&
        startLine <= outline.totalLines
      ) {
        region = { startLine, endLine: Math.min(endLine, outline.totalLines) };
        locatedBy = 'model';
      }
      if (!region) {
        const fallback = locateByKeywords(original, requirement);
        region = fallback
          ? { startLine: fallback.startLine, endLine: fallback.endLine }
          : { startLine: 1, endLine: Math.min(outline.totalLines, 120) };
        locatedBy = fallback ? 'keyword' : 'file-start';
      }
      window = extractWindow(original, region.startLine, region.endLine, 8);
      if (window.text.length > MAX_WINDOW_CHARS) {
        window = { ...window, text: window.text.slice(0, MAX_WINDOW_CHARS), truncated: true };
      }
    } else {
      window = { from: 1, to: outline.totalLines, text: original, truncated: false };
    }

    let blocks = null;
    let newContent = null;
    let appliedInfo = null;
    let route = null;
    let problem = '模型没有返回 SEARCH/REPLACE 补丁块';

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prompt =
        attempt === 0
          ? generatePatchPrompt({
            fileName,
            requirement,
            window,
            header: outline.header,
          })
          : refinePatchPrompt({
            fileName,
            requirement,
            window,
            header: outline.header,
            problem,
          });
      const result = await complete(modelContext, {
        task: 'patch',
        mode: settings.routingMode,
        system: prompt.system,
        prompt: prompt.prompt,
        requireLarge: settings.routingMode === 'auto',
        signal: context.signal,
      });
      route = result.route;
      const parsedBlocks = parsePatchBlocks(result.text);
      if (!parsedBlocks.length) {
        problem = '模型没有返回可解析的 SEARCH/REPLACE 补丁块';
        continue;
      }
      try {
        const applied = applyBlocks(original, parsedBlocks);
        blocks = parsedBlocks;
        newContent = applied.content;
        appliedInfo = applied.applied;
        break;
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
    }

    if (!blocks) throw new Error(`patch_generation_failed: ${problem}`);

    const relativeLabel = path.relative(target.root, target.path).split(path.sep).join('/');
    const diff = unifiedDiff(original, newContent, `a/${relativeLabel}`, `b/${relativeLabel}`);
    const patchId = randomUUID();
    await writeJsonAtomic(path.join(patchesDir, `${patchId}.json`), {
      id: patchId,
      createdAt: new Date().toISOString(),
      targetPath: target.path,
      root: target.root,
      requirement,
      fileName,
      originalSha256: sha256(originalBuffer),
      originalBytes: originalBuffer.length,
      blocks,
      applied: appliedInfo,
      diff,
      newContent,
      locatedBy,
      window: { from: window.from, to: window.to, truncated: Boolean(window.truncated) },
      status: 'previewed',
    });

    return {
      ok: true,
      patchId,
      targetPath: target.path,
      root: target.root,
      fileName,
      requirement,
      blocks,
      applied: appliedInfo,
      diff,
      locatedBy,
      window: { from: window.from, to: window.to, truncated: Boolean(window.truncated) },
      fileLines: outline.totalLines,
      route,
    };
  };

  const applyPatch = async (body) => {
    const patchId = String(body.patchId || '').trim();
    if (!patchId) throw new Error('patch_id_required');
    const record = await readJson(path.join(patchesDir, `${patchId}.json`), null);
    if (!record) throw new Error('patch_not_found');

    const target = await assertWritable(record.targetPath);
    const currentBuffer = await readFile(target.path);
    if (sha256(currentBuffer) !== record.originalSha256) {
      throw new Error('target_changed_since_preview: 目标文件在预览之后已被修改，请重新生成补丁');
    }

    if (!settings.backupRoot) {
      throw new Error('backup_root_not_configured: 请先在「路由与设置」里填写备份根目录');
    }
    const backup = await createBackup({
      backupRoot: settings.backupRoot,
      targetPath: target.path,
      root: target.root,
      originalBuffer: currentBuffer,
      patch: record.blocks,
      diff: record.diff,
    });

    await writeFileAtomic(target.path, Buffer.from(record.newContent, 'utf8'));
    const afterBuffer = await readFile(target.path);
    const afterSha = sha256(afterBuffer);

    record.status = 'applied';
    record.appliedAt = new Date().toISOString();
    record.backup = {
      id: backup.id,
      directory: backup.backupDirectory,
      file: backup.backupFile,
      manifestPath: path.join(backup.backupDirectory, 'manifest.json'),
      recordPath: path.join(backup.backupDirectory, 'record.json'),
    };
    record.sha256Before = record.originalSha256;
    record.sha256After = afterSha;
    await writeJsonAtomic(path.join(patchesDir, `${patchId}.json`), record);

    return {
      ok: true,
      patchId,
      targetPath: target.path,
      backupPath: backup.backupDirectory,
      backupFile: backup.backupFile,
      manifestPath: record.backup.manifestPath,
      recordPath: record.backup.recordPath,
      backupId: backup.id,
      sha256Before: record.originalSha256,
      sha256After: afterSha,
      diff: record.diff,
    };
  };

  const runRollback = async (body) => {
    const operationId = String(body.operationId || '').trim();
    if (!operationId) throw new Error('operation_id_required');
    if (!settings.backupRoot) {
      throw new Error('backup_root_not_configured: 请先在「路由与设置」里填写备份根目录');
    }
    const result = await rollback({ backupRoot: settings.backupRoot, operationId });
    return { ok: result.ok, ...result };
  };

  /* ----------------------------------------------------------------- deploy */

  const deploy = async (body) => {
    const commandId = String(body.commandId || '').trim();
    const entry = settings.deployCommands.find((item) => item.id === commandId);
    if (!entry) throw new Error('deploy_command_not_found');
    const cwd = path.resolve(entry.workdir);
    if (!getWriteRoots().some((root) => isUnderAny(cwd, [root]))) {
      throw new Error('deploy_workdir_outside_allowed_roots');
    }
    const result = await runDeploy({
      command: entry.command,
      cwd,
      timeoutMs: 120000,
      signal: context.signal,
    });
    const log = {
      id: randomUUID(),
      at: new Date().toISOString(),
      commandId: entry.id,
      name: entry.name,
      command: entry.command,
      workdir: cwd,
      ok: result.ok,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
    const logs = (await readJson(deployLogFile, [])) || [];
    logs.unshift(log);
    await writeJsonAtomic(deployLogFile, logs.slice(0, DEPLOY_LOG_LIMIT));
    return { ok: true, log, logs: logs.slice(0, DEPLOY_LOG_LIMIT) };
  };

  /* ------------------------------------------------------------------ routes */

  const routeApi = async (route, method, url, request) => {
    if (method === 'GET' && route === '/api/state') return readState();
    if (method === 'POST' && route === '/api/settings') {
      const body = await readJsonBody(request);
      return { ok: true, settings: await saveSettings(body) };
    }
    if (method === 'GET' && route === '/api/documents') {
      return { ok: true, documents: await listDocuments(kbDir) };
    }
    if (method === 'POST' && route === '/api/documents') {
      const body = await readJsonBody(request);
      return ingestDocument(body);
    }
    if (method === 'DELETE' && route === '/api/documents') {
      const id = String(url.searchParams.get('id') || '').trim();
      if (!id) throw new Error('document_id_required');
      const removed = await deleteDocument(kbDir, id);
      if (!removed) throw new Error('document_not_found');
      return { ok: true, documentId: id };
    }
    if (method === 'GET' && route === '/api/files') return listFiles(url);
    if (method === 'POST' && route === '/api/ask') {
      const body = await readJsonBody(request);
      return ask(body);
    }
    if (method === 'POST' && route === '/api/patch') {
      const body = await readJsonBody(request);
      return createPatch(body);
    }
    if (method === 'POST' && route === '/api/patch/apply') {
      const body = await readJsonBody(request);
      return applyPatch(body);
    }
    if (method === 'GET' && route === '/api/backups') {
      return { ok: true, backups: await listBackups(settings.backupRoot) };
    }
    if (method === 'POST' && route === '/api/rollback') {
      const body = await readJsonBody(request);
      return runRollback(body);
    }
    if (method === 'POST' && route === '/api/deploy') {
      const body = await readJsonBody(request);
      return deploy(body);
    }
    throw new Error('not_found');
  };

  const handle = async (request, response) => {
    const url = new URL(request.url || '/', 'http://miniapp.local');
    const route = url.pathname;
    const method = request.method || 'GET';

    if (method === 'GET' && (route === '/' || route === '/dashboard')) {
      await serveAsset(response, 'index.html', 'text/html; charset=utf-8');
      return;
    }
    if (method === 'GET' && route === '/app.js') {
      await serveAsset(response, 'app.js', 'text/javascript; charset=utf-8');
      return;
    }
    if (method === 'GET' && route === '/styles.css') {
      await serveAsset(response, 'styles.css', 'text/css; charset=utf-8');
      return;
    }
    if (route.startsWith('/api/')) {
      try {
        const payload = await routeApi(route, method, url, request);
        sendJson(response, 200, payload);
      } catch (error) {
        const code =
          error instanceof LlmError
            ? error.code
            : String((error && error.message) || 'request_failed').split(':')[0];
        const message = error instanceof Error ? error.message : String(error);
        context.logger.warn('miniapp.request.failed', { route, code });
        sendJson(response, 400, { ok: false, error: code, message });
      }
      return;
    }
    sendJson(response, 404, { ok: false, error: 'not_found', message: '未知路由' });
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      context.logger.error('miniapp.request.unhandled', { message: String(error && error.message) });
      if (!response.headersSent) {
        sendJson(response, 500, {
          ok: false,
          error: 'internal_error',
          message: error instanceof Error ? error.message : '未知错误',
        });
      } else {
        response.end();
      }
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  context.logger.info('miniapp.runtime.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    stopActiveDeploys();
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
