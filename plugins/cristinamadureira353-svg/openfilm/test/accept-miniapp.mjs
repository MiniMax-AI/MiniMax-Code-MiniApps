/**
 * OpenFilm MiniApp 的完整验收。
 *
 * 跑法：node test/accept-miniapp.mjs
 * 全部实例都用**临时的 home 和端口**（4900–4903），跑完自己收掉；
 * 不碰你正在用的面板，也不写你的项目（项目列表只读）。
 * 没有 OpenFilm 项目的机器上，与项目相关的两项检查会明确跳过。
 *
 * 唯一会动真东西的：`probe codex` 会起一个 ACP 会话（只探测，不发消息、不改项目）。
 * 不想跑它：SKIP_PROBE=1 node accept-miniapp.mjs
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtemp, readFile, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import net from 'node:net';

/** Host 头要用原始 socket 测：undici/fetch 不许覆盖 Host（会静默换成 URL 里的）。 */
function rawGet(port, path, host) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    s.on('data', (d) => { data += d; });
    s.on('end', () => resolve(data));
    s.on('error', () => resolve(''));
  });
}
const rawStatus = async (port, path, host) => {
  const text = await rawGet(port, path, host);
  const m = /^HTTP\/1\.1 (\d+)/.exec(text);
  return m ? Number(m[1]) : 0;
};

const PKG = fileURLToPath(new URL('..', import.meta.url));
const { start } = await import(pathToFileURL(join(PKG, 'miniapp', 'node', 'server.mjs')).href);
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 起一个实例，返回它的调用方法。 */
async function boot(pluginRoot, port, studioHome) {
  const controller = new AbortController();
  const app = await start({
    pluginRoot,
    listen: { port, host: '127.0.0.1' },
    signal: controller.signal,
    logger: { info: () => {} },
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, text: await r.text(), headers: r.headers };
  };
  const ipc = (channel, payload) => call('/ipc/' + encodeURIComponent(channel), { method: 'POST', body: payload ?? null });
  const json = async (path) => {
    const r = await call(path);
    try { return { status: r.status, data: JSON.parse(r.text) }; } catch { return { status: r.status, data: null, raw: r.text }; }
  };
  const waitReady = async () => {
    for (let i = 0; i < 240; i++) {
      const { data } = await json('/miniapp/studio');
      if (data?.ready) return data;
      await sleep(500);
    }
    return null;
  };
  return { app, call, ipc, json, waitReady, base };
}

/** 一份临时包（自己的 home、自己的端口、可改配置）。 */
async function tempPackage(patch) {
  const root = await mkdtemp(join(tmpdir(), 'of-accept-'));
  await mkdir(join(root, 'miniapp', 'node'), { recursive: true });
  await mkdir(join(root, 'miniapp', 'client'), { recursive: true });
  await cp(join(PKG, 'miniapp', 'node'), join(root, 'miniapp', 'node'), { recursive: true });
  await cp(join(PKG, 'miniapp', 'client'), join(root, 'miniapp', 'client'), { recursive: true });
  const config = JSON.parse(await readFile(join(PKG, 'miniapp.config.json'), 'utf8'));
  const studioHome = join(root, 'studio-home');
  const merged = { ...config, studioHome, ...patch };
  delete merged._说明;
  await writeFile(join(root, 'miniapp.config.json'), JSON.stringify(merged, null, 2));
  return { root, studioHome };
}
import { createServer as netCreateServer } from 'node:net';

