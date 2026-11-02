// @ts-check

/**
 * 章鱼娘的状态机（领域服务）。
 *
 * 所有改动都从这里走：页面请求、MCP 工具、Agent 事件观察，共用同一个实例。
 * 先落盘再广播，保证页面、MCP、后台看到的永远是同一份状态。
 *
 * **落盘用 `atomic-json.mjs` 的唯一实现**（原子写 + 串行队列）——
 * 不在这里另写一份 `writeFile`，否则 `chat.mjs` 写一份、`state.mjs` 写一份，
 * 迟早有一份忘了原子写（历史上就发生过：`state.json` 直写，崩溃后
 * 半截 JSON 被 `load()` 静默吞掉，她的 L2 会话绑定无声丢失）。
 */

import { writeJsonAtomic, createWriteQueue } from './atomic-json.mjs';
import { textLength } from './clip.mjs';
import { pickLine } from './lines.mjs';

/**
 * 章鱼娘的表情。thinking/working 由 Agent 侧驱动。
 * celebrate 是「这一轮结束了」——**不是**「活全干完了」：
 * turn.finished 只说明根回合结束，后台子任务可能还在跑
 * （agent-interaction.md:23-26）。没有确证就不庆祝。
 */
export const MOODS = {
  idle: { label: '待机', hint: '在桌面上陪着你' },
  thinking: { label: '思考中', hint: 'MMX 正在想事情' },
  working: { label: '工作中', hint: 'MMX 正在动手' },
  celebrate: { label: '这一轮结束', hint: 'MMX 这一轮结束了（后台的活可能还在跑）' },
};

export const MOOD_KEYS = Object.keys(MOODS);

/**
 * 心情与亲密度（CONTRACT §6.1，老板 2026-10-28 拍板）。
 *
 * ⚠️ **落盘键是 `heart`，不是 `mood`** —— `mood` 已经被任务态
 * （idle/thinking/working/celebrate）占住了。契约层：任务态 = `mood`，
 * 心情 = `heart`。
 *
 * **唯一用途是选回复语气档**；**不影响事实**（她「查到了」还是「查不到」
 * 由能力与证据决定，语气档只决定同一件事**怎么说**）。
 */

/** 心情与亲密度的取值范围。 */
export const HEART_MIN = 0;
export const HEART_MAX = 100;
export const INTIMACY_MIN = 0;
export const INTIMACY_MAX = 100;

/** 久没理她：每满 30 分钟，heart −5（锚点差值算，不开定时器）。 */
export const LONELY_MS = 30 * 60 * 1000;
export const LONELY_HEART_DROP = 5;

/** 语气档（只有这三档）。 */
export const TONES = ['distant', 'familiar', 'close'];
export const TONE_LABELS = { distant: '初识', familiar: '熟悉', close: '亲近' };

/**
 * 把任意值夹到 0–100 的整数。**上限封顶、下限兜底**，
 * 不衰减、不归零（唯一归零路径是文件损坏回退默认）。
 * @param {unknown} value
 * @returns {number}
 */
export function clampValue(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return HEART_MIN;
  return Math.min(HEART_MAX, Math.max(HEART_MIN, n));
}

/**
 * 语气档 = **亲密度**分档；心情只在**同一档内**做微调（不跨档）。
 *
 * | 亲密度 | 语气档 | 表现 |
 * |---|---|---|
 * | 0–30 | distant 初识 | 短句、少语气词、略带距离感；不主动示好 |
 * | 31–70 | familiar 熟悉 | 自然平铺；偶尔主动 |
 * | 71–100 | close 亲近 | 允许一个语气词 / 一个「～」；主动表达情绪 |
 *
 * | 心情 | 同档内的调整 |
 * |---|---|
 * | ≥ 66 | bright 偏轻快：句子可稍长、允许主动搭话 |
 * | 34–65 | even 平 |
 * | ≤ 33 | quiet 偏安静：句子更短、少主动 |
 *
 * @param {number} heart
 * @param {number} intimacy
 * @returns {{tone: string, mood: string, label: string}}
 */
export function toneOf(heart, intimacy) {
  const i = clampValue(intimacy);
  const tone = i <= 30 ? 'distant' : i <= 70 ? 'familiar' : 'close';
  const h = clampValue(heart);
  const mood = h >= 66 ? 'bright' : h <= 33 ? 'quiet' : 'even';
  return { tone, mood, label: TONE_LABELS[tone] };
}

/**
 * 双通道时间闸门的冷却（毫秒）—— 契约 §6.2 第三十七轮落地。
 *
 * ⚠️ **两条通道共用一个时钟**（lastSpokeAt）：谁先说，谁把对方的窗口一并推后。
 *   这是 dsh-pet-multi 的做法（REFERENCE §4.2 J2 / C 行）：
 *   feed(category) 9s 冷却 / result(kind) 5s 冷却，**共用一个 lastWhisperAt**。
 * ⚠️ **为什么 result 更短**：结果时刻更重要 ⇒ 更容易说上话。
 */
export const SPOKE_COOLDOWN = {
  /** 碎碎念通道（交互 / 关系 / 任务 / 工作状态 / 闲话）。 */
  feed: 9000,
  /** 结果通道（完成 / 庆祝）。 */
  result: 5000,
  /**
   * **豁免通道**：降级话术必须给用户反馈 —— 吞了她就一声不吭。
   * ⚠️ **0 = 不设窗口**（不是「没登记」）：登记了但窗口是 0，
   *   闸门判据才认得这条通道（陌生通道一律按「无窗口」处理，容易漏判）。
   */
  exempt: 0,
};

/**
 * 闸门判据（**纯函数** —— 不读时钟、不读状态，判据要能被抓）。
 *
 * @param {string} channel feed / result
 * @param {number} lastSpokeAt 上一次开口的时间戳（0 = 还没说过）
 * @param {number} [now] 现在
 * @returns {boolean} 能不能说
 */
