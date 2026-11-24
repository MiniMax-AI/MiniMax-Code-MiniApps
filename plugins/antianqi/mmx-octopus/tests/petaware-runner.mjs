// @ts-check
/**
 * 场景跑批的**子进程入口** —— 判断的实现见 `petaware-scenarios.mjs`。
 *
 * 把结果以 JSON 打到 stdout（**同步写**），父进程好解析。
 *
 * ⚠️ **写完就主动退出**（`writeSync` + `process.exit`）：
 *   生产代码一旦被改坏，它自己起的定时器就没人收了 —— 这个子进程会永远
 *   退不出去，父进程只能等到超时才判失败（慢，而且看不出哪儿坏了）。
 *   同步写完直接退出 ⇒ 父进程**立刻**拿到结果，红在哪一条一目了然。
 *   （`writeSync` 是同步的，退出不会把输出截断。）
 */

import { writeSync } from 'node:fs';
import { runPetAwareScenarios } from './petaware-scenarios.mjs';

const results = await runPetAwareScenarios();
writeSync(1, JSON.stringify(results) + '\n');
process.exit(0);
