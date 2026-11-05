// @ts-check

/**
 * 她的会话该挂在哪个 agent 上（纯决策）。
 *
 * ⭐ **为什么这件事要单独成模块**：
 * 「**现在最主要的问题是调用了错误的agent文件**」。
 * 查下来的事实：她的会话一直挂在**默认 agent（primary = mavis）**上，
 * 于是她的 **system prompt 是 Mavis 的**（"You are Mavis… a coding agent…"），
 * 而「她是谁 / 她长什么样 / 她的规矩」只是工作区里的 `AGENTS.md`（项目级说明）。
 * **权重打架时 system prompt 赢** ⇒ 老板一句「最早啊」，她就照 Mavis 的模式去查数据。
 *
 * 修法不是削工具（老板明说「可以有权限」），而是**让她的 agent 文件讲她是谁**。
 *
 * ⚠️ **可推广性**：专属 agent 是**用户配置**的 —— 别人装了我们的 Mini App，
 * `agents()` 里没有「mmx」⇒ `create({agent:'mmx'})` 直接 INVALID_ARGUMENTS。
 * 所以要**先探测再用**，探测不到就退回默认 agent（= 之前的行为）。
 *
 * 纯函数放这里，是为了让自检能**真的跑函数行为**（而不是读源码猜），
 * 并且能用「传坏参数」做负向注入。
 */

/** 她的专属 agent 名（用户自己建的那个 —— 老板机器上就有这个名字）。 */
export const PET_AGENT_NAME = 'mmx';

/**
 * 我们自己新增的那个专属 agent 名（v1.8.0）。
 *
 * ⭐ **agent 名字的真源就在这个纯模块里**（agentpick.mjs 不依赖任何东西）——
 *   `agentprov.mjs` 从这里取，两边不许各写一份。
 */
export const SELF_AGENT_NAME = 'mmx-octopus-agent';

/**
 * 产品默认档（**唯一真源**）。
 *
 * ⭐ **老板 2026-11-04 拍板**：「默认是用专属agent，这样体验感才最好，也是我们主要的方向，
 *   但是需要给用户一个选择的余地」⇒ **默认 = 建专属 agent**，用户随时能切回「用现有 agent」。
 *
 * ⚠️ **只有这一处写默认值** —— 状态机、服务端路由、客户端面板的默认归一都从这里取，
 *   不许各写各的（写散了下次改默认就会漏）。
 *
 * @type {'own'|'existing'}
 */
export const DEFAULT_AGENT_MODE = 'own';

/**
 * 把任意输入归一成合法档位（**默认归一的唯一实现**）。
 *
 * ⚠️ **只有明确是 'existing' 才降级**；别的值（空 / 乱值 / undefined）一律按**默认档**算
 *   —— 这样「默认值是什么」这件事**只由 DEFAULT_AGENT_MODE 说了算**。
 *
 * @param {unknown} mode
 * @returns {'own'|'existing'}
 */
export function normalizeAgentMode(mode) {
  return mode === 'existing' ? 'existing' : DEFAULT_AGENT_MODE;
}

/**
 * 决定这一轮用哪个 agent —— **用户在面板里选的那一档**决定。
 *
 * 优先级：
 *   · 「用现有 agent」：**显式指定的** ＞ **用户自己的「mmx」** ＞ **空（默认 agent）**
 *     —— 我们新增的那个**不参与**（这一档就是「不新增、不使用」）。
 *   · 「建专属 agent」（**产品默认**）：**显式指定的** ＞ **我们新增的那个** ＞ **用户自己的「mmx」** ＞ **空**
 *     —— 用户明确选了它 ⇒ 就要它的性格，不迁就现有 agent。
 *
 * ⚠️ **「用现有 agent」那一档里「用户自己的 mmx」优先于我们的**：老板机器上已经有那个 agent ⇒
 *   不新增、不改它、也不把会话挪走（零影响）。
 *
 * @param {string[]} listedNames 宿主 `agents()` 列出来的 agent 名
 * @param {string|null|undefined} configured 用户显式指定的 agent 名（`state.petAgent`）
 * @param {string} [selfName] 我们自己新增的那个 agent 名（宿主里**确实列出来了**才用它）
 * @param {string} [mode] 'own' = 建专属 agent（**产品默认**）；'existing' = 用现有 agent
 *   （内部会先归一：只有明确 existing 才降级）
 * @param {boolean} [selfOwned] 我们那个 agent **确实是我们写的**吗？
 *   ⚠️ 名字被别人占了（name_taken）⇒ 我们**没建成** ⇒ 那个同名 agent 是**别人的**
 *   ⇒ 不能把它当成「我们那个」用（降级：继续用现有 agent）。
 *   传进来的 `selfName` 只是**名字**；**是不是我们的**由这条事实决定。
 * @returns {string} '' = 不指定（用默认 agent）
 */
export function pickPetAgent(listedNames, configured, selfName = '', mode = DEFAULT_AGENT_MODE, selfOwned = false) {
  const explicit = configured ? String(configured) : '';
  if (explicit) return explicit;
  const names = Array.isArray(listedNames) ? listedNames.map((n) => String(n ?? '')) : [];
  const self = String(selfName ?? '');
  // ⭐ **档位先归一**（唯一实现）：只有明确 existing 才降级，别的值按默认档算。
  const m = normalizeAgentMode(mode);
  // 「建专属 agent」那一档：我们那个**排在自己的 mmx 前面**（用户明确选了它）。
  // ⚠️ **但只有它确实是我们写的才用** —— 名字被别人占了 ⇒ 我们没建成 ⇒
  //   那个同名 agent 是**别人的** ⇒ 绝不能把它当成「我们那个」用。
  if (m === 'own' && selfOwned && self && names.includes(self)) return self;
  // 「用现有 agent」那一档：我们那个**不参与**（不新增、不使用）。
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
