// @ts-check

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { almanac, zodiacProfile, SOLAR_TERMS, ELEMENTS } from './almanac.mjs';
import { MAX_QUESTION, castFromParams, clampText } from './cast-params.mjs';
import { buildReading, castDaily, tossCoins } from './divination.mjs';
import { HEXAGRAM_LIST, TRIGRAMS, hexagramSymbol, invertedHexagram, mutualHexagram, oppositeHexagram } from './hexagrams.mjs';
import { MAX_NOTE, ReadingStore } from './store.mjs';
import { jingfang } from './jingfang.mjs';
import { handleMcpRequest } from './mcp/divination-http.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const SURFACE_PATH = '/divination';
const API_ROOT = '/api/divination';
/** MCP 端点路径，须与 miniapp.json 的 mcpEndpoints 一致。 */
const MCP_PATH = '/mcp/divination';
const MAX_BODY_BYTES = 64 * 1024;

/**
 * 卦历条目的 id 形态。存的时候按它挑，删的时候按它找——两处必须同一个正则，
 * 否则会出现「存得进去、删不掉」的条目（页面永远删不掉的记录，用户只能手改 JSON）。
 */
const ID_PATTERN = /^[A-Za-z0-9-]{1,80}$/;

/**
 * `/cast` 刚算出来的卦，留一份给 `/history` 用。
 *
 * 存卦这条路由原先收的是页面回传的整份 reading，而那份 reading 原样落盘——
 * `docs/security.md` 说「Validate every request parameter」，于是这里成了整个包里
 * 唯一一处没设防的地方：伪造的 id、十万字的 `question`、顺手带上的几十 KB 额外字段，
 * 以及 `hexagram: null`（`typeof null === 'object'` 直接过检，之后卦历页读
 * `entry.hexagram.name` 抛错，整个列表显示「读取失败」）。
 *
 * 改收 `{ id, note }`：id 必须命中服务端这一轮真的算出来过的卦，note 是页面唯一的
 * 自由文本且有长度上限。落盘的内容从此只可能是引擎自己的产物，页面改不动。
 *
 * 代价是存卦必须与起卦在同一个进程内——这在页面上本来就成立：卦只渲染在起卦结果页上，
 * 而结果页要靠这个服务撑着，服务重启了页面也已经失效。超过上限的旧卦直接挤出。
 */
const CAST_CACHE_LIMIT = 500;

/**
 * 允许的 Host / Origin 主机名。Host 给的 listen 恒为回环（docs/runtime.md），
 * 这里再钉一道，是为堵 DNS rebinding：恶意页面把自有域名解析到 127.0.0.1 之后，
 * 浏览器认为那是同源，Host 头就带着攻击者的域名打到这里。若不校验，
 * `GET /api/divination/history` 里的卦题与批注会被别的网站读走。
 * 只认回环，不认具体端口——端口由 Host 分配，这里猜不得也不该猜。
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1', '0:0:0:0:0:0:0:1']);

/** 一个合法八位组：0-255，且不认前导零（Node 的 URL 解析同样不认）。 */
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const LOOPBACK_IPV4 = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLoopbackHostname(hostname) {
  const normalized = hostname.trim().toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(normalized)) return true;
  // 127.0.0.0/8 整段都是回环。浏览器不会替攻击者页面发这种 Host，
  // 所以放行整段不引入风险，却能覆盖 Host 绑到 127.0.0.2 之类的情况。
  return LOOPBACK_IPV4.test(normalized);
}

/**
 * 从 `Host: 127.0.0.1:41999` / `Host: [::1]:41999` 里取出主机名部分。
 * 端口连同分隔符一起去掉；没有端口就是整串。
 * @param {string} header
 * @returns {string}
 */
