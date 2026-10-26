// Canvas persistence for the AI Node Canvas MiniApp.
//
// Node shape follows the reference implementation:
//   { id, type, title, position:{x,y}, width, height, metadata:{...} }
//
// `config` is the generator node: it owns the composer, the generation
// parameters and the run button. A finished run materialises a child node of
// the result type (image / text / video / audio) and connects the two.
//
// All state lives under `context.dataDir`, a directory the Host creates and
// owns. The location is treated as opaque: it is only ever used as a base
// path, never parsed for meaning.
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NODE_FORMS, NODE_ROLES, NODE_TYPES as NODE_FORM_TYPES, currentModeId, kindOf, modeForKinds, modesFor } from '../client/forms.mjs';
import { limitsForNodeType } from './capabilities.mjs';

// What each form produces. A generating node has no kind of its own on the
// card; it is its form that says what it makes.
const NODE_FORM_KINDS = Object.fromEntries(
  Object.entries(NODE_FORMS).map(([type, form]) => [type, form.kind]),
);

import { NODE_SIZE, RESULT_KINDS, INPUT_KINDS } from './capabilities.mjs';

const CANVAS_DIR = 'canvases';
const MAX_NODES = 300;
const MAX_CONNECTIONS = 1000;
const MAX_TITLE = 120;
const MAX_PROMPT = 20000;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;

// The node types the store accepts. They come from the node table, so a new
// form cannot be created on the page and then dropped on the way in.
export const NODE_TYPES = new Set(NODE_FORM_TYPES);

// A node that was a kind of its own and is a mode of another node now. The
// card keeps its shape and the mode is remembered.
const LEGACY_MODE_TYPES = {
  prompt: { type: 'text', mode: 'prompt' },
  music: { type: 'audio', mode: 'music' },
};

const OUTPUT_STATUS = new Set(['idle', 'loading', 'success', 'error', 'interrupted']);
// Only material can be mentioned: a picture, a video or an audio file gets a
// number in the provider's syntax. Text is prompt material, not a reference.
const MENTION_KINDS = new Set(['image', 'video', 'audio']);

