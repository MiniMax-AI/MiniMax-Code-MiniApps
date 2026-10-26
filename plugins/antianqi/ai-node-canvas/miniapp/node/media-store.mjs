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
import { createWriteStream, mkdirSync } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
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
 * The ranges a download must not reach.
 *
 * The loopback, the private ranges, the link-local range, the range that is
 * reserved and the shared address space of a carrier are this machine or the
 * network it sits in. A provider link never points there, so a request to one
 * is refused.
 *
 * The ranges are written down once, as ranges and not as single addresses, so
 * every address inside one of them is refused by the same rule.
 */
const PRIVATE_RANGES = new BlockList();

// IPv4: this network, the private ranges, the loopback, the link-local range,
// the shared space of a carrier, the benchmark range, and everything from
// multicast up (which also covers the reserved range).
PRIVATE_RANGES.addSubnet('0.0.0.0', 8, 'ipv4');
PRIVATE_RANGES.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_RANGES.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE_RANGES.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_RANGES.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_RANGES.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_RANGES.addSubnet('192.0.0.0', 24, 'ipv4');
PRIVATE_RANGES.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_RANGES.addSubnet('198.18.0.0', 15, 'ipv4');
PRIVATE_RANGES.addSubnet('224.0.0.0', 4, 'ipv4');
PRIVATE_RANGES.addSubnet('240.0.0.0', 4, 'ipv4');

// IPv6: the unspecified address, the loopback, the discard range, the
// documentation range, the unique local range, the link-local range and the
// multicast range.
PRIVATE_RANGES.addSubnet('::', 128, 'ipv6');
PRIVATE_RANGES.addSubnet('::1', 128, 'ipv6');
PRIVATE_RANGES.addSubnet('100::', 64, 'ipv6');
PRIVATE_RANGES.addSubnet('2001:db8::', 32, 'ipv6');
PRIVATE_RANGES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_RANGES.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_RANGES.addSubnet('ff00::', 8, 'ipv6');

/**
 * An address in the one form it is written in.
 *
 * The URL parser rewrites an address into its own form, so the same address
 * is always judged the same way: `::ffff:127.0.0.1` and `::ffff:7f00:1` are
 * one address, not two. A zone id says which interface an address is on, not
 * which address it is, so it is dropped.
 */
function normalizedAddress(address) {
  let ip = String(address ?? '').trim().toLowerCase();
  if (!ip) return '';
  ip = ip.replace(/^\[|\]$/g, '');
  ip = ip.split('%')[0];
  if (!ip) return '';
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return ip;
  try {
    return new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return ip;
  }
}

/**
 * The eight numbers an IPv6 address is made of.
 *
 * The written form may leave out the zeroes in the middle, so they are put
 * back: the address is read as the eight numbers it stands for.
 */
function expandIPv6(text) {
  const parts = String(text ?? '').split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head.map((part) => Number.parseInt(part, 16)),
    ...(parts.length === 2 ? Array(missing).fill(0) : []),
    ...tail.map((part) => Number.parseInt(part, 16)),
  ];
  if (groups.length !== 8) return null;
  if (groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  return groups;
}

/**
 * The IPv4 address an IPv6 address carries, if it carries one.
 *
 * Four forms carry an IPv4 address inside an IPv6 one: the mapped form
 * (`::ffff:7f00:1`), the compatible form (`::7f00:1`), the NAT64 form
 * (`64:ff9b::7f00:1`) and the 6to4 form (`2002:7f00:1::`). Each of them
 * points at an IPv4 address, so each of them is judged as that address.
 */
