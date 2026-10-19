// @ts-check
// Agent runs: every figure owns one MCode session; create and edit turns run there from Node.
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { GalleryError, cleanText } from './store.mjs';
import { resolveSkill } from './examples.mjs';

const MAX_LOG_ENTRIES = 3000;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @typedef {import('./miniapp-api.js').MiniAppAgentClient} MiniAppAgentClient */
/** @typedef {import('./miniapp-api.js').MiniAppAgentRunEvent} MiniAppAgentRunEvent */
/** @typedef {import('./miniapp-api.js').MiniAppLogger} MiniAppLogger */

const SIZE_TEXT = {
  figure: 'Figure：一个机构，40–80 个零件，最多一层 WebGL。',
  hero: 'Hero：更密的整机或多层 WebGL，80–150 个零件，预计 2–4 小时。',
};

const REGISTER_RULE =
  '调用 MCP 工具 register_figure_version 登记：figureId 填 "{id}"；page 填深色页面的绝对路径；' +
  'lightPage 填浅色页面的绝对路径；preview 和 lightPreview 分别填深色、浅色页面的桌面尺寸截图（PNG）的绝对路径；' +
  'title 填一个简短的标题（中文不超过 12 个字，其他语言长度相当）；note 用一句话说明这一版的内容。';

/**
 * Point the Agent at one concrete copy of the skill. A standalone install and the gallery's bundled
 * copy can both be in its Skill list under similar names; the directory removes the ambiguity.
 * @param {{ root: string, bundled: boolean } | null} skill
 */
function skillLine(skill) {
  return skill ? `anatomy 技能的目录是 ${skill.root}，动手前先读其中的 SKILL.md，按它的规范和 kit 来做。` : '';
}

/** @param {{ root: string, bundled: boolean } | null} skill */
function kitDir(skill) {
  return skill ? `${skill.root}/kit` : '已安装 anatomy 技能的 kit 目录';
}

