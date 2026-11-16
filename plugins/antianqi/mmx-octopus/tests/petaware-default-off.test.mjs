// @ts-check
/**
 * 随包发布的测试：跨会话感知默认关，且关的时候真的不采集。
 *
 * 跑法（包根目录下）：
 *   node --test tests/petaware-default-off.test.mjs
 *
 * 覆盖上游 issue #136 点名的三组：**首次启动**、**切换开关**、**重启**。
 * 判断的实现见同目录 `petaware-scenarios.mjs` —— 与包内自检共用同一份，
 * 所以「同一个判断不许写在两个地方」这条规矩守得住。
 *
 * ⚠️ **为什么用子进程跑**：这些场景会**真起一套 server**。如果生产代码被改坏
 *   （比如把开关守卫删了），它自己起的定时器就没人收了 —— 同一个进程里
 *   `node --test` 会一直等进程退出，**挂死而不是失败**。
 *   放子进程里跑并设超时 ⇒ 真代码坏了的时候看到的是一条**干净的失败**，
 *   而不是 CI 卡住。判据要能被抓：挂死也算被抓，但没法告诉人哪儿坏了。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'petaware-runner.mjs');
/** 场景本身要起 4 套 server，正常 7 秒左右；给 3 分钟余量。 */
const TIMEOUT_MS = 180000;

/**
 * 跑一遍场景（子进程），把结果 JSON 取回来。
 *
 * @returns {Promise<{code: number|null, stdout: string, stderr: string, timedOut: boolean}>}
 */
function runScenarios() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

test('petAware：默认关，关的时候真的不采集（首启 / 切换 / 重启）', async () => {
  const run = await runScenarios();
  assert.equal(
    run.timedOut,
    false,
    '跑场景超时（' + TIMEOUT_MS + 'ms）⇒ 生产代码可能改坏了，进程退不出去'
  );
  assert.equal(run.code, 0, '跑场景的子进程退出了 ' + run.code + '：\n' + run.stderr.slice(-2000));
  const results = JSON.parse(run.stdout);
  const failed = results.filter((r) => !r.ok);
  assert.deepEqual(
    failed,
    [],
    failed.map((f) => f.name + ' -> ' + f.detail).join('; ')
  );
  assert.ok(results.length >= 12, '场景数不对：' + results.length);
});
