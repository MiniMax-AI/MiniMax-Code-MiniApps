// 图片下载地址安全校验。
//
// 为什么要管：规划节点（LLM）可以在 image.spec.refs 里直接写公网地址，运行时只校验了
// 协议是不是 http/https 就去 fetch，地址本身没人看。于是 http://169.254.169.254/ 这种
// 云元数据地址会被当成「参考图」下载并落盘到 refcache/。
//
// 只拦两类，都是「不可能是合法图片源、但恰恰最危险」的地址：
//   169.254.0.0/16  链路本地段，AWS/GCP/Azure/阿里云的元数据服务都在这里
//   0.0.0.0 / ::    通配地址
// 另外顺带拦 fe80::/10（IPv6 的链路本地段，和 169.254/16 是同一语义，同样零误伤）。
//
// 私有段（10./172.16./192.168.）和 127.0.0.1 / ::1 在这一层放行：H3 接口本身可能就在企业
// 内网，它返回的成图地址也是内网地址；用户也可能合法地在需求里给出家里 NAS 上的照片当参考图。
// 检索工具给出的第三方地址另有一层更严的检查，见下面的 privateReason。
//
// 绕过形式必须一起堵，否则等于没拦：
//   - 2852039166 / 0251.0376.0251.0376 / 0xA9.0xFE.0xA9.0xFE 这类 IPv4 写法，WHATWG URL
//     会先归一化成点分十进制，所以只要 new URL() 之后再判断就够。
//   - [::ffff:169.254.169.254] 会被归一化成 [::ffff:a9fe:a9fe]，指向同一个地址却不是
//     IPv4，isIP() 判成 6，必须单独展开判断。

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

// IPv4 点分十进制 -> 4 字节。调用前 isIP() 已确认是合法 IPv4，这里只做防御。
function v4Bytes(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const bytes = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

// IPv6 规范形式 -> 16 字节。WHATWG URL 归一化后是最长零段压缩一次的写法，
// 没有 IPv4 尾部（尾部已被折成十六进制组）。
function v6Bytes(host) {
  const at = host.indexOf('::');
  let head = [];
  let tail = [];
  if (at >= 0) {
    if (at > 0) head = host.slice(0, at).split(':');
    if (at + 2 < host.length) tail = host.slice(at + 2).split(':');
  } else {
    head = host.split(':');
  }
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = head.concat(new Array(fill).fill('0'), tail);
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function v4Reason(b) {
  if (b[0] === 169 && b[1] === 254) {
    return '169.254.0.0/16 是链路本地段（云主机元数据服务在这个段里），不能作为图片来源';
  }
  if (b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0) {
    return '0.0.0.0 是通配地址，不能作为图片来源';
  }
  return '';
}

function v6Reason(b) {
  // IPv4-mapped：前 10 字节全 0，接着两个 0xff，后 4 字节就是 IPv4。
  let mapped = true;
  for (let i = 0; i < 10; i += 1) {
    if (b[i] !== 0) { mapped = false; break; }
  }
  if (mapped && b[10] === 0xff && b[11] === 0xff) {
    const reason = v4Reason([b[12], b[13], b[14], b[15]]);
    return reason ? '（IPv6 映射形式）' + reason : '';
  }
  let allZero = true;
  for (let i = 0; i < 16; i += 1) {
    if (b[i] !== 0) { allZero = false; break; }
  }
  if (allZero) return ':: 是通配地址，不能作为图片来源';
  // fe80::/10
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) {
    return 'fe80::/10 是链路本地段，不能作为图片来源';
  }
  return '';
}

// 放行返回空串，拦截返回一句可以直接进时间线给人看的原因。
export function blockedReason(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return '';
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    // 解析不了的地址不归这里管，交给下游按「下载失败」报错。
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  let host = parsed.hostname;
  if (!host) return '';
  if (host.charCodeAt(0) === 91 && host.charCodeAt(host.length - 1) === 93) {
    host = host.slice(1, -1);
  }
  const kind = isIP(host);
  if (kind === 4) {
    const bytes = v4Bytes(host);
    return bytes ? v4Reason(bytes) : '';
  }
  if (kind === 6) {
    const bytes = v6Bytes(host);
    return bytes ? v6Reason(bytes) : '';
  }
  return '';
}

export function isBlocked(rawUrl) {
  return Boolean(blockedReason(rawUrl));
}

// ---------------------------------------------------------------- 检索结果：本机与内网
//
// 检索结果是第三方网页给的地址，不能让它指向本机或内网：否则一条搜索结果就能让应用去读用户
// 局域网里的设备，读到的图还会被送进生成接口，甚至进公开分享页。
// 接口返回的成图地址、按用户需求写进规划的地址不走这一层（理由见文件头）。
// 主机名要解析一遍再判，挡住解析到内网的域名。解析和随后的请求之间仍有时间差（DNS rebinding），
// 这一层是尽力而为的拦截，不是边界。

function v4PrivateReason(b) {
  if (b[0] === 127) return '127.0.0.0/8 是本机回环地址';
  if (b[0] === 10) return '10.0.0.0/8 是内网地址';
  if (b[0] === 172 && b[1] >= 16 && b[1] <= 31) return '172.16.0.0/12 是内网地址';
  if (b[0] === 192 && b[1] === 168) return '192.168.0.0/16 是内网地址';
  if (b[0] === 100 && b[1] >= 64 && b[1] <= 127) return '100.64.0.0/10 是运营商内网地址';
  if (b[0] === 0) return '0.0.0.0/8 不是合法的图片来源';
  return '';
}

function v6PrivateReason(b) {
  let mapped = true;
  for (let i = 0; i < 10; i += 1) {
    if (b[i] !== 0) { mapped = false; break; }
  }
  if (mapped && b[10] === 0xff && b[11] === 0xff) return v4PrivateReason([b[12], b[13], b[14], b[15]]);
  let loopback = b[15] === 1;
  for (let i = 0; i < 15 && loopback; i += 1) {
    if (b[i] !== 0) loopback = false;
  }
  if (loopback) return '::1 是本机回环地址';
  if ((b[0] & 0xfe) === 0xfc) return 'fc00::/7 是内网地址';
  return '';
}

// DNS 给的 IPv6 可能带点分十进制尾巴（::ffff:192.168.1.1）或区域标识（fe80::1%en0），
// 先整理成 v6Bytes 认得的形式。
function normalizeV6(address) {
  const lower = String(address).toLowerCase().split('%')[0];
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (!tail) return lower;
  const bytes = v4Bytes(tail[2]);
  if (!bytes) return lower;
  return tail[1] + ((bytes[0] << 8) | bytes[1]).toString(16) + ':' + ((bytes[2] << 8) | bytes[3]).toString(16);
}

function addressReason(address) {
  const kind = isIP(String(address).split('%')[0]);
  if (kind === 4) {
    const bytes = v4Bytes(address);
    return bytes ? v4Reason(bytes) || v4PrivateReason(bytes) : '';
  }
  if (kind === 6) {
    const bytes = v6Bytes(normalizeV6(address));
    return bytes ? v6Reason(bytes) || v6PrivateReason(bytes) : '';
  }
  return '';
}

export async function privateReason(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return '';
  }
  let host = parsed.hostname.toLowerCase();
  if (host.charCodeAt(0) === 91 && host.charCodeAt(host.length - 1) === 93) host = host.slice(1, -1);
  if (!host) return '';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'localhost 是本机地址';
  if (isIP(host)) return addressReason(host);
  let addresses = [];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    // 解析失败交给随后的请求按「下载失败」报错。
    return '';
  }
  for (const entry of addresses) {
    const reason = addressReason(entry.address);
    if (reason) return host + ' 解析到 ' + entry.address + '，' + reason;
  }
  return '';
}

