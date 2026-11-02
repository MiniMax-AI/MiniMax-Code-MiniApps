// @ts-check

/**
 * MMX 章鱼娘 Mini App —— Node 服务。
 *
 * 形态是「Node 算、页面显」：所有状态在 Node 的状态机里，
 * 页面、Agent 观察、MCP 工具三条入口共用它，改完先落盘再广播。
 *
 * 这个进程是宿主的直接子进程，必须一直占着 context.listen 分配的端口。
 */

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import {
  PetState,
  MOODS,
  MOOD_KEYS,
  ANCHORS,
  SCOPES,
  SCOPE_KEYS,
  BUBBLE_KIND,
  NAME_MAX,
  DEFAULT_HER_NAME,
} from './state.mjs';
import { ChatStore } from './chat.mjs';
import {
  DiaryStore,
  diaryStatus,
  MAX_CHARS as DIARY_MAX_CHARS,
  MAX_COMMENT_CHARS as DIARY_MAX_COMMENT_CHARS,
} from './diary.mjs';
import { createMcpHandler } from './mcp.mjs';
import { pickDiaryMemory, buildRecentDiaryContext } from './memory.mjs';
// ★ **她从相处中学说话习惯**（第二十六轮第三档第二项）。
import {
  StyleMemStore,
  buildStyleBlock,
  buildStylePrompt,
  parseStyleOutput,
  pickSourceLines,
} from './stylemem.mjs';
import {
  TRACKS,
  MOOD_TRACK,
  poseToTransform,
  frameKind,
  POOLS,
  POOL_KEYS,
  EVENT_POOLS,
  TRACK_MODES,
  SEGMENT_LIMITS,
  validateSegments,
} from './tracks.mjs';
import { clip, textLength } from './clip.mjs';
import { ReplyFlow, splitChunks, REPLY_MAX_CHARS, REPLY_MAX_CHARS_SHORT } from './replyflow.mjs';
// ★ **表达独立决策环节**（第二十六轮第三档第一项）：
// 表情符号与口语填充词**不在大提示词里决定**，在这里单独决定。
import {
  applyExpress,
  applyExpressToLine,
  detectScene,
  pushHistory as pushExpressHistory,
} from './express.mjs';
import { assembleChatInput, buildCarryOver, SHORT_USER_MAX } from './chatinput.mjs';
// ★ **落库前剥皮**（2026-10-31 第二十九轮）：把「工作日志味」擦掉再进聊天区。
//   预告句（「我去把 X 的代码翻出来」）/ 纯路径句 / 纯校验味句 ⇒ 去掉。
// ⚠️ **只擦工作日志味，不擦「她懂很多」** —— 老板口径：她知道更多梗才更有真实感。
import { scrubText, pickFinalText } from './scrub.mjs';
import {
  shouldLoadStory,
  buildStoryBlock,
  parseStoryBody,
} from './storyscope.mjs';
import { pickPetAgent, needRebuild } from './agentpick.mjs';
import { syncAgentDisplayName } from './displayname.mjs';
import { writeTextAtomic } from './atomic-json.mjs';
import { checkFrame, protocolPayload } from './chat-protocol.mjs';
import { createObserve } from './observe.mjs';
import {
  shouldSpeakIdle,
  buildIdlePrompt,
  pickIdleLine,
  IDLE_DEFAULTS,
} from './idletalk.mjs';
// ★ **台词库接线**（2026-11-01 第三十一轮）：
//   身体动画强绑定的那 27 条静态台词 ＋「她此刻在做什么」的片段上下文
//   （模型闲话对着画面说，不再跟动作各说各的）。
import {
  sceneForEvent,
  sceneForMood,
  voiceOf,
  isUntouched,
  buildScenePrompt,
  isTonePool,
  relationMarkScene,
  reunionTier,
  greetingTier,
  isWeekendDay,
  heartAskTopics,
  REUNION_MS,
  BACK_GAP_MS,
} from './chatter.mjs';

/** 客户端可取的静态资源白名单。 */
const ASSETS = {
  'mmx-octopus.png': 'image/png',
  // 头像（26px 聊天头像 / 22px 消息头像）—— 与立绘分开两条路径
  'mmx-avatar.png': 'image/png',
  // 立绘（浮窗 #pet-img）—— 落地后指向它
  'mmx-chibi-front.png': 'image/png',
};

/**
 * webm 素材目录（相对 miniapp/client/assets）。
 *
 * **白名单 = 素材清单**，不是扫目录 —— 扫目录等于「文件在就能播」，
 * 半截文件、名字写错的也会被端上去。清单由
 * `mmx-character/tools/sync_webm_assets.py` 显式对账后生成。
 */
const WEBM_DIR = 'webm/';
const WEBM_MANIFEST = 'manifest.json';

/** 状态摘要最多几行、每行最多几个字。 */
const SUMMARY_LINES = 8;
const SUMMARY_WIDTH = 60;

/**
 * 她的专属 agent（`PET_AGENT_NAME`）与「要不要重建会话」的判据都在 `agentpick.mjs`。
 *
 * 起因：老板 2026-10-30 拍板「**现在最主要的问题是调用了错误的agent文件**」——
 * 她的会话原本挂在**默认 agent（primary = mavis）**上，于是她的 system prompt 是
 * Mavis 的（"You are Mavis… a coding agent…"），而「她是谁 / 她长什么样 / 她的规矩」
 * 只是工作区里的 `AGENTS.md`（项目级说明）—— **权重打架时 system prompt 赢**。
 *
 * 那个 agent 的定义文件：真源 = `mmx-character/persona/agent.md`，
 * 投影 = `.minimax/agents/mmx/agent.md`（由 `sync_agent_prompt.py` 生成）。
 */

/** 聊天历史最多留 200 条（chat.mjs 里的同一份约束）。 */
const CHAT_MAX_TEXT = 2000;

/**
 * 一轮对话最长等多久，超时就掐断。
 *
 * 宿主不给超时：规范原文是「There is no timeout: a waiting run is released by
 * cancel or abort, process exit, or republish」。她那轮要是停在「等一个人回答
 * 的问题」上（子会话里调提问工具就会这样），run 永远不会自己结束 ——
 * chatBusy 永远为真、run slot 永远占着、输入框永远禁用，她就再也不会回话。
 * 所以这道闸只能我们自己设。
 */
const CHAT_TURN_TIMEOUT = 180000;

/** 看门狗开火时给用户看的话。走气泡，所以用她的口吻。 */
const STUCK_NOTE = '我卡住了……多半是停在等一个没人回答的问题上。你再问我一次就好。';

/**
 * 身份层（底稿 + 样子 + 规矩）的**降级路径** —— 全部从项目内
 * `miniapp/node/identity/AGENTS.md` 的三段里读（见 `readIdentityFallback()`）。
 *
 * ⚠️ 正常路径下身份层**不在这个文件里** —— 它写进了宿主给这个 Mini App 建的
 * agent 目录的 `AGENTS.md`，宿主每轮读它 → 进 system prompt → 压缩压不掉。
 * 那份投影只在**写文件失败**时兜底（老宿主 / 没有 `agent.session` 能力）。
 *
 * 真源：`mmx-character/persona/story-baseline.md`（底稿）、
 * `mmx-character/persona/appearance.md`（样子）、
 * `mmx-character/persona/rules.md`（规矩）——
 * 三份都由 `sync_identity_file.py` 投影进 `identity/AGENTS.md`。
 *
 * ⚠️ **2026-10-29 第八轮**：底稿与样子的副本原本还留在本文件里
 * （`STORY_BASELINE` / `APPEARANCE`），现在一并搬回真源 —— 三段读同一个地方。
 */

/**
 * 每轮都带给她的一条行事规则 + 一段「怎么写回复」的引导。
 *
 * 不是客套，是必需：新的专属会话没有上一轮的上下文，这条得每轮都带。
 *
 * ⚠️ **第 2 条在 2026-10-29 改写过**（老板拍板「不要问卷，聊天哪有给人家发问卷的」）：
 * 原来第 2 条是「提问要用非阻塞方式（async）发出来」—— 那条**反过来在鼓励她用问卷工具**，
 * 于是聊天区里就冒出一张「她想问你」的选择框卡片。
 * 现在第 2 条是「**直接在话里问出来，不发问卷、不列选项**」：
 * ① 治本 —— 她不再发问卷，选择框就不会出现；
 * ② 顺带把「同步提问会把这一轮卡死」那个工程风险一起消掉了（没有提问工具，就没有阻塞提问）。
 * 服务端另有一层**兜底降级**（`degradeQuestionToText()`）：万一她还发了问卷，
 * 也**不渲染卡片**，而是把问题降级成她的一条普通消息。
 *
 * ⚠️ **第 1 条在 2026-10-29 改写过**（老板 2026-10-29 第七轮：
 * 「为什么要控制气泡，不是应该控制回复的内容吗」）：
 * 起因是真机实测她一轮刷了 **42 个气泡 / 820 字**。查宿主 transcript 才发现，
 * **那一轮宿主发了 5 条 committed**：前 4 条全是「我先看一眼…」「真源找到了…」
 * 「我跑一下那个校验…」这类**干活过程播报**（每条都伴随工具调用），
 * 第 5 条才是 733 字的最终答复 —— 而这 733 字里大半是**查证数据**
 * （「底稿 183 字、样子 182 字」「SHA256 完全一样」「原始故事在 story-mmx-origin.md」），
 * 那是给 Agent 看的汇报，不是跟人说话的内容。
 *
 * 所以第 1 条补了三件事（**内容层**，不是「限制气泡数」）：
 *  ① **一轮写 100 字左右，最多 200 字；整轮写 4~6 句，一次只回一件事**；
 *  ② **别把干活的过程说给用户听** —— 不报「我去看一下/查一下/跑一下」；
 *  ③ **别为了显得严谨再补一堆路径、行数和校验结果**；
 *     并且「用户问什么就答什么，别把话题扩到实现细节上」。
 *
 * ⭐ **为什么约束的是「字数」而不是「条数」**（第一版写「一轮说 3~6 条就够」，实测无效）：
 * **条数不是模型能控制的量** —— 条是服务端切分出来的，模型写一段长文，
 * 服务端就切成一堆气泡；模型既不知道切成了几条，也没法数。
 * **字数是它自己能控的**（写多少字是它自己写的）。所以约束必须落在字数上。
 * 换算：200 字 ÷ 切分规则（每条 ≤40 字）≈ 4~6 条气泡 —— 正好落在
 * 「一轮好几条短消息」的口径里（见 §5.5）。
 *
 * ⚠️ **2026-10-29 第九轮补上「句」这个口径**（老板：「150 还是有点多，
 * 一下子会变成 8 个气泡」）：真机实测 **气泡数 ≠ 句数** ——
 * 服务端切句除「句末标点」必断外，还有一条**逗号级断点**
 * （攒够 `CHUNK_MIN` 字就断），会把句子再切成「半句」。
 * 所以**光压句数压不下气泡数**；老板拍板：`CHUNK_MIN` 12 → 20。
 *
 * ⚠️ **为什么写在这里而不是服务端裁**：服务端裁条数是**治症状**
 * （老板明确否掉了这条路：内容错了，气泡数怎么裁都不对）。
 * 提示词是内容层的抓手 —— 她每轮都读得到这条规矩。
 * ⚠️ 2026-10-29 实测：加上「别汇报干活过程」后，过程播报**真的消失了**；
 * 但「一轮说 3~6 条」**完全无效**（仍回 29 条）—— 见上面「为什么约束字数」。
 *
 * 分两段：
 *  - 「[你的规矩]」4 条 —— 前 3 条是【工程硬约束】，不可协商；
 *    第 4 条是【气质约束】，来自官方关键词「傻白甜」（2026-10-26 老板采访 MMX 官方）——
 *    老板拍板「只呆萌、永远不出错」：自然直白、带一点甜、不端着、不客服腔；
 *    但不许拿「我不会」当挡箭牌示弱卖萌，也绝不许敷衍装懂。
 *    注意：她的「甜」本来就自带（历史对话里就有「给你端一杯茶～」这种），
 *    这条要守的是甜，不是把甜压掉 —— 傻白甜约束的是气质，不是能力。
 *  - 「[怎么写回复]」6 条 —— **引导段**（2026-10-28 老板拍板）。
 *    ⚠️ 规矩正文**不在这个文件里** —— 真源 = `mmx-character/persona/rules.md`。
 *    讲的是「回话该长什么样」，不是「你是谁」：一条消息两三句、换行分句不分条、
 *    带动作神态、不空转、不替用户做决定、语气词节制、偶尔一个表情符号。
 *    ⚠️ **第 9 条的单位是「切分之后」的那一条**（老板 2026-10-28 拍板「按切分之后算」）：
 *    「一条消息」= 服务端切完后的一个气泡，「整轮」= 一轮回复。
 *    不写清楚的话，模型会把「一条消息」当成自己写的那一段，
 *    「～」的「一次」就会变成「每条消息一次」—— 切完 8 条就是 8 个「～」。
 *    骨架来自参考项目的 ROLEPLAY_GUIDE（REFERENCE-deepseek-pet-analysis.md §2.3.4），
 *    只取通用骨架，不抄酒馆扮演专有的那几条。
 *  - 「[怎么写得像活人]」14 条 —— 落笔前先想什么、情绪怎么接、怎么说话才不像客服。
 *    ⭐ **第 14、15 条在 2026-10-29 放行**（老板拍板「日记是很重要的记录，
 *    就相当于每天整理的 memory 或者重点」）。
 *    当年这两条**故意留空**：它们依赖「记忆档案」（跨会话记忆），
 *    落进去等于教她宣称自己没有的能力。
 *    现在**日记就是那份凭据** —— `memory.mjs` 每轮把她的日记注入给她，
 *    她能读到、能引原话，所以「你说过的那句我还存着」这句话**兑现得了**。
 *    ⚠️ **顺序不能动**：14、15 卡在 13 和 16 之间（编号跟着 `voice.md` 的口径）。
 */
