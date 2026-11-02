// @ts-check

/**
 * 顯示名（宿主 agent 列表裡顯示的名字）—— **唯一真源是設置區**。
 *
 * 為什麼有這個模塊（老板 2026-11-01 第三十二輪）：
 * 「名字不應該是寫寫死的啊，本來就是隨時進行設置和修改的」。
 * 從前 `sync_agent_prompt.py` 裡有個寫死的常量（顯示名等於 MMX），
 * 每跑一次同步就把宿主裡她 agent 的顯示名按回去 ——
 * 老板在設置裡改了名字，**這裡不跟著走** ⇒ 那就是寫死。
 *
 * 現在的口徑（單一口徑，不分裂）：
 *   ① **她叫什么**（herName）唯一真源 = 設置區 = 運行時 state.json 的 naming.herName
 *      （`/api/naming` 寫入，`state.setNaming()` 落盤）。
 *   ② **agent 列表裡顯示的名字**（frontmatter 的 displayName）是**投影**，
 *      由 ① 驅動：`/api/naming` 成功後由運行時改寫，同步腳本也按 ① 寫。
 *   ③ ① 為空（用戶從沒設過名字）⇒ 回落 FALLBACK_DISPLAY_NAME。
 *
 * ⚠️ **正文裡不許出現名字** —— 那是 `sync_agent_prompt.py` 的 BANNED_NAMES 門禁管的事。
 *    這裡管的是**顯示層**，兩件事不打架。
 *
 * @module miniapp/node/displayname
 */

import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { writeTextAtomic } from './atomic-json.mjs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/** 換行符 —— 源碼裡不寫轉義序列，免得換個地方就對不上。 */
const NL = String.fromCharCode(10);

/** 用戶從沒設過名字時的回落顯示名（這是**默認值**，不是寫死的名字）。 */
export const FALLBACK_DISPLAY_NAME = 'MMX';

/**
 * 算出該寫進 agent 文件的顯示名。
 *
 * 順序：**設置區的名字 → 目標文件已有的 → 回落值**。
 * 設置區永遠優先 —— 這就是「隨時能改、改了就生效」的那條規則。
 *
 * @param {{herName?: string} | null | undefined} naming 設置區的稱呼配置
 * @param {string} [existing] 目標文件裡已經寫著的顯示名
 * @returns {string}
 */
export function pickDisplayName(naming, existing) {
  const her = String((naming && naming.herName) || '').trim();
  if (her) return her;
  const old = String(existing || '').trim();
  if (old) return old;
  return FALLBACK_DISPLAY_NAME;
}
/**
 * 從 agent 文件的原文裡讀出顯示名（frontmatter 的 displayName）。
 *
 * ⚠️ **用逐行比對，不用正則** —— 正則裡的轉義序列在這個文件裡容易對不上，
 *    而且判據要能被抓：逐行比對的行為一眼看得見。
 *
 * @param {string} text agent 文件原文
 * @returns {string} 讀不到就空串
 */
export function readDisplayName(text) {
  const lines = String(text || '').split(NL);
  if (!lines[0] || lines[0].trim() !== '---') return '';
  for (let i = 1; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (t === '---') return '';
    if (t.startsWith('displayName:')) {
      return t.slice('displayName:'.length).trim();
    }
  }
  return '';
}

/**
 * 把顯示名寫回 agent 文件的 frontmatter（其餘內容逐字保留）。
 *
 * ⚠️ **沒有 frontmatter 就不造一個** —— 那個文件的結構歸 `sync_agent_prompt.py` 管，
 *    這裡只負責「改名字」，不負責「蓋房子」。
 *
 * @param {string} text agent 文件原文
 * @param {string} name 要寫的顯示名
 * @returns {string} 改完的原文（要改才改）
 */
export function withDisplayName(text, name) {
  const src = String(text || '');
  const want = String(name || '').trim();
  if (!want) return src;
  const lines = src.split(NL);
  if (!lines[0] || lines[0].trim() !== '---') return src;
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end < 0) return src;
  let replaced = false;
  for (let i = 1; i < end; i += 1) {
    if (lines[i].trim().startsWith('displayName:')) {
      lines[i] = '  displayName: ' + want;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    let anchor = -1;
    for (let i = 1; i < end; i += 1) {
      if (lines[i].trim() === 'x-mavis:') { anchor = i; break; }
    }
    if (anchor >= 0) lines.splice(anchor + 1, 0, '  displayName: ' + want);
    else lines.splice(end, 0, '  displayName: ' + want);
  }
  return lines.join(NL);
}
/**
 * 把顯示名寫進 agent 文件（**冪等**：已經是對的就什麼都不做）。
 *
 * ⚠️ **寫的是 frontmatter，不是正文** —— 正文歸 `sync_agent_prompt.py` 管，
 *    這裡動它就會跟那邊打架（兩個寫者 = 遲早漂）。
 *
 * @param {string} file agent 文件的絕對路徑
 * @param {string} herName 設置區裡「她叫什么」
 * @returns {Promise<{changed: boolean, displayName: string, reason: string}>}
 */
export async function applyDisplayName(file, herName) {
  const path = String(file || '');
  if (!path) return { changed: false, displayName: '', reason: 'no_path' };
  let src = '';
  try {
    src = await readFile(path, 'utf8');
  } catch {
    return { changed: false, displayName: '', reason: 'not_found' };
  }
  const existing = readDisplayName(src);
  const want = pickDisplayName({ herName }, existing);
  if (existing && want === existing) {
    return { changed: false, displayName: want, reason: 'same' };
  }
  const next = withDisplayName(src, want);
  if (next === src) {
    return { changed: false, displayName: want, reason: 'no_frontmatter' };
  }
  await writeTextAtomic(path, next);
  return { changed: true, displayName: want, reason: 'written' };
}

