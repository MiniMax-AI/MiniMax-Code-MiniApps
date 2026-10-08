// @ts-check

/**
 * 八卦与六十四卦。
 *
 * 卦的爻象一律由「上卦 + 下卦」推导，不手写爻字符串：少抄一次就少错一次。
 * 本文件只保留三项必须人工录入的经典文本：卦名、卦辞、象辞。彖传与逐爻爻辞、
 * 小象传分别在 tuan.mjs、yao.mjs、xiang-chuan.mjs 里，理由见各自的说明。
 */

import { tuanText } from './tuan.mjs';

/**
 * 三爻，自下而上，1 为阳、0 为阴。
 *
 * direction 是后天八卦方位，categories 是万物类象。两者都是断卦取象的依据：
 * 问方位看 direction，问人事物类看 categories。
 */
const TRIGRAM = {
  qian: {
    key: 'qian', name: '乾', symbol: '☰', lines: '111', element: '金', nature: '健', image: '天', early: 1, animal: '马',
    direction: '西北', family: '父', categories: ['天', '君上', '首领', '父', '金玉', '马', '西北', '刚健', '决断', '公门'],
  },
  dui: {
    key: 'dui', name: '兑', symbol: '☱', lines: '110', element: '金', nature: '悦', image: '泽', early: 2, animal: '羊',
    direction: '正西', family: '少女', categories: ['泽', '口舌', '言语', '饮食', '毁折', '少女', '正西', '喜悦', '巫祝'],
  },
  li: {
    key: 'li', name: '离', symbol: '☲', lines: '101', element: '火', nature: '丽', image: '火', early: 3, animal: '雉',
    direction: '正南', family: '中女', categories: ['火', '日', '明', '文采', '声名', '财货', '中女', '正南', '丽泽', '礼乐'],
  },
  zhen: {
    key: 'zhen', name: '震', symbol: '☳', lines: '100', element: '木', nature: '动', image: '雷', early: 4, animal: '龙',
    direction: '正东', family: '长男', categories: ['雷', '震动', '长子', '车马', '惊扰', '正东', '雷声', '奋发', '足'],
  },
  xun: {
    key: 'xun', name: '巽', symbol: '☴', lines: '011', element: '木', nature: '入', image: '风', early: 5, animal: '鸡',
    direction: '东南', family: '长女', categories: ['风', '长女', '柔顺', '入', '往来', '东南', '虫', '气味', '股'],
  },
  kan: {
    key: 'kan', name: '坎', symbol: '☵', lines: '010', element: '水', nature: '陷', image: '水', early: 6, animal: '豕',
    direction: '正北', family: '中男', categories: ['水', '险陷', '智慧', '暗昧', '盗贼', '劳苦', '正北', '沟渎', '耳'],
  },
  gen: {
    key: 'gen', name: '艮', symbol: '☶', lines: '001', element: '土', nature: '止', image: '山', early: 7, animal: '狗',
    direction: '东北', family: '少男', categories: ['山', '静止', '少男', '门阙', '墙垣', '东北', '医药', '手足', '狗'],
  },
  kun: {
    key: 'kun', name: '坤', symbol: '☷', lines: '000', element: '土', nature: '顺', image: '地', early: 8, animal: '牛',
    direction: '西南', family: '母', categories: ['地', '母', '众', '田土', '房产', '布帛', '西南', '柔顺', '腹', '牛'],
  },
};

/** @typedef {typeof TRIGRAM[keyof typeof TRIGRAM]} Trigram */

/** @type {Record<string, Trigram>} */
export const TRIGRAMS = TRIGRAM;

/** 先天八卦数，梅花易数起卦取模 8 用。 */
export const EARLY_NUMBERS = Object.freeze({
  qian: 1,
  dui: 2,
  li: 3,
  zhen: 4,
  xun: 5,
  kan: 6,
  gen: 7,
  kun: 8,
});

/**
 * 六十四卦，通行本次序。卦名书写惯例是「上卦 + 下卦」，例如「水雷屯」为坎上震下。
 * 每行：[上卦, 下卦, 卦名, 卦辞, 象辞]
 * @type {readonly (readonly [string, string, string, string, string])[]}
 */