export function hostnameFromHeader(header) {
  const trimmed = header.trim();
  // IPv6 必须带方括号，否则一串 ::1 会被按最后一个冒号切开
  const bracketed = /^\[([^\]]*)\]/.exec(trimmed);
  if (bracketed) return bracketed[1];
  const colon = trimmed.lastIndexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/**
 * 这一请求的 Host / Origin 是不是本机自己发出来的。
 *
 * 两个头各堵一条路，少一条都留着口子：
 * - Host 管 DNS rebinding。攻击者的域名解析到 127.0.0.1 之后，浏览器把它当同源，
 *   Host 头带的就是攻击者域名，不看就会把卦历读出去。
 * - Origin 管跨源简单请求。请求直接打到 127.0.0.1 时 Host 头是 legit 的，
 *   挡不住；但浏览器会带上 `Origin: https://evil.example.com`，认这个才拦得住。
 *
 * 头不存在就放行：Host 的 MCP 客户端是 Node 程序，不发 Origin；
 * HTTP/1.0 也不带 Host。缺头不是伪造的信号，据此拒绝只会打断正常调用。
 * @param {string | undefined} hostHeader
 * @param {string | undefined} originHeader
 */
export function isLocalRequest(hostHeader, originHeader) {
  if (hostHeader !== undefined && !isLoopbackHostname(hostnameFromHeader(hostHeader))) return false;
  if (originHeader === undefined) return true;
  // Origin 的形态是 scheme://host[:port]
  const originHost = /^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]*\]|[^/:?#]+)/i.exec(originHeader);
  if (!originHost) return false;
  return isLoopbackHostname(hostnameFromHeader(originHost[1]));
}

/**
 * 日志只报错误码，不报 error.message。
 *
 * Node 的 fs 报错会把完整绝对路径连同操作系统用户名写进 message：
 * `EACCES: permission denied, open '/Users/<用户名>/…/readings.json'`。
 * dataDir 的位置按契约是不透明的，那串路径不该跟着日志离开这个进程——
 * 日志会被贴进 issue、被转进工单、被上传。错误码足够定位，不带路径。
 * （EISDIR 是唯一被 Node 特殊处理、不带路径的码，不能拿它代表其余。）
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  if (!(error instanceof Error)) return 'unknown';
  const code = /** @type {NodeJS.ErrnoException} */ (error).code;
  return typeof code === 'string' ? code : error.name;
}

