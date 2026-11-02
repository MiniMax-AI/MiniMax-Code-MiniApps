// @ts-check

/**
 * SSE 聊天帧的**唯一真源**（2026-10-29 第八轮「收口」改造）。
 *
 * ⭐ **为什么要有这个文件**：
 * 帧的类型清单以前**手抄在三处** —— 服务端十来个 `broadcastChat()` 调用点、
 * 客户端 `handleChatEvent()` 的 9 个 `case`、还有 CONTRACT 文档里的表格。
 * 抄一次漂一次：服务端加了 `naming` 帧，客户端忘了加 `case`，
 * 那一帧就**静默消失**（`default: break`）—— 改名不生效，却查不出原因
 * （2026-10-29 第八轮实测发现的就是这个悬空帧）。
 *
 * 现在这份清单只有这一份：
 *   - 服务端发帧前先过 `checkFrame()` —— 契约表里没有的帧**发不出去**；
 *   - 服务端把契约表注入页面（`window.__MMX_CHAT_PROTOCOL__`，照 `tracks.mjs` 的模式）；
 *   - 页面按契约表判断帧的类型，不再自己维护一份清单；
 *   - 自检断言「契约表 == 客户端 switch 的 case 集合」（**双向**）。
 *
 * ⚠️ **字段表也是契约的一部分**：字段名写错（比如 `messge`）会让页面收不到内容，
 * 而且一样是静默失败 —— 所以 `checkFrame()` 一并查必填字段。
 */

/**
 * 每种帧的必填字段 + 一句话说明。
 *
 * ⚠️ 字段名**必须和客户端读的完全一样** —— 自检会逐字比对。
 * @type {Record<string, {fields: string[], desc: string}>}
 */
export const CHAT_FRAMES = {
  message: {
    fields: ['message'],
    desc:
      '一条聊天消息（用户的话或她的回复）；' +
      // ⚠️ **text 为空串 = 这条被服务端剥掉了**（第二十九轮）——
      //   服务端落库前会把「工作日志味」的话剥掉；剥空的那条**不写进 chat.json**，
      //   于是用**同一个 id** 广播一条空文本 ⇒ 页面按 id 覆盖并**撤掉那个气泡**
      //   ⇒ 页面和 chat.json 永远对得上（不留空气泡，也不留越界原文）。
      'text 为空串 = 这条被剥掉了 ⇒ 页面撤掉同 id 的气泡',
  },
  delta: {
    fields: ['id', 'text'],
    desc: '流式增量：按气泡 id 追加文本',
  },
  naming: {
    fields: ['naming'],
    desc: '名字/称呼改了 —— 多窗口时别的窗口也要跟着改',
  },
  busy: {
    fields: ['busy'],
    desc: '她正在想（true）/ 想完了（false）',
  },
  done: {
    fields: ['status'],
    desc: '这一轮结束了',
  },
  reset: {
    fields: [],
    desc: '对话被清空',
  },
  permission: {
    fields: ['requestId', 'toolName', 'reason', 'toolInput'],
    desc: '要用户批准一次工具调用',
  },
  permission_resolved: {
    fields: ['requestId'],
    desc: '审批有结果了（批准或拒绝）',
  },
  question_as_text: {
    fields: ['requestId'],
    desc: '问卷被降级成她的一句普通话（问卷机制已撤）',
  },
  diary: {
    fields: ['entries', 'status'],
    desc: '日记本全量（列表 + 状态）',
  },
};

/** 全部帧类型（顺序 = 契约表的书写顺序）。 */
export const CHAT_FRAME_TYPES = Object.keys(CHAT_FRAMES);

/**
 * 契约表的版本号。改了帧的结构就 +1。
 *
 * ⚠️ 页面拿到的表带版本号 —— 老页面配新服务端时能一眼看出版本对不上，
 * 而不是「某个功能莫名其妙没反应」。
 */
export const CHAT_PROTOCOL_VERSION = 1;

/**
 * 帧类型在不在契约表里。
 * @param {unknown} type
 * @returns {boolean}
 */
export function isKnownFrameType(type) {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(CHAT_FRAMES, type);
}

/**
 * 查一帧有没有违反契约。
 *
 * ⚠️ **必填字段用「值不是 undefined」判定**，不是「键在不在」——
 * `busy: false` / `toolInput: null` 都是合法的值；键在但值是 undefined 才算缺。
 *
 * @param {unknown} frame
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function checkFrame(frame) {
  if (!frame || typeof frame !== 'object') return { ok: false, error: '帧不是对象' };
  const anyFrame = /** @type {any} */ (frame);
  const type = anyFrame.type;
  if (!isKnownFrameType(type)) {
    return { ok: false, error: `契约表里没有的帧类型：${String(type)}` };
  }
  const spec = CHAT_FRAMES[/** @type {string} */ (type)];
  for (const field of spec.fields) {
    if (anyFrame[field] === undefined) {
      return { ok: false, error: `帧 ${type} 缺必填字段：${field}` };
    }
  }
  return { ok: true };
}

/**
 * 注入页面的契约表（页面据此判断帧的类型）。
 *
 * ⚠️ 注入前要把 `<` 转义 —— 否则 `</script>` 会提前闭合脚本标签。
 * @returns {string}
 */
export function protocolPayload() {
  return JSON.stringify({
    version: CHAT_PROTOCOL_VERSION,
    types: CHAT_FRAME_TYPES,
    frames: CHAT_FRAMES,
  }).replace(/</g, '\\u003c');
}