export function spokeGateOpen(channel, lastSpokeAt, now = Date.now()) {
  const cd = Number(SPOKE_COOLDOWN[String(channel ?? '')]) || 0;
  if (!cd) return true;
  const last = Number(lastSpokeAt) || 0;
  if (!last) return true;
  return Number(now) - last >= cd;
}

/**
 * 心情的说法（**用词，不是数字**）—— 契约 §6.1「用户明确问起时她口头说明」。
 *
 * ⚠️ **阈值跟 toneOf 同源**（≥66 偏轻快 / ≤33 偏安静）—— 两处不漂移。
 * @param {number} heart
 * @returns {string}
 */
export function heartWord(heart) {
  const h = clampValue(heart);
  if (h >= 66) return '挺不错';
  if (h <= 33) return '有点闷';
  return '普普通通';
}

/**
 * 亲近程度的说法（**用词，不是数字**）。
 * @param {number} intimacy
 * @returns {string}
 */
export function intimacyWord(intimacy) {
  const i = clampValue(intimacy);
  if (i <= 30) return '还有点生分';
  if (i <= 70) return '已经挺熟了';
  return '很亲近了';
}

/** 浮窗可停靠的位置。 */
export const ANCHORS = {
  'bottom-right': { label: '右下角' },
  'bottom-left': { label: '左下角' },
  'top-right': { label: '右上角' },
  'center': { label: '屏幕中间' },
};

/** 观察范围。current=只跟随当前会话，global=整个 MCode 的所有会话。 */
export const SCOPES = {
  current: { label: '跟随当前会话' },
  global: { label: '整个 MCode' },
};

export const SCOPE_KEYS = Object.keys(SCOPES);

const MAX_LOG = 60;
const CELEBRATE_MS = 4500;
const BUBBLE_MS = 12000;
const MAX_BUBBLE_QUEUE = 20;

/**
 * 气泡的来源类别 —— 排队顺序只看这个，别处不再另立判断。
 *
 * manual：用户明确让她说（面板设置区的「让她说一句话」）。
 * trigger：Agent / 系统有事要说（mmx_say、会话结束播报、她的回复、审批请求）。
 * idle：自动闲话 —— **唯一不抢占的一类**。
 *
 * manual 与 trigger 在顺序上同权，区分它们是为了日志与后续规则（比如
 * 「闲话频率」只管 idle），不是为了谁压谁。
 */
export const BUBBLE_KIND = { MANUAL: 'manual', TRIGGER: 'trigger', IDLE: 'idle' };

/**
 * 称呼配置（老板 2026-10-28 拍板：「叫什么和称呼由用户设定」）。
 *
 * 两个字段都是**用户可改的**：
 *  - `herName`   —— 她的名字（面板上显示、她自称用）
 *  - `userTitle` —— 她怎么称呼用户（老板 / 主人 / 老张 …）
 *
 * **为什么不做成固定值**：截图里那条鱼叫「爸」、自称「小鱼」，
 * 固定下来就变成「设定」；让用户自己填才有「这是我的」的归属感。
 *
 * **首启要问一次**（老板原话：「第一次打开进行询问」）→ 用 `configured` 标记：
 * 没设过 = 首启，面板弹一次询问；设过了 = 设置区里随时改。
 *
 * 默认值留空 = **不硬塞一个称呼**。空着的时候引导段就不带称呼那一句，
 * 她会自然地用「你」—— 比硬塞一个错的好。
 */
export const DEFAULT_HER_NAME = 'MMX';

/** 称呼字段的长度上限（防止把引导段撑爆）。 */
export const NAME_MAX = 24;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeName(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  // 换行会把引导段切段 —— 一律换成空格
  return text.replace(/[\r\n\t]+/g, ' ').slice(0, NAME_MAX);
}

/**
 * @param {number} ms
 * @returns {string}
 */
