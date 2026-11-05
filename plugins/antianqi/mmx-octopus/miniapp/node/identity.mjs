// @ts-check

/**
 * 身份层的**唯一读取口** —— 只读，不写。
 *
 * ⭐ **为什么单独成模块**：
 *   ① 随消息带的身份层（server.mjs 的 withIdentity）要读「她是谁 / 她长什么样 / 她的规矩」；
 *   ② 新增的专属 agent（agentprov.mjs）要把同样三段写进宿主 agent 的 system prompt。
 *   两处读同一份投影 ⇒ **判断只写一处**，否则改了一处另一处会漂。
 *
 * ⚠️ **只读** —— 这两个投影文件都在插件自己的目录里（identity/），
 *   插件**不往宿主目录写任何东西**（Marketplace 评审 Must fix 2 的底线仍然成立）。
 *
 * @module miniapp/node/identity
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 身份层三段的小节结构（identity/AGENTS.md 的标题）。 */
export const IDENTITY_SECTIONS = [
  { key: 'baseline', title: '# 她是谁', end: '# 她长什么样' },
  { key: 'appearance', title: '# 她长什么样', end: '# 她的规矩' },
  { key: 'rules', title: '# 她的规矩', end: '# 结尾' },
];

/**
 * 取两个标记之间的正文（缺任一标记 → 空串：宁可不带，也不带错）。
 *
 * @param {string} raw 整份文件
 * @param {string} startMarker 起始标记
 * @param {string} endMarker 结束标记
 * @returns {string}
 */
export function extractSection(raw, startMarker, endMarker) {
  const text = String(raw ?? '');
  const start = text.indexOf(startMarker);
  if (start < 0) return '';
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : -1;
  if (endMarker && end < 0) return '';
  return text.slice(start + startMarker.length, end < 0 ? text.length : end).trim();
}

/**
 * 去掉文件头的说明（投影文件头上那两行「这是投影，别手改」）。
 *
 * ⚠️ 只去**开头**的注释 —— 正文里的说明一句都不能吃。
 *
 * @param {string} raw
 * @returns {string}
 */
export function stripLeadingComments(raw) {
  const lines = String(raw ?? '').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    const isComment = line.startsWith('<!--') && line.endsWith('-->');
    if (line && !isComment) break;
    index += 1;
  }
  return lines.slice(index).join('\n').trim();
}

/**
 * 读身份层三段（她是谁 / 她长什么样 / 她的规矩）。
 *
 * @param {string} pluginRoot 插件根目录
 * @returns {Promise<{baseline: string, appearance: string, rules: string}>}
 */
export async function readIdentitySections(pluginRoot) {
  const empty = { baseline: '', appearance: '', rules: '' };
  try {
    const raw = await readFile(
      join(pluginRoot, 'miniapp', 'node', 'identity', 'AGENTS.md'),
      'utf8'
    );
    const out = { ...empty };
    for (const section of IDENTITY_SECTIONS) {
      out[section.key] = extractSection(raw, section.title, section.end);
    }
    return out;
  } catch {
    return empty;
  }
}

/**
 * 读人格正文（identity/PERSONA.md —— 由 mmx-character/tools/sync_agent_prompt.py 从真源投影）。
 *
 * @param {string} pluginRoot 插件根目录
 * @returns {Promise<string>}
 */
export async function readPersonaBody(pluginRoot) {
  try {
    const raw = await readFile(
      join(pluginRoot, 'miniapp', 'node', 'identity', 'PERSONA.md'),
      'utf8'
    );
    return stripLeadingComments(raw);
  } catch {
    return '';
  }
}