const HEXAGRAMS = [
  ['qian', 'qian', '乾为天', '元亨利贞。', '天行健，君子以自强不息。'],
  ['kun', 'kun', '坤为地', '元亨，利牝马之贞。君子有攸往，先迷后得主，利。西南得朋，东北丧朋。安贞，吉。', '地势坤，君子以厚德载物。'],
  ['kan', 'zhen', '水雷屯', '元亨利贞。勿用有攸往，利建侯。', '云雷屯，君子以经纶。'],
  ['gen', 'kan', '山水蒙', '亨。匪我求童蒙，童蒙求我。初筮告，再三渎，渎则不告。利贞。', '山下出泉，蒙；君子以果行育德。'],
  ['kan', 'qian', '水天需', '有孚，光亨，贞吉。利涉大川。', '云上于天，需；君子以饮食宴乐。'],
  ['qian', 'kan', '天水讼', '有孚窒惕，中吉终凶。利见大人，不利涉大川。', '天与水违行，讼；君子以作事谋始。'],
  ['kun', 'kan', '地水师', '贞，丈人吉，无咎。', '地中有水，师；君子以容民畜众。'],
  ['kan', 'kun', '水地比', '吉。原筮，元永贞，无咎。不宁方来，后夫凶。', '地上有水，比；先王以建万国，亲诸侯。'],
  ['xun', 'qian', '风天小畜', '亨。密云不雨，自我西郊。', '风行天上，小畜；君子以懿文德。'],
  ['qian', 'dui', '天泽履', '履虎尾，不咥人，亨。', '上天下泽，履；君子以辨上下，定民志。'],
  ['kun', 'qian', '地天泰', '小往大来，吉亨。', '天地交，泰；后以财成天地之道，辅相天地之宜，以左右民。'],
  ['qian', 'kun', '天地否', '否之匪人，不利君子贞，大往小来。', '天地不交，否；君子以俭德辟难，不可荣以禄。'],
  ['qian', 'li', '天火同人', '同人于野，亨。利涉大川，利君子贞。', '天与火，同人；君子以类族辨物。'],
  ['li', 'qian', '火天大有', '元亨。', '火在天上，大有；君子以遏恶扬善，顺天休命。'],
  ['kun', 'gen', '地山谦', '亨，君子有终。', '地中有山，谦；君子以裒多益寡，称物平施。'],
  ['zhen', 'kun', '雷地豫', '利建侯行师。', '雷出地奋，豫；先王以作乐崇德，殷荐之上帝，以配祖考。'],
  ['dui', 'zhen', '泽雷随', '元亨利贞，无咎。', '泽中有雷，随；君子以向晦入宴息。'],
  ['gen', 'xun', '山风蛊', '元亨，利涉大川。先甲三日，后甲三日。', '山下有风，蛊；君子以振民育德。'],
  ['kun', 'dui', '地泽临', '元亨，利贞。至于八月有凶。', '泽上有地，临；君子以教思无穷，容保民无疆。'],
  ['xun', 'kun', '风地观', '盥而不荐，有孚顒若。', '风行地上，观；先王以省方观民设教。'],
  ['li', 'zhen', '火雷噬嗑', '亨。利用狱。', '雷电，噬嗑；先王以明罚敕法。'],
  ['gen', 'li', '山火贲', '亨。小利有攸往。', '山下有火，贲；君子以明庶政，无敢折狱。'],
  ['gen', 'kun', '山地剥', '不利有攸往。', '山附于地，剥；上以厚下安宅。'],
  ['kun', 'zhen', '地雷复', '亨。出入无疾，朋来无咎。反复其道，七日来复，利有攸往。', '雷在地中，复；先王以至日闭关，商旅不行，后不省方。'],
  ['qian', 'zhen', '天雷无妄', '元亨利贞。其匪正有眚，不利有攸往。', '天下雷行，物与无妄；先王以茂对时育万物。'],
  ['gen', 'qian', '山天大畜', '利贞，不家食吉，利涉大川。', '天在山中，大畜；君子以多识前言往行，以蓄其德。'],
  ['gen', 'zhen', '山雷颐', '贞吉。观颐，自求口实。', '山下有雷，颐；君子以慎言语，节饮食。'],
  ['dui', 'xun', '泽风大过', '栋桡，利有攸往，亨。', '泽灭木，大过；君子以独立不惧，遁世无闷。'],
  ['kan', 'kan', '坎为水', '习坎，有孚，维心亨，行有尚。', '水洊至，习坎；君子以常德行，习教事。'],
  ['li', 'li', '离为火', '利贞，亨。畜牝牛，吉。', '明两作，离；大人以继明照于四方。'],
  ['dui', 'gen', '泽山咸', '亨，利贞，取女吉。', '山上有泽，咸；君子以虚受人。'],
  ['zhen', 'xun', '雷风恒', '亨，无咎，利贞，利有攸往。', '雷风，恒；君子以立不易方。'],
  ['qian', 'gen', '天山遁', '亨，小利贞。', '天下有山，遁；君子以远小人，不恶而严。'],
  ['zhen', 'qian', '雷天大壮', '利贞。', '雷在天上，大壮；君子以非礼弗履。'],
  ['li', 'kun', '火地晋', '康侯用锡马蕃庶，昼日三接。', '明出地上，晋；君子以自昭明德。'],
  ['kun', 'li', '地火明夷', '明入地中，明夷。内文明而外柔顺，以蒙大难，文王用之。', '明入地中，明夷；君子以莅众，用晦而明。'],
  ['xun', 'li', '风火家人', '利女贞。', '风自火出，家人；君子以言有物而行有恒。'],
  ['li', 'dui', '火泽睽', '小事吉。', '上火下泽，睽；君子以同而异。'],
  ['kan', 'gen', '水山蹇', '利西南，不利东北。利见大人，贞吉。', '山上有水，蹇；君子以反身修德。'],
  ['zhen', 'kan', '雷水解', '利西南。无所往，其来复吉。有攸往，夙吉。', '雷雨作，解；君子以赦过宥罪。'],
  ['gen', 'dui', '山泽损', '有孚，元吉，无咎，可贞，利有攸往。', '山下有泽，损；君子以惩忿窒欲。'],
  ['xun', 'zhen', '风雷益', '利有攸往，利涉大川。', '风雷，益；君子以见善则迁，有过则改。'],
  ['dui', 'qian', '泽天夬', '扬于王庭，孚号有厉。告自邑，不利即戎，利有攸往。', '泽上于天，夬；君子以施禄及下，居德则忌。'],
  ['qian', 'xun', '天风姤', '女壮，勿用取女。', '天下有风，姤；后以施命诰四方。'],
  ['dui', 'kun', '泽地萃', '亨。王假有庙，利见大人，亨，利贞。用大牲吉，利有攸往。', '泽上于地，萃；君子以除戎器，戒不虞。'],
  ['kun', 'xun', '地风升', '元亨。用见大人，勿恤，南征吉。', '地中生木，升；君子以顺德，积小以高大。'],
  ['dui', 'kan', '泽水困', '亨，贞，大人吉，无咎，有言不信。', '泽无水，困；君子以致命遂志。'],
  ['kan', 'xun', '水风井', '改邑不改井，无丧无得。往来井井。', '木上有水，井；君子以劳民劝相。'],
  ['dui', 'li', '泽火革', '巳日乃孚，元亨利贞，悔亡。', '泽中有火，革；君子以治历明时。'],
  ['li', 'xun', '火风鼎', '元吉，亨。', '木上有火，鼎；君子以正位凝命。'],
  ['zhen', 'zhen', '震为雷', '亨。震来虩虩，笑言哑哑。震惊百里，不丧匕鬯。', '洊雷，震；君子以恐惧修省。'],
  ['gen', 'gen', '艮为山', '艮其背，不获其身；行其庭，不见其人，无咎。', '兼山，艮；君子以思不出其位。'],
  ['xun', 'gen', '风山渐', '女归吉，利贞。', '山上有木，渐；君子以居贤德善俗。'],
  ['zhen', 'dui', '雷泽归妹', '征凶，无攸利。', '泽上有雷，归妹；君子以永终知敝。'],
  ['zhen', 'li', '雷火丰', '亨，王假之，勿忧，宜日中。', '雷电皆至，丰；君子以折狱致刑。'],
  ['li', 'gen', '火山旅', '小亨，旅贞吉。', '山上有火，旅；君子以明慎用刑而不留狱。'],
  ['xun', 'xun', '巽为风', '小亨。利有攸往，利见大人。', '随风，巽；君子以申命行事。'],
  ['dui', 'dui', '兑为泽', '亨，利贞。', '丽泽，兑；君子以朋友讲习。'],
  ['xun', 'kan', '风水涣', '亨。王假有庙，利涉大川。', '风行水上，涣；先王以享于帝立庙。'],
  ['kan', 'dui', '水泽节', '亨。苦节不可贞。', '泽上有水，节；君子以制数度，议德行。'],
  ['xun', 'dui', '风泽中孚', '豚鱼吉，利涉大川，利贞。', '泽上有风，中孚；君子以议狱缓死。'],
  ['zhen', 'gen', '雷山小过', '亨，利贞，可小事，不可大事。飞鸟遗之音，不宜上宜下，大吉。', '山上有雷，小过；君子以行过乎恭，丧过乎哀，用过乎俭。'],
  ['kan', 'li', '水火既济', '亨小，利贞。初吉终乱。', '水在火上，既济；君子以思患而豫防之。'],
  ['li', 'kan', '火水未济', '亨。小狐汔济，濡其尾，无攸利。', '火在水上，未济；君子以慎辨物居方。'],
];

