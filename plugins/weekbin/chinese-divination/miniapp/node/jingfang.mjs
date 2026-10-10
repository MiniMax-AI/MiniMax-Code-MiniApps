// @ts-check

/**
 * 京房象数：八宫、纳甲、六亲、世应。
 *
 * 这是与梅花易数并行的另一层。梅花以「动爻所在经卦为体」讲我与事；京房以「本卦
 * 属哪一宫、定第几世」讲六爻各自的身份——哪一爻是我（世），哪一爻是对方（应），
 * 每一爻在五行生克下是谁的什么（父母子孙官鬼妻财兄弟）。两套各管一段，不互相替代：
 * 梅花说「我和这件事」，京房说「我和这个人、每一方是谁」。
 *
 * 出处与底本
 * ──────────
 * 八宫卦序与世次出自《京氏易传》（西汉京房）。八纯卦各领七卦，按爻变推出来：
 *   初爻变＝一世，初二爻变＝二世，初三四爻变＝三世，初至四爻变＝四世，
 *   初至五爻变＝五世；五世卦第四爻变回本宫为游魂；游魂卦下三爻收回来为归魂。
 * 「归魂」一句最容易记错：游魂的下三爻收回来，净效果等于**从本宫卦只变第五爻**，
 * 不是变第四、五爻。本文件据此推导而非抄表——抄表就有抄错的余地。推导时先写成
 * 变第四、五爻，八宫推出的归魂卦整列全错，与传世卦序一撞就查出来了。
 *
 * 纳支用后世沿用两千年的纳支歌诀原文：
 *   乾金甲子外壬午，坎水戊寅外戊申，艮土丙辰外丙戌，震木庚子外庚午，
 *   巽木辛丑外辛未，离火己卯外己酉，坤土乙未外癸丑，兑金丁巳外丁亥。
 * 「内」指下卦三爻，「外」指上卦三爻。乾坤分量最重，各纳两干（乾内甲外壬、
 * 坤内乙外癸）；其余六卦内外共用一天干。
 *
 * 六亲以**本宫五行为我**：生我者父母，我生者子孙，克我者官鬼，我克者妻财，
 * 同我者兄弟。取爻的**地支五行**（纳音不在此列）。
 */

import { TRIGRAMS, HEXAGRAM_LIST, hexagramByKey } from './hexagrams.mjs';
// 本文件已有一个按地支字符取五行的 BRANCH_ELEMENTS；历法那边是按索引排的数组，
// 同名会撞成重复声明，所以这里换个别名，别图省事直接 import 同名常量。
import { branchClash, muJue, seasonVacuous, xunKong, SIX_HARMONY, BRANCH_ELEMENTS as ELEMENT_BY_BRANCH } from './almanac.mjs';

import { BRANCHES } from './almanac.mjs';

/** 地支字面 → 序号。旬空月破墓绝都按序号比，序号在这层只此一处取。 */
const BRANCH_ORDER = BRANCHES;

