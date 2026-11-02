// @ts-check

/**
 * **归属判据** —— 「这个目录 / 这个 agent 是不是本插件自己的」唯一真源。
 *
 * ⚠️ **为什么要有这个模块**（PR #101 review 的 Must fix 1、2）：
 *   评审指出两处会写到**不属于本插件**的文件：
 *   ① `displayname.mjs` 向上最多 6 级找 `agent.md` —— 会指到用户项目里毫不相干的 agent.md；
 *   ② `ensureIdentityFile()` 直接往会话工作区写 `AGENTS.md` —— 回落成默认 agent 时，
 *      工作区可能是用户的真实项目，用户的 `AGENTS.md` 会被**每轮静默覆盖**。
 *   ⇒ 两条改成**同一个判据**：**只认「装了本插件的那个 agent」**
 *     （它的目录里含 `miniapps/<pluginId>`）。
 *
 * ⚠️ **判据只在这里写一次** —— 显示名同步与身份文件写入都从这里取；
 *   两边口径不一致 = 迟早写错地方（写错地方比不写更糟）。
 *
 * @module miniapp/node/ownership
 */

import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** 宿主 agent 目录里装 Mini App 的那一层目录名。 */
export const PLUGIN_DIR_NAME = 'miniapps';

/**
 * 这个目录**就是** `miniapps/<pluginId>` 吗？
 *
 * ⚠️ **只看形状，不看里面有什么** —— 判据是「路径形状 + 归属」，
 *   不是「里面碰巧有某个文件」（那是巧合，不是归属）。
 *
 * @param {string} dir 目录绝对路径
 * @param {string} pluginId 本插件的 pluginId
 * @returns {boolean}
 */
export function ownsPluginDir(dir, pluginId) {
  const d = String(dir || '').trim();
  const plugin = String(pluginId || '').trim();
  if (!d || !plugin) return false;
  if (basename(d) !== plugin) return false;
  if (basename(dirname(d)) !== PLUGIN_DIR_NAME) return false;
  return true;
}

/**
 * 从「她的会话工作区」推出**宿主那个 agent 目录**（`<agents>/<agent>`）。
 *
 * ⚠️ **只认一种形状** —— 会话工作区 = `<agents>/<agent>/miniapps/<pluginId>`；
 *   别的形状（回落成默认 agent 时可能是用户的项目目录）**一律不认**。
 *
 * @param {string} workspaceDir 宿主给的会话工作区
 * @param {string} pluginId 本插件的 pluginId
 * @returns {string} agent 目录；不认就空串
 */
export function agentDirFromWorkspace(workspaceDir, pluginId) {
  const dir = String(workspaceDir || '').trim();
  if (!ownsPluginDir(dir, pluginId)) return '';
  return dirname(dirname(dir));
}

/**
 * 这个 agent 目录是**装了本插件**的那个吗？（归属证明）
 *
 * @param {string} agentDir agent 目录
 * @param {string} pluginId 本插件的 pluginId
 * @returns {boolean}
 */
export function ownsAgentDir(agentDir, pluginId) {
  const dir = String(agentDir || '').trim();
  const plugin = String(pluginId || '').trim();
  if (!dir || !plugin) return false;
  return existsSync(join(dir, PLUGIN_DIR_NAME, plugin));
}

/**
 * 宿主 agent 目录的**根**（`agents/`）—— 从插件自己的数据目录往上找，不写死 `~/.minimax`。
 *
 * ⚠️ **为什么不能写死 `homedir()/.minimax`**（review Must fix 1 第三条）：
 *   自定义数据目录时那条路径指空 ⇒ 要么找不到，要么写到别的地方去。
 *   ⇒ 改成**从 `context.dataDir` 往上找**（数据目录搬家时它跟着搬）。
 *
 * ⚠️ **找错目录不致命** —— 下游还有一道归属过滤
 *   （agent 目录里必须含 `miniapps/<pluginId>`），错目录只会「找不到」，不会「写错」。
 *
 * @param {string} dataDir 插件的数据目录
 * @returns {string} agents 根目录；找不到就空串
 */
export function agentsRootFromDataDir(dataDir) {
  let dir = String(dataDir || '').trim();
  if (!dir) return '';
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, 'agents');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return '';
}
