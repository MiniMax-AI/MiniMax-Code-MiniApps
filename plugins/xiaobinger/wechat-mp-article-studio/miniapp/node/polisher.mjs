// @ts-check

/**
 * 「交给 Agent 润色」 — an Agent turn that rewrites the article body.
 *
 * The turn runs in the Node service (context.agent), because the result has to
 * be committed as a new draft version through the same domain service as every
 * other mutation. The page polls a call record for progress, permission asks
 * and questionnaire steps.
 *
 * The polished text always becomes a *new version*; the previous version is
 * kept, so nothing the user wrote is destroyed by an Agent turn.
 */

import { randomUUID } from 'node:crypto';

export function createPolisher(context) {
  /** @type {Map<string, any>} */
  const calls = new Map();
  /** @type {Map<string, string>} */
  const sessions = new Map();

  /**
   * @param {string} callId
   * @returns {any}
   */
  function read(callId) {
    const record = calls.get(callId);
    if (!record) return null;
    return {
      callId,
      status: record.status,
      draftId: record.draftId,
      streamed: record.streamed,
      result: record.result,
      failureCode: record.failureCode,
      permission: record.permission,
      question: record.question,
      sessionId: record.sessionId,
    };
  }

  /**
   * @param {any} draft
   * @param {string} note
   * @returns {string}
   */
  function buildPrompt(draft, note) {
    const topic = String(draft.topic ?? '').trim();
    const title = String(draft.title ?? '').trim();
    const body = String(draft.body ?? '').trim();
    return [
      '你正在为一篇微信公众号文章做文字润色。请只返回润色后的正文，不要任何解释、前言、后记或代码块围栏。',
      '',
      `文章主题：${topic || '（未填写）'}`,
      `文章标题：${title || '（未填写）'}`,
      note ? `额外要求：${note}` : '额外要求：保持原有事实与数据不变，段落更清晰，节奏更适合移动端阅读。',
      '',
      '请保留原有的结构标记：## 为二级标题、### 为三级标题、> 为引用、- 为列表项、**加粗** 保留。',
      '不要新增事实、案例或数据；不要写标题；不要输出除正文以外的内容。',
      '',
      '--- 原正文开始 ---',
      body,
      '--- 原正文结束 ---',
    ].join('\n');
  }

  /**
   * Start one polish run.
   *
   * @param {any} draft
   * @param {string} note
   * @param {(draftId: string, body: string, source: string) => Promise<void>} commit
   * @returns {{ callId: string }}
   */
  function start(draft, note, commit) {
    const callId = randomUUID();
    const record = {
      callId,
      draftId: draft.id,
      status: 'running',
      streamed: '',
      result: null,
      failureCode: '',
      permission: null,
      question: null,
      sessionId: '',
      controller: new AbortController(),
    };
    calls.set(callId, record);

    if (!context.agent) {
      record.status = 'failed';
      record.failureCode = 'AGENT_UNAVAILABLE';
      return { callId };
    }

    const articleKey = String(draft.articleId ?? draft.id);
    const previousSession = sessions.get(articleKey);
    const text = buildPrompt(draft, note);

    const onEvent = (/** @type {any} */ event) => {
      if (event.type === 'turn.started') {
        record.sessionId = event.sessionId;
        sessions.set(articleKey, event.sessionId);
      } else if (event.type === 'text.delta') {
        record.streamed += event.text;
      } else if (event.type === 'permission.requested') {
        record.permission = {
          sessionId: event.sessionId,
          requestId: event.requestId,
          toolName: event.toolName,
          reason: event.reason,
          toolInput: event.toolInput || '',
        };
      } else if (event.type === 'question.requested') {
        record.question = event.request;
      }
    };

    void (async () => {
      try {
        const result = await context.agent.run(
          previousSession ? { text, sessionId: previousSession } : { text },
          { signal: record.controller.signal, onEvent },
        );
        record.result = result;
        record.sessionId = result.sessionId || record.sessionId;
        sessions.set(articleKey, record.sessionId);
        if (result.pendingQuestion) {
          record.question = result.pendingQuestion.request;
          record.status = 'waiting_answer';
          return;
        }
        const polished = typeof result.text === 'string' ? result.text.trim() : '';
        if (result.status !== 'finished' || !polished) {
          record.status = 'failed';
          record.failureCode = result.error?.code || result.status || 'AGENT_NO_RESULT';
          return;
        }
        await commit(record.draftId, polished, 'agent');
        record.status = 'done';
      } catch (error) {
        record.status = 'failed';
        record.failureCode = /** @type {any} */ (error)?.code || 'AGENT_CALL_FAILED';
      }
    })();

    return { callId };
  }

  /**
   * @param {string} callId
   * @param {'allowOnce'|'deny'} decision
   */
  async function replyPermission(callId, decision) {
    const record = calls.get(callId);
    if (!record || !record.permission) return { ok: false, message: '没有待处理的授权请求' };
    if (!context.agent) return { ok: false, message: 'Agent 不可用' };
    try {
      await context.agent.reply({
        sessionId: record.permission.sessionId,
        requestId: record.permission.requestId,
        decision,
      });
      record.permission = null;
      return { ok: true, message: decision === 'allowOnce' ? '已允许本次调用' : '已拒绝本次调用' };
    } catch (error) {
      return { ok: false, message: `回复授权失败：${/** @type {any} */ (error)?.code || '未知错误'}` };
    }
  }

  /**
   * @param {string} callId
   * @param {any[]} answers
   */
  async function answerQuestion(callId, answers) {
    const record = calls.get(callId);
    if (!record || !record.question) return { ok: false, message: '没有待回答的问题' };
    if (!context.agent) return { ok: false, message: 'Agent 不可用' };
    const sessionId = record.sessionId || record.result?.sessionId;
    const questionId = record.question.requestId;
    if (!sessionId || !questionId) return { ok: false, message: '问题上下文已失效' };
    record.status = 'running';
    record.question = null;
    try {
      const result = await context.agent.answer(
        { sessionId, questionId, answers },
        {},
      );
      record.result = result;
      const polished = typeof result.text === 'string' ? result.text.trim() : '';
      if (result.pendingQuestion) {
        record.question = result.pendingQuestion.request;
        record.status = 'waiting_answer';
        return { ok: true, message: 'Agent 继续提问' };
      }
      if (result.status === 'finished' && polished) {
        record.polished = polished;
        record.status = 'done';
        return { ok: true, message: '润色完成' };
      }
      record.status = 'failed';
      record.failureCode = result.error?.code || result.status || 'AGENT_NO_RESULT';
      return { ok: false, message: 'Agent 未产出可用正文' };
    } catch (error) {
      record.status = 'failed';
      record.failureCode = /** @type {any} */ (error)?.code || 'AGENT_CALL_FAILED';
      return { ok: false, message: `继续对话失败：${/** @type {any} */ (error)?.code || '未知错误'}` };
    }
  }

  /**
   * @param {string} callId
   */
  function cancel(callId) {
    const record = calls.get(callId);
    if (!record) return { ok: false, message: '任务不存在' };
    record.controller.abort();
    if (record.status === 'running') record.status = 'cancelled';
    return { ok: true, message: '已请求取消' };
  }

  return { start, read, replyPermission, answerQuestion, cancel };
}
