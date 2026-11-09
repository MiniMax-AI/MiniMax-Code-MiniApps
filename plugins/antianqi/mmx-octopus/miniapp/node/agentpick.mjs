// @ts-check

/**
 * 她的会话该挂在哪个 agent 上（纯决策）。
 *
 * ⚠️ **v1.9.0：插件不再往宿主目录写任何文件。**
 *   官方插件市场拒绝 1.8.0 的理由：1.8.0 默认会往宿主内部的 agent 目录新增一个
 *   agent.md —— 越出了插件自己的数据目录，用户没明确同意就多出一个 agent，
 *   卸载后也不会清理。v1.9.0 把那条能力**整个删掉**（不是改成默认关闭）。
 *
 * 现在这一层只做一件**只读**的事：宿主里有没有一个叫 mmx 的 agent
 * （用户自己建的那个），有就优先用它，没有就用默认 agent。
 *
 * ⚠️ **同一判断只写一处**：状态机、服务端路由都走这里。
 */

/** 用户自己建的专属 agent 名（**只读**：插件只是认出它，不创建、不修改、不删除）。 */
export const PET_AGENT_NAME = 'mmx';

/**
 * 决定这一轮用哪个 agent。
 *
 * 优先级：
 *   · **显式指定的**（state.petAgent）＞ **用户自己的 mmx** ＞ **空（默认 agent）**
 *
 * ⚠️ 插件**永远不新增 agent**（v1.9.0）：名字被别人占了也不碰、不用、不降级到它。
 *
 * @param {string[]} listedNames 宿主 agents() 列出来的 agent 名
 * @param {string|null|undefined} configured 用户显式指定的 agent 名（state.petAgent）
 * @returns {string} '' = 不指定（用默认 agent）
 */
export function pickPetAgent(listedNames, configured) {
  const explicit = configured ? String(configured) : '';
  if (explicit) return explicit;
  const names = Array.isArray(listedNames) ? listedNames.map((n) => String(n ?? '')) : [];
  if (names.includes(PET_AGENT_NAME)) return PET_AGENT_NAME;
  return '';
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
