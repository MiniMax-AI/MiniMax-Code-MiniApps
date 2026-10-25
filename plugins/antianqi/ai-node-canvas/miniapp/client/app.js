// AI Node Canvas - page runtime.
//
// One node is one asset slot: an image node holds an image, generating
// updates that node in place, and every media node carries its own prompt,
// parameters and generate button. A style node holds a preset whose text is
// prepended to the prompt of every downstream node.
//
// Rendering model: nodes are DOM elements with `data-node-id`, edges live in one
// SVG layer, the scene sits under a single CSS transform, and the prompt
// editor is an inline contentEditable so `@` references can be embedded as
// chips in the text.
import { detectMention, parseSegments, plainText, textIndexBefore } from './mention.mjs';
import { bandSelection, BATCH_COUNTS, BATCH_MODES, cropRectAfterDrag, dragPositions, effectiveOption, fanOutParams, fitMediaBox, fitParamsToCaps, inputKindsFor, isControlTarget, kindOf, mentionCandidates as mentionCandidatesOf, modelSummary, NODE_GAP, placeOverlay, planBatchPlacement, planGridSplit, planPaste, portOfConnection, portState, pushAside, resolveEventTarget, roleOf, slotsOf as slotsOfForm, TILE_CARD, toolPrompt, upstreamNodes } from './tools.mjs';
import { cardChrome, DATA_KINDS, hasTextBox, modeLabelOf, modesFor, NODE_FORMS, NODE_KINDS, modeOf, modeRecordOf, modesOf, portKinds, portKindsFor, portList, ratioLabel, ratioOptionsFor, runModeOf, stripInputs } from './forms.mjs';
import { applyAction, applyModel, inheritedTextFor, lineKind, linesDroppedByMode, materializeResults, planIncoming, planPort, promptTemplateFor, readTemplateFile, runSpecFor, syncMentions, templateFile, templateFromCanvas } from './actions.mjs';

