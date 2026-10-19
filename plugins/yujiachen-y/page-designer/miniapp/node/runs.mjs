// @ts-check
// Agent turns. Every page owns one hidden MiniMax Code session; each message the user sends
// from the page is one turn in it, run from Node so it keeps going when the panel closes.
import { randomBytes } from 'node:crypto';
import { firstTurnText, followUpText } from './prompts.mjs';
import { StudioError, cleanText } from './store.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppAgentClient} MiniAppAgentClient */
/** @typedef {import('./miniapp-api.js').MiniAppAgentRunEvent} MiniAppAgentRunEvent */
/** @typedef {import('./miniapp-api.js').MiniAppAgentModelSelection} ModelSelection */

export const MAX_MESSAGE_CHARS = 20_000;
const MAX_LIVE_TEXT = 20_000;

/** @param {unknown} error */
export function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(/** @type {any} */ (error).code) : 'UNKNOWN';
}

/**
 * Accept a model selection from the page in the shape `models()` returns. The Host validates
 * it again against the catalog.
 * @param {unknown} value
 * @returns {ModelSelection | null}
 */
export function selectionFrom(value) {
  if (!value || typeof value !== 'object') return null;
  const raw = /** @type {Record<string, any>} */ (value);
  const providerId = cleanText(raw.providerId, 160);
  const modelId = cleanText(raw.modelId, 160);
  if (!providerId || !modelId) return null;
  /** @type {Record<string, any>} */
  const selection = { providerId, modelId };
  if (typeof raw.variant === 'string' && raw.variant.length <= 80) selection.variant = raw.variant;
  const effort = raw.thinking && typeof raw.thinking === 'object' ? cleanText(raw.thinking.effort, 40) : '';
  if (effort) selection.thinking = { effort };
  return /** @type {ModelSelection} */ (selection);
}

/**
 * Validate questionnaire answers from the page.
 * @param {unknown} value
 */
export function answersFrom(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new StudioError('invalid', 'The answer is incomplete.');
  }
  return value.map((item) => {
    const raw = item && typeof item === 'object' ? /** @type {Record<string, any>} */ (item) : {};
    const stepId = cleanText(raw.stepId, 200);
    if (!stepId) throw new StudioError('invalid', 'The answer is incomplete.');
    const selectedOptionIds = Array.isArray(raw.selectedOptionIds)
      ? raw.selectedOptionIds.map((id) => cleanText(id, 200)).filter(Boolean).slice(0, 20)
      : [];
    /** @type {Record<string, any>} */
    const answer = { stepId, selectedOptionIds, selectedOther: raw.selectedOther === true };
    const otherText = cleanText(raw.otherText, 4000);
    if (answer.selectedOther && otherText) answer.otherText = otherText;
    if (raw.skipped === true) answer.skipped = true;
    return answer;
  });
}

/**
 * One line per step for the transcript: the chosen labels, the typed text, or a skip mark.
 * @param {any} request @param {any[]} answers
 */
export function answerSummary(request, answers) {
  const steps = Array.isArray(request?.steps) ? request.steps : [];
  return answers
    .map((answer) => {
      const step = steps.find((/** @type {any} */ item) => item?.id === answer.stepId);
      if (answer.skipped) return '—';
      const labels = answer.selectedOptionIds.map(
        (/** @type {string} */ id) => step?.options?.find((/** @type {any} */ option) => option?.id === id)?.label ?? id,
      );
      if (answer.selectedOther && answer.otherText) labels.push(answer.otherText);
      return labels.join(', ') || '—';
    })
    .join('\n')
    .slice(0, 4000);
}

/** @param {string} text */
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

/** @param {ModelSelection | undefined} model */
function modelLabel(model) {
  return model && typeof model === 'object' ? { providerId: model.providerId, modelId: model.modelId } : null;
}

/**
 * @param {{ agent: MiniAppAgentClient | undefined, store: ReturnType<typeof import('./store.mjs').createStore>,
 *   publish: (event: object) => void, logger: import('./miniapp-api.js').MiniAppLogger }} deps
 */
