// 采集层共用工具。只读查询命令走 execFile + 参数数组，不拼接 shell。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

export const CMD_TIMEOUT = 4000;
export const CMD_MAXBUF = 8 * 1024 * 1024;

/** 执行一条只读查询命令，失败返回 null 而不是抛错 */
export async function run(cmd, args) {
  try {
    const { stdout } = await pexec(cmd, args, { timeout: CMD_TIMEOUT, maxBuffer: CMD_MAXBUF });
    return stdout;
  } catch {
    return null;
  }
}

/** 从任意文本里抠出第一个数字，抠不出返回 null */
export const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
