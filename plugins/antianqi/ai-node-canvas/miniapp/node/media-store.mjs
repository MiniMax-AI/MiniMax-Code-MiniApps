// The local media store.
//
// The reference implementation keeps the generated media in a local asset
// folder and serves it from its own HTTP server; the same split is used
// here. The input side downloads a provider asset into a working file, and
// the output side publishes a produced file under a stable URL.
//
// The provider hands out a short-lived download link, so a link that has
// expired is refreshed through the connector instead of failing the tool.
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { decodeHostConnectorValue } from './host-connector-value.mjs';
import { createProviderUploader } from './provider-upload.mjs';

const ASSET_URL_PREFIX = '/assets/';
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_MEDIA_BYTES = 512 * 1024 * 1024;

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const KIND_BY_EXT = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.m4a': 'audio',
  '.mp3': 'audio',
  '.wav': 'audio',
};

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
};

export function extForMime(mimeType) {
  return EXT_BY_MIME[String(mimeType ?? '')] ?? '.bin';
}

export function mimeForExt(ext) {
  return MIME_BY_EXT[String(ext ?? '').toLowerCase()] ?? 'application/octet-stream';
}

export function kindForExt(ext) {
  return KIND_BY_EXT[String(ext ?? '').toLowerCase()] ?? 'image';
}

function extensionOf(url, fallback = '.bin') {
  const clean = String(url ?? '').split('?')[0].split('#')[0];
  const match = /\.[a-z0-9]{2,5}$/i.exec(clean);
  return match ? match[0].toLowerCase() : fallback;
}

/**
 * Where a person looks for a file they saved.
 *
 * The folder is the one the system uses, whatever it is called on screen.
 */
function downloadsDir() {
  return join(homedir(), 'Downloads');
}

/**
 * A plain file name: one segment of a name, never a path.
 *
 * The name of a material and the name a file is saved under both end up on
 * the file system, so this is the rule they share: no separator survives,
 * and a dot segment is not a name at all. One rule, so an id can never
 * name the folder above the assets.
 */
export function plainName(name) {
  const clean = String(name ?? '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 120);
  if (!clean) return null;
  if (clean === '.' || clean === '..') return null;
  return clean;
}

/**
 * A path inside a folder, or nothing.
 *
 * A name that walks out of the folder is refused, not tidied up: `.` is the
 * folder itself, `..` is its parent, and anything that resolves outside
 * the folder is refused too. The check is made on the **resolved** path, so
 * a name that only looks harmless cannot escape.
 */
export function resolveInside(folder, name) {
  const base = resolve(String(folder ?? ''));
  const raw = String(name ?? '').trim();
  if (!raw) return null;
  const target = resolve(base, raw);
  const inside = relative(base, target);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null;
  return target;
}

/**
 * Whether an address is one a download must not reach.
 *
 * The loopback, the private ranges, the link-local range and the reserved
 * ranges are this machine or the network it sits in. A provider link never
 * points there, so a request to one is refused.
 */
export function isPrivateAddress(address) {
  const ip = String(address ?? '').trim().toLowerCase();
  if (!ip) return true;
  if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  // An IPv4 address written inside an IPv6 one (::ffff:127.0.0.1).
  if (ip.startsWith('::ffff:')) return isPrivateAddress(ip.slice(7));
  if (/^fe[89ab]/.test(ip)) return true;
  if (/^f[cd]/.test(ip)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!v4) return false;
  const first = Number(v4[1]);
  const second = Number(v4[2]);
  if (first === 0 || first === 127) return true;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  if (first >= 224) return true;
  return false;
}

/**
 * Whether a link may be fetched at all.
 *
 * A name is judged by its shape: it has to be an http(s) link, and a link
 * that spells out a private address is refused. A name that has to be
 * looked up is judged when it is looked up.
 */
export function isPublicUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (isIP(host)) return !isPrivateAddress(host);
  return true;
}

/**
 * Whether one hop of a download may be made.
 *
 * The address is judged twice: by its shape (a private address spelled out
 * is refused at once) and by where the name points (a name that resolves
 * into this machine is refused too). Every hop of a redirect is judged the
 * same way, so a public address that redirects into the loopback is
 * refused as well.
 */
