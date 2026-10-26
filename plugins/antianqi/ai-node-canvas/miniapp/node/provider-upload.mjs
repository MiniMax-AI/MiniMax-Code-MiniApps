// Uploading a local file to the provider.
//
// The provider reads media by itself, and it only reads assets it holds: a
// local file, or a link on the loopback address, is not reachable for it.
// Its own upload command turns a local file into a temporary public link,
// which is what a generation reference needs.
//
// The command does not take a path — the provider cannot read this machine's
// disk. It takes the file's name and media type and answers with a signed
// form; the bytes are then posted to that form, and the temporary URL is
// where the provider can fetch the file from.
//
// The command is a top-level command of the provider's tool set rather than
// one of the connector tools the CLI lists, so the inventory is read at
// runtime instead of being hard-coded.
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { decodeHostConnectorValue } from './host-connector-value.mjs';

const INVENTORY_TTL_MS = 60_000;

const MIME_BY_EXT = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

function mimeTypeFor(filePath) {
  return MIME_BY_EXT[extname(String(filePath ?? '')).toLowerCase()] ?? 'application/octet-stream';
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the signed form out of the provider's answer.
 *
 * The provider may hand the object over directly or as a JSON string in a
 * `result_json` field, so both shapes are read; nothing else is guessed.
 */
function parseSignedUpload(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (isRecord(raw) && typeof raw.result_json === 'string') {
    try {
      const inner = JSON.parse(raw.result_json);
      if (isRecord(inner)) raw = inner;
    } catch {
      // The outer object is the form itself.
    }
  }
  if (!isRecord(raw)) throw new Error('provider 没有返回可用的上传表单');
  if (raw.code !== undefined && Number(raw.code) !== 0) {
    throw new Error(raw.message ? `provider 拒绝了这次上传：${raw.message}` : 'provider 拒绝了这次上传');
  }
  const uploadHost = typeof raw.upload_host === 'string' ? raw.upload_host.trim() : '';
  const tempUrl = typeof raw.temp_url === 'string' ? raw.temp_url.trim() : '';
  if (!uploadHost || !tempUrl) throw new Error('provider 返回的上传表单不完整');
  // The form carries the signature, so it only travels over https. A
  // loopback host stays on this machine, so it is the one exception.
  const loopback = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(uploadHost);
  if (!uploadHost.startsWith('https://') && !loopback) {
    throw new Error('provider 返回的上传地址不是 https');
  }
  const fields = isRecord(raw.fields) ? raw.fields : {};
  const normalized = {};
  for (const [key, item] of Object.entries(fields)) {
    if (typeof item === 'string') normalized[key] = item;
  }
  return {
    uploadHost,
    tempUrl,
    fields: normalized,
    fileFieldName: typeof raw.file_field_name === 'string' && raw.file_field_name ? raw.file_field_name : 'file',
    maxBytes: Number.isFinite(Number(raw.max_bytes)) ? Number(raw.max_bytes) : null,
  };
}

export function createProviderUploader(context) {
  const connector = context.hostConnector ?? null;
  let inventory = null;
  let inventoryAt = 0;

  async function listTools() {
    if (!connector) return [];
    const now = Date.now();
    if (inventory && now - inventoryAt < INVENTORY_TTL_MS) return inventory;
    try {
      const result = await connector.list();
      inventory = Array.isArray(result?.tools) ? result.tools : [];
    } catch {
      inventory = [];
      inventoryAt = 0;
    }
    inventoryAt = now;
    return inventory;
  }

  async function findTool(suffix) {
    const tools = await listTools();
    return (
      tools.find((item) => item?.name === suffix)
      ?? tools.find((item) => new RegExp(`(^|_)${suffix}$`).test(item?.name ?? ''))
      ?? null
    );
  }

  /** Whether the Host grants the provider's upload command. */
  async function available() {
    return Boolean(await findTool('upload_temp_url'));
  }

  /**
   * Upload a local file and return its temporary public URL.
   *
   * Returns null when the command is not granted, and throws when the
   * provider refuses the file — the reason is worth showing, because it is
   * the difference between "this file can be used" and "this file cannot".
   */
  async function upload(localPath) {
    if (!connector) return null;
    const tool = await findTool('upload_temp_url');
    if (!tool) return null;
    const filename = basename(String(localPath ?? '')) || 'file';
    const mimeType = mimeTypeFor(localPath);

    let result;
    try {
      // The provider cannot read this machine's disk, so it is told what the
      // file is and where the bytes will be posted.
      result = await connector.call(
        tool.toolRef,
        { filename, mime_type: mimeType },
        { signal: context.signal },
      );
    } catch (error) {
      throw Object.assign(
        new Error(`上传素材到 provider 失败：${error?.message ?? error}`),
        { code: 'PROVIDER_UPLOAD_FAILED' },
      );
    }

    const signed = parseSignedUpload(decodeHostConnectorValue(result?.value));

    let bytes;
    try {
      bytes = await readFile(localPath);
    } catch (error) {
      throw Object.assign(
        new Error(`读取要上传的文件失败：${error?.message ?? error}`),
        { code: 'PROVIDER_UPLOAD_FAILED' },
      );
    }
    if (signed.maxBytes !== null && bytes.length > signed.maxBytes) {
      throw Object.assign(
        new Error(`文件超过 provider 的上传上限（${signed.maxBytes} 字节）`),
        { code: 'PROVIDER_UPLOAD_FAILED' },
      );
    }

    const form = new FormData();
    for (const [key, item] of Object.entries(signed.fields)) form.append(key, item);
    form.append(signed.fileFieldName, new Blob([bytes], { type: mimeType }), filename);

    let response;
    try {
      response = await fetch(signed.uploadHost, {
        method: 'POST',
        body: form,
        signal: context.signal,
      });
    } catch (error) {
      throw Object.assign(
        new Error(`上传素材到 provider 失败：${error?.message ?? error}`),
        { code: 'PROVIDER_UPLOAD_FAILED' },
      );
    }
    if (!response.ok) {
      throw Object.assign(
        new Error(`上传素材到 provider 失败：HTTP ${response.status}`),
        { code: 'PROVIDER_UPLOAD_FAILED' },
      );
    }
    return { url: signed.tempUrl, tool: tool.name };
  }

  return { available, upload };
}
