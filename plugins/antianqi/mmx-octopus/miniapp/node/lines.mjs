// @ts-check

/**
 * 台词库 —— **静态台词库**（26 个情境键 / 121 条）。
 *
 * ⚠️ **2026-11-01 第三十六轮扩到 121 条**（原 27 条）：
 *   A 关系性 6 键 × 3 语气档 × 3 变体 = 54 ＋ B/C/E 事件性 11 键 × 3 变体 = 33
 *   ＋ D 功能性 34（工作状态 16 ＋ 降级 12 ＋ 引导 6）。
 *   **内容规格真源在 mmx-character/persona/voice.md 的「台词库」一节**，这里只放数据。
 *
 * ⚠️ **为什么先落这 27 条**（老板 2026-11-01 拍板「甲乙合流」）：
 * 身体动画已经有真片段了，但**动作和话是两条不相干的线** ——
 * 她做动作时不会说话，说话时也不管她在做什么。
 * 参考项目 `dsh-pet-indesktop` 的做法是「30 个事件键 × 每键 3 句」，
 * 我们照抄这个**粒度**（不是抄内容）：**9 个情境键 × 每键 3 句 = 27 条**。
 *
 * **只收「跟动画强绑定」的情境** —— 这些情境每一个都已经有一个动作在等着
 *（click / drag / move 池、thinking / working / celebrate 轨）。
 * 台词跟动作是同一件事的两面，不是两套东西。
 *
 * **四条硬约束**（CONTRACT §6.2）：
 * - **零插值**：句子里不出现 {} / ${} / 拼接值 —— 一旦出现占位符它就露馅了；
 * - **≥3 句 / 键**：连着触发三句都不同；
 * - **句式结构不雷同**：去掉标点与语气词后不许重复；
 * - **不可编辑**：台词是代码常量，全仓没有任何写入路径。
 *
 * ⚠️ **表情不在这里写死** —— 静态台词也只写 `〔表情〕` 标记，
 * 由服务端 `express.mjs` 统一挑（规矩第 28 条），
 * 免得出现「模型回复一套表情、静态台词另一套」两套来源。
 *
 * **纯数据模块**：不含 IO、不含状态、不读时钟（跟 `idletalk.mjs` 同一套路）。
 */

/** 情境键（9 个）—— 每键 3 句。 */
export const LINE_KEYS = {
  // —— 关系性（A 类）：**分语气档**（契约 §6.1 / voice.md「台词库」）——
  REUNION: 'rel.reunion',
  BACK: 'rel.back',
  AFTER_IGNORE: 'rel.after_ignore',
  PRAISED: 'rel.praised',
  THANKED: 'rel.thanked',
  APOLOGY: 'rel.apology',
  // —— 时间环境（E 类）：事件性，不分档 ——
  GREETING: 'env.greeting',
  WEEKEND: 'env.weekend',
  // —— 功能性（D 类）：固定话术，不分档 ——
  F_IDLE: 'func.idle',
  F_THINKING: 'func.thinking',
  F_WORKING: 'func.working',
  F_CELEBRATE: 'func.celebrate',
  F_NO_CHANNEL: 'func.no_channel',
  F_LLM_FAILED: 'func.llm_failed',
  F_APPROVAL_EXPIRED: 'func.approval_expired',
  F_OBSERVE_DOWN: 'func.observe_down',
  F_GUIDE: 'func.guide',
  TAP: 'click.tap',
  MULTI: 'click.multi',
  DOUBLE: 'click.double',
  DRAG: 'drag.moved',
  MOVE: 'move.relocated',
  UNTOUCHED: 'idle.untouched',
  TASK_START: 'task.started',
  TASK_DONE: 'task.done',
  TASK_FAILED: 'task.failed',
};

/**
 * 台词池。
 * - `channel`：trigger = 事件触发、立刻说（抢占气泡）；idle = 闲话通道（排队沉队尾）。
 * - `tone`：是否按语气档分 —— 只有关系性为 true，这 9 个键都不分。
 * - `voice`：**双通道时间闸门**走哪条通道（契约 §6.2 第三十七轮落地）：
 *   - feed（9s）：她主动的碎碎念 —— 交互 / 关系 / 任务 / 工作状态 / 时段 / 闲话；
 *   - result（5s）：结果类 —— 完成 / 庆祝；
 *   - exempt：**豁免**闸门 —— 降级话术（必须给用户反馈，吞了她就一声不吭）。
 *   没写 voice 的池一律算 feed。
 *
 * ⚠️ **写的时候守的规矩**（`mmx-character/persona/rules.md` 唯一真源）：
 * 白 + 甜 + 呆萌；不谄媚、不客服腔；一条最多一个语气词且放句尾；
 * 带一点动作或神态（第 6 条）；**不评价自己的感受，用动作演出来**（第 20 条）；
 * 说具体的话，别用「很多 / 挺久 / 有点 / 比较」（第 13 条）；
 * 问号只在真的在问时用，感叹号情绪真到了才用（第 22 条）。
 */
