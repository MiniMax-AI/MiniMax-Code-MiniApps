// H3-Image-Executor Node 运行时：页面路由 + 会话状态机 + H3-Image 调用 + Agent 节点调度。
import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as h3 from './lib/h3.mjs';
import { createAgentRunner } from './lib/agent.mjs';
import { runSession, runIncrementalEdit, DEFAULTS } from './lib/workflow.mjs';
import { detail, text } from './lib/detail.mjs';
import { buildShareHtml } from './lib/share.mjs';
import { createRefCache } from './lib/refcache.mjs';
import { readClipboard, classifyClipboard, disposeClipboard, writeClipboard } from './lib/clipboard.mjs';
import { publishHtml } from './lib/publish.mjs';

// 文件名 / 会话 ID 只认这种形状。「.」和「..」本身也匹配字符集，必须单独排除：
// 它们拼进 join() 会指向上一级目录。
const SAFE_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

// 按实际字节定 content-type，不按扩展名：接口有时回 JPEG，而落盘文件名统一是 .png。
// 浏览器对图片会自己嗅探，所以标错也能显示——但下载下来用错扩展名打开就会出问题，
// 而且把 JPEG 标成 image/png 会让任何按 content-type 走的下游（分享页、curl -OJ）拿到错的类型。
function imageContentType(buffer) {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG') return 'image/png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length > 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}
const MAX_BODY = 24 * 1024 * 1024;

