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

/** @typedef {{ key: string, label: string, status: 'confirmed'|'pending'|'unavailable', detected: string[], detectedNames?: string[], chosen?: string, note: string, confirmedBy: string, confirmedAt: string }} PublishCheck */

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
// `submit` on its own is too generic to stand for a publish interface; a
// 公众号 publish operation names itself `publish` or `freepublish`.
const PUBLISH_WORDS = new Set(['freepublish', 'publish']);

/** Chinese markers are matched inside a token, because Chinese has no spaces. */
const WECHAT_CJK = ['公众号', '微信'];
const ACCOUNT_CJK = ['授权', '账号', '主体'];
const MATERIAL_CJK = ['素材', '封面'];
const PUBLISH_CJK = ['发布', '群发'];

/** A token that carries one of these is a different operation, not the one. */
const DRAFT_CJK = ['草稿'];

const UPLOAD_WORDS = ['upload'];
const UPLOAD_PAYLOAD_WORDS = ['audio', 'file', 'image', 'media', 'pic', 'picture', 'video'];

/**
 * The roles a publish interface can fill, and the argument names each role
 * is known by.
 *
 * Nothing here is tied to one interface: these are the spellings the role has
 * across 公众号 publish interfaces, and the first name the *detected* tool
 * itself declares is the one that gets filled. A tool that calls its cover
 * `cover_image` is served exactly like one that calls it `thumb_media_id`.
 */
const ARGUMENT_ROLES = {
  /** The article title. */
  title: ['art_title', 'article_title', 'title'],
  /** The short summary. */
  digest: ['desc', 'description', 'digest', 'summary'],
  /** The body. */
  body: ['article_content', 'body', 'content', 'html'],
  /** A 公众号 API style article list. */
  list: ['article_list', 'articles'],
  /** The cover, as a local file path. */
  coverFile: ['cover', 'cover_path', 'cover_file', 'cover_image', 'thumb_path', 'image', 'img'],
  /** The cover, as a media id of an already uploaded image. */
  coverId: ['cover_media_id', 'media_id', 'thumb', 'thumb_media', 'thumb_media_id'],
  /** Further images, as local file paths. */
  images: ['images', 'image_list', 'photos', 'pictures', 'extra_images'],
  /** The kind of message the interface builds. */
  kind: ['kind', 'message_type', 'type'],
  /** What the interface does with what it built. */
  action: ['action', 'mode'],
  /** The flag that lets an interface do something irreversible. */
  confirm: ['confirm', 'confirmed'],
  /** How long the interface may wait for the publish to land. */
  wait: ['wait_seconds', 'wait_publish_seconds', 'wait_publish_s'],
  /** The author of the article. */
  author: ['author'],
};

/** The value a publish interface waits for a publish to land, in seconds. */
const PUBLISH_WAIT_SECONDS = 180;

/** How the app names an image inside a plain body. */
export const IMAGE_MARKER = '![](';

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
 * The runtime names of the detected tools, parallel to their labels.
 *
 * @param {DetectedTool[]} tools
 * @returns {string[]}
 */
function namesOf(tools) {
  return tools.map((tool) => tool.name);
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
        detectedNames: namesOf(found.account),
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
        detectedNames: namesOf(found.material),
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
        detectedNames: namesOf(found.interface),
        note:
          found.interface.length > 1
            ? `检测到 ${found.interface.length} 个发布接口，请选择一个用于发布。`
            : `检测到发布接口 ${found.interface.length} 个，可用于真实发布。`,
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
 * The value a tool's own schema allows for one argument.
 *
 * @param {any} tool
 * @param {string} key
 * @returns {any}
 */
function propertySpec(tool, key) {
  const properties = tool?.inputSchema?.properties;
  if (!properties || typeof properties !== 'object') return {};
  const spec = properties[key];
  return spec && typeof spec === 'object' ? spec : {};
}

/**
 * The first candidate the tool's own enum allows.
 *
 * @param {any} tool
 * @param {string} key
 * @param {string[]} candidates
 * @returns {string}
 */
function pickEnum(tool, key, candidates) {
  const values = Array.isArray(propertySpec(tool, key).enum) ? propertySpec(tool, key).enum.map(String) : [];
  for (const candidate of candidates) {
    if (!values.length) return candidate;
    if (values.includes(candidate)) return candidate;
  }
  return '';
}

/**
 * The properties a tool declares for the items of a list argument.
 *
 * @param {any} tool
 * @param {string} listKey
 * @returns {Record<string, any>}
 */
function itemProperties(tool, listKey) {
  const items = propertySpec(tool, listKey).items;
  const properties = items && typeof items === 'object' ? items.properties : null;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};
  return properties;
}

