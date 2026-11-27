// @ts-check

/**
 * 公众号图文工作台 — Node runtime.
 *
 * One domain service owns every mutation. The page talks to narrow business
 * routes; durable state lives in dataDir; tool and Agent calls happen only
 * inside request handlers, never during startup.
 */

import { readFile, readdir, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createStore } from './store.mjs';
import { findStyle } from './styles.mjs';
import { buildPlan, checkDuplicate, deriveContent, toPlainBody, toStandaloneHtml, toWeChatHtml } from './content.mjs';
import { renderImages } from './images.mjs';
import { CHECK_KEYS, evaluateGates, interfaceReadiness, manualReadiness, publishViaInterface } from './publishing.mjs';
import { createPolisher } from './polisher.mjs';

const STATUS_LABELS = {
  draft: '草稿',
  ready: '待发布',
  published_api: '已发布（接口）',
  published_manual: '已发布（手动）',
  archived: '已归档',
};

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * @param {any} context
 * @returns {Promise<any>}
 */
export async function start(context) {
  const store = createStore(context.dataDir);
  await store.init();
  const polisher = createPolisher(context);
  const assetsDir = join(context.dataDir, 'assets');

  const clientEntry = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'), 'utf8');

  /* ---------------------------------------------------------------- *
   * Helpers
   * ---------------------------------------------------------------- */

  /**
   * @param {any} draft
   * @returns {any}
   */
  function decorate(draft) {
    const style = findStyle(draft.styleId || 'style-minimal', store.styles());
    return {
      ...draft,
      styleName: style.name,
      derived: deriveContent(draft),
      plan: buildPlan(draft, style),
      duplicate: checkDuplicate(draft, store.state.drafts),
      publishChecks: store.state.publishChecks[draft.id] || null,
    };
  }

  /**
   * @returns {any}
   */
  function snapshot() {
    return {
      drafts: store.state.drafts.map(decorate),
      styles: store.styles(),
      statusLabels: STATUS_LABELS,
      notice: store.state.notice || '',
      updatedAt: store.state.updatedAt || '',
    };
  }

  /**
   * @param {any} draft
   * @returns {string}
   */
  function safeFileName(draft) {
    const base =
      String(draft.title || draft.topic || 'article')
        .replace(/[\\/:*?"<>|]/g, '')
        .trim()
        .slice(0, 40) || 'article';
    return `${base}-v${draft.version}.html`;
  }

  /**
   * Load the rendered assets of one draft as data URIs.
   *
   * @param {any} draft
   * @returns {Promise<Map<string, { mime: string, dataUri: string }>>}
   */
  async function collectAssetData(draft) {
    /** @type {Map<string, { mime: string, dataUri: string }>} */
    const map = new Map();
    const assets = draft.assets || {};
    /** @type {any[]} */
    const list = [];
    if (assets.cover) list.push(['cover', assets.cover]);
    for (const [slotId, asset] of Object.entries(assets.illustrations || {})) {
      list.push([slotId, asset]);
    }
    let files = [];
    try {
      files = await readdir(assetsDir);
    } catch {
      files = [];
    }
    for (const [slotId, asset] of list) {
      const match = files.find((name) => name.startsWith(`${asset.assetId}.`));
      if (!match) continue;
      try {
        const bytes = await readFile(join(assetsDir, match));
        const mime = match.endsWith('.png') ? 'image/png' : match.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        map.set(slotId, { mime, dataUri: `data:${mime};base64,${bytes.toString('base64')}` });
      } catch {
        // A missing asset file simply leaves the slot without an image.
      }
    }
    return map;
  }

  /**
   * The local path of every rendered asset of one draft.
   *
   * An interface that uploads images takes file paths, not media ids, so the
   * app has to be able to say where the rendered file is on this machine.
   *
   * @param {any} draft
   * @returns {{ cover: string, illustrations: Record<string, string> }}
   */
  function collectAssetPaths(draft) {
    const assets = draft.assets || {};
    /** @type {Record<string, string>} */
    const illustrations = {};
    for (const [slotId, asset] of Object.entries(assets.illustrations || {})) {
      if (!asset?.assetId) continue;
      illustrations[slotId] = join(assetsDir, `${asset.assetId}${asset.ext || '.jpg'}`);
    }
    return {
      cover: assets.cover?.assetId ? join(assetsDir, `${assets.cover.assetId}${assets.cover.ext || '.jpg'}`) : '',
      illustrations,
    };
  }

  /**
   * Remove asset files that no remaining draft references any more.
   *
   * @param {any[]} removed
   */
  async function pruneAssets(removed) {
    const candidate = new Set();
    for (const draft of removed) {
      if (draft?.assets?.cover?.assetId) candidate.add(draft.assets.cover.assetId);
      for (const asset of Object.values(draft?.assets?.illustrations || {})) {
        if (asset?.assetId) candidate.add(asset.assetId);
      }
    }
    if (!candidate.size) return;

    const stillUsed = new Set();
    for (const draft of store.state.drafts) {
      if (draft?.assets?.cover?.assetId) stillUsed.add(draft.assets.cover.assetId);
      for (const asset of Object.values(draft?.assets?.illustrations || {})) {
        if (asset?.assetId) stillUsed.add(asset.assetId);
      }
    }

    let files = [];
    try {
      files = await readdir(assetsDir);
    } catch {
      files = [];
    }
    for (const file of files) {
      const assetId = file.split('.')[0];
      if (candidate.has(assetId) && !stillUsed.has(assetId)) {
        try {
          await unlink(join(assetsDir, file));
        } catch {
          // A missing file is already the desired end state.
        }
      }
    }
  }

  /**
   * @param {any} response
   * @param {number} status
   * @param {any} payload
   */
  function sendJson(response, status, payload) {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify(payload));
  }

  /**
   * @param {any} request
   * @returns {Promise<any>}
   */
  async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('请求体过大');
        error.code = 'BODY_TOO_LARGE';
        throw error;
      }
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    const text = Buffer.concat(chunks).toString('utf8');
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      const error = new Error('请求体不是合法 JSON');
      error.code = 'BAD_JSON';
      throw error;
    }
  }

  /**
   * Apply a field patch. A changed body always becomes a new version of the
   * same article; the previous version is kept.
   *
   * @param {any} draft
   * @param {any} patch
   * @param {string} source
   * @returns {Promise<any>}
   */
  async function applyPatch(draft, patch, source) {
    const bodyChanged = typeof patch.body === 'string' && patch.body !== draft.body;
    if (!bodyChanged) {
      Object.assign(draft, {
        title: patch.title ?? draft.title,
        topic: patch.topic ?? draft.topic,
        coverRequirement: patch.coverRequirement ?? draft.coverRequirement,
        illustrationRequirement: patch.illustrationRequirement ?? draft.illustrationRequirement,
        styleId: patch.styleId ?? draft.styleId,
        coverRatio: patch.coverRatio ?? draft.coverRatio,
        coverWithTitle: patch.coverWithTitle ?? draft.coverWithTitle,
        updatedAt: new Date().toISOString(),
      });
      draft.derived = deriveContent(draft);
      return draft;
    }
    const next = {
      ...draft,
      id: randomUUID(),
      version: draft.version + 1,
      title: patch.title ?? draft.title,
      body: patch.body,
      status: 'draft',
      publish: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versionSource: source,
      assetsInheritedFrom: draft.version,
    };
    next.derived = deriveContent(next);
    store.state.drafts.push(next);
    return next;
  }

  /**
   * Save a polished body as a new version of the article.
   *
   * Used by the polish run itself and by the continuation after a
   * questionnaire, so both paths save a version the same way.
   *
   * @param {string} draftId
   * @param {string} body
   * @param {string} source
   * @returns {Promise<any>}
   */
  async function commitPolish(draftId, body, source) {
    const target = store.draft(draftId);
    if (!target) {
      const error = new Error('草稿已不存在，润色结果没有保存');
      error.code = 'DRAFT_NOT_FOUND';
      throw error;
    }
    let saved;
    await store.mutate(async () => {
      saved = await applyPatch(target, { body }, source);
    });
    return saved;
  }

  /* ---------------------------------------------------------------- *
   * Routes
   * ---------------------------------------------------------------- */

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    try {
      if (method === 'GET' && (path === '/' || path === '/dashboard')) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(clientEntry);
        return;
      }

      // Client payload files (styles.css, app.js, …) served from the package.
      if (method === 'GET' && path.startsWith('/') && !path.startsWith('/api/')) {
        const relative = path.slice(1);
        if (!/^[A-Za-z0-9._-]+$/.test(relative) || relative.includes('..')) {
          sendJson(response, 404, { error: 'not_found' });
          return;
        }
        const ext = relative.slice(relative.lastIndexOf('.')).toLowerCase();
        const types = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.mjs': 'text/javascript; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ico': 'image/x-icon',
        };
        try {
          const bytes = await readFile(join(context.pluginRoot, 'miniapp/client', relative));
          response.writeHead(200, {
            'content-type': types[ext] || 'application/octet-stream',
            'cache-control': 'no-store',
          });
          response.end(bytes);
        } catch {
          sendJson(response, 404, { error: 'not_found' });
        }
        return;
      }

      if (method === 'GET' && path === '/api/state') {
        sendJson(response, 200, snapshot());
        return;
      }

      if (method === 'GET' && path === '/api/tools') {
        if (!context.tool) {
          sendJson(response, 200, { tools: [], partial: false, error: '当前 Mini App 未获得工具调用权限' });
          return;
        }
        try {
          const listed = await context.tool.list();
          sendJson(response, 200, {
            tools: (listed.tools || []).map((/** @type {any} */ tool) => ({
              name: tool.name,
              kind: tool.kind,
              provider: tool.provider || tool.server || '',
              tool: tool.tool,
              permission: tool.permission,
            })),
            partial: Boolean(listed.partial),
            error: '',
          });
        } catch (error) {
          sendJson(response, 200, {
            tools: [],
            partial: false,
            error: `工具清单读取失败：${/** @type {any} */ (error)?.code || '未知错误'}`,
          });
        }
        return;
      }

      if (method === 'GET' && path.startsWith('/api/assets/')) {
        const assetId = path.slice('/api/assets/'.length);
        if (!/^[A-Za-z0-9-]+$/.test(assetId)) {
          sendJson(response, 400, { error: 'bad_asset_id' });
          return;
        }
        let files = [];
        try {
          files = await readdir(assetsDir);
        } catch {
          files = [];
        }
        const match = files.find((name) => name.startsWith(`${assetId}.`));
        if (!match) {
          sendJson(response, 404, { error: 'asset_not_found' });
          return;
        }
        const bytes = await readFile(join(assetsDir, match));
        const mime = match.endsWith('.png') ? 'image/png' : match.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
        response.end(bytes);
        return;
      }

      if (method === 'POST' && path === '/api/drafts') {
        const body = await readJson(request);
        const topic = String(body.topic ?? '').trim();
        const text = String(body.body ?? '').trim();
        if (!topic) {
          sendJson(response, 400, { error: 'topic_required', message: '请填写文章主题' });
          return;
        }
        if (!text) {
          sendJson(response, 400, { error: 'body_required', message: '请填写正文' });
          return;
        }
        const styleId = findStyle(body.styleId || 'style-minimal', store.styles()).id;
        const draft = {
          id: randomUUID(),
          articleId: randomUUID(),
          version: 1,
          title: String(body.title ?? '').trim() || topic,
          topic,
          body: text,
          coverRequirement: String(body.coverRequirement ?? '').trim(),
          illustrationRequirement: String(body.illustrationRequirement ?? '').trim(),
          styleId,
          coverRatio: body.coverRatio === 'square' ? 'square' : 'wide',
          coverWithTitle: Boolean(body.coverWithTitle),
          status: 'draft',
          publish: null,
          assets: { cover: null, illustrations: {} },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versionSource: 'manual',
        };
        draft.derived = deriveContent(draft);
        await store.mutate((state) => {
          state.drafts.push(draft);
        });
        sendJson(response, 201, { draft: decorate(draft), snapshot: snapshot() });
        return;
      }

      if (method === 'PATCH' && path.startsWith('/api/drafts/')) {
        const id = path.slice('/api/drafts/'.length);
        const draft = store.draft(id);
        if (!draft) {
          sendJson(response, 404, { error: 'draft_not_found' });
          return;
        }
        const body = await readJson(request);
        const updated = await applyPatch(draft, body, 'manual');
        await store.mutate(() => {});
        sendJson(response, 200, { draft: decorate(updated), snapshot: snapshot() });
        return;
      }

      if (method === 'DELETE' && path.startsWith('/api/drafts/')) {
        const id = path.slice('/api/drafts/'.length);
        const draft = store.draft(id);
        if (!draft) {
          sendJson(response, 404, { error: 'draft_not_found' });
          return;
        }
        const allowPublished = url.searchParams.get('allowPublished') === '1';
        const isPublished = draft.status === 'published_api' || draft.status === 'published_manual';
        if (isPublished && !allowPublished) {
          sendJson(response, 409, {
            error: 'published_version_protected',
            message: '这是已发布版本的记录，确认删除请勾选「同时删除已发布记录」。',
          });
          return;
        }
        await store.mutate((state) => {
          state.drafts = state.drafts.filter((item) => item.id !== id);
          delete state.publishChecks[id];
        });
        await pruneAssets([draft]);
        sendJson(response, 200, { snapshot: snapshot() });
        return;
      }

      if (method === 'POST' && path === '/api/drafts/bulk-delete') {
        const body = await readJson(request);
        const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
        const allowPublished = Boolean(body.allowPublished);
        if (!ids.length) {
          sendJson(response, 400, { error: 'no_ids', message: '请先选择要删除的草稿' });
          return;
        }
        /** @type {string[]} */
        const blocked = [];
        /** @type {string[]} */
        const removed = [];
        /** @type {any[]} */
        const removedDrafts = [];
        await store.mutate((state) => {
          state.drafts = state.drafts.filter((item) => {
            if (!ids.includes(item.id)) return true;
            const isPublished = item.status === 'published_api' || item.status === 'published_manual';
            if (isPublished && !allowPublished) {
              blocked.push(item.id);
              return true;
            }
            removed.push(item.id);
            removedDrafts.push(item);
            delete state.publishChecks[item.id];
            return false;
          });
        });
        await pruneAssets(removedDrafts);
        sendJson(response, 200, { removed, blocked, snapshot: snapshot() });
        return;
      }

      if (method === 'POST' && path.endsWith('/render')) {
        const id = path.slice('/api/drafts/'.length, path.length - '/render'.length);
        const draft = store.draft(id);
        if (!draft) {
          sendJson(response, 404, { error: 'draft_not_found' });
          return;
        }
        const body = await readJson(request);
        const target = String(body.target ?? 'all');
        const slot = String(body.slot ?? '');
        const style = findStyle(draft.styleId, store.styles());
        const plan = buildPlan(draft, style);
        try {
          const result = await renderImages(context, draft, plan, assetsDir, { target, slot });
          await store.mutate(() => {
            draft.assets = draft.assets || { cover: null, illustrations: {} };
            draft.assets.illustrations = draft.assets.illustrations || {};
            for (const [slotId, asset] of Object.entries(result.assets)) {
              if (slotId === 'cover') draft.assets.cover = asset;
              else draft.assets.illustrations[slotId] = asset;
            }
            draft.updatedAt = new Date().toISOString();
          });
          sendJson(response, 200, {
            rendered: Object.keys(result.assets).length,
            failures: result.failures,
            draft: decorate(draft),
            snapshot: snapshot(),
          });
        } catch (error) {
          sendJson(response, 502, {
            error: /** @type {any} */ (error)?.code || 'RENDER_FAILED',
            message: /** @type {any} */ (error)?.message || '图片渲染失败',
            details: /** @type {any} */ (error)?.details || [],
          });
        }
        return;
      }

      if (method === 'POST' && path.endsWith('/publish-check')) {
        const id = path.slice('/api/drafts/'.length, path.length - '/publish-check'.length);
        const draft = store.draft(id);
        if (!draft) {
          sendJson(response, 404, { error: 'draft_not_found' });
          return;
        }
        const evaluation = await evaluateGates(context);
        await store.mutate((state) => {
          const previous = state.publishChecks[draft.id] || {};
          /** @type {Record<string, any>} */
          const merged = { ...previous };
          for (const key of CHECK_KEYS) {
            const fresh = evaluation.checks[key];
            const old = previous[key];
            // A manual confirmation the user already gave is not wiped by a
            // later scan that cannot detect the interface.
            if (old?.status === 'confirmed' && old.confirmedBy === 'manual' && fresh.status !== 'confirmed') {
              merged[key] = old;
            } else {
              merged[key] = fresh;
            }
          }
          state.publishChecks[draft.id] = { ...merged, checkedAt: new Date().toISOString() };
        });
        sendJson(response, 200, {
          checks: store.state.publishChecks[draft.id],
          inventorySize: evaluation.inventorySize,
          partial: evaluation.partial,
          scanError: evaluation.scanError,
          wechatTools: evaluation.wechatTools,
          draft: decorate(draft),
        });
        return;
      }

      if (method === 'POST' && path.endsWith('/confirm-check')) {
        const id = path.slice('/api/drafts/'.length, path.length - '/confirm-check'.length);
        const draft = store.draft(id);
        if (!draft) {
          sendJson(response, 404, { error: 'draft_not_found' });
          return;
        }
        const body = await readJson(request);
        const key = String(body.key ?? '');
        if (!CHECK_KEYS.includes(key)) {
          sendJson(response, 400, { error: 'unknown_check', message: '未知的检查项' });
          return;
        }
        await store.mutate((state) => {
          const record = state.publishChecks[draft.id] || {};
          const current = record[key] || { key, label: key, detected: [], note: '' };
          record[key] = {
            ...current,
            key,
            status: body.confirmed === false ? 'pending' : 'confirmed',
            confirmedBy: body.confirmed === false ? '' : 'manual',
            confirmedAt: new Date().toISOString(),
            note: String(body.note ?? current.note ?? ''),
          };
          state.publishChecks[draft.id] = record;
        });
        sendJson(response, 200, { checks: store.state.publishChecks[draft.id], draft: decorate(draft) });
        return;
      }

      if (method === 'POST' && path.endsWith('/choose-interface')) {
        const id = path.slice('/api/drafts/'.length, path.length - '/choose-interface'.length);
        const draft = store.draft(id);
        if (!draft) {
          sendJson(response, 404, { error: 'draft_not_found' });
          return;
        }
        const body = await readJson(request);
        const name = String(body.name ?? '');
        const record = store.state.publishChecks[draft.id];
        const known = Array.isArray(record?.interface?.detectedNames) ? record.interface.detectedNames : [];
        if (!name || !known.includes(name)) {
          sendJson(response, 400, {
            error: 'unknown_interface',
            message: '选定的发布接口不在本次检测到的接口里，请重新检测后再选择。',
          });
          return;
        }
        await store.mutate((state) => {
          const checks = state.publishChecks[draft.id];
          const current = checks.interface;
          checks.interface = { ...current, chosen: name };
        });
        sendJson(response, 200, { checks: store.state.publishChecks[draft.id], draft: decorate(draft) });
        return;
      }

      if (method === 'POST' && path.endsWith('/publish')) {
        const id = path.slice('/api/drafts/'.length, path.length - '/publish'.length);
        const draft = store.draft(id);
        if (!draft) {
          sendJson(response, 404, { error: 'draft_not_found' });
          return;
        }
        const body = await readJson(request);
        const mode = body.mode === 'manual' ? 'manual' : 'api';
        const checks = store.state.publishChecks[draft.id];

        if (mode === 'api') {
          const readiness = interfaceReadiness(checks);
          if (!readiness.ready) {
            sendJson(response, 409, {
              error: 'publish_gate_locked',
              message: `发布前检查未通过：${readiness.missing.join('、')}。内容仍为草稿，未做任何发布动作。`,
            });
            return;
          }
          const assetData = await collectAssetData(draft);
          const style = findStyle(draft.styleId, store.styles());
          const assetPaths = collectAssetPaths(draft);
          // An interface that publishes a 公众号 article needs the cover; a
          // draft without one is not published half-made.
          if (!draft.assets?.cover) {
            sendJson(response, 409, {
              error: 'cover_not_rendered',
              message: '这篇稿件还没有渲染封面图，未做任何发布动作，草稿保持不变。请先渲染封面再发布。',
            });
            return;
          }
          const outcome = await publishViaInterface(context, checks, {
            ...draft,
            exportHtml: toWeChatHtml(draft, style, assetData),
            plainBody: toPlainBody(draft, assetPaths),
            assetPaths,
          });
          if (!outcome.ok) {
            sendJson(response, 409, { error: 'publish_failed', message: outcome.message });
            return;
          }
          await store.mutate(() => {
            draft.status = 'published_api';
            draft.publish = {
              mode: 'api',
              at: new Date().toISOString(),
              interfaceName: outcome.interfaceName,
              note: outcome.message,
            };
            draft.updatedAt = new Date().toISOString();
          });
          sendJson(response, 200, { draft: decorate(draft), snapshot: snapshot(), message: outcome.message });
          return;
        }

        const readiness = manualReadiness(checks);
        if (!readiness.ready) {
          sendJson(response, 409, {
            error: 'publish_gate_locked',
            message: `发布前检查未通过：${readiness.missing.join('、')}。内容仍为草稿，未做任何发布动作。`,
          });
          return;
        }
        await store.mutate(() => {
          draft.status = 'published_manual';
          draft.publish = {
            mode: 'manual',
            at: new Date().toISOString(),
            interfaceName: '',
            note: String(body.note ?? '由你在公众号后台手动发布后回填'),
          };
          draft.updatedAt = new Date().toISOString();
        });
        sendJson(response, 200, {
          draft: decorate(draft),
          snapshot: snapshot(),
          message: '已记录为「已发布（手动）」。本应用没有调用任何公众号发布接口。',
        });
        return;
      }

      if (method === 'POST' && path === '/api/styles') {
        const body = await readJson(request);
        const name = String(body.name ?? '').trim();
        const description = String(body.description ?? '').trim();
        if (!name) {
          sendJson(response, 400, { error: 'style_name_required', message: '请填写风格名称' });
          return;
        }
        if (!description) {
          sendJson(response, 400, { error: 'style_description_required', message: '请填写风格描述' });
          return;
        }
        const palette = Array.isArray(body.palette)
          ? body.palette.filter((/** @type {any} */ item) => typeof item === 'string').slice(0, 3)
          : [];
        const style = {
          id: `style-${randomUUID()}`,
          name,
          builtin: false,
          tone: description,
          palette: palette.length === 3 ? palette : ['#1f2328', '#2563eb', '#e8eaed'],
          coverPrompt: `${description}，用于公众号文章封面主视觉。`,
          illustrationPrompt: `${description}，用于公众号正文插图。`,
          bodyStyle: 'classic',
          createdAt: new Date().toISOString(),
        };
        await store.mutate((state) => {
          state.styles.push(style);
        });
        sendJson(response, 201, { style, snapshot: snapshot() });
        return;
      }

      if (method === 'DELETE' && path.startsWith('/api/styles/')) {
        const id = path.slice('/api/styles/'.length);
        const style = store.state.styles.find((/** @type {any} */ item) => item.id === id);
        if (!style) {
          sendJson(response, 404, { error: 'style_not_found' });
          return;
        }
        await store.mutate((state) => {
          state.styles = state.styles.filter((/** @type {any} */ item) => item.id !== id);
        });
        sendJson(response, 200, { snapshot: snapshot() });
        return;
      }

      if (method === 'POST' && path === '/api/polish') {
        const body = await readJson(request);
        const draft = store.draft(String(body.draftId ?? ''));
        if (!draft) {
          sendJson(response, 404, { error: 'draft_not_found' });
          return;
        }
        const note = String(body.note ?? '').trim();
        const call = polisher.start(draft, note, commitPolish);
        sendJson(response, 202, { callId: call.callId });
        return;
      }

      if (method === 'GET' && path.startsWith('/api/polish/')) {
        const callId = path.slice('/api/polish/'.length);
        const record = polisher.read(callId);
        if (!record) {
          sendJson(response, 404, { error: 'call_not_found' });
          return;
        }
        sendJson(response, 200, { call: record, snapshot: snapshot() });
        return;
      }

      if (method === 'POST' && path.endsWith('/permission')) {
        const callId = path.slice('/api/polish/'.length, path.length - '/permission'.length);
        const body = await readJson(request);
        const outcome = await polisher.replyPermission(callId, body.decision === 'deny' ? 'deny' : 'allowOnce');
        sendJson(response, outcome.ok ? 200 : 409, outcome);
        return;
      }

      if (method === 'POST' && path.endsWith('/answer')) {
        const callId = path.slice('/api/polish/'.length, path.length - '/answer'.length);
        const body = await readJson(request);
        const answers = Array.isArray(body.answers) ? body.answers : [];
        const outcome = await polisher.answerQuestion(callId, answers);
        sendJson(response, outcome.ok ? 200 : 409, outcome);
        return;
      }

      if (method === 'POST' && path.endsWith('/cancel')) {
        const callId = path.slice('/api/polish/'.length, path.length - '/cancel'.length);
        sendJson(response, 200, polisher.cancel(callId));
        return;
      }

      if (method === 'GET' && path.startsWith('/api/export/')) {
        const id = path.slice('/api/export/'.length);
        const draft = store.draft(id);
        if (!draft) {
          sendJson(response, 404, { error: 'draft_not_found' });
          return;
        }
        const style = findStyle(draft.styleId, store.styles());
        const assetData = await collectAssetData(draft);
        const html = toWeChatHtml(draft, style, assetData);
        // The plain body names every image by its local path, so it can be
        // handed to an interface that uploads images, and pasted as text.
        const text = toPlainBody(draft, collectAssetPaths(draft));
        if (url.searchParams.get('download') === '1') {
          const standalone = toStandaloneHtml(draft, style, assetData);
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(draft))}`,
          });
          response.end(standalone);
          return;
        }
        sendJson(response, 200, {
          title: draft.title || draft.topic,
          digest: draft.derived?.digest || '',
          html,
          text,
          fileName: safeFileName(draft),
          hasCover: Boolean(draft.assets?.cover),
          illustrationCount: Object.keys(draft.assets?.illustrations || {}).length,
        });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      const code = /** @type {any} */ (error)?.code || 'INTERNAL_ERROR';
      context.logger.warn('miniapp.request.failed', { code });
      sendJson(response, 500, { error: code, message: /** @type {any} */ (error)?.message || '请求处理失败' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
  context.logger.info('miniapp.runtime.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
