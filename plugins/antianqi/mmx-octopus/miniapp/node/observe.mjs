// @ts-check

/**
 * 观察通道（2026-10-29 第八轮从 `server.mjs` 抽出来）。
 *
 * ⭐ **为什么抽**：
 * `server.mjs` 原来是一个 1836 行的 `start()` 闭包，里面塞了三件不相干的事：
 * 聊天回合、身份层、**观察通道**。观察通道自己又带着 16 个函数和一整套
 * 共享闭包变量（订阅取消器 / 重试计时器 / 退避次数 / 看板计时器 / 轮次正文缓存），
 * 和聊天逻辑挤在一起 —— 改一句「她怎么庆祝」要在一个满是聊天代码的大函数里找。
 *
 * 现在它是一个模块：**只认注入进来的 `context` 和 `state`**，
 * 自己的状态全在自己的闭包里，不再靠 `server.mjs` 的外层变量。
 *
 * 它管三件事：
 *   1. **订阅** Agent 的事件（`turn.started` / `message.committed` / `turn.finished`），
 *      让她的表情跟着 MCode 在干什么走；
 *   2. **看板**：每 30 秒查一次 `sessions()`，面板上显示「正在跑」；
 *   3. **轮次摘要**：一轮结束时播一句「这一轮做完了：<结论>」。
 *
 * ⚠️ **G2~G5 的行为口径不变**（自检起一套真 server + mock Agent 打过来验）：
 *   - G2：宿主明确没有 `agent.observe` 能力 → 一次都不试，也不重试；
 *   - G3：`observe` 报 BUSY / NOT_PERMITTED → 不可重试，别白跑 10 次退避；
 *   - G4：重连后错过的事件不会重放 → 订阅成功后用 `sessions()` 校准一次状态；
 *   - G5：没有 `message.committed` 确证 → 不庆祝（后台子任务可能还在跑）。
 */

import { summarize } from './summarize.mjs';

/** 状态看板的刷新节拍：每 30 秒查一次 sessions()。 */
const BOARD_INTERVAL = 30000;

/** 正文最多留多少字符（摘要只需要开头）。 */
const TURN_TEXT_MAX = 4000;

/** 最多同时记多少个会话的正文（防内存无上限增长）。 */
const TURN_TEXT_SESSIONS = 50;

/**
 * 建一套观察通道。
 *
 * @param {{context: any, state: any, onTaskEvent?: (lineKey: string) => Promise<boolean> | boolean}} deps
 * @returns {{
 *   agentAvailable: boolean,
 *   observeCapability: string,
 *   observeSupported: boolean,
 *   scheduleObserve: () => void,
 *   scheduleBoard: () => void,
 *   restartObserve: () => void,
 *   stopObserve: () => void,
 *   listSessions: () => Promise<Array<any> | null>,
 *   runningSince: Map<string, number>,
 *   dispose: () => void,
 * }}
 */