export function embeddedIPv4(address) {
  const ip = normalizedAddress(address);
  if (isIP(ip) !== 6) return null;
  const groups = expandIPv6(ip);
  if (!groups) return null;
  const zero = (from, to) => groups.slice(from, to).every((group) => group === 0);
  const mapped = zero(0, 5) && groups[5] === 0xffff;
  const compatible = zero(0, 6);
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && zero(2, 6);
  const sixToFour = groups[0] === 0x2002;
  let hi = 0;
  let lo = 0;
  if (mapped || compatible || nat64) {
    hi = groups[6];
    lo = groups[7];
  } else if (sixToFour) {
    hi = groups[1];
    lo = groups[2];
  } else {
    return null;
  }
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/**
 * Whether an address is one a download must not reach.
 *
 * The ranges above are the rule. An IPv6 address that carries an IPv4
 * address is judged as that IPv4 address, so the forms that hide one cannot
 * be used to get past the rule.
 */
export function isPrivateAddress(address) {
  const ip = normalizedAddress(address);
  if (!ip) return true;
  const family = isIP(ip);
  if (family === 4) return PRIVATE_RANGES.check(ip, 'ipv4');
  // An address that is neither IPv4 nor IPv6 cannot be reached at all, so it
  // is refused rather than passed on.
  if (family !== 6) return true;
  const carried = embeddedIPv4(ip);
  if (carried) return PRIVATE_RANGES.check(carried, 'ipv4');
  return PRIVATE_RANGES.check(ip, 'ipv6');
}

/**
 * The address a download connects to.
 *
 * Every address a name points at is judged, so a name that points at one
 * private address is refused even when it points at a public one as well.
 * The answer is the address the download uses: the address that was judged
 * is the address that is connected to.
 */
export function pinnedAddress(addresses) {
  const list = (Array.isArray(addresses) ? addresses : [])
    .map((entry) => ({
      address: String(entry?.address ?? entry ?? '').trim(),
      family: Number(entry?.family ?? isIP(String(entry?.address ?? entry ?? ''))) || 4,
    }))
    .filter((entry) => entry.address);
  if (!list.length) return null;
  if (list.some((entry) => isPrivateAddress(entry.address))) return null;
  return list[0];
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
  // The same judgment the download makes: every address is judged, and the
  // one that is used is the one that was judged.
  return Boolean(pinnedAddress(addresses));
}

/**
 * Whether a path is taken.
 *
 * The link itself is looked at, not what it points at: a link that points at
 * nothing is still a name that is taken, so a file is never written through
 * it.
 */
async function exists(path) {
  try {
    await lstat(path);
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
    // The folder is made here, so every caller gets a path it can write to.
    // The path is handed out synchronously, so the folder is made the same
    // way: a caller that writes there without preparing it first loses the
    // file, and the failure shows up as an empty result much later.
    mkdirSync(workDir, { recursive: true });
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
   * The address a download connects to.
   *
   * The name is looked up once, and the answer is what the download uses: the
   * address that was judged is the address that is connected to, so a name
   * that answers one thing for the check and another for the connection cannot
   * get through.
   */
  async function resolvePublic(url) {
    const parsed = new URL(String(url));
    if (!isPublicUrl(parsed.toString())) {
      throw new Error('素材链接指向本机或内网，已拒绝');
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    // An address that is written out is the address that is used.
    if (isIP(host)) return { address: host, family: isIP(host) };
    let addresses = [];
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new Error('素材链接的主机名解析失败');
    }
    const pinned = pinnedAddress(addresses);
    if (!pinned) {
      // No address at all, or one of them is this machine or the network it
      // sits in.
      if (!addresses.length) throw new Error('素材链接的主机名解析失败');
      throw new Error('素材链接指向本机或内网，已拒绝');
    }
    return pinned;
  }

  /**
   * Open a connection to the address that was judged.
   *
   * The name is not looked up again: the connection goes to the address that
   * was checked, so a name cannot answer differently the second time.
   */
  function openPinned(target, pinned, signal) {
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const request = send(
        target,
        {
          lookup: (hostname, options, callback) => {
            if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
            else callback(null, pinned.address, pinned.family);
          },
          headers: {
            // The bytes are wanted as they are: a compressed answer would be
            // written down compressed.
            'accept-encoding': 'identity',
            'user-agent': 'ai-node-canvas',
          },
        },
        (response) => resolve(response),
      );
      request.on('error', reject);
      if (signal) {
        const stop = () => request.destroy(new Error('素材下载超时'));
        if (signal.aborted) stop();
        else signal.addEventListener('abort', stop, { once: true });
      }
      request.end();
    });
  }

  async function downloadTo(url, path, hops = 0) {
    const target = new URL(String(url));
    const pinned = await resolvePublic(target.toString());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await openPinned(target, pinned, controller.signal);
      // The redirect is followed by hand, so every hop is judged too: a
      // public address that redirects into the loopback is still refused.
      if (response.statusCode >= 300 && response.statusCode < 400) {
        const location = response.headers.location;
        response.resume();
        if (!location) throw new Error(`素材下载失败（HTTP ${response.statusCode}）`);
        if (hops >= 5) throw new Error('素材下载失败（重定向过多）');
        return downloadTo(new URL(location, target).toString(), path, hops + 1);
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        throw new Error(`素材下载失败（HTTP ${response.statusCode}）`);
      }
      const type = response.headers['content-type'] ?? '';
      const bytes = Number(response.headers['content-length'] ?? 0);
      if (bytes > MAX_MEDIA_BYTES) {
        response.resume();
        throw new Error('素材超过本机处理上限');
      }
      await pipeline(response, createWriteStream(path));
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
    const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''), 'utf8');
    let finalPath = join(folder, plain);
    let index = 1;
    // The name has to be free: not a file, and not a link that points at
    // nothing either — a link is a name that is taken, so nothing is ever
    // written through one.
    for (;;) {
      if (!(await exists(finalPath))) {
        try {
          await writeFile(finalPath, body, { flag: 'wx' });
          break;
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
        }
      }
      // A name that is taken gets a number: the file that is there is kept.
      const ext = extensionOf(finalPath, '');
      const stem = finalPath.slice(0, finalPath.length - ext.length);
      finalPath = `${stem} (${index})${ext}`;
      index += 1;
    }
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
