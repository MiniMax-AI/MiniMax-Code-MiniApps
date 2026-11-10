// Agent 节点调度：每个 LLM / VLM 节点都是「一次独立会话 + 一次 JSON 回复」。
// 回复不合 schema 就地在同一会话里要求重写；权限与问卷请求上抛给页面由用户决定。
import { randomUUID } from 'node:crypto';
import { detail, kv, list, seconds, text as textBlock } from './detail.mjs';

// 用户可以在插件详情里随时关掉清单声明的权限（docs/package-contract.md「Permission switches」）。
// 关掉之后 context.agent 还在，但调用会以 NOT_PERMITTED 失败、进行中的回合以 aborted 结束。
// 只把错误码丢给用户等于什么都没说，所以错误文本里必须写清楚去哪里重新打开。
export const AGENT_OFF_HINT = '请在 MiniMax Code 的插件详情里把 H3-Image-Executor 的 Agent 权限（session.run）重新打开，然后重试';

export function isNotPermitted(error) {
  return Boolean(error) && (error.code === 'NOT_PERMITTED' || error.message === 'not_permitted');
}

function notPermittedError() {
  const error = new Error('Agent 权限已关闭（NOT_PERMITTED）：' + AGENT_OFF_HINT);
  error.code = 'NOT_PERMITTED';
  return error;
}