(() => {
  'use strict';

  // The names and the menu order come from the node table, so a new node
  // form is added in one place and the page cannot fall out of step with the
  // runtime.
  const KIND_LABEL = Object.fromEntries(
    Object.entries(NODE_FORMS).map(([type, form]) => [type, form.label]),
  );
  // The menu offers the kinds of node — a role and the data it moves — so
  // what it lists is exactly what the board can show. A mode is a choice on
  // the card, so it never gets a row of its own.
  const KIND_ORDER = NODE_KINDS;
  // The name of a way to run: it is a kind of node, not a raw mode key, so the
  // capability list never shows "MUSIC" to the user.
  const RUN_MODE_LABEL = {
    image: '图片',
    video: '视频',
    audio: '音频',
    music: '音频 · 音乐',
    text: '文本',
  };
  // The palette follows the system unless the user picks a side.
  const THEME_ORDER = ['system', 'light', 'dark'];
  const THEME_LABEL = { system: '跟随系统', light: '亮色', dark: '暗色' };
  const THEME_KEY = 'nxc-theme';
  const POLL_MS = 700;
  const ACTION_POLL_MS = 700;
  const AUTOSAVE_MS = 1100;
  const HISTORY_MAX = 50;
  const HISTORY_DEBOUNCE_MS = 350;
  const GRID_SIZE = 48;
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 5;
  const SNAP_SCREEN_PX = 56;
  const DRAG_THRESHOLD = 3;
  const MINI_W = 184;
  const MINI_H = 124;
  const CLIPBOARD_KIND = 'nxc-canvas-nodes';

  // A group of cards the app placed together.
  //
  // The real size of a card is measured from the page: the preview box
  // follows the media's own ratio and the tool bar wraps, so the height is
  // not known before the card is on the board. A group is therefore placed
  // again when a card of it is measured, and the cards stand by their real
  // size instead of by a guess.
  const layoutGroups = new Map();
  const layoutGroupOf = new Map();
  let layoutSeq = 0;
  // The answer to the one question the page asks in itself.
  let confirmResolve = null;

  const state = {
    canvas: {
      id: null,
      title: '未命名画布',
      nodes: [],
      connections: [],
      backgroundMode: 'lines',
      viewport: { x: 80, y: 60, k: 1 },
    },
    selection: [],
    editingTitleId: null,
    canvases: [],
    dropdown: null,
    models: [],
    defaultModelKey: null,
    voices: [],
    voiceError: null,
    palette: null,
    capabilities: {},
    capabilitiesByModel: {},
    media: { available: false, version: '', ffprobe: false, canUpload: false },
    tasks: new Map(), // taskId -> task record
    nodeTasks: new Map(), // nodeId -> taskId
    pollTimer: null,
    actionTimer: null,
    saveTimer: null,
    historyTimer: null,
    snapNodeId: null,
    draft: null,
    mention: null,
    panel: null,
    history: { stack: [], index: -1, max: HISTORY_MAX },
    clip: null,
    band: null,
    pendingRender: false,
    minimap: false,
    theme: 'system',
    editors: new Map(),
    crop: null, // { nodeId, rect:{x,y,w,h} } in 0..1 image space
    tool: null, // { nodeId, tool, params }
    picker: null, // the node picker that opens on an empty drop
    suppressClick: false,
  };

  const dom = {};
  let nodeSeq = 0;
  let connSeq = 0;

  // ---------------------------------------------------------------- helpers

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function uid(prefix) {
    nodeSeq += 1;
    connSeq += 1;
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: { 'content-type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { error: 'bad_response', message: text.slice(0, 200) };
    }
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      error.code = payload?.error || 'http_error';
      error.status = response.status;
      if (response.status === 401) {
        // The Host rotates the loopback credential when the runtime restarts,
        // and that happens on every plugin update. The page still holds the
        // old one, so every write is refused until the board is opened again.
        // A bare "save failed" gives the user nothing to act on.
        showBanner('页面会话已失效：插件更新后运行时会重启，请重新打开画布再继续。', 'error');
      }
      throw error;
    }
    return payload;
  }

  function setSaveState(next) {
    dom.saveState.dataset.state = next;
    dom.saveState.textContent = {
      pending: '待保存',
      saving: '保存中…',
      saved: '已保存',
      error: '保存失败',
    }[next];
  }

  // ---------------------------------------------------------------- theme

  /**
   * Apply the palette.
   *
   * `system` removes the attribute so the media query decides, and an
   * explicit choice pins it. The page never forces one side.
   */
  function applyTheme() {
    const root = document.documentElement;
    if (state.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.theme);
    try {
      localStorage.setItem(THEME_KEY, state.theme);
    } catch {
      // A blocked storage must not stop the theme from applying.
    }
  }

  function loadTheme() {
    let saved = 'system';
    try {
      saved = localStorage.getItem(THEME_KEY) ?? 'system';
    } catch {
      saved = 'system';
    }
    state.theme = THEME_ORDER.includes(saved) ? saved : 'system';
    applyTheme();
  }

  function cycleTheme() {
    const index = THEME_ORDER.indexOf(state.theme);
    state.theme = THEME_ORDER[(index + 1) % THEME_ORDER.length];
    applyTheme();
    renderToolbar();
  }

  // ---------------------------------------------------------------- build check

  const PAGE_BUILD = window.__NXC_BUILD__ || '';

  async function syncBuild() {
    if (!PAGE_BUILD) return;
    try {
      const response = await fetch('/api/bootstrap');
      const payload = await response.json();
      const current = payload.clientBuild;
      if (current && current !== PAGE_BUILD) {
        const already = sessionStorage.getItem('nxc-reloaded-from');
        if (already !== PAGE_BUILD) {
          sessionStorage.setItem('nxc-reloaded-from', PAGE_BUILD);
          location.reload();
          return;
        }
      }
      if (payload.pluginVersion || current) {
        const version = payload.pluginVersion || window.__NXC_VERSION__ || '';
        dom.buildBadge.textContent = `${version ? `v${version} ` : ''}${current ?? PAGE_BUILD}`;
        dom.buildBadge.title = `运行中的客户端构建指纹：${current ?? PAGE_BUILD}`;
      }
    } catch {
      // The build check must never block the canvas from working.
    }
  }

  // ---------------------------------------------------------------- history

  /**
   * The content of the canvas, for the history.
   *
   * The view is not part of it: panning the board is not a change to the
   * document, and undoing a change should not move the camera.
   */
  function snapshot() {
    return JSON.stringify({
      nodes: state.canvas.nodes,
      connections: state.canvas.connections,
    });
  }

  function pushHistory() {
    const h = state.history;
    const s = snapshot();
    if (h.stack[h.index] === s) return;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(s);
    while (h.stack.length > h.max) h.stack.shift();
    h.index = h.stack.length - 1;
    updateHistoryBtns();
  }

  function resetHistory() {
    state.history = { stack: [snapshot()], index: 0, max: HISTORY_MAX };
    updateHistoryBtns();
  }

  function applySnapshot(s) {
    let o;
    try {
      o = JSON.parse(s);
    } catch {
      return;
    }
    state.canvas.nodes = o.nodes ?? [];
    state.canvas.connections = o.connections ?? [];
    // The camera stays where it is: the history holds the document, not the
    // place it is looked at from.
    state.selection = state.selection.filter((id) => state.canvas.nodes.some((n) => n.id === id));
    render();
    markDirty();
    updateHistoryBtns();
  }

  function undo() {
    const h = state.history;
    if (h.index <= 0) {
      showBanner('没有可撤销的操作');
      return;
    }
    h.index -= 1;
    applySnapshot(h.stack[h.index]);
  }

  function redo() {
    const h = state.history;
    if (h.index >= h.stack.length - 1) {
      showBanner('没有可重做的操作');
      return;
    }
    h.index += 1;
    applySnapshot(h.stack[h.index]);
  }

  function updateHistoryBtns() {
    const h = state.history;
    dom.undoButton.disabled = h.index <= 0;
    dom.redoButton.disabled = h.index >= h.stack.length - 1;
  }

  // ---------------------------------------------------------------- graph

  function getNode(id) {
    return state.canvas.nodes.find((node) => node.id === id) || null;
  }

  // The whole chain above this node. The rule lives in `tools.mjs`, where it
  // is pure, so the runtime reads the same chain as the page.
  function upstreamOf(nodeId) {
    return upstreamNodes(state.canvas, nodeId);
  }

  function hasPath(fromId, toId) {
    const stack = [fromId];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (current === toId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      state.canvas.connections
        .filter((conn) => conn.fromNodeId === current)
        .forEach((conn) => stack.push(conn.toNodeId));
    }
    return false;
  }

  function nodeSize(type) {
    return state.palette?.sizes?.[type] ?? { width: 300, height: 300 };
  }

  // The input kinds a generating node takes. It follows the model the node
  // selected: a model that cannot take a video does not offer a video slot.
  function inputKindsForNode(node) {
    if (roleOf(node) !== 'generate') return [];
    return inputKindsFor(effectiveCaps(node));
  }

  // The name of the mode the node is in. The mode is a choice on the card,
  // so it names itself.
  function nodeModeLabel(node) {
    if (roleOf(node) !== 'generate') return '';
    return modeRecordOf(node)?.label ?? '';
  }

  // The generating nodes on their own.
  function isGeneratingNode(node) {
    return Boolean(node) && roleOf(node) === 'generate';
  }

  // The result node a generating node produced.
  function resultNodeOf(node) {
    if (!node) return null;
    for (const conn of state.canvas.connections) {
      if (conn.fromNodeId !== node.id) continue;
      const target = getNode(conn.toNodeId);
      if (target && target.type === 'result') return target;
    }
    return null;
  }

  // Every result node a generating node produced. A batch of results is more
  // than one, and a second run has to replace all of them.
  function resultNodesOf(node) {
    if (!node) return [];
    const ids = new Set();
    for (const conn of state.canvas.connections) {
      if (conn.fromNodeId !== node.id) continue;
      const target = getNode(conn.toNodeId);
      if (target && target.type === 'result') ids.add(target.id);
    }
    return state.canvas.nodes.filter((item) => ids.has(item.id));
  }

  // Whether the node already produced something.
  //
  // A result whose asset is gone does not count: the chain would reuse a dead
  // reference instead of running that step again, and the step is cheap
  // compared to a broken picture further down.
  function hasResult(node) {
    const result = resultNodeOf(node);
    if (!result) return false;
    return !result.metadata?.output?.missing;
  }

  // The text an upstream line hands over is read in `actions.mjs`, where the
  // page and the runtime share the rule: the card shows the upstream text and
  // the run sends that same text.

  // A video node is generated by the connector with a dedicated video model,
  // while every other mode is driven by an Agent turn that runs on a text
  // model. The capability table carries both lists; the model dropdown has to
  // show the one that belongs to the node, otherwise a video node offers
  // MiniMax-M3 and never the video models it can actually use.
  function modeModelOptions(node) {
    // The models belong to the way the node makes its data: an audio node in
    // the music mode runs the music model.
    const models = state.capabilities[runModeOf(node)]?.models ?? [];
    if (models.length === 0) return [];
    return models.map((model) => ({ value: model.id, label: model.label, hint: model.note }));
  }

  function agentModelOptions() {
    return state.models.map((model) => ({
      value: model.key,
      label: model.miniMax ? `${model.label} ★` : model.label,
    }));
  }

  // The limits of the model a node actually selected: Hailuo offers other
  // resolutions and durations than H3, and the parameter row has to follow.
  //
  // The runtime resolves them once and ships them per model, so the rule
  // that a model only offers a resolution for some durations is written
  // down in one place only.
  function effectiveCaps(node) {
    const runMode = runModeOf(node);
    const base = state.capabilities[runMode] ?? {};
    const models = base.models ?? [];
    if (models.length === 0) return base;
    const resolved = state.capabilitiesByModel?.[runMode]?.[node.metadata.model];
    if (!resolved) return base;
    const caps = { ...resolved };
    // A model may only offer a resolution for particular durations; the
    // parameter row has to show what the connector would actually accept.
    const allowed = resolved.resolutionByDuration?.[String(node.metadata.duration)];
    if (allowed) caps.resolutions = allowed;
    return caps;
  }

  function createNode(type, position, options = {}) {
    const size = nodeSize(type);
    // Only a generating node picks a model; an input node holds something
    // and a result node shows something. The model belongs to the way the node
    // makes its data: a music run uses the music model.
    const generates = !['input', 'result', 'group'].includes(type);
    const mode = options.mode ?? modeOf({ type, metadata: {} });
    const runMode = runModeOf({ type, metadata: { mode } });
    const modeModels = state.capabilities[runMode]?.models ?? [];
    const node = {
      id: uid('n'),
      type,
      title: options.title ?? KIND_LABEL[type] ?? '节点',
      position: {
        x: Math.round(position?.x ?? 120),
        y: Math.round(position?.y ?? 120),
      },
      width: size.width,
      height: size.height,
      metadata: {
        templateVars: {},
        segments: [],
        prompt: '',
        mentions: [],
        // The mode's own model list wins; the Agent catalog is the fallback.
        model: generates ? (modeModels.length ? modeModels[0].id : state.defaultModelKey) : null,
        // The way the node makes its data: a text node writes text or expands
        // a sentence into a prompt, an audio node speaks or makes music.
        mode: mode || null,
        ratio: null,
        resolution: null,
        duration: null,
        voice: null,
        emotion: null,
        sessionId: null,
        // What the card holds: an input node holds what the user put in it, a
        // result node holds what the generation produced. A generating node
        // holds nothing but its own settings.
        kind: options.kind ?? (type === 'result' ? 'image' : 'text'),
        // The template the prompt card expands the sentence with. The page
        // and the Agent ask the same rule, so a prompt node is the same
        // either way.
        ...promptTemplateFor({
          mode: mode || '',
          templateId: options.templateId,
          templateText: options.templateText,
          templates: state.palette?.promptTemplates ?? [],
        }),
        output: { status: 'idle', text: '', media: [], error: '', posterUrl: '', durationMs: 0, width: 0, height: 0, missing: false, updatedAt: '' },
      },
    };
    if (options.output) {
      node.metadata.output = { ...node.metadata.output, ...options.output };
    }
    state.canvas.nodes.push(node);
    return node;
  }

  function removeNode(id) {
    state.canvas.nodes = state.canvas.nodes.filter((node) => node.id !== id);
    state.canvas.connections = state.canvas.connections.filter(
      (conn) => conn.fromNodeId !== id && conn.toNodeId !== id,
    );
    state.selection = state.selection.filter((item) => item !== id);
  }

  function copyNode(node) {
    if (!node) return;
    const clone = {
      ...node,
      id: uid('n'),
      title: `${node.title} 副本`,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      metadata: {
        ...node.metadata,
        sessionId: null,
        output: { status: 'idle', text: '', media: [], error: '', posterUrl: '', durationMs: 0, width: 0, height: 0, missing: false, updatedAt: '' },
      },
    };
    state.canvas.nodes.push(clone);
    state.selection = [clone.id];
    markDirty();
    render();
  }

  function removeConnection(id) {
    state.canvas.connections = state.canvas.connections.filter((conn) => conn.id !== id);
    markDirty();
    render();
  }

  /**
   * The kind a line carries, read live from its source.
   *
   * The line may have been drawn before the source changed what it holds, so
   * the source is the truth.
   */
  function kindOfConnection(conn) {
    return lineKind(state.canvas, conn);
  }

  /**
   * Draw a line between two nodes.
   *
   * The target's mode says what it takes. A line of a kind the mode does not
   * take moves the target to the mode that takes it — that is how a picture
   * turns an image node into a 图生图 node. When no mode takes it, the line is
   * refused and the reason is given.
   *
   * The rule itself lives in `actions.mjs`, where the page and the runtime
   * share it, so a line drawn by hand and a line the Agent asks for land in the
   * same shape.
   *
   * `quiet` leaves the redraw to the caller. A batch that draws many lines at
   * once — a local tool that cuts a video into thirty pieces — would otherwise
   * rebuild the whole board thirty times.
   */
  function connect(fromId, toId, kind = '', options = {}) {
    if (!fromId || !toId || fromId === toId) return { ok: false, reason: '这条线连不到自己身上。' };
    if (state.canvas.connections.some((c) => c.fromNodeId === fromId && c.toNodeId === toId)) {
      return { ok: false, reason: '这两个节点已经连上了。' };
    }
    if (hasPath(toId, fromId)) return { ok: false, reason: '这样连会形成一个环。' };
    const target = getNode(toId);
    let role = options.role ?? '';
    if (target && kind) {
      const plan = planIncoming(state.canvas, target, kind);
      if (plan.error) return { ok: false, reason: plan.reason };
      if (plan.changed) {
        target.metadata.mode = plan.modeId;
        // The card changed shape, so the user is told what happened to it.
        showBanner(`「${target.title}」切到「${modeLabelOf(target, plan.modeId)}」，这样才接得住这条线。`);
      }
      // The port the line lands on. A mode that takes the same kind twice has
      // a port for each, and the role says which one this line is.
      const port = planPort(state.canvas, target, kind, role);
      if (!port.ok) return { ok: false, reason: port.reason };
      role = port.role;
    }
    // The kind travels with the line, so the line can be drawn on the port it
    // belongs to instead of in the middle of the card.
    state.canvas.connections.push({ id: uid('c'), fromNodeId: fromId, toNodeId: toId, kind, role });
    // A material the source's prompt names has to reach the node it now
    // feeds, and the new target may be missing a material its own prompt
    // names. The rule lives in `actions.mjs`, so the Agent and the page wire
    // it the same way.
    applyMentions(fromId);
    applyMentions(toId);
    if (!options.quiet) {
      markDirty();
      render();
    }
    return { ok: true, reason: '' };
  }

  /**
   * Wire the material a prompt names into the nodes that need it.
   *
   * A mention says the prompt is about that material, so the node that
   * generates from the prompt has to receive it as an input of its own —
   * otherwise the prompt names a picture the request never sends. The rule
   * lives in `actions.mjs`, so the Agent and the page wire it the same way.
   */
  function applyMentions(nodeId) {
    if (!nodeId) return false;
    const synced = syncMentions(state.canvas, nodeId, actionContext());
    if (synced.added.length === 0 && synced.connected.length === 0) return false;
    state.canvas.nodes = synced.canvas.nodes;
    state.canvas.connections = synced.canvas.connections;
    markDirty();
    return true;
  }

  // ---------------------------------------------------------------- viewport

  function applyViewport() {
    const { x, y, k } = state.canvas.viewport;
    dom.world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    const size = GRID_SIZE * k;
    dom.grid.style.backgroundSize = `${size}px ${size}px`;
    dom.grid.style.backgroundPosition = `${x % size}px ${y % size}px`;
    const dot = k < 0.12 ? 0.9 : 1.2;
    const line = k < 0.12 ? 0.16 : 0.1;
    dom.grid.style.backgroundImage =
      state.canvas.backgroundMode === 'dots'
        ? `radial-gradient(circle, rgba(148,163,184,${line + 0.14}) ${dot}px, transparent ${dot + 0.4}px)`
        : `linear-gradient(rgba(148,163,184,${line}) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,${line}) 1px, transparent 1px)`;
    dom.zoom.textContent = `${Math.round(k * 100)}%`;
    renderMinimap();
  }

  function screenToWorld(clientX, clientY) {
    const rect = dom.viewport.getBoundingClientRect();
    const { x, y, k } = state.canvas.viewport;
    return { x: (clientX - rect.left - x) / k, y: (clientY - rect.top - y) / k };
  }

  /**
   * The world position of a port.
   *
   * A generating node can have several input ports, so a line has to start
   * and end on the port itself and not on the middle of the node.
   *
   * A text line is the exception: a node with a text box takes its text in the
   * box, so the line ends on the box and not on a port.
   */
  function portPointOf(node, side, kind = '', role = '') {
    if (side === 'in' && kind === 'text' && hasTextBox(node)) {
      const box = dom.nodes.querySelector(`[data-node-id="${node.id}"] [data-text-box]`);
      if (box) {
        const rect = box.getBoundingClientRect();
        return screenToWorld(rect.left, rect.top + rect.height / 2);
      }
    }
    // A mode that takes the same kind twice has two ports of it, and the role
    // is what tells them apart.
    const selector = role
      ? `[data-node-id="${node.id}"] [data-port="${side}"][data-kind="${kind}"][data-role="${role}"]`
      : kind
        ? `[data-node-id="${node.id}"] [data-port="${side}"][data-kind="${kind}"]`
        : null;
    const byKind = selector ? dom.nodes.querySelector(selector) : null;
    const el = byKind ?? dom.nodes.querySelector(`[data-node-id="${node.id}"] [data-port="${side}"]`);
    if (!el) {
      return {
        x: side === 'in' ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
      };
    }
    const rect = el.getBoundingClientRect();
    return screenToWorld(side === 'in' ? rect.left : rect.right, rect.top + rect.height / 2);
  }

  // The same, for the port element the pointer went down on.
  function portPointOfEl(el, side) {
    const rect = el.getBoundingClientRect();
    return screenToWorld(side === 'in' ? rect.left : rect.right, rect.top + rect.height / 2);
  }

  function centerOfViewport() {
    const rect = dom.viewport.getBoundingClientRect();
    return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  // ---------------------------------------------------------------- minimap

  function minimapBox() {
    const nodes = state.canvas.nodes;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + node.width);
      maxY = Math.max(maxY, node.position.y + node.height);
    }
    const vp = state.canvas.viewport;
    const rect = dom.viewport.getBoundingClientRect();
    const vw = rect.width / vp.k;
    const vh = rect.height / vp.k;
    minX = Math.min(minX, -vp.x / vp.k);
    minY = Math.min(minY, -vp.y / vp.k);
    maxX = Math.max(maxX, -vp.x / vp.k + vw);
    maxY = Math.max(maxY, -vp.y / vp.k + vh);
    if (!Number.isFinite(minX)) return null;
    minX -= 60;
    minY -= 60;
    maxX += 60;
    maxY += 60;
    const k = Math.min(MINI_W / Math.max(1, maxX - minX), MINI_H / Math.max(1, maxY - minY));
    return {
      minX,
      minY,
      k,
      ox: (MINI_W - (maxX - minX) * k) / 2,
      oy: (MINI_H - (maxY - minY) * k) / 2,
    };
  }

  function renderMinimap() {
    if (!state.minimap || !dom.minimap) return;
    const ctx = dom.minimap.getContext('2d');
    ctx.clearRect(0, 0, MINI_W, MINI_H);
    const box = minimapBox();
    if (!box) return;
    for (const node of state.canvas.nodes) {
      const w = node.width * box.k;
      const h = node.height * box.k;
      const x = (node.position.x - box.minX) * box.k + box.ox;
      const y = (node.position.y - box.minY) * box.k + box.oy;
      ctx.fillStyle =
        node.type === 'group'
          ? 'rgba(167,139,250,.20)'
          : state.selection.includes(node.id)
            ? 'rgba(34,211,238,.60)'
            : 'rgba(120,140,170,.45)';
      ctx.fillRect(x, y, Math.max(2, w), Math.max(2, h));
    }
    const vp = state.canvas.viewport;
    const rect = dom.viewport.getBoundingClientRect();
    const vx = (-vp.x / vp.k - box.minX) * box.k + box.ox;
    const vy = (-vp.y / vp.k - box.minY) * box.k + box.oy;
    ctx.strokeStyle = 'rgba(34,211,238,.95)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, Math.max(6, (rect.width / vp.k) * box.k), Math.max(6, (rect.height / vp.k) * box.k));
  }

  function minimapJump(event) {
    const box = minimapBox();
    if (!box) return;
    const rect = dom.minimap.getBoundingClientRect();
    const worldX = (event.clientX - rect.left - box.ox) / box.k + box.minX;
    const worldY = (event.clientY - rect.top - box.oy) / box.k + box.minY;
    const vpRect = dom.viewport.getBoundingClientRect();
    state.canvas.viewport = {
      x: vpRect.width / 2 - worldX * state.canvas.viewport.k,
      y: vpRect.height / 2 - worldY * state.canvas.viewport.k,
      k: state.canvas.viewport.k,
    };
    applyViewport();
    markDirty({ history: false });
  }

  // ---------------------------------------------------------------- composer

  function plainTextOf(segments) {
    return plainText(segments);
  }

  function buildChip(segment) {
    const source = getNode(segment.nodeId);
    const media = source?.metadata?.output?.media?.[0];
    const orphan = !media;
    const chip = el(
      'span',
      `nxc-mention-chip nxc-mention-chip--${segment.kind}${orphan ? ' nxc-mention-chip--orphan' : ''}`,
    );
    chip.contentEditable = 'false';
    chip.dataset.mentionNodeId = segment.nodeId;
    chip.dataset.mentionKind = segment.kind;
    if (segment.kind === 'image' && media?.url && !orphan) {
      const img = el('img', 'nxc-mention-chip__thumb');
      img.src = media.url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      chip.appendChild(img);
    } else if (segment.kind === 'video' && media?.url && !orphan) {
      const video = el('video', 'nxc-mention-chip__thumb');
      video.src = media.url;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      chip.appendChild(video);
    } else {
      const thumb = el('span', 'nxc-mention-chip__thumb nxc-mention-chip__thumb--audio');
      thumb.textContent = segment.kind === 'audio' ? '♪' : '·';
      chip.appendChild(thumb);
    }
    chip.appendChild(el('span', null, source?.title ?? '（素材已删除）'));
    if (orphan) chip.title = '素材已不在画布里，生成时会忽略它';
    return chip;
  }

  function renderSegments(editor, segments) {
    editor.textContent = '';
    for (const segment of segments) {
      if (segment.type === 'text') editor.appendChild(document.createTextNode(segment.text));
      else editor.appendChild(buildChip(segment));
    }
  }

  function caretTextIndex(editor) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return plainTextOf(parseSegments(editor)).length;
    const range = selection.getRangeAt(0);
    return textIndexBefore(editor, range.startContainer, range.startOffset);
  }

  function insertMention(node, editor, candidate) {
    const segments = parseSegments(editor);
    const caret = caretTextIndex(editor);
    let consumed = 0;
    let inserted = false;
    const next = [];
    for (const segment of segments) {
      const length = segment.type === 'text' ? segment.text.length : 1;
      if (!inserted && caret <= consumed + length) {
        if (segment.type === 'text') {
          const offset = Math.max(0, Math.min(segment.text.length, caret - consumed));
          if (segment.text.slice(0, offset)) next.push({ type: 'text', text: segment.text.slice(0, offset) });
          next.push({ type: 'mention', nodeId: candidate.id, kind: candidate.kind });
          if (segment.text.slice(offset)) next.push({ type: 'text', text: segment.text.slice(offset) });
        } else {
          next.push(segment);
          next.push({ type: 'mention', nodeId: candidate.id, kind: candidate.kind });
        }
        inserted = true;
        continue;
      }
      next.push(segment);
      consumed += length;
    }
    if (!inserted) next.push({ type: 'mention', nodeId: candidate.id, kind: candidate.kind });
    renderSegments(editor, next);
    syncSegments(node, editor);
    // The prompt now names that material, so the nodes that generate from
    // this prompt have to receive it. The board is not redrawn here: the
    // editor has the focus, and a redraw would take the caret away. The
    // next redraw shows it.
    applyMentions(node.id);
    // The editor sits in the transformed layer, so the focus must not scroll
    // the canvas to the editor's layout box.
    editor.focus({ preventScroll: true });
  }

  function syncSegments(node, editor) {
    const segments = parseSegments(editor);
    node.metadata.segments = segments;
    node.metadata.prompt = plainTextOf(segments);
    node.metadata.mentions = segments
      .filter((s) => s.type === 'mention')
      .map((s) => ({ nodeId: s.nodeId, kind: s.kind }));
    // An input node holds what goes in, so its text is its content: the
    // downstream node reads it as the prompt material.
    if (node.type === 'input') {
      node.metadata.output.text = node.metadata.prompt;
      node.metadata.output.status = 'success';
      node.metadata.output.updatedAt = new Date().toISOString();
    }
  }

  /**
   * The sources a mention can point at.
   *
   * The whole canvas is in the list, not only the chain above the node: a
   * prompt may be about a picture that sits somewhere else, and naming it is
   * what wires it in. The rule lives in `tools.mjs`, so the page and the
   * runtime read the same one.
   */
  function mentionCandidates(node) {
    return mentionCandidatesOf(state.canvas, node);
  }

  function closeMentionMenu() {
    state.mention = null;
    dom.mentionMenu.hidden = true;
  }

  function openMentionMenu(node, editor, query) {
    const items = mentionCandidates(node).filter((item) =>
      query ? item.title.toLowerCase().includes(query.toLowerCase()) : true,
    );
    if (items.length === 0) {
      closeMentionMenu();
      return;
    }
    state.mention = { nodeId: node.id, editor, items, activeIndex: 0 };
    const menu = dom.mentionMenu;
    menu.textContent = '';
    items.forEach((item, index) => {
      const button = el('button', `nxc-mention-menu__item${index === 0 ? ' is-active' : ''}`);
      button.type = 'button';
      if (item.url) {
        const img = el('img', 'nxc-mention-menu__thumb');
        img.src = item.url;
        img.alt = '';
        button.appendChild(img);
      } else {
        button.appendChild(el('span', 'nxc-mention-menu__thumb', item.kind === 'audio' ? '♪' : '♪'));
      }
      button.appendChild(el('span', 'nxc-mention-menu__label', item.title));
      // The whole board is in the list, so the menu says which of them are
      // already above this node — those are the ones a prompt is usually
      // about, and the ones that need no new line.
      if (item.upstream) {
        button.appendChild(el('span', 'nxc-mention-menu__hint', '上游'));
      }
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        insertMention(node, editor, item);
        closeMentionMenu();
      });
      menu.appendChild(button);
    });
    const rect = editor.getBoundingClientRect();
    // The mention menu is placed before it is shown, so its size is an
    // estimate. The estimate still goes through the shared rule, so the
    // menu cannot land above the top of the window.
    const place = placeOverlay(
      { left: rect.left, top: rect.bottom + 6 },
      { width: 258, height: 220 },
      { width: window.innerWidth, height: window.innerHeight },
    );
    menu.style.left = `${place.left}px`;
    menu.style.top = `${place.top}px`;
    menu.hidden = false;
  }

  function maybeOpenMentionMenu(node, editor) {
    const query = detectMention(parseSegments(editor), caretTextIndex(editor));
    if (query === null) closeMentionMenu();
    else openMentionMenu(node, editor, query);
  }

  /**
   * The prompt an upstream text line handed over.
   *
   * It is shown read-only: the text comes from upstream, so there is nothing
   * to type here any more. The node keeps its own prompt — it comes back when
   * the line is gone — so the user is told that it is still there.
   */
  function renderInheritedPrompt(node, inherited) {
    const box = el('div', 'nxc-inherited');
    box.dataset.canvasNoZoom = 'true';
    // The text box is where a text line lands, so the line ends here.
    box.dataset.textBox = '1';
    box.appendChild(el('div', 'nxc-inherited__label', `来自上游：${inherited.title}`));
    box.appendChild(el('div', 'nxc-inherited__text', inherited.text));
    if (String(node.metadata?.prompt ?? '').trim()) {
      box.appendChild(el('div', 'nxc-inherited__note', '你自己写的提示词还留着：断开这条线就能继续改。'));
    }
    return box;
  }

  /**
   * The upload control of an input node.
   *
   * The file is sent to the Node service, which keeps it under its own data
   * directory and serves it back. The provider cannot reach that address, so
   * the runtime uploads the file to the provider when it is used as a
   * reference.
   *
   * Only a node that holds material has one: a text node holds text, which
   * is typed or filled from a template, so it has nothing to pick.
   */
  function renderUpload(node) {
    const wrap = el('div', 'nxc-upload');
    wrap.dataset.canvasNoZoom = 'true';

    const picker = el('input', 'nxc-upload__file');
    picker.type = 'file';
    const kind = node.metadata.kind ?? 'image';
    const label = { image: '图片', video: '视频', audio: '音频' }[kind] ?? '素材';
    // The input card only takes what its kind is for.
    picker.accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : 'audio/*';
    picker.multiple = kind === 'image';
    picker.title = `把本机的${label}放进这个输入节点`;
    picker.setAttribute('aria-label', `选择本地${label}`);
    picker.addEventListener('change', () => {
      const files = [...(picker.files ?? [])];
      picker.value = '';
      if (files.length) void uploadFiles(node, files);
    });
    wrap.appendChild(picker);

    const media = node.metadata.output?.media ?? [];
    if (media.length) {
      const list = el('div', 'nxc-upload__list');
      for (const item of media) {
        const row = el('div', 'nxc-upload__item');
        row.appendChild(el('span', 'nxc-upload__name', item.name || item.url));
        const remove = el('button', 'nxc-upload__remove', '×');
        remove.type = 'button';
        remove.title = '移除这个素材';
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          node.metadata.output.media = media.filter((entry) => entry !== item);
          node.metadata.output.updatedAt = new Date().toISOString();
          markDirty();
          render();
        });
        row.appendChild(remove);
        list.appendChild(row);
      }
      wrap.appendChild(list);
    }
    return wrap;
  }

  async function uploadFiles(node, files) {
    showBanner(`正在上传 ${files.length} 个文件…`);
    let failed = 0;
    for (const file of files) {
      try {
        // The node's kind travels with the request: an input node holds one
        // kind of material, so the wrong file is refused by the runtime.
        const kind = node.metadata.kind ?? 'image';
        const response = await fetch(
          `/api/uploads?name=${encodeURIComponent(file.name)}&kind=${encodeURIComponent(kind)}`,
          {
            method: 'POST',
            headers: { 'content-type': file.type || 'application/octet-stream' },
            body: file,
          },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
        const output = node.metadata.output;
        output.media = [
          ...(output.media ?? []),
          { url: payload.url, kind: payload.kind, name: payload.originalName, local: true },
        ];
        output.status = 'success';
        output.updatedAt = new Date().toISOString();
      } catch (error) {
        failed += 1;
        showBanner(`「${file.name}」上传失败：${error?.message ?? error}`, 'error');
      }
    }
    if (!failed) showBanner(`${files.length} 个文件已上传`);
    markDirty();
    render();
  }

  /**
   * The template the prompt node expands the sentence with: a preset from the
   * palette, or one the user writes.
   */
  function renderPromptTemplate(node) {
    const wrap = el('div', 'nxc-template');
    wrap.dataset.canvasNoZoom = 'true';
    const templates = state.palette?.promptTemplates ?? [];
    const current = templates.find((item) => item.id === node.metadata.templateId) ?? templates[0];

    const dropdown = createDropdown({
      options: templates.map((item) => ({ value: item.id, label: item.label })),
      value: node.metadata.templateId || current?.id,
      onChange: (value) => {
        const preset = templates.find((item) => item.id === value);
        node.metadata.templateId = value;
        node.metadata.templateText = preset?.text ?? '';
        markDirty();
        render();
      },
    });
    wrap.appendChild(dropdown);

    const field = el('textarea', 'nxc-template__text');
    field.value = node.metadata.templateText ?? '';
    field.placeholder = '写自己的模板要求；留空则只按原句扩写';
    field.rows = 2;
    field.setAttribute('aria-label', '提示词模板');
    field.addEventListener('input', () => {
      node.metadata.templateText = field.value;
      const preset = templates.find((item) => item.id === node.metadata.templateId);
      if (!preset || preset.text !== field.value) node.metadata.templateId = 'custom';
      markDirty();
    });
    wrap.appendChild(field);
    return wrap;
  }

  // The prompt the prompt node sends to the text model is built in
  // `actions.mjs`, where the page and the runtime share it.

  function createComposer(node) {
    const wrap = el('div', 'nxc-composer');
    // The text box is where a text line lands: the line ends here, not on a
    // port on the edge of the card.
    wrap.dataset.textBox = '1';
    const mentionWrap = el('div', 'nxc-composer__mention-wrap');
    const placeholder = el('div', 'nxc-composer__placeholder', placeholderFor(node));
    const editor = el('div', 'nxc-composer__editor');
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    // A placeholder is a hint, not a name: the editor needs one of its own.
    editor.setAttribute('aria-label', `${KIND_LABEL[node.type] ?? node.type}节点的提示词`);
    editor.dataset.canvasNoZoom = 'true';

    renderSegments(editor, node.metadata.segments ?? []);
    state.editors.set(node.id, editor);
    let composing = false;

    editor.addEventListener('compositionstart', () => {
      composing = true;
    });
    editor.addEventListener('compositionend', () => {
      composing = false;
      syncSegments(node, editor);
      maybeOpenMentionMenu(node, editor);
      markDirty();
    });
    editor.addEventListener('input', () => {
      if (composing) return;
      syncSegments(node, editor);
      maybeOpenMentionMenu(node, editor);
      markDirty();
    });
    editor.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.nativeEvent?.isComposing) return;
      if (state.mention) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          state.mention.activeIndex = (state.mention.activeIndex + 1) % state.mention.items.length;
          paintMentionActive();
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          state.mention.activeIndex =
            (state.mention.activeIndex - 1 + state.mention.items.length) % state.mention.items.length;
          paintMentionActive();
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          const item = state.mention.items[state.mention.activeIndex];
          if (item) insertMention(node, editor, item);
          closeMentionMenu();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMentionMenu();
          return;
        }
      }
      if (event.key === 'Escape') editor.blur();
    });
    editor.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!state.mention) closeMentionMenu();
        flushRender();
        pushHistory();
      }, 120);
    });

    mentionWrap.appendChild(placeholder);
    mentionWrap.appendChild(editor);
    wrap.appendChild(mentionWrap);
    wrap.appendChild(el('div', 'nxc-composer__hint', '输入 @ 可引用上游节点的产物'));
    return wrap;
  }

  function paintMentionActive() {
    const items = dom.mentionMenu.querySelectorAll('.nxc-mention-menu__item');
    items.forEach((item, index) => {
      item.classList.toggle('is-active', index === state.mention?.activeIndex);
    });
  }

  function placeholderFor(node) {
    const hasUpstream = upstreamOf(node.id).length > 0;
    const mode = modeOf(node);
    if (mode === 'prompt') return '一句话说明你想要什么，例如：一只猫在窗边打盹';
    if (mode === 'video2text') return '要反推的重点，例如：只写运镜和光线';
    if (mode === 'music') return '例如：轻快电子口播 BGM，120 BPM，无人声';
    if (node.type === 'input') return '写要送进去的内容';
    if (node.type === 'text') return '描述要生成的文本内容';
    if (node.type === 'video') return hasUpstream ? '描述要生成的视频内容，输入 @ 引用上游素材' : '描述要生成的视频内容';
    if (node.type === 'audio') return '描述要生成的音频内容';
    return hasUpstream ? '描述要生成的图片内容，输入 @ 引用上游接入的图…' : '描述要生成的图片内容';
  }

  // ---------------------------------------------------------------- node render

  /** The kind of a node and the mode it is in, as the header shows it. */
  function nodeKindLabel(node) {
    const mode = nodeModeLabel(node);
    const kind = KIND_LABEL[node.type] ?? node.type;
    if (node.type === 'input') {
      return `输入 · ${state.palette?.inputKindLabels?.[node.metadata.kind] ?? node.metadata.kind}`;
    }
    return mode ? `${kind} · ${mode}` : kind;
  }

  /**
   * The accessible name of a node.
   *
   * It names the node and says whether it is selected, so the selection is
   * carried by words as well and not by the border colour alone.
   */
  /**
   * Whether a node takes part in the current selection.
   *
   * While something is selected, the rest of the board steps back, so the
   * selection and the lines around it are what the eye lands on.
   */
  function isRelatedToSelection(nodeId) {
    if (state.selection.length === 0) return true;
    if (state.selection.includes(nodeId)) return true;
    return state.canvas.connections.some((conn) => (
      (state.selection.includes(conn.fromNodeId) && conn.toNodeId === nodeId)
      || (state.selection.includes(conn.toNodeId) && conn.fromNodeId === nodeId)
    ));
  }

  /**
   * The slots of a node: what may be plugged into it, and what it hands on.
   *
   * The rule itself lives in `forms.mjs`, where the node table is, so the page
   * and the runtime declare the same slots.
   */
  function slotsOf(node) {
    const slots = slotsOfForm(node);
    // The strip reads the same rule the ports are drawn from: the text goes
    // into the card's text box, and a kind the model cannot take is not an
    // input either.
    return { inputs: stripInputs(node, effectiveCaps(node)), outputs: slots.outputs };
  }

  /**
   * The slot strip under the header: what may come in, and what goes out.
   *
   * An open slot stays hollow and says it is waiting, so what is still
   * missing can be read off the card without touching anything.
   */
  function renderSlotStrip(node, slots) {
    const strip = el('div', 'nxc-slots');
    if (slots.inputs.length > 0) {
      const inRow = el('div', 'nxc-slots__row');
      inRow.appendChild(el('span', 'nxc-slots__label', '入'));
      for (const slot of slots.inputs) {
        inRow.appendChild(renderSlot(slot, portState(state.canvas, node, slot)));
      }
      strip.appendChild(inRow);
    }
    if (slots.outputs.length > 0) {
      const outRow = el('div', 'nxc-slots__row nxc-slots__row--out');
      for (const slot of slots.outputs) {
        // An output is what the node hands on, so it is never waiting.
        outRow.appendChild(renderSlot(slot, 'out'));
      }
      outRow.appendChild(el('span', 'nxc-slots__label', '出'));
      strip.appendChild(outRow);
    }
    return strip;
  }

  /**
   * One slot: a dot in the colour of the data, and the name of that data.
   *
   * The state is carried by the shape of the dot, by the word next to it and
   * by the tooltip, so it does not depend on colour alone.
   *
   * A port that has a role says which one it is: 首帧 and 尾帧 are both
   * pictures, and the user has to be able to tell them apart.
   */
  function renderSlot(slot, slotState = 'filled') {
    const kind = slot?.kind ?? slot;
    const open = slotState === 'open';
    const item = el('span', `nxc-slot${open ? ' is-open' : ''}${slotState === 'out' ? ' is-out' : ''}`);
    item.dataset.kind = kind;
    item.dataset.state = slotState;
    const label = KIND_LABEL[kind] ?? kind;
    const name = slot?.label ? `${slot.label} ${label}` : label;
    item.title = {
      filled: `${name} · 已接入`,
      ready: `${name} · 已就绪`,
      open: `${name} · 待接入`,
      out: `${name} · 产出`,
    }[slotState] ?? name;
    item.appendChild(el('i', 'nxc-slot__dot'));
    item.appendChild(el('span', 'nxc-slot__name', name));
    if (open) item.appendChild(el('span', 'nxc-slot__wait', '待接入'));
    return item;
  }

  function nodeAccessibleName(node) {
    const kind = nodeKindLabel(node);
    // A node that still carries its default title would say its kind twice.
    const title = node.title && node.title !== kind ? node.title : '';
    const name = [kind, title].filter(Boolean).join(' ');
    return state.selection.includes(node.id) ? `${name}（已选）` : name;
  }

  function renderNode(node) {
    // What the model this node selected can take. The ports and the modes
    // follow it, so the card never offers something the run would refuse.
    const caps = effectiveCaps(node);
    const wrap = el('div', 'nxc-node');
    wrap.dataset.nodeId = node.id;
    wrap.classList.add(`nxc-node--${node.type}`);
    const selected = state.selection.includes(node.id);
    if (selected) wrap.classList.add('nxc-node--selected');
    // A node is a group of controls, so it gets a name of its own.
    wrap.setAttribute('role', 'group');
    if (node.id === state.snapNodeId) wrap.classList.add('nxc-node--connect-snap');
    const status = node.metadata.output?.status;
    if (status === 'loading') wrap.classList.add('nxc-node--loading');
    if (status === 'error') wrap.classList.add('nxc-node--error');
    // The hue of the card, the ports and the line: what the node carries.
    wrap.dataset.kind = kindOf(node);
    // The state, as a colour next to the words that say it.
    wrap.dataset.state = {
      loading: 'running',
      success: 'done',
      error: 'error',
      interrupted: 'interrupted',
    }[status] ?? 'idle';
    // While something is selected, the rest of the board steps back.
    if (!isRelatedToSelection(node.id)) wrap.classList.add('is-dim');
    wrap.style.left = `${node.position.x}px`;
    wrap.style.top = `${node.position.y}px`;
    wrap.style.width = `${node.width}px`;
    wrap.style.height = `${node.height}px`;

    const head = el('div', 'nxc-node__head');
    // A dot that says how the node is doing, beside the words that say it.
    head.appendChild(el('i', 'nxc-node__state'));
    // The kind, and the mode the node is in: 文生图 becomes 图生图 when a
    // picture is connected to it. An input card names what it takes.
    const kindLabel = nodeKindLabel(node);
    const kind = el('span', 'nxc-node__kind', kindLabel);
    kind.dataset.kind = node.type;
    head.appendChild(kind);

    if (state.editingTitleId === node.id) {
      const input = el('input', 'nxc-node__title-input');
      input.value = node.title;
      input.addEventListener('blur', () => {
        state.editingTitleId = null;
        node.title = input.value.trim() || node.title;
        markDirty();
        window.setTimeout(() => scheduleRender(), 0);
      });
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') input.blur();
        if (event.key === 'Escape') {
          input.value = node.title;
          input.blur();
        }
      });
      head.appendChild(input);
      window.setTimeout(() => {
        // The card is a transformed layer: focusing the field must not scroll
        // the canvas to the field's layout box.
        input.focus({ preventScroll: true });
        input.select();
      }, 0);
    } else {
      const title = el('span', 'nxc-node__title', node.title);
      title.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        state.editingTitleId = node.id;
        render();
      });
      head.appendChild(title);
    }

    // The selection is not only a border colour: the node says so in words,
    // and its name carries the same state for a reader that cannot see it.
    const chip = el('span', 'nxc-node__sel', '已选');
    chip.hidden = !selected;
    head.appendChild(chip);
    wrap.setAttribute('aria-label', nodeAccessibleName(node));

    const task = state.tasks.get(state.nodeTasks.get(node.id));
    if (task && (task.status === 'running' || task.status === 'waiting-question')) {
      const badge = el('span', 'nxc-node__status');
      badge.dataset.tone = 'running';
      badge.appendChild(el('i', 'nxc-spin'));
      badge.appendChild(document.createTextNode(`${Math.round((task.elapsedMs ?? 0) / 1000)}s`));
      head.appendChild(badge);
    } else if (status && status !== 'idle') {
      const badge = el('span', 'nxc-node__status');
      badge.dataset.tone = status === 'success' ? 'success' : status === 'error' ? 'error' : 'running';
      badge.textContent = { success: '已完成', error: '失败', interrupted: '已中断' }[status] ?? status;
      // A batch that lost an asset says so on the card: the user asked for
      // four and three came out, and the card has to say it.
      const asked = Number(node.metadata.count ?? 1);
      const made = Array.isArray(task?.media) ? task.media.length : 0;
      if (status === 'success' && asked > 1 && made > 0 && made < asked) {
        badge.textContent = `已完成 ${made}/${asked}`;
        badge.dataset.tone = 'error';
        badge.title = `这一批里少了 ${asked - made} 张`;
      }
      head.appendChild(badge);
    }
    wrap.appendChild(head);

    // The slots: what may come in and what goes out, read off the card.
    const slots = slotsOf(node);
    if (slots.inputs.length > 0 || slots.outputs.length > 0) {
      wrap.appendChild(renderSlotStrip(node, slots));
    }

    const body = el('div', 'nxc-node__body');
    const role = roleOf(node);
    if (role === 'group') {
      body.appendChild(el('div', 'nxc-note', '把相关的节点框进来'));
    } else if (role === 'input') {
      // The input card holds what goes in: one kind of material. What kind it
      // is, the header says — there is no switch for it, because the kind is
      // fixed when the node is created.
      const kind = node.metadata.kind ?? 'text';
      if (kind === 'text') {
        // A text node holds text: the template fills it and the composer
        // holds it, so there is nothing else on the card.
        body.appendChild(renderTemplatePicker(node));
        body.appendChild(createComposer(node));
      } else {
        // A node that holds material shows what it holds and lets the user
        // pick more. It has no text box: the text that goes with the material
        // is another node's job — a text input above it, or the prompt of the
        // node it feeds.
        body.appendChild(renderOutput(node));
        body.appendChild(renderUpload(node));
      }
    } else if (role === 'result') {
      // The result card only shows what was produced.
      body.appendChild(renderOutput(node));
    } else {
      // The generating card has the prompt, the model and the button, and
      // no result of its own: the result arrives as its own node.
      // A text line that landed on this node hands its text over, so the box
      // shows that text instead of the user's own prompt.
      const inherited = inheritedTextFor(state.canvas, node);
      if (inherited) {
        body.appendChild(renderInheritedPrompt(node, inherited));
      } else {
        body.appendChild(createComposer(node));
      }
      // The prompt mode of a text node brings the template picker with it.
      if (modeOf(node) === 'prompt') body.appendChild(renderPromptTemplate(node));
      body.appendChild(renderParams(node));
    }
    if (node.metadata.output?.error) {
      body.appendChild(el('div', 'nxc-node__error', node.metadata.output.error));
    }
    wrap.appendChild(body);
    bindNodeGestures(node, wrap);

    if (role === 'result') {
      // The footer is the toolbar. A card with no tools has no footer, so no
      // empty strip with a border is left under the material.
      const bar = renderToolBar(node);
      if (bar) {
        const footer = el('div', 'nxc-node__footer');
        footer.appendChild(bar);
        wrap.appendChild(footer);
      }
    }

    if (node.type !== 'group') {
      // One port per input kind the node can take, so the picture of what
      // this node needs is on the card itself. A node with a text box takes
      // its text in the text box, so the text has no port: the line lands on
      // the box instead. And a kind the model cannot take has no port either:
      // the card must not offer something the run would refuse.
      const ports = portList(node, caps);
      const labels = state.palette?.inputKindLabels ?? {};
      ports.forEach((port, index) => {
        const portIn = el('button', 'nxc-node__port nxc-node__port--in');
        portIn.type = 'button';
        portIn.dataset.port = 'in';
        portIn.dataset.kind = port.kind;
        // A port that has a role says which one it is, so the line that
        // lands on it says the same thing.
        if (port.role) portIn.dataset.role = port.role;
        // The port and the slot strip read the same state, so the card never
        // says two different things about the same input. The name is not
        // `state` on purpose: that would shadow the app state inside its own
        // initializer and the card would fail to render.
        const slotState = portState(state.canvas, node, port);
        if (slotState !== 'open') portIn.classList.add('is-connected');
        const portLabel = port.label ? `${port.label} ` : '';
        portIn.title = `接入${portLabel}${labels[port.kind] ?? port.kind}（${
          slotState === 'filled' ? '已接入' : slotState === 'ready' ? '已就绪' : '未接入'
        }）`;
        portIn.setAttribute('aria-label', portIn.title);
        // The ports are spread around the middle of the left edge.
        portIn.style.top = `${50 + (index - (ports.length - 1) / 2) * 13}%`;
        wrap.appendChild(portIn);
      });

      const portOut = el('button', 'nxc-node__port nxc-node__port--out');
      portOut.type = 'button';
      portOut.dataset.port = 'out';
      portOut.dataset.kind = kindOf(node);
      portOut.title = `输出${KIND_LABEL[kindOf(node)] ?? kindOf(node)}`;
      portOut.setAttribute('aria-label', portOut.title);
      wrap.appendChild(portOut);
    }

    const resize = el('span', 'nxc-node__resize');
    resize.dataset.resize = 'se';
    wrap.appendChild(resize);

    if (status === 'loading') {
      const ns = 'http://www.w3.org/2000/svg';
      const comet = document.createElementNS(ns, 'svg');
      comet.setAttribute('class', 'nxc-node__comet');
      comet.setAttribute('width', String(node.width + 2));
      comet.setAttribute('height', String(node.height + 2));
      comet.setAttribute('aria-hidden', 'true');
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', String(node.width / 2));
      circle.setAttribute('cy', String(node.height / 2));
      circle.setAttribute('r', String(Math.max(node.width, node.height) / 2 + 4));
      comet.appendChild(circle);
      wrap.appendChild(comet);
    }

    return wrap;
  }

  // The preview keeps the media's own ratio and the card is sized around it.
  // The box itself is worked out by `fitMediaBox`, which is a pure function
  // and is covered by the test suite.
  const MEDIA_CHROME = 20; // the body padding and the preview border

  function applyMediaBox(mediaWrap, media, box) {
    mediaWrap.classList.add('nxc-node__media-wrap--fitted');
    mediaWrap.style.width = `${box.width}px`;
    mediaWrap.style.height = `${box.height}px`;
    if (media && media.tagName !== 'AUDIO') {
      media.style.width = '100%';
      media.style.height = '100%';
    }
  }

  /**
   * Size the node around the media it just produced.
   *
   * The preview box takes the media's own ratio, the card grows to fit it,
   * and a card the user never resized also follows the media's width.
   */
  function fitNodeToMedia(node, card, mediaWrap, media, naturalWidth, naturalHeight) {
    if (!naturalWidth || !naturalHeight) return;
    const output = node.metadata.output ?? (node.metadata.output = {});
    const signature = `${naturalWidth}x${naturalHeight}`;
    if (output.fittedSignature === signature && output.fittedSize) return;

    const box = fitMediaBox(naturalWidth / naturalHeight, Math.max(160, node.width - MEDIA_CHROME));
    applyMediaBox(mediaWrap, media, box);
    output.fittedSize = box;
    output.fittedSignature = signature;

    // A card that was never resized by hand follows the media; one that was
    // keeps the width the user chose.
    if (!node.metadata.userSized) {
      const width = Math.max(240, Math.min(420, box.width + MEDIA_CHROME));
      if (Math.abs(width - node.width) > 1) {
        node.width = width;
        card.style.width = `${width}px`;
      }
    }

    // The card grows with the preview: its natural height is measured with
    // the media box already in place.
    const previous = card.style.height;
    card.style.height = 'auto';
    const natural = card.offsetHeight;
    card.style.height = previous;
    const height = Math.max(200, Math.min(2000, Math.round(natural)));
    if (Math.abs(height - node.height) > 1) {
      node.height = height;
      card.style.height = `${height}px`;
      markDirty();
      renderConnections();
    }
    // The card is measured now, so the cards that were placed with it are
    // placed again by their real size.
    const groupId = layoutGroupOf.get(node.id);
    if (groupId) relayoutGroup(groupId);
  }

  /**
   * The name a file is saved under.
   *
   * The title of the node it belongs to, so the file on the desktop says
   * what it is, and the extension of the material, so the machine knows
   * what it is.
   */
  function fileNameFor(node, item) {
    const ext = (/\.[A-Za-z0-9]{2,5}$/.exec(String(item?.url ?? '')) ?? [])[0] ?? '';
    const base = String(node?.title ?? '素材').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60);
    return `${base || '素材'}${ext}`;
  }

  /**
   * Hand the material of a node to the user's machine.
   *
   * The runtime keeps the file so the canvas can point at it, but that folder
   * is not somewhere a person looks for a picture. The runtime copies it into
   * the Downloads folder under the name the node carries, and says where it
   * landed.
   */
  async function saveMedia(node, item) {
    const url = String(item?.url ?? '');
    if (!url) return false;
    const file = url.split('/').pop() ?? '';
    if (!file) return false;
    try {
      const result = await api(`/api/library/${encodeURIComponent(file)}/save`, {
        method: 'POST',
        body: { name: fileNameFor(node, item) },
      });
      showBanner(`已保存到 ${result.path}`);
      return true;
    } catch (error) {
      showBanner(`保存失败：${error?.message ?? error}`, 'error');
      return false;
    }
  }

  /** The row under a material: the way to get the file out of the app. */
  function renderMediaActions(node, item) {
    const row = el('div', 'nxc-node__media-actions');
    const save = el('button', 'nxc-btn nxc-btn--small', '保存');
    save.type = 'button';
    save.dataset.canvasNoZoom = 'true';
    save.title = '把这个文件存到电脑';
    save.addEventListener('click', (event) => {
      event.stopPropagation();
      saveMedia(node, item);
    });
    row.appendChild(save);
    return row;
  }

  function renderOutput(node) {
    const output = node.metadata.output ?? {};
    const box = el('div', 'nxc-node__output');
    if (output.media?.length) {
      box.classList.add('nxc-node__output--media');
      const item = output.media[0];
      const mediaWrap = el('div', 'nxc-node__media-wrap');
      mediaWrap.dataset.canvasNoZoom = 'true';
      if (item.kind === 'video') {
        const video = el('video', 'nxc-node__media');
        video.src = item.url;
        if (output.posterUrl) video.poster = output.posterUrl;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.addEventListener('loadedmetadata', () => {
          // The file is back: the card is whole again.
          if (output.missing) {
            output.missing = false;
            markDirty();
            render();
          }
          output.durationMs = Math.round((video.duration || 0) * 1000);
          output.width = video.videoWidth || 0;
          output.height = video.videoHeight || 0;
          const card = mediaWrap.closest('.nxc-node');
          if (card) fitNodeToMedia(node, card, mediaWrap, video, video.videoWidth, video.videoHeight);
        });
        video.addEventListener('seeked', () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(video, 0, 0);
            output.posterUrl = canvas.toDataURL('image/jpeg', 0.82);
            markDirty();
          } catch {
            // A cross-origin video cannot be sampled; that is expected.
          }
        });
        video.addEventListener('error', () => {
          if (output.missing) return;
          output.missing = true;
          markDirty();
          render();
        });
        mediaWrap.appendChild(video);
        const play = el('button', 'nxc-node__video-play');
        play.type = 'button';
        play.dataset.canvasNoZoom = 'true';
        play.textContent = '▶';
        play.addEventListener('click', (event) => {
          event.stopPropagation();
          if (video.paused) {
            video.muted = false;
            video.play().catch(() => {});
          } else {
            video.pause();
            video.muted = true;
          }
        });
        mediaWrap.appendChild(play);
        if (output.durationMs) {
          mediaWrap.appendChild(el('span', 'nxc-node__video-duration', formatDuration(output.durationMs)));
        }
      } else if (item.kind === 'audio') {
        const audio = el('audio', 'nxc-node__media nxc-node__media--audio');
        audio.src = item.url;
        audio.controls = true;
        audio.preload = 'metadata';
        mediaWrap.appendChild(audio);
      } else {
        const img = el('img', 'nxc-node__media');
        img.src = item.url;
        img.alt = '';
        img.draggable = false;
        img.addEventListener('load', () => {
          // The file is back: the card is whole again, and the chain may use
          // this step instead of running it once more. The card is drawn
          // again, because the tools of a card whose material was lost are
          // blocked until the material is there.
          if (output.missing) {
            output.missing = false;
            markDirty();
            render();
          }
          output.width = img.naturalWidth || 0;
          output.height = img.naturalHeight || 0;
          const card = mediaWrap.closest('.nxc-node');
          if (card) fitNodeToMedia(node, card, mediaWrap, img, img.naturalWidth, img.naturalHeight);
        });
        img.addEventListener('error', () => {
          // The asset is gone: say so instead of leaving a broken image.
          // The guard matters: a re-render builds a new image element, which
          // would fail again and start the loop over.
          if (output.missing) return;
          output.missing = true;
          markDirty();
          render();
        });
        mediaWrap.appendChild(img);
        if (state.crop?.nodeId === node.id) mediaWrap.appendChild(renderCropOverlay(node, mediaWrap));
      }
      // A media that was already measured keeps the box it was given, so the
      // card does not jump back to a fixed size on every render.
      if (output.fittedSize && item.kind !== 'audio') {
        applyMediaBox(mediaWrap, mediaWrap.querySelector('.nxc-node__media'), output.fittedSize);
      }
      // The file this card points at is gone. The card says so in words
      // instead of showing a broken picture, and the picture stays in the
      // page so the card heals by itself when the file is back.
      if (output.missing) {
        mediaWrap.classList.add('is-missing');
        mediaWrap.appendChild(el('div', 'nxc-media-lost', '素材已不在了。重新生成上游那一步，或者从资产库把它插回来。'));
      }
      box.appendChild(mediaWrap);
      // The way out of the app: the file is on this machine, and the user
      // may want it on theirs.
      box.appendChild(renderMediaActions(node, item));
    } else if (output.missing) {
      box.appendChild(el('div', 'nxc-media-lost', '素材已不在了'));
    } else if (output.text) {
      box.classList.add('nxc-node__output--text');
      box.appendChild(el('div', 'nxc-node__text-body', output.text));
    } else if (output.status !== 'loading' && output.status !== 'error') {
      box.appendChild(el('div', 'nxc-note', emptyHintFor(node)));
    }
    return box;
  }

  function emptyHintFor(node) {
    const mode = modeOf(node);
    // An input node does not generate anything: it holds what goes in. Only
    // the nodes that hold material show this; a text node says it in its
    // own box.
    if (roleOf(node) === 'input') return '这里放你要送进去的素材：上传一个文件。';
    if (mode === 'prompt') return '写好要扩写的句子，点「生成」。';
    if (mode === 'music') return '写一段音乐描述点「生成」。';
    if (node.type === 'text') return '写好提示词点「生成」。';
    if (node.type === 'video') return '写好提示词点「生成」出视频。';
    if (node.type === 'audio') return '写好要念的文案点「生成」。';
    return '还没出图。写好提示词点「生成」。';
  }

  function formatDuration(ms) {
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  /**
   * Snap the parameters onto what the model offers.
   *
   * The runtime snaps them again when it runs, so a value that is not allowed
   * would be changed behind the user's back. The page does it at the moment a
   * parameter changes, so what is shown is what will be generated.
   */
  function fitNodeParams(node, caps) {
    Object.assign(node.metadata, fitParamsToCaps(node.metadata, caps));
  }

  /**
   * Put the node in another mode.
   *
   * The ports are the mode's inputs, so a line the new mode does not take has
   * nowhere to land: it goes, and the user is told. The rule lives in
   * `actions.mjs`, so the runtime drops the same lines.
   */
  function renderParams(node) {
    const caps = effectiveCaps(node);
    const row = el('div', 'nxc-row');

    // The mode is a choice on the card: it says what the node takes, so the
    // ports on the left follow it. And a mode the model cannot run is not
    // offered at all: only MiniMax-H3 can continue a video.
    const modes = modesFor(node, caps);
    if (modes.length) {
      const field = paramSelect('模式', modeOf(node), modes.map((mode) => ({ value: mode.id, label: mode.label })), (value) => {
        // The same action the Agent sends, so the page and the runtime drop
        // the same lines.
        const applied = applyAction(
          state.canvas,
          { type: 'update_node', args: { id: node.id, mode: value } },
          actionContext(),
        );
        if (applied.error) {
          showBanner(`切不了这个模式：${applied.error}`, 'error');
          return;
        }
        state.canvas.nodes = applied.canvas.nodes;
        state.canvas.connections = applied.canvas.connections;
        // The prompt mode starts with the first preset, so it is useful
        // before anything is typed.
        if (value === 'prompt') {
          const at = state.canvas.nodes.findIndex((item) => item.id === node.id);
          if (at >= 0) {
            const template = promptTemplateFor({
              mode: 'prompt',
              templates: state.palette?.promptTemplates ?? [],
            });
            state.canvas.nodes[at].metadata.templateId = template.templateId;
            state.canvas.nodes[at].metadata.templateText = template.templateText;
          }
        }
        if (applied.info?.dropped?.length) {
          showBanner(`切到「${nodeModeLabel(node)}」后，去掉了 ${applied.info.dropped.length} 条连线（这个模式不接）。`, 'error');
        }
        // The new mode may take a material the prompt names, and the node may
        // not have it yet.
        applyMentions(node.id);
        markDirty();
        render();
        // The card was rebuilt, so the control that was used is gone and the
        // focus fell back to the page — where the next Tab would land on
        // another node. Put the focus back on this node's mode.
        focusModeControl(node);
      });
      // The control is found again by this name after the card is rebuilt.
      field.dataset.field = 'mode';
      row.appendChild(field);
    }

    // The ratio follows the request the mode makes. The two keyframe requests
    // follow the frame, so there is nothing to choose there.
    const ratioOptions = ratioOptionsFor(node, caps);
    if (ratioOptions.length) {
      row.appendChild(
        // The ratio says which way the frame lies, so the menu names it: the
        // value stays the ratio the provider takes.
        paramSelect('比例', node.metadata.ratio, ratioOptions.map((ratio) => ({
          value: ratio,
          label: ratioLabel(ratio),
        })), (value) => {
          node.metadata.ratio = value;
        }),
      );
    }
    if (caps.resolutions?.length) {
      row.appendChild(
        paramSelect('清晰度', node.metadata.resolution, caps.resolutions, (value) => {
          node.metadata.resolution = value;
        }),
      );
    }
    if (caps.supportsDuration && caps.durations?.length) {
      row.appendChild(
        paramSelect('时长', node.metadata.duration == null ? null : String(node.metadata.duration), caps.durations.map(String), (value) => {
          node.metadata.duration = Number(value);
          // The resolution depends on the duration, so it is snapped too.
          fitNodeParams(node, effectiveCaps(node));
          // The row shows what will be generated right away, not on the next
          // render tick.
          render();
        }),
      );
    }
    if (caps.supportsVoice) {
      // The voice catalogue is live data the Node service reads from the
      // connector; until it arrives the row says so instead of offering a
      // made-up list.
      const voiceOptions = state.voices.length
        ? state.voices
        : [{ value: '', label: state.voiceError ?? '音色清单读取中…' }];
      row.appendChild(
        paramSelect('音色', node.metadata.voice ?? 'male-qn-qingse', voiceOptions, (value) => {
          node.metadata.voice = value;
        }),
      );
      row.appendChild(
        paramSelect(
          '情绪',
          node.metadata.emotion ?? '',
          [{ value: '', label: '默认' }, ...(caps.emotions ?? [])],
          (value) => {
            node.metadata.emotion = value || null;
          },
        ),
      );
    }
    row.appendChild(modelSelect(node));

    // How many assets one run produces. It sits right next to the button that
    // starts the run, because that is where the choice matters.
    if (BATCH_MODES.includes(runModeOf(node))) {
      row.appendChild(
        paramSelect('数量', String(node.metadata.count ?? 1), BATCH_COUNTS, (value) => {
          node.metadata.count = Number(value);
        }),
      );
    }

    const running = isRunning(node.id);
    const generate = el('button', 'nxc-btn nxc-btn--primary', running ? '生成中…' : '生成');
    generate.type = 'button';
    generate.dataset.canvasNoZoom = 'true';
    generate.disabled = running || !state.agentAvailable;
    generate.addEventListener('click', (event) => {
      event.stopPropagation();
      void startRun(node);
    });
    row.appendChild(generate);

    // A node that ran through an Agent turn keeps its session, so the
    // conversation is still reachable after the run is over.
    if (node.metadata.sessionId) {
      if (pageAgent()?.open) {
        const chat = el('button', 'nxc-btn', '对话');
        chat.type = 'button';
        chat.dataset.canvasNoZoom = 'true';
        chat.title = '在对话里打开这次生成所在的会话';
        chat.addEventListener('click', (event) => {
          event.stopPropagation();
          void openInChat(node.metadata.sessionId);
        });
        row.appendChild(chat);
      }

      // A new turn in the same conversation carries the old one along. This
      // drops the root session, so the next run starts a fresh one. It is
      // disabled while a run is in flight: the run in flight would put its
      // own session back on the node.
      const fresh = el('button', 'nxc-btn', '新会话');
      fresh.type = 'button';
      fresh.dataset.canvasNoZoom = 'true';
      fresh.disabled = running;
      fresh.title = running
        ? '当前这次生成还在跑，跑完才能换新会话'
        : '下次生成从新会话开始，不再接着这次对话';
      fresh.addEventListener('click', (event) => {
        event.stopPropagation();
        node.metadata.sessionId = null;
        markDirty();
        render();
        showBanner('下次生成会开一个新会话');
      });
      row.appendChild(fresh);
    }

    const wrap = el('div', 'nxc-node__params');
    wrap.appendChild(row);

    // The video node has no sound switches: the mode says what the request
    // carries (a reference with an audio or without one), and the model's own
    // note says whether the picture comes with a track. A switch the request
    // ignores is a switch the user cannot trust.

    const refs = upstreamOf(node.id);
    if (refs.length > 0) {
      const counts = { image: 0, video: 0, audio: 0 };
      for (const ref of refs) {
        const kind = ref.metadata.output.media?.[0]?.kind;
        if (kind && counts[kind] !== undefined) counts[kind] += 1;
      }
      const text = [
        counts.image ? `${counts.image} 图` : '',
        counts.video ? `${counts.video} 视频` : '',
        counts.audio ? `${counts.audio} 音频` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      wrap.appendChild(el('span', 'nxc-node__refs', `引用 ${text}`));
    }
    return wrap;
  }

  /** The node's mode control, found again after the card was rebuilt. */
  function focusModeControl(node) {
    const el = dom.nodes.querySelector(
      `[data-node-id="${node.id}"] [data-field="mode"] .nxc-dropdown__button`,
    );
    el?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- dropdowns
  //
  // Native <select> popups are drawn by the browser as separate OS windows.
  // Inside the MiniApp host that window never reaches the screen, so every
  // drop-down silently does nothing. The canvas therefore draws its own
  // menu, which is plain DOM and behaves the same everywhere.

  function createDropdown({ options, value, onChange, className = 'nxc-select', placeholder = '' }) {
    const list = (options ?? []).map((option) => (
      option && typeof option === 'object'
        ? { value: option.value, label: option.label, hint: option.hint }
        : { value: option, label: String(option) }
    ));
    const wrap = el('span', 'nxc-dropdown');
    const button = el('button', `${className} nxc-dropdown__button`);
    button.type = 'button';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'dropdown-menu');
    const current = effectiveOption(list, value);
    button.textContent = current ? current.label : placeholder;
    button.title = current ? current.label : placeholder;
    button.dataset.dropdownValue = current ? String(current.value) : '';
    button.addEventListener('pointerdown', (event) => {
      // preventDefault keeps the button from stealing focus; stopPropagation
      // keeps the canvas from treating the press as a node drag.
      event.preventDefault();
      event.stopPropagation();
      toggleDropdown(button, list, onChange);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleDropdown(button, list, onChange);
      }
    });
    wrap.appendChild(button);
    return wrap;
  }

  function toggleDropdown(button, list, onChange) {
    if (state.dropdown?.button === button) {
      closeDropdown({ restoreFocus: true });
      return;
    }
    closeDropdown({ restoreFocus: false });
    const menu = dom.dropdownMenu;
    menu.textContent = '';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', '选项');
    const currentValue = button.dataset.dropdownValue;
    const entries = [];
    for (const item of list) {
      const entry = el('button', 'nxc-menu__item');
      entry.type = 'button';
      entry.setAttribute('role', 'option');
      const active = String(item.value) === currentValue;
      entry.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) entry.classList.add('is-active');
      entry.appendChild(el('span', null, item.label));
      if (item.hint) entry.appendChild(el('small', null, item.hint));
      entry.addEventListener('click', (event) => {
        event.stopPropagation();
        closeDropdown({ restoreFocus: false });
        // The label updates right away: waiting for a re-render would leave
        // the old value on screen and look like the click did nothing.
        button.textContent = item.label;
        button.title = item.label;
        button.dataset.dropdownValue = String(item.value);
        onChange(item.value, item);
      });
      menu.appendChild(entry);
      entries.push(entry);
    }
    menu.hidden = false;
    const rect = button.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    // Flip above the button when there is no room below.
    const below = rect.bottom + 4;
    const flip = below + size.height > window.innerHeight - 8;
    const place = placeOverlay(
      { left: rect.left, top: flip ? rect.top - size.height - 4 : below },
      size,
      { width: window.innerWidth, height: window.innerHeight },
    );
    menu.style.left = `${place.left}px`;
    menu.style.top = `${place.top}px`;
    button.setAttribute('aria-expanded', 'true');
    state.dropdown = { button, onChange, entries };
    // The keyboard drives the menu: focus lands on the current option.
    const focusTarget = entries.find((entry) => entry.getAttribute('aria-selected') === 'true') ?? entries[0];
    // The canvas is a transformed layer, so the browser would scroll the
    // layout box of the focused control into view — which is a place the
    // canvas is not. The focus moves without the view moving with it.
    focusTarget?.focus({ preventScroll: true });

    menu.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeDropdown({ restoreFocus: true });
        return;
      }
      const index = entries.indexOf(document.activeElement);
      if (event.key === 'Tab') {
        // Tab stays inside the menu instead of leaving it behind.
        event.preventDefault();
        const next = event.shiftKey ? index - 1 : index + 1;
        entries[(next + entries.length) % entries.length]?.focus({ preventScroll: true });
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        entries[(next + entries.length) % entries.length]?.focus({ preventScroll: true });
      }
    };
  }

  function closeDropdown(options = {}) {
    const menu = dom.dropdownMenu;
    const open = state.dropdown;
    if (menu) {
      menu.hidden = true;
      menu.removeAttribute('role');
      menu.removeAttribute('aria-label');
      menu.onkeydown = null;
    }
    if (open?.button) {
      open.button.setAttribute('aria-expanded', 'false');
      // Without the scroll guard the browser would scroll the canvas to the
      // layout box of the control, and the view would jump to another place.
      if (options.restoreFocus) open.button.focus({ preventScroll: true });
    }
    state.dropdown = null;
  }

  function paramSelect(label, value, options, onChange) {
    const field = el('span', 'nxc-field');
    if (label) field.appendChild(el('span', 'nxc-field__label', label));
    field.appendChild(createDropdown({
      options,
      value,
      onChange: (next) => {
        onChange(next);
        markDirty();
      },
    }));
    return field;
  }

  function modelSelect(node) {
    const field = el('span', 'nxc-field nxc-field--grow');
    field.appendChild(el('span', 'nxc-field__label', '模型'));
    const options = modeModelOptions(node).length ? modeModelOptions(node) : agentModelOptions();
    if (options.length === 0) {
      options.push({ value: '', label: state.agentAvailable ? '暂无可用模型' : 'Agent 不可用' });
    }
    field.appendChild(createDropdown({
      options,
      value: node.metadata.model,
      onChange: (next) => {
        // The options follow the model, and the rule lives in the shared action
        // layer: the Agent and the runtime do the same thing.
        const result = applyModel(state.canvas, node, next, actionContext());
        const at = state.canvas.nodes.findIndex((item) => item.id === node.id);
        if (at >= 0) state.canvas.nodes[at] = result.node;
        if (result.dropped.length) {
          state.canvas.connections = state.canvas.connections.filter((conn) => !result.dropped.includes(conn));
        }
        if (result.mode.from !== result.mode.to) {
          const label = modeModelOptions(node).find((item) => item.value === next)?.label ?? next;
          showBanner(
            `「${label}」跑不了「${modeLabelOf(node, result.mode.from)}」，已切到「${modeLabelOf(node, result.mode.to)}」${
              result.dropped.length ? `，去掉了 ${result.dropped.length} 条连线` : ''
            }。`,
            'error',
          );
        }
        markDirty();
        // The parameter row follows the model: H3-Max does not offer 2K.
        render();
      },
    }));
    return field;
  }

  /**
   * The template that fills an input node's text.
   *
   * The template and its fields are a shortcut for writing the text by hand:
   * what they compose is the node's text, and it goes downstream as such.
   */
  function renderTemplatePicker(node) {
    const box = el('div', 'nxc-style');
    const templates = state.palette?.templates ?? [];

    const field = el('div', 'nxc-field');
    field.appendChild(el('span', 'nxc-field__label', '品类模板'));
    field.appendChild(createDropdown({
      options: templates.map((template) => ({ value: template.id, label: template.label })),
      value: node.metadata.templateId ?? 'custom',
      onChange: (next) => {
        node.metadata.templateId = next;
        node.metadata.templateVars = {};
        markDirty();
        render();
      },
    }));
    box.appendChild(field);

    const template = templates.find((t) => t.id === (node.metadata.templateId ?? 'custom'));
    if (template && template.id !== 'custom') {
      box.appendChild(el('div', 'nxc-note', template.desc ?? ''));
      for (const item of template.fields ?? []) {
        const row = el('div', 'nxc-field');
        row.appendChild(el('span', 'nxc-field__label', item.label));
        const input = el('input', 'nxc-input');
        input.value = node.metadata.templateVars?.[item.key] ?? item.default ?? '';
        input.addEventListener('input', () => {
          node.metadata.templateVars = { ...(node.metadata.templateVars ?? {}), [item.key]: input.value };
          markDirty();
          render();
        });
        row.appendChild(input);
        box.appendChild(row);
      }
      const preview = renderTemplateText(template, node.metadata.templateVars ?? {});
      const previewBox = el('div', 'nxc-style__preview');
      previewBox.appendChild(el('span', null, '预览'));
      previewBox.appendChild(el('b', null, preview || '（未填写）'));
      box.appendChild(previewBox);

      const apply = el('button', 'nxc-btn nxc-btn--tiny', '应用到文本');
      apply.type = 'button';
      apply.addEventListener('click', (event) => {
        event.stopPropagation();
        // The composed text is the node's text: it goes downstream the way any
        // text of an input node does.
        node.metadata.segments = preview ? [{ type: 'text', text: preview }] : [];
        node.metadata.prompt = preview;
        markDirty();
        render();
      });
      box.appendChild(apply);
    }
    return box;
  }

  function renderTemplateText(template, values) {
    if (!template || template.id === 'custom') return '';
    return (template.fields ?? [])
      .map((field) => (values?.[field.key] != null ? String(values[field.key]) : field.default ?? ''))
      .map((value) => value.trim())
      .filter(Boolean)
      .join('，');
  }

  /**
   * The menu of a node.
   *
   * The same list wherever the node is clicked, so the board and the panel
   * do not drift apart.
   */
  function nodeMenuItems(node) {
    const items = [{ label: '复制节点', action: () => copyNode(node) }];
    // A node that holds material can hand the file over.
    const item = node?.metadata?.output?.media?.[0];
    if (item?.url) {
      items.push({ label: '保存到本地', action: () => saveMedia(node, item) });
    }
    items.push({ label: '删除节点', danger: true, action: () => { removeNode(node.id); markDirty(); render(); } });
    items.push('-');
    return [...items, ...kindMenuItems()];
  }

  // Toolbar entry point: the tools of whatever node is selected.
  function openNodeMenu(node, x, y) {
    showMenu(dom.contextMenu, x, y, nodeMenuItems(node));
  }

  function openToolMenu(anchorRect) {
    const node = getNode(state.selection[0]);
    const panel = dom.floatingPanel;
    panel.textContent = '';
    panel.dataset.canvasNoZoom = 'true';

    if (!node) {
      panel.appendChild(el('div', 'nxc-panel__title', '工具'));
      panel.appendChild(el('div', 'nxc-panel__desc', '先选中一个节点，再点这里使用它的工具。'));
      panel.hidden = false;
      const rect = panel.getBoundingClientRect();
      const place = placeOverlay(
        { left: anchorRect.left, top: anchorRect.bottom + 6 },
        rect,
        { width: window.innerWidth, height: window.innerHeight },
      );
      panel.style.left = `${place.left}px`;
      panel.style.top = `${place.top}px`;
      return;
    }

    const tools = toolsForNode(node);
    panel.appendChild(el('div', 'nxc-panel__title', `工具 · ${node.title}`));
    const list = el('div', 'nxc-panel__list');
    if (tools.length === 0) {
      list.appendChild(el('div', 'nxc-mention-menu__empty', '这个节点类型没有工具。'));
    }
    const hasAsset = Boolean(node.metadata.output?.media?.length);
    for (const tool of tools) {
      const pending = tool.status !== 'ready';
      const needsSource = tool.needs && !hasAsset;
      const blocked = toolBlockedReason(tool, node);
      const button = el('button', 'nxc-panel__option');
      button.type = 'button';
      button.disabled = pending || needsSource || Boolean(blocked);
      button.appendChild(el('span', null, pending ? `${tool.label}（待接入）` : tool.label));
      button.appendChild(el('small', null, blocked ?? (pending ? '' : needsSource ? '需要素材' : tool.desc ?? '')));
      button.addEventListener('click', () => {
        if (pending || needsSource || blocked) return;
        openToolPanel(node, tool, button.getBoundingClientRect());
      });
      list.appendChild(button);
    }
    panel.appendChild(list);
    panel.hidden = false;
    const rect = panel.getBoundingClientRect();
    const place = placeOverlay(
      { left: anchorRect.left, top: anchorRect.bottom + 6 },
      rect,
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.style.left = `${place.left}px`;
    panel.style.top = `${place.top}px`;
  }

  // ---------------------------------------------------------------- tool bar

  // The tools a card offers: a result card offers the tools of what it
  // holds, a generating card offers none (it has nothing to transform yet),
  // and a card holding a video offers none either — the finished clip is a
  // deliverable, not a working material.
  //
  // The tools and the footer come from one rule, so the buttons under a card
  // and the strip that holds them can never disagree.
  function cardChromeFor(node) {
    return cardChrome(node, state.palette?.tools ?? []);
  }

  function toolsForNode(node) {
    return cardChromeFor(node).tools;
  }

  // Why a tool cannot run right now, or null when it can. The local media
  // tools need ffmpeg on the machine, so the page says what is missing
  // instead of failing on the first click.
  function toolBlockedReason(tool, node = null) {
    // A card whose material is gone cannot be worked on: every tool would
    // fail on a file that is not there. The page says so before the click.
    if (node?.metadata?.output?.missing) {
      return '这张素材已经不在了，重新生成上游那一步，或者从资产库把它插回来';
    }
    if (tool.status !== 'ready') return tool.pendingReason ?? '尚未接入';
    if (tool.run === 'ffmpeg' && !state.media?.available) {
      return '本机没有找到 ffmpeg，装好 ffmpeg 后重新发布这个 MiniApp 就能用';
    }
    if (tool.run === 'understand' && state.media && !state.media.canUpload) {
      return '当前客户端没有提供素材上传能力，provider 读不到这段素材';
    }
    return null;
  }

  function renderToolBar(node) {
    const chrome = cardChromeFor(node);
    // No tools, no toolbar — and no footer either, so an empty strip is not
    // left under the material.
    if (!chrome.hasFooter) return null;
    const bar = el('div', 'nxc-tools');
    bar.dataset.canvasNoZoom = 'true';
    const hasAsset = Boolean(node.metadata.output?.media?.length);
    for (const tool of chrome.tools) {
      const pending = tool.status !== 'ready';
      const needsSource = tool.needs && !hasAsset;
      const blocked = toolBlockedReason(tool, node);
      const button = el('button', `nxc-tools__btn${pending ? ' is-pending' : ''}`, pending ? `${tool.label}（待接入）` : tool.label);
      button.type = 'button';
      // Say what is missing instead of a bare "not wired yet". A missing
      // capability is the more fundamental blocker, so it wins over "no
      // material yet".
      button.title = blocked ?? (needsSource ? '这个节点还没有素材，先生成一张再用工具' : tool.desc);
      button.disabled = pending || needsSource || Boolean(blocked);
      const open = (event) => {
        event.stopPropagation();
        if (pending || needsSource || blocked) return;
        openToolPanel(node, tool, button.getBoundingClientRect());
      };
      button.addEventListener('pointerdown', open);
      button.addEventListener('click', open);
      bar.appendChild(button);
    }
    return bar;
  }

  function openToolPanel(node, tool, anchorRect) {
    state.tool = { nodeId: node.id, tool, params: toolDefaults(tool) };
    const panel = dom.floatingPanel;
    panel.textContent = '';
    panel.dataset.canvasNoZoom = 'true';

    panel.appendChild(el('div', 'nxc-panel__title', tool.label));
    panel.appendChild(el('div', 'nxc-panel__desc', tool.desc ?? ''));

    // A tool that asks for several values runs once per value, and every run
    // costs the user a generation. Say so before they press the button.
    const multi = (tool.params ?? []).find((param) => param.type === 'multi');
    if (multi) {
      panel.appendChild(el('div', 'nxc-panel__desc', `每选一个「${multi.label}」跑一次生成，每个值一张图。`));
    }

    const body = el('div', 'nxc-toolpanel__body');
    for (const param of tool.params ?? []) {
      body.appendChild(toolField(node, param, state.tool.params));
    }
    if ((tool.params ?? []).length === 0) {
      body.appendChild(el('div', 'nxc-panel__desc', '这个工具不需要参数。'));
    }
    panel.appendChild(body);

    const actions = el('div', 'nxc-toolpanel__acts');
    const apply = el('button', 'nxc-btn nxc-btn--primary', '应用');
    apply.type = 'button';
    apply.addEventListener('click', (event) => {
      event.stopPropagation();
      void applyTool(node, tool, state.tool.params);
    });
    const cancel = el('button', 'nxc-btn', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', (event) => {
      event.stopPropagation();
      state.tool = null;
      closePanel();
    });
    actions.appendChild(apply);
    actions.appendChild(cancel);
    panel.appendChild(actions);

    panel.hidden = false;
    const rect = panel.getBoundingClientRect();
    const place = placeOverlay(
      { left: anchorRect.left, top: anchorRect.bottom + 6 },
      rect,
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.style.left = `${place.left}px`;
    panel.style.top = `${place.top}px`;
  }

  function toolDefaults(tool) {
    const params = {};
    for (const param of tool.params ?? []) {
      params[param.key] = Array.isArray(param.default) ? [...param.default] : param.default;
    }
    return params;
  }

  function toolField(node, param, values) {
    const field = el('div', 'nxc-field');
    field.appendChild(el('span', 'nxc-field__label', param.label));

    if (param.type === 'multi') {
      const box = el('div', 'nxc-multiselect');
      for (const option of param.options ?? []) {
        const label = el('label', 'nxc-opt');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = (values[param.key] ?? []).includes(option);
        input.addEventListener('change', () => {
          const current = new Set(values[param.key] ?? []);
          if (input.checked) current.add(option);
          else current.delete(option);
          values[param.key] = [...current];
        });
        label.appendChild(input);
        label.appendChild(el('span', null, option));
        box.appendChild(label);
      }
      field.appendChild(box);
      return field;
    }

    if (param.type === 'select') {
      field.appendChild(createDropdown({
        options: param.options ?? [],
        value: values[param.key],
        onChange: (next) => {
          values[param.key] = next;
        },
      }));
      return field;
    }

    const input = el('input', 'nxc-input');
    input.type = 'number';
    if (param.min !== undefined) input.min = String(param.min);
    if (param.max !== undefined) input.max = String(param.max);
    input.value = String(values[param.key] ?? param.default ?? 0);
    input.addEventListener('input', () => {
      values[param.key] = Number(input.value);
    });
    field.appendChild(input);
    return field;
  }

  async function applyTool(node, tool, params) {
    state.tool = null;
    closePanel();
    try {
      if (tool.run === 'local') {
        if (tool.key === 'gridSplit') await runGridSplit(node, params);
        else if (tool.key === 'crop') await runCrop(node, params);
        else throw new Error('这个工具还没有实现');
      } else if (tool.run === 'agent') {
        await runAgentTool(node, tool, params);
      } else if (tool.run === 'ffmpeg') {
        await runFfmpegTool(node, tool, params);
      } else if (tool.run === 'understand') {
        await runUnderstandTool(node, tool, params);
      } else {
        throw new Error('这个工具尚未接入');
      }
    } catch (error) {
      showBanner(`工具失败：${error?.message ?? error}`, 'error');
    }
  }

  // Load a source image for a local transform. Cross-origin assets may refuse
  // to be read back from a canvas; that is reported instead of silently
  // producing a blank result.
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('素材无法读取（可能不允许跨域读取）'));
      image.src = url;
    });
  }

  /**
   * Hand a picture the page drew to the runtime, so it becomes a real file.
   *
   * A data URL would live inside the canvas and nowhere else: it could not be
   * saved to the user's machine, it would not show up in the library and it
   * would bloat every save of the canvas. The runtime publishes it into its
   * own asset folder, the same place the tools that run on this machine put
   * their results.
   */
  async function publishCanvas(canvas, name) {
    // PNG, so a cut-out keeps its transparent background instead of turning
    // black on the way out.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('这张图没能生成文件');
    const fileName = /\.png$/i.test(name) ? name : `${name}.png`;
    const response = await fetch(`/api/media/publish?name=${encodeURIComponent(fileName)}`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: blob,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
    return { url: payload.url, kind: payload.kind ?? 'image', name: payload.name, bytes: payload.bytes };
  }

  /**
   * The node a tool leaves behind.
   *
   * It is a result node: only a result node carries the tool bar, so the
   * picture a tool produced can be worked on again. Every tool writes its
   * result this way — the ones that run on this machine and the ones that
   * draw in the browser — so the chain never stops after one step.
   */
  function createToolResult(source, { kind = 'image', media, text = '', title, x, y }) {
    const child = createNode('result', { x, y }, {
      kind,
      title,
      output: {
        status: 'success',
        text,
        media: media ? [media] : [],
        error: '',
        posterUrl: '',
        durationMs: 0,
        width: media?.width ?? 0,
        height: media?.height ?? 0,
        missing: false,
        updatedAt: new Date().toISOString(),
      },
    });
    child.metadata.sourceNodeId = source?.id ?? '';
    return child;
  }

  /**
   * A group of cards, placed by their real size.
   *
   * The cards are placed once with the size that was asked for, and placed
   * again when a card of the group is measured. The rule lives in
   * `tools.mjs`, so the page and the tests read the same one.
   */
  function registerLayoutGroup(ids, columns, originX, originY) {
    const groupId = `lg${++layoutSeq}`;
    layoutGroups.set(groupId, { ids, columns, originX, originY });
    for (const id of ids) layoutGroupOf.set(id, groupId);
    return groupId;
  }

  /** Place a group of cards again, now that their real size is known. */
  function relayoutGroup(groupId) {
    const group = layoutGroups.get(groupId);
    if (!group) return;
    const nodes = group.ids.map((id) => getNode(id)).filter(Boolean);
    if (!nodes.length) return;
    const plan = planBatchPlacement({
      sizes: nodes.map((node) => ({ width: node.width, height: node.height })),
      originX: group.originX,
      originY: group.originY,
      gap: NODE_GAP,
      perRow: group.columns,
    });
    nodes.forEach((node, index) => {
      const cell = plan.cells[index];
      if (!cell) return;
      if (node.position.x === cell.x && node.position.y === cell.y) return;
      node.position.x = cell.x;
      node.position.y = cell.y;
      const element = dom.nodes.querySelector(`[data-node-id="${node.id}"]`);
      if (element) {
        element.style.left = `${cell.x}px`;
        element.style.top = `${cell.y}px`;
      }
    });
    // The cards that are in the way step aside, so a group that grew does not
    // cover what is already on the board.
    keepCardsApart(group.ids);
    renderConnections();
    markDirty();
  }

  /**
   * The cards never cover each other.
   *
   * A card that lands on another one pushes it aside. The rule lives in
   * `tools.mjs`, so the page and the tests read the same one.
   */
  function keepCardsApart(placedIds) {
    const doc = pushAside(state.canvas, placedIds);
    state.canvas.nodes = doc.nodes;
  }

  async function runGridSplit(node, params) {
    const media = node.metadata.output?.media?.[0];
    if (!media?.url) throw new Error('这个节点还没有素材');
    const image = await loadImage(media.url);
    const plan = planGridSplit({
      width: image.naturalWidth,
      height: image.naturalHeight,
      rows: params.rows,
      cols: params.cols,
      originX: node.position.x + node.width + 60,
      originY: node.position.y + 40,
    });

    showBanner(`正在切分 ${plan.rows}×${plan.cols}…`);
    const created = [];
    for (const cell of plan.cells) {
      const canvas = document.createElement('canvas');
      canvas.width = cell.sw;
      canvas.height = cell.sh;
      canvas.getContext('2d').drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, 0, 0, cell.sw, cell.sh);
      // The piece is published by the runtime, so it is a real file: it can be
      // saved, listed in the library and worked on again.
      const published = await publishCanvas(canvas, `切分 ${cell.index + 1}`);
      const child = createToolResult(node, {
        kind: 'image',
        media: { url: published.url, kind: 'image', name: published.name, bytes: published.bytes },
        title: `${node.title} · 切分 ${cell.index + 1}`,
        x: cell.x,
        y: cell.y,
      });
      child.metadata.output.width = cell.sw;
      child.metadata.output.height = cell.sh;
      // A tile shows one piece of the picture, so it is a small card: a grid of
      // nine full-size media cards would be enormous, and they would sit on
      // top of each other.
      child.width = TILE_CARD.width;
      child.height = TILE_CARD.height;
      connect(node.id, child.id, 'image', { quiet: true });
      created.push(child);
    }
    // The tiles are placed by their real size, which is measured once they are
    // on the board: the height of a card follows the media and the tool bar.
    registerLayoutGroup(
      created.map((child) => child.id),
      plan.cols,
      plan.cells[0].x,
      plan.cells[0].y,
    );
    keepCardsApart(created.map((child) => child.id));
    state.selection = created.map((child) => child.id);
    markDirty();
    render();
    showBanner(`已切成 ${plan.rows}×${plan.cols} 共 ${plan.count} 块`);
  }

  async function runCrop(node) {
    const media = node.metadata.output?.media?.[0];
    if (!media?.url) throw new Error('这个节点还没有素材');
    state.crop = { nodeId: node.id, rect: { x: 0, y: 0, w: 1, h: 1 } };
    render();
    showBanner('在图上拖出要保留的区域，然后点「完成剪裁」');
  }

  async function applyCrop(node) {
    const crop = state.crop;
    if (!crop || crop.nodeId !== node.id) return;
    const media = node.metadata.output?.media?.[0];
    const rect = crop.rect;
    state.crop = null;
    try {
      const image = await loadImage(media.url);
      const sx = Math.round(rect.x * image.naturalWidth);
      const sy = Math.round(rect.y * image.naturalHeight);
      const sw = Math.max(1, Math.round(rect.w * image.naturalWidth));
      const sh = Math.max(1, Math.round(rect.h * image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext('2d').drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      // The crop leaves a picture of its own behind; the original stays where
      // it was, so nothing the user had is thrown away.
      const published = await publishCanvas(canvas, `${node.title} 剪裁`);
      const child = createToolResult(node, {
        kind: 'image',
        media: { url: published.url, kind: 'image', name: published.name, bytes: published.bytes },
        title: `${node.title} · 剪裁`,
        x: node.position.x + node.width + 80,
        y: node.position.y + 40,
      });
      child.metadata.output.width = sw;
      child.metadata.output.height = sh;
      connect(node.id, child.id, 'image', { quiet: true });
      state.selection = [child.id];
      markDirty();
      render();
      showBanner('已剪裁');
    } catch (error) {
      render();
      throw error;
    }
  }

  // The media a tool reads: the node's own output first, then the output of
  // the nodes connected to it. A multi-source tool (拼图 / 合并视频) uses the
  // whole list.
  function mediaSourcesFor(node) {
    const own = node.metadata.output?.media ?? [];
    const upstream = upstreamOf(node.id)
      .filter((source) => source.type !== 'group')
      .flatMap((source) => source.metadata.output?.media ?? []);
    const seen = new Set();
    return [...own, ...upstream].filter((item) => {
      if (!item?.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }

  // A local media tool. The Node service downloads the source, runs ffmpeg on
  // the machine and publishes the result; the page only turns the result
  // into a node.
  async function runFfmpegTool(node, tool, params) {
    const sources = mediaSourcesFor(node);
    if (!sources.length) throw new Error('这个节点还没有素材');
    showBanner(`正在执行 ${tool.label}…`);
    const payload = await api('/api/tools/run', {
      method: 'POST',
      body: { tool: tool.key, sources, params },
    });
    const artifacts = payload.artifacts ?? [];
    if (!artifacts.length) throw new Error('工具没有产出文件');

    const created = [];
    const places = planBatchPlacement({
      count: artifacts.length,
      originX: node.position.x + node.width + 80,
      originY: node.position.y + 40,
      cardWidth: node.width || 320,
      cardHeight: node.height || 420,
    });
    artifacts.forEach((artifact, index) => {
      const place = places.cells[index];
      const child = createToolResult(node, {
        kind: artifact.kind || 'image',
        media: { url: artifact.url, kind: artifact.kind || 'image' },
        title: `${node.title} · ${tool.label}`,
        x: place.x,
        y: place.y,
      });
      // The child takes what the line carries, so it moves to the mode that
      // takes it — the same rule every other line obeys. The board is redrawn
      // once at the end, not once per piece.
      connect(node.id, child.id, kindOf(node), { quiet: true });
      created.push(child);
    });
    // The cards are placed by their real size, which is measured once they
    // are on the board.
    registerLayoutGroup(created.map((child) => child.id), places.columns, places.cells[0].x, places.cells[0].y);
    keepCardsApart(created.map((child) => child.id));
    state.selection = created.map((child) => child.id);
    markDirty();
    render();
    showBanner(`${tool.label} 完成，产出 ${created.length} 个节点`);
  }

  // A tool that asks the provider about the media. The Node service downloads
  // the media and uploads it first, because the provider only reads assets it
  // holds itself.
  async function runUnderstandTool(node, tool, params) {
    const media = node.metadata.output?.media?.[0];
    if (!media?.url) throw new Error('这个节点还没有素材');
    showBanner(`正在执行 ${tool.label}…`);
    const payload = await api('/api/tools/understand', {
      method: 'POST',
      body: { kind: 'video', url: media.url, prompt: toolPrompt(tool, params) },
    });
    const text = String(payload.text ?? '').trim();
    if (!text) throw new Error('没有拿到分析结果');

    const child = createToolResult(node, {
      kind: 'text',
      text,
      title: `${node.title} · ${tool.label}`,
      x: node.position.x + node.width + 80,
      y: node.position.y + 40,
    });
    connect(node.id, child.id, 'text');
    state.selection = [child.id];
    markDirty();
    render();
    showBanner(`${tool.label} 完成`);
  }

  // Model-backed tools: a child node is created with the tool template as its
  // prompt and the source node as its reference, then the Agent runs on it.
  async function runAgentTool(node, tool, params) {
    // A tool that asks for several values runs once per value: one run cannot
    // answer two angles with one picture.
    const steps = fanOutParams(tool, params);
    if (!steps.length) {
      throw new Error(`「${tool.label}」至少要选一个${tool.params?.find((param) => param.type === 'multi')?.label ?? '值'}`);
    }
    const created = [];
    const places = planBatchPlacement({
      count: steps.length,
      originX: node.position.x + node.width + 80,
      originY: node.position.y + 40,
      cardWidth: node.width || 320,
      cardHeight: node.height || 420,
    });
    for (const [index, step] of steps.entries()) {
      const prompt = toolPrompt(tool, step.params);
      // The child generates the same kind of data the source holds. It cannot
      // be a result node: the runtime refuses to generate from one, and the
      // tools only ever sit on a result node, so that would never run.
      const child = createNode(kindOf(node), {
        x: places.cells[index].x,
        y: places.cells[index].y,
      });
      child.title = `${node.title} · ${tool.label}${step.label ? ` · ${step.label}` : ''}`;
      child.metadata.segments = [{ type: 'text', text: prompt }];
      child.metadata.prompt = prompt;
      child.metadata.model = node.metadata.model;
      child.metadata.ratio = node.metadata.ratio;
      child.metadata.resolution = node.metadata.resolution;
      child.metadata.duration = node.metadata.duration;
      connect(node.id, child.id, kindOf(node));
      created.push(child);
    }
    // The branches are placed by their real size, which is measured once they
    // are on the board, and they never cover the card they came from.
    registerLayoutGroup(created.map((child) => child.id), places.columns, places.cells[0].x, places.cells[0].y);
    keepCardsApart(created.map((child) => child.id));
    state.selection = created.map((child) => child.id);
    markDirty();
    render();
    showBanner(`${tool.label} 开始跑 ${created.length} 次生成…`);
    for (const child of created) {
      await startRun(child);
    }
  }

  function renderCropOverlay(node, host) {
    const crop = state.crop;
    const overlay = el('div', 'nxc-crop');
    overlay.dataset.canvasNoZoom = 'true';

    const box = el('div', 'nxc-crop__box');
    box.style.left = `${crop.rect.x * 100}%`;
    box.style.top = `${crop.rect.y * 100}%`;
    box.style.width = `${crop.rect.w * 100}%`;
    box.style.height = `${crop.rect.h * 100}%`;

    const handle = el('span', 'nxc-crop__handle');
    box.appendChild(handle);

    const startDrag = (event, mode) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = host.getBoundingClientRect();
      const origin = { ...crop.rect };
      const startX = event.clientX;
      const startY = event.clientY;
      const move = (moveEvent) => {
        const dx = (moveEvent.clientX - startX) / rect.width;
        const dy = (moveEvent.clientY - startY) / rect.height;
        // The pointer decides where the box goes; the rule only keeps it
        // inside the picture. The rule lives in `tools.mjs`, so the page and
        // the tests read the same one.
        const next = cropRectAfterDrag(origin, dx, dy, mode);
        crop.rect.x = next.x;
        crop.rect.y = next.y;
        crop.rect.w = next.w;
        crop.rect.h = next.h;
        box.style.left = `${crop.rect.x * 100}%`;
        box.style.top = `${crop.rect.y * 100}%`;
        box.style.width = `${crop.rect.w * 100}%`;
        box.style.height = `${crop.rect.h * 100}%`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };

    box.addEventListener('pointerdown', (event) => startDrag(event, 'move'));
    handle.addEventListener('pointerdown', (event) => startDrag(event, 'resize'));
    overlay.appendChild(box);

    const done = el('button', 'nxc-btn nxc-btn--tiny nxc-btn--primary', '完成剪裁');
    done.type = 'button';
    done.addEventListener('click', (event) => {
      event.stopPropagation();
      void applyCrop(node);
    });
    overlay.appendChild(done);

    const cancel = el('button', 'nxc-btn nxc-btn--tiny', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', (event) => {
      event.stopPropagation();
      state.crop = null;
      render();
    });
    overlay.appendChild(cancel);
    return overlay;
  }

  // ---------------------------------------------------------------- connections

  /**
   * The curve of a connection.
   *
   * The line starts and ends on the ports themselves, so a node with several
   * input ports has one line per port instead of all of them coming out of
   * the middle of the card.
   */
  function bezier(from, to, kind = '', port = null) {
    const start = portPointOf(from, 'out', kind);
    const end = portPointOf(to, 'in', port?.kind ?? kind, port?.role ?? '');
    const x1 = start.x;
    const y1 = start.y;
    const x2 = end.x;
    const y2 = end.y;
    const dx = Math.min(180, Math.max(40, Math.abs(x2 - x1) * 0.5));
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  function renderConnections() {
    dom.connections.textContent = '';
    const ns = 'http://www.w3.org/2000/svg';
    for (const conn of state.canvas.connections) {
      const from = getNode(conn.fromNodeId);
      const to = getNode(conn.toNodeId);
      if (!from || !to) continue;
      // What flows through the line is read live from the source, so the
      // line, the port it starts on and the port it ends on always agree.
      // A canvas from before the line knew its kind still lands on the right
      // port and wears the right colour.
      const kind = kindOf(from) || conn.kind || '';
      // The port the line fills. The card and the line have to agree on it,
      // so the line ends on the port it was assigned to.
      const port = portOfConnection(state.canvas, to, conn);
      const d = bezier(from, to, kind, port);
      const active = state.selection.includes(conn.fromNodeId) || state.selection.includes(conn.toNodeId);

      const hit = document.createElementNS(ns, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'nxc-connection--hit');
      hit.dataset.connectionId = conn.id;

      const line = document.createElementNS(ns, 'path');
      line.setAttribute('d', d);
      line.setAttribute('class', `nxc-connection${active ? ' nxc-connection--active' : ''}`);
      line.dataset.connectionId = conn.id;
      // The line carries the hue of what flows through it, the same kind its
      // two ports are coloured by.
      line.dataset.kind = kind;
      // While something is selected, the lines that are not part of it step back.
      if (!isRelatedToSelection(conn.fromNodeId) || !isRelatedToSelection(conn.toNodeId)) {
        line.classList.add('is-dim');
      }

      dom.connections.appendChild(hit);
      dom.connections.appendChild(line);
    }
  }

  // ---------------------------------------------------------------- rendering

  function render() {
    renderNodes();
    renderConnections();
    renderToolbar();
    renderTaskPanel();
    applyViewport();
    dom.emptyHint.hidden = state.canvas.nodes.length > 0;
  }

  function renderNodes() {
    dom.nodes.textContent = '';
    state.editors.clear();
    for (const node of state.canvas.nodes) {
      try {
        dom.nodes.appendChild(renderNode(node));
      } catch (error) {
        // One broken node must not blank the whole canvas.
        const broken = el('div', 'nxc-node nxc-node--error');
        broken.style.left = `${node.position.x}px`;
        broken.style.top = `${node.position.y}px`;
        broken.style.width = `${node.width}px`;
        broken.style.height = `${node.height}px`;
        broken.appendChild(el('div', 'nxc-node__error', `这个节点渲染失败：${error?.message ?? error}`));
        dom.nodes.appendChild(broken);
      }
    }
  }

  function renderToolbar() {
    renderCanvasSelect();
    dom.renameButton.disabled = !state.canvas.id;
    dom.deleteButton.disabled = !state.canvas.id;
    dom.gridButton.textContent = state.canvas.backgroundMode === 'dots' ? '网格：圆点' : '网格：线条';
    dom.themeButton.textContent = `主题：${THEME_LABEL[state.theme] ?? THEME_LABEL.system}`;
    updateHistoryBtns();
  }

  function isEditing() {
    const active = document.activeElement;
    if (!active) return false;
    return active.isContentEditable === true || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA';
  }

  function scheduleRender() {
    if (isEditing()) {
      state.pendingRender = true;
      return;
    }
    render();
  }

  function flushRender() {
    if (!state.pendingRender) return;
    state.pendingRender = false;
    window.setTimeout(() => {
      if (!isEditing()) render();
      else state.pendingRender = true;
    }, 0);
  }

  // ---------------------------------------------------------------- task panel

  function isRunning(nodeId) {
    const task = state.tasks.get(state.nodeTasks.get(nodeId));
    return Boolean(task && (task.status === 'running' || task.status === 'waiting-question'));
  }

  // The Host chat side panel, when this Mini App runs in a chat. It is not
  // there in every host, so every use is feature-detected.
  function pageAgent() {
    return window.mcode?.miniapp?.agent ?? null;
  }

  /**
   * Open a run's conversation in the Host chat.
   *
   * The session belongs to this Mini App, so the Host can show it in the
   * side panel of the chat the app is open in, where the user can read the
   * turn and answer the Host itself.
   */
  async function openInChat(sessionId) {
    const agent = pageAgent();
    if (!agent?.open || !sessionId) {
      showBanner('当前环境没有开放对话面板', 'error');
      return;
    }
    try {
      await agent.open(sessionId);
    } catch (error) {
      const code = String(error?.message ?? error);
      const reason =
        code === 'session_not_found' ? '会话不存在或不属于本应用'
        : code === 'not_permitted' ? '当前应用没有打开对话的权限'
        : code;
      showBanner(`打开对话失败：${reason}`, 'error');
    }
  }

  /** Stop one run. The other runs keep going. */
  async function cancelRun(task) {
    try {
      const payload = await api(`/api/runs/${task.id}/cancel`, { method: 'POST' });
      if (payload?.run) {
        state.tasks.set(task.id, payload.run);
        const node = getNode(task.nodeId);
        if (node) applyRunResult(node, payload.run);
        // The run is over, so the node is free to run again.
        if (state.nodeTasks.get(task.nodeId) === task.id) state.nodeTasks.delete(task.nodeId);
        markDirty();
        scheduleRender();
      }
    } catch (error) {
      showBanner(`取消失败：${error?.message ?? error}`, 'error');
    }
  }

  function renderTaskPanel() {
    const panel = dom.taskPanel;
    if (!panel) return;
    const now = Date.now();
    const tasks = [...state.tasks.values()].filter(
      (task) => task.status === 'running' || task.status === 'waiting-question' || task.status === 'error'
        // A run that just finished stays a moment. Its log says how long it
        // waited for the machine and how long it ran, and that is the answer
        // to "why was this one slower?".
        || (task.status === 'done' && now - (task.finishedAt ?? 0) < 30_000),
    );
    if (tasks.length === 0) {
      // The panel is hidden, but its old content is cleared as well: a hidden
      // panel that still holds buttons is a stale control in the page.
      panel.hidden = true;
      panel.textContent = '';
      return;
    }
    panel.hidden = false;
    panel.textContent = '';
    panel.appendChild(el('div', 'nxc-taskpanel__title', '运行进度'));
    for (const task of tasks) {
      const item = el('div', 'nxc-taskpanel__item');
      const head = el('div', 'nxc-taskpanel__head');
      head.appendChild(el('span', null, nodeTitle(task.nodeId)));
      head.appendChild(el('small', null, `${Math.round((task.elapsedMs ?? 0) / 1000)}s`));
      item.appendChild(head);
      // A direct connector run has no Agent turn behind it, so the provider
      // state is the only progress signal the page has.
      if (task.runner === 'connector' && (task.status === 'running' || task.status === 'waiting-question')) {
        const phase = task.providerStatus === 'submitted' ? '已提交，等待生成' : (task.providerStatus ?? '提交中');
        item.appendChild(el('div', 'nxc-taskpanel__line', `连接器：${phase}`));
      }
      for (const line of (task.log ?? []).slice(-4)) {
        item.appendChild(el('div', 'nxc-taskpanel__line', line));
      }
      // Every run can be stopped on its own, and every run that went through
      // an Agent turn can be continued in the Host chat.
      const actions = el('div', 'nxc-taskpanel__actions');
      if (task.status === 'running' || task.status === 'waiting-question') {
        const cancel = el('button', 'nxc-btn nxc-btn--tiny', '取消');
        cancel.type = 'button';
        cancel.addEventListener('click', (event) => {
          event.stopPropagation();
          void cancelRun(task);
        });
        actions.appendChild(cancel);
      }
      if (task.sessionId && pageAgent()?.open) {
        const open = el('button', 'nxc-btn nxc-btn--tiny', '在对话里打开');
        open.type = 'button';
        open.addEventListener('click', (event) => {
          event.stopPropagation();
          void openInChat(task.sessionId);
        });
        actions.appendChild(open);
      }
      if (actions.childElementCount > 0) item.appendChild(actions);
      // The Agent may need the user before it can continue.
      if (task.pendingPermission) item.appendChild(buildPermissionCard(task));
      if (task.pendingQuestion) item.appendChild(buildQuestionCard(task));
      panel.appendChild(item);
    }
  }

  function buildPermissionCard(task) {
    const card = el('div', 'nxc-taskcard');
    card.appendChild(el('div', 'nxc-taskcard__title', '需要你的批准'));
    card.appendChild(
      el('div', 'nxc-taskcard__body', `工具「${task.pendingPermission.toolName}」请求执行权限。${task.pendingPermission.reason ?? ''}`),
    );
    const actions = el('div', 'nxc-taskcard__actions');
    const allow = el('button', 'nxc-btn nxc-btn--tiny nxc-btn--primary', '允许一次');
    allow.type = 'button';
    allow.addEventListener('click', (event) => {
      event.stopPropagation();
      void replyPermission(task, 'allowOnce');
    });
    const deny = el('button', 'nxc-btn nxc-btn--tiny', '拒绝');
    deny.type = 'button';
    deny.addEventListener('click', (event) => {
      event.stopPropagation();
      void replyPermission(task, 'deny');
    });
    actions.appendChild(allow);
    actions.appendChild(deny);
    card.appendChild(actions);
    return card;
  }

  function buildQuestionCard(task) {
    const card = el('div', 'nxc-taskcard');
    card.appendChild(el('div', 'nxc-taskcard__title', 'Agent 需要你的确认'));
    const request = task.pendingQuestion.request;
    const steps = Array.isArray(request) ? request : Array.isArray(request?.steps) ? request.steps : [];

    if (steps.length === 0) {
      card.appendChild(el('div', 'nxc-taskcard__body', 'Agent 提出了一个问题。'));
      const open = el('button', 'nxc-btn nxc-btn--tiny', '在对话中回答');
      open.type = 'button';
      open.addEventListener('click', (event) => {
        event.stopPropagation();
        void openInChat(task.sessionId);
      });
      card.appendChild(open);
      return card;
    }

    const answers = [];
    steps.forEach((step, index) => {
      const stepId = step.id ?? step.stepId ?? `step_${index}`;
      card.appendChild(el('div', 'nxc-taskcard__body', `${index + 1}. ${step.title ?? step.question ?? step.label ?? '问题'}`));
      const options = Array.isArray(step.options) ? step.options : [];
      const multi = step.multiSelect === true || step.type === 'multi' || step.type === 'checkbox';
      options.forEach((option, optionIndex) => {
        const optionId = option?.id ?? option?.value ?? `opt_${optionIndex}`;
        const label = el('label', 'nxc-opt');
        const input = el('input');
        input.type = multi ? 'checkbox' : 'radio';
        input.name = `q_${stepId}_${index}`;
        input.addEventListener('change', () => {
          let answer = answers.find((item) => item.stepId === stepId);
          if (!answer) {
            answer = { stepId, selectedOptionIds: [], skipped: false };
            answers.push(answer);
          }
          if (multi) {
            if (input.checked) answer.selectedOptionIds.push(optionId);
            else answer.selectedOptionIds = answer.selectedOptionIds.filter((id) => id !== optionId);
          } else {
            answer.selectedOptionIds = [optionId];
            answer.skipped = false;
          }
        });
        label.appendChild(input);
        label.appendChild(el('span', null, option?.label ?? option?.text ?? String(option)));
        card.appendChild(label);
      });
    });

    const actions = el('div', 'nxc-taskcard__actions');
    const submit = el('button', 'nxc-btn nxc-btn--tiny nxc-btn--primary', '提交');
    submit.type = 'button';
    submit.addEventListener('click', (event) => {
      event.stopPropagation();
      void answerQuestion(task, answers);
    });
    const skip = el('button', 'nxc-btn nxc-btn--tiny', '跳过');
    skip.type = 'button';
    skip.addEventListener('click', (event) => {
      event.stopPropagation();
      void answerQuestion(
        task,
        steps.map((step, index) => ({
          stepId: step.id ?? step.stepId ?? `step_${index}`,
          selectedOptionIds: [],
          skipped: true,
        })),
      );
    });
    actions.appendChild(submit);
    actions.appendChild(skip);
    card.appendChild(actions);
    return card;
  }

  async function replyPermission(task, decision) {
    try {
      await api(`/api/runs/${task.id}/permission`, {
        method: 'POST',
        body: {
          requestId: task.pendingPermission.requestId,
          sessionId: task.pendingPermission.sessionId,
          decision,
        },
      });
    } catch (error) {
      showBanner(`操作失败：${error?.message ?? error}`, 'error');
    }
  }

  async function answerQuestion(task, answers) {
    try {
      await api(`/api/runs/${task.id}/answer`, {
        method: 'POST',
        body: {
          requestId: task.pendingQuestion.requestId,
          sessionId: task.pendingQuestion.sessionId,
          answers,
        },
      });
    } catch (error) {
      showBanner(`提交失败：${error?.message ?? error}`, 'error');
    }
  }

  function nodeTitle(nodeId) {
    return getNode(nodeId)?.title ?? '节点';
  }

  // ---------------------------------------------------------------- panels

  function closePanel() {
    state.panel = null;
    dom.floatingPanel.hidden = true;
  }

  function openPanel(type, anchorRect, node) {
    state.panel = { type, nodeId: node?.id ?? null };
    const panel = dom.floatingPanel;
    panel.textContent = '';
    panel.dataset.canvasNoZoom = 'true';

    try {
      if (type === 'model') {
        panel.appendChild(el('div', 'nxc-panel__title', '选择模型（MiniMax 优先）'));
        const list = el('div', 'nxc-panel__list');
        const options = modeModelOptions(node).length ? modeModelOptions(node) : agentModelOptions();
        if (options.length === 0) {
          list.appendChild(el('div', 'nxc-mention-menu__empty', state.agentAvailable ? '暂无可用模型' : 'Agent 不可用'));
        }
        for (const model of options) {
          const button = el('button', `nxc-panel__option${model.value === node.metadata.model ? ' is-active' : ''}`);
          button.type = 'button';
          button.appendChild(el('span', null, model.label));
          button.addEventListener('click', () => {
            node.metadata.model = model.value;
            markDirty();
            closePanel();
            render();
          });
          list.appendChild(button);
        }
        panel.appendChild(list);
      }

      if (type === 'caps') {
      panel.appendChild(el('div', 'nxc-panel__title', '能力清单'));
      for (const [mode, caps] of Object.entries(state.capabilities ?? {})) {
        // The name of a way to run is the kind it moves, not its own key: the
        // music path is a mode of the audio node.
        panel.appendChild(el('div', 'nxc-panel__section', RUN_MODE_LABEL[mode] ?? KIND_LABEL[mode] ?? mode));
        panel.appendChild(capsRow('比例', caps.ratios?.join(' / ') ?? '—'));
        panel.appendChild(capsRow('清晰度', caps.resolutions?.join(' / ') ?? '—'));
        panel.appendChild(capsRow('时长', caps.durations?.length ? caps.durations.join(' / ') : '—'));
        panel.appendChild(capsRow('参考上限', `${caps.maxImages ?? 0} 图 / ${caps.maxVideos ?? 0} 视频 / ${caps.maxAudios ?? 0} 音频`));
        if (caps.models) {
          for (const model of caps.models) {
            // A model that couples a resolution to specific durations says so
            // instead of showing a combination the connector would reject.
            panel.appendChild(capsRow(model.label, modelSummary(model)));
          }
        }
      }
      panel.appendChild(el('div', 'nxc-panel__section', '数据色（节点 / 端口 / 连线 / 插槽共用）'));
      // Every kind the app can carry is listed, so a colour on the board can
      // always be looked up.
      const kindLabels = state.palette?.inputKindLabels ?? {};
      for (const kind of DATA_KINDS) {
        const row = el('div', 'nxc-panel__row');
        const dot = el('i', 'nxc-kind-dot');
        dot.dataset.kind = kind;
        row.appendChild(dot);
        row.appendChild(el('span', null, kindLabels[kind] ?? kind));
        row.appendChild(el('small', null, kind));
        panel.appendChild(row);
      }

      panel.appendChild(el('div', 'nxc-panel__section', '连接器工具（宿主按安装授予）'));
      const connectorTools = state.palette?.connectorTools ?? [];
      for (const tool of connectorTools) {
        // The list is the provider's tools, so the panel says which one the
        // Host did not grant, and which one this app does not run through.
        const marks = [];
        if (!tool.granted) marks.push('未授予');
        if (tool.drives === false) marks.push('本 app 不用');
        panel.appendChild(capsRow(tool.label, `${tool.tool}${marks.length ? `（${marks.join('，')}）` : ''}`));
      }
      if (connectorTools.length > 0 && !connectorTools.some((tool) => tool.granted)) {
        panel.appendChild(el('div', 'nxc-panel__desc', '当前客户端没有授予任何连接器工具，生成类功能不可用。'));
      }

      // The node tools are a different list: they are what the user actually
      // clicks, and they run on this machine or through a turn.
      const nodeTools = state.palette?.tools ?? [];
      const byRun = nodeTools.reduce((acc, tool) => {
        acc[tool.run] = (acc[tool.run] ?? 0) + 1;
        return acc;
      }, {});
      panel.appendChild(el('div', 'nxc-panel__section', '节点工具（结果节点上的「工具」条）'));
      panel.appendChild(capsRow('数量', String(nodeTools.length)));
      panel.appendChild(capsRow('本机 ffmpeg', String(byRun.ffmpeg ?? 0)));
      panel.appendChild(capsRow('浏览器本地', String(byRun.local ?? 0)));
      panel.appendChild(capsRow('Agent 回合', String(byRun.agent ?? 0)));
      panel.appendChild(capsRow('provider 理解', String(byRun.understand ?? 0)));
      }
    } catch (error) {
      // A panel that cannot be drawn is still shown: otherwise the button
      // silently does nothing and the user cannot tell what went wrong.
      panel.textContent = '';
      panel.appendChild(el('div', 'nxc-panel__title', '这个面板没有画出来'));
      panel.appendChild(el('div', 'nxc-panel__desc', String(error?.message ?? error)));
    }

    panel.hidden = false;
    const rect = panel.getBoundingClientRect();
    const place = placeOverlay(
      { left: anchorRect.left, top: anchorRect.bottom + 6 },
      rect,
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.style.left = `${place.left}px`;
    panel.style.top = `${place.top}px`;
  }

  /**
   * The templates of a panel, under the headings they belong to.
   *
   * The headings are the groups the templates carry, in the order they come:
   * the ones that start from words, the ones that start from material, the
   * H3 shapes and the one that reads a clip back.
   */
  function templateGroups(templates) {
    const groups = [];
    const byLabel = new Map();
    for (const template of templates) {
      const label = template.group || '其它';
      if (!byLabel.has(label)) {
        const group = { label, templates: [] };
        byLabel.set(label, group);
        groups.push(group);
      }
      byLabel.get(label).templates.push(template);
    }
    return groups;
  }

  /**
   * Write a list of templates into a panel.
   *
   * The panel says what happens when a template is picked, and the picker
   * does exactly that: one list, one way of picking it.
   */
  function renderTemplateGroups(body, groups, onPick, onDelete) {
    for (const group of groups) {
      if (!group.templates.length) continue;
      body.appendChild(el('div', 'nxc-panel__section', group.label));
      for (const template of group.templates) {
        const item = el('button', 'nxc-panel__option');
        item.type = 'button';
        item.appendChild(el('span', null, template.title));
        item.appendChild(el('small', null, template.description || `${template.steps ?? 0} 步`));
        item.addEventListener('click', () => onPick(template));
        // A template of the user is one the user can take away again. The
        // ready-made ones are not: they belong to the package.
        if (!group.own || !onDelete) {
          body.appendChild(item);
          continue;
        }
        const row = el('div', 'nxc-panel__item');
        row.appendChild(item);
        const remove = el('button', 'nxc-panel__del', '×');
        remove.type = 'button';
        remove.title = '删掉这个模板';
        remove.setAttribute('aria-label', `删掉模板 ${template.title}`);
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          onDelete(template);
        });
        row.appendChild(remove);
        body.appendChild(row);
      }
    }
  }


  /**
   * Put a template on the canvas.
   *
   * The page is the writer of the canvas, so the template is put on by the
   * same rules that put on an action from the Agent. Nothing is run: the
   * first node waits for the user.
   */
  function applyTemplateOnCanvas(template) {
    const applied = applyAction(
      state.canvas,
      { type: 'apply_template', args: { template } },
      actionContext(),
    );
    if (applied.error) {
      showBanner(`模板没有铺上：${applied.error}`, 'error');
      return;
    }
    state.canvas.nodes = applied.canvas.nodes;
    state.canvas.connections = applied.canvas.connections;
    state.selection = [];
    markDirty();
    render();
    showBanner(`已铺上「${template.title}」，点节点上的「生成」开始`);
  }

  /**
   * Keep the canvas that is open now as a template of the user's own.
   *
   * The name comes from the canvas, so no name has to be typed: the page
   * cannot ask for one, because a native dialog would block it.
   */
  async function saveCurrentCanvasAsTemplate(title) {
    if (!state.canvas.id) {
      showBanner('先有一张画布，才能存成模板', 'error');
      return;
    }
    const name = String(title ?? '').trim();
    if (!name) {
      showBanner('这个模板还没有名字', 'error');
      return;
    }
    const id = `own-${Date.now().toString(36)}`;
    try {
      const response = await api('/api/templates', {
        method: 'POST',
        body: { id, title: name, canvasId: state.canvas.id },
      });
      showBanner(`已存成模板「${response?.template?.title ?? name}」`);
      await openTemplatePanel(dom.templatesButton.getBoundingClientRect());
    } catch (error) {
      showBanner(`没存上：${error?.message ?? error}`, 'error');
    }
  }

  /**
   * Take a template of the user away.
   *
   * The question is asked in the page: a native confirm() is a separate OS
   * window that never reaches the screen inside the MiniApp host.
   */
  async function deleteTemplate(template) {    const yes = await confirmInPage(`确定删掉模板「${template.title}」？画布本身不受影响。`);
    if (!yes) return;
    try {
      await api(`/api/templates/${encodeURIComponent(template.id)}`, { method: 'DELETE' });
      showBanner(`删掉了模板「${template.title}」`);
      await openTemplatePanel(dom.templatesButton.getBoundingClientRect());
    } catch (error) {
      showBanner(`没删掉：${error?.message ?? error}`, 'error');
    }
  }

  /**
   * The local library.
   *
   * Everything the runtime produced and everything the user picked from their
   * machine sits in a folder on this machine. The panel shows it, so an asset
   * that is on no canvas can still be brought back into a flow — and so a file
   * that nothing uses can be cleared away.
   */
  async function openLibraryPanel(anchorRect) {
    const panel = dom.floatingPanel;
    state.panel = { type: 'library', nodeId: null };
    panel.textContent = '';
    panel.dataset.canvasNoZoom = 'true';
    panel.appendChild(el('div', 'nxc-panel__title', '资产库'));
    const body = el('div', 'nxc-panel__body', '加载中…');
    panel.appendChild(body);
    panel.hidden = false;
    const rect = panel.getBoundingClientRect();
    const place = placeOverlay(
      { left: anchorRect.left, top: anchorRect.bottom + 6 },
      rect,
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.style.left = `${place.left}px`;
    panel.style.top = `${place.top}px`;

    const reload = async () => {
      let assets = [];
      try {
        const response = await api('/api/library');
        assets = Array.isArray(response.assets) ? response.assets : [];
      } catch (error) {
        body.textContent = `加载失败：${error?.message ?? error}`;
        return;
      }
      body.textContent = '';
      if (assets.length === 0) {
        body.appendChild(el('div', 'nxc-panel__desc', '还没有素材。画布里生成一张，就会自动收进这里。'));
        return;
      }
      const grid = el('div', 'nxc-library');
      for (const asset of assets) grid.appendChild(renderLibraryItem(asset, reload));
      body.appendChild(grid);
    };

    // The count and the cleanup: the folder grows with every run, and this is
    // what keeps it from growing for ever.
    const head = el('div', 'nxc-library__head');
    const count = el('span', null, '');
    const gc = el('button', 'nxc-btn nxc-btn--small', '清理未引用');
    gc.type = 'button';
    gc.title = '删掉既没有被节点引用、也不在画布上的素材';
    gc.addEventListener('click', async () => {
      try {
        const result = await api('/api/library/gc', { method: 'POST' });
        showBanner(`清理了 ${(result.removed ?? []).length} 个未引用素材`);
        await reload();
      } catch (error) {
        showBanner(`清理失败：${error?.message ?? error}`, 'error');
      }
    });
    head.appendChild(count);
    head.appendChild(gc);
    panel.insertBefore(head, body);

    await reload();
    count.textContent = `${body.querySelectorAll('.nxc-library__item').length} 个`;
  }

  function renderLibraryItem(asset, reload) {
    const item = el('div', 'nxc-library__item');
    const thumb = el('div', 'nxc-library__thumb');
    if (asset.kind === 'video') {
      const video = el('video', null);
      video.src = asset.url;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      thumb.appendChild(video);
    } else if (asset.kind === 'audio') {
      thumb.appendChild(el('span', 'nxc-library__badge', '♪'));
    } else {
      const img = el('img', null);
      img.src = asset.url;
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    }
    item.appendChild(thumb);

    const meta = el('div', 'nxc-library__meta');
    meta.appendChild(el('span', 'nxc-library__name', asset.title || asset.name));
    const kind = { image: '图片', video: '视频', audio: '音频' }[asset.kind] ?? asset.kind;
    const size = asset.bytes ? ` · ${Math.max(1, Math.round(asset.bytes / 1024))} KB` : '';
    meta.appendChild(el('span', 'nxc-library__sub', `${kind}${size}${asset.inUse ? ' · 画布在用' : ''}`));
    item.appendChild(meta);

    const acts = el('div', 'nxc-library__acts');
    const use = el('button', 'nxc-btn nxc-btn--small', '插入');
    use.type = 'button';
    use.title = '插进画布';
    use.addEventListener('click', () => insertFromLibrary(asset));
    acts.appendChild(use);

    const save = el('button', 'nxc-btn nxc-btn--small', '保存');
    save.type = 'button';
    save.title = '存到电脑';
    save.addEventListener('click', () => saveMedia({ title: asset.title || asset.name }, asset));
    acts.appendChild(save);

    const remove = el('button', 'nxc-btn nxc-btn--small', '删除');
    remove.type = 'button';
    remove.title = '从库里删掉这个文件';
    remove.addEventListener('click', async () => {
      try {
        await api(`/api/library/${encodeURIComponent(asset.name)}`, { method: 'DELETE' });
        showBanner('已从资产库移除');
        await reload();
      } catch (error) {
        showBanner(error?.message ?? '删除失败', 'error');
      }
    });
    acts.appendChild(remove);
    item.appendChild(acts);
    return item;
  }

  /**
   * Bring an asset from the library back into the flow.
   *
   * It lands as an input node: a piece of material that was put in, which
   * the flow reads like any other.
   */
  function insertFromLibrary(asset) {
    const rect = dom.viewport.getBoundingClientRect();
    const world = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const node = createNode('input', { x: world.x - 150, y: world.y - 90 }, {
      kind: asset.kind,
      title: asset.title || '素材',
      output: { status: 'success', media: [{ kind: asset.kind, url: asset.url }] },
    });
    state.selection = [node.id];
    markDirty();
    render();
    showBanner('已插进画布');
    return node;
  }

  function capsRow(label, value) {
    const row = el('div', 'nxc-panel__row');
    row.appendChild(el('span', null, label));
    row.appendChild(el('small', null, value));
    return row;
  }

  // ---------------------------------------------------------------- menus

  function closeMenus() {
    dom.contextMenu.hidden = true;
    dom.addMenu.hidden = true;
    closeDropdown();
    closeMentionMenu();
  }

  function showMenu(menu, x, y, items) {
    menu.textContent = '';
    for (const item of items) {
      if (item === '-') {
        menu.appendChild(el('div', 'nxc-menu__sep'));
        continue;
      }
      const button = el('button', `nxc-menu__item${item.danger ? ' nxc-menu__item--danger' : ''}`);
      // The colour of the data the node moves, the same one the board uses.
      if (item.kind) {
        const dot = el('i', 'nxc-menu__dot');
        dot.dataset.kind = item.kind;
        button.appendChild(dot);
      }
      button.appendChild(el('span', null, item.label));
      if (item.hint) button.appendChild(el('small', null, item.hint));
      button.addEventListener('click', () => {
        closeMenus();
        item.action();
      });
      menu.appendChild(button);
    }
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const place = placeOverlay(
      { left: x, top: y },
      rect,
      { width: window.innerWidth, height: window.innerHeight },
    );
    menu.style.left = `${place.left}px`;
    menu.style.top = `${place.top}px`;
  }

  /**
   * The menu that adds a node.
   *
   * It lists the kinds of node — a role and the data it moves — and the list
   * comes from the node table, so the menu and the board cannot fall out of
   * step. A mode is a choice on the card, so it never gets a row here.
   */
  function kindMenuItems() {
    return KIND_ORDER.map((entry) => ({
      label: entry.label,
      kind: entry.kind,
      action: () => {
        const center = centerOfViewport();
        const node = createNode(entry.type, { x: center.x - 140, y: center.y - 90 }, {
          // An input node is born holding the kind it was asked for.
          kind: entry.kind ?? undefined,
        });
        state.selection = [node.id];
        markDirty();
        render();
      },
    }));
  }

  // ---------------------------------------------------------------- runs

  /**
   * The generating nodes upstream of this one that still owe a result.
   *
   * They are returned in the order they have to run: the deepest one first.
   */
  function pendingAncestors(node) {
    const seen = new Set([node.id]);
    const order = [];
    const visit = (current) => {
      for (const conn of state.canvas.connections) {
        if (conn.toNodeId !== current.id) continue;
        const source = getNode(conn.fromNodeId);
        if (!source || seen.has(source.id)) continue;
        seen.add(source.id);
        if (!isGeneratingNode(source) || hasResult(source)) continue;
        visit(source);
        order.push(source);
      }
    };
    visit(node);
    return order;
  }

  /** Wait for the run that was started on this node to finish. */
  function waitForRun(nodeId, timeoutMs = 2_700_000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const taskId = state.nodeTasks.get(nodeId);
        const task = taskId ? state.tasks.get(taskId) : null;
        if (task && !['running', 'waiting-question'].includes(task.status)) {
          resolve(task);
          return;
        }
        // A video on MiniMax-H3 takes 15-30 minutes, so the wait is long
        // enough for a slow generation and not a timeout of its own.
        if (Date.now() - started > timeoutMs) {
          resolve(null);
          return;
        }
        window.setTimeout(tick, 200);
      };
      tick();
    });
  }

  /** Run a node and wait for its result. */
  async function runAndWait(node) {
    await startRun(node, { chain: false });
    const task = await waitForRun(node.id);
    return task?.status === 'done';
  }

  async function startRun(node, options = {}) {
    if (!state.agentAvailable) return;
    // A chain runs itself: the generating nodes upstream that still owe a
    // result are run first, and a node that already has one is left alone.
    if (options.chain !== false) {
      const pending = pendingAncestors(node);
      if (pending.length) {
        showBanner(`先补齐上游 ${pending.length} 个生成节点…`);
        for (const step of pending) {
          const ok = await runAndWait(step);
          if (!ok) {
            showBanner(`上游「${step.title}」没跑出来，先停下了`, 'error');
            return;
          }
        }
      }
    }
    const editor = state.editors.get(node.id);
    if (editor) syncSegments(node, editor);
    // The run is built by the shared rule, so the page and the runtime send
    // the same thing: the text the card shows is the text the run sends.
    const spec = runSpecFor(state.canvas, node, { chain: options.chain !== false });

    node.metadata.output = {
      status: 'loading',
      text: '',
      media: [],
      error: '',
      posterUrl: '',
      durationMs: 0,
      width: 0,
      height: 0,
      missing: false,
      updatedAt: new Date().toISOString(),
    };
    // Leave the editor: while it holds the focus the canvas defers its
    // rendering, and the run progress would stay invisible.
    if (document.activeElement?.isContentEditable) document.activeElement.blur();
    markDirty();
    render();

    try {
      const payload = await api('/api/runs', {
        method: 'POST',
        body: {
          nodeId: spec.nodeId,
          mode: spec.mode,
          // The mode the node is in: the runtime reads the material some modes
          // need before the Agent writes.
          nodeMode: spec.nodeMode,
          segments: spec.segments,
          prompt: spec.prompt,
          mentions: spec.mentions,
          params: spec.params,
          modelKey: spec.modelKey,
          sessionId: spec.sessionId,
          // How many assets this run asks for.
          count: spec.count,
          references: spec.references,
          // Which request the provider is asked for, and the pictures that are
          // plugged straight into this node. The three picture-to-video
          // requests are different requests, so the runtime needs to know.
          path: spec.path,
          frames: spec.frames,
        },
      });
      const task = payload.run;
      state.tasks.set(task.id, task);
      state.nodeTasks.set(node.id, task.id);
      if (task.sessionId) node.metadata.sessionId = task.sessionId;
      ensurePolling();
      render();
      // The caller may want to know which run this is: the Agent does, when it
      // asks for a run through the hosted MCP.
      return task;
    } catch (error) {
      node.metadata.output.status = 'error';
      node.metadata.output.error = String(error?.message ?? error);
      markDirty();
      render();
      return null;
    }
  }

  function ensurePolling() {
    if (state.pollTimer) return;
    state.pollTimer = window.setInterval(() => {
      void pollTasks();
    }, POLL_MS);
  }

  // After a reload the page has no run ids of its own, but the Node service
  // still knows which runs are in flight. Re-attach so a long video keeps
  // being waited for instead of being orphaned.
  async function reattachRuns() {
    try {
      const payload = await api('/api/tasks');
      const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
      for (const task of tasks) {
        if (!task?.id || !task?.nodeId) continue;
        state.nodeTasks.set(task.nodeId, task.id);
        state.tasks.set(task.id, task);
      }
      if (state.nodeTasks.size > 0) ensurePolling();
    } catch {
      // Nothing to re-attach.
    }
  }

  /**
   * Apply the outcome of a run.
   *
   * A generating node keeps the state of the run but not the result: the
   * result arrives as its own node, connected to the generating one.
   */
  function applyRunResult(node, task) {
    const output = node.metadata.output;
    if (task.sessionId) node.metadata.sessionId = task.sessionId;
    output.error = task.error || '';
    output.updatedAt = new Date().toISOString();
    if (task.status === 'running' || task.status === 'waiting-question') output.status = 'loading';
    else if (task.status === 'done') output.status = 'success';
    else if (task.status === 'aborted') output.status = 'interrupted';
    else if (task.status === 'error') output.status = 'error';

    if (roleOf(node) !== 'generate') {
      output.text = task.text || '';
      output.media = task.media || [];
      return;
    }
    if (task.status === 'done') spawnResultNode(node, task);
  }

  // The generating node this node feeds, if there is one.
  function downstreamGeneratingNode(node) {
    for (const conn of state.canvas.connections) {
      if (conn.fromNodeId !== node.id) continue;
      const target = getNode(conn.toNodeId);
      if (isGeneratingNode(target)) return target;
    }
    return null;
  }

  /**
   * The result of a run becomes its own node.
   *
   * The rule is in `actions.mjs`, where the runtime reads the same one: a
   * result that is placed by the page and a result that is placed by the
   * runtime have to look the same, or the canvas would depend on who wrote it.
   */
  function spawnResultNode(node, task) {
    const placed = materializeResults(state.canvas, node, task, actionContext());
    if (placed.error) return null;
    state.canvas.nodes = placed.canvas.nodes;
    state.canvas.connections = placed.canvas.connections;
    // A batch is more than one result: they are picked, so the versions can be
    // compared next to each other.
    if (placed.results.length > 1) {
      state.selection = placed.results.map((item) => item.id);
    }
    return placed.results[0] ?? null;
  }

  async function pollTasks() {
    const entries = [...state.nodeTasks.entries()];
    if (entries.length === 0) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
      return;
    }
    for (const [nodeId, taskId] of entries) {
      try {
        const payload = await api(`/api/runs/${taskId}`);
        const task = payload.run;
        const node = getNode(nodeId);
        // The result is applied before the task is recorded as settled: the
        // chain waits for the task, and the result node has to exist by then.
        if (node) {
          applyRunResult(node, task);
        }
        state.tasks.set(taskId, task);
        if (task.status && !['running', 'waiting-question'].includes(task.status)) {
          // The run is over. The panel keeps it for a moment, so the last
          // lines of its log can still be read.
          task.finishedAt = Date.now();
          state.nodeTasks.delete(nodeId);
          if (task.status === 'error') showBanner(task.error || '生成失败', 'error');
        }
        markDirty();
        scheduleRender();
      } catch {
        // Transient poll failures are ignored; the next tick retries.
      }
    }
  }

  // ---------------------------------------------------------------- actions

  // The Agent changes a canvas by asking for an action. The page is the only
  // writer of a canvas, so the action is applied here and the runtime waits
  // for the answer. The rule lives in `actions.mjs`, where the runtime reads
  // the same one.

  /** What an action needs to know about the page. */
  function actionContext() {
    return {
      sizes: state.palette?.sizes ?? {},
      modelsByType: Object.fromEntries(
        Object.entries(state.capabilities ?? {}).map(([type, caps]) => [
          type,
          (caps.models ?? []).map((model) => model.id),
        ]),
      ),
      defaultModelKey: state.defaultModelKey,
      idFor: (prefix) => uid(prefix),
      // The templates the prompt node offers, so a prompt node the Agent
      // makes is the same one the page would make.
      promptTemplates: state.palette?.promptTemplates ?? [],
      // What the model this node selected can take. The rules about the modes
      // and the ports ask for it, so the page and the runtime answer the same.
      capsFor: (node) => effectiveCaps(node),
    };
  }

  function ensureActionPolling() {
    if (state.actionTimer) return;
    state.actionTimer = window.setInterval(() => {
      void pollActions();
    }, ACTION_POLL_MS);
  }

  async function pollActions() {
    const canvasId = state.canvas.id;
    if (!canvasId) return;
    try {
      const payload = await api(`/api/actions?canvas=${encodeURIComponent(canvasId)}`);
      const actions = Array.isArray(payload?.actions) ? payload.actions : [];
      for (const action of actions) {
        await applyActionFromAgent(action);
      }
    } catch {
      // A failed poll is retried on the next tick.
    }
  }

  /** Apply one action and answer it. */
  async function applyActionFromAgent(action) {
    try {
      if (action.type === 'run') {
        const node = getNode(action.args?.nodeId);
        if (!node) throw new Error('这个画布上没有这个节点');
        // The run is started, not waited for: a video takes a quarter of an
        // hour, and the result shows up on the canvas on its own.
        const task = await startRun(node, { chain: false });
        if (!task) {
          await ackAction(action.id, false, node.metadata.output?.error || '这次运行没有开始');
          return;
        }
        await ackAction(action.id, true, '', { nodeId: node.id, runId: task.id });
        return;
      }
      if (action.type === 'materialize_result') {
        const node = getNode(action.args?.nodeId);
        if (!node) throw new Error('这个画布上没有这个节点');
        const placed = materializeResults(state.canvas, node, action.args?.task, actionContext());
        if (placed.error) throw new Error(placed.error);
        state.canvas.nodes = placed.canvas.nodes;
        state.canvas.connections = placed.canvas.connections;
        state.selection = placed.results.map((item) => item.id);
        markDirty();
        render();
        await ackAction(action.id, true, '', { nodeId: node.id });
        return;
      }
      const applied = applyAction(state.canvas, action, actionContext());
      if (applied.error) {
        showBanner(`Agent 的改动没有生效：${applied.error}`, 'error');
        await ackAction(action.id, false, applied.error);
        return;
      }
      state.canvas.nodes = applied.canvas.nodes;
      state.canvas.connections = applied.canvas.connections;
      // A material a prompt names has to reach the nodes that generate from
      // it, and the Agent's change may have opened a port or a new child.
      for (const id of [action.args?.id, action.args?.from, action.args?.to]) {
        applyMentions(id);
      }
      // A node that is gone cannot stay selected.
      state.selection = state.selection.filter((id) => (
        state.canvas.nodes.some((node) => node.id === id)
      ));
      markDirty();
      render();
      await ackAction(action.id, true, '', applied.info ?? null);
    } catch (error) {
      await ackAction(action.id, false, String(error?.message ?? error));
    }
  }

  /** Answer an action: it was applied, or it could not be. */
  async function ackAction(id, ok, error = '', info = null) {
    try {
      await api('/api/actions/ack', {
        method: 'POST',
        body: { id, ok, error, info },
      });
    } catch {
      // The runtime notices the silence and takes the change itself.
    }
  }

  /**
   * The page takes the canvas.
   *
   * From here on the runtime does not write this canvas: every change the
   * Agent asks for is handed to the page and applied here. The claim waits for
   * the writes that are already on their way, so the copy the page reads is
   * never older than the last write.
   */
  async function takeCanvas(id) {
    try {
      await api('/api/actions/claim', {
        method: 'POST',
        body: { canvasId: id },
      });
    } catch {
      // The canvas stays free for the runtime; the next open tries again.
    }
  }

  /** The page lets the canvas go: it shows another one now. */
  function releaseCanvas(id) {
    if (!id) return;
    void api('/api/actions/release', {
      method: 'POST',
      body: { canvasId: id },
    }).catch(() => {});
  }

  /**
   * Take the canvas back and see whether the stored one is newer.
   *
   * A page that was in the background may have missed a change: the runtime
   * writes a canvas nobody holds, and a browser throttles the timers of a tab
   * it does not show. So when the page comes back it takes the canvas again
   * and reads the stored one — and if that one is newer, the page loads it,
   * because a page that holds an old copy cannot save.
   */
  async function resyncCanvas(reason = 'stale') {
    const id = state.canvas.id;
    if (!id) return;
    try {
      await takeCanvas(id);
      const payload = await api(`/api/canvases/${id}`);
      const stored = payload.canvas;
      if (!stored) return;
      const storedAt = new Date(stored.updatedAt ?? 0).getTime();
      const heldAt = new Date(state.canvas.updatedAt ?? 0).getTime();
      if (storedAt <= heldAt) return;
      const unsaved = dom.saveState?.dataset?.state === 'pending';
      state.canvas = stored;
      state.selection = [];
      state.nodeTasks.clear();
      state.tasks.clear();
      render();
      setSaveState('saved');
      if (reason === 'conflict') {
        showBanner('画布在别处被改过了，这次没保存上，已重新载入。', 'error');
      } else if (unsaved) {
        showBanner('画布在别处被改过了，已重新载入；你刚才那次改动没有保存上。', 'error');
      } else {
        showBanner('画布在别处被改过了，已重新载入。');
      }
    } catch {
      // The page keeps the copy it has.
    }
  }

  // ---------------------------------------------------------------- persistence

  /**
   * The canvas changed.
   *
   * `history: false` is for a change that only moves the view: the document
   * has to be saved, but there is nothing to undo. Panning the board would
   * otherwise fill the history with entries that only restore the camera.
   */
  function markDirty(options = {}) {
    setSaveState('pending');
    if (state.saveTimer) window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      void saveCanvas();
    }, AUTOSAVE_MS);
    if (options.history === false) return;
    if (state.historyTimer) window.clearTimeout(state.historyTimer);
    state.historyTimer = window.setTimeout(() => {
      pushHistory();
    }, HISTORY_DEBOUNCE_MS);
  }

  function draftKey() {
    return `nxc-draft:${state.canvas.id ?? 'new'}`;
  }

  function saveDraft() {
    if (!state.canvas.id) return;
    try {
      localStorage.setItem(
        draftKey(),
        JSON.stringify({
          nodes: state.canvas.nodes,
          connections: state.canvas.connections,
          viewport: state.canvas.viewport,
          savedAt: new Date().toISOString(),
        }),
      );
    } catch {
      // A full or unavailable localStorage must not break the canvas.
    }
  }

  function maybeRestoreDraft() {
    if (!state.canvas.id) return;
    let draft = null;
    try {
      const raw = localStorage.getItem(draftKey());
      draft = raw ? JSON.parse(raw) : null;
    } catch {
      draft = null;
    }
    if (!draft || !Array.isArray(draft.nodes)) return;
    const savedAt = new Date(draft.savedAt ?? 0).getTime();
    const serverAt = new Date(state.canvas.updatedAt ?? 0).getTime();
    if (!savedAt || savedAt <= serverAt) return;
    state.draft = draft;
    showBanner('发现未保存的草稿，可在空白处右键恢复');
  }

  function restoreDraft() {
    if (!state.draft) return;
    state.canvas.nodes = state.draft.nodes;
    state.canvas.connections = state.draft.connections;
    state.canvas.viewport = state.draft.viewport;
    state.draft = null;
    markDirty();
    render();
    showBanner('已恢复草稿');
  }

  async function saveCanvas() {
    if (!state.canvas.id) return;
    setSaveState('saving');
    saveDraft();
    try {
      const payload = await api(`/api/canvases/${state.canvas.id}`, {
        method: 'PUT',
        body: state.canvas,
      });
      state.canvas.updatedAt = payload.canvas?.updatedAt ?? state.canvas.updatedAt;
      setSaveState('saved');
      await refreshCanvasList();
    } catch (error) {
      // The api helper already told the user what went wrong when it was a
      // session problem; the state only records that the save did not happen.
      setSaveState('error');
      if (error?.status === 409) {
        // The stored canvas moved on. The page takes it again and reads it, so
        // the next save is not refused as well; what was not saved is said.
        await resyncCanvas('conflict');
      }
    }
  }

  async function refreshCanvasList() {
    try {
      const payload = await api('/api/canvases');
      state.canvases = payload.canvases ?? [];
      renderCanvasSelect();
    } catch {
      // The list is a convenience; failing to refresh must not break the app.
    }
  }

  function renderCanvasSelect() {
    const button = dom.canvasSelect;
    const current = state.canvases.find((item) => item.id === state.canvas.id) ?? state.canvases[0] ?? null;
    // The count of the canvas in front of the user is the live one: the list
    // still holds the count from the last save, so an edit would be counted
    // late — and never, when the save did not happen.
    const count = current && current.id === state.canvas.id
      ? state.canvas.nodes.length
      : current?.nodeCount;
    button.textContent = current ? `${current.title}（${count} 节点）` : '选择画布';
    button.title = current ? current.title : '切换画布';
    button.dataset.dropdownValue = current ? current.id : '';
  }

  function openCanvasDropdown() {
    toggleDropdown(
      dom.canvasSelect,
      state.canvases.map((item) => ({
        value: item.id,
        label: `${item.title}（${item.nodeCount} 节点）`,
      })),
      (next) => {
        if (next) void openCanvas(next);
      },
    );
  }

  // A node saved before the mode-specific model lists existed still carries a
  // text-model key. Move it onto the mode's own model so the dropdown and the
  // server agree on what the node will actually generate with.
  function normalizeNodeModels() {
    let changed = false;
    for (const node of state.canvas.nodes) {
      // The models belong to the way the node makes its data, so a music run
      // keeps the music model.
      const models = state.capabilities[runModeOf(node)]?.models ?? [];
      if (models.length === 0) continue;
      if (models.some((model) => model.id === node.metadata.model)) continue;
      node.metadata.model = models[0].id;
      changed = true;
    }
    if (changed) markDirty();
  }

  /**
   * Move an old canvas onto the three-role model.
   *
   * A node that used to hold its own result becomes a generating node, and
   * the result it held becomes a result node next to it. The connections
   * follow the data: what came in still goes into the generating node, and
   * what went out now starts at the result.
   */
  function migrateToRoles() {
    const canvas = state.canvas;
    if (!canvas?.nodes?.length) return false;
    // A canvas that already has the new roles is left alone.
    if (canvas.nodes.some((node) => node.type === 'result' || node.type === 'input')) return false;
    let changed = false;
    for (const node of [...canvas.nodes]) {
      if (node.type === 'group') continue;
      const output = node.metadata.output ?? {};
      if (!output.media?.length && !String(output.text ?? '').trim()) continue;
      const result = createNode(
        'result',
        { x: node.position.x + node.width + 80, y: node.position.y + 40 },
        {
          title: `${node.title} · 结果`,
          kind: output.media?.[0]?.kind ?? (node.type === 'text' ? 'text' : 'image'),
          output: { ...output, status: 'success' },
        },
      );
      result.metadata.sourceNodeId = node.id;
      // The generating node keeps the prompt, the model and the parameters.
      node.metadata.output = emptyOutput();
      // What went out used to be read from this node, so it now starts at the
      // result.
      for (const conn of canvas.connections) {
        if (conn.fromNodeId === node.id) conn.fromNodeId = result.id;
      }
      connect(node.id, result.id, result.metadata.kind, { quiet: true });
      changed = true;
    }
    return changed;
  }

  function emptyOutput() {
    return {
      status: 'idle', text: '', media: [], error: '', posterUrl: '',
      durationMs: 0, width: 0, height: 0, missing: false, updatedAt: '',
    };
  }

  async function openCanvas(id) {
    try {
      // The page takes the canvas before it reads it: from here on the runtime
      // does not write it, and every change the Agent asks for is applied
      // here.
      const previous = state.canvas.id;
      if (previous && previous !== id) releaseCanvas(previous);
      await takeCanvas(id);
      const payload = await api(`/api/canvases/${id}`);
      state.canvas = payload.canvas;
      state.selection = [];
      state.nodeTasks.clear();
      state.tasks.clear();
      state.draft = null;
      normalizeNodeModels();
      if (migrateToRoles()) {
        markDirty();
        showBanner('旧画布已迁移为「输入 / 生成 / 结果」三段式。');
      }
      render();
      resetHistory();
      setSaveState('saved');
      maybeRestoreDraft();
      ensureActionPolling();
      void pollActions();
    } catch (error) {
      setSaveState('error');
      showBanner(`打开画布失败：${error?.message ?? error}`, 'error');
    }
  }

  /**
   * The name a new canvas gets when nobody types one.
   *
   * The name is a name, not a question: the page asks nothing with a native
   * dialog, because such a dialog never reaches the screen inside the
   * MiniApp host.
   */
  function nextCanvasTitle() {
    const taken = new Set((state.canvases ?? []).map((item) => String(item.title ?? '')));
    if (!taken.has('未命名画布')) return '未命名画布';
    for (let index = 2; index < 1000; index += 1) {
      const title = `未命名画布 ${index}`;
      if (!taken.has(title)) return title;
    }
    return '未命名画布';
  }

  /** Rename the canvas in place: the name is typed into the page itself. */
  function startRename(initial = '') {
    const field = dom.canvasRename;
    if (!field) return;
    field.value = initial;
    field.hidden = false;
    // The name sits where the title of the canvas was, so the two do not
    // stand next to each other.
    if (dom.canvasSelect) dom.canvasSelect.hidden = true;
    // The focus never scrolls: the board is a transformed layer, and the
    // browser would scroll to the layout box of the focused control.
    field.focus({ preventScroll: true });
    field.select();
  }

  function commitRename() {
    const field = dom.canvasRename;
    if (!field || field.hidden) return;
    const title = field.value.trim();
    field.hidden = true;
    if (dom.canvasSelect) dom.canvasSelect.hidden = false;
    if (!title || title === state.canvas.title) return;
    state.canvas.title = title;
    markDirty();
    render();
    void saveCanvas();
  }

  async function createCanvas(title, { askName = true } = {}) {
    const payload = await api('/api/canvases', { method: 'POST', body: { title } });
    // A canvas the page made is a canvas the page holds: the runtime does not
    // write it behind the page's back either.
    await takeCanvas(payload.canvas.id);
    state.canvas = payload.canvas;
    state.selection = [];
    render();
    resetHistory();
    setSaveState('saved');
    ensureActionPolling();
    await refreshCanvasList();
    // The name is written right away, while the new canvas is in front. A
    // canvas that was made for a template already has its name.
    if (askName) startRename(state.canvas.title || title);
  }

  /**
   * Ask the user to confirm, in the page.
   *
   * A native confirm() is a separate OS window that never reaches the screen
   * inside the MiniApp host, so a question asked that way is a question
   * nobody answers — and the button looks as if it did nothing.
   */
  function confirmInPage(text) {
    const dialog = dom.confirmDialog;
    if (!dialog) return Promise.resolve(false);
    dom.confirmText.textContent = text;
    dialog.hidden = false;
    dom.confirmOk.focus({ preventScroll: true });
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }

  function closeConfirm(answer) {
    const dialog = dom.confirmDialog;
    if (dialog) dialog.hidden = true;
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(answer);
  }

  async function deleteCanvas() {
    if (!state.canvas.id) return;
    const title = state.canvas.title || '未命名画布';
    const yes = await confirmInPage(
      // What goes away is said out loud, and the way to keep it is named: the
      // chain can become a template, and a result can be written to the disk.
      `确定删除画布「${title}」？画布上的步骤会一起没了；想留住就先「存成模板」，结果去「资产库」存到本地。`,
    );
    if (!yes) return;
    await api(`/api/canvases/${state.canvas.id}`, { method: 'DELETE' });
    // The canvas is gone: the page does not hold it any more.
    releaseCanvas(state.canvas.id);
    try {
      localStorage.removeItem(draftKey());
    } catch {
      // ignore
    }
    state.canvas = {
      id: null,
      title: '未命名画布',
      nodes: [],
      connections: [],
      backgroundMode: 'lines',
      viewport: { x: 80, y: 60, k: 1 },
    };
    state.selection = [];
    render();
    await refreshCanvasList();
  }

  /**
   * Share the steps of the canvas that is open now, as a template file.
   *
   * A template is the skeleton of a chain: the nodes that generate, the lines
   * between them and the prompts and parameters they carry. What a run left
   * behind is left behind, so the file opens whole on another machine.
   *
   * The file is written by the runtime, not by the browser: a download the
   * browser starts here never arrives under the name it was given, so the
   * runtime writes it and says where it went.
   *
   * Where it goes is the user's to say: the panel asks for the path, because
   * a native file dialog is a separate OS window that never reaches the
   * screen inside the MiniApp host.
   */
  async function saveTemplateToLocal() {
    const panel = dom.floatingPanel;
    state.panel = { type: 'export-template', nodeId: null };
    panel.textContent = '';
    panel.dataset.canvasNoZoom = 'true';
    panel.appendChild(el('div', 'nxc-panel__title', '保存到本地'));
    const body = el('div', 'nxc-panel__body', '找位置中…');
    panel.appendChild(body);
    panel.hidden = false;
    const rect = panel.getBoundingClientRect();
    const place = placeOverlay(
      { left: dom.templatesButton.getBoundingClientRect().left, top: dom.templatesButton.getBoundingClientRect().bottom + 6 },
      rect,
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.style.left = `${place.left}px`;
    panel.style.top = `${place.top}px`;

    const base = String(state.canvas.title || '画布').replace(/[\\/:*?"<>|]/g, '').trim() || '画布';
    const skeleton = templateFromCanvas(state.canvas, { id: `own-${base}-${Date.now().toString(36)}`, title: `${base} 的模板` });
    if (!skeleton.actions.length) {
      body.textContent = '这张画布上没有能带走的步骤（结果和素材不算步骤）';
      return;
    }
    const document = templateFile({
      id: skeleton.id,
      title: skeleton.title,
      description: `从画布「${state.canvas.title || base}」存下来的模板`,
      actions: skeleton.actions,
    });

    let places = null;
    try {
      places = await api('/api/places');
    } catch (error) {
      body.textContent = `找不到本机的位置：${error?.message ?? error}`;
      return;
    }
    const sep = places.sep || '\\';
    const fileName = `${base}.模板.json`;
    body.textContent = '';
    body.appendChild(el('div', 'nxc-panel__desc', '这个文件会存到本机的哪个位置：'));
    const path = el('input', 'nxc-panel__path');
    path.type = 'text';
    path.value = `${places.downloads}${sep}${fileName}`;
    path.setAttribute('aria-label', '保存到哪个位置');
    body.appendChild(path);
    // The folders a person looks in, so the path is one click away.
    const row = el('div', 'nxc-panel__row');
    for (const [label, key] of [['下载文件夹', 'downloads'], ['桌面', 'desktop'], ['文档', 'documents'], ['主目录', 'home']]) {
      const pick = el('button', 'nxc-btn nxc-btn--small', label);
      pick.type = 'button';
      pick.addEventListener('click', () => {
        path.value = `${places[key]}${sep}${fileName}`;
      });
      row.appendChild(pick);
    }
    body.appendChild(row);
    const save = el('button', 'nxc-panel__option');
    save.type = 'button';
    save.appendChild(el('span', null, '存到这儿'));
    save.appendChild(el('small', null, `${fileName} · 模板文件`));
    save.addEventListener('click', () => {
      void writeTemplateFile(path.value, document);
    });
    body.appendChild(save);
  }

  /**
   * Write the template file where the user said.
   */
  async function writeTemplateFile(path, document) {
    const asked = String(path ?? '').trim();
    if (!asked) {
      showBanner('没写这个文件要去哪里', 'error');
      return;
    }
    try {
      const response = await api('/api/export', {
        method: 'POST',
        body: { path: asked, document },
      });
      closePanel();
      showBanner(`已保存到 ${response.path}`);
    } catch (error) {
      showBanner(`没导出成：${error?.message ?? error}`, 'error');
    }
  }

/**
   * The one menu that holds templates.
   *
   * There are two ways in and two ways out, and no more:
   *
   * - **我的模板** — the chains the user kept. They live in the runtime's own
   *   template folder, so they are there whatever happens to a file.
   * - **打开本地模板** — a template file that is on this machine.
   * - **保存为我的模板** — the canvas that is open now becomes one of the
   *   user's own, under a name they give it.
   * - **保存到本地** — the canvas that is open now becomes a file.
   *
   * A template that is picked here lands on a canvas of its own — the canvas
   * that is open now is a piece of work in progress, and a chain that came
   * from somewhere else should not be poured into it. An empty canvas is used
   * as it is: there is nothing on it to lose.
   */
  async function openTemplatePanel(anchorRect) {
    const panel = dom.floatingPanel;
    state.panel = { type: 'templates', nodeId: null };
    panel.textContent = '';
    panel.dataset.canvasNoZoom = 'true';
    panel.appendChild(el('div', 'nxc-panel__title', '模板'));
    const body = el('div', 'nxc-panel__body', '找模板中…');
    panel.appendChild(body);
    panel.hidden = false;
    const rect = panel.getBoundingClientRect();
    const place = placeOverlay(
      { left: anchorRect.left, top: anchorRect.bottom + 6 },
      rect,
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.style.left = `${place.left}px`;
    panel.style.top = `${place.top}px`;

    body.textContent = '';
    body.appendChild(el('div', 'nxc-panel__desc', '选中的模板会开一张新画布；当前画布是空的就用它。'));

    // The templates: the ones of the user first, then the ready-made ones.
    let templates = [];
    try {
      const response = await api('/api/templates');
      templates = Array.isArray(response.templates) ? response.templates : [];
    } catch (error) {
      body.textContent = `没找到模板：${error?.message ?? error}`;
      return;
    }
    const own = templates.filter((item) => item.own);
    const builtin = templates.filter((item) => !item.own);
    const groups = templateGroups(builtin);
    if (own.length) groups.unshift({ label: '我的模板', templates: own, own: true });
    renderTemplateGroups(body, groups, (template) => {
      void openTemplateInNewCanvas(template);
    }, (template) => {
      void deleteTemplate(template);
    });

    // A template file that is on this machine: the file the user picks is
    // read by the one rule that reads a template, so a file that is something
    // else is refused instead of being poured onto the canvas.
    const pick = el('label', 'nxc-panel__option nxc-file');
    pick.appendChild(el('span', null, '打开本地模板'));
    pick.appendChild(el('small', null, '本机任意位置的 .json'));
    const input = el('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.title = '打开一个本机的模板文件';
    input.setAttribute('aria-label', '打开本地模板');
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const parsed = readTemplateFile(await file.text());
      if (!parsed.ok) {
        showBanner(`这不是一个模板：${parsed.error}`, 'error');
        return;
      }
      await openTemplateInNewCanvas(parsed.template);
    });
    pick.appendChild(input);
    body.appendChild(pick);

    // The canvas that is open now can become a template of its own: the steps
    // are taken from it, the results and the material are left behind.
    // The name is typed into the page: a template the user keeps should carry
    // the name they gave it, not the name of the canvas it came from.
    const save = el('button', 'nxc-panel__option');
    save.type = 'button';
    save.appendChild(el('span', null, '保存为我的模板'));
    save.appendChild(el('small', null, '只留步骤：生成节点、连线和提示词；结果和素材不留'));
    const nameRow = el('div', 'nxc-panel__row');
    const nameInput = el('input', 'nxc-panel__path');
    nameInput.type = 'text';
    nameInput.maxLength = 80;
    nameInput.value = `${state.canvas.title || '画布'} 的模板`;
    nameInput.setAttribute('aria-label', '这个模板叫什么');
    const nameOk = el('button', 'nxc-btn nxc-btn--small', '存下来');
    nameOk.type = 'button';
    nameRow.appendChild(nameInput);
    nameRow.appendChild(nameOk);
    nameRow.hidden = true;
    const doSave = () => {
      const title = nameInput.value.trim();
      nameRow.hidden = true;
      if (!title) return;
      void saveCurrentCanvasAsTemplate(title);
    };
    nameOk.addEventListener('click', doSave);
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        doSave();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        nameRow.hidden = true;
      }
    });
    save.addEventListener('click', () => {
      nameRow.hidden = !nameRow.hidden;
      if (!nameRow.hidden) {
        nameInput.focus({ preventScroll: true });
        nameInput.select();
      }
    });
    body.appendChild(save);
    body.appendChild(nameRow);

    // And it can become a file on this machine, wherever the user says.
    const toLocal = el('button', 'nxc-panel__option');
    toLocal.type = 'button';
    toLocal.appendChild(el('span', null, '保存到本地'));
    toLocal.appendChild(el('small', null, '写成一个 .json 文件，可以发给别的机器'));
    toLocal.addEventListener('click', () => {
      void saveTemplateToLocal();
    });
    body.appendChild(toLocal);
  }


  /**
   * Put a template on a canvas of its own.
   *
   * The canvas that is open now is left alone: a chain that was picked in the
   * import panel is a new piece of work, and it gets a canvas of its own. An
   * **empty** canvas is used as it is — there is nothing on it to lose, and a
   * second empty canvas would only be clutter.
   *
   * The template is not kept in the list: the file it came from stays where
   * it is, and the import panel finds it there again. A template the user
   * wants to keep is one they save from the canvas it landed on.
   */
  async function openTemplateInNewCanvas(template) {
    closePanel();
    // A canvas that is open and empty is used as it is: there is nothing on
    // it to lose, and a second empty canvas would only be clutter. A canvas
    // that is not open yet is not a canvas at all — it would have nowhere to
    // be written — so that one is made.
    const empty = Boolean(state.canvas?.id) && !(state.canvas?.nodes?.length);
    if (empty) {
      // The canvas that is open is empty: it becomes the canvas of this
      // template, and it takes the name of it.
      if (template.title) state.canvas.title = template.title;
      applyTemplateOnCanvas(template);
      return;
    }
    await createCanvas(`${template.title || '新画布'}`, { askName: false });
    applyTemplateOnCanvas(template);
  }

  function showBanner(message, tone = 'info') {
    if (!dom.banner) {
      dom.banner = el('div', 'nxc-banner');
      // A status message is announced: politely for an outcome, firmly for
      // a failure.
      dom.banner.setAttribute('role', tone === 'error' ? 'alert' : 'status');
      dom.banner.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
      dom.viewport.appendChild(dom.banner);
    }
    dom.banner.dataset.tone = tone;
    dom.banner.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    dom.banner.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    dom.banner.textContent = message;
    dom.banner.hidden = false;
    window.setTimeout(() => {
      if (dom.banner) dom.banner.hidden = true;
    }, 4200);
  }

  async function loadPalette() {
    try {
      const payload = await api('/api/palette');
      state.palette = payload;
      state.models = payload.models ?? [];
      state.defaultModelKey = payload.defaultModelKey ?? state.models[0]?.key ?? null;
      state.agentAvailable = Boolean(payload.agentAvailable);
      state.capabilities = payload.modes ?? {};
      state.capabilitiesByModel = payload.modesByModel ?? {};
    } catch {
      // Keep whatever we had.
    }
  }

  // The local media tools need ffmpeg on the machine. The Node service reports
  // whether it was found, so the page can unlock the tools or say what is
  // missing instead of failing on the first click.
  async function loadMediaStatus() {
    try {
      const payload = await api('/api/media/status');
      state.media = payload.media ?? { available: false };
    } catch {
      state.media = { available: false, canUpload: false };
    }
  }

  // The TTS voice catalogue comes from the connector through the Node service.
  // It is read once per session; the audio nodes render it from the cache.
  async function loadVoices() {
    try {
      const payload = await api('/api/voices');
      state.voices = Array.isArray(payload.voices) ? payload.voices : [];
      state.voiceError = state.voices.length ? null : (payload.error ?? null);
    } catch (error) {
      state.voices = [];
      state.voiceError = `音色清单读取失败：${error?.message ?? error}`;
    }
    render();
  }

  // ---------------------------------------------------------------- interactions

  // Node gestures are bound directly on each node element, the way the
  // reference implementation does it. Delegating them through the viewport
  // means one stray event target can swallow the whole gesture, and a node
  // that is rebuilt between pointerdown and pointermove loses its drag.
  function bindNodeGestures(node, wrap) {
    wrap.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const target = resolveEventTarget(event);
      const portEl = target?.closest?.('[data-port]');
      const resizeEl = target?.closest?.('[data-resize]');
      if (portEl) {
        event.preventDefault();
        event.stopPropagation();
        startConnectionDrag(event, node.id, portEl.dataset.port, portEl.dataset.kind ?? 'text', portEl);
        return;
      }
      if (resizeEl) {
        event.preventDefault();
        event.stopPropagation();
        startResize(event, node);
        return;
      }
      // Controls and the inline editor keep their own behaviour. The press is
      // still stopped here: the viewport cancels pointerdown, and a cancelled
      // pointerdown never produces the click a control listens for.
      if (isControlTarget(target)) {
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      selectNode(node.id, event.shiftKey || event.metaKey || event.ctrlKey);
      startNodeDrag(event, node);
    });
    wrap.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectNode(node.id);
      openNodeMenu(node, event.clientX, event.clientY);
    });
  }

  function bindInteractions() {
    dom.viewport.addEventListener(
      'wheel',
      (event) => {
        const target = resolveEventTarget(event);
        // Overlays, scrollable node bodies and ports must never zoom the canvas.
        if (target?.closest('.nxc-menu,.nxc-panel,.nxc-minimap,.nxc-taskpanel,[data-canvas-no-zoom]')) return;
        if (target?.closest('.nxc-node__body,.nxc-node__media-wrap,[data-port],textarea,input,select')) return;
        event.preventDefault();
        const rect = dom.viewport.getBoundingClientRect();
        const { x, y, k } = state.canvas.viewport;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k * 1.1 ** (-event.deltaY / 100)));
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        const worldX = (sx - x) / k;
        const worldY = (sy - y) / k;
        state.canvas.viewport = { x: sx - worldX * next, y: sy - worldY * next, k: next };
        applyViewport();
        markDirty({ history: false });
      },
      { passive: false },
    );

    dom.viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      // A control inside the viewport keeps its own behaviour: cancelling the
      // pointerdown would suppress the compatibility mouse events, so the
      // click a control listens for would never happen. The nodes stop the
      // press themselves; the task panel and the minimap do not.
      if (isControlTarget(resolveEventTarget(event))) return;
      event.preventDefault();
      if (event.shiftKey) {
        startBand(event);
        return;
      }
      selectNode(null, false);
      startPan(event);
    });

    dom.viewport.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const target = resolveEventTarget(event);
      const nodeEl = target?.closest('.nxc-node');
      const connectionEl = target?.closest('[data-connection-id]');
      const connectionId = connectionEl?.dataset.connectionId;

      if (connectionId) {
        showMenu(dom.contextMenu, event.clientX, event.clientY, [
          { label: '删除连接', action: () => removeConnection(connectionId) },
        ]);
        return;
      }
      if (nodeEl) {
        const id = nodeEl.dataset.nodeId;
        const node = getNode(id);
        showMenu(dom.contextMenu, event.clientX, event.clientY, nodeMenuItems(node));
        return;
      }
      showMenu(dom.contextMenu, event.clientX, event.clientY, [
        ...kindMenuItems(),
        { label: '重置视图', action: resetView },
        { label: '恢复草稿', action: restoreDraft },
      ]);
    });

    dom.viewport.addEventListener('dblclick', (event) => {
      const target = resolveEventTarget(event);
      if (target?.closest('.nxc-node')) return;
      const world = screenToWorld(event.clientX, event.clientY);
      const node = createNode('image', { x: world.x - 150, y: world.y - 80 });
      state.selection = [node.id];
      markDirty();
      render();
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        // The question the page asks is closed by Escape, like any other.
        if (dom.confirmDialog && !dom.confirmDialog.hidden) {
          closeConfirm(false);
          return;
        }
        if (state.dropdown) {
          // Escape closes the drop-down and hands the focus back to the
          // control that opened it.
          closeDropdown({ restoreFocus: true });
          return;
        }
        if (state.mention) {
          closeMentionMenu();
          return;
        }
        if (state.panel) {
          closePanel();
          return;
        }
        if (!dom.contextMenu.hidden || !dom.addMenu.hidden) {
          closeMenus();
          return;
        }
        if (state.editingTitleId) {
          state.editingTitleId = null;
          render();
          return;
        }
        selectNode(null, false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault();
        redo();
        return;
      }
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.target?.isContentEditable) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selection.length) {
          event.preventDefault();
          for (const id of [...state.selection]) removeNode(id);
          state.selection = [];
          markDirty();
          render();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
        if (state.selection.length) {
          event.preventDefault();
          copySelection();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
        event.preventDefault();
        pasteClipboard();
      }
    });

    // A native drag would swallow the pointermove stream the canvas relies on.
    // The blocker lives on the document so it also covers media that is
    // rendered outside the viewport subtree.
    document.addEventListener('dragstart', (event) => {
      event.preventDefault();
    });
    dom.minimap.addEventListener('click', minimapJump);
    window.addEventListener('resize', () => applyViewport());
    // Swallow the click that ends a drag.
    window.addEventListener(
      'click',
      (event) => {
        if (!state.suppressClick) return;
        state.suppressClick = false;
        event.stopPropagation();
        event.preventDefault();
      },
      true,
    );
    document.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('.nxc-menu') || event.target.closest?.('.nxc-panel')) return;
      closeDropdown();
      closeMentionMenu();
      closePanel();
    });
  }

  // Pointer capture keeps the gesture alive: every pointermove / pointerup is
  // retargeted to the viewport, so the drag cannot be lost when the pointer
  // crosses a node, an overlay, or the window edge.
  function capturePointer(event) {
    const id = event.pointerId;
    try {
      dom.viewport.setPointerCapture(id);
    } catch {
      // Some surfaces refuse capture; the window listener still works.
    }
    return id;
  }

  function releasePointer(pointerId) {
    try {
      dom.viewport.releasePointerCapture(pointerId);
    } catch {
      // Already released.
    }
  }

  function selectNode(id, additive) {
    if (id == null) state.selection = [];
    else if (additive) {
      const index = state.selection.indexOf(id);
      if (index >= 0) state.selection.splice(index, 1);
      else state.selection.push(id);
    } else state.selection = [id];
    // Selection is a class toggle, not a rebuild: re-rendering here would
    // destroy the focused contentEditable and drop the caret.
    for (const element of dom.nodes.querySelectorAll('.nxc-node')) {
      const node = getNode(element.dataset.nodeId);
      const selected = state.selection.includes(element.dataset.nodeId);
      element.classList.toggle('nxc-node--selected', selected);
      // The word and the name follow the state, so it is never carried by
      // the border colour alone.
      const chip = element.querySelector('.nxc-node__sel');
      if (chip) chip.hidden = !selected;
      if (node) element.setAttribute('aria-label', nodeAccessibleName(node));
      // The board steps back around the selection.
      element.classList.toggle('is-dim', !isRelatedToSelection(element.dataset.nodeId));
    }
    // The lines are redrawn, so they pick up the selection and the focus
    // state in one go.
    renderConnections();
  }

  function copySelection() {
    const nodes = state.selection.map(getNode).filter(Boolean).map((node) => JSON.parse(JSON.stringify(node)));
    if (!nodes.length) {
      showBanner('没有选中的节点');
      return;
    }
    state.clip = { nodes };
    try {
      const payload = JSON.stringify({ kind: CLIPBOARD_KIND, nodes });
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(payload).catch(() => {});
    } catch {
      // System clipboard unavailable: the internal clipboard still works.
    }
    showBanner(`已复制 ${nodes.length} 个节点`);
  }

  function pasteClipboard() {
    if (!state.clip?.nodes?.length) {
      showBanner('剪贴板是空的');
      return;
    }
    const rect = dom.viewport.getBoundingClientRect();
    const planned = planPaste({
      clip: state.clip,
      viewport: state.canvas.viewport,
      viewportSize: { width: rect.width, height: rect.height },
      idFor: () => uid('n'),
    });
    const ids = [];
    for (const copy of planned) {
      copy.metadata = { ...copy.metadata, sessionId: null };
      state.canvas.nodes.push(copy);
      ids.push(copy.id);
    }
    state.selection = ids;
    markDirty();
    render();
    showBanner(`已粘贴 ${ids.length} 个节点`);
  }

  function resetView() {
    const nodes = state.canvas.nodes;
    if (nodes.length === 0) {
      state.canvas.viewport = { x: 80, y: 60, k: 1 };
      applyViewport();
      markDirty({ history: false });
      return;
    }
    // Fit every node into the view. A fixed viewport left the canvas blank
    // as soon as a node had been dragged away from the origin.
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.position.y + node.height));
    const rect = dom.viewport.getBoundingClientRect();
    const pad = 48;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const k = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((rect.width - pad * 2) / width, (rect.height - pad * 2) / height)),
    );
    state.canvas.viewport = {
      x: rect.width / 2 - ((minX + maxX) / 2) * k,
      y: rect.height / 2 - ((minY + maxY) / 2) * k,
      k,
    };
    applyViewport();
    markDirty({ history: false });
  }

  function startPan(event) {
    const pointerId = capturePointer(event);
    const start = { x: event.clientX, y: event.clientY };
    const origin = { ...state.canvas.viewport };
    let moved = false;
    dom.viewport.classList.add('is-panning');
    const move = (moveEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) moved = true;
      if (!moved) return;
      state.canvas.viewport = { ...state.canvas.viewport, x: origin.x + dx, y: origin.y + dy };
      applyViewport();
    };
    const up = () => {
      releasePointer(pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dom.viewport.classList.remove('is-panning');
      if (moved) markDirty({ history: false });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startBand(event) {
    const pointerId = capturePointer(event);
    const rect = dom.viewport.getBoundingClientRect();
    const band = dom.band;
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;
    band.hidden = false;
    const move = (moveEvent) => {
      const x = Math.min(start.x, moveEvent.clientX) - rect.left;
      const y = Math.min(start.y, moveEvent.clientY) - rect.top;
      const w = Math.abs(moveEvent.clientX - start.x);
      const h = Math.abs(moveEvent.clientY - start.y);
      band.style.left = `${x}px`;
      band.style.top = `${y}px`;
      band.style.width = `${w}px`;
      band.style.height = `${h}px`;
      if (w > DRAG_THRESHOLD || h > DRAG_THRESHOLD) moved = true;
    };
    const up = () => {
      releasePointer(pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const box = band.getBoundingClientRect();
      band.hidden = true;
      if (!moved) return;
      const ids = bandSelection({
        band: {
          left: box.left - rect.left,
          top: box.top - rect.top,
          right: box.right - rect.left,
          bottom: box.bottom - rect.top,
        },
        viewport: state.canvas.viewport,
        nodes: state.canvas.nodes,
      });
      state.selection = ids;
      render();
      if (ids.length) showBanner(`选中 ${ids.length} 个节点`);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startNodeDrag(event, node) {
    const pointerId = capturePointer(event);
    if (!node) return;
    const start = { x: event.clientX, y: event.clientY };
    const scale = state.canvas.viewport.k;
    // Dragging a node that is part of the current selection moves the whole
    // selection; dragging an unselected node moves only that node.
    const selection = state.selection.map((id) => getNode(id)).filter(Boolean);
    const moving = selection.some((item) => item.id === node.id)
      ? selection.filter((item) => item.id !== node.id)
      : [];
    const origins = [{ node, x: node.position.x, y: node.position.y }];
    for (const item of moving) origins.push({ node: item, x: item.position.x, y: item.position.y });
    let moved = false;

    const move = (moveEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) moved = true;
      for (const moved of dragPositions(
        origins.map((origin) => ({ id: origin.node.id, x: origin.x, y: origin.y })),
        dx,
        dy,
        scale,
      )) {
        const origin = origins.find((item) => item.node.id === moved.id);
        if (!origin) continue;
        origin.node.position.x = moved.x;
        origin.node.position.y = moved.y;
        // Move the element in place; rebuilding the tree would drop the caret
        // of any editor the user happens to be typing in.
        const element = dom.nodes.querySelector(`[data-node-id="${moved.id}"]`);
        if (element) {
          element.style.left = `${moved.x}px`;
          element.style.top = `${moved.y}px`;
        }
      }
      renderConnections();
    };
    const up = () => {
      releasePointer(pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      // A drag must not also trigger a click on whatever was under the cursor.
      if (moved) state.suppressClick = true;
      if (moved) markDirty();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startResize(event, node) {
    const pointerId = capturePointer(event);
    if (!node) return;
    const start = { x: event.clientX, y: event.clientY };
    const origin = { w: node.width, h: node.height };
    const scale = state.canvas.viewport.k;
    const move = (moveEvent) => {
      // A card the user sized by hand keeps its width when the media is
      // fitted, so the fit does not fight the resize.
      node.metadata.userSized = true;
      node.width = Math.round(Math.min(1200, Math.max(200, origin.w + (moveEvent.clientX - start.x) / scale)));
      node.height = Math.round(Math.min(2000, Math.max(140, origin.h + (moveEvent.clientY - start.y) / scale)));
      const target = dom.nodes.querySelector(`[data-node-id="${node.id}"]`);
      if (target) {
        target.style.width = `${node.width}px`;
        target.style.height = `${node.height}px`;
      }
      renderConnections();
    };
    const up = () => {
      releasePointer(pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      markDirty();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /**
   * The node picker that opens when a connection is dropped on empty space.
   *
   * The candidates are the node types that can actually take what the source
   * offers, so the choice cannot be a dead end.
   */
  function openNodePicker(fromNodeId, port, clientX, clientY) {
    const source = getNode(fromNodeId);
    if (!source) return;
    const types = downstreamTypesFor(kindOf(source));
    if (!types.length) {
      showBanner('这个节点没有可以接的下游类型。', 'error');
      return;
    }
    closeNodePicker();
    const world = screenToWorld(clientX, clientY);
    const picker = el('div', 'nxc-picker');
    picker.dataset.canvasNoZoom = 'true';
    picker.appendChild(el('div', 'nxc-picker__title', '接一个…'));
    const list = el('div', 'nxc-picker__list');
    for (const type of types) {
      const entry = KIND_ORDER.find((item) => item.role === 'generate' && item.kind === type);
      const button = el('button', 'nxc-picker__item', entry?.label ?? KIND_LABEL[type] ?? type);
      button.type = 'button';
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const node = createNode(type, { x: world.x - 140, y: world.y - 90 });
        state.selection = [node.id];
        // The new node takes what the line carries, so it moves to the mode
        // that takes it. The rule is the shared one, so this lands the same way
        // as a line drawn by hand.
        const linked = connect(fromNodeId, node.id, kindOf(source));
        if (!linked.ok) showBanner(linked.reason, 'error');
        closeNodePicker();
        markDirty();
        render();
      });
      list.appendChild(button);
    }
    picker.appendChild(list);
    document.body.appendChild(picker);
    // The picker opens where the pointer is, so it has to be measured first:
    // a link dropped near the right edge would open the picker off screen.
    const pickerPlace = placeOverlay(
      { left: clientX, top: clientY },
      picker.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    );
    picker.style.left = `${pickerPlace.left}px`;
    picker.style.top = `${pickerPlace.top}px`;
    state.picker = picker;
    window.setTimeout(() => {
      const close = (event) => {
        if (picker.contains(event.target)) return;
        closeNodePicker();
        window.removeEventListener('pointerdown', close, true);
      };
      window.addEventListener('pointerdown', close, true);
    }, 0);
  }

  /**
   * Create the input node an empty drop on an input port asks for.
   *
   * The node takes the kind the port was for, so an image slot gets an image
   * input and a text slot gets a text input.
   */
  function createInputAt(targetNodeId, kind, clientX, clientY) {
    const world = screenToWorld(clientX, clientY);
    const node = createNode(
      'input',
      { x: world.x - 140, y: world.y - 90 },
      { title: '输入', kind },
    );
    state.selection = [node.id];
    // The line lands on the port it was dropped on, so the node takes it. The
    // rule is the shared one, so it lands the same way as any other line.
    const linked = connect(node.id, targetNodeId, kind);
    if (!linked.ok) showBanner(linked.reason, 'error');
    markDirty();
    render();
    return node;
  }

  function closeNodePicker() {
    if (state.picker) {
      state.picker.remove();
      state.picker = null;
    }
  }

  // The kinds of node that can take what this upstream offers.
  //
  // The palette names the ways to run; the board shows the kinds, and a music
  // run is an audio node in its music mode.
  function downstreamTypesFor(upstreamKind) {
    const accepts = state.palette?.upstreamAccepts?.[upstreamKind] ?? [];
    const kinds = new Set();
    for (const mode of accepts) {
      if (!state.palette?.modes?.[mode]) continue;
      kinds.add(mode === 'music' ? 'audio' : mode);
    }
    return [...kinds];
  }

  function startConnectionDrag(event, fromNodeId, port, portKind = 'text', portEl = null) {
    const pointerId = capturePointer(event);
    const source = getNode(fromNodeId);
    if (!source) return;
    // The port that was grabbed, and the role it carries. A mode that takes
    // the same kind twice has a port for each, so the line says which one it
    // is from the moment it is drawn.
    const grabbedRole = portEl?.dataset.role ?? '';
    const ns = 'http://www.w3.org/2000/svg';
    const draft = document.createElementNS(ns, 'path');
    draft.setAttribute('class', 'nxc-connection--draft');
    dom.connections.appendChild(draft);
    dom.viewport.classList.add('is-connecting');
    // The line starts on the port that was grabbed, not in the middle of the
    // node: a node with several input ports has one line per port.
    const origin = portEl
      ? portPointOfEl(portEl, port)
      : portPointOf(source, port, port === 'in' ? portKind : '');

    const move = (moveEvent) => {
      const world = screenToWorld(moveEvent.clientX, moveEvent.clientY);
      const x1 = origin.x;
      const y1 = origin.y;
      const dx = Math.min(180, Math.max(40, Math.abs(world.x - x1) * 0.5));
      draft.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${world.x - dx} ${world.y}, ${world.x} ${world.y}`);
      state.snapNodeId = null;
      let best = null;
      let bestDistance = SNAP_SCREEN_PX;
      for (const node of state.canvas.nodes) {
        if (node.id === fromNodeId) continue;
        const center = {
          x: node.position.x + (port === 'in' ? 0 : node.width),
          y: node.position.y + node.height / 2,
        };
        const screen = {
          x: center.x * state.canvas.viewport.k + state.canvas.viewport.x,
          y: center.y * state.canvas.viewport.k + state.canvas.viewport.y,
        };
        const distance = Math.hypot(screen.x - moveEvent.clientX, screen.y - moveEvent.clientY);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = node.id;
        }
      }
      state.snapNodeId = best;
      renderNodes();
    };

    const up = (upEvent) => {
      releasePointer(pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dom.viewport.classList.remove('is-connecting');
      draft.remove();
      state.snapNodeId = null;
      const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      const nodeEl = target?.closest?.('.nxc-node');
      const toId = nodeEl?.dataset.nodeId;
      if (!toId || toId === fromNodeId) {
        if (!toId) {
          if (port === 'in') {
            // Pulled from an input port into empty space: the input node that
            // slot needs is created there and wired up.
            createInputAt(fromNodeId, portKind, upEvent.clientX, upEvent.clientY);
          } else {
            // Dropped on empty space: offer the node types that fit here.
            openNodePicker(fromNodeId, port, upEvent.clientX, upEvent.clientY);
          }
        }
        render();
        return;
      }
      const targetNode = getNode(toId);
      const sourceNode = getNode(fromNodeId);
      // The line carries what it carries, so the port can be picked on both
      // ends.
      const kind = port === 'out' ? kindOf(sourceNode) : kindOf(targetNode);
      // The port it lands on: the one under the pointer when the line was
      // dropped on it, and the one that was grabbed when the line was pulled
      // out of it.
      const droppedPort = target?.closest?.('[data-port="in"]');
      const role = port === 'out' ? (droppedPort?.dataset.role ?? '') : grabbedRole;
      const result = port === 'out'
        ? connect(fromNodeId, toId, kind, { role })
        : connect(toId, fromNodeId, kind, { role: grabbedRole });
      if (!result.ok) showBanner(`无法连接：${result.reason}`, 'error');
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------- toolbar

  function bindToolbar() {
    dom.canvasSelect.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openCanvasDropdown();
    });
    dom.newButton.addEventListener('click', () => {
      // No native dialog: a prompt() is a separate OS window that never
      // reaches the screen inside the MiniApp host, so asking there left
      // the button doing nothing at all. The name is typed into the page
      // instead, right after the canvas is made.
      void createCanvas(nextCanvasTitle());
    });
    dom.renameButton.addEventListener('click', () => {
      startRename(state.canvas.title || '未命名画布');
    });
    // The name is typed into the page: Enter keeps it, Escape leaves it as it
    // was, and leaving the field keeps it too.
    dom.canvasRename?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitRename();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        dom.canvasRename.hidden = true;
        dom.canvasSelect.hidden = false;
      }
    });
    dom.canvasRename?.addEventListener('blur', () => {
      commitRename();
    });
    dom.confirmOk?.addEventListener('click', () => {
      closeConfirm(true);
    });
    dom.confirmCancel?.addEventListener('click', () => {
      closeConfirm(false);
    });
    dom.templatesButton.addEventListener('click', () => {
      void openTemplatePanel(dom.templatesButton.getBoundingClientRect());
    });
    dom.deleteButton.addEventListener('click', () => {
      void deleteCanvas();
    });
    dom.addButton.addEventListener('click', () => {
      const rect = dom.addButton.getBoundingClientRect();
      showMenu(dom.addMenu, rect.left, rect.bottom + 6, kindMenuItems());
    });
    dom.undoButton.addEventListener('click', undo);
    dom.redoButton.addEventListener('click', redo);
    dom.capsButton.addEventListener('click', async () => {
      // The grant of the connector tools is read now, not at boot: the Host's
      // inventory is not complete right after the runtime starts, and a list
      // read then would say a tool is missing while it works.
      await loadPalette();
      openPanel('caps', dom.capsButton.getBoundingClientRect());
    });
    dom.toolsButton.addEventListener('click', () => {
      openToolMenu(dom.toolsButton.getBoundingClientRect());
    });
    dom.libraryButton.addEventListener('click', () => {
      void openLibraryPanel(dom.libraryButton.getBoundingClientRect());
    });
    dom.minimapButton.addEventListener('click', () => {
      state.minimap = !state.minimap;
      dom.minimap.hidden = !state.minimap;
      dom.minimapButton.textContent = state.minimap ? '小地图：开' : '小地图';
      renderMinimap();
    });
    dom.resetButton.addEventListener('click', resetView);
    dom.gridButton.addEventListener('click', () => {
      state.canvas.backgroundMode = state.canvas.backgroundMode === 'dots' ? 'lines' : 'dots';
      markDirty();
      applyViewport();
      renderToolbar();
    });
    dom.themeButton.addEventListener('click', cycleTheme);

    const win = window.mcode?.miniapp?.window;
    if (win?.update) {
      dom.popoutButton.hidden = false;
      dom.popoutButton.addEventListener('click', () => {
        void win.update({ mode: 'window', width: 1280, height: 820 }).catch(() => {
          showBanner('无法打开独立窗口。', 'error');
        });
      });
    }
  }

  // ---------------------------------------------------------------- bootstrap

  async function boot() {
    dom.viewport = $('viewport');
    dom.grid = $('grid');
    dom.world = $('world');
    dom.nodes = $('nodes');
    dom.connections = $('connections');
    dom.band = $('band');
    dom.minimap = $('minimap');
    dom.taskPanel = $('task-panel');
    dom.emptyHint = $('empty-hint');
    dom.zoom = $('zoom');
    dom.saveState = $('save-state');
    dom.buildBadge = $('build-badge');
    dom.canvasSelect = $('canvas-select');
    dom.canvasRename = $('canvas-rename');
    dom.contextMenu = $('context-menu');
    dom.addMenu = $('add-menu');
    dom.mentionMenu = $('mention-menu');
    dom.dropdownMenu = $('dropdown-menu');
    dom.floatingPanel = $('floating-panel');
    dom.confirmDialog = $('confirm-dialog');
    dom.confirmText = $('confirm-text');
    dom.confirmOk = $('confirm-ok');
    dom.confirmCancel = $('confirm-cancel');
    dom.newButton = $('btn-new');
    dom.renameButton = $('btn-rename');
    dom.templatesButton = $('btn-templates');
    dom.deleteButton = $('btn-delete');
    dom.addButton = $('btn-add');
    dom.undoButton = $('btn-undo');
    dom.redoButton = $('btn-redo');
    dom.capsButton = $('btn-caps');
    dom.toolsButton = $('btn-tools');
    dom.libraryButton = $('btn-library');
    dom.minimapButton = $('btn-minimap');
    dom.resetButton = $('btn-reset');
    dom.gridButton = $('btn-grid');
    dom.themeButton = $('btn-theme');
    dom.popoutButton = $('btn-popout');

    bindInteractions();
    bindToolbar();
    loadTheme();
    render();

    // A tab the user does not show has its timers throttled by the browser,
    // so the page can fall behind. It lets the canvas go when it is hidden
    // for good, and it takes it back — and reads the stored one — when it
    // comes back.
    window.addEventListener('pagehide', () => {
      // The canvas saves itself, but the last change may still be waiting for
      // the timer. The draft is written right here, and it is written in one
      // go, so a change made a moment before the window closed is still there
      // when the canvas is opened again.
      saveDraft();
      void saveCanvas();
      releaseCanvas(state.canvas.id);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void resyncCanvas('stale');
      // A window that is hidden may never come back. The draft goes with it.
      if (document.visibilityState === 'hidden') saveDraft();
    });

    void syncBuild();
    await loadPalette();
    await loadMediaStatus();
    void loadVoices();
    await refreshCanvasList();

    if (state.canvases.length > 0) await openCanvas(state.canvases[0].id);
    else await createCanvas('我的第一个画布');
    await reattachRuns();

    if (!state.agentAvailable) showBanner('当前客户端未授予 Agent 访问权限，生成功能不可用。', 'error');
  }

  void boot();
})();