function clamp(value, min, max, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function str(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeMentions(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 32)
    .map((item) => ({
      nodeId: str(item?.nodeId, 64),
      kind: MENTION_KINDS.has(item?.kind) ? item.kind : 'image',
    }))
    .filter((item) => item.nodeId);
}

function normalizeOutput(input) {
  const source = input && typeof input === 'object' ? input : {};
  const fitted = source.fittedSize;
  return {
    status: OUTPUT_STATUS.has(source.status) ? source.status : 'idle',
    text: str(source.text, MAX_PROMPT * 2),
    media: Array.isArray(source.media)
      ? source.media.slice(0, 24).map((item) => ({
          url: str(item?.url, 2048),
          kind: item?.kind === 'video' || item?.kind === 'audio' ? item.kind : 'image',
          // The drive node id survives so a short-lived URL can be refreshed
          // later instead of turning into a broken image.
          nodeId: str(item?.nodeId, 128),
          // A video has no drive asset, so its link is refreshed by asking
          // the task again. Both survive a reload for the same reason.
          taskId: str(item?.taskId, 128),
          model: str(item?.model, 64),
          // A file the user picked carries its name, so the card can show
          // what is in it, and the flag that says it lives on this machine.
          name: str(item?.name, 200),
          local: item?.local === true,
        }))
      : [],
    error: str(source.error, 500),
    posterUrl: str(source.posterUrl, 2048),
    durationMs: Number.isFinite(source.durationMs) ? Math.round(source.durationMs) : 0,
    width: Number.isFinite(source.width) ? Math.round(source.width) : 0,
    height: Number.isFinite(source.height) ? Math.round(source.height) : 0,
    // The preview box the media's own ratio asked for, so the card keeps
    // that shape across a reload instead of falling back to a fixed size.
    fittedSize:
      fitted && Number.isFinite(fitted.width) && Number.isFinite(fitted.height)
        ? { width: Math.round(fitted.width), height: Math.round(fitted.height) }
        : null,
    missing: source.missing === true,
    updatedAt: str(source.updatedAt, 40),
  };
}

function normalizeSegments(input) {
  if (!Array.isArray(input)) return [];
  const segments = [];
  for (const item of input.slice(0, 64)) {
    if (item?.type === 'text') {
      const text = str(item.text, MAX_PROMPT);
      if (!text) continue;
      const last = segments[segments.length - 1];
      if (last && last.type === 'text') last.text = `${last.text}${text}`.slice(0, MAX_PROMPT);
      else segments.push({ type: 'text', text });
    } else if (item?.type === 'mention') {
      const nodeId = str(item.nodeId, 64);
      if (!nodeId) continue;
      segments.push({
        type: 'mention',
        nodeId,
        kind: MENTION_KINDS.has(item.kind) ? item.kind : 'image',
      });
    }
  }
  return segments;
}

function segmentsToPrompt(segments) {
  let out = '';
  for (const segment of segments) {
    out += segment.type === 'text' ? segment.text : `@${segment.nodeId}`;
  }
  return out.slice(0, MAX_PROMPT);
}

function segmentsToMentions(segments) {
  return segments
    .filter((segment) => segment.type === 'mention')
    .map((segment) => ({ nodeId: segment.nodeId, kind: segment.kind }));
}

function normalizeNode(input) {
  const source = input && typeof input === 'object' ? input : {};
  // A canvas from before the style node became a text input: the style was a
  // text source with a template, so it becomes an input node that holds text.
  const legacyStyle = source.type === 'style';
  // The prompt and music nodes were kinds of their own; they are modes of the
  // text and audio nodes now, so they keep their cards and lose their rows in
  // the menu.
  const legacyMode = LEGACY_MODE_TYPES[source.type] ?? null;
  const type = legacyStyle
    ? 'input'
    : (legacyMode ? legacyMode.type : (NODE_TYPES.has(source.type) ? source.type : 'image'));
  const fallbackSize = NODE_SIZE[type] ?? { width: 300, height: 300 };
  const position = source.position && typeof source.position === 'object' ? source.position : source;
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const segments = normalizeSegments(metadata.segments);
  // The text of a legacy style node was the preset it injected; it is the text
  // of the input node now.
  const legacyText = legacyStyle ? String(metadata.styleText ?? '').trim() : '';
  return {
    id: str(source.id, 64) || `n_${Math.random().toString(36).slice(2, 10)}`,
    type,
    // An input node from before the menu listed the kinds carried its kind in
    // the title as well, and the header says the same thing. The title is the
    // node's name now, so the legacy default becomes the plain form label.
    title: type === 'input' && /^输入 · /.test(str(source.title, 80))
      ? '输入'
      : (str(source.title, 80) || fallbackSize.title || '未命名节点'),
    position: {
      x: Math.round(clamp(position.x, -200000, 200000, 0)),
      y: Math.round(clamp(position.y, -200000, 200000, 0)),
    },
    width: Math.round(clamp(source.width, 160, 2000, fallbackSize.width)),
    height: Math.round(clamp(source.height, 120, 2400, fallbackSize.height)),
    metadata: {
      templateId: str(metadata.templateId, 64) || 'custom',
      templateVars: metadata.templateVars && typeof metadata.templateVars === 'object'
        ? { ...metadata.templateVars }
        : {},
      segments,
      prompt: metadata.prompt ? str(metadata.prompt, MAX_PROMPT) : segmentsToPrompt(segments),
      mentions: metadata.mentions?.length ? normalizeMentions(metadata.mentions) : segmentsToMentions(segments),
      model: str(metadata.model, 512) || null,
      ratio: str(metadata.ratio, 16) || null,
      resolution: str(metadata.resolution, 16) || null,
      duration: Number.isFinite(metadata.duration) ? metadata.duration : null,
      // How many assets one run of this node asks for.
      count: Number.isFinite(metadata.count) ? Math.max(1, Math.min(8, Math.round(metadata.count))) : 1,
      voice: str(metadata.voice, 128) || null,
      emotion: str(metadata.emotion, 200) || null,
      sessionId: str(metadata.sessionId, 128) || null,
      // The way the node makes its data: a text node writes text or expands a
      // sentence into a prompt, an audio node speaks or makes music.
      mode: str(legacyMode?.mode ?? metadata.mode, 32) || null,
      // A card the user sized by hand keeps its width when the media is
      // fitted, so the fit does not fight the resize.
      userSized: bool(metadata.userSized),
      // What the card holds: an input node holds what the user put in it, a
      // result node holds what the generation produced, and a generating node
      // holds nothing but its own settings.
      kind: (() => {
        const wanted = metadata.kind ?? metadata.inputKind ?? metadata.resultKind;
        if (type === 'input') return INPUT_KINDS.has(wanted) ? wanted : 'text';
        if (type === 'result') return RESULT_KINDS.has(wanted) ? wanted : 'image';
        // A generating node produces what its form says: an image node makes
        // an image, a music node makes audio.
        return NODE_FORM_KINDS[type] ?? 'text';
      })(),
      // The text of a legacy style node was the preset it injected.
      ...(legacyText && !metadata.prompt ? { prompt: legacyText } : {}),
      // The template the prompt node expands the sentence with.
      templateId: str(metadata.templateId, 64) || 'custom',
      templateText: str(metadata.templateText, 4000),
      // Which run produced a result node, so the result is not created twice
      // when a run is re-attached after a reload.
      sourceNodeId: str(metadata.sourceNodeId, 64),
      sourceTaskId: str(metadata.sourceTaskId, 64),
      // The node a material came from, when this node only holds it: the
      // holder is found again by this, so the same picture is not held twice.
      materialFrom: str(metadata.materialFrom, 64),
      output: normalizeOutput(metadata.output),
    },
  };
}

function normalizeCanvas(input, existing) {
  const source = input && typeof input === 'object' ? input : {};
  const nodes = Array.isArray(source.nodes)
    ? source.nodes.slice(0, MAX_NODES).map(normalizeNode)
    : [];
  const known = new Set(nodes.map((node) => node.id));
  const connections = Array.isArray(source.connections)
    ? source.connections
        .slice(0, MAX_CONNECTIONS)
        .map((item) => ({
          id: str(item?.id, 64),
          fromNodeId: str(item?.fromNodeId, 64),
          toNodeId: str(item?.toNodeId, 64),
          // What the line carries, so the line can be drawn on the port it
          // belongs to instead of in the middle of the card.
          kind: str(item?.kind, 16),
          // Which port it landed on. A mode that takes the same kind twice —
          // 图生视频·首尾帧 takes a picture for each end of the clip — needs
          // the line to say which one it is.
          role: str(item?.role, 32),
        }))
        .filter(
          (item) =>
            item.id &&
            known.has(item.fromNodeId) &&
            known.has(item.toNodeId) &&
            // A self-loop is a cycle of length one; the graph must stay acyclic.
            item.fromNodeId !== item.toNodeId,
        )
    : [];
  // A generating node from before the mode was a choice on the card: its mode
  // was read off what was connected to it. The same rule moves it into the
  // mode table, so the card keeps saying what it said.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (NODE_ROLES[node.type] !== 'generate') continue;
    // A canvas from before the merge names a mode that is one of the two now:
    // the node keeps its card and lands on the mode that is left.
    const current = currentModeId(node.metadata.mode);
    if (current !== node.metadata.mode) {
      node.metadata.mode = current;
    }
    // What is plugged into this node. The mode has to fit it.
    const kinds = new Set();
    for (const conn of connections) {
      if (conn.toNodeId !== node.id) continue;
      const upstream = byId.get(conn.fromNodeId);
      if (!upstream) continue;
      kinds.add(kindOf(upstream));
    }
    // The mode the node's model can run at all. A card must never offer a
    // request the run would refuse.
    const caps = limitsForNodeType(node.type, node.metadata.model);
    const available = modesFor(node, caps);
    if (available.length && !available.some((mode) => mode.id === node.metadata.mode)) {
      // The mode it was in is gone for this model, so the node lands on the
      // one that still fits what is plugged into it.
      const fit = available.find((mode) => (
        [...kinds].every((kind) => (mode.ports ?? []).some((port) => port.kind === kind))
      ));
      node.metadata.mode = (fit ?? available[0]).id;
      continue;
    }
    if (node.metadata.mode) continue;
    node.metadata.mode = modeForKinds(node.type, [...kinds]);
  }
  const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {};
  return {
    id: str(source.id, 64) || existing?.id || `cv_${Date.now().toString(36)}`,
    title: str(source.title, MAX_TITLE) || existing?.title || '未命名画布',
    nodes,
    connections,
    backgroundMode: source.backgroundMode === 'dots' ? 'dots' : 'lines',
    viewport: {
      x: clamp(viewport.x, -200000, 200000, 80),
      y: clamp(viewport.y, -200000, 200000, 60),
      k: clamp(viewport.k, MIN_ZOOM, MAX_ZOOM, 1),
    },
    createdAt: existing?.createdAt || str(source.createdAt, 40) || new Date().toISOString(),
    // The version of the document. Reading keeps the stored one, so a page
    // can tell whether the copy it holds is still the current one; writing
    // gives it a new one.
    //
    // A document that was never stamped has no version, and reading it must
    // not mint one: a fresh stamp on every read would make every write look
    // like somebody else had changed it, and the canvas could never be saved.
    // The first write stamps it, and from then on the version works.
    updatedAt: existing?.updatedAt || str(source.updatedAt, 40),
  };
}

