// @ts-check

/**
 * Cover / illustration rendering.
 *
 * Path proven by probe before authoring:
 *   1. context.tool.call('connector__matrix__generate_image', { requests }) -> node_id
 *   2. context.tool.call('connector__matrix__get_asset_url', { node_id }) -> signed URL
 *   3. fetch(signedUrl) -> image bytes, stored under dataDir/assets
 *
 * Every step goes through context.tool, so the whole path is judged by the
 * user's permission rules and no local process is spawned.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeHostConnectorValue } from './host-connector-value.mjs';

export const GENERATE_TOOL = 'connector__matrix__generate_image';
export const ASSET_URL_TOOL = 'connector__matrix__get_asset_url';

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Hosts a signed image URL may point at.
 *
 * The URL comes from `connector__matrix__get_asset_url` and points at the
 * Matrix Drive object storage bucket, so only an Alibaba Cloud OSS host is
 * fetched. A tool that returns an internal address — or a 302 that points
 * one — can therefore never make this process request it.
 */
const ASSET_HOST_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}\.oss-[a-z0-9-]{2,30}\.aliyuncs\.com$/;
const MAX_REDIRECTS = 3;

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function isAllowedAssetHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;
  // Literal addresses are never allowed, loopback and private ones included.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(':')) return false;
  return ASSET_HOST_PATTERN.test(host);
}

/**
 * @param {string} url
 * @returns {URL}
 */
export function assertAllowedAssetUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    const error = new Error('素材地址无法解析');
    error.code = 'ASSET_URL_INVALID';
    throw error;
  }
  if (parsed.protocol !== 'https:') {
    const error = new Error('素材地址必须使用 HTTPS');
    error.code = 'ASSET_URL_PROTOCOL';
    throw error;
  }
  if (!isAllowedAssetHost(parsed.hostname)) {
    const error = new Error(`素材地址的主机不在允许范围内：${parsed.hostname}`);
    error.code = 'ASSET_URL_HOST_NOT_ALLOWED';
    throw error;
  }
  return parsed;
}

/**
 * @param {string} fileName
 * @returns {string}
 */
function extOf(fileName) {
  const match = /\.[a-z0-9]+$/i.exec(String(fileName ?? ''));
  const ext = match ? match[0].toLowerCase() : '.jpg';
  return MIME_BY_EXT[ext] ? ext : '.jpg';
}

/**
 * Pull the provider batch out of a raw connector value.
 *
 * The provider returns success_items / failed_items. A decoded value that
 * carries no recognisable batch is a parse error, not an empty result.
 *
 * @param {unknown} value
 * @returns {{ success: any[], failed: any[], total: number }}
 */
export function extractBatch(value) {
  /** @type {any[]} */
  const found = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (depth > 5 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const record = /** @type {Record<string, any>} */ (node);
    if (Array.isArray(record.success_items) || Array.isArray(record.failed_items)) {
      if (!seen.has(record)) {
        seen.add(record);
        found.push(record);
      }
    }
    for (const key of Object.keys(record)) walk(record[key], depth + 1);
  };
  walk(value, 0);

  const batch = found[0];
  if (!batch) {
    const error = new Error('无法解析图片生成结果');
    error.code = 'IMAGE_RESULT_UNPARSEABLE';
    throw error;
  }
  const success = Array.isArray(batch.success_items) ? batch.success_items : [];
  const failed = Array.isArray(batch.failed_items) ? batch.failed_items : [];
  const total = typeof batch.total_requested === 'number' ? batch.total_requested : success.length + failed.length;
  return { success, failed, total };
}

/**
 * Read the download URL out of a connector result.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function extractDownloadUrl(value) {
  let decoded = decodeHostConnectorValue(value);
  if (typeof decoded === 'string') {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      return decoded;
    }
  }
  if (decoded && typeof decoded === 'object') {
    const record = /** @type {Record<string, any>} */ (decoded);
    for (const key of ['download_url', 'downloadUrl', 'url', 'signed_url']) {
      if (typeof record[key] === 'string' && record[key]) return record[key];
    }
  }
  return '';
}

/**
 * Find a tool in the live inventory by runtime name, or by provider and tool.
 *
 * @param {any[]} tools
 * @param {string} name
 * @param {RegExp} pattern
 * @returns {any | undefined}
 */
function findTool(tools, name, pattern) {
  return (
    tools.find((tool) => tool.name === name) ||
    tools.find(
      (tool) =>
        tool.kind === 'connector' &&
        tool.provider === 'matrix' &&
        pattern.test(String(tool.tool || '')),
    )
  );
}

/**
 * Resolve a Drive node to a short-lived signed URL through the same tool
 * inventory the app already uses for generation.
 *
 * @param {any} context
 * @param {string} nodeId
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<string>}
 */