function clock(ms) {
  const d = new Date(ms);
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export class PetState {
  /**
   * @param {string} dataDir Host 注入的运行期数据目录
   * @param {import('./chat.mjs').ChatStore | null} [chat] 聊天历史存储（独立文件）
   * @param {{bubbleMs?: number}} [options] 测试用的时长覆盖（生产不传）
   */
  constructor(dataDir, chat = null, options = {}) {
    this.dataDir = dataDir;
    this.file = `${dataDir}/state.json`;
    /**
     * 写盘串行队列。多个端点可能同时改状态并各自 commit()，
     * 串成一条链才不会「后写的先落盘」把新数据盖掉。
     * @type {(task: () => Promise<any>) => Promise<any>}
     */
    this.writeQueue = createWriteQueue();
    /** @type {import('./chat.mjs').ChatStore | null} */
    this.chat = chat;
    /** @type {string} */
    this.mood = 'idle';
    /**
     * 称呼配置（老板 2026-10-28 拍板：名字和称呼由用户设定）。
     * `configured=false` = 从没设过 = 首启要问一次。
     * @type {{herName: string, userTitle: string, configured: boolean}}
     */
    this.naming = { herName: DEFAULT_HER_NAME, userTitle: '', configured: false };
    /** @type {{text: string, at: number, kind: string, until: number} | null} */
    this.bubble = null;
    /**
     * 待播队列（运行时态，不持久化）。
     * 单槽气泡的老毛病是「后一条直接盖掉前一条」——Agent 连报三条就丢两条。
     * @type {Array<{text: string, at: number, kind: string, until: number}>}
     */
    this.bubbleQueue = [];
    /** @type {number} 一条气泡显示多久（毫秒） */
    this.bubbleMs =
      Number.isFinite(options.bubbleMs) && Number(options.bubbleMs) > 0 ? Number(options.bubbleMs) : BUBBLE_MS;
    /**
     * 台词轮换计数（按情境键）—— **持久化**。
     * ⚠️ 重启后不能又从第一句开始（用户会察觉「每次重开都那句」）。
     * @type {Record<string, number>}
     */
    this.lineCounters = {};
    /**
     * 心情 0–100（落盘键 `heart`）。**不是** `mood`（那是任务态）。
     * @type {number}
     */
    this.heart = 50;
    /**
     * 亲密度 0–100。越高越亲近 —— **唯一用途是选语气档**。
     * @type {number}
     */
    this.intimacy = 0;
    /**
     * 惰性结算锚点：上一次算过「久没理她」的时间戳。
     * ⚠️ **首次零收益也要写锚点**，否则时钟永远不动
     * （坑来自 dsh-pet-multi `settleTreatGrants`，见 REFERENCE-deepseek-pet-analysis.md §4.2 L4）。
     * @type {number}
     */
    this.lastSeenAt = 0;
    /**
     * 她此刻在做什么（片段 key / 中文动作名 / 分类 / 池）＋ 最近一次交互事件。
     * **运行时态，不持久化**（跟气泡队列一样）：
     * 重启后她不记得自己在做什么，这是对的 —— 她本来就该从零开始。
     * @type {{key?: string, name?: string, category?: string, pool?: string, event?: string, at?: number} | null}
     */
    this.scene = null;
    /**
     * 最后一次「她被碰 / 被说话」的时间戳。
     * @type {number}
     */
    this.lastTouchedAt = 0;
    /**
     * 最后一次她**开口**的时间戳（双通道时间闸门用）。
     * ⚠️ **运行时态，不落盘** —— 9 秒的窗口跨重启没意义，落盘只会给 state.json 添垃圾。
     * @type {number}
     */
    this.lastSpokeAt = 0;
    /**
     * 这一轮已经说过一句「工作 / 任务台词」没有（第三十七轮的去位规则）。
     * ⚠️ **运行时态，不落盘** —— 它只管这一轮。
     * @type {boolean}
     */
    this.roundLineSpoken = false;
    /** @type {{target: string, at: number} | null} */
    this.pendingMove = null;
    /** @type {{x: number, y: number} | null} */
    this.position = null;
    /** @type {{state: string, title: string | null, at: number} | null} */
    this.agent = null;
    /** @type {'current' | 'global'} 观察范围，默认整个 MCode */
    this.scope = 'global';
    /** @type {string | null} 「当前会话」模式下正在观察的会话（运行时目标，不持久化） */
    this.scopeSessionId = null;
    /** @type {string | null} 她的专属会话（agent.create 出来的） */
    this.petSessionId = null;
    /** @type {boolean} 专属会话卡住（pendingQuestion）时置 true，下次重新 create */
    this.petSessionDirty = false;
    /**
     * 当前专属会话**有没有注入过第一轮**（新会话的第一轮会带接续摘要）。
     *
     * 换新会话 → 这个标记要归零，否则新会话不会带接续摘要。
     * @type {boolean}
     */
    this.petHeadInjected = false;
    /**
     * **身份层是不是已经写进 agent 目录的 `AGENTS.md`**（底稿 + 规矩正文）。
     *
     * true  = 宿主每轮读那个文件 → 进 system prompt → **压缩压不掉**（正常路径）
     * false = 写失败了 → 降级：每轮把身份层拼进 user 消息（会被压缩掉）
     *
     * @type {boolean}
     */
    this.identityFileReady = false;
    /** @type {{text: string, at: number} | null} 用户正在问她的内容（临时态，不持久化） */
    this.asking = null;
    /** @type {string | null} 她的专属会话用哪个 agent */
    this.petAgent = null;
    /** @type {boolean} 她正在回话（运行时态，不持久化） */
    this.chatBusy = false;
    /** @type {boolean} 是否把 MCode 状态摘要拼进她的输入（持久化，默认开） */
    this.petAware = true;
    /**
     * 设置区看板（运行时态，不持久化）。
     * running：Node 每 30 秒查一次 sessions()；
     * recent：由 turn.finished 事件累积。
     * @type {{running: Array<{sessionId: string, title: string, status: string, sinceAt: number}>, recent: Array<{sessionId: string, title: string, status: string, finishedAt: number}>}}
     */
    this.board = { running: [], recent: [] };
    /**
     * 当前待处理的交互（运行时态，不持久化：它只在一次 run 的生命周期内有意义）。
     * @type {{type: 'permission'|'question', requestId: string, sessionId: string, toolName?: string, reason?: string, toolInput?: unknown, request?: unknown, mode?: string, ready?: boolean, at: number} | null}
     */
    this.pendingInteraction = null;
    /**
     * Agent 观察通道的自诊断。面板会显示它，
     * 这样「她没反应」时能立刻分清是事件没来，还是通道就没建起来。
     * @type {{available: boolean, capability: string, subscribed: boolean, attempts: number, sessions: number | null, sessionTitle: string | null, sessionsError: string | null, lastEventType: string | null, lastEventAt: number | null, error: string | null, eventTypes: string[]}}
     */
    this.agentTracking = {
      available: false,
      capability: 'unknown',
      subscribed: false,
      attempts: 0,
      sessions: null,
      sessionTitle: null,
      sessionsError: null,
      lastEventType: null,
      lastEventAt: null,
      error: null,
      /**
       * 这一轮对话里宿主实际发来的事件类型（去重、保序）。
       * 用来回答「她到底卡在哪种交互上」——宿主日志看不到 Mini App 的 logger，
       * 这里就是唯一能读到事件的通道。
       * @type {string[]}
       */
      eventTypes: [],
    };
    /** @type {Array<{id: string, ts: number, kind: string, text: string}>} */
    this.log = [];
    /** @type {number} */
    this.seq = 0;
    /** @type {Set<(snapshot: any) => void>} */
    this.listeners = new Set();
    /** @type {NodeJS.Timeout | null} */
    this.celebrateTimer = null;
    /** @type {NodeJS.Timeout | null} */
    this.bubbleTimer = null;
    /**
     * 页面上报的**宿主窗口状态**。
     * 浮窗「点不到 / 右键没反应 / 拖不动」这类问题只发生在宿主窗口层
     * （穿透、app-region、mode 切换），Node 侧一概看不到 —— 页面必须把它
     * 报上来，否则就只能靠人肉复现。
     * @type {{mode: string, clickThrough: boolean, lastError: string, updatedAt: number}}
     */
    this.windowState = {
      mode: 'inline',
      clickThrough: true,
      lastError: '',
      updatedAt: 0,
      x: null,
      y: null,
      /**
       * 最近一次拖动的**对账结果**（鼠标位移 / 宿主位移 / 误差）。
       * 拖动精度没法靠工具验，只能让页面自己算这笔账再报上来。
       * @type {{mouse: {x: number, y: number}, host: ({x: number, y: number} | null), error: ({x: number, y: number} | null), clamped: boolean, at: number} | null}
       */
      drag: null,
    };
  }

  /**
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(this.file, 'utf8');
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        if (typeof saved.mood === 'string' && saved.mood in MOODS) this.mood = saved.mood;
        if (Array.isArray(saved.log)) this.log = saved.log.slice(-MAX_LOG);
        if (saved.position && typeof saved.position.x === 'number') this.position = saved.position;
        if (Number.isFinite(saved.seq)) this.seq = saved.seq;
        if (typeof saved.scope === 'string' && saved.scope in SCOPES) this.scope = saved.scope;
        if (typeof saved.petSessionId === 'string' && saved.petSessionId) this.petSessionId = saved.petSessionId;
        if (typeof saved.petSessionDirty === 'boolean') this.petSessionDirty = saved.petSessionDirty;
        if (typeof saved.petHeadInjected === 'boolean') this.petHeadInjected = saved.petHeadInjected;
        if (typeof saved.identityFileReady === 'boolean') this.identityFileReady = saved.identityFileReady;
        if (typeof saved.petAgent === 'string' && saved.petAgent) this.petAgent = saved.petAgent;
        if (typeof saved.petAware === 'boolean') this.petAware = saved.petAware;
        if (saved.naming && typeof saved.naming === 'object') {
          this.naming = {
            herName: sanitizeName(saved.naming.herName) || DEFAULT_HER_NAME,
            userTitle: sanitizeName(saved.naming.userTitle),
            configured: saved.naming.configured === true,
          };
        }
        if (saved.windowState && typeof saved.windowState === 'object') {
          this.windowState = { ...this.windowState, ...saved.windowState };
        }
        if (Number.isFinite(saved.heart)) this.heart = clampValue(saved.heart);
        if (Number.isFinite(saved.intimacy)) this.intimacy = clampValue(saved.intimacy);
        if (Number.isFinite(saved.lastSeenAt)) this.lastSeenAt = saved.lastSeenAt;
        if (saved.lineCounters && typeof saved.lineCounters === 'object') {
          const counters = {};
          for (const [k, v] of Object.entries(saved.lineCounters)) {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) counters[k] = Math.floor(n);
          }
          this.lineCounters = counters;
        }
        // 结算「重启期间她被冷落了多久」—— 锚点恢复完就结算，不能等第一次 commit
        // （否则第一次 commit 会把锚点当成从未存在过，那段时间白丢）。
        this.settleHeart();
      }
    } catch (error) {
      // 首次运行没有存档（ENOENT），用默认值 —— 这是正常的。
      // 但**别的异常要留痕**：存档损坏时静默回落默认值，
      // 她的 L2 会话绑定（petSessionId）就无声丢了，用户还不知道。
      const code = /** @type {any} */ (error)?.code;
      if (code !== 'ENOENT') {
        console.warn(
          JSON.stringify({
            event: 'pet.state.load_failed',
            code: code || 'PARSE_ERROR',
            file: this.file,
          })
        );
      }
    }
  }

  /**
   * 原子落盘。**唯一的 JSON 落盘实现**在 `atomic-json.mjs`：
   * 临时文件 + 独占创建 + fsync + rename，读者只会看到旧文件或完整新文件。
   * @returns {Promise<void>}
   */
  async persist() {
    try {
      await writeJsonAtomic(this.file, {
        mood: this.mood,
        log: this.log,
        position: this.position,
        seq: this.seq,
        scope: this.scope,
        petSessionId: this.petSessionId,
        petSessionDirty: this.petSessionDirty,
        petHeadInjected: this.petHeadInjected,
        identityFileReady: this.identityFileReady,
        petAgent: this.petAgent,
        petAware: this.petAware,
        naming: { ...this.naming },
        windowState: { ...this.windowState },
        lineCounters: { ...this.lineCounters },
        heart: this.heart,
        intimacy: this.intimacy,
        lastSeenAt: this.lastSeenAt,
      });
    } catch (error) {
      // 存档失败不影响运行，但必须留痕（静默失败会让人以为存上了）。
      console.warn(
        JSON.stringify({
          event: 'pet.state.persist_failed',
          code: /** @type {any} */ (error)?.code || 'UNKNOWN',
          file: this.file,
        })
      );
    }
  }

  /**
   * @param {(snapshot: any) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 改动之后统一落盘 + 广播。
   *
   * **落盘走串行队列**：多个端点可能同时改状态并各自调 commit()，
   * 串成一条链才不会「后写的先落盘」把新数据盖掉。
   * 广播在落盘之后，且**每次都是当次的快照** —— 不排队，
   * 否则监听者会收到一串过时的快照。
   */
  async commit() {
    // 惰性结算「久没理她」：**先算再落盘** ⇒ heart 的下降一定跟得上盘。
    this.settleHeart();
    await this.writeQueue(() => this.persist());
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // 单个订阅者出错不影响其他人。
      }
    }
  }

  snapshot() {
    return {
      mood: this.mood,
      moodLabel: MOODS[this.mood].label,
      moodHint: MOODS[this.mood].hint,
      bubble: this.bubble,
      bubbleQueue: this.bubbleQueue.slice(),
      pendingMove: this.pendingMove,
      position: this.position,
      agent: this.agent,
      agentTracking: this.agentTracking,
      scope: this.scope,
      scopeSessionId: this.scopeSessionId,
      petSessionId: this.petSessionId,
      petSessionDirty: this.petSessionDirty,
      petHeadInjected: this.petHeadInjected,
      identityFileReady: this.identityFileReady,
      asking: this.asking,
      petAgent: this.petAgent,
      petAware: this.petAware,
      naming: { ...this.naming },
      chatBusy: this.chatBusy,
      pendingInteraction: this.pendingInteraction,
      windowState: { ...this.windowState },
      board: {
        running: this.board.running.slice(),
        recent: this.board.recent.slice(),
      },
      log: this.log.slice(-30).reverse(),
      serverTime: Date.now(),
    };
  }

  /**
   * 更新 Agent 观察通道的自诊断信息。
   * @param {Partial<typeof this.agentTracking>} patch
   */
  setAgentTracking(patch) {
    this.agentTracking = { ...this.agentTracking, ...patch };
  }

  /**
   * 设置称呼（老板 2026-10-28 拍板：名字和称呼由用户设定）。
   *
   * **空值怎么处理**：
   *  - `userTitle` 传空串 = 用户不想给称呼 → 引导段**不带**称呼那句，
   *    她自然地用「你」。（比硬塞一个默认称呼好 —— 那是替用户做决定。）
   *  - `herName` 传空串 = 回落到默认名 `MMX`，不许出现「无名」。
   *
   * 存完 `configured=true` → 首启询问不再弹。
   * @param {{herName?: string, userTitle?: string}} patch
   */
  setNaming(patch) {
    const herName = sanitizeName(patch?.herName) || DEFAULT_HER_NAME;
    const userTitle = sanitizeName(patch?.userTitle);
    this.naming = { herName, userTitle, configured: true };
    return { ...this.naming };
  }

  /**
   * @param {string} kind
   * @param {string} text
   */
  appendLog(kind, text) {
    this.seq += 1;
    this.log.push({ id: `a-${this.seq}-${Date.now()}`, ts: Date.now(), kind, text });
    if (this.log.length > MAX_LOG) this.log = this.log.slice(-MAX_LOG);
  }

  /**
   * 让章鱼娘说一句话，弹气泡。
   *
   * 气泡走**队列**而不是单槽：后一条不会把前一条顶掉。
   * 排队规则（只这一处判断）：
   *   - 当前没有气泡 → 直接显示；
   *   - 新消息是 **idle（闲话）** → 排队，不抢占；
   *   - 新消息是 **manual / trigger（主动说的）** → 抢占当前气泡，
   *     被挤掉的那条退回队列 —— 一条都不丢。
   *
   * @param {string} text
   * @param {string} [from] 来源标签，只进日志，不决定顺序
   * @param {string} [kind] BUBBLE_KIND 之一，默认 trigger
   */
  async say(text, from = '控制台', kind = BUBBLE_KIND.TRIGGER) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) throw new Error('EMPTY_TEXT');
    if (textLength(trimmed) > 300) throw new Error('TEXT_TOO_LONG');
    const now = Date.now();
    this.appendLog('说话', trimmed);
    this.pushBubble({
      text: trimmed,
      at: now,
      kind: kind === BUBBLE_KIND.IDLE || kind === BUBBLE_KIND.MANUAL ? kind : BUBBLE_KIND.TRIGGER,
      until: now + this.bubbleMs,
    });
    await this.commit();
    return this.bubble;
  }

  /**
   * 记下「她此刻在做什么」＋「刚刚被碰了」。
   *
   * ⚠️ **运行时态，不持久化**（跟气泡队列一样）——
   * 重启后她不记得自己在做什么，这是对的：她本来就该从零开始。
   *
   * @param {{key?: string, name?: string, category?: string, pool?: string, event?: string} | null} scene
   */
  setScene(scene) {
    if (!scene) {
      this.scene = null;
      return;
    }
    this.scene = { ...scene, at: Date.now() };
  }

  /**
   * 记一笔「她被碰了」。
   *
   * ⚠️ **只有真正的交互才算**：她每 5 秒切一段片段，
   * 那是「她在做什么」，不是「用户碰了她」——
   * 两者混在一起，「久没人碰她」的判定就永远不成立。
   */
  touch() {
    this.lastTouchedAt = Date.now();
  }

  /**
   * 现在能不能开口（**双通道时间闸门**，契约 §6.2）。
   *
   * ⚠️ **通过就顺手记下时间** —— 免得「先检查后开口」之间被人插一脚。
   * ⚠️ **exempt 豁免**：降级话术必须给用户反馈，吞了她就一声不吭 ⇒ 豁免
   *   （SPOKE_COOLDOWN.exempt = 0 = 不设窗口），但**照样记时间**
   *   （她确实开口了 ⇒ 别人的窗口照样被她推后）。
   *
   * @param {string} channel feed / result / exempt
   * @param {number} [now]
   * @returns {boolean} 能不能说
   */
  trySpeak(channel, now = Date.now()) {
    if (!spokeGateOpen(channel, this.lastSpokeAt, now)) return false;
    this.lastSpokeAt = now;
    return true;
  }

  /**
   * 只记「她开口了」，不做闸门检查（豁免内容用）。
   * @param {number} [now]
   */
  noteSpoke(now = Date.now()) {
    this.lastSpokeAt = now;
  }

  /**
   * 标记「这一轮已经说过一句工作 / 任务台词」（工作状态台词要让位）。
   */
  markRoundLineSpoken() {
    this.roundLineSpoken = true;
  }

  /** 清掉「这一轮已经说过」的标记（一轮结束 ⇒ 回到待机）。 */
  clearRoundLineSpoken() {
    this.roundLineSpoken = false;
  }

  /**
   * 这一轮有没有已经说过一句工作 / 任务台词。
   * @returns {boolean}
   */
  isRoundLineSpoken() {
    return this.roundLineSpoken === true;
  }

  /**
   * 走静态台词库说一句（身体动画强绑定的那 27 条）。
   *
   * ⚠️ **只取原文，不做表情替换** —— 表情由服务端 `express.mjs` 统一挑
   *（规矩第 28 条；模型回复与静态台词共用一套表情来源）。
   *
   * ⚠️ **轮换计数在这里递增**（按情境键持久化）：
   * 同一个情境连着触发三句都不同；重启后不回到第一句。
   *
   * @param {string} lineKey 情境键
   * @param {string | null} [tone] 语气档（只有分档的池认）
   * @param {number | null} [index] **显式下标**：变体由事实决定时用（重逢时长档 / 时段档）
   * @returns {{key: string, text: string, index: number, channel: string} | null}
   */
  nextSceneLine(lineKey, tone, index) {
    // 分档的台词按（情境键, 语气档）**各存一个计数** ——
    // 换档就是换了一批句子；同一档内连着触发三句仍然三句都不同。
    const counterKey = tone ? `${lineKey}@${tone}` : lineKey;
    const counter = Number(this.lineCounters[counterKey]) || 0;
    const picked = pickLine(lineKey, counter, tone, index);
    if (!picked) return null;
    // ⚠️ **显式下标时不动轮换计数** —— 那条句子的位置由**事实**决定
    //   （重逢的冷落时长、问候的时段），不是「说到第几句」。
    const explicit = index !== null && index !== undefined && Number.isFinite(Number(index));
    if (!explicit) this.lineCounters[counterKey] = counter + 1;
    return picked;
  }

  /**
   * 惰性结算「久没理她」：heart 每满 30 分钟 −5。
   *
   * ⚠️ **锚点差值算，不开定时器**（契约 §6.1）。
   * ⚠️ **首次零收益也要写锚点** —— 否则时钟永远不动。
   * ⚠️ 只降 heart，**不降亲密度**（契约：亲密不衰减）。
   *
   * @param {number} [now]
   * @returns {{settled: boolean, steps: number, gapMs: number}}
   */
  settleHeart(now = Date.now()) {
    if (!Number.isFinite(this.lastSeenAt) || this.lastSeenAt <= 0) {
      this.lastSeenAt = now;
      return { settled: false, steps: 0, gapMs: 0 };
    }
    const gap = now - this.lastSeenAt;
    if (gap < LONELY_MS) return { settled: false, steps: 0, gapMs: gap };
    const steps = Math.floor(gap / LONELY_MS);
    this.heart = clampValue(this.heart - LONELY_HEART_DROP * steps);
    // 锚点只前移**结算掉的那几段**，余数留着继续算
    this.lastSeenAt += steps * LONELY_MS;
    return { settled: true, steps, gapMs: gap };
  }

  /**
   * 改心情（契约 §6.1 的四种涨法都走这里）。**上限封顶、下限兜底**。
   * @param {number} delta
   * @returns {number} 改完后的心情
   */
  bumpHeart(delta) {
    this.heart = clampValue(this.heart + Number(delta || 0));
    return this.heart;
  }

  /**
   * 改亲密度。**上限封顶、下限兜底**；不衰减、不归零。
   * @param {number} delta
   * @returns {number} 改完后的亲密度
   */
  bumpIntimacy(delta) {
    this.intimacy = clampValue(this.intimacy + Number(delta || 0));
    return this.intimacy;
  }

  /**
   * 用户主动发消息（走 L2 聊天层）⇒ `intimacy` **+2** / `heart` **+1**（契约 §6.1）。
   *
   * ⚠️ **判据来源 = 请求路径**（`/api/chat` 这条路由），**不是模型输出文本**。
   * ⚠️ **先结算再涨**：冷落那段时间掉的心情先算掉，再算这次互动涨的。
   * @returns {Promise<{heart: number, intimacy: number}>}
   */
  async applyUserMessageBump() {
    this.settleHeart();
    this.bumpIntimacy(2);
    this.bumpHeart(1);
    await this.commit();
    return { heart: this.heart, intimacy: this.intimacy };
  }

  /**
   * 完成一轮对话（`turn.finished` **有确证产出**）⇒ `intimacy` **+1** / `heart` **+2**（契约 §6.1）。
   *
   * ⚠️ **判据来源 = 事件类型**（`turn.finished` ＋ 该回合有 `message.committed`），
   *   **不读模型输出文本**（契约 §6.1 判据纪律）。
   * @returns {Promise<{heart: number, intimacy: number}>}
   */
  async applyTurnFinishedBump() {
    this.settleHeart();
    this.bumpIntimacy(1);
    this.bumpHeart(2);
    await this.commit();
    return { heart: this.heart, intimacy: this.intimacy };
  }

  /**
   * 当前语气档（**纯读**：不结算、不落盘）。
   * @returns {{tone: string, mood: string, label: string}}
   */
  currentTone() {
    return toneOf(this.heart, this.intimacy);
  }

  /**
   * 把一条消息塞进气泡通道。
   *
   * 规则（只这一处判断）：
   *   - 当前没有气泡 → 直接显示；
   *   - 新消息是 idle（闲话）→ 排队，不抢占；
   *   - 新消息是 manual / trigger（主动说的）→ 抢占当前气泡，
   *     **被挤掉的那条退回队列**，一条都不丢。
   *
   * 队列按「收到的先后」排队（先到先播），闲话统一沉到队尾 —— 闲话让位。
   * @param {{text: string, at: number, kind: string, until: number}} entry
   */
  pushBubble(entry) {
    const current = this.bubble;
    if (!current) {
      this.bubble = entry;
      this.armBubbleTimer();
      return;
    }
    if (entry.kind === BUBBLE_KIND.IDLE) {
      // 闲话不抢占：排队等位置
      this.bubbleQueue.push(entry);
      this.sortBubbleQueue();
      this.trimBubbleQueue();
      return;
    }
    // 主动说的抢占当前气泡。被挤掉的那条退回队列（队尾），
    // 于是播放顺序仍然等于收到的先后顺序。
    this.bubbleQueue.push(current);
    this.bubble = entry;
    this.armBubbleTimer();
    this.sortBubbleQueue();
    this.trimBubbleQueue();
  }

  /**
   * 队列排序：主动说的在前，闲话统一沉到队尾。
   * Array.sort 在 V8 里是稳定的，所以同一类内部仍按收到的先后排。
   */
  sortBubbleQueue() {
    this.bubbleQueue.sort(
      (a, b) => (a.kind === BUBBLE_KIND.IDLE ? 1 : 0) - (b.kind === BUBBLE_KIND.IDLE ? 1 : 0)
    );
  }

  /**
   * 给当前气泡上计时：到点收起，顺手取队首接着播。
   */
  armBubbleTimer() {
    if (this.bubbleTimer) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
    this.bubbleTimer = setTimeout(() => {
      this.bubbleTimer = null;
      const next = this.bubbleQueue.shift() ?? null;
      this.bubble = next;
      if (next) this.armBubbleTimer();
      void this.commit();
    }, this.bubbleMs);
  }

  /**
   * 队列有界。超了先丢最旧的闲话（idle）；
   * 闲话丢完还超，就丢最旧的一条 —— 触发类（trigger）优先级更高。
   */
  trimBubbleQueue() {
    while (this.bubbleQueue.length > MAX_BUBBLE_QUEUE) {
      const idleAt = this.bubbleQueue.findIndex((item) => item.kind === BUBBLE_KIND.IDLE);
      this.bubbleQueue.splice(idleAt >= 0 ? idleAt : 0, 1);
    }
  }

  /**
   * 收摊：清掉定时器，别让进程被拖住。
   */
  dispose() {
    if (this.bubbleTimer) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
    if (this.celebrateTimer) {
      clearTimeout(this.celebrateTimer);
      this.celebrateTimer = null;
    }
    this.bubble = null;
    this.bubbleQueue = [];
  }

  /**
   * 切表情。
   * @param {string} mood
   * @param {string} [from]
   */
  async setMood(mood, from = '控制台') {
    if (!(mood in MOODS)) throw new Error(`UNKNOWN_MOOD:${mood}`);
    this.mood = mood;
    this.appendLog('表情', `${MOODS[mood].label}`);
    if (mood === 'celebrate') {
      if (this.celebrateTimer) clearTimeout(this.celebrateTimer);
      this.celebrateTimer = setTimeout(() => {
        this.mood = 'idle';
        void this.commit();
      }, CELEBRATE_MS);
    }
    await this.commit();
    return MOODS[mood];
  }

  /**
   * 请求浮窗挪到某个位置。真正挪动由页面执行（只有页面能控制宿主窗口），
   * 这里只是把意图放进状态，页面通过 SSE 收到后调用宿主窗口 API。
   * @param {string} target
   */
  async requestMove(target) {
    if (!(target in ANCHORS)) throw new Error(`UNKNOWN_ANCHOR:${target}`);
    this.pendingMove = { target, at: Date.now() };
    this.appendLog('移动', ANCHORS[target].label);
    await this.commit();
    return this.pendingMove;
  }

  /**
   * 页面把实际位置回报回来。
   * @param {number} x
   * @param {number} y
   */
  async setPosition(x, y) {
    this.position = { x: Math.round(x), y: Math.round(y) };
    await this.commit();
    return this.position;
  }

  /**
   * 页面上报**宿主窗口状态**（模式 / 穿透 / 最近一次失败原因）。
   *
   * 只在内容**真的变了**时才落盘 + 广播 —— 页面每秒轮询一次，
   * 不做这个判断会把 state.json 写爆、把 SSE 推爆。
   *
   * @param {{mode?: string, clickThrough?: boolean, lastError?: string, x?: number, y?: number, drag?: object}} patch
   * @returns {Promise<typeof this.windowState>}
   */
  async setWindowState(patch) {
    const source = patch || {};
    const next = {
      mode: typeof source.mode === 'string' ? source.mode : this.windowState.mode,
      clickThrough:
        typeof source.clickThrough === 'boolean'
          ? source.clickThrough
          : this.windowState.clickThrough,
      lastError:
        typeof source.lastError === 'string' ? source.lastError : this.windowState.lastError,
      // 宿主窗口的**真实坐标**（页面从 getState() 读到的）。
      // 有了它才能分辨「我们算错了」还是「宿主没动」——
      // `position` 是我们自己写的账本，不是证据。
      x: Number.isFinite(source.x) ? Math.round(source.x) : this.windowState.x,
      y: Number.isFinite(source.y) ? Math.round(source.y) : this.windowState.y,
      // 最近一次拖动的对账结果。传了就更新，没传就保持原值。
      drag:
        source.drag && typeof source.drag === 'object' ? source.drag : this.windowState.drag,
      updatedAt: Date.now(),
    };
    const changed =
      next.mode !== this.windowState.mode ||
      next.clickThrough !== this.windowState.clickThrough ||
      next.lastError !== this.windowState.lastError ||
      next.x !== this.windowState.x ||
      next.y !== this.windowState.y ||
      // drag 是对象 → 得比内容不比引用，否则每次上报都判定「没变」而不落盘。
      JSON.stringify(next.drag) !== JSON.stringify(this.windowState.drag);
    this.windowState = next;
    if (!changed) return this.windowState;
    await this.commit();
    return this.windowState;
  }

  /**
   * 清掉已经处理过的移动请求，避免重复触发。
   */
  async consumeMove(at) {
    if (this.pendingMove && this.pendingMove.at === at) {
      this.pendingMove = null;
      await this.commit();
    }
  }

  /**
   * Agent 状态变化（来自 observe 事件）。
   *
   * 'idle' 是**校准**用的：重连后用会话列表把状态拉回真实值。
   * 只在「工作中」时降回待机，不去打断正在进行的对话（thinking）。
   * @param {string} state
   * @param {string | null} title
   */
  async setAgentState(state, title = null) {
    this.agent = { state, title, at: Date.now() };
    if (state === 'thinking' || state === 'working') {
      if (this.celebrateTimer) clearTimeout(this.celebrateTimer);
      this.mood = state === 'thinking' ? 'thinking' : 'working';
    } else if (state === 'done') {
      this.mood = 'celebrate';
      if (this.celebrateTimer) clearTimeout(this.celebrateTimer);
      this.celebrateTimer = setTimeout(() => {
        this.mood = 'idle';
        void this.commit();
      }, CELEBRATE_MS);
    } else if (state === 'idle' && this.mood === 'working') {
      this.mood = 'idle';
      if (this.celebrateTimer) clearTimeout(this.celebrateTimer);
    }
    await this.commit();
    return this.agent;
  }

  /**
   * 切换观察范围。
   * current 时 sessionId 是正在观察的会话；传 null 表示「当前不在任何会话里」，
   * 观察会退守全局。
   * @param {'current' | 'global'} mode
   * @param {string | null} [sessionId]
   */
  async setScope(mode, sessionId = null) {
    if (!(mode in SCOPES)) throw new Error(`UNKNOWN_SCOPE:${mode}`);
    this.scope = mode;
    this.scopeSessionId = mode === 'current' ? (sessionId ?? null) : null;
    this.appendLog('观察', SCOPES[mode].label);
    await this.commit();
    return { mode: this.scope, sessionId: this.scopeSessionId };
  }

  /**
   * 记下用户正在问她的内容。
   * @param {string} text
   */
  async setAsking(text) {
    this.asking = { text: String(text ?? ''), at: Date.now() };
    await this.commit();
    return this.asking;
  }

  /**
   * 这一轮问完了，清掉 asking。
   */
  async clearAsking() {
    if (!this.asking) return null;
    this.asking = null;
    await this.commit();
    return null;
  }

  /**
   * 记下她的专属会话。
   * @param {string} sessionId
   * @param {boolean} [dirty] 会话是否卡住（有 pendingQuestion 未回答）
   */
  async setPetSession(sessionId, dirty = false) {
    this.petSessionId = sessionId ? String(sessionId) : null;
    this.petSessionDirty = !!dirty;
    // 新会话 = 新的第一轮（要带接续摘要）。
    // ⚠️ `petHeadInjected` 归零是「换会话时带接续摘要」这条规则的地基 ——
    // 漏了它，新会话接不上上一段。
    this.petHeadInjected = false;
    await this.commit();
    return this.petSessionId;
  }

  /**
   * 记下：这个会话的第一轮已经发过了（换会话时归零）。
   * @returns {Promise<boolean>}
   */
  async markPetHeadInjected() {
    // ⚠️ 这里必须是 `true` —— 语义是「这个会话的第一轮已经发过了」。
    // 写成 `false` 会让 `isNewSession = !petHeadInjected` 永远为真 →
    // 接续摘要每轮都带（老毛病「每轮重贴」换了个形式回来）。
    // 负向注入第三轮实测抓到的就是这个（2026-10-29）。
    this.petHeadInjected = true;
    await this.commit();
    return true;
  }

  /**
   * 记下：身份层已经写进 agent 目录的 `AGENTS.md` 了。
   * @param {boolean} ready
   * @returns {Promise<boolean>}
   */
  async setIdentityFileReady(ready) {
    this.identityFileReady = !!ready;
    await this.commit();
    return this.identityFileReady;
  }

  /**
   * 专属会话卡住了（还有问题没回答，run slot 被占着），
   * 下次提问要重新 create 一个会话，否则后面每一问都是 BUSY。
   */
  async markPetSessionDirty() {
    if (!this.petSessionId) return false;
    this.petSessionDirty = true;
    await this.commit();
    return true;
  }

  /**
   * 指定她的专属会话用哪个 agent。
   * @param {string | null} agent
   */
  async setPetAgent(agent) {
    this.petAgent = agent ? String(agent) : null;
    await this.commit();
    return this.petAgent;
  }

  /**
   * 她正在回话。她一次只回一句话，所以这个闸门要挡掉插队的话。
   * @param {boolean} busy
   */
  async setChatBusy(busy) {
    this.chatBusy = !!busy;
    await this.commit();
    return this.chatBusy;
  }

  /**
   * 是否把 MCode 的状态摘要拼进她的输入。她知道你在忙什么，是 L2 的核心。
   * @param {boolean} aware
   */
  async setPetAware(aware) {
    this.petAware = aware !== false;
    await this.commit();
    return this.petAware;
  }

  /**
   * 设置区看板。running 来自 sessions()，recent 来自 turn.finished。
   * @param {{running?: any[], recent?: any[]}} board
   */
  async setBoard(board) {
    this.board = {
      running: Array.isArray(board?.running) ? board.running.slice(0, 8) : [],
      recent: Array.isArray(board?.recent) ? board.recent.slice(0, 5) : [],
    };
    await this.commit();
    return this.board;
  }

  /**
   * 追加一条聊天消息。落盘在 chat.json（和 state.json 分开），
   * 但仍走 commit()：让面板/浮窗/MCP 看到的都是同一份状态。
   * @param {'user'|'her'} role
   * @param {string} text
   * @param {string} [id] 提前发好的消息 id（流式增量帧要和它对上）
   */
  async appendMessage(role, text, id) {
    if (!this.chat) throw new Error('CHAT_UNAVAILABLE');
    const message = await this.chat.appendMessage(role, text, id);
    // ⚠️ **用户开口 = 她被碰了** —— 只有真正的交互才算
    // （片段切换不算，那是「她在做什么」）。
    if (role === 'user') this.touch();
    await this.commit();
    return message;
  }

  /**
   * 记下当前待处理的交互（审批 / 问卷）。
   * @param {any} interaction
   */
  async setPendingInteraction(interaction) {
    this.pendingInteraction = interaction ?? null;
    await this.commit();
    return this.pendingInteraction;
  }

  /**
   * 清掉已处理的交互。
   */
  async clearPendingInteraction() {
    if (!this.pendingInteraction) return null;
    this.pendingInteraction = null;
    await this.commit();
    return null;
  }
}

export { clock };
