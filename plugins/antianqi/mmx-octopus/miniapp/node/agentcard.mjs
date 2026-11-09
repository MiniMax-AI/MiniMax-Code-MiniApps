// @ts-check

/**
 * 渲染「交给用户自己粘贴的 agent 设定正文」。
 *
 * ⭐ **为什么需要它**（官方插件市场拒收 1.8.0 → 官方给的改法 B，2026-11-09）：
 *   插件**全程不写宿主任何文件** ⇒ 想留住「专属 agent」这个体验，
 *   只能由**用户自己**建 agent、自己粘贴设定；插件只负责**认出来**并用它。
 *   要能引导，就得先把那份设定正文交出来 —— 就是这个模块的活。
 *
 * ⚠️ **纯函数**：只拼字符串。它**不写**任何文件
 *   （读身份层在 identity.mjs；**这里绝对没有写盘** —— 判据第四十九轮盯着这一点）。
 *
 * ⚠️ **同一个判断只写一处**：agent 叫什么，只有 agentpick.mjs 说了算
 *   （这里 import 它的 PET_AGENT_NAME，不另写一份）。
 *
 * @module miniapp/node/agentcard
 */

import { readIdentitySections, readPersonaBody } from './identity.mjs';
import { PET_AGENT_NAME } from './agentpick.mjs';

/** 用户自己建那个 agent 时该用的名字（真源在 agentpick.mjs，这里只引用）。 */
export const AGENT_CARD_NAME = PET_AGENT_NAME;

/** 宿主 agent 列表里的显示名（用户可以在自己的 Agent 设置里改成别的）。 */
export const AGENT_CARD_DISPLAY_NAME = '章鱼娘';

/** 宿主 agent 列表里的说明。 */
export const AGENT_CARD_DESCRIPTION = '桌面上的章鱼娘（她自己那个专属 agent）';

/** 写进正文里的标记 —— 方便认出「这份设定来自这个插件」。 */
export const AGENT_CARD_MARK = '<!-- mmx-octopus:agent-card -->';

/**
 * 渲染 agent 设定正文（纯函数）。
 *
 * ⚠️ frontmatter 只用宿主认识的字段（name / description / x-mavis.displayName）：
 *   宿主解析器会拒掉不认识的字段，写错 = agent 认不出来。
 *
 * @param {{persona?: string, identity?: {baseline?: string, appearance?: string, rules?: string},
 *   name?: string, displayName?: string, description?: string}} input
 * @returns {string}
 */
export function renderAgentCard(input) {
  const name = String(input?.name || AGENT_CARD_NAME);
  const displayName = String(input?.displayName || AGENT_CARD_DISPLAY_NAME);
  const description = String(input?.description || AGENT_CARD_DESCRIPTION);
  const persona = String(input?.persona ?? '').trim();
  const identity = input?.identity || {};
  const parts = [
    '---',
    'name: ' + name,
    'description: ' + description,
    'x-mavis:',
    '  displayName: ' + displayName,
    '---',
    '',
    AGENT_CARD_MARK,
    '',
  ];
  if (persona) parts.push(persona, '');
  const baseline = String(identity.baseline ?? '').trim();
  const appearance = String(identity.appearance ?? '').trim();
  const rules = String(identity.rules ?? '').trim();
  if (baseline) parts.push('# 她是谁', '', baseline, '');
  if (appearance) parts.push('# 她长什么样', '', appearance, '');
  if (rules) parts.push('# 她的规矩', '', rules, '');
  return parts.join('\n').trimEnd() + '\n';
}

/**
 * 取这份设定正文（读包内的身份层三段 + 人格正文）。
 *
 * ⚠️ **只读**：读的是插件自己包里的文件（identity/AGENTS.md、identity/PERSONA.md），
 *   不碰宿主任何文件，**也不写任何文件**。
 *
 * @param {string} pluginRoot
 * @returns {Promise<string>}
 */
export async function buildAgentCard(pluginRoot) {
  const persona = await readPersonaBody(pluginRoot);
  const identity = await readIdentitySections(pluginRoot);
  return renderAgentCard({ persona, identity });
}
