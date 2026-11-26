// @ts-check

/**
 * Publish readiness.
 *
 * A 公众号 article can only be "published" by an interface that actually
 * exists. This module inspects the live tool inventory of the running Mini
 * App and reports, per gate, what was detected and what is still missing.
 *
 * The three gates the workflow requires before publishing:
 *   1. 公众号账号授权  — an account-authorization interface is connected
 *   2. 素材访问范围    — a material/media interface is connected
 *   3. 可用发布接口    — a draft/publish interface is connected
 *
 * A gate the user confirms by hand is recorded as 手动确认 and never mixed
 * with 接口检测 evidence.
 *
 * Matching rules (deliberately narrow):
 *   - Only the tool's *identity* is read: `provider` / `server` / `tool`.
 *     A free-text `description` is never matched, because prose that happens
 *     to mention "WeChat official account draft" says nothing about what a
 *     tool does.
 *   - Every keyword is matched on whole tokens, never as a substring, so
 *     "immediate" is not the word "media" and "publisher" is not "publish".
 *   - The role keyword must come from the *operation* name (`tool.tool`).
 *     A tool named `wechat_publish` matches; a tool named `search` in a
 *     server that mentions publishing in its description does not.
 */

import { decodeHostConnectorValue } from './host-connector-value.mjs';

/** @typedef {{ key: string, label: string, status: 'confirmed'|'pending'|'unavailable', detected: string[], note: string, confirmedBy: string, confirmedAt: string }} PublishCheck */

/** @typedef {{ label: string, name: string }} DetectedTool */

/** Whole-word markers. A token matches only when it equals the word. */
const WECHAT_WORDS = new Set(['wechat', 'weixin', 'weixinmp', 'mpweixin', 'wechatmp', 'gzh', 'wxmp']);
const ACCOUNT_WORDS = new Set([
  'account',
  'accounts',
  'auth',
  'authenticate',
  'authorization',
  'authorize',
  'credential',
  'credentials',
  'openid',
  'profile',
  'token',
  'userinfo',
]);
const MATERIAL_WORDS = new Set(['material', 'materials', 'media', 'thumb', 'thumbnail']);
const PUBLISH_WORDS = new Set(['freepublish', 'publish', 'submit']);

/** Chinese markers are matched inside a token, because Chinese has no spaces. */
const WECHAT_CJK = ['公众号', '微信'];
const ACCOUNT_CJK = ['授权', '账号', '主体'];
const MATERIAL_CJK = ['素材', '封面'];
const PUBLISH_CJK = ['发布', '群发'];

/** A token that carries one of these is a different operation, not the one. */
const DRAFT_CJK = ['草稿'];

const UPLOAD_WORDS = ['upload'];
const UPLOAD_PAYLOAD_WORDS = ['audio', 'file', 'image', 'media', 'pic', 'picture', 'video'];

/** Argument names a 公众号 interface may use for each part of the article. */
const TITLE_KEYS = ['art_title', 'article_title', 'title'];
const DIGEST_KEYS = ['desc', 'description', 'digest', 'summary'];
const CONTENT_KEYS = ['article_content', 'body', 'content', 'html'];
const THUMB_KEYS = ['cover_media_id', 'media_id', 'thumb', 'thumb_media', 'thumb_media_id'];
const AUTHOR_KEYS = ['author'];
const LIST_KEYS = ['article_list', 'articles'];

export const CHECK_KEYS = ['account', 'material', 'interface'];

/**
 * @param {any} tool
 * @returns {string}
 */
function toolLabel(tool) {
  const provider = tool.provider || tool.server || '';
  const name = tool.tool || '';
  return provider ? `${provider} / ${name}` : name;
}

/**
 * Split an identity field into whole words.
 *
 * Camel case is split first, so `freePublish` yields `free` and `publish`.
 * Chinese characters stay inside a token, because Chinese is not spaced.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function tokenize(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter(Boolean);
}

/**
 * @param {string[]} tokens
 * @param {Set<string>} words
 * @param {string[]} cjk
 * @returns {boolean}
 */
