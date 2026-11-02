// @ts-check

/**
 * 场景接线 —— 把「谁在做什么」变成「她该说什么」。
 *
 * ⚠️ **这一层只做判定与措辞，不发消息** —— 真正塞进气泡是 `server.mjs` 的事。
 * 拆开是因为「该不该说」是判断、「说了什么」是执行，
 * 混在一起就没法单独测判定（判据必须能被抓）。
 *
 * **两条通道，各管各的**（老板 2026-11-01 拍板「甲乙合流」）：
 *
 * | 通道 | 什么时候说 | 说什么 |
 * |---|---|---|
 * | **静态台词（trigger）** | 明确的交互 / 任务事件 | `lines.mjs` 里那 27 条之一 |
 * | **静态台词（idle）** | 闲话闸门放行、且久没人碰她 | `lines.mjs` 里 `idle.untouched` 那 3 条 |
 * | **模型闲话** | 闲话闸门放行、其余情况 | 模型现说，但**提示词里带片段上下文** |
 *
 * ⇒ 模型那条不会跟静态台词撞：静态只在「有明确事件」或「久没人碰」时说，
 * 其余闲话时刻走模型，而模型说的话**对着她此刻正在做的动作**。
 *
 * **纯函数**：时间戳、计数、随机全部由调用方注入，测试里能精确造出来。
 */

import { LINES, MOOD_SCENES, EVENT_SCENES, pickLine } from './lines.mjs';
// ⚠️ **断句器是 scrub.mjs 的唯一实现** —— 这边不另写一份（同一判断只写一处）。
import { splitSentences } from './scrub.mjs';
import { LONELY_MS } from './state.mjs';

/**
 * 多久没人碰她 ⇒ 走「长时间没人碰她」静态句。
 * ⚠️ **为什么是 2 小时**：闲话闸门是 20 分钟（`idletalk.mjs`），
 * 20 分钟就够「很久没人理」了 —— 若阈值比闸门还短，静态句会把模型闲话全吃掉。
 */
export const UNTOUCHED_MS = 2 * 60 * 60 * 1000;

/**
 * 客户端上报的交互事件 → 情境键。
 * @param {string} event
 * @returns {string | null}
 */
export function sceneForEvent(event) {
  return EVENT_SCENES[String(event ?? '')] || null;
}

/**
 * 状态四态 → 情境键（**工作状态台词**挂在状态上）。
 *
 * ⚠️ **第三十七轮**：以前是 sceneForTrack（轨 → 任务事件台词）。
 *   现在**工作状态**与**任务事件**分成两套判据来源 —— 这里只管「她此刻是什么状态」，
 *   任务事件那套在观察通道里（observe.mjs → onTaskEvent）。
 * @param {string} mood idle / thinking / working / celebrate
 * @returns {string | null}
 */
export function sceneForMood(mood) {
  return MOOD_SCENES[String(mood ?? '')] || null;
}

/**
 * 情境键 → 静态台词。
 * @param {string} lineKey 情境键
 * @param {number} [counter] 该情境已说过几句
 * @returns {{key: string, text: string, index: number, channel: string} | null}
 */
export function pickSceneLine(lineKey, counter = 0, tone = null, index = null) {
  return pickLine(lineKey, counter, tone, index);
}

/**
 * 这个情境键**是不是分语气档的池**。
 * ⚠️ **只有分档的池才给 tone** —— 不分档的池给了也没用，
 * 而且会把轮换计数的键从 click.tap 变成 click.tap@familiar，
 * 落盘的计数就接不上旧的（重启后老句子重来一遍）。
 * @param {string} lineKey
 * @returns {boolean}
 */
export function isTonePool(lineKey) {
  return Boolean(LINES[String(lineKey ?? '')]?.tone);
}

/**
 * 这个情境键有没有台词。
 * @param {string} lineKey
 * @returns {boolean}
 */
export function hasSceneLine(lineKey) {
  return Boolean(LINES[String(lineKey ?? '')]);
}