export function createCanvasStore(context) {
  const base = context.dataDir;
  const dir = join(base, CANVAS_DIR);
  let ready = null;

  function ensureDir() {
    if (!ready) {
      ready = mkdir(dir, { recursive: true }).then(() => dir);
    }
    return ready;
  }

  const queues = new Map();

  // Serialize writes per file so a rapid autosave burst cannot interleave.
  function enqueue(key, task) {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    queues.set(key, next.catch(() => {}));
    return next;
  }

  async function atomicWrite(file, text) {
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, text, 'utf8');
    await rename(temp, file);
  }

  function fileFor(id) {
    const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '');
    if (!safe || safe === '.' || safe === '..') return null;
    return join(dir, `${safe}.json`);
  }

  return {
    async list() {
      await ensureDir();
      const entries = await readdir(dir);
      const results = [];
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        try {
          const raw = await readFile(join(dir, entry), 'utf8');
          const parsed = JSON.parse(raw);
          results.push({
            id: parsed.id,
            title: parsed.title,
            updatedAt: parsed.updatedAt,
            createdAt: parsed.createdAt,
            nodeCount: Array.isArray(parsed.nodes) ? parsed.nodes.length : 0,
          });
        } catch {
          // A partially written or hand-edited file must not break the list.
        }
      }
      results.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return results;
    },

    async get(id) {
      const file = fileFor(id);
      if (!file) return null;
      try {
        const raw = await readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        return normalizeCanvas(parsed, {
          id,
          title: parsed.title ?? '未命名画布',
          updatedAt: parsed.updatedAt,
        });
      } catch {
        return null;
      }
    },

    async save(canvas) {
      await ensureDir();
      const existing = await this.get(canvas?.id);
      // Two pages can have the same canvas open. A write that is based on an
      // older version than the one on disk would silently drop the other
      // page's work, so it is refused instead.
      const base = str(canvas?.updatedAt, 40);
      const current = str(existing?.updatedAt, 40);
      if (existing && base && current && base !== current) {
        throw Object.assign(
          new Error('画布在另一个页面被改过了，这次没有保存上；请重新打开画布再继续'),
          { code: 'CONFLICT' },
        );
      }
      const normalized = { ...normalizeCanvas(canvas, existing), updatedAt: new Date().toISOString() };
      const file = fileFor(normalized.id);
      if (!file) throw new Error('invalid_canvas_id');
      await enqueue(normalized.id, () =>
        atomicWrite(file, `${JSON.stringify(normalized, null, 2)}\n`),
      );
      return normalized;
    },

    async remove(id) {
      const file = fileFor(id);
      if (!file) return false;
      await enqueue(id, async () => {
        await rm(file, { force: true });
      });
      return true;
    },

    normalizeCanvas,
  };
}