function hasWord(tokens, words, cjk) {
  for (const token of tokens) {
    if (words.has(token)) return true;
    if (DRAFT_CJK.some((blocker) => token.includes(blocker))) continue;
    if (cjk.some((needle) => token.includes(needle))) return true;
  }
  return false;
}

/**
 * @param {string[]} tokens
 * @returns {boolean}
 */
function isMaterialOperation(tokens) {
  if (hasWord(tokens, MATERIAL_WORDS, MATERIAL_CJK)) return true;
  const uploads = tokens.some((token) => UPLOAD_WORDS.includes(token));
  const payload = tokens.some((token) => UPLOAD_PAYLOAD_WORDS.includes(token));
  return uploads && payload;
}

/**
 * Inspect the connected tool inventory.
 *
 * @param {any} context
 * @returns {Promise<{ inventory: any[], partial: boolean, error: string }>}
 */
export async function scanInventory(context) {
  if (!context.tool || typeof context.tool.list !== 'function') {
    return { inventory: [], partial: false, error: '当前 Mini App 未获得工具调用权限，无法扫描公众号接口' };
  }
  try {
    const listed = await context.tool.list();
    return {
      inventory: Array.isArray(listed.tools) ? listed.tools : [],
      partial: Boolean(listed.partial),
      error: '',
    };
  } catch (error) {
    const code = /** @type {any} */ (error)?.code || '';
    if (code === 'TOOL_NOT_PERMITTED') {
      // The user switched tool:call off: the inventory is unreachable, which is
      // a different fact from "no interface is connected".
      return { inventory: [], partial: false, error: '工具调用权限已关闭，无法扫描本机接口' };
    }
    return { inventory: [], partial: false, error: code ? `工具清单读取失败：${code}` : '工具清单读取失败' };
  }
}

/**
 * Split the tool inventory into the three gates.
 *
 * A tool only reaches a gate when its *operation* name carries that role and
 * its identity names 公众号 — either in the namespace (`wechat`, `gzh`,
 * `mp_weixin`, `公众号`) or in the operation name itself.
 *
 * @param {any[]} inventory
 * @returns {{ account: DetectedTool[], material: DetectedTool[], interface: DetectedTool[], wechatTools: DetectedTool[] }}
 */
export function classify(inventory) {
  /** @type {DetectedTool[]} */
  const account = [];
  /** @type {DetectedTool[]} */
  const material = [];
  /** @type {DetectedTool[]} */
  const publishInterface = [];
  /** @type {DetectedTool[]} */
  const wechatTools = [];

  for (const tool of Array.isArray(inventory) ? inventory : []) {
    if (!tool || typeof tool !== 'object') continue;
    const namespace = tokenize(tool.provider || tool.server || '');
    const operation = tokenize(tool.tool || '');
    const detected = { label: toolLabel(tool), name: String(tool.name ?? '') };

    const namesWeChat =
      hasWord(namespace, WECHAT_WORDS, WECHAT_CJK) || hasWord(operation, WECHAT_WORDS, WECHAT_CJK);
    if (!namesWeChat) continue;

    wechatTools.push(detected);
    if (hasWord(operation, ACCOUNT_WORDS, ACCOUNT_CJK)) account.push(detected);
    if (isMaterialOperation(operation)) material.push(detected);
    if (hasWord(operation, PUBLISH_WORDS, PUBLISH_CJK)) publishInterface.push(detected);
  }

  return { account, material, interface: publishInterface, wechatTools };
}

/**
 * @param {DetectedTool[]} tools
 * @returns {string[]}
 */
function labelsOf(tools) {
  return tools.map((tool) => tool.label);
}

/**
 * Build the three publish gates from a live inventory scan.
 *
 * @param {any} context
 * @returns {Promise<{ checks: Record<string, PublishCheck>, inventorySize: number, partial: boolean, scanError: string, wechatTools: string[] }>}
 */
