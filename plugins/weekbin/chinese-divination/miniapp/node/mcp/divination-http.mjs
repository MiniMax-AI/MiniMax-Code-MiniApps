// @ts-check

/**
 * MCP（streamable-http）端点：让 Agent 在对话里主动起卦。
 *
 * 为什么在这里接模型：这个包自己不调任何模型、不出站。Agent 本身就是模型，
 * 由它在对话中调用本端点，再用自己的语言把卦象讲给用户听——密钥、计费、上下文
 * 全都留在会话里，本包只负责「算得对」和「讲得准」。
 */

import {
  buildReading,
} from '../divination.mjs';
import { HEXAGRAM_LIST, hexagramSymbol, invertedHexagram, mutualHexagram, oppositeHexagram } from '../hexagrams.mjs';
import { almanac } from '../almanac.mjs';
import { jingfang } from '../jingfang.mjs';
import { TOPIC_KEYS } from '../topics.mjs';
import {
  CAST_METHODS,
  CastParamError,
  MAX_NUMBER,
  MAX_QUESTION,
  PACKAGE_VERSION,
  castFromParams,
  clampText,
  tossCoinSums,
} from '../cast-params.mjs';

/**
 * MCP 对外认的起法。`hexagram` 是页面卦库那一路专用的，不进工具 schema。
 * 取自 CAST_METHODS 而不是另写一份数组，少一处会漂移的地方。
 */
export const MCP_CAST_METHODS = Object.freeze(
  CAST_METHODS.filter((item) => item !== 'hexagram'),
);

/**
 * 工具描述里 `method` 的那组枚举，与实际认的起法同一份。schema 与实现各写一份时，
 * 会出现「提示说可以、实际做不到」或反过来。
 */
const MCP_CAST_METHOD_ENUM = Object.freeze([...MCP_CAST_METHODS]);

const SERVER_INFO = Object.freeze({ name: 'chinese-divination', version: PACKAGE_VERSION });

/**
 * 免责说明。全文只有这一份：MCP 的 `instructions` 与每次起卦的返回都从这里取，
 * `skills/divination/SKILL.md` 里那一份必须与它逐字相同（有一条断言钉着）。
 *
 * 之前这里有三份措辞不同的文字——工具返回的一段、`instructions` 里改写的另一段、
 * 以及 SKILL 里要求「不得改写」的那第三段。Agent 会同时拿到互相矛盾的要求，
 * 于是每次转述的免责声明都不一样。同一件事只能有一个出处。
 */
export const DISCLAIMER =
  '内容由 AI 生成，仅供娱乐，无实际预测功能。卦象不构成任何建议、预测或决策依据，不应作为医疗、法律、财务等重要决定的参考。';

const READ_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/**
 * @param {string} name
 * @param {string} title
 * @param {string} description
 * @param {object} inputSchema
 */
function tool(name, title, description, inputSchema) {
  return { name, title, description, inputSchema, annotations: READ_ANNOTATIONS };
}

const QUESTION_PROPERTY = Object.freeze({
  question: {
    type: 'string',
    maxLength: MAX_QUESTION,
    description:
      '所问何事，原话即可。写了它，应期与取象才有着落——不写则一律退回用卦本分。',
  },
  topic: {
    type: 'string',
    enum: [...TOPIC_KEYS],
    description:
      '所问何事归哪一类，由你来定——你读过用户原话，比在本工具里拿关键词撞「他对我还有没有真心」'
      + '这类问法可靠。财运=钱与买卖、事业功名=工作前程与升迁、感情=恋爱与暧昧、婚恋=结婚与配偶、'
      + '疾病=病症与身体、学业文书=考试与证照、房产车契=房舍车契与搬迁、官讼是非=官司与纠纷、'
      + '出行寻物=远行与丢东西。拿不准就省略，省略后本工具按关键词认，认不出就按用卦算。'
      + '**只影响应期、用神与取象，不改变卦体吉凶**——同一个卦，问财与问婚，凶不会翻面。',
  },
});

