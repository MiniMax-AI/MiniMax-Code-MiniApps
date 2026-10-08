// @ts-check

/**
 * 十二辟卦（又作十二月卦、十二消息卦）。
 *
 * 传统以十二卦配十二月，令卦与月建直接挂钩：复主子月、临主丑月，直到坤主亥月。
 * 这与本包已有的「月建五行旺相休囚死」是两条不同的路——那条看的是五行在月令中的
 * 强弱，这条看的是卦象本身随节气消长，因此不重复，也不互相替代。
 *
 * 「息」与「消」是这一学说全部的关键：阳爻去而阴爻来为消，阴爻去而阳爻来为息。
 * 从子月复卦到巳月乾卦，阳爻自初爻逐次上升，是为息卦（生长）；从午月姤卦到亥月
 * 坤卦，阴爻自初爻逐次上升，是为消卦（消退）。因此十二卦全部取「同性爻在下、
 * 异性爻在上」的规整形状，且集中在乾坤二宫。
 *
 * 本文件不载经文——《彖传》《大象传》原句都在 tuan.mjs 与 hexagrams.mjs 里，
 * 这里只保留「哪个月主哪一卦」这条传统对应关系，以及它的消长含义。
 */

/**
 * 一位是地支在 BRANCHES 里的下标，与 almanac.mjs 的月支一致。
 * key 是该卦的六位阴阳串，1 阳 0 阴，自下而上——十二辟卦的爻象是固定的，
 * 直接按爻象查表，不必由形状反推（试过按「转换点唯一」推，会把屯、师、谦等
 * 下卦两爻为阳、上卦参杂的卦一并算进去，错了五十七处）。
 * phase 是这一月的消长阶段，yangCount 是当月纯阳的爻数。
 * @type {readonly (readonly [number, string, string, '息' | '消', number, string, string])[]}
 */
const MONTH_ORDER = [
  [0, '复', '地雷复', '息', 1, '100000', '一阳来复。冬至之后阳气初生，阳爻生于初爻，故曰复。'],
  [1, '临', '地泽临', '息', 2, '110000', '二阳息阴。阳气续长而及于二爻，冬去春临，故曰临。'],
  [2, '泰', '地天泰', '息', 3, '111000', '三阳息阴。天地气交，上下相通，三阳开泰，故曰泰。'],
  [3, '大壮', '雷天大壮', '息', 4, '111100', '四阳息阴。阳气已过半春，雷动于天，故曰大壮。'],
  [4, '夬', '泽天夬', '息', 5, '111110', '五阳息阴。阴气仅余上爻，阳盛而阴决，故曰夬。'],
  [5, '乾', '乾为天', '息', 6, '111111', '六阳息阴。纯阳之卦，阳气至此而极，故曰乾。'],
  [6, '姤', '天风姤', '消', 1, '011111', '一阴消阳。夏至之后阴气始生于初爻，阳极而阴将起，故曰姤。'],
  [7, '遁', '天山遁', '消', 2, '001111', '二阴消阳。阴气渐长，阳气退避，故曰遁。'],
  [8, '否', '天地否', '消', 3, '000111', '三阴消阳。天地不交，上下不通，故曰否。'],
  [9, '观', '风地观', '消', 4, '000011', '四阴消阳。风行地上，观乎天文以察时变，故曰观。'],
  [10, '剥', '山地剥', '消', 5, '000001', '五阴消阳。阴气剥尽在下之阳，万物至此而剥，故曰剥。'],
  [11, '坤', '坤为地', '消', 6, '000000', '六阴消阳。纯阴之卦，阴气至此而极，一阳将复，故曰坤。'],
];

/** @type {Map<number, {branch: number, short: string, name: string, phase: '息'|'消', yangCount: number, meaning: string, key: string}>} */
const BY_BRANCH = new Map(
  MONTH_ORDER.map(([branch, short, name, phase, yangCount, key, meaning]) => [
    branch,
    { branch, short, name, phase, yangCount, key, meaning },
  ]),
);

/** @type {Map<string, ReturnType<typeof toEntry>>} */
const BY_KEY = new Map(MONTH_ORDER.map(([, , , , , key]) => [key, toEntry(key)]));

/**
 * 本月的卦气主卦。
 *
 * @param {number} branch 月支下标，与 almanac.mjs 的 BRANCHES 同序
 * @returns {{branch: number, short: string, name: string, phase: '息'|'消', yangCount: number, meaning: string, key: string} | null}
 */
export function monthQi(branch) {
  return BY_BRANCH.get(branch) ?? null;
}

/**
 * 本卦在十二消息中的位置。
 *
 * 十二辟卦并非另一套吉凶判断，而是给本卦一个「当下走到哪一步」的坐标：本卦若落在
 * 息卦那一段，说明它正合于阳气生长的时势；若落在消卦那一段，则正当阴长阳退。
 * 落在哪一卦，则看它的阴爻位置——消息卦的形状由初爻起算的纯阳爻数决定。
 *
 * 不在十二辟卦之列的卦（它们分属八宫其余）不硬套，只说明它不是当令之主。
 *
 * @param {string} key 六位阴阳串
 * @returns {{name: string, short: string, phase: '息'|'消', yangCount: number, meaning: string, yang: boolean} | null}
 */
export function hexagramQi(key) {
  const entry = BY_KEY.get(key);
  if (!entry) return null;
  return {
    name: entry.name,
    short: entry.short,
    phase: entry.phase,
    yangCount: entry.yangCount,
    meaning: entry.meaning,
    yang: entry.phase === '息',
  };
}

/** @param {string} key */
function toEntry(key) {
  const [branch, short, name, phase, yangCount, , meaning] = MONTH_ORDER.find((row) => row[5] === key);
  return { branch, short, name, phase, yangCount, key, meaning };
}

/** 十二辟卦全表，供卦库与说明文字取用。 */
export const TWELVE_MESSAGES = Object.freeze([...BY_BRANCH.values()]);