export async function evaluateGates(context) {
  const scan = await scanInventory(context);
  const found = classify(scan.inventory);

  /** @type {Record<string, PublishCheck>} */
  const checks = {};

  checks.account = found.account.length
    ? {
        key: 'account',
        label: '公众号账号授权',
        status: 'confirmed',
        detected: labelsOf(found.account),
        note: `检测到账号授权接口 ${found.account.length} 个，可读取授权主体。`,
        confirmedBy: 'interface',
        confirmedAt: new Date().toISOString(),
      }
    : {
        key: 'account',
        label: '公众号账号授权',
        status: 'unavailable',
        detected: [],
        note: scan.error
          ? scan.error
          : '本机未连接任何公众号授权接口，无法自动校验账号授权。',
        confirmedBy: '',
        confirmedAt: '',
      };

  checks.material = found.material.length
    ? {
        key: 'material',
        label: '素材访问范围',
        status: 'confirmed',
        detected: labelsOf(found.material),
        note: `检测到素材接口 ${found.material.length} 个，可确认可写入的素材范围。`,
        confirmedBy: 'interface',
        confirmedAt: new Date().toISOString(),
      }
    : {
        key: 'material',
        label: '素材访问范围',
        status: 'unavailable',
        detected: [],
        note: scan.error
          ? scan.error
          : '本机未连接素材管理接口，无法自动确认素材可访问范围。',
        confirmedBy: '',
        confirmedAt: '',
      };

  checks.interface = found.interface.length
    ? {
        key: 'interface',
        label: '可用发布接口',
        status: 'confirmed',
        detected: labelsOf(found.interface),
        note: `检测到发布接口 ${found.interface.length} 个，可用于真实发布。`,
        confirmedBy: 'interface',
        confirmedAt: new Date().toISOString(),
      }
    : {
        key: 'interface',
        label: '可用发布接口',
        status: 'unavailable',
        detected: [],
        note: scan.error
          ? scan.error
          : '本机未连接任何公众号发布接口，自动发布通道不可用。',
        confirmedBy: '',
        confirmedAt: '',
      };

  return {
    checks,
    inventorySize: scan.inventory.length,
    partial: scan.partial,
    scanError: scan.error,
    wechatTools: labelsOf(found.wechatTools),
  };
}

/**
 * A draft may only be published through an interface when all three gates
 * are confirmed by a real detected interface.
 *
 * @param {Record<string, PublishCheck> | undefined} checks
 * @returns {{ ready: boolean, missing: string[] }}
 */
export function interfaceReadiness(checks) {
  const missing = [];
  if (!checks) return { ready: false, missing: ['尚未执行发布前检查'] };
  for (const key of CHECK_KEYS) {
    const check = checks[key];
    if (!check) {
      missing.push('尚未执行发布前检查');
      continue;
    }
    if (check.status !== 'confirmed') missing.push(`${check.label}未确认`);
    else if (check.confirmedBy !== 'interface') missing.push(`${check.label}仅为人工确认，未检测到接口`);
  }
  return { ready: missing.length === 0, missing };
}

/**
 * A manual publish (the user published in the 公众号 backend themselves) also
 * requires all three gates, but a gate the user confirmed by hand counts.
 *
 * @param {Record<string, PublishCheck> | undefined} checks
 * @returns {{ ready: boolean, missing: string[] }}
 */
export function manualReadiness(checks) {
  const missing = [];
  if (!checks) return { ready: false, missing: ['尚未执行发布前检查'] };
  for (const key of CHECK_KEYS) {
    const check = checks[key];
    if (!check) {
      missing.push('尚未执行发布前检查');
      continue;
    }
    if (check.status !== 'confirmed') missing.push(`${check.label}未确认`);
  }
  return { ready: missing.length === 0, missing };
}

/**
 * The argument names a tool declares, or null when it declares none.
 *
 * @param {any} tool
 * @returns {Set<string> | null}
 */
function schemaProperties(tool) {
  const schema = tool?.inputSchema;
  if (!schema || typeof schema !== 'object') return null;
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null;
  return new Set(Object.keys(properties));
}

/**
 * Build the publish arguments for one tool, using only the names that tool
 * declares. A tool that cannot carry the article body yields null, so the
 * article is never handed to a tool that cannot receive it.
 *
 * @param {any} tool
 * @param {any} draft
 * @returns {Record<string, unknown> | null}
 */