/**
 * **规矩正文不再住在 `.mjs` 里**（老板 2026-10-29 第七轮：
 * 「**你把规则写在哪里了？写到 agent.md 里面会不会好写**」）。
 *
 * ⭐ **真源 = `mmx-character/persona/rules.md`**。
 * 查下来的事实：规矩**最终就住在 `AGENTS.md` 里** ——
 * 宿主每轮重读它 → 进 system prompt → 压缩压不掉；
 * 而真源却塞在这个文件的字符串常量里，于是「改一条规矩」要：
 * 改 .mjs → 跑 `sync_pet_rules.py` → 跑 `sync_identity_file.py`
 * → 再手抄一份 `voice.md` 的可读版。**改三处**，最后一处还是手抄。
 *
 * 搬过去之后：**改规矩只动那一个 md 文件**，
 * 两个同步脚本各自把它投影到 `AGENTS.md`（运行时生效的那份）和
 * `CONTRACT-v3.md` §5.0（可读的契约）—— 两边都是机器生成，不会漂。
 *
 * ⚠️ **`AGENTS.md` 本身仍然不要手改**（它是脚本拼出来的三段）：
 * 改规矩 → 改 `persona/rules.md` → 重跑 `sync_identity_file.py`。
 *
 * ⚠️ **降级路径**（身份层写不进 agent 目录时）不再需要本文件里的副本 ——
 * 它直接读项目内那份 `identity/AGENTS.md` 的三段（见 `readIdentityFallback()`）。
 */

// ⚠️ **这里原来有两份副本**：`STORY_BASELINE`（底稿）与 `APPEARANCE`（样子）——
// 2026-10-29 第八轮**搬回真源**：
//   底稿真源 = `mmx-character/persona/story-baseline.md`
//   样子真源 = `mmx-character/persona/appearance.md`
// 两者都由 `sync_identity_file.py` 投影进 `miniapp/node/identity/AGENTS.md` 的
// 「# 她是谁」/「# 她长什么样」两段。
// 降级路径现在**读那份投影**（见 `readIdentityFallback()`），本文件不再留副本 ——
// 双写 = 迟早漂（规矩 → CONTRACT §5.0 已经这么漂过好几回）。



/**
 * 从宿主发来的问卷请求里**取出问题正文**。
 *
 * ⚠️ **问卷已撤掉**（老板 2026-10-29：「不要问卷，聊天哪有给人家发问卷的」），
 * 这里只用来**兜底降级**：万一她还发了问卷，就把这个问题当成她的一句普通话说出来，
 * 用户在聊天框打字回 —— 而不是弹一张选择框卡片。
 *
 * 宿主的问卷结构有两种形态（`request` 是对象，题干可能在不同位置）：
 *   - `{ steps: [{ id, question, options }] }` —— 多步问卷（我们遇到的形态）
 *   - `{ question: '…' }` —— 单问
 * 所以这里挨个试一遍，取到第一个非空的。
 *
 * @param {unknown} request
 * @returns {string}
 */
function questionTextOf(request) {
  if (!request || typeof request !== 'object') {
    return typeof request === 'string' ? request : '';
  }
  const steps = Array.isArray(request.steps) ? request.steps : [];
  const texts = steps
    .map((step) => String(step?.question ?? step?.text ?? step?.title ?? '').trim())
    .filter(Boolean);
  if (texts.length) return texts.join('\n');
  return String(request.question ?? request.text ?? request.title ?? '').trim();
}

/**
 * 把多个 AbortSignal 合成一个：任一被取消，整体就取消。
 * @param {...(AbortSignal | undefined | null)} signals
 * @returns {AbortSignal | undefined}
 */
function mergeSignals(...signals) {
  const list = signals.filter((s) => s && typeof s.aborted === 'boolean');
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  return AbortSignal.any(list);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} text
 * @param {number} [status]
 */
function sendText(res, text, status = 200) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} location
 */
function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

/**
 * 时长（毫秒）说成人话：3 分 12 秒 / 3 分钟。
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return `${seconds} 秒`;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

/**
 * @param {any} context
 * @param {{bubbleMs?: number}} [options] 测试用的时长覆盖（生产不传）
 */