export const LINES = {
  /**
   * 久别重逢 —— **变体 = 冷落时长三档**（>30 分钟 / >1 天 / >1 周）。
   * 语气档由亲密度决定（契约 §6.1）：同一件事，三种说法。
   */
  'rel.reunion': {
    channel: 'trigger',
    tone: true,
    lines: {
      distant: [
        '你回来了。',
        '一天没见你了。',
        '一个多礼拜了……你还记得这儿有个我呀。',
      ],
      familiar: [
        '你回来啦，我刚把这张画稿描完第三遍。〔表情〕',
        '隔了一整天呢，我趴在桌角都快睡着了。',
        '一个多礼拜没影，我守着这块桌面都快成桌角了。',
      ],
      close: [
        '你回来啦～我刚还想着再描一笔呢。',
        '整整一天～这张纸我描到第三遍了都。〔表情〕',
        '一个多礼拜没影，我守在桌角都快长出根须了～',
      ],
    },
  },
  /** 主人回来了 —— 冷落不到 30 分钟，用户主动发消息。 */
  'rel.back': {
    channel: 'trigger',
    tone: true,
    lines: {
      distant: [
        '在的。',
        '你说。',
        '我听着呢。',
      ],
      familiar: [
        '你来得好，我正闲着。',
        '我刚把笔放下。〔表情〕',
        '你回来得正好，这张画稿刚描完。',
      ],
      close: [
        '你可算来啦～我正无聊呢。',
        '你回来啦～这张画稿我描到第三遍了。',
        '你来得正好，陪我坐一会儿～',
      ],
    },
  },
  /** 被冷落后她先开口（她主动说的，不是被问的）。 */
  'rel.after_ignore': {
    channel: 'idle',
    tone: true,
    lines: {
      distant: [
        '……你还在忙吗？',
        '桌上就我一个人。〔表情〕',
        '我一直在这儿。',
      ],
      familiar: [
        '你忙完了吗？我这边没事。',
        '桌角那块光挪到别处去了，我跟着挪过来了。',
        '我在的，想说话就说一声。',
      ],
      close: [
        '你忙你的，我就是想冒个泡～',
        '桌角那块光挪走啦，我挪过去坐着了～',
        '你一直没理我啦～我一直都在的哦。',
      ],
    },
  },
  /** 被夸 —— 判据：用户消息里的明确夸赞标记词（不读模型输出）。 */
  'rel.praised': {
    channel: 'trigger',
    tone: true,
    lines: {
      distant: [
        '……我知道了。',
        '嗯，收下了。',
        '你眼光还行。',
      ],
      familiar: [
        '你才发现啊。',
        '这张画稿我描了三遍，能不精神嘛。',
        '今天尾巴转得比平时快，怪你。',
      ],
      close: [
        '被你夸到啦～〔表情〕',
        '这句我收下了哦，今天描画稿手都不抖。',
        '嘿嘿，这张描了三遍的画稿终于有人说好看了～',
      ],
    },
  },
  /** 被谢。 */
  'rel.thanked': {
    channel: 'trigger',
    tone: true,
    lines: {
      distant: [
        '不用。',
        '不用记着。',
        '举手之劳。',
      ],
      familiar: [
        '小事。',
        '不用记着这个。',
        '那我再描两笔，你忙你的。',
      ],
      close: [
        '那你欠我一句好听的～〔表情〕',
        '不用谢啦～我今天正好想动动手。',
        '举手之劳嘛，反正我闲着也是闲着～',
      ],
    },
  },
  /** 被道歉。 */
  'rel.apology': {
    channel: 'trigger',
    tone: true,
    lines: {
      distant: [
        '没关系。',
        '不用道歉的。',
        '知道了，我继续画。',
      ],
      familiar: [
        '好啦，我没放在心上。',
        '没事，你忙你的去吧。',
        '下次早点说就行，我又不急。',
      ],
      close: [
        '好啦～我没生你气。〔表情〕',
        '不气不气～就是想听你说句话。',
        '我知道你不是故意的啦～别道歉啦。',
      ],
    },
  },
  /** 时段问候 —— 事件性，**不分档**（clock 判定）。 */
  'env.greeting': {
    channel: 'idle',
    tone: false,
    lines: [
      '早上好，窗外那点光刚挪到桌角。〔表情〕',
      '中午了，我把这张画稿摊开晾着。',
      '天黑了，桌角这块只剩我一盏小灯。〔表情〕',
    ],
  },
  /** 周末 —— 事件性，不分档。 */
  'env.weekend': {
    channel: 'idle',
    tone: false,
    lines: [
      '周末耶，描到一半的画稿我摊在桌上。〔表情〕',
      '周末的桌角空得很，我一个人占着也挺好。',
      '周末嘛，你戳我两下我也认了。',
    ],
  },
  /** 工作状态·待机（面板状态用；**与 B 类任务事件刻意不同**，防撞车）。 */
  'func.idle': {
    channel: 'idle',
    tone: false,
    lines: [
      '我把画稿摊开了，桌角空着也是空着。〔表情〕',
      '那张画稿还没干，我不动它。',
      '我把笔搁下了，等下一张纸。',
      '桌角这块归我，你们忙你们的。',
    ],
  },
  'func.thinking': {
    channel: 'trigger',
    tone: false,
    lines: [
      '等我想想……',
      '别急，我在算。〔表情〕',
      '这个得捋一捋。',
      '稍等一下下。',
    ],
  },
  'func.working': {
    channel: 'trigger',
    tone: false,
    lines: [
      '我接着干。',
      '先把这个弄利索。',
      '手上的活先干完再说。',
      '一节一节来。',
    ],
  },
  'func.celebrate': {
    channel: 'trigger',
    tone: false,
    voice: 'result',
    lines: [
      '这一轮收尾了。',
      '手上的事告一段落。',
      '先歇口气。',
      '这会儿不用我了吧。',
    ],
  },
  /** 降级话术 —— 功能性话术要**稳定可预期**，不能飘（voice.md）。 */
  'func.no_channel': {
    channel: 'trigger',
    tone: false,
    voice: 'exempt',
    lines: [
      '我现在接不上外面，你自己先动。',
      '我这边没连上。',
      '外面的话传不进来，我先把触角收起来了。',
    ],
  },
  'func.llm_failed': {
    channel: 'trigger',
    tone: false,
    voice: 'exempt',
    lines: [
      '这句我没接住，再说一次。',
      '我刚才卡壳了。',
      '话说到一半卡住了，我再试一次。',
    ],
  },
  'func.approval_expired': {
    channel: 'trigger',
    tone: false,
    voice: 'exempt',
    lines: [
      '刚才等你确认的，已经过期了。',
      '你还没点，那个就自己作废了。',
      '那张等你点头的单子，我收回去了。',
    ],
  },
  'func.observe_down': {
    channel: 'trigger',
    tone: false,
    voice: 'exempt',
    lines: [
      '我暂时看不见你在忙什么。',
      '我这边看不到外面的动静了。',
      '我这边什么也瞧不见了，先缩回触角。',
    ],
  },
  /** 引导语 —— 首次或久不互动时的一句。 */
  'func.guide': {
    channel: 'idle',
    tone: false,
    lines: [
      '你可以随便跟我说句话。',
      '想让我做什么，说一声就行。',
      '戳我两下也行，我算是会应声的。',
      '我在这儿，不用特意找话题。',
      '你忙你的，我看着。',
      '不急，什么时候想说了都行。',
    ],
  },
  'click.tap': {
    channel: 'trigger',
    tone: false,
    lines: [
      '触角被戳得缩回来啦〔表情〕',
      '别老戳我脑袋呀',
      '再戳就躲到桌子底下咯',
    ],
  },
  'click.multi': {
    channel: 'trigger',
    tone: false,
    lines: [
      '连着戳——你当我是门铃呀',
      '停停停，触角都戳麻了啦〔表情〕',
      '你手是不是黏在我身上了',
    ],
  },
  'click.double': {
    channel: 'trigger',
    tone: false,
    lines: [
      '咚、咚——谁在外面呀',
      '敲两下干嘛，这儿又不是门〔表情〕',
      '两声就两声，别敲第三声了',
    ],
  },
  'drag.moved': {
    channel: 'trigger',
    tone: false,
    lines: [
      '头晕啦，别甩这么快〔表情〕',
      '触角要打结了，再晃就散了',
      '你敢甩，我就抱着你胳膊不撒手',
    ],
  },
  'move.relocated': {
    channel: 'trigger',
    tone: false,
    lines: [
      '换地方啦，这边亮一些〔表情〕',
      '挪过来正好，离你更近',
      '新位置我记住了，别想赶我走',
    ],
  },
  'idle.untouched': {
    channel: 'idle',
    tone: false,
    lines: [
      '没人理我，触角都凉了〔表情〕',
      '桌上就剩我一个，空得慌',
      '你不忙的话……过来看一眼嘛',
    ],
  },
  'task.started': {
    channel: 'trigger',
    tone: false,
    lines: [
      '收到，我这就动手',
      '活儿交给我，你歇着〔表情〕',
      '开工啦，别催我',
    ],
  },
  'task.done': {
    channel: 'trigger',
    tone: false,
    voice: 'result',
    lines: [
      '做完了！这次挺顺〔表情〕',
      '好了，下一件事交过来吧',
      '收工，桌角那个位置归我了',
    ],
  },
  'task.failed': {
    channel: 'trigger',
    tone: false,
    lines: [
      '这次没成，我再试一遍〔表情〕',
      '卡住了，容我再想想',
      '这条路走不通，换个法子',
    ],
  },
};