export function buildPublishArguments(tool, draft) {
  const available = schemaProperties(tool);
  if (!available) return null;

  const title = String(draft?.title || draft?.topic || '');
  const content = String(draft?.exportHtml || '');
  const digest = String(draft?.derived?.digest || '');
  const thumb = String(draft?.assets?.cover?.mediaId || '');
  if (!content) return null;

  /** @param {string[]} keys */
  const pick = (keys) => keys.find((key) => available.has(key)) || '';

  const contentKey = pick(CONTENT_KEYS);
  const listKey = pick(LIST_KEYS);
  if (!contentKey && !listKey) return null;

  /** @type {Record<string, unknown>} */
  const args = {};
  const titleKey = pick(TITLE_KEYS);
  if (titleKey) args[titleKey] = title;
  const digestKey = pick(DIGEST_KEYS);
  if (digestKey) args[digestKey] = digest;
  const thumbKey = pick(THUMB_KEYS);
  if (thumbKey) args[thumbKey] = thumb;
  const authorKey = pick(AUTHOR_KEYS);
  if (authorKey && draft?.author) args[authorKey] = String(draft.author);
  if (contentKey) args[contentKey] = content;
  if (listKey) {
    args[listKey] = [
      {
        title,
        content,
        digest,
        thumb_media_id: thumb,
        ...(draft?.author ? { author: String(draft.author) } : {}),
      },
    ];
  }
  return args;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function tryParseJson(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

const ERROR_TEXT_PATTERN =
  /\b(error|failed|failure|invalid|denied|unauthorized|forbidden|not_found|not found)\b|失败|错误|拒绝|无权限/i;

/**
 * Look for an error marker inside a tool result payload.
 *
 * @param {unknown} value
 * @param {number} depth
 * @returns {string}
 */
export function findErrorMarker(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const parsed = tryParseJson(value);
    if (parsed !== undefined) return findErrorMarker(parsed, depth + 1);
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const marker = findErrorMarker(item, depth + 1);
      if (marker) return marker;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  const record = /** @type {Record<string, any>} */ (value);

  for (const key of ['errcode', 'errCode', 'error_code']) {
    const code = record[key];
    if (typeof code === 'number' && code !== 0) return `接口返回错误码 ${code}`;
    if (typeof code === 'string' && code.trim() && code.trim() !== '0') return `接口返回错误码 ${code.trim()}`;
  }
  if (typeof record.code === 'number' && record.code !== 0) return `接口返回错误码 ${record.code}`;

  if (record.success === false) return '接口返回 success=false';

  for (const key of ['error', 'errmsg', 'errorMessage', 'error_message']) {
    const text = record[key];
    if (typeof text === 'string' && text.trim()) return `接口返回错误：${text.trim().slice(0, 200)}`;
    if (text && typeof text === 'object') return '接口返回错误对象';
  }

  const message = record.message;
  if (typeof message === 'string' && ERROR_TEXT_PATTERN.test(message)) {
    return `接口返回错误：${message.trim().slice(0, 200)}`;
  }

  const failed = record.failed_items ?? record.failedItems;
  if (Array.isArray(failed) && failed.length > 0) {
    const first = failed[0];
    const reason =
      (first && typeof first === 'object' && (first.reason || first.message)) ||
      (typeof first === 'string' ? first : '');
    return `接口报告 ${failed.length} 个失败项${reason ? `：${String(reason).slice(0, 120)}` : ''}`;
  }

  return '';
}

/**
 * @param {unknown} block
 * @returns {string}
 */
function contentText(block) {
  if (!block || typeof block !== 'object') return typeof block === 'string' ? block : '';
  const record = /** @type {Record<string, any>} */ (block);
  if (typeof record.text === 'string') return record.text;
  return '';
}

/**
 * Decide whether a tool call actually published.
 *
 * A Connector result is judged by its own payload, not by the absence of a
 * transport error: a provider that answers `{ errcode: 40001 }` failed, even
 * though the call itself resolved.
 *
 * @param {any} result
 * @returns {{ ok: boolean, reason: string }}
 */
export function interpretPublishResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, reason: '接口没有返回结果' };
  }

  if (result.kind === 'mcp') {
    if (result.isError === true) {
      const text = (Array.isArray(result.content) ? result.content : [])
        .map((block) => contentText(block))
        .filter(Boolean)
        .join(' ')
        .trim();
      return { ok: false, reason: text ? `接口报告调用失败：${text.slice(0, 200)}` : '接口报告调用失败' };
    }
    const structured = findErrorMarker(result.structuredContent);
    if (structured) return { ok: false, reason: structured };
    for (const block of Array.isArray(result.content) ? result.content : []) {
      const parsed = tryParseJson(contentText(block));
      if (parsed === undefined) continue;
      const marker = findErrorMarker(parsed);
      if (marker) return { ok: false, reason: marker };
    }
    return { ok: true, reason: '' };
  }

  if (result.kind === 'connector') {
    let value;
    try {
      value = decodeHostConnectorValue(result.value);
    } catch {
      value = result.value;
    }
    const marker = findErrorMarker(value);
    if (marker) return { ok: false, reason: marker };
    return { ok: true, reason: '' };
  }

  return { ok: false, reason: '接口返回了无法识别的结果类型' };
}

