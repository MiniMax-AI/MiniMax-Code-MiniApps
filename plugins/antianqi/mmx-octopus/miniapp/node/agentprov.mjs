// @ts-check

/**
 * 给她**新增**一个专属 agent —— 只增不改、失败必降级。
 *
 * ⭐ **为什么需要它**：官方给 Mini App 的通道只有三条（托管 MCP / 输入框 message.append /
 *   Agent 会话 API），**没有「注入 system prompt」这一条**。身份层只能靠「每轮随消息带」
 *   （弱通道），而弱通道会被宿主压缩掉。
 *   官方答复：「可以写个脚本在 mcode 的 agent 配置中新增一个 agent；不修改已有的 agent 配置，
 *   新增应该没问题。」这个模块就是那件事 —— 在宿主 agent 目录里**新增**一个我们自己的 agent.md，
 *   之后她的会话挂在这个 agent 上 ⇒ 身份层进了 system prompt（强通道）。
 *
 * ⚠️ **三条硬底线**：
 *   ① 只**新增**一个目录 + 一个文件：<agents 根>/<agent 名>/agent.md；
 *   ② **绝不改**已有的 agent —— 名字被占（那个目录里已经有别人的 agent.md）就**不碰不用**，降级；
 *   ③ 定位 agent 根目录**只用宿主 API 返回的路径**（会话工作目录 / agents() 列表），
 *      **不从 dataDir 反推** —— dataDir 的布局是宿主内部实现，反推就是猜。
 *
 * ⚠️ **失败必降级**：任何一步出错（拿不到根目录 / 名字被占 / 写失败 / 校验失败）
 *   都只是**返回失败**，不抛异常、不阻断她说话 —— 降级路径上身份层仍走随消息带（弱通道）。
 *
 * @module miniapp/node/agentprov
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteQueue, writeTextAtomic } from './atomic-json.mjs';
import { readIdentitySections, readPersonaBody } from './identity.mjs';
// ⭐ **agent 名字的真源在 agentpick.mjs**（纯模块、零依赖）—— 这边不许另写一份。
import { PET_AGENT_NAME as LEGACY_AGENT_NAME, SELF_AGENT_NAME } from './agentpick.mjs';

export { LEGACY_AGENT_NAME, SELF_AGENT_NAME };

/** 我们写进 agent.md 的标记 —— 用来认出「这个文件是我们写的」。 */
export const SELF_AGENT_MARK = '<!-- mmx-octopus:self-agent -->';

/** 宿主自定义 agent 的 system prompt 文件名。 */
export const SELF_AGENT_FILE = 'agent.md';

/** 宿主 agent 列表里显示的名字（角色名，不跟着用户的改名走）。 */
export const SELF_AGENT_DISPLAY_NAME = '小章鱼';

/** agent 列表里的说明。 */
export const SELF_AGENT_DESCRIPTION =
  '桌面上的章鱼娘专属 agent（她的会话跑在这个 agent 上，身份层写在这个 agent 的文件里）';

/** 同一个文件上的并发写排成一条链（社区规则：串行化并发写）。 */
const writeQueue = createWriteQueue();

/**
 * 这个字符串看起来像一条绝对路径吗？
 *
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikePath(value) {
  const text = String(value ?? '');
  if (text.length < 3) return false;
  if (text.charAt(0) === '/') return true;
  const isDrive = text.charCodeAt(1) === 58;
  const sep = text.charAt(2);
  return isDrive && (sep === '/' || sep === String.fromCharCode(92));
}

/**
 * 把一个值里所有像路径的字符串抠出来（深度有限，防跑飞）。
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function collectPathStrings(value, depth = 0, out = []) {
  if (depth > 4 || value === null || value === undefined) return out;
  if (typeof value === 'string') {
    if (looksLikePath(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathStrings(item, depth + 1, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      collectPathStrings(value[key], depth + 1, out);
    }
  }
  return out;
}

/**
 * 从宿主给的路径里找 agent 根目录。
 *
 * 两种形态：
 *   ① <root>/<agent 名>/miniapps/<pluginId> —— Mini App 自己的 Agent 目录
 *      ⇒ root = 往上三层；
 *   ② <root>/agents/<agent 名> —— agents() 列表里带的 agent 目录
 *      ⇒ root = 那个 agents 目录。
 *
 * ⚠️ **只认宿主给的路径** —— 这里不做任何「从 dataDir 反推」的兜底。
 *
 * @param {string[]} paths 宿主返回的路径们
 * @param {string} pluginId 插件 id
 * @returns {string[]} 候选根目录（按可信度排序）
 */