// ---------------------------------------------------------------- 下载
//
// fetch 默认自动跟随重定向，只查第一跳等于没查：一个公网地址 302 到 169.254.169.254 就绕过去了。
// 所以重定向改成手动跟随，每一跳都重新过一遍检查；响应体按字节数封顶，读到上限就断开，
// 免得一个超大的响应把进程内存吃满。

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function megabytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function discard(response) {
  try {
    if (response.body) await response.body.cancel();
  } catch {
    /* 已经关了 */
  }
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (maxBytes && declared > maxBytes) {
    await discard(response);
    throw new Error('图片太大（' + megabytes(declared) + '，上限 ' + megabytes(maxBytes) + '）');
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (maxBytes && size > maxBytes) throw new Error('图片太大（超过 ' + megabytes(maxBytes) + '）');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// publicOnly：检索结果专用，额外拒绝本机与内网地址。被策略拒绝的错误带 blocked = true。
export async function fetchImage(rawUrl, { publicOnly = false, maxBytes = 0, timeoutMs = 60000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = String(rawUrl || '').trim();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('图片地址无效');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('只下载 http / https 地址的图片');
    }
    const reason = blockedReason(url) || (publicOnly ? await privateReason(url) : '');
    if (reason) {
      const error = new Error('地址被安全策略拒绝：' + reason);
      error.blocked = true;
      throw error;
    }
    const response = await fetch(url, { redirect: 'manual', signal });
    if (REDIRECT_CODES.has(response.status)) {
      const location = response.headers.get('location');
      await discard(response);
      if (!location) throw new Error('HTTP ' + response.status + '：重定向没有给出目标地址');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await discard(response);
      throw new Error('HTTP ' + response.status);
    }
    return readCapped(response, maxBytes);
  }
  throw new Error('重定向超过 ' + MAX_REDIRECTS + ' 次');
}
