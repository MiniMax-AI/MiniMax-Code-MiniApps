// @ts-check

/**
 * MMX 姿态轨道表 —— **身体动画的唯一真源**。
 *
 * **为什么要有它**
 * 原来她的四态是 CSS `@keyframes` 各写一条（呼吸 / 晃 / 点头 / 跳），
 * 节奏藏在一堆 `animation:` 声明里：没法编排、没法逐帧调、没法换资产、
 * 也没有任何机器能读。官方 `minimax-pet` 把身体拆成「轨道 + 每帧时长」，
 * 节奏就成了**数据** —— 可查、可 diff、可由文档投影。
 *
 * **这里只管「怎么动」，不管「她是谁」**（判断不许分裂在多处）：
 * - 表情名 / 提示语 → `state.mjs` 的 `MOODS`
 * - 语义状态与回落（celebrate 多久回 idle）→ `state.mjs` 的状态机
 * - 轨道 / 帧 / 每帧时长 / 姿态 → 本文件
 *
 * **帧 = 一个姿态 + 停留多久**。姿态是**结构化参数**而不是 CSS 字符串，
 * 因为 client 要拿它插值、自检要校验它、文档要读它 —— 字符串这三件事都做不了。
 * 单位：x / y = px，r = deg，s = 倍率。
 *
 * **帧有两种来源，同一张表都能装**（这是刻意的，先做时序层不返工）：
 * - `pose` —— 程序化路线：浏览器按这组数插值出姿态。
 *   **现在的定位是「降级兜底」**：webm 片段层是身体动效的主力，
 *   池里一条素材都没有 / 连续 3 次装不出 / 加载超时时才回退到 pose 帧。
 * - `sourceMs` —— 视频路线（**2026-11-02 老板拍板：不做**，见 `ARCHITECTURE.md` §3.2）：
 *   这一帧取自源视频的第几毫秒，像素由图集（PNG 序列）提供。
 *   老板定的身体路线是「生成视频 → 抽帧 → 图集」，官方那条是「几何代码画图集」，
 *   两者产出的都是「一串帧」，播放层完全一样 —— 区别只在帧从哪来。
 *   ⚠️ **为什么不做**：webm 片段层已经把身体动效做完了（真实动作 + alpha + 124 帧），
 *   再产一套 PNG 图集是重复投入；而「真眨眼 / 真口型」需要**分层立绘**，那是另一项更大的决策。
 *   保留 `sourceMs` 字段与判定逻辑（`frameKind()`）：万一真源里真出现这类帧，
 *   页面会**明确回退并留痕**，不静默吞掉。
 *
 * **一帧一姿态，不做假的**：官方 idle 轨里有 660ms 的眨眼帧，
 * 我们只有一张整体立绘、没有分层的眼睛，**做不出真眨眼**，所以不假装 ——
 * idle 轨就是呼吸，不塞一个假的"眨眼"。
 */

/**
 * @typedef {{ x: number, y: number, r: number, s: number }} Pose
 * @typedef {{ ms: number, pose?: Pose, sourceMs?: number }} Frame
 * @typedef {{ frames: Frame[], cycleMs: number }} Track
 */

/** @type {Pose} */
const REST = { x: 0, y: 0, r: 0, s: 1 };

/**
 * @param {Partial<Pose>} patch
 * @returns {Pose}
 */
function pose(patch) {
  return { x: patch.x ?? 0, y: patch.y ?? 0, r: patch.r ?? 0, s: patch.s ?? 1 };
}

/**
 * @param {Frame[]} frames
 * @returns {number}
 */
function cycle(frames) {
  return frames.reduce((sum, frame) => sum + frame.ms, 0);
}

/**
 * 轨道表。键 = 轨道名，值 = 该轨的帧序列。
 *
 * 帧数与时长是**对现有 CSS 观感的等价改写**（不是重新设计）：
 * - idle 呼吸 3.4s → 3 帧 1200/1100/1100
 * - thinking 晃 2.6s → 4 帧 650×4
 * - working 点头 0.9s → 4 帧 225×4
 * - celebrate 跳 0.7s×2 → 6 帧 200/240/180/200/260/320
 *
 * @type {Record<string, Track>}
 */
/**
 * 素材池 —— **轨道与素材之间唯一的连接方式**。
 *
 * **为什么要有这一层**：素材是「一段 webm」，轨道是「她现在是什么状态」，
 * 中间必须有一张对照表 —— 否则池名会散落在清单 / 运行时 / 文档各写一遍，
 * 迟早对不上（这种「同一判断写多处」的坑我们踩过好几次）。
 *
 * - `track@ = 这个池属于哪条表情轨（`null@ = 不是常驻轨，是**事件池**）
 * - `mode@  = `ambient@（常驻循环）/ `once@（播一次就切走）
 *
 * **素材还没全齐时也要能跑**：运行时按本表与素材清单求交集，
 * 一个池里一条都没有 ⇒ 那条轨回退到 pose 帧（契约 §8.5 的降级路径）。
 *
 * @type {Record<string, {track: string|null, mode: 'ambient'|'once'}>}
 */
