import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  backupCurriculum,
  cleanCursor,
  cleanSince,
  findLesson,
  getSession,
  importCurriculum,
  loadSnapshot,
  makeMessage,
  mutateCurriculum,
  mutateNotes,
  nodeWriteCursor,
  nodeWritesAfter,
  readCurriculumBackup,
  readMeta,
  readMission,
  reconcileWorkspaceFiles,
  registerWorkspace,
  saveSession,
  sessionSummary,
  writeContextFile,
  writeMeta,
} from './store.mjs';
import { readText, resolveInside, writeText } from './fsx.mjs';
import {
  canWrite,
  denyMessage,
  protectedSpecs,
  rulesPath as contractPath,
  toPosixRel,
  underAny,
} from './policy.mjs';
import {
  buildContextPacket,
  curriculumPrompt,
  lessonFileName,
  lessonRewritePrompt,
  lessonSeedPrompt,
  mainSeedPrompt,
  noteFileName,
  notePrompt,
  setupPrompt,
} from './prompts.mjs';

const ASK_TIMEOUT_MS = 5 * 60 * 1000;
/** How long a clean waits for an aborted turn to write its last word. */
const CANCEL_WAIT_MS = 4000;

/** Said once per turn while a ready mission has no readable title line. */
const MISSION_TITLE_NOTE =
  'MISSION.md 的第一行不是「# Mission: 主题」格式，工作台名字没有更新。把它改成这个格式，再重新读取一次就会按标题命名。';

const READ_TOOLS = new Set([
  'read',
  'read_file',
  'readfile',
  'view',
  'open_file',
  'glob',
  'grep',
  'rg',
  'ls',
  'list',
  'list_dir',
  'list_files',
  'listdirectory',
  'webfetch',
  'web_fetch',
  'fetch',
  'web_search',
  'websearch',
  'search',
  'todo_write',
  'todo',
  'todos',
  'skill',
  'update_plan',
  'think',
]);
const WRITE_TOOLS = new Set([
  'write',
  'write_file',
  'writefile',
  'edit',
  'edit_file',
  'editfile',
  'multiedit',
  'multi_edit',
  'apply_patch',
  'applypatch',
  'create_file',
  'str_replace_editor',
  'str_replace',
  'notebook_edit',
  'notebookedit',
  'patch',
  'delete_file',
  'mkdir',
]);
const SHELL_TOOLS = new Set(['bash', 'shell', 'powershell', 'run_command', 'exec', 'terminal']);
const DELEGATE_TOOLS = new Set(['task', 'agent', 'spawn_agent', 'launch_agent']);

function toolKey(name) {
  const raw = String(name ?? '').toLowerCase();
  const tail = raw.includes('__') ? raw.split('__').pop() : raw;
  return tail.replace(/[^a-z_]/g, '') || raw;
}

function collectPaths(input, key = '', out = []) {
  if (typeof input === 'string') {
    if (/^(file_?path|path|paths?|target|target_file|filename|file|notebook_path)$/i.test(key)) {
      out.push(input);
    }
    if (/patch|diff/i.test(key) || input.includes('*** Begin Patch')) {
      for (const match of input.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)) {
        out.push(match[1].trim());
      }
      for (const match of input.matchAll(/^\+\+\+ (?:b\/)?(.+)$/gm)) {
        out.push(match[1].trim());
      }
    }
    return out;
  }
  if (Array.isArray(input)) {
    input.forEach((item) => collectPaths(item, key, out));
    return out;
  }
  if (input && typeof input === 'object') {
    for (const [childKey, value] of Object.entries(input)) collectPaths(value, childKey, out);
  }
  return out;
}