/** 找一个空闲端口（不写死，免得跟别的东西撞）。 */
async function freePort() {
  const srv = netCreateServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));
  return port;
}
const hasLsof = (() => { try { execFileSync('lsof', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const portFree = (port) => {
  try {
    execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { stdio: 'ignore' });
    return false;
  } catch { return true; }
};

/* ───────────────────────── 1. 主实例：桌面版模式 ───────────────────────── */
console.log('\n【1】桌面版模式（主实例）');
const mainPkg = await tempPackage({ studioPort: await freePort() });
const main = await boot(mainPkg.root, await freePort(), mainPkg.studioHome);
const studio = await main.waitReady();
check('Studio 起来', Boolean(studio), studio ? `mode=${studio.mode}` : '超时');
check('桌面模式就绪', studio?.desktop?.ready === true, JSON.stringify(studio?.desktop ?? {}));

const tree = await main.json('/miniapp/tree');
check('项目列表读得到', tree.status === 200 && Array.isArray(tree.data?.groups) && tree.data.groups.length > 0,
  tree.data ? `${tree.data.groups.length} 组，library=${tree.data.library}` : tree.status);
check('没有残留 windows 字段', !JSON.stringify(tree.data).includes('"windows"'));
check('没有死掉的项目（/private/tmp 那条）', !JSON.stringify(tree.data).includes('openfilm-smoke'));

const firstProject = tree.data?.groups?.[0]?.project ?? null;
const page = firstProject ? await main.call('/projects/' + firstProject.id) : { status: 0, text: '' };
if (firstProject) check('桌面版那一页伺服得出', page.status === 200 && page.text.includes('/bridge-web.js'));
check('页面不注入任何密钥（Host 负责鉴权）', !page.text.includes('__OPENFILM_PANEL_TOKEN__'));
const bridge = await main.call('/bridge-web.js');
check('网页版原生桥伺服得出', bridge.status === 200 && bridge.text.includes('openfilmNative'));

/* 预览：影片页必须与桌面版同源、EDITOR 必须改写成面板源、bridge 的同源限制必须放开，
   否则预览会一直停在「正在绘制第一帧」。 */
if (firstProject) {
  const filmInfo = await main.json('/api/projects/' + firstProject.id);
  const folder = filmInfo.data?.folder || '';
  check('folder 已改写到面板源', folder.startsWith(main.base + '/p/'), folder.slice(0, 60));
  const filmPage = await main.call(folder.slice(main.base.length) + 'film.html');
  check('影片页经代理伺服得出', filmPage.status === 200 && filmPage.text.includes('openfilm-film'));
  check('影片页的 EDITOR 是面板源（不再是 4823）', filmPage.text.includes(main.base) && !filmPage.text.includes(':4823'));
  check('bridge 的同源限制已放开（否则同源时桥不启动）', !filmPage.text.includes('parent.location.origin === location.origin'));
  const firstClip = /src="([^"]+\.mp4)/.exec(filmPage.text)?.[1];
  if (firstClip) {
    const media = await main.call(folder.slice(main.base.length) + firstClip);
    check('影片素材经代理可读', media.status === 200 || media.status === 206, `HTTP ${media.status}`);
  }
}

for (const channel of ['desktop:hello', 'desktop:local-agents:list', 'desktop:prefs']) {
  const r = await main.ipc(channel);
  check(`IPC ${channel}`, r.status === 200 && !r.text.startsWith('{"error"'), r.text.slice(0, 90));
}
let chat = { status: 0, text: '{}' };
let sessions = 0;
for (const g of (tree.data?.groups ?? [])) {
  const r = await main.ipc('desktop:chat:load', { project: g.project.path });
  let n = 0;
  try { n = JSON.parse(r.text).sessions?.length ?? 0; } catch { /* 下一个 */ }
  if (r.status === 200 && n > 0) { chat = r; sessions = n; break; }
}
if (!firstProject) console.log('  ↷ 这台机器没有 OpenFilm 项目：与项目相关的两项检查跳过');
if (firstProject) check('聊天读得到项目里真实的会话', chat.status === 200 && sessions > 0, `${sessions} 条会话`);

const roster = await main.ipc('desktop:agents:list');
let agentCount = 0;
try { agentCount = JSON.parse(roster.text).length; } catch { /* 下面会报 */ }
check('设置页的智能体名单不是空的（roster 已接真）', agentCount >= 10, `${agentCount} 个`);
for (const ch of ['desktop:agents:skills', 'desktop:agents:mcp']) {
  const r = await main.ipc(ch, { id: 'codex' });
  check(`${ch} 不被 stub 覆盖`, r.status === 200 && !r.text.includes('need the desktop app'), r.text.slice(0, 70));
}

const sse = await fetch(main.base + '/ipc/events');
check('SSE 推送连得上', sse.status === 200 && String(sse.headers.get('content-type')).includes('text/event-stream'));
const reader = sse.body.getReader();
await reader.read();
await reader.cancel();

if (!process.env.SKIP_PROBE) {
  const claude = await main.ipc('desktop:local-agents:probe', { agent: 'claude' });
  check('probe claude（没装要照实说）', claude.status === 200, claude.text.slice(0, 90));
  const codex = await main.ipc('desktop:local-agents:probe', { agent: 'codex' });
  check('probe codex（本地 agent 真起得来）', codex.status === 200 && codex.text.includes('"ok":true'), codex.text.slice(0, 90));
}

console.log('\n【2b】评审要求的安全边界');
{
  const st = await main.json('/miniapp/studio');
  check('/miniapp/studio 不再返回 key', st.data && !('key' in st.data), JSON.stringify(st.data).slice(0, 80));
  const quit = await main.call('/api/quit', { method: 'POST', body: {} });
  check('/api/quit 被白名单挡住', quit.status === 403, `HTTP ${quit.status}`);
  const open = await main.call('/api/open');
  check('/api/open 被白名单挡住', open.status === 403, `HTTP ${open.status}`);
  const auto = await main.ipc('desktop:agents:automatic', { id: 'codex' });
  check('automatic 流程被 IPC 白名单挡住', auto.status === 403, `HTTP ${auto.status}`);
  const bad = await main.ipc('desktop:agents:shown', { id: 'codex', shown: 'yes' });
  check('参数类型不对返回 400', bad.status === 400, `HTTP ${bad.status}`);
  const reveal = await main.ipc('desktop:reveal', '/etc');
  check('reveal 项目目录之外被拒', reveal.status === 200 && reveal.text.includes('not inside a project'), reveal.text.slice(0, 80));
}

console.log('\n【2】鉴权边界（生产由 Host 守，见 docs/runtime.md）');
let r = await main.call('/miniapp/studio');
check('开发直连能调（生产的 Host 凭据不在这套测试范围）', r.status === 200, `HTTP ${r.status}`);
r = await main.call('/api/health');
check('/api/health 转发通', r.status === 200 && r.text.includes('openfilm-studio'));

console.log('\n【3】收尾（主实例，SSE 还开着的时候 dispose 不能挂）');
const hangingSse = await fetch(main.base + '/ipc/events');
await hangingSse.body.getReader().read();
const disposeMain = await Promise.race([
  main.app.dispose().then(() => 'done'),
  sleep(15000).then(() => 'timeout'),
]);
check('主实例 dispose 完成', disposeMain === 'done', disposeMain);
await hangingSse.body.cancel().catch(() => {});
await rm(mainPkg.root, { recursive: true, force: true });

/* ───────────────────────── 2. 降级：desktopMode false ───────────────────────── */
console.log('\n【4】降级：关掉桌面模式就是网页版');
const webPort = await freePort();
const web = await tempPackage({ desktopMode: false, studioPort: webPort });
const webApp = await boot(web.root, await freePort(), web.studioHome);
const webStudio = await webApp.waitReady();
check('网页模式 Studio 起来', Boolean(webStudio));
check('desktop.on = false', webStudio?.desktop?.on === false);
if (firstProject) {
  const wp = await webApp.call('/projects/' + firstProject.id);
  check('网页模式编辑器也同源伺服（不带 key）', wp.status === 200 && !wp.text.includes('/open?key='), `HTTP ${wp.status}`);
}
const noBridge = await webApp.call('/bridge-web.js');
check('网页模式不伺服**我们的**桥（返回的是 Studio 编辑器）', !noBridge.text.includes('openfilmNative'), `HTTP ${noBridge.status}`);
await webApp.app.dispose();
check('网页模式 dispose 后端口空了', portFree(webPort));
await rm(web.root, { recursive: true, force: true });

/* ───────────────────────── 3. 桌面版没构建：要报错，不是白屏 ───────────────────────── */
console.log('\n【5】桌面版页面没构建时');
const brokenPort = await freePort();
const broken = await tempPackage({ desktopMode: true, shellDist: '/nonexistent-of-shell', studioPort: brokenPort });
const brokenApp = await boot(broken.root, await freePort(), broken.studioHome);
await brokenApp.waitReady();
let brokenStudio = null;
for (let i = 0; i < 100; i++) {
  brokenStudio = await brokenApp.json('/miniapp/studio');
  if (brokenStudio.data?.desktop?.ready || brokenStudio.data?.desktop?.error) break;
  await sleep(300);
}
check('desktop.ready = false', brokenStudio.data?.desktop?.ready === false);
check('报错说清是没构建', String(brokenStudio.data?.desktop?.error || '').includes('build:shell'),
  String(brokenStudio.data?.desktop?.error || '(no error)'),
  String(brokenStudio.data?.desktop?.error || '').slice(0, 90));
await brokenApp.app.dispose();
await rm(broken.root, { recursive: true, force: true });

/* ───────────────────────── 4. 生命周期：幂等 + 并发 + 收尾 ───────────────────────── */
console.log('\n【6】两个面板同时开：只许起一个 Studio');
const lifeStudioPort = await freePort();
const life = await tempPackage({ desktopMode: false, studioPort: lifeStudioPort });
const a = await boot(life.root, await freePort(), life.studioHome);
const b = await boot(life.root, await freePort(), life.studioHome);
const [sa, sb] = await Promise.all([a.waitReady(), b.waitReady()]);
check('两个都起来了', Boolean(sa && sb), `A=${sa?.mode} B=${sb?.mode}`);
check('一个 spawned 一个 reused', new Set([sa?.mode, sb?.mode]).size === 2 || sa?.mode === 'reused' && sb?.mode === 'reused',
  `A=${sa?.mode} B=${sb?.mode}`);
if (hasLsof) {
  const listeners = execFileSync('bash', ['-c', `lsof -nP -iTCP:${new URL(sa.origin).port} -sTCP:LISTEN -t | sort -u | wc -l`], { encoding: 'utf8' }).trim();
  check('只起一个 Studio 进程', listeners === '1', `${listeners} 个`);
} else {
  console.log('  ↷ 没有 lsof，进程数检查跳过');
}

const aSse = await fetch(a.base + '/ipc/events');
await aSse.body.getReader().read();
const disposeA = await Promise.race([a.app.dispose().then(() => 'done'), sleep(15000).then(() => 'timeout')]);
check('A dispose（SSE 开着）不挂', disposeA === 'done', disposeA);
await aSse.body.cancel().catch(() => {});
const disposeB = await Promise.race([b.app.dispose().then(() => 'done'), sleep(15000).then(() => 'timeout')]);
check('B dispose 完成', disposeB === 'done', disposeB);
check('两份都收了之后没有 Studio 留下', portFree(lifeStudioPort));
/* 如果这次复用的是上一轮留下的 Studio（reused），顺手收掉它，免得测试越积越多。
   只收高位端口的测试 Studio，4823 那个真面板的一律不碰。 */
for (const origin of [sa?.origin, sb?.origin]) {
  if (!origin) continue;
  const port = Number(new URL(origin).port);
  if (port === 4823) continue;
  const run = JSON.parse(await readFile(join(life.studioHome, 'run.json'), 'utf8').catch(() => 'null'));
  if (run?.key) {
    await fetch(origin + '/api/quit', { method: 'POST', headers: { 'x-studio-key': run.key, 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
  }
}
await rm(life.root, { recursive: true, force: true });

console.log('\n────────────────────────');
if (failures.length) {
  console.log(`✘ ${failures.length} 项没过：`);
  for (const f of failures) console.log('  · ' + f);
  process.exitCode = 1;
} else {
  console.log('✔ 全部通过');
}
process.exit(process.exitCode ?? 0);