const TOOLS = Object.freeze([
  tool(
    'divination_cast',
    '起卦并解读',
    '按梅花易数起一卦并返回完整解读：卦名、上下卦、五行、体用生克所定的吉凶、十七到二十一段断语（含卦气当令主卦、六冲六合、爻之合、爻之刑）、应期、宜忌与起卦依据。问事请尽量写清楚，写了问题与不写问题解出来的侧重不同。默认时间起卦，按当下时辰成卦，两小时一换。',
    {
      type: 'object',
      properties: {
        ...QUESTION_PROPERTY,
        method: {
          type: 'string',
          enum: MCP_CAST_METHOD_ENUM,
          description:
            '起法。time=以当下时辰成卦（两小时一换）；daily=按今日日期成卦（一天一换）；numbers=由你给两个正整数，默念所问之后自行取数，一上卦一下卦；coins=由本工具掷六次铜钱，每次皆不同。用户说「掷铜钱」或要随机时用 coins，说「今天」用 daily。',
          default: 'time',
        },
        upper: { type: 'integer', minimum: 1, maximum: MAX_NUMBER, description: 'method=numbers 时的第一数，取上卦。' },
        lower: { type: 'integer', minimum: 1, maximum: MAX_NUMBER, description: 'method=numbers 时的第二数，取下卦。' },
      },
      additionalProperties: false,
    },
  ),
  tool(
    'divination_hexagram_lookup',
    '查六十四卦',
    '按卦名、上下卦或关键字检索六十四卦，返回卦辞、象辞、所属宫位与世应六亲、互错综三卦。用户问「谦卦什么意思」「水雷屯怎么解」时用这个，不要起新卦。默认只给这些：卦辞与象辞说得出这卦是什么，宫位与世应说得出它是谁，三卦说得出它连着什么。真要看彖传原文与六亲全表时传 detail="full"，那部分动辄六十字，连查几卦就淹掉了要紧的话。',
    {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 40, description: '卦名、上下卦名或关键字，如「乾」「雷」「风」「水天」。省略则返回六十四卦全表。' },
        limit: { type: 'integer', minimum: 1, maximum: 64, default: 8, description: '返回条数上限。' },
        detail: { type: 'string', enum: ['brief', 'full'], default: 'brief', description: 'brief 给出卦辞、象辞与三卦；full 额外附上彖传原文。' },
      },
      additionalProperties: false,
    },
  ),
  tool(
    'divination_almanac',
    '查今日历法',
    '返回今日干支纪年月日时、月建与旺衰、当前时辰、黄黑道吉时、二十四节气与生肖三合六合。用户问「今天黄历」「今天什么日子」时用这个。',
    { type: 'object', properties: {}, additionalProperties: false },
  ),
]);

class ToolError extends Error {
  /** @param {string} code @param {string} message @param {string} [recovery] */
  constructor(code, message, recovery) {
    super(message);
    this.code = code;
    this.recovery = recovery;
  }
}

/**
 * Agent 自报的事类。没给就给 null（后面退回关键词）；给了但不在九类里就是硬伤，
 * 悄悄当没给会让 Agent 以为自己定过了，所以当场报错让它重挑。
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @returns {string|null}
 */
function toTopicKey(value, allowed) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ToolError(
      'INVALID_ARGUMENTS',
      `未知的事类：${typeof value === 'string' ? value : typeof value}`,
      `topic 只能是 ${allowed.join('、')} 这九个，拿不准就省略，省略后按关键词认。`,
    );
  }
  return value;
}

/**
 * 把一卦压成给模型读的文本。给全量 JSON 没用，模型要的是能复述的句子。
 * @param {ReturnType<typeof buildReading>} reading
 */
