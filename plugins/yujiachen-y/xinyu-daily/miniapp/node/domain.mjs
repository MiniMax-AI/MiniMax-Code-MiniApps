// @ts-check
// 领域服务：校验 → 修改 → 持久化 → 广播。所有页面写操作只走这里。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  ANSWERS, BIRTH_FLOWERS, CARE_LINES, COLORS, DAILY_QUESTIONS, DIMENSIONS, FOCUS_LINES, KEYWORDS,
  MESSAGES, PAUSES, PROFILE_QUESTIONS, QUIZ_KEYS, QUIZ_QUESTIONS, QUIZ_STYLES, SECRET_IDS, SUITS,
} from './content.mjs';

export class DomainError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_JOYS = 500;
const FLAG_KEY = /^(awoke|lastDay|questsDay|bdayDay|region\.(today|journal|decide|explore)|ms\.\d{1,3})$/;
const MAX_ANSWERS = 200;

function emptyState() {
  return {
    version: 1,
    profile: { nickname: '', birthday: '' },
    /** @type {Record<string, {mood:number,note:string,at:string}>} */
    checkins: {},
    /** @type {Record<string, any>} */
    cards: {},
    /** @type {{id:string,text:string,date:string,at:string}[]} */
    joys: [],
    /** @type {{id:string,question:string,answer:string,date:string,at:string}[]} */
    answers: [],
    /** @type {null | {style:string, scores:Record<string,number>, at:string}} */
    quiz: null,
    /** 关于你：questionId -> 选项下标 @type {Record<string, number>} */
    about: {},
    /** 已发现的小岛秘密：id -> 发现时间 @type {Record<string, string>} */
    secrets: {},
    /** 引导类一次性标记（开场、区域横幅、当日庆祝等） @type {Record<string, string>} */
    flags: {},
  };
}

/** 本机本地日期 YYYY-MM-DD */
export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickN(rand, list, n) {
  const pool = list.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return out;
}

/** 每天固定抽 3 道今日问题 */
export function dailyQuestionsFor(date) {
  return pickN(mulberry32(fnv1a(`daily|${date}`)), DAILY_QUESTIONS, 3);
}

const sig = (obj) => Object.keys(obj).sort().map((k) => `${k}:${obj[k]}`).join(',');

/**
 * 根据生日、日期、「关于你」和今日三问的回答生成当日灵感卡。
 * 输入相同则结果稳定；回答不同，卡片随之变化。
 */
export function composeCard(birthday, date, about = {}, daily = {}, dailyQs = []) {
  const rand = mulberry32(fnv1a(`xinyu|${birthday}|${date}|${sig(about)}|${sig(daily)}`));
  const keyword = pickN(rand, KEYWORDS, 1)[0];
  const message = pickN(rand, MESSAGES, 1)[0];
  const color = pickN(rand, COLORS, 1)[0];
  const number = 1 + Math.floor(rand() * 9);
  const dims = DIMENSIONS.map((d) => ({ ...d, value: 2 + Math.floor(rand() * 4) }));
  const suits = pickN(rand, SUITS, 3);
  const pauses = pickN(rand, PAUSES, 2);
  const total = dims.reduce((s, d) => s + d.value, 0);
  const energy = Math.round(55 + ((total - 8) / 12) * 43); // 55 ~ 98
  const answered = dailyQs.filter((q) => daily[q.id] != null);
  let echo = null;
  if (answered.length) {
    const q = answered[Math.floor(rand() * answered.length)];
    const o = q.options[daily[q.id]];
    echo = `你选了「${o.label}」：${o.hint}`;
  }
  const focusLine = FOCUS_LINES[about.focus] ? pickN(rand, FOCUS_LINES[about.focus], 1)[0] : null;
  const careLine = about.stress >= 2 ? pickN(rand, CARE_LINES, 1)[0] : null;
  const basis = { about: Object.keys(about).length, daily: answered.length };
  return { date, keyword, message, color, number, dims, suits, pauses, energy, echo, focusLine, careLine, basis };
}

function birthProfile(birthday, today) {
  if (!isValidDate(birthday)) return null;
  const [y, m, d] = birthday.split('-').map(Number);
  const flower = BIRTH_FLOWERS[m - 1];
  const [ty, tm, td] = today.split('-').map(Number);
  const daysLived = Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000,
  );
  let next = new Date(ty, m - 1, d);
  const todayDt = new Date(ty, tm - 1, td);
  if (next < todayDt) next = new Date(ty + 1, m - 1, d);
  const untilBirthday = Math.round((next.getTime() - todayDt.getTime()) / 86400000);
  const season = m >= 3 && m <= 5 ? '春' : m >= 6 && m <= 8 ? '夏' : m >= 9 && m <= 11 ? '秋' : '冬';
  return { ...flower, season, daysLived, untilBirthday };
}