export function createRunManager({ agent, store, publish, logger }) {
  /** @type {Map<string, any>} projectId -> live run */
  const active = new Map();

  /** @param {any} live */
  function liveView(live) {
    return {
      runId: live.runId,
      startedAt: live.startedAt,
      model: live.model,
      text: live.text,
      tool: live.tool,
      permissions: [...live.permissions.values()].map((item) => ({
        requestId: item.requestId,
        toolName: item.toolName,
        reason: item.reason,
        toolInput: item.toolInput,
      })),
    };
  }

  /** @param {any} live @param {boolean} [now] */
  function emit(live, now = false) {
    const elapsed = Date.now() - live.lastEmit;
    if (!now && elapsed < 120) {
      live.pendingEmit ??= setTimeout(() => {
        live.pendingEmit = null;
        emit(live, true);
      }, 140 - elapsed);
      return;
    }
    if (live.pendingEmit) clearTimeout(live.pendingEmit);
    live.pendingEmit = null;
    live.lastEmit = Date.now();
    publish({ type: 'live', id: live.projectId, live: liveView(live) });
  }

  /** @param {any} live @param {object} message */
  async function record(live, message) {
    try {
      await store.update(live.projectId, (project) => {
        project.messages.push({ id: randomBytes(6).toString('hex'), at: Date.now(), runId: live.runId, ...message });
      });
      publish({ type: 'project', id: live.projectId });
    } catch (error) {
      logger.warn(`page_designer.record_failed ${errorCode(error)}`);
    }
  }

  /**
   * @param {any} live
   * @returns {(event: MiniAppAgentRunEvent) => void}
   */
  function eventHandler(live) {
    return (event) => {
      switch (event.type) {
        case 'turn.started':
          live.turnId = event.turnId;
          live.model = modelLabel(event.model);
          if (!live.primed) {
            live.primed = true;
            void store
              .update(live.projectId, (project) => {
                project.primedSessionId = live.sessionId;
              })
              .catch(() => {});
          }
          emit(live, true);
          break;
        case 'text.delta':
          live.text = (live.text + event.text).slice(-MAX_LIVE_TEXT);
          emit(live);
          break;
        case 'message.committed': {
          live.text = '';
          const text = cleanText(event.text, 40_000);
          if (text && event.sessionId === live.sessionId) {
            live.committed += 1;
            // Already kept when the tool call that followed it started.
            if (!live.kept.delete(normalize(text))) {
              live.writes = live.writes.then(() => record(live, { kind: 'assistant', text }));
            }
          }
          emit(live, true);
          break;
        }
        case 'tool.started':
          if (event.sessionId !== live.sessionId) break;
          // The Host commits the text before a tool call only after the call, so a page version
          // published by that call would land above it. Keep the streamed text now instead.
          if (live.text.trim()) {
            const text = cleanText(live.text, 40_000);
            live.kept.add(normalize(text));
            live.committed += 1;
            live.writes = live.writes.then(() => record(live, { kind: 'assistant', text }));
            live.text = '';
          }
          live.tool = cleanText(event.name, 160);
          emit(live);
          break;
        case 'tool.finished':
          if (event.sessionId !== live.sessionId) break;
          live.tool = '';
          live.writes = live.writes.then(() => record(live, { kind: 'tool', name: cleanText(event.name, 160), ok: event.ok }));
          emit(live);
          break;
        case 'permission.requested':
          // Every request waits for the user's click on the card, or for MiniMax Code's own card
          // after the user opens the session in the chat side panel. Nothing is answered here.
          live.permissions.set(event.requestId, {
            requestId: event.requestId,
            sessionId: event.sessionId,
            toolName: cleanText(event.toolName, 160),
            reason: cleanText(event.reason, 600),
            toolInput: cleanText(event.toolInput, 1200),
          });
          emit(live, true);
          break;
        default:
          break;
      }
    };
  }

  /**
   * @param {string} projectId
   * @param {{ kind: 'message', text: string, model: ModelSelection | null }
   *   | { kind: 'answer', answers: object[], model: ModelSelection | null }} input
   */
  async function start(projectId, input) {
    if (!agent) throw new StudioError('agent_unavailable', 'Page Designer has no permission to run the Agent.');
    if (active.has(projectId)) throw new StudioError('busy', 'This page is already working on a request.');
    const project = store.find(projectId);
    if (input.kind === 'message' && project.pendingQuestion) {
      throw new StudioError('question_pending', 'Answer or skip the open question first.');
    }
    if (input.kind === 'answer' && !project.pendingQuestion) {
      throw new StudioError('not_found', 'This question has already been answered.');
    }

    const live = {
      projectId,
      runId: randomBytes(8).toString('hex'),
      kind: input.kind,
      startedAt: Date.now(),
      sessionId: project.sessionId,
      primed: false,
      controller: new AbortController(),
      permissions: new Map(),
      model: null,
      turnId: null,
      text: '',
      tool: '',
      committed: 0,
      kept: new Set(),
      lastEmit: 0,
      pendingEmit: /** @type {NodeJS.Timeout | null} */ (null),
      writes: Promise.resolve(),
    };
    active.set(projectId, live);
    try {
      await store.update(projectId, (draft) => {
        if (input.kind === 'message') {
          draft.messages.push({ id: randomBytes(6).toString('hex'), kind: 'user', text: input.text, at: live.startedAt, runId: live.runId });
        } else {
          const text = answerSummary(draft.pendingQuestion?.request, input.answers);
          draft.messages.push({ id: randomBytes(6).toString('hex'), kind: 'answer', at: live.startedAt, runId: live.runId, text });
        }
        draft.runs.push({ id: live.runId, kind: input.kind, startedAt: live.startedAt, status: 'running' });
        if (input.model) draft.model = input.model;
      });
    } catch (error) {
      active.delete(projectId);
      throw error;
    }
    publish({ type: 'project', id: projectId });
    emit(live, true);
    void execute(live, input);
    return live.runId;
  }

  /** @param {any} live @param {any} input */
  async function execute(live, input) {
    const client = /** @type {MiniAppAgentClient} */ (agent);
    /** @type {Record<string, any>} */
    const outcome = {};
    try {
      const result = await runTurn(client, live, input, false);
      outcome.status = result.status;
      outcome.turnId = result.turnId ?? live.turnId;
      outcome.model = modelLabel(result.model) ?? live.model;
      await live.writes;
      // A reply that arrived without a committed message event is still kept.
      const finalText = cleanText(result.text, 40_000);
      if (finalText && live.committed === 0) await record(live, { kind: 'assistant', text: finalText });
      if (result.status === 'error') {
        outcome.error = 'TURN_ERROR';
        await record(live, { kind: 'notice', tone: 'error', code: 'TURN_ERROR', text: cleanText(result.error?.message, 600) });
      } else if (result.status === 'aborted') {
        await record(live, { kind: 'notice', tone: 'info', code: 'ABORTED' });
      }
      const pending = result.pendingQuestion;
      await store.update(live.projectId, (project) => {
        project.pendingQuestion = pending
          ? { requestId: pending.requestId, sessionId: result.sessionId, mode: pending.mode, title: cleanText(pending.request?.title, 200), request: pending.request }
          : null;
      });
      if (pending) outcome.status = 'question';
    } catch (error) {
      const code = errorCode(error);
      outcome.status = code === 'REQUEST_CANCELLED' ? 'aborted' : code === 'AGENT_OUTCOME_UNKNOWN' ? 'unknown' : 'failed';
      outcome.error = code;
      if (code !== 'REQUEST_CANCELLED') logger.warn(`page_designer.run_failed ${code}`);
      await live.writes;
      await record(live, { kind: 'notice', tone: code === 'REQUEST_CANCELLED' ? 'info' : 'error', code });
      if (input.kind === 'answer' && code === 'REQUEST_NOT_FOUND') {
        await store.update(live.projectId, (project) => {
          project.pendingQuestion = null;
        }).catch(() => {});
      }
    } finally {
      if (live.pendingEmit) clearTimeout(live.pendingEmit);
      active.delete(live.projectId);
      try {
        await store.update(live.projectId, (project) => {
          const run = project.runs.find((/** @type {any} */ item) => item.id === live.runId);
          if (run) Object.assign(run, outcome, { endedAt: Date.now() });
        });
      } catch (error) {
        if (errorCode(error) !== 'not_found') logger.warn(`page_designer.run_record_failed ${errorCode(error)}`);
      }
      publish({ type: 'live', id: live.projectId, live: null });
      publish({ type: 'project', id: live.projectId });
      publish({ type: 'projects' });
    }
  }

  /**
   * One turn. A session that no longer exists (for example after the user cleared Agent data) is
   * replaced once, and the new session gets the full brief again.
   * @param {MiniAppAgentClient} client @param {any} live @param {any} input @param {boolean} replaced
   * @returns {Promise<import('./miniapp-api.js').MiniAppAgentRunResult>}
   */
  async function runTurn(client, live, input, replaced) {
    const stopped = () => {
      // Stop pressed before the turn reached the Host: nothing ran.
      if (live.controller.signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'REQUEST_CANCELLED' });
    };
    stopped();
    const project = store.find(live.projectId);
    let sessionId = project.sessionId;
    if (!sessionId) {
      sessionId = (await client.create()).sessionId;
      await store.update(live.projectId, (draft) => {
        draft.sessionId = sessionId;
        draft.primedSessionId = null;
      });
      publish({ type: 'project', id: live.projectId });
    }
    stopped();
    live.sessionId = sessionId;
    live.primed = input.kind === 'answer' || project.primedSessionId === sessionId;
    const model = input.model ? { model: input.model } : {};
    const options = { signal: live.controller.signal, onEvent: eventHandler(live) };
    try {
      if (input.kind === 'answer') {
        return await client.answer(
          { sessionId, requestId: project.pendingQuestion.requestId, answers: input.answers, ...model },
          options,
        );
      }
      const facts = { id: project.id, style: project.style, versions: project.versions.length };
      const text = live.primed ? followUpText(facts, input.text) : firstTurnText(facts, input.text);
      return await client.run({ text, sessionId, ...model }, options);
    } catch (error) {
      if (errorCode(error) !== 'SESSION_NOT_FOUND' || replaced || input.kind === 'answer') throw error;
      await store.update(live.projectId, (draft) => {
        draft.sessionId = null;
        draft.primedSessionId = null;
      });
      return runTurn(client, live, input, true);
    }
  }

  /** @param {string} projectId @param {string} requestId @param {'allowOnce' | 'deny'} decision */
  async function reply(projectId, requestId, decision) {
    const live = active.get(projectId);
    const request = live?.permissions.get(requestId);
    if (!live || !request) throw new StudioError('not_found', 'This request has already been handled.');
    let elsewhere = false;
    try {
      await /** @type {MiniAppAgentClient} */ (agent).reply({ sessionId: request.sessionId, requestId, decision });
    } catch (error) {
      if (errorCode(error) !== 'REQUEST_NOT_FOUND') throw error;
      elsewhere = true; // decided on MiniMax Code's own card, or the run moved on
    }
    live.permissions.delete(requestId);
    emit(live, true);
    if (elsewhere) throw new StudioError('not_found', 'This request was already handled in the conversation.');
  }

  return {
    start,
    reply,
    /** @param {string} projectId */
    cancel(projectId) {
      const live = active.get(projectId);
      if (!live) throw new StudioError('not_found', 'Nothing is running on this page.');
      live.controller.abort();
    },
    /** @param {string} projectId */
    live(projectId) {
      const live = active.get(projectId);
      return live ? liveView(live) : null;
    },
    /** @param {string} projectId */
    liveRunId(projectId) {
      return active.get(projectId)?.runId ?? null;
    },
    activeIds() {
      return [...active.keys()];
    },
    dispose() {
      for (const live of active.values()) live.controller.abort();
    },
  };
}