function readingToText(reading) {
  const lines = reading.lines.map((line) => `${line.label} ${line.kind}`).join('、');
  const insights = reading.insights.map((item) => `【${item.title}】${item.text}`).join('\n');
  const basis = reading.details.map((item) => `${item.label} ${item.value}`).join('；');
  // 事类是谁定的要说清楚：Agent 自己给的那一路，它自己负责；关键词撞出来的那一路
  // 可能压根没撞上（表上的词没覆盖用户的说法），模型得知道自己站在哪条路上。
  const topic = reading.topic
    ? `所问事类：${reading.topic.label}（${reading.topicSource === 'explicit' ? '由 Agent 指定' : '按关键词认出'}），类神五行 ${reading.topic.element}。`
    : '所问未落到已知事类，应期按用卦推。';
  // 抬头就给宫与世应：这是模型复述卦象时最常要用的两个身份，埋在断语里要它自己去找。
  const jf = reading.jingfang;
  const shiLine = jf.lines[jf.shi - 1];
  const yingLine = jf.lines[jf.ying - 1];
  const jingfangLine = `${jf.palaceName}${jf.stage}卦，属${jf.element}；世爻${shiLine.label}持${shiLine.relative}，应爻${yingLine.label}为${yingLine.relative}`;
  // 动爻的去向挂在【变卦】这一行：Agent 复述「变到哪里、往哪儿去」时看这一行就够，
  // 回头生克与进退神的来历在【断语】的「化爻」一段里。
  const changedLine = reading.changed
    ? `【变卦】${reading.changed.name}（上卦 ${reading.changed.upper.name}、下卦 ${reading.changed.lower.name}）`
      + (reading.transforms && reading.transforms.length > 0
        ? `；动爻去向 ${reading.transforms.map((t) => `${t.label}${t.relation}${t.jinTui ? `·${t.jinTui}` : ''}`).join('、')}`
        : '')
    : '【变卦】六爻皆静，无变卦';
  // 日辰冲爻的三路，与世应并排放在抬头上：这三样都是「今天才有的处境」，
  // 模型复述卦象时最常追问「有没有被日辰冲到、又动了的爻」。三路皆空时不出这一行。
  const dayClashLine = (() => {
    const clash = reading.dayClash;
    if (!clash) return null;
    const bits = [];
    if (clash.dark.length > 0) bits.push(`暗动${clash.dark.join('、')}爻`);
    if (clash.dayBroken.length > 0) bits.push(`日破${clash.dayBroken.join('、')}爻`);
    if (clash.pressed.length > 0) bits.push(`冲散${clash.pressed.join('、')}爻`);
    return bits.length === 0 ? null : `【日冲】${bits.join('，')}`;
  })();
  // 爻之合四名。这一行只报名目与爻位，不带吉凶：原章说「宜合吉，不宜合凶」，
  // 「合」字进不了断语，所以抬头也不许替它表态。
  const combineLine = (() => {
    const combine = reading.combine;
    if (!combine) return null;
    const bits = [];
    if (combine.rise.length > 0) {
      bits.push(`合起${combine.rise.map(([p, source]) => `${p}爻合${source}`).join('、')}`);
    }
    if (combine.bind.length > 0) {
      bits.push(`合绊${combine.bind.map(([p, source]) => `${p}爻合${source}`).join('、')}`);
    }
    if (combine.friendly.length > 0) {
      bits.push(`合好${combine.friendly.map(([a, b]) => `${a}与${b}`).join('、')}`);
    }
    if (combine.support.length > 0) {
      bits.push(`化扶${combine.support.join('、')}爻`);
    }
    return bits.length === 0 ? null : `【逢合】${bits.join('，')}`;
  })();
  // 爻之刑。只报名目与来路，不带吉凶——原书「独犯三刑得验者少」是它的收口。
  const punishLine = (() => {
    const punish = reading.punish;
    if (!punish) return null;
    const bits = [];
    if (punish.linePairs.length > 0) {
      bits.push(`卦内${punish.linePairs.map(([a, b, self]) => `${self ? '自' : ''}${a}刑${b}`).join('、')}`);
    }
    if (punish.outside.length > 0) {
      // 自刑那一支照原样拼会成「月建酉刑酉」，读着像句病话，单独说。
      // 每一项自己都带来源，前面不再加「日月」两个字——加了会拼成「日月月建与…」。
      bits.push(punish.outside.map(([position, source, from, to, self]) => (
        self ? `${source}与${position}爻${to}自刑` : `${source}${from}刑${to}（${position}爻）`
      )).join('、'));
    }
    return bits.length === 0 ? null : `【犯刑】${bits.join('，')}`;
  })();
  // 反伏与卦变。两档分开报：卦变是六爻全动换到对宫八纯卦，反伏是内卦或外卦
  // 的纳支被换成逐位六冲的那一组。合起来报会把乾变坤漏掉——那一卦的纳支一支都不冲。
  const fanfuLine = (() => {
    const fanfu = reading.fanfu;
    if (!fanfu) return null;
    const bits = [];
    if (fanfu.guaChange) bits.push('六爻全动，换到对宫的八纯卦');
    const swaps = [];
    if (fanfu.inner) swaps.push(`内卦${fanfu.innerFrom}→${fanfu.innerTo}`);
    if (fanfu.outer) swaps.push(`外卦${fanfu.outerFrom}→${fanfu.outerTo}`);
    if (swaps.length > 0) bits.push(`纳支逐位相冲：${swaps.join('，')}`);
    return bits.length === 0 ? null : `【反伏与卦变】${fanfu.kind}｜${bits.join('；')}`;
  })();
  // 卦体冲合。六冲卦十个、六合卦八个，都是整卦的定性；变卦那两路要等动起来才谈得上。
  // 六十四卦里有四十六卦既不是六冲也不是六合，那种「不是」不值一行，不出。
  const clashLine = (() => {
    const c = reading.clash;
    if (!c) return null;
    if (!(c.chong || c.he || c.changedChong || c.changedHe || (c.transformClash || []).length > 0)) return null;
    const bits = [];
    bits.push(c.chong ? '本卦六冲卦' : c.he ? '本卦六合卦' : '本卦非六冲非六合');
    if (c.chongToChong) bits.push('变卦亦六冲');
    else if (c.heToChong) bits.push('变卦六冲（六合变六冲）');
    else if (c.changedChong) bits.push('变卦六冲');
    if ((c.transformClash || []).length > 0) bits.push(`动爻变冲${c.transformClash.join('、')}爻`);
    return `【卦体】${bits.join('，')}`;
  })();
  return [
    `【起法】${reading.method}`,
    reading.question ? `【所问】${reading.question}` : '【所问】未填',
    topic,
    `【卦名】${reading.hexagram.name}（第 ${reading.hexagram.order} 卦，${reading.hexagram.symbol}），上卦 ${reading.hexagram.upper.name}${reading.hexagram.upper.element}、下卦 ${reading.hexagram.lower.name}${reading.hexagram.lower.element}`,
    changedLine,
    `【爻象】${lines}`,
    `【体用】体卦 ${reading.structure.body.name}${reading.structure.body.element}，用卦 ${reading.structure.use.name}${reading.structure.use.element}`,
    `【京房】${jingfangLine}`,
    clashLine,
    dayClashLine,
    combineLine,
    punishLine,
    fanfuLine,
    `【月令旺衰】当令 ${reading.structure.monthElement}，体 ${reading.structure.bodyVitality}、用 ${reading.structure.useVitality}`,
    `【吉凶】${reading.verdict.label} —— ${reading.verdict.summary}`,
    `【断语】\n${insights}`,
    `【宜】${reading.advice.suitable.join('、')}`,
    `【忌】${reading.advice.avoid.join('、')}`,
    `【起卦依据】${basis}`,
    // 白话块放在最末，而不是塞在【吉凶】旁边：上面那些是给模型复述卦象用的，
    // 这一段是给用户听的，位置就跟着「请照着这几行讲」走，不必混在术语里。
    `【大白话】\n${plainBlock(reading)}`,
    `【提示】${DISCLAIMER}`,
  ].filter(Boolean).join('\n');
}

