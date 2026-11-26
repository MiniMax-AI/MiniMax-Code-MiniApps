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
 */

/** @typedef {{ key: string, label: string, status: 'confirmed'|'pending'|'unavailable', detected: string[], note: string, confirmedBy: string, confirmedAt: string }} PublishCheck */

const WECHAT_PATTERN = /(wechat|weixin|weixinmp|official[_-]?account|gzh|公众号|mp_?weixin|weixin_mp)/i;
const ACCOUNT_PATTERN = /(account|auth|authorize|profile|userinfo|token|credential|授权|账号|主体)/i;
const MATERIAL_PATTERN = /(material|media|thumb|permanent[_-]?material|image[_-]?upload|素材|永久素材|封面图)/i;
const PUBLISH_PATTERN = /(freepublish|publish|add[_-]?news|draft|article[_-]?publish|发布|草稿|群发)/i;

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
 * @param {any[]} inventory
 * @returns {{ account: string[], material: string[], interface: string[], wechatTools: string[] }}
 */
export function classify(inventory) {
  const wechatTools = [];
  const account = [];
  const material = [];
  const publishInterface = [];

  for (const tool of inventory) {
    const label = toolLabel(tool);
    const haystack = `${tool.provider || ''} ${tool.server || ''} ${tool.tool || ''} ${tool.description || ''}`;
    if (!WECHAT_PATTERN.test(haystack)) continue;
    wechatTools.push(label);
    if (ACCOUNT_PATTERN.test(haystack)) account.push(label);
    if (MATERIAL_PATTERN.test(haystack)) material.push(label);
    if (PUBLISH_PATTERN.test(haystack)) publishInterface.push(label);
  }

  return { account, material, interface: publishInterface, wechatTools };
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
        detected: found.account,
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
        detected: found.material,
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
        detected: found.interface,
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
    wechatTools: found.wechatTools,
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
 * Attempt a real publish through a detected interface.
 *
 * Only reached when every gate was confirmed by a detected interface.
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
  const candidates = checks.interface?.detected ?? [];
  if (!context.tool) {
    return { ok: false, message: '当前 Mini App 未获得工具调用权限，未做任何发布动作。', interfaceName: '' };
  }

  const listed = await context.tool.list();
  const target = (listed.tools || []).find((/** @type {any} */ tool) => {
    const label = toolLabel(tool);
    return candidates.includes(label);
  });

  if (!target) {
    return {
      ok: false,
      message: '发布接口在本轮检查后已不可用，未做任何发布动作，草稿保持不变。',
      interfaceName: '',
    };
  }

  const interfaceName = toolLabel(target);
  try {
    const result = await context.tool.call(
      target.name,
      {
        title: draft.title || draft.topic || '',
        author: '',
        digest: draft.derived?.digest || '',
        content: draft.exportHtml || '',
        thumb_media_id: draft.assets?.cover?.mediaId || '',
      },
      {},
    );
    const failed = result.kind === 'mcp' ? result.isError : false;
    if (failed) {
      return { ok: false, message: `发布接口返回失败，未确认发布成功，草稿保持不变。`, interfaceName };
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