export async function resolveAssetUrl(context, nodeId, options = {}) {
  if (!/^\d+$/.test(String(nodeId ?? ''))) {
    const error = new Error('非法的素材标识');
    error.code = 'INVALID_NODE_ID';
    throw error;
  }
  if (!context.tool) {
    const error = new Error('当前 Mini App 未获得工具调用权限，无法取回图片地址');
    error.code = 'TOOL_NOT_PERMITTED';
    throw error;
  }

  const listed = await context.tool.list();
  const tool = findTool(listed.tools || [], ASSET_URL_TOOL, /get_asset_url/);
  if (!tool) {
    const error = new Error('当前环境没有提供素材地址接口，无法取回生成图片的下载地址');
    error.code = 'ASSET_CHANNEL_UNAVAILABLE';
    throw error;
  }

  // The argument name comes from the tool's own schema, not from a guess.
  const properties = tool.inputSchema?.properties || {};
  const key = 'node_id' in properties ? 'node_id' : 'nodeId' in properties ? 'nodeId' : 'node_id';

  const result = await context.tool.call(tool.name, { [key]: String(nodeId) }, options.signal ? { signal: options.signal } : {});
  const url = extractDownloadUrl(result.kind === 'connector' ? result.value : result);
  if (!url) {
    const error = new Error('素材地址接口没有返回下载地址');
    error.code = 'ASSET_CHANNEL_UNAVAILABLE';
    throw error;
  }
  return url;
}

/**
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function downloadAsset(url) {
  let current = url;
  // Redirects are followed by hand: every hop is checked against the same
  // allowlist, so a 302 can never move the request to another host.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const parsed = assertAllowedAssetUrl(current);
    const response = await fetch(parsed.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(45000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        const error = new Error('素材地址返回了重定向，但没有目标地址');
        error.code = 'ASSET_DOWNLOAD_FAILED';
        throw error;
      }
      current = new URL(location, parsed).toString();
      continue;
    }
    if (!response.ok) {
      const error = new Error(`素材下载失败（HTTP ${response.status}）`);
      error.code = 'ASSET_DOWNLOAD_FAILED';
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  }
  const error = new Error('素材地址重定向次数过多');
  error.code = 'ASSET_DOWNLOAD_FAILED';
  throw error;
}

/**
 * Render cover + illustration slots for one draft.
 *
 * @param {any} context
 * @param {any} draft
 * @param {{ cover: any, illustrations: any[] }} plan
 * @param {string} assetsDir
 * @param {{ target?: string, signal?: AbortSignal }} [options]
 * @returns {Promise<{ assets: Record<string, any>, failures: any[] }>}
 */
export async function renderImages(context, draft, plan, assetsDir, options = {}) {
  const target = options.target || 'all';
  const slots = [];
  if (target === 'cover' || target === 'all') slots.push(plan.cover);
  if (target === 'illustrations' || target === 'all') slots.push(...plan.illustrations);
  if (slots.length === 0) return { assets: {}, failures: [] };

  if (!context.tool) {
    const error = new Error('当前 Mini App 未获得工具调用权限，无法渲染图片');
    error.code = 'TOOL_NOT_PERMITTED';
    throw error;
  }

  /** @type {Record<string, any>} */
  const assets = {};
  /** @type {any[]} */
  const failures = [];

  // One Connector call per slot. A Connector tool times out after 30 s, and a
  // multi-image batch easily exceeds that, so each slot is isolated: a slow
  // image fails on its own instead of cancelling the whole render.
  for (const slot of slots) {
    try {
      const result = await context.tool.call(
        GENERATE_TOOL,
        {
          requests: [
            {
              prompt: slot.prompt,
              aspect_ratio: slot.ratio,
              area: '1K',
              n: 1,
              output_format: 'jpeg',
              output_file: slot.id,
            },
          ],
        },
        options.signal ? { signal: options.signal } : {},
      );

      if (result.kind !== 'connector') {
        const error = new Error('图片生成通道返回了非预期结果');
        error.code = 'IMAGE_RESULT_UNPARSEABLE';
        throw error;
      }

      const batch = extractBatch(decodeHostConnectorValue(result.value));
      if (batch.success.length === 0) {
        const reason = batch.failed[0]?.reason || batch.failed[0]?.message || '生成服务未返回任何图片';
        const error = new Error(`图片生成失败：${reason}`);
        error.code = 'IMAGE_GENERATION_FAILED';
        error.details = batch.failed;
        throw error;
      }

      const item = batch.success[0];
      const nodeId = String(item?.node_id ?? '');
      const fileName = String(item?.file_name ?? '');
      if (!nodeId) {
        const error = new Error('生成结果缺少素材标识');
        error.code = 'ASSET_FETCH_FAILED';
        throw error;
      }

      const url = await resolveAssetUrl(context, nodeId, { signal: options.signal });
      const bytes = await downloadAsset(url);
      const assetId = randomUUID();
      const ext = extOf(fileName);
      await writeFile(join(assetsDir, `${assetId}${ext}`), bytes);
      assets[slot.id] = {
        assetId,
        nodeId,
        fileName,
        ext,
        mime: MIME_BY_EXT[ext] || 'image/jpeg',
        bytes: bytes.length,
        role: slot.role,
        ratio: slot.ratio,
        renderedAt: new Date().toISOString(),
      };
    } catch (error) {
      const code = /** @type {any} */ (error)?.code || 'RENDER_FAILED';
      const reason =
        code === 'TOOL_TIMEOUT'
          ? '图片生成超过 30 秒未返回（接口超时），可单独重试这一张'
          : /** @type {any} */ (error)?.message || '渲染失败';
      failures.push({ slotId: slot.id, role: slot.role, reason, code });
    }
  }

  return { assets, failures };
}