const GENERATES = Object.freeze({ 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' });
const OVERCOMES = Object.freeze({ 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' });

function generatesTo(from, to) {
  return GENERATES[from] === to;
}

function overcomesTo(from, to) {
  return OVERCOMES[from] === to;
}

/** 五行全序，定义校验表用它遍历，不另写一份。 */
const ELEMENTS = Object.freeze(['木', '火', '土', '金', '水']);

/**
 * 六神起例，《卜筮全书·卷之一·启蒙节要·起六神决》原文：
 *   「甲乙起青龍，丙丁起朱雀，戊日起勾陳，己日起螣蛇，庚辛起白虎，壬癸起玄武。（俱從下起至上。）」
 * 歌诀定的是**初爻**起哪一神；自初爻往上，六神的先后是青龙、朱雀、勾陈、螣蛇、白虎、玄武，
 * 日干只管从哪一神起转，顺序永不改变。存成数据是为了让测试逐字对着底本校。
 */
export const SIX_GOD_SONG = '甲乙起青龙，丙丁起朱雀，戊日起勾陈，己日起螣蛇，庚辛起白虎，壬癸起玄武。（俱从下起至上。）';

/** 六神自初爻向上的固定次序。 */
export const SIX_GOD_ORDER = Object.freeze(['青龙', '朱雀', '勾陈', '螣蛇', '白虎', '玄武']);

/** 日干序（甲乙丙丁戊己庚辛壬癸）各从哪一神起转。 */
const SIX_GOD_FIRST = Object.freeze([0, 0, 1, 1, 2, 3, 4, 4, 5, 5]);

/**
 * 六神的象。
 *
 * 螣蛇的五行有异说：或作火，或作阴土。本包取**火**并在此注明，因为《卜筮全书》与
 * 《增删卜易》通行本多把它与朱雀同类；取土则与勾陈同，两者一主虚惊一主迟滞，取错说反。
 *
 * 另有一条本包死死守住的原则，出处在野鹤一派：「吉凶全凭五行生克，情态方看六神吉凶。」
 * 六神**不参与生克、不改吉凶**，它只说这件事是什么气氛、什么性质。
 */
export const SIX_GOD_MEANING = Object.freeze({
  青龙: Object.freeze({ element: '木', meaning: '喜庆、喜事、贵人、酒色、正直' }),
  朱雀: Object.freeze({ element: '火', meaning: '口舌、文书、消息、是非、诉讼' }),
  勾陈: Object.freeze({ element: '土', meaning: '田土、房产、牵连、迟滞、牢狱' }),
  螣蛇: Object.freeze({ element: '火', meaning: '怪异、虚惊、缠绕、噩梦、欺诈' }),
  白虎: Object.freeze({ element: '金', meaning: '凶险、血光、伤病、丧事、威猛' }),
  玄武: Object.freeze({ element: '水', meaning: '暗昧、盗贼、隐私、暧昧、欺瞒' }),
});

/**
 * 装卦时排的六神：自初爻向上，一神一爻。
 * 书上的两个乾为天卦例本包的测试逐爻对过：甲子日子水子孙临青龙、戊子日子水子孙临勾陈。
 * @param {number} dayStem 日干序 0–9（甲乙丙丁戊己庚辛壬癸）
 * @returns {string[]} 下标 0 为初爻，5 为上爻
 */
export function sixGods(dayStem) {
  const start = SIX_GOD_FIRST[dayStem];
  if (start === undefined) return [];
  return SIX_GOD_ORDER.map((_, i) => SIX_GOD_ORDER[(start + i) % 6]);
}

/** 十二地支五行。地支定这一爻的五行，六亲与一切生克都从这里起。 */
export const BRANCH_ELEMENTS = Object.freeze({
  子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火',
  午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水',
});

/**
 * 八宫。《京氏易传》原序为乾震坎艮、坤巽离兑：前四为阳宫，后四为阴宫。
 */
const PALACES = Object.freeze([
  { key: 'qian', name: '乾宫', trigram: '乾', element: '金', polarity: '阳' },
  { key: 'zhen', name: '震宫', trigram: '震', element: '木', polarity: '阳' },
  { key: 'kan', name: '坎宫', trigram: '坎', element: '水', polarity: '阳' },
  { key: 'gen', name: '艮宫', trigram: '艮', element: '土', polarity: '阳' },
  { key: 'kun', name: '坤宫', trigram: '坤', element: '土', polarity: '阴' },
  { key: 'xun', name: '巽宫', trigram: '巽', element: '木', polarity: '阴' },
  { key: 'li', name: '离宫', trigram: '离', element: '火', polarity: '阴' },
  { key: 'dui', name: '兑宫', trigram: '兑', element: '金', polarity: '阴' },
]);

/** 世次。flips 相对本宫纯卦要变哪几爻；shi 是世爻位。 */
const STAGES = Object.freeze([
  { name: '本宫', shi: 6, flips: [], meaning: '八纯卦。六爻同气，事体纯粹，无从变起。' },
  { name: '一世', shi: 1, flips: [1], meaning: '一世变。事在初起，想动而未走远。' },
  { name: '二世', shi: 2, flips: [1, 2], meaning: '二世变。事已成形，行在半途。' },
  { name: '三世', shi: 3, flips: [1, 2, 3], meaning: '三世变。内卦尽变，外象未动。' },
  { name: '四世', shi: 4, flips: [1, 2, 3, 4], meaning: '四世变。将及于外，局面将定未定。' },
  { name: '五世', shi: 5, flips: [1, 2, 3, 4, 5], meaning: '五世变。外部尽变，只余上爻本宫。' },
  { name: '游魂', shi: 4, flips: [1, 2, 3, 5], meaning: '游魂。外已复本而内卦离散，事无定向、往来不定。' },
  { name: '归魂', shi: 3, flips: [5], meaning: '归魂。内卦归于本宫，事有归处、复回本位。' },
]);

/**
 * 纳支歌诀：内卦三支、外卦三支。乾内甲子外壬午、坤内乙未外癸丑各纳两干，
 * 其余六卦内外同干。
 */
const NAJIA = Object.freeze({
  qian: { inner: { stem: '甲', branches: ['子', '寅', '辰'] }, outer: { stem: '壬', branches: ['午', '申', '戌'] } },
  zhen: { inner: { stem: '庚', branches: ['子', '寅', '辰'] }, outer: { stem: '庚', branches: ['午', '申', '戌'] } },
  kan: { inner: { stem: '戊', branches: ['寅', '辰', '午'] }, outer: { stem: '戊', branches: ['申', '戌', '子'] } },
  gen: { inner: { stem: '丙', branches: ['辰', '午', '申'] }, outer: { stem: '丙', branches: ['戌', '子', '寅'] } },
  kun: { inner: { stem: '乙', branches: ['未', '巳', '卯'] }, outer: { stem: '癸', branches: ['丑', '亥', '酉'] } },
  xun: { inner: { stem: '辛', branches: ['丑', '亥', '酉'] }, outer: { stem: '辛', branches: ['未', '巳', '卯'] } },
  li: { inner: { stem: '己', branches: ['卯', '丑', '亥'] }, outer: { stem: '己', branches: ['酉', '未', '巳'] } },
  dui: { inner: { stem: '丁', branches: ['巳', '卯', '丑'] }, outer: { stem: '丁', branches: ['亥', '酉', '未'] } },
});

/** 爻位标签，自下而上，index 0 是初爻。 */
const POSITION_LABELS = Object.freeze(['初爻', '二爻', '三爻', '四爻', '五爻', '上爻']);

const HEXAGRAMS_BY_KEY = new Map(HEXAGRAM_LIST.map((item) => [item.key, item]));

/** 爻象串翻转若干爻。positions 为 1 起的爻位。 */
function flip(key, positions) {
  const lines = key.split('').map(Number);
  for (const position of positions) lines[position - 1] = lines[position - 1] ? 0 : 1;
  return lines.join('');
}

/**
 * 由八纯卦推出六十四卦的宫与世次。
 * 逐宫推完跟卦表核对：撞车说明两个宫算出了同一卦，数量不足说明有卦没被推到，
 * 任一情况都在这里抛，不静默出错。
 */
const BY_HEXAGRAM_KEY = new Map();
/** 每宫的八卦，按世次先后排好：卦盘上那一列同宫名单就是从这里取的。 */
const PALACE_ROSTERS = new Map();
for (const palace of PALACES) {
  const base = TRIGRAMS[palace.key].lines.repeat(2);
  const roster = [];
  for (const stage of STAGES) {
    const hexagram = hexagramByKey(flip(base, stage.flips));
    const existing = BY_HEXAGRAM_KEY.get(hexagram.key);
    if (existing) {
      throw new Error(`八宫推导撞车：${hexagram.name} 同时算进${existing.palace.name}与${palace.name}`);
    }
    BY_HEXAGRAM_KEY.set(hexagram.key, { palace, stage });
    roster.push(Object.freeze({
      stage: stage.name,
      name: hexagram.name,
      key: hexagram.key,
      // 相对本宫纯卦变过哪几爻。游魂是五世卦第四爻复本来的，第四爻不在其中；
      // 归魂只变第五爻。正因为这两个反着来，「游」「归」两个字才不是随口起的。
      flips: Object.freeze([...stage.flips]),
      shi: stage.shi,
      ying: yingOf(stage.shi),
    }));
  }
  PALACE_ROSTERS.set(palace.key, Object.freeze(roster));
}
if (BY_HEXAGRAM_KEY.size !== HEXAGRAM_LIST.length) {
  throw new Error(`八宫推导只得到 ${BY_HEXAGRAM_KEY.size} 卦，应为 ${HEXAGRAM_LIST.length} 卦`);
}

/** 以本宫五行为「我」，论爻的五行是什么身份。 */
function relativeOf(palaceElement, lineElement) {
  if (lineElement === palaceElement) return '兄弟';
  if (generatesTo(lineElement, palaceElement)) return '父母';
  if (generatesTo(palaceElement, lineElement)) return '子孙';
  if (overcomesTo(lineElement, palaceElement)) return '官鬼';
  if (overcomesTo(palaceElement, lineElement)) return '妻财';
  return '兄弟';
}

/**
 * 世应相隔三位，且是配对关系：初应四、二应五、三应六，返过来四应一、五应二、
 * 六应三。八纯卦世在上爻、坎水等五世卦世在五爻，若照字面「世 + 3」会算到第七、
 * 第八爻去，所以要绕回。一世至三世本就在前三爻内，加三不加不减。
 */
function yingOf(shi) {
  return shi <= 3 ? shi + 3 : shi - 3;
}

/**
 * @typedef {object} JingfangLine
 * @property {number} position  爻位 1 至 6
 * @property {string} label     初爻…上爻
 * @property {string} stem      天干
 * @property {string} branch    地支
 * @property {number} branchIndex 地支索引 0–11
 * @property {string} element   地支五行
 * @property {string} relative  六亲
 * @property {string} role      '世' | '应' | ''
 *
 * @typedef {object} Jingfang
 * @property {string} palaceName   乾宫…
 * @property {string} palaceTrigram 本宫纯卦名
 * @property {string} element      宫五行
 * @property {string} polarity     阳宫 / 阴宫
 * @property {string} stage        本宫…归魂
 * @property {number} shi          世爻位
 * @property {number} ying         应爻位（世 + 3）
 * @property {string} stageMeaning 本宫与游归的含义
 * @property {JingfangLine[]} lines 六爻，自下而上
 */

function palaceEntry(hexagram) {
  const found = BY_HEXAGRAM_KEY.get(hexagram.key);
  if (!found) throw new Error(`八宫查不到 ${hexagram.name || hexagram.key}`);
  return found;
}

/**
 * 给一个卦装上京房的宫、世次、纳甲与六亲。
 *
 * @param {{ key: string, name?: string }} hexagram
 * @returns {Jingfang}
 */
export function jingfang(hexagram) {
  const { palace, stage } = palaceEntry(hexagram);
  const record = HEXAGRAMS_BY_KEY.get(hexagram.key);
  const lower = NAJIA[record.lower];
  const upper = NAJIA[record.upper];
  const ying = yingOf(stage.shi);

  const lines = POSITION_LABELS.map((label, index) => {
    const position = index + 1;
    const isInner = position <= 3;
    const source = isInner ? lower.inner : upper.outer;
    const branch = source.branches[isInner ? position - 1 : position - 4];
    const element = BRANCH_ELEMENTS[branch];
    return Object.freeze({
      position,
      label,
      stem: source.stem,
      branch,
      // 旬空、月破、墓绝都按地支序号算，留着它就不用每处再查一次字表。
      branchIndex: BRANCH_ORDER.indexOf(branch),
      element,
      relative: relativeOf(palace.element, element),
      role: position === stage.shi ? '世' : position === ying ? '应' : '',
    });
  });

  return Object.freeze({
    palaceName: palace.name,
    palaceTrigram: palace.trigram,
    element: palace.element,
    polarity: `${palace.polarity}宫`,
    stage: stage.name,
    shi: stage.shi,
    ying,
    stageMeaning: stage.meaning,
    // 同宫那八卦。卦盘上那一列小卦就是它，每一格标着相对本宫纯卦变过哪几爻。
    roster: PALACE_ROSTERS.get(palace.key),
    lines: Object.freeze(lines),
  });
}

/**
 * 同宫那八卦，按世次先后排好。
 *
 * 拿本宫纯卦作底，按各世次的变爻推出来，所以这一列与宫、世次是同一套推导出来的，
 * 不是另抄的一张表。卦名、变爻、世应都在里面，够卦盘画一整列小卦。
 *
 * @param {{ key: string, name?: string }} hexagram
 * @returns {ReadonlyArray<{ stage: string, name: string, key: string,
 *   flips: readonly number[], shi: number, ying: number }>}
 */
export function palaceRoster(hexagram) {
  return PALACE_ROSTERS.get(palaceEntry(hexagram).palace.key);
}

/**
 * 查卦时用这个就够：只要宫与世次，不必装六亲。
 *
 * @param {{ key: string, name?: string }} hexagram
 * @returns {{ palace: typeof PALACES[number], stage: typeof STAGES[number], ying: number }}
 */
export function palaceOf(hexagram) {
  const { palace, stage } = palaceEntry(hexagram);
  return Object.freeze({ palace, stage, ying: yingOf(stage.shi) });
}

/**
 * 世爻对世爻之外那一方。
 *
 * @param {string} shiElement
 * @param {string} yingElement
 * @returns {{ key: string, text: string } | null}
 */
export function shiYingRelation(shiElement, yingElement) {
  const pairs = [
    [generatesTo(shiElement, yingElement), '生', '世生应', '我这一方主动去就对方，付出在前，谋事多由我推动'],
    [generatesTo(yingElement, shiElement), '被生', '应生世', '对方主动向我，机会多从对方来，宜受之而不宜强求'],
    [overcomesTo(shiElement, yingElement), '克', '世克应', '我压得住对方，主动权在握，但费力'],
    [overcomesTo(yingElement, shiElement), '被克', '应克世', '对方压住我，处境受制，宜守不宜攻'],
    [shiElement === yingElement, '比和', '世应比和', '两边同一路人，立场相近，事情好谈但也难分高下'],
  ];
  const hit = pairs.find(([matched]) => matched);
  return hit ? { key: /** @type {string} */ (hit[1]), text: `${/** @type {string} */ (hit[2])}——${/** @type {string} */ (hit[3])}` } : null;
}

/** 六亲各管什么事，断语里按所问取用神时用。 */
export const RELATIVE_MEANING = Object.freeze({
  父母: '文书契约、长辈、上级、庇护与辛劳',
  兄弟: '同辈、同行、竞争者，也主分夺破耗',
  子孙: '后辈、福佑、解忧，也主医药与消弭',
  妻财: '财物、货物、妻与所求之利',
  官鬼: '官职、名位、夫婿、忧患与阻挠',
});

/**
 * 取用神：在卦中锁定代表所问之事的那一爻。
 *
 * 择爻次序本包从简为两条：**动爻优先，其次取近世爻者**。传世取法更细，两爻俱动时
 * 取旺相者、俱静时取旺相或临世应者，还要看日辰、旬空、墓库——那些本包不具条件，
 * 就不硬凑一条像模像样却无法核验的规则。近世取绝对爻位差，不带旺衰，是能核验的那条。
 *
 * 用神不上卦（六亲一个也没出现在卦里）时，传统要从本宫首卦取伏神。伏神要连带飞神、
 * 出伏与否一并判，属另一层，本包此处只如实说「不上卦」，不硬编。
 *
 * @param {Jingfang} jingfang
 * @param {readonly string[]} relatives 用神取哪几个六亲
 * @param {readonly number[]} movingPositions 动爻位
 * @returns {{
 *   relatives: readonly string[],
 *   present: readonly string[],
 *   absent: readonly string[],
 *   picked: JingfangLine | null,
 *   all: readonly JingfangLine[],
 *   why: string,
 * }}
 */
export function pickUseGod(jingfang, relatives, movingPositions = []) {
  const moving = new Set(movingPositions);
  const all = jingfang.lines.filter((line) => relatives.includes(line.relative));
  const present = relatives.filter((name) => all.some((line) => line.relative === name));
  const absent = relatives.filter((name) => !present.includes(name));

  if (all.length === 0) {
    return Object.freeze({ relatives, present, absent, picked: null, all, why: '不上卦' });
  }
  // 候选不止一亲时**不择**：婚恋分男女，本包不认得求测者性别；疾病是病症与医药
  // 两头看，择了其一就等于替人认了性别或认了病势。只报各亲所在，取舍交回断语。
  if (relatives.length > 1) {
    return Object.freeze({ relatives, present, absent, picked: null, all, why: '两亲各看各的' });
  }
  if (all.length === 1) {
    return Object.freeze({ relatives, present, absent, picked: all[0], all, why: '卦中独一' });
  }

  const animated = all.filter((line) => moving.has(line.position));
  const pool = animated.length > 0 ? animated : all;
  const why = animated.length > 0 ? '动爻优先' : '近世爻者';
  // 绝对爻位差，不带旺衰判断
  let picked = pool[0];
  for (const line of pool) {
    if (Math.abs(line.position - jingfang.shi) < Math.abs(picked.position - jingfang.shi)) {
      picked = line;
    }
  }
  return Object.freeze({ relatives, present, absent, picked, all, why });
}

/**
 * 伏神：用神不上卦时，从本宫首卦借来压在某一爻之下。
 *
 * 出处为《增删卜易·飞伏神章第二十八》：「若用神不现，即以日月为用神，倘日月非用神者，
 * 则于本宫首卦寻之，因本宫首卦，父子财官六亲俱全之故耳。」位置也随之定死：**本宫首卦
 * 里那一亲在第几爻，就伏在本卦的第几爻之下**；本卦同爻位那一爻压着它，就是飞神。
 *
 * 书上的两个例证，本文件的测试逐条对：
 *   天风姤（乾宫一世）占妻财——姤卦六爻无寅卯，乾为天二爻是妻财寅木，故寅木伏于
 *     姤卦二爻亥水之下，亥水为飞神；亥水生寅木，是「飞来生伏得长生」，作吉断。
 *   天山遁（乾宫二世）占子孙——遁卦无亥子，乾为天初爻是子水子孙，故子水伏于遁卦
 *     初爻辰土之下，辰土为飞神；辰土克子水，是「飞来克伏遭克害」，伏神受制，作凶推。
 *
 * 另有一条《火珠林》更严的版本「本宫财官伏世下方可取，不伏世下则不取」——本包不取：
 * 它会把大量正常局面直接判成无用神。
 *
 * @param {Jingfang} jingfang
 * @param {string} relative 缺的那一亲
 * @returns {{
 *   hushen: JingfangLine,
 *   feishen: JingfangLine,
 *   palaceName: string,
 *   ambiguous: boolean,
 * } | null}
 */
export function hiddenGod(hexagramJingfang, relative) {
  const palace = PALACES.find((item) => item.name === hexagramJingfang.palaceName);
  if (!palace) return null;
  // 参数不能也叫 jingfang：会把这层遮蔽掉，函数内就再也调不到它。
  const palaceJingfang = jingfang(hexagramByKey(TRIGRAMS[palace.key].lines.repeat(2)));
  const candidates = palaceJingfang.lines.filter((line) => line.relative === relative);
  if (candidates.length === 0) return null;
  const hushen = candidates[0];
  return Object.freeze({
    hushen,
    feishen: hexagramJingfang.lines[hushen.position - 1],
    palaceName: palace.name,
    // 八纯卦里同一亲占两爻的情况（乾宫父母在三、六爻）。测试量过六十四卦全量：
    // 缺失六亲的实例与伏神爻一一对应，从没碰上过同亲两爻同时缺失，所以不必另设挑法。
    ambiguous: candidates.length > 1,
  });
}

/** 飞伏生克，四种关系各有定名，出处同《增删卜易》飞伏神章。 */
export function flyingRelation(hushen, feishen) {
  const from = feishen.element;
  const to = hushen.element;
  if (from === to) return { key: '比和', text: '飞伏同气，伏神不另得生也另不得泄', good: null };
  if (generatesTo(from, to)) {
    return { key: '飞来生伏', text: '飞来生伏得长生：压着它的那一爻反倒生它，所求之事虽不在明面，底下是被养着的', good: true };
  }
  if (generatesTo(to, from)) {
    return { key: '伏去生飞', text: '伏去生飞是泄气：伏神一味往上供，耗神费力，付出多而收成迟', good: false };
  }
  if (overcomesTo(to, from)) {
    return { key: '伏来克飞', text: '伏来克飞是出暴：伏神一脚踹开压着它的爻，事情应得突然而急，多为不吉之兆', good: false };
  }
  return { key: '飞来克伏', text: '飞来克伏是反伤：飞神死死压住伏神，所求之事受压制，难以出头', good: false };
}

/** 任两个五行之间的关系，说人话用。from 生 to 为「生」。 */
export function elementRelation(from, to) {
  if (from === to) return '同气';
  if (generatesTo(from, to)) return '生';
  if (generatesTo(to, from)) return '被生';
  if (overcomesTo(from, to)) return '克';
  if (overcomesTo(to, from)) return '被克';
  return '无涉';
}

/**
 * 用神、元神、忌神、仇神：用神周围那一圈。
 *
 * 出处为《增删卜易》卷之一·用神元神忌神仇神章第九，原文连定义带worked example都给足了：
 *   「用神者，即前各类之用神。元神者，生用神之爻，即为元神。忌神者，克用神之爻也，即为忌神。
 *     仇神者，克制元神不能生用神，反生忌神而克害用神，即为仇神。假令金为用神，生金者土也，
 *     土为元神；克金者火也，火为忌神；克土生火者木也，木为仇神。余仿此。」
 *
 * 三个名目都在本卦六爻里找，不出卦外：
 *   元神——生用神那一行的爻；忌神——克用神那一行的爻；仇神——克元神那一行的爻。
 * 仇神的害处是**间接**的，这一点原文讲得很明白：它压着元神使元神生不动用神，
 * 自己又反去生忌神，等于两头帮倒忙。所以断语不说「仇神克用神」——它并不直接克。
 *
 * 三行必然互异，五行里逐个核过：金木水火土五位用神，元、忌、仇各占一支，十九种组合
 * 没有一次撞行；金用神那组也正好是书上的土元、火忌、木仇。加载时核一遍，核不过就抛。
 *
 * 另有一条本包要照办的提醒，原文紧接着就说了：**「勿以仇神即仇人也」**——仇神是五行位置上
 * 的那一爻，不是卦里那个人。原文里真正把人称作仇人的，是应爻克世。两者不是一回事。
 *
 * @param {Jingfang} jingfang
 * @param {JingfangLine} picked 用神爻
 * @returns {{ yuan: JingfangLine[], ji: JingfangLine[], chou: JingfangLine[], elements: { yuan: string, ji: string, chou: string } }}
 */
export function useGodCircle(jingfang, picked) {
  const god = picked.element;
  const yuanElement = Object.keys(GENERATES).find((element) => GENERATES[element] === god) ?? '';
  const jiElement = Object.keys(OVERCOMES).find((element) => OVERCOMES[element] === god) ?? '';
  // 仇神克的是元神，不是用神——原文「克土生火者木也」那个「克土」说的是元神那一行。
  const chouElement = Object.keys(OVERCOMES).find((element) => OVERCOMES[element] === yuanElement) ?? '';
  const pick = (element) => jingfang.lines.filter((line) => line.element === element);
  return Object.freeze({
    yuan: Object.freeze(pick(yuanElement)),
    ji: Object.freeze(pick(jiElement)),
    chou: Object.freeze(pick(chouElement)),
    elements: Object.freeze({ yuan: yuanElement, ji: jiElement, chou: chouElement }),
  });
}

// 元、忌、仇三行互异，且与书上的金用神一例对得上。定义跟着代码走，核不过就在这里抛。
for (const god of ELEMENTS) {
  const { elements } = useGodCircle(
    { lines: ELEMENTS.map((element, index) => ({ position: index + 1, element })) },
    { element: god },
  );
  if (new Set([elements.yuan, elements.ji, elements.chou]).size !== 3) {
    throw new Error(`元忌仇校验不过：${god}用神之下算出元${elements.yuan}忌${elements.ji}仇${elements.chou}，五行里这三者应当互异`);
  }
  // 书上给的例子：金为用神，土为元神，火为忌神，木为仇神
  if (god === '金' && (elements.yuan !== '土' || elements.ji !== '火' || elements.chou !== '木')) {
    throw new Error(`元忌仇校验不过：书上说金用则土元火忌木仇，实算出元${elements.yuan}忌${elements.ji}仇${elements.chou}`);
  }
  // 原文说仇神「反生忌神」，这一条也核上——它替忌神出力，自己却并不生用神
  if (GENERATES[elements.chou] !== elements.ji || GENERATES[elements.chou] === god) {
    throw new Error(`元忌仇校验不过：${god}用神之仇神${elements.chou}该反生忌神${elements.ji}且不生用神`);
  }
}

/**
 * 变出之爻：动爻动了以后变出来的那一爻，讲的是这一爻「往哪儿去」。
 *
 * 回头生与回头克的定名，各有一条可核的原话，两句都只看一个方向——**变爻对本爻**：
 *   回头生——「巽木变坎水，谓之化生，水回头以生木也，即以吉断。」
 *   回头克——「震木变乾金，谓之化克，金回头以克木也，即以凶推。」
 * 变爻生本爻是回头生，变爻克本爻是回头克，就这么一条线，两个方向。
 *
 * 《卜筮正宗·十八问答第二问》更进一步，把回头克的五种情形逐个点出来：
 *   「土爻動而變木、木爻動而變金、金爻動而變火、火爻動而變水、水爻動而變土，
 *     此是爻之回頭剋也」
 * 正好是「变爻克本爻」在五行上的全部五个组合，一个不多一个不少。本包拿它当回头克的
 * 定义校验表：HUI_TOU_KE_PAIRS 逐对与 overcomesTo 对撞，少一对多一对都在加载时抛。
 * 同章还有一句要紧的——「凡遇回頭剋者,徹底剋盡,原用二神遇之則凶,忌仇二神遇之反吉也」：
 * 回头克是「彻底克尽」，凶不凶还要看它落在哪一亲身上，所以断语里把这半句一并带出。
 *
 * 反过来的两个方向书上另有名：变爻生本爻为回头生，本爻生变爻为化泄（气泄给变爻），
 * 本爻克变爻为化耗（自出力气还要克下），同行者为化比和。这三个本包**只作事实陈述，
 * 不配吉凶调子**——《增删卜易》只对回头生、回头克明说了吉凶，其余三个没有原话可依，
 * 硬配就成了编。吉凶那一半仍旧只看回头生与回头克两个字。
 */

/** 回头克的五个五行组合，出自《卜筮正宗·十八问答第二问》，用来校验定义而非枚举。 */
export const HUI_TOU_KE_PAIRS = Object.freeze([
  Object.freeze(['土', '木']),
  Object.freeze(['木', '金']),
  Object.freeze(['金', '火']),
  Object.freeze(['火', '水']),
  Object.freeze(['水', '土']),
]);

// 定义校验：表里每一对都得真的是「变爻克本爻」。反过来，五行上的克关系一共就这五对，
// 这里逐一确认表是全的——将来谁动了 OVERCOMES 而忘了回头克，这里先炸。
for (const [moving, changed] of HUI_TOU_KE_PAIRS) {
  if (!overcomesTo(changed, moving)) {
    throw new Error(`回头克校验不过：书上说${moving}爻动变${changed}是回头克，而${changed}并不克${moving}`);
  }
}
for (const moving of ELEMENTS) {
  for (const changed of ELEMENTS) {
    if (overcomesTo(changed, moving) && !HUI_TOU_KE_PAIRS.some(([m, c]) => m === moving && c === changed)) {
      throw new Error(`回头克校验不过：${moving}爻动变${changed}属于变爻克本爻，歌诀表里却没有这一对`);
    }
  }
}

/**
 * 动爻与变爻之间的五行关系，即变爻对本爻是回头生、回头克，还是另外三种不配吉凶的。
 * @param {{ element: string }} moving 本卦动爻
 * @param {{ element: string }} changed 变卦同位那一爻
 * @returns {{ key: string, good: boolean|null, text: string }}
 */
export function transformRelation(moving, changed) {
  const from = moving.element;
  const to = changed.element;
  if (from === to) {
    return { key: '化比和', good: null, text: '变爻与本爻同气，是化比和：力量不相增减，事情维持原有格局，不进不退。' };
  }
  if (generatesTo(to, from)) {
    return { key: '回头生', good: true, text: '变爻回头以生本爻，作吉断：动爻往变爻那一头去，反倒得了生扶，越往后越有转机。' };
  }
  if (overcomesTo(to, from)) {
    return {
      key: '回头克',
      good: false,
      text: '变爻回头以克本爻，作凶推。《卜筮正宗》说它「彻底克尽」，落在用神身上则凶，落在忌神仇神身上反吉。',
    };
  }
  if (generatesTo(from, to)) {
    return { key: '化泄', good: null, text: '本爻生变爻，是化泄：动爻的力量一路泄进变爻，付出在前，收成在后。' };
  }
  return { key: '化耗', good: null, text: '本爻克变爻，是化耗：动爻既出了力又去克下，两头耗着，得来不易。' };
}

/**
 * 进退神，《增删卜易·进退神章第二十九》歌诀原文：
 *   「进神：亥化子，寅化卯，巳化午，申化酉，丑化辰，辰化未，未化戌，戍化丑。
 *     退神：子化亥，卯化寅，午化巳，酉化申，辰化丑，未化辰，戍化未，丑化戍。」
 *
 * 底本此处「戍」即「戌」，同一个字的异体；歌诀照录底本，算的时候一律按十二支正字写「戌」。
 * 十六对两两互为反面，且每一对本支同行：水水、木木、火火、金金各一对，剩下四对都在土上
 * ——丑→辰→未→戌→丑这一圈上前后各走一步。土占四对不是笔误，是这一行本来就密。
 *
 * 这是固定映射不是形状推导，所以直接查表；表本身在模块加载时逐对核两件事——同行、反向互为
 * 反面，数量也得是十六对。任一条不合就在这里抛，不留一个能算错的表。
 */
export const JIN_TUI_SONG = '进神：亥化子，寅化卯，巳化午，申化酉，丑化辰，辰化未，未化戌，戍化丑。退神：子化亥，卯化寅，午化巳，酉化申，辰化丑，未化辰，戍化未，丑化戍。';

const JIN_TUI = Object.freeze({
  '亥子': '进神', '子亥': '退神',
  '寅卯': '进神', '卯寅': '退神',
  '巳午': '进神', '午巳': '退神',
  '申酉': '进神', '酉申': '退神',
  '丑辰': '进神', '辰丑': '退神',
  '辰未': '进神', '未辰': '退神',
  '未戌': '进神', '戌未': '退神',
  '戌丑': '进神', '丑戌': '退神',
});

for (const [pair, key] of Object.entries(JIN_TUI)) {
  const from = pair[0];
  const to = pair[1];
  if (BRANCH_ELEMENTS[from] !== BRANCH_ELEMENTS[to]) {
    throw new Error(`进退神校验不过：歌诀说${from}化${to}，而两支不同行`);
  }
  const back = JIN_TUI[`${to}${from}`];
  if (back !== (key === '进神' ? '退神' : '进神')) {
    throw new Error(`进退神校验不过：${from}化${to}为${key}，反方向${to}化${from}却是${back ?? '无'}`);
  }
}
if (Object.keys(JIN_TUI).length !== 16) {
  throw new Error(`进退神只列了 ${Object.keys(JIN_TUI).length} 对，歌诀两首各八字，应为 16 对`);
}

/**
 * 变爻相对本爻是进是退。歌诀里没有的不硬说——不是每一爻都化得成进退。
 * @param {string} fromBranch 本爻地支
 * @param {string} toBranch 变爻地支
 * @returns {{ key: '进神'|'退神', text: string } | null}
 */
export function jinTui(fromBranch, toBranch) {
  const key = JIN_TUI[`${fromBranch}${toBranch}`];
  if (!key) return null;
  return {
    key,
    text: key === '进神'
      ? `${fromBranch}化${toBranch}是进神：事情往前走一步，力量渐长，宜顺势推进。`
      : `${fromBranch}化${toBranch}是退神：事情往回退一步，力量渐消，宜守宜缓。`,
  };
}

/**
 * 纳支里逢不上绝地。绝地是墓的下一支，自墓法：金绝寅、木绝申、水土绝巳、火绝亥。
 * 纳甲里每个五行只占两支（金申酉、木寅卯、水子亥、火巳午、土丑辰未戌），逐支核下来，
 * 上列绝支没有一支落在这五行自己占的支里——所以任何一爻、任何一化爻都逢不上绝地，
 * 卦体与断语的「绝」小标据此撤掉。这不是漏做，留着就是一条永远不亮的字。
 * 钉在这里是怕日后有人看见「十二长生有绝地」就把它加回来——加回来只会多一个空标记。
 */
for (const element of ELEMENTS) {
  const j = BRANCH_ORDER[(muJue(element).mu + 1) % 12];
  if (BRANCH_ELEMENTS[j] === element) {
    throw new Error(`纳支绝地校验不过：${element}的绝地是${j}，而纳甲偏偏把${j}也派给了${element}，「逢绝」重新成立，墓表与纳支得重核`);
  }
}

/**
 * 旬空、月破、入墓，落到一爻上是什么情形；旬空再分真假。
 *
 * 出处为《增删卜易·旬空章第二十六》野鹤自道：
 *   「旺不爲空，動不爲空，有日建動爻生扶者不爲空，動而化空、伏而旺相皆不爲空。
 *     月破爲空。有卦不動爲空，爻反伏而被克爲空，真空爲空，
 *     真空卽春土、夏金、秋木、三冬逢火是真空。」
 *
 * 逐条照做，不另立规矩：
 *   假空（有救，不作真空论）——旺、动、得日辰或动爻生扶、动而化空、伏而旺相。
 *   真空（真无用）——月破、有气而不动、伏而被克、四季所逢之空元素。
 *
 * 一处存疑照实交代：「有卦不動爲空」一句，野鹤原文如此，后世多本作「有氣無動爲空」。
 * 两者差一个「氣」字，意思差得远——前者是说静卦全空，后者只说静而有气者空。
 * 本包取**后者**（有气而不动方论空），理由是它与同段「旺不爲空」不冲突：若静而旺便
 * 算真空，那前一句「旺不为空」就无处容身。此处已在 README 标明是取舍不是定论。
 *
 * @param {JingfangLine} line 本卦一爻
 * @param {{
 *   monthBranch: number, dayBranch: number, dayIndex: number,
 *   movingElements: string[], movingPositions: number[],
 *   isHidden?: boolean, isStruck?: boolean,
 * }} calendar
 */
export function voidReading(line, calendar) {
  const kong = xunKong(calendar.dayIndex);
  const isVoid = kong.voidBranches.includes(line.branchIndex);
  const isBroken = branchClash(calendar.monthBranch) === line.branchIndex;
  const mj = muJue(line.element);
  const isTomb = mj.mu === line.branchIndex;

  // 下面只在「空」这一支上判真假。逢月破而不逢旬空时不算这一支——
  // 但也不能就这么什么也不说：《增删卜易·月破章》「虽有日辰之生，亦不能生」，
  // 逢冲只会把它冲得更伤，而同章旬空一篇又把「月破爲空」列在真空那几条里。
  // 所以单逢月破的爻也作真空，只是它的空不是旬空那种「等出旬」，是「待出月」。
  if (!isVoid) {
    if (!isBroken) {
      return Object.freeze({
        isVoid: false, isBroken, isTomb,
        status: null, rescues: Object.freeze([]), empties: Object.freeze([]),
      });
    }
    return Object.freeze({
      isVoid: false, isBroken, isTomb,
      status: '真空', rescues: Object.freeze([]), empties: Object.freeze(['逢月破']),
    });
  }

  const dayElement = ELEMENT_BY_BRANCH[calendar.dayBranch];
  const monthElement = ELEMENT_BY_BRANCH[calendar.monthBranch];
  const moving = new Set(calendar.movingPositions);

  /** 有救者不为空。顺序照野鹤原话的次序。 */
  const rescues = [];
  const tone = vitality(line.element, monthElement).tone;
  if (tone === 'strong' || tone === 'good') {
    rescues.push(`旺相（于月建${tone === 'strong' ? '旺' : '相'}）`);
  }
  if (moving.has(line.position)) rescues.push('发动');
  if (generatesTo(dayElement, line.element) || calendar.movingElements.some((e) => generatesTo(e, line.element))) {
    rescues.push('得日辰或动爻生扶');
  }
  if (calendar.isHidden && (tone === 'strong' || tone === 'good')) rescues.push('伏而旺相');

  /** 作真空论者。 */
  const empties = [];
  if (isBroken) empties.push('逢月破');
  if ((tone === 'strong' || tone === 'good') && !moving.has(line.position)) {
    empties.push('有气而不动');
  }
  if (calendar.isStruck) empties.push('伏而被克');
  const vacuous = seasonVacuous(calendar.monthBranch);
  if (vacuous.vacuousElement === line.element) {
    empties.push(`${vacuous.season}令正空${vacuous.vacuousElement}`);
  }

  // 有救就不作真空论——这是野鹤的次序：先说不为空，再说什么为空。
  const status = rescues.length > 0 ? '假空' : (empties.length > 0 ? '真空' : '旬空未判');
  return Object.freeze({
    isVoid: true, isBroken, isTomb,
    status, rescues: Object.freeze(rescues), empties: Object.freeze(empties),
  });
}

/**
 * 旺相休囚死：月建为令，令生者相、生令者休、克令者囚、令克者死。
 *
 * 口诀里的「令」是月建，不是爻——这一层最容易读反。照口诀逐档落：
 * 旺=与月建同我；相=月建生爻；休=爻生月建；囚=爻克月建；死=月建克爻。
 * 拿寅卯木令核一遍：木旺、火相、水休、金囚、土死——与《增删卜易·四时旺相章》
 * 逐月所列一致。早先这里把注释写成「克我为囚、我克为死」，那个「我」若指月建，
 * 就正好把囚与死掉个个儿；若指爻，又与相、休两档相矛盾。两种读法都跟代码对不上，
 * 注释已按口诀改正，代码一直是对的。
 *
 * 五档穷尽，且旺相（strong/good）与休囚死（weak/bad）二分干净——暗动与日破
 * 就是拿这条线分的，见 dayClashReading。
 *
 * 另有一层本包**未做**：《增删卜易·四时旺相章》在四季土月（辰戌丑未为月建）另有
 * 一条加减，说冲着月建的那一支按休囚论、另支尚有余气不作休囚。那一章在卷内另有章次，
 * 且「不作休囚」之后并未交代该落到哪一档，照搬要靠猜，所以此处不并进来。旺相
 * 在四季土月只按本表算，取舍已在 README 标明。
 *
 * 放在这层是因为生克的 GENERATES / OVERCOMES 就在这里，挪到别处只会多出第二份口径。
 * @param {string} element 爻或卦的五行
 * @param {string} monthElement 当月月建的五行
 */
export function vitality(element, monthElement) {
  if (element === monthElement) return { key: '旺', tone: 'strong' };
  if (generatesTo(monthElement, element)) return { key: '相', tone: 'good' };
  if (generatesTo(element, monthElement)) return { key: '休', tone: 'weak' };
  if (overcomesTo(element, monthElement)) return { key: '囚', tone: 'bad' };
  return { key: '死', tone: 'bad' };
}

/**
 * 日辰冲爻，分三路。出处两份，都是逐字引的。
 *
 * **静爻那一头是《增删卜易》卷一·暗动章第二十二**：
 *   「靜爻旺相日辰沖之爲暗動，靜爻休囚日辰沖之爲破。」
 * 章节号以卷一目录为准作**第二十二**；传本正文在「增删卜易/22」一页题下亦作
 * 「暗動章第二十二」。另有二手站把这章标作「025章」，是按全书篇序排的号，
 * 与卷内章次不同，本包不从。
 *
 * **动爻那一头是同卷紧接的《动散章第二十三》**：
 *   「占以日辰而沖動爻，謂之沖散，又以爻動沖爻，亦能沖散，予屢試之，
 *     旺相者沖之不散，有气者沖之不散，休囚者間有沖散，亦千百中之一二也，
 *     其故何也？神兆機於動，動必有因。𨿽則今日受制，後逢值日而不散也。」
 * 传本有把这段接在暗动章末的，本包仍按目录作独立的第二十三章。
 *
 * 一句话分三路：日辰只冲一支，被冲到的那几爻里，静爻按旺衰分暗动与日破，
 * 动爻一律记为冲散。三路互斥，结构上就不会同时出现。
 *
 * 四处取舍照实交代：
 *
 * 一、**动散只管「报」，不断「散」**。这一章的结论恰恰是**不散**：旺相者冲之不散，
 *    休囚者也说散是「千百中之一二」——野鹤说他屡试都碰不上几回，末了归到
 *    「神兆機於動，動必有因」。所以本包只把「哪一爻动而逢日冲」这件事实报出来，
 *    连带把这句话一起引，不拿它断凶。暗动章那半句「占以暗動福來而不知，禍來而不覺」
 *    是说静爻的，不挪来套在动爻上。
 *
 * 二、**「有气者冲之不散」那半句没做**。「有气」在《四时旺相章》里是四季土月的余气
 *    一档，与旺相不同档；原书没有说它落到旺衰哪一档，照搬要靠猜。旺相与休囚两路
 *    分尽已够，此处只按旺相休囚死五档判，取舍已写进 README。
 *
 * 三、**月建冲动爻不作冲散**，这一条是明文。同卷日辰章驳别家时写：
 *    「他書有云，爻逢月建日沖而不散，是明知當令，不畏日沖」——《易冒·日冲章》说
 *    「如動爻遇日辰相沖，苟非月建，則謂之散」，「苟非月建」四字就是豁免。
 *    所以本包只取日辰这一路冲散，月建那一路只留给既有的月破。
 *
 * 四、**「又以爻動沖爻」那半句没做**。他爻发动来冲要看两爻谁强谁弱
 *    （《易冒》作「若彼強我弱皆散」），强弱不在本包现有口径里，硬判就是自造一档。
 *    只取日辰冲这一路。
 *
 * 另有一处结构事实顺带钉住：日辰所冲之支与被冲之爻只可能同行或相克，六冲六对里
 * 丑未、辰戌同为土不生不克，子午、寅申、卯酉、巳亥四对都是日辰克本爻，没有一对
 * 是日辰生本爻。所以「得日辰生扶」这一路救不了被冲的爻——旬空章那半个救应
 * 对暗动与冲散天然不适用。下方加载时把这一条钉死。
 *
 * @param {Jingfang} jingfang
 * @param {{ monthBranch: number, dayBranch: number, movingPositions: number[] }} calendar
 * @returns {{ dark: JingfangLine[], dayBroken: JingfangLine[], pressed: JingfangLine[] }}
 */
export function dayClashReading(jingfang, calendar) {
  const monthElement = ELEMENT_BY_BRANCH[calendar.monthBranch];
  const moving = new Set(calendar.movingPositions);
  const clashed = branchClash(calendar.dayBranch);
  const dark = [];
  const dayBroken = [];
  const pressed = [];
  for (const line of jingfang.lines) {
    if (line.branchIndex !== clashed) continue;
    // 动爻逢日冲走冲散那一路，与静爻的两路互斥，所以下面那个 continue 挪到了这里。
    if (moving.has(line.position)) {
      pressed.push(line);
      continue;
    }
    const tone = vitality(line.element, monthElement).tone;
    (tone === 'strong' || tone === 'good' ? dark : dayBroken).push(line);
  }
  return Object.freeze({
    dark: Object.freeze(dark),
    dayBroken: Object.freeze(dayBroken),
    pressed: Object.freeze(pressed),
  });
}

/**
 * 六冲卦与六合卦。判据是纳甲装出来的六支按初四、二五、三六配成三对，三对全冲为六冲卦，
 * 三对全合为六合卦。
 *
 * 出处：《增删卜易》卷一·六合章第十九与六冲章第二十。
 * 六合章：「卦逢六合者，即如天地否卦內外六爻自相和合是也，不動亦是。」
 * 六冲章：「相冲之法有六……卦逢六冲者，二也。」
 *
 * **配对为什么是初四、二五、三六，不是内外卦各自成对。** 这一步容易数错：
 * 纳甲装卦时内卦三爻排在初二三、外卦三爻排在四五六，两卦的地支起点错开一位
 * （乾内子寅辰、外午申戌，坤内未巳卯、外丑亥酉），所以内外对应的地支是「隔三位相配」
 * 才撞得上，不是「内外同位相配」。按同位去配，六十四卦里一个六冲卦也找不出来。
 *
 * **「三对全冲」其实一组就够。** 世传歌诀说「这三组，只要有一组相冲，其他两组必定相冲，
 * 一看就知」。这不是经验，是纳甲定死的：两卦的地支是同一起点的平移，六冲六对把十二支
 * 分成六组互斥的搭档，任一支的冲支唯一，所以三组里撞上一组，另两组必也撞上。下方
 * 加载时把这一条对六十四卦逐个核过。
 *
 * 卦内**任意**两爻相冲是另一回事，频次高得多（六十四卦里三十卦都有，六冲卦之外的二十卦
 * 也有），本函数不把它算成六冲卦——六冲卦是三对皆冲的整卦结构，爻与爻冲是零散的事实，
 * 两者混为一谈会把三分之一的卦都说成六冲卦。
 *
 * @param {object} hexagram
 * @param {{ palace: string, stage: string, shi: number, ying: number, element: string,
 *           lines: JingfangLine[] }} [prepared] 已有京房卦就传进来，省一次重算
 * @returns {{ chong: boolean, he: boolean, pairs: Array<{ lower: JingfangLine, upper: JingfangLine, kind: '冲'|'合' }> }}
 */
export function hexagramClash(hexagram, prepared) {
  const jf = prepared ?? jingfang(hexagram);
  const pairs = CLASH_PAIR_OFFSETS.map(([lower, upper]) => {
    const a = jf.lines[lower - 1];
    const b = jf.lines[upper - 1];
    const kind = branchClash(a.branchIndex) === b.branchIndex
      ? '冲'
      : SIX_HARMONY.some(([x, y]) => (x === a.branchIndex && y === b.branchIndex)
        || (x === b.branchIndex && y === a.branchIndex)) ? '合' : null;
    return { lower: a, upper: b, kind };
  });
  const chong = pairs.every((pair) => pair.kind === '冲');
  const he = pairs.every((pair) => pair.kind === '合');
  return Object.freeze({ chong, he, pairs: Object.freeze(pairs) });
}

/**
 * 地支相刑。出处是《增删卜易》卷一·三刑章第二十一，该章原文只有这六句：
 *
 *   「寅刑巳、巳刑申、子刑卯、卯刑午、丑戌相刑、未辰相刑。又云：辰午酉亥谓之自刑。」
 *
 * **本包照这六条原样排，不照八字那一套。** 子平命理流行的八条是「寅刑巳、巳刑申、申刑寅、
 * 丑刑戌、戌刑未、未刑丑、子刑卯、卯刑子」，与此有两处实质不同：
 *   一、增删卜易作「卯刑午」，命理作「卯刑子」；
 *   二、增删卜易作「未辰相刑」，命理作「未刑丑、戌刑未」两条。
 * 两套在六十四卦上落出来的卦也不一样：底本这六条碰得出三十七卦，命理那八条碰得出四十八卦。
 * 底本既是本包据以立论的那一部，异说在这里记明，不混着排——两套一起排就成了二十四条，
 * 断语里「有几爻犯刑」这句话立刻失去意义。
 *
 * **刑是有向的。** 「寅刑巳」说的是寅去刑巳，不是巳去刑寅。方向在六十四卦上确实落出差别：
 * 丑刑戌有十二卦，戌刑未只四卦。所以这里存成有序的二元组，按 a 刑 b 逐对判，不做成无向表。
 * 子卯那一对两向都刑（底本作「子刑卯、卯刑午」，命理作「子刑卯、卯刑子」，两向都在），
 * 但那是两条分别的话，不是同一条的镜像，所以照样分开存。
 *
 * 自刑四支辰午酉亥出自同章的「又云」，不是那六句之一，另存一处。
 */
const PUNISH_PAIRS = Object.freeze([
  ['寅', '巳'], ['巳', '申'], ['子', '卯'], ['卯', '午'], ['丑', '戌'], ['未', '辰'],
]);

/** 自刑四支：辰午酉亥再见同支为刑。 */
const SELF_PUNISH_BRANCHES = Object.freeze(['辰', '午', '酉', '亥']);

/** a 是否刑 b。取自 {@link PUNISH_PAIRS}，有序。 */
function branchPunishes(a, b) {
  return PUNISH_PAIRS.some(([from, to]) => from === a && to === b);
}

/** 自刑只在本支见本支时成立，别的支之间没有自刑一说。 */
function branchSelfPunishes(a, b) {
  return a === b && SELF_PUNISH_BRANCHES.includes(a);
}

/**
 * 爻之刑。三刑章那句话是这一层唯一的主张，而它自带一个很紧的前提。
 *
 * 原文：「夫三刑者，予屡试之，**或因用神休囚又兼他爻犯之**，刑者则见凶，
 * 而**独犯三刑得验者少，占过数十年只验得一卦**。」
 *
 * 也就是说「犯刑」本身不是判词：野鹤自己试了几十年，单靠犯刑只验中一卦，要见凶还得搭上
 * 用神休囚与另一爻也犯刑两条。所以本函数只报「谁刑了谁」，那两条前提由断语核，
 * 吉凶仍旧归用神旺衰——这跟本包在六冲、六合两章上的处置是同一条线。
 *
 * 三路都报：爻与爻相刑、动变两爻之外的本支自刑、以及日月与爻相刑。
 * 刑不像冲，方向明确（见 {@link PUNISH_PAIRS} 的注），所以报的时候把「谁刑谁」原样带出去，
 * 不折成一句「此爻犯刑」——折了就看不出是谁动的。
 *
 * @param {Jingfang} jingfang
 * @param {{ monthBranch: number, dayBranch: number }} calendar
 * @returns {{
 *   linePairs: readonly { from: JingfangLine, to: JingfangLine, self: boolean }[],
 *   outside: readonly { line: JingfangLine, source: string, from: string, to: string, self: boolean }[],
 *   hitPositions: readonly number[], hasAny: boolean,
 * }}
 */
export function punishReading(jingfang, calendar) {
  const linePairs = [];
  for (let a = 1; a <= 6; a += 1) {
    for (let b = 1; b <= 6; b += 1) {
      if (a === b) continue;
      const from = jingfang.lines[a - 1];
      const to = jingfang.lines[b - 1];
      if (branchPunishes(from.branch, to.branch)) {
        linePairs.push(Object.freeze({ from, to, self: false }));
      } else if (branchSelfPunishes(from.branch, to.branch) && a < b) {
        // 自刑本就对称，同一对（a 刑 b / b 刑 a）只算一次。
        // 两头都收的话，断语会把「二爻亥自刑四爻」和「四爻亥自刑二爻」并排说一遍，
        // 看着像两件事，其实是一对。相刑那六条有方向，不必这样收。
        linePairs.push(Object.freeze({ from, to, self: true }));
      }
    }
  }
  // 日月与爻。日辰月建当作一只「爻」来看，方向照旧。
  const outside = [];
  for (const source of [
    { name: '日辰', branch: BRANCH_ORDER[calendar.dayBranch] },
    { name: '月建', branch: BRANCH_ORDER[calendar.monthBranch] },
  ]) {
    for (const line of jingfang.lines) {
      if (branchPunishes(source.branch, line.branch)) {
        outside.push(Object.freeze({ line, source: source.name, from: source.branch, to: line.branch, self: false }));
      } else if (branchPunishes(line.branch, source.branch)) {
        outside.push(Object.freeze({ line, source: source.name, from: line.branch, to: source.branch, self: false }));
      } else if (branchSelfPunishes(source.branch, line.branch)) {
        outside.push(Object.freeze({ line, source: source.name, from: line.branch, to: source.branch, self: true }));
      }
    }
  }
  const hit = new Set();
  for (const item of linePairs) {
    hit.add(item.from.position);
    hit.add(item.to.position);
  }
  for (const item of outside) hit.add(item.line.position);
  const hitPositions = [...hit].sort((a, b) => a - b);
  return Object.freeze({
    linePairs: Object.freeze(linePairs),
    outside: Object.freeze(outside),
    hitPositions: Object.freeze(hitPositions),
    hasAny: linePairs.length > 0 || outside.length > 0,
  });
}

/** 十二支的六冲配对，子午丑未寅申卯酉辰戌巳亥，两两互冲。 */
const SIX_CLASH_PAIRS = Object.freeze([
  ['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥'],
]);

/** 冲不到返回空串。 */
function branchClash6(branch) {
  for (const [x, y] of SIX_CLASH_PAIRS) {
    if (x === branch) return y;
    if (y === branch) return x;
  }
  return '';
}

/** 取内卦（初二三）或外卦（四五六）三爻的纳支，连成三字。 */
function trigramBranches(jingfang, inner) {
  return jingfang.lines.slice(inner ? 0 : 3, inner ? 3 : 6).map((line) => line.branch).join('');
}

/**
 * 反伏与卦变。反伏章第二十五把两者摆在一起说，但它们各自的条件对不上，
 * 所以这里分成两档报，不合成一条——理由见下面两段注。
 *
 * **一、反伏：内卦或外卦的纳支被整体换成与之逐位六冲的那一组。**
 *
 * 章里给的三例都对得上这一条：
 *   「外卦反伏而内卦不动者，如观之坤」→ 观→坤 动五、六，只有外纳支换了
 *   「内卦反伏而外卦不动者，如巽之观」→ 巽→观 动二、三，只有内纳支换了
 *   「爻变者内外爻动…如升之观是也」    → 升→观 动二、三、五、六，内外都换了
 * 三例换过去的那一组，无一例外都是本卦那一组的逐位六冲。六十四卦配六十三种
 * 非空动静扫下来，这一档落在 252 种上（内外都反 4、只内反 124、只外反 124）。
 *
 * **二、卦变：六爻全动，且本卦与变卦都是八纯卦。**
 *
 * 章里第一句「卦变者内外动而反伏者同一卦也。如乾卦变坤卦」举的乾变坤，
 * 纳支逐位**一个都不冲**（子对未、寅对巳、辰对卯），所以它不属于上面那一档。
 * 它属于的显然是「同一卦」那四个字：乾与坤都是八纯卦，两两相对
 * （乾坤、坎离、震巽、艮兑）。全动之后还能落到另一个八纯卦的只有这八组。
 * 扫描证实：这一档与反伏那一档**交集为零**，所以确实该分开报——
 * 合成一条的话，乾变坤要么被漏掉，要么得为了它把反伏的判据放宽到不再可核。
 *
 * @param {Jingfang} jingfang 本卦
 * @param {{ movingPositions: readonly number[] }} calendar
 * @param {Jingfang|null} changedJingfang 变卦；六爻皆静时为 null
 * @returns {{
 *   inner: boolean, outer: boolean, both: boolean, hasAny: boolean,
 *   guaChange: boolean, allSixMoving: boolean,
 *   innerFrom: string, innerTo: string, outerFrom: string, outerTo: string,
 *   kind: '内外' | '内卦' | '外卦' | '卦变' | '',
 * }}
 */
export function fanfuReading(jingfang, calendar, changedJingfang) {
  const moving = new Set(calendar.movingPositions);
  const allSixMoving = jingfang.lines.every((line) => moving.has(line.position));
  // 六爻皆静就没有变卦，没有变卦就没什么伏不伏的——这一支是「压根没得算」。
  // 注意别顺手把 allSixMoving 也当成闸门：反伏只要求内卦或外卦那一组换了，
  // 章里「內卦反伏而外卦不動」「外卦反伏而內卦不動」两句说的正是只动一侧。
  if (!changedJingfang) {
    return Object.freeze({
      inner: false, outer: false, both: false, hasAny: false,
      guaChange: false, allSixMoving,
      innerFrom: '', innerTo: '', outerFrom: '', outerTo: '',
      kind: '',
    });
  }
  const innerFrom = trigramBranches(jingfang, true);
  const innerTo = trigramBranches(changedJingfang, true);
  const outerFrom = trigramBranches(jingfang, false);
  const outerTo = trigramBranches(changedJingfang, false);
  const inner = innerFrom !== innerTo && innerTo === [...innerFrom].map(branchClash6).join('');
  const outer = outerFrom !== outerTo && outerTo === [...outerFrom].map(branchClash6).join('');
  // 卦变那一档：六爻全动，且本卦与变卦都是八纯卦——也就是两两相对的那四组
  // （乾坤、坎离、震巽、艮兑），书里「同一卦也」四个字指的就是这个。
  // 「全动」这一条不能省：乾只动初、四两爻也能变到巽为风，两头都是八纯卦，
  // 可那一爻没动全，谈不上章里说的「內外動」。八纯卦两两互补，全翻才换得到对宫。
  // 后面那半个条件是被前半个蕴含的——八纯卦两两互补，全翻必落到另一个八纯卦，
  // 所以只查本卦与只查两头结果一样。留着是为了把书上「同一卦」那句原样写出来。
  const guaChange = allSixMoving
    && jingfang.stage === '本宫' && changedJingfang.stage === '本宫';
  const both = inner && outer;
  return Object.freeze({
    inner, outer, both, guaChange, allSixMoving,
    innerFrom, innerTo, outerFrom, outerTo,
    hasAny: inner || outer || guaChange,
    kind: guaChange ? '卦变' : both ? '内外' : inner ? '内卦' : outer ? '外卦' : '',
  });
}

/** 纳甲六爻的配对位：内卦初二三与外卦四五六错开一位，隔三位相配。 */
const CLASH_PAIR_OFFSETS = Object.freeze([[1, 4], [2, 5], [3, 6]]);

/** 与之相合的那一支查不到时返回 -1。 */
function branchHarmony(branch) {
  for (const [x, y] of SIX_HARMONY) {
    if (x === branch) return y;
    if (y === branch) return x;
  }
  return -1;
}

/**
 * 爻之合：落在单爻上的那三法，与卦级的三法各管一段。
 *
 * 出处：《增删卜易》卷一·六合章第十九。该章分两层，先说「合从何来」有六法，
 * 再说「这一爻得叫什么」有四名：
 *
 *   「相合法有六：日月合爻者一也。爻与爻合者二也。爻动化合者三也。
 *     卦逢六合四也。六冲卦变六合卦五也。六合卦变六合卦六也。」
 *   「爻之合者，静而逢合，谓之合起；动而逢合，谓之合绊；
 *     爻与爻合谓之合好，爻动化合谓之化扶。」
 *
 * 后三法（卦逢六合、六冲变六合、六合变六合）是整卦的结构，由 hexagramClash 判。
 * 这里做的是前三法，逐爻落地，四名由这一爻的动静与合的来路定：
 *
 *   合起  静爻与日辰或月建相合 ——「爻静或与日月动爻合者，得合而起，
 *         即使爻值休囚亦有旺相之意」
 *   合绊  动爻与日辰或月建相合 ——「爻动或与日月动爻合者，谓之动逢合而绊住，
 *         反不能动之意」
 *   合好  两爻相合，且两爻皆动 ——「爻动与动爻相合，乃得他来合我，
 *         与我和好相助之意」
 *   化扶  动爻化出之爻回头与本爻相合 ——「爻动化出之爻回头相合者，谓之化扶，
 *         得他扶助之意」
 *
 * **合好那一条有一句明文限定，两爻皆动才算**：「但有一爻不动，亦不为合」。
 * 所以静爻与动爻相合本包不作合好——那一爻不动，恰恰是这一句排除掉的。
 * 六合章后文另有「爻静或与日月动爻合者」一句，标点两读：读作「与日月、动爻合者」
 * 则静爻也能与动爻成合，这与上句正面冲突。本包从可核的一读，
 * 冲突那一支不取，在此记明取舍而不是含糊过去。
 *
 * **合好不算卦逢六合那三对。** 初四、二五、三六那三对相合是整卦的六合结构，
 * 由 hexagramClash 判并画在卦体边上；这里两爻相合只取其余配对，免得一处事实
 * 在卦体与断语里各记一次账。
 *
 * **本函数不定吉凶。** 同章把话收得很紧：「然必用神有气相宜，用若失陷无益」，
 * 又说「用神受克，六合有何益哉」，末尾一句「宜合吉，不宜合凶」。合是关系不是判词，
 * 吉凶仍归用神旺衰，所以这里只报出关系与名目。
 *
 * @param {Jingfang} jingfang 本卦
 * @param {{ monthBranch: number, dayBranch: number, movingPositions: number[] }} calendar
 * @param {Jingfang} [changedJingfang] 变卦；没有动爻时可略
 * @returns {{
 *   rise: readonly object[], bind: readonly object[], friendly: readonly object[],
 *   support: readonly object[], hitPositions: readonly number[], hasAny: boolean,
 * }}
 */
export function heCombineReading(jingfang, calendar, changedJingfang) {
  const moving = new Set(calendar.movingPositions);
  // 日月同支时（寅月寅日之类）只算一路。六合是十二支上的两两配对，一支的合支唯一，
  // 日辰与月建既然是同一支，合上它的判据就是同一条，报两次是同一件事数了两遍。
  const calendars = calendar.dayBranch === calendar.monthBranch
    ? [{ name: '日辰', branchIndex: calendar.dayBranch }]
    : [
      { name: '日辰', branchIndex: calendar.dayBranch },
      { name: '月建', branchIndex: calendar.monthBranch },
    ];
  const rise = [];
  const bind = [];
  const friendly = [];
  const support = [];

  for (const line of jingfang.lines) {
    for (const source of calendars) {
      if (branchHarmony(line.branchIndex) !== source.branchIndex) continue;
      // 动静分两头：静爻得合而起，动爻得合而绊。名目不同，在此分派。
      (moving.has(line.position) ? bind : rise).push(Object.freeze({
        line,
        source: source.name,
        branch: BRANCH_ORDER[source.branchIndex],
      }));
    }
  }

  for (let a = 1; a <= 6; a += 1) {
    for (let b = a + 1; b <= 6; b += 1) {
      if (!moving.has(a) || !moving.has(b)) continue;
      const lineA = jingfang.lines[a - 1];
      const lineB = jingfang.lines[b - 1];
      if (branchHarmony(lineA.branchIndex) !== lineB.branchIndex) continue;
      // 初四、二五、三六那三对是整卦六合，不在这里再记一次。
      if (CLASH_PAIR_OFFSETS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue;
      friendly.push(Object.freeze({ lineA, lineB }));
    }
  }

  if (changedJingfang) {
    for (const position of calendar.movingPositions) {
      const line = jingfang.lines[position - 1];
      const changedLine = changedJingfang.lines[position - 1];
      if (branchHarmony(line.branchIndex) !== changedLine.branchIndex) continue;
      support.push(Object.freeze({ line, changedLine }));
    }
  }

  const hit = new Set();
  for (const item of rise) hit.add(item.line.position);
  for (const item of bind) hit.add(item.line.position);
  for (const item of friendly) {
    hit.add(item.lineA.position);
    hit.add(item.lineB.position);
  }
  for (const item of support) hit.add(item.line.position);
  const hitPositions = [...hit].sort((a, b) => a - b);
  return Object.freeze({
    rise: Object.freeze(rise),
    bind: Object.freeze(bind),
    friendly: Object.freeze(friendly),
    support: Object.freeze(support),
    hitPositions: Object.freeze(hitPositions),
    hasAny: rise.length > 0 || bind.length > 0 || friendly.length > 0 || support.length > 0,
  });
}

// 六冲卦十个、六合卦八个，是传世名单里人人能背下来的两组卦；数目或名单对不上就是装卦错了。
// 另有一处结构事实顺带钉住：三对里只要有一组相冲（相合），另两组必也相冲（相合）。所以六十四卦
// 只有三种样子——三对皆冲、三对皆合、三对皆不相干，没有「只撞一对」的。客户端那层冲合连线正是
// 照这条画的：要么画满三条，要么一条不画。
// 三条都在下面核，任一条不合就在这里抛，不留一个能算错的判定。
{
  const chongNames = [];
  const heNames = [];
  // 三对就是初四、二五、三六，这个数目是定义的一部分，不能从表里推：
  // 从表里推的话表里少配一组，数目跟着少一个，下面那两条「三对皆撞」就跟着松了。
  const pairCount = 3;
  for (const hexagram of HEXAGRAM_LIST) {
    const clash = hexagramClash(hexagram);
    if (clash.chong) chongNames.push(hexagram.name);
    if (clash.he) heNames.push(hexagram.name);
    const chongPairs = clash.pairs.filter((pair) => pair.kind === '冲').length;
    const hePairs = clash.pairs.filter((pair) => pair.kind === '合').length;
    if ((chongPairs > 0) !== clash.chong) {
      throw new Error(`六冲校验不过：${hexagram.name}只有${chongPairs}对冲，却判成非六冲——`
        + '「一组冲则三组皆冲」这条结构事实不成立，配对位或纳甲表有问题');
    }
    if ((hePairs > 0) !== clash.he) {
      throw new Error(`六合校验不过：${hexagram.name}只有${hePairs}对合，却判成非六合——`
        + '「一组合则三组皆合」这条结构事实不成立，配对位或六合表有问题');
    }
    // 上两条只钉住「有没有」，这里再钉住「是不是三对」：判成六冲六合的必须三对全撞。
    if (clash.chong && chongPairs !== pairCount) {
      throw new Error(`六冲校验不过：${hexagram.name}判成六冲，撞上的却只有${chongPairs}对，`
        + `不是三对全撞。配对位或纳甲表有问题，连线会画出半截的卦体`);
    }
    if (clash.he && hePairs !== pairCount) {
      throw new Error(`六合校验不过：${hexagram.name}判成六合，撞上的却只有${hePairs}对，`
        + `不是三对全撞。配对位或六合表有问题，连线会画出半截的卦体`);
    }
  }
  if (chongNames.length !== 10) {
    throw new Error(`六冲卦校验不过：传世名单十个（八纯卦加天雷无妄、雷天大壮），实算出${chongNames.length}个：${chongNames.join('、')}`);
  }
  if (heNames.length !== 8) {
    throw new Error(`六合卦校验不过：传世名单八个（泰否豫贲复困旅节），实算出${heNames.length}个：${heNames.join('、')}`);
  }
}

// 日辰所冲之支永不可能生被冲的那一爻。上面第三条取舍整个建立在这句上，所以在这里钉死。
for (let branch = 0; branch < 12; branch += 1) {
  const clashed = branchClash(branch);
  if (generatesTo(ELEMENT_BY_BRANCH[branch], ELEMENT_BY_BRANCH[clashed])) {
    throw new Error(`日辰生扶校验不过：日支${BRANCH_ORDER[branch]}能生${BRANCH_ORDER[clashed]}，`
      + '则被日辰冲的静爻还能得日辰生扶，「暗动不靠日辰生扶」这条取舍得重核');
  }
}

// 三刑章那六条与自刑四支，落在这六十四卦的纳甲上是什么样子，在这里钉死。
// 要钉的是三件能查的事：每一条都碰得出卦（碰不出的条目等于写错了字）、六条合起来碰出
// 三十七卦（数目错一条就露）、以及自刑里辰一支在六十四卦上一次都不出现。
{
  const SELF_TOTAL = 4;
  // 一、辰只装在内卦三爻（乾内子寅辰、坎内寅辰午、艮内辰午申），一卦只有一个下卦，
  //    所以一卦里最多一个辰，自刑辰在六十四卦上一次也碰不出来。底本没有这一条，
  //    是纳甲装出来的结构事实——写代码的人若以为自刑四支都能碰到，就得在这里撞一下。
  let selfChen = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    const branches = jingfang(hexagram).lines.map((line) => line.branch);
    const chen = branches.filter((branch) => branch === '辰').length;
    if (chen > 1) {
      throw new Error(`纳甲校验不过：${hexagram.name}里出现了${chen}个辰，`
        + '一卦只有一个下卦，辰只装在内卦三爻，碰不出两个——纳甲表有问题');
    }
  }
  for (const hexagram of HEXAGRAM_LIST) {
    const branches = jingfang(hexagram).lines.map((line) => line.branch);
    for (let a = 0; a < 6; a += 1) {
      for (let b = 0; b < 6; b += 1) {
        if (a === b) continue;
        if (branchSelfPunishes(branches[a], branches[b]) && branches[a] === '辰') selfChen += 1;
      }
    }
  }
  if (selfChen !== 0) {
    throw new Error(`自刑校验不过：辰自刑在六十四卦上碰出了${selfChen}次，`
      + '辰只装在内卦三爻，一卦最多一个，碰不出自刑辰——纳甲表或自刑四支有问题');
  }
  // 二、那六条每一条都得碰得出卦。碰不出就是写错了字，刑这一路会静悄悄少掉一条。
  const pairHits = new Map(PUNISH_PAIRS.map(([from, to]) => [`${from}刑${to}`, 0]));
  let hexWithPunish = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    const jf = jingfang(hexagram);
    let hit = false;
    for (let a = 1; a <= 6 && !hit; a += 1) {
      for (let b = 1; b <= 6; b += 1) {
        if (a === b) continue;
        const key = `${jf.lines[a - 1].branch}刑${jf.lines[b - 1].branch}`;
        if (!pairHits.has(key)) continue;
        pairHits.set(key, pairHits.get(key) + 1);
        hit = true;
      }
    }
    if (hit) hexWithPunish += 1;
  }
  for (const [key, count] of pairHits) {
    if (count === 0) {
      throw new Error(`三刑校验不过：${key}在六十四卦上一次也碰不出，`
        + '这一条多半是写错了字，刑这一路会静悄悄少掉一条');
    }
  }
  // 六条合起来碰出二十八卦。加上自刑那三支能碰着的（辰一支永远碰不着）才是三十七卦——
  // 两个数别混，早先就把这两个数记串过一次。
  if (hexWithPunish !== 28) {
    throw new Error(`三刑校验不过：底本那六条在六十四卦上碰出${hexWithPunish}卦，应为二十八卦——`
      + '改了刑的条目或纳甲表，这里立刻响');
  }
  // 三、刑有向这件事本身查不出来（表是有序二元组，judge 天然按序判），
  //    真正要防的是「顺手把底本那六条补成命理那八条」。所以直接数条目：底本是六条。
  if (PUNISH_PAIRS.length !== 6) {
    throw new Error(`三刑校验不过：底本那六条现在是${PUNISH_PAIRS.length}条。`
      + '命理那八条另存一处可以，别混进来——两套一起排，「有几爻犯刑」这句话就没意义了');
  }
  void SELF_TOTAL;
}


// 反伏与卦变那一层的地基。两档各自的事实都在这里钉死，改了判据立刻响，
// 免得日后有人把「反伏」放宽成「内外纳支换了就算」而不自知——那会把乾变坤
// 混进来，而它明明属于「同一卦」那一档。
{
  // 一、卦变那档：六爻全动之后还能落到八纯卦的，只有八组两两相对。
  let guaChange = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    const jingfangValue = jingfang(hexagram);
    const allSix = [1, 2, 3, 4, 5, 6];
    const changedKey = flip(hexagram.key, allSix);
    const changedHexagram = HEXAGRAMS_BY_KEY.get(changedKey);
    const hit = fanfuReading(jingfangValue, { movingPositions: allSix },
      jingfang(changedHexagram));
    if (!hit.allSixMoving) {
      throw new Error(`反伏校验不过：${hexagram.name}六爻全动却没认成全动`);
    }
    if (hit.guaChange) guaChange += 1;
  }
  if (guaChange !== 8) {
    throw new Error(`反伏校验不过：六爻全动能落到八纯卦的现在是${guaChange}组，应为八组`
      + '（乾坤、坎离、震巽、艮兑）。改了「本宫」的判法，这里立刻响');
  }

  // 二、反伏那档：六十四卦配六十三种非空动静共 4032 种，并集 252 种
  //    （内外都反 4、只内反 124、只外反 124）。数目不是从判据推的，是从卦表数出来的。
  //    inner / outer 按并集计（内外都反的那几种两头都算），所以各是 128 而不是 124；
  //    124 是互斥口径。两处报数对不上号最容易看糊涂，故在此写明。
  let inner = 0;
  let outer = 0;
  let both = 0;
  let union = 0;
  let overlapWithGuaChange = 0;
  for (const hexagram of HEXAGRAM_LIST) {
    const jingfangValue = jingfang(hexagram);
    for (let mask = 1; mask < 64; mask += 1) {
      const movingPositions = [];
      for (let i = 0; i < 6; i += 1) if (mask & (1 << i)) movingPositions.push(i + 1);
      const changedHexagram = HEXAGRAMS_BY_KEY.get(flip(hexagram.key, movingPositions));
      const hit = fanfuReading(jingfangValue, { movingPositions }, jingfang(changedHexagram));
      if (hit.inner) inner += 1;
      if (hit.outer) outer += 1;
      if (hit.both) both += 1;
      if (hit.hasAny) union += 1;
      if (hit.guaChange && (hit.inner || hit.outer)) overlapWithGuaChange += 1;
    }
  }
  if (inner !== 128 || outer !== 128 || both !== 4 || union !== 260) {
    throw new Error(`反伏校验不过：内反${inner}、外反${outer}、内外都反${both}、反伏或卦变共${union}种，`
      + '应为 128、128、4、260（252 反伏 + 8 卦变）。改了纳甲表或逐位六冲的判定，这里立刻响');
  }
  // 三、两档必须不相交。乾变坤不在逐位六冲那一档里——它换过去的那一组一支都不冲，
  //    靠的是「同一卦」。要是哪天把判据放宽到两者有交，这里会响。
  if (overlapWithGuaChange !== 0) {
    throw new Error(`反伏校验不过：卦变与反伏那一档出现了${overlapWithGuaChange}处重叠，`
      + '两档原本互不相交，重叠说明「反伏」的判据被放宽了');
  }
  // 四、六爻皆静时没有变卦，反伏与卦变都该是零——不是「算出来没有」，是压根没得算。
  const still = jingfang(HEXAGRAM_LIST[0]);
  const quiet = fanfuReading(still, { movingPositions: [] }, null);
  if (quiet.hasAny || quiet.kind !== '') {
    throw new Error('反伏校验不过：六爻皆静却报出了反伏或卦变');
  }
}


// 爻之合那一层的地基。六合是十二支上的两两配对，这个函数把「四名」的判定整个架在上面：
// 配对若不严格互斥，「与谁合」就有两个答案，同一爻会落进两路，卦体上的小标也要打架。
// 所以三件事在加载时钉死：表把十二支盖满、每一支的合支唯一、合是双向的。
{
  const seen = new Set();
  for (let branch = 0; branch < 12; branch += 1) {
    const partner = branchHarmony(branch);
    if (partner < 0) {
      throw new Error(`六合表校验不过：${BRANCH_ORDER[branch]}没有配到合支，表少了一组`);
    }
    if (seen.has(branch)) {
      throw new Error(`六合表校验不过：${BRANCH_ORDER[branch]}被配了两次，表里有重复`);
    }
    seen.add(branch);
    if (branchHarmony(partner) !== branch) {
      throw new Error(`六合表校验不过：${BRANCH_ORDER[branch]}与${BRANCH_ORDER[partner]}相合，`
        + `但${BRANCH_ORDER[partner]}的合支不是${BRANCH_ORDER[branch]}——合必须双向`);
    }
  }
  // 配对既已互斥且双向，一个日辰支与一个月建支若不同支，不会有哪一支同时合于两者——
  // 否则同一爻会同时落进日辰那一路和月建那一路，断语里就成了同一件事说两遍。
  for (let day = 0; day < 12; day += 1) {
    for (let month = 0; month < 12; month += 1) {
      if (day === month) continue;
      for (let branch = 0; branch < 12; branch += 1) {
        if (branchHarmony(day) === branch && branchHarmony(month) === branch) {
          throw new Error(`六合表校验不过：${BRANCH_ORDER[branch]}同时合于日支${BRANCH_ORDER[day]}`
            + `与月支${BRANCH_ORDER[month]}，则「与谁合」有两个答案，四名里该落哪一路就定了`);
        }
      }
    }
  }
  // 四路各自的成立条件，逐条对着结果核。这一段扫的是全部六十四卦配十二日辰配十二种动静，
  // 只核「有没有」没有意义——四路里有三路本来就跟日辰无关——所以核的是每一路凭什么算数。
  for (const hexagram of HEXAGRAM_LIST) {
    const jf = jingfang(hexagram);
    for (let day = 0; day < 12; day += 1) {
      for (let month = 0; month < 12; month += 1) {
        for (let mask = 0; mask < 64; mask += 1) {
          const moving = [];
          for (let position = 1; position <= 6; position += 1) {
            if (mask & (1 << (position - 1))) moving.push(position);
          }
          const got = heCombineReading(jf, { monthBranch: month, dayBranch: day, movingPositions: moving });
          const isMoving = (position) => moving.includes(position);
          // 合起：静爻，且与日辰或月建那一支相合
          for (const item of got.rise) {
            if (isMoving(item.line.position)) {
              throw new Error(`逢合校验不过：${hexagram.name}的${item.line.label}是动爻，却落进合起`
                + '——合起只管静爻，动爻逢日月那一路叫合绊');
            }
            const partner = branchHarmony(item.line.branchIndex);
            if (partner !== day && partner !== month) {
              throw new Error(`逢合校验不过：${hexagram.name}的${item.line.label}报了合起，`
                + `却既不合日支${BRANCH_ORDER[day]}也不合月支${BRANCH_ORDER[month]}`);
            }
          }
          // 合绊：动爻，且与日辰或月建那一支相合
          for (const item of got.bind) {
            if (!isMoving(item.line.position)) {
              throw new Error(`逢合校验不过：${hexagram.name}的${item.line.label}是静爻，却落进合绊`
                + '——合绊只管动爻，静爻逢日月那一路叫合起');
            }
            const partner = branchHarmony(item.line.branchIndex);
            if (partner !== day && partner !== month) {
              throw new Error(`逢合校验不过：${hexagram.name}的${item.line.label}报了合绊，`
                + `却既不合日支${BRANCH_ORDER[day]}也不合月支${BRANCH_ORDER[month]}`);
            }
          }
          // 合好：两支相合，且两爻皆动，且不撞整卦六合那三对
          for (const item of got.friendly) {
            if (!isMoving(item.lineA.position) || !isMoving(item.lineB.position)) {
              throw new Error(`逢合校验不过：${hexagram.name}的${item.lineA.label}与${item.lineB.label}报了合好，`
                + '其中有静爻——「但有一爻不动，亦不为合」');
            }
            if (branchHarmony(item.lineA.branchIndex) !== item.lineB.branchIndex) {
              throw new Error(`逢合校验不过：${hexagram.name}的${item.lineA.label}与${item.lineB.label}报了合好，`
                + '两支却并不相合');
            }
            if (CLASH_PAIR_OFFSETS.some(([x, y]) => (x === item.lineA.position && y === item.lineB.position)
              || (x === item.lineB.position && y === item.lineA.position))) {
              throw new Error(`逢合校验不过：${hexagram.name}的${item.lineA.label}与${item.lineB.label}是`
                + '初四二五三六那一对，报了合好——那一对属整卦六合，不在这里再记一次');
            }
          }
          // 化扶：本爻在动，且化出之爻回头与本爻相合
          for (const item of got.support) {
            if (!isMoving(item.line.position)) {
              throw new Error(`逢合校验不过：${hexagram.name}的${item.line.label}报了化扶，本爻却不是动爻`);
            }
            if (branchHarmony(item.line.branchIndex) !== item.changedLine.branchIndex) {
              throw new Error(`逢合校验不过：${hexagram.name}的${item.line.label}报了化扶，`
                + `变出的${item.changedLine.branch}却与本爻${item.line.branch}不相合`);
            }
          }
          // 逢合爻位就是四路合起来的那几处，不多不少
          const union = new Set();
          for (const item of got.rise) union.add(item.line.position);
          for (const item of got.bind) union.add(item.line.position);
          for (const item of got.friendly) {
            union.add(item.lineA.position);
            union.add(item.lineB.position);
          }
          for (const item of got.support) union.add(item.line.position);
          if (union.size !== got.hitPositions.length
            || [...union].some((position) => !got.hitPositions.includes(position))) {
            throw new Error(`逢合校验不过：${hexagram.name}（日支${BRANCH_ORDER[day]}、月支${BRANCH_ORDER[month]}、`
              + `动爻${moving.join(',') || '无'}）卦体上标的逢合爻与四路实际报出的对不上`);
          }
          if (got.hasAny !== got.hitPositions.length > 0) {
            throw new Error(`逢合校验不过：${hexagram.name}的 hasAny 与实际命中的爻位对不上`);
          }
        }
      }
    }
  }
}

/**
 * 旺衰逐月表，直接抄《增删卜易·四时旺相章》，拿来给 vitality 钉桩。
 *
 * 八个月建各配一句原话：
 *   「正月、二月木为旺，火为相，其余金、水、土俱为休囚」
 *   「四月、五月火旺土相，其余俱作休囚」
 *   「七月、八月金旺生水，水为相，其余俱作休囚」
 *   「十月、十一月水生木，木为相，其余俱作休囚」
 *
 * 只钉这八个月。辰戌丑未四个月建不在表内：同章对四季另有一条加减，冲着月建的那支
 * 按休囚论、另支尚有余气不作休囚，四支不再一视同仁。照那条办要补一档没有原话可依的
 * 细分，本包未做（见 vitality 注释），所以这四个月建不进校验，免得拿一张不完整的表
 * 去核一个更宽的算法。
 */
const FOUR_SEASONS_TONE = [
  { branch: 2, 木: '旺', 火: '相', 土: '死', 金: '囚', 水: '休' },
  { branch: 3, 木: '旺', 火: '相', 土: '死', 金: '囚', 水: '休' },
  { branch: 5, 木: '休', 火: '旺', 土: '相', 金: '死', 水: '囚' },
  { branch: 6, 木: '休', 火: '旺', 土: '相', 金: '死', 水: '囚' },
  { branch: 8, 木: '死', 火: '囚', 土: '休', 金: '旺', 水: '相' },
  { branch: 9, 木: '死', 火: '囚', 土: '休', 金: '旺', 水: '相' },
  { branch: 11, 木: '相', 火: '死', 土: '囚', 金: '休', 水: '旺' },
  { branch: 0, 木: '相', 火: '死', 土: '囚', 金: '休', 水: '旺' },
];
for (const row of FOUR_SEASONS_TONE) {
  for (const element of ELEMENTS) {
    const got = vitality(element, ELEMENT_BY_BRANCH[row.branch]).key;
    if (got !== row[element]) {
      throw new Error(`旺衰校验不过：《四时旺相章》${BRANCH_ORDER[row.branch]}月${element}爻作${row[element]}，`
        + `实算出${got}。囚与死最易掉个个儿——令克者死、克令者囚，念反了就会错掉这两档`);
    }
  }
}