/**
 * 这个情境键走哪条**时间闸门通道**（feed / result / exempt）。
 *
 * ⚠️ **不取句就能知道** —— 闸门必须在**取句之前**判：
 *   反过来的话，被闸门挡掉的那一次会把「轮换计数」吃掉（下次从第三句开始）。
 * @param {string} lineKey
 * @returns {string}
 */
export function voiceOf(lineKey) {
  return String(LINES[String(lineKey ?? '')]?.voice || 'feed');
}

/**
 * 久没人碰她没有。
 * @param {number} now 当前时间戳
 * @param {number} lastTouchedAt 最后一次被碰 / 被说话的时间戳
 * @returns {boolean}
 */
export function isUntouched(now, lastTouchedAt) {
  const t = Number(lastTouchedAt) || 0;
  if (!t) return false;
  return Number(now) - t >= UNTOUCHED_MS;
}

/**
 * 冷落多久算「回来了」—— **与 state.mjs 的 LONELY_MS 同值**（30 分钟）。
 *
 * ⚠️ **同值只有一个来路**：state.mjs 是心情结算的真源，这里 import 它，
 *   不另写一份 30 分钟 —— 两份一漂移，「久别重逢」和「心情变冷」就对不上了。
 */
export const REUNION_MS = LONELY_MS;

/**
 * 多久算「他回来了一下」—— 走 rel.back（"你回来啦"）。
 * ⚠️ **低于这个间隔不算回来**：他还在跟你聊，只是上一句隔了一会儿而已。
 */
export const BACK_GAP_MS = 10 * 60 * 1000;

/**
 * 久别重逢的时长档：0 = 刚走开（>30 分钟），1 = 过了一天，2 = 隔了一周以上。
 *
 * ⚠️ **这个变体是「事实」不是「轮次」** —— 她说了「隔了一整天」就得真的隔了一天，
 *   所以取句时按本档的下标取，不按轮换计数取。
 * @param {number} gapMs 冷落了多久（毫秒）
 * @returns {0|1|2}
 */
export function reunionTier(gapMs) {
  const gap = Number(gapMs) || 0;
  if (gap >= 7 * 24 * 60 * 60 * 1000) return 2;
  if (gap >= 24 * 60 * 60 * 1000) return 1;
  return 0;
}

/**
 * 用户消息里的关系标记词 → 关系性情境键。
 *
 * ⚠️ **读用户原话，不读模型输出**（契约 §6.1 判据纪律：判据只来自结构化字段）。
 * ⚠️ **这是设计判断**：契约只写「事件 + 时间锚点」，没说「被夸」怎么判。
 *   判据表就这一份，不散落在别处。
 */
export const RELATION_MARKS = {
  'rel.praised': [
    '厉害',
    '真棒',
    '好棒',
    '好看',
    '真好看',
    '可爱',
    '漂亮',
    '做得好',
    '不错',
    '赞',
  ],
  'rel.thanked': ['谢谢', '感谢', '多谢', '辛苦了'],
  'rel.apology': ['对不起', '抱歉', '不好意思', '我错了', '原谅我'],
};

/**
 * 用户这条消息里有没有「被夸 / 被谢 / 被道歉」的标记。
 *
 * ⚠️ **一次只认一种**（表里的顺序：夸 → 谢 → 道歉）——
 *   一条消息同时命中两种时，取先命中的那种，不叠着说两句。
 * @param {string} text 用户原话
 * @returns {'rel.praised'|'rel.thanked'|'rel.apology'|null}
 */
export function relationMarkScene(text) {
  const s = String(text ?? '');
  if (!s) return null;
  for (const [key, words] of Object.entries(RELATION_MARKS)) {
    for (const word of words) {
      if (s.includes(word)) return key;
    }
  }
  return null;
}