/**
 * Whether the interface takes the images as files of its own — at the top
 * level, or inside the items of a list argument.
 *
 * @param {any} tool
 * @param {string} listKey
 * @returns {boolean}
 */
function takesImageFiles(tool, listKey) {
  const names = [...ARGUMENT_ROLES.coverFile, ...ARGUMENT_ROLES.images];
  const declared = schemaProperties(tool) || new Set();
  if (names.some((name) => declared.has(name))) return true;
  const items = listKey ? itemProperties(tool, listKey) : {};
  return names.some((name) => Object.hasOwn(items, name));
}

/**
 * The body the interface should receive.
 *
 * An interface that takes the images separately assembles the body itself,
 * so it wants plain text with the images named inside it — the styled HTML
 * is both wrong for it and three orders of magnitude too long. Every other
 * interface gets the styled HTML, unless that does not fit either.
 *
 * `spec` is the schema of the field that receives the body: a top-level
 * `content`, or the `content` of one list item. Both go through this rule,
 * so neither can be handed a body it declares no room for.
 *
 * @param {{ maxLength?: unknown } | null | undefined} spec
 * @param {string} html
 * @param {string} plain
 * @param {boolean} wantsFiles
 * @returns {{ value: string, plain: boolean }}
 */
function chooseBody(spec, html, plain, wantsFiles) {
  if (wantsFiles && plain) return { value: plain, plain: true };
  const limit = spec && typeof spec === 'object' ? spec.maxLength : undefined;
  if (typeof limit === 'number' && html.length > limit && plain) return { value: plain, plain: true };
  return { value: html || plain, plain: !html };
}

/**
 * Where the article body can go in this interface, if anywhere.
 *
 * A tool that names no field for the body — or names a list but none of the
 * item fields a body would live in — cannot receive the article, and saying
 * so is the point: the body is never guessed into a field the tool did not
 * declare.
 *
 * @param {any} tool
 * @returns {{ kind: 'body'|'list'|'none', key: string, itemKey: string, message: string }}
 */
export function bodyCarrier(tool) {
  const available = schemaProperties(tool);
  if (!available) return { kind: 'none', key: '', itemKey: '', message: '没有声明任何参数' };

  const bodyKey = ARGUMENT_ROLES.body.find((key) => available.has(key)) || '';
  if (bodyKey) return { kind: 'body', key: bodyKey, itemKey: '', message: '' };

  const listKey = ARGUMENT_ROLES.list.find((key) => available.has(key)) || '';
  if (!listKey) return { kind: 'none', key: '', itemKey: '', message: '没有声明正文参数' };

  const items = itemProperties(tool, listKey);
  const itemKey = ARGUMENT_ROLES.body.find((key) => Object.hasOwn(items, key)) || '';
  if (!itemKey) {
    return {
      kind: 'none',
      key: listKey,
      itemKey: '',
      message: `列表参数 ${listKey} 没有声明列表项里的正文字段`,
    };
  }
  return { kind: 'list', key: listKey, itemKey, message: '' };
}

/**
 * The kind of message the interface should build.
 *
 * The tool's own enum decides which word means "an article"; the app never
 * assumes a vocabulary the tool does not declare.
 *
 * @param {any} tool
 * @param {string} key
 * @returns {string}
 */