export function isAllowedHop(url, addresses = []) {
  if (!isPublicUrl(url)) return false;
  return !addresses.some((entry) => isPrivateAddress(entry?.address ?? entry));
}

/** Whether a path is taken. */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function createMediaStore(context) {
  const assetsDir = join(context.dataDir, 'assets');
  const workDir = join(context.dataDir, 'work');
  const uploadsDir = join(context.dataDir, 'uploads');
  // The upload to the provider lives in one place, so the media tools and
  // the generation references cannot drift apart on how it is called.
  const uploader = createProviderUploader(context);

  // The file types the canvas accepts as a local asset.
  const UPLOAD_KIND = {
    '.jpg': 'image',
    '.jpeg': 'image',
    '.png': 'image',
    '.webp': 'image',
    '.gif': 'image',
    '.bmp': 'image',
    '.mp4': 'video',
    '.mov': 'video',
    '.webm': 'video',
    '.m4a': 'audio',
    '.mp3': 'audio',
    '.wav': 'audio',
  };

  async function ensureDirs() {
    await mkdir(assetsDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(uploadsDir, { recursive: true });
  }

  function assetUrl(name) {
    return `${ASSET_URL_PREFIX}${name}`;
  }

  // A fresh output path. The file lives in the working folder until the tool
  // succeeds, and is published into the asset folder afterwards.
  function out(ext) {
    const name = `m_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}${ext}`;
    return join(workDir, name);
  }

  // A scratch file that is never published.
  async function writeTemp(name, content) {
    await ensureDirs();
    const path = join(workDir, name);
    await writeFile(path, content, 'utf8');
    return path;
  }

  /**
   * The address a download may go to.
   *
   * A link that spells out a private address is refused straight away, and
   * a name is looked up first: if any of the addresses it points at is
   * this machine or the network it sits in, the download is refused too.
   */
  async function assertPublicUrl(url) {
    const parsed = new URL(String(url));
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) {
      if (!isAllowedHop(url, [])) throw new Error('素材链接指向本机或内网，已拒绝');
      return parsed.toString();
    }
    let addresses = [];
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new Error('素材链接的主机名解析失败');
    }
    if (!addresses.length) throw new Error('素材链接的主机名解析失败');
    if (!isAllowedHop(url, addresses)) throw new Error('素材链接指向本机或内网，已拒绝');
    return parsed.toString();
  }

  async function downloadTo(url, path, hops = 0) {
    const target = await assertPublicUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(target, { signal: controller.signal, redirect: 'manual' });
      // The redirect is followed by hand, so every hop is judged too: a
      // public address that redirects into the loopback is still refused.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) throw new Error(`素材下载失败（HTTP ${response.status}）`);
        if (hops >= 5) throw new Error('素材下载失败（重定向过多）');
        return downloadTo(new URL(location, target).toString(), path, hops + 1);
      }
      if (!response.ok) {
        throw new Error(`素材下载失败（HTTP ${response.status}）`);
      }
      const type = response.headers.get('content-type') ?? '';
      const bytes = Number(response.headers.get('content-length') ?? 0);
      if (bytes > MAX_MEDIA_BYTES) {
        throw new Error('素材超过本机处理上限');
      }
      if (!response.body) {
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(path, buffer);
        return { path, bytes: buffer.length };
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
      const info = await stat(path);
      return { path, bytes: info.size, mimeType: type };
    } finally {
      clearTimeout(timer);
    }
  }

  // A fresh download link for an asset the provider still holds.
  async function refreshAssetUrl(nodeId) {
    const connector = context.hostConnector;
    if (!connector || !nodeId) return null;
    try {
      const inventory = await connector.list();
      const tools = Array.isArray(inventory?.tools) ? inventory.tools : [];
      const tool =
        tools.find((item) => item?.name === 'get_asset_url')
        ?? tools.find((item) => /(^|_)get_asset_url$/.test(item?.name ?? ''));
      if (!tool) return null;
      const result = await connector.call(tool.toolRef, { node_id: nodeId }, { signal: context.signal });
      const value = decodeHostConnectorValue(result.value);
      return value?.url ?? value?.link ?? value?.download_url ?? null;
    } catch {
      return null;
    }
  }

  // A fresh link for a finished video task.
  //
  // The provider keeps the video for a while, but the download link is
  // temporary, so the task is asked again instead of failing on a dead URL.
  async function refreshVideoUrl(taskId, model) {
    const connector = context.hostConnector;
    if (!connector || !taskId) return null;
    try {
      const inventory = await connector.list();
      const tools = Array.isArray(inventory?.tools) ? inventory.tools : [];
      const tool =
        tools.find((item) => item?.name === 'query_video_generation')
        ?? tools.find((item) => /(^|_)query_video_generation$/.test(item?.name ?? ''));
      if (!tool) return null;
      const args = { task_id: taskId };
      if (model) args.model = model;
      const result = await connector.call(tool.toolRef, args, { signal: context.signal });
      const value = decodeHostConnectorValue(result.value);
      return value?.video_url ?? value?.url ?? value?.download_url ?? null;
    } catch {
      return null;
    }
  }

  // Whether the Host exposes the provider's upload command.
  async function hasUploadTool() {
    return uploader.available();
  }

  /**
   * Upload a local file and get a temporary public URL.
   *
   * The provider's media gateway only reads assets it holds itself: a raw
   * generation link is refused with "could not be used as a media source".
   * A file this MiniApp produced has to be uploaded first, which is what the
   * reference implementation does as well.
   *
   * The upload itself lives in one place, because the provider's upload
   * command takes a signed form and the bytes have to be posted to it.
   */
  async function uploadTempUrl(filePath) {
    return uploader.upload(filePath);
  }

  /**
   * Turn a media reference into a local file.
   *
   * A data URL is decoded, an already published asset is reused, and a
   * provider link is downloaded. When the link has expired, it is refreshed
   * through the connector once before the tool gives up.
   *
   * The file behind a published asset is **borrowed**, not owned: the canvas
   * still points at it. Only `discard` knows what may be thrown away.
   */
  async function materialize(media, { fallbackExt = '.mp4' } = {}) {
    const url = String(media?.url ?? '').trim();
    if (!url) {
      throw Object.assign(new Error('素材地址为空'), { code: 'INVALID_ARGUMENTS' });
    }
    await ensureDirs();

    if (url.startsWith(ASSET_URL_PREFIX)) {
      const name = url.slice(ASSET_URL_PREFIX.length);
      const path = join(assetsDir, name);
      try {
        await stat(path);
        return { path, ext: extensionOf(name, fallbackExt) };
      } catch {
        throw Object.assign(
          new Error(`本地产物已不存在（${name}），重新生成这一步，或者从资产库把它插回来`),
          { code: 'MEDIA_MISSING' },
        );
      }
    }

    if (url.startsWith('data:')) {
      const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
      if (!match) {
        throw Object.assign(new Error('素材数据无法解析'), { code: 'INVALID_ARGUMENTS' });
      }
      const [, mimeType, isBase64, payload] = match;
      const buffer = isBase64
        ? Buffer.from(payload, 'base64')
        : Buffer.from(decodeURIComponent(payload), 'utf8');
      const ext = EXT_BY_MIME[String(mimeType ?? '').split(';')[0]] ?? fallbackExt;
      const path = join(workDir, `in_${randomUUID().slice(0, 8)}${ext}`);
      await writeFile(path, buffer);
      return { path, ext };
    }

    if (!/^https?:\/\//i.test(url)) {
      throw Object.assign(new Error('素材地址不是可处理的链接'), { code: 'INVALID_ARGUMENTS' });
    }

    const ext = extensionOf(url, fallbackExt);
    const path = join(workDir, `in_${randomUUID().slice(0, 8)}${ext}`);
    try {
      const result = await downloadTo(url, path);
      return { path, ext, bytes: result.bytes };
    } catch (error) {
      // The provider link is short-lived, so an expired one is refreshed.
      // A video is refreshed by asking its task again; other assets use the
      // drive node id.
      const fresh =
        (await refreshVideoUrl(media?.taskId, media?.model)) ?? (await refreshAssetUrl(media?.nodeId));
      if (!fresh) {
        throw Object.assign(new Error(`素材下载失败：${error.message}`), { code: 'MEDIA_DOWNLOAD_FAILED' });
      }
      try {
        const result = await downloadTo(fresh, path);
        return { path, ext, bytes: result.bytes };
      } catch (retryError) {
        throw Object.assign(new Error(`素材下载失败：${retryError.message}`), { code: 'MEDIA_DOWNLOAD_FAILED' });
      }
    }
  }

  // Publish a produced file under a stable URL.
  async function publish(filePath, ext) {
    await ensureDirs();
    const name = filePath.split(/[\\/]/).pop();
    const info = await stat(filePath);
    return {
      url: assetUrl(name),
      name,
      bytes: info.size,
      mimeType: mimeForExt(ext),
      kind: kindForExt(ext),
    };
  }

  // Move a file into the published folder under a new name.
  async function publishAs(filePath, ext) {
    await ensureDirs();
    const name = `m_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}${ext}`;
    const target = join(assetsDir, name);
    await rename(filePath, target).catch(async () => {
      // A cross-device rename fails, so the bytes are copied instead.
      const data = await readFile(filePath);
      await writeFile(target, data);
    });
    const info = await stat(target);
    return {
      url: assetUrl(name),
      name,
      bytes: info.size,
      mimeType: mimeForExt(ext),
      kind: kindForExt(ext),
    };
  }

  /**
   * Publish bytes this runtime produced into the asset folder.
   *
   * The tools that draw in the browser (宫格切分 / 剪裁) hand their bytes over
   * instead of a link. They belong with the other produced files, so they are
   * published under the same naming: a canvas that points at them can save
   * them, list them in the library and hand them to the provider.
   */
  async function publishBytes(bytes, ext = '.png') {
    await ensureDirs();
    const match = /\.[A-Za-z0-9]{2,5}$/.exec(String(ext ?? ''));
    const safeExt = match ? match[0].toLowerCase() : '.png';
    if (!bytes?.length) {
      throw Object.assign(new Error('文件是空的'), { code: 'INVALID_ARGUMENTS' });
    }
    const name = `m_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}${safeExt}`;
    const target = join(assetsDir, name);
    await writeFile(target, bytes);
    const info = await stat(target);
    return {
      url: assetUrl(name),
      name,
      bytes: info.size,
      mimeType: mimeForExt(safeExt),
      kind: kindForExt(safeExt),
    };
  }

  // Remove a scratch file that is no longer needed.
  //
  // Only a file in the working folder is scratch. A published asset belongs to
  // the canvas that points at it, and this is the last line of defence
  // against a caller that forgets to tell a scratch file from a borrowed one:
  // deleting the source of a tool would kill the picture the node still shows.
  async function discard(path) {
    try {
      // The same rule as everywhere else: a path inside a folder, or nothing.
      const target = resolveInside(workDir, path);
      if (!target) return false;
      await rm(target, { force: true });
      return true;
    } catch {
      // The scratch file is not worth failing the tool over.
      return false;
    }
  }

  /**
   * Store a file the user picked from their machine.
   *
   * The file is kept under the runtime's own data directory and served from
   * there, so it survives a restart and is reachable from the page.
   *
   * `expectedKind` is the kind of the input node the file was picked for. An
   * input node holds one kind of material, so a picture node does not take a
   * video: the file is refused instead of landing in the wrong node.
   */
  async function saveUpload(name, bytes, expectedKind = '') {
    await ensureDirs();
    const match = /\.[A-Za-z0-9]{2,5}$/.exec(String(name ?? ''));
    const ext = match ? match[0].toLowerCase() : '';
    const kind = UPLOAD_KIND[ext];
    if (!kind) {
      throw Object.assign(
        new Error(`不支持的文件类型${ext ? ` ${ext}` : ''}，可以传图片、视频或音频`),
        { code: 'INVALID_ARGUMENTS' },
      );
    }
    const wanted = String(expectedKind ?? '');
    if (wanted && wanted !== 'text' && wanted !== kind) {
      const label = { image: '图片', video: '视频', audio: '音频' };
      throw Object.assign(
        new Error(
          `这个输入节点装的是${label[wanted] ?? wanted}，收到的是${label[kind] ?? kind}文件`,
        ),
        { code: 'INVALID_ARGUMENTS' },
      );
    }
    if (!bytes?.length) {
      throw Object.assign(new Error('文件是空的'), { code: 'INVALID_ARGUMENTS' });
    }
    const fileName = `up_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}${ext}`;
    const path = join(uploadsDir, fileName);
    await writeFile(path, bytes);
    return {
      url: `/uploads/${fileName}`,
      name: fileName,
      originalName: String(name ?? fileName).slice(0, 160),
      kind,
      bytes: bytes.length,
      mimeType: mimeForExt(ext),
      path,
    };
  }

  // The local file behind a URL this runtime serves.
  //
  // The URL carries the folder twice ("/assets/name.png" is the file
  // "name.png" in the asset folder), so the name is taken from the end and
  // the folder is decided by the prefix.
  function localPathOf(url) {
    const text = String(url ?? '');
    const folder = text.startsWith('/uploads/') ? uploadsDir
      : text.startsWith('/assets/') ? assetsDir
      : null;
    if (!folder) return null;
    const name = text.slice(text.lastIndexOf('/') + 1).replace(/[^\w.\-]/g, '');
    return name ? join(folder, name) : null;
  }

  /** Read an uploaded file, for the HTTP route that serves it. */
  async function readUpload(name) {
    const safe = String(name ?? '').replace(/[^\w.\-]/g, '');
    if (!safe) return null;
    try {
      const data = await readFile(join(uploadsDir, safe));
      return { data, mimeType: mimeForExt(safe.slice(safe.lastIndexOf('.'))) };
    } catch {
      return null;
    }
  }

  /**
   * Publish a remote asset locally.
   *
   * A provider link is temporary, so the produced file is downloaded and
   * kept under this runtime's own asset folder. The canvas then refers to a
   * link that does not expire, the way the reference implementation keeps
   * its assets in its own folder.
   */
  async function publishRemote(url, kind = 'image') {
    const text = String(url ?? '');
    if (!text) return null;
    if (text.startsWith('/assets/')) return text;
    const fallback = kind === 'video' ? '.mp4' : kind === 'audio' ? '.m4a' : '.png';
    const local = await materialize({ url: text }, { fallbackExt: fallback });
    const asset = await publishAs(local.path, local.ext || fallback);
    return asset.url;
  }

  /** Read a published asset, for the HTTP route that serves it. */
  async function readAsset(name) {
    const safe = String(name ?? '').replace(/[^\w.\-]/g, '');
    if (!safe) return null;
    const path = join(assetsDir, safe);
    try {
      const data = await readFile(path);
      return { data, mimeType: mimeForExt(safe.slice(safe.lastIndexOf('.'))) };
    } catch {
      return null;
    }
  }

  /**
   * Every local asset this runtime holds.
   *
   * The library is the folder itself: what was generated and what the user
   * picked from their machine. The list says what kind each file is and how
   * big it is, so the page can show it without reading the file.
   */
  async function listLibrary() {
    await ensureDirs();
    const out = [];
    for (const [folder, prefix] of [[assetsDir, ASSET_URL_PREFIX], [uploadsDir, '/uploads/']]) {
      const entries = await readdir(folder).catch(() => []);
      for (const name of entries) {
        const info = await stat(join(folder, name)).catch(() => null);
        if (!info?.isFile()) continue;
        const ext = extensionOf(name, '.bin');
        out.push({
          id: name,
          url: `${prefix}${name}`,
          name,
          kind: kindForExt(ext),
          mimeType: mimeForExt(ext),
          bytes: info.size,
          createdAt: new Date(info.mtimeMs).toISOString(),
        });
      }
    }
    out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return out;
  }

  /**
   * Remove one local asset.
   *
   * The name is the file name, and it is cleaned before it is used, so a
   * name that tries to walk out of the folder finds nothing.
   */
  async function removeAsset(name) {
    const safe = String(name ?? '').replace(/[^\w.\-]/g, '');
    if (!safe) return false;
    for (const folder of [assetsDir, uploadsDir]) {
      const path = join(folder, safe);
      try {
        await stat(path);
      } catch {
        continue;
      }
      await rm(path, { force: true });
      return true;
    }
    return false;
  }

  /**
   * Put a file where the user can find it.
   *
   * The file is already on this machine, but it lives in the runtime's own
   * folder, which is not somewhere a person looks for a picture. Saving it
   * copies it into the Downloads folder under the name the user knows it by.
   * A file that is already there is not overwritten: the copy gets a number.
   *
   * Both names are checked: the name of the material and the name it is
   * saved under. A name that walks out of its folder is refused, so a
   * request cannot write next to the Downloads folder.
   */
  async function saveToDownloads(name, wanted = '', targetDir = '') {
    // The material is named by a plain name: no separator, no dot segment.
    // That is what keeps the lookup inside the folder it belongs to.
    const safe = plainName(name);
    if (!safe) return { ok: false, reason: 'not_found' };
    let source = null;
    for (const folder of [assetsDir, uploadsDir]) {
      const path = join(folder, safe);
      try {
        await stat(path);
        source = path;
        break;
      } catch {
        continue;
      }
    }
    if (!source) return { ok: false, reason: 'not_found' };
    const folder = targetDir || downloadsDir();
    // The name is judged as it was given: a name that walks out of the
    // folder is refused, not tidied up into something that looks safe.
    const asked = String(wanted ?? '').trim();
    if (!resolveInside(folder, asked || safe)) return { ok: false, reason: 'bad_name' };
    // What lands on disk is one plain name: the separators are taken out,
    // so the file lands in the folder itself.
    const target = join(folder, plainName(asked) ?? safe);
    const info = await stat(source);
    let finalPath = target;
    let index = 1;
    // A file that is already there is kept: the copy gets a number.
    while (await exists(finalPath)) {
      const ext = extensionOf(target, '');
      const stem = target.slice(0, target.length - ext.length);
      finalPath = `${stem} (${index})${ext}`;
      index += 1;
    }
    await copyFile(source, finalPath);
    // The copy is a file the user just saved, so it says so: a copied file
    // keeps the time of the original, which would make a fresh save look old.
    const now = new Date();
    await utimes(finalPath, now, now).catch(() => {});
    return { ok: true, path: finalPath, bytes: info.size, name: finalPath.split(/[\\/]/).pop() };
  }

  /**
   * Write a file of our own into a folder of this machine.
   *
   * The file the page makes — a template to share, for instance — has to land
   * where a person looks for it. The browser's own download cannot be trusted
   * to finish here, so the runtime writes the file and says where it went.
   *
   * The folder is the one the user named, and the name is judged as it was
   * given: a name that walks out of the folder is refused, not tidied up into
   * something that looks safe.
   */
  async function writeToFolder(name, data, targetDir = '') {
    const asked = String(name ?? '').trim();
    if (!asked) return { ok: false, reason: 'bad_name' };
    const folder = targetDir ? String(targetDir) : downloadsDir();
    if (!resolveInside(folder, asked)) return { ok: false, reason: 'bad_name' };
    const plain = plainName(asked);
    if (!plain) return { ok: false, reason: 'bad_name' };
    await mkdir(folder, { recursive: true });
    let finalPath = join(folder, plain);
    let index = 1;
    // A file that is already there is kept: the new one gets a number.
    while (await exists(finalPath)) {
      const ext = extensionOf(finalPath, '');
      const stem = finalPath.slice(0, finalPath.length - ext.length);
      finalPath = `${stem} (${index})${ext}`;
      index += 1;
    }
    const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''), 'utf8');
    await writeFile(finalPath, body);
    return { ok: true, path: finalPath, bytes: body.length, name: finalPath.split(/[\\/]/).pop() };
  }

  return {
    assetsDir,
    workDir,
    out,
    writeTemp,
    materialize,
    publish,
    publishAs,
    readAsset,
    assetUrl,
    uploadTempUrl,
    hasUploadTool,
    refreshVideoUrl,
    discard,
    saveUpload,
    publishBytes,
    localPathOf,
    readUpload,
    publishRemote,
    uploadsDir,
    listLibrary,
    removeAsset,
    saveToDownloads,
    writeToFolder,
  };
}