export const POOLS = {
  idle: { track: 'idle', mode: 'ambient' },
  idle_random: { track: 'idle', mode: 'ambient' },
  turn: { track: 'idle', mode: 'ambient' },
  thinking: { track: 'thinking', mode: 'ambient' },
  whisper: { track: 'thinking', mode: 'ambient' },
  working: { track: 'working', mode: 'ambient' },
  celebrate: { track: 'celebrate', mode: 'once' },
  click: { track: null, mode: 'once' },
  move: { track: null, mode: 'once' },
  drag: { track: null, mode: 'once' },
};

/** 事件池 = 不挂任何表情轨、由事件触发的池（点她 / 自主走位 / 拖拽悬空）。 */
export const EVENT_POOLS = Object.fromEntries(
  Object.entries(POOLS).filter(([, p]) => p.track === null).map(([k, p]) => [k, p])
);

/** 池名清单。 */
export const POOL_KEYS = Object.keys(POOLS);

/** 播放模式。 */
export const TRACK_MODES = { AMBIENT: 'ambient', ONCE: 'once' };

/** 片段层的校验上限（自检与运行时共用同一份数字）。 */
export const SEGMENT_LIMITS = {
  /** 片段加载超时（毫秒）—— 超了就放弃这次换源，别把画面卡住。 */
  maxLoadMs: 10000,
  minDurationMs: 500,
  maxDurationMs: 30000,
  minWeight: 1,
  maxWeight: 100,
};

export const TRACKS = {
  /** 待机：呼吸。首尾同姿态，循环无缝。 */
  idle: {
    frames: [
      { ms: 1200, pose: pose({}) },
      { ms: 1100, pose: pose({ y: -2, s: 1.02 }) },
      { ms: 1100, pose: pose({}) },
    ],
    cycleMs: 3400,
    /** 片段池：这一轨从哪些素材池里取（池 → 轨的归属见 POOLS）。 */
    pools: ['idle', 'idle_random', 'turn'],
    /** ambient = 常驻循环；once = 播一次就切走。 */
    mode: 'ambient',
  },

  /** 思考：慢呼吸 + 轻微左右晃（重心偏一边，别挺直）。 */
  thinking: {
    frames: [
      { ms: 650, pose: pose({ r: -2 }) },
      { ms: 650, pose: pose({ y: -1, s: 1.008 }) },
      { ms: 650, pose: pose({ y: -2, r: 2, s: 1.015 }) },
      { ms: 650, pose: pose({ y: -1, s: 1.008 }) },
    ],
    cycleMs: 2600,
    /** 片段池：思考态 + 碎碎念（说话时的小动作）。 */
    pools: ['thinking', 'whisper'],
    mode: 'ambient',
  },

  /** 工作：快速上下点头。 */
  working: {
    frames: [
      { ms: 225, pose: pose({ s: 1.01 }) },
      { ms: 225, pose: pose({ y: -4, s: 1.01 }) },
      { ms: 225, pose: pose({ s: 1.01 }) },
      { ms: 225, pose: pose({ y: -1, s: 1.01 }) },
    ],
    cycleMs: 900,
    /** 片段池：工作状态档（同一池内随机轮换）。 */
    pools: ['working'],
    mode: 'ambient',
  },

  /** 这一轮结束：跳一下。末两帧停住，由 node 那边 4.5s 后收回 idle。 */
  celebrate: {
    frames: [
      { ms: 200, pose: pose({}) },
      { ms: 240, pose: pose({ y: -16, s: 1.05 }) },
      { ms: 180, pose: pose({ s: 0.97 }) },
      { ms: 200, pose: pose({ y: -4, s: 1.02 }) },
      { ms: 260, pose: pose({}) },
      { ms: 320, pose: pose({}) },
    ],
    cycleMs: 1400,
    /** 片段池：庆祝（一次性演出，播完由 node 侧收回 idle）。 */
    pools: ['celebrate'],
    mode: 'once',
  },
};

/**
 * 表情 → 轨道。**表情名归 state.mjs，这里只做指向。**
 * 自检会断言 `MOOD_KEYS` 里的每个表情在这里都有轨 —— 漏一个就红。
 * @type {Record<string, string>}
 */
export const MOOD_TRACK = {
  idle: 'idle',
  thinking: 'thinking',
  working: 'working',
  celebrate: 'celebrate',
};