function chooseKind(tool, key) {
  const values = Array.isArray(propertySpec(tool, key).enum) ? propertySpec(tool, key).enum.map(String) : [];
  if (!values.length) return 'article';
  const article = values.find((value) => /article|news|graph|post/i.test(value));
  if (article) return article;
  const picture = values.find((value) => /tietu|image|picture|photo/i.test(value));
  return picture || values[0];
}

/**
 * One list item, built only from the names its own item schema declares.
 *
 * @param {any} tool
 * @param {string} listKey
 * @param {any} draft
 * @param {{ html: string, plain: string, mediaId: string, coverPath: string, imagePaths: string[], wantsFiles: boolean }} parts
 * @returns {{ value: Record<string, unknown>, plain: boolean } | null}
 */
function buildListItem(tool, listKey, draft, parts) {
  const items = itemProperties(tool, listKey);
  const itemBodyKey = ARGUMENT_ROLES.body.find((key) => Object.hasOwn(items, key)) || '';
  if (!itemBodyKey) return null;

  /** @param {keyof typeof ARGUMENT_ROLES} role */
  const pick = (role) => ARGUMENT_ROLES[role].find((key) => Object.hasOwn(items, key)) || '';

  /** @type {Record<string, unknown>} */
  const item = {};
  const titleKey = pick('title');
  if (titleKey) item[titleKey] = String(draft?.title || draft?.topic || '');
  const digestKey = pick('digest');
  if (digestKey) item[digestKey] = String(draft?.derived?.digest || '');
  const authorKey = pick('author');
  if (authorKey && draft?.author) item[authorKey] = String(draft.author);

  const coverIdKey = pick('coverId');
  const coverPathKey = pick('coverFile');
  if (coverIdKey && parts.mediaId) item[coverIdKey] = parts.mediaId;
  else if (coverPathKey && parts.coverPath) item[coverPathKey] = parts.coverPath;

  const body = chooseBody(items[itemBodyKey], parts.html, parts.plain, parts.wantsFiles);
  item[itemBodyKey] = body.value;

  const imagesKey = body.plain ? '' : pick('images');
  if (imagesKey && parts.imagePaths.length) item[imagesKey] = parts.imagePaths;

  return { value: item, plain: body.plain };
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

  const carrier = bodyCarrier(tool);
  if (carrier.kind === 'none') return null;

  const title = String(draft?.title || draft?.topic || '');
  const html = String(draft?.exportHtml || '');
  const plain = String(draft?.plainBody || '');
  if (!html && !plain) return null;

  const digest = String(draft?.derived?.digest || '');
  const mediaId = String(draft?.assets?.cover?.mediaId || '');
  const coverPath = String(draft?.assetPaths?.cover || '');
  const imagePaths = Object.values(draft?.assetPaths?.illustrations || {});
  const bodyKey = ARGUMENT_ROLES.body.find((key) => available.has(key)) || '';
  const listKey = ARGUMENT_ROLES.list.find((key) => available.has(key)) || '';
  const wantsFiles = takesImageFiles(tool, listKey);

  /** @param {keyof typeof ARGUMENT_ROLES} role */
  const pick = (role) => ARGUMENT_ROLES[role].find((key) => available.has(key)) || '';

  /** @type {Record<string, unknown>} */
  const args = {};
  const titleKey = pick('title');
  if (titleKey) args[titleKey] = title;
  const digestKey = pick('digest');
  if (digestKey) args[digestKey] = digest;

  // A cover is sent as a local path when the interface takes a file, and as
  // the media id when the interface takes an id.
  const coverPathKey = pick('coverFile');
  const coverIdKey = pick('coverId');
  if (coverPathKey && coverPath) args[coverPathKey] = coverPath;
  else if (coverIdKey && mediaId) args[coverIdKey] = mediaId;

  const authorKey = pick('author');
  if (authorKey && draft?.author) args[authorKey] = String(draft.author);

  let bodyIsPlain = false;
  if (bodyKey) {
    const body = chooseBody(propertySpec(tool, bodyKey), html, plain, wantsFiles);
    bodyIsPlain = body.plain;
    args[bodyKey] = body.value;
  }
  if (listKey) {
    // A list item's body follows the same rule as a top-level body: the item's
    // own `maxLength`, and plain text when the interface takes the images
    // separately. An item schema that names no body field leaves the list out
    // rather than being filled with a name the tool never declared.
    const item = buildListItem(tool, listKey, draft, {
      html,
      plain,
      mediaId,
      coverPath,
      imagePaths,
      wantsFiles,
    });
    if (item) {
      args[listKey] = [item.value];
      bodyIsPlain = bodyIsPlain || item.plain;
    }
  }

  // The images are named inside the plain body, so they are not sent twice.
  const imageListKey = bodyIsPlain ? '' : pick('images');
  if (imageListKey && imagePaths.length) args[imageListKey] = imagePaths;

  // What the interface builds, and whether it may publish.
  const kindKey = pick('kind');
  if (kindKey) args[kindKey] = chooseKind(tool, kindKey);
  // `publish` is preferred over `draft` because this call only happens after
  // the page's confirmation dialog named the interface: the user asked for a
  // publish, not for another draft. An interface whose enum has no `publish`
  // gets its own `draft` word instead.
  const actionKey = pick('action');
  if (actionKey) {
    const action = pickEnum(tool, actionKey, ['publish', 'draft']);
    if (action) args[actionKey] = action;
  }
  // The same dialog is the confirmation the flag stands for.
  const confirmKey = pick('confirm');
  if (confirmKey) args[confirmKey] = true;
  const waitKey = pick('wait');
  if (waitKey) args[waitKey] = PUBLISH_WAIT_SECONDS;

  return args;
}

