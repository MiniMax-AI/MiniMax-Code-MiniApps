// 红线守卫：这个插件**不许**碰宿主的三类私有数据。
//
// 2026-10-20 管理员 review 明确的三条硬约束（社区插件）：
//   ① 不能读取 MiniMax Code 的登录凭据
//   ② 不能直接读写 MiniMax Code 的内部数据库
//   ③ 不能读取其它插件的数据目录
//
// v1.x 三条全犯了（读 lease socket / `.cap`、sqlite3 直接 UPDATE/DELETE/INSERT、
// 读 minimax-bot 的 state.json）。v2.0 全部移除。
//
// ⇒ 这个测试把三条红线**变成可执行的门禁**：谁不小心把旧代码加回来，CI 立刻红。
// 人工审计靠不住 —— v1.x 的那些代码在仓库里躺了好几个版本才被发现。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// 插件包根目录：tests/ 的上一级；工作区源码则是 miniapp/node/ 的上两级。
const candidates = [join(here, '..'), join(here, '..', '..')];
const root = candidates.find((p) => existsSync(join(p, 'miniapp', 'node', 'server.mjs')));
if (!root) {
  console.error('  FAIL  找不到插件根目录（既不在 ../ 也不在 ../../）');
  process.exit(1);
}

let pass = 0;
let total = 0;
const check = (name, ok, extra = '') => {
  total += 1;
  if (ok) pass += 1;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
};

/** 递归收集源码文件（只看文本源码，跳过二进制与构建产物）。 */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name === '__pycache__' || name === '.git') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collect(p, out);
    else if (/\.(mjs|js|py|rs|html|json)$/.test(name)) out.push(p);
  }
  return out;
}

const files = collect(root);
const sources = files.map((f) => ({ path: relative(root, f), text: readFileSync(f, 'utf8') }));
const sourceText = sources.map((s) => s.text).join('\n');

/** 在**源码**里找禁用模式（测试文件与文档不算）。 */
function findForbidden(pattern, label) {
  const hits = [];
  for (const s of sources) {
    // 跳过测试自身与文档（它们会**提到**这些名字来断言它们不存在）
    // ⚠️ 按**文件名**跳过，不能按目录：工作区源码把测试放在 `miniapp/node/` 下，
    //    按目录跳会漏掉它们 ⇒ 守卫在本地误报。
    if (s.path.includes('/tests/') || s.path.startsWith('tests/')) continue;
    if (s.path.endsWith('.md')) continue;
    if (s.path.includes('.test.')) continue;
    const lines = s.text.split('\n');
    lines.forEach((line, i) => {
      // 注释行不算（文档里解释「我们不碰 X」是允许的）
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('#')) return;
      if (pattern.test(line)) hits.push(`${s.path}:${i + 1}`);
    });
  }
  return { hits, label };
}

console.log('=== 红线 ①：不得读取 MiniMax Code 的登录凭据 ===');
{
  const checks = [
    [/mcode-auth-lease/i, 'lease socket'],
    [/\.cap['"`]/, '.cap 凭据文件'],
    [/acquireLeaseToken|acquire_lease_token/, '取 lease token 的函数'],
    [/mcode-reset-card\/token/, '把 token 落到磁盘'],
  ];
  for (const [pat, label] of checks) {
    const { hits } = findForbidden(pat, label);
    check(`不出现「${label}」`, hits.length === 0, hits.slice(0, 3).join(' '));
  }
}

console.log('\n=== 红线 ②：不得直接读写 MiniMax Code 的内部数据库 ===');
{
  const checks = [
    [/runtime-state\.sqlite/, '宿主状态库路径'],
    [/local_runtime_thread_goals/, '目标表'],
    [/local_runtime_queue_items/, '执行队列表'],
    [/\bUPDATE\s+local_runtime/i, 'UPDATE 宿主表'],
    [/\bDELETE\s+FROM\s+local_runtime/i, 'DELETE 宿主表'],
    [/\bINSERT\s+(OR\s+IGNORE\s+)?INTO\s+local_runtime/i, 'INSERT 宿主表'],
  ];
  for (const [pat, label] of checks) {
    const { hits } = findForbidden(pat, label);
    check(`不出现「${label}」`, hits.length === 0, hits.slice(0, 3).join(' '));
  }
}

console.log('\n=== 红线 ③：不得读取其它插件的数据目录 ===');
{
  const checks = [
    [/plugin-data[\\/]/, '其它插件的 plugin-data 目录'],
    [/liveboards[\\/]/, '其它插件的 liveboard 数据'],
    [/minimax-bot[\\/]state\.json/i, 'minimax-bot 的 state.json'],
  ];
  for (const [pat, label] of checks) {
    const { hits } = findForbidden(pat, label);
    check(`不出现「${label}」`, hits.length === 0, hits.slice(0, 3).join(' '));
  }
}

console.log('\n=== 不做写操作：不得自己扣卡 / 暂停目标 ===');
{
  const checks = [
    [/reset_card\/use/, '扣卡接口'],
    [/useCard\s*\(/, '扣卡函数'],
    [/resume_goal|pause_goal/, '目标暂停/恢复'],
  ];
  for (const [pat, label] of checks) {
    const { hits } = findForbidden(pat, label);
    check(`不出现「${label}」`, hits.length === 0, hits.slice(0, 3).join(' '));
  }
}

console.log('\n=== 账本读取器是唯一数据源（它必须在）===');
{
  check('server.mjs 里有账本读取器', /function readLedger\(/.test(sourceText));
  check('账本路径指向插件自己的目录', /mcode-reset-card[\\/]ledger\.json/.test(sourceText));
  check('没有账号 API 调用', !/apiGet\(|apiPost\(/.test(sourceText));
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