export async function start(context) {
  const root = context.pluginRoot;
  const clientDir = join(root, 'miniapp/client');
  const assets = {
    '/dashboard': { body: await readFile(join(clientDir, 'index.html')), type: 'text/html; charset=utf-8' },
    '/app.js': { body: await readFile(join(clientDir, 'app.js')), type: 'text/javascript; charset=utf-8' },
    '/styles.css': { body: await readFile(join(clientDir, 'styles.css')), type: 'text/css; charset=utf-8' },
    '/blocks.js': { body: await readFile(join(clientDir, 'blocks.js')), type: 'text/javascript; charset=utf-8' },
  };

  const dataRoot = join(context.dataDir, 'sessions');
  await mkdir(dataRoot, { recursive: true });
  // 接口凭据存在 Host 给的私有数据目录里，绝不进包体、也不回传给页面。
  const settingsFile = join(context.dataDir, 'settings.json');
  await loadSettings();

  async function loadSettings() {
    try {
      const raw = await readFile(settingsFile, 'utf8');
      const parsed = JSON.parse(raw);
      h3.setStoredSettings({ apiKey: parsed.apiKey, baseUrl: parsed.baseUrl });
    } catch {
      /* 没配过就是没配过，不是错误 */
    }
  }

  // 原子写：先写同目录临时文件再 rename。进程随时可能被 Host 停掉，
  // 写一半的 settings.json 会让用户下次启动发现 Key 莫名其妙没了。
  async function saveSettings(value) {
    const tmp = settingsFile + '.tmp';
    await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(tmp, settingsFile);
  }
  // 参考图下载缓存跨会话共享：同一个实体在不同会话里会搜到同一批地址，重复下载既慢又浪费带宽。
  const cacheRoot = join(context.dataDir, 'refcache');
  const refCache = createRefCache(cacheRoot);
  const sessions = new Map();
  // 运行时重启（publish / 崩溃）会清空内存里的会话，页面就变成"什么都没跑过"。
  // 所以要把磁盘上的 session.json 读回来，列表、看图、追问都还能用。
  // 恢复放在后台跑，不等它完成就开始监听：start() 只装路由、开始监听（docs/runtime.md），
  // 会话多、session.json 大的时候，恢复要好几秒，等它会拖慢就绪甚至超时。
  // 所有 /api/ 请求先等恢复完成，页面看到的列表总是完整的。
  const restoring = restoreSessions().catch((error) => {
    context.logger.error('h3.sessions.restore_failed', {
      message: String(error && error.message ? error.message : error),
    });
  });

  const agent = createAgentRunner(context, {
    onProgress(session, stage, text, extra) {
      push(session, stage, text, extra);
    },
    onPermission(session, record) {
      agent.trackPermission(record);
      push(session, 'permission', '需要你确认工具调用：' + record.toolName, { level: 'warn' });
    },
    onQuestion(session, pending) {
      push(session, 'question', 'Agent 需要你补充信息，请在下面回答');
    },
  });

  const MAX_EVENTS = 400;

  // 每条事件都带：绝对时间、相对会话起点的已运行时间、自身耗时、可展开的结构化详情。
  // 页面上的"执行过程"就是这份事件流，所以内容必须在这里就组装好。
  function push(session, stage, text, extra) {
    const now = Date.now();
    session.eventSeq = (session.eventSeq || 0) + 1;
    const event = {
      seq: session.eventSeq,
      t: now,
      elapsedMs: now - session.createdAt,
      stage,
      text,
      level: (extra && extra.level) || 'info',
      durMs: (extra && extra.durMs) || 0,
      detail: (extra && extra.detail) || null,
      // 生图请求号要跟着事件一起走：出图后要拿它去对账、报障、查限流，
      // 只藏在 detail 里等于没有——用户得先展开三层才看得到。
      requestId: (extra && extra.requestId) || '',
    };
    session.events.push(event);
    if (session.events.length > MAX_EVENTS) session.events.splice(0, session.events.length - MAX_EVENTS);
    session.updatedAt = now;
    context.logger.info('h3.session.event', { sessionId: session.id, stage });
    void persist(session);
  }

  // 从磁盘把历史会话读回内存。session.json 可能在进程被强杀时写了一半，
  // 所以用宽松解析：取第一个完整的 JSON 对象，后面的残字节丢掉。
  async function restoreSessions() {
    let entries = [];
    try {
      entries = await readdir(dataRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !SAFE_NAME.test(entry.name)) continue;
      const dir = join(dataRoot, entry.name);
      let raw = '';
      try {
        raw = await readFile(join(dir, 'session.json'), 'utf8');
      } catch {
        continue;
      }
      const data = parseLooseJson(raw);
      if (!data || !data.id || sessions.has(data.id)) continue;
      const restored = await rehydrate(data, dir);
      if (restored) sessions.set(restored.id, restored);
    }
    if (sessions.size) context.logger.info('h3.sessions.restored', { count: sessions.size });
  }

  // 阶段耗时：某个阶段第一条事件到最后一条事件的跨度。
  function stageStats(events) {
    const map = new Map();
    for (const event of events) {
      const hit = map.get(event.stage) || { stage: event.stage, count: 0, startAt: event.t, endAt: event.t, spanMs: 0 };
      hit.count += 1;
      hit.endAt = event.t;
      hit.spanMs = hit.endAt - hit.startAt;
      map.set(event.stage, hit);
    }
    return Array.from(map.values());
  }

  // ---------------------------------------------------------------- 对话轮次
  //
  // 页面要长得像正常聊天窗口：一句用户消息 → 一段过程 → 一次交付，再来一句追问就是新一轮。
  // 所以这里按"轮"记账：一轮 = { 用户这句话, 从哪条事件开始, 这一轮交付了什么 }。
  // 事件不需要额外打标：下一轮的 startSeq 就是上一轮的右边界。

  function startTurn(session, instruction) {
    const turn = {
      instruction,
      at: Date.now(),
      startSeq: session.eventSeq || 0,
      finishedAt: 0,
      delivery: null,
      // 成本是会话级累加的，扣掉这一轮开始时的基数才是"这一轮花了多少"。
      baseCost: {
        ditImages: session.cost.ditImages,
        ditMs: session.cost.ditMs,
        agentCalls: session.cost.agentCalls,
        agentMs: session.cost.agentMs,
      },
    };
    session.turns.push(turn);
    return turn;
  }

  function finishTurn(session) {
    const turn = session.turns[session.turns.length - 1];
    if (!turn) return;
    if (!turn.finishedAt) turn.finishedAt = Date.now();
    turn.endCost = pickCost(session.cost);
  }

  const ZERO_COST = { ditImages: 0, ditMs: 0, agentCalls: 0, agentMs: 0 };

  function pickCost(cost) {
    if (!cost) return null;
    return {
      ditImages: Number(cost.ditImages) || 0,
      ditMs: Number(cost.ditMs) || 0,
      agentCalls: Number(cost.agentCalls) || 0,
      agentMs: Number(cost.agentMs) || 0,
    };
  }

  function turnView(session, index, turns, full) {
    const turn = turns[index];
    const next = turns[index + 1];
    const from = turn.startSeq || 0;
    const to = next ? next.startSeq || 0 : Infinity;
    const events = session.events.filter((event) => event.seq > from && event.seq <= to);
    const last = index === turns.length - 1;
    const running = Boolean(last && session.busy);
    // 落盘/强杀之后 finishedAt 可能没写上，退回这一轮最后一条事件的时间。
    const endAt = turn.finishedAt || (events.length ? events[events.length - 1].t : turn.at);
    // 这一轮自己花了多少 = 这一轮结束时的累计 - 开始时的累计。
    // 不能拿会话总成本减：那样除了最后一轮，其他轮都会显示成"整个会话花了多少"。
    const base = pickCost(turn.baseCost) || ZERO_COST;
    const end =
      pickCost(turn.delivery && turn.delivery.cost) ||
      pickCost(turn.endCost) ||
      (last ? pickCost(session.cost) : null) ||
      ZERO_COST;
    const view = {
      index,
      instruction: turn.instruction || '',
      at: turn.at,
      // 下面几个是记账用的原始字段：rehydrate 全靠它们把事件重新切回各轮，不能省。
      startSeq: from,
      finishedAt: turn.finishedAt || 0,
      baseCost: pickCost(turn.baseCost),
      endCost: pickCost(turn.endCost),
      running,
      // 中间轮次的状态只能自己推：交付过就是 delivered，没交付就说明那一轮挂了。
      status: running ? 'running' : last ? session.status : turn.delivery ? 'delivered' : 'failed',
      elapsedMs: Math.max(0, (running ? Date.now() : endAt) - turn.at),
      cost: {
        ditImages: Math.max(0, end.ditImages - base.ditImages),
        ditMs: Math.max(0, end.ditMs - base.ditMs),
        agentCalls: Math.max(0, end.agentCalls - base.agentCalls),
        agentMs: Math.max(0, end.agentMs - base.agentMs),
      },
      delivery: turn.delivery
        ? {
            version: turn.delivery.version,
            items: turn.delivery.items,
            questions: turn.delivery.questions,
            crossCheck: turn.delivery.crossCheck || null,
            cost: pickCost(turn.delivery.cost),
          }
        : null,
    };
    // full 是落盘和分享页用的：事件已经在顶层 events 里，turns 里再存一份会让 session.json 翻倍。
    if (!full) {
      view.events = events;
      view.stageStats = stageStats(events);
    }
    return view;
  }

  function turnViews(session, full) {
    const turns = session.turns || [];
    return turns.map((turn, index) => turnView(session, index, turns, full));
  }

  // 事件是并发推入的，writeFile 不原子，直接并发写会把两个 JSON 拼在一起。
  // 按会话串行排队写，留档失败不影响主流程。
  function persist(session) {
    session.persistChain = (session.persistChain || Promise.resolve()).then(async () => {
      const target = join(session.dirs.root, 'session.json');
      const tmp = target + '.tmp';
      try {
        // writeFile 不是原子的：进程在写到一半时被杀（publish / 崩溃），
        // session.json 就会缺一截或多一截，重启后整个会话读不回来。
        // 先写临时文件再 rename——同一文件系统上 rename 是原子的。
        await writeFile(tmp, JSON.stringify(snapshot(session, true), null, 2));
        await rename(tmp, target);
      } catch {
        /* 留档失败不影响主流程 */
      }
    });
    return session.persistChain;
  }

  // 出图前的关键确认：工作流在闸门这里挂起，等页面回答，或者用户直接选"按默认方案"。
  const gates = new Map();

  function askUser(session, questions) {
    return new Promise((resolve) => {
      session.gate = { id: randomUUID(), questions, at: Date.now() };
      gates.set(session.id, resolve);
      void persist(session);
    });
  }

  function resolveGate(session, answers) {
    const resolve = gates.get(session.id);
    gates.delete(session.id);
    session.gate = null;
    if (resolve) resolve(answers);
    return Boolean(resolve);
  }

  // 重跑：拿原会话的需求和参考图开一个新会话。参考图在磁盘上，转成 dataUrl 走同一条创建路径，
  // 这样重跑出来的会话和手输需求创建的完全一致，不会多出一种特殊结构。
  async function rerunSession(source) {
    const refs = [];
    for (const ref of (source.refs || []).slice(0, 8)) {
      try {
        const buffer = await readFile(ref.path);
        const ext = String(ref.file || '').split('.').pop().toLowerCase() || 'png';
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        refs.push({
          name: ref.note || ref.id,
          dataUrl: 'data:image/' + mime + ';base64,' + buffer.toString('base64'),
        });
      } catch (error) {
        // 参考图读不到就跳过：重跑本身不该因为少一张图而失败。
      }
    }
    return createSession({ instruction: source.instruction, refs });
  }

  // 删除会话：先把整个目录挪进 .trash 再从内存摘掉，不直接 rm。
  // 误删一次就没法恢复的代价太大，挪走之后用户还能自己去磁盘找回来。
  async function deleteSession(id) {
    const session = sessions.get(id);
    if (!session) return { error: 'no_session' };
    // 正在跑的会话不允许删：agent 还在往这个目录里写，删了会写出一堆无主文件。
    // status 也要看：重启后 busy 会被恢复成 false，只看它会漏掉「看起来在跑」的那种。
    if (session.busy || session.taskActive || session.status === 'running') return { error: 'busy' };
    sessions.delete(id);
    try {
      const trash = join(dataRoot, '.trash');
      await mkdir(trash, { recursive: true });
      await rename(session.dirs.root, join(trash, id + '-' + Date.now()));
    } catch (error) {
      context.logger.error('h3.session.trash_failed', {
        message: String(error && error.message ? error.message : error),
      });
    }
    return { ok: true };
  }

  // 生成分享页并落盘到会话目录。发布成公开网址是 Agent 侧的能力，这里只负责把自包含 HTML 写好，
  // 让 Agent 拿到就能发。交付完成后自动跑一次，链接链路不用等用户点「分享」才开始。
  async function saveSharePage(session, options) {
    const result = await buildShareHtml({
      snapshot: snapshot(session, true),
      dirs: { ...session.dirs, cache: cacheRoot },
      dataDir: context.dataDir,
      clientDir,
      options,
    });
    const dir = join(session.dirs.root, 'share');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'index.html');
    // 原子写：交付后的后台构建和「发布」触发的构建可能前后脚写同一个文件，
    // 发布轮次拷走的必须是一份完整的页面。
    const tmp = file + '.' + randomUUID().slice(0, 8) + '.tmp';
    await writeFile(tmp, result.html);
    await rename(tmp, file);
    return { saved: true, file, bytes: result.bytes, images: result.images, large: result.large, url: session.shareUrl || null };
  }

  // 发布分享页成公开链接。
  //
  // 为什么是异步：这一步要起一个 Agent turn（起会话 → 跑模型 → 拷文件 → 调 website_deploy →
  // 上传 3MB），量级在分钟级，HTTP 请求挂不住。所以这里只点火，页面轮询 shareState /
  // shareUrl / shareError 拿结果——按钮变「发布中」，好了自动把链接写进剪贴板。
  //
  // 重复点击保护：shareState 已经是 publishing 就直接拒，不然会并行跑两个 turn，
  // 拿到两个不同的公开地址，用户不知道该分享哪个。
  function startPublish(session) {
    if (session.shareState === 'publishing') return { error: 'share_publishing' };
    if (!context.agent || typeof context.agent.run !== 'function') return { error: 'agent_unavailable' };
    session.shareState = 'publishing';
    session.shareError = null;
    push(session, 'share', '开始发布分享页，正在起一个 Agent 会话');
    void persist(session);

    void (async () => {
      let file = null;
      try {
        // 每次发布都重新生成：会话可能在上次落盘之后又跑过追问，页面得是最新的。
        const saved = await saveSharePage(session);
        file = saved.file;
        push(session, 'share', '分享页已就绪（' + Math.round(saved.bytes / 1024) + ' KB，' + (saved.large || 0) + ' 张交付图带大图），开始部署');
      } catch (error) {
        session.shareState = 'failed';
        session.shareError = 'share_failed：' + String(error && error.message ? error.message : error);
        push(session, 'share', '分享页生成失败：' + session.shareError, { level: 'warn' });
        void persist(session);
        return;
      }
      const result = await publishHtml({
        context,
        htmlPath: file,
        projectName: 'H3-Image 分享页',
        onProgress: (message, extra) => push(session, 'share', message, extra),
        // website_deploy 的权限请求和规划 / 评审节点的一样，放进 session.permissions，
        // 页面画成确认卡片，用户点了才经 /api/session/permission 回给 Host。
        onPermission: (record) => {
          const entry = { ...record, source: 'publish' };
          session.permissions = session.permissions || [];
          session.permissions.push(entry);
          agent.trackPermission(entry);
          push(session, 'permission', '需要你确认：把分享页发布成公开链接（website_deploy）', { level: 'warn' });
        },
      });
      // 发布这一轮已经结束（成功、失败或超时），它留下的确认卡片不能再挂在页面上。
      session.permissions = (session.permissions || []).filter((item) => item.source !== 'publish');
      if (result.ok) {
        session.shareUrl = result.url;
        session.shareState = 'done';
        session.shareError = null;
        session.sharePublishedAt = Date.now();
        // 链接必须由服务端写进剪贴板：页面侧两条路都被浏览器安全模型堵死——
        // navigator.clipboard.writeText 和 execCommand('copy') 都要求文档聚焦，而这一刻
        // 是 setInterval 回调，用户在这 1–3 分钟里早就切走了（实测 document.hasFocus() 为 false）。
        const clip = await writeClipboard(result.url);
        session.shareClip = clip.ok ? 'ok' : String(clip.error || clip.reason || 'failed');
        push(session, 'share', '发布完成：' + result.url, { durMs: result.ms });
        push(
          session,
          'share',
          clip.ok ? '链接已放进剪贴板' : '链接没能放进剪贴板（' + session.shareClip + '），请手动复制',
          { level: clip.ok ? 'info' : 'warn' },
        );
      } else {
        session.shareState = 'failed';
        session.shareError = result.error || 'publish_failed';
        push(session, 'share', '发布失败：' + session.shareError, { level: 'warn', durMs: result.ms });
      }
      void persist(session);
    })();

    return { ok: true, state: 'publishing' };
  }

  function deps(session) {    return {
      agent,
      askUser: (target, questions) => askUser(target, questions),
      // 参考图检索要直连 Connector 工具，只有运行时 context 拿得到，子会话里的 agent 拿不到。
      context,
      config: session.config,
      dirs: session.dirs,
      cache: refCache,
      // 多图并行上限：Mini App 运行时的 agentConcurrency 默认 4，每张图同一时刻最多 1 个 agent 节点，留一半余量。
      concurrency: DEFAULTS.imageConcurrency,
      emit: (target, stage, text, extra) => push(target, stage, text, extra),
      ensureDir: (dir) => mkdir(dir, { recursive: true }),
      // 交付完就把分享页备好：用户点「分享」时链接可能已经在手，点一下就是复制。
      // 不等它完成：分享页要给每张交付图算一份大图，4K 原图解码一张就要一两秒，
      // 等它会让「已交付」晚好几秒才出现。
      afterDeliver: (target) => {
        void saveSharePage(target).catch((error) => {
          context.logger.error('h3.share.autosave_failed', {
            message: String(error && error.message ? error.message : error),
          });
        });
      },
    };
  }

  async function createSession(payload) {
    const id = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + randomUUID().slice(0, 6);
    const dir = join(dataRoot, id);
    const dirs = sessionDirs(dir);
    for (const key of Object.keys(dirs)) await mkdir(dirs[key], { recursive: true });

    const refs = [];
    const incoming = Array.isArray(payload.refs) ? payload.refs.slice(0, 8) : [];
    for (let index = 0; index < incoming.length; index += 1) {
      const item = incoming[index];
      const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(String(item.dataUrl || ''));
      if (!match) continue;
      const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
      const refId = 'R' + (index + 1);
      const file = refId + '.' + ext;
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 20 * 1024 * 1024) continue;
      await writeFile(join(dirs.refs, file), buffer);
      refs.push({ id: refId, file, path: join(dirs.refs, file), note: String(item.name || '').slice(0, 60), origin: 'user' });
    }

    const config = await h3.resolveConfig(true);
    const session = {
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      instruction: String(payload.instruction || '').slice(0, 4000),
      refs,
      config,
      dirs,
      status: 'running',
      route: 'full',
      think: [],
      plan: null,
      images: [],
      events: [],
      eventSeq: 0,
      finishedAt: 0,
      archived: false,
      questions: [],
      assumptions: [],
      blockers: [],
      answered: [],
      gate: null,
      permissions: [],
      pendingQuestion: null,
      turns: [],
      delivery: null,
      deliveryVersion: 0,
      // 角色基准图：多图时先出的外观基准，只做内部参考，不进交付。
      characterRefs: [],
      // 跨图一致性评审结论，所有图出完之后才写得出来。
      crossCheck: null,
      fatal: '',
      busy: true,
      cost: { ditImages: 0, ditMs: 0, agentCalls: 0, agentMs: 0, usage: null },
    };
    sessions.set(id, session);
    startTurn(session, session.instruction);
    push(session, 'input', '收到需求：' + session.instruction + (refs.length ? '（附 ' + refs.length + ' 张参考图）' : ''));

    // taskActive 一直到后台任务真正结束才放下。「停止」会立刻把 busy 置回 false，
    // 但被中止的任务还要一点时间收尾；这期间不许追问、不许删除，否则同一个会话上会跑两个任务。
    session.taskActive = true;
    session.task = (async () => {
      try {
        await runSession(session, deps(session));
      } catch (error) {
        // 用户点了停止：被中止的回合抛出来的错误不算失败，会话保持「已取消」。
        if (session.status === 'cancelled') return;
        session.fatal = String(error && error.message ? error.message : error);
        session.status = 'failed';
        push(session, 'error', '流程中断：' + session.fatal, { level: 'error' });
      } finally {
        session.taskActive = false;
        session.busy = false;
        session.finishedAt = Date.now();
        finishTurn(session);
        await persist(session);
      }
    })();
    return session;
  }

  async function followUp(session, instruction) {
    if (session.busy || session.taskActive) throw new Error('busy');
    session.busy = true;
    session.status = 'running';
    session.finishedAt = 0;
    if (!session.config) session.config = await h3.resolveConfig(true);
    // 这一轮的起点必须记在"收到追问"这条事件之前，它自己属于新一轮。
    startTurn(session, instruction);
    push(session, 'edit', '收到追问：' + instruction, {
      detail: detail('增量编辑请求', [text('用户这次的话', instruction)]),
    });
    session.taskActive = true;
    session.task = (async () => {
      try {
        await runIncrementalEdit(session, instruction, deps(session));
      } catch (error) {
        if (session.status === 'cancelled') return;
        session.fatal = String(error && error.message ? error.message : error);
        session.status = 'failed';
        push(session, 'error', '增量编辑中断：' + session.fatal, { level: 'error' });
      } finally {
        session.taskActive = false;
        session.busy = false;
        session.finishedAt = Date.now();
        finishTurn(session);
        await persist(session);
      }
    })();
  }

  function snapshot(session, full) {
    const now = Date.now();
    const finishedAt = session.finishedAt || 0;
    return {
      id: session.id,
      status: session.status,
      busy: session.busy,
      archived: Boolean(session.archived),
      route: session.route,
      instruction: session.instruction,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      timing: {
        startedAt: session.createdAt,
        now,
        running: Boolean(session.busy),
        finishedAt,
        elapsedMs: (session.busy ? now : finishedAt || now) - session.createdAt,
      },
      stageStats: stageStats(session.events),
      fatal: session.fatal,
      // 规划原文要落盘：排查「检索了什么、refs 怎么写的」只能靠它，
      // 从事件 detail 里反推非常费劲。
      plan: session.plan || null,
      think: session.think,
      questions: session.questions,
      assumptions: session.assumptions,
      answered: session.answered,
      gate: session.gate,
      permissions: session.permissions,
      pendingQuestion: session.pendingQuestion,
      // origin 决定这张图算"你给的"还是"系统搜的"：用户气泡只能放前者，搜到的属于执行轨迹。
      refs: session.refs.map((ref) => ({
        id: ref.id,
        file: 'refs/' + ref.file,
        note: ref.note,
        origin: ref.origin || (ref.source ? 'search' : 'user'),
      })),
      // 角色基准图要跟着会话活过重启：跨图评审靠它判断"本组本该一致"，
      // 前端也要靠它说明每张图的外观基准是谁。path 是绝对路径，不能带出去。
      characterRefs: (session.characterRefs || []).map((ref) => ({
        id: ref.id,
        file: 'refs/' + ref.file,
        note: ref.note,
        images: ref.images || [],
      })),
      // 跨图结论同样要落盘。sheet 是本地绝对路径，只留结论。
      crossCheck: session.crossCheck
        ? {
            consistent: session.crossCheck.consistent,
            summary: session.crossCheck.summary,
            issues: session.crossCheck.issues || [],
            checkedAt: session.crossCheck.checkedAt || 0,
          }
        : null,
      // 页面按轮渲染，事件已经切进 turns 里；顶层 events 只在落盘和分享页（full）时给全量，
      // 否则每 1.5s 的轮询要把同一批事件发两遍。
      events: full ? session.events : [],
      turns: turnViews(session, full),
      // 分享页发布成公开链接后回填的网址；页面据此显示「公开链接」。
      shareUrl: session.shareUrl || null,
      // 发布是异步的（一次 Agent turn，分钟级），页面要靠这三个字段决定按钮长什么样：
      // publishing 时变「发布中」，failed 时把原因摊开，done 时把链接写进剪贴板。
      shareState: session.shareState || 'idle',
      shareError: session.shareError || null,
      sharePublishedAt: session.sharePublishedAt || 0,
      // 剪贴板有没有写成功。页面侧自己写需要文档聚焦，服务端写不需要；
      // 页面要靠这个字段决定是直接报「已放进剪贴板」还是退回自己试一次。
      shareClip: session.shareClip || null,
      cost: session.cost,
      delivery: session.delivery
        ? {
            version: session.delivery.version,
            items: session.delivery.items,
            questions: session.delivery.questions,
            crossCheck: session.delivery.crossCheck || null,
          }
        : null,
      images: session.images.map((image) => ({
        id: image.id,
        title: image.title,
        status: image.status,
        blocked: image.blocked,
        blockReason: image.blockReason,
        // 失败原因必须落盘：交付页要显示「为什么没画出来」，
        // 重启后也要还在，否则已失败的会话会退化成一句「未生成」。
        failReason: image.failReason || '',
        contentPolicy: Boolean(image.contentPolicy),
        spec: {
          // 交付文件名靠它拼（H3-Image_<slug>_<时间戳>）。不落盘的话，
          // 重启后增量编辑再交付会退回用图号命名，同一张图前后两个名字。
          slug: image.spec.slug || '',
          entry: image.spec.entry,
          prompt: image.spec.prompt,
          slots: image.spec.slots || null,
          missingSlots: image.spec.missingSlots || [],
          aspectRatio: image.spec.aspectRatio,
          area: image.spec.area,
          refs: image.spec.refs,
          // 必须落盘：rehydrate 全靠它把角色基准图重新绑回图上。
          // 丢了它，重启后追问时 executeAction 就不会再强制带上角色图，主体会漂回各画各的。
          characterRefs: image.spec.characterRefs || [],
          textLayers: image.spec.textLayers,
          checklist: image.spec.checklist,
        },
        chosenReason: image.chosenReason || '',
        chosenId: image.chosen ? image.chosen.id : null,
        // 下一轮候选从哪个轮号继续编号。不存它，重启后增量编辑会从 r1 重新编，
        // 把上一轮已经交付的同名文件覆盖掉。
        roundBase: image.roundBase || 0,
        rounds: image.rounds.map((round) => ({
          index: round.index,
          action: round.action,
          error: round.error || '',
          verdict: round.verdict || null,
          candidates: (round.candidates || []).map((candidate) => ({
            id: candidate.id,
            size: candidate.size,
            file: candidate.file,
            previewFile: candidate.previewFile || null,
            sheetFile: candidate.sheet ? candidate.sheet.split('/').pop() : null,
            requestId: candidate.requestId,
            actionType: candidate.actionType,
            parentId: candidate.parentId,
            prompt: candidate.actionPrompt || '',
            revisedPrompt: candidate.revisedPrompt,
            program: candidate.program
              ? {
                  width: candidate.program.width,
                  height: candidate.program.height,
                  drift: candidate.program.drift,
                  sharpness: candidate.program.sharpness,
                  redCast: Boolean(candidate.program.redCast),
                  stats: candidate.program.stats,
                }
              : null,
            checks: candidate.checks || [],
            verdict: candidate.verdict || null,
          })),
        })),
      })),
    };
  }

  async function serveFile(url, response) {
    const kind = url.searchParams.get('kind') || 'preview';
    const name = url.searchParams.get('name') || '';
    const sessionId = url.searchParams.get('session') || '';
    if (!SAFE_NAME.test(name)) return json(response, 400, { error: 'bad_name' });
    // 缓存图按内容寻址、跨会话共享，所以不查会话表；文件名是地址的哈希，不含任何可读信息。
    if (kind === 'cache') {
      try {
        const body = await readFile(join(cacheRoot, name));
        response.writeHead(200, {
          'content-type': imageContentType(body),
          'cache-control': 'public, max-age=86400',
        });
        response.end(body);
      } catch {
        json(response, 404, { error: 'not_found' });
      }
      return;
    }
    if (!SAFE_NAME.test(sessionId)) return json(response, 400, { error: 'bad_name' });
    const session = sessions.get(sessionId);
    if (!session) return json(response, 404, { error: 'no_session' });
    let base = session.dirs.previews;
    if (kind === 'image') base = session.dirs.images;
    else if (kind === 'refs') base = session.dirs.refs;
    else if (kind === 'sheets') base = session.dirs.sheets;
    else if (kind === 'deliver') {
      const sub = url.searchParams.get('sub') || '';
      if (!SAFE_NAME.test(sub)) return json(response, 400, { error: 'bad_name' });
      base = join(session.dirs.deliver, sub);
    }
    try {
      const body = await readFile(join(base, name));
      response.writeHead(200, { 'content-type': imageContentType(body), 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      json(response, 404, { error: 'not_found' });
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      context.logger.error('h3.request.failed', { message: String(error && error.message ? error.message : error) });
      json(response, 500, { error: 'internal_error' });
    });
  });

  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;

    if (request.method === 'GET' && assets[path]) {
      response.writeHead(200, { 'content-type': assets[path].type, 'cache-control': 'no-store' });
      response.end(assets[path].body);
      return;
    }
    if (request.method === 'GET' && path === '/') {
      response.writeHead(302, { location: '/dashboard' });
      response.end();
      return;
    }
    if (path.startsWith('/api/')) await restoring;
    if (request.method === 'GET' && path === '/api/config') {
      const config = await h3.resolveConfig(true);
      json(response, 200, {
        ...h3.configSummary(config),
        defaults: DEFAULTS,
        cache: await refCache.stats(),
        // 页面需要知道「现在用的是哪一份配置」才能给出正确的引导，
        // 但只能知道来源和掩码，永远拿不到 Key 本身。
        stored: Boolean(h3.getStoredSettings()),
        defaultBaseUrl: h3.DEFAULT_BASE_URL || '',
      });
      return;
    }
    // 保存 / 清除接口凭据。Key 只往里写，不往外读。
    if (request.method === 'POST' && path === '/api/config') {
      const body = await readJson(request).catch(() => ({}));
      if (body && body.clear) {
        await saveSettings({});
        h3.setStoredSettings(null);
        json(response, 200, { ok: true, cleared: true });
        return;
      }
      const apiKey = String((body && body.apiKey) || '').trim();
      const rawUrl = String((body && body.baseUrl) || '').trim();
      // 页面是不可信输入：Key 和地址都要先验一遍再落盘。
      if (!apiKey) return json(response, 400, { error: 'api_key_required' });
      if (/\s/.test(apiKey)) return json(response, 400, { error: 'api_key_has_space' });
      if (apiKey.length > 512) return json(response, 400, { error: 'api_key_too_long' });
      if (!rawUrl) return json(response, 400, { error: 'base_url_required' });
      if (!/^https:\/\//i.test(rawUrl)) return json(response, 400, { error: 'base_url_must_be_https' });
      // 先判「不完整」再交给 URL 解析：'https://' 会被 new URL() 抛成 invalid，
      // 提示成「不是合法的 URL」会让人以为格式错了，其实只是没打完。
      if (!/^[^/]/.test(rawUrl.slice('https://'.length))) {
        return json(response, 400, { error: 'base_url_incomplete' });
      }
      try {
        // eslint-disable-next-line no-new
        new URL(rawUrl);
      } catch {
        return json(response, 400, { error: 'base_url_invalid' });
      }
      // 落盘用用户原样输入（只削尾斜杠），不用 new URL() 的归一化结果：
      // 归一化会改大小写、补端口、改路径，接口地址的路径未必大小写不敏感。
      const baseUrl = rawUrl.replace(/\/+$/, '');
      await saveSettings({ apiKey, baseUrl });
      h3.setStoredSettings({ apiKey, baseUrl });
      const config = await h3.resolveConfig(true);
      json(response, 200, { ok: true, ...h3.configSummary(config), stored: true });
      return;
    }
    // 读系统剪贴板，只在用户点「剪贴板」按钮时调一次。
    // 页面自己读不到（deviceAccess 不含 clipboard），这是唯一通路。
    // 只把「像 Key」或「像接口地址」的内容回给页面，其余一律只回错误码。
    if (request.method === 'POST' && path === '/api/clipboard') {
      const clip = await readClipboard();
      if (!clip.ok) {
        const map = {
          unavailable: 'clipboard_unavailable',
          timeout: 'clipboard_timeout',
          too_large: 'clipboard_too_long',
        };
        return json(response, 400, { error: map[clip.reason] || 'clipboard_unavailable' });
      }
      const picked = classifyClipboard(clip.text);
      if (picked.error) return json(response, 400, { error: picked.error });
      json(response, 200, { ok: true, field: picked.field, value: picked.value });
      return;
    }
    if (request.method === 'GET' && path === '/api/file') {
      await serveFile(url, response);
      return;
    }
    // 分享页：把整条链路打包成一个自包含 HTML，图片降采样后内嵌，不泄露任何本地路径。
    if (request.method === 'GET' && path === '/api/session/share') {
      const session = sessions.get(url.searchParams.get('id') || '');
      if (!session) return json(response, 404, { error: 'no_session' });
      // 页面是不可信输入：边长不设上限的话，一个 edge=100000 就会把原图整张内嵌进分享页。
      const edge = Math.min(2048, Math.max(0, Math.floor(Number(url.searchParams.get('edge') || 0)) || 0));
      const sheets = url.searchParams.get('sheets');
      const options = {
        edge: edge > 0 ? edge : undefined,
        includeSheets: sheets === '0' ? false : undefined,
      };
      // save=1：把分享页落到会话目录下的 share/index.html，「发布公开链接」就从这个文件开始。
      if (url.searchParams.get('save') === '1') {
        try {
          return json(response, 200, await saveSharePage(session, options));
        } catch (error) {
          context.logger.error('h3.share.failed', { message: String(error && error.message ? error.message : error) });
          return json(response, 500, { error: 'share_failed' });
        }
      }
      let result;
      try {
        result = await buildShareHtml({
          snapshot: snapshot(session, true),
          dirs: { ...session.dirs, cache: cacheRoot },
          dataDir: context.dataDir,
          clientDir,
          options,
        });
      } catch (error) {
        context.logger.error('h3.share.failed', { message: String(error && error.message ? error.message : error) });
        return json(response, 500, { error: 'share_failed' });
      }
      const inline = url.searchParams.get('inline') === '1';
      const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
      if (!inline) headers['content-disposition'] = 'attachment; filename="h3-' + session.id + '.html"';
      response.writeHead(200, headers);
      response.end(result.html);
      return;
    }
    // 发布分享页成公开链接。页面和服务端自己都做不到部署（context 没有 drive / upload /
    // storage 能力，website_deploy 只下发给 Agent turn），所以这里起一个 turn 去调它。
    // 异步：202 立刻返回，页面轮询 shareState 拿结果。
    if (request.method === 'POST' && path === '/api/session/share/publish') {
      const body = await readJson(request).catch(() => ({}));
      const session = sessions.get((body && body.id) || '');
      if (!session) return json(response, 404, { error: 'no_session' });
      const started = startPublish(session);
      if (started.error) {
        return json(response, 409, { error: started.error, state: session.shareState || 'idle' });
      }
      return json(response, 202, { ok: true, state: 'publishing' });
    }
    // 把会话已有的公开链接写进系统剪贴板。
    // 页面侧写剪贴板要求文档聚焦，面板里经常没有（实测 document.hasFocus() 为 false），
    // 所以手动点「分享」复制已有链接时也要有服务端兜底。
    // 只写 session.shareUrl，绝不接受页面传来的文本——否则这个接口会变成一个通用的
    // 「往用户剪贴板里写任意内容」的后门。
    if (request.method === 'POST' && path === '/api/session/share/copy') {
      const body = await readJson(request).catch(() => ({}));
      const session = sessions.get((body && body.id) || '');
      if (!session) return json(response, 404, { error: 'no_session' });
      if (!session.shareUrl) return json(response, 409, { error: 'no_share_url' });
      const clip = await writeClipboard(session.shareUrl);
      if (!clip.ok) {
        return json(response, 500, { error: clip.error || clip.reason || 'clipboard_write_failed' });
      }
      return json(response, 200, { ok: true, url: session.shareUrl });
    }
    if (request.method === 'GET' && path === '/api/sessions') {
      const now = Date.now();
      const list = Array.from(sessions.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((session) => ({
          id: session.id,
          status: session.status,
          busy: session.busy,
          archived: Boolean(session.archived),
          instruction: session.instruction,
          createdAt: session.createdAt,
          elapsedMs: (session.busy ? now : session.finishedAt || session.updatedAt) - session.createdAt,
          images: session.images.length,
          delivered: session.delivery ? session.delivery.items.filter((item) => item.file).length : 0,
        }));
      json(response, 200, { sessions: list, now });
      return;
    }
    if (request.method === 'GET' && path === '/api/session') {
      const session = sessions.get(url.searchParams.get('id') || '');
      if (!session) return json(response, 404, { error: 'no_session' });
      json(response, 200, snapshot(session));
      return;
    }
    if (request.method === 'POST' && path === '/api/session') {
      const payload = await readJson(request);
      if (!payload || !String(payload.instruction || '').trim()) return json(response, 400, { error: 'empty_instruction' });
      const session = await createSession(payload);
      json(response, 200, { id: session.id });
      return;
    }
    if (request.method === 'POST' && path === '/api/session/followup') {
      const payload = await readJson(request);
      const session = sessions.get(String(payload.id || ''));
      if (!session) return json(response, 404, { error: 'no_session' });
      if (session.busy || session.taskActive) return json(response, 409, { error: 'busy' });
      const instruction = String(payload.instruction || '').trim();
      if (!instruction) return json(response, 400, { error: 'empty_instruction' });
      await followUp(session, instruction);
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === 'POST' && path === '/api/session/permission') {
      const payload = await readJson(request);
      const decision = payload.decision === 'allowOnce' ? 'allowOnce' : 'deny';
      try {
        await agent.decidePermission(String(payload.requestId || ''), decision);
      } catch (error) {
        return json(response, 200, { ok: false, code: String(error && error.code ? error.code : 'unknown') });
      }
      const session = sessions.get(String(payload.id || ''));
      if (session) {
        session.permissions = (session.permissions || []).filter((item) => item.requestId !== payload.requestId);
        push(session, 'permission', '已' + (decision === 'allowOnce' ? '允许' : '拒绝') + '工具调用');
      }
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === 'POST' && path === '/api/session/answer') {
      const payload = await readJson(request);
      const session = sessions.get(String(payload.id || ''));
      if (!session) return json(response, 404, { error: 'no_session' });
      const answers = Array.isArray(payload.answers) ? payload.answers : [];
      // Agent 的问卷带 requestId，出图前的闸门不带：按这个分流，问卷的回答才不会被当成闸门的回答。
      const requestId = String(payload.requestId || '');
      if (requestId) {
        if (!agent.answerQuestion(session, requestId, answers)) return json(response, 404, { error: 'no_question' });
        push(session, 'question', '已提交回答，继续');
        json(response, 200, { ok: true });
        return;
      }
      // 出图前的关键确认走工作流闸门，不经过 agent 问卷。
      if (session.gate) {
        const ok = resolveGate(session, answers);
        push(session, 'question', answers.length ? '已收到确认，继续出图' : '按默认方案继续出图');
        json(response, 200, { ok });
        return;
      }
      return json(response, 404, { error: 'no_question' });
    }
    if (request.method === 'POST' && path === '/api/session/cancel') {
      const payload = await readJson(request);
      const session = sessions.get(String(payload.id || ''));
      if (session) {
        // 先标成 cancelled 再放闸门、中止回合：工作流醒来时要能认出这是用户自己停的，
        // 不能按默认方案接着出图，也不能把被中止的回合当成失败。
        session.status = 'cancelled';
        resolveGate(session, []);
        agent.cancelSession(session);
        session.busy = false;
        push(session, 'cancel', '已取消当前流程', { level: 'warn' });
      }
      json(response, 200, { ok: true });
      return;
    }
    // 重跑：同一个需求再画一次，开的是新会话，原会话原封不动留着。
    if (request.method === 'POST' && path === '/api/session/rerun') {
      const payload = await readJson(request);
      const source = sessions.get(String(payload.id || ''));
      if (!source) return json(response, 404, { error: 'no_session' });
      if (!String(source.instruction || '').trim()) return json(response, 400, { error: 'empty_instruction' });
      const created = await rerunSession(source);
      json(response, 200, { id: created.id });
      return;
    }
    // 删除：目录挪进 .trash，可在磁盘找回；正在跑的会话直接拒绝。
    if (request.method === 'POST' && path === '/api/session/delete') {
      const payload = await readJson(request);
      const result = await deleteSession(String(payload.id || ''));
      if (result.error === 'no_session') return json(response, 404, { error: 'no_session' });
      if (result.error === 'busy') return json(response, 409, { error: 'busy' });
      json(response, 200, { ok: true });
      return;
    }
    json(response, 404, { error: 'not_found' });
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  context.logger.info('h3.runtime.listening', { port: context.listen.port });

  let disposal = null;
  const dispose = () => {
    if (disposal) return disposal;
    context.signal.removeEventListener('abort', onAbort);
    agent.cancelAll();
    // 剪贴板子进程是我们自己拉起来的，Host 只 SIGTERM 这个 Node 入口，不会管孙进程。
    disposeClipboard();
    disposal = new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    return disposal;
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

// session.json 正常是标准 JSON；被强杀时可能尾部多出残字节。
// 先按标准解析，失败再扫出第一个括号配平的对象。
function parseLooseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* 继续走宽松解析 */
  }
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function sessionDirs(dir) {
  return {
    root: dir,
    images: join(dir, 'images'),
    previews: join(dir, 'previews'),
    refs: join(dir, 'refs'),
    sheets: join(dir, 'sheets'),
    deliver: join(dir, 'deliver'),
  };
}

// 把落盘的 snapshot 还原成可继续操作的内存会话：看图、追问、再次交付都能用。
async function rehydrate(data, dir) {
  const dirs = sessionDirs(dir);
  // 老会话落盘时没记 origin。检索来的参考图 note 就是规划里写的 query，
  // 用它回填比"猜"可靠：用户上传的 note 是文件名，不会撞上 query。
  const searchNotes = new Set(
    (((data.plan || {}).ref_queries) || [])
      .map((item) => String((item && item.query) || '').trim())
      .filter(Boolean),
  );
  const refs = (data.refs || [])
    .map((ref) => {
      const file = String(ref.file || '').split('/').pop();
      const note = String(ref.note || '');
      return {
        id: ref.id,
        file,
        path: join(dirs.refs, file),
        note,
        source: ref.source || '',
        origin: ref.origin || (ref.source || searchNotes.has(note.trim()) ? 'search' : 'user'),
      };
    })
    .filter((ref) => ref.id && SAFE_NAME.test(ref.file));

  // 候选文件名里带着轮号，扫一遍盘才能知道这张图历史上最高排到第几轮。
  // 只看 image.rounds 不够：增量编辑会把 rounds 清成只剩最新一轮，
  // 早期轮次的候选不在里面，按它算出来的轮号会撞上磁盘上已有的文件。
  const diskRounds = new Map();
  try {
    for (const name of await readdir(dirs.images)) {
      // 扩展名不写死 .png：接口回 JPEG 时候选图落盘是 .jpg，写死会扫不到、轮号算错。
      const hit = /^([A-Za-z0-9]+)-r(\d+)-g\d+(?:-cc)?\.(?:png|jpe?g|webp)$/i.exec(name);
      if (!hit) continue;
      const seen = Number(hit[2]);
      if (seen > (diskRounds.get(hit[1]) || 0)) diskRounds.set(hit[1], seen);
    }
  } catch {
    /* 图片目录还不存在，按 0 处理 */
  }

  const images = (data.images || []).map((image) => {
    const rounds = (image.rounds || []).map((round) => ({
      index: round.index,
      action: round.action,
      error: round.error || '',
      verdict: round.verdict || null,
      candidates: (round.candidates || []).map((candidate) => ({
        id: candidate.id,
        file: candidate.file,
        path: join(dirs.images, candidate.file),
        previewFile: candidate.previewFile || null,
        preview: candidate.previewFile ? join(dirs.previews, candidate.previewFile) : null,
        sheet: candidate.sheetFile ? join(dirs.sheets, candidate.sheetFile) : null,
        size: candidate.size,
        requestId: candidate.requestId,
        actionType: candidate.actionType,
        parentId: candidate.parentId,
        actionPrompt: candidate.prompt || '',
        revisedPrompt: candidate.revisedPrompt,
        round: round.index,
        program: candidate.program || {},
        checks: candidate.checks || [],
        verdict: candidate.verdict || null,
      })),
    }));
    let chosen = null;
    for (const round of rounds) {
      const hit = round.candidates.find((candidate) => candidate.id === image.chosenId);
      if (hit) chosen = hit;
    }
    // 候选文件名是 <图号>-r<轮号>-g<序号>.png，轮号 = roundBase + 当前 rounds.length。
    // 除了读回持久化的 roundBase，还要按已存在的候选 id 兜一个下限：
    // 旧会话根本没存过这个字段，靠 id 反推才能自愈，否则编辑会覆盖历史交付的文件。
    let maxRound = 0;
    for (const round of rounds) {
      for (const candidate of round.candidates) {
        const hit = /-r(\d+)-g\d+$/.exec(candidate.id || '');
        if (hit) maxRound = Math.max(maxRound, Number(hit[1]));
      }
    }
    const diskMax = diskRounds.get(image.id) || 0;
    const roundBase = Math.max(Number(image.roundBase) || 0, maxRound - rounds.length, diskMax - rounds.length);
    return {
      id: image.id,
      title: image.title,
      blocked: Boolean(image.blocked),
      blockReason: image.blockReason || '',
      // 老会话落盘时还没有 failReason 字段，但每轮的报错一直存在 rounds 里。
      // 恢复时补算一次，否则历史失败会话永远只显示一句「未生成」。
      failReason: (image && image.failReason) || lastRoundError(image),
      contentPolicy: Boolean(image && image.contentPolicy) || isPolicyText(lastRoundError(image)),
      spec: {
        // 交付文件名靠它拼。老会话没这个字段，回退到图号小写即可。
        slug: (image.spec && image.spec.slug) || String(image.id || '').toLowerCase(),
        entry: (image.spec && image.spec.entry) || 't2i',
        prompt: (image.spec && image.spec.prompt) || '',
        slots: (image.spec && image.spec.slots) || null,
        missingSlots: (image.spec && image.spec.missingSlots) || [],
        aspectRatio: (image.spec && image.spec.aspectRatio) || 'auto',
        area: (image.spec && image.spec.area) || DEFAULTS.area,
        size: (image.spec && image.spec.size) || '',
        refs: (image.spec && image.spec.refs) || [],
        // 角色基准图编号要跟着会话活过重启，否则追问时 refine 会把它顶掉，主体又漂回去。
        characterRefs: (image.spec && image.spec.characterRefs) || [],
        textLayers: (image.spec && image.spec.textLayers) || [],
        checklist: (image.spec && image.spec.checklist) || [],
      },
      rounds,
      roundBase,
      status: image.status || 'pending',
      chosen,
      chosenReason: image.chosenReason || '',
    };
  });

  // 失败原因按图编号建索引：交付项里的 reason 是交付那一刻写下的，
  // 老会话那一版还没写，只能拿图上的失败原因回填。
  const failReasons = new Map(
    images
      .filter((image) => image.failReason)
      .map((image) => [image.id, { reason: image.failReason, contentPolicy: Boolean(image.contentPolicy) }]),
  );
  const turns = await restoreTurns(data, dirs, failReasons);
  // 老会话的 session.json 里没有 delivery，但 deliver/vN/report.json 在盘上，
  // 反推出来的最后一轮交付就是当前交付。
  const latest = turns.length ? turns[turns.length - 1].delivery : null;
  const source = data.delivery || latest;
  const delivery = source
    ? {
        version: source.version,
        dir: join(dirs.deliver, 'v' + source.version),
        items: backfillFailReasons(source.items, failReasons),
        questions: source.questions || [],
        crossCheck: source.crossCheck || null,
        cost: (data.delivery && data.delivery.cost) || null,
      }
    : null;

  // 老会话落盘时还没有「一张都没出来就判失败」这条规则，status 仍写着 delivered。
  // 恢复时按交付实况纠正，否则侧边栏会把 0 张图的会话当成正常完成，用户看不出它炸了。
  const deliveredItems = delivery ? (delivery.items || []).filter((item) => item.file) : [];
  const declaredItems = delivery ? delivery.items || [] : [];
  let status = data.status === 'running' ? 'failed' : data.status || 'delivered';
  if (status === 'delivered' && declaredItems.length && !deliveredItems.length) status = 'failed';
  // 失败会话必须带一句能看的原因，页面上才有东西可显示。
  const derivedFatal =
    status === 'failed' && declaredItems.length && !deliveredItems.length
      ? declaredItems
          .filter((item) => !item.file)
          .map((item) => item.id + ' ' + (item.reason || '未生成'))
          .join('；')
          .slice(0, 500)
      : '';

  return {
    id: data.id,
    createdAt: data.createdAt || Date.now(),
    updatedAt: data.updatedAt || data.createdAt || Date.now(),
    finishedAt: data.updatedAt || data.createdAt || Date.now(),
    instruction: data.instruction || '',
    refs,
    config: null,
    dirs,
    // 进程重启后 agent 一定已经死了。磁盘上还写着 running 的，只能是被打断的残留：
    // 老实标成 failed，否则页面会一直显示「运行中」，用户以为还在画，干等一个不会来的结果。
    status,
    route: data.route || 'full',
    think: data.think || [],
    plan: data.plan || null,
    images,
    events: Array.isArray(data.events) ? data.events : [],
    eventSeq: Array.isArray(data.events) ? data.events.length : 0,
    questions: data.questions || [],
    assumptions: data.assumptions || [],
    blockers: [],
    answered: data.answered || [],
    gate: null,
    permissions: [],
    pendingQuestion: null,
    // 公开链接要跟着会话一起活过重启，否则刷新一次页面就没了。
    shareUrl: data.shareUrl || null,
    // 正在发布的时候进程被重启（publish / 崩溃）：那一轮的 Agent turn 已经随进程没了，
    // 没人会再回来写结果。直接落成 failed，不然按钮会永远停在「发布中」。
    shareState: data.shareState === 'publishing' ? 'failed' : data.shareState || 'idle',
    shareError:
      data.shareState === 'publishing' ? 'publish_interrupted' : data.shareError || null,
    sharePublishedAt: data.sharePublishedAt || 0,
    shareClip: data.shareClip || null,
    turns,
    delivery,
    deliveryVersion: delivery ? delivery.version : 0,
    characterRefs: Array.isArray(data.characterRefs) ? data.characterRefs : [],
    crossCheck: data.crossCheck || (delivery && delivery.crossCheck) || null,
    fatal:
      data.status === 'running'
        ? data.fatal || 'interrupted'
        : data.fatal || derivedFatal || '',
    busy: false,
    archived: true,
    cost: data.cost || { ditImages: 0, ditMs: 0, agentCalls: 0, agentMs: 0, usage: null },
  };
}

// 新会话直接读 session.json 里的 turns；老会话没这个字段，只能从事件流反推：
// 「收到追问：xxx」是每一轮的起点，「交付 vN」把交付挂到当前轮，缺的部分去 deliver/vN/report.json 补。
async function restoreTurns(data, dirs, failReasons) {
  const events = Array.isArray(data.events) ? data.events : [];
  const bornAt = data.createdAt || Date.now();
  if (Array.isArray(data.turns) && data.turns.length) {
    return data.turns.map((turn) => ({
      instruction: turn.instruction || '',
      at: turn.at || bornAt,
      // 追问事件自己属于新一轮，所以起点是它的前一条。
      startSeq: Number(turn.startSeq) || 0,
      finishedAt: Number(turn.finishedAt) || 0,
      baseCost: turn.baseCost || null,
      endCost: turn.endCost || null,
      delivery: normalizeTurnDelivery(turn.delivery, failReasons),
    }));
  }
  const turns = [{ instruction: data.instruction || '', at: bornAt, startSeq: 0, finishedAt: 0, baseCost: null, delivery: null }];
  for (const event of events) {
    if (event.stage !== 'edit') continue;
    const match = /^收到追问：([\s\S]*)$/.exec(String(event.text || ''));
    if (!match) continue;
    turns.push({
      instruction: match[1].trim(),
      at: event.t || bornAt,
      startSeq: Math.max(0, (Number(event.seq) || 1) - 1),
      finishedAt: 0,
      baseCost: null,
      delivery: null,
    });
  }
  for (const report of await readDeliveryReports(dirs.deliver)) {
    const turn = turns[Math.min(report.version - 1, turns.length - 1)];
    if (turn && !turn.delivery) turn.delivery = normalizeTurnDelivery(report, failReasons);
  }
  // 成本是会话级累加的，老会话没记每轮起点。report.json 里的 cost 是"交付这一版时的累计值"，
  // 拿上一版的累计值当本轮基数，就能还原出每一轮自己花了多少。
  let previous = null;
  for (const turn of turns) {
    turn.baseCost = previous;
    if (turn.delivery && turn.delivery.cost) previous = turn.delivery.cost;
  }
  return turns;
}

function normalizeTurnDelivery(delivery, failReasons) {
  if (!delivery || !delivery.version) return null;
  return {
    version: delivery.version,
    items: backfillFailReasons(delivery.items, failReasons),
    questions: delivery.questions || [],
    crossCheck: delivery.crossCheck || null,
    cost: delivery.cost || null,
  };
}

// 图没画出来时，从后往前找最后一次真实报错。
// 老会话的 image 上没有 failReason 字段，但 rounds[].error 一直在盘上。
function lastRoundError(image) {
  const rounds = (image && image.rounds) || [];
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    if (round && round.error) return String(round.error);
  }
  return '';
}

function isPolicyText(text) {
  return /safety check|content[_ ]?policy|content[_ ]?filter|内容安全|审核不通过|敏感内容|违规内容/i.test(
    String(text || ''),
  );
}

// 交付项里的 reason 是交付那一刻写下的。老会话那一版还没写这段，
// 页面只能显示「未生成」——这里按图编号回填，让历史失败会话也说得清原因。
function backfillFailReasons(items, failReasons) {
  const list = items || [];
  if (!failReasons || !failReasons.size) return list;
  return list.map((item) => {
    if (!item || item.file || item.reason) return item;
    const hit = failReasons.get(item.id);
    if (!hit) return item;
    return { ...item, reason: hit.reason, contentPolicy: item.contentPolicy || hit.contentPolicy };
  });
}

async function readDeliveryReports(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const reports = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^v\d+$/.test(entry.name)) continue;
    try {
      const report = JSON.parse(await readFile(join(dir, entry.name, 'report.json'), 'utf8'));
      reports.push({
        version: Number(report.version) || Number(entry.name.slice(1)),
        items: report.items || [],
        questions: report.questions || [],
        cost: report.cost || null,
      });
    } catch {
      /* 报告缺失或写坏了就跳过，不影响看图 */
    }
  }
  return reports.sort((a, b) => a.version - b.version);
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(payload);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body_too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}