export async function start(context, options = {}) {
  // 聊天历史独立于 state.json：chat.json。
  const chat = new ChatStore(context.dataDir);
  await chat.load();
  // 她的日记本独立于 state.json 和 chat.json：diary.json。
  // （老板 2026-10-29：日记是她的独白，跟对话混在一起会串味）
  const diary = new DiaryStore(context.dataDir);
  await diary.load();
  /** 她学到的说话习惯（落盘，跨会话还在） */
  const styleMem = new StyleMemStore(context.dataDir);
  await styleMem.load();
  /** 回顾正在跑（一天最多一次） */
  let styleWriting = false;
  const state = new PetState(context.dataDir, chat, options);
  await state.load();

  // 页面 HTML 里读一次；资产引用在下面按 mtime 注入版本戳。
  const clientEntryRaw = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));

  // 资产版本戳：按文件 mtime 生成，换一次立绘/头像，URL 就变一次，
  // 绕开浏览器缓存（换图后页面仍显示旧立绘 —— 2026-10-27 实测踩坑）。
  // 源 HTML 保持干净（只写 /assets/xxx.png），版本戳只在服务端注入。
  let clientEntry = clientEntryRaw.toString('utf-8');
  for (const name of Object.keys(ASSETS)) {
    try {
      const st = await stat(join(context.pluginRoot, 'miniapp/client/assets', name));
      const token = `/assets/${name}`;
      clientEntry = clientEntry.split(token).join(`${token}?v=${Math.floor(st.mtimeMs)}`);
    } catch {
      // 资产文件还没生成 —— 保持原样，不注入版本戳
    }
  }

  // webm 素材清单 —— **运行时与素材之间唯一的接口**。
  // 读不到就当空清单（素材还没同步过来）：页面会回退到 pose 帧，画面不会空。
  let webmManifest = { version: 1, canvas: '', fps: 0, segments: {}, pools: {} };
  try {
    webmManifest = JSON.parse(
      await readFile(
        join(context.pluginRoot, 'miniapp/client/assets', WEBM_DIR, WEBM_MANIFEST),
        'utf-8'
      )
    );
  } catch {
    // 清单还没有 —— 空清单，下面按「没有片段」处理
  }
  // 素材换一批 URL 必须变（否则浏览器拿旧的）：给每段加版本戳。
  for (const [key, seg] of Object.entries(webmManifest.segments || {})) {
    try {
      const st = await stat(
        join(context.pluginRoot, 'miniapp/client/assets', WEBM_DIR, `${key}.webm`)
      );
      seg.url = `${seg.url}?v=${Math.floor(st.mtimeMs)}`;
    } catch {
      // 文件不在（清单与磁盘不同步）—— 服务时会 404，注入时保持原样
    }
  }

  // 轨道表注入：身体动画的节奏是**数据**（`tracks.mjs` 是唯一真源），
  // 页面只负责按帧推进，不再硬编码任何时长。
  // transform 字符串在服务端算好 —— 页面侧零逻辑，不重复实现一遍姿态换算。
  // `</script>` 里的 `<` 转义，防止提前闭合脚本标签。
  const tracksPayload = JSON.stringify({
    tracks: Object.fromEntries(
      Object.entries(TRACKS).map(([name, track]) => [
        name,
        {
          cycleMs: track.cycleMs,
          frames: track.frames.map((frame) => ({
            ms: frame.ms,
            // 呈现方式由真源判定（pose=整图微动 / sprite=图集取格），页面不猜。
            kind: frameKind(frame),
            transform: frame.pose ? poseToTransform(frame.pose) : 'none',
            sourceMs: frame.sourceMs === undefined ? null : frame.sourceMs,
          })),
        },
      ])
    ),
    moodTrack: MOOD_TRACK,
  }).replace(/</g, '\\u003c');
  clientEntry = clientEntry.replace(
    '<script id="mmx-tracks"></script>',
    `<script id="mmx-tracks">window.__MMX_TRACKS__ = ${tracksPayload};</script>`
  );
  // 片段清单注入：轨道表说「她该怎么动」，素材清单说「素材是什么」。
  // 两者都进页面，但**选哪条、怎么播的判断全在真源里**，页面只按池取。
  const segmentsPayload = JSON.stringify({
    segments: webmManifest.segments || {},
    pools: webmManifest.pools || {},
    trackPools: Object.fromEntries(
      Object.entries(TRACKS).map(([n, t]) => [n, t.pools || []])
    ),
    eventPools: EVENT_POOLS,
    poolDefs: POOLS,
    limits: SEGMENT_LIMITS,
  }).replace(/</g, '\\u003c');
  clientEntry = clientEntry.replace(
    '<script id="mmx-segments"></script>',
    `<script id="mmx-segments">window.__MMX_SEGMENTS__ = ${segmentsPayload};</script>`
  );
  // 帧契约注入：帧类型清单的唯一真源是 `chat-protocol.mjs`,
  // 页面据此判断收到的帧是哪一种（照 tracks.mjs 的模式，不用改 ASSETS 白名单）。
  clientEntry = clientEntry.replace(
    '<script id="mmx-chat-protocol"></script>',
    `<script id="mmx-chat-protocol">window.__MMX_CHAT_PROTOCOL__ = ${protocolPayload()};</script>`
  );
  const mcpHandler = createMcpHandler({
    state,
    chat,
    logger: { error: (code, fields) => context.logger.error(code, fields) },
  });

  // 观察通道（订阅 Agent 事件 + 看板 + 轮次摘要）——
  // 2026-10-29 第八轮从本文件抽成独立模块 `observe.mjs`：
  // 它只认注入进来的 `context` 和 `state`，自己的状态（订阅取消器 / 退避计时器 /
  // 看板计时器 / 轮次正文缓存）全在自己的闭包里，不再挤在这个大闭包的外层。
  const observe = createObserve({ context, state, onTaskEvent });
  state.setAgentTracking({ available: observe.agentAvailable, capability: observe.observeCapability });

  // ============ 闲话生产者（idle）：她不说话的时候也在活着 ============
  // ⚠️ **为什么要做这个**（老板 2026-10-30 第十九轮）：
  // 气泡队列**一直有 idle 这一类**（排队、不抢占、沉到队尾），但**从来没有生产者** ——
  // 「她不说话的时候也在活着」这句话一直是空的。第十八轮跟 Aurabot 逐条对账时，
  // 这是三个已知空缺之一（他们有 `chatty` 维 ＋「偶尔主动开个新话题、提起以前聊过的事」）。
  //
  // **判定逻辑在 `idletalk.mjs`**（纯函数、能单独测）；这里只负责接线：
  // 到点检查 → 让她自己开口说一句 → 塞进 idle 气泡（**不进聊天区**）。
  //
  // ⚠️ **她用自己的专属会话**：这样她知道刚才在聊什么，
  // 才有资格「提起以前聊过的事」（规矩第 26 条）。
  // 代价是那一轮会以 user 消息的身份进历史 —— 提示里写清楚了「这是你自己想开口」。
  /** @type {number[]} 最近说过闲话的时间戳 */
  const idleHistory = [];
  /**
   * 表达决策的跨轮状态：
   * - `expressHistory`：最近若干轮带过的表情（空字符串 = 那轮没带）
   *   → 算“十条里至少一条要带”的密度（规矩第 10 条）。
   * - `expressUsed`：最近用过的候选（用来轮换，避免每次都同一个）。
   *
   * ⚠️ **进程内状态**（不落盘）：重启后窗口重置 ⇒ 最多多带一个。
   * ⚠️ **不读时钟**：密度窗口由调用方注入，判据可被负向注入抓。
   */
  let expressHistory = [];
  let expressUsed = [];
  /**
   * 走静态台词库说一句（身体动画强绑定的那 27 条）。
   *
   * ⚠️ **表情由 `express.mjs` 统一挑**（规矩第 28 条）——
   * 模型回复与静态台词共用一套表情来源，不各写各的。
   * ⚠️ **轮换计数在 `state.nextSceneLine()` 里递增并持久化**：
   * 同一个情境连着触发三句都不同，重启后不回到第一句。
   *
   * @param {string} lineKey 情境键
   * @param {string} from 来源标签（只进日志）
   * @param {string | null} [tone] 语气档（只有分档的池认；不传就用当前语气档）
   * @param {number | null} [index] 显式下标（变体由事实决定时用）
   * @returns {Promise<boolean>} 说出去了没有
   */
  async function speakSceneLine(lineKey, from, tone = null, index = null) {
    // ★ **双通道时间闸门**（契约 §6.2，第三十七轮）：**先判闸门、再取句** ——
    //   反过来的话，被挡的那一次会把「轮换计数」吃掉（下次从第三句开始）。
    //   ⚠️ **exempt 豁免**：降级话术必须给用户反馈（voiceOf 返回 exempt）。
    if (!state.trySpeak(voiceOf(lineKey))) return false;
    // ⚠️ **只有分档的池才给语气档** —— 不分档的池给了会把落盘的轮换计数键
    //   从 click.tap 变成 click.tap@familiar，重启后老句子重来一遍。
    const useTone = isTonePool(lineKey) ? tone || state.currentTone().tone : null;
    const picked = state.nextSceneLine(lineKey, useTone, index);
    if (!picked) return false;
    const expressed = applyExpressToLine(picked.text, {
      scene: 'chat',
      history: expressHistory,
      used: expressUsed,
    });
    expressHistory = pushExpressHistory(expressHistory, expressed.decision);
    const usedNow = [
      ...(Array.isArray(expressed.decision.emojiAll) ? expressed.decision.emojiAll : []),
      ...(expressed.decision.emoji ? [expressed.decision.emoji] : []),
      ...(expressed.decision.spoken ? [expressed.decision.spoken] : []),
    ];
    if (usedNow.length) {
      expressUsed = [...usedNow, ...expressUsed].slice(0, 8);
    }
    const kind = picked.channel === 'idle' ? BUBBLE_KIND.IDLE : BUBBLE_KIND.TRIGGER;
    await state.say(expressed.text, from, kind);
    return true;
  }

  /**
   * 关系性台词（A 类）：用户发消息时，她可能该说一句什么。
   *
   * ⚠️ **判据全部来自结构化字段**：用户原话（标记词）＋ 时间锚点（冷落了多久）。
   *   **不读模型输出文本**（契约 §6.1 判据纪律）。
   * ⚠️ **一次互动最多说一句** —— 标记词优先；没有标记词才看「你回来了」。
   *
   * @param {string} text 用户原话
   * @param {number} awayMs 这次开口**之前**冷落了多久（毫秒）
   * @returns {Promise<string | null>} 说了哪个情境键
   */
  async function speakRelationLine(text, awayMs) {
    const mark = relationMarkScene(text);
    if (mark) {
      await speakSceneLine(mark, '关系');
      return mark;
    }
    const gap = Number(awayMs) || 0;
    if (gap < BACK_GAP_MS) return null;
    if (gap >= REUNION_MS) {
      // ⚠️ **重逢的变体是「冷落了多久」这个事实** ⇒ 按档取句，不按轮换计数取。
      await speakSceneLine('rel.reunion', '关系', null, reunionTier(gap));
      return 'rel.reunion';
    }
    await speakSceneLine('rel.back', '关系');
    return 'rel.back';
  }

  /** 引导语（D 类 func.guide）说没说过 —— **运行时态**，只说一次。 */
  let guideSaid = false;
  /**
   * 引导语：第一次有人跟她说话时给一句。
   * ⚠️ 走 idle 通道（排队不抢占）—— 她的第一句回答不能被引导语挤掉。
   */
  async function speakGuideLine() {
    if (guideSaid) return false;
    // ⚠️ **第三十七轮**：**说出来了才记** —— 以前先记「已说过」，
    //   万一被时间闸门挡掉，这句引导语就**永远**不会再说了。
    const said = await speakSceneLine('func.guide', '引导');
    if (!said) return false;
    guideSaid = true;
    return true;
  }

  /**
   * 任务事件台词（B 类，第三十七轮）：真的有活儿开始 / 结束。
   *
   * ⚠️ **判据 = 观察事件**（turn.started 等）—— 不是模型输出文本（契约 §6.1 判据纪律）。
   * ⚠️ **说出来了才标记「本轮已说过」** —— 没说成（被闸门挡了）就别占位，
   *   否则工作状态台词会被一条根本没说出口的台词压掉。
   *
   * @param {string} lineKey
   * @returns {Promise<boolean>}
   */
  async function onTaskEvent(lineKey) {
    const said = await speakSceneLine(lineKey, '任务').catch(() => false);
    if (said) state.markRoundLineSpoken();
    return said;
  }

  /** 今天说过时段问候 / 周末没有（运行时态，重启后再说一遍也无妨）。 */
  let envGreetingDay = '';
  let envWeekendDay = '';
  /**
   * E 类：今天该不该打招呼（时段问候 / 周末）。
   * ⚠️ **判据 = 时钟**（契约 §6.2：E 类的触发判据就是时钟）。
   * @param {number} now
   * @returns {{key: string, index: number | null} | null}
   */
  function pickTimeEnvScene(now) {
    const d = new Date(now);
    const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (envGreetingDay !== day) {
      const index = greetingTier(d.getHours());
      if (index !== null) {
        envGreetingDay = day;
        return { key: 'env.greeting', index };
      }
    }
    if (isWeekendDay(d.getDay()) && envWeekendDay !== day) {
      envWeekendDay = day;
      return { key: 'env.weekend', index: null };
    }
    return null;
  }
  /**
   * 任务类台词：她进入哪条工作轨 = 她在做什么。
   *
   * ⚠️ **只认「轨变了」**：thinking / working / celebrate 三条轨各挂一个情境键；
   * 日常轨（idle）不挂 —— 每天切几十个小动作，不该每次都冒一句。
   * ⚠️ **订阅只在 commit() 后触发**（`state.subscribe`），不是每次 snapshot 都触发。
   */
  let lastMoodForLine = state.mood;
  state.subscribe((snapshot) => {
    if (!snapshot || snapshot.mood === lastMoodForLine) return;
    lastMoodForLine = snapshot.mood;
    // ⚠️ **回到待机 = 一轮结束** ⇒ 清掉「本轮已说过」的标记（下一轮可以再说话）。
    if (snapshot.mood === 'idle') state.clearRoundLineSpoken();
    // ⚠️ **工作状态台词让位**（第三十七轮）：这一轮已经说过任务 / 结果台词 ⇒
    //   不再叠一句（一次交互只冒一条，别话痨）。
    if (state.isRoundLineSpoken()) return;
    // ⚠️ **判据 = 状态四态**（D 类工作状态台词），不是「任务事件」——
    //   任务事件那套在观察通道里（onTaskEvent），两套判据来源不同 ⇒ 不撞车。
    const lineKey = sceneForMood(snapshot.mood);
    if (!lineKey) return;
    void speakSceneLine(lineKey, '工作状态').catch(() => {});
  });
  /** @type {NodeJS.Timeout|null} 闲话检查定时器 */
  let idleTimer = null;
  /** 上次说「你一直没理我」是什么时候（运行时态，用来节流）。 */
  let lastAfterIgnoreAt = 0;
  /** 「你一直没理我」的节流：一小时最多一句。 */
  const AFTER_IGNORE_THROTTLE_MS = 60 * 60 * 1000;
  /** 闲话那一轮是不是正在跑（防止两次闲话叠在一起） */
  let idleRunning = false;
  /**
   * 专属 agent 的探测结果（运行时缓存，不落盘）。
   *
   * `null` = 还没探过；`''` = 探过了、这台机器上没有专属 agent（用默认 agent）；
   * `'mmx'` = 有，用它。
   */
  let petAgentProbe = null;

  /**
   * 检查一次该不该让她主动开口；该就说一句。
   *
   * ⚠️ **闲话失败不致命**：她该说话的时候没说上，不该把整个 Mini App 带崩。
   */
  async function tickIdleTalk() {
    if (idleRunning) return;
    try {
      if (!agentReady() || state.chatBusy) return;
      // 用户最后一次说话是什么时候（聊天历史里最晚的一条 user 消息）。
      let lastUserAt = 0;
      for (const item of chat.list()) {
        if (item && item.role === 'user') {
          const at = Number(item.at) || 0;
          if (at > lastUserAt) lastUserAt = at;
        }
      }
      const now = Date.now();
      // ★ **时段问候 / 周末**（E 类）：每天各一次。
      //   ⚠️ **放在闲话闸门之前** —— 「早上好」不该等她闲下来才说（闸门要 20 分钟没人说话）。
      //   它走 idle 通道（排队不抢占），不会打断用户正在进行的对话。
      const env = pickTimeEnvScene(now);
      if (env) {
        idleRunning = true;
        idleHistory.push(now);
        try {
          await speakSceneLine(env.key, '闲话', null, env.index);
        } finally {
          idleRunning = false;
        }
        return;
      }
      const verdict = shouldSpeakIdle({
        now,
        lastUserAt,
        lastIdleAt: idleHistory.length ? idleHistory[idleHistory.length - 1] : 0,
        idleTimestamps: idleHistory,
        busy: state.chatBusy,
      });
      if (!verdict.ok) return;

      // ⚠️ **先判静态**：久没人碰她 ⇒ 用静态台词库那 3 条（idle 通道），不走模型。
      // 阈值（2 小时）比闲话闸门（20 分钟）长 —— 否则静态句会把模型闲话全吃掉。
      if (isUntouched(now, state.lastTouchedAt)) {
        idleRunning = true;
        idleHistory.push(now);
        try {
          await speakSceneLine('idle.untouched', '闲话');
        } finally {
          idleRunning = false;
        }
        return;
      }
      // ★ **冷落后她先开口**（A 类 rel.after_ignore）：冷落 ≥30 分钟但不到 2 小时。
      //   ⚠️ **一小时最多一句** —— 闲话闸门 20 分钟就放行一次，不节流她会一直抱怨。
      const awayMs = now - (Number(state.lastTouchedAt) || 0);
      if (awayMs >= REUNION_MS && now - lastAfterIgnoreAt >= AFTER_IGNORE_THROTTLE_MS) {
        lastAfterIgnoreAt = now;
        idleRunning = true;
        idleHistory.push(now);
        try {
          await speakSceneLine('rel.after_ignore', '闲话');
        } finally {
          idleRunning = false;
        }
        return;
      }

      idleRunning = true;
      const minutes = Math.round((now - lastUserAt) / 60000);
      const clock = new Date(now).toTimeString().slice(0, 5);
      // ⚠️ **片段上下文**：她此刻在做什么 ＋ 刚刚发生了什么 ⇒ 模型说的话对得上画面。
      // 只喂结构化字段（片段 key / 中文动作名 / 分类 / 交互事件），不读模型输出文本。
      const scenePrompt = buildScenePrompt(state.scene);
      // ★ **双通道时间闸门**（第三十七轮）：模型闲话走 feed 通道（9s）。
      //   ⚠️ **在跑模型之前占位** —— 模型这一轮要十几秒，跑完再判就晚了。
      if (!state.trySpeak('feed')) return;
      const sessionId = await ensurePetSession();
      // 身份层先落位（跟聊天那条路一样）：她在 agent 目录里读到 AGENTS.md 才知道自己是谁。
      await ensureIdentityFile(sessionId);
      /** 她的这一轮正文 */
      let finalText = '';
      const controller = new AbortController();
      const watchdog = setTimeout(() => controller.abort(), CHAT_TURN_TIMEOUT);
      try {
        await context.agent.run(
          { text: buildIdlePrompt({ clock, minutes, scene: scenePrompt, tone: state.currentTone() }), sessionId },
          {
            signal: mergeSignals(context.signal, controller.signal),
            onEvent: (event) => {
              if (event && event.type === 'message.committed') {
                finalText = String(event.text ?? '');
              }
            },
          }
        );
      } finally {
        clearTimeout(watchdog);
      }
      const line = pickIdleLine(finalText);
      if (!line) return;
      idleHistory.push(now);
      // ★ **闲话也走表达决策**：闲话的情绪强得多（“刚睡醒”“光挪过来了”），
      // 但闲话**不进聊天区**（只走气泡通道）—— 与聊天路径分开。
      const idleExpressed = applyExpressToLine(line, {
        scene: 'chat',
        history: expressHistory,
        used: expressUsed,
      });
      expressHistory = pushExpressHistory(expressHistory, idleExpressed.decision);
      // ⚠️ **第二十八轮**：同聊天路径 —— 全部用过的表情 + 口语都进轮换池。
      const idleUsedNow = [
        ...(Array.isArray(idleExpressed.decision.emojiAll) ? idleExpressed.decision.emojiAll : []),
        ...(idleExpressed.decision.emoji ? [idleExpressed.decision.emoji] : []),
        ...(idleExpressed.decision.spoken ? [idleExpressed.decision.spoken] : []),
      ];
      if (idleUsedNow.length) {
        expressUsed = [...idleUsedNow, ...expressUsed].slice(0, 8);
      }
      // ⚠️ **idle 气泡**：排队、不抢占、沉到队尾 —— 她不打断正在说的话。
      await state.say(idleExpressed.text, '闲话', BUBBLE_KIND.IDLE);
    } catch (error) {
      context.logger.warn('miniapp.idle.failed', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    } finally {
      idleRunning = false;
    }
  }

  /** @type {Set<import('node:http').ServerResponse>} */
  const sseClients = new Set();

  state.subscribe((snapshot) => {
    if (!sseClients.size) return;
    const frame = `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
  });

  /**
   * 广播一帧聊天事件（与 event: state 并行，走同一个 SSE 连接）。
   * @param {Record<string, unknown>} payload
   */
  function broadcastChat(payload) {
    // ⚠️ **契约外的帧一律不发**（2026-10-29 第八轮）：
    // 帧类型清单的唯一真源是 `chat-protocol.mjs`。契约表里没有的帧发出去，
    // 页面也不认（`default: break`）→ **静默失败**，最难查的就是这种
    // （第八轮实测发现的悬空 `naming` 帧就是这个样子）。
    // 在这里卡住，日志里立刻看得出「服务端加了帧但没进契约表」。
    const verdict = checkFrame(payload);
    if (!verdict.ok) {
      context.logger.error('miniapp.chat.frame.invalid', { error: verdict.error });
      return;
    }
    if (!sseClients.size) return;
    const frame = `event: chat\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  /** 对话纪元：清空对话后 +1，旧轮次的结果就不再冒出来。 */
  let chatEpoch = 0;

  /**
   * 当前这一轮对话是否还活着。
   * busy 标志本身分不出死活 —— 上一轮如果没能正常收尾，标志就永远留在 true。
   * 只有真实的运行态能判断，否则她会被自己锁死。
   */
  const chatTurn = { active: false, startedAt: 0 };

  /** @type {Map<string, number>} 会话第一次被看见是 running 的时间戳（内存态，不持久化） */
  const runningSince = new Map();

  const server = createServer(async (request, response) => {
    // 首个请求到达时，宿主激活已经完成，这时才能安全地订阅 Agent 事件。
    observe.scheduleObserve();
    // 看板同理：sessions() 要等激活之后才调得通。
    observe.scheduleBoard();
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const path = url.pathname;

    try {
      // ===== 页面 =====
      if (request.method === 'GET' && (path === '/' || path === '/dashboard')) {
        if (path === '/') {
          redirect(response, '/dashboard');
          return;
        }
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(clientEntry);
        return;
      }

      // ===== 静态资源（白名单）=====
      if (request.method === 'GET' && path.startsWith('/assets/')) {
        const name = decodeURIComponent(path.slice('/assets/'.length));
        // webm 片段走**清单白名单**；其余走静态白名单。
        let contentType = /** @type {string | null} */ (null);
        let filePath = /** @type {string | null} */ (null);
        if (name.startsWith(WEBM_DIR)) {
          const file = name.slice(WEBM_DIR.length);
          // ⚠️ **清单里的 key 不带扩展名**（rand-01），文件名带（rand-01.webm）。
          // 拿文件名直接去查清单 ⇒ 永远查不到 ⇒ 白名单形同虚设、webm 全部 404。
          const key = file.endsWith('.webm') ? file.slice(0, -'.webm'.length) : '';
          if (key && webmManifest.segments && webmManifest.segments[key]) {
            contentType = 'video/webm';
            filePath = join(context.pluginRoot, 'miniapp/client/assets', WEBM_DIR, file);
          }
        } else {
          contentType = ASSETS[/** @type {keyof typeof ASSETS} */ (name)] || null;
          filePath = join(context.pluginRoot, 'miniapp/client/assets', name);
        }
        if (!contentType || !filePath) {
          sendJson(response, 404, { error: 'unknown_asset' });
          return;
        }
        try {
          const info = await stat(filePath);
          response.writeHead(200, {
            'content-type': contentType,
            'content-length': info.size,
            // no-store：资产是本地开发产物，换一次立绘/头像就换一次内容。
            // 之前这里发的是 public, max-age=3600 —— 换图后浏览器仍吐旧立绘，
            // 页面看着没更新（2026-10-27 实测踩坑）。
            'cache-control': 'no-store',
          });
          response.end(await readFile(filePath));
        } catch {
          sendJson(response, 404, { error: 'asset_missing' });
        }
        return;
      }

      // ===== MCP 端点 =====
      if (path === '/mcp/mmx') {
        await mcpHandler(request, response);
        return;
      }

      // ===== 状态 =====
      if (request.method === 'GET' && path === '/api/state') {
        sendJson(response, 200, state.snapshot());
        return;
      }

      // ===== 聊天历史（SSE 重连后补读用）=====
      if (request.method === 'GET' && path === '/api/chat') {
        sendJson(response, 200, {
          messages: chat.list(),
          busy: state.chatBusy,
          pending: state.pendingInteraction,
          sessionId: state.petSessionId,
        });
        return;
      }

      // ===== 她的日记本 =====
      if (request.method === 'GET' && path === '/api/diary') {
        sendJson(response, 200, {
          entries: diary.list(),
          status: diaryStatus(diary),
          writing: diaryWriting,
        });
        return;
      }

      // ===== 实时推送 =====
      if (request.method === 'GET' && path === '/api/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        sseClients.add(response);
        response.write(`event: state\ndata: ${JSON.stringify(state.snapshot())}\n\n`);
        request.on('close', () => sseClients.delete(response));
        return;
      }

      // ===== 元信息 =====
      if (request.method === 'GET' && path === '/api/meta') {
        sendJson(response, 200, {
          moods: MOODS,
          anchors: ANCHORS,
          moodKeys: MOOD_KEYS,
          scopes: SCOPES,
          scopeKeys: SCOPE_KEYS,
          agentTracking: !!context.agent,
        });
        return;
      }

      // ===== 写操作 =====
      if (request.method === 'POST') {
        const body = await readJsonBody(request);
        if (body === undefined) {
          sendJson(response, 400, { error: 'invalid_json' });
          return;
        }

        if (path === '/api/say') {
          try {
            // 面板里用户明确让她说的 → manual：立刻显示，抢占当前气泡。
            await state.say(String(body.text ?? ''), '控制台', BUBBLE_KIND.MANUAL);
            sendJson(response, 202, { ok: true, snapshot: state.snapshot() });
          } catch (error) {
            sendJson(response, 400, {
              error: error instanceof Error ? error.message : 'say_failed',
            });
          }
          return;
        }

        // 页面上报「她此刻在做什么」（片段层）。
        //
        // ⚠️ **只更新场景，不说话** —— 她每 5 秒切一段片段，
        // 每次都冒一句就成话痨了。
        // 说话由交互事件（`/api/react`）与任务事件（轨变了）触发。
        if (path === '/api/scene') {
          try {
            const key = String(body.key ?? '');
            const pool = String(body.pool ?? '');
            const event = String(body.event ?? '');
            let name = '';
            let category = '';
            const seg = key && webmManifest.segments ? webmManifest.segments[key] : null;
            if (seg) {
              name = String(seg.name || '');
              category = String(seg.category || '');
            }
            state.setScene({ key, pool, name, category, event });
            sendJson(response, 202, { ok: true });
          } catch (error) {
            sendJson(response, 400, {
              error: error instanceof Error ? error.message : 'scene_failed',
            });
          }
          return;
        }

        // 交互事件（点她 / 连点 / 双击 / 拖动 / 挪位置 / 这一轮失败）
        // ⇒ 走静态台词库（身体动画强绑定的那 27 条）。
        if (path === '/api/react') {
          try {
            const event = String(body.event ?? '');
            const lineKey = sceneForEvent(event);
            if (!lineKey) {
              sendJson(response, 400, { error: 'unknown_event' });
              return;
            }
            state.touch();
            state.setScene({ ...(state.scene || {}), event });
            const said = await speakSceneLine(lineKey, '交互');
            sendJson(response, 202, { ok: true, said });
          } catch (error) {
            sendJson(response, 400, {
              error: error instanceof Error ? error.message : 'react_failed',
            });
          }
          return;
        }

        // 页面上报宿主窗口状态（模式 / 穿透 / 最近一次失败 / 真实坐标）。
        // 浮窗的问题只发生在宿主窗口层，Node 侧看不到 —— 这是唯一的观测口。
        // ⚠️ x/y 必须一起传：漏了的话，Node 侧存的就只是「我们自己的账本」，
        // 跟宿主真实坐标对不上账（这个坑踩过：账本 y=-14，宿主真值 y=-164）。
        if (path === '/api/window-state') {
          try {
            const windowState = await state.setWindowState({
              mode: body.mode,
              clickThrough: body.clickThrough,
              lastError: body.lastError,
              x: body.x,
              y: body.y,
              // 最近一次拖动的对账结果（鼠标位移 / 宿主位移 / 误差）。
              drag: body.drag,
            });
            sendJson(response, 200, { ok: true, windowState });
          } catch (error) {
            sendJson(response, 400, {
              error: error instanceof Error ? error.message : 'window_state_failed',
            });
          }
          return;
        }

        if (path === '/api/mood') {
          const mood = String(body.mood ?? '');
          if (!MOOD_KEYS.includes(mood)) {
            sendJson(response, 400, { error: 'invalid_mood', allowed: MOOD_KEYS });
            return;
          }
          await state.setMood(mood, '控制台');
          sendJson(response, 202, { ok: true, snapshot: state.snapshot() });
          return;
        }

        // ===== 称呼（老板 2026-10-28 拍板：名字和称呼由用户设定）=====
        // 首启问一次，之后在设置里随时改 —— 两个入口走同一个接口。
        if (path === '/api/naming') {
          const herName = String(body.herName ?? '');
          const userTitle = String(body.userTitle ?? '');
          if (herName.length > NAME_MAX * 4 || userTitle.length > NAME_MAX * 4) {
            sendJson(response, 400, { error: 'naming_too_long', max: NAME_MAX });
            return;
          }
          const naming = state.setNaming({ herName, userTitle });
          await state.commit();
          // 改了名字/称呼 → 她的专属会话要重建，否则旧会话还记着老称呼
          state.petSessionDirty = true;
          // (*) 显示名跟着设置走（老板 2026-11-01：名字不该写死，随时能改）
          await syncAgentDisplayName({ context, state }, naming.herName);
          broadcastChat({ type: 'naming', naming });
          sendJson(response, 200, { ok: true, naming, snapshot: state.snapshot() });
          return;
        }

        if (path === '/api/diary') {
          // 让她自己写一篇日记（走一次她的专属会话）。
          //
          // ⚠️ **老板 2026-10-29 改口**：用户发动态（`{ text }`）和「让她写」按钮
          // 都被拿掉了 —— 日记本现在是**只读 + 互动**（点赞 / 评论 / 她回评论）。
          // 这个入口留着，是因为「让她写一篇」本身是日记能力的一部分：
          // 聊天结束后自动补一篇走的是**同一个** `writeDiary()`。
          const result = await writeDiary();
          if (!result.ok) {
            sendJson(response, result.error === 'BUSY' ? 409 : 400, {
              error: result.error,
              reason: result.reason ?? '',
              status: diaryStatus(diary),
            });
            return;
          }
          sendJson(response, 201, {
            ok: true,
            entry: result.entry,
            entries: diary.list(),
            status: diaryStatus(diary),
          });
          return;
        }

        // ===== 点赞（老板 2026-10-29：可以添加点赞）=====
        if (path === '/api/diary/like') {
          const id = String(body.id ?? '');
          const entry = await diary.toggleLike(id);
          if (!entry) {
            sendJson(response, 404, { error: 'NOT_FOUND', reason: '这条动态已经不在了。' });
            return;
          }
          broadcastDiary();
          sendJson(response, 200, {
            ok: true,
            entry,
            entries: diary.list(),
            status: diaryStatus(diary),
          });
          return;
        }

        // ===== 评论（老板 2026-10-29：可以添加评论，评论后她可以回复）=====
        if (path === '/api/diary/comment') {
          const id = String(body.id ?? '');
          const text = String(body.text ?? '').trim();
          if (!text) {
            sendJson(response, 400, { error: 'EMPTY_TEXT', reason: '评论不能是空的。' });
            return;
          }
          /** @type {{entry: any, comment: any}|null} */
          let added = null;
          try {
            added = await diary.addComment(id, text);
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown';
            sendJson(response, 400, { error: reason, reason: '评论不能是空的。' });
            return;
          }
          if (!added) {
            sendJson(response, 404, { error: 'NOT_FOUND', reason: '这条动态已经不在了。' });
            return;
          }
          broadcastDiary();
          sendJson(response, 201, {
            ok: true,
            entry: added.entry,
            comment: added.comment,
            entries: diary.list(),
            status: diaryStatus(diary),
          });
          // 她回复这条评论 —— **异步**（不阻塞用户这一下），回复完再广播一次。
          void writeDiaryReply(added.entry.id, added.comment.id);
          return;
        }

        if (path === '/api/move') {
          const target = String(body.target ?? '');
          if (!(target in ANCHORS)) {
            sendJson(response, 400, { error: 'invalid_anchor', allowed: Object.keys(ANCHORS) });
            return;
          }
          await state.requestMove(target);
          sendJson(response, 202, { ok: true, snapshot: state.snapshot() });
          return;
        }

        if (path === '/api/position') {
          const x = Number(body.x);
          const y = Number(body.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            sendJson(response, 400, { error: 'invalid_coordinates' });
            return;
          }
          await state.setPosition(x, y);
          sendJson(response, 202, { ok: true, snapshot: state.snapshot() });
          return;
        }

        if (path === '/api/move-done') {
          await state.consumeMove(Number(body.at));
          sendJson(response, 202, { ok: true, snapshot: state.snapshot() });
          return;
        }

        // ===== 观察范围 =====
        if (path === '/api/scope') {
          const mode = String(body.mode ?? '');
          if (!(mode in SCOPES)) {
            sendJson(response, 400, { error: 'invalid_scope', allowed: SCOPE_KEYS });
            return;
          }
          // mode:'current' 时 sessionId 是页面探测到的当前会话；
          // 页面不在任何会话里会报 null（可空 → 观察退守全局）。
          let sessionId = null;
          if (mode === 'current' && body.sessionId !== undefined && body.sessionId !== null) {
            if (typeof body.sessionId !== 'string' || !body.sessionId.trim()) {
              sendJson(response, 400, { error: 'invalid_session' });
              return;
            }
            sessionId = body.sessionId.trim();
          }
          await state.setScope(mode, sessionId);
          // 换观察目标：先掐断旧订阅，再按新目标重新订阅。
          observe.restartObserve();
          sendJson(response, 202, { ok: true, snapshot: state.snapshot() });
          return;
        }

        // ===== 聊天 =====
        // 契约 v3 §5：受理，不等 Agent 跑完。她一次只回一句话。
        if (path === '/api/chat') {
          const text = String(body.text ?? '').trim();
          if (!text) {
            sendJson(response, 400, { error: 'EMPTY_TEXT' });
            return;
          }
          if (textLength(text) > CHAT_MAX_TEXT) {
            sendJson(response, 400, { error: 'TEXT_TOO_LONG' });
            return;
          }
          if (state.chatBusy) {
            // busy 有可能是脏的：上一轮没能正常收尾（比如宿主那边断了），
            // 标志就永远留在 true，她再也不会回话，用户也问不了她。
            // 真的还在跑就挡回去；已经没人跑了就清掉放行。
            const alive =
              chatTurn.active && Date.now() - chatTurn.startedAt <= CHAT_TURN_TIMEOUT + 30000;
            if (alive) {
              sendJson(response, 400, { error: 'BUSY' });
              return;
            }
            state.chatBusy = false;
            await state.setChatBusy(false);
          }
          // 同步占位：并发请求不能同时挤进来（正式提交在下面第 5 步）。
          state.chatBusy = true;
          chatTurn.active = true;
          chatTurn.startedAt = Date.now();
          const epoch = chatEpoch;
          // ⚠️ **冷落时长要在 appendMessage 之前算** —— appendMessage('user') 会 touch()
          //   （「她被碰了」），算晚了永远是 0。
          const awayMs = Date.now() - (Number(state.lastTouchedAt) || 0);
          try {
            // 用户的话先进历史：不然界面看起来像丢消息。
            const userMessage = await state.appendMessage('user', text);
            broadcastChat({ type: 'message', message: userMessage });
            await state.setAsking(text);
            // ★ 心情与亲密度（契约 §6.1）：用户主动发消息 ⇒ intimacy +2 / heart +1。
            //   判据 = **请求路径**（这条路由），不是模型输出文本。
            await state.applyUserMessageBump();
            // ★ 关系性台词（A 类）：先看消息里的标记词，没有才看「你回来了」。
            await speakRelationLine(text, awayMs);
            // ★ 引导语（D 类 func.guide）：第一次有人跟她说话时给一句（只说一次）。
            await speakGuideLine();

            // 取她的专属会话：卡住的（pendingQuestion）不能复用，重新 create。
            let sessionId = null;
            if (agentReady()) {
              try {
                sessionId = await ensurePetSession(body.agent);
              } catch (error) {
                context.logger.warn('miniapp.agent.session.create.failed', {
                  reason: error instanceof Error ? error.message : 'unknown',
                });
                sessionId = null;
              }
            }

            await state.setChatBusy(true);
            await state.setAgentState('thinking');
            // ⚠️ **busy=true 也要广播**（以前只在结束时推 busy:false）：
            // 她跑一轮 Agent 可能要几十秒，这期间页面要显示「她正在输入…」
            // 那个三个跳动的点（微信/QQ 都有）。不推的话，页面只能靠 202 响应
            // 才知道 —— SSE 重连后就断了这条线。
            broadcastChat({ type: 'busy', busy: true });
            sendJson(response, 202, {
              ok: true,
              snapshot: state.snapshot(),
              message: userMessage,
            });
            // Agent 那一轮可能跑很久，不能挡着响应；答案后面从她嘴里出来。
            void runChatTurn({ text, sessionId, epoch }).catch((error) => {
              context.logger.warn('miniapp.agent.chat.crashed', {
                reason: error instanceof Error ? error.message : 'unknown',
              });
            });
          } catch (error) {
            state.chatBusy = false;
            chatTurn.active = false;
            await state.setChatBusy(false);
            throw error;
          }
          return;
        }

        // ===== 审批回路 =====
        // reply() 能在 run 还在等的时候调：用户点「允许一次」不用等这轮结束。
        if (path === '/api/chat/permission') {
          const requestId = String(body.requestId ?? '');
          const decision = String(body.decision ?? '');
          if (decision !== 'allowOnce' && decision !== 'deny') {
            sendJson(response, 400, {
              error: 'invalid_permission',
              allowed: ['allowOnce', 'deny'],
            });
            return;
          }
          const pending = state.pendingInteraction;
          if (!pending || pending.type !== 'permission' || pending.requestId !== requestId) {
            sendJson(response, 404, { error: 'NOT_FOUND' });
            return;
          }
          if (!context.agent || typeof context.agent.reply !== 'function') {
            sendJson(response, 404, { error: 'NOT_FOUND' });
            return;
          }
          try {
            // 必须用事件里的 sessionId：审批可能来自子会话。
            await context.agent.reply({ sessionId: pending.sessionId, requestId, decision });
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown';
            context.logger.warn('miniapp.agent.reply.failed', { reason });
            if (reason.includes('REQUEST_NOT_FOUND')) {
              await state.clearPendingInteraction();
              // ★ 审批过期（D 类 func.approval_expired）：宿主已经不认这个请求了 ⇒ 它作废了。
              await speakSceneLine('func.approval_expired', '降级').catch(() => undefined);
              sendJson(response, 404, { error: 'NOT_FOUND' });
              return;
            }
            sendJson(response, 400, { error: 'reply_failed' });
            return;
          }
          await state.clearPendingInteraction();
          broadcastChat({ type: 'permission_resolved', requestId });
          sendJson(response, 202, { ok: true });
          return;
        }

        // ===== 问卷回路：已撤掉 =====
        // 老板 2026-10-29：「不要问卷，聊天哪有给人家发问卷的」。
        // 问卷机制整条拿掉：没有问卷，就没有「作答」这个动作，
        // 所以 `/api/chat/answer` **整条路由都不存在**（请求它 → 404）。
        // 她要问什么，**直接在话里问**（规矩第 2 条），
        // 用户在聊天框打字回 —— 聊天是对话，不是填表。
        // ⚠️ **审批回路不动**：`/api/chat/permission` 还在（那是「允许/拒绝」，
        //    跟「给她几个选项」不是一回事）。

        // ===== 清空对话 =====
        if (path === '/api/chat/reset') {
          chatEpoch += 1;
          await chat.clear();
          broadcastChat({ type: 'reset' });
          await state.clearPendingInteraction();
          // 丢弃当前会话：下一问重新 create。
          await state.setPetSession(null, false);
          sendJson(response, 202, { ok: true, snapshot: state.snapshot() });
          return;
        }
      }

      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      context.logger.error('miniapp.request.failed', {
        path,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' });
      else response.end();
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });

  // 绑完之后的**真实端口**。
  //
  // ⚠️ `context.listen.port = 0` 的意思是「让操作系统分配一个空闲端口」。
  // 以前自检是「先起一个探针占端口 → 关掉探针 → 再让真服务器绑那个端口」——
  // 中间有个窗口，端口被别人抢走就 EADDRINUSE，自检会**随机崩在 fetch 上**
  // （2026-10-28 实测踩到：并行跑两次自检就崩一次）。
  // 现在由服务器自己绑 0 号端口，再把真实端口报回去，**这个竞态就没了**。
  const actualPort = server.address()?.port ?? context.listen.port;

  // ===== L2 聊天层：让她在自己的房间里回话 =====
  /**
   * Agent 通道能不能用（老宿主 / 用户关掉 session.run 时没有）。
   * @returns {boolean}
   */
  function agentReady() {
    return (
      !!context.agent &&
      typeof context.agent.run === 'function' &&
      typeof context.agent.create === 'function'
    );
  }

  /**
   * 她的会话该用哪个 agent。
   *
   * 优先级：用户显式指定的（`state.petAgent`）＞ 探测到的专属 agent ＞ 空（用默认）。
   *
   * ⚠️ **为什么探测而不是写死**：专属 agent 是**用户配置**的 —— 别人装了我们的
   * Mini App，`agents()` 列表里没有「mmx」⇒ `create({agent})` 直接 INVALID_ARGUMENTS。
   * 探测不到就退回默认 agent（= 2026-10-30 之前的行为），可推广性不破。
   *
   * ⚠️ **探测结果要缓存**：`agents()` 走宿主的目录调用通道，
   * 跟 `run`/`answer` 共享 Node 进程的 16 个普通请求名额 —— 每轮探一次不划算。
   *
   * @returns {Promise<string>} '' = 不指定（用默认 agent）
   */
  async function resolvePetAgent() {
    if (state.petAgent) return String(state.petAgent);
    if (petAgentProbe !== null) return petAgentProbe;
    /** 宿主列出来的 agent 名（探测失败就当空表 ⇒ 退回默认 agent） */
    let names = [];
    try {
      if (context.agent && typeof context.agent.agents === 'function') {
        const listed = await context.agent.agents();
        names = (listed?.agents || []).map((item) => String(item?.name ?? ''));
      }
    } catch (error) {
      // 探测失败不是错误 —— 退回默认 agent 就行（她照样能说话）。
      context.logger.warn('miniapp.agent.pet_agent.probe_failed', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
      names = [];
    }
    petAgentProbe = pickPetAgent(names, '');
    context.logger.info('miniapp.agent.pet_agent.resolved', { agent: petAgentProbe || '(default)' });
    return petAgentProbe;
  }

  /**
   * 她的专属会话：卡住的（pendingQuestion）不能复用，重新 create 一个。
   * create 不占 run slot；run({sessionId}) 继续时不能带 agent。
   *
   * ⭐ **agent 对不上就重建**（2026-10-30 第二十三轮）：
   * 官方规范「会话不能中途换 agent」⇒ 想换只能新建会话。
   * 原来这里只认 `state.petSessionDirty`，而 `state.petAgent` **从来没有入口写入过**
   * （三个调用点都没传 agentName）⇒ 她的会话一直挂在默认 agent（mavis）上。
   * 现在多一道判据：**当前会话挂的 agent 跟要用的不一致 ⇒ 重建**。
   *
   * ⚠️ **重建的代价**：新会话 = 她的会话历史从零开始（旧的 session 数据还在宿主库里，
   * 只是不再续用它）。这是「让 agent 文件用对」的必然代价。
   *
   * @param {unknown} agentName 可选：这一轮用哪个 agent
   * @returns {Promise<string>}
   */
  async function ensurePetSession(agentName) {
    const wanted = agentName ? String(agentName) : await resolvePetAgent();
    const current = state.petSessionId;
    if (current && !state.petSessionDirty) {
      if (!wanted) return current;
      try {
        const detail = await context.agent.session(current);
        const running = String(detail?.agent ?? '');
        if (!needRebuild(running, wanted)) return current;
        context.logger.info('miniapp.agent.pet_session.rebuild', { from: running, to: wanted });
      } catch {
        // 读不到当前会话挂在谁身上 → 按原样续用，不折腾她。
        return current;
      }
    }
    // 指定了 agent 就记下来，之后几轮沿用同一个。
    if (agentName && wanted !== state.petAgent) await state.setPetAgent(wanted);
    const created = await context.agent.create(wanted ? { agent: wanted } : {});
    const sessionId = String(created?.sessionId ?? '');
    if (!sessionId) throw new Error('session_create_failed');
    await state.setPetSession(sessionId, false);
    // ⚠️ 这里**不**写身份层 —— 统一在 run 之前写（`ensureIdentityFile`）。
    // 理由：老会话被复用时根本走不到这个分支，身份文件会永远缺。
    return sessionId;
  }

  /**
   * 「她知道 MCode 在干什么」的状态摘要。
   * sessions() 调不通就不拼 —— 宁可不说，也不能给她一份编造的状态。
   * @returns {Promise<string | null>}
   */
  async function buildStatusSummary() {
    if (!state.petAware) return null;
    const list = await observe.listSessions();
    if (list === null) return null;
    const now = Date.now();
    const rows = list
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        sessionId: String(item.sessionId ?? ''),
        title: String(item.title ?? '').trim() || '(无标题)',
        status: String(item.status ?? ''),
        running: item.status === 'running',
      }));
    // running 优先，其余最多补到 8 行。
    const picked = [...rows.filter((row) => row.running), ...rows.filter((row) => !row.running)].slice(
      0,
      SUMMARY_LINES
    );
    const lines = picked.map((row) => {
      const head = `· ${row.title} · ${row.status}`;
      if (!row.running) return clip(head, SUMMARY_WIDTH);
      const since = observe.runningSince.get(row.sessionId);
      const duration = since ? formatDuration(now - since) : '';
      return clip(duration ? `${head} · ${duration}` : head, SUMMARY_WIDTH);
    });
    const body = lines.length ? lines.join('\n') : '· （无其它会话）';
    return `[当前 MCode 状态]\n${body}`;
  }

  /**
   * 把状态摘要和她的行事规则拼在用户输入前面。
   *
   * 摘要让她知道 MCode 在干什么；规则那段是必需的，不是多余的客套：
   * 她在子会话里调提问工具时，如果用阻塞方式，这一轮就永远等不到答案 ——
   * 宿主不提供超时（规范原文：a waiting run is released by cancel or abort,
   * process exit, or republish），run 不会自己结束，问卷事件也就永远不会来。
   * 新建的专属会话没有上一轮的上下文，所以这条规则每轮都要带。
   * @param {string} text 用户原话
   * @returns {Promise<string>}
   */
  /**
   * 称呼那一句（老板 2026-10-28 拍板：名字和称呼由用户设定）。
   *
   * **只在用户真的填了称呼时才加那半句** —— 用户没填 = 她自然地用「你」，
   * 不塞一个默认称呼进去（那是替用户做决定）。
   *
   * 名字那一半**总是给**：她的名字是她的身份，每轮都得知道。
   * @returns {string}
   */
  function buildNamingLine() {
    const { herName, userTitle } = state.naming;
    const lines = [`[你是谁]\n你叫${herName}。`];
    if (userTitle) {
      lines.push(`你称呼对方「${userTitle}」，平时就这么叫，别的一概不叫。`);
    }
    return lines.join('\n');
  }

  /**
   * 把身份层写进**宿主为这个 Mini App 建的 agent 目录**的 `AGENTS.md`。
   *
   * ⭐ 这是整件事的关键（2026-10-29 老板追问引出）：
   * 宿主为每个安装的 Mini App 自动建一个专属 agent 目录
   * （`~/.minimax/agents/<用户的primary>/miniapps/<pluginId>/`），
   * 并且**每轮重读**该目录下的 `AGENTS.md`，把它当项目指令拼进 **system prompt**。
   *
   * 为什么这比「每轮拼进 user 消息」好：
   * ① **压缩压不掉** —— system prompt 不进会话历史，宿主压缩只压对话历史；
   * ② **上下文不被撑爆** —— 身份层不进历史，每轮历史只长真实对话；
   * ③ **符合老板口径** ——「不在每一条进行反复注入」；
   * ④ **可推广** —— 目录由宿主按插件自动建，不要求用户配置任何 agent
   *    （专属 agent 方案不可推广：`agents()` 列的是**用户配置**的，
   *      别人装了我们的 Mini App 列表里没有「mmx」，`create({agent})` 直接 INVALID_ARGUMENTS）。
   *
   * 实测依据（2026-10-29 真机）：写暗号「甲」→ 她答「暗号甲」；
   * 改成「丙」→ **下一轮**就答「暗号丙」（每轮重读）；
   * 同目录 `PERSONA.md` 不生效（只认 `AGENTS.md`）；文件内容不进 `messages.jsonl` 历史。
   *
   * @param {string} sessionId 她的专属会话
   * @returns {Promise<boolean>} 有没有写成功（失败要降级）
   */
  async function ensureIdentityFile(sessionId) {
    if (!sessionId) return false;
    try {
      if (!context.agent || typeof context.agent.session !== 'function') return false;
      const detail = await context.agent.session(sessionId);
      const dir = String(detail?.workspaceDir ?? '');
      if (!dir) return false;
      const target = join(dir, 'AGENTS.md');
      const template = await readFile(
        join(context.pluginRoot, 'miniapp', 'node', 'identity', 'AGENTS.md'),
        'utf8'
      );
      /** 目标文件当前的内容（不存在就当空串 → 一定会重写） */
      let current = '';
      try {
        current = await readFile(target, 'utf8');
      } catch {
        // 文件还不存在 —— 正常情况（第一次写）。
      }
      if (current !== template) {
        await writeTextAtomic(target, template);
        context.logger.info('miniapp.agent.identity.written', { dir });
      }
      if (!state.identityFileReady) await state.setIdentityFileReady(true);
      return true;
    } catch (error) {
      context.logger.warn('miniapp.agent.identity.write_failed', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
      await state.setIdentityFileReady(false);
      return false;
    }
  }

  /**
   * **降级路径**用的身份层三段 —— 从项目内那份 `identity/AGENTS.md` 里取。
   *
   * ⭐ **真源在 `mmx-character/persona/`**（2026-10-29 第七轮搬走规矩、
   * 第八轮搬走底稿与样子），而那份 `AGENTS.md` 是它的投影。
   * 所以这里读投影 = 读真源，**不会漂**。
   *
   * ⚠️ **为什么降级路径要单独准备身份层**：
   * 身份层写不进宿主 agent 目录时（老宿主 / 没 `agent.session` 能力），
   * 就退回「每轮把身份层拼在 user 消息里」—— 效果差一点（会被压缩掉），
   * 但不会让她不知道自己是谁。降级判据 = `state.identityFileReady`。
   *
   * @returns {Promise<{baseline: string, appearance: string, rules: string}>}
   */
  async function readIdentityFallback() {
    try {
      const raw = await readFile(
        join(context.pluginRoot, 'miniapp', 'node', 'identity', 'AGENTS.md'),
        'utf8'
      );
      /** 取两个标记之间的正文（缺任一标记 → 空串，宁可不带也不带错）。 */
      const section = (startMarker, endMarker) => {
        const start = raw.indexOf(startMarker);
        if (start < 0) return '';
        const end = endMarker ? raw.indexOf(endMarker, start + startMarker.length) : -1;
        if (endMarker && end < 0) return '';
        return raw.slice(start + startMarker.length, end < 0 ? raw.length : end).trim();
      };
      return {
        baseline: section('# 她是谁', '# 她长什么样'),
        appearance: section('# 她长什么样', '# 她的规矩'),
        rules: section('# 她的规矩', '# 结尾'),
      };
    } catch {
      return { baseline: '', appearance: '', rules: '' };
    }
  }

  /**
   * 拼这一轮送进她耳朵的文本。
   *
   * ⭐ **身份层不在这里**（底稿 + 规矩已经写进 agent 目录的 `AGENTS.md`，
   * 宿主每轮读它 → 进 system prompt → 压缩压不掉）。
   * 这里只拼**每轮都会变的**的部分：状态摘要 + 称呼 + 用户原话。
   *
   * ⚠️ **称呼必须每轮带** —— 名字和称呼是用户随时能改的（`/api/naming`），
   * 写进 `AGENTS.md` 就成了静态的，改名不生效。所以它留在这里。
   *
   * @param {string} text 用户原话
   * @returns {Promise<string>}
   */
  async function buildChatInput(text) {
    const summary = await buildStatusSummary();
    // ⚠️ **降级路径**：身份层写不进 agent 目录时（老宿主 / 没 agent.session 能力），
    // 就退回「每轮把身份层拼在 user 消息里」—— 效果差一点（会被压缩掉），
    // 但不会让她不知道自己是谁。降级判据 = `state.identityFileReady`。
    const identityInFile = state.identityFileReady;
    // 降级路径的身份层三段（identityInFile 时不读，也不带 —— 已经在 AGENTS.md 里了）。
    const fallback = identityInFile ? null : await readIdentityFallback();
    // 换会话后的第一轮：带一段「上一段聊到这」，不然她接不上。
    const isNewSession = !state.petHeadInjected;
    // ⭐ **她的日记**（老板 2026-10-29：「日记是很重要的记录，
    // 就相当于每天整理的 memory 或者重点」）。
    // 挑哪几篇、命中怎么算，全在 `memory.mjs` 里 —— 这里只调它。
    // ⚠️ **注入的是她自己的日记**（不是用户的原话），所以她能拿它当「我记得」的凭据。
    const memory = pickDiaryMemory(diary.list(), { text }).block;
    // ⭐ **她的背景故事**（老板 2026-10-30 第二十二轮：
    // 「她的背景故事，和后面的记忆，自己写的日记，都可以加入参考的范围啊」）。
    // 她 961 汉字的来历（弄堂、石库门、阿婆、作文、星野水手、画的小章鱼…）**从来没进过参考范围** ——
    // 底稿文件写着「完整故事留着，被问起时才需要」，那个机制一直没实现。
    // 现在实现它：**问到她的过去/来历时才注入**，平时零成本。
    // 判断在 `storyscope.mjs` 里（唯一一处），这里只调它。
    const storyScope = await pickStoryScope(text);
    // ⭐ **她学到的说话习惯**（第二十六轮第三档第二项）：
    // 每轮都带上（最多 5 条，不多）—— 学到了就要用得上。
    const styleBlock = buildStyleBlock(styleMem);
    // ⭐ **心情 / 亲近程度**（第三十七轮）：**只在用户明确问起时**才告诉她自己 ——
    //   判据 = 用户原话（chatter.mjs 的 heartAskTopics），
    //   **不读模型输出文本**（契约 §6.1 判据纪律）。平时一个字节都不花。
    const heartTopics = heartAskTopics(text);
    const heartInfo =
      heartTopics.heart || heartTopics.intimacy
        ? { heart: state.heart, intimacy: state.intimacy, topics: heartTopics }
        : null;
    const input = assembleChatInput({
      text,
      summary,
      naming: buildNamingLine(),
      baseline: fallback ? fallback.baseline : '',
      appearance: fallback ? fallback.appearance : '',
      rules: fallback ? fallback.rules : '',
      identityInFile,
      carryOver: isNewSession ? buildCarryOverBlock(text) : null,
      memory,
      storyScope,
      styleMem: styleBlock,
      // ⭐ **语气档**（契约 §6.1）：只影响措辞，不改事实。
      //   不写进 rules.md —— 规矩正文只能追加，而语气每轮都可能变。
      tone: state.currentTone(),
      // ⭐ **心情 / 亲近程度**（第三十七轮）：**只在用户明确问起时**才给 ——
      //   判据 = 用户原话（chatter.mjs 的 heartAskTopics），不读模型输出文本。
      heart: heartInfo,
    });
    if (isNewSession) await state.markPetHeadInjected();
    return input;
  }

  /**
   * 背景故事：读投影（只读一次，缓存）→ 判断这一条要不要 → 拼块。
   *
   * ⚠️ **失败不拦**：读不到投影 / 判断出错 ⇒ 这一轮就当没有故事块（退回旧行为）。
   * @param {string} text 老板这一轮说的话
   * @returns {Promise<string | null>} 空 = 这一轮不注入
   */
  async function pickStoryScope(text) {
    try {
      const body = await loadStoryBody();
      if (!body) return null;
      const verdict = shouldLoadStory(text, body);
      if (!verdict.triggered) return null;
      return buildStoryBlock(body);
    } catch (error) {
      context.logger.warn('miniapp.agent.storyscope.failed', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
  }

  /**
   * 故事正文（投影）—— **只读一次**，之后走缓存。
   *
   * 真源 `mmx-character/persona/story-mmx-origin.md` 的正文由
   * `mmx-character/tools/sync_story_scope.py` 投影到 `identity/STORY.md`。
   * @returns {Promise<string>}
   */
  let storyBodyPromise = null;
  function loadStoryBody() {
    if (!storyBodyPromise) {
      storyBodyPromise = readFile(
        join(context.pluginRoot, 'miniapp', 'node', 'identity', 'STORY.md'),
        'utf8'
      )
        .then((raw) => parseStoryBody(raw))
        .catch(() => '');
    }
    return storyBodyPromise;
  }

  /**
   * 换会话时带上的「上一段聊到这」。
   *
   * 新会话是空的 —— 不带这一段，她一上来就失忆，用户会觉得「刚才不是聊得好好的吗」。
   * 用聊天历史里的**原话摘录**，不另花一次模型调用（也就没有「总结歪了」的风险）。
   * @param {string} currentText 这一轮用户刚说的话（要从摘录里剔掉，别重复一次）
   * @returns {string} 空串 = 没有可接续的内容
   */
  function buildCarryOverBlock(currentText) {
    if (!state.chat) return '';
    const list = state.chat.list();
    // 最后一条就是**这一轮**用户刚说的话 —— 它已经在 [用户消息] 里了，不该再出现一次。
    const last = list[list.length - 1];
    const trimmed =
      last && last.role === 'user' && last.text === currentText ? list.slice(0, -1) : list;
    return buildCarryOver(trimmed, { herName: state.naming.herName });
  }

  /**
   * 落一条她的消息并广播。
   * @param {string} text
   * @param {string} [id]
   * @returns {Promise<any>}
   */
  async function sayHerMessage(text, id) {
    // ★ **落库前剥皮**（2026-10-31 第二十九轮）—— 她的话进聊天区的**唯一出口**。
    //
    // ⚠️ **为什么在这里剥**：聊天回复 / 提问 / 闲话三条路径都走这个函数 ⇒ 一处覆盖全部。
    //
    // ⚠️ **剥空了怎么办**（2026-10-31 真机实测改口径）：
    //   老口径「剥空 ⇒ 保留原话」⇒ 被剥空的那 14 条**原样落进 chat.json**
    //   ⇒ 老板报的越界①（闲聊里真的去调工具翻源码 + 报过程）**根本没修掉**。
    // ⇒ **新口径**：剥空 ⇒ **这条不落库**（chat.json 不留痕），
    //   并且**把页面上那个气泡也撤掉**（同一个 id 广播一条空文本 ⇒ 客户端按 id 覆盖）。
    //   ⚠️ **没有 id 的调用**（遗留降级路径）⇒ 屏幕上本来就没有气泡 ⇒ **保留原话**，
    //     否则老板的问题会被吞掉（详见 `pickFinalText` 的说明）。
    const scrubbed = scrubText(text);
    const finalText = pickFinalText(text, scrubbed, { hasBubble: Boolean(id) });
    if (!finalText) {
      // 撤气泡：同一个 id 广播空文本，客户端按 id 覆盖后把这条摘掉 ⇒ 页面和 chat.json 对得上。
      if (id) {
        broadcastChat({ type: 'message', message: { id, role: 'her', text: '', at: Date.now() } });
      }
      return null;
    }
    const message = await state.appendMessage('her', finalText, id);
    broadcastChat({ type: 'message', message });
    return message;
  }

  /**
   * 跑一轮对话（契约 v3 §5 的第 7~11 步）。
   * @param {{text: string, sessionId: string | null, epoch: number}} turn
   */
  async function runChatTurn({ text, sessionId, epoch }) {
    /** 累积的增量文本：run 没给出 text 时兜底 */
    let delta = '';
    /**
     * 这一轮回复的**流式切分器**：她的回复按断点切成多条短消息，
     * 一条一条冒出来（老板 2026-10-28 口径：一次回好几条短句）。
     *
     * ⚠️ 流式只是**乐观预告** —— 宿主可能丢 `text.delta`。
     * 最终落库一律以 `message.committed` 的完整正文为准（下面落定段），
     * 切分规则两边共用 `replyflow.mjs` 的同一个真源，所以边界必然对齐。
     */
    // ⚠️ **第三十七轮**：用户这一条很短 ⇒ 这一轮的回复预算收紧
    //   （规矩第 27 条「少说两句」不只是提示，服务端也兜一道）。
    //   ⚠️ **按块收口**（replyflow 的 Chunker）⇒ 不会切出半截话。
    const replyBudget =
      textLength(text) <= SHORT_USER_MAX ? REPLY_MAX_CHARS_SHORT : REPLY_MAX_CHARS;
    const flow = new ReplyFlow(() => chat.nextId(), replyBudget);
    /**
     * 已经定稿的短消息（id 在 `message.committed` 事件里就发好了）。
     * @type {{id: string, text: string}[]}
     */
    const sealedParts = [];
    let status = 'finished';
    /** 看门狗有没有开火：开火了说明这一轮卡住了，不是普通失败 */
    let watchdogFired = false;
    /** 看门狗定时器 */
    let watchdog = null;
    /** 宿主实际发过来的事件类型：用来核对「她到底卡在哪种交互上」 */
    const seenEventTypes = new Set();
    /** 这一轮失败的原因文案（看门狗和普通失败走不同的说法） */
    let failureNote = null;

    try {
      // 优雅降级：老宿主 / 用户关掉了 session.run。
      // 受理照旧：用户的消息已经进历史；通道不通这件事**只走气泡**（通知不进聊天区），不调 run。
      if (!sessionId || !agentReady()) {
        state.appendLog('聊天', '已受理，但当前没有可用的 Agent 通道');
        await state.commit();
        context.logger.warn('miniapp.agent.chat.unavailable');
        // ★ 降级话术走台词库（D 类 func.no_channel）—— 话术是代码常量，不另写一份。
        await speakSceneLine('func.no_channel', '降级').catch(() => undefined);
        await state.setMood('idle');
        return;
      }

      // 身份层先落位（AGENTS.md），再拼这一轮的话。
      // 必须在 run 之前 —— 宿主每轮重读那个文件，写晚了这一轮就还用旧身份。
      // 失败不拦：降级路径会把身份层拼进 user 消息（见 buildChatInput）。
      await ensureIdentityFile(sessionId);

      const input = await buildChatInput(text);

      // 看门狗：她要是停在等答案的状态，run 自己不会结束（宿主没有超时），
      // 到点就掐断，把 chatBusy 和 run slot 还回来。
      const controller = new AbortController();
      state.setAgentTracking({ eventTypes: [] });
      watchdog = setTimeout(() => {
        watchdogFired = true;
        context.logger.warn('miniapp.agent.chat.timeout', { sessionId });
        controller.abort();
      }, CHAT_TURN_TIMEOUT);

      const result = await context.agent.run(
        { text: input, sessionId },
        {
          signal: mergeSignals(context.signal, controller.signal),
          onEvent: (event) => {
            if (!event || typeof event !== 'object') return;
            const type = String(event.type ?? '');
            // 审批/问卷可能来自子会话：要用事件里的 sessionId，别换成 root 的。
            const eventSessionId =
              typeof event.sessionId === 'string' && event.sessionId ? event.sessionId : sessionId;

            // 每种事件类型只记第一次：出问题时能一眼看出宿主到底发了什么。
            if (type && !seenEventTypes.has(type)) {
              seenEventTypes.add(type);
              // 宿主不落 Mini App 的 logger，事件类型只能挂到快照上才看得见。
              state.setAgentTracking({ eventTypes: [...seenEventTypes] });
              context.logger.info('miniapp.agent.chat.event', {
                type,
                sessionId: eventSessionId,
                turnId: typeof event.turnId === 'string' ? event.turnId : undefined,
              });
            }

            if (type === 'turn.started') {
              void state.setAgentState('thinking');
            } else if (type === 'text.delta') {
              const piece = String(event.text ?? '');
              delta += piece;
              // 增量帧按断点逐条收口：一条短句一个气泡 id，不再全堆进同一个气泡。
              for (const action of flow.pushDelta(piece)) {
                if (action.kind === 'seal') {
                  broadcastChat({
                    type: 'message',
                    message: { id: action.id, role: 'her', text: action.text, at: Date.now() },
                  });
                } else {
                  broadcastChat({ type: 'delta', id: action.id, text: action.text });
                }
              }
            } else if (type === 'message.committed') {
              // 一条 committed = 她的一次完整回复 → 立刻切成若干条短消息。
              //
              // ⚠️ **id 在这里就发好**（复用流式已经用掉的那些 id），
              // 但**落库要等 epoch 校验之后** —— 顺序反了，页面上的气泡就和落盘的正文对不上。
              sealedParts.push(...flow.commit(clip(String(event.text ?? ''), 4000)));
            } else if (type === 'permission.requested') {
              const requestId = String(event.requestId ?? '');
              const toolName = String(event.toolName ?? '工具');
              void state.setPendingInteraction({
                type: 'permission',
                requestId,
                sessionId: eventSessionId,
                toolName,
                reason: event.reason ?? '',
                toolInput: event.toolInput ?? null,
                at: Date.now(),
              });
              broadcastChat({
                type: 'permission',
                requestId,
                toolName,
                reason: event.reason ?? '',
                toolInput: event.toolInput ?? null,
              });
              void state
                .say(clip(`她想用一下 ${toolName}，要允许吗？`, 300), 'MMX')
                .catch(() => undefined);
            } else if (type === 'question.requested') {
              // ⚠️ **问卷已撤掉**（老板 2026-10-29：「不要问卷，聊天哪有给人家发问卷的」）。
              // 这里**不渲染任何卡片**、**不设 pendingInteraction**（没有问卷要答），
              // 而是把问题**降级成她的一条普通消息** —— 她用嘴问，用户在聊天框打字回。
              // 聊天是对话，不是填表。
              const requestId = String(event.requestId ?? '');
              const questionText = questionTextOf(event.request ?? null);
              if (questionText) {
                void (async () => {
                  for (const part of splitChunks(questionText)) {
                    await sayHerMessage(part);
                  }
                })().catch(() => undefined);
              }
              // 通知走气泡：浮窗用户看不见面板，得让她先开口。
              void state.say('我有个问题想问你～', 'MMX').catch(() => undefined);
              // 宿主那边那个问卷就让它自然过期（宿主会给它 60 秒倒计时）。
              // ⚠️ **不能在这里 answer()**：paused run 还没 resolve，answer 会 BUSY。
              broadcastChat({ type: 'question_as_text', requestId });
            }
          },
        }
      );

      status = String(result?.status ?? 'finished');

      // 看门狗掐断后 run 可能正常 resolve 成 aborted —— 那也是「这一轮没跑完」。
      if (watchdogFired) {
        status = 'error';
        failureNote = STUCK_NOTE;
      }

      // 用户在等答案时清空过对话：这轮的话就不该再冒出来。
      if (epoch !== chatEpoch) return;

      // 每条 message.committed 落成**若干条短消息**（老板 2026-10-28 口径）。
      //
      // ⚠️ **以 committed 的完整正文为准，不用流式结果**：
      // 宿主可能丢 `text.delta`（规范原文：events back up 时 delta may be dropped），
      // 所以流式切出来的段只当「乐观预告」。两边共用 `replyflow.mjs` 的同一个
      // 切分真源 → 边界必然一致，页面上的气泡和落盘的正文对得上。
      //
      // `sealedParts` 在 `message.committed` 事件里就切好了（id 也发好了），
      // 这里只负责落库 —— 用户中途清空过对话的话，这轮就不该冒出来。
      let parts = sealedParts;
      if (!parts.length) {
        // 宿主没给 message.committed：退回到 run 的结果正文 / 累积的增量。
        const fallback = result?.text ? String(result.text) : delta;
        if (fallback) parts = flow.commit(clip(fallback, 4000));
      }
      // ★ **表达独立决策环节**（第二十六轮第三档第一项）：
      // 表情 / 口语不在大提示词里决定（那部分实测证实推不动），在这里单独定。
      // ⚠️ **放在落库前**：这里定下的文字才是页面上那条。
      if (parts.length) {
        const expressed = applyExpress(parts, {
          scene: detectScene(text),
          history: expressHistory,
          used: expressUsed,
        });
        parts = expressed.parts;
        expressHistory = pushExpressHistory(expressHistory, expressed.decision);
        // ⚠️ **第二十八轮**：一轮可能贴多个表情 ⇒ 轮换池要把**全部**用过的收进来，
        //   口语也要收（否则「嗯…」永远是同一个 ⇒ 贴纸感）。
        const usedNow = [
          ...(Array.isArray(expressed.decision.emojiAll) ? expressed.decision.emojiAll : []),
          ...(expressed.decision.emoji ? [expressed.decision.emoji] : []),
          ...(expressed.decision.spoken ? [expressed.decision.spoken] : []),
        ];
        if (usedNow.length) {
          expressUsed = [...usedNow, ...expressUsed].slice(0, 8);
        }
      }
      let lastHer = null;
      /** 整轮兜底用：第一条被剥空的原话（整轮都没落库时才用得上） */
      let droppedPart = null;
      for (const part of parts) {
        const message = await sayHerMessage(part.text, part.id);
        if (message) {
          lastHer = message;
        } else if (!droppedPart) {
          droppedPart = part;
        }
      }
      // ⚠️ **整轮兜底**（2026-10-31 真机实测改口径）：
      //   这一轮的话**全部**被剥空 ⇒ 老板发了一句话却一个字都没得到
      //   ⇒ 保留第一条原话（宁可漏杀一次，也不给老板一个死轮）。
      //   真机 35 轮里 **0 次**触发（剥皮整条剥掉 14 条，散在 9 轮里）⇒ 这是兜底，不是常态。
      if (!lastHer && droppedPart) {
        const message = await state.appendMessage('her', droppedPart.text, droppedPart.id);
        broadcastChat({ type: 'message', message });
        lastHer = message;
      }

      // 有问卷 → **降级成她的一条普通消息**（老板 2026-10-29 撤掉问卷机制）。
      // 不渲染卡片、不设 pendingInteraction；她用嘴问，用户在聊天框打字回。
      const pending = result?.pendingQuestion;
      if (pending) {
        const questionText = clip(
          typeof pending === 'string'
            ? pending
            : String(pending?.text ?? pending?.question ?? pending?.request?.question ?? ''),
          4000
        );
        if (questionText) {
          // 提问也是她的话 —— 同样按短句切开，别甩一整块过来。
          for (const part of splitChunks(questionText)) {
            const message = await sayHerMessage(part);
            lastHer = message;
          }
        }
        // ⚠️ **不 markPetSessionDirty**：
        // 原来标脏是为了「那个 run slot 还占着，下轮重建会话」。
        // 现在问卷不设 pending、会话照常用 —— 用户下一句回答她时，
        // 她**还记得自己刚才问了什么**（标脏 = 换新会话 = 她当场失忆）。
        // 宿主那边的问卷用 `skipped` 结算掉（见 `skipQuestion()`），
        // slot 不会被占死；结算失败就让宿主自己过期（它有 60 秒倒计时）。
        const requestId = String(pending?.requestId ?? '');
        if (requestId) {
          void skipQuestion({
            sessionId: String(result?.sessionId ?? sessionId),
            requestId,
            request: pending?.request ?? null,
          }).catch(() => undefined);
        }
      }

      // 通知走气泡，聊天区只留对话（2026-10-28 老板拍板）。
      if (status === 'error') {
        const reason = String(result?.error?.message ?? result?.error ?? '未知原因');
        // ⚠️ **技术细节留痕，不进气泡** —— 气泡给她说人话。
        state.appendLog('聊天', failureNote ?? `这一轮没跑完：${reason}。你再问我一次就好。`);
        if (failureNote) {
          // 看门狗掐断 = 卡住（在等一个没人回答的问题），不是失败 ⇒ 保留原来那句人话。
          await state.say(failureNote, 'MMX').catch(() => undefined);
        } else {
          // 普通失败 ⇒ 走台词库的降级话术（D 类 func.llm_failed）。
          await speakSceneLine('func.llm_failed', '降级').catch(() => undefined);
        }
      }

      // 她的回复只进聊天区，**不再复制到气泡** —— 气泡和聊天是两条通道：
      // 气泡装通知与碎碎念，聊天区装对话。
      if (lastHer) {
        await state.setAgentState('done');
      } else {
        await state.setMood('idle');
      }

      // ===== 「每天至少记录一次」（老板 2026-10-29）=====
      //
      // 聊天**结束**之后，如果今天还没写过日记 → 让她自己写一篇。
      //
      // ⚠️ **为什么挂在聊天后面，而不是定时器**：
      // 定时器（每天固定时间）要求 Mini App 一直活着，而且她会在用户不在的时候
      // 凭空编一篇没发生的事。挂在聊天后面 —— **有话可说才写**，写出来的才是真的。
      //
      // ⚠️ **每天只自动写一次**：`diary.voidToday()` 是硬判据。
      // ⚠️ **没有「一天最多 N 篇」的闸门了**（老板 2026-10-29 要求去掉）；
      // 要写几篇由她自己决定 —— 触发权在她，不在闸门。
      //
      // ⚠️ **不阻塞这一轮**：日记是异步的，写不成功也不该影响聊天。
      if (epoch === chatEpoch && diary.voidToday()) {
        void writeDiary().catch((error) => {
          context.logger.warn('miniapp.agent.diary.auto_failed', {
            reason: error instanceof Error ? error.message : 'unknown',
          });
        });
      }
      // ★ **学说话习惯**（第二十六轮第三档第二项）：
      // ⚠️ **触发点不在这里** —— 见 `finally` 块里的同名注释。
      //   （这里 `state.chatBusy` 还没清 ⇒ `!state.chatBusy` 恒假 ⇒ 永远不触发。
      //     真机实测：聊完一轮，`style.json` 压根没生成。）
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      context.logger.warn('miniapp.agent.chat.failed', { reason, watchdog: watchdogFired });
      status = 'error';
      if (epoch === chatEpoch) {
        failureNote = watchdogFired ? STUCK_NOTE : `这一轮没跑完：${reason}。你再问我一次就好。`;
        state.appendLog('聊天', failureNote);
        await state.commit();
        // 跑挂了也把会话标脏：run slot 可能还占着，下一问重建会话。
        await state.markPetSessionDirty();
        // 通知走气泡，聊天区只留对话。
        await state.say(failureNote, 'MMX').catch(() => undefined);
        await state.setMood('idle');
      }
    } finally {
      if (watchdog) clearTimeout(watchdog);
      // 闸门归位 + 广播。done 帧必须在 question.requested 之后发。
      chatTurn.active = false;
      await state.setChatBusy(false).catch(() => undefined);
      broadcastChat({ type: 'busy', busy: false });
      broadcastChat({ type: 'done', status });
      await state.clearAsking().catch(() => undefined);

      // ★ **学说话习惯**（第二十六轮第三档第二项）：
      // ⚠️ **必须放在这里（finally 里、busy 归位之后）**：
      //   之前它挂在 `try` 段的末尾 —— 那时 `state.chatBusy` **还没清**
      //   （它要到下面的 `setChatBusy(false)` 才清）⇒ 条件里的
      //   `!state.chatBusy` **恒假** ⇒ 这个功能**永远不触发**。
      //   真机实测：聊完一轮，`style.json` 压根没生成。
      //   ⇒ 「机制写好了」不等于「机制会跑」—— 这就是活生生的例子。
      // ⚠️ **不阻塞这一轮**：异步跑，失败不影响聊天。
      // ⚠️ **失败的那轮不学**（`status === 'error'` 时她的话是残的，学了是垃圾）。
      if (status !== 'error' && epoch === chatEpoch && styleMem.voidToday()) {
        void learnStyle().catch((error) => {
          context.logger.warn('miniapp.agent.style.auto_failed', {
            reason: error instanceof Error ? error.message : 'unknown',
          });
        });
      }
    }
  }

  /**
   * 把宿主发来的问卷**结算掉**（不显示、不作答）。
   *
   * ⚠️ **为什么还需要结算**（老板 2026-10-29 撤掉问卷机制）：
   * 撤掉的是**人机界面**（不再给用户一张选择框卡片），不是宿主那边的请求本身。
   * 宿主那个问卷还挂着 → 那个会话的 run slot 可能一直被占着 → 后面每一轮都 BUSY。
   * 所以这里用 **`skipped` 答案**把它结算掉（`answers` 结构见 runtime-api.md:372-373，
   * `selectedOther` 是必填，`skipped` 表示「这一问不答」）。
   *
   * ⚠️ **静默**：这个续接轮次的输出**一律丢弃** —— 用户看到的是
   * 「她问了一句」，然后自己打字回；再来一句莫名其妙的续接只会更乱。
   *
   * ⚠️ **answer() 必须等 paused run resolve 之后**，否则 BUSY。
   * 所以只有 `result.pendingQuestion` 那条路径能走到这里（run 已经 resolve 了）；
   * `question.requested` 那条（paused run 还没 resolve）**不能**结算，让宿主自己过期。
   *
   * @param {{sessionId: string, requestId: string, request: any}} question
   */
  async function skipQuestion({ sessionId, requestId, request }) {
    if (!context.agent || typeof context.agent.answer !== 'function') return;
    const steps = Array.isArray(request?.steps) ? request.steps : [];
    const answers = steps.map((step) => ({
      stepId: String(step?.id ?? ''),
      selectedOptionIds: [],
      // selectedOther 是必填的（宿主类型 MiniAppAgentQuestionAnswer）。
      selectedOther: false,
      skipped: true,
    }));
    if (!answers.length) {
      // 没有 step 就没有 stepId 可填 —— 干脆不结算，让宿主自己过期（它有倒计时）。
      return;
    }
    const controller = new AbortController();
    const watchdog = setTimeout(() => {
      context.logger.warn('miniapp.agent.skip.timeout', { sessionId, requestId });
      controller.abort();
    }, CHAT_TURN_TIMEOUT);
    try {
      await context.agent.answer(
        { sessionId, requestId, answers },
        { signal: mergeSignals(context.signal, controller.signal) }
      );
    } catch (error) {
      // 结算失败不算事：宿主那边的问卷会自己过期（60 秒倒计时），
      // 用户那边完全无感（他已经看到她的文字提问了）。
      const reason = error instanceof Error ? error.message : 'unknown';
      context.logger.warn('miniapp.agent.skip.failed', { reason });
    } finally {
      clearTimeout(watchdog);
    }
  }

  // ===== 她的日记本 =====
  //
  // 老板 2026-10-29：「进去之后，是一个日记本，或者是像QQ空间每天发动态的感觉，
  // 每天至少记录一次，其他时间也可以写，但别太频繁，每一次字数不要太多。」
  //
  // ⚠️ **老板 2026-10-29 改口**：「为什么要设置一天只能写三篇，去掉这个设置，
  // 撤掉按钮也去掉，她写日记我为啥要删除，下面的说点什么，让她写，和发表也不要，
  // 但是可以添加点赞和评论。评论后她可以回复。」
  //
  // **规则的真源在 `diary.mjs`**（`MAX_CHARS` / `MAX_COMMENT_CHARS` / `dayKey`），
  // 这里做四件事：读出来、让她写一篇、记点赞、回评论。

  /** 日记正在写（防并发：写日记和回评论都不该同时起两个 run）。 */
  let diaryWriting = false;

  /** 回复评论的**串行队列**（一次一个 run —— 并发会抢 Agent slot，回复也会乱序）。 */
  let replyChain = Promise.resolve();

  /**
   * 让她自己写一篇日记。
   *
   * ⚠️ **走她自己的专属会话**，不是新建一个 —— 她的日记要接着她聊过的东西写，
   * 新会话里她什么都不记得，写出来就是空话。
   *
   * ⚠️ **不进聊天区** —— 日记是她的独白。写完只落 `diary.json` + 推给页面。
   * 如果进了聊天区，用户会以为她在回话，其实她在写日记（那就串味了）。
   *
   * ⚠️ **没有「一天最多 N 篇」的闸门了**（老板 2026-10-29 要求去掉）。
   *
   * @returns {Promise<{ok: boolean, entry?: any, error?: string, reason?: string}>}
   */
  /**
   * **她学一些老板的说话习惯**（第二十六轮第三档第二项）。
   *
   * ⚠️ **结构照 `learn_style`（MaiBot）**，**内容全部自己写**：
   * 每条 = `场景` + `表达方式` + `来源编号`（可溯源）。
   * 三条排除规则（不学表情包/图片、不学自己的发言、不涉具体人名名词）。
   *
   * ⚠️ **话太少不学**：老板还没说几句字、学了也是空的。
   * ⚠️ **失败不报错**：学不到就不学，不影响聊天。
   */
  async function learnStyle() {
    if (styleWriting) return { ok: false, reason: 'BUSY' };
    if (!agentReady()) return { ok: false, reason: 'AGENT_UNAVAILABLE' };
    // ⚠️ **只学老板说的话**（不学她自己的）—— 排除规则在输入层就挡住。
    const lines = pickSourceLines(chat.list());
    if (lines.length < 3) return { ok: false, reason: 'TOO_FEW_LINES' };
    styleWriting = true;
    try {
      const sessionId = await ensurePetSession();
      await ensureIdentityFile(sessionId);
      const prompt = buildStylePrompt(lines);
      const controller = new AbortController();
      const watchdog = setTimeout(() => {
        context.logger.warn('miniapp.agent.style.timeout', { sessionId });
        controller.abort();
      }, CHAT_TURN_TIMEOUT);
      try {
        const result = await context.agent.run(
          { text: prompt, sessionId },
          { signal: mergeSignals(context.signal, controller.signal) }
        );
        const parsed = parseStyleOutput(result?.text);
        if (!parsed.items.length) {
          context.logger.warn('miniapp.agent.style.empty', { rejected: parsed.rejected.length });
          return { ok: false, reason: 'EMPTY', rejected: parsed.rejected };
        }
        await styleMem.replace(parsed.items);
        return { ok: true, items: parsed.items.length };
      } finally {
        clearTimeout(watchdog);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      context.logger.warn('miniapp.agent.style.failed', { reason });
      return { ok: false, reason };
    } finally {
      styleWriting = false;
    }
  }

  async function writeDiary() {
    // 她自己写：走一次 Agent。
    if (diaryWriting) return { ok: false, error: 'BUSY', reason: '她正在写这一篇。' };
    if (!agentReady()) {
      return { ok: false, error: 'AGENT_UNAVAILABLE', reason: '现在接不上 Agent 通道。' };
    }
    diaryWriting = true;
    try {
      const sessionId = await ensurePetSession();
      await ensureIdentityFile(sessionId);
      const prompt = buildDiaryPrompt();
      const controller = new AbortController();
      const watchdog = setTimeout(() => {
        context.logger.warn('miniapp.agent.diary.timeout', { sessionId });
        controller.abort();
      }, CHAT_TURN_TIMEOUT);
      try {
        const result = await context.agent.run(
          { text: prompt, sessionId },
          { signal: mergeSignals(context.signal, controller.signal) }
        );
        const body = clip(String(result?.text ?? ''), DIARY_MAX_CHARS * 2);
        if (!body) {
          return { ok: false, error: 'EMPTY_TEXT', reason: '她这次没写出来。' };
        }
        const entry = await diary.write(body, { author: 'her' });
        broadcastDiary();
        return { ok: true, entry };
      } finally {
        clearTimeout(watchdog);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      context.logger.warn('miniapp.agent.diary.failed', { reason });
      return { ok: false, error: 'DIARY_FAILED', reason: '她这次没写出来。' };
    } finally {
      diaryWriting = false;
    }
  }

  /**
   * **她回复一条评论**（老板 2026-10-29：评论后她可以回复）。
   *
   * ⚠️ **走她自己的专属会话** —— 她得记得自己那篇日记写了什么，才接得上话。
   * ⚠️ **有看门狗** —— 宿主不给 run 超时，卡住就是永久卡住。
   * ⚠️ **串行** —— 一次只回一条，回复按评论顺序落（`replyChain`）。
   * ⚠️ **不阻塞用户** —— 评论先落盘先返回，她的回复异步来（页面显示「她正在回复…」）。
   *
   * @param {string} entryId 日记 id
   * @param {string} commentId 评论 id
   * @returns {Promise<void>}
   */
  async function writeDiaryReply(entryId, commentId) {
    const entry = diary.find(entryId);
    const comment = entry?.comments.find((item) => item.id === commentId);
    if (!entry || !comment) return;
    const task = async () => {
      if (!agentReady()) {
        await diary.clearReplying(entryId, commentId).catch(() => undefined);
        broadcastDiary();
        return;
      }
      try {
        const sessionId = await ensurePetSession();
        await ensureIdentityFile(sessionId);
        const prompt = buildDiaryReplyPrompt(entry.text, comment.text);
        const controller = new AbortController();
        const watchdog = setTimeout(() => {
          context.logger.warn('miniapp.agent.diary.reply_timeout', { sessionId });
          controller.abort();
        }, CHAT_TURN_TIMEOUT);
        try {
          const result = await context.agent.run(
            { text: prompt, sessionId },
            { signal: mergeSignals(context.signal, controller.signal) }
          );
          const body = clip(String(result?.text ?? ''), DIARY_MAX_CHARS);
          if (!body) {
            await diary.clearReplying(entryId, commentId).catch(() => undefined);
            broadcastDiary();
            return;
          }
          await diary.setReply(entryId, commentId, body);
          broadcastDiary();
        } finally {
          clearTimeout(watchdog);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown';
        context.logger.warn('miniapp.agent.diary.reply_failed', { reason });
        await diary.clearReplying(entryId, commentId).catch(() => undefined);
        broadcastDiary();
      }
    };
    // 串行入队：前一条回复没落完，下一条先等着。
    const next = replyChain.then(task, task);
    replyChain = next.then(
      () => undefined,
      () => undefined
    );
    await next;
  }

  /**
   * 「写一篇日记」这段指令。
   *
   * ⚠️ **只说「写日记」+ 长度上限 + 语气要求**，不多说：
   * 多说一点她就会开始解释「我今天要写日记了」，写出来全是废话。
   *
   * ⭐ **带上她最近写过的**（老板 2026-10-29）：
   * 原来写的时候她眼前是空的 —— 所以会说「**又**让我写日记」，
   * 也会把同一件事写两遍（2026-10-29 真机实证）。
   * 现在她知道自己写过什么，就写得出「接着上次往下写」的东西。
   * 挑哪几篇在 `memory.mjs` 的 `buildRecentDiaryContext()` 里。
   *
   * @returns {string}
   */
  function buildDiaryPrompt() {
    const recent = buildRecentDiaryContext(diary.list());
    return (
      '[写日记]\n' +
      '写一篇你今天的日记。就写今天发生过的事、你的心情，用你自己的话。\n' +
      (recent ? recent + '\n' : '') +
      `不超过 ${DIARY_MAX_CHARS} 字，一两句话，别列条目，别写标题，别加 markdown。\n` +
      '直接写正文，别报告你在写日记。'
    );
  }

  /**
   * 「回一条评论」这段指令（老板 2026-10-29：评论后她可以回复）。
   *
   * ⚠️ **把她的日记正文一起给她** —— 她得知道自己写了什么，才接得上话。
   * ⚠️ **只说「回他一句」+ 长度上限 + 语气要求** —— 多说她就会开始解释。
   *
   * @param {string} entryText 日记正文
   * @param {string} commentText 用户的评论
   * @returns {string}
   */
  function buildDiaryReplyPrompt(entryText, commentText) {
    return (
      '[回评论]\n' +
      `你刚写了一篇日记：\n「${clip(entryText, DIARY_MAX_CHARS)}」\n` +
      `对方评论：${clip(commentText, DIARY_MAX_COMMENT_CHARS)}\n` +
      `回他一句，不超过 ${DIARY_MAX_CHARS} 字，别列条目，别写标题，别加 markdown。\n` +
      '直接写回复本身，别报告你在回评论。'
    );
  }

  /**
   * 把日记推给页面（打开日记本时它可能开着）。
   */
  function broadcastDiary() {
    broadcastChat({ type: 'diary', entries: diary.list(), status: diaryStatus(diary) });
  }

  context.logger.info('miniapp.runtime.listening');

  // 闲话检查：到点看一次，用户安静够久就让她自己开口说一句。
  // ⚠️ **不 unref 也行**，但这里 unref 一下 —— 不想让这个定时器把进程钉住。
  idleTimer = setInterval(() => {
    void tickIdleTalk();
  }, IDLE_DEFAULTS.tickMs);
  idleTimer.unref?.();

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    // 观察通道自己收尾（掐断订阅 + 停掉看板计时器）。
    observe.dispose();
    // 闲话计时器也收掉（别让收尾之后还在跑）。
    if (idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
    state.dispose();
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // 忽略关闭时的异常。
      }
    }
    sseClients.clear();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  };

  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  // state 一并返回：宿主用不到，但自检要能直接驱动它（比如造一条闲话）。
  // port 也一并返回：`context.listen.port` 传 0 时（自检）真实端口只能从这里拿。
  return { dispose, state, port: actualPort };
}