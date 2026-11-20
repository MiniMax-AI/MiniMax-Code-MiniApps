// 假 AI：行为和真实宿主的 context.agent 对齐（会话、提问、权限、排队/插话、模型目录）。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 睡 ms 毫秒；被取消就立刻醒 */
const nap = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

export function makeStubAgent({ workDir, sessions = new Map() } = {}) {
  const state = {
    workDir, // 假装宿主说「这个会话在这里干活」；测试里可以改
    runs: [],
    calls: { create: 0, session: 0, models: 0, run: 0, reply: 0, answer: 0 },
    answers: [],
    created: [],
    permWaiters: new Map(),
    pendingQ: new Map(),
    active: 0, // 此刻有几个 run 在跑
    maxActive: 0, // 同时跑过的最大数量
    flags: { askPerm: false, askNext: false, failNext: false, steerNext: false, slowMs: 0 },
  };
  let n = sessions.size;

  async function runInner(input, opts) {
    state.runs.push(input);
    if (!sessions.has(input.sessionId)) throw Object.assign(new Error('not found'), { code: 'SESSION_NOT_FOUND' });
    const on = opts?.onEvent;
    const turnId = 't' + state.runs.length;
    const sessionId = input.sessionId;
    on?.({ type: 'turn.started', sessionId, turnId, model: input.model || { providerId: 'x', modelId: 'other' } });
    on?.({ type: 'tool.started', sessionId, turnId, name: 'run_code' });
    const { flags } = state;
    if (flags.failNext) {
      flags.failNext = false;
      return { sessionId, turnId, status: 'error', error: { code: 'MODEL_ERROR', message: '模型暂时不可用' } };
    }
    if (flags.steerNext) {
      flags.steerNext = false;
      on?.({ type: 'message.steered', sessionId, turnId });
      return { sessionId, turnId, status: 'steered' };
    }
    if (flags.askNext) {
      flags.askNext = false;
      const q = { requestId: 'q-' + turnId, mode: 'questionnaire', request: { schemaVersion: 2, id: 'q-' + turnId, steps: [{ id: 'lang', question: '用中文还是英文？', selectionMode: 'single', options: [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }], allowOther: true }] } };
      state.pendingQ.set(q.requestId, sessionId);
      return { sessionId, turnId, status: 'finished', text: '', pendingQuestion: q };
    }
    if (flags.askPerm) {
      flags.askPerm = false;
      const waiting = new Promise((res) => state.permWaiters.set('req1', res));
      on?.({ type: 'permission.requested', sessionId, turnId, requestId: 'req1', toolName: 'bash', toolInput: 'git status', reason: 'test' });
      const decision = await waiting;
      if (decision === 'deny') return { sessionId, turnId, status: 'finished', text: '被拒绝了，换了办法。' };
    }
    await nap(flags.slowMs || 60, opts?.signal);
    on?.({ type: 'tool.finished', sessionId, turnId, name: 'run_code', ok: true });
    on?.({ type: 'text.delta', sessionId, turnId, text: '讲解中…' });
    if (opts?.signal?.aborted) return { sessionId, turnId, status: 'aborted' };
    return { sessionId, turnId, status: 'finished', text: '## 一句话\n测试讲解 for: ' + input.text.slice(0, 60) };
  }

  const agent = {
    async create() {
      state.calls.create += 1;
      const id = 'sess_' + ++n;
      sessions.set(id, {});
      state.created.push(id);
      return { sessionId: id };
    },
    async session(id) {
      state.calls.session += 1;
      if (!sessions.has(id)) throw Object.assign(new Error('not found'), { code: 'SESSION_NOT_FOUND' });
      return { sessionId: id, workspaceDir: state.workDir, status: 'idle' };
    },
    async models() {
      state.calls.models += 1;
      return {
        models: [
          { providerId: 'minimax', modelId: 'MiniMax-M3.1-Flash', displayName: 'MiniMax M3.1 Flash', variants: ['', 'thinking'], thinking: { efforts: ['default', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'default' } },
          { providerId: 'x', modelId: 'other', displayName: 'Other' },
        ],
        default: { providerId: 'x', modelId: 'other' },
      };
    },
    async run(input, opts) {
      state.calls.run += 1;
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      try {
        return await runInner(input, opts);
      } finally {
        state.active -= 1;
      }
    },
    async reply(r) {
      state.calls.reply += 1;
      state.permWaiters.get(r.requestId)?.(r.decision);
    },
    async answer(input) {
      state.calls.answer += 1;
      state.answers.push(input);
      const real = (input.answers || []).some((a) => (a.selectedOther && a.otherText) || (a.selectedOptionIds || []).length);
      // 与真实宿主一致：全部「跳过」不算回答，续写不会开始
      if (!real) throw Object.assign(new Error('outcome unknown'), { code: 'AGENT_OUTCOME_UNKNOWN' });
      state.pendingQ.delete(input.requestId);
      return { status: 'finished', text: '好的，按默认用中文：这是一个测试项目。', sessionId: input.sessionId, turnId: 'ta' + state.answers.length };
    },
  };
  return { agent, state, sessions, sleep };
}