/**
 * @typedef {object} Hexagram
 * @property {number} index          0 起的通行本序号（+1 为卦序）
 * @property {number} order          卦序，1 至 64
 * @property {string} key            六位爻象串，下爻在前
 * @property {string} name           卦名
 * @property {string} upper          上卦 key
 * @property {string} lower          下卦 key
 * @property {Trigram} upperTrigram
 * @property {Trigram} lowerTrigram
 * @property {string} judgment       卦辞
 * @property {string} image          象辞（大象传）
 * @property {string} tuan           彖传
 */

/** @type {readonly Hexagram[]} */
export const HEXAGRAM_LIST = Object.freeze(
  HEXAGRAMS.map(([upper, lower, name, judgment, image], index) => {
    const lowerTrigram = TRIGRAM[lower];
    const upperTrigram = TRIGRAM[upper];
    if (!lowerTrigram || !upperTrigram) throw new Error(`unknown trigram in ${name}`);
    return Object.freeze({
      index,
      order: index + 1,
      key: lowerTrigram.lines + upperTrigram.lines,
      name,
      upper,
      lower,
      upperTrigram,
      lowerTrigram,
      judgment,
      image,
      tuan: tuanText(index + 1),
    });
  }),
);

/** 爻象串 → 卦，梅花易数算完卦象后查表用。 */
const BY_KEY = new Map(HEXAGRAM_LIST.map((hexagram) => [hexagram.key, hexagram]));