/**
 * 從「她的會話工作區」上溯，找出她真正在用的那個 agent 文件。
 *
 * 宿主給的 agent 工作區形如 `<agents>/<agent>/miniapps/<pluginId>`，
 * 所以 agent.md 在**上溯兩級**的地方。上溯而不是寫死路徑 ——
 * 寫死路徑換個 agent 名或换个插件 id 就指空了。
 *
 * ⚠️ **上溯最多 6 級且必須真的存在 agent.md** —— 不然會指到無關的目錄。
 *
 * @param {string} workspaceDir 宿主給的會話工作區
 * @returns {string} agent 文件路徑；找不到就空串
 */
export function agentFileFromWorkspace(workspaceDir) {
  let dir = String(workspaceDir || '').trim();
  if (!dir) return '';
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, 'agent.md');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return '';
}
/**
 * 找出「她真正在用的那个 agent 文件」的候选路径（按可靠度排序）。
 *
 * ⚠️ **找不到就不给** —— 写错地方比不写更糟。
 *
 * @param {{context?: any, state?: any}} [opts]
 * @returns {Promise<string[]>}
 */
/**
 * 在宿主 agent 目录里找「装了本 Mini App 的那个 agent」的 agent.md。
 *
 * (*) **为什么需要它**（真机实证）：宿主不给 agent 列表（agents() 探测不到），
 * 所以**首启第一次设名字的时候还没有任何会话** —— 拿不到 workspaceDir，
 * 按 agent 名找也拿不到名 ⇒ 那一次改名**根本落不到文件上**。
 * 而宿主给「装了这个 Mini App 的 agent」建了 miniapps/<pluginId>/ 工作区，
 * 那个目录就是**唯一可靠的指认**。
 *
 * ⚠️ **匹配到几个就返回几个** —— 调用方只在**恰好一个**时才写，
 *    多个都像就一个都不写（写错地方比不写更糟）。
 *
 * @param {string} agentsDir 宿主的 agents 目录
 * @param {string} pluginId 本 Mini App 的 pluginId
 * @returns {string[]} 候选 agent.md 路径（可能 0~n 个）
 */
export function findAgentFilesByPlugin(agentsDir, pluginId) {
  const base = String(agentsDir || '').trim();
  const plugin = String(pluginId || '').trim();
  if (!base || !plugin) return [];
  let entries = [];
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const hits = [];
  for (const entry of entries) {
    if (!entry || !entry.isDirectory()) continue;
    const dir = join(base, entry.name);
    if (!existsSync(join(dir, 'miniapps', plugin))) continue;
    const file = join(dir, 'agent.md');
    if (existsSync(file)) hits.push(file);
  }
  return hits;
}

export async function resolveAgentFiles(opts = {}) {
  const ctx = opts.context || {};
  const st = opts.state || {};
  const files = [];
  // agents 根目录可注入（测试用；生产走 homedir）
  const agentsRoot = String(opts.agentsDir || join(homedir(), '.minimax', 'agents'));
  const sessionId = String(st.petSessionId || '');
  if (sessionId && ctx.agent && typeof ctx.agent.session === 'function') {
    try {
      const detail = await ctx.agent.session(sessionId);
      const dir = String((detail && detail.workspaceDir) || '');
      const hit = agentFileFromWorkspace(dir);
      if (hit) files.push(hit);
    } catch (error) {
      if (ctx.logger && typeof ctx.logger.warn === 'function') {
        ctx.logger.warn('miniapp.agent.displayname.probe_failed', {
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
  }
  const agentName = String(st.petAgent || '');
  if (agentName) {
    files.push(join(homedir(), '.minimax', 'agents', agentName, 'agent.md'));
  }
  // 3) 兜底：宿主 agent 目录里装了本 Mini App 的那个（首启还没会话时靠这条）
  //    **恰好一个才用** —— 多个都像就一个都不写（写错地方比不写更糟）。
  const scanned = findAgentFilesByPlugin(agentsRoot, String(ctx.pluginId || ''));
  if (scanned.length === 1) files.push(scanned[0]);
  return files;
}

/**
 * 设置区改了名字 => 宿主 agent 列表里的显示名跟着改（老板 2026-11-01）。
 *
 * (*) **显示名是投影，她叫什么才是真源**（真源 = 设置区 state.naming.herName）。
 * ⚠️ **找不到文件就什么都不做** —— 写错地方比不写更糟。
 *
 * @param {{context?: any, state?: any}} opts 运行时上下文与状态
 * @param {string} herName 设置区里的名字
 * @returns {Promise<{changed: boolean, displayName: string, reason: string}>}
 */
export async function syncAgentDisplayName(opts, herName) {
  const ctx = (opts && opts.context) || {};
  const st = (opts && opts.state) || {};
  const files = await resolveAgentFiles({ context: ctx, state: st, agentsDir: opts.agentsDir });
  for (const file of files) {
    try {
      const result = await applyDisplayName(file, herName);
      if (result.changed && ctx.logger && typeof ctx.logger.info === 'function') {
        ctx.logger.info('miniapp.agent.displayname.written', { file, displayName: result.displayName });
      }
      // 只有真写进去 / 本来就是目标值才算数；文件不在或没有 frontmatter
      // ⇒ 换下一个候选（**写错地方比不写更糟**）。
      if (result.reason === 'written' || result.reason === 'same') return result;
    } catch (error) {
      if (ctx.logger && typeof ctx.logger.warn === 'function') {
        ctx.logger.warn('miniapp.agent.displayname.write_failed', {
          file,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
  }
  return { changed: false, displayName: '', reason: 'no_candidate' };
}