/**
 * 用户消息里**问起心情**的标记词。
 *
 * ⚠️ **读用户原话，不读模型输出**（契约 §6.1 判据纪律）。
 * ⚠️ **这是设计判断**：契约 §6.1 承诺「用户明确问起『你心情怎么样』时她口头说明」，
 *   但没说「怎么算问起」—— 判据表就这一份，不散落在别处。
 * ⚠️ 词表收窄：宁可漏判不可误判（漏判 = 她照常回答；误判 = 她无缘无故报心情）。
 */
export const HEART_ASKS = [
  '心情',
  '开心',
  '高兴',
  '生气',
  '难过',
  '还好吗',
  '心里',
  '烦不烦',
  '闷不闷',
];

/**
 * 用户消息里**问起亲近程度**的标记词（同一个判据表里的另一半）。
 */
export const INTIMACY_ASKS = [
  '想我',
  '亲近',
  '我们熟',
  '熟吗',
  '关系',
  '在乎我',
  '在意我',
];

/**
 * 用户这条消息里有没有问起心情 / 亲近程度。
 *
 * ⚠️ **只返回「问没问」，不返回任何模型输出** —— 纯用户原话。
 * @param {string} text 用户原话
 * @returns {{heart: boolean, intimacy: boolean}}
 */
export function heartAskTopics(text) {
  const s = String(text ?? '');
  if (!s) return { heart: false, intimacy: false };
  return {
    heart: HEART_ASKS.some((w) => s.includes(w)),
    intimacy: INTIMACY_ASKS.some((w) => s.includes(w)),
  };
}

/**
 * 用户消息里提到「ronny 爸爸」的标记词 —— **彩蛋判据（唯一一处）**。
 *
 * ⚠️ **这是什么彩蛋**（老板 2026-11-02 拍板）：她管**那个人**叫「ronny爸爸」；
 *   老板在群里提到「ronny哥 / R总 / 涛哥」时，她要认得出说的是同一个人。
 *   ⚠️ **当事人已明确同意保留这个彩蛋**（2026-11-02；说明见 PR #101）。
 * ⚠️ **读用户原话，不读模型输出**（契约 §6.1 判据纪律）。
 * ⚠️ **词表收窄**：宁可漏判不可误判（漏判 = 她照常答；误判 = 她无缘无故插一句彩蛋）。
 *   'ronny' 一条就盖住 ronny哥 / ronny 哥 / ronny爸爸 / RONNY 等全部变体。
 * ⚠️ **「r总裁」不算「r总」** —— 字面边界（否则「r总裁」会误触发）。
 */
export const RONNY_MARKS = ['ronny', 'r总', 'r 总', '涛哥', '何涛'];

/**
 * 用户这条消息里有没有提到「ronny 爸爸」。
 *
 * @param {string} text 用户原话
 * @returns {boolean}
 */
export function ronnyMention(text) {
  const s = String(text ?? '').toLowerCase();
  if (!s) return false;
  for (const w of RONNY_MARKS) {
    let idx = s.indexOf(w);
    while (idx >= 0) {
      // ⚠️ 「r总裁」不是「r总」—— 字面边界（老板说的「r总」是别名，别把带后缀的算进去）。
      if (w === 'r总' && s[idx + 2] === '裁') {
        idx = s.indexOf(w, idx + 1);
        continue;
      }
      return true;
    }
  }
  return false;
}

// ============ 彩蛋的两条禁令（老板 2026-11-02 第二遍要求）============
//
// ⚠️ **为什么这两条要落成运行时判据**（真机 2026-11-02 15:53 抓到）：
//   老板点名的是「别说是老板说过他」「不要称呼全名」——
//   前一版只把它写进**事实块**（提示词层），**模型自己说的话没人管**：
//   真机她回的是「ronny爸爸呀，爸爸说过他老叫我傻白甜」
//   ⇒ 「老板说过他」原样漏出去（只把「老板」换成了「爸爸」）。
//   ⇒ 提示词是**请求**不是保证 ⇒ 要保证，就在她的话**出口前**兜一道。

