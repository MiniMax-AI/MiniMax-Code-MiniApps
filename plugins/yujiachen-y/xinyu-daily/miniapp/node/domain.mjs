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
const MAX_LETTERS = 60;
const MAX_AI_MEMORY = 8;
const MAX_USER_MEMORY = 6;
const MAX_FORGOTTEN = 20;
const MAX_CHAT = 60;
const CHAT_DAYS = 3;

function emptyCompanion() {
  return {
    /** null = 还没问过；true/false = 用户的选择 */
    enabled: /** @type {null | boolean} */ (null),
    /** @type {{id:string,text:string,by:'xiaoyu'|'user',at:string}[]} */
    memory: [],
    /** 用户让小屿忘掉的笔记，写信整理笔记时不再记回来 @type {string[]} */
    forgotten: [],
    /** @type {Record<string, {date:string,text:string,by:'ai'|'note',at:string,read:boolean}>} */
    letters: {},
    /** @type {Record<string, {role:'me'|'xiaoyu',text:string,kind:string,at:string}[]>} */
    chats: {},
    /** 当天的 Agent 会话 @type {null | {date:string,id:string}} */
    session: null,
  };
}

function normalizeCompanion(raw) {
  const base = emptyCompanion();
  if (!raw || typeof raw !== 'object') return base;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : null,
    memory: Array.isArray(raw.memory) ? raw.memory.filter((m) => m && typeof m.id === 'string' && typeof m.text === 'string') : [],
    forgotten: Array.isArray(raw.forgotten) ? raw.forgotten.filter((t) => typeof t === 'string') : [],
    letters: obj(raw.letters),
    chats: obj(raw.chats),
    session: raw.session && typeof raw.session === 'object' && typeof raw.session.id === 'string' ? raw.session : null,
  };
}

/** 按字符（而不是 UTF-16 单元）截断 */
export function clipText(value, max) {
  const chars = [...String(value ?? '')];
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('');
}