/** 轨道名清单。 */
export const TRACK_KEYS = Object.keys(TRACKS);

/** 校验规则上限（自检和 validateTracks 共用同一份数字）。 */
export const LIMITS = {
  minFrames: 2,
  maxFrameMs: 5000,
  minFrameMs: 1,
  maxShiftPx: 60,
  maxRotateDeg: 45,
  minScale: 0.5,
  maxScale: 2,
};

/**
 * 校验一张轨道表。**返回错误清单，空数组 = 合法。**
 *
 * 为什么要「返回错误」而不是「抛异常」：自检要能拿一张**故意改坏的表**
 * 喂进来，断言它**必须**被拒 —— 否则「校验通过」可能是恒真式，
 * 检查器全绿却什么都没查（这条坑我们踩过：断言被自己写的注释喂绿）。
 *
 * @param {any} tracks
 * @param {Record<string, string>} [moodTrack]
 * @returns {string[]} 错误清单（空 = 合法）
 */
export function validateTracks(tracks, moodTrack = MOOD_TRACK) {
  /** @type {string[]} */
  const errors = [];
  if (!tracks || typeof tracks !== 'object' || Array.isArray(tracks)) {
    return ['tracks 不是对象'];
  }
  const names = Object.keys(tracks);
  if (names.length === 0) errors.push('tracks 是空的');

  for (const name of names) {
    const track = tracks[name];
    if (!track || typeof track !== 'object') {
      errors.push(`${name}: 轨道不是对象`);
      continue;
    }
    const frames = track.frames;
    if (!Array.isArray(frames)) {
      errors.push(`${name}: frames 不是数组`);
      continue;
    }
    if (frames.length < LIMITS.minFrames) {
      errors.push(`${name}: 帧数 ${frames.length} < ${LIMITS.minFrames}`);
    }
    let sum = 0;
    frames.forEach((frame, index) => {
      const at = `${name}[${index}]`;
      if (!frame || typeof frame !== 'object') {
        errors.push(`${at}: 帧不是对象`);
        return;
      }
      if (!Number.isInteger(frame.ms) || frame.ms < LIMITS.minFrameMs || frame.ms > LIMITS.maxFrameMs) {
        errors.push(`${at}: ms=${frame.ms} 非法（应为 ${LIMITS.minFrameMs}..${LIMITS.maxFrameMs} 的整数）`);
      } else {
        sum += frame.ms;
      }
      const p = frame.pose;
      const kind = frameKind(frame);
      if (!p && kind !== 'sprite') {
        errors.push(`${at}: 帧既没有 pose 也没有 sourceMs`);
        return;
      }
      if (kind === 'sprite' && (!Number.isFinite(frame.sourceMs) || frame.sourceMs < 0)) {
        errors.push(`${at}: sourceMs=${frame.sourceMs} 非法（应为 ≥0 的有限数）`);
      }
      if (!p) return;
      if (typeof p !== 'object') {
        errors.push(`${at}: pose 不是对象`);
        return;
      }
      for (const key of ['x', 'y', 'r', 's']) {
        if (!Number.isFinite(p[key])) {
          errors.push(`${at}: pose.${key}=${p[key]} 不是有限数`);
        }
      }
      if (Number.isFinite(p.x) && Math.abs(p.x) > LIMITS.maxShiftPx) {
        errors.push(`${at}: pose.x=${p.x} 超出 ±${LIMITS.maxShiftPx}px`);
      }
      if (Number.isFinite(p.y) && Math.abs(p.y) > LIMITS.maxShiftPx) {
        errors.push(`${at}: pose.y=${p.y} 超出 ±${LIMITS.maxShiftPx}px`);
      }
      if (Number.isFinite(p.r) && Math.abs(p.r) > LIMITS.maxRotateDeg) {
        errors.push(`${at}: pose.r=${p.r} 超出 ±${LIMITS.maxRotateDeg}deg`);
      }
      if (Number.isFinite(p.s) && (p.s < LIMITS.minScale || p.s > LIMITS.maxScale)) {
        errors.push(`${at}: pose.s=${p.s} 超出 ${LIMITS.minScale}..${LIMITS.maxScale}`);
      }
    });
    if (track.cycleMs !== sum) {
      errors.push(`${name}: cycleMs=${track.cycleMs} 与帧时长之和 ${sum} 不符`);
    }
    // 片段池：池名必须在 POOLS 里，且该池的归属轨就是本轨。
    // （池名散落各处就会对不上 —— 这条校验是那类错的唯一拦截点。）
    if (track.pools !== undefined) {
      if (!Array.isArray(track.pools)) {
        errors.push(`${name}: pools 不是数组`);
      } else if (track.pools.length === 0) {
        errors.push(`${name}: pools 是空的`);
      } else {
        for (const pool of track.pools) {
          const def = POOLS[pool];
          if (!def) {
            errors.push(`${name}: 片段池 ${pool} 不存在`);
          } else if (def.track !== name) {
            errors.push(`${name}: 片段池 ${pool} 属于轨 ${def.track}，不是 ${name}`);
          }
        }
      }
    }
    if (track.mode !== undefined && !Object.values(TRACK_MODES).includes(track.mode)) {
      errors.push(`${name}: mode=${track.mode} 非法`);
    }
  }

  // 表情 → 轨道 必须全覆盖，且指向真实存在的轨。
  for (const [mood, trackName] of Object.entries(moodTrack || {})) {
    if (!names.includes(trackName)) {
      errors.push(`表情 ${mood} 指向不存在的轨 ${trackName}`);
    }
  }
  return errors;
}

