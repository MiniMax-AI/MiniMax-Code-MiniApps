/**
 * GML 练习记录 · Mini App 运行时
 *
 * 数据目录（Host 注入的 dataDir）：
 *   GML-Saves/    项目存档文件：<名称>.<id>.json  + save-index.json
 *   GML-Trash/    回收站：<id>.<删除时间>.json    + trash-index.json
 *   GML-App/      打卡网页版本：app.html + app-meta.json
 *   exports/      用户导出的备份文件
 *
 * 所有写入都走这一层（校验 → 落盘 → 再广播），浏览器端只负责界面。
 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createMcpHandler } from './mcp.mjs';

const PREFIX = 'gml-practice-log-v2:';
const PATHS = {
  proj: 'GML-Saves',
  trash: 'GML-Trash',
  index: 'save-index.json',
  trashIndex: 'trash-index.json',
  appDir: 'GML-App',
  appFile: 'app.html',
  appMeta: 'app-meta.json',
  exports: 'exports',
};
const APP_DEFAULT_URL = 'https://basetier-gml.github.io/gml-practice-log/';
const APP_MAX_BYTES = 8 * 1024 * 1024;

/* ------------------------------ 小工具 ------------------------------ */
function uid() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function safeFile(s) {
  return String(s || '存档').replace(/[\\/:*?"<>|]/g, '_').slice(0, 48);
}
function stableId(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'f' + (h >>> 0).toString(36);
}
function clone(o) {
  return o === undefined ? o : JSON.parse(JSON.stringify(o));
}
function appVersionOf(html) {
  let h = 5381;
  const lim = Math.min(html.length, 200000);
  for (let i = 0; i < lim; i += 1) h = ((h << 5) + h + html.charCodeAt(i)) | 0;
  return html.length.toString(36) + '-' + (h >>> 0).toString(36);
}
function hasStorageKeys(o) {
  if (!o || typeof o !== 'object') return false;
  return Object.keys(o).some((k) => k.indexOf(PREFIX) === 0);
}

/* ------------------------------ 存储层 ------------------------------ */
function createStore(dataDir) {
  const projDir = join(dataDir, PATHS.proj);
  const trashDir = join(dataDir, PATHS.trash);
  const appDir = join(dataDir, PATHS.appDir);
  const exportDir = join(dataDir, PATHS.exports);
  const builtinAppPath = join(dataDir, '..', 'unused');

  async function ensureDirs() {
    await mkdir(projDir, { recursive: true });
    await mkdir(trashDir, { recursive: true });
    await mkdir(appDir, { recursive: true });
    await mkdir(exportDir, { recursive: true });
  }

  async function readJson(dir, name) {
    try {
      return JSON.parse(await readFile(join(dir, name), 'utf8'));
    } catch {
      return null;
    }
  }

  /** 原子写：同目录临时文件 → rename，避免宿主强制结束进程时留下半个文件。 */
  async function writeJson(dir, name, obj) {
    const target = join(dir, name);
    const tmp = join(dir, `.${name}.tmp`);
    await writeFile(tmp, JSON.stringify(obj), 'utf8');
    await rename(tmp, target);
    return name;
  }

  async function writeText(dir, name, text) {
    const target = join(dir, name);
    const tmp = join(dir, `.${name}.tmp`);
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, target);
    return name;
  }

  async function listFiles(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async function fileMeta(dir, name) {
    try {
      const st = await stat(join(dir, name));
      return { size: st.size, lastModified: st.mtimeMs };
    } catch {
      return null;
    }
  }

  /* 把任意一个 json 文件解析成一条存档记录；返回 null 表示不是存档 */
  function parseSaveFile(obj, name, lastModified) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const out = { format: '', name: '', id: '', note: '', createdAt: 0, updatedAt: 0, saveCount: 0, data: {}, siteBackup: null };

    const sv = obj.format === 'gml-pm-save' && obj.save && typeof obj.save === 'object'
      ? obj.save
      : (obj.save && obj.save.data && typeof obj.save.data === 'object' ? obj.save : null);
    if (sv) {
      out.format = obj.format || 'gml-pm-save';
      out.data = sv.data && typeof sv.data === 'object' ? sv.data : {};
      out.name = String(sv.name || name.replace(/\.json$/i, ''));
      out.id = String(sv.id || '') || stableId(name);
      out.note = String(sv.note || '');
      out.createdAt = Number(sv.createdAt) || lastModified || Date.now();
      out.updatedAt = Number(sv.updatedAt) || lastModified || Date.now();
      out.saveCount = Number(sv.saveCount) || 0;
      out.siteBackup = sv.siteBackup || null;
      return out;
    }

    let site = null;
    if (obj.app && obj.data && typeof obj.data === 'object') site = obj;
    else if (obj.records || obj.apiLib || obj.apiById || obj.dailyGoal || obj.nickname) site = obj;
    if (site) {
      out.format = 'site-native';
      out.name = name.replace(/\.json$/i, '');
      out.id = stableId(name);
      out.createdAt = lastModified || Date.now();
      out.updatedAt = lastModified || Date.now();
      out.data = {};
      out.siteBackup = site;
      return out;
    }

    if (hasStorageKeys(obj)) {
      out.format = 'fragmented';
      out.name = name.replace(/\.json$/i, '');
      out.id = stableId(name);
      out.createdAt = lastModified || Date.now();
      out.updatedAt = lastModified || Date.now();
      out.data = obj;
      return out;
    }
    return null;
  }

  /** 扫描项目目录：项目列表的唯一数据源 */
  async function scanProjects() {
    const names = (await listFiles(projDir)).filter((n) => /\.json$/i.test(n) && n !== PATHS.index).sort();
    const slots = [];
    const skipped = [];
    for (const name of names) {
      const meta = await fileMeta(projDir, name);
      let obj = null;
      try {
        obj = JSON.parse(await readFile(join(projDir, name), 'utf8'));
      } catch (e) {
        skipped.push({ name, reason: String((e && e.message) || e) });
        continue;
      }
      const parsed = parseSaveFile(obj, name, meta ? meta.lastModified : Date.now());
      if (!parsed) {
        skipped.push({ name, reason: '不是存档格式' });
        continue;
      }
      slots.push({
        id: parsed.id,
        name: parsed.name,
        note: parsed.note,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
        saveCount: parsed.saveCount,
        data: parsed.data,
        siteBackup: parsed.siteBackup,
        file: name,
        fileSize: meta ? meta.size : 0,
        fileModified: meta ? meta.lastModified : parsed.updatedAt,
        fileFormat: parsed.format,
      });
    }
    return { slots, skipped, total: names.length, at: Date.now() };
  }

  async function readIndex() {
    const idx = await readJson(projDir, PATHS.index);
    return idx && typeof idx === 'object' ? idx : null;
  }

  async function writeIndex(saves, uiLang) {
    const prev = (await readIndex()) || {};
    await writeJson(projDir, PATHS.index, {
      format: 'gml-pm-index',
      version: 1,
      updatedAt: new Date().toISOString(),
      root: PATHS.proj,
      uiLang: uiLang || prev.uiLang || 'zh',
      saves: saves.map((s) => ({
        id: s.id,
        name: s.name,
        file: slotFileName(s),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        size: JSON.stringify(s.data || {}).length,
      })),
    });
  }

  async function readTrashIndex() {
    const idx = await readJson(trashDir, PATHS.trashIndex);
    return idx && Array.isArray(idx.items) ? idx : null;
  }

  async function writeTrashIndex(items) {
    await writeJson(trashDir, PATHS.trashIndex, {
      format: 'gml-trash-index',
      version: 1,
      updatedAt: new Date().toISOString(),
      note: '垃圾回收文件：记录所有被移入回收站的项目文件，可据此恢复。',
      items: items.map((t) => ({
        id: t.id,
        name: t.name,
        originalName: t.originalName || t.name,
        file: t.file,
        deletedAt: t.deletedAt,
        size: JSON.stringify(t.data || {}).length,
        where: 'file',
      })),
    });
  }

  async function readTrash() {
    const idx = await readTrashIndex();
    const items = [];
    if (idx) {
      for (const it of idx.items) {
        if (!it || !it.id) continue;
        const tf = it.file ? await readJson(trashDir, it.file) : null;
        items.push({
          id: it.id,
          name: it.name,
          originalName: it.originalName || it.name,
          createdAt: it.createdAt,
          deletedAt: it.deletedAt || Date.now(),
          data: (tf && tf.data) || {},
          siteBackup: (tf && tf.siteBackup) || null,
          file: it.file || null,
          where: 'file',
        });
      }
    }
    return items;
  }

  function slotFileName(slot) {
    return `${safeFile(slot.name).slice(0, 40)}.${slot.id}.json`;
  }

  /** 写项目文件；改名后同步删掉旧文件，绝不留下重复存档 */
  async function writeSlot(slot, previousFile) {
    const name = slotFileName(slot);
    const save = {
      id: slot.id,
      name: slot.name,
      note: slot.note || '',
      createdAt: slot.createdAt,
      updatedAt: slot.updatedAt,
      saveCount: slot.saveCount || 0,
      data: slot.data || {},
    };
    if (slot.siteBackup) save.siteBackup = slot.siteBackup;
    await writeJson(projDir, name, { format: 'gml-pm-save', version: 1, exportedAt: new Date().toISOString(), save });
    if (previousFile && previousFile !== name) {
      await rm(join(projDir, previousFile), { force: true });
    }
    slot.file = name;
    return name;
  }

  async function removeSlotFile(slot) {
    const names = await listFiles(projDir);
    for (const n of names) {
      if (!/\.json$/i.test(n) || n === PATHS.index) continue;
      if (n === slot.file || n === slotFileName(slot) || n.indexOf(`.${slot.id}.json`) >= 0) {
        await rm(join(projDir, n), { force: true });
      }
    }
  }

  async function writeTrashFile(item) {
    const name = `${item.id}.${item.deletedAt}.json`;
    await writeJson(trashDir, name, {
      format: 'gml-pm-trash',
      version: 1,
      deletedAt: item.deletedAt,
      id: item.id,
      name: item.name,
      originalName: item.originalName,
      createdAt: item.createdAt,
      data: item.data,
      siteBackup: item.siteBackup || null,
    });
    item.file = name;
    item.where = 'file';
    return name;
  }

  async function removeTrashFile(item) {
    const names = await listFiles(trashDir);
    for (const n of names) {
      if (n === PATHS.trashIndex) continue;
      if (n === item.file || n.indexOf(item.id) === 0) await rm(join(trashDir, n), { force: true });
    }
  }

  async function uniqueName(base, slots) {
    const names = new Set(slots.map((s) => s.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} (${i})`)) i += 1;
    return `${base} (${i})`;
  }

  /* --------------------- 打卡网页版本 --------------------- */
  async function readAppInfo() {
    const meta = await readJson(appDir, PATHS.appMeta);
    if (meta && meta.url) {
      return {
        url: String(meta.url),
        version: String(meta.version || ''),
        fetchedAt: Number(meta.fetchedAt || 0),
        size: Number(meta.size || 0),
        custom: true,
      };
    }
    return { url: APP_DEFAULT_URL, version: '', fetchedAt: 0, size: 0, custom: false };
  }

  async function appHtmlPath() {
    const custom = join(appDir, PATHS.appFile);
    try {
      const st = await stat(custom);
      if (st.size > 0) return custom;
    } catch {
      /* 没有缓存版本 */
    }
    return null;
  }

  async function fetchApp(url) {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) throw new Error('网址无效');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let html;
    try {
      const resp = await fetch(target, { signal: controller.signal, redirect: 'follow' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > APP_MAX_BYTES) throw new Error('网页文件过大');
      html = buf.toString('utf8');
    } finally {
      clearTimeout(timer);
    }
    if (!/<html[\s>]/i.test(html)) throw new Error('抓到的不是 HTML 网页');
    if (!/gml-practice-log-v2/.test(html) || !/cmd/.test(html)) throw new Error('这不是同一个打卡网页');
    await writeText(appDir, PATHS.appFile, html);
    const info = { url: target, version: appVersionOf(html), fetchedAt: Date.now(), size: html.length, custom: true };
    await writeJson(appDir, PATHS.appMeta, info);
    return info;
  }

  async function restoreBuiltinApp() {
    await rm(join(appDir, PATHS.appFile), { force: true });
    await rm(join(appDir, PATHS.appMeta), { force: true });
    return { url: APP_DEFAULT_URL, version: '', fetchedAt: 0, size: 0, custom: false };
  }

  async function saveExport(name, text) {
    const file = safeFile(name).replace(/\.json$/i, '') + '.json';
    await writeText(exportDir, file, text);
    return join(exportDir, file);
  }

  return {
    dirs: { projDir, trashDir, appDir, exportDir },
    ensureDirs,
    readJson,
    writeJson,
    listFiles,
    fileMeta,
    scanProjects,
    readIndex,
    writeIndex,
    readTrash,
    writeTrashIndex,
    writeSlot,
    removeSlotFile,
    writeTrashFile,
    removeTrashFile,
    slotFileName,
    uniqueName,
    readAppInfo,
    appHtmlPath,
    fetchApp,
    restoreBuiltinApp,
    saveExport,
    builtinAppPath,
  };
}

/* ------------------------------ HTTP ------------------------------ */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function sendText(res, status, text, type) {
  res.writeHead(status, { 'content-type': `${type || 'text/plain'}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(text);
}
/** 打卡网页自带的 Google Fonts 远程链接在 Mini App 里去掉，改用系统字体栈。 */
function stripRemoteFonts(html) {
  return String(html)
    .replace(/<link[^>]*fonts\.googleapis\.com[^>]*>\s*/gi, '')
    .replace(/<link[^>]*fonts\.gstatic\.com[^>]*>\s*/gi, '');
}

function mimeOf(name) {
  if (name.endsWith('.html')) return 'text/html';
  if (name.endsWith('.css')) return 'text/css';
  if (name.endsWith('.js') || name.endsWith('.mjs')) return 'text/javascript';
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

async function readBody(req, limit = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

export async function start(context) {
  const store = createStore(context.dataDir);
  await store.ensureDirs();

  const clientRoot = join(context.pluginRoot, 'miniapp/client');
  const builtinApp = join(clientRoot, 'core/app.html');
  const clientIndex = join(clientRoot, 'index.html');

  const readFileSafe = async (p) => {
    try {
      return await readFile(p, 'utf8');
    } catch {
      return null;
    }
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      const message = String((error && error.message) || error);
      if (!res.headersSent) sendJson(res, 400, { error: message });
      else res.end();
    });
  });

  /* 托管 MCP：把练习存档的业务能力交给 Agent（路径见 miniapp.json 的 mcpEndpoints） */
  const mcpHandler = createMcpHandler(store);

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    /* ---- 页面与静态资源 ---- */
    if (method === 'GET' && (path === '/app' || path === '/app/' || path === '/app/index.html')) {
      const html = await readFileSafe(clientIndex);
      if (!html) return sendText(res, 404, 'client missing');
      return sendText(res, 200, html, 'text/html');
    }

    if (method === 'GET' && path.startsWith('/app/') && !path.startsWith('/app/api/')) {
      const rel = path.slice('/app/'.length);
      if (!rel || rel.includes('..') || rel.includes('\\')) return sendJson(res, 404, { error: 'not_found' });
      const filePath = join(clientRoot, rel);
      if (!filePath.startsWith(clientRoot)) return sendJson(res, 404, { error: 'not_found' });
      const body = await readFileSafe(filePath);
      if (body === null) return sendJson(res, 404, { error: 'not_found' });
      return sendText(res, 200, body, mimeOf(rel));
    }

    /* ---- 托管 MCP（Agent 调用） ---- */
    if (path === '/mcp/gml-notes') return mcpHandler(req, res);

    if (!path.startsWith('/app/api/')) return sendJson(res, 404, { error: 'not_found' });

    const api = path.slice('/app/api/'.length);
    const seg = api.split('/').map((s) => decodeURIComponent(s));

    /* ---- 总状态：列表 / 回收站 / 版本信息 ---- */
    if (method === 'GET' && api === 'state') {
      const scan = await store.scanProjects();
      const trash = await store.readTrash();
      const index = await store.readIndex();
      const app = await store.readAppInfo();
      const builtinSize = (await store.fileMeta(join(context.pluginRoot, 'miniapp/client/core'), 'app.html'))?.size || 0;
      return sendJson(res, 200, {
        uiLang: (index && index.uiLang) || 'zh',
        saves: scan.slots,
        trash,
        skipped: scan.skipped,
        scan: { at: scan.at, total: scan.total, ok: scan.slots.length },
        app: { ...app, builtinSize },
        store: {
          projDir: store.dirs.projDir,
          trashDir: store.dirs.trashDir,
          appDir: store.dirs.appDir,
          exportDir: store.dirs.exportDir,
        },
      });
    }

    /* ---- 打卡网页 HTML（内置版或已抓取的缓存版） ---- */
    if (method === 'GET' && api === 'app/html') {
      const cached = await store.appHtmlPath();
      const html = cached ? await readFileSafe(cached) : await readFileSafe(builtinApp);
      if (!html) return sendText(res, 404, 'app missing');
      return sendText(res, 200, stripRemoteFonts(html), 'text/html');
    }

    /* ---- 打卡网页版本管理 ---- */
    if (method === 'POST' && api === 'app/fetch') {
      const body = await readBody(req);
      const info = await store.fetchApp(body && body.url);
      return sendJson(res, 200, info);
    }
    if (method === 'POST' && api === 'app/builtin') {
      return sendJson(res, 200, await store.restoreBuiltinApp());
    }

    /* ---- 配置（界面语言 / 来源网址） ---- */
    if (method === 'PUT' && api === 'config') {
      const body = await readBody(req);
      const scan = await store.scanProjects();
      if (body && typeof body.uiLang === 'string' && body.uiLang !== 'en' && body.uiLang !== 'zh') {
        throw new Error('语言取值无效');
      }
      await store.writeIndex(scan.slots, body && body.uiLang);
      if (body && typeof body.appUrl === 'string' && body.appUrl.trim()) {
        const meta = await store.readJson(store.dirs.appDir, 'app-meta.json');
        if (meta && meta.custom) await store.writeJson(store.dirs.appDir, 'app-meta.json', { ...meta, url: body.appUrl.trim() });
      }
      return sendJson(res, 200, { ok: true });
    }

    /* ---- 项目 ---- */
    if (seg[0] === 'projects') {
      if (method === 'POST' && seg.length === 1) {
        const body = await readBody(req);
        const name = String((body && body.name) || '').trim();
        if (!name) throw new Error('项目名称不能为空');
        const scan = await store.scanProjects();
        const slot = {
          id: uid(),
          name: await store.uniqueName(name, scan.slots),
          note: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          saveCount: 0,
          data: {},
        };
        await store.writeSlot(slot);
        await store.writeIndex([...scan.slots, slot], (await store.readIndex())?.uiLang);
        return sendJson(res, 200, slot);
      }

      const id = seg[1];
      if (!id) throw new Error('缺少项目 ID');

      if (method === 'GET' && seg.length === 2) {
        const scan = await store.scanProjects();
        const slot = scan.slots.find((s) => s.id === id);
        if (!slot) return sendJson(res, 404, { error: '项目不存在' });
        return sendJson(res, 200, slot);
      }

      if (method === 'PUT' && seg.length === 2) {
        const body = await readBody(req);
        if (!body || typeof body.data !== 'object' || body.data === null) throw new Error('存档数据无效');
        const scan = await store.scanProjects();
        const slot = scan.slots.find((s) => s.id === id);
        if (!slot) return sendJson(res, 404, { error: '项目不存在' });
        const previousFile = slot.file;
        slot.data = body.data;
        slot.updatedAt = Date.now();
        slot.saveCount = (slot.saveCount || 0) + 1;
        await store.writeSlot(slot, previousFile);
        await store.writeIndex(scan.slots, (await store.readIndex())?.uiLang);
        return sendJson(res, 200, { id: slot.id, updatedAt: slot.updatedAt, saveCount: slot.saveCount });
      }

      if (method === 'PATCH' && seg.length === 2) {
        const body = await readBody(req);
        const scan = await store.scanProjects();
        const slot = scan.slots.find((s) => s.id === id);
        if (!slot) return sendJson(res, 404, { error: '项目不存在' });
        const previousFile = slot.file;
        if (body && typeof body.name === 'string' && body.name.trim()) slot.name = body.name.trim();
        slot.updatedAt = Date.now();
        await store.writeSlot(slot, previousFile);
        await store.writeIndex(scan.slots, (await store.readIndex())?.uiLang);
        return sendJson(res, 200, slot);
      }

      if (method === 'POST' && seg[2] === 'copy') {
        const scan = await store.scanProjects();
        const slot = scan.slots.find((s) => s.id === id);
        if (!slot) return sendJson(res, 404, { error: '项目不存在' });
        const copy = {
          id: uid(),
          name: await store.uniqueName(`${slot.name} · 副本`, scan.slots),
          note: slot.note || '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          saveCount: 0,
          data: clone(slot.data || {}),
          siteBackup: slot.siteBackup || null,
        };
        await store.writeSlot(copy);
        await store.writeIndex([...scan.slots, copy], (await store.readIndex())?.uiLang);
        return sendJson(res, 200, copy);
      }

      if (method === 'DELETE' && seg.length === 2) {
        const scan = await store.scanProjects();
        const slot = scan.slots.find((s) => s.id === id);
        if (!slot) return sendJson(res, 404, { error: '项目不存在' });
        const item = {
          id: slot.id,
          name: slot.name,
          originalName: slot.name,
          createdAt: slot.createdAt,
          deletedAt: Date.now(),
          data: clone(slot.data || {}),
          siteBackup: slot.siteBackup || null,
        };
        /* 必须先成功写进回收站，才允许删原件 */
        await store.writeTrashFile(item);
        await store.removeSlotFile(slot);
        const trash = await store.readTrash();
        trash.push(item);
        await store.writeTrashIndex(trash);
        await store.writeIndex(scan.slots.filter((s) => s.id !== id), (await store.readIndex())?.uiLang);
        return sendJson(res, 200, { ok: true, trash: item });
      }
    }

    /* ---- 回收站 ---- */
    if (seg[0] === 'trash') {
      if (method === 'POST' && seg[2] === 'restore') {
        const trash = await store.readTrash();
        const item = trash.find((t) => t.id === seg[1]);
        if (!item) return sendJson(res, 404, { error: '回收站里没有这个项目' });
        const scan = await store.scanProjects();
        const slot = {
          id: item.id,
          name: await store.uniqueName(item.originalName || item.name, scan.slots),
          note: '',
          createdAt: item.createdAt || Date.now(),
          updatedAt: Date.now(),
          saveCount: 0,
          data: item.data || {},
          siteBackup: item.siteBackup || null,
        };
        await store.writeSlot(slot);
        await store.removeTrashFile(item);
        await store.writeTrashIndex(trash.filter((t) => t.id !== item.id));
        await store.writeIndex([...scan.slots, slot], (await store.readIndex())?.uiLang);
        return sendJson(res, 200, slot);
      }

      if (method === 'DELETE' && seg.length === 2) {
        const trash = await store.readTrash();
        const item = trash.find((t) => t.id === seg[1]);
        if (!item) return sendJson(res, 404, { error: '回收站里没有这个项目' });
        await store.removeTrashFile(item);
        await store.writeTrashIndex(trash.filter((t) => t.id !== item.id));
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'POST' && seg[1] === 'clear') {
        const trash = await store.readTrash();
        for (const item of trash) await store.removeTrashFile(item);
        await store.writeTrashIndex([]);
        return sendJson(res, 200, { ok: true });
      }
    }

    /* ---- 导入 ---- */
    if (method === 'POST' && api === 'import') {
      const body = await readBody(req);
      if (!body || typeof body.text !== 'string') throw new Error('导入内容无效');
      let obj;
      try {
        obj = JSON.parse(body.text);
      } catch {
        throw new Error('不是有效的 JSON 存档文件');
      }
      const base = String(body.filename || '').replace(/\.json$/i, '').slice(0, 40) || '导入项目';
      const scan = await store.scanProjects();
      const uiLang = (await store.readIndex())?.uiLang;
      const created = [];

      if (obj && obj.format === 'gml-pm-vault') {
        const saves = Array.isArray(obj.saves) ? obj.saves : [];
        for (const s of saves) {
          if (!s || typeof s !== 'object' || !s.data) continue;
          const slot = {
            id: uid(),
            name: await store.uniqueName(s.name || base, [...scan.slots, ...created]),
            note: s.note || '',
            createdAt: s.createdAt || Date.now(),
            updatedAt: s.updatedAt || Date.now(),
            saveCount: 0,
            data: clone(s.data),
            siteBackup: s.siteBackup || null,
          };
          await store.writeSlot(slot);
          created.push(slot);
        }
        const trash = await store.readTrash();
        const importedTrash = Array.isArray(obj.trash) ? obj.trash : [];
        for (const t of importedTrash) {
          if (!t || !t.id || trash.some((x) => x.id === t.id)) continue;
          const item = {
            id: t.id,
            name: t.name || '已删除项目',
            originalName: t.originalName || t.name,
            createdAt: t.createdAt,
            deletedAt: t.deletedAt || Date.now(),
            data: t.data || {},
            siteBackup: t.siteBackup || null,
          };
          await store.writeTrashFile(item);
          trash.push(item);
        }
        await store.writeTrashIndex(trash);
        await store.writeIndex([...scan.slots, ...created], uiLang);
        return sendJson(res, 200, { ok: true, imported: created.length, trash: importedTrash.length });
      }

      if (obj && obj.format === 'gml-pm-save' && obj.save && obj.save.data) {
        const s = obj.save;
        const slot = {
          id: uid(),
          name: await store.uniqueName(s.name || base, scan.slots),
          note: s.note || '',
          createdAt: s.createdAt || Date.now(),
          updatedAt: s.updatedAt || Date.now(),
          saveCount: 0,
          data: clone(s.data),
          siteBackup: s.siteBackup || null,
        };
        await store.writeSlot(slot);
        await store.writeIndex([...scan.slots, slot], uiLang);
        return sendJson(res, 200, { ok: true, imported: 1, project: slot });
      }

      /* 网站原生存档 / 分片存档：先建项目，打开时交给打卡网页自己的 import 接口转换 */
      const site = obj && typeof obj === 'object' ? obj : {};
      const slot = {
        id: uid(),
        name: await store.uniqueName(base, scan.slots),
        note: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        saveCount: 0,
        data: hasStorageKeys(site) ? clone(site) : {},
        siteBackup: hasStorageKeys(site) ? null : clone(site),
      };
      await store.writeSlot(slot);
      await store.writeIndex([...scan.slots, slot], uiLang);
      return sendJson(res, 200, { ok: true, imported: 1, project: slot });
    }

    /* ---- 导出 ---- */
    if (method === 'GET' && seg[0] === 'export') {
      if (seg[1] === 'all') {
        const scan = await store.scanProjects();
        const trash = await store.readTrash();
        const payload = {
          format: 'gml-pm-vault',
          version: 2,
          exportedAt: new Date().toISOString(),
          saves: scan.slots,
          trash,
        };
        const text = JSON.stringify(payload);
        const path = await store.saveExport(`gml存档库-${new Date().toISOString().slice(0, 10)}.json`, text);
        return sendJson(res, 200, { filename: `gml存档库-${new Date().toISOString().slice(0, 10)}.json`, text, path });
      }
      if (seg[1] === 'project' && seg[2]) {
        const scan = await store.scanProjects();
        const slot = scan.slots.find((s) => s.id === seg[2]);
        if (!slot) return sendJson(res, 404, { error: '项目不存在' });
        const payload = {
          format: 'gml-pm-save',
          version: 1,
          exportedAt: new Date().toISOString(),
          save: {
            name: slot.name,
            note: slot.note || '',
            createdAt: slot.createdAt,
            updatedAt: slot.updatedAt,
            data: slot.data || {},
          },
        };
        const text = JSON.stringify(payload);
        const filename = `gml项目-${safeFile(slot.name)}.json`;
        const path = await store.saveExport(filename, text);
        return sendJson(res, 200, { filename, text, path });
      }
    }

    /* ---- 导出落盘（网站存档格式等由网页生成的内容） ---- */
    if (method === 'POST' && api === 'export/file') {
      const body = await readBody(req);
      if (!body || typeof body.text !== 'string') throw new Error('导出内容无效');
      const filename = String(body.filename || 'gml-export.json');
      const path = await store.saveExport(filename, body.text);
      return sendJson(res, 200, { filename, path });
    }

    return sendJson(res, 404, { error: 'not_found' });
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  let disposal;
  const dispose = () => {
    if (disposal) return disposal;
    context.signal.removeEventListener('abort', onAbort);
    disposal = new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    return disposal;
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