function ymd(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

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
    companion: emptyCompanion(),
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
    state.companion = normalizeCompanion(raw.companion);
  } catch (error) {
    if (/** @type {any} */ (error)?.code !== 'ENOENT') throw error;
  }
  let version = 0;
  let epoch = 0;
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
      companion: {
        enabled: state.companion.enabled,
        memory: state.companion.memory.map(({ id, text, by }) => ({ id, text, by })),
        letter: state.companion.letters[today] ?? null,
        letters: Object.values(state.companion.letters).sort((a, b) => (a.date < b.date ? 1 : -1)),
        chat: state.companion.chats[today] ?? [],
      },
    };
  }

  /** 发给模型的素材：只取心屿自己的数据，并且逐项限长。 */
  function companionData() {
    const today = localDate();
    const c = state.companion;
    const ago = (date) => Math.round((ymd(today) - ymd(date)) / 86400000);
    const clip = (v, n) => clipText(String(v ?? '').replace(/\s+/g, ' ').trim(), n);
    const moods = Object.keys(state.checkins)
      .sort()
      .reverse()
      .filter((d) => ago(d) <= 14)
      .slice(0, 7)
      .map((d) => ({ date: d, mood: state.checkins[d].mood, note: clip(state.checkins[d].note, 60) }));
    const chatSaid = Object.keys(c.chats)
      .filter((d) => d < today && ago(d) <= 2)
      .sort()
      .flatMap((d) => c.chats[d].filter((m) => m.role === 'me').map((m) => clip(m.text, 60)))
      .slice(-8);
    const letterDates = Object.keys(c.letters).sort();
    const prev = letterDates.filter((d) => d < today).pop();
    const birth = birthProfile(state.profile.birthday, today);
    const todayCheckin = state.checkins[today];
    return {
      today,
      nickname: clip(state.profile.nickname, 20),
      streak: streakOf(state.checkins, today),
      untilBirthday: birth ? birth.untilBirthday : null,
      moods,
      joys: state.joys.slice(-6).reverse().map((j) => ({ date: j.date, text: clip(j.text, 40) })),
      about: PROFILE_QUESTIONS.filter((q) => state.about[q.id] != null).map((q) => ({ q: q.q, a: q.options[state.about[q.id]] })),
      aboutAnswered: PROFILE_QUESTIONS.filter((q) => state.about[q.id] != null).length,
      quiz: state.quiz ? QUIZ_STYLES[state.quiz.style]?.name ?? '' : '',
      card: state.cards[today]?.keyword ?? '',
      aboutIdx: { ...state.about },
      askedBook: state.answers.filter((a) => ago(a.date) <= 2).slice(-2).map((a) => clip(a.question, 40)),
      chatSaid,
      memory: c.memory.filter((m) => m.by === 'xiaoyu').map((m) => m.text),
      userNotes: c.memory.filter((m) => m.by === 'user').map((m) => m.text),
      letterCount: letterDates.length,
      lastLetter: prev ? { date: prev, text: clip(c.letters[prev].text, 140) } : null,
      todayLetter: c.letters[today]?.text ?? '',
      todayMood: todayCheckin ? { mood: todayCheckin.mood, note: clip(todayCheckin.note, 60) } : null,
      todayJoys: state.joys.filter((j) => j.date === today).slice(-3).map((j) => clip(j.text, 40)),
    };
  }

  return {
    snapshot,
    companionData,

    // ---------- 小屿陪伴 ----------
    /** 每次清空数据加一，让清空前发起的 Agent 结果不再写回 */
    epoch: () => epoch,
    /** 只有运行时状态（例如“正在写信”）变了：广播但不落盘 */
    touch() {
      version++;
      try { onChange(version); } catch { /* ignore */ }
    },
    companionEnabled: () => state.companion.enabled,
    companionSession: () => state.companion.session,
    letterOf: (date) => state.companion.letters[date] ?? null,
    checkinOf: (date) => state.checkins[date] ?? null,
    chatOf: (date) => state.companion.chats[date] ?? [],

    setCompanionEnabled(body) {
      if (typeof body?.enabled !== 'boolean') throw new DomainError(400, 'invalid_argument', '开关格式不正确');
      const enabled = body.enabled;
      return mutate(() => {
        state.companion.enabled = enabled;
      });
    },

    addMemory(body) {
      const text = str(body?.text, '要记住的事', 30);
      const c = state.companion;
      if (c.memory.some((m) => m.text === text)) throw new DomainError(409, 'duplicate', '小屿已经记得这件事啦');
      if (c.memory.filter((m) => m.by === 'user').length >= MAX_USER_MEMORY) {
        throw new DomainError(409, 'too_many', `最多让小屿记 ${MAX_USER_MEMORY} 件你亲口说的事`);
      }
      return mutate(() => {
        const cc = state.companion;
        cc.forgotten = cc.forgotten.filter((t) => t !== text);
        cc.memory.push({ id: randomUUID(), text, by: 'user', at: new Date().toISOString() });
        // 记事本变了，当天会话里的素材就旧了：下次换新会话（会带上今天的聊天记录）
        cc.session = null;
      });
    },

    forgetMemory(id) {
      const item = state.companion.memory.find((m) => m.id === id);
      if (!item) throw new DomainError(404, 'not_found', '这条笔记已经不在了');
      return mutate(() => {
        const cc = state.companion;
        cc.memory = cc.memory.filter((m) => m.id !== id);
        // 不管是谁记的，被要求忘掉之后，小屿整理笔记时都不再记回来；这份名单只在本地过滤用，不发给模型
        cc.forgotten = [...cc.forgotten.filter((t) => t !== item.text), item.text].slice(-MAX_FORGOTTEN);
        // 当天会话里还带着这条笔记，换新会话让“忘掉”立刻生效
        cc.session = null;
      });
    },

    /** 写信后整理的笔记：只替换小屿自己记的部分，用户亲口让它记的不动，被要求忘掉的不再记回来。 */
    replaceAiMemory(list) {
      return mutate(() => {
        const cc = state.companion;
        const forgotten = cc.forgotten.filter(Boolean);
        const keep = cc.memory.filter((m) => m.by === 'user');
        const seen = new Set(keep.map((m) => m.text));
        const fresh = [];
        for (const raw of Array.isArray(list) ? list : []) {
          if (typeof raw !== 'string') continue;
          const text = clipText(raw.replace(/\s+/g, ' ').trim(), 30);
          if (!text || seen.has(text) || forgotten.some((f) => text.includes(f) || f.includes(text))) continue;
          seen.add(text);
          fresh.push(cc.memory.find((m) => m.by === 'xiaoyu' && m.text === text) ?? { id: randomUUID(), text, by: 'xiaoyu', at: new Date().toISOString() });
          if (fresh.length >= MAX_AI_MEMORY) break;
        }
        cc.memory = [...keep, ...fresh];
      });
    },

    /** by: 'ai' 是模型写的信；'note' 是离线便条，fallback 表示模型没写成、用便条兜底（不再自动重试）。 */
    putLetter({ date, text, by, fallback = false }) {
      return mutate(() => {
        const cc = state.companion;
        cc.letters[date] = { date, text: clipText(text, 600), by, fallback, at: new Date().toISOString(), read: false };
        const keys = Object.keys(cc.letters).sort();
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_LETTERS))) delete cc.letters[k];
      });
    },

    markLetterFallback(date) {
      if (!state.companion.letters[date]) return Promise.resolve();
      return mutate(() => {
        const l = state.companion.letters[date];
        if (l) l.fallback = true;
      });
    },

    markLetterRead(date) {
      const letter = isValidDate(date) ? state.companion.letters[date] : null;
      if (!letter) throw new DomainError(404, 'not_found', '没有找到这封信');
      if (letter.read) return Promise.resolve(false);
      return mutate(() => {
        const l = state.companion.letters[date];
        if (l) l.read = true;
        return true;
      });
    },

    appendChat(date, msg) {
      return mutate(() => {
        const cc = state.companion;
        const list = cc.chats[date] ?? (cc.chats[date] = []);
        list.push({ role: msg.role, text: clipText(msg.text, 400), kind: msg.kind ?? '', at: new Date().toISOString() });
        if (list.length > MAX_CHAT) list.splice(0, list.length - MAX_CHAT);
        const keys = Object.keys(cc.chats).sort();
        for (const k of keys.slice(0, Math.max(0, keys.length - CHAT_DAYS))) delete cc.chats[k];
      });
    },

    /** at 是发起回应时那条打卡的时间；之后换过贴纸就不再写回旧的回应。 */
    setMoodReply(date, text, at) {
      if (state.checkins[date]?.at !== at) return Promise.resolve(false);
      return mutate(() => {
        const ck = state.checkins[date];
        if (!ck || ck.at !== at) return false;
        ck.reply = clipText(text, 120);
        return true;
      });
    },

    /** 用户在聊天里亲口让小屿记住的事：算作用户的笔记，写信整理时不会被替换。 */
    rememberFromChat(raw) {
      const text = clipText(String(raw ?? '').replace(/\s+/g, ' ').trim(), 30);
      const c = state.companion;
      if (!text || c.memory.some((m) => m.text === text)) return Promise.resolve(false);
      if (c.memory.filter((m) => m.by === 'user').length >= MAX_USER_MEMORY) return Promise.resolve(false);
      return mutate(() => {
        const cc = state.companion;
        cc.forgotten = cc.forgotten.filter((t) => t !== text);
        cc.memory.push({ id: randomUUID(), text, by: 'user', at: new Date().toISOString() });
        return true;
      });
    },

    setCompanionSession(session) {
      return mutate(() => {
        state.companion.session = session;
      });
    },

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
      epoch++;
      return mutate(() => {
        state = emptyState();
      });
    },

    async flush() {
      await queue;
    },
  };
}