export function createAgentRunner(context, host) {
  const pendingPermissions = new Map();
  const running = new Set();
  // 等用户回答的问卷，按问卷的 requestId 记：{ session, request, resolve }。
  const questionWaiters = new Map();

  // 页面一次只画一份问卷：取这个会话最早还在等回答的那份。
  function syncPendingQuestion(session) {
    for (const [requestId, waiter] of questionWaiters) {
      if (waiter.session === session) {
        session.pendingQuestion = { requestId, request: waiter.request };
        return;
      }
    }
    session.pendingQuestion = null;
  }

  // 回合停在问卷上时，run 会带着 pendingQuestion 结束（docs/agent.md「Interaction」）。
  // answer 只能在 run 结束之后调，所以问卷到这时才交给页面；回合被中止（停止、工具预算、关闭进程）时放弃等待。
  function waitForAnswer(session, pending, signal) {
    return new Promise((resolve, reject) => {
      const requestId = String(pending.requestId);
      const finish = () => {
        signal.removeEventListener('abort', onAbort);
        questionWaiters.delete(requestId);
        syncPendingQuestion(session);
      };
      const onAbort = () => {
        finish();
        const error = new Error('question_cancelled');
        error.code = 'REQUEST_CANCELLED';
        reject(error);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      questionWaiters.set(requestId, {
        session,
        request: pending.request,
        resolve: (answers) => {
          finish();
          resolve(answers);
        },
      });
      syncPendingQuestion(session);
      host.onQuestion(session, session.pendingQuestion);
    });
  }

  function handleEvent(session, event, record) {
    if (event.type === 'permission.requested') {
      const record = { requestId: event.requestId, sessionId: event.sessionId, toolName: event.toolName, reason: event.reason || '' };
      session.permissions = session.permissions || [];
      session.permissions.push(record);
      host.onPermission(session, record);
      return;
    }
    // question.requested 不在这里处理：这时 run 还占着会话，提前把问卷挂到页面上，
    // 用户的回答只会以 busy 失败。问卷在 run 返回之后由 runTurn 交给页面。
    if (!record) return;
    if (event.type === 'tool.started') {
      // 按节点计数：规划和评审的工具用量要能分开看，否则没法判断哪一段在拖时间。
      record.toolCalls += 1;
      const toolName = event.toolName || event.name || '未知工具';
      record.tools.push({ name: toolName, at: Date.now() - record.startedAt });
      // 提示词里写"最多 N 次工具"约束不住 agent，必须在运行时硬性执行。
      if (record.maxTools && record.toolCalls > record.maxTools && !record.overBudget) {
        record.overBudget = true;
        host.onProgress(session, record.step, '工具调用已达上限 ' + record.maxTools + ' 次，中断并强制收尾', {
          detail: detail('工具预算耗尽', [
            kv('上限', record.maxTools + ' 次'),
            list('调用序列', record.tools.map((item) => ({ text: item.name, note: '+' + seconds(item.at) }))),
          ]),
        });
        record.controller.abort();
        return;
      }
      host.onProgress(
        session,
        record.step,
        '调用工具 ' + toolName + '（' + record.toolCalls + '/' + (record.maxTools || '∞') + '）',
        {
          // 完整调用序列只在节点收尾时给一次：每调一次工具就重复一遍整串，越到后面越长。
          detail: detail('工具调用', [
            kv('工具', toolName),
            kv('本节点累计', record.toolCalls + ' / ' + (record.maxTools || '∞')),
            kv('节点已运行', seconds(Date.now() - record.startedAt)),
          ]),
        },
      );
    }
    if (event.type === 'turn.started' && event.model) {
      host.onProgress(session, 'agent', '模型 ' + modelLabel(event.model) + ' 已启动', {
        detail: detail('模型', [kv('模型', modelLabel(event.model)), kv('节点', record.step)]),
      });
    }
  }

  async function runTurn(session, text, sessionId, step, maxTools) {
    const controller = new AbortController();
    const started = Date.now();
    const record = {
      controller,
      session,
      sessionId,
      step,
      startedAt: started,
      tools: [],
      toolCalls: 0,
      maxTools: maxTools || 0,
      overBudget: false,
      // 等用户回答问卷的时间，不算进节点耗时和成本。
      waitMs: 0,
    };
    running.add(record);
    const onEvent = (event) => handleEvent(session, event, record);
    try {
      let result = await context.agent.run(
        sessionId ? { text, sessionId } : { text },
        { signal: controller.signal, onEvent },
      );
      // 回合停在问卷上：等页面上的回答，再用 answer 接着跑同一回合，直到它不再提问。
      while (result && result.pendingQuestion && result.pendingQuestion.requestId && !controller.signal.aborted) {
        const pending = result.pendingQuestion;
        const waitStarted = Date.now();
        const answers = await waitForAnswer(session, pending, controller.signal);
        record.waitMs += Date.now() - waitStarted;
        result = await context.agent.answer(
          { sessionId: result.sessionId, requestId: pending.requestId, answers },
          { signal: controller.signal, onEvent },
        );
      }
      return {
        result,
        ms: Date.now() - started - record.waitMs,
        toolCalls: record.toolCalls,
        tools: record.tools,
        overBudget: record.overBudget,
      };
    } catch (error) {
      if (isNotPermitted(error)) throw notPermittedError();
      throw error;
    } finally {
      running.delete(record);
    }
  }

  // 跑一个需要 JSON 回复的节点。
  // - 工具调用超过 maxTools 就在运行时中断，然后在同一会话里强制收尾（保留已经查到的信息）。
  // - 回复不是合法 JSON 时在同一会话里要求重写。
  async function runJson(session, options) {
    const step = options.step;
    const maxTools = options.maxTools || 0;
    let sessionId = null;
    let ms = 0;
    let toolCalls = 0;
    let text = options.instruction;
    const allTools = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      host.onProgress(session, step, attempt === 0 ? '开始' : '收尾中', {
        detail: detail('节点输入 · ' + step, [
          kv('轮次', attempt === 0 ? '首次调用' : '第 ' + (attempt + 1) + ' 次（收尾）'),
          kv('工具预算', (attempt === 0 ? maxTools : 0) + ' 次'),
          textBlock('发给模型的完整提示词', text),
        ]),
      });
      let turn;
      try {
        turn = await runTurn(session, text, sessionId, step, attempt === 0 ? maxTools : 0);
      } catch (error) {
        // 中断后同一会话可能不可用，退回到全新会话强制收尾。
        // 权限被关掉时换会话也没用，直接把带说明的错误交上去。
        if (!sessionId || isNotPermitted(error)) throw error;
        sessionId = null;
        turn = await runTurn(session, options.instruction + '\n\n注意：不要再调用任何工具，直接用现有信息输出最终 JSON。', null, step, 0);
      }
      sessionId = turn.result.sessionId || sessionId;
      ms += turn.ms;
      toolCalls += turn.toolCalls;
      allTools.push(...(turn.tools || []));
      session.cost.agentCalls += 1;
      session.cost.agentMs += turn.ms;
      session.cost.agentTools = (session.cost.agentTools || 0) + turn.toolCalls;
      session.cost.byStep = session.cost.byStep || {};
      const bucket = session.cost.byStep[step] || { calls: 0, ms: 0, tools: 0 };
      bucket.calls += 1;
      bucket.ms += turn.ms;
      bucket.tools += turn.toolCalls;
      session.cost.byStep[step] = bucket;

      if (turn.overBudget) {
        text = '工具调用预算已经用完，不要再调用任何工具。现在就用你已经掌握的信息，直接输出最终 JSON 对象。';
        continue;
      }
      if (turn.result.status !== 'finished') {
        // result.error 是 { code, message } 对象，直接拼字符串会变成 [object Object]，
        // 排查时什么都看不到。展开成「code message」。
        const info = turn.result.error;
        const suffix = info ? '：' + [info.code, info.message].filter(Boolean).join(' ') : '';
        const failure = 'agent_' + turn.result.status + suffix;
        // Host 把这一轮判成 error（实测过一次：第 2 次 LLM 返回后卡 191 秒，整轮 205 秒后 error），
        // 是上游的问题不是我们的问题。换个干净会话再试一次，别让一次抽风把整个节点报废。
        // aborted 是我们自己中断的（工具预算耗尽 / 用户点停止），重试没有意义。
        if (turn.result.status === 'error' && attempt < 2 && session.status !== 'cancelled') {
          host.onProgress(session, step, '本轮被判失败，换新会话重试：' + failure, { level: 'warn' });
          sessionId = null;
          text = options.instruction;
          continue;
        }
        // 不是工具预算（上面已经 continue）也不是用户点了停止，那多半是用户在插件详情里
        // 关掉了 Agent 权限：Host 会把进行中的回合判成 aborted。
        if (turn.result.status === 'aborted' && session.status !== 'cancelled') {
          throw new Error(failure + '：Agent 回合被中止。如果你刚关闭了 Agent 权限，' + AGENT_OFF_HINT);
        }
        throw new Error(failure);
      }
      const lastText = turn.result.text || '';
      const data = extractJson(lastText);
      if (data) {
        host.onProgress(session, step, '完成（' + Math.round(ms / 1000) + 's，' + toolCalls + ' 次工具调用）', {
          durMs: ms,
          detail: detail('节点完成 · ' + step, [
            kv('总耗时', seconds(ms)),
            kv('模型调用', attempt + 1 + ' 次'),
            kv('工具调用', toolCalls + ' 次'),
            list('调用序列', allTools.map((item) => ({ text: item.name, note: '+' + seconds(item.at) }))),
            textBlock('模型最终回复', lastText),
          ]),
        });
        return { data, text: lastText, sessionId };
      }
      text = '上一次回复无法解析成 JSON。请只输出一个合法 JSON 对象，不要 markdown 代码块、不要任何解释文字。';
    }
    throw new Error('agent_json_parse_failed');
  }

  async function decidePermission(requestId, decision) {
    const record = pendingPermissions.get(requestId);
    const target = record || {};
    await context.agent.reply({ sessionId: target.sessionId, requestId, decision });
    pendingPermissions.delete(requestId);
  }

  function trackPermission(record) {
    pendingPermissions.set(record.requestId, record);
  }

  // 页面提交的问卷回答。返回 false 表示这份问卷不在等回答（已经答过、回合已中止、或者不属于这个会话）。
  function answerQuestion(session, requestId, answers) {
    const waiter = questionWaiters.get(String(requestId || ''));
    if (!waiter || waiter.session !== session) return false;
    waiter.resolve(Array.isArray(answers) ? answers : []);
    return true;
  }

  // 只中止这个会话自己的回合（连同它在等的问卷）。以前「停止」调的是 cancelAll，
  // 会把同时在跑的其他会话的回合一起中止，那些会话随后就莫名其妙地失败了。
  function cancelSession(session) {
    for (const record of running) {
      if (record.session === session) record.controller.abort();
    }
  }

  // 只在进程停止（dispose）时用。
  function cancelAll() {
    for (const record of running) record.controller.abort();
    running.clear();
  }

  return { runJson, decidePermission, trackPermission, answerQuestion, cancelSession, cancelAll };
}

function modelLabel(model) {
  if (!model) return '未知';
  if (typeof model === 'string') return model;
  return model.modelId || model.id || model.name || JSON.stringify(model);
}

export function extractJson(text) {
  if (!text) return null;
  const candidates = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* 继续尝试下一个候选 */
    }
  }
  return null;
}
