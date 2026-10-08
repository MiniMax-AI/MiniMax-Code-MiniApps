// @ts-check

/**
 * 梅花易数：起卦与解卦。
 *
 * 体用生克是本模块的判吉凶依据；互卦看过程、变卦看结果、错卦看旁支、综卦看反求，
 * 都由爻象推导，不查外部表。
 */

import { randomInt } from 'node:crypto';

import {
  TRIGRAMS,
  earlyKey,
  hexagramByKey,
  hexagramByNumbers,
  hexagramSymbol,
  invertedHexagram,
  mutualHexagram,
  normalizeToEight,
  normalizeToSix,
  oppositeHexagram,
} from './hexagrams.mjs';
import { monthPillar, yearPillar, dayPillar, hourPillar, monthPo, xunKong, branchClash, BRANCHES, BRANCH_ELEMENTS } from './almanac.mjs';
import { LINE_POSITIONS, responseTiming } from './xiang.mjs';
import { lineText } from './yao.mjs';
import { lineXiang } from './xiang-chuan.mjs';
import { monthQi, hexagramQi } from './guaqi.mjs';
import { jingfang, pickUseGod, hiddenGod, flyingRelation, shiYingRelation, elementRelation,
  voidReading, vitality, sixGods, SIX_GOD_MEANING, RELATIVE_MEANING, transformRelation, jinTui,
  useGodCircle, dayClashReading, heCombineReading, punishReading, hexagramClash, fanfuReading } from './jingfang.mjs';
import { detectTopic, godRelation, topicByKey, TOPIC_CLASSES } from './topics.mjs';