export function createAgentService({ context, emit, onCurriculumImported }) {
  const runs = new Map();
  const ensuring = new Map();

  const keyOf = (wsId, sessionId) => `${wsId}:${sessionId}`;

  const summary = sessionSummary;

  function newRecord({ id, kind, targetId, title }) {
    const now = Date.now();
    return {
      id,
      kind,
      targetId,
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
      pending: null,
      permissions: [],
      running: null,
      seeded: false,
      model: null,
    };
  }

  /**
   * Snapshot every artifact this kind must not write, so a turn that writes one
   * anyway can be corrected. The cursor lets the restore skip files node itself
   * touched during the same turn (curriculum, indexes, the session store).
   */
  async function snapshotProtected(ws, session) {
    const files = new Map();
    const take = async (rel) => {
      try {
        const abs = resolveInside(ws.root, rel);
        const info = await stat(abs);
        if (!info.isFile() || info.size > 400_000) return;
        files.set(toPosixRel(rel), await readFile(abs, 'utf8'));
      } catch {
        /* missing files are not part of the snapshot */
      }
    };

    const specs = protectedSpecs(session.kind);
    for (const rel of specs.files) await take(rel);
    for (const entry of specs.dirs) {
      const dir = path.join(ws.root, entry.dir);
      const names = await readdir(dir).catch(() => []);
      const own =
        entry.own && session.kind === 'lesson' ? toPosixRel(session.targetFile || '').split('/').pop() : '';
      for (const name of names) {
        if (name === own) continue;
        if (entry.exts && !entry.exts.some((ext) => name.toLowerCase().endsWith(ext))) continue;
        await take(`${entry.dir}/${name}`);
      }
    }
    return { files, cursor: nodeWriteCursor() };
  }

  async function restoreProtected(ws, snapshot, session, cleanedPaths = []) {
    if (!snapshot || !snapshot.files || !snapshot.files.size) return [];
    const touched = nodeWritesAfter(ws.root, snapshot.cursor);
    const restored = [];
    for (const [rel, text] of snapshot.files) {
      if (touched.has(rel)) continue;
      // Deleted by a clean that started mid-turn: the clean wins over the copy.
      if (underAny(rel, cleanedPaths)) continue;
      const abs = resolveInside(ws.root, rel);
      const current = await readFile(abs, 'utf8').catch(() => null);
      if (current === text) continue;
      await writeText(abs, text);
      restored.push(rel);
    }
    if (restored.length) {
      const hint =
        {
          lesson: '这一课只能改自己的课程文件',
          note: '提炼会话只能写笔记与速查文档',
          setup: '配置会话只能改 MISSION / RESOURCES / GLOSSARY / NOTES',
          main: '主会话不直接改课程文件与学习记录',
        }[session.kind] ?? '这一轮只能改自己负责的文件';
      session.messages.push(
        makeMessage('system', `已还原越界修改：${restored.join('、')}。${hint}。`, {
          kind: 'policy',
        }),
      );
    }
    return restored;
  }

  function makeEventHandlers({ ws, session, record }) {
    return (event) => {
      if (!event || typeof event !== 'object') return;
      if (event.type === 'text.delta') {
        emit(ws.id, { t: 'delta', sessionId: session.id, text: event.text ?? '' });
        return;
      }
      if (event.type === 'tool.started' || event.type === 'tool.finished') {
        emit(ws.id, {
          t: 'tool',
          sessionId: session.id,
          phase: event.type === 'tool.started' ? 'start' : 'end',
          name: event.name ?? '',
          ok: event.ok !== false,
        });
        return;
      }
      if (event.type === 'permission.requested') {
        void handlePermission({ ws, session, event, record });
        return;
      }
      if (event.type === 'turn.started') {
        // The Host is the source of truth for which model actually ran.
        if (event.model) session.model = event.model;
        emit(ws.id, { t: 'turn', sessionId: session.id, phase: 'started', model: event.model ?? '' });
      }
    };
  }

  async function createHostSession() {
    const created = await context.agent.create({});
    if (!created?.sessionId) {
      const error = new Error('session_create_failed');
      error.code = 'SESSION_CREATE_FAILED';
      throw error;
    }
    return created.sessionId;
  }

  /* ------------------------------------------------------------- deciding */

  function decidePermission(session, event) {
    const tool = toolKey(event.toolName);
    const kind = session.kind;

    if (READ_TOOLS.has(tool)) return { decision: 'allowOnce' };
    if (WRITE_TOOLS.has(tool)) {
      const targets = collectPaths(event.toolInput ?? {});
      if (!targets.length) {
        return { decision: 'ask', reason: '无法判断这次写入的目标路径' };
      }
      const relative = targets.filter((target) => !path.isAbsolute(target));
      if (relative.length) {
        return {
          decision: 'deny',
          note: `已阻止相对路径写入（${relative[0]}）：本工作台要求对工作区文件使用绝对路径。`,
        };
      }
      for (const target of targets) {
        const resolved = path.resolve(target);
        const rel = path.relative(session.root, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          return { decision: 'ask', reason: `写入工作区之外的文件：${target}` };
        }
        if (!canWrite(kind, rel, session)) {
          return { decision: 'deny', note: denyMessage(kind, rel, session) };
        }
      }
      return { decision: 'allowOnce' };
    }
    if (SHELL_TOOLS.has(tool) || DELEGATE_TOOLS.has(tool)) {
      if (kind === 'main') return { decision: 'ask', reason: `主会话请求 ${tool}` };
      return {
        decision: 'deny',
        note: `已阻止 ${tool}：${kind === 'lesson' ? '课程' : '提炼'}会话不执行 shell，也不委派子任务。`,
      };
    }
    return { decision: 'ask', reason: `工具 ${event.toolName} 需要确认` };
  }

  async function replyPermission(session, event, decision) {
    try {
      await context.agent.reply({
        sessionId: event.sessionId,
        requestId: event.requestId,
        decision,
      });
      return true;
    } catch {
      return false;
    }
  }

  /* ---------------------------------------------------------------- turns */

  /**
   * The only entry that starts a turn. A fresh turn pushes the user message and
   * calls run; a resume keeps the transcript, clears the questionnaire and calls
   * answer. Everything else — busy check, running marker, snapshot, record,
   * finalize — happens exactly once here.
   */
  async function runTurn({ ws, session, prompt, promptKind, resume }) {
    // Read before anything is written: a clean that lands after this point owns
    // the files, and this turn must not write them back when it finalizes.
    const turnFrom = cleanCursor();
    const key = keyOf(ws.id, session.id);
    if (runs.has(key)) {
      const error = new Error('session_busy');
      error.code = 'BUSY';
      throw error;
    }

    // The merge after the turn needs the curriculum as it was before the agent
    // rewrites it: lesson files, statuses and session bindings live there. A
    // backup taken at generation time is too old to carry them between turns.
    if (session.kind === 'main') await backupCurriculum(ws.root);

    const requestId = randomUUID();
    if (!resume) {
      const isSeed = (session.messages?.length ?? 0) === 0;
      const kind = isSeed ? 'seed' : promptKind || '';
      session.messages.push(makeMessage('user', prompt, kind ? { kind } : {}));
    }
    session.running = { requestId, startedAt: Date.now() };
    session.pending = null;
    session.updatedAt = Date.now();
    session.root = ws.root;
    await saveSession(ws.root, session);
    emit(ws.id, { t: 'session', sessionId: session.id, session: summary(session) });

    const controller = new AbortController();
    let settle = () => {};
    const done = new Promise((resolve) => {
      settle = resolve;
    });
    const record = {
      controller,
      startedAt: Date.now(),
      permissionTimers: new Map(),
      protected: null,
      cleanCursor: turnFrom,
      done,
    };
    // Visible to cancelAll from the start; a failed snapshot only means there is
    // nothing to restore later.
    runs.set(key, record);
    record.protected = await snapshotProtected(ws, session).catch(() => null);

    const onEvent = makeEventHandlers({ ws, session, record });

    void (async () => {
      let result = null;
      let failure = null;
      try {
        if (resume) {
          result = await context.agent.answer(
            {
              sessionId: session.id,
              requestId: resume.requestId,
              answers: resume.answers,
              ...(session.model ? { model: session.model } : {}),
            },
            { signal: controller.signal, onEvent },
          );
        } else {
          result = await context.agent.run(
            { text: prompt, sessionId: session.id, ...(session.model ? { model: session.model } : {}) },
            { signal: controller.signal, onEvent },
          );
        }
      } catch (error) {
        failure = error;
      }
      // A questionnaire that never reached the Host can be answered again.
      const retryable =
        failure && (failure.code === 'AGENT_UNAVAILABLE' || failure.code === 'REQUEST_CANCELLED');
      try {
        await finalizeTurn({
          ws,
          session,
          result,
          failure,
          record,
          preservedPending: resume && retryable ? resume.pending : null,
        });
      } finally {
        // Stay in runs until the last write is done: cancelAll waits on done.
        runs.delete(key);
        settle();
      }
    })();

    return { requestId };
  }

  async function handlePermission({ ws, session, event, record }) {
    const decision = decidePermission(session, event);

    if (decision.decision !== 'ask') {
      const settled = await replyPermission(session, event, decision.decision);
      if (!settled) {
        // The automatic reply failed, so the run would wait forever. Surface
        // the request as a manual card instead of dropping it.
        const pending = {
          requestId: event.requestId,
          agentSessionId: event.sessionId,
          toolName: event.toolName,
          reason: '自动处理失败，请手动决定',
          at: Date.now(),
        };
        session.permissions = [...(session.permissions || []), pending];
        session.messages.push(
          makeMessage('system', `自动授权失败：${event.toolName}。请在会话里手动允许或拒绝。`, {
            kind: 'policy',
          }),
        );
        await saveSession(ws.root, session);
        emit(ws.id, { t: 'session', sessionId: session.id, session: summary(session) });
        return;
      }
      if (decision.note) {
        session.messages.push(makeMessage('system', decision.note, { kind: 'policy' }));
        await saveSession(ws.root, session);
        emit(ws.id, { t: 'session', sessionId: session.id, session: summary(session) });
      }
      emit(ws.id, {
        t: 'permission',
        sessionId: session.id,
        toolName: event.toolName,
        auto: decision.decision,
        note: decision.note ?? '',
      });
      return;
    }

    const pending = {
      requestId: event.requestId,
      agentSessionId: event.sessionId,
      toolName: event.toolName,
      reason: decision.reason ?? event.reason ?? '',
      at: Date.now(),
    };
    // Several tools can ask at once; every request keeps its own card and timer.
    session.permissions = [
      ...(session.permissions || []).filter((item) => item.requestId !== event.requestId),
      pending,
    ];
    await saveSession(ws.root, session);
    emit(ws.id, { t: 'session', sessionId: session.id, session: summary(session) });

    const timer = setTimeout(() => {
      void (async () => {
        const still = (session.permissions || []).find((item) => item.requestId === event.requestId);
        if (!still) return;
        await replyPermission(session, event, 'deny');
        session.permissions = (session.permissions || []).filter(
          (item) => item.requestId !== event.requestId,
        );
        session.messages.push(
          makeMessage('system', '这次工具调用等待了 5 分钟无人处理，已自动拒绝。', { kind: 'policy' }),
        );
        await saveSession(ws.root, session);
        emit(ws.id, { t: 'session', sessionId: session.id, session: summary(session) });
      })();
    }, ASK_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    record.permissionTimers.set(event.requestId, timer);
  }

  async function finalizeTurn({ ws, session, result, failure, record, preservedPending }) {
    const status = result?.status ?? (failure ? 'error' : 'finished');
    const reply = result?.text ?? '';

    for (const timer of record?.permissionTimers?.values?.() ?? []) clearTimeout(timer);
    record?.permissionTimers?.clear?.();

    // 「清理产物」 that started after this turn did owns the files. A deleted
    // state directory must not be written back, and a deleted artifact must not
    // be restored from the protected snapshot.
    const cleans = cleanSince(ws.root, record?.cleanCursor ?? 0);
    const cleanedPaths = cleans.flatMap((entry) => entry.paths);
    if (cleans.some((entry) => entry.keys.includes('state'))) {
      // The workspace's state is gone: saving the transcript would recreate it
      // and bring the cleaned workspace back. An out-of-scope write is still
      // reverted (that file is not under the cleaned paths), but nothing is
      // persisted and no post-turn bookkeeping runs.
      if (record?.protected) {
        try {
          await restoreProtected(ws, record.protected, session, cleanedPaths);
        } catch {
          /* A restore failure is reported, never fatal. */
        }
      }
      return;
    }

    if (reply.trim()) {
      session.messages.push(makeMessage('assistant', reply, { status }));
    }
    if (failure) {
      const code = failure?.code ?? failure?.message ?? 'unknown';
      session.messages.push(
        makeMessage('system', `这一轮没有跑完（${code}）。可以直接再问一次，或检查插件权限。`, {
          kind: 'error',
        }),
      );
    } else if (status === 'error') {
      session.messages.push(
        makeMessage('system', `这一轮以错误结束${result?.error ? `：${result.error}` : ''}。`, {
          kind: 'error',
        }),
      );
    } else if (status === 'aborted') {
      session.messages.push(makeMessage('system', '这一轮已停止。', { kind: 'policy' }));
    }

    session.pending = result?.pendingQuestion
      ? {
          kind: 'question',
          requestId: result.pendingQuestion.requestId,
          request: result.pendingQuestion.request,
          at: Date.now(),
        }
      : preservedPending ?? null;
    if (preservedPending) {
      session.messages.push(
        makeMessage('system', '这次回答没有送达，可以重新提交一次。', { kind: 'policy' }),
      );
    }
    session.permissions = [];
    session.running = null;
    session.updatedAt = Date.now();

    if (record?.protected) {
      try {
        await restoreProtected(ws, record.protected, session, cleanedPaths);
      } catch {
        /* A restore failure is reported, never fatal. */
      }
    }

    await saveSession(ws.root, session);
    emit(ws.id, { t: 'session', sessionId: session.id, session: summary(session) });

    try {
      await afterTurn({
        ws,
        session,
        result,
        failure,
        cleanedKeys: new Set(cleans.flatMap((entry) => entry.keys)),
      });
    } catch {
      /* A refresh failure never invalidates the stored turn. */
    }
    emit(ws.id, { t: 'state' });
  }

  /**
   * Keep the workspace name in step with the mission title. Setup and main are the
   * two kinds that may rewrite MISSION.md. A ready mission without a readable
   * title line is reported once instead of silently keeping the directory name.
   */
  async function syncWorkspaceName({ ws, session }) {
    const mission = readMission(await readText(path.join(ws.root, 'MISSION.md'), ''));
    if (!mission.ready) return;
    if (mission.title) {
      await registerWorkspace(ws.root, { name: mission.title, touch: false });
      return;
    }
    const said = session.messages.some(
      (message) => message.role === 'system' && message.text === MISSION_TITLE_NOTE,
    );
    if (said) return;
    session.messages.push(makeMessage('system', MISSION_TITLE_NOTE, { kind: 'policy' }));
    await saveSession(ws.root, session);
    emit(ws.id, { t: 'session', sessionId: session.id, session: summary(session) });
  }

  async function afterTurn({ ws, session, result, cleanedKeys = new Set() }) {
    const meta = await readMeta(ws.root);
    if (session.kind === 'setup') {
      await syncWorkspaceName({ ws, session });
      return;
    }
    if (session.kind === 'main') {
      // The Agent rewrites curriculum.json from scratch; merge it onto the
      // pre-turn snapshot so lesson sessions, files and status survive.
      const backup = await readCurriculumBackup(ws.root);
      const imported = await importCurriculum(ws.root, meta, backup ? { previous: backup } : {});
      if (imported.curriculum.modules.length && onCurriculumImported) {
        onCurriculumImported(ws);
      }
      // The merge carries lesson files over from the pre-turn backup; a clean
      // that deleted them mid-turn must not get those paths back.
      if (cleanedKeys.has('lessons')) {
        await reconcileWorkspaceFiles(ws.root, { lessons: true });
      }
      await syncWorkspaceName({ ws, session });
      return;
    }
    if (session.kind === 'lesson') {
      const snap = await loadSnapshot(ws);
      const lesson = findLesson(snap.curriculum, session.targetId);
      if (!lesson) return;
      // The target is fixed before the turn. A file under another name is not
      // this lesson's result, so it is never adopted.
      const target = session.targetFile || lesson.file;
      if (!target || !existsSync(resolveInside(ws.root, target))) {
        session.messages.push(
          makeMessage(
            'system',
            cleanedKeys.has('lessons')
              ? '「清理产物」删除了课程 HTML，这一轮生成的内容没有保留。可以再问一次重新生成。'
              : `这一轮没有写成本课文件${target ? `（期望 ${target}）` : ''}。可以再问一次，或检查它是否写到了别的文件名。`,
            { kind: 'policy' },
          ),
        );
        await saveSession(ws.root, session);
        emit(ws.id, { t: 'session', sessionId: session.id, session: summary(session) });
        return;
      }
      await mutateCurriculum(ws.root, meta, (curriculum) => {
        const current = findLesson(curriculum, session.targetId);
        if (!current) return null;
        current.file = target;
        current.sessionId = session.id;
        if (current.status === 'planned') current.status = 'active';
        return curriculum;
      });
      return;
    }
    if (session.kind === 'note') {
      const target = session.targetFile || '';
      const found = Boolean(target && existsSync(resolveInside(ws.root, target)));
      await mutateNotes(ws.root, (notes) => {
        const item = notes.items.find((entry) => entry.id === session.targetId);
        if (!item) return null;
        item.status = found ? 'ready' : 'failed';
        if (found) item.path = target;
        item.updatedAt = Date.now();
        return notes;
      });
    }
  }

  /* ------------------------------------------------------------- opening */

  async function ensureMainSession(ws) {
    const meta = await readMeta(ws.root);
    if (meta?.mainSessionId) {
      const existing = await getSession(ws.root, meta.mainSessionId);
      if (existing) return { session: existing, meta };
    }
    const sessionKey = `main:${ws.id}`;
    if (ensuring.has(sessionKey)) return ensuring.get(sessionKey);
    const task = (async () => {
      const sid = await createHostSession();
      const session = newRecord({ id: sid, kind: 'main', targetId: '', title: '主会话' });
      await saveSession(ws.root, session);
      const freshMeta = (await readMeta(ws.root)) ?? {};
      await writeMeta(ws.root, { ...freshMeta, id: ws.id, mainSessionId: sid });
      return { session, meta: { ...freshMeta, mainSessionId: sid } };
    })();
    ensuring.set(sessionKey, task);
    try {
      return await task;
    } finally {
      ensuring.delete(sessionKey);
    }
  }

  async function ensureSetupSession(ws) {
    const meta = await readMeta(ws.root);
    if (meta?.setupSessionId) {
      const existing = await getSession(ws.root, meta.setupSessionId);
      if (existing) return { session: existing, meta };
    }
    const sessionKey = `setup:${ws.id}`;
    if (ensuring.has(sessionKey)) return ensuring.get(sessionKey);
    const task = (async () => {
      const sid = await createHostSession();
      const session = newRecord({ id: sid, kind: 'setup', targetId: '', title: '配置 · 学习工作台' });
      await saveSession(ws.root, session);
      const freshMeta = (await readMeta(ws.root)) ?? {};
      await writeMeta(ws.root, { ...freshMeta, id: ws.id, setupSessionId: sid });
      return { session, meta: { ...freshMeta, setupSessionId: sid } };
    })();
    ensuring.set(sessionKey, task);
    try {
      return await task;
    } finally {
      ensuring.delete(sessionKey);
    }
  }

  /** Start the front-matter configuration conversation (once). */
  async function seedSetup(ws) {
    const { session } = await ensureSetupSession(ws);
    if (session.seeded || (session.messages?.length ?? 0) > 0) {
      return { sessionId: session.id, started: false };
    }
    const rulesPath = contractPath(ws.root);
    session.seeded = true;
    await saveSession(ws.root, session);
    await runTurn({
      ws,
      session,
      prompt: setupPrompt({ workspace: { ...ws, name: ws.name || path.basename(ws.root) }, rulesPath }),
    });
    return { sessionId: session.id, started: true };
  }

  async function openSetup(ws) {
    const result = await seedSetup(ws);
    const session = await getSession(ws.root, result.sessionId);
    return {
      sessionId: result.sessionId,
      started: Boolean(result.started),
      session: session ? summary(session) : null,
    };
  }

  async function ensureLessonSession(ws, lessonId) {
    const sessionKey = `lesson:${ws.id}:${lessonId}`;
    if (ensuring.has(sessionKey)) return ensuring.get(sessionKey);
    const task = (async () => {
      const snap = await loadSnapshot(ws);
      const lesson = findLesson(snap.curriculum, lessonId);
      if (!lesson) {
        const error = new Error('lesson_not_found');
        error.code = 'NOT_FOUND';
        throw error;
      }
      if (lesson.sessionId) {
        const existing = await getSession(ws.root, lesson.sessionId);
        if (existing) return { session: existing, lesson };
      }
      const sid = await createHostSession();
      const target = lesson.file || lessonFileName(lesson);
      const session = newRecord({
        id: sid,
        kind: 'lesson',
        targetId: lesson.id,
        title: `第 ${lesson.no} 课 · ${lesson.title}`,
      });
      session.targetFile = target;
      await saveSession(ws.root, session);
      const meta = await readMeta(ws.root);
      await mutateCurriculum(ws.root, meta, (curriculum) => {
        const current = findLesson(curriculum, lessonId);
        if (!current) return null;
        current.sessionId = sid;
        return curriculum;
      });
      return { session, lesson: { ...lesson, sessionId: sid } };
    })();
    ensuring.set(sessionKey, task);
    try {
      return await task;
    } finally {
      ensuring.delete(sessionKey);
    }
  }

  async function seedMain(ws) {
    const { session, meta } = await ensureMainSession(ws);
    if (session.seeded || (session.messages?.length ?? 0) > 0) {
      return { sessionId: session.id, started: false };
    }
    const snap = await loadSnapshot(ws);
    const hasMission = Boolean(snap.workspace.configured);
    const rulesPath = contractPath(ws.root);
    session.seeded = true;
    await saveSession(ws.root, session);
    await runTurn({
      ws,
      session,
      prompt: mainSeedPrompt({ workspace: { ...ws, root: ws.root }, rulesPath, hasMission }),
    });
    return { sessionId: session.id, started: true };
  }

  async function seedLesson(ws, lessonId) {
    const { session, lesson } = await ensureLessonSession(ws, lessonId);
    // A lesson whose file the curriculum already claims is read, not generated:
    // 「重新生成」 owns that case. A missing file — cleaned, or deleted by hand —
    // is the one state where the same session may be seeded again, so the button
    // that starts a lesson keeps working after 「清理产物」.
    if (lesson.file && existsSync(resolveInside(ws.root, lesson.file))) {
      return { sessionId: session.id, started: false };
    }
    // No file yet, but the session is already busy or waiting for an answer:
    // seeding would start a second turn and clear the questionnaire. Refuse it;
    // the caller opens the session as it stands instead.
    if (session.running) {
      const error = new Error('session_busy');
      error.code = 'BUSY';
      throw error;
    }
    if (session.pending) {
      const error = new Error('answer_pending');
      error.code = 'ANSWER_PENDING';
      throw error;
    }
    const snap = await loadSnapshot(ws);
    const main = snap.workspace.mainSessionId ? await getSession(ws.root, snap.workspace.mainSessionId) : null;
    const target = session.targetFile || lesson.file || lessonFileName(lesson);
    const rulesPath = contractPath(ws.root);
    const packet = buildContextPacket({
      workspace: { name: ws.name, root: ws.root, mission: snap.mission },
      curriculum: snap.curriculum,
      lesson,
      records: snap.records,
      mainSession: main,
    });
    await writeContextFile(ws.root, `lesson-${String(lesson.no).padStart(4, '0')}`, packet);
    session.seeded = true;
    await saveSession(ws.root, session);
    await runTurn({
      ws,
      session,
      prompt: lessonSeedPrompt({
        workspace: { ...ws, name: ws.name },
        rulesPath,
        lesson,
        target,
        contextPacket: packet,
      }),
      promptKind: 'seed',
    });
    return { sessionId: session.id, started: true };
  }

  async function openLesson(ws, lessonId, { seed = true } = {}) {
    let sessionId = '';
    let started = false;
    if (seed) {
      const result = await seedLesson(ws, lessonId);
      sessionId = result.sessionId;
      started = Boolean(result.started);
    } else {
      const result = await ensureLessonSession(ws, lessonId);
      sessionId = result.session.id;
    }
    const session = await getSession(ws.root, sessionId);
    return {
      sessionId,
      started,
      session: session ? summary(session) : null,
    };
  }

  /**
   * Rewrite one lesson in place: the same branch session and the same target
   * file. Unlike a follow-up this asks for the whole lesson, and unlike seeding
   * it runs even when the session already has a transcript.
   */
  async function regenerateLesson(ws, lessonId) {
    const { session, lesson } = await ensureLessonSession(ws, lessonId);
    if (session.running) {
      const error = new Error('session_busy');
      error.code = 'BUSY';
      throw error;
    }
    if (session.pending) {
      const error = new Error('answer_pending');
      error.code = 'ANSWER_PENDING';
      throw error;
    }
    const snap = await loadSnapshot(ws);
    const main = snap.workspace.mainSessionId ? await getSession(ws.root, snap.workspace.mainSessionId) : null;
    const target = session.targetFile || lesson.file || lessonFileName(lesson);
    session.targetFile = target;
    const rulesPath = contractPath(ws.root);
    const packet = buildContextPacket({
      workspace: { name: ws.name, root: ws.root, mission: snap.mission },
      curriculum: snap.curriculum,
      lesson,
      records: snap.records,
      mainSession: main,
    });
    await writeContextFile(ws.root, `lesson-${String(lesson.no).padStart(4, '0')}`, packet);
    session.seeded = true;
    await saveSession(ws.root, session);
    await runTurn({
      ws,
      session,
      prompt: lessonRewritePrompt({
        workspace: { ...ws, name: ws.name },
        rulesPath,
        lesson,
        target,
        contextPacket: packet,
      }),
      promptKind: 'rewrite',
    });
    return { sessionId: session.id, started: true, target };
  }
  /**
   * Start a follow-up branch for a lesson with a fresh Host session.
   * The old session record stays on disk; the lesson points at the new one, so a
   * long chain of questions never runs on an unbounded context.
   */
  async function renewLesson(ws, lessonId) {
    const snap = await loadSnapshot(ws);
    const lesson = findLesson(snap.curriculum, lessonId);
    if (!lesson) {
      const error = new Error('lesson_not_found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const previous = lesson.sessionId ? await getSession(ws.root, lesson.sessionId) : null;
    if (previous?.running) {
      const error = new Error('session_busy');
      error.code = 'BUSY';
      throw error;
    }
    const previousTurns = (previous?.messages ?? []).filter((message) => message.role === 'assistant').length;
    const lastReply =
      (previous?.messages ?? []).filter((message) => message.role === 'assistant').slice(-1)[0]?.text ?? '';
    const main = snap.workspace.mainSessionId ? await getSession(ws.root, snap.workspace.mainSessionId) : null;
    const target = lesson.file || lessonFileName(lesson);
    const packet = buildContextPacket({
      workspace: { name: ws.name, root: ws.root, mission: snap.mission },
      curriculum: snap.curriculum,
      lesson,
      records: snap.records,
      mainSession: main,
    });
    const sessionId = await createHostSession();
    const session = newRecord({
      id: sessionId,
      kind: 'lesson',
      targetId: lessonId,
      title: `第 ${lesson.no} 课 · 续 ${previousTurns + 1}`,
    });
    session.targetFile = target;
    session.seeded = true;
    session.model = previous?.model ?? null;
    await saveSession(ws.root, session);
    await mutateCurriculum(ws.root, {}, (curriculum) => {
      const current = findLesson(curriculum, lessonId);
      if (!current) return null;
      current.sessionId = sessionId;
      return curriculum;
    });
    const prompt = [
      `你是第 ${lesson.no} 课的追问续接会话（${session.title}）。`,
      `工作台：${ws.root}`,
      `规则（先读）：${contractPath(ws.root)}`,
      `本课文件：${path.join(ws.root, target)}（已存在，不要重写整节课，只回答追问。）`,
      lastReply ? `上一次会话的结论摘要：\n${lastReply.slice(0, 1500)}` : '',
      packet ? `— 本课上下文 —\n${packet}\n— 上下文结束 —` : '',
      '用户即将继续追问这一课。先用一句话确认你已接手这一课的上下文（不超过 40 字），不要重复课程内容，也不要生成新课件。',
    ]
      .filter(Boolean)
      .join('\n\n');
    await runTurn({ ws, session, prompt });
    return { sessionId, started: true, session: summary(session) };
  }

  /* ------------------------------------------------------------ messaging */

  async function send(ws, sessionId, text) {
    const session = await getSession(ws.root, sessionId);
    if (!session) {
      const error = new Error('session_not_found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    session.root = ws.root;
    return runTurn({ ws, session, prompt: String(text ?? '').trim() });
  }

  async function answer(ws, sessionId, requestId, answers) {
    const session = await getSession(ws.root, sessionId);
    if (!session) {
      const error = new Error('session_not_found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const pending = session.pending;
    if (!pending || pending.kind !== 'question' || (requestId && pending.requestId !== requestId)) {
      const error = new Error('no_pending_question');
      error.code = 'NO_QUESTION';
      throw error;
    }
    await runTurn({
      ws,
      session,
      resume: { requestId: pending.requestId, answers, pending },
    });
    return { started: true };
  }

  async function reply(ws, sessionId, requestId, decision) {
    const session = await getSession(ws.root, sessionId);
    const pending = (session?.permissions || []).find((item) => item.requestId === requestId);
    if (!session || !pending) {
      const error = new Error('no_pending_permission');
      error.code = 'NO_PERMISSION';
      throw error;
    }
    try {
      await context.agent.reply({
        sessionId: pending.agentSessionId ?? session.id,
        requestId,
        decision,
      });
    } catch (error) {
      const failed = new Error(error?.code ?? 'reply_failed');
      failed.code = error?.code ?? 'REPLY_FAILED';
      throw failed;
    }
    const record = runs.get(keyOf(ws.id, session.id));
    const timer = record?.permissionTimers?.get(requestId);
    if (timer) {
      clearTimeout(timer);
      record.permissionTimers.delete(requestId);
    }
    session.permissions = (session.permissions || []).filter((item) => item.requestId !== requestId);
    session.messages.push(
      makeMessage('system', decision === 'allowOnce' ? '已允许这次工具调用。' : '已拒绝这次工具调用。', {
        kind: 'policy',
      }),
    );
    await saveSession(ws.root, session);
    emit(ws.id, { t: 'session', sessionId: session.id, session: summary(session) });
    return { ok: true };
  }

  function cancel(ws, sessionId) {
    const record = runs.get(keyOf(ws.id, sessionId));
    if (!record) return false;
    record.controller.abort();
    return true;
  }

  /**
   * Stop every running turn of one workspace and wait for their finalize.
   * A caller that deletes workspace files must await this before it touches disk.
   */
  async function cancelAll(ws) {
    const prefix = `${ws.id}:`;
    const records = [];
    for (const [key, record] of runs) {
      if (!key.startsWith(prefix)) continue;
      records.push(record);
      record.controller.abort();
    }
    if (!records.length) return 0;
    // A host that ignores the abort must not block the clean forever; whatever
    // lands late is caught by the finalize gate.
    await Promise.race([
      Promise.all(records.map((record) => record.done)),
      new Promise((resolve) => {
        const timer = setTimeout(resolve, CANCEL_WAIT_MS);
        if (timer.unref) timer.unref();
      }),
    ]);
    return records.length;
  }

  /* -------------------------------------------------------------- notes */

  async function startNoteJob(ws, { lessonIds, title }) {
    const snap = await loadSnapshot(ws);
    const lessons = lessonIds
      .map((id) => findLesson(snap.curriculum, id))
      .filter((lesson) => lesson && lesson.file);
    if (!lessons.length) {
      const error = new Error('no_lessons_with_files');
      error.code = 'NO_LESSONS';
      throw error;
    }
    const scoped = snap.annotations.filter((item) => lessonIds.includes(item.lessonId));
    const safeTitle = String(title ?? '').trim() || `第 ${lessons.map((l) => l.no).join('、')} 课笔记`;
    // A running note has no file yet, so also avoid paths already claimed by a note record.
    const taken = new Set((snap.notes || []).map((item) => item.path));
    let target = noteFileName(safeTitle);
    let suffix = 2;
    while (taken.has(target) || existsSync(resolveInside(ws.root, target))) {
      target = noteFileName(safeTitle).replace(/\.md$/, `-${suffix}.md`);
      suffix += 1;
    }
    const noteId = `n_${randomUUID().slice(0, 8)}`;
    const sid = await createHostSession();
    const session = newRecord({
      id: sid,
      kind: 'note',
      targetId: noteId,
      title: `提炼 · ${safeTitle}`,
    });
    session.targetFile = target;
    session.seeded = true;
    await saveSession(ws.root, session);
    await mutateNotes(ws.root, (notes) => {
      notes.items.unshift({
        id: noteId,
        title: safeTitle,
        path: target,
        lessonIds: lessons.map((lesson) => lesson.id),
        sessionId: sid,
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return notes;
    });
    const rulesPath = contractPath(ws.root);
    await runTurn({
      ws,
      session,
      prompt: notePrompt({
        workspace: ws,
        rulesPath,
        title: safeTitle,
        target,
        lessons,
        annotations: scoped,
      }),
    });
    return { noteId, sessionId: sid, path: target };
  }

  async function curriculumTurn(ws) {
    const snap = await loadSnapshot(ws);
    if (!snap.workspace.configured) {
      const error = new Error('setup_required');
      error.code = 'SETUP_REQUIRED';
      throw error;
    }
    const { session } = await ensureMainSession(ws);
    const rulesPath = contractPath(ws.root);
    // runTurn backs the curriculum up before the rewrite; importCurriculum merges
    // lesson state back from it after the turn.
    await runTurn({
      ws,
      session,
      prompt: curriculumPrompt({ workspace: ws, rulesPath }),
      promptKind: 'task',
    });
    return { sessionId: session.id };
  }

  function abortAll() {
    for (const record of runs.values()) {
      for (const timer of record.permissionTimers?.values?.() ?? []) clearTimeout(timer);
      record.permissionTimers?.clear?.();
      try {
        record.controller.abort();
      } catch {
        /* ignore */
      }
    }
    runs.clear();
  }

  return {
    openLesson,
    regenerateLesson,
    renewLesson,
    openSetup,
    seedMain,
    ensureMainSession,
    send,
    answer,
    reply,
    cancel,
    cancelAll,
    startNoteJob,
    curriculumTurn,
    abortAll,
  };
}
