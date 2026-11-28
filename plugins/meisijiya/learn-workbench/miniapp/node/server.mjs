import { createReadStream, existsSync } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { createAgentService } from './agent.mjs';
import { checkPaths } from './check-paths.mjs';
import { cleanKeys, cleanTargets, cleanWorkspace } from './clean.mjs';
import { rulesPath, STATE_RELS, WORKBENCH_DIR } from './policy.mjs';
import { refreshRules } from './scaffold.mjs';
import {
  createWorkspace,
  findLesson,
  forgetWorkspace,
  getSession,
  getWorkspace,
  importCurriculum,
  importWorkspace,
  initStore,
  listWorkspaces,
  loadSnapshot,
  mutateAnnotations,
  mutateCurriculum,
  readAnnotations,
  readCurriculum,
  readMeta,
  readMission,
  readRules,
  registerWorkspace,
  saveSession,
  sessionSummary,
} from './store.mjs';
import {
  homeDir,
  parentOf,
  platformRoots,
  readText,
  resolveInside,
  toPosix,
} from './fsx.mjs';

const SURFACE = '/workbench';

/** Accept only a selection the Host can dispatch: provider, model, optional variant, optional effort. */
function normalizeModelSelection(value) {
  if (!value || typeof value !== 'object') return null;
  const providerId = typeof value.providerId === 'string' ? value.providerId.trim() : '';
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : '';
  if (!providerId || !modelId) return null;
  const selection = { providerId, modelId };
  if (typeof value.variant === 'string') selection.variant = value.variant;
  if (value.thinking && typeof value.thinking === 'object' && typeof value.thinking.effort === 'string') {
    selection.thinking = { effort: value.thinking.effort };
  }
  return selection;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.svg']);
// What the lesson file panel may read: the workspace's own text files plus the
// code a lesson links to. Serving over /w/ stays on TEXT_EXT above.
const READABLE_EXT = new Set([
  ...TEXT_EXT,
  '.py', '.pyi', '.ts', '.tsx', '.jsx', '.java', '.kt', '.go', '.rs', '.rb', '.php',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.swift', '.sh', '.bash', '.ps1',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.sql', '.log',
]);

/**
 * Lesson pages are generated from web research and run their own scripts, so
 * they get a CSP that keeps rendering and quizzes working but forbids any
 * network call back into this app's API (or anywhere else).
 */
const LESSON_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: https:",
  "font-src 'self' data: https:",
  "media-src 'self' data: https:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function fail(response, status, code, message) {
  json(response, status, { error: code, message: message ?? code });
}

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    const error = new Error('invalid_path');
    error.code = 'INVALID_PATH';
    throw error;
  }
}

