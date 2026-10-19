// @ts-check
// 已选清单接口：读取、增删（含按分类）、重复文件「每组只保留最新的一份」。从 app.mjs 拆出，依赖由 app 注入。
import { selectionTotals } from './selection.mjs';
import { HttpError } from './util.mjs';

/**
 * @param {{
 *   st: any,
 *   views: ReturnType<typeof import('./views.mjs').createViews>,
 *   pathOps: import('./util.mjs').PathOps,
 *   logger: import('./miniapp-api.js').MiniAppLogger,
 *   ensureLoaded: () => Promise<void>,
 *   selEntities: () => any[],
 *   selSummary: () => { count: number, bytes: number },
 *   selChanged: () => void,
 *   isIgnored: (key: string) => boolean,
 *   gateAdd?: (e: { key: string, path: string }) => Promise<string | null>,
 *   worktreeKeys?: () => Set<string>,
 * }} o
 */
export function createSelectionOps(o) {
  const { st, views, pathOps, logger, ensureLoaded, selEntities, selSummary, selChanged, isIgnored } = o;

  /**
   * 条目来源，按顺序取第一条：junk（命中垃圾清理规则）、worktree、large（在大文件列表里）、duplicates、manual。
   * @param {any} e @param {Set<string>} wtKeys @param {Set<string>} dupIds
   */
  function sourceOf(e, wtKeys, dupIds) {
    const cat = e.category ? views.catById.get(e.category) : null;
    if (cat && cat.id !== 'duplicates') return { type: 'junk', categoryId: cat.id };
    if (wtKeys.has(e.key)) return { type: 'worktree' };
    if (e.item && e.item.large) return { type: 'large' };
    if (e.item && dupIds.has(e.item.id)) return { type: 'duplicates' };
    return { type: 'manual' };
  }

  function getSelection() {
    const entities = selEntities();
    const sum = selectionTotals(entities, pathOps);
    const wtKeys = o.worktreeKeys ? o.worktreeKeys() : new Set();
    const dupIds = new Set();
    for (const g of st.model ? st.model.dup.groups : []) for (const f of g.files) dupIds.add(f.id);
    return { ...sum, items: entities.map((e) => ({ ...views.itemJSON(e), source: sourceOf(e, wtKeys, dupIds) })) };
  }

  /**
   * 执行顺序：clear、removeCategories、addCategories、remove、add。
   * 分类操作作用于该分类的全部条目（不受每类 300 条的返回上限影响），锁定条目照样跳过。
   * @param {any} body
   */
  async function updateSelection(body) {
    await ensureLoaded();
    const isIds = (/** @type {any} */ v) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
    if (!isIds(body.add) || !isIds(body.remove) || !isIds(body.addCategories) || !isIds(body.removeCategories) || (body.clear !== undefined && typeof body.clear !== 'boolean')) {
      throw new HttpError(400, 'bad_request', '参数格式不正确');
    }
    for (const c of [...(body.addCategories || []), ...(body.removeCategories || [])]) {
      const cat = views.catById.get(c);
      if (!cat || cat.tier === 'info' || cat.id === 'duplicates') throw new HttpError(400, 'invalid_category', '这个分类不能整类勾选');
    }
    const m = st.model;
    /** @param {string[]} cats */
    const itemsOf = (cats) => {
      const set = new Set(cats);
      return m && set.size ? [...m.items.values()].filter((/** @type {any} */ it) => it.category && set.has(it.category)) : [];
    };
    /** @type {{ id: string, reason: string }[]} */
    const skipped = [];
    let categoryLocked = 0;
    if (body.clear) {
      for (const k of st.sel.entries.keys()) st.sel.deselected.add(k);
      st.sel.entries.clear();
    }
    for (const it of itemsOf(body.removeCategories || [])) {
      st.sel.entries.delete(it.key);
      st.sel.deselected.add(it.key);
    }
    for (const it of itemsOf(body.addCategories || [])) {
      if (isIgnored(it.key)) continue;
      if (views.lockFor(views.entityFromItem(it))) {
        categoryLocked += 1;
        continue;
      }
      st.sel.entries.set(it.key, { id: it.id, path: it.path });
      st.sel.deselected.delete(it.key);
    }
    for (const id of body.remove || []) {
      const e = views.resolve(id);
      if (e) {
        st.sel.entries.delete(e.key);
        st.sel.deselected.add(e.key);
        continue;
      }
      for (const [k, v] of st.sel.entries) {
        if (v.id === id) {
          st.sel.entries.delete(k);
          st.sel.deselected.add(k);
        }
      }
    }
    for (const id of body.add || []) {
      const e = views.resolve(id);
      if (!e) {
        skipped.push({ id, reason: 'unknown' });
        continue;
      }
      if (views.lockFor(e)) {
        skipped.push({ id, reason: 'locked' });
        continue;
      }
      // 代码仓库里的 worktree：状态必须是 clean，没检查过的当场检查。
      const gate = o.gateAdd ? await o.gateAdd(e) : null;
      if (gate) {
        skipped.push({ id, reason: gate });
        continue;
      }
      st.sel.entries.set(e.key, { id: e.id, path: e.path });
      st.sel.deselected.delete(e.key);
    }
    if (skipped.length) {
      const n = (/** @type {string} */ reason) => skipped.filter((s) => s.reason === reason).length;
      logger.info('selection.add.skipped', { count: skipped.length, locked: n('locked'), unknown: n('unknown'), worktreeNotClean: n('worktree_not_clean') });
    }
    if (categoryLocked) logger.info('selection.category.skipped', { count: categoryLocked, locked: categoryLocked });
    selChanged();
    const sum = selSummary();
    return skipped.length ? { ...sum, skipped } : sum;
  }

  /** 每组保留最后修改时间最新的一份，其余加入已选清单。返回整个已选清单的合计。 */
  async function keepNewest() {
    await ensureLoaded();
    const m = st.model;
    let locked = 0;
    if (m) {
      for (const g of views.visibleDupGroups()) {
        const sorted = g.files.slice().sort((/** @type {any} */ a, /** @type {any} */ b) => b.mtimeMs - a.mtimeMs);
        st.sel.entries.delete(sorted[0].key);
        for (const f of sorted.slice(1)) {
          if (views.lockFor(views.entityFromItem(f))) {
            locked += 1;
            continue;
          }
          st.sel.entries.set(f.key, { id: f.id, path: f.path });
          st.sel.deselected.delete(f.key);
        }
      }
    }
    if (locked) logger.info('selection.add.skipped', { count: locked, locked });
    selChanged();
    return selSummary();
  }

  return { getSelection, updateSelection, keepNewest };
}