/**
 * Attempt a real publish through a detected interface.
 *
 * Only reached when every gate was confirmed by a detected interface. The
 * live inventory is classified again here, so a tool that only looked like a
 * publish interface during the check is never called.
 *
 * @param {any} context
 * @param {Record<string, PublishCheck>} checks
 * @param {any} draft
 * @returns {Promise<{ ok: boolean, message: string, interfaceName: string }>}
 */
export async function publishViaInterface(context, checks, draft) {
  const readiness = interfaceReadiness(checks);
  if (!readiness.ready) {
    return {
      ok: false,
      message: `发布前检查未通过：${readiness.missing.join('、')}。已保留为草稿，未做任何发布动作。`,
      interfaceName: '',
    };
  }
  if (!context.tool || typeof context.tool.list !== 'function') {
    return { ok: false, message: '当前 Mini App 未获得工具调用权限，未做任何发布动作。', interfaceName: '' };
  }

  let inventory = [];
  try {
    const listed = await context.tool.list();
    inventory = Array.isArray(listed.tools) ? listed.tools : [];
  } catch (error) {
    const code = /** @type {any} */ (error)?.code || '';
    return {
      ok: false,
      message: `发布接口清单读取失败${code ? `（${code}）` : ''}，未做任何发布动作，草稿保持不变。`,
      interfaceName: '',
    };
  }

  const found = classify(inventory);
  if (!found.interface.length) {
    return {
      ok: false,
      message: '当前工具清单里没有可用的公众号发布接口，未做任何发布动作，草稿保持不变。',
      interfaceName: '',
    };
  }

  // Only a tool that declares a field for the article body may receive the
  // article; the others are skipped instead of being called blindly.
  /** @type {{ tool: any, args: Record<string, unknown> } | null} */
  let chosen = null;
  for (const detected of found.interface) {
    const tool = inventory.find((item) => item && item.name === detected.name);
    if (!tool) continue;
    const args = buildPublishArguments(tool, draft);
    if (args) {
      chosen = { tool, args };
      break;
    }
  }

  if (!chosen) {
    return {
      ok: false,
      message:
        '检测到的发布接口没有声明可承载正文的参数，为避免把文章发给不合适的工具，未做任何发布动作，草稿保持不变。',
      interfaceName: labelsOf(found.interface).join('、'),
    };
  }

  const interfaceName = toolLabel(chosen.tool);
  try {
    const result = await context.tool.call(chosen.tool.name, chosen.args, {});
    const verdict = interpretPublishResult(result);
    if (!verdict.ok) {
      return {
        ok: false,
        message: `${verdict.reason}，未确认发布成功，草稿保持不变。`,
        interfaceName,
      };
    }
    return { ok: true, message: `已通过 ${interfaceName} 提交发布。`, interfaceName };
  } catch (error) {
    const code = /** @type {any} */ (error)?.code || '';
    return {
      ok: false,
      message: `调用发布接口失败${code ? `（${code}）` : ''}，未确认发布成功，草稿保持不变。`,
      interfaceName,
    };
  }
}