/**
 * The required arguments a tool asks for that this draft cannot provide.
 *
 * A list argument is checked by its own item schema too: an item that must
 * carry a field this app cannot name is as unfulfillable as a missing
 * top-level argument.
 *
 * @param {any} tool
 * @param {Record<string, unknown> | null} args
 * @returns {string[]}
 */
export function missingRequiredArguments(tool, args) {
  const required = Array.isArray(tool?.inputSchema?.required) ? tool.inputSchema.required.map(String) : [];
  const provided = args && typeof args === 'object' ? args : {};
  const missing = required.filter((key) => !(key in provided));

  for (const listKey of ARGUMENT_ROLES.list) {
    if (!(listKey in provided)) continue;
    const items = propertySpec(tool, listKey).items;
    const itemRequired = Array.isArray(items?.required) ? items.required.map(String) : [];
    if (!itemRequired.length) continue;
    const entry = Array.isArray(provided[listKey]) ? provided[listKey][0] : null;
    const item = entry && typeof entry === 'object' ? /** @type {Record<string, unknown>} */ (entry) : {};
    for (const key of itemRequired) {
      if (!(key in item)) missing.push(`${listKey}[].${key}`);
    }
  }

  return missing;
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
 * The result code decides first. A payload that carries `errcode: 0` or
 * `code: 0` succeeded, and the status string next to it — `errmsg: "ok"` is
 * what 公众号 answers with on success — is informational, not a failure.
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

  // The explicit result code is the strongest signal there is.
  /** @type {any} */
  let code;
  let hasCode = false;
  for (const key of ['errcode', 'errCode', 'error_code']) {
    if (record[key] !== undefined) {
      code = record[key];
      hasCode = true;
      break;
    }
  }
  if (!hasCode && record.code !== undefined) {
    code = record.code;
    hasCode = true;
  }

  // A zero code means the call succeeded. A code that names anything else is
  // a failure. A code that says nothing at all — null, an empty string —
  // is not read as a success either.
  let codeSaysSuccess = false;
  if (hasCode) {
    if (typeof code === 'number') {
      if (code !== 0) return `接口返回错误码 ${code}`;
      codeSaysSuccess = true;
    } else if (typeof code === 'string') {
      const trimmed = code.trim();
      if (trimmed && trimmed !== '0') return `接口返回错误码 ${trimmed}`;
      codeSaysSuccess = trimmed === '0';
    }
  }

  if (record.success === false) return '接口返回 success=false';

  const failed = record.failed_items ?? record.failedItems;
  if (Array.isArray(failed) && failed.length > 0) {
    const first = failed[0];
    const reason =
      (first && typeof first === 'object' && (first.reason || first.message)) ||
      (typeof first === 'string' ? first : '');
    return `接口报告 ${failed.length} 个失败项${reason ? `：${String(reason).slice(0, 120)}` : ''}`;
  }

  // An explicit error field is an error whatever the code said: the code
  // names the outcome, this field names the failure.
  for (const key of ['error', 'errorMessage', 'error_message']) {
    const text = record[key];
    if (text === undefined || text === null) continue;
    if (typeof text === 'string') {
      if (!text.trim()) continue;
      return `接口返回错误：${text.trim().slice(0, 200)}`;
    }
    if (typeof text === 'object' && Object.keys(text).length > 0) return '接口返回错误对象';
  }

  // `errmsg` and `message` sit next to the result code as status strings:
  // 公众号 answers a successful publish with `errmsg: "ok"`. They are read
  // as an error only when the payload carries no result code at all.
  if (!codeSaysSuccess) {
    const errmsg = record.errmsg;
    if (typeof errmsg === 'string' && errmsg.trim()) return `接口返回错误：${errmsg.trim().slice(0, 200)}`;
    if (errmsg && typeof errmsg === 'object' && Object.keys(errmsg).length > 0) return '接口返回错误对象';
    const message = record.message;
    if (typeof message === 'string' && ERROR_TEXT_PATTERN.test(message)) {
      return `接口返回错误：${message.trim().slice(0, 200)}`;
    }
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

  // The interface to publish through is the one the user chose in the page.
  // When there is exactly one candidate it is used; when there are several
  // and none was chosen, nothing is published.
  const chosenName = String(checks.interface?.chosen ?? '');
  /** @type {DetectedTool[]} */
  let candidates;
  if (chosenName) {
    candidates = found.interface.filter((detected) => detected.name === chosenName);
  } else if (found.interface.length === 1) {
    candidates = found.interface;
  } else {
    candidates = [];
  }

  if (!candidates.length) {
    return {
      ok: false,
      message: chosenName
        ? '选定的发布接口在本轮清单里已不可用，未做任何发布动作，草稿保持不变。'
        : `检测到 ${found.interface.length} 个发布接口，请先在页面上选择一个再发布；未做任何发布动作，草稿保持不变。`,
      interfaceName: '',
    };
  }

  // Only the chosen interface is called, and only when it declares a field for
  // the article body. It is never quietly swapped for another one.
  const detected = candidates[0];
  const target = inventory.find((item) => item && item.name === detected.name);
  const args = target ? buildPublishArguments(target, draft) : null;
  if (!target || !args) {
    const why = target ? bodyCarrier(target).message : '';
    return {
      ok: false,
      message: `选定的发布接口${why ? `（${why}）` : ''}没有声明可承载正文的参数，为避免把文章发给不合适的工具，未做任何发布动作，草稿保持不变。`,
      interfaceName: detected.label,
    };
  }

  // A tool that asks for something this draft cannot provide is not called at
  // all: publishing with a missing argument is the call the user would have
  // to undo.
  const missing = missingRequiredArguments(target, args);
  if (missing.length) {
    return {
      ok: false,
      message: `选定的发布接口要求参数 ${missing.join('、')}，这篇稿件无法提供，未做任何发布动作，草稿保持不变。`,
      interfaceName: detected.label,
    };
  }

  const interfaceName = toolLabel(target);
  try {
    const result = await context.tool.call(target.name, args, {});
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