/**
 * 这个人的全名 —— 她不许说出口（老板点名）。
 *
 * ⚠️ **效果必需，别删**：这是禁令词表 —— 她的话出口前要拿它拦一遍。
 *   删了它，「不要称呼全名」这条老板点名的规矩就没有运行时兜底了
 *   （提示词只是请求，不是保证）。
 */
export const RONNY_FULL_NAME = '何涛';

/** 她唯一许用的称呼。 */
export const RONNY_CALL = 'ronny爸爸';

/**
 * 来路动词 —— 她一说这些字，就等于把「谁告诉我的」漏出去了。
 *
 * ⚠️ **只收「说完了某件事」的动词**（说过 / 提过 / 听说 …），
 *   不收光杆的「说 / 讲 / 提」—— 否则老板指定的那句「他总叫我傻白甜」会被误伤。
 */
export const RONNY_SOURCE_VERBS = [
  '说过', '讲过', '告诉过', '告诉我', '告诉我的', '提过', '听说', '听来', '说的', '提的',
];

/**
 * 会指到人的主语 —— 「谁讲过」里的那个「谁」。
 *
 * ⚠️ **不放「他」**：老板指定的那句就是「他总叫我傻白甜」——
 *   把「他」当主语，会把要留的那句当成漏网的来路。
 * ⚠️ **不放「谁」**：「谁说过傻白甜」是她正常会问的话，不是泄漏。
 */
export const RONNY_SOURCE_SUBJECTS = ['老板', '爸爸', '主人', '你', '人家', '有人'];

/**
 * 跟他有关的语境 —— 只有在这样的语境里，来路词才算漏。
 *
 * ⚠️ **为什么要有语境**：老板平时聊天也会说「老板说过今天要开会」——
 *   那不是彩蛋的漏，是正常话，不能剥。
 */
export const RONNY_CONTEXT = ['傻白甜', 'ronny', '涛哥', 'r总'];

/**
 * 老板指定的那句 —— **真源在台词库**（lines.mjs），这里只是取出来用。
 * ⚠️ 〔表情〕标记要去掉：这条兜底走的是**聊天区**，不走 express 的标记替换。
 */
export const RONNY_CANONICAL = String(
  (LINES['rel.ronny'] && LINES['rel.ronny'].lines && LINES['rel.ronny'].lines[0]) || ''
).replace(/〔表情〕/g, '');

/**
 * 这句话有没有把「傻白甜」的来路说出来。
 *
 * @param {string} sentence 一句话
 * @param {string} [context] 语境（默认 = 这句话本身；调用方可以传整条回复）
 * @returns {boolean}
 */
export function ronnySourceLeak(sentence, context) {
  const s = String(sentence == null ? '' : sentence);
  if (!s) return false;
  const ctx = String(context == null ? s : context).toLowerCase();
  let inContext = false;
  for (const w of RONNY_CONTEXT) {
    if (ctx.includes(w.toLowerCase())) { inContext = true; break; }
  }
  if (!inContext) return false;
  // 主语在前：老板说过 / 爸爸提过 / 你告诉过我
  for (const subj of RONNY_SOURCE_SUBJECTS) {
    let at = s.indexOf(subj);
    while (at >= 0) {
      const tail = s.slice(at + subj.length, at + subj.length + 8);
      for (const v of RONNY_SOURCE_VERBS) {
        if (tail.includes(v)) return true;
      }
      at = s.indexOf(subj, at + 1);
    }
  }
  // 动词在前：说过老板 / 听爸爸说过
  for (const verb of RONNY_SOURCE_VERBS) {
    let at = s.indexOf(verb);
    while (at >= 0) {
      const tail = s.slice(at + verb.length, at + verb.length + 6);
      for (const subj of RONNY_SOURCE_SUBJECTS) {
        if (tail.includes(subj)) return true;
      }
      at = s.indexOf(verb, at + 1);
    }
  }
  return false;
}