/**
 * 页面与 Node 服务之间的唯一数据通道。所有写操作都经由这里落到 dataDir。
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const clientEntry = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));
  const store = new ReadingStore(context.dataDir);
  /** 本进程这一轮算出来过的卦，`/history` 认它当存卦凭据。见 CAST_CACHE_LIMIT。 */
  /** @type {Map<string, import('./divination.mjs').Reading>} */
  const cache = new Map();

  const server = createServer((request, response) => {
    handle(request, response, clientEntry, store, cache).catch((error) => {
      context.logger.error(`divination.request.failed ${describeError(error)}`);
      sendJson(response, 500, { error: 'internal_error' });
    });
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('divination.runtime.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await close(server);
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {Buffer} clientEntry
 * @param {ReadingStore} store
 * @param {Map<string, import('./divination.mjs').Reading>} cache
 */
async function handle(request, response, clientEntry, store, cache) {
  const url = new URL(request.url ?? '/', 'http://miniapp.local');
  const path = url.pathname;
  const method = request.method ?? 'GET';

  // 头不认本机就整个拒掉，且不回显它是什么：回显等于替攻击者确认服务存在。
  if (!isLocalRequest(request.headers.host, request.headers.origin)) {
    sendJson(response, 403, { error: 'forbidden' });
    return;
  }

  // MCP 端点：只在本机回环上提供 POST，Agent 通过它主动起卦。
  if (path === MCP_PATH) {
    if (method === 'POST') {
      const body = await readJsonBody(request);
      if (body === null) {
        sendJson(response, 400, { error: 'invalid_body' });
        return;
      }
      await handleMcpRequest({ response, body });
      return;
    }
    response.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  if (method === 'GET' && path === SURFACE_PATH) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(clientEntry);
    return;
  }

  if (method === 'GET' && path === `${API_ROOT}/bootstrap`) {
    const now = new Date();
    sendJson(response, 200, {
      almanac: almanac(now),
      trigrams: Object.values(TRIGRAMS),
      elements: ELEMENTS,
      solarTerms: SOLAR_TERMS,
      zodiac: Array.from({ length: 12 }, (_unused, index) => zodiacProfile(index)),
      today: castDaily(now),
    });
    return;
  }

  if (method === 'GET' && path === `${API_ROOT}/library`) {
    sendJson(response, 200, {
      hexagrams: HEXAGRAM_LIST.map((hexagram) => ({
        order: hexagram.order,
        key: hexagram.key,
        name: hexagram.name,
        symbol: hexagramSymbol(hexagram.key),
        upper: hexagram.upperTrigram.name,
        lower: hexagram.lowerTrigram.name,
        element: hexagram.upperTrigram.element === hexagram.lowerTrigram.element
          ? hexagram.upperTrigram.element
          : `${hexagram.upperTrigram.element}${hexagram.lowerTrigram.element}`,
        judgment: hexagram.judgment,
        tuan: hexagram.tuan,
        image: hexagram.image,
        // 与 jingfang() 同形，客户端卦体那一列直接拿来渲染，不必再转一次
        palace: jingfang(hexagram),
        mutual: mutualHexagram(hexagram).name,
        opposite: oppositeHexagram(hexagram).name,
        inverted: invertedHexagram(hexagram).name,
      })),
    });
    return;
  }

  if (method === 'GET' && path === `${API_ROOT}/history`) {
    sendJson(response, 200, { entries: await store.list() });
    return;
  }

  const historyDetail = /^\/api\/divination\/history\/([A-Za-z0-9-]{1,80})$/u.exec(path);
  if (historyDetail) {
    const id = historyDetail[1];
    if (method === 'GET') {
      const entry = await store.get(id);
      if (!entry) {
        sendJson(response, 404, { error: 'not_found' });
        return;
      }
      sendJson(response, 200, { entry });
      return;
    }
    if (method === 'DELETE') {
      const removed = await store.remove(id);
      sendJson(response, removed ? 200 : 404, removed ? { removed: true } : { error: 'not_found' });
      return;
    }
  }

  if (method === 'POST' && path === `${API_ROOT}/toss`) {
    const toss = tossCoins();
    sendJson(response, 200, {
      sum: toss.sum,
      coins: toss.coins,
      kind: toss.sum === 9 ? '老阳' : toss.sum === 8 ? '少阴' : toss.sum === 7 ? '少阳' : '老阴',
    });
    return;
  }

  if (method === 'POST' && path === `${API_ROOT}/cast`) {
    const body = await readJsonBody(request);
    if (body === null) {
      sendJson(response, 400, { error: 'invalid_body' });
      return;
    }
    const now = new Date();
    let cast;
    try {
      cast = castFromParams(body, now);
    } catch (error) {
      sendJson(response, 400, { error: 'invalid_cast', message: error instanceof Error ? error.message : 'invalid cast' });
      return;
    }
    const question = clampText(body.question, MAX_QUESTION);
    const reading = buildReading(cast, { question, now });
    // 记下这一卦，`/history` 才能凭 id 把它存下来。超过上限挤掉最老的一卦：
    // Map 的插入序即先进先出，取第一个键就是最老的那一卦。
    cache.set(reading.id, reading);
    while (cache.size > CAST_CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    sendJson(response, 200, { reading });
    return;
  }

  if (method === 'POST' && path === `${API_ROOT}/history`) {
    const body = await readJsonBody(request);
    if (body === null) {
      sendJson(response, 400, { error: 'invalid_body' });
      return;
    }
    const id = body.id;
    // 存的形态是 `{ id, note }`，不是整份 reading。id 要么命中本进程这一轮真的算出来
    // 过的卦，要么不存——见 CAST_CACHE_LIMIT 那段。note 是页面唯一能写的自由文本。
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      sendJson(response, 400, { error: 'invalid_id' });
      return;
    }
    const reading = cache.get(id);
    if (!reading) {
      sendJson(response, 409, { error: 'unknown_cast' });
      return;
    }
    // 同一 id 存两次会得到两条同 id 的记录，而 remove() 按 id 过滤，删一条连带删另一条。
    if (await store.get(id)) {
      sendJson(response, 409, { error: 'already_saved' });
      return;
    }
    const note = clampText(body.note, MAX_NOTE);
    const saved = await store.save(reading, note);
    sendJson(response, 201, { entry: saved });
    return;
  }

  sendJson(response, 404, { error: 'not_found' });
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {import('node:http').ServerResponse} response @param {number} status @param {unknown} payload */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
