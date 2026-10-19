// @ts-check
// Gallery state: figures, their versions (copied page snapshots) and recent Agent runs.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';

const MAX_PAGE_BYTES = 30 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;
const MAX_RUNS_PER_FIGURE = 20;
const MAX_CATEGORIES = 30;
export const DEFAULT_CATEGORY = 'default';
const PREVIEW_TYPES = new Map([
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);
/** Every anatomy page wraps the figure in `class="iso"` (kit ISO_CSS root). */
const ANATOMY_MARKER = /class\s*=\s*["']iso["']/;

/**
 * The image type from the file's own header, never from its name: PNG, JPEG or WebP.
 * @param {Buffer} buffer
 * @returns {'.png' | '.jpg' | '.webp' | null}
 */
function imageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  return null;
}

/**
 * Resolve symlinks first, so every later check applies to the file that will actually be read.
 * @param {string} path @param {string} label
 */
async function resolveFile(path, label) {
  let real;
  try {
    real = await realpath(path);
  } catch {
    throw new GalleryError('invalid', `${label}不存在：${path}`);
  }
  const info = await stat(real);
  if (!info.isFile()) throw new GalleryError('invalid', `${label}不是文件：${path}`);
  return { real, size: info.size };
}

export class GalleryError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** @param {unknown} value @param {number} max */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim().slice(0, max);
}

/** @param {string} html */
function titleOf(html) {
  const match = /<title>([^<]{1,200})<\/title>/i.exec(html);
  if (!match || match[1].includes('${')) return '';
  return match[1].trim();
}