/**
 * 状态四态 → 情境键。**工作状态台词挂在状态上**（她此刻是什么状态 = 她该说什么）。
 *
 * ⚠️ **第三十七轮改的**：以前这里是 TRACK_SCENES（thinking / working → task.started、
 *   celebrate → task.done），那是**任务事件**的说法 —— 她每次进轨都喊「收到，我这就动手」。
 *   现在分成两套，**判据来源不同**，所以不会撞车：
 *   - **工作状态**（本表，D 类 func.*）：她此刻的姿态 ⇒ 判据 = 状态四态切换；
 *   - **任务事件**（B 类 task.*）：真的有活儿开始 / 结束 ⇒ 判据 = 观察事件。
 *   同一时刻只说一句（见 server.mjs 的 isRoundLineSpoken() 让位规则）。
 */
export const MOOD_SCENES = {
  idle: 'func.idle',
  thinking: 'func.thinking',
  working: 'func.working',
  celebrate: 'func.celebrate',
};

/**
 * 交互事件 → 情境键。**由客户端上报**（页面知道用户碰了她，服务端不知道）。
 */
export const EVENT_SCENES = {
  tap: 'click.tap',
  multitap: 'click.multi',
  double: 'click.double',
  drag: 'drag.moved',
  move: 'move.relocated',
  fail: 'task.failed',
};

