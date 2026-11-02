// @ts-check

/**
 * 闲话（idle）生产者：**她不说话的时候也在活着**。
 *
 * ⚠️ **为什么要有这个**（老板 2026-10-30 第十九轮）：
 * 气泡队列**一直有 idle 这一类**（排队、不抢占、沉到队尾），但**从来没有生产者** ——
 * 于是「她不说话的时候也在活着」这句话一直是空的。
 * 第十八轮跟 Aurabot 逐条对账时，这被列成三个已知空缺之一
 * （他们有 `chatty` 维 ＋「偶尔主动开个新话题、或者提起以前聊过的事」）。
 *
 * **这一份只做判定和措辞，不发消息** —— 真正跑一轮模型、取回正文、塞进气泡
 * 是 `server.mjs` 的事。拆开是因为「该不该说」是判断、「说了什么」是执行，
 * 混在一起就没法单独测判定（判据必须能被抓）。
 *
 * **内容从哪来**：**不另立素材池** —— 她的日常写在**规矩第 26 条**里（唯一真源），
 * 这里只负责**让她开口**：提示里说清「这是你自己想开口，不是老板说的话」。
 * 另立一份素材池 = 第二真源 = 早晚漂。
 *
 * **踩过的坑**（别重做）：
 * - 判据不能读投影、要读真源 —— 本模块的「该不该说」全部是**纯函数**，
 *   时间戳全部由调用方注入，测试里可以精确造出「刚好 19 分钟」「刚好 21 分钟」。
 * - `clip()` 是硬截 —— `pickIdleLine` 先按句断、再按字数收，**不靠硬截**。
 */

import { clip, textLength } from './clip.mjs';
// ★ **语气块**（契约 §6.1）：闲话也是说给老板听的 ⇒ 跟聊天回复**同一块语气块**。
//   **同一个真源**在 chatinput.mjs 的 buildToneHint() —— 这里不另写一份。
import { buildToneHint } from './chatinput.mjs';

/**
 * 闲话生产者的默认口径。
 *
 * ⚠️ **为什么这么保守**：闲话是**她在用户没要求时自己说的话** ——
 * 说多了就是打扰，说少了等于没有。第一版宁可少说。
 */
export const IDLE_DEFAULTS = {
  /** 用户静默多久才考虑主动开口（20 分钟）。 */
  minSilenceMs: 20 * 60 * 1000,
  /** 两次闲话之间至少隔多久（45 分钟）。 */
  minGapMs: 45 * 60 * 1000,
  /** 一小时最多几条。 */
  maxPerHour: 2,
  /** 过了前面所有闸门还要过的随机闸（免得每次到点就发）。 */
  chance: 0.5,
  /** 检查间隔（60 秒）。 */
  tickMs: 60 * 1000,
};

/** 总开关：不想让她主动开口时，把这里改成 false 就全停（一个数，好回滚）。 */
export const IDLE_TALK_ENABLED = true;

/**
 * 现在该不该让她主动说一句。
 *
 * ⚠️ **判定顺序是有讲究的**：先挡「她在忙」「用户还没说过话」，
 * 再看静默够不够久 —— 这样失败原因一眼看得出是哪一道闸。
 *
 * @param {{
 *   now?: number,
 *   lastUserAt?: number,
 *   lastIdleAt?: number,
 *   idleTimestamps?: number[],
 *   busy?: boolean,
 *   rand?: () => number,
 * }} input
 * @param {Partial<typeof IDLE_DEFAULTS>} [options]
 * @returns {{ok: boolean, reason: string, silentMs?: number, inHour?: number}}
 */
export function shouldSpeakIdle(input, options = {}) {
  const cfg = { ...IDLE_DEFAULTS, ...options };
  const {
    now = Date.now(),
    lastUserAt = 0,
    lastIdleAt = 0,
    idleTimestamps = [],
    busy = false,
    rand = Math.random,
  } = input ?? {};

  if (!IDLE_TALK_ENABLED) return { ok: false, reason: 'disabled' };
  if (busy) return { ok: false, reason: 'busy' };
  if (!lastUserAt) return { ok: false, reason: 'no_user_yet' };

  const silentMs = now - lastUserAt;
  if (silentMs < cfg.minSilenceMs) return { ok: false, reason: 'too_soon', silentMs };

  if (lastIdleAt && now - lastIdleAt < cfg.minGapMs) {
    return { ok: false, reason: 'gap_too_small', silentMs };
  }

  const hourAgo = now - 60 * 60 * 1000;
  const stamps = Array.isArray(idleTimestamps) ? idleTimestamps : [];
  const inHour = stamps.filter((t) => Number(t) > hourAgo).length;
  if (inHour >= cfg.maxPerHour) return { ok: false, reason: 'hour_full', silentMs, inHour };

  if (rand() >= cfg.chance) return { ok: false, reason: 'chance', silentMs, inHour };

  return { ok: true, reason: 'ok', silentMs, inHour };
}

/**
 * 让她主动开口的那段提示。
 *
 * ⚠️ **这段会作为 user 消息进她的会话历史**，所以必须写清楚
 * 「这是你自己想开口，不是老板说的话」—— 否则她会以为老板说了这句。
 *
 * @param {{clock?: string, minutes?: number, scene?: string, tone?: {tone?: string, mood?: string} | null}} [input]
 * @returns {string}
 */
export function buildIdlePrompt(input = {}) {
  const clock = String(input.clock ?? '');
  const minutes = Math.max(0, Math.round(Number(input.minutes) || 0));
  const scene = String(input.scene ?? '').trim();
  // ★ **语气档**（契约 §6.1）：闲话也是说给老板听的 ⇒ 跟聊天回复**同一块语气块**。
  //   漏了它 ⇒ 同一个气泡通道出现两套标准：静态台词分了档、模型闲话没分档。
  const toneHint = buildToneHint(input.tone ?? null);
  const out = [
    `[主动开口] 现在 ${clock}，老板已经 ${minutes} 分钟没说话了。`,
    '这是你自己想开口，不是老板说的话，也不用等他回。',
  ];
  if (toneHint) out.push(toneHint);
  // ⚠️ **片段上下文是结构化事实**（她在做什么、刚刚发生了什么），
  // 不是模型输出文本 —— §6.2 的硬纪律（「什么时候说哪句」来自结构化字段）。
  if (scene) out.push(scene);
  out.push('说一件你自己的事，或者刚看到什么，或者以前聊过的事；一条就够，别问问题。');
  return out.join('\n');
}

/**
 * 从模型回复里挑出能进气泡的那一句。
 *
 * ⚠️ **气泡里只放一句**：闲话是插在用户没要求的时候冒出来的一小句 ——
 * 贴两段进去就变成「她突然开始写作文」。
 * 第一句太短（不到 8 个字）才补上第二句，免得只吐一个字。
 *
 * ⚠️ **不靠硬截**：`clip()` 是硬截，会在句中间切断 ——
 * 这里先按句末标点断；实在超长才退到硬截（罕见）。
 *
 * @param {string} text 模型这一轮的正文
 * @param {number} [max] 气泡最多几个字
 * @returns {string} 空串 = 没挑出可用的
 */
export function pickIdleLine(text, max = 60) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  const parts = raw
    .split(/(?<=[。！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  let line = parts[0];
  if (textLength(line) < 8 && parts[1]) line = `${parts[0]}${parts[1]}`;
  return textLength(line) > max ? clip(line, max) : line;
}