/**
 * 校验素材清单 —— 运行时与素材之间那份对照表。
 *
 * **清单是什么**：每个已验收的 webm 片段一条（key / url / 池 / 时长 / 帧数 / 权重）。
 * 它同时是**白名单**（只有清单里的 key 能被服务）与**事实表**。
 *
 * **为什么单独一个函数**：轨道表校验的是「她该怎么动」，清单校验的是「素材本身对不对」。
 * 两件事的坏法不一样，判据也不一样 —— 合成一个函数，注入时就分不清是谁该背锅。
 *
 * @param {any} manifest
 * @param {Record<string, {track: string|null, mode: string}>} [pools]
 * @returns {string[]} 错误清单（空 = 合法）
 */
export function validateSegments(manifest, pools = POOLS) {
  /** @type {string[]} */
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['素材清单不是对象'];
  }
  const segments = manifest.segments || {};
  for (const [key, seg] of Object.entries(segments)) {
    const at = `segments.${key}`;
    if (!seg || typeof seg !== 'object') {
      errors.push(`${at}: 不是对象`);
      continue;
    }
    if (!seg.url || typeof seg.url !== 'string') {
      errors.push(`${at}: 缺 url`);
    }
    const def = pools[seg.pool];
    if (!def) {
      errors.push(`${at}: 池 ${seg.pool} 不存在`);
    } else if ((def.track || null) !== (seg.track || null)) {
      errors.push(`${at}: 池 ${seg.pool} 归属轨是 ${def.track}，清单写的是 ${seg.track}`);
    }
    if (!Number.isFinite(seg.durationMs)
      || seg.durationMs < SEGMENT_LIMITS.minDurationMs
      || seg.durationMs > SEGMENT_LIMITS.maxDurationMs) {
      errors.push(`${at}: durationMs=${seg.durationMs} 非法（${SEGMENT_LIMITS.minDurationMs}..${SEGMENT_LIMITS.maxDurationMs}）`);
    }
    if (!Number.isFinite(seg.weight)
      || seg.weight < SEGMENT_LIMITS.minWeight
      || seg.weight > SEGMENT_LIMITS.maxWeight) {
      errors.push(`${at}: weight=${seg.weight} 非法（${SEGMENT_LIMITS.minWeight}..${SEGMENT_LIMITS.maxWeight}）`);
    }
    if (!Number.isInteger(seg.frames) || seg.frames < 1) {
      errors.push(`${at}: frames=${seg.frames} 非法`);
    }
  }
  return errors;
}

/**
 * 帧的**呈现方式**。**由真源判定，页面侧不猜。**
 *
 * - `'pose'`   → 对整张立绘做 transform（**现在**：只有一张 g10，程序化微动）
 * - `'sprite'` → 从图集里取一格（**将来**：视频抽帧成 PNG 图集后的逐帧播放）
 *
 * 判定只看帧上有没有 `sourceMs` —— 帧是「从源视频第几毫秒抽出来的」，
 * 它的像素就不在立绘里，而在图集里。这条判断必须**只有一处**，
 * 所以它在真源里算好、由服务端注入，页面只按 `kind` 分派。
 *
 * @param {any} frame
 * @returns {'pose' | 'sprite'}
 */
export function frameKind(frame) {
  return frame && frame.sourceMs !== undefined ? 'sprite' : 'pose';
}

/**
 * 把姿态拼成 CSS transform。
 * @param {Pose} p
 * @returns {string}
 */
export function poseToTransform(p) {
  const parts = [];
  if (p.x) parts.push(`translateX(${p.x}px)`);
  if (p.y) parts.push(`translateY(${p.y}px)`);
  if (p.r) parts.push(`rotate(${p.r}deg)`);
  if (p.s !== 1) parts.push(`scale(${p.s})`);
  return parts.length ? parts.join(' ') : 'none';
}
