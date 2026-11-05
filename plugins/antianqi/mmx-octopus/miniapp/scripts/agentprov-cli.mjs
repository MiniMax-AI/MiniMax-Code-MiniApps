// @ts-check

/**
 * 手动新增我们那个专属 agent 的命令行入口。
 *
 * 用法：
 *   node miniapp/scripts/agentprov-cli.mjs --agents-root <宿主的 agents 目录> [--check]
 *
 * ⭐ **为什么不住在 miniapp/node/**（上游评审 Optional，2026-11-04）：
 *   宿主把 miniapp/node/** 当**运行时代码**扫（上游 scripts/validate.mjs 的 node 规则），
 *   运行时代码里往 stdout 写东西会触发告警（stdout 属于宿主，运行时该走
 *   context.logger）。CLI 是**手动执行**的工具，它的输出就该走 stdout。
 *
 * ⚠️ **只新增，不改已有**：名字被占（那个目录里已经有别人的 agent.md）就**不碰不用**。
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeTextAtomic } from '../node/atomic-json.mjs';
import {
  SELF_AGENT_DESCRIPTION,
  SELF_AGENT_DISPLAY_NAME,
  SELF_AGENT_FILE,
  SELF_AGENT_NAME,
  isSelfAgentFile,
  readFileIfExists,
  renderSelfAgentFile,
} from '../node/agentprov.mjs';
import { readIdentitySections, readPersonaBody } from '../node/identity.mjs';

/**
 * 取一个 --flag 的值。
 *
 * @param {string[]} args
 * @param {string} name
 * @returns {string}
 */
function flag(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] ?? '') : '';
}

/**
 * 手动执行这条命令。
 *
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runCli(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const root = flag(args, '--agents-root');
  const checkOnly = args.includes('--check');
  if (!root) {
    process.stdout.write(
      '用法：node miniapp/scripts/agentprov-cli.mjs --agents-root <宿主 agents 目录> [--check]\n'
    );
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
function isMainModule() {
  try {
    const entry = process.argv[1] ? resolve(process.argv[1]) : '';
    return !!entry && entry === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runCli(process.argv);
}
