// @ts-check
// 条目操作：问 Agent 的提示词、在访达或资源管理器中显示、打开系统设置。从 app.mjs 拆出，依赖由 app 注入。
import { SYSTEM_ACTIONS } from './platform.mjs';
import { buildAskPrompt } from './prompt.mjs';
import { HttpError } from './util.mjs';

/**
 * @param {{
 *   views: ReturnType<typeof import('./views.mjs').createViews>,
 *   sys: { labels: { fileManager: string }, reveal: (p: string) => Promise<boolean>, systemAction: (a: string) => Promise<boolean> },
 *   platform: string,
 *   logger: import('./miniapp-api.js').MiniAppLogger,
 *   ensureLoaded: () => Promise<void>,
 * }} o
 */
export function createItemActions(o) {
  const { views, sys, platform, logger, ensureLoaded } = o;

  /** @param {string | null} id */
  async function askContext(id) {
    await ensureLoaded();
    const e = views.resolve(id);
    if (!e) throw new HttpError(404, 'not_found', '找不到这个条目，请重新扫描');
    const children = await views.childrenOf(e, 10);
    const cat = e.category ? views.catById.get(e.category) || null : null;
    return { title: e.name, prompt: buildAskPrompt(e, { platform, category: cat, children }) };
  }

  /** @param {any} body */
  async function reveal(body) {
    await ensureLoaded();
    const e = views.resolve(body.id);
    if (!e) throw new HttpError(404, 'not_found', '找不到这个条目，请重新扫描');
    const ok = await sys.reveal(e.path);
    if (!ok) {
      logger.warn('reveal.failed', { code: 'exec' });
      throw new HttpError(500, 'reveal_failed', `无法在${sys.labels.fileManager}中显示`);
    }
    return { ok: true };
  }

  /** @param {any} body */
  async function systemAction(body) {
    const a = body.action;
    const match = (platform === 'darwin' && typeof a === 'string' && a.startsWith('mac-')) || (platform === 'win32' && typeof a === 'string' && a.startsWith('win-'));
    if (!SYSTEM_ACTIONS.includes(a) || !match) throw new HttpError(400, 'invalid_action', '不支持这个操作');
    const ok = await sys.systemAction(a);
    if (!ok) {
      logger.warn('system_action.failed', { code: 'exec' });
      throw new HttpError(500, 'action_failed', '打开系统设置失败');
    }
    return { ok: true };
  }

  return { askContext, reveal, systemAction };
}