/** 白话块各句。空的那句（没定事类时的取象）直接不占一行，不留空壳。 */
function plainBlock(reading) {
  const plain = reading.plain;
  return [
    plain.ask,
    plain.topic,
    plain.verdict,
    plain.why,
    plain.onTopic,
    plain.timing,
    plain.actions,
    plain.caution,
  ].filter(Boolean).join('\n');
}

/**
 * `divination_cast` 在 schema 里声明的键。白名单而不是黑名单：Agent 多传了什么，
 * 这里就不认什么。
 */
const CAST_ARG_KEYS = Object.freeze(['question', 'topic', 'method', 'upper', 'lower']);

/**
 * 按白名单收一遍起卦参数，并钉住 method 必须落在 MCP 对外认的那组起法里。
 * @param {Record<string, unknown>} args
 * @returns {{ method?: string, upper?: unknown, lower?: unknown }}
 */
function pickCastArgs(args) {
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const key of CAST_ARG_KEYS) {
    if (key !== 'question' && key !== 'topic' && args[key] !== undefined) picked[key] = args[key];
  }
  const method = typeof args.method === 'string' && args.method !== '' ? args.method : 'time';
  if (!MCP_CAST_METHODS.includes(method)) {
    throw new ToolError(
      'INVALID_ARGUMENTS',
      `未知的起法：${method}`,
      `method 只能是 ${MCP_CAST_METHODS.join('、')}。`,
    );
  }
  picked.method = method;
  return picked;
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {Date} now 这一次的时刻。测试注入固定时钟用——起卦结果随日辰变，
 *   而 MCP 以前只能走真时钟，于是「伏神出不出得来」那条断言跟着跑测试的当天走。
 */