/** @param {any} figure @param {string | null} example @param {{ root: string, bundled: boolean } | null} [skill] */
export function createPrompt(figure, example, skill = null) {
  return [
    '请使用 anatomy 技能制作一张交互式等距图解，做完后登记到 Anatomy 画廊。',
    skillLine(skill),
    '',
    '## 要讲清楚的内容',
    figure.prompt,
    '',
    '## 规模',
    SIZE_TEXT[figure.size === 'hero' ? 'hero' : 'figure'],
    example ? `可以参考技能目录下的示例 examples/${example}/ 的结构和写法，但物体要按上面的内容重新设计。` : '',
    '',
    '## 工作方式',
    `1. 先运行 pwd 确认当前目录，在其中新建文件夹 figures/${figure.id}/。这张图解的所有文件都放在里面，不要修改这个文件夹以外的文件。`,
    '2. 走 anatomy 的框架无关路径：写 build.mjs 生成独立 HTML 页面，深色版和 --light 浅色版都要生成。',
    '3. 按 anatomy 的流程完成截图和校验，深色和浅色页面各留一张桌面尺寸截图，登记时要用。',
    `4. 做完并校验后，${REGISTER_RULE.replace('{id}', figure.id)}工作时间较长时，可以先登记一个能打开的草稿版，note 里注明是草稿。`,
    '5. 不要发布到 anatomy 社区画廊。',
    '6. 语言跟随用户：上面「要讲清楚的内容」用的是什么语言，你过程中的说明、最后的总结、登记时的 title 和 note，以及图里给观众看的文字（标题、图例、图注、提示和读数标签）都用这种语言。最后用两三句话说明这张图解用什么物体表现了什么、怎么交互。',
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

/**
 * @param {any} figure @param {string} instruction @param {boolean} newSession
 * @param {{ root: string, bundled: boolean } | null} [skill]
 */
export function editPrompt(figure, instruction, newSession, skill = null) {
  const latest = figure.versions.at(-1);
  // An imported page is a copy of someone else's folder (possibly the skill's own examples): never edit it in place.
  const needsCopy = latest.origin === 'import';
  const workDir = needsCopy ? `当前工作目录下的 figures/${figure.id}/` : '源文件夹';
  return [
    `继续修改 Anatomy 画廊里的图解《${figure.title}》（figureId: ${figure.id}）。`,
    `当前最新是第 ${latest.n} 版，源文件夹：${figure.sourceDir}`,
    skillLine(skill),
    needsCopy
      ? `这张图解是导入的。先运行 pwd 确认当前目录，把源文件夹整个复制到 figures/${figure.id}/，之后只修改副本，不要改动原文件夹。如果 build.mjs 用相对路径引用 anatomy 的 kit，复制后改成指向 ${kitDir(skill)}。`
      : '',
    newSession || needsCopy ? '这张图解不是在这个对话里做的，先读一下 build.mjs 和相关模块，了解它的结构。' : '',
    '',
    '## 修改要求',
    instruction,
    '',
    '## 工作方式',
    `只修改${workDir}里的文件。build.mjs 里引用的 anatomy kit 路径如果已经不存在，改成指向 ${kitDir(skill)}，其余照旧。改完后用 anatomy 重新生成深色和浅色页面，按它的流程校验，然后${REGISTER_RULE.replace('{id}', figure.id)}`,
    '不要发布到 anatomy 社区画廊。',
    '语言跟随用户：上面「修改要求」用的是什么语言，你过程中的说明、最后的总结、登记时的 title 和 note 都用这种语言。图里已有文字的语言保持不变，除非修改要求里提到要改。最后用一两句话说明改了什么。',
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

/**
 * Validate a model selection sent by the page. The Host validates it again against `models()`.
 * @param {unknown} value
 * @returns {import('./miniapp-api.js').MiniAppAgentModelSelection | null}
 */
export function selectionFrom(value) {
  if (!value || typeof value !== 'object') return null;
  const raw = /** @type {Record<string, any>} */ (value);
  const providerId = cleanText(raw.providerId, 120);
  const modelId = cleanText(raw.modelId, 120);
  if (!providerId || !modelId) return null;
  /** @type {{ providerId: string, modelId: string, variant?: string, thinking?: { effort: string } }} */
  const selection = { providerId, modelId };
  if (typeof raw.variant === 'string') selection.variant = raw.variant.slice(0, 60); // '' keeps thinking off
  const effort = cleanText(raw.thinking?.effort, 40);
  if (effort) selection.thinking = { effort };
  return selection;
}

/** Keep only displayable model fields; never credentials. @param {any} model */
function modelOf(model) {
  if (!model || typeof model !== 'object') return null;
  return {
    providerId: cleanText(model.providerId, 120),
    modelId: cleanText(model.modelId, 120),
    variant: typeof model.variant === 'string' ? model.variant : null,
    effort: typeof model.thinking?.effort === 'string' ? cleanText(model.thinking.effort, 40) : null,
  };
}

/** @param {unknown} error */
function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'app_call_failed';
}

const FAILURE_TEXT = {
  BUSY: '这个对话或运行队列正忙，稍后再试。',
  AGENT_UNAVAILABLE: 'Agent 暂时不可用，稍后再试。',
  AGENT_OUTCOME_UNKNOWN: '无法确认这次运行是否已执行，请先打开对话查看，不要直接重试。',
  SESSION_NOT_FOUND: '关联的对话已不存在。',
  INVALID_ARGUMENTS: '所选模型现在不可用，换一个再试。',
  NOT_PERMITTED: '画廊没有运行 Agent 的权限。',
  REQUEST_CANCELLED: '已取消。',
};

/**
 * @param {{ agent: MiniAppAgentClient | undefined, store: ReturnType<typeof import('./store.mjs').createStore>,
 *   publish: (event: object) => void, logger: MiniAppLogger, logDir: string, pluginRoot?: string }} deps
 */
export function createRunManager({ agent, store, publish, logger, logDir, pluginRoot }) {
  /**
   * The production log of one run: what the gallery asked, which model answered, every Agent
   * message, each finished tool step and every permission decision. One JSON object per line.
   * @param {any} live @param {Record<string, unknown>} entry
   */
  function log(live, entry) {
    if (live.logCount >= MAX_LOG_ENTRIES) return;
    live.logCount += 1;
    const line = live.logCount === MAX_LOG_ENTRIES ? { type: 'truncated', t: Date.now() } : { ...entry, t: Date.now() };
    live.logWrite = live.logWrite
      .then(() => appendFile(join(logDir, `${live.runId}.jsonl`), `${JSON.stringify(line)}\n`))
      .catch((/** @type {unknown} */ error) => logger.warn('anatomy_gallery.log_write_failed', { code: errorCode(error) }));
    publish({ type: 'log', figureId: live.figureId, runId: live.runId, entry: line });
  }

  /** @type {Map<string, any>} figureId -> live run */
  const active = new Map();

  /** @param {any} live */
  function liveView(live) {
    return {
      runId: live.runId,
      startedAt: live.startedAt,
      lastTool: live.lastTool,
      textTail: live.textTail,
      model: live.model ?? null,
      permissions: [...live.permissions.values()].map((item) => ({
        requestId: item.requestId,
        toolName: item.toolName,
        reason: item.reason,
        toolInput: item.toolInput,
        child: item.sessionId !== live.sessionId,
      })),
    };
  }

  /** @param {any} live */
  function emitProgress(live) {
    const now = Date.now();
    if (now - live.lastEmit < 400) {
      live.pendingEmit ??= setTimeout(() => {
        live.pendingEmit = null;
        emitProgress(live);
      }, 450);
      return;
    }
    live.lastEmit = now;
    publish({ type: 'run', figureId: live.figureId, live: liveView(live) });
  }

  /**
   * @param {string} figureId
   * @param {{ kind: 'create' | 'edit', instruction?: string, example?: string | null,
   *   model?: import('./miniapp-api.js').MiniAppAgentModelSelection | null }} input
   */
  async function start(figureId, input) {
    if (!agent) throw new GalleryError('agent_unavailable', '这个画廊没有获得运行 Agent 的授权');
    if (active.has(figureId)) throw new GalleryError('busy', '这张图解已经有一次运行在进行');
    const figure = store.find(figureId);
    const instruction = cleanText(input.instruction, 4000);
    if (input.kind === 'edit' && !instruction) throw new GalleryError('invalid', '请先写下要怎么改');
    if (input.kind === 'edit' && figure.versions.length === 0) {
      throw new GalleryError('invalid', '还没有可修改的版本，请等首版完成或重新生成');
    }

    const live = {
      figureId,
      runId: randomUUID(),
      startedAt: Date.now(),
      sessionId: figure.sessionId,
      controller: new AbortController(),
      permissions: new Map(),
      lastTool: '',
      textTail: '',
      lastEmit: 0,
      pendingEmit: /** @type {NodeJS.Timeout | null} */ (null),
      logCount: 0,
      logWrite: Promise.resolve(),
    };
    active.set(figureId, live);
    try {
      await store.update(figureId, (item) => {
        item.runs.push({
          id: live.runId,
          kind: input.kind,
          instruction: input.kind === 'edit' ? instruction : '',
          startedAt: live.startedAt,
          status: 'running',
        });
      });
    } catch (error) {
      active.delete(figureId);
      throw error;
    }
    publish({ type: 'changed', figureId });
    void execute(live, input, instruction);
    return live.runId;
  }

  /** @param {any} live @param {any} input @param {string} instruction */
  async function execute(live, input, instruction) {
    const agentClient = /** @type {MiniAppAgentClient} */ (agent);
    /** @type {Record<string, any>} */
    const outcome = {};
    try {
      await mkdir(logDir, { recursive: true });
      let newSession = false;
      if (!live.sessionId) {
        const created = await agentClient.create();
        live.sessionId = created.sessionId;
        newSession = true;
        await store.update(live.figureId, (item) => {
          item.sessionId = created.sessionId;
        });
        publish({ type: 'changed', figureId: live.figureId });
      }
      const figure = store.find(live.figureId);
      const skill = await resolveSkill(pluginRoot);
      const text =
        input.kind === 'create'
          ? createPrompt(figure, input.example ?? null, skill)
          : editPrompt(figure, instruction, newSession && figure.source !== 'gallery', skill);
      log(live, {
        type: 'start',
        kind: input.kind,
        request: input.kind === 'create' ? figure.prompt : instruction,
        prompt: text,
        model: input.model ? modelOf(input.model) : null,
      });

      /** @param {MiniAppAgentRunEvent} event */
      const onEvent = (event) => {
        switch (event.type) {
          case 'turn.started':
            outcome.turnId = event.turnId;
            live.model = modelOf(event.model);
            outcome.model = live.model;
            log(live, { type: 'turn', model: live.model });
            emitProgress(live);
            break;
          case 'message.committed':
            if (event.text.trim()) log(live, { type: 'message', text: cleanText(event.text, 8000) });
            break;
          case 'tool.finished':
            log(live, { type: 'tool', name: cleanText(event.name, 120), ok: event.ok });
            break;
          case 'question.requested':
            log(live, {
              type: 'question',
              title: cleanText(event.request.title, 120),
              steps: event.request.steps.map((step) => cleanText(step.question, 300)),
            });
            break;
          case 'tool.started':
            live.lastTool = event.name;
            emitProgress(live);
            break;
          case 'text.delta':
            live.textTail = (live.textTail + event.text).slice(-280);
            emitProgress(live);
            break;
          case 'permission.requested':
            onPermission(live, event);
            break;
          default:
            break;
        }
      };
      const result = await agentClient.run(
        { text, sessionId: live.sessionId, ...(input.model ? { model: input.model } : {}) },
        { signal: live.controller.signal, onEvent },
      );
      outcome.status = result.status;
      outcome.turnId = result.turnId ?? outcome.turnId;
      if (result.model) outcome.model = modelOf(result.model);
      outcome.summary = cleanText(result.text, 2000);
      if (result.error) outcome.error = cleanText(result.error.message, 300) || result.error.code;
      if (result.pendingQuestion) {
        outcome.status = 'question';
        outcome.question = {
          title: cleanText(result.pendingQuestion.request.title, 120),
          steps: result.pendingQuestion.request.steps.map((step) => cleanText(step.question, 300)),
        };
      }
    } catch (error) {
      const code = errorCode(error);
      outcome.status = code === 'REQUEST_CANCELLED' ? 'aborted' : code === 'AGENT_OUTCOME_UNKNOWN' ? 'unknown' : 'failed';
      outcome.error = FAILURE_TEXT[/** @type {keyof typeof FAILURE_TEXT} */ (code)] ?? '运行失败，请打开对话查看。';
      logger.warn('anatomy_gallery.run_failed', { code });
    } finally {
      log(live, { type: 'end', status: outcome.status ?? 'failed', error: outcome.error ?? null });
      if (live.pendingEmit) clearTimeout(live.pendingEmit);
      active.delete(live.figureId);
      try {
        await store.update(live.figureId, (item) => {
          const run = item.runs.find((entry) => entry.id === live.runId);
          if (!run) return;
          Object.assign(run, outcome, { endedAt: Date.now() });
          if (!run.status) run.status = 'failed';
        });
      } catch (error) {
        logger.warn('anatomy_gallery.run_record_failed', { code: errorCode(error) });
      }
      publish({ type: 'changed', figureId: live.figureId });
    }
  }

  /**
   * Every request waits for the user: a click on the gallery card, or the Host's own card in the chat
   * side panel (where MCode offers its own "allow for this conversation"). The gallery never answers
   * on the user's behalf.
   * @param {any} live @param {Extract<MiniAppAgentRunEvent, { type: 'permission.requested' }>} event
   */
  function onPermission(live, event) {
    log(live, { type: 'permission', toolName: cleanText(event.toolName, 120), reason: cleanText(event.reason, 400) });
    live.permissions.set(event.requestId, {
      requestId: event.requestId,
      sessionId: event.sessionId,
      toolName: event.toolName,
      reason: cleanText(event.reason, 400),
      toolInput: cleanText(event.toolInput, 800),
    });
    emitProgress(live);
  }

  /** @param {string} figureId @param {string} requestId @param {'allowOnce' | 'deny'} decision */
  async function reply(figureId, requestId, decision) {
    const live = active.get(figureId);
    const request = live?.permissions.get(requestId);
    if (!live || !request) throw new GalleryError('not_found', '这个确认请求已经结束');
    let settledElsewhere = false;
    try {
      await /** @type {MiniAppAgentClient} */ (agent).reply({ sessionId: request.sessionId, requestId, decision });
    } catch (error) {
      if (errorCode(error) !== 'REQUEST_NOT_FOUND') throw error;
      settledElsewhere = true; // decided on MCode's card in the side panel, or the run moved on
    }
    live.permissions.delete(requestId);
    log(live, { type: 'decision', toolName: request.toolName, decision: settledElsewhere ? 'elsewhere' : decision });
    emitProgress(live);
    if (settledElsewhere) throw new GalleryError('not_found', '这个请求已经在对话里处理过了');
  }

  /** @param {string} figureId */
  function cancel(figureId) {
    const live = active.get(figureId);
    if (!live) throw new GalleryError('not_found', '当前没有进行中的运行');
    live.controller.abort();
  }

  return {
    start,
    reply,
    cancel,
    /** @param {string} figureId */
    live: (figureId) => {
      const run = active.get(figureId);
      return run ? liveView(run) : null;
    },
    isActive: (/** @type {string} */ figureId) => active.has(figureId),
    /** Model of the run currently working on this figure, used to label a version it registers. */
    liveModel: (/** @type {string} */ figureId) => active.get(figureId)?.model ?? null,
    liveRunId: (/** @type {string} */ figureId) => active.get(figureId)?.runId ?? null,
    /** @param {string} runId */
    async readLog(runId) {
      if (!RUN_ID.test(runId)) throw new GalleryError('invalid', '运行编号无效');
      let raw = '';
      try {
        raw = await readFile(join(logDir, `${runId}.jsonl`), 'utf8');
      } catch (error) {
        if (/** @type {any} */ (error).code === 'ENOENT') return null;
        throw error;
      }
      return raw
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
    },
    /** @param {readonly string[]} runIds */
    async removeLogs(runIds) {
      await Promise.all(runIds.filter((id) => RUN_ID.test(id)).map((id) => rm(join(logDir, `${id}.jsonl`), { force: true })));
    },
    dispose() {
      for (const live of active.values()) live.controller.abort();
    },
  };
}