async function readBody(request, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('payload_too_large');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('invalid_json');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function errorStatus(error) {
  switch (error?.code) {
    case 'NOT_FOUND':
      return 404;
    case 'SETUP_REQUIRED':
    case 'BUSY':
    case 'ANSWER_PENDING':
    case 'NO_QUESTION':
    case 'NO_PERMISSION':
    case 'TARGET_NOT_EMPTY':
      return 409;
    case 'PARENT_NOT_FOUND':
    case 'NOT_A_WORKSPACE':
    case 'TOPIC_REQUIRED':
    case 'INVALID_JSON':
    case 'HOME_NOT_ALLOWED':
    case 'DRIVE_ROOT_NOT_ALLOWED':
    case 'NO_LESSONS':
    case 'PATH_OUTSIDE':
    case 'INVALID_PATH':
    case 'PAYLOAD_TOO_LARGE':
      return 400;
    case 'SESSION_CREATE_FAILED':
      return 502;
    default:
      return 500;
  }
}

export async function start(context) {
  initStore(context.dataDir);
  // The vocabulary guard runs on every start, so a module that grows its own
  // copy of a workspace path does not wait for someone to remember the CLI.
  let pathCheck = { ok: true, failures: [] };
  try {
    pathCheck = checkPaths();
  } catch (error) {
    pathCheck = { ok: false, failures: [`check-paths 无法运行：${error?.message ?? error}`] };
  }
  if (!pathCheck.ok) console.error(`[check-paths]\n${pathCheck.failures.join('\n')}`);
  for (const workspace of await listWorkspaces()) {
    await refreshRules(workspace.root).catch(() => {});
  }
  const clientRoot = path.join(context.pluginRoot, 'miniapp', 'client');
  const surfaceHtml = await readFile(path.join(clientRoot, 'index.html'), 'utf8');

  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();

  const emit = (wsId, payload) => {
    const frame = `data: ${JSON.stringify({ wsId, ...payload })}\n\n`;
    for (const response of clients) {
      try {
        response.write(frame);
      } catch {
        clients.delete(response);
      }
    }
  };

  const warming = new Set();
  let disposing = false;

  const agent = createAgentService({
    context,
    emit,
    onCurriculumImported: (ws) => {
      void warmLessonSessions(ws);
    },
  });

  async function warmLessonSessions(ws) {
    const key = `warm:${ws.id}`;
    if (warming.has(key) || disposing) return;
    warming.add(key);
    try {
      const snap = await loadSnapshot(ws);
      const pending = snap.curriculum.modules
        .flatMap((module) => module.lessons)
        .filter((lesson) => !lesson.sessionId);
      for (let index = 0; index < pending.length; index += 3) {
        if (disposing) break;
        const batch = pending.slice(index, index + 3);
        await Promise.all(
          batch.map((lesson) =>
            agent.openLesson(ws, lesson.id, { seed: false }).catch(() => undefined),
          ),
        );
      }
      if (!disposing) emit(ws.id, { t: 'state' });
    } catch {
      /* warming is best effort; a lesson session is created when it is opened */
    } finally {
      warming.delete(key);
    }
  }

  async function requireWorkspace(id) {
    const ws = await getWorkspace(id);
    if (!ws) {
      const error = new Error('workspace_not_found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    return ws;
  }

  async function serveClient(response, pathname) {
    if (pathname === SURFACE || pathname === '/' || pathname === '/index.html') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(surfaceHtml);
      return true;
    }
    const name = pathname.slice(1);
    if (!['app.css', 'app.js', 'lesson-bridge.js'].includes(name)) return false;
    try {
      const body = await readFile(path.join(clientRoot, name));
      const type = MIME[path.extname(name)] ?? 'application/octet-stream';
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(body);
      return true;
    } catch {
      fail(response, 404, 'client_asset_missing', name);
      return true;
    }
  }

  function injectBridge(html, { wsId, rel, lessonId, annotations }) {
    const payload = JSON.stringify({
      wsId,
      rel,
      lessonId,
      annotations: annotations.map((item) => ({ id: item.id, quote: item.quote, note: item.note })),
    }).replace(/</g, '\\u003c');
    const snippet = `<script>window.__WB__=${payload};</script><script src="/lesson-bridge.js"></script>`;
    if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n</body>`);
    return `${html}\n${snippet}`;
  }

  async function serveWorkspaceFile(response, ws, relative) {
    const rel = toPosix(relative);
    if (!rel || rel.includes('..') || rel.includes('\0')) {
      fail(response, 400, 'invalid_path');
      return;
    }
    if (rel.startsWith(WORKBENCH_DIR + '/')) {
      fail(response, 403, 'reserved_path');
      return;
    }
    const ext = path.extname(rel).toLowerCase();
    if (!MIME[ext]) {
      fail(response, 415, 'unsupported_type');
      return;
    }
    let absolute;
    try {
      absolute = resolveInside(ws.root, rel);
    } catch {
      fail(response, 400, 'invalid_path');
      return;
    }
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) {
      fail(response, 404, 'file_not_found', rel);
      return;
    }

    if (ext === '.html') {
      const curriculum = await readCurriculum(ws.root, { topic: ws.name }).then(
        (result) => result.curriculum,
        () => null,
      );
      const lesson = curriculum
        ? curriculum.modules
            .flatMap((module) => module.lessons)
            .find((entry) => entry.file === rel)
        : null;
      const annotations = lesson
        ? (await readAnnotations(ws.root)).items.filter((item) => item.lessonId === lesson.id)
        : [];
      const html = await readFile(absolute, 'utf8');
      response.writeHead(200, {
        'content-type': MIME[ext],
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': LESSON_CSP,
      });
      response.end(injectBridge(html, { wsId: ws.id, rel, lessonId: lesson?.id ?? '', annotations }));
      return;
    }

    if (TEXT_EXT.has(ext)) {
      const body = await readFile(absolute, 'utf8');
      response.writeHead(200, {
        'content-type': MIME[ext],
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(body);
      return;
    }

    response.writeHead(200, {
      'content-type': MIME[ext],
      'cache-control': 'no-store',
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
    });
    createReadStream(absolute).pipe(response);
  }

  async function handleApi(request, response, url) {
    const { pathname } = url;

    if (pathname === '/api/models' && request.method === 'GET') {
      if (typeof context.agent?.models !== 'function') {
        fail(response, 501, 'models_unavailable');
        return true;
      }
      const catalog = await context.agent.models().catch(() => null);
      if (!catalog) {
        fail(response, 502, 'models_unavailable');
        return true;
      }
      json(response, 200, catalog);
      return true;
    }

    if (pathname === '/api/bootstrap' && request.method === 'GET') {
      const workspaces = await listWorkspaces();
      let models = null;
      if (typeof context.agent?.models === 'function') {
        models = await context.agent.models().catch((error) => ({ error: String(error?.message ?? error) }));
      }
      // The catalog is what the composer offers; null when this host build has no models().
      json(response, 200, {
        surface: SURFACE,
        platform: process.platform,
        home: homeDir(),
        drives: platformRoots(),
        workspaces,
        cleanTargets: cleanTargets(),
        models,
        diagnostics: { pathVocabulary: pathCheck.failures },
      });
      return true;
    }

    if (pathname === '/api/fs/list' && request.method === 'GET') {
      const requested = url.searchParams.get('path') || homeDir();
      if (!path.isAbsolute(requested)) {
        fail(response, 400, 'path_must_be_absolute');
        return true;
      }
      const target = path.resolve(requested);
      const info = await stat(target).catch(() => null);
      if (!info || !info.isDirectory()) {
        fail(response, 400, 'not_a_directory');
        return true;
      }
      const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
      const dirs = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'node_modules' || entry.name === '$RECYCLE.BIN') continue;
        const child = path.join(target, entry.name);
        const isWorkspace = await access(path.join(child, STATE_RELS.meta)).then(
          () => true,
          () => false,
        );
        dirs.push({
          name: entry.name,
          path: child,
          hidden: entry.name.startsWith('.') || entry.name.startsWith('$'),
          isWorkspace,
        });
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      json(response, 200, {
        path: target,
        parent: parentOf(target),
        entries: dirs.slice(0, 400),
      });
      return true;
    }

    if (pathname === '/api/workspaces/create' && request.method === 'POST') {
      const body = await readBody(request);
      if (!body?.parentPath) {
        fail(response, 400, 'parent_required');
        return true;
      }
      const created = await createWorkspace({ parentPath: body.parentPath });
      json(response, 200, { workspace: created.workspace, existing: Boolean(created.existing) });
      return true;
    }

    if (pathname === '/api/workspaces/import' && request.method === 'POST') {
      const body = await readBody(request);
      const imported = await importWorkspace({ root: body.root });
      void warmLessonSessions(imported.workspace);
      json(response, 200, { workspace: imported.workspace });
      return true;
    }

    if (pathname === '/api/workspaces/forget' && request.method === 'POST') {
      const body = await readBody(request);
      await forgetWorkspace(String(body.id ?? ''));
      json(response, 200, { ok: true });
      return true;
    }

    const wsMatch = pathname.match(/^\/api\/ws\/([^/]+)(\/(.*))?$/);
    if (wsMatch) {
      const ws = await requireWorkspace(decodeURIComponent(wsMatch[1]));
      const rest = wsMatch[3] ?? '';

      if (rest === '' && request.method === 'GET') {
        json(response, 200, await loadSnapshot(ws));
        return true;
      }

      if (rest === 'rules' && request.method === 'GET') {
        json(response, 200, {
          text: await readRules(ws.root),
          path: rulesPath(ws.root),
        });
        return true;
      }

      if (rest === 'refresh' && request.method === 'POST') {
        const meta = await readMeta(ws.root);
        const imported = await importCurriculum(ws.root, meta ?? {});
        // Re-reading the directory re-reads the mission too: a fixed title is the
        // workspace's name, and this is the button the overview offers.
        const mission = readMission(await readText(path.join(ws.root, 'MISSION.md'), ''));
        if (mission.title) await registerWorkspace(ws.root, { name: mission.title, touch: false });
        if (imported.curriculum.modules.length) void warmLessonSessions(ws);
        json(response, 200, {
          snapshot: await loadSnapshot(ws),
          error: imported.error ?? null,
        });
        return true;
      }

      if (rest === 'clean' && request.method === 'POST') {
        const body = await readBody(request);
        const wanted = cleanKeys(body.targets);
        if (!wanted.length) {
          fail(response, 400, 'nothing_selected');
          return true;
        }
        // Running turns would write the state directory back and restore the
        // files this clean deletes, so they are stopped and awaited first.
        await agent.cancelAll(ws);
        const result = await cleanWorkspace(ws.root, wanted);
        emit(ws.id, { t: 'state' });
        json(response, 200, result);
        return true;
      }

      if (rest === 'setup/open' && request.method === 'POST') {
        const result = await agent.openSetup(ws);
        json(response, 200, result);
        return true;
      }

      if (rest === 'main/open' && request.method === 'POST') {
        const result = await agent.seedMain(ws);
        json(response, 200, result);
        return true;
      }

      if (rest === 'curriculum' && request.method === 'POST') {
        const result = await agent.curriculumTurn(ws);
        json(response, 200, result);
        return true;
      }

      const lessonMatch = rest.match(/^lessons\/([^/]+)\/(open|status|renew|regenerate)$/);
      if (lessonMatch) {
        const lessonId = decodeParam(lessonMatch[1]);
        if (lessonMatch[2] === 'open' && request.method === 'POST') {
          const body = await readBody(request).catch(() => ({}));
          const result = await agent.openLesson(ws, lessonId, { seed: body?.seed !== false });
          json(response, 200, result);
          return true;
        }
        if (lessonMatch[2] === 'regenerate' && request.method === 'POST') {
          const result = await agent.regenerateLesson(ws, lessonId);
          json(response, 200, result);
          return true;
        }
        if (lessonMatch[2] === 'renew' && request.method === 'POST') {
          const result = await agent.renewLesson(ws, lessonId);
          json(response, 200, result);
          return true;
        }
        if (lessonMatch[2] === 'status' && request.method === 'POST') {
          const body = await readBody(request);
          const status = ['planned', 'active', 'done'].includes(body.status) ? body.status : null;
          if (!status) {
            fail(response, 400, 'invalid_status');
            return true;
          }
          const meta = await readMeta(ws.root);
          const updated = await mutateCurriculum(ws.root, meta ?? {}, (curriculum) => {
            const lesson = findLesson(curriculum, lessonId);
            if (!lesson) return null;
            lesson.status = status;
            return curriculum;
          });
          if (!updated) {
            fail(response, 404, 'lesson_not_found', lessonId);
            return true;
          }
          emit(ws.id, { t: 'state' });
          json(response, 200, { ok: true, snapshot: await loadSnapshot(ws) });
          return true;
        }
      }

      const sessionMatch = rest.match(/^sessions\/([^/]+)(?:\/(send|reply|answer|cancel|model))?$/);
      if (sessionMatch) {
        const sessionId = decodeParam(sessionMatch[1]);
        const action = sessionMatch[2] ?? '';
        if (!action && request.method === 'GET') {
          const session = await getSession(ws.root, sessionId);
          if (!session) {
            fail(response, 404, 'session_not_found');
            return true;
          }
          json(response, 200, session);
          return true;
        }
        if (action === 'send' && request.method === 'POST') {
          const body = await readBody(request);
          const text = String(body.text ?? '').trim();
          if (!text) {
            fail(response, 400, 'empty_text');
            return true;
          }
          const result = await agent.send(ws, sessionId, text);
          json(response, 200, { ok: true, ...result });
          return true;
        }
        if (action === 'reply' && request.method === 'POST') {
          const body = await readBody(request);
          const decision = body.decision === 'allowOnce' ? 'allowOnce' : 'deny';
          const result = await agent.reply(ws, sessionId, String(body.requestId ?? ''), decision);
          json(response, 200, result);
          return true;
        }
        if (action === 'answer' && request.method === 'POST') {
          const body = await readBody(request);
          const answers = Array.isArray(body.answers) ? body.answers : [];
          const result = await agent.answer(ws, sessionId, String(body.requestId ?? ''), answers);
          json(response, 200, result);
          return true;
        }
        if (action === 'cancel' && request.method === 'POST') {
          json(response, 200, { ok: agent.cancel(ws, sessionId) });
          return true;
        }
        if (action === 'model' && request.method === 'POST') {
          const body = await readBody(request);
          const selection = normalizeModelSelection(body.model);
          const record = await getSession(ws.root, sessionId);
          if (!record) {
            fail(response, 404, 'session_not_found');
            return true;
          }
          if (record.running) {
            fail(response, 409, 'session_busy');
            return true;
          }
          const catalog =
            typeof context.agent?.models === 'function' ? await context.agent.models().catch(() => null) : null;
          const known = Boolean(
            selection &&
              catalog &&
              catalog.models.some(
                (item) => item.providerId === selection.providerId && item.modelId === selection.modelId,
              ),
          );
          if (!known) {
            fail(response, 400, 'unknown_model');
            return true;
          }
          record.model = selection;
          record.updatedAt = Date.now();
          await saveSession(ws.root, record);
          emit(ws.id, { t: 'session', sessionId, session: sessionSummary(record) });
          json(response, 200, { session: sessionSummary(record) });
          return true;
        }
      }

      if (rest === 'annotations' && request.method === 'POST') {
        const body = await readBody(request);
        const action = String(body.action ?? 'create');
        const note = String(body.note ?? '').trim();
        if (action !== 'delete' && !note) {
          fail(response, 400, 'empty_note');
          return true;
        }
        let missing = false;
        const next = await mutateAnnotations(ws.root, (current) => {
          if (action === 'create') {
            const lessonId = String(body.lessonId ?? '');
            const quote = String(body.quote ?? '').trim().slice(0, 600);
            if (!lessonId) {
              missing = true;
              return null;
            }
            current.items.unshift({
              id: `an_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
              lessonId,
              quote,
              note: note.slice(0, 4000),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            return current;
          }
          const item = current.items.find((entry) => entry.id === String(body.id ?? ''));
          if (!item) {
            missing = true;
            return null;
          }
          if (action === 'update') {
            item.note = note.slice(0, 4000);
            item.updatedAt = Date.now();
            return current;
          }
          current.items = current.items.filter((entry) => entry.id !== item.id);
          return current;
        });
        if (missing || !next) {
          fail(response, 404, 'annotation_not_found');
          return true;
        }
        emit(ws.id, { t: 'annotations' });
        json(response, 200, { annotations: next.items });
        return true;
      }

      if (rest === 'notes' && request.method === 'POST') {
        const body = await readBody(request);
        const lessonIds = Array.isArray(body.lessonIds)
          ? body.lessonIds.filter((id) => typeof id === 'string')
          : [];
        if (!lessonIds.length) {
          fail(response, 400, 'no_lessons');
          return true;
        }
        const result = await agent.startNoteJob(ws, {
          lessonIds,
          title: String(body.title ?? '').trim(),
        });
        emit(ws.id, { t: 'state' });
        json(response, 200, result);
        return true;
      }

      if (rest === 'file' && request.method === 'GET') {
        const rel = toPosix(url.searchParams.get('rel') ?? '');
        const ext = path.extname(rel).toLowerCase();
        if (!rel || rel.includes('..') || rel.startsWith(WORKBENCH_DIR + '/') || !READABLE_EXT.has(ext)) {
          fail(response, 400, 'invalid_path');
          return true;
        }
        const absolute = resolveInside(ws.root, rel);
        const info = await stat(absolute).catch(() => null);
        if (!info?.isFile()) {
          fail(response, 404, 'file_not_found', rel);
          return true;
        }
        if (info.size > 512 * 1024) {
          fail(response, 413, 'file_too_large');
          return true;
        }
        const body = await readText(absolute, '');
        json(response, 200, { rel, text: body });
        return true;
      }

      fail(response, 404, 'not_found', rest);
      return true;
    }

    if (pathname === '/api/events' && request.method === 'GET') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      response.write(': ok\n\n');
      clients.add(response);
      const ping = setInterval(() => {
        try {
          response.write(': ping\n\n');
        } catch {
          /* ignore */
        }
      }, 30_000);
      if (ping.unref) ping.unref();
      const close = () => {
        clearInterval(ping);
        clients.delete(response);
      };
      request.on('close', close);
      request.on('aborted', close);
      return true;
    }

    return false;
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://miniapp.local');
      try {
        if (request.method === 'GET' || request.method === 'HEAD') {
          if (await serveClient(response, url.pathname)) return;
        }

        const workspaceFile = url.pathname.match(/^\/w\/([^/]+)\/(.+)$/);
        if (workspaceFile && request.method === 'GET') {
          const ws = await requireWorkspace(decodeParam(workspaceFile[1]));
          await serveWorkspaceFile(response, ws, decodeParam(workspaceFile[2]));
          return;
        }

        if (await handleApi(request, response, url)) return;

        fail(response, 404, 'not_found', url.pathname);
      } catch (error) {
        const code = error?.code ?? 'internal_error';
        if (response.headersSent) {
          try {
            response.end();
          } catch {
            /* ignore */
          }
          return;
        }
        if (response.writableEnded) return;
        if (code === 'internal_error') {
          context.logger?.error?.('request_failed', {
            path: url.pathname,
            message: String(error?.message ?? error).slice(0, 300),
          });
        }
        fail(response, errorStatus(error), code, error?.message);
      }
    })();
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  let disposal;
  const dispose = () => {
    if (disposal) return disposal;
    disposing = true;
    context.signal.removeEventListener('abort', onAbort);
    disposal = new Promise((resolve) => {
      agent.abortAll();
      for (const client of clients) {
        try {
          client.end();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
      // The Host gives 2 s; never let a lingering connection hold the exit.
      const timer = setTimeout(() => {
        try {
          server.closeAllConnections?.();
        } catch {
          /* ignore */
        }
        resolve();
      }, 1500);
      if (timer.unref) timer.unref();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return disposal;
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
