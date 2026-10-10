// @ts-check

/**
 * 干支历法与时辰吉凶。
 *
 * 干支纪日用儒略日公式推算，与传世万年历一致；月支以二十四节为准（节气日期为常年近似值，
 * 可能有一日之差），不引入农历年历表，因此本模块不声称能换算农历初一。
 */

export const STEMS = Object.freeze(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']);
export const BRANCHES = Object.freeze(['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']);
export const ZODIAC = Object.freeze(['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']);

export const ELEMENTS = Object.freeze(['木', '火', '土', '金', '水']);

/** 天干五行。 */
export const STEM_ELEMENTS = Object.freeze(['木', '木', '火', '火', '土', '土', '金', '金', '水', '水']);
/** 地支五行。 */
export const BRANCH_ELEMENTS = Object.freeze(['水', '土', '木', '木', '土', '火', '火', '土', '金', '金', '土', '水']);

/** 地支三合局。 */
export const TRIPLE_HARMONY = Object.freeze([
  { branches: [8, 0, 4], element: '水', name: '申子辰' },
  { branches: [11, 3, 7], element: '木', name: '亥卯未' },
  { branches: [2, 6, 10], element: '火', name: '寅午戌' },
  { branches: [5, 9, 1], element: '金', name: '巳酉丑' },
]);

/** 地支六合。 */
export const SIX_HARMONY = Object.freeze([
  [0, 1], [2, 11], [3, 10], [4, 9], [5, 8], [6, 7],
]);

/**
 * 六冲：子午、丑未、寅申、卯酉、辰戌、巳亥。
 * 十二支排成圈便隔六位相冲，不必另立表，索引加六取模十二即是。
 * @param {number} branch 地支索引 0–11
 * @returns {number} 与之相冲的地支索引
 */
export function branchClash(branch) {
  return (branch + 6) % 12;
}

/**
 * 旬空歌诀，《增删卜易·旬空章第二十六》原文，六句。
 * 存成数据是为了让测试能逐字对着底本校，不是拿它去查——xunKong 是按序号算的，
 * 歌诀只是它的对校；两者对不上就是其中之一错了。
 */
export const XUNKONG_SONG = Object.freeze([
  '甲子旬中戌亥空', '甲戌旬中申酉空', '甲申旬中午未空',
  '甲午旬中辰巳空', '甲辰旬中寅卯空', '甲寅旬中子丑空',
]);

/**
 * 旬空（空亡）。《增删卜易·旬空章第二十六》：
 *   「甲子旬中戌亥空，甲戌旬中申酉空，甲申旬中午未空，
 *     甲午旬中辰巳空，甲辰旬中寅卯空，甲寅旬中子丑空。」
 * 天干十位配十二支，一旬十日总有两支配不上天干，那两支便是本旬的空。
 * 六十甲子以旬首的地支为头，缺的两支正在头的**前两位**——这是本函数算法，
 * 上面六句歌诀是它的对校，不是它的来源。
 * @param {number} dayIndex 日柱在六十甲子中的序 0–59
 * @returns {{xun: number, head: number, headName: string, voidBranches: number[], voidNames: string[]}}
 */
export function xunKong(dayIndex) {
  const xun = Math.floor(dayIndex / 10);
  const head = (xun * 10) % 12;
  const voidBranches = [(head + 10) % 12, (head + 11) % 12];
  return {
    xun,
    head,
    headName: BRANCHES[head],
    voidBranches,
    voidNames: voidBranches.map((index) => BRANCHES[index]),
  };
}

/**
 * 月破：月建所冲之支。《增删卜易》定「月破者，月建冲爻之谓」，
 * 十二个月逐月各破一支——正月申破、二月酉破……十二月未破，与六冲同源。
 * @param {number} monthBranch 月支索引 0–11
 * @returns {number} 该月所破的地支索引
 */
export function monthPo(monthBranch) {
  return branchClash(monthBranch);
}

/**
 * 五行入墓。《纳甲筮法讲义·生旺墓绝》：
 *   金长生在巳，旺在酉，墓在丑。
 *   木长生在亥，旺在卯，墓在未。
 *   水土长生在申，旺在子，墓在辰。
 *   火长生在寅，旺在午，墓在戌。
 * 墓取**自墓**一支（丑未辰戌各归一行）。另有「库」法以辰为水库、戌为火库、
 * 丑为金库、未为木库，与此不同；本包只用上表，断语遇到入墓会写明依的是哪一支。
 *
 * 同一张表里原本还记了「绝」（墓的下一支：金绝寅、木绝申、水土绝巳、火绝亥）。它已删，
 * 不是漏做：纳甲里每个五行只占两支（金申酉、木寅卯、水子亥、火巳午、土丑辰未戌），
 * 上列的绝支**没有一支落在该五行自己占的那两支里**，所以任何一爻都逢不上绝地。
 * 这一点由装卦那一层在模块加载时逐支核过并抛错，核的是「绝地不出现」这个事实，
 * 不是「绝地清单」——将来谁动了纳支或这张表，这里先炸。
 *
 * @param {string} element 五行
 * @returns {{mu: number}}
 */
const MU_JUE = Object.freeze({
  金: Object.freeze({ mu: 1 }),   // 墓丑
  木: Object.freeze({ mu: 7 }),   // 墓未
  水: Object.freeze({ mu: 4 }),   // 墓辰
  土: Object.freeze({ mu: 4 }),   // 墓辰
  火: Object.freeze({ mu: 10 }),  // 墓戌
});

export function muJue(element) {
  return MU_JUE[element];
}

/**
 * 四季之真空。《增删卜易·旬空章》引《黄金策》口诀：「春土、夏金、秋木、三冬逢火是真空。」
 * 四季以月支三分：寅卯辰春、巳午未夏、申酉戌秋、亥子丑冬。
 * @param {number} monthBranch 月支索引 0–11
 * @returns {{season: string, vacuousElement: string}}
 */
const SEASON_VACUOUS = Object.freeze([
  Object.freeze({ season: '冬', vacuousElement: '火' }), // 亥
  Object.freeze({ season: '冬', vacuousElement: '火' }), // 子
  Object.freeze({ season: '春', vacuousElement: '土' }), // 寅
  Object.freeze({ season: '春', vacuousElement: '土' }), // 卯
  Object.freeze({ season: '春', vacuousElement: '土' }), // 辰
  Object.freeze({ season: '夏', vacuousElement: '金' }), // 巳
  Object.freeze({ season: '夏', vacuousElement: '金' }), // 午
  Object.freeze({ season: '夏', vacuousElement: '金' }), // 未
  Object.freeze({ season: '秋', vacuousElement: '木' }), // 申
  Object.freeze({ season: '秋', vacuousElement: '木' }), // 酉
  Object.freeze({ season: '秋', vacuousElement: '木' }), // 戌
  Object.freeze({ season: '冬', vacuousElement: '火' }), // 亥
]);

export function seasonVacuous(monthBranch) {
  return SEASON_VACUOUS[monthBranch];
}

/** 十二时辰，索引即地支序。 */
export const SHICHEN = Object.freeze(
  BRANCHES.map((name, index) => {
    const startHour = (index * 2 + 23) % 24;
    const endHour = (startHour + 2) % 24;
    return Object.freeze({
      index,
      name: `${name}时`,
      branch: name,
      startHour,
      endHour,
      range: `${pad(startHour)}:00 - ${pad(endHour)}:00`,
    });
  }),
);

/** 黄黑道十二神，循环一周。 */
const TWELVE_OFFICE = Object.freeze([
  { name: '青龙', auspicious: true },
  { name: '明堂', auspicious: true },
  { name: '天刑', auspicious: false },
  { name: '朱雀', auspicious: false },
  { name: '金匮', auspicious: true },
  { name: '天德', auspicious: true },
  { name: '白虎', auspicious: false },
  { name: '玉堂', auspicious: true },
  { name: '天牢', auspicious: false },
  { name: '玄武', auspicious: false },
  { name: '司命', auspicious: true },
  { name: '勾陈', auspicious: false },
]);

/** 建除十二神。 */
export const JIANCHU = Object.freeze([
  { name: '建', suitable: '出行、上任、祈福', avoid: '动土、开仓' },
  { name: '除', suitable: '扫舍、治病、解除', avoid: '出行、求财' },
  { name: '满', suitable: '祭祀、祈福、开市', avoid: '服药' },
  { name: '平', suitable: '修饰、整平道路', avoid: '求医' },
  { name: '定', suitable: '冠笄、安床、嫁娶', avoid: '诉讼' },
  { name: '执', suitable: '造屋、收购、捕捉', avoid: '开市' },
  { name: '破', suitable: '破屋坏垣、求医', avoid: '嫁娶、开市' },
  { name: '危', suitable: '安床、祭祀', avoid: '登高、行船' },
  { name: '成', suitable: '开市、嫁娶、入学', avoid: '诉讼' },
  { name: '收', suitable: '纳财、进人口', avoid: '开仓' },
  { name: '开', suitable: '开市、入学、动土', avoid: '安葬' },
  { name: '闭', suitable: '筑堤、埋穴、安葬', avoid: '开市、出行' },
]);

/**
 * 二十四节气。`month`/`day` 是该节气在公历中的常年近似日期，交节时刻逐年摆动，
 * 本模块按日期比较，误差至多一日。
 * @type {readonly {name: string, month: number, day: number, kind: '节'|'中气', branch?: number, solar: string}[]}
 */
export const SOLAR_TERMS = Object.freeze([
  { name: '立春', month: 2, day: 4, kind: '节', branch: 2, solar: '东风解冻，蛰虫始振，鱼陟负冰' },
  { name: '雨水', month: 2, day: 19, kind: '中气', solar: '獭祭鱼，鸿雁来，草木萌动' },
  { name: '惊蛰', month: 3, day: 6, kind: '节', branch: 3, solar: '桃始华，仓庚鸣，鹰化为鸠' },
  { name: '春分', month: 3, day: 21, kind: '中气', solar: '玄鸟至，雷乃发声，始电' },
  { name: '清明', month: 4, day: 5, kind: '节', branch: 4, solar: '桐始华，田鼠化为鴽，虹始见' },
  { name: '谷雨', month: 4, day: 20, kind: '中气', solar: '萍始生，鸣鸠拂其羽，戴胜降于桑' },
  { name: '立夏', month: 5, day: 6, kind: '节', branch: 5, solar: '蝼蝈鸣，蚯蚓出，王瓜生' },
  { name: '小满', month: 5, day: 21, kind: '中气', solar: '苦菜秀，靡草死，麦秋至' },
  { name: '芒种', month: 6, day: 6, kind: '节', branch: 6, solar: '螳螂生，鵙始鸣，反舌无声' },
  { name: '夏至', month: 6, day: 21, kind: '中气', solar: '鹿角解，蜩始鸣，半夏生' },
  { name: '小暑', month: 7, day: 7, kind: '节', branch: 7, solar: '温风至，蟋蟀居壁，鹰始挚' },
  { name: '大暑', month: 7, day: 23, kind: '中气', solar: '腐草为萤，土润溽暑，大雨时行' },
  { name: '立秋', month: 8, day: 8, kind: '节', branch: 8, solar: '凉风至，白露降，寒蝉鸣' },
  { name: '处暑', month: 8, day: 23, kind: '中气', solar: '鹰乃祭鸟，天地始肃，禾乃登' },
  { name: '白露', month: 9, day: 8, kind: '节', branch: 9, solar: '鸿雁来，雀入大水为蛤，菊有黄华' },
  { name: '秋分', month: 9, day: 23, kind: '中气', solar: '雷始收声，蛰虫坯户，水始涸' },
  { name: '寒露', month: 10, day: 8, kind: '节', branch: 10, solar: '鸿雁来宾，雀入大水为蛤，菊有黄华' },
  { name: '霜降', month: 10, day: 23, kind: '中气', solar: '豺乃祭兽，草木黄落，蛰虫咸俯' },
  { name: '立冬', month: 11, day: 7, kind: '节', branch: 11, solar: '水始冰，地始冻，雉入大水为蜃' },
  { name: '小雪', month: 11, day: 22, kind: '中气', solar: '虹藏不见，天气上升地气下降' },
  { name: '大雪', month: 12, day: 7, kind: '节', branch: 0, solar: '鹖鴠不鸣，虎始交，荔挺出' },
  { name: '冬至', month: 12, day: 22, kind: '中气', solar: '蚯蚓结，麋角解，水泉动' },
  { name: '小寒', month: 1, day: 6, kind: '节', branch: 1, solar: '雁北乡，鹊始巢，雉始雊' },
  { name: '大寒', month: 1, day: 20, kind: '中气', solar: '鸡始乳，征鸟厉疾，水泽腹坚' },
].map((term) => Object.freeze(term)));

const JIE_TERMS = SOLAR_TERMS.filter((term) => term.kind === '节');

/**
 * 公历日期的儒略日数。
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 * @returns {number}
 */
export function julianDayNumber(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

/**
 * 干支纪日：0 为甲子。公历 2000-01-01 为戊午日，与传世万年历一致。
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {{ index: number, stem: number, branch: number, name: string }}
 */
export function dayPillar(year, month, day) {
  const index = ((julianDayNumber(year, month, day) + 49) % 60 + 60) % 60;
  const stem = index % 10;
  const branch = index % 12;
  return { index, stem, branch, name: `${STEMS[stem]}${BRANCHES[branch]}` };
}

/**
 * 年干支。干支历年以立春为界，本模块按立春近似日（2 月 4 日）切换。
 * @param {number} year
 * @param {number} month
 * @param {number} day
 */
export function yearPillar(year, month, day) {
  const effectiveYear = month < 2 || (month === 2 && day < 4) ? year - 1 : year;
  const offset = (effectiveYear - 4) % 60;
  const stem = ((offset % 10) + 10) % 10;
  const branch = ((offset % 12) + 12) % 12;
  return {
    year: effectiveYear,
    index: offset,
    stem,
    branch,
    name: `${STEMS[stem]}${BRANCHES[branch]}`,
    element: STEM_ELEMENTS[stem],
    zodiac: ZODIAC[branch],
  };
}

/**
 * 当前所处的节，节气月支由它决定。
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {{ term: typeof JIE_TERMS[number], branch: number }}
 */
export function currentJie(year, month, day) {
  const current = month * 100 + day;
  let bestTerm = null;
  let bestOrder = -1;
  for (const term of JIE_TERMS) {
    const order = term.month * 100 + term.day;
    if (order <= current && order > bestOrder) {
      bestTerm = term;
      bestOrder = order;
    }
  }
  // 全年最早的一节是小寒；在此之前仍处上一轮大雪之后的子月。
  const term = bestTerm ?? JIE_TERMS.find((item) => item.name === '大雪');
  if (!term || term.branch === undefined) throw new Error('solar term table is incomplete');
  return { term, branch: term.branch };
}

/** 六十甲子序：同干同支唯一。 */
function cycleIndex(stem, branch) {
  for (let i = 0; i < 60; i += 1) {
    if (i % 10 === stem && i % 12 === branch) return i;
  }
  return -1;
}

/**
 * 月干支。五虎遁：年干起寅月。
 */
export function monthPillar(year, month, day) {
  const jie = currentJie(year, month, day);
  const yearStem = yearPillar(year, month, day).stem;
  const yinStem = ((yearStem % 5) * 2 + 2) % 10;
  const stem = (yinStem + (jie.branch - 2 + 12) % 12) % 10;
  return {
    index: cycleIndex(stem, jie.branch),
    stem,
    branch: jie.branch,
    name: `${STEMS[stem]}${BRANCHES[jie.branch]}`,
    jie: jie.term.name,
    element: BRANCH_ELEMENTS[jie.branch],
  };
}

/**
 * 时干支，直接按地支序求。五鼠遁：日干起子时。
 * @param {number} dayStem
 * @param {number} branch 地支序 0 至 11
 */
export function hourPillarByBranch(dayStem, branch) {
  const stem = ((dayStem % 5) * 2 + branch) % 10;
  return { index: cycleIndex(stem, branch), stem, branch, name: `${STEMS[stem]}${BRANCHES[branch]}` };
}

/**
 * 时干支，由钟点求地支后再算。子时跨 23:00 与 00:00。
 * @param {number} dayStem
 * @param {number} hour 0-23
 */
export function hourPillar(dayStem, hour) {
  return hourPillarByBranch(dayStem, Math.floor(((hour + 1) % 24) / 2));
}

/**
 * 黄黑道十二神在某日某时落位。青龙起点按日支三合局：申子辰起子、寅午戌起寅、巳酉丑起巳、亥卯未起亥。
 * @param {number} dayBranch
 * @param {number} hourBranch
 */
export function hourOffice(dayBranch, hourBranch) {
  const trigramGroup = [
    [8, 0, 4], [2, 6, 10], [5, 9, 1], [11, 3, 7],
  ].findIndex((group) => group.includes(dayBranch));
  const qinglongPosition = [0, 2, 5, 11][trigramGroup] ?? 0;
  // 十二神随时辰顺行：青龙所在时辰之后依次为明堂、天刑、朱雀……
  const offset = (hourBranch - qinglongPosition + 12) % 12;
  const office = TWELVE_OFFICE[offset];
  return { name: office.name, auspicious: office.auspicious, type: office.auspicious ? '黄道' : '黑道' };
}

/**
 * 建除十二神：日支与月支同者建，之后每日顺行一位。
 */
export function jianchu(dayBranch, monthBranch) {
  return JIANCHU[(((dayBranch - monthBranch) % 12) + 12) % 12];
}

/**
 * 数九。冬至起头九，九九八十一天。
 */
export function shujiu(year, month, day) {
  const dongzhi = SOLAR_TERMS.find((term) => term.name === '冬至');
  if (!dongzhi) return null;
  const current = julianDayNumber(year, month, day);
  // 冬至在 12 月 22 日前后，跨年时取上一年冬至起算。
  const startYear = month * 100 + day >= 1222 ? year : year - 1;
  const start = julianDayNumber(startYear, dongzhi.month, dongzhi.day);
  const elapsed = current - start;
  if (elapsed < 0 || elapsed > 80) return null;
  const round = Math.floor(elapsed / 9) + 1;
  const numerals = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const label = `${numerals[round]}九`;
  const stage = elapsed <= 8 ? '入九' : elapsed >= 72 ? '出九' : '数九中';
  return { round, label, stage, elapsed, total: 81 };
}

/**
 * 今日完整历法快照。
 * @param {Date} date
 */
export function almanac(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const dayGanZhi = dayPillar(year, month, day);
  const yearGanZhi = yearPillar(year, month, day);
  const monthGanZhi = monthPillar(year, month, day);
  const currentHour = hourPillar(dayGanZhi.stem, hour);
  const jian = jianchu(dayGanZhi.branch, monthGanZhi.branch);

  const hours = SHICHEN.map((shichen) => {
    const pillar = hourPillarByBranch(dayGanZhi.stem, shichen.index);
    const office = hourOffice(dayGanZhi.branch, shichen.index);
    return {
      index: shichen.index,
      branch: shichen.branch,
      name: shichen.name,
      range: shichen.range,
      pillar: pillar.name,
      pillarBranch: BRANCHES[pillar.branch],
      office: office.name,
      officeType: office.type,
      auspicious: office.auspicious,
      verdict: office.auspicious ? '吉时' : '凶时',
      current: shichen.index === currentHour.branch,
    };
  });

  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    year: yearGanZhi,
    month: monthGanZhi,
    day: dayGanZhi,
    hour: { ...currentHour, name: `${BRANCHES[currentHour.branch]}时`, range: SHICHEN[currentHour.branch].range },
    jianchu: jian,
    shujiu: shujiu(year, month, day),
    currentTerm: monthGanZhi.jie,
    hours,
    luckyHours: hours.filter((item) => item.auspicious).map((item) => item.name),
  };
}

/**
 * 十二生肖的生克关系，用于「今日生肖」速查。
 * @param {number} branch 地支序
 */
export function zodiacProfile(branch) {
  const harmony = SIX_HARMONY.find((pair) => pair.includes(branch));
  const partner = harmony ? harmony[0] === branch ? harmony[1] : harmony[0] : undefined;
  const triple = TRIPLE_HARMONY.find((group) => group.branches.includes(branch));
  const conflict = (branch + 6) % 12;
  return {
    zodiac: ZODIAC[branch],
    branch: BRANCHES[branch],
    element: BRANCH_ELEMENTS[branch],
    harmony: partner === undefined ? undefined : ZODIAC[partner],
    triple: triple ? { name: triple.name, element: triple.element } : undefined,
    conflict: ZODIAC[conflict],
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}
