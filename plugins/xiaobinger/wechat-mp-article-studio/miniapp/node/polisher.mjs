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
 *
 * A questionnaire is addressed by its `requestId`. The Host carries that id on
 * the `question.requested` event and on `result.pendingQuestion`, next to the
 * questionnaire itself — never inside it — so the id is kept on its own here.
 * Node names the questionnaire `requestId`; only the page uses `questionId`.
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
      failureMessage: record.failureMessage,
      permission: record.permission,
      question: record.question,
      sessionId: record.sessionId,
      /** True only when the polished text really became a new version. */
      committed: Boolean(record.committed),
      committedVersion: record.committedVersion || 0,
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
   * Commit the polished body as a new version.
   *
   * The status is only `done` when this succeeded, so the page never claims
   * that a version was saved when nothing was written.
   *
   * @param {any} record
   * @param {string} polished
   * @param {(draftId: string, body: string, source: string) => Promise<any>} commit
   */
  async function commitVersion(record, polished, commit) {
    try {
      const saved = await commit(record.draftId, polished, 'agent');
      record.committed = true;
      record.committedVersion = Number(saved?.version ?? 0) || 0;
      record.status = 'done';
    } catch (error) {
      record.status = 'failed';
      record.failureCode = 'COMMIT_FAILED';
      record.failureMessage =
        /** @type {any} */ (error)?.message || '润色内容未能保存为新版本，草稿保持不变。';
    }
  }

  /**
   * Start one polish run.
   *
   * @param {any} draft
   * @param {string} note
   * @param {(draftId: string, body: string, source: string) => Promise<any>} commit
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
      failureMessage: '',
      permission: null,
      question: null,
      /** The questionnaire's id, kept beside the questionnaire and not inside it. */
      questionRequestId: '',
      committed: false,
      committedVersion: 0,
      sessionId: '',
      controller: new AbortController(),
      /** Kept on the record so a continued turn commits exactly like the first one. */
      commit,
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
        record.questionRequestId = String(event.requestId ?? '');
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
          record.questionRequestId = String(result.pendingQuestion.requestId ?? '');
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
        await commitVersion(record, polished, commit);
      } catch (error) {
        record.status = 'failed';
        record.failureCode = /** @type {any} */ (error)?.code || 'AGENT_CALL_FAILED';
        record.failureMessage = /** @type {any} */ (error)?.message || '';
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
   * Answer a questionnaire and continue the turn.
   *
   * The commit callback is the one the run was started with, so a turn that
   * asked a question saves its result the same way a turn that did not.
   *
   * @param {string} callId
   * @param {any[]} answers
   */
  async function answerQuestion(callId, answers) {
    const record = calls.get(callId);
    if (!record || !record.question) return { ok: false, message: '没有待回答的问题' };
    if (!context.agent) return { ok: false, message: 'Agent 不可用' };
    const sessionId = record.sessionId || record.result?.sessionId;
    const requestId = record.questionRequestId;
    if (!sessionId || !requestId) return { ok: false, message: '问题上下文已失效' };
    record.status = 'running';
    record.question = null;
    try {
      const result = await context.agent.answer({ sessionId, requestId, answers }, {});
      record.result = result;
      const polished = typeof result.text === 'string' ? result.text.trim() : '';
      if (result.pendingQuestion) {
        record.questionRequestId = String(result.pendingQuestion.requestId ?? '');
        record.question = result.pendingQuestion.request;
        record.status = 'waiting_answer';
        return { ok: true, message: 'Agent 继续提问' };
      }
      if (result.status === 'finished' && polished) {
        await commitVersion(record, polished, record.commit);
        if (record.status !== 'done') {
          return { ok: false, message: record.failureMessage || '润色内容未能保存为新版本' };
        }
        return {
          ok: true,
          message: record.committedVersion ? `润色完成，已保存为 v${record.committedVersion}` : '润色完成，已保存为新版本',
        };
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
