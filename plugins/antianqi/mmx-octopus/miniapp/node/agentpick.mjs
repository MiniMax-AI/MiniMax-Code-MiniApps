// @ts-check

/**
 * 她的会话该挂在哪个 agent 上（纯决策，2026-10-30 第二十三轮）。
 *
 * ⭐ **为什么这件事要单独成模块**：
 * 老板 2026-10-30 拍板「**现在最主要的问题是调用了错误的agent文件**」。
 * 查下来的事实：她的会话一直挂在**默认 agent（primary = mavis）**上，
 * 于是她的 **system prompt 是 Mavis 的**（"You are Mavis… a coding agent…"），
 * 而「她是谁 / 她长什么样 / 她的规矩」只是工作区里的 `AGENTS.md`（项目级说明）。
 * **权重打架时 system prompt 赢** ⇒ 老板一句「最早啊」，她就照 Mavis 的模式去查数据。
 *
 * 修法不是削工具（老板明说「可以有权限」），而是**让她的 agent 文件讲她是谁**。
 *
 * ⚠️ **可推广性**：专属 agent 是**用户配置**的 —— 别人装了我们的 Mini App，
 * `agents()` 里没有「mmx」⇒ `create({agent:'mmx'})` 直接 INVALID_ARGUMENTS。
 * 所以要**先探测再用**，探测不到就退回默认 agent（= 2026-10-30 之前的行为）。
 *
 * 纯函数放这里，是为了让自检能**真的跑函数行为**（而不是读源码猜），
 * 并且能用「传坏参数」做负向注入。
 */

/** 她的专属 agent 名。 */
export const PET_AGENT_NAME = 'mmx';

/**
 * 决定这一轮用哪个 agent。
 *
 * 优先级：**用户显式指定的** ＞ **探测到的专属 agent** ＞ **空（用默认 agent）**。
 *
 * @param {string[]} listedNames 宿主 `agents()` 列出来的 agent 名
 * @param {string|null|undefined} configured 用户显式指定的 agent 名（`state.petAgent`）
 * @returns {string} '' = 不指定（用默认 agent）
 */
export function pickPetAgent(listedNames, configured) {
  const explicit = configured ? String(configured) : '';
  if (explicit) return explicit;
  const names = Array.isArray(listedNames) ? listedNames.map((n) => String(n ?? '')) : [];
  return names.includes(PET_AGENT_NAME) ? PET_AGENT_NAME : '';
}

/**
 * 当前会话挂的 agent 跟要用的对不上时，要不要重建会话？
 *
 * ⚠️ **官方规范**：会话不能中途换 agent（agent 只在新建会话时定）⇒ 只能重建。
 * ⚠️ **重建的代价**：新会话 = 她的会话历史从零开始。
 *
 * @param {string} currentAgent 当前会话挂着的 agent 名（读不到时传空串）
 * @param {string} wanted 这一轮要用的 agent 名（'' = 用默认 agent）
 * @returns {boolean}
 */
export function needRebuild(currentAgent, wanted) {
  // 没指定 agent（用默认）⇒ 不折腾她。
  if (!wanted) return false;
  return String(currentAgent ?? '') !== String(wanted);
}
