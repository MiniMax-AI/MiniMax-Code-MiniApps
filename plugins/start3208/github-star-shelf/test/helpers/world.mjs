// 一台完整的「别人的电脑」：沙盒目录 + 假 gh / 假 git + 假 AI + 真正的 Mini App 服务。
import test from 'node:test';
import { IS_WIN, installFake, makeSandbox, setFixtures, setMode, fakeEnv, sleep } from './sandbox.mjs';
import { makeFixtures } from './fixtures.mjs';
import { makeStubAgent } from './stub-agent.mjs';
import { boot, importAll } from './host.mjs';

export { importAll };

/** 端到端测试：假 gh / 假 git 是 sh 脚本，Windows 上跳过（Windows 的路径规则由 env / github 单测用模拟平台覆盖） */
export const e2e = (name, fn) => test(name, { skip: IS_WIN ? '需要 POSIX sh 来放假 gh / 假 git' : false }, fn);

/**
 * opts.gh / opts.git   是否在 PATH 里放假命令（默认放）
 * opts.mode            假命令的故障模式（见 sandbox.setMode）
 * opts.agent === false 宿主不给 Agent（模拟没打开「运行 Agent」权限）
 * opts.workDir         假宿主说「AI 在这个文件夹干活」，默认沙盒里的 AI 工作区
 * opts.env             覆盖假环境（比如 platform / commonDirs）；也可以是 (sb) => ({...})
 * opts.setup           启动前在沙盒里再准备点东西：async (sb) => {}
 * opts.capabilities    undefined = 全支持，null = 没有这个字段（老版本宿主），或自己给 { has }
 */
export async function world(t, opts = {}) {
  const sb = await makeSandbox();
  const w = { sb, fx: opts.fixtures || makeFixtures(), app: null, stub: null, envCtx: null };
  if (opts.gh !== false) await installFake(sb, 'gh');
  if (opts.git !== false) await installFake(sb, 'git');
  await setFixtures(sb, w.fx);
  if (opts.mode) await setMode(sb, opts.mode);
  w.stub = opts.agent === false ? null : makeStubAgent({ workDir: opts.workDir ?? sb.agent });
  if (opts.setup) await opts.setup(sb);
  w.envCtx = fakeEnv(sb, typeof opts.env === 'function' ? opts.env(sb) : opts.env);
  const up = async () => {
    w.app = await boot(sb, { agent: w.stub?.agent, envCtx: w.envCtx, capabilities: opts.capabilities });
    return w.app;
  };
  // 先停服务（它停之前会把状态写盘），再删沙盒；node:test 的 after 钩子按注册顺序执行
  t.after(async () => {
    await w.app?.stop().catch(() => {});
    await sb.cleanup();
  });
  await up();
  /** 重启 Mini App：数据目录和 AI 会话都还在，就像用户关掉再打开 */
  w.restart = async (before) => {
    await w.app.stop();
    if (before) await before();
    return up();
  };
  return w;
}

/** 等 gh / git 的检测做完（页面第一次取状态时才会开始检测） */
export async function settled(app) {
  return app.waitFor(async () => {
    const s = await app.state();
    return s.github && !s.github.checking ? s : null;
  }, { what: 'github detection' });
}

/** 等这个项目没有进行中的 AI 任务 */
export async function idle(app, key) {
  return app.waitFor(async () => {
    const r = await app.get('/api/projects/' + key);
    return r.status === 200 && r.json.calls.length === 0 ? r.json : null;
  }, { what: 'project ' + key + ' idle', timeout: 15000 });
}

export async function managerIdle(app) {
  return app.waitFor(async () => {
    const r = await app.get('/api/manager');
    return r.json.calls.length === 0 ? r.json : null;
  }, { what: 'manager idle' });
}

/** 收集 /api/events 推过来的消息 */
export async function listen(app) {
  const res = await fetch(app.base + '/api/events');
  const reader = res.body.getReader();
  const events = [];
  const dec = new TextDecoder();
  let buf = '';
  const pump = (async () => {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        return;
      }
      if (chunk.done) return;
      buf += dec.decode(chunk.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of block.split('\n')) if (line.startsWith('data:')) events.push(JSON.parse(line.slice(5)));
      }
    }
  })();
  return { events, close: async () => { await reader.cancel().catch(() => {}); await pump; } };
}

export { sleep };

/** 导入 12 个 Star 之后的世界 */
export async function ready(t, opts) {
  const w = await world(t, opts);
  await importAll(w.app);
  return w;
}

/** 请求讲解，等它做完，返回项目详情 */
export async function explain(w, key, mode, body = {}) {
  const r = await w.app.post('/api/projects/' + key + '/explain', { mode, ...body });
  if (r.status !== 200) throw new Error('explain rejected: ' + r.text);
  return idle(w.app, key);
}

/** 发一条追问，等它做完，返回项目详情 */
export async function ask(w, key, text, body = {}) {
  const r = await w.app.post('/api/projects/' + key + '/message', { text, ...body });
  if (r.status !== 200) throw new Error('message rejected: ' + r.text);
  return idle(w.app, key);
}
