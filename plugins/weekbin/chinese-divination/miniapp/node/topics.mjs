// @ts-check

/**
 * 五行类事：把「所问何事」落到一个事类，再由事类取类神五行与用神六亲。
 *
 * 口径说明（重要）：梅花易数本身没有六爻那样的六亲用神，这张表是本包**自订**的类象口径，
 * 不是传世定法。它只决定两件事——应期看类神五行的旺相，取象多看类神与体卦的生克。
 * 卦的吉凶仍由体用生克单独推定，问不同的事不会把同一个卦说出相反的吉凶。
 *
 * 用神（god）那一栏是另一回事，**有传世定法可依**，见 jingfang.mjs：
 * 问何事取何亲为用神，出处见各条 reason。多半一亲，婚恋与疾病两亲——婚恋分男女
 * 取，本包不知道求测者是男是女，所以两个都列出来，不替人猜。
 */

/**
 * @typedef {object} GodRule
 * @property {readonly string[]} relatives 用神取哪几个六亲
 * @property {string} reason 取法依据，随断语一同给出，免得凭空断言
 * @property {boolean} [byGender] 是否男取其一、女取其一（婚恋）
 * @property {string} [relate] 两亲之间的生克，疾病用（病症与医药）
 *
 * @typedef {object} TopicClass
 * @property {string} key 事类标识
 * @property {string} label 事类名，出现在断语里
 * @property {'木'|'火'|'土'|'金'|'水'} element 类神五行
 * @property {string} reason 取此五行的类象依据，随断语一同给出，免得凭空断言
 * @property {GodRule} god 用神取法
 * @property {readonly string[]} keywords 命中用的词，按长度从长到短匹配
 */

/** @type {readonly TopicClass[]} */
export const TOPIC_CLASSES = Object.freeze([
  Object.freeze({
    key: 'wealth',
    god: Object.freeze({ relatives: Object.freeze(['妻财']), reason: '求财取妻财：财爻是求测者可以支配、可以到手的资源。' }),
    label: '财运',
    element: '金',
    reason: '金为财，梅花以金主财帛、货利、得失。',
    // 进货、货款、卖掉这类买卖行话原先不在表里，「这批货该不该进」「该不该进货」一律认不出，
    // 问的人十有八九是问财，不该因为措辞不像「赚钱」就断成没写问题。
    keywords: Object.freeze(['工资', '薪水', '融资', '股票', '投资', '报价', '收益', '买卖', '生意', '赚钱', '亏', '钱', '财',
      '进货', '货款', '订货', '利润', '营收', '卖', '销', '货']),
  }),
  Object.freeze({
    key: 'career',
    god: Object.freeze({ relatives: Object.freeze(['官鬼']), reason: '求职、升迁取官鬼，官鬼为职位与上司；考试、文凭另取父母。' }),
    label: '事业功名',
    element: '火',
    reason: '火主文明与显达，梅花以火主名声、职位、上位者的照拂。',
    keywords: Object.freeze(['升职', '跳槽', '面试', '录用', '创业', '工作', '事业', '前程', '项目', '老板', '上司', '职位', 'offer']),
  }),
  Object.freeze({
    key: 'love',
    god: Object.freeze({ relatives: Object.freeze(['妻财', '官鬼']), byGender: true, reason: '《增删卜易》「男测婚以财为用，女测婚以官为用」：男占取妻财（女方），女占取官鬼（男方）。本包不替求测者认性别，两亲都列出来。' }),
    label: '感情',
    element: '水',
    reason: '水主流动与暗昧，梅花以水主情欲、暧昧、往来不定。',
    keywords: Object.freeze(['暗恋', '复合', '分手', '挽回', '暧昧', '表白', '在一起', '感情', '恋爱', '交往', '心动', '主动', '回头', '喜欢',
      // 「前任」「旧情」是别的类都不占的名词，加进来不会跟财运的「钱」之类抢。
      // 「回来」「找我」没加：这两个词跟财运、出行寻物共用，「这笔钱什么时候回来」
      // 会被判成感情——宁可认不出，也不把卦算到别的事上去。
      '前任', '旧情']),
  }),
  Object.freeze({
    key: 'marriage',
    god: Object.freeze({ relatives: Object.freeze(['妻财', '官鬼']), byGender: true, reason: '《增删卜易》「男测婚以财为用，女测婚以官为用」：男占取妻财，女占取官鬼。' }),
    label: '婚恋',
    element: '木',
    reason: '木主生发与匹配，梅花以木主婚姻、配偶、长辈之允。',
    // 补一个单字「婚」：「这婚要不要定」这类写法原先认不出，而婚在九个事类里
    // 只有婚恋用，不跟任何一类相撞。
    keywords: Object.freeze(['结婚', '婚姻', '婚期', '婚', '相亲', '领证', '嫁', '娶', '配偶', '对象', '老公', '老婆']),
  }),
  Object.freeze({
    key: 'health',
    god: Object.freeze({ relatives: Object.freeze(['官鬼', '子孙']), reason: '占病以官鬼为病症本身，以子孙为医药。', relate: '子孙克官鬼：子孙有力则病退，官鬼受制则病轻。' }),
    label: '疾病',
    element: '土',
    reason: '土主形体与脾胃，梅花以土主肉身、疾厄、居处。',
    keywords: Object.freeze(['体检', '手术', '康复', '健康', '身体', '吃药', '检查', '病']),
  }),
  Object.freeze({
    key: 'study',
    god: Object.freeze({ relatives: Object.freeze(['父母']), reason: '父母为文书、成绩与证照，问考试取父母爻。' }),
    label: '学业文书',
    element: '木',
    reason: '木主文昌与青卷，梅花以木主文书、科名、考试与批复。',
    keywords: Object.freeze(['考试', '学业', '论文', '证照', '执照', '资格', '录取', '证书', '申请', '材料']),
  }),
  Object.freeze({
    key: 'property',
    god: Object.freeze({ relatives: Object.freeze(['父母']), reason: '房舍、契约皆属父母，契据为父母所主。' }),
    label: '房产车契',
    element: '土',
    reason: '土为不动之象，梅花以土主宅舍、车辆、契据与安顿。',
    keywords: Object.freeze(['买房', '租房', '搬家', '置业', '装修', '贷款', '合同', '房产', '车', '房']),
  }),
  Object.freeze({
    key: 'dispute',
    god: Object.freeze({ relatives: Object.freeze(['官鬼']), reason: '官司取官鬼，官鬼为对方与官非；我克官鬼则我胜。' }),
    label: '官讼是非',
    element: '金',
    reason: '金主肃杀与律令，梅花以金主官非、评判、赔偿与强制。',
    keywords: Object.freeze(['赔偿', '仲裁', '举报', '官司', '诉讼', '起诉', '纠纷', '是非', '立案']),
  }),
  Object.freeze({
    key: 'journey',
    god: Object.freeze({ relatives: Object.freeze(['妻财']), reason: '失物取妻财——所求之物以财论。寻人则须按与失踪者的关系另取六亲，本包不替你猜关系。' }),
    label: '出行寻物',
    element: '水',
    reason: '水主行旅与隐匿，梅花以水主远行、失物与寻访。',
    keywords: Object.freeze(['出差', '差旅', '签证', '行程', '出行', '远行', '遗失', '失物', '丢失', '寻人', '找回', '找到', '寻', '丢']),
  }),
]);