/** @param {string} dataDir */
export function createStore(dataDir) {
  const statePath = join(dataDir, 'gallery.json');
  const filesRoot = join(dataDir, 'figures');
  /** @type {{ schemaVersion: 1, figures: any[], categories: any[] }} */
  let state = { schemaVersion: 1, figures: [], categories: [] };
  /** @type {Promise<void>} */
  let writing = Promise.resolve();

  async function load() {
    await mkdir(filesRoot, { recursive: true });
    try {
      const raw = JSON.parse(await readFile(statePath, 'utf8'));
      if (raw && Array.isArray(raw.figures)) {
        state = { schemaVersion: 1, figures: raw.figures, categories: Array.isArray(raw.categories) ? raw.categories : [] };
      }
    } catch (error) {
      if (/** @type {any} */ (error).code !== 'ENOENT') throw error;
    }
    // A run from an earlier process cannot be observed or continued by this one.
    let changed = false;
    if (!state.categories.some((item) => item.id === DEFAULT_CATEGORY)) {
      state.categories.unshift({ id: DEFAULT_CATEGORY, name: '默认', builtIn: true });
      changed = true;
    }
    for (const figure of state.figures) {
      for (const run of figure.runs ?? []) {
        if (run.status === 'running') {
          run.status = 'interrupted';
          run.endedAt = run.endedAt ?? Date.now();
          changed = true;
        }
      }
    }
    if (changed) await persist();
  }

  function persist() {
    const snapshot = JSON.stringify(state, null, 2);
    const next = writing
      .catch(() => {})
      .then(async () => {
        const tmp = `${statePath}.${process.pid}.tmp`;
        await writeFile(tmp, snapshot);
        await rename(tmp, statePath);
      });
    writing = next;
    return next;
  }

  /** @param {string} id */
  function find(id) {
    const figure = state.figures.find((item) => item.id === id);
    if (!figure) throw new GalleryError('not_found', '找不到这张图解');
    return figure;
  }

  /** @param {any} figure */
  function summary(figure) {
    const latest = figure.versions.at(-1);
    const lastRun = figure.runs?.at(-1);
    return {
      id: figure.id,
      title: figure.title,
      source: figure.source,
      categoryId: categoryOf(figure),
      createdAt: figure.createdAt,
      updatedAt: figure.updatedAt,
      versionCount: figure.versions.length,
      latest: latest
        ? {
            n: latest.n,
            note: latest.note,
            hasLight: latest.hasLight,
            hasPreview: !!latest.previewExt,
            hasLightPreview: !!latest.lightPreviewExt,
          }
        : null,
      lastRun: lastRun ? { status: lastRun.status, kind: lastRun.kind, startedAt: lastRun.startedAt } : null,
    };
  }

  /** A figure whose room was deleted, or that predates rooms, hangs in the default room. @param {any} figure */
  function categoryOf(figure) {
    return state.categories.some((item) => item.id === figure.categoryId) ? figure.categoryId : DEFAULT_CATEGORY;
  }

  /** @param {unknown} id */
  function knownCategory(id) {
    return typeof id === 'string' && state.categories.some((item) => item.id === id) ? id : DEFAULT_CATEGORY;
  }

  /** @param {unknown} value */
  function categoryName(value) {
    const name = cleanText(value, 40).replace(/\s+/g, ' ');
    if (!name) throw new GalleryError('invalid', '展区名称不能为空');
    if ([...name].length > 20) throw new GalleryError('invalid', '展区名称最多 20 个字');
    return name;
  }

  /** @param {string} name @param {string} [except] */
  function assertUniqueName(name, except) {
    const lower = name.toLowerCase();
    if (state.categories.some((item) => item.id !== except && item.name.toLowerCase() === lower)) {
      throw new GalleryError('invalid', `已经有叫“${name}”的展区了`);
    }
  }

  function listCategories() {
    return state.categories.map((item) => ({
      id: item.id,
      name: item.name,
      builtIn: !!item.builtIn,
      count: state.figures.filter((figure) => categoryOf(figure) === item.id).length,
    }));
  }

  /** @param {unknown} rawName */
  async function createCategory(rawName) {
    const name = categoryName(rawName);
    assertUniqueName(name);
    if (state.categories.length >= MAX_CATEGORIES) throw new GalleryError('invalid', `最多 ${MAX_CATEGORIES} 个展区`);
    const category = { id: `cat-${randomUUID().slice(0, 6)}`, name, builtIn: false };
    state.categories.push(category);
    await persist();
    return category;
  }

  /** @param {string} id @param {unknown} rawName */
  async function renameCategory(id, rawName) {
    const category = state.categories.find((item) => item.id === id);
    if (!category) throw new GalleryError('not_found', '找不到这个展区');
    const name = categoryName(rawName);
    assertUniqueName(name, id);
    category.name = name;
    await persist();
    return category;
  }

  /** Delete a room; its works move to the default room. @param {string} id */
  async function deleteCategory(id) {
    const category = state.categories.find((item) => item.id === id);
    if (!category) throw new GalleryError('not_found', '找不到这个展区');
    if (category.builtIn) throw new GalleryError('invalid', `“${category.name}”是内置展区，不能移除`);
    let moved = 0;
    for (const figure of state.figures) {
      if (figure.categoryId === id) {
        figure.categoryId = DEFAULT_CATEGORY;
        moved += 1;
      }
    }
    state.categories = state.categories.filter((item) => item.id !== id);
    await persist();
    return { moved };
  }

  /** @param {unknown} ids */
  async function reorderCategories(ids) {
    if (!Array.isArray(ids)) throw new GalleryError('invalid', '排序参数无效');
    const byId = new Map(state.categories.map((item) => [item.id, item]));
    const ordered = ids.filter((id) => typeof id === 'string' && byId.has(id)).map((id) => byId.get(id));
    if (new Set(ordered).size !== state.categories.length) throw new GalleryError('invalid', '排序需要包含全部展区');
    state.categories = ordered;
    await persist();
  }

  /** Moving a work between rooms is not an edit, so it keeps its updatedAt and wall position.
   * @param {string} figureId @param {unknown} categoryId */
  async function moveFigure(figureId, categoryId) {
    if (typeof categoryId !== 'string' || !state.categories.some((item) => item.id === categoryId)) {
      throw new GalleryError('invalid', '找不到这个展区');
    }
    const figure = find(figureId);
    figure.categoryId = categoryId;
    await persist();
    return figure;
  }

  /** Resolve a room by its name, for MCP callers that only know names. @param {unknown} name */
  function categoryIdByName(name) {
    if (typeof name !== 'string' || !name.trim()) return DEFAULT_CATEGORY;
    const lower = name.trim().toLowerCase();
    return state.categories.find((item) => item.name.toLowerCase() === lower)?.id ?? DEFAULT_CATEGORY;
  }

  /** @param {{ title?: string, prompt?: string, size?: string, source: string, categoryId?: unknown }} input */
  async function createFigure(input) {
    const now = Date.now();
    const figure = {
      id: `fig-${randomUUID().slice(0, 8)}`,
      title: cleanText(input.title, 80) || '未命名图解',
      prompt: cleanText(input.prompt, 4000),
      size: input.size === 'hero' ? 'hero' : 'figure',
      source: input.source,
      categoryId: knownCategory(input.categoryId),
      createdAt: now,
      updatedAt: now,
      sessionId: null,
      sourceDir: null,
      versions: [],
      runs: [],
    };
    state.figures.unshift(figure);
    await persist();
    return figure;
  }

  /** @param {string} id @param {(figure: any) => void} mutate */
  async function update(id, mutate) {
    const figure = find(id);
    mutate(figure);
    figure.updatedAt = Date.now();
    if (figure.runs.length > MAX_RUNS_PER_FIGURE) figure.runs.splice(0, figure.runs.length - MAX_RUNS_PER_FIGURE);
    await persist();
    return figure;
  }

  /** @param {string} path @param {string} label */
  async function readPage(path, label) {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      throw new GalleryError('invalid', `${label}需要是绝对路径`);
    }
    const { real, size } = await resolveFile(path, label);
    const ext = extname(real).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') throw new GalleryError('invalid', `${label}必须是 .html 文件`);
    if (size > MAX_PAGE_BYTES) throw new GalleryError('invalid', `${label}超过 30 MB`);
    const buffer = await readFile(real);
    const html = buffer.toString('utf8');
    if (!ANATOMY_MARKER.test(html)) {
      throw new GalleryError('invalid', `${label}看起来不是 anatomy 构建出的页面（缺少 class="iso"）`);
    }
    return { buffer, html };
  }

  /** @param {string | undefined} path @param {string} label */
  async function readPreview(path, label = '预览图') {
    if (!path) return null;
    if (!isAbsolute(path)) throw new GalleryError('invalid', `${label}需要是绝对路径`);
    const { real, size } = await resolveFile(path, label);
    if (!PREVIEW_TYPES.has(extname(real).toLowerCase())) throw new GalleryError('invalid', `${label}只支持 PNG、WebP 或 JPEG`);
    if (size > MAX_PREVIEW_BYTES) throw new GalleryError('invalid', `${label}超过 15 MB`);
    const buffer = await readFile(real);
    const ext = imageType(buffer);
    if (!ext) throw new GalleryError('invalid', `${label}的内容不是 PNG、WebP 或 JPEG 图片`);
    return { buffer, ext };
  }

  /** The kit writes `<name>-light.html` beside the dark page when built with `--light`. */
  async function siblingLight(page) {
    const ext = extname(page);
    if (basename(page, ext).endsWith('-light')) return undefined;
    const candidate = join(dirname(page), `${basename(page, ext)}-light${ext}`);
    try {
      return (await stat(candidate)).isFile() ? candidate : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Copy a built page (and optional light page and preview) into the gallery as a new version.
   * Without a figureId a new figure is created.
   * @param {{ figureId?: string, page: string, lightPage?: string, preview?: string, lightPreview?: string, note?: string,
   *   title?: string, prompt?: string, origin: 'agent' | 'import', model?: object | null,
   *   runId?: string | null, categoryId?: unknown }} input
   */
  async function addVersion(input) {
    const existing = input.figureId ? find(input.figureId) : null;
    const page = await readPage(input.page, '页面');
    const lightPath = input.lightPage || (await siblingLight(input.page));
    const light = lightPath ? await readPage(lightPath, '浅色页面') : null;
    const preview = await readPreview(input.preview, '深色预览图');
    const lightPreview = await readPreview(input.lightPreview, '浅色预览图');

    const figure =
      existing ??
      (await createFigure({
        title: cleanText(input.title, 80) || titleOf(page.html) || basename(input.page, extname(input.page)),
        prompt: input.prompt,
        source: input.origin === 'import' ? 'import' : 'chat',
        categoryId: input.categoryId,
      }));
    const n = (figure.versions.at(-1)?.n ?? 0) + 1;
    const dir = join(filesRoot, figure.id, `v${n}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'dark.html'), page.buffer);
    if (light) await writeFile(join(dir, 'light.html'), light.buffer);
    if (preview) await writeFile(join(dir, `preview${preview.ext}`), preview.buffer);
    if (lightPreview) await writeFile(join(dir, `preview-light${lightPreview.ext}`), lightPreview.buffer);

    const version = {
      n,
      createdAt: Date.now(),
      note: cleanText(input.note, 300),
      origin: input.origin,
      hasLight: !!light,
      previewExt: preview?.ext ?? null,
      lightPreviewExt: lightPreview?.ext ?? null,
      model: input.model ?? null,
      runId: input.runId ?? null,
      sourcePage: input.page,
    };
    await update(figure.id, (item) => {
      item.versions.push(version);
      item.sourceDir = dirname(input.page);
      if (cleanText(input.title, 80) && existing) item.title = cleanText(input.title, 80);
      if (item.title === '未命名图解') item.title = titleOf(page.html) || item.title;
    });
    return { figure, version };
  }

  /** @param {string} id */
  async function remove(id) {
    find(id);
    state.figures = state.figures.filter((item) => item.id !== id);
    await persist();
    await rm(join(filesRoot, id), { recursive: true, force: true });
  }

  /** @param {string} id @param {number} n @param {'dark' | 'light' | 'preview' | 'preview-light'} kind */
  function versionFile(id, n, kind) {
    const figure = find(id);
    const version = figure.versions.find((item) => item.n === n);
    if (!version) throw new GalleryError('not_found', '找不到这个版本');
    const dir = join(filesRoot, figure.id, `v${version.n}`);
    if (kind === 'preview') {
      if (!version.previewExt) throw new GalleryError('not_found', '这个版本没有深色预览图');
      return { path: join(dir, `preview${version.previewExt}`), type: PREVIEW_TYPES.get(version.previewExt) };
    }
    if (kind === 'preview-light') {
      if (!version.lightPreviewExt) throw new GalleryError('not_found', '这个版本没有浅色预览图');
      return { path: join(dir, `preview-light${version.lightPreviewExt}`), type: PREVIEW_TYPES.get(version.lightPreviewExt) };
    }
    if (kind === 'light' && !version.hasLight) throw new GalleryError('not_found', '这个版本没有浅色页面');
    return { path: join(dir, `${kind}.html`), type: 'text/html; charset=utf-8' };
  }

  return {
    load,
    find,
    summary,
    list: () => state.figures.map(summary),
    categoryOf,
    listCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    reorderCategories,
    moveFigure,
    categoryIdByName,
    createFigure,
    update,
    addVersion,
    remove,
    versionFile,
  };
}