function streakOf(checkins, today) {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (!checkins[localDate(dt)]) dt.setDate(dt.getDate() - 1);
  let n = 0;
  while (checkins[localDate(dt)]) {
    n++;
    dt.setDate(dt.getDate() - 1);
  }
  return n;
}

function str(v, field, max, { required = true } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new DomainError(400, 'invalid_argument', `${field} 格式不正确`);
  const s = v.trim();
  if (required && !s) throw new DomainError(400, 'invalid_argument', `${field} 不能为空`);
  if ([...s].length > max) throw new DomainError(400, 'invalid_argument', `${field} 最多 ${max} 个字`);
  return s;
}

/**
 * @param {{dataDir:string, onChange:(version:number)=>void}} opts
 */
export async function createDomain({ dataDir, onChange }) {
  const file = join(dataDir, 'xinyu-state.json');
  await mkdir(dataDir, { recursive: true });
  let state = emptyState();
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    state = { ...emptyState(), ...raw, profile: { ...emptyState().profile, ...(raw.profile ?? {}) } };
    if (!state.about || typeof state.about !== 'object') state.about = {};
    if (!state.secrets || typeof state.secrets !== 'object') state.secrets = {};
    if (!state.flags || typeof state.flags !== 'object') state.flags = {};
  } catch (error) {
    if (/** @type {any} */ (error)?.code !== 'ENOENT') throw error;
  }
  let version = 0;
  let queue = Promise.resolve();

  async function persist() {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(state), 'utf8');
    await rename(tmp, file);
  }

  /** 串行化所有写操作：修改 → 落盘 → 广播 */
  function mutate(fn) {
    const run = queue.then(async () => {
      const result = fn();
      await persist();
      version++;
      try { onChange(version); } catch { /* 广播失败不回滚 */ }
      return result;
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  function snapshot() {
    const today = localDate();
    const card = state.cards[today] ?? null;
    return {
      version,
      today,
      profile: state.profile,
      birth: birthProfile(state.profile.birthday, today),
      checkins: state.checkins,
      streak: streakOf(state.checkins, today),
      todayCard: card,
      favorites: Object.values(state.cards)
        .filter((c) => c.favorite)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
      cardCount: Object.keys(state.cards).length,
      joys: state.joys.slice(-100).reverse(),
      joyCount: state.joys.length,
      answers: state.answers.slice(-20).reverse(),
      quiz: state.quiz ? { ...state.quiz, detail: QUIZ_STYLES[state.quiz.style] } : null,
      quizQuestions: QUIZ_QUESTIONS,
      about: { questions: PROFILE_QUESTIONS, answers: state.about },
      secrets: state.secrets,
      flags: state.flags,
      dailyQuestions: dailyQuestionsFor(today).map((q) => ({ id: q.id, q: q.q, options: q.options.map((o) => o.label) })),
    };
  }

  return {
    snapshot,

    updateProfile(body) {
      const nickname = str(body?.nickname, '昵称', 20, { required: false });
      const birthday = body?.birthday ? String(body.birthday) : '';
      if (birthday) {
        if (!isValidDate(birthday)) throw new DomainError(400, 'invalid_argument', '生日格式不正确');
        if (birthday > localDate() || birthday < '1900-01-01') {
          throw new DomainError(400, 'invalid_argument', '生日需在 1900 年之后且不晚于今天');
        }
      }
      return mutate(() => {
        state.profile = { nickname, birthday };
      });
    },

    checkin(body) {
      const mood = Number(body?.mood);
      if (!Number.isInteger(mood) || mood < 1 || mood > 5) {
        throw new DomainError(400, 'invalid_argument', '请选择一个心情');
      }
      const note = str(body?.note, '心情备注', 140, { required: false });
      const today = localDate();
      return mutate(() => {
        state.checkins[today] = { mood, note, at: new Date().toISOString() };
      });
    },

    removeCheckin(date) {
      if (!isValidDate(date)) throw new DomainError(400, 'invalid_argument', '日期格式不正确');
      if (!state.checkins[date]) throw new DomainError(404, 'not_found', '这一天没有打卡记录');
      return mutate(() => {
        delete state.checkins[date];
      });
    },

    setAbout(body) {
      const q = PROFILE_QUESTIONS.find((x) => x.id === body?.id);
      if (!q) throw new DomainError(400, 'invalid_argument', '没有这道题');
      const choice = body?.choice;
      if (choice !== null && (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length)) {
        throw new DomainError(400, 'invalid_argument', '回答格式不正确');
      }
      return mutate(() => {
        if (choice === null) delete state.about[q.id];
        else state.about[q.id] = choice;
      });
    },

    setFlag(body) {
      const key = body?.key;
      if (typeof key !== 'string' || !FLAG_KEY.test(key)) {
        throw new DomainError(400, 'invalid_argument', '未知的标记');
      }
      const value = body?.value === undefined ? new Date().toISOString() : body.value;
      if (typeof value !== 'string' || value.length > 32) {
        throw new DomainError(400, 'invalid_argument', '标记格式不正确');
      }
      if (state.flags[key] === value) return Promise.resolve(false);
      return mutate(() => {
        state.flags[key] = value;
        return true;
      });
    },

    discover(body) {
      const id = body?.id;
      if (typeof id !== 'string' || !SECRET_IDS.includes(id)) {
        throw new DomainError(400, 'invalid_argument', '没有这个秘密');
      }
      if (state.secrets[id]) return Promise.resolve(false);
      return mutate(() => {
        if (state.secrets[id]) return false;
        state.secrets[id] = new Date().toISOString();
        return true;
      });
    },

    drawCard(body) {
      const today = localDate();
      if (!isValidDate(state.profile.birthday)) {
        throw new DomainError(409, 'birthday_required', '先填写生日，才能生成专属灵感卡');
      }
      if (state.cards[today]) return Promise.resolve(state.cards[today]);
      const qs = dailyQuestionsFor(today);
      const raw = body?.answers ?? {};
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new DomainError(400, 'invalid_argument', '回答格式不正确');
      }
      /** @type {Record<string, number>} */
      const daily = {};
      for (const [k, v] of Object.entries(raw)) {
        const q = qs.find((x) => x.id === k);
        if (!q) throw new DomainError(400, 'invalid_argument', '今日问题已更新，请重新回答');
        if (v === null) continue;
        if (!Number.isInteger(v) || v < 0 || v >= q.options.length) {
          throw new DomainError(400, 'invalid_argument', '回答格式不正确');
        }
        daily[k] = v;
      }
      return mutate(() => {
        if (state.cards[today]) return state.cards[today];
        const card = {
          ...composeCard(state.profile.birthday, today, state.about, daily, qs),
          dailyAnswers: daily,
          drawnAt: new Date().toISOString(),
          favorite: false,
        };
        state.cards[today] = card;
        return card;
      });
    },

    toggleFavorite(date) {
      if (!isValidDate(date) || !state.cards[date]) {
        throw new DomainError(404, 'not_found', '没有找到这张灵感卡');
      }
      return mutate(() => {
        state.cards[date].favorite = !state.cards[date].favorite;
        return state.cards[date].favorite;
      });
    },

    addJoy(body) {
      const text = str(body?.text, '小确幸', 80);
      return mutate(() => {
        state.joys.push({ id: randomUUID(), text, date: localDate(), at: new Date().toISOString() });
        if (state.joys.length > MAX_JOYS) state.joys.splice(0, state.joys.length - MAX_JOYS);
      });
    },

    removeJoy(id) {
      if (!state.joys.some((j) => j.id === id)) {
        throw new DomainError(404, 'not_found', '这条记录已不存在');
      }
      return mutate(() => {
        state.joys = state.joys.filter((j) => j.id !== id);
      });
    },

    ask(body) {
      const question = str(body?.question, '问题', 100);
      const today = localDate();
      // 同一个问题在同一天得到同一个答案，避免反复重抽
      const rand = mulberry32(fnv1a(`answer|${today}|${question}`));
      const answer = ANSWERS[Math.floor(rand() * ANSWERS.length)];
      return mutate(() => {
        const item = { id: randomUUID(), question, answer, date: today, at: new Date().toISOString() };
        state.answers.push(item);
        if (state.answers.length > MAX_ANSWERS) state.answers.splice(0, state.answers.length - MAX_ANSWERS);
        return item;
      });
    },

    clearAnswers() {
      return mutate(() => {
        state.answers = [];
      });
    },

    submitQuiz(body) {
      const picks = body?.picks;
      if (!Array.isArray(picks) || picks.length !== QUIZ_QUESTIONS.length) {
        throw new DomainError(400, 'invalid_argument', '请回答全部题目');
      }
      /** @type {Record<string, number>} */
      const scores = { dawn: 0, ocean: 0, forest: 0, spark: 0 };
      for (const p of picks) {
        if (!QUIZ_KEYS.includes(p)) throw new DomainError(400, 'invalid_argument', '答案格式不正确');
        scores[p]++;
      }
      // 平分时按最后一题的选择决胜，再按固定顺序
      const max = Math.max(...Object.values(scores));
      const tied = QUIZ_KEYS.filter((k) => scores[k] === max);
      const last = picks[picks.length - 1];
      const style = tied.includes(last) ? last : tied[0];
      return mutate(() => {
        state.quiz = { style, scores, at: new Date().toISOString() };
      });
    },

    resetAll() {
      return mutate(() => {
        state = emptyState();
      });
    },

    async flush() {
      await queue;
    },
  };
}