function callTool(name, args, now) {
  if (name === 'divination_cast') {
    const question = clampText(args.question, MAX_QUESTION);
    const topic = toTopicKey(args.topic, TOPIC_KEYS);
    /** @type {ReturnType<typeof buildReading>} */
    let reading;
    try {
      // 先按 schema 收一遍参数，只留下 `divination_cast` 真正声明的那几个。
      // 直接把 args 整个递进 castFromParams 的话，Agent 传进来的 schema 之外的键
      // 也会被当真：`sums` 会让本该自己掷的摇卦改用 Agent 指定的点数（页面那条路
      // 要这个，Agent 背后没有人替用户掷，不要），`method: 'hexagram'` 更是页面
      // 卦库专用的起法，不该从对话里走。
      const params = pickCastArgs(args);
      // 摇卦一律由本工具自己掷：Agent 只说「掷铜钱」，点数是随机的，不该由它指定。
      const withCoins = params.method === 'coins' ? { ...params, sums: tossCoinSums() } : params;
      reading = buildReading(castFromParams(withCoins, now), { question, now, topic });
    } catch (error) {
      if (error instanceof CastParamError) {
        throw new ToolError('INVALID_ARGUMENTS', error.message, error.recovery);
      }
      throw error;
    }
    return {
      content: [{ type: 'text', text: readingToText(reading) }],
      structuredContent: {
        method: reading.method,
        question: reading.question,
        topic: reading.topic,
        hexagram: { name: reading.hexagram.name, order: reading.hexagram.order },
        changed: reading.changed ? { name: reading.changed.name, order: reading.changed.order } : null,
        verdict: { label: reading.verdict.label, key: reading.verdict.key },
        useGod: reading.useGod
          ? {
              relatives: reading.useGod.relatives,
              present: reading.useGod.present,
              absent: reading.useGod.absent,
              picked: reading.useGod.picked
                ? { label: reading.useGod.picked.label, relative: reading.useGod.picked.relative, branch: reading.useGod.picked.branch, element: reading.useGod.picked.element, position: reading.useGod.picked.position }
                : null,
              why: reading.useGod.why,
              // 用神周围那一圈：元神、忌神、仇神。断语里已讲过一遍，Agent 要复述
              // 「谁生着它、谁克着它、谁在背后使坏」时不必再从正文里刨。
              circle: reading.useGod.circle
                ? {
                    yuan: reading.useGod.circle.yuan,
                    ji: reading.useGod.circle.ji,
                    chou: reading.useGod.circle.chou,
                    elements: reading.useGod.circle.elements,
                  }
                : null,
              // 用神不上卦时从本宫首卦取伏神，一并带出去：断语里已经讲过一遍，
              // Agent 要复述「伏在哪、飞神是谁」时不必再从正文里刨。
              hidden: (reading.useGod.hidden || []).map((h) => ({
                relative: h.relative,
                position: h.position,
                hushen: h.hushen,
                feishen: h.feishen,
                feishenRelative: h.feishenRelative,
                flying: h.flying,
                emerges: h.emerges,
              })),
            }
          : null,
        // 每一动爻变出来的那一爻：回头生克与进退神。断语里已经讲过一遍，
        // Agent 要复述「这一爻往哪儿去」时不必再从正文里刨。
        transforms: (reading.transforms || []).map((t) => ({
          position: t.position,
          label: t.label,
          moving: t.moving,
          movingRelative: t.movingRelative,
          changed: t.changed,
          changedRelative: t.changedRelative,
          relation: t.relation,
          jinTui: t.jinTui,
          marks: t.marks,
        })),
        // 日辰冲到的爻分三路：静爻旺相作暗动、静爻休囚作日破、动爻作冲散。断语里已讲过一遍，
        // Agent 要复述「今天有哪些爻被日辰冲到」时不必再从正文里刨。三个爻位数组互不相交。
        dayClash: reading.dayClash
          ? {
              dark: reading.dayClash.dark,
              dayBroken: reading.dayClash.dayBroken,
              pressed: reading.dayClash.pressed,
            }
          : null,
        // 卦体冲合：六冲卦十个、六合卦八个，都是整卦的定性，一卦至多中一个；
        // 变卦那两路（六合变六冲、六冲变六冲）与动爻变冲要等动起来才谈得上。
        // 卦内零散爻与爻冲六十四卦里有三十卦都有，太常见，不单列开关，只给爻位对。
        // 爻之合那四名各是哪些爻。合起/合绊是「合于日月」，按动静分两路，互不相交；
        // 合好是两动爻相合（成对给出），化扶是动爻化出之爻回头相合（只给本爻位）。
        // 四路皆空时是空对象，不占结构。卦级那三法在 clash 里，不在这里重复。
        // 爻之刑。方向原样给出（谁刑谁），不折成「这几爻犯刑」——折了就看不出是谁动的。
        // 刑本身不是判词：三刑章说独犯三刑得验者少，所以这里只给位置与来路。
        // 反伏与卦变。两档不合成一条：卦变换过去的纳支并不逐位相冲，合起来报会漏掉乾变坤。
        // 也不由这一层下吉凶——章末那两句都以用神为轴，判词仍归用神旺衰。
        fanfu: reading.fanfu ?? null,
        punish: reading.punish ?? null,
        combine: reading.combine ?? null,
        clash: reading.clash,
        timing: reading.timing,
        disclaimer: DISCLAIMER,
      },
    };
  }

  if (name === 'divination_hexagram_lookup') {
    const query = clampText(args.query, 40);
    const requested = Number.isInteger(args.limit) ? /** @type {number} */ (args.limit) : 8;
    const limit = Math.min(Math.max(requested, 1), 64);
    // detail 默认 brief：卦辞与象辞说得出这卦是什么，三卦说得出它连着什么，够回答
    // 「谦卦什么意思」这类问题。彖传动辄六十字，连查八卦就是近五百字，多半用不上，
    // 却把要紧的话埋在中间。要看原文时显式传 detail="full"。
    const detail = args.detail === 'full' ? 'full' : 'brief';
    const hits = query
      ? HEXAGRAM_LIST.filter(
          (item) =>
            item.name.includes(query) ||
            item.upperTrigram.name.includes(query) ||
            item.lowerTrigram.name.includes(query) ||
            item.upperTrigram.image.includes(query) ||
            item.lowerTrigram.image.includes(query) ||
            item.judgment.includes(query) ||
            item.tuan.includes(query),
        )
      : HEXAGRAM_LIST;
    const picked = hits.slice(0, limit);
    // 宫位与世应各一行就够说明「这卦是谁」，六亲全表连干支约三十字，压到 full 里。
    const palaceLine = (item) => {
      const jf = jingfang(item);
      const shi = jf.lines[jf.shi - 1];
      const ying = jf.lines[jf.ying - 1];
      return `${jf.palaceName}${jf.stage}卦（属${jf.element}），世${shi.label}持${shi.relative}，应${ying.label}为${ying.relative}`;
    };
    const relativesLine = (item) => {
      const jf = jingfang(item);
      return jf.lines
        .map((line) => `${line.stem}${line.branch}${line.element}${line.relative}${line.role ? `持${line.role}` : ''}`)
        .join('　');
    };
    const text = picked
      .map((item) =>
        [
          `【${item.name}】第 ${item.order} 卦，${hexagramSymbol(item.key)}，上${item.upperTrigram.name}下${item.lowerTrigram.name}`,
          `卦辞：${item.judgment}`,
          detail === 'full' ? `彖传：${item.tuan}` : null,
          `象辞：${item.image}`,
          `京房：${palaceLine(item)}`,
          detail === 'full' ? `六亲：${relativesLine(item)}` : null,
          `互卦 ${mutualHexagram(item).name}，错卦 ${oppositeHexagram(item).name}，综卦 ${invertedHexagram(item).name}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');
    return {
      content: [
        {
          type: 'text',
          text: picked.length === 0
            ? `没有匹配「${query}」的卦。`
            : `${query ? `匹配「${query}」的卦共 ${hits.length} 个，` : ''}如下：\n\n${text}` +
              `${detail === 'brief' ? '\n\n（以上省去了彖传原文；需要时传 detail="full" 补上。）' : ''}` +
              `\n\n${DISCLAIMER}`,
        },
      ],
      structuredContent: { count: hits.length, detail, hexagrams: picked.map((item) => ({ name: item.name, order: item.order })) },
    };
  }

  if (name === 'divination_almanac') {
    const snapshot = almanac(now);
    // hour 只有干支序号，吉凶与时柱在 hours 的完整条目里；数九只在三九、九九两段有。
    const current = snapshot.hours.find((item) => item.current) ?? snapshot.hour;
    const text = [
      `【日期】${snapshot.date}`,
      `【干支】${snapshot.year.name}年 ${snapshot.month.name}月 ${snapshot.day.name}日 ${current.pillar}时`,
      `【节气】${snapshot.currentTerm}，月建 ${snapshot.month.name}（${snapshot.month.element}）`,
      `【当前时辰】${current.name}（${current.range}，${current.office}·${current.officeType}${current.verdict}）`,
      `【黄黑道吉时】${snapshot.luckyHours.join('、')}`,
      `【建除十二神】${snapshot.jianchu.name}`,
      snapshot.shujiu ? `【数九】${snapshot.shujiu}` : '【数九】未入数九（数九只在三九、九九两段）',
      DISCLAIMER,
    ].join('\n');
    return { content: [{ type: 'text', text }], structuredContent: snapshot };
  }

  throw new ToolError('TOOL_NOT_FOUND', `未知工具：${name}`, '先调用 tools/list，用返回的工具名重试。');
}

/**
 * @param {unknown} message
 * @param {Date} now
 * @returns {Promise<object|null>}
 */
async function handleMessage(message, now) {
  if (!message || typeof message !== 'object' || Array.isArray(message)
    || /** @type {any} */ (message).id === undefined) {
    return null; // 通知：Streamable HTTP 下直接 202。
  }
  const { id, method, params } = /** @type {any} */ (message);
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2025-11-25',
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        // 免责声明逐字取 DISCLAIMER，不在这里另写一份：Agent 同时收到两段措辞不同的
        // 免责要求时，会照着其中一段转述，于是每次讲出来的免责声明都不一样。
        instructions:
          '起卦前先问清或直接采用用户的所问之事，并用 topic 报出它属于哪一类——'
          + '事类只改应期、用神与取象，不改卦体吉凶。'
          + '结尾的【大白话】是给用户听的那一段，照着它讲，不要拿术语复述。'
          + '解读要连「所问」一起讲，不要只复述卦辞。'
          + `任何一次起卦的结果都要带上这句免责说明，不得省略、不得改写：${DISCLAIMER}`,
      },
    };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    try {
      const result = callTool(/** @type {string} */ (params?.name), params?.arguments ?? {}, now);
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      const failure = /** @type {any} */ (error);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: failure.message ?? '起卦失败。' }],
          isError: true,
          ...(failure.recovery ? { _meta: { recovery: failure.recovery } } : {}),
        },
      };
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

/**
 * Streamable HTTP：POST 一条 JSON-RPC；纯通知返回 202。
 *
 * 批量数组曾经在这里「支持」着，可 `readJsonBody` 拒绝数组（它要的是一个对象），
 * 所以那一支永远走不到——实测批量请求是 400 `invalid_body`。MCP 自 2025-03-26 起
 * 也不再支持 JSON-RPC 批量，于是这段死代码删掉，数组按非法请求处理。
 *
 * @param {{ response: import('node:http').ServerResponse, body: unknown, now?: Date }} input
 */
export async function handleMcpRequest({ response, body, now = new Date() }) {
  const reply = await handleMessage(body, now);
  const replies = reply ? [reply] : [];
  if (replies.length === 0) {
    response.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
    response.end();
    return;
  }
  const payload = JSON.stringify(replies[0]);
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

export { TOOLS };