/**
 * @param {string} key 六位爻象串
 * @returns {Hexagram}
 */
export function hexagramByKey(key) {
  const hexagram = BY_KEY.get(key);
  if (!hexagram) throw new Error(`no hexagram for lines ${key}`);
  return hexagram;
}

/**
 * @param {number} order 卦序 1 至 64
 * @returns {Hexagram}
 */
export function hexagramByOrder(order) {
  const hexagram = HEXAGRAM_LIST[order - 1];
  if (!hexagram) throw new Error(`no hexagram for order ${order}`);
  return hexagram;
}

/**
 * 由上下卦直接取卦，梅花易数取模起卦时用。
 * @param {number} upperNumber 上卦先天数 1 至 8
 * @param {number} lowerNumber 下卦先天数 1 至 8
 * @returns {Hexagram}
 */
export function hexagramByNumbers(upperNumber, lowerNumber) {
  const upper = TRIGRAM[earlyKey(normalizeToEight(upperNumber))];
  const lower = TRIGRAM[earlyKey(normalizeToEight(lowerNumber))];
  return hexagramByKey(lower.lines + upper.lines);
}

/** @param {number} value @returns {number} 归一到 1 至 8 */
export function normalizeToEight(value) {
  const wrapped = ((value - 1) % 8 + 8) % 8;
  return wrapped + 1;
}

/** @param {number} value @returns {number} 归一到 1 至 6 */
export function normalizeToSix(value) {
  const wrapped = ((value - 1) % 6 + 6) % 6;
  return wrapped + 1;
}

/** @param {number} earlyNumber 先天数 1 至 8 @returns {string} */
export function earlyKey(earlyNumber) {
  const key = Object.keys(EARLY_NUMBERS).find((item) => EARLY_NUMBERS[item] === earlyNumber);
  if (!key) throw new Error(`no trigram for early number ${earlyNumber}`);
  return key;
}

/** 互卦：二三四爻为下卦，三四五爻为上卦。 */
/** @param {Hexagram} hexagram @returns {Hexagram} */
export function mutualHexagram(hexagram) {
  const lines = hexagram.key.split('');
  const lower = [lines[1], lines[2], lines[3]].join('');
  const upper = [lines[2], lines[3], lines[4]].join('');
  return hexagramByKey(lower + upper);
}

/** 错卦：六爻阴阳互错。 */
/** @param {Hexagram} hexagram @returns {Hexagram} */
export function oppositeHexagram(hexagram) {
  return hexagramByKey([...hexagram.key].map((line) => (line === '1' ? '0' : '1')).join(''));
}

/** 综卦：上下颠倒。 */
/** @param {Hexagram} hexagram @returns {Hexagram} */
export function invertedHexagram(hexagram) {
  return hexagramByKey([...hexagram.key].reverse().join(''));
}

/** 卦符：自下而上排布，可直接渲染。 */
/** @param {string} key @returns {string} */
export function hexagramSymbol(key) {
  return [...key].reverse().map((line) => (line === '1' ? '⚊' : '⚋')).join('');
}