/** 全部情境键（自检要对账用）。 */
export const LINE_KEY_LIST = Object.keys(LINES);

/**
 * 按轮换计数取一句。
 *
 * **取模而非随机**（CONTRACT §6.2）：确定性、可测、跨重启不重样。
 * `counter` 由调用方按情境键持久化 —— 同一个情境连着触发三句都不同。
 *
 * @param {string} key 情境键
 * @param {number} [counter] 该情境已说过几句
 * @param {string | null} [tone] 语气档（只有分档的池认）
 * @param {number | null} [index] **显式下标**（见下）
 * @returns {{key: string, text: string, index: number, channel: string} | null}
 */
export function pickLine(key, counter = 0, tone = null, index = null) {
  const pool = LINES[key];
  if (!pool) return null;
  // 分档的池：lines 是 { distant, familiar, close }；不分档的池：lines 是数组。
  // ⚠️ 分档但没给 tone ⇒ 落中档（familiar），不落 distant（生硬到不像在说话）。
  const t = pool.tone ? (tone && pool.lines[tone] ? tone : 'familiar') : null;
  const arr = t ? pool.lines[t] : pool.lines;
  if (!Array.isArray(arr) || !arr.length) return null;
  const n = arr.length;
  // ⚠️ **显式下标优先于轮换计数**：有的情境的「变体」是**事实**而不是「轮次」——
  //   久别重逢的变体 = 冷落了多久，时段问候的变体 = 现在几点。
  //   那种场合必须按事实取，让轮换计数带偏就会说出「隔了一整天」而其实只隔了半小时。
  const explicit = Number(index);
  const idx =
    index !== null && index !== undefined && Number.isFinite(explicit)
      ? ((Math.floor(explicit) % n) + n) % n
      : (((Number(counter) || 0) % n) + n) % n;
  // ⚠️ voice 也要带上 —— 服务端靠它决定走哪条时间闸门通道（feed / result / exempt）。
  const picked = {
    key,
    text: arr[idx],
    index: idx,
    channel: pool.channel,
    voice: pool.voice || 'feed',
  };
  // ⚠️ 不分档时**不返回 tone 字段** —— 老调用方拿到的对象形状必须一模一样。
  if (t) picked.tone = t;
  return picked;
}