/** 关键词长的先匹配：「找工作」不该被「工作」抢走，「买房子」不该被「房」抢走。 */
const MATCH_ORDER = Object.freeze(
  [...TOPIC_CLASSES]
    .flatMap((topic) => topic.keywords.map((keyword) => ({ topic, keyword })))
    .sort((a, b) => b.keyword.length - a.keyword.length),
);

/** @type {Map<string, TopicClass>} */
const BY_KEYWORD = new Map(MATCH_ORDER.map((entry) => [entry.keyword, entry.topic]));

/**
 * 从所问之事里认事类。没写、写得含糊、或写到认不出的事类，都返回 null，
 * 由调用方退回用卦本分——宁可不给类神，也不硬套一个五行。
 *
 * @param {string} question
 * @returns {TopicClass | null}
 */
export function detectTopic(question) {
  const text = (question ?? '').trim();
  if (!text) return null;
  for (const [keyword, topic] of BY_KEYWORD) {
    if (text.includes(keyword)) return topic;
  }
  return null;
}

/**
 * 认出事类对应的类目。MCP 让 Agent 自己挑事类时就是拿这个键来查的——
 * Agent 看得懂「这笔钱」是什么，认不出「财运」里那串关键词命中了哪一条。
 * @param {unknown} key
 * @returns {TopicClass | null}
 */
export function topicByKey(key) {
  return typeof key === 'string' ? (TOPIC_CLASSES.find((topic) => topic.key === key) ?? null) : null;
}

/**
 * 九个事类的键，供 MCP 把枚举列给 Agent 看。
 * @type {readonly string[]}
 */
export const TOPIC_KEYS = Object.freeze(TOPIC_CLASSES.map((topic) => topic.key));

/**
 * 类神与体卦的关系，用来提醒所问之事对求测者是生是克。
 * @param {string} godElement 类神五行
 * @param {string} bodyElement 体卦五行
 * @param {(a: string, b: string) => boolean} generates
 * @param {(a: string, b: string) => boolean} overcomes
 */
export function godRelation(godElement, bodyElement, generates, overcomes) {
  if (generates(godElement, bodyElement)) {
    return { key: 'god-generates-body', tone: 'good', text: `类神${godElement}生体卦${bodyElement}，所问之事对你有补益，多主外力在托着你。` };
  }
  if (overcomes(godElement, bodyElement)) {
    return { key: 'god-overcomes-body', tone: 'bad', text: `类神${godElement}克体卦${bodyElement}，所问之事压着你，多主你要主动应付、不能让其牵着走。` };
  }
  if (generates(bodyElement, godElement)) {
    return { key: 'body-generates-god', tone: 'bad', text: `体卦${bodyElement}生类神${godElement}，你在往这件事上使力，多主你要多花心思与本钱。` };
  }
  if (overcomes(bodyElement, godElement)) {
    return { key: 'body-overcomes-god', tone: 'good', text: `体卦${bodyElement}克类神${godElement}，这件事在你掌握之中，多主主动权归你。` };
  }
  return { key: 'god-same-as-body', tone: 'flat', text: `类神与体卦同为${godElement}，所问之事与你的处境同气，宜顺其势而不宜强求改变。` };
}