const GENERATES = Object.freeze({ 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' });
const OVERCOMES = Object.freeze({ 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' });

/** a 生 b。导出供测试与类神取象共用，避免五行规则在两处各写一份。 @param {string} a @param {string} b */
export function generates(a, b) {
  return GENERATES[a] === b;
}

/** a 克 b。 @param {string} a @param {string} b */
export function overcomes(a, b) {
  return OVERCOMES[a] === b;
}

/**
 * @typedef {object} MovingLine
 * @property {number} position 1 为初爻，6 为上爻
 * @property {string} label 初爻 / 二爻 ...
 * @property {0|1} value 本卦爻值
 * @property {0|1} changed 变卦爻值
 * @property {number} sum 铜钱数 6-9，数字起卦与时间起卦为 null
 * @property {'老阴'|'少阳'|'少阴'|'老阳'|'静爻'} kind
 * @property {boolean} moving 是否动爻
 * @property {string|null} text 爻辞原文「爻题：爻辞」
 * @property {string|null} title 爻题，如「初九」
 * @property {string|null} xiang 小象传原文「爻题：象辞」
 */

/**
 * @typedef {object} Reading
 * @property {string} id
 * @property {string} method
 * @property {string} question
 * @property {string} createdAt
 * @property {object} hexagram 本卦
 * @property {object|null} changed 变卦
 * @property {object|null} mutual 互卦
 * @property {object|null} opposite 错卦
 * @property {object|null} inverted 综卦
 * @property {MovingLine[]} lines
 * @property {MovingLine[]} movingLines
 * @property {object} structure 体用、五行、世应
 * @property {object} verdict 吉凶断语
 * @property {{ key: string, label: string, element: string, reason: string }|null} topic 认出事类时的类神
 * @property {'explicit'|'detected'|null} topicSource 事类是谁定的：Agent 显式给的、关键词撞出来的，还是没定
 * @property {string} [topicLine] 取象句。认不出事类时这个键不存在
 * @property {{ ask: string, topic: string, verdict: string, why: string, onTopic: string, timing: string, actions: string, caution: string }} plain 白话结论块
 * @property {string} timing 应期
 * @property {{ title: string, text: string }[]} insights
 * @property {{ label: string, value: string }[]} details 起卦依据
 * @property {{ suitable: string[], avoid: string[] }} advice
 */

const POSITION_LABELS = Object.freeze(['初爻', '二爻', '三爻', '四爻', '五爻', '上爻']);
const BRANCH_NAMES = Object.freeze(['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']);

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 对应爻：初应四、二应五、三应上。 */
function counterpart(position) {
  if (position <= 3) return position + 3;
  return position - 3;
}

/**
 * 由卦象与动爻位生成完整的六爻信息。
 * @param {string} key 六位爻象串
 * @param {number[]} positions 动爻位，1 至 6
 * @param {Array<number|null>} sums 每爻对应的铜钱数
 * @param {number} [order] 卦序 1 至 64，缺省则不带爻辞
 * @returns {(MovingLine & { text: string|null, title: string|null, xiang: string|null })[]}
 */
function buildLines(key, positions, sums, order = 0) {
  const moving = new Set(positions);
  return [...key].map((line, index) => {
    const position = index + 1;
    const value = /** @type {0|1} */ (line === '1' ? 1 : 0);
    const sum = sums[index] ?? null;
    const isMoving = moving.has(position);
    const changed = isMoving ? (value === 1 ? 0 : 1) : value;
    let kind = '静爻';
    if (isMoving) kind = value === 1 ? '老阳' : '老阴';
    else if (sum === 7) kind = '少阳';
    else if (sum === 8) kind = '少阴';
    const text = order ? lineText(order, position) : null;
    return {
      position,
      label: POSITION_LABELS[index],
      value,
      changed: /** @type {0|1} */ (changed),
      sum,
      kind,
      moving: isMoving,
      text,
      title: text ? text.slice(0, text.indexOf('：')) : null,
      xiang: order ? lineXiang(order, position) : null,
    };
  });
}

/** 去掉「爻题：」前缀，只留正文。 */
function afterColon(entry) {
  if (!entry) return '';
  const at = entry.indexOf('：');
  return at < 0 ? entry : entry.slice(at + 1);
}

function changedKey(lines) {
  return lines.map((line) => String(line.changed)).join('');
}

/**
 * 时间起卦：上卦取年支序 + 月 + 日，下卦再加时支序，总数取动爻。
 * 年支序、时支序均按地支序（子 1 至 亥 12）。
 * @param {Date} date
 */
export function castByTime(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const yearGanZhi = yearPillar(year, month, day);
  const monthGanZhi = monthPillar(year, month, day);
  const dayGanZhi = dayPillar(year, month, day);
  const hourGanZhi = hourPillar(dayGanZhi.stem, hour);

  const yearNumber = yearGanZhi.branch + 1;
  const hourNumber = hourGanZhi.branch + 1;
  const upperNumber = normalizeToEight(yearNumber + month + day);
  const lowerNumber = normalizeToEight(yearNumber + month + day + hourNumber);
  const position = normalizeToSix(yearNumber + month + day + hourNumber);

  // 时间起卦按时辰取数，两小时一换。把下一次换算结果一并给出，
  // 免得同一个时辰内反复起卦，看到同一个卦而以为结果写死。
  const nextDate = new Date(date);
  const nextBranch = (hourGanZhi.branch + 1) % 12;
  nextDate.setHours((nextBranch * 2 + 23) % 24, 0, 0, 0);
  const nextHourNumber = nextBranch + 1;
  const nextHexagram = hexagramByNumbers(
    normalizeToEight(yearNumber + month + day),
    normalizeToEight(yearNumber + month + day + nextHourNumber),
  );
  const nextPosition = normalizeToSix(yearNumber + month + day + nextHourNumber);

  return {
    method: '时间起卦',
    summary: '以年支序加公历月、日得上下卦，再加时支序得动爻。',
    cadence: {
      basis: '时辰',
      current: `${BRANCH_NAMES[hourGanZhi.branch]}时（${pad2(date.getHours())}:00 起，两小时一换）`,
      next: `${BRANCH_NAMES[nextBranch]}时得${nextHexagram.name}，动${POSITION_LABELS[nextPosition - 1]}`,
      text: `时间起卦按时辰取数，两小时一换，同一时辰内结果相同，跨时辰即变。现起${BRANCH_NAMES[hourGanZhi.branch]}时之卦；到${BRANCH_NAMES[nextBranch]}时再起，将得${nextHexagram.name}。`,
    },
    detail: [
      { label: '年支序', value: `${yearGanZhi.name}（${yearNumber}）` },
      { label: '月 · 日', value: `${month} + ${day}` },
      { label: '时支序', value: `${hourGanZhi.name}（${hourNumber}），${BRANCH_NAMES[hourGanZhi.branch]}时` },
      { label: '上卦', value: `${(yearNumber + month + day).toString()} 除 8 余 ${upperNumber} → ${TRIGRAMS[earlyKey(upperNumber)].name}` },
      { label: '下卦', value: `${(yearNumber + month + day + hourNumber).toString()} 除 8 余 ${lowerNumber} → ${TRIGRAMS[earlyKey(lowerNumber)].name}` },
      { label: '动爻', value: `${(yearNumber + month + day + hourNumber).toString()} 除 6 余 ${position} → ${POSITION_LABELS[position - 1]}` },
    ],
    hexagram: hexagramByNumbers(upperNumber, lowerNumber),
    positions: [position],
    sums: Array.from({ length: 6 }, () => null),
  };
}

/**
 * 数字起卦：两数分取上下卦，两数之和取动爻。
 * @param {number} upperNumber
 * @param {number} lowerNumber
 */
export function castByNumbers(upperNumber, lowerNumber) {
  const upper = normalizeToEight(upperNumber);
  const lower = normalizeToEight(lowerNumber);
  const position = normalizeToSix(upperNumber + lowerNumber);
  return {
    method: '数字起卦',
    summary: '以两个数字分取上下卦，两数之和取动爻。',
    cadence: {
      basis: '所取之数',
      current: `本次取数 ${upperNumber} 与 ${lowerNumber}`,
      next: '换一组数字即得另一卦',
      text: '数字起卦由你心里默念的两数决定，数字相同自然卦相同——这是取数，不是随机。心里先有事再默念数字，才算应了「以数起卦」的本意。',
    },
    detail: [
      { label: '第一数', value: `${upperNumber} 除 8 余 ${upper} → ${TRIGRAMS[earlyKey(upper)].name}卦` },
      { label: '第二数', value: `${lowerNumber} 除 8 余 ${lower} → ${TRIGRAMS[earlyKey(lower)].name}卦` },
      { label: '动爻', value: `${upperNumber + lowerNumber} 除 6 余 ${position} → ${POSITION_LABELS[position - 1]}` },
    ],
    hexagram: hexagramByNumbers(upper, lower),
    positions: [position],
    sums: Array.from({ length: 6 }, () => null),
  };
}

/**
 * 由卦直接起卦：取上下卦的先天数当两个数，交给数字起卦那条路。
 *
 * 卦库里「以此卦起一卦」要的就是这个。它原先传的是 `order` 与 `order`——同一个数
 * 上下都用，取模 8 之后上下卦必然相同，落出来永远是纯卦或错卦，64 卦里只有 2 卦起得
 * 回自己（水雷屯落成离为火）。先天数是八卦本来的那个数（一二三四五六七八），拿它起卦
 * 仍走数字起卦的规矩，起卦依据那一栏照实显示「第一数 6 除 8 余 6 → 坎卦」。
 *
 * @param {import('./hexagrams.mjs').Hexagram} hexagram
 */
export function castByHexagram(hexagram) {
  return castByNumbers(hexagram.upperTrigram.early, hexagram.lowerTrigram.early);
}

/**
 * 每日一卦：同日同结果，便于「今天怎么样」这类问题。
 * @param {Date} date
 */
export function castDaily(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const upper = normalizeToEight(year + month + day);
  const lower = normalizeToEight(year + 2 * month + day);
  const position = normalizeToSix(year + 3 * month + day);

  // 每日一卦一日一换，零点即变。明日之卦一并给出，说明它不是在原地打转。
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tYear = tomorrow.getFullYear();
  const tMonth = tomorrow.getMonth() + 1;
  const tDay = tomorrow.getDate();
  const tomorrowHexagram = hexagramByNumbers(
    normalizeToEight(tYear + tMonth + tDay),
    normalizeToEight(tYear + 2 * tMonth + tDay),
  );

  return {
    method: '每日一卦',
    summary: '按年月日确定性推算，同一天起卦结果不变。',
    cadence: {
      basis: '日期',
      current: `${year} 年 ${month} 月 ${day} 日之卦`,
      next: `明日（${tMonth}/${tDay}）得${tomorrowHexagram.name}`,
      text: `每日一卦一日一换，同一天内反复起卦自然是同一个卦，次日零点后即变。明日之卦为${tomorrowHexagram.name}。想随时随地起不同的卦，请用铜钱摇卦或数字起卦。`,
    },
    detail: [
      { label: '日期', value: `${year} 年 ${month} 月 ${day} 日` },
      { label: '上卦', value: `${year} + ${month} + ${day} = ${year + month + day}，除 8 余 ${upper} → ${TRIGRAMS[earlyKey(upper)].name}` },
      { label: '下卦', value: `${year} + ${2 * month} + ${day} = ${year + 2 * month + day}，除 8 余 ${lower} → ${TRIGRAMS[earlyKey(lower)].name}` },
      { label: '动爻', value: `${year} + ${3 * month} + ${day} = ${year + 3 * month + day}，除 6 余 ${position} → ${POSITION_LABELS[position - 1]}` },
    ],
    hexagram: hexagramByNumbers(upper, lower),
    positions: [position],
    sums: Array.from({ length: 6 }, () => null),
  };
}

/**
 * 摇卦一次：三枚铜钱，6 老阴、7 少阳、8 少阴、9 老阳。
 * @returns {{ sum: number, coins: boolean[] }} coins 中 true 为背
 */
export function tossCoins() {
  const coins = [randomInt(2) === 1, randomInt(2) === 1, randomInt(2) === 1];
  const sum = coins.reduce((total, isBack) => total + (isBack ? 3 : 2), 0);
  return { sum, coins };
}

/**
 * 摇卦：由六次掷钱结果组卦，自初爻向上。
 * @param {number[]} sums 自初爻起的六次掷钱结果
 */
export function castByCoins(sums) {
  // 每一项都得是六到九之间的整数。少了 Number.isInteger 这层，NaN 与 undefined
  // 会被 `sum < 6 || sum > 9` 一起放过去——非数与任何数比较都是 false——于是一次
  // 手搓的请求会安静地组出一个全 0 的坤卦，看着像卦，其实什么都没掷。
  if (!Array.isArray(sums)
    || sums.length !== 6
    || sums.some((sum) => !Number.isInteger(sum) || sum < 6 || sum > 9)) {
    throw new Error('六次掷钱结果必须是 6 到 9 之间的整数');
  }
  const key = sums.map((sum) => (sum === 7 || sum === 9 ? '1' : '0')).join('');
  const positions = sums.reduce((list, sum, index) => (sum === 6 || sum === 9 ? [...list, index + 1] : list), /** @type {number[]} */ ([]));
  return {
    method: '摇卦',
    summary: '三枚铜钱掷六次，自初爻向上成卦，六为老阴、九为老阳。',
    cadence: {
      basis: '铜钱',
      current: `本次掷出 ${sums.map((sum) => sum).join('、')}`,
      next: '重掷一次即得另一卦',
      text: '摇卦由铜钱随机而成，每一卦都不一样，是四法中最接近古法的一种。',
    },
    detail: [
      { label: '掷钱', value: sums.map((sum) => `${sum}`).join(' · ') },
      { label: '动爻', value: positions.length ? positions.map((p) => POSITION_LABELS[p - 1]).join('、') : '无（六爻皆静）' },
    ],
    hexagram: hexagramByKey(key),
    positions,
    sums,
  };
}

/**
 * 五行旺衰：以月令为令。当令者旺，月令所生者相，生月令者休，克月令者囚，被月令克者死。
 * 以春木为例：木旺、火相、水休、金囚、土死。
 * @param {string} element
 * @param {string} monthElement
 */
/**
 * 体用生克断吉凶。
 * @param {string} bodyElement 体卦五行
 * @param {string} useElement 用卦五行
 */
function judgeRelation(bodyElement, useElement) {
  if (bodyElement === useElement) {
    return {
      key: '比和',
      verdict: '吉',
      weight: 1,
      text: `体卦${bodyElement}与用卦${useElement}同气相求，是比和之象。彼此立场一致，事情少有阻滞，按既定节奏推进即可。`,
    };
  }
  if (generates(useElement, bodyElement)) {
    return {
      key: '用生体',
      verdict: '大吉',
      weight: 2,
      text: `用卦${useElement}生体卦${bodyElement}，是对方主动来就我。得力、得助、得人，阻力最小，是四种关系里最顺的一种。`,
    };
  }
  if (overcomes(bodyElement, useElement)) {
    return {
      key: '体克用',
      verdict: '小吉',
      weight: 1,
      text: `体卦${bodyElement}克用卦${useElement}，是我能制住局面。事情多半能办成，但要费些周折，属于主动权在我、代价也由我承担。`,
    };
  }
  if (generates(bodyElement, useElement)) {
    return {
      key: '体生用',
      verdict: '凶',
      weight: -1,
      text: `体卦${bodyElement}生用卦${useElement}，是我耗自己去成全对方。主动投入却收不回，是四种关系里最费力的一种，不宜勉强。`,
    };
  }
  return {
    key: '用克体',
    verdict: '凶',
    weight: -2,
    text: `用卦${useElement}克体卦${bodyElement}，是对方压制我。处境被动、受制于人，宜守不宜攻，先避其锋。`,
  };
}

/**
 * 所问何事落到这一卦上的那个「东西」。梅花里用卦是「事」，可「事」是空的：
 * 不问它，结论就只能停在「体卦水克用卦火」这种谁都套得上的话上——问跳槽跟问
 * 进货拿到同一句，等于没答。这里按已认出的事类，把用卦换算成那一类事里具体的那个
 * 东西。**只换说法，不换吉凶**：换问法不会把同一个卦说出相反的结论。
 */
const TOPIC_OBJECTS = Object.freeze({
  wealth: '这笔进项',
  career: '这份前程',
  love: '这段关系',
  marriage: '这桩婚事',
  health: '这桩病症',
  study: '这场考试或这纸文书',
  property: '这处房产或这纸契',
  dispute: '这桩是非',
  journey: '这趟行程或这件失物',
});

/** 生克那一层的关系怎么说。强弱不在这儿定，强弱由 judgeScore 给。 */
const RELATION_FLAVOUR = Object.freeze({
  用生体: '外头有人来成就你',
  体克用: '这件事你压得住',
  比和: '两边立场站得一般齐',
  体生用: '这件事要你往外掏',
  用克体: '外头的力压着这件事',
});

/**
 * 把生克关系与吉凶强弱收成一句落到所问之事上的话。
 * @param {{key: string, label: string}|null} topic detectTopic 认出的事类
 * @param {string} relationKey 体用生克的关系名
 * @param {string} label judgeScore 给的吉凶
 * @returns {string|null} 认不出事类就返回 null，页面不摆这句
 */
function topicSentence(topic, relationKey, label) {
  if (!topic) return null;
  const object = TOPIC_OBJECTS[topic.key];
  const flavour = RELATION_FLAVOUR[relationKey];
  if (!object || !flavour) return null;
  // 强弱一律跟着 judgeScore 给的那一档走，不拿生克那一层的教科书断语当结论：
  // 体克用本是生克小吉，体卦逢死地时总分落回「平」，这时候还说「压得住」就是过了。
  const strength = label === '大吉' || label === '吉'
    ? '这一卦落在它上面是顺的'
    : label === '平'
      ? '它上还看不出强弱'
      : '这一卦落在它上面不顺';
  return `问的是${topic.label}，卦里说的就是${object}——${flavour}，${strength}。`;
}

/**
 * 旺衰在白话里说的是「你此刻有多少劲」，不是「五行在月令里排第几」。
 * 断语里那五句（「体卦得令，所求之事根基稳」之类）是术语文，跟用户隔着一层。
 */
const VITALITY_PLAIN = Object.freeze({
  旺: '你此刻最有力气',
  相: '有人托着你，不算最强但站得住',
  休: '你使不上劲，这一回得借外力',
  囚: '你被局面困住，处境受制',
  死: '你气力最弱，此时强推反而吃亏',
});

/** 白话结论块：把体用生克这套术语翻成「你、那件事、你此刻的劲」。 */
function buildPlain({ question, topic, topicLine, verdict, body, use, timing, advice }) {
  const flavour = RELATION_FLAVOUR[verdict.key] ?? '两者关系不上不下';
  // 生克那一层与总分不一致时（体克用本是生克小吉，体卦逢死地总分落回「平」），
  // 正好是用户最容易当成「算错了」的地方，白话里把这层差价讲明白。
  // 整块里都不许出现「体卦／用卦／旺衰／类神／月令」——它们在断语正文里出现过，
  // 搬进白话就等于没翻。校验在 tests 里，措辞改了那边会报红。
  const adjust = verdict.relationVerdict !== verdict.label
    ? `照两人之间的关系本该是${verdict.relationVerdict}，你这个月的状态把它拉到了「${verdict.label}」。`
    : '';
  return {
    ask: question ? `你问的是「${question}」。` : '你没写具体问什么，我按起卦当时的时辰给你看这一卦。',
    topic: topic
      ? `我把它归到「${topic.label}」这一类——这一类以${topic.element}为事。`
      : '你问的事不在那九类里，事类先空着，时间上按那件事本身算。',
    verdict: `这一卦给的是「${verdict.label}」，${verdict.summary.split('：').slice(1).join('：') || '没有偏向'}。`,
    // 这一句是整块里最要紧的翻译：体卦是你、用卦是那件事、旺衰是你此刻的劲。
    why: `体卦${body.name}${body.element}是你，用卦${use.name}${use.element}是那件事——${flavour}；${VITALITY_PLAIN[verdict.vitality] ?? '你此刻的状态不上不下'}。${adjust}`,
    onTopic: topicLine ?? '',
    timing: timing
      ? `时间上：${timing.wang}月或${timing.wang}日见端倪，到${timing.xiang}前后渐明。`
      : '',
    actions: `该做的是：${advice.suitable.join('、')}。别做的是：${advice.avoid.join('、')}。`,
    caution: advice.caution,
  };
}

/**
 * 组装完整卦象解读。
 * @param {{ method: string, summary: string, detail: {label: string, value: string}[], hexagram: any, positions: number[], sums: (number|null)[] }} cast
 * @param {{ question?: string, id?: string, now?: Date }} [options]
 * @returns {Reading}
 */
/**
 * 吉凶只此一处断：由「生克 + 旺衰」合出来的总分定，页面徽章、结论行、MCP 抬头
 * 全取这一份。
 *
 * 从前徽章取的是 judgeRelation() 里的生克断语（只论体用生克这一条），结论行取的
 * 却是含旺衰的总分——体克用而体卦当令得旺时，同一屏上一个说「小吉」一个说
 * 「大吉」。两句话都在讲吉凶，却不是同一个吉凶，读的人只会挑一个信。
 *
 * 生克本身的教科书断语仍单列为 relationVerdict：它是这一卦凭什么得分的「因」，
 * 跟总分这个「果」不是一回事，摆在事实表里当作依据，不与结论抢位置。
 *
 * @param {number} score 生克权重加上体卦旺衰修正
 * @returns {{ label: string, summary: string }}
 */
function judgeScore(score) {
  if (score >= 2) return { label: '大吉', summary: '大吉：可进' };
  if (score >= 1) return { label: '吉', summary: '吉：宜行' };
  if (score <= -2) return { label: '大凶', summary: '大凶：宜止' };
  if (score <= -1) return { label: '凶', summary: '凶：宜守' };
  return { label: '平', summary: '平：待时' };
}

/**
 * 推一卦。
 * @param {any} cast 起卦四法的结果
 * @param {object} [options]
 * @param {string} [options.question] 所问何事原话，用于关键词认事类
 * @param {Date} [options.now]
 * @param {string} [options.topic] 事类键（九个之一）。给了就以它为准，不再看关键词；
 *   给的键不在九类里则当作没给，退回关键词那条路。
 * @returns {any} 一卦的全部解读
 */
export function buildReading(cast, options = {}) {
  const now = options.now ?? new Date();
  const question = (options.question ?? '').trim();
  const { hexagram, positions, sums } = cast;
  const lines = buildLines(hexagram.key, positions, sums, hexagram.order);
  const movingLines = lines.filter((line) => line.moving);
  const hasChange = movingLines.length > 0;

  const changed = hasChange ? hexagramByKey(changedKey(lines)) : null;
  const mutual = mutualHexagram(hexagram);
  const opposite = oppositeHexagram(hexagram);
  const inverted = invertedHexagram(hexagram);

  // 梅花易数：动爻所在经卦为体（我），另一经卦为用（事）。
  const primaryPosition = positions[0] ?? 1;
  const bodyIsLower = primaryPosition <= 3;
  const bodyKey = bodyIsLower ? hexagram.lower : hexagram.upper;
  const useKey = bodyIsLower ? hexagram.upper : hexagram.lower;
  const body = TRIGRAMS[bodyKey];
  const use = TRIGRAMS[useKey];
  const shiyinPosition = counterpart(primaryPosition);

  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const monthBranch = monthPillar(year, month, day).branch;
  const monthElement = monthPillar(year, month, day).element;
  const bodyVitality = vitality(body.element, monthElement);
  const useVitality = vitality(use.element, monthElement);
  const relation = judgeRelation(body.element, use.element);

  // 卦气是另一条路：月建五行讲的是「这五行在当月强弱如何」，十二辟卦讲的是
  // 「当月本该是哪一卦当令」。两者不互相替代，故并列给出。
  const monthLord = monthQi(monthBranch);
  const selfQi = hexagramQi(hexagram.key);

  // 所问何事落到事类，事类取类神五行。类神只管应期与取象，不改吉凶——
  // 同一个卦问财与问婚，凶不会因此翻面，只是看的时辰和轻重不同。
  //
  // 事类有两个来路。关键词那条是给页面用的：页面上只有一句「所问何事」，
  // 没有能替你归纳的人。MCP 那条是给 Agent 用的——它本来就看得懂用户在说
  // 什么，让它自己挑，比在这儿拿一串词去撞「他对我还有没有真心」这类问法
  // 靠谱得多。**显式给的优先**：Agent 是在读过原话之后判断的，比关键词更
  // 贴近用户真正问的那件事。认不出（没给、或给的键不在九类里）才退回关键词。
  const explicitTopic = topicByKey(options.topic);
  const topic = explicitTopic ?? detectTopic(question);
  const topicSource = explicitTopic ? 'explicit' : (topic ? 'detected' : null);
  const god = topic ? godRelation(topic.element, body.element, generates, overcomes) : null;
  const timing = topic
    ? responseTiming(topic.element, `${topic.label}类神`)
    : responseTiming(use.element, `用卦${use.name}`);
  const linePosition = LINE_POSITIONS[primaryPosition - 1];

  const structure = {
    body: { key: bodyKey, name: body.name, element: body.element, nature: body.nature, image: body.image, direction: body.direction, position: bodyIsLower ? '内卦（下卦）' : '外卦（上卦）' },
    use: { key: useKey, name: use.name, element: use.element, nature: use.nature, image: use.image, direction: use.direction, position: bodyIsLower ? '外卦（上卦）' : '内卦（下卦）' },
    shi: { position: primaryPosition, label: POSITION_LABELS[primaryPosition - 1], role: '动爻 · 体卦' },
    ying: { position: shiyinPosition, label: POSITION_LABELS[shiyinPosition - 1], role: '配爻 · 用卦' },
    monthElement,
    bodyVitality: bodyVitality.key,
    useVitality: useVitality.key,
  };

  const weight = relation.weight + (bodyVitality.tone === 'strong' || bodyVitality.tone === 'good' ? 1 : bodyVitality.tone === 'bad' ? -1 : 0);
  const judged = judgeScore(weight);
  const verdict = {
    key: relation.key,
    label: judged.label,
    score: weight,
    summary: judged.summary,
    text: relation.text,
    relationVerdict: relation.verdict,
    vitality: bodyVitality.key,
    vitalityText: `体卦五行属${body.element}，当月令为${monthElement}，旺衰落在「${bodyVitality.key}」。${{ 旺: '体卦得令，所求之事根基稳。', 相: '体卦得月令之助，虽非最强但有托底。', 休: '体卦失令而休，力量不足，宜借外力。', 囚: '体卦受月令所困，处境受制，宜守。', 死: '体卦逢月令死地，气力最弱，此时强求不利。' }[bodyVitality.key]}`,
  };

  const insights = [];
  insights.push({ title: '卦象总断', text: `本卦${hexagram.name}，${hexagram.judgment} ${hexagram.image}` });
  // 卦辞说大势，爻辞才对着动的那一爻说话，所以把它排在紧随卦辞之后；象传跟在
  // 同一段里，是这一爻「凭什么」的解释。
  const yaoQuotes = movingLines.map((line) => {
    const say = line.text ? `${line.text}　象曰：${afterColon(line.xiang)}` : '';
    return say;
  }).filter(Boolean);
  if (yaoQuotes.length > 0) {
    insights.push({ title: '动爻爻辞', text: yaoQuotes.join('；') });
  }
  if (topic && god) {
    insights.push({
      title: '所问之事',
      text: `所问归「${topic.label}」，类神取${topic.element}。${topic.reason}${god.text}`,
    });
  }
  insights.push({ title: '体用关系', text: relation.text });
  insights.push({ title: '旺衰应期', text: verdict.vitalityText });
  if (monthLord) {
    // 卦气只讲位置，不改吉凶：本卦是不是当令主卦，是另一维度的话，不与体用相混。
    const trend = monthLord.phase === '息'
      ? '当月阳气渐长，主事有推进之势'
      : '当月阴气渐盛，主事宜收敛守成';
    const self = selfQi
      ? `本卦${hexagram.name}正在十二辟卦之中，为${selfQi.short}卦，属${selfQi.phase}，${selfQi.meaning}`
      : `本卦${hexagram.name}不属十二辟卦，十二辟卦是乾坤二宫专主月份的十二卦，其余五十二卦不论卦气`;
    const align = selfQi
      ? (selfQi.phase === monthLord.phase
        ? `与当月${selfQi.phase === '息' ? '同处阳长之段，方向与时势相合' : '同处阴长之段，行事与时势相应'}。`
        : `与当月${monthLord.short}卦分处消长两端，是逆着时势走，宜放缓一步。`)
      : '';
    insights.push({
      title: '卦气 · 当令主卦',
      text: `${BRANCHES[monthBranch]}月当令主卦为${monthLord.name}，${monthLord.meaning}${trend}。${self}${align}`,
    });
  }
  insights.push({
    title: '互卦 · 过程',
    text: `互卦为${mutual.name}，主事情中间一段的走向。${mutual.image}`,
  });
  if (changed) {
    insights.push({ title: '变卦 · 结果', text: `动爻${movingLines.map((line) => line.label).join('、')}，变出${changed.name}，主事情最终落点。${changed.image}` });
  } else {
    insights.push({ title: '变卦 · 结果', text: '六爻皆静，无变卦。事态格局稳定，不会中途生变，守住当前位置即可。' });
  }
  insights.push({
    title: '错卦 · 旁支',
    text: `错卦为${opposite.name}，是同一件事的另一面，提醒你别只盯着眼前这一层。${opposite.image}`,
  });
  insights.push({
    title: '综卦 · 反求',
    text: `综卦为${inverted.name}，是此事的倒影：换到对方的位置看，往往能看出自己忽略的条件。${inverted.image}`,
  });
  // 京房一层：本卦定宫定世次，六爻各装纳甲与六亲。世爻是我、应爻是对方，
  // 世应之间的生克讲的是「我跟这个人」，与上面体用讲的「我跟这件事」不是一回事。
  const jf = jingfang(hexagram);
  const shiLine = jf.lines[jf.shi - 1];
  const yingLine = jf.lines[jf.ying - 1];
  const shengke = shiYingRelation(shiLine.element, yingLine.element);
  const movingRelatives = movingLines
    .map((line) => jf.lines[line.position - 1])
    .filter((line) => line.relative)
    .map((line) => `${line.label}${line.relative}`);
  const uniqueRelatives = [...new Set(movingRelatives.map((item) => item.replace(/^.*?爻/u, '')))];
  insights.push({
    title: '六亲世应',
    text: [
      `${jf.palaceName}${jf.stage}卦，属${jf.element}。世爻${shiLine.label}持${shiLine.relative}，应爻${yingLine.label}为${yingLine.relative}。`,
      shengke ? `${shengke.text}。` : '',
      movingRelatives.length > 0
        ? `动爻${movingRelatives.join('、')}，事落在${uniqueRelatives.join('、')}上：${uniqueRelatives.map((name) => RELATIVE_MEANING[name]).filter(Boolean).join('；')}。`
        : '六爻皆静，无动爻，身份格局照旧。',
      jf.stage === '游魂' || jf.stage === '归魂' ? jf.stageMeaning : '',
    ].filter(Boolean).join(''),
  });

  // 用神：问何事取何亲。六亲摆在那里只是摆着，落到「你问的这一件事」上才算用上了。
  const movingPositions = movingLines.map((line) => line.position);
  const useGod = topic ? pickUseGod(jf, topic.god.relatives, movingPositions) : null;
  const dayBranch = dayPillar(year, month, day).branch;
  const dayGanZhi = dayPillar(year, month, day);
  const calendar = {
    monthElement,
    dayElement: BRANCH_ELEMENTS[dayBranch],
    // 旬空要靠日柱在六十甲子里的序号才排得出，月破与入墓要靠地支序号，都一并带上。
    dayIndex: dayGanZhi.index,
    dayStem: dayGanZhi.stem,
    dayBranch,
    monthBranch,
    movingPositions,
    movingElements: movingLines.map((line) => {
      const na = jf.lines[line.position - 1];
      return na ? na.element : body.element;
    }),
  };
  // 日辰冲爻分三路：静爻旺相作暗动、静爻休囚作日破、动爻作冲散。判定在 jingfang 层。
  const clash = dayClashReading(jf, calendar);
  const darkPositions = clash.dark.map((line) => line.position);
  const pressedPositions = clash.pressed.map((line) => line.position);
  // 用神那圈（元神、忌神、仇神）只在一个用神定下来时才存在：不上卦取的是伏神，
  // 伏神在卦外，元忌仇无从谈起；两亲各看各的时也无从取舍。所以只在 picked 非空时算。
  // 排在暗动之后，是因为这一圈要报「暗动」与「动而逢冲」——元神忌神究竟在明处动、
  // 是在暗处动、还是正被日辰冲着，正要用刚算出来的日冲爻位。
  const circle = useGod && useGod.picked
    ? circleReading(jf, useGod.picked, calendar, darkPositions, pressedPositions)
    : null;
  insights.push({
    title: '用神',
    text: useGod
      ? useGodText(topic, useGod, jf, movingPositions, calendar, circle, darkPositions, pressedPositions)
      // 写没写问题与写了但认不出是两回事。都说成「未写所问何事」，等于把话没说到位
      // 赖到问卦的人头上——他明明写了，是这张事类表没接住那句话。
      : (question
        ? `写了问题，但这句话里没有本包认得的事类词。用神是「问何事取何亲」，认不出所问何事就取不出用神——`
          + `表里接得住的是${TOPIC_CLASSES.map((item) => item.label).join('、')}这九类，`
          + '把话里带上具体那一件事再看这一段。'
        : '未写所问何事，取不出用神——六亲各管一摊事，没有所指就没有用神。写下问题再看这一段。'),
  });

  // 这一段紧接用神：暗动章的吉凶两路（喜、忌）判的正是元神与忌神是不是在暗中动手，
  // 冲散章则说动爻逢日冲并不作散——都是拿日辰对着用神周围那圈讲的，
  // 挨着「用神是谁、谁坐着」才接得上。
  if (clash.dark.length > 0 || clash.dayBroken.length > 0 || clash.pressed.length > 0) {
    insights.push({ title: '暗动 · 日破 · 冲散', text: dayClashText(clash, circle, calendar) });
  }

  // 变卦的京房卦提前算出来：下面「六冲」那一段要判变卦是不是六冲/六合，
  // 「逢合」那一段要拿变出的那一爻回头看，化爻那一段也要用。
  const changedJf = changed ? jingfang(changed) : null;

  // 爻之合的另外三法。卦级那三法（卦逢六合、六冲变六合、六合变六合）在 hexagramClash 里，
  // 已经画在卦体边上、也在「卦体冲合」那一格列出；这里补的是落在单爻上的三法，
  // 按动静与来路分成合起、合绊、合好、化扶四名。排在暗动、六冲之后：
  // 前一段拿日月对着爻看冲，后一段先认整卦的冲合，再落到单爻的合上。
  const combine = heCombineReading(jf, calendar, changedJf);
  if (combine.hasAny) {
    insights.push({ title: '逢合 · 合起合绊合好化扶', text: heCombineText(combine, calendar) });
  }

  // 爻之刑。三刑章那句话自带一个很紧的前提，判定放在 punishText 里核。
  // 排在逢合之后：那一段讲合住，这一段讲刑伤，都是拿日月与别爻对着这一爻看。
  const punish = punishReading(jf, calendar);
  if (punish.hasAny) {
    insights.push({ title: '犯刑', text: punishText(punish, jf, circle, calendar) });
  }

  // 变出之爻：本卦这一爻是「谁」，变出来的那一爻是它「往哪儿去」。
  // 提前算在这里，不只是为了下面那一段——章末那句「用神化回头冲克」的判定
  // 只有 transformReading 这一处有，在别处重算一遍就是两套说法。
  const transforms = changedJf
    ? movingPositions.map((position) => transformReading(position, jf, changedJf, calendar))
    : [];

  // 反伏与卦变。反伏章第二十五把两者摆在一起说，但条件对不上（见 jingfang 的注），
  // 所以分两档报。排在犯刑之后：前面几段都是拿单爻说话，这一段才看整卦的内与外。
  const fanfu = fanfuReading(jf, calendar, changedJf);
  if (fanfu.hasAny) {
    insights.push({
      title: '反伏与卦变',
      text: fanfuText(fanfu, changed.name, topic, circle, calendar, movingPositions, transforms),
    });
  }

  // 六冲章的六种冲，前一路（日月冲爻）刚在上面逐爻算过，这里接着数剩下几路。
  // 触发条件取「卦体本身是六冲或六合」加「变卦是六冲」加「动爻变冲」——
  // 卦内零散爻与爻冲六十四卦里有三十卦都有，单拿它当触发会让大半卦都多出这一段，
  // 所以那一路只在卦体已经因为别的理由出段时顺带报，不单独开段。
  const kinds = clashKinds({ hexagram, jf, changed, changedJf, movingPositions });
  if (kinds.chong || kinds.he || kinds.changedChong || kinds.transformClash.length > 0) {
    insights.push({ title: '六冲', text: clashText(kinds, circle, topic, calendar) });
  }

  insights.push({ title: '化爻 · 变出之爻', text: transformText(transforms, circle) });

  // 「世应」这两个字留给京房那边：世爻恒由本卦的宫与世次定，与动爻无关。梅花这一层
  // 讲的是我与事，说「主客」才不打架——同一段解读里出现两个不同的世爻位会看糊涂。
  // 对应爻是初应四、二应五、三应上，来回都跨内卦与外卦，所以主客恒分居两卦，
  // 不存在「同在一卦」的情形，这里只陈事实，趋势的话留给体用关系与取象两段。
  insights.push({
    title: '主客',
    text: `体卦在${POSITION_LABELS[primaryPosition - 1]}，是我；用卦在${POSITION_LABELS[shiyinPosition - 1]}，是所测之事。世为己、应为彼，两爻相隔三位，恒分居内卦与外卦。`,
  });
  insights.push({
    title: '取象',
    text: `下卦${body.name}取${body.image}象，主自身与内里；上卦${use.name}取${use.image}象，主环境与外在。体${body.nature}而用${use.nature}，${body.nature === use.nature ? '两卦同性，内外如一' : `内外异质，外在环境是${use.nature}的，对你形成${generates(use.element, body.element) ? '生扶' : overcomes(use.element, body.element) ? '压制' : '耗损'}。`}${god ? `就所问之事而论，${god.text}` : ''}`,
  });
  insights.push({
    title: `爻位 · ${linePosition.title}`,
    text: `动爻在${POSITION_LABELS[primaryPosition - 1]}。${linePosition.text}`,
  });
  insights.push({
    title: '方所',
    text: `体卦${body.name}居${body.direction}，用卦${use.name}居${use.direction}。寻物问路可取此方位；体卦方位主你所归，用卦方位主你要去的地方。`,
  });

  if (timing) {
    insights.splice(2, 0, { title: '应期', text: timing.text });
  }

  const advice = buildAdvice(verdict);
  const topicLine = topic ? topicSentence(topic, verdict.key, verdict.label) : null;

  return {
    id: options.id ?? buildId(hexagram, positions, now),
    method: cast.method,
    question,
    createdAt: now.toISOString(),
    hexagram: serialize(hexagram),
    changed: changed ? serialize(changed) : null,
    mutual: serialize(mutual),
    opposite: serialize(opposite),
    inverted: serialize(inverted),
    lines,
    movingLines,
    structure,
    jingfang: jf,
    changedJingfang: changedJf,
    // 六神自初爻向上各归一爻。只说是什么气氛，不参与生克，也不动吉凶。
    sixGods: sixGods(dayGanZhi.stem),
    // 旬空与月破是这一卦整体的两处日子，跟哪一卦无关，单列一份给右栏和历法页用。
    void: (() => {
      const kong = xunKong(dayGanZhi.index);
      const po = monthPo(monthBranch);
      return {
        headName: kong.headName,
        names: kong.voidNames,
        brokenName: BRANCHES[po],
      };
    })(),
    // 六爻各自逢什么：旬空（连真假）、月破、入墓、暗动、日破。卦体照这个画小标，断语照这个说话。
    // 注意两个「破」不是一回事：broken 是月建冲的月破，这里 dayBroken 才是日辰冲的日破。
    states: jf.lines.map((line) => {
      const v = voidReading(line, calendar);
      return {
        position: line.position,
        void: v.isVoid,
        voidKind: v.status,
        broken: v.isBroken,
        tomb: v.isTomb,
        dark: darkPositions.includes(line.position),
        dayBroken: clash.dayBroken.some((one) => one.position === line.position),
        // 冲散：动爻被日辰冲到。与暗动、日破互斥，三者不会同落一爻。
        pressed: pressedPositions.includes(line.position),
        // 逢合：这一爻合于日月、与另一动爻相合、或动爻化出之爻回头相合，三路任一即是。
        // 与上面那三个不互斥——冲的是被冲来的那一边，合的是被缠住的那一边，同一爻可以又逢冲又逢合。
        combined: combine.hitPositions.includes(line.position),
        // 犯刑：与「逢合」不是互斥的两路。合是被缠住，刑是被伤着，同一爻可以又合又刑。
        punished: punish.hitPositions.includes(line.position),
        rescues: v.rescues,
        empties: v.empties,
      };
    }),
    // 日辰冲爻的三路各是哪些爻。暗动约逢三卦里一卦，日破略多，冲散（动爻逢冲）又约四卦里一卦；
    // 三路皆空时断语里不出这一段。
    dayClash: {
      dark: darkPositions,
      dayBroken: clash.dayBroken.map((line) => line.position),
      pressed: pressedPositions,
    },
    // 爻之合那四名各是哪些爻。合起与合绊互斥（一爻要么静要么动），
    // 合好与化扶可以与它们同落一爻。日月合爻最常见，合好要两爻皆动、化扶要动爻化出之爻
    // 回头相合，都少得多。四路皆空时断语里不出这一段。
    // 反伏与卦变。两档不合成一条：卦变换过去的纳支并不逐位相冲，
    // 合成一条报，乾变坤就得被漏掉。内/外各报出换过去的那三支，方向不折。
    fanfu: {
      kind: fanfu.kind,
      inner: fanfu.inner,
      outer: fanfu.outer,
      guaChange: fanfu.guaChange,
      innerSwap: fanfu.inner ? [fanfu.innerFrom, fanfu.innerTo] : null,
      outerSwap: fanfu.outer ? [fanfu.outerFrom, fanfu.outerTo] : null,
    },
    // 爻之刑。方向原样带出去（谁刑谁），不折成「这几爻犯刑」——折了就看不出是谁动的。
    punish: {
      linePairs: punish.linePairs.map((pair) => [pair.from.position, pair.to.position, pair.self]),
      outside: punish.outside.map((item) => [item.line.position, item.source, item.from, item.to, item.self]),
    },
    combine: {
      rise: combine.rise.map((item) => [item.line.position, item.source]),
      bind: combine.bind.map((item) => [item.line.position, item.source]),
      friendly: combine.friendly.map((item) => [item.lineA.position, item.lineB.position]),
      support: combine.support.map((item) => item.line.position),
    },
    // 六冲章那六种冲逐条对出来的结果。本卦逢六冲十五卦中的十卦、六合八卦，都是整卦的
    // 定性；变卦那两路与动爻变冲要等动起来才谈得上。爻位一律用数字，便于程序取用。
    clash: {
      chong: kinds.chong,
      he: kinds.he,
      changedChong: kinds.changedChong,
      changedHe: kinds.changedHe,
      heToChong: kinds.heToChong,
      chongToChong: kinds.chongToChong,
      transformClash: kinds.transformClash.map((item) => item.position),
      incidental: kinds.incidental.map((pair) => [pair.a, pair.b]),
      pairs: kinds.pairs.map((pair) => ({
        lower: pair.lower.position,
        upper: pair.upper.position,
        kind: pair.kind,
      })),
      // 变卦那三对同样给出去：卦体上本卦与变卦各画一组冲合连线，六冲变六冲那一路
      // 才看得见「两头都是三对皆冲」，而不是只在本卦上出。
      changedPairs: (changedJf
        ? hexagramClash(changed, changedJf).pairs
        : []).map((pair) => ({
        lower: pair.lower.position,
        upper: pair.upper.position,
        kind: pair.kind,
      })),
    },
    useGod: useGod
      ? {
          topic: topic.key,
          relatives: useGod.relatives,
          present: useGod.present,
          absent: useGod.absent,
          picked: useGod.picked,
          why: useGod.why,
          // 用神周围那一圈：元神、忌神、仇神。用神定不下来时无此圈（伏神在卦外，
          // 两亲各看各的也无从取舍），所以是一段字段而不是逐爻摊开。
          circle: circle
            ? {
                yuan: circle.yuan.map((line) => line.position),
                ji: circle.ji.map((line) => line.position),
                chou: circle.chou.map((line) => line.position),
                elements: circle.elements,
              }
            : null,
          // 用神不上卦时，从本宫首卦借来的伏神与压在它上面的飞神。
          // sentence 只给断语正文用，不进结构化字段——那段话断语里已经整段说过了。
          hidden: useGod && useGod.picked === null && useGod.present.length === 0
            ? useGod.absent
              .map((name) => {
                const one = hiddenReading(name, jf, calendar);
                if (!one) return null;
                const { sentence, ...rest } = one;
                return rest;
              })
              .filter(Boolean)
            : [],
        }
      : null,
    verdict,
    // 取象句挂在 verdict 上而不是平铺一层：它跟吉凶是一件事的两半——吉凶是那一档，
    // 取象句是这一档落在所问之事上是什么话。拆开放，页面就得自己拼回去。
    // 认不出事类时这个键压根不存在（不是 null），页面不摆这句，也不拿它凑数。
    ...(topic ? { topicLine } : {}),
    // 白话块：MCP 把它接在正文末尾，Agent 照着讲给用户听。每一句都从上面已算好的
    // 字段来，不另起一套判断，也不替没定吉凶的东西表态。
    plain: buildPlain({ question, topic, topicLine, verdict, body, use, timing, advice }),
    // 每一动爻变出来的那一爻：回头生克、进退神、化空化墓。断语正文与这里走同一份，
    // sentence 只进断语不进字段——那段话断语里已经整段说过了。
    transforms: transforms.map(({ sentence, ...rest }) => rest),
    topic: topic ? { key: topic.key, label: topic.label, element: topic.element, reason: topic.reason } : null,
    // 事类是谁定的：Agent 显式给的、关键词撞出来的，还是压根没定。前两种差别说大不大——
    // 关键词那一路会有「问的是感情，但原话里没一个词在表上」的漏判，Agent 显式给就绕开了。
    topicSource,
    qi: monthLord
      ? {
        branch: monthBranch,
        lord: monthLord.name,
        lordShort: monthLord.short,
        phase: monthLord.phase,
        yangCount: monthLord.yangCount,
        self: selfQi ? selfQi.short : null,
        selfName: selfQi ? selfQi.name : null,
        selfPhase: selfQi ? selfQi.phase : null,
      }
      : null,
    timing: timing?.text ?? '',
    cadence: cast.cadence ?? null,
    insights,
    details: cast.detail,
    advice,
  };
}

/** 用神与世爻的关系：世爻是我，用神是所求之事，两者的生克讲「这件事对我是什么」。 */
const GOD_SHI_TONE = Object.freeze({
  生: '世爻生用神，用神得扶，所求之事有底子。',
  被生: '用神生世爻，反是我被这件事牵着走，多主我出力多过收成。',
  克: '世爻克用神，这件事在我压制之下，主动权在握但要费力气。',
  被克: '用神克世爻，这件事压着我，宜守不宜攻。',
  同气: '用神与世爻同气，所求之事与我的处境同一路数，顺势为宜。',
});

/**
 * 伏神出不出得来。
 *
 * 《增删卜易·飞伏神章》列「伏神易出有六」与「终不得出有五」，本包七条都能核验：
 *   易出六——得日月生、得旺相、得飞神生、得动爻生，用月建与日辰即可判；
 *           「飞神逢旬空、月破或休囚墓绝」这一条要旬空、月破、入墓，也已做。
 *   不出五——休囚无气、被日月冲克、被旺相飞神克害、正逢墓绝、直逢旬空月破，逐条对上。
 * 六用五不出之外，野鹤还把休、囚、死并入无气，本包同此口径。
 */

/**
 * 伏神的取法、飞伏生克与出伏结论，收在一处。
 * 断语正文与 reading.useGod.hidden 两边都从这里取，免得同一卦算出两个说法。
 * @returns {{relative: string, position: number, hushen: string, feishen: string,
 *   feishenRelative: string, flying: string, emerges: {key: string, text: string},
 *   sentence: string} | null}
 */
function hiddenReading(name, jingfang, calendar) {
  const pair = hiddenGod(jingfang, name);
  if (!pair) return null;
  const flying = flyingRelation(pair.hushen, pair.feishen);
  // 伏神与飞神各自逢什么空、破、墓，一并问出来；伏神按野鹤的分法再判真假。
  const fu = voidReading(pair.hushen, { ...calendar, isHidden: true, isStruck: flying.key === '飞来克伏' });
  const god = sixGods(calendar.dayStem)[pair.hushen.position - 1];
  const fei = voidReading(pair.feishen, calendar);
  const emerges = hiddenVerdict(
    pair.hushen,
    pair.feishen,
    flying,
    calendar.monthElement,
    calendar.dayElement,
    calendar.movingElements,
    {
      isVoid: fu.isVoid,
      status: fu.status,
      isBroken: fu.isBroken,
      isTomb: fu.isTomb,
      flyingVoid: fei.isVoid,
      flyingBroken: fei.isBroken,
      flyingTomb: fei.isTomb,
    },
  );
  return {
    relative: name,
    position: pair.hushen.position,
    hushen: `${pair.hushen.stem}${pair.hushen.branch}${pair.hushen.element}`,
    feishen: `${pair.feishen.stem}${pair.feishen.branch}${pair.feishen.element}`,
    feishenRelative: pair.feishen.relative,
    god,
    flying: flying.key,
    emerges,
    sentence: `${name}伏在${pair.hushen.position}爻之下——本宫首卦${pair.palaceName}的${pair.hushen.stem}${pair.hushen.branch}${pair.hushen.element}在此位，`
      + `压着它的${pair.feishen.stem}${pair.feishen.branch}${pair.feishen.element}${pair.feishen.relative}是飞神。`
      + `${flying.text}。伏神临${god}，${SIX_GOD_MEANING[god].meaning}，只是它的调子，成不成仍只由生克与旺衰定。`
      + `${emerges.text}`,
  };
}

/** 伏神那一整句：取自本宫首卦，飞伏生克 + 出不出得来。 */
function hiddenText(god, jingfang, calendar) {
  const found = [];
  for (const name of god.absent) {
    const one = hiddenReading(name, jingfang, calendar);
    if (!one) {
      found.push(`${name}在本宫首卦里也寻不到`);
      continue;
    }
    found.push(one.sentence);
  }
  return `按《增删卜易·飞伏神章》从本宫首卦取伏神：${found.join(' ')}`;
}

function hiddenVerdict(hushen, feishen, flying, monthElement, dayElement, movingElements, state) {
  // 《增删卜易》「伏神易出有六」与「终不得出有五」逐条落：旺衰靠月建，生扶靠月建与
  // 日辰，旬空月破入墓各据其表，飞伏空破则压不住伏神。七条之外野鹤还把休囚死并入无气。
  const good = [];
  if (generates(monthElement, hushen.element)) good.push('得月建生');
  if (generates(dayElement, hushen.element)) good.push('得日辰生');
  const tone = vitality(hushen.element, monthElement);
  if (tone.tone === 'strong' || tone.tone === 'good') good.push(`于月建${tone.key}`);
  if (flying.key === '飞来生伏') good.push('得飞神生');
  if (movingElements.some((element) => generates(element, hushen.element))) good.push('得动爻生');
  if (state.flyingVoid || state.flyingBroken || state.flyingTomb) {
    good.push('飞神逢空破墓，压不住它');
  }

  const bad = [];
  if (overcomes(monthElement, hushen.element) || overcomes(dayElement, hushen.element)) {
    bad.push('被月建或日辰克');
  }
  if (['休', '囚', '死'].includes(tone.key)) bad.push(`于月建${tone.key}，休囚无气`);
  if (overcomes(feishen.element, hushen.element)
    && ['strong', 'good'].includes(vitality(feishen.element, monthElement).tone)) {
    bad.push('被旺相的飞神克害');
  }
  // 「伏神正逢休囚无气」「被日月冲克」「被旺相飞神克害」三条之外，
  // 《增删卜易》另列「占卦之日月伏神正逢墓绝」与「伏神直旬空、月破」——正是这三条。
  if (state.isTomb) bad.push('占卦之日月于伏神正逢入墓');
  if (state.isVoid) bad.push(`伏神直${state.status || '旬空'}`);
  if (state.isBroken) bad.push('伏神逢月破');

  // 「这一旬空不空」与「出不出得来」本就是两问，野鹤也分列两处。混在一句里会出现
  // 「旬空而假空……终不得出」这种看着自相矛盾的话，所以两句要分开摆：先讲空，
  // 真空就把空本身算作出不来的一条，假空就说清「空不为其患」——出不来是另有原因。
  const kongHead = (() => {
    if (!state.isVoid) return '';
    // 真空时 bad 里有「伏神直真空」兜着底，头一句只点个方向，不必把空说三遍。
    if (state.status === '真空') return '伏神旬空而真空，';
    if (state.status === '假空') return '伏神旬空而假空，空不为其患，';
    return '伏神旬空，真假未判，';
  })();

  if (good.length > 0) {
    return {
      key: '出得来',
      text: `${kongHead}伏神${good.join('、')}，出得来，无用亦为有用。`
        + (state.status === '假空' ? '不过此是假空，出旬或逢冲之后才见真章。' : ''),
    };
  }
  if (bad.length > 0) return { key: '出不来', text: `${kongHead}伏神${bad.join('、')}，终不得出，虽有如无。` };
  // 这里走不到，也没有走不到的分支可留：旺衰只有旺相休囚死五档，旺相进 good、
  // 休囚死进 bad，两边必有一边非空，「出得来」与「出不来」已穷尽全部情形。
  // 早先还留过一个「无从判」兜底，扫了两千六百八十八个伏神，一次都没走到——是死代码，删。
  /* c8 ignore next */
  throw new Error('出伏判定漏了情形：旺衰本该让 good 或 bad 必有其一');
}

/** 用神那一段。候选不止一亲时只各报所在，不替求测者择。circle 由 buildReading 算好传进来。 */
function useGodText(topic, god, jingfang, movingPositions, calendar, circle, darkPositions, pressedPositions) {
  const motion = motionTiers(calendar, darkPositions, pressedPositions);
  // 用神自己那一爻的动静与元神忌神仇神同一口径——两处分开写，早先就写岔过一次：
  // 那一圈认四档，这里只认动静两档，于是用神自己暗动了或冲散了也看不出来。
  const where = (name) => god.all.filter((line) => line.relative === name)
    .map((line) => {
      const kind = motion(line.position);
      return `${line.label}${kind === '静' ? '' : `（${kind}）`}`;
    })
    .join('、');
  const head = `所问为${topic.label}，${topic.god.reason}`;

  // 一亲都不上卦：传统从本宫首卦取伏神，连带飞神与出不出得来一并断。
  if (!god.picked && god.present.length === 0) {
    return `${head}卦中${god.relatives.join('、')}一亲也不见，属用神不上卦。${hiddenText(god, jingfang, calendar)}`;
  }

  // 候选不止一亲：婚恋分男女（byGender），本包不认得求测者性别；疾病是病症与医药
  // 两头看。两种情形都只报所在，不硬择其一——择了就等于替人认了性别或认了病势。
  if (god.relatives.length > 1) {
    const rows = god.present.map((name) => `${name}见于${where(name)}`).join('；');
    const tail = topic.god.relate && god.present.length === 2
      ? `${topic.god.relate}`
      : topic.god.byGender ? '对照自己那一亲取用。' : '';
    return `${head}卦中${rows}。${god.present.length < god.relatives.length ? `${god.absent.join('、')}不上卦。` : ''}${tail}`;
  }

  const picked = god.picked;
  const parts = [head, `卦中${god.present[0]}见于${where(god.present[0])}。`];
  if (god.all.length > 1) {
    parts.push(`两现，按${god.why}取${picked.label}。`);
  }
  parts.push(circle.sentence);
  const relation = elementRelation(jingfang.lines[jingfang.shi - 1].element, picked.element);
  parts.push(picked.position === jingfang.shi
    ? '用神恰在世爻之上，所求之事就在自己身上。'
    : GOD_SHI_TONE[relation]);
  const state = voidSentence(voidReading(picked, { ...calendar, movingPositions }));
  if (state) parts.push(state);
  // 别把局部也叫 god：这个函数的第二个参数就叫 god，同名会撞成重复声明。
  // （与先前 hiddenGod 那次参数名 jingfang 遮蔽同源，是同一类错。）
  const pickedGod = sixGods(calendar.dayStem)[picked.position - 1];
  // 爻位用汉字，跟全篇「二爻」「五爻」一致，别在中文里插个「2爻」。
  parts.push(godSentence(pickedGod, picked.label));
  return parts.join('');
}

/**
 * 动爻变出来的那一爻：回头生克、进退神、化空化墓。
 *
 * 变爻只跟本位这一爻生克，这一条有明文。《增删卜易》：「夫變出之爻，能生克沖合本位之動爻，
 * 不能生克他爻，而他爻與本位之動爻，亦不能生克變爻。」所以这里只取本卦动爻与变卦同位那一爻，
 * 不去跟别爻攀关系，也不去跟世爻应爻攀——那是「他爻」，书上说得很清楚。
 *
 * 化空、化墓只作事实报告，**不配吉凶调子**。野鹤讲空讲的是「动爻逢空」那一层，
 * 书上并没有「变爻逢空即凶」这样的断语；变爻是不是空破入墓是看得见的事，说出来就是，
 * 成不成仍旧归回头生克那一句管。
 *
 * @param {number} position 动爻位
 * @param {import('./jingfang.mjs').Jingfang} jingfang 本卦
 * @param {import('./jingfang.mjs').Jingfang} changedJingfang 变卦
 * @param {object} calendar
 */
function transformReading(position, jingfang, changedJingfang, calendar) {
  const moving = jingfang.lines[position - 1];
  const ch = changedJingfang.lines[position - 1];
  const relation = transformRelation(moving, ch);
  const move = jinTui(moving.branch, ch.branch);
  // 变爻在变卦里是静的，不是本卦的动爻。问它逢什么时要把动爻位与动爻五行清空再问，
  // 留着就会把「发动」「得动爻生扶」这些救应错记到它头上——变爻不是动爻，别混。
  const v = voidReading(ch, { ...calendar, movingPositions: [], movingElements: [] });
  const marks = [];
  if (v.isVoid) marks.push(v.status === '真空' ? '化真空' : v.status === '假空' ? '化假空' : '化空');
  if (v.isTomb) marks.push('化墓');
  const stateText = marks.length === 0
    ? ''
    : `变爻${marks.join('又')}——这是这一爻此刻的处境，看得见；成不成仍旧归上头那句话管。`;
  return {
    position,
    label: moving.label,
    moving: `${moving.stem}${moving.branch}${moving.element}`,
    movingRelative: moving.relative,
    changed: `${ch.stem}${ch.branch}${ch.element}`,
    changedRelative: ch.relative,
    relation: relation.key,
    good: relation.good,
    jinTui: move ? move.key : null,
    marks,
    sentence: `${moving.label}${moving.stem}${moving.branch}${moving.element}${moving.relative}动，`
      + `变出${ch.stem}${ch.branch}${ch.element}${ch.relative}。${relation.text}`
      + (move ? move.text : '')
      + stateText,
  };
}

/**
 * 用神周围那一圈：元神、忌神、仇神。
 *
 * 《增删卜易》卷之一·用神元神忌神仇神章第九把三个名目连定义带例子都给足了：
 *   「元神者，生用神之爻，即为元神。忌神者，克用神之爻也，即为忌神。仇神者，克制元神
 *     不能生用神，反生忌神而克害用神，即为仇神。」
 * 紧接着野鹤交代了看完用神接着看什么——「既得用神，須看旺衰否？有元神動而生扶否？
 * 有忌神動而克害否？」——所以三者各报所在、动不动、月建旺衰，正照这两句来。
 *
 * 仇神要**另说一句**：它并不直接克用神，是压着元神使元神生不动，反去生忌神，两头帮倒忙。
 * 断语若写成「仇神克用神」就是把它的路数说反了。
 *
 * 同章还有一句本包照办：**「勿以仇神即仇人也」**——仇神是五行位置上那一爻，不是卦里那个人。
 * 原书自己就把话说尽了：卦里称作仇人的另有其人，是应爻克世。两者不混。
 *
 * 三者都可能不在卦上——六爻只纳八个地支，五行里本就常常不齐。这时照实说「卦中不见」，
 * 不从别处借一爻来凑。借了就是给卦外编爻。
 *
 * @param {import('./jingfang.mjs').Jingfang} jingfang
 * @param {import('./jingfang.mjs').JingfangLine} picked
 * @param {object} calendar
 */
/**
 * 动静共四档：发动、动而逢日冲、暗动、安静。
 *
 * 暗动与冲散分属两章，且一个只管静爻、一个只管动爻：暗动章管静爻逢冲（旺相为暗动、
 * 休囚为日破），动散章管动爻逢冲（冲散）。所以这里各认各的，不把暗动并进动、
 * 也不把冲散并进静。用神自己那一爻与元神忌神仇神那几行用的是同一个口径。
 *
 * @param {{ movingPositions: number[] }} calendar
 * @param {number[]} darkPositions
 * @param {number[]} pressedPositions
 */
function motionTiers(calendar, darkPositions, pressedPositions) {
  const moving = new Set(calendar.movingPositions);
  const dark = new Set(darkPositions);
  const pressed = new Set(pressedPositions);
  return (position) => {
    if (pressed.has(position)) return '动而逢日冲';
    if (moving.has(position)) return '动';
    return dark.has(position) ? '暗动' : '静';
  };
}

function circleReading(jingfang, picked, calendar, darkPositions, pressedPositions) {
  const circle = useGodCircle(jingfang, picked);
  const motion = motionTiers(calendar, darkPositions, pressedPositions);
  const say = (name, element, lines) => (lines.length === 0
    ? `${name}属${element}，本卦六爻里没有这一行`
    : `${name}属${element}，见${lines.map((line) => `${line.label}（${motion(line.position)}，于月建${vitality(line.element, calendar.monthElement).key}）`).join('、')}`);
  const parts = [
    `按《增删卜易·用神元神忌神仇神章》，用神取${picked.label}${picked.element}，它周围还有三个位置：`,
    `${say('元神', circle.elements.yuan, circle.yuan)}，正是生用神的那一行。`,
    `${say('忌神', circle.elements.ji, circle.ji)}，正是克用神的那一行。`,
    `${say('仇神', circle.elements.chou, circle.chou)}。`,
  ];
  // 仇神的路数要说准：它不直接克用神，是压着元神、反去生忌神。写反了这一条就把它当忌神说了。
  if (circle.chou.length > 0) {
    parts.push('仇神并不直接克用神，它压着元神叫元神生不动，自己又反去生忌神，两头帮倒忙。');
  }
  parts.push('这三者是五行上的位置，不是卦里的人——原书紧接着就提醒「勿以仇神即仇人也」，'
    + '卦里那个称作仇人的另有其人，是应爻克世，不在这里头。');
  return {
    godPosition: picked.position,
    god: picked,
    yuan: circle.yuan,
    ji: circle.ji,
    chou: circle.chou,
    elements: circle.elements,
    sentence: parts.join(''),
  };
}

/**
 * 日辰冲爻那一段。静爻两路出自《增删卜易·暗动章第二十二》，动爻一路出自紧接的
 * 《动散章第二十三》，判语全部逐字引自这两章，一处自造也没有。
 *
 * 本章的吉凶两路判的正是元神与忌神——「暗動者有喜有忌」。这一段是上一层用神圈的
 * 正题，所以要紧的话是「哪一爻暗动了、它是不是元神或忌神」。用神定不下来时
 * （伏神在卦外、两亲各看各的）没有圈，喜忌两路就无从落，只报事实，不硬接。
 *
 * 一处传入异说照实交代：传入本该章的忌路作「用神休囚無助，若遇忌神克害用神」，
 * 未系「暗动」二字；后世解说多作「忌神暗动克害用神」。本包取**带「暗动」**的读法——
 * 上一句喜路明写「得元神暗動以相生」，句式正相对举，且本章题为暗动、
 * 开篇又点明「暗動者有喜有忌」，忌路若不含暗动，这一喜一忌就对不上。
 * 同章还有一句「忌神明動於卦中，得元神暗動而生用神」：忌神按定义是克用神的，
 * 生不了用神，这半句自相矛盾，传本与后世多本都照录未改，本包不据它另立一条。
 *
 * @param {{ dark: JingfangLine[], dayBroken: JingfangLine[], pressed: JingfangLine[] }} clash
 * @param {ReturnType<circleReading> | null} circle
 * @param {object} calendar
 */
function dayClashText(clash, circle, calendar) {
  const dayName = BRANCHES[calendar.dayBranch];
  const nameOf = (position) => {
    if (!circle) return '';
    if (circle.yuan.some((line) => line.position === position)) return '元神';
    if (circle.ji.some((line) => line.position === position)) return '忌神';
    if (circle.chou.some((line) => line.position === position)) return '仇神';
    return '';
  };
  // 身份另起一句说，不逐爻重复「正是元神」。同一行（同一身份）本就同一五行，
  // 旺衰必同，所以整行都在其中时可以并成一句，不必一爻一爻报两遍。
  const roleClause = (lines) => {
    if (!circle) return '';
    const said = [];
    for (const [name, row] of [['元神', circle.yuan], ['忌神', circle.ji], ['仇神', circle.chou]]) {
      const hit = lines.filter((line) => row.some((one) => one.position === line.position));
      if (hit.length === 0) continue;
      said.push(hit.length === 1
        ? `${hit[0].label}正是${name}那一行`
        : `${name}那一行在${hit.map((line) => line.label).join('、')}都占着`);
    }
    return said.length === 0 ? '' : `${said.join('，')}。`;
  };
  const list = (lines) => lines
    .map((line) => `${line.label}${line.element}（于月建${vitality(line.element, calendar.monthElement).key}）`)
    .join('、');
  const opener = (clash.dark.length > 0 || clash.dayBroken.length > 0)
    ? `按《增删卜易·暗动章第二十二》「靜爻旺相日辰沖之爲暗動，靜爻休囚日辰沖之爲破」：被${dayName}日冲到的静爻，旺衰分作两路。`
    : `按《增删卜易·动散章第二十三》「占以日辰而沖動爻，謂之沖散」：被${dayName}日冲到的，是动爻。`;
  const parts = [opener];

  if (clash.dark.length > 0) {
    parts.push(`${list(clash.dark)}${clash.dark.length > 1 ? '皆为暗动' : '为暗动'}——静而不静，今日起暗中起作用。${roleClause(clash.dark)}`);
    // 喜忌两路要落到具体爻上才说得出。用神定不下来时没有圈，就只摆定义，不空谈吉凶。
    if (circle) {
      const yuanDark = clash.dark.find((line) => circle.yuan.some((one) => one.position === line.position));
      const jiDark = clash.dark.find((line) => circle.ji.some((one) => one.position === line.position));
      const chouDark = clash.dark.find((line) => circle.chou.some((one) => one.position === line.position));
      const godTone = vitality(circle.god.element, calendar.monthElement);
      const rests = ['休', '囚', '死'].includes(godTone.key);
      if (yuanDark || jiDark) {
        const judged = [];
        if (yuanDark) {
          judged.push(`元神${yuanDark.label}暗动来生用神，正合原书「用神休囚得元神暗動以相生」那句，谓之喜`);
        }
        if (jiDark) {
          judged.push(`忌神${jiDark.label}暗动起来克害用神，即原书「用神休囚無助，若遇忌神克害用神」，谓之忌`);
        }
        // 原书两路都写在「用神休囚」的前提下。用神不休囚时前提不成立，标出来，不硬套。
        parts.push(`原书紧接着说「暗動者有喜有忌」，判的正是这一圈：${judged.join('；')}。`
          + (rests ? '' : `只是这两路都写在「用神休囚」之下，本卦用神${circle.god.label}于月建为${godTone.key}，那一层前提并不齐备。`));
      } else if (chouDark) {
        // 仇神暗动要说得出「原书没分这一支」，否则前一句点名仇神、后一句说不在两行上，连读像自相矛盾。
        parts.push('暗动章的喜忌两路只分元神与忌神两支，仇神暗动归哪一支，原书未言，这里不替它定。');
      } else {
        parts.push('暗动章的喜忌两路判的是元神与忌神，对别的爻暗动只说「有喜有忌」，没再分派吉凶，这里不替它定。');
      }
    }
  }

  if (clash.dayBroken.length > 0) {
    parts.push(`${list(clash.dayBroken)}${clash.dayBroken.length > 1 ? '皆为日破' : '为日破'}——休囚无气而逢日冲，与暗动恰是同一句话的两头。${roleClause(clash.dayBroken)}`);
  }

  if (clash.pressed.length > 0) {
    const listed = list(clash.pressed);
    const strong = clash.pressed.filter((line) => {
      const tone = vitality(line.element, calendar.monthElement).tone;
      return tone === 'strong' || tone === 'good';
    });
    parts.push(`${listed}${clash.pressed.length > 1 ? '皆逢日冲' : '逢日冲'}，谓之冲散。`
      + (strong.length > 0
        ? `其中${strong.map((line) => line.label).join('、')}于月建旺相，原书直言「旺相者沖之不散」。`
        : '')
      + '这一章的结论恰恰是不散：「予屢試之，旺相者沖之不散，有气者沖之不散，休囚者間有沖散，'
      + '亦千百中之一二也」，末了归到「神兆機於動，動必有因」。所以此处只报「哪一爻动而逢日冲」'
      + '这件事实，不拿它断凶。');
  }

  // 旧说与野鹤自己的驳一并摆上：只引旧说就成了拿一句被作者否掉的话断卦。
  // 这两句驳的是「暗动迟缓」，跟冲散不相干——只有真出了暗动才摆。
  if (clash.dark.length > 0) {
    parts.push('「占以暗動福來而不知，禍來而不覺」是旧说，原作者在本章末尾就驳了它：'
      + '「吉凶之應於動，有急緩之應，則緩非此論，何當不知不覺，報應亦非緩也。」暗动不必当成迟缓。');
  }
  return parts.join('');
}

/**
 * 《增删卜易·六合章第十九》「爻之合者」那四名，逐名说清这一爻得了什么。
 *
 *   「爻之合者，静而逢合，谓之合起；动而逢合，谓之合绊；
 *     爻与爻合谓之合好，爻动化合谓之化扶。」
 *
 * 四句各自的落点照原书：「爻静或与日月动爻合者，得合而起，即使爻值休囚亦有旺相之意」；
 * 「爻动或与日月动爻合者，谓之动逢合而绊住，反不能动之意」；「爻动与动爻相合，乃得他来合我，
 * 与我和好相助之意」；「爻动化出之爻回头相合者，谓之化扶，得他扶助之意」。
 *
 * **这一段不给吉凶，这是原书自己收的。** 同章三处：「然必用神有气相宜，用若失陷无益」、
 * 「用神受克，六合有何益哉」、末了「宜合吉，不宜合凶」。所以只报关系与名目，
 * 吉凶仍旧归用神旺衰那一路，不在这里替它表态。
 *
 * 卦级那三法不在这一段：卦逢六合、六冲变六合、六合变六合是整卦结构，由 clashKinds 出段、
 * 卦体上另画三支合弧，两处都已列全，在这里再列一遍就成了第二份要人核对的账。
 *
 * @param {import('./jingfang.mjs').ReturnType<typeof import('./jingfang.mjs').heCombineReading>} combine
 * @param {{ dayBranch: number, monthBranch: number }} calendar
 * @returns {string}
 */
function heCombineText(combine, calendar) {
  const parts = ['按《增删卜易·六合章第十九》「爻之合者，静而逢合，谓之合起；动而逢合，谓之合绊；'
    + '爻与爻合谓之合好，爻动化合谓之化扶」：合落在这几爻上，分这么四名。'];
  if (combine.rise.length > 0) {
    const said = combine.rise
      .map((item) => `${item.line.label}${item.line.branch}${item.line.element}合${item.source}${item.branch}`)
      .join('、');
    parts.push(`${said}皆为合起——静爻得合而起，原书说「即使爻值休囚亦有旺相之意」，`
      + '起得来的是这一爻，不等于这件事就成。');
  }
  if (combine.bind.length > 0) {
    const said = combine.bind
      .map((item) => `${item.line.label}${item.line.branch}${item.line.element}合${item.source}${item.branch}`)
      .join('、');
    parts.push(`${said}皆为合绊——动爻被合住，原书说「反不能动之意」，动起来的事被绊在这里。`);
  }
  if (combine.friendly.length > 0) {
    const said = combine.friendly
      .map((item) => `${item.lineA.label}${item.lineA.branch}与${item.lineB.label}${item.lineB.branch}`)
      .join('、');
    parts.push(`${said}两动爻相合为合好——是他来合我，原书说「与我和好相助之意」。`
      + '此处只取两爻皆动的那一路：同章「但有一爻不动，亦不为合」，有一爻静的算不上合。');
  }
  if (combine.support.length > 0) {
    const said = combine.support
      .map((item) => `${item.line.label}${item.line.branch}化出${item.changedLine.branch}回头相合`)
      .join('、');
    parts.push(`${said}为化扶——动爻化出去的那一爻回头来合本爻，原书说「得他扶助之意」。`);
  }
  // 原书把话收在这一句上，且收在吉凶之前。合不是判词，这一句照录，不替它翻成断语。
  parts.push('以上只说合的关系，不据此断吉凶：同章说「然必用神有气相宜，用若失陷无益」，'
    + '又说「用神受克，六合有何益哉」，末了一句「宜合吉，不宜合凶」——合吉合凶仍要看用神旺衰。');
  return parts.join('');
}

/**
 * 《增删卜易·三刑章第二十一》。这一章只有六句话，判语却比六句话还紧，全在最后那半句上。
 *
 *   「寅刑巳、巳刑申、子刑卯、卯刑午、丑戌相刑、未辰相刑。又云：辰午酉亥谓之自刑。
 *     夫三刑者，予屡试之，或因用神休囚又兼他爻犯之，刑者则见凶，
 *     而独犯三刑得验者少，占过数十年只验得一卦。」
 *
 * **所以「犯刑」本身不是判词，这是原书自己说的。** 野鹤试了几十年，单靠犯刑只验中一卦；
 * 要见凶还得搭上两条前提：用神休囚，且另有一爻也犯刑。所以这一段把两条前提逐条核出来摆明，
 * 成立不成立都照实说，不拿「犯刑」两个字替用神断吉凶——这跟本包在六冲、六合两章上的处置
 * 是同一条线，只是这一条的依据直接来自原书。
 *
 * 书上那个卦例照录在下面，寅月庚申日占痘症得风火家人变离卦：月建寅刑五爻巳火子孙，
 * 五爻巳又刑申日，两路都落在同一爻上。子孙当春令、旺相得很，原书仍断「后死于寅日寅时」。
 * 可见刑伤得行的不是休囚那一头，旺相的爻照样被刑。
 *
 * @param {import('./jingfang.mjs').ReturnType<typeof import('./jingfang.mjs').punishReading>} punish
 * @param {object} jingfang 本卦
 * @param {object|null} circle 用神那一圈，用神定不下来时为 null
 * @param {{ monthBranch: number, dayBranch: number, monthElement: string }} calendar
 * @returns {string}
 */
function punishText(punish, jingfang, circle, calendar) {
  const parts = ['按《增删卜易·三刑章第二十一》「寅刑巳、巳刑申、子刑卯、卯刑午、丑戌相刑、未辰相刑。'
    + '又云：辰午酉亥谓之自刑」：刑有方向，下面按「谁刑谁」原样摆出来。'];
  if (punish.linePairs.length > 0) {
    const said = punish.linePairs
      .map((pair) => `${pair.from.label}${pair.from.branch}${pair.self ? '自刑' : `刑${pair.to.branch}`}`
        + `${pair.to.label}`)
      .join('、');
    parts.push(`卦中${said}。`);
  }
  if (punish.outside.length > 0) {
    // 自刑那一支若照非自刑那样拼，会成「月建三爻酉」——读起来像在说月建就是三爻的酉。
    // 明写「自刑」，跟上面卦中那半句一个口径。
    const said = punish.outside
      .map((item) => (item.self
        ? `${item.source}与${item.line.label}${item.line.branch}自刑`
        : `${item.source}${item.from}刑${item.line.branch}`))
      .join('、');
    parts.push(`${said}。`);
  }

  // 两条前提，逐条核。用神定不下来时没有圈，第一条就明说缺哪一层，不空谈。
  if (!circle) {
    parts.push('原书说「或因用神休囚又兼他爻犯之，刑者则见凶」——这两条前提本卦核不了第一条：'
      + '用神定不下来。写下问题再看这一段，或者由着它只是一条关系，不作吉凶。');
  } else {
    const godTone = vitality(circle.god.element, calendar.monthElement);
    const rests = ['休', '囚', '死'].includes(godTone.key);
    const others = punish.hitPositions.filter((position) => position !== circle.god.position);
    parts.push(`原书说「或因用神休囚又兼他爻犯之，刑者则见凶」。拿本卦核这两条：`
      + `用神在${circle.god.label}${circle.god.element}，于月建${godTone.key}`
      + `，${rests ? '正合「用神休囚」那条' : '不算休囚，那条不成立'}；`
      + `另有${others.length > 0 ? `${others.map((position) => jingfang.lines[position - 1].label).join('、')}犯之` : '没有别的爻犯之'}，`
      + `「又兼他爻犯之」那条${others.length > 0 ? '成立' : '不成立'}。`);
  }
  // 这一句是原书的收口，也是本段不许由刑断吉凶的凭据，逐字照录。
  parts.push('但原书紧接着自己收了一句：「而独犯三刑得验者少，占过数十年只验得一卦」——'
    + '所以这一段只报刑落在哪里、由谁动的手，不据此断吉凶。');
  return parts.join('');
}

/**
 * 反伏与卦变的断语。判据在 jingfang.fanfuReading 里，两档为什么必须分开、
 * 乾变坤为什么落在卦变那一档，理由都记在那儿。
 *
 * **这一层不定吉凶，依据是原书自己给的。** 章末那句把话说死了：
 * 「反伏卦用神旺相不變沖克者則反復，事之必成，第恐用神而化回頭之沖克者，卽是卦變大凶之象。」
 * 两条都以用神为轴，所以这里只把两条前提核出来，判词仍旧归用神旺衰那一路——
 * 与六冲、六合、爻之合、爻之刑各章同一条线。
 *
 * 章里那十条分占的断语（占功名、占财物、占坟茔宅舍、占天时、占婚姻、占疾病、
 * 占盗贼官非、占出行、占行人、占彼此），本包只接住所问事类对得上的那几条，
 * 接不住的明说接不住，不拿别的占法来顶。
 */

/** 章里的占法与本包九类事类对得上的几条。key 取 topics.mjs 的事类标识。 */
const FANFU_BY_TOPIC = Object.freeze({
  career: '占功名者，用爻旺相，遷而又行往他處，去而仍復來',
  wealth: '占財物聚散不常，買賣經營興衰往來不定',
  property: '占墳墓宅捨，欲遷不遷，或遷之而再遷，或目下就有遷移之事',
  marriage: '占婚姻反復難成',
  love: '占婚姻反復難成',
  health: '占疾病愈而有病',
  journey: '占出行，行至中途變反，卽使到彼，一事無成',
  dispute: '占盜賊官非，見而又見',
});

/** 反伏章开头那三句，判据的出处，每次都照录，免得读者不知这六支是怎么挑的。 */
const FANFU_ORIGINAL = '卦有卦變，爻有爻變。卦變者內外動而反伏者同一卦也。如乾卦變坤卦。'
  + '爻變者內外爻動而反伏者，非同一卦也。如升之觀是也。'
  + '又有外卦反伏而內卦不動者，如觀之坤是也。又有內卦反伏而外卦不動者如巽之觀是也';

/** 章末那两条前提的原文。 */
const FANFU_CLOSING = '反伏卦用神旺相不變沖克者則反復，事之必成，'
  + '第恐用神而化回頭之沖克者，卽是卦變大凶之象';

/**
 * @param {ReturnType<typeof import('./jingfang.mjs').fanfuReading>} fanfu
 * @param {string} changedName 变卦卦名
 * @param {{ key: string, label: string }|null} topic
 * @param {ReturnType<typeof circleReading>|null} circle
 * @param {{ monthElement: string }} calendar
 * @param {readonly number[]} movingPositions
 * @param {readonly { position: number, relation: string }[]} transforms
 */
function fanfuText(fanfu, changedName, topic, circle, calendar, movingPositions, transforms) {
  const parts = [];

  if (fanfu.guaChange) {
    parts.push(`按《增删卜易·反伏章第二十五》「${FANFU_ORIGINAL}」：本卦六爻全动，`
      + `变出${changedName}——章里「同一卦」四个字指的就是本卦与变卦同为八纯卦、`
      + '两两相对（乾坤、坎离、震巽、艮兑）。这一档换过去的纳支并不逐位相冲，'
      + '所以与下面那一档不是一回事，本包分成两路报，合在一起的话乾变坤就得被漏掉。');
  } else {
    const swaps = [];
    if (fanfu.inner) swaps.push(`内卦${fanfu.innerFrom}换成${fanfu.innerTo}`);
    if (fanfu.outer) swaps.push(`外卦${fanfu.outerFrom}换成${fanfu.outerTo}`);
    parts.push(`按《增删卜易·反伏章第二十五》「${FANFU_ORIGINAL}」：本卦变出${changedName}，`
      + `其中${swaps.join('，')}。判据是逐位六冲——换过去的那三支与本卦那三支一一相冲，`
      + '章里三例（观之坤、巽之观、升之观）换过去的那一组，无一例外都是这样。');
    const say = fanfu.both
      ? '內外反伏者，內外不寧之象也'
      : (fanfu.inner ? '內卦反伏，內則不安' : '外卦反伏，外則不寧');
    parts.push(`${say}。章里紧接着列了一串对称的说法：「皆主成而敗，敗而成，有而卽無，`
      + '無而卽有，得而失，失而得，來而去，去而來，散而聚，聚而散，動而思靜，靜而思動」'
      + '——说的是同一件事的两头会翻面，不是判吉凶。');
    if (fanfu.inner !== fanfu.outer) {
      parts.push(fanfu.inner
        ? '章里另有一条能直接对上号：「占彼此之形勢者，內卦反伏，我亂他定」——内卦反伏，这一路说的是我这一头先乱。'
        : '章里另有一条能直接对上号：「占彼此之形勢者……外卦反伏，他亂我定」——外卦反伏，这一路说的是对方那头先乱。');
    } else {
      parts.push('章里那条「占彼此之形勢者，內卦反伏，我亂他定，外卦反伏，他亂我定」，'
        + '内外都反伏时两句都沾得上，本包不替你择一句。');
    }
  }

  const line = topic ? FANFU_BY_TOPIC[topic.key] : null;
  if (line) {
    parts.push(`所问落在「${topic.label}」，章里正有这一条：${line}。`);
  } else if (topic) {
    parts.push(`所问落在「${topic.label}」，反伏章这一节没有对得上的占法——`
      + '章里那十条各管一桩事，别的占法挪过来顶就是替人选了，故此处不接。');
  } else {
    parts.push('没写所问何事，反伏章那十条占法各管一桩事，接不上；写下问题再按事类看这一段。');
  }

  // 章末那两条前提，逐条核。核不了的那一层，明说缺哪一层。
  if (!circle) {
    parts.push(`章末收口的是「${FANFU_CLOSING}」——这两条要以用神为轴，`
      + '而本卦取不出用神，第一条就核不了。写下问题再看这一段。');
    return parts.join('');
  }
  const godTone = vitality(circle.god.element, calendar.monthElement);
  const strong = !['休', '囚', '死'].includes(godTone.key);
  const godMoving = movingPositions.includes(circle.god.position);
  const huiTouKe = transforms.some(
    (item) => item.position === circle.god.position && item.relation === '回头克',
  );
  const close = `章末收口的是「${FANFU_CLOSING}」。拿本卦核这两条：`
    + `用神在${circle.god.label}${circle.god.element}，于月建${godTone.key}，`
    + `「用神旺相」那条${strong ? '成立' : '不成立'}`
    + `（${godTone.key}${strong ? '不属休囚' : '正属休囚'}）`
    + (godMoving
      ? `；用神本爻在动，「用神化回头冲克」那条${huiTouKe ? '成立' : '不成立（变出来的那一爻不克本爻）'}。`
      : '；用神本爻不在动，谈不上「化」，回头冲克那条不成立。')
    + '章里那句「事之必成」只在这两条同时成立时才有；'
    + '化回头冲克成立时，章里接着说那是「卦變大凶之象」。'
    + '两条都以用神为轴，所以这一段不另下吉凶判词，判词仍归用神旺衰那一路。';
  parts.push(close);
  return parts.join('');
}

/**
 * 《增删卜易·六冲章第二十》「相冲之法有六」逐条对出本卦这一卦实到哪几种。
 *
 *   「子午相冲、丑未相冲、寅申相冲、卯酉相冲、辰戌相冲、巳亥相冲。相冲之法有六：
 *     日月冲爻者一也，卦逢六冲者二也，六合卦变六冲者三也，冲变六冲者四也，
 *     动爻变冲者五也，爻与爻冲者六也。」
 *
 * 第一路「日月冲爻」归日辰与月建，日辰那一半已经在暗动章与动散章里逐爻算过（暗动、
 * 日破、冲散），月建那一半是月破，所以这里不重数，只在收尾时指一句路。本函数数的是
 * 剩下五路里本卦实到的那几条。
 *
 * 「冲变六冲」（第四路）底本如此；明天机一系作「六冲卦变六冲者，四也」，把「冲」二字
 * 补全成「六冲卦」。两说指同一件事——变出来的那个卦也是六冲卦——本包取补全的写法，
 * 底本原样记在这里。
 *
 * @param {{ hexagram: object, jf: object, changed: object|null,
 *           changedJf: object|null, movingPositions: number[] }} input
 */
function clashKinds({ hexagram, jf, changed, changedJf, movingPositions }) {
  const here = hexagramClash(hexagram, jf);
  const there = changedJf ? hexagramClash(changed, changedJf) : null;
  // 卦内任意两爻相冲。标准那三对（初四、二五、三六）单另走 chong/he 两条判语，
  // 这里报的是余下那些撞上的零散对——六冲卦那三对不重复报，免得同一件事说两遍。
  const incidental = [];
  for (let a = 1; a <= 6; a += 1) {
    for (let b = a + 1; b <= 6; b += 1) {
      if (branchClash(jf.lines[a - 1].branchIndex) !== jf.lines[b - 1].branchIndex) continue;
      if (CLASH_STANDARD_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue;
      incidental.push({ a, b, lineA: jf.lines[a - 1], lineB: jf.lines[b - 1] });
    }
  }
  // 动爻变冲：这一爻动起来变出去的那一爻，正好冲它本位那一爻。
  const transformClash = [];
  if (changedJf) {
    for (const position of movingPositions) {
      const line = jf.lines[position - 1];
      const changedLine = changedJf.lines[position - 1];
      if (branchClash(line.branchIndex) === changedLine.branchIndex) {
        transformClash.push({ position, line, changedLine });
      }
    }
  }
  return {
    chong: here.chong,
    he: here.he,
    pairs: here.pairs,
    changedChong: there?.chong ?? false,
    changedHe: there?.he ?? false,
    heToChong: Boolean(here.he && there?.chong),
    chongToChong: Boolean(here.chong && there?.chong),
    transformClash,
    incidental,
    incidentalOutsideChong: incidental.length > 0 && !here.chong,
    hasAny: here.chong || here.he || Boolean(there?.chong) || transformClash.length > 0 || incidental.length > 0,
  };
}

const CLASH_STANDARD_PAIRS = Object.freeze([[1, 4], [2, 5], [3, 6]]);

/**
 * 六冲那一段。断语逐字引《增删卜易·六冲章第二十》，该给吉凶的地方一律压在用神上。
 *
 * 两条本包不替人定的：
 * 一是「凡占凶事，宜于冲散；占吉事，则不宜」。所问算吉事还是凶事，是问卦人自己心里的
 *   定位，一句问题里读不出来；本包不替他把事归到哪一头，只把两半都摆上。
 * 二是「近病逢冲即愈，久病逢冲则死」。新病与久病差着一条命，这是个只有问的人知道的事，
 *   本包不认病势，所以占病遇六冲时只引这句、不选边。
 * 官讼那一半反倒能接：所问既已认作官讼是非，原书「惟占官非、盗贼、结绝事者宜之」
 *   说的正是这一类，直接引。
 *
 * @param {ReturnType<typeof clashKinds>} kinds
 * @param {ReturnType<typeof circleReading>|null} circle
 * @param {{ key: string, label: string }|null} topic
 * @param {object} calendar
 */
function clashText(kinds, circle, topic, calendar) {
  const parts = [];
  if (kinds.chong || kinds.he) {
    const which = kinds.chong ? '六冲卦' : '六合卦';
    const spoken = kinds.pairs.map((pair) => `${pair.lower.branch}${pair.upper.branch}`).join('、');
    parts.push(`本卦是${which}。纳甲装出来初四、二五、三六三对，${kinds.chong ? '三对皆冲' : '三对皆合'}（${spoken}）。`);
  } else {
    const near = kinds.pairs.filter((pair) => pair.kind !== null);
    parts.push(`本卦既不是六冲卦也不是六合卦：初四、二五、三六三对里`
      + (near.length === 0 ? '一对也不冲不合。' : `只有${near.map((pair) => `${pair.lower.branch}${pair.upper.branch}`).join('、')}这一对${near[0].kind}。`));
  }

  const trans = [];
  if (kinds.transformClash.length > 0) {
    trans.push(`${kinds.transformClash.map((item) => `${item.line.label}化出${item.changedLine.branch}`).join('、')}`
      + '，变出去的那一支正好冲本位那一爻（动爻变冲）');
  }
  if (kinds.heToChong) {
    trans.push('本卦六合、变卦六冲（六合变六冲）');
  }
  if (kinds.chongToChong) {
    trans.push('本卦六冲、变卦也是六冲（六冲变六冲）');
  } else if (kinds.changedChong && !kinds.heToChong) {
    trans.push('变出来的那个卦是六冲卦（卦变六冲，底本作「冲变六冲」）');
  }
  if (trans.length > 0) parts.push(`${trans.join('；')}。`);

  if (kinds.incidentalOutsideChong) {
    parts.push(`卦里另有${kinds.incidental.map((pair) => `${pair.lineA.label}${pair.lineA.branch}冲${pair.lineB.label}${pair.lineB.branch}`).join('、')}`
      + '——这是卦内两爻相冲，不等于本卦就是六冲卦。');
  }

  if (kinds.heToChong) {
    parts.push('原书对六合变六冲写得很重：「诸占先合后离、先亲后疏、先浓后淡，始荣终悴，'
      + '得而复失，成而后败，事就而又变也。惟占官非、盗贼、结绝事者宜之。」'
      + (topic?.key === 'dispute'
        ? '所问正落在官讼是非上，末了那半句说的就是这一类。'
        : '末了那半句说的是官非、盗贼、结绝事一类；所问不在此，断语不替它改判吉凶。'));
  }
  if (kinds.chongToChong) {
    parts.push('六冲变六冲，原书作「乃内外变动，交相冲击，必主上下不和，至亲反目，彼此怀奸，'
      + '始终不就。若用神再受克者，大凶之兆，纵用神旺相，亦不长久」。');
  }

  if (kinds.chong || kinds.heToChong || kinds.chongToChong) {
    parts.push('章末把总规矩收在一句上：「冲者，散也。凡占凶事，宜于冲散；占吉事，则不宜。'
      + '亦必兼用神而言，用神若旺，虽冲不碍；用神失陷，凶而又凶。」'
      + '所问算吉事还是凶事，是你自己的定位，本包不替你归这一头；后半句判得了，按用神说：');
    if (!circle) {
      parts.push('用神定不下来，这一层就不接。');
    } else {
      const tone = vitality(circle.god.element, calendar.monthElement);
      const strong = tone.tone === 'strong' || tone.tone === 'good';
      parts.push(strong
        ? `用神${circle.god.label}${circle.god.element}于月建为${tone.key}，照「用神若旺，虽冲不碍」，这层冲不碍着它。`
        : `用神${circle.god.label}${circle.god.element}于月建为${tone.key}，落在失陷那一头，照「用神失陷，凶而又凶」，这层冲对它不是好事。`);
    }
  }

  if (topic?.key === 'health' && (kinds.chong || kinds.heToChong || kinds.chongToChong)) {
    parts.push('占病另有一条不兼用神的：「惟占病，有远近之分，不用用神，近病逢冲即愈，久病逢冲则死。」'
      + '新病还是久病只有你清楚，这里只引这句、不替你选边。');
  }
  if (kinds.chong) {
    parts.push('原书另有一句兜底：「古以六冲卦，诸占不吉。予屡试之，用神失陷，实不为吉；'
      + '用若得地，须以用神断之。」所以六冲卦本身不作凶论。');
  }
  return parts.join('');
}

/** 化爻那一段。变爻只认本位动爻，所以先把这句规矩摆出来，免得看着像要把变爻拿去六爻通算。 */
function transformText(transforms, circle) {
  if (transforms.length === 0) {
    return '六爻皆静，无变卦，也就谈不上变出之爻——本卦的格局就此定格，不会中途生变。';
  }
  // 回头克那条「原用二神遇之則凶，忌仇二神遇之反吉也」，得先知道回头克落在哪一爻上才说得出。
  // 用神那圈还没算出来（用神不上卦、两亲各看各的）时就只报关系，不接后半句——空口说凶是编的。
  const at = (lines, position) => lines.some((line) => line.position === position);
  const rows = transforms.map((item) => {
    if (item.relation !== '回头克' || !circle) return item.sentence;
    // 原文只交代了两路：用神一路则凶，忌神仇神一路反吉。元神那一路原书未言，就不替它定。
    if (item.position === circle.godPosition) {
      return `${item.sentence}这一爻正是用神——照《卜筮正宗》「原用二神遇之則凶」，用神遭回头克是实打实的凶。`;
    }
    if (at(circle.ji, item.position) || at(circle.chou, item.position)) {
      const name = at(circle.ji, item.position) ? '忌神' : '仇神';
      return `${item.sentence}这一爻正落在${name}那一行——照同章「忌仇二神遇之反吉」，回头克打在${name}上，这一卦里反不作凶论。`;
    }
    if (at(circle.yuan, item.position)) {
      return `${item.sentence}这一爻正落在元神那一行。书上回头克只交代用神与忌仇两路，元神遇之如何原书未言，这里不替它定。`;
    }
    return item.sentence;
  });
  return '按《增删卜易》「夫變出之爻，能生克沖合本位之動爻，不能生克他爻」，变爻只与本位动爻相生克，不与他爻相干：'
    + rows.join(' ');
}

/**
 * 用神临六神。只交代这件事是什么调子，成不成仍旧只由生克定——
 * 「吉凶全凭五行生克，情态方看六神吉凶」，这句是本包不许越的界。
 */
function godSentence(god, lineLabel) {
  return `用神临${god}（${lineLabel}），${SIX_GOD_MEANING[god].meaning}——这是这件事的调子，`
    + '成不成仍只由上面的生克与旺衰定，六神不改吉凶。';
}

/**
 * 一爻逢空逢破逢入墓，说人话。
 * 野鹤《增删卜易·旬空章》分真假：「旺不爲空，動不爲空，有日建動爻生扶者不爲空」是假空，
 * 出旬与冲空之后照旧有力；「月破爲空」「真空卽春土、夏金、秋木、三冬逢火」才是真空，
 * 逢值或逢冲之日应事。
 */
function voidSentence(v) {
  const marks = [];
  if (v.isVoid) marks.push('旬空');
  if (v.isBroken) marks.push('月破');
  if (v.isTomb) marks.push('入墓');
  if (marks.length === 0) return '';
  if (v.status === '假空') {
    return `${marks.join('又')}，然${v.rescues.join('、')}，是假空：出旬或逢冲之日照旧有力，不是全无指望。`;
  }
  if (v.status === '真空') {
    // 「逢月破」这条在上头的标记里已经点过名了，不再说第二遍。
    const extra = v.empties.filter((one) => !(v.isBroken && one === '逢月破'));
    const because = extra.length === 0 ? '' : `，且${extra.join('、')}`;
    // 逢值、出旬能救空，逢冲救不了月破——月破章说死了「虽有日辰之生，亦不能生」，
    // 冲得越勤它越受伤。所以只在这一卦没逢月破时提「逢冲」。
    const wait = v.isBroken ? '待出月、逢值再论' : '这一旬里做不成，等出旬逢值或逢冲再论';
    return `${marks.join('又')}${because}，是真空：${wait}。`;
  }
  return `${marks.join('又')}，暂看不出真假，等出旬或逢冲之日再定。`;
}

function buildAdvice(verdict) {
  const good = verdict.score >= 1;
  const bad = verdict.score <= -1;
  return {
    suitable: good
      ? ['主动推进，抓紧时间', '争取外援相助', '落定结果后再推进下一步']
      : bad
        ? ['守成，不宜扩张', '先处理内务再对外', '避开正面对抗']
        : ['按原计划等待时机', '先观察再决定进退'],
    avoid: good
      ? ['反复犹豫、久拖不决', '轻信口头承诺']
      : bad
        ? ['正面强争', '额外投入与加码', '在对方主场行事']
        : ['临时变卦、随意更改方向'],
    caution: good && bad
      ? ''
      : good
        ? '体卦得势，但用卦耗你：方向可进，力气要省，别一上来就全力押上。'
        : bad
          ? '体用相制：局面不在你手上，宜守宜退，不宜正面强求。'
          : '',
  };
}

function serialize(hexagram) {
  return {
    order: hexagram.order,
    key: hexagram.key,
    name: hexagram.name,
    symbol: hexagramSymbol(hexagram.key),
    upper: hexagram.upperTrigram,
    lower: hexagram.lowerTrigram,
    judgment: hexagram.judgment,
    tuan: hexagram.tuan,
    image: hexagram.image,
    element: uniqueElement(hexagram.upperTrigram.element, hexagram.lowerTrigram.element),
  };
}

function uniqueElement(upper, lower) {
  return upper === lower ? upper : `${upper}${lower}`;
}

/**
 * 同一秒内两次同样的取法，卦序与动爻分毫不差，只靠时间戳加那点哈希是分不开的。
 * 触发这个缺陷的那条路——推演动画（要停 CASTING_HOLD_MS 那么多）期间起卦按钮一直可点，
 * 双击就发出两次请求——客户端那边已另设了 `casting` 闸堵上。但 id 撞车这件事本身还在，
 * 任何两条同 id 的记录进来，删一条就会把另一条一起带走：store.remove 是按 id 过滤的，
 * 实测确实会清掉两条。所以种子末尾再掺一个进程内单调递增的计数：同一秒内不会再撞。
 * 不取模：取模会让计数绕回来时重新撞上，而这一秒内本来就起不了那么多卦。
 */
let idSequence = 0;

function buildId(hexagram, positions, now) {
  const stamp = now.toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14);
  idSequence += 1;
  const seed = `${hexagram.order}-${positions.join('')}-${stamp}-${idSequence}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return `${stamp}-${hash.toString(36).slice(0, 6)}`;
}