/**
 * 去掉她话里的两样东西 —— **彩蛋兜底（她的话出口前的最后一道）**。
 *
 * ⚠️ **两条禁令的对象是「她的话」，不是「提示词」**：
 *   事实块里写「别报全名」只是请求；真机 15:53 她照样说了「爸爸说过他」。
 *   ⇒ 这一层在**她的话落库前**兜一道，模型说什么都不算数。
 * ⚠️ **只去掉漏的那几句，不整条抹掉**（沿用 scrub.mjs 的老规矩：宁可整句去掉，也不留破洞）——
 *   「老板说过他，还说我傻白甜」挖掉「老板说过」会剩下一个没主语的「他」。
 * ⚠️ **剥光了就回落成老板指定的那句** —— 她还是得回话；
 *   宁可回一句模板，也不回一句泄漏了来路的话。
 *
 * @param {string} text 她原本要说的话
 * @returns {string}
 */
export function deRonnyLeak(text) {
  const src = String(text == null ? '' : text);
  if (!src) return src;
  // ① 全名 → 她只许用 ronny爸爸
  let out = src.split(RONNY_FULL_NAME).join(RONNY_CALL);
  out = out.replace(/(ronny爸爸)[，、, ]{0,2}\1/g, '$1');
  // ② 来路 → 去掉漏的那几句
  const sentences = splitSentences(out);
  const kept = [];
  let dropped = false;
  for (const s of sentences) {
    if (ronnySourceLeak(s, out)) { dropped = true; continue; }
    kept.push(s);
  }
  if (!dropped) return out;
  const rest = kept.join('').trim();
  return rest || RONNY_CANONICAL || out;
}


/**
 * 时段问候的档：0 = 早上，1 = 中午，2 = 晚上/深夜。
 *
 * ⚠️ **小时数由调用方算好传进来** —— 本模块不读时钟（判据要能被抓）。
 * @param {number} hour 0–23
 * @returns {0|1|2|null}
 */
export function greetingTier(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return null;
  if (h >= 5 && h < 11) return 0;
  if (h >= 11 && h < 17) return 1;
  return 2;
}

/**
 * 周末判据（调用方传星期几：0 = 周日 … 6 = 周六）。
 * @param {number} weekday
 * @returns {boolean}
 */
export function isWeekendDay(weekday) {
  const w = Number(weekday);
  return w === 0 || w === 6;
}

/**
 * 把「她此刻在做什么」写成一段给模型的补充提示。
 *
 * ⚠️ **只喂结构化字段**（片段 key / 中文动作名 / 分类 / 池 / 刚发生的交互），
 * **不读模型输出文本** —— 那是 §6.2 的硬纪律（「什么时候说哪句」来自结构化字段）。
 *
 * @param {{key?: string, name?: string, category?: string, pool?: string, event?: string} | null} scene
 * @returns {string} 空串 = 没场景可讲
 */
export function buildScenePrompt(scene) {
  if (!scene) return "";
  const out = [];
  const name = String(scene.name ?? "").trim();
  if (name) out.push('她这会儿正在做：' + name + (scene.category ? '（' + scene.category + '）' : '') + '。');
  const ev = String(scene.event ?? '').trim();
  if (ev === 'tap') out.push('刚才用户点了她一下。');
  else if (ev === 'multitap') out.push('刚才用户连着戳了她好几下。');
  else if (ev === 'double') out.push('刚才用户敲了她两下。');
  else if (ev === 'drag') out.push('刚才用户把她拖来拖去。');
  else if (ev === 'move') out.push('刚才用户把她挪了个位置。');
  if (!out.length) return '';
  out.push('要提到就顺着这件事说，别复述这两句，也别解释她在做什么。');
  return out.join('\n');
}

/**
 * 场景摘要（给日志看，不进提示词）。
 * @param {{key?: string, name?: string, pool?: string, event?: string} | null} scene
 * @returns {string}
 */
export function describeScene(scene) {
  if (!scene) return "";
  return [scene.name, scene.pool, scene.event].filter(Boolean).join('/');
}