export function agentsRootCandidates(paths, pluginId) {
  const wanted = String(pluginId ?? '');
  const out = [];
  const push = (value) => {
    const text = String(value ?? '');
    if (text && !out.includes(text)) out.push(text);
  };
  for (const raw of Array.isArray(paths) ? paths : []) {
    const text = String(raw ?? '');
    if (!text) continue;
    // 形态①：<root>/<agent>/miniapps/<pluginId>
    if (wanted && basename(text) === wanted && basename(dirname(text)) === 'miniapps') {
      const root = dirname(dirname(dirname(text)));
      if (root && root !== text) push(root);
    }
  }
  for (const raw of Array.isArray(paths) ? paths : []) {
    const text = String(raw ?? '');
    if (!text) continue;
    // 形态②：<root>/agents/<name>
    let current = text;
    for (let step = 0; step < 8; step += 1) {
      if (basename(current) === 'agents') {
        push(current);
        break;
      }
      const up = dirname(current);
      if (!up || up === current) break;
      current = up;
    }
  }
  return out;
}

/**
 * 渲染我们那个 agent 的 agent.md（纯函数 —— 自检能直接跑它做负向注入）。
 *
 * ⚠️ **frontmatter 只用宿主认识的字段**（name / description / x-mavis.displayName）：
 *   宿主解析器会拒掉不认识的字段，写错 = agent 认不出来。
 *
 * @param {{persona?: string, identity?: {baseline?: string, appearance?: string, rules?: string},
 *   name?: string, displayName?: string, description?: string}} input
 * @returns {string}
 */
export function renderSelfAgentFile(input) {
  const name = String(input?.name || SELF_AGENT_NAME);
  const displayName = String(input?.displayName || SELF_AGENT_DISPLAY_NAME);
  const description = String(input?.description || SELF_AGENT_DESCRIPTION);
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
    SELF_AGENT_MARK,
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
 * 这个 agent.md 是我们写的吗？
 *
 * @param {string} text 文件内容
 * @returns {boolean}
 */
export function isSelfAgentFile(text) {
  return String(text ?? '').includes(SELF_AGENT_MARK);
}

/**
 * 读一个文件；不存在 → null。
 *
 * @param {string} file
 * @returns {Promise<string|null>}
 */
export async function readFileIfExists(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 宿主 agent 根目录找到了没有（目录必须真的存在）。
 *
 * @param {string[]} candidates
 * @returns {Promise<string>}
 */
export async function resolveAgentsRoot(candidates) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) return candidate;
    } catch {
      // 不存在就试下一个
    }
  }
  return '';
}

/**
 * 在宿主里**新增**我们那个专属 agent。
 *
 * @param {{context: any, sessionId?: string, pluginId?: string, logger?: any}} input
 * @returns {Promise<{ok: boolean, created: boolean, agent?: string, path?: string,
 *   reason?: string, probeSessionId?: string}>}
 */
export async function ensureSelfAgent(input) {
  const context = input?.context;
  const pluginId = String(input?.pluginId || context?.pluginId || '');
  const logger = input?.logger || context?.logger;
  const paths = [];

  // ① 会话详情里的工作目录（宿主给的路径）
  if (input?.sessionId && context?.agent && typeof context.agent.session === 'function') {
    try {
      const detail = await context.agent.session(input.sessionId);
      paths.push(...collectPathStrings(detail));
    } catch (error) {
      logger?.warn?.('miniapp.agent.self_agent.session_probe_failed', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  // ② agents() 列表里带的 agent 目录（宿主给的路径）
  if (context?.agent && typeof context.agent.agents === 'function') {
    try {
      const listed = await context.agent.agents();
      paths.push(...collectPathStrings(listed));
    } catch (error) {
      logger?.warn?.('miniapp.agent.self_agent.agents_probe_failed', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  const root = await resolveAgentsRoot(agentsRootCandidates(paths, pluginId));
  if (!root) {
    logger?.warn?.('miniapp.agent.self_agent.agents_root_unknown', { pluginId });
    return { ok: false, created: false, reason: 'agents_root_unknown' };
  }

  const targetFile = join(root, SELF_AGENT_NAME, SELF_AGENT_FILE);

  // ⭐ **只增不改**：文件已经存在就一个字节都不动。
  const existing = await readFileIfExists(targetFile);
  if (existing !== null) {
    if (isSelfAgentFile(existing)) {
      return { ok: true, created: false, agent: SELF_AGENT_NAME, path: targetFile };
    }
    // 那个名字已经被别人的 agent 占了 —— 不碰不用，降级。
    logger?.warn?.('miniapp.agent.self_agent.name_taken', { path: targetFile });
    return { ok: false, created: false, path: targetFile, reason: 'name_taken' };
  }

  const persona = await readPersonaBody(context?.pluginRoot || '');
  if (!persona) {
    logger?.warn?.('miniapp.agent.self_agent.persona_missing', {});
    return { ok: false, created: false, reason: 'persona_missing' };
  }
  const identity = await readIdentitySections(context?.pluginRoot || '');
  const content = renderSelfAgentFile({
    persona,
    identity,
    name: SELF_AGENT_NAME,
    displayName: SELF_AGENT_DISPLAY_NAME,
    description: SELF_AGENT_DESCRIPTION,
  });

  try {
    await writeQueue(async () => {
      // 队列里再查一次：并发下别把别人的文件顶掉。
      const again = await readFileIfExists(targetFile);
      if (again !== null) return;
      await writeTextAtomic(targetFile, content);
    });
  } catch (error) {
    logger?.warn?.('miniapp.agent.self_agent.write_failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, created: false, path: targetFile, reason: 'write_failed' };
  }

  const verified = await readFileIfExists(targetFile);
  if (verified === null || !isSelfAgentFile(verified)) {
    logger?.warn?.('miniapp.agent.self_agent.verify_failed', { path: targetFile });
    return { ok: false, created: false, path: targetFile, reason: 'verify_failed' };
  }
  logger?.info?.('miniapp.agent.self_agent.created', { path: targetFile });
  return { ok: true, created: true, agent: SELF_AGENT_NAME, path: targetFile };
}

/**
 * 手动执行：node miniapp/node/agentprov.mjs --agents-root <宿主的 agents 目录>
 *
 * ⭐ **这是用户自己动手的那条路**（官方答复里说的「写个脚本新增一个 agent」）：
 *   用户明确指定了目录，我们才写；只新增，不改已有。
 *
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runCli(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const flag = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? String(args[index + 1] ?? '') : '';
  };
  const root = flag('--agents-root');
  const checkOnly = args.includes('--check');
  if (!root) {
    process.stdout.write('用法：node agentprov.mjs --agents-root <宿主 agents 目录> [--check]\n');
    return 2;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = dirname(dirname(here));
  const persona = await readPersonaBody(pluginRoot);
  const identity = await readIdentitySections(pluginRoot);
  const targetFile = join(resolve(root), SELF_AGENT_NAME, SELF_AGENT_FILE);
  const existing = await readFileIfExists(targetFile);
  if (existing !== null) {
    process.stdout.write(
      (isSelfAgentFile(existing) ? '已经是我们写的那个 agent：' : '那个名字已被占用（不碰）：') +
        targetFile +
        '\n'
    );
    return 0;
  }
  if (checkOnly) {
    process.stdout.write('可以写：' + targetFile + '\n');
    return 0;
  }
  const content = renderSelfAgentFile({
    persona,
    identity,
    name: SELF_AGENT_NAME,
    displayName: SELF_AGENT_DISPLAY_NAME,
    description: SELF_AGENT_DESCRIPTION,
  });
  try {
    await writeTextAtomic(targetFile, content);
  } catch (error) {
    process.stdout.write('写失败：' + (error instanceof Error ? error.message : 'unknown') + '\n');
    return 1;
  }
  process.stdout.write('已写入：' + targetFile + '\n');
  return 0;
}

/**
 * 这个文件是不是被当作主程序跑的？
 *
 * @returns {boolean}
 */
export function isMainModule() {
  try {
    const entry = process.argv[1] ? resolve(process.argv[1]) : '';
    return !!entry && entry === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const code = await runCli(process.argv);
  process.exitCode = code;
}