export function createObserve({ context, state, onTaskEvent = null }) {
  // 这几个在 createServer 之前算好：请求处理器会读它们，不能等到后面才初始化。
  const agentAvailable = !!context.agent;
  const capabilitiesKnown = !!context.capabilities;
  const observeCapability = context.capabilities
    ? String(context.capabilities.has('agent.observe'))
    : 'no-capabilities';
  // G2 能力门控：宿主明确说它没有 agent.observe 能力时，别再白跑 10 次退避重试。
  // 宿主连 capabilities 表都没有（老宿主）→ 不知道就别拦，交给退避重试去试。
  // 注意：capabilities 反映的是**宿主能力**，不是清单授权。
  const observeSupported = capabilitiesKnown ? observeCapability === 'true' : true;

  /**
   * 日志走宿主 logger —— stdout 属宿主，包内代码不写 stdout。
   * logger 缺失时静默（老宿主 / 自检 mock 可能没有它）。
   * @param {string} code @param {Record<string, unknown>} [fields]
   */
  function logInfo(code, fields) {
    if (context.logger && typeof context.logger.info === 'function') context.logger.info(code, fields);
  }

  /**
   * 文本类日志：字段名固定为 text。
   * 单独一个入口，是为了 `if (summary) { ... }` 块里不出现花括号 ——
   * 自检判「一轮只播一条」是按结构扫的（if 块里有 return），块里出现 `}` 会让它扫不到。
   * @param {string} code @param {unknown} text
   */
  function logText(code, text) {
    logInfo(code, { text: String(text ?? '') });
  }

  /** @type {AbortController | null} 当前订阅的取消器 */
  let observeAbort = null;
  /** @type {NodeJS.Timeout | null} 首次订阅与退避重试的计时器 */
  let observeTimer = null;
  let observeAttempts = 0;
  let observeStarted = false;
  /** @type {NodeJS.Timeout | null} 看板刷新计时器 */
  let boardTimer = null;
  let boardStarted = false;
  /**
   * 这一轮有没有真的产出回复（按会话记）。
   * turn.finished 只说明**根回合**结束，后台子任务可能还在跑，
   * 所以没有确证就不庆祝（见 agent-interaction.md:23-26）。
   * @type {Map<string, boolean>}
   */
  const turnCommitted = new Map();

  /**
   * 这一轮的**最终回复正文**（按会话记）。
   *
   * 宿主 `message.committed` 事件带 `text` 字段，而且是**保证送达**的
   * （「never dropped the final reply」）—— 数据一直送到门口，
   * 以前只是没用（只置了个布尔标记，正文直接扔了）。
   * 现在用它做一句短摘要，把「《标题》这一轮结束了」升级成
   * 「这一轮做完了：<结论>」。
   *
   * **只存截断后的片段** —— 摘要只需要开头，存全文是浪费内存。
   * @type {Map<string, string>}
   */
  const turnText = new Map();

  /** @type {Map<string, number>} 会话第一次被看见是 running 的时间戳（内存态，不持久化） */
  const runningSince = new Map();

  /**
   * 记下这一轮的最终回复正文。
   *
   * 一个 turn 可能有多条 `message.committed`（宿主规范原话：
   * 「a turn can have several」）→ **保留最后一条**：
   * 最后一条才是这一轮的最终结论。
   *
   * @param {string} key 会话 id
   * @param {string} text 正文
   */
  function noteTurnText(key, text) {
    const body = String(text ?? '');
    if (!body.trim()) return;
    // 超限时丢最旧的一条（Map 保持插入序）
    while (turnText.size >= TURN_TEXT_SESSIONS) {
      const oldest = turnText.keys().next();
      if (oldest.done) break;
      turnText.delete(oldest.value);
    }
    turnText.set(key, body.slice(0, TURN_TEXT_MAX));
  }

  /**
   * 取这一轮的最终回复正文并**清掉**（读完即弃，不留残留）。
   * @param {string} key
   * @returns {string}
   */
  function takeTurnText(key) {
    const body = turnText.get(key) ?? '';
    turnText.delete(key);
    return body;
  }

  /**
   * 按当前观察范围算出 observe 的目标参数。observe 要求 all 与 sessionId 二选一。
   * @returns {{all: true} | {sessionId: string}}
   */
  function observeTarget() {
    if (state.scope === 'current' && state.scopeSessionId) {
      return { sessionId: state.scopeSessionId };
    }
    return { all: true };
  }

  /**
   * 列出可见会话。调不通返回 null（降级信号）。
   * @returns {Promise<Array<any> | null>}
   */
  async function listSessions() {
    if (typeof context.agent?.sessions !== 'function') return null;
    try {
      const result = await context.agent.sessions();
      // 调通了就把之前的失败原因擦掉。
      // 宿主激活有延迟，第一个请求进来时 sessions() 可能还报
      // 「Mini App Agent is unavailable」——那是一次性的早期失败，
      // 不擦掉的话面板会一直挂着这条错误，误导成「通道坏了」。
      state.setAgentTracking({ sessionsError: null });
      return Array.isArray(result?.sessions) ? result.sessions : [];
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      // 只记 sessionsError：通用的 error 字段归观察订阅自己管。
      state.setAgentTracking({ sessionsError: reason });
      return null;
    }
  }

  /**
   * 还有没有会话在跑。调不通返回 null，让调用方走降级路径。
   * @returns {Promise<boolean | null>}
   */
  async function anySessionRunning() {
    const list = await listSessions();
    if (list === null) return null;
    return list.some((item) => item && item.status === 'running');
  }

  /**
   * 一轮结束：还有别的会话在跑就保持工作中，没有才庆祝。
   * sessions() 调不通就退回「最后一个事件说了算」。
   *
   * G5：`committed` 为 false 表示这一轮没有 message.committed ——
   * 也就是没有拿到「活真的干完了」的确证。这种情况下**不庆祝**，
   * 免得在后台子任务还在跑的时候给出错误的安全感。
   * @param {string | null} title
   * @param {boolean} [committed]
   */
  async function settleAfterTurn(title, committed = true) {
    const running = await anySessionRunning();
    if (running === null) {
      await state.setAgentState(committed ? 'done' : 'working', title);
      return;
    }
    await state.setAgentState(running ? 'working' : committed ? 'done' : 'working', title);
  }

  /**
   * 重连后校准一次状态。
   *
   * G4：observe 错过的事件**不会重放**（`agent-interaction.md:353-354`）。
   * 所以重新订阅成功后，要用当前的会话列表把状态拉回真实值，
   * 而不是让它停在断线前的旧值。
   *
   * 没有在跑的会话时回到**待机**而不是庆祝 —— 没拿到确证就不庆祝。
   * @param {Array<any>} list
   * @returns {Promise<void>}
   */
  async function calibrateAgentState(list) {
    const scopeId = state.scope === 'current' ? state.scopeSessionId : null;
    const running = list.some((item) => {
      if (!item || item.status !== 'running') return false;
      if (scopeId) return String(item.sessionId ?? '') === scopeId;
      return true;
    });
    await state.setAgentState(running ? 'working' : 'idle', null);
  }

  /**
   * 刷新设置区看板的「正在跑」。
   * sessions() 调不通 → 保留上一次的值，不清空、不填兜底。
   * @returns {Promise<void>}
   */
  async function refreshBoard() {
    const list = await listSessions();
    if (list === null) return;
    const now = Date.now();
    const running = [];
    for (const item of list) {
      if (!item || item.status !== 'running') continue;
      const sessionId = String(item.sessionId ?? '');
      if (!sessionId) continue;
      if (!runningSince.has(sessionId)) runningSince.set(sessionId, now);
      running.push({
        sessionId,
        title: String(item.title ?? ''),
        status: 'running',
        sinceAt: runningSince.get(sessionId) ?? now,
      });
    }
    // 不在跑的会话从内存表里清掉：它下次再跑起来，用时要从头算。
    for (const sessionId of [...runningSince.keys()]) {
      if (!running.some((row) => row.sessionId === sessionId)) runningSince.delete(sessionId);
    }
    await state.setBoard({ running: running.slice(0, 8), recent: state.board.recent });
  }

  /**
   * 一轮结束时的两件事：
   *  1) 记进「最近完成」
   *  2) 冒一句这一轮的**摘要**
   *
   * ⚠️ **一轮只播一条**（老板拍板：总结一次最好）——
   * 有最终回复正文 → 播摘要；读不到正文 → 退回泛泛的兜底文案。
   * **不两条都发**：那是噪音。
   *
   * @param {any} event
   * @param {string} [replyText] 这一轮的最终回复正文（`message.committed` 的 text）
   */
  async function noteTurnFinished(event, replyText = '') {
    const sessionId = typeof event?.sessionId === 'string' ? event.sessionId : '';
    const title = typeof event?.title === 'string' ? event.title : '';
    const status = typeof event?.status === 'string' ? event.status : 'finished';
    const recent = [
      { sessionId, title, status, finishedAt: Date.now() },
      ...state.board.recent.filter((row) => row.sessionId !== sessionId),
    ].slice(0, 5);
    await state.setBoard({ running: state.board.running, recent });

    const list = await listSessions();
    if (list === null) return; // 调不通就不说：气泡只说确证的事。
    const anyRunning = list.some((item) => item && item.status === 'running');
    if (anyRunning) return;
    if (!title) return;

    // 有正文 → 播摘要；没有正文（宿主读不到最终回复）→ 兜底文案。
    // ⚠️ 正文有两个入口：`message.committed.text` 与 `turn.finished.text`
    // （宿主规范：turn.finished carries the same `text?`）。
    // 哪个先到用哪个 —— 同一个数据源的两个入口，不是两个判断。
    // ★ **第三十七轮：轮次播报豁免时间闸门** ——
    //   它是通知层的核心承诺（老板拍板「总结一次最好」），被 9 秒窗口吞掉就等于没播。
    //   但它**照样占住时钟**：她确实开口了 ⇒ 紧接着的庆祝台词会让位。
    state.noteSpoke();
    state.markRoundLineSpoken();
    const summary = summarize(replyText || event?.text || '');
    if (summary) {
      logText('miniapp.agent.observe.turn_summary', summary);
      await state.say(summary, 'MMX').catch(() => undefined);
      return;
    }
    logInfo('miniapp.agent.observe.turn_summary_fallback', { title });
    await state.say(`《${title}》这一轮结束了`, 'MMX').catch(() => undefined);
  }

  /** 掐断当前订阅与待执行的重试。 */
  function stopObserve() {
    if (observeTimer) {
      clearTimeout(observeTimer);
      observeTimer = null;
    }
    if (observeAbort) {
      try {
        observeAbort.abort();
      } catch {
        // 忽略取消时的异常。
      }
      observeAbort = null;
    }
  }

  /**
   * 这些错误重试也没用：重试只会白刷日志。
   * BUSY：每个 Mini App 的 observer 数超了（`agent-interaction.md:352`，**不可重试**）
   * NOT_PERMITTED：宿主不给了
   * 其余（unavailable 等）才值得退避重试。
   * @param {unknown} raw
   * @returns {boolean}
   */
  function isFatalObserveError(raw) {
    const code = String(raw ?? '').toUpperCase();
    return code.includes('BUSY') || code.includes('NOT_PERMITTED');
  }

  /**
   * 不可重试的错误，说人话。
   * @param {unknown} raw
   * @returns {string}
   */
  function explainObserveError(raw) {
    const code = String(raw ?? '').toUpperCase();
    if (code.includes('BUSY')) return '观察通道忙（超过宿主允许的观察数），稍后会自动重试';
    if (code.includes('NOT_PERMITTED')) return '宿主没有给观察权限';
    return String(raw ?? 'unknown');
  }

  function attemptObserve() {
    if (context.signal.aborted) return;
    // G2 能力门控：宿主明确没有 agent.observe 能力 → 一次都不试，也不重试。
    if (!observeSupported) {
      state.setAgentTracking({ subscribed: false, error: '宿主未提供 agent.observe 能力' });
      return;
    }
    observeAttempts += 1;
    state.setAgentTracking({ attempts: observeAttempts });

    const controller = new AbortController();
    observeAbort = controller;
    const target = observeTarget();

    const onEvent = async (event) => {
      if (!event || typeof event !== 'object') return;
      const type = String(event.type ?? '');
      const eventSessionId = typeof event.sessionId === 'string' ? event.sessionId : null;

      // 范围过滤：只认目标会话的事件，别的会话不该把她带着乱跳。
      if (state.scope === 'current' && state.scopeSessionId && eventSessionId !== state.scopeSessionId) {
        return;
      }

      state.setAgentTracking({
        subscribed: true,
        lastEventType: type,
        lastEventAt: Date.now(),
        error: null,
      });

      // G5：记下这一轮有没有真的产出回复。
      // turn.finished 只说明**根回合**结束，后台的子任务可能还在跑
      // （agent-interaction.md:23-26）。没有确证就不庆祝，
      // 免得给出错误的安全感。
      const key = eventSessionId ?? 'unknown';
      if (type === 'turn.started') {
        turnCommitted.set(key, false);
        // ★ **任务事件台词**（B 类，第三十七轮）：真的有活儿开始了。
        //   ⚠️ **先说、再改状态** —— 状态一改，「工作状态台词」也会想冒一句；
        //     先说任务台词 ⇒ 它把这一轮标记成「已说过」⇒ 工作状态台词让位（不撞车）。
        if (onTaskEvent) await onTaskEvent('task.started');
        void state.setAgentState('working', event.title ?? null);
      } else if (type === 'message.committed') {
        turnCommitted.set(key, true);
        // **最终回复正文就在事件里**（`text` 字段），而且宿主保证送达。
        // 以前只置了个布尔标记就把它扔了 —— 现在留下来做摘要。
        noteTurnText(key, event.text);
        // **现场留痕**：正文到底有多长、前几个字是什么。
        // 万一摘要没出来，这一行能立刻分清是「宿主没给正文」还是「摘要逻辑有问题」。
        logInfo('miniapp.agent.observe.message_committed', {
          length: String(event.text ?? '').length,
          head: String(event.text ?? '').slice(0, 40).replace(/\s+/g, ' '),
        });
      } else if (type === 'turn.finished') {
        const committed = turnCommitted.get(key) === true;
        turnCommitted.delete(key);
        // ★ 心情与亲密度（契约 §6.1）：完成一轮对话且**有确证产出** ⇒ intimacy +1 / heart +2。
        //   ⚠️ **判据 = 事件类型**（turn.finished ＋ 该回合有 message.committed），
        //   **不读模型输出文本** —— 跟 G5「确证才庆祝」用的是同一个 committed 标志。
        if (committed) void state.applyTurnFinishedBump().catch(() => undefined);
        // 先把正文取走（读完即弃），再交给播报逻辑用。
        const replyText = takeTurnText(key);
        // ⚠️ **第三十七轮：顺序变了** —— 先播**轮次摘要**（信息量最大、豁免时间闸门），
        //   再改状态。状态一改就是 celebrate ⇒「庆祝台词」被摘要顶掉
        //   （闸门 + 让位）⇒ **一轮只播一次结果**（老板拍板「总结一次最好」）。
        await noteTurnFinished(event, replyText);
        await settleAfterTurn(event.title ?? null, committed);
      }
    };

    try {
      const promise = context.agent.observe(target, { signal: controller.signal, onEvent });
      state.setAgentTracking({ subscribed: true, error: null });

      // 只读探针：能列出会话就说明 agent API 在激活后完全可用。
      // 顺带把「她能看到几个会话」摆在面板上，权限是明账。
      //
      // G4：重连后错过的事件不会重放，所以订阅成功后要**校准一次**状态，
      // 不能让它停在断线前的旧值。
      void listSessions().then((list) => {
        if (!list) return;
        state.setAgentTracking({
          sessions: list.length,
          sessionTitle: list.length ? String(list[0].title ?? '') : null,
        });
        void calibrateAgentState(list);
      });

      promise.catch((error) => {
        if (controller.signal.aborted) return; // 我们自己取消的，不算失败。
        const reason = error instanceof Error ? error.message : 'unknown';
        // G3：BUSY / NOT_PERMITTED 不可重试，别白跑 10 次退避。
        if (isFatalObserveError(reason)) {
          state.setAgentTracking({ subscribed: false, error: explainObserveError(reason) });
          // ★ 观察通道彻底断了（D 类 func.observe_down）：她看得见外面才说得出「在忙什么」。
          //   ⚠️ **豁免时间闸门**（第三十七轮）—— 降级话术必须给用户反馈，
          //     吞了她就一声不吭（用户会以为她死了）。
          state.noteSpoke();
          const pickedDown = state.nextSceneLine('func.observe_down', null);
          if (pickedDown) void state.say(pickedDown.text, 'MMX').catch(() => undefined);
          context.logger.warn('miniapp.agent.observe.fatal', { reason, attempt: observeAttempts });
          return;
        }
        state.setAgentTracking({ subscribed: false, error: reason });
        context.logger.warn('miniapp.agent.observe.failed', { reason, attempt: observeAttempts });
        if (observeAttempts < 10) {
          observeTimer = setTimeout(attemptObserve, Math.min(1500 * observeAttempts, 8000));
        }
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      if (isFatalObserveError(reason)) {
        state.setAgentTracking({ subscribed: false, error: explainObserveError(reason) });
        context.logger.warn('miniapp.agent.observe.fatal', { reason, attempt: observeAttempts });
        return;
      }
      state.setAgentTracking({ subscribed: false, error: reason });
      context.logger.warn('miniapp.agent.observe.failed', { reason, attempt: observeAttempts });
      if (observeAttempts < 10) {
        observeTimer = setTimeout(attemptObserve, Math.min(1500 * observeAttempts, 8000));
      }
    }
  }

  /**
   * 首个请求到达后订阅（宿主在 start() resolve 之后才激活）。
   */
  function scheduleObserve() {
    if (observeStarted || !agentAvailable || context.signal.aborted) return;
    observeStarted = true;
    // G2：宿主明确不支持 observe —— 直说，不做无意义的退避重试。
    if (!observeSupported) {
      state.setAgentTracking({ subscribed: false, error: '宿主未提供 agent.observe 能力' });
      context.logger.warn('miniapp.agent.observe.unsupported', { capability: observeCapability });
      return;
    }
    observeTimer = setTimeout(attemptObserve, 900);
  }

  /**
   * 看板刷新：等首个请求到了再开始（那时宿主才刚激活，sessions() 未必已经可用）。
   * 所以第一次刷新要往后推一拍，避开激活窗口；之后每 30 秒刷一次。
   * 调不通就保留上一次的值，不清空、不填兜底。
   */
  function scheduleBoard() {
    if (boardStarted || !agentAvailable || context.signal.aborted) return;
    boardStarted = true;
    // 激活延迟是毫秒级的，1 秒足够越过；太早调用只会拿到一次假的失败。
    boardTimer = setTimeout(() => {
      if (context.signal.aborted) return;
      void refreshBoard();
      boardTimer = setInterval(() => {
        void refreshBoard();
      }, BOARD_INTERVAL);
    }, 1000);
  }

  /**
   * 切换观察目标：先掐断旧订阅，再按新目标重新订阅。
   * 时序不变 —— 切换一定发生在请求处理器里，此时宿主必然已激活。
   */
  function restartObserve() {
    if (!agentAvailable || context.signal.aborted) return;
    stopObserve();
    observeAttempts = 0;
    observeStarted = true;
    observeTimer = setTimeout(attemptObserve, 900);
  }

  /**
   * 关停：掐断订阅 + 停掉看板计时器。
   *
   * ⚠️ `boardTimer` 先是个 `setTimeout`（激活窗口），之后才换成 `setInterval` ——
   * 两个都得清，否则关停之后还会多刷一次。
   */
  function dispose() {
    stopObserve();
    if (boardTimer) {
      clearTimeout(boardTimer);
      clearInterval(boardTimer);
      boardTimer = null;
    }
  }

  return {
    agentAvailable,
    observeCapability,
    observeSupported,
    scheduleObserve,
    scheduleBoard,
    restartObserve,
    stopObserve,
    listSessions,
    runningSince,
    dispose,
  };
}
