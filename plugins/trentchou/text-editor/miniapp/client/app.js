// Text editor Mini App client: Sublime-style workbench on top of CodeMirror 6.
// Buffers are owned by the Node service (CodeMirror collab authority), so the Agent's MCP edits
// and the user's typing merge into the same document.
import * as CM from './vendor/codemirror.js';
import { LANGUAGES, languageById, detectLanguage, detectIndent } from './languages.js';
import { darkTheme, lightTheme, highlight } from './themes.js';

const { state: S, view: V, commands: C, language: L, search: Q, autocomplete: A, collab: CB } = CM;

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// Code font stacks mirror MiniMax Code's appearance options (Settings → Appearance → Code font).
// JetBrains Mono is served by this Mini App (fonts/jetbrains-mono.css) because MiniMax Code's bundled copy
// is not visible to Mini App pages.
const FONT_STACKS = {
  system: 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  menlo: 'Menlo, Monaco, "Courier New", monospace',
  'jetbrains-mono': '"JetBrains Mono Variable", "JetBrains Mono", "SFMono-Regular", Consolas, ui-monospace, monospace',
};
const DEFAULT_MONO = FONT_STACKS.system;
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
const LARGE_DOC = 2_000_000;

const $ = (selector) => document.querySelector(selector);
const tabsEl = $('#tabs');
const treeEl = $('#tree');
const editorEl = $('#editor');
const welcomeEl = $('#welcome');
const paletteEl = $('#palette');
const paletteInput = $('#palette-input');
const paletteList = $('#palette-list');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- icons -------------------------------------------------------------------------------------

const svg = (body, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  file: svg('<path d="M4 1.75h5l3.25 3.25v9.25H4z"/><path d="M9 1.75V5h3.25"/>', 14),
  folder: svg('<path d="M1.75 3.25h4.5l1.5 1.5h6.5v8.5H1.75z"/>', 14),
  newFile: svg('<path d="M4 1.75h5l3.25 3.25v9.25H4z"/><path d="M9 1.75V5h3.25"/><path d="M8.1 7.5v4.5M5.85 9.75h4.5"/>'),
  newFolder: svg('<path d="M1.75 3.25h4.5l1.5 1.5h6.5v8.5H1.75z"/><path d="M8 6.75v4.5M5.75 9h4.5"/>'),
  addFolder: svg('<path d="M1.75 3.25h4.5l1.5 1.5h6.5v8.5H1.75z"/><path d="M5.5 9h5M8.75 7l1.75 2-1.75 2"/>'),
  refresh: svg('<path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71"/><path d="M13.25 2.5v3h-3"/>'),
  command: svg('<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="m4.75 6.25 2 1.75-2 1.75M8.5 10h2.75"/>'),
  settings: svg('<path d="M2.25 4.5h7.5M12.75 4.5h1M2.25 11.5h1M6.25 11.5h7.5"/><circle cx="11.25" cy="4.5" r="1.5"/><circle cx="4.75" cy="11.5" r="1.5"/>'),
  close: svg('<path d="m4.75 4.75 6.5 6.5m0-6.5-6.5 6.5"/>', 14),
  chevron: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2 6.5 5l-3 3"/></svg>',
  chevronDown: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5 5 6.5l3-3"/></svg>',
  dot: '<svg class="dot" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="3.5" fill="currentColor"/></svg>',
};
const CMD_ICONS = {
  'file.new': ICONS.newFile, 'file.newFolder': ICONS.newFolder, 'folder.add': ICONS.addFolder,
  'tree.refresh': ICONS.refresh, 'palette.commands': ICONS.command, prefs: ICONS.settings,
};

// ---- small helpers -----------------------------------------------------------------------------

const sepIndex = (p) => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
const baseName = (p) => p.slice(sepIndex(p) + 1) || p;
const dirName = (p) => {
  const i = sepIndex(p);
  return i <= 0 ? p.slice(0, i + 1) || p : p.slice(0, i);
};
const joinPath = (dir, name) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const error = new Error('无法连接编辑器服务');
    error.code = 'NETWORK';
    throw error;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new Error(data?.error?.message ?? `请求失败（${res.status}）`);
    error.code = data?.error?.code ?? `HTTP_${res.status}`;
    throw error;
  }
  return data;
}
const get = (path, params) => api('GET', `${path}?${new URLSearchParams(params)}`);
const post = (path, body = {}) => api('POST', path, body);

// ---- app state ---------------------------------------------------------------------------------

const app = {
  settings: null,
  folders: [],
  tabs: [],
  tabStatus: new Map(),
  active: null,
  requestedActive: null,
  requestedAt: 0,
  tree: new Map(),
  treeFocus: null,
  index: new Map(),
  lastUserEdit: 0,
  everConnected: false,
  chord: null,
  chordTimer: null,
  langOverride: new Map(),
  indentOverride: new Map(),
  highlightTotal: 0,
};
/** path → { path, state, loading, scroll, size, langId, detectedIndent, eol, bom, closed, pushing, pushTimer, pulling } */
const docs = new Map();
let current = null;

function folderOf(path) {
  let best = null;
  for (const f of app.folders) {
    if ((path === f.path || path.startsWith(`${f.path}/`)) && (!best || f.path.length > best.path.length)) best = f;
  }
  return best;
}

function displayPath(path) {
  const f = folderOf(path);
  if (!f) return path;
  const rel = path.slice(f.path.length + 1);
  return rel ? `${f.name}/${rel}` : f.name;
}

const stateOf = (doc) => (doc === current ? view.state : doc.state);

function isDirty(path) {
  if (app.tabStatus.get(path)?.dirty) return true;
  const doc = docs.get(path);
  const st = doc && (doc === current || doc.state) ? stateOf(doc) : null;
  return !!st && CB.sendableUpdates(st).length > 0;
}

// ---- toasts and status -------------------------------------------------------------------------

function toast(message, level = 'info', action) {
  const host = level === 'error' ? $('#alerts') : $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${level}`;
  el.textContent = message;
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      el.remove();
      action.run();
    });
    el.append(button);
  }
  host.append(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  setTimeout(() => el.remove(), level === 'error' ? 7000 : 4500);
}
const showError = (error) => toast(error?.message ?? String(error), 'error');

let flashTimer = null;
function flash(message) {
  const el = $('#st-message');
  el.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    el.textContent = '';
  }, 4000);
}

// ---- editor configuration ----------------------------------------------------------------------

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const themeName = () => {
  const t = app.settings?.theme ?? 'system';
  return t === 'system' ? (darkQuery.matches ? 'dark' : 'light') : t;
};

// ---- agent highlights --------------------------------------------------------------------------
// Overlays added through the Agent's highlight_code tool; they never change the document. The service owns
// the list (it drops highlights whose code was edited unless the user keeps them); this field only maps
// positions through edits between service events.

const setHighlights = S.StateEffect.define();
const HIGHLIGHT_LABELS = { info: '说明', warning: '注意', error: '问题', success: '良好' };

class HighlightNote extends V.WidgetType {
  constructor(item) {
    super();
    this.item = item;
  }

  eq(other) {
    return other.item.id === this.item.id && other.item.kind === this.item.kind && other.item.note === this.item.note;
  }

  toDOM() {
    // CodeMirror measures block widgets without their margins, so spacing lives in this wrapper's
    // padding; margins here would shift the line-number gutter below every note.
    const el = document.createElement('div');
    el.className = 'cm-agent-note';
    const card = document.createElement('div');
    card.className = `cm-agent-note-card hl-${this.item.kind}`;
    const kind = document.createElement('div');
    kind.className = 'cm-agent-note-kind';
    kind.textContent = `Agent · ${HIGHLIGHT_LABELS[this.item.kind] ?? HIGHLIGHT_LABELS.info}`;
    const text = document.createElement('div');
    text.className = 'cm-agent-note-text';
    text.textContent = this.item.note;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cm-agent-note-close';
    close.title = '移除这个高亮';
    close.setAttribute('aria-label', '移除这个高亮');
    close.innerHTML = ICONS.close;
    close.addEventListener('click', () => void removeHighlights({ ids: [this.item.id] }));
    card.append(kind, text, close);
    el.append(card);
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

function highlightDeco(doc, items) {
  const ranges = [];
  for (const h of items) {
    if (h.from < 0 || h.to > doc.length || h.to < h.from) continue;
    const kind = `hl-${h.kind}`;
    const first = doc.lineAt(h.from);
    const last = doc.lineAt(h.lines ? h.to : Math.max(h.from, h.to - 1));
    if (h.lines) {
      for (let n = first.number; n <= last.number; n++) {
        const edges = `${n === first.number ? ' cm-agent-line-first' : ''}${n === last.number ? ' cm-agent-line-last' : ''}`;
        ranges.push(V.Decoration.line({ class: `cm-agent-line ${kind}${edges}` }).range(doc.line(n).from));
      }
    } else if (h.to > h.from) {
      ranges.push(V.Decoration.mark({ class: `cm-agent-mark ${kind}` }).range(h.from, h.to));
    }
    if (h.note) ranges.push(V.Decoration.widget({ widget: new HighlightNote(h), block: true, side: 1 }).range(last.to));
  }
  return V.Decoration.set(ranges, true);
}

/** Same mapping rule as the service, so both sides agree between events. */
function mapHighlight(h, changes) {
  const from = changes.mapPos(h.from, 1);
  const to = Math.max(from, changes.mapPos(h.to, -1));
  return h.to > h.from && to === from ? null : { ...h, from, to };
}

const highlightField = S.StateField.define({
  create: () => ({ items: [], deco: V.Decoration.none }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlights)) return { items: effect.value, deco: highlightDeco(tr.state.doc, effect.value) };
    }
    if (!tr.docChanged || !value.items.length) return value;
    const items = value.items.map((h) => mapHighlight(h, tr.changes)).filter(Boolean);
    return { items, deco: highlightDeco(tr.state.doc, items) };
  },
});
const highlightsOf = (st) => st?.field(highlightField, false)?.items ?? [];

// Notes are sticky so they stay readable when a long line scrolls the editor sideways; they must stop
// right of the (also sticky) gutters, whose width changes with the line count.
const noteOffset = V.ViewPlugin.fromClass(class {
  constructor(view) {
    this.width = -1;
    this.measure(view);
  }

  update(update) {
    if (update.geometryChanged) this.measure(update.view);
  }

  measure(view) {
    view.requestMeasure({
      read: () => view.dom.querySelector('.cm-gutters')?.getBoundingClientRect().width ?? 0,
      write: (width) => {
        if (width === this.width) return;
        this.width = width;
        view.dom.style.setProperty('--agent-note-left', `${width}px`);
      },
    });
  }
});

const comp = {
  lang: new S.Compartment(),
  theme: new S.Compartment(),
  indent: new S.Compartment(),
  wrap: new S.Compartment(),
  minimap: new S.Compartment(),
  guides: new S.Compartment(),
  whitespace: new S.Compartment(),
  lineNumbers: new S.Compartment(),
  highlights: new S.Compartment(),
};

function indentFor(doc) {
  const o = app.indentOverride.get(doc.path) ?? doc.detectedIndent;
  return { insertSpaces: o?.insertSpaces ?? app.settings.insertSpaces, size: o?.size ?? app.settings.tabSize };
}

const extFor = {
  theme: () => (themeName() === 'dark' ? darkTheme : lightTheme),
  indent: (doc) => {
    const { insertSpaces, size } = indentFor(doc);
    return [S.EditorState.tabSize.of(size), L.indentUnit.of(insertSpaces ? ' '.repeat(size) : '\t')];
  },
  wrap: () => (app.settings.wordWrap ? V.EditorView.lineWrapping : []),
  minimap: (doc) =>
    app.settings.minimap && doc.size <= LARGE_DOC
      ? CM.showMinimap.of({ create: () => ({ dom: document.createElement('div') }), displayText: 'blocks', showOverlay: 'always' })
      : [],
  guides: () =>
    app.settings.indentGuides
      ? CM.indentationMarkers({
        highlightActiveBlock: true,
        markerType: 'fullScope',
        thickness: 1,
        colors: { light: 'var(--ed-guide)', dark: 'var(--ed-guide)', activeLight: 'var(--ed-guide-active)', activeDark: 'var(--ed-guide-active)' },
      })
      : [],
  whitespace: () => (app.settings.showWhitespace ? [V.highlightWhitespace(), V.highlightTrailingWhitespace()] : []),
  lineNumbers: () => (app.settings.lineNumbers ? V.lineNumbers() : []),
  // Hiding only removes the decorations; the field keeps tracking the highlights.
  highlights: () => (app.settings.highlightsVisible !== false ? [V.EditorView.decorations.from(highlightField, (v) => v.deco), noteOffset] : []),
};

const settingsEffects = (doc) => Object.keys(extFor).map((key) => comp[key].reconfigure(extFor[key](doc)));

function foldMarker(open) {
  const el = document.createElement('span');
  el.className = 'fold-marker';
  el.innerHTML = open ? ICONS.chevronDown : ICONS.chevron;
  el.title = open ? '折叠' : '展开';
  return el;
}

function splitSelectionByLine(target) {
  const { state } = target;
  const ranges = [];
  for (const r of state.selection.ranges) {
    if (r.empty) {
      ranges.push(r);
      continue;
    }
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      const from = Math.max(line.from, r.from);
      const to = Math.min(line.to, r.to);
      if (n === last && n !== first && to === line.from) continue;
      ranges.push(S.EditorSelection.range(from, to));
    }
  }
  if (ranges.length < 2) return false;
  target.dispatch({ selection: S.EditorSelection.create(ranges, ranges.length - 1) });
  return true;
}

function insertLineBefore(target) {
  const { state } = target;
  target.dispatch(
    state.changeByRange((range) => {
      const line = state.doc.lineAt(range.head);
      const indent = /^\s*/.exec(line.text)[0];
      return { changes: { from: line.from, insert: `${indent}\n` }, range: S.EditorSelection.cursor(line.from + indent.length) };
    }),
    { scrollIntoView: true, userEvent: 'input' },
  );
  return true;
}

const sublimeKeymap = [
  { key: 'Mod-d', run: Q.selectNextOccurrence, preventDefault: true },
  { key: 'Mod-Shift-l', run: splitSelectionByLine, preventDefault: true },
  { key: 'Mod-l', run: C.selectLine, preventDefault: true },
  { key: 'Mod-Shift-k', run: C.deleteLine, preventDefault: true },
  { key: 'Mod-Shift-d', run: C.copyLineDown, preventDefault: true },
  { mac: 'Ctrl-Cmd-ArrowUp', key: 'Ctrl-Shift-ArrowUp', run: C.moveLineUp, preventDefault: true },
  { mac: 'Ctrl-Cmd-ArrowDown', key: 'Ctrl-Shift-ArrowDown', run: C.moveLineDown, preventDefault: true },
  { key: 'Mod-Shift-Enter', run: insertLineBefore, preventDefault: true },
  { key: 'Mod-Alt-f', run: Q.openSearchPanel, preventDefault: true },
  { mac: 'Ctrl-Cmd-g', key: 'Alt-F3', run: Q.selectSelectionMatches, preventDefault: true },
  { key: 'Ctrl-m', run: C.cursorMatchingBracket },
];

function createDocState(doc, text, version, highlights = []) {
  return S.EditorState.create({
    doc: text,
    extensions: [
      comp.lineNumbers.of(extFor.lineNumbers()),
      L.foldGutter({ markerDOM: foldMarker }),
      V.highlightActiveLineGutter(),
      V.highlightSpecialChars(),
      C.history(),
      V.drawSelection(),
      V.dropCursor(),
      S.EditorState.allowMultipleSelections.of(true),
      L.indentOnInput(),
      L.syntaxHighlighting(highlight),
      L.bracketMatching(),
      A.closeBrackets(),
      A.autocompletion(),
      S.EditorState.languageData.of(() => [{ autocomplete: A.completeAnyWord }]),
      V.rectangularSelection(),
      V.crosshairCursor(),
      V.highlightActiveLine(),
      Q.highlightSelectionMatches(),
      Q.search({ top: true }),
      V.keymap.of([
        ...sublimeKeymap, ...A.closeBracketsKeymap, ...C.defaultKeymap, ...Q.searchKeymap,
        ...C.historyKeymap, ...L.foldKeymap, ...A.completionKeymap, C.indentWithTab,
      ]),
      comp.lang.of(languageById(doc.langId).load()),
      comp.theme.of(extFor.theme()),
      comp.indent.of(extFor.indent(doc)),
      comp.wrap.of(extFor.wrap()),
      comp.minimap.of(extFor.minimap(doc)),
      comp.guides.of(extFor.guides()),
      comp.whitespace.of(extFor.whitespace()),
      highlightField.init((state) => ({ items: highlights, deco: highlightDeco(state.doc, highlights) })),
      comp.highlights.of(extFor.highlights()),
      V.EditorView.contentAttributes.of({ 'aria-label': `编辑 ${baseName(doc.path)}` }),
      // Dropped files become new files (handled at window level) instead of being inserted as text.
      V.EditorView.domEventHandlers({ drop: (event) => !!event.dataTransfer?.files?.length }),
      CB.collab({ startVersion: version }),
      V.EditorView.updateListener.of((update) => onEditorUpdate(doc, update)),
    ],
  });
}

const view = new V.EditorView({ parent: editorEl });

function reconfigureAll() {
  for (const doc of docs.values()) {
    if (doc === current) view.dispatch({ effects: settingsEffects(doc) });
    else if (doc.state) doc.state = doc.state.update({ effects: settingsEffects(doc) }).state;
  }
  updateStatusBar();
}

function reconfigureDoc(doc, key) {
  const effects = comp[key].reconfigure(key === 'lang' ? languageById(doc.langId).load() : extFor[key](doc));
  if (doc === current) view.dispatch({ effects });
  else if (doc.state) doc.state = doc.state.update({ effects }).state;
  updateStatusBar();
}

function applyChrome() {
  const s = app.settings;
  const root = document.documentElement;
  root.dataset.theme = themeName();
  const font = s.codeFont === 'custom' ? (s.fontFamily ? `${s.fontFamily}, ${DEFAULT_MONO}` : DEFAULT_MONO) : FONT_STACKS[s.codeFont] ?? DEFAULT_MONO;
  root.style.setProperty('--ed-font', font);
  root.style.setProperty('--ed-font-size', `${s.fontSize}px`);
  root.style.setProperty('--ed-line-height', String(s.lineHeight));
  root.style.setProperty('--sidebar-width', `${s.sidebarWidth}px`);
  $('#app').classList.toggle('sidebar-hidden', !s.sidebarVisible);
  const resizer = $('#resizer');
  resizer.setAttribute('aria-valuenow', String(s.sidebarWidth));
  resizer.setAttribute('aria-valuemin', '160');
  resizer.setAttribute('aria-valuemax', '640');
  view.requestMeasure();
}

darkQuery.addEventListener('change', () => {
  if (app.settings?.theme !== 'system') return;
  applyChrome();
  reconfigureAll();
});

async function updateSettings(patch) {
  const previous = app.settings;
  app.settings = { ...app.settings, ...patch };
  applyChrome();
  reconfigureAll();
  try {
    await post('/api/settings', { patch });
  } catch (error) {
    app.settings = previous;
    applyChrome();
    reconfigureAll();
    showError(error);
  }
}

const toggleSetting = (key) => updateSettings({ [key]: !app.settings[key] });
const changeFont = (delta) => updateSettings({ fontSize: clamp(app.settings.fontSize + delta, 8, 40) });

// ---- document sync (CodeMirror collab) ---------------------------------------------------------

function onEditorUpdate(doc, update) {
  if (doc !== current) return;
  if (update.docChanged) {
    if (update.transactions.some((tr) => tr.docChanged && !tr.annotation(S.Transaction.remote))) {
      app.lastUserEdit = Date.now();
      schedulePush(doc);
    }
    renderTabStatus(doc.path);
  }
  if (update.docChanged || update.selectionSet) {
    updateStatusBar();
    scheduleViewReport();
  }
}

const fromWire = (u) => ({ clientID: u.clientID, changes: S.ChangeSet.fromJSON(u.changes) });

function schedulePush(doc) {
  if (doc.pushTimer) return;
  doc.pushTimer = setTimeout(() => {
    doc.pushTimer = null;
    void pushDoc(doc);
  }, 30);
}

function pushDoc(doc) {
  if (doc.pushing) {
    doc.pushAgain = true;
    return doc.pushing;
  }
  doc.pushing = (async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (doc.closed || !doc.state) return;
      const st = stateOf(doc);
      const updates = CB.sendableUpdates(st);
      if (!updates.length) return;
      const version = CB.getSyncedVersion(st);
      let res;
      try {
        res = await post('/api/doc/push', {
          path: doc.path,
          version,
          updates: updates.map((u) => ({ clientID: u.clientID, changes: u.changes.toJSON() })),
        });
      } catch (error) {
        if (error.code === 'DESYNC' || error.code === 'NOT_OPEN') {
          await reloadDoc(doc, '编辑器服务的文档状态已变化，已重新加载该文件');
          return;
        }
        await sleep(1000);
        continue;
      }
      if (res.ok) applyRemote(doc, version, updates.map((u) => ({ clientID: u.clientID, changes: u.changes })));
      else await pullDoc(doc);
    }
  })().finally(() => {
    doc.pushing = null;
    if (doc.pushAgain) {
      doc.pushAgain = false;
      schedulePush(doc);
    }
  });
  return doc.pushing;
}

async function flushPush(doc) {
  for (let i = 0; i < 60; i++) {
    if (!doc.state || doc.closed) return true;
    if (!CB.sendableUpdates(stateOf(doc)).length) return true;
    await pushDoc(doc);
    if (i > 3) await sleep(100);
  }
  return false;
}

function applyRemote(doc, version, updates) {
  if (!doc.state || doc.closed) return;
  const st = stateOf(doc);
  const synced = CB.getSyncedVersion(st);
  if (version > synced) {
    void pullDoc(doc);
    return;
  }
  const fresh = updates.slice(synced - version);
  if (!fresh.length) return;
  const tr = CB.receiveUpdates(st, fresh);
  if (doc === current) view.dispatch(tr);
  else doc.state = tr.state;
  renderTabStatus(doc.path);
  const pending = doc.pendingHighlights;
  if (pending && pending.version <= CB.getSyncedVersion(stateOf(doc))) receiveHighlights(doc, pending.version, pending.items);
}

/** A highlight list from the service is at its document version; unconfirmed local edits are mapped on top. */
function receiveHighlights(doc, version, items, refetch = true) {
  if (doc.closed) return;
  const st = doc.state ? stateOf(doc) : null;
  const synced = st ? CB.getSyncedVersion(st) : -1;
  if (!st || version > synced) {
    doc.pendingHighlights = { version, items }; // applied once the document catches up (applyRemote / load)
    return;
  }
  doc.pendingHighlights = null;
  if (version < synced) {
    // Our own edits were confirmed before this event arrived; ask for the list at the current version.
    if (refetch) get('/api/highlights', { path: doc.path }).then((res) => receiveHighlights(doc, res.version, res.items, false)).catch(() => undefined);
    return;
  }
  const unconfirmed = CB.sendableUpdates(st);
  const changes = unconfirmed.length ? unconfirmed.map((u) => u.changes).reduce((a, b) => a.compose(b)) : null;
  const effects = setHighlights.of(changes ? items.map((h) => mapHighlight(h, changes)).filter(Boolean) : items);
  if (doc === current) {
    view.dispatch({ effects });
    renderHighlightStatus();
  } else {
    doc.state = doc.state.update({ effects }).state;
  }
}

/** A freshly loaded document already carries the list at its version; drop events it supersedes. */
function settlePendingHighlights(doc, version) {
  if (doc.pendingHighlights && doc.pendingHighlights.version <= version) doc.pendingHighlights = null;
}

function pullDoc(doc) {
  if (doc.pulling) return doc.pulling;
  doc.pulling = (async () => {
    if (!doc.state || doc.closed) return;
    const version = CB.getSyncedVersion(stateOf(doc));
    const res = await get('/api/doc/pull', { path: doc.path, version });
    if (res.reset) await reloadDoc(doc, '编辑器服务已重启，已重新加载该文件');
    else applyRemote(doc, res.version, res.updates.map(fromWire));
  })()
    .catch(() => undefined)
    .finally(() => {
      doc.pulling = null;
    });
  return doc.pulling;
}

async function reloadDoc(doc, message) {
  try {
    const res = await post('/api/doc/open', { path: doc.path, tab: false });
    if (doc.closed) return;
    doc.size = res.text.length;
    doc.eol = res.eol;
    doc.bom = res.bom;
    setTabStatus(doc.path, res);
    doc.state = createDocState(doc, res.text, res.version, res.highlights);
    settlePendingHighlights(doc, res.version);
    if (doc === current) view.setState(doc.state);
    if (message) toast(message, 'warn');
  } catch (error) {
    showError(error);
  }
}

async function ensureDoc(path, { focus = false } = {}) {
  let doc = docs.get(path);
  if (doc?.state) return doc;
  if (doc?.loading) return doc.loading;
  doc = { path, state: null, loading: null, scroll: null, size: 0, langId: null, detectedIndent: null, eol: 'LF', bom: false, closed: false };
  docs.set(path, doc);
  const loading = (async () => {
    const res = await post('/api/doc/open', { path, tab: true, focus });
    doc.size = res.text.length;
    doc.eol = res.eol;
    doc.bom = res.bom;
    doc.langId = app.langOverride.get(path) ?? detectLanguage(path, res.text.slice(0, 200));
    doc.detectedIndent = detectIndent(res.text.slice(0, 200_000));
    setTabStatus(path, res);
    doc.state = createDocState(doc, res.text, res.version, res.highlights);
    settlePendingHighlights(doc, res.version);
    return doc;
  })();
  doc.loading = loading;
  try {
    return await loading;
  } catch (error) {
    if (docs.get(path) === doc) docs.delete(path);
    throw error;
  } finally {
    doc.loading = null;
  }
}

// ---- tabs and activation -----------------------------------------------------------------------

let activationSeq = 0;

async function activate(path, { report = true, focus = true, line = null } = {}) {
  const seq = ++activationSeq;
  if (report) {
    app.requestedActive = path;
    app.requestedAt = Date.now();
  }
  try {
    let doc;
    try {
      doc = await ensureDoc(path, { focus: report });
    } catch (error) {
      if (seq === activationSeq) showOpenError(path, error);
      return;
    }
    if (seq !== activationSeq || doc.closed) return;
    if (current !== doc) {
      if (current && !current.closed) {
        current.state = view.state;
        current.scroll = view.scrollSnapshot();
      }
      current = doc;
      view.setState(doc.state);
      if (doc.scroll) view.dispatch({ effects: doc.scroll });
    }
    showEditor();
    if (line) gotoLine(line, focus);
    renderTabs();
    updateStatusBar();
    renderBanner();
    markTreeActive();
    if (focus) view.focus();
    if (report && app.active !== path) {
      app.active = path;
      await post('/api/tabs/activate', { path }).catch(showError);
    }
  } finally {
    if (seq === activationSeq && report) app.requestedActive = null;
  }
}

function setTabStatus(path, s) {
  app.tabStatus.set(path, { dirty: !!s.dirty, diskChanged: !!s.diskChanged, deleted: !!s.deleted });
  renderTabStatus(path);
  if (current?.path === path) renderBanner();
}

function tabLabel(path) {
  const name = baseName(path);
  const twins = app.tabs.filter((p) => p !== path && baseName(p) === name);
  return twins.length ? `${name} — ${baseName(dirName(path))}` : name;
}

function renderTabs() {
  const frag = document.createDocumentFragment();
  for (const path of app.tabs) {
    const tab = document.createElement('div');
    const selected = current ? current.path === path : app.active === path;
    tab.className = 'tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(selected));
    tab.setAttribute('aria-controls', 'editor-area');
    tab.tabIndex = selected ? 0 : -1;
    tab.dataset.path = path;
    tab.title = path;
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tabLabel(path);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.tabIndex = -1;
    close.setAttribute('aria-label', `关闭 ${baseName(path)}`);
    close.innerHTML = ICONS.close.replace('<svg', '<svg class="x"') + ICONS.dot;
    tab.append(name, close);
    frag.append(tab);
  }
  tabsEl.replaceChildren(frag);
  for (const path of app.tabs) renderTabStatus(path);
  tabsEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderTabStatus(path) {
  const tab = tabsEl.querySelector(`[data-path="${CSS.escape(path)}"]`);
  const s = app.tabStatus.get(path) ?? {};
  const dirty = isDirty(path);
  if (tab) {
    tab.classList.toggle('dirty', dirty);
    tab.classList.toggle('warn', !!(s.diskChanged || s.deleted));
    const notes = [dirty && '未保存', s.diskChanged && '磁盘上已被修改', s.deleted && '磁盘上已删除'].filter(Boolean);
    tab.setAttribute('aria-label', [baseName(path), ...notes].join('，'));
  }
  const row = treeEl.querySelector(`[data-path="${CSS.escape(path)}"] > .tree-row`);
  if (row) {
    const badge = row.querySelector('.tree-badge');
    if (dirty && !badge) row.insertAdjacentHTML('beforeend', '<span class="tree-badge" title="未保存">●<span class="visually-hidden">未保存</span></span>');
    else if (!dirty && badge) badge.remove();
  }
}

function cycleTab(delta) {
  if (!app.tabs.length) return;
  const index = app.tabs.indexOf(current?.path ?? app.active);
  void activate(app.tabs[(index + delta + app.tabs.length) % app.tabs.length]);
}

async function closeTab(path) {
  let discard = false;
  if (isDirty(path)) {
    const choice = await confirmDialog({
      title: '保存更改？',
      message: `“${baseName(path)}” 有未保存的更改。如果不保存，这些更改会丢失。`,
      buttons: [
        { value: 'cancel', label: '取消' },
        { value: 'discard', label: '不保存', kind: 'danger' },
        { value: 'save', label: '保存', kind: 'primary' },
      ],
    });
    if (choice === 'save') {
      if (!(await saveDoc(path))) return;
    } else if (choice === 'discard') discard = true;
    else return;
  }
  const doc = docs.get(path);
  if (doc && !discard) await flushPush(doc);
  try {
    await post('/api/tabs/close', { path, discard });
  } catch (error) {
    showError(error);
  }
}

function showEditor() {
  const wasHidden = editorEl.hidden;
  editorEl.hidden = false;
  welcomeEl.hidden = true;
  if (wasHidden) view.requestMeasure();
}

function showWelcome({ title = '没有打开的文件', text, actions } = {}) {
  editorEl.hidden = true;
  welcomeEl.hidden = false;
  $('#welcome-title').textContent = title;
  $('#welcome-text').textContent = text ?? '从左侧选择文件，或把文件拖进窗口。你和 Agent 编辑的是同一份内容，保存后才会写入磁盘。';
  const box = welcomeEl.querySelector('.welcome-actions');
  box.replaceChildren(
    ...(actions ?? [
      { label: '新建文件', cmd: 'file.new', primary: true },
      { label: '快速打开', cmd: 'goto.file' },
      { label: '添加文件夹', cmd: 'folder.add' },
    ]).map((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn${a.primary ? ' primary' : ''}`;
      b.textContent = a.label;
      if (a.cmd) b.dataset.cmd = a.cmd;
      if (a.run) b.addEventListener('click', a.run);
      return b;
    }),
  );
  $('#shortcuts').hidden = !!actions;
  updateStatusBar();
  renderBanner();
}

function showOpenError(path, error) {
  if (current) {
    current.state = view.state;
    current.scroll = view.scrollSnapshot();
  }
  current = null;
  renderTabs();
  showWelcome({
    title: `无法打开 ${baseName(path)}`,
    text: error.message,
    actions: [
      { label: '关闭标签', primary: true, run: () => post('/api/tabs/close', { path, discard: true }).catch(showError) },
      { label: '快速打开', cmd: 'goto.file' },
    ],
  });
}

function renderBanner() {
  const el = $('#doc-banner');
  const s = current ? app.tabStatus.get(current.path) : null;
  if (!current || !s || (!s.diskChanged && !s.deleted)) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  const path = current.path;
  const text = document.createElement('span');
  text.className = 'banner-text';
  const button = (label, kind, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn${kind ? ` ${kind}` : ''}`;
    b.textContent = label;
    b.addEventListener('click', run);
    return b;
  };
  if (s.diskChanged) {
    text.textContent = `“${baseName(path)}” 已在磁盘上被其他程序修改，而编辑器中有未保存的更改。`;
    el.replaceChildren(
      text,
      button('重新加载（放弃我的更改）', 'danger', () => revertDoc(path)),
      button('保留我的版本并保存', '', () => saveDoc(path, { overwrite: true })),
    );
  } else {
    text.textContent = `“${baseName(path)}” 已在磁盘上被删除。保存会重新创建该文件。`;
    el.replaceChildren(text, button('保存', '', () => saveDoc(path)));
  }
  el.hidden = false;
}

function updateStatusBar() {
  renderHighlightStatus();
  const cursor = $('#st-cursor');
  const indent = $('#st-indent');
  const lang = $('#st-lang');
  if (!current || editorEl.hidden) {
    cursor.textContent = '';
    indent.hidden = true;
    lang.hidden = true;
    $('#st-encoding').textContent = '';
    $('#st-eol').textContent = '';
    return;
  }
  const st = view.state;
  const main = st.selection.main;
  const line = st.doc.lineAt(main.head);
  let text = `行 ${line.number}，列 ${main.head - line.from + 1}`;
  if (st.selection.ranges.length > 1) text += `　${st.selection.ranges.length} 个选区`;
  else if (!main.empty) {
    const lines = st.doc.lineAt(main.to).number - st.doc.lineAt(main.from).number + 1;
    text += `　已选 ${main.to - main.from} 个字符${lines > 1 ? `（${lines} 行）` : ''}`;
  }
  cursor.textContent = text;
  const { insertSpaces, size } = indentFor(current);
  indent.hidden = false;
  indent.textContent = insertSpaces ? `空格：${size}` : `Tab：${size}`;
  $('#st-encoding').textContent = current.bom ? 'UTF-8 BOM' : 'UTF-8';
  $('#st-eol').textContent = current.eol;
  lang.hidden = false;
  lang.textContent = languageById(current.langId).label;
}

let viewTimer = null;
function scheduleViewReport() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    if (!current) return;
    const st = view.state;
    const pos = (p) => {
      const line = st.doc.lineAt(p);
      return { line: line.number, col: p - line.from + 1 };
    };
    const main = st.selection.main;
    post('/api/view', {
      path: current.path,
      selections: st.selection.ranges.slice(0, 50).map((r) => ({ anchor: pos(r.anchor), head: pos(r.head) })),
      selectedText: main.empty ? '' : st.sliceDoc(main.from, Math.min(main.to, main.from + 8000)),
    }).catch(() => undefined);
  }, 400);
}

function gotoLine(n, focus = true) {
  if (!current) return;
  const { doc } = view.state;
  const line = doc.line(clamp(n, 1, doc.lines));
  view.dispatch({ selection: { anchor: line.from }, effects: V.EditorView.scrollIntoView(line.from, { y: 'center' }) });
  if (focus) view.focus();
}

function renderHighlightStatus() {
  const el = $('#st-highlights');
  const here = current && !editorEl.hidden ? highlightsOf(view.state).length : 0;
  const total = Math.max(app.highlightTotal, here);
  el.hidden = total === 0;
  if (!total) return;
  const visible = app.settings?.highlightsVisible !== false;
  el.textContent = `高亮 ${here}${total > here ? ` / 共 ${total}` : ''}${visible ? '' : '（已隐藏）'}`;
  el.classList.toggle('muted', !visible);
  el.setAttribute('aria-label', `Agent 高亮：此文件 ${here} 个，共 ${total} 个${visible ? '' : '，已隐藏'}`);
  el.title = app.settings?.highlightsPersist ? '高亮会一直保留，直到手动清除' : '修改被高亮的代码或关闭文件后，高亮会自动消失';
}

function jumpHighlight(delta) {
  if (!current || editorEl.hidden) return;
  const items = [...highlightsOf(view.state)].sort((a, b) => a.from - b.from || a.to - b.to);
  if (!items.length) {
    flash('这个文件没有 Agent 高亮');
    return;
  }
  if (app.settings.highlightsVisible === false) void toggleHighlightSetting('highlightsVisible');
  const head = view.state.selection.main.head;
  const target = delta > 0
    ? items.find((h) => h.from > head) ?? items[0]
    : items.findLast((h) => h.from < head) ?? items[items.length - 1];
  view.dispatch({ selection: { anchor: target.from }, effects: V.EditorView.scrollIntoView(target.from, { y: 'center' }) });
  view.focus();
  const note = target.note ? `：${target.note.split('\n')[0].slice(0, 80)}` : '';
  flash(`高亮 ${items.indexOf(target) + 1}/${items.length}${note}`);
}

async function removeHighlights(body) {
  try {
    const res = await post('/api/highlights/remove', body);
    flash(res.removed ? `已清除 ${res.removed} 个高亮` : '没有可清除的高亮');
  } catch (error) {
    showError(error);
  }
}

async function toggleHighlightSetting(key) {
  const on = !app.settings[key];
  await updateSettings({ [key]: on });
  if (app.settings[key] !== on) return; // the service rejected it; updateSettings already reported
  if (key === 'highlightsVisible') flash(on ? '已显示 Agent 高亮' : 'Agent 高亮已隐藏（不会被删除）');
  else flash(on ? 'Agent 高亮会一直保留，直到手动清除' : 'Agent 高亮会在代码被修改或文件关闭后自动消失');
}

function setLanguage(id) {
  if (!current) return;
  app.langOverride.set(current.path, id);
  current.langId = id;
  reconfigureDoc(current, 'lang');
}

function setDocIndent(value) {
  if (!current) return;
  app.indentOverride.set(current.path, value);
  reconfigureDoc(current, 'indent');
}

// ---- save / revert / create --------------------------------------------------------------------

async function saveDoc(path, { overwrite = false } = {}) {
  const doc = docs.get(path);
  if (doc?.state && !(await flushPush(doc))) {
    toast('编辑内容还没有同步到编辑器服务，请稍后再试', 'error');
    return false;
  }
  try {
    const res = await post('/api/doc/save', { path, overwrite });
    flash(res.saved ? `已保存 ${baseName(path)}` : `${baseName(path)} 没有需要保存的更改`);
    return true;
  } catch (error) {
    if (error.code === 'CONFLICT') {
      const choice = await confirmDialog({
        title: '文件已被外部修改',
        message: `“${baseName(path)}” 在磁盘上已被其他程序修改。保存会覆盖这些修改。`,
        buttons: [
          { value: 'cancel', label: '取消' },
          { value: 'reload', label: '重新加载（放弃我的更改）', kind: 'danger' },
          { value: 'overwrite', label: '覆盖保存', kind: 'primary' },
        ],
      });
      if (choice === 'overwrite') return saveDoc(path, { overwrite: true });
      if (choice === 'reload') await revertDoc(path);
      return false;
    }
    showError(error);
    return false;
  }
}

async function saveAll() {
  const dirty = app.tabs.filter((p) => isDirty(p));
  if (!dirty.length) {
    flash('没有未保存的文件');
    return;
  }
  let saved = 0;
  for (const path of dirty) if (await saveDoc(path)) saved++;
  flash(`已保存 ${saved} 个文件`);
}

async function revertDoc(path) {
  const doc = docs.get(path);
  try {
    if (doc?.state) await flushPush(doc);
    await post('/api/doc/revert', { path });
    flash(`已从磁盘重新加载 ${baseName(path)}`);
  } catch (error) {
    showError(error);
  }
}

function targetDir() {
  if (current && folderOf(current.path)) return dirName(current.path);
  const focused = treeEl.querySelector('[role="treeitem"][tabindex="0"]');
  if (focused?.dataset.path) return focused.dataset.kind === 'dir' ? focused.dataset.path : dirName(focused.dataset.path);
  return app.folders[0]?.path ?? null;
}

async function newEntry(kind, dir = targetDir()) {
  if (!dir) {
    toast('请先在侧边栏添加一个文件夹', 'warn');
    return addFolderPrompt();
  }
  const isFile = kind === 'file';
  const created = await promptDialog({
    title: isFile ? '新建文件' : '新建文件夹',
    label: `位置：${displayPath(dir)}`,
    placeholder: isFile ? '例如 notes.md 或 docs/todo.txt' : '例如 docs',
    confirm: '创建',
    submit: (value) => post('/api/fs/create', { dir, name: value.trim(), kind, focus: false }),
  });
  if (!created) return;
  const node = app.tree.get(dir);
  if (node) node.expanded = true;
  void loadDir(dir, { silent: true });
  if (isFile) await activate(created.path);
}

async function addFolderPrompt() {
  const result = await promptDialog({
    title: '添加文件夹到侧边栏',
    label: '文件夹的绝对路径',
    placeholder: '/Users/you/project',
    hint: '可以用 ~ 表示用户主目录。Agent 也能把当前对话的工作区添加进来。',
    confirm: '添加',
    submit: (value) => post('/api/folders/add', { path: value.trim() }),
  });
  if (result) {
    app.tree.set(result.path, { ...(app.tree.get(result.path) ?? {}), expanded: true });
    void loadDir(result.path);
  }
}

async function removeFolder(path) {
  const choice = await confirmDialog({
    title: '从侧边栏移除文件夹？',
    message: `“${baseName(path)}” 只会从侧边栏移除，磁盘上的文件不受影响。其中已打开的文件标签会被关闭。`,
    buttons: [{ value: 'cancel', label: '取消' }, { value: 'remove', label: '移除', kind: 'primary' }],
  });
  if (choice !== 'remove') return;
  try {
    await post('/api/folders/remove', { path });
  } catch (error) {
    showError(error);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  flash('已复制路径');
}

// ---- file import (drop / paste) ----------------------------------------------------------------

async function importFiles(files, dir) {
  if (!dir) {
    toast('请先在侧边栏添加一个文件夹', 'warn');
    return;
  }
  let added = 0;
  let firstPath = null;
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      toast(`${file.name} 超过 32 MB，已跳过`, 'warn');
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.subarray(0, 8192).includes(0)) {
      toast(`${file.name} 不是文本文件，已跳过`, 'warn');
      continue;
    }
    let content;
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      toast(`${file.name} 不是 UTF-8 编码，已跳过`, 'warn');
      continue;
    }
    try {
      const res = await post('/api/fs/create', { dir, name: file.name, kind: 'file', content, unique: true, focus: false });
      added++;
      firstPath ??= res.path;
    } catch (error) {
      showError(error);
    }
  }
  if (!added) return;
  const node = app.tree.get(dir);
  if (node) node.expanded = true;
  void loadDir(dir, { silent: true });
  flash(`已添加 ${added} 个文件到 ${displayPath(dir)}`);
  if (firstPath) await activate(firstPath);
}

const hasFiles = (event) => !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
let dragDepth = 0;
let dropRow = null;

function dropDir(event) {
  const item = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('#tree [role="treeitem"]');
  if (item?.dataset.path) return { dir: item.dataset.kind === 'dir' ? item.dataset.path : dirName(item.dataset.path), item };
  return { dir: targetDir(), item: null };
}

function setDropRow(item) {
  const row = item?.dataset.kind === 'dir' ? item.querySelector(':scope > .tree-row') : item?.parentElement?.closest('[role="treeitem"]')?.querySelector(':scope > .tree-row');
  if (row === dropRow) return;
  dropRow?.classList.remove('drop-target');
  dropRow = row ?? null;
  dropRow?.classList.add('drop-target');
}

window.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  $('#drop-overlay').hidden = false;
});
window.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  const { dir, item } = dropDir(event);
  setDropRow(item);
  $('#drop-text').textContent = dir ? `松开即可添加到 ${displayPath(dir)}` : '请先添加一个文件夹';
});
window.addEventListener('dragleave', (event) => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) {
    $('#drop-overlay').hidden = true;
    setDropRow(null);
  }
});
window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  setDropRow(null);
  const { dir } = dropDir(event);
  const files = [];
  let skippedDirs = 0;
  for (const item of Array.from(event.dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      skippedDirs++;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (skippedDirs) toast(`已跳过 ${skippedDirs} 个文件夹；可用“添加文件夹”把整个文件夹加入侧边栏`, 'warn');
  if (files.length) void importFiles(files, dir);
});

document.addEventListener(
  'paste',
  (event) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length || event.target.closest?.('dialog, input, select, textarea:not(.cm-content)')) return;
    event.preventDefault();
    event.stopPropagation();
    void importFiles(files, targetDir());
  },
  true,
);

// ---- tree --------------------------------------------------------------------------------------

function ensureRootNodes() {
  app.folders.forEach((f, i) => {
    if (!app.tree.has(f.path)) app.tree.set(f.path, { expanded: i === 0, entries: null, loading: false, error: null, truncated: false });
    const node = app.tree.get(f.path);
    if (node.expanded && !node.entries && !node.loading && !node.error) void loadDir(f.path);
  });
}

async function loadDir(path, { silent = false } = {}) {
  let node = app.tree.get(path);
  if (!node) {
    node = { expanded: false };
    app.tree.set(path, node);
  }
  if (node.loading) return;
  node.loading = true;
  if (!silent) node.error = null;
  try {
    const res = await get('/api/list', { path });
    node.entries = res.entries;
    node.truncated = res.truncated;
    node.error = null;
  } catch (error) {
    if (!silent || !node.entries) {
      node.error = error.message;
      node.entries = null;
    }
  } finally {
    node.loading = false;
    renderTree();
  }
}

function toggleDir(path, expand) {
  const node = app.tree.get(path) ?? { expanded: false };
  node.expanded = expand ?? !node.expanded;
  app.tree.set(path, node);
  if (node.expanded && !node.entries) void loadDir(path);
  renderTree();
}

function refreshDir(path) {
  if (app.tree.get(path)?.entries) void loadDir(path, { silent: true });
}

function refreshTree() {
  app.index.clear();
  for (const [path, node] of app.tree) if (node.entries) void loadDir(path, { silent: true });
}

function treeNote(text, level, error = false) {
  const el = document.createElement('div');
  el.className = `tree-note${error ? ' error' : ''}`;
  el.setAttribute('role', 'none');
  el.style.paddingLeft = `${26 + (level - 1) * 14}px`;
  el.textContent = text;
  return el;
}

function renderTreeNode(entry, level) {
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.setAttribute('role', 'treeitem');
  item.setAttribute('aria-level', String(level));
  item.dataset.path = entry.path;
  item.dataset.kind = entry.kind;
  item.tabIndex = -1;
  if (entry.root) item.dataset.root = '1';
  const row = document.createElement('div');
  row.className = `tree-row${entry.root ? ' root' : ''}${current?.path === entry.path ? ' active' : ''}`;
  row.style.paddingLeft = `${6 + (level - 1) * 14}px`;
  row.innerHTML = `<span class="tree-twisty">${entry.kind === 'dir' ? ICONS.chevron : ''}</span><span class="tree-icon">${entry.kind === 'dir' ? ICONS.folder : ICONS.file}</span><span class="tree-name"></span>`;
  row.querySelector('.tree-name').textContent = entry.name;
  row.title = entry.drafts
    ? `草稿：Mini App 的私有目录\n${entry.path}`
    : entry.auto
      ? `当前对话的项目（自动添加，切换项目且没有打开的文件时会自动移除）\n${entry.path}`
      : entry.path;
  item.append(row);
  if (entry.kind === 'file') {
    item.setAttribute('aria-selected', String(current?.path === entry.path));
    if (isDirty(entry.path)) row.insertAdjacentHTML('beforeend', '<span class="tree-badge" title="未保存">●<span class="visually-hidden">未保存</span></span>');
    return item;
  }
  const node = app.tree.get(entry.path);
  const expanded = !!node?.expanded;
  item.setAttribute('aria-expanded', String(expanded));
  if (!expanded) return item;
  const group = document.createElement('div');
  group.className = 'tree-group';
  group.setAttribute('role', 'group');
  if (node.error) group.append(treeNote(node.error, level + 1, true));
  else if (!node.entries) group.append(treeNote('加载中…', level + 1));
  else {
    if (!node.entries.length) group.append(treeNote('空文件夹', level + 1));
    for (const e of node.entries) {
      group.append(renderTreeNode({ path: joinPath(entry.path, e.name), name: e.name, kind: e.kind === 'dir' ? 'dir' : 'file' }, level + 1));
    }
    if (node.truncated) group.append(treeNote('仅显示前 5000 项', level + 1));
  }
  item.append(group);
  return item;
}

function renderTree() {
  const hadFocus = treeEl.contains(document.activeElement);
  const scroll = treeEl.scrollTop;
  const frag = document.createDocumentFragment();
  for (const f of app.folders) {
    frag.append(renderTreeNode({ path: f.path, name: f.name, kind: 'dir', root: true, drafts: f.drafts, auto: f.auto }, 1));
  }
  treeEl.replaceChildren(frag);
  treeEl.scrollTop = scroll;
  $('#sidebar-empty').hidden = app.folders.length > 0;
  const focusItem = (app.treeFocus && treeEl.querySelector(`[role="treeitem"][data-path="${CSS.escape(app.treeFocus)}"]`)) || treeEl.querySelector('[role="treeitem"]');
  if (focusItem) {
    focusItem.tabIndex = 0;
    if (hadFocus) focusItem.focus({ preventScroll: true });
  }
}

function markTreeActive() {
  for (const el of treeEl.querySelectorAll('.tree-row.active')) el.classList.remove('active');
  for (const el of treeEl.querySelectorAll('[aria-selected="true"]')) el.setAttribute('aria-selected', 'false');
  if (!current) return;
  const item = treeEl.querySelector(`[role="treeitem"][data-path="${CSS.escape(current.path)}"]`);
  if (item) {
    item.setAttribute('aria-selected', 'true');
    item.querySelector(':scope > .tree-row').classList.add('active');
  }
}

function setTreeFocus(item) {
  for (const el of treeEl.querySelectorAll('[role="treeitem"][tabindex="0"]')) el.tabIndex = -1;
  item.tabIndex = 0;
  item.focus({ preventScroll: false });
  app.treeFocus = item.dataset.path;
}

treeEl.addEventListener('click', (event) => {
  const item = event.target.closest('[role="treeitem"]');
  if (!item?.dataset.path) return;
  setTreeFocus(item);
  if (item.dataset.kind === 'dir') toggleDir(item.dataset.path);
  else void activate(item.dataset.path);
});

treeEl.addEventListener('keydown', (event) => {
  const item = event.target.closest('[role="treeitem"]');
  if (!item) return;
  const items = [...treeEl.querySelectorAll('[role="treeitem"]')];
  const index = items.indexOf(item);
  const isDir = item.dataset.kind === 'dir';
  const expanded = item.getAttribute('aria-expanded') === 'true';
  let handled = true;
  switch (event.key) {
    case 'ArrowDown':
      if (items[index + 1]) setTreeFocus(items[index + 1]);
      break;
    case 'ArrowUp':
      if (items[index - 1]) setTreeFocus(items[index - 1]);
      break;
    case 'Home':
      setTreeFocus(items[0]);
      break;
    case 'End':
      setTreeFocus(items[items.length - 1]);
      break;
    case 'ArrowRight':
      if (isDir && !expanded) toggleDir(item.dataset.path, true);
      else if (isDir && items[index + 1]) setTreeFocus(items[index + 1]);
      break;
    case 'ArrowLeft':
      if (isDir && expanded) toggleDir(item.dataset.path, false);
      else {
        const parent = item.parentElement?.closest('[role="treeitem"]');
        if (parent) setTreeFocus(parent);
      }
      break;
    case 'Enter':
    case ' ':
      if (isDir) toggleDir(item.dataset.path);
      else void activate(item.dataset.path);
      break;
    case 'ContextMenu':
      openTreeMenu(item, item.getBoundingClientRect().left + 24, item.getBoundingClientRect().bottom);
      break;
    default:
      handled = false;
  }
  if (handled) event.preventDefault();
});

treeEl.addEventListener('contextmenu', (event) => {
  const item = event.target.closest('[role="treeitem"]');
  if (!item?.dataset.path) return;
  event.preventDefault();
  setTreeFocus(item);
  openTreeMenu(item, event.clientX, event.clientY);
});

function openTreeMenu(item, x, y) {
  const path = item.dataset.path;
  const isDir = item.dataset.kind === 'dir';
  const dir = isDir ? path : dirName(path);
  const entries = [];
  if (!isDir) entries.push({ label: '打开', run: () => activate(path) });
  entries.push(
    { label: '新建文件…', run: () => newEntry('file', dir) },
    { label: '新建文件夹…', run: () => newEntry('dir', dir) },
    { sep: true },
    { label: '复制路径', run: () => copyText(path) },
  );
  if (isDir) entries.push({ label: '刷新', run: () => loadDir(path, { silent: true }) });
  if (item.dataset.root) entries.push({ sep: true }, { label: '从侧边栏移除', run: () => removeFolder(path) });
  showMenu(entries, x, y);
}

// ---- tabs interaction --------------------------------------------------------------------------

tabsEl.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  if (event.target.closest('.tab-close')) void closeTab(tab.dataset.path);
  else void activate(tab.dataset.path);
});
tabsEl.addEventListener('auxclick', (event) => {
  const tab = event.target.closest('.tab');
  if (tab && event.button === 1) void closeTab(tab.dataset.path);
});
tabsEl.addEventListener('keydown', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  const index = app.tabs.indexOf(tab.dataset.path);
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    const next = app.tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + app.tabs.length) % app.tabs.length];
    void activate(next, { focus: false }).then(() => tabsEl.querySelector(`[data-path="${CSS.escape(next)}"]`)?.focus());
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    void closeTab(tab.dataset.path);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    view.focus();
  }
});
tabsEl.addEventListener('contextmenu', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  event.preventDefault();
  const path = tab.dataset.path;
  showMenu(
    [
      { label: '关闭', run: () => closeTab(path) },
      { label: '关闭其他标签', run: async () => { for (const p of app.tabs.filter((t) => t !== path)) await closeTab(p); } },
      { sep: true },
      { label: '复制路径', run: () => copyText(path) },
      { label: '从磁盘重新加载', run: () => revertDoc(path) },
    ],
    event.clientX,
    event.clientY,
  );
});

// ---- menu --------------------------------------------------------------------------------------

const menuEl = $('#menu');
let menuRestore = null;

function hideMenu() {
  if (menuEl.hidden) return;
  menuEl.hidden = true;
  menuEl.replaceChildren();
  menuRestore?.focus?.({ preventScroll: true });
  menuRestore = null;
}

function showMenu(entries, x, y) {
  menuRestore = document.activeElement;
  menuEl.replaceChildren();
  for (const entry of entries) {
    if (entry.sep) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      sep.setAttribute('role', 'separator');
      menuEl.append(sep);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item';
    b.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemradio');
    if (entry.checked !== undefined) b.setAttribute('aria-checked', String(entry.checked));
    b.textContent = entry.label;
    b.tabIndex = -1;
    b.addEventListener('click', () => {
      hideMenu();
      void entry.run();
    });
    menuEl.append(b);
  }
  menuEl.hidden = false;
  const rect = menuEl.getBoundingClientRect();
  menuEl.style.left = `${clamp(x, 8, window.innerWidth - rect.width - 8)}px`;
  menuEl.style.top = `${y + rect.height > window.innerHeight - 8 ? Math.max(8, y - rect.height) : y}px`;
  menuEl.querySelector('.menu-item')?.focus();
}

menuEl.addEventListener('keydown', (event) => {
  const items = [...menuEl.querySelectorAll('.menu-item')];
  const index = items.indexOf(document.activeElement);
  if (event.key === 'ArrowDown') items[(index + 1) % items.length]?.focus();
  else if (event.key === 'ArrowUp') items[(index - 1 + items.length) % items.length]?.focus();
  else if (event.key === 'Escape' || event.key === 'Tab') hideMenu();
  else return;
  event.preventDefault();
});
document.addEventListener('pointerdown', (event) => {
  if (!menuEl.hidden && !menuEl.contains(event.target)) hideMenu();
});
window.addEventListener('blur', hideMenu);

// ---- dialogs -----------------------------------------------------------------------------------

function promptDialog({ title, label, value = '', placeholder = '', hint = '', confirm = '确定', submit }) {
  const dlg = $('#prompt-dialog');
  const form = $('#prompt-form');
  const input = $('#prompt-input');
  const errorEl = $('#prompt-error');
  const ok = $('#prompt-ok');
  const cancel = $('#prompt-cancel');
  $('#prompt-title').textContent = title;
  $('#prompt-label').textContent = label;
  $('#prompt-hint').textContent = hint;
  input.value = value;
  input.placeholder = placeholder;
  input.removeAttribute('aria-invalid');
  errorEl.hidden = true;
  ok.textContent = confirm;
  const restore = document.activeElement;
  return new Promise((resolve) => {
    let busy = false;
    const setError = (message) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    };
    const finish = (result) => {
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      dlg.removeEventListener('cancel', onCancel);
      if (dlg.open) dlg.close();
      restore?.focus?.({ preventScroll: true });
      resolve(result);
    };
    const onSubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      if (!input.value.trim()) return setError('请输入内容');
      busy = true;
      ok.disabled = true;
      try {
        finish(submit ? await submit(input.value) : input.value);
      } catch (error) {
        setError(error.message);
      } finally {
        busy = false;
        ok.disabled = false;
      }
    };
    const onCancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
    input.focus();
    input.select();
  });
}

function confirmDialog({ title, message, buttons }) {
  const dlg = $('#confirm-dialog');
  const actions = $('#confirm-actions');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  const restore = document.activeElement;
  return new Promise((resolve) => {
    const finish = (value) => {
      dlg.removeEventListener('cancel', onCancel);
      if (dlg.open) dlg.close();
      restore?.focus?.({ preventScroll: true });
      resolve(value);
    };
    const onCancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    actions.replaceChildren(
      ...buttons.map((b) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `btn${b.kind ? ` ${b.kind}` : ''}`;
        el.textContent = b.label;
        el.addEventListener('click', () => finish(b.value));
        return el;
      }),
    );
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
    (actions.querySelector('.btn.primary') ?? actions.lastElementChild)?.focus();
  });
}

const SETTING_CHECKS = ['insertSpaces', 'wordWrap', 'minimap', 'indentGuides', 'lineNumbers', 'showWhitespace', 'highlightsVisible', 'highlightsPersist'];

function openSettings() {
  const dlg = $('#settings-dialog');
  const form = $('#settings-form');
  const s = app.settings;
  form.theme.value = s.theme;
  form.fontSize.value = String(s.fontSize);
  form.codeFont.value = s.codeFont;
  form.fontFamily.value = s.fontFamily;
  const customField = $('#custom-font-field');
  const syncCustom = () => {
    const custom = form.codeFont.value === 'custom';
    customField.hidden = !custom;
    form.fontFamily.required = custom;
  };
  syncCustom();
  form.codeFont.addEventListener('change', syncCustom);
  form.lineHeight.value = String(s.lineHeight);
  form.tabSize.value = [2, 4, 8].includes(s.tabSize) ? String(s.tabSize) : '4';
  for (const key of SETTING_CHECKS) form[key].checked = s[key];
  const restore = document.activeElement;
  const close = () => {
    form.removeEventListener('submit', onSubmit);
    form.codeFont.removeEventListener('change', syncCustom);
    $('#settings-cancel').removeEventListener('click', onCancel);
    dlg.removeEventListener('close', onClose);
    if (dlg.open) dlg.close();
    restore?.focus?.({ preventScroll: true });
  };
  const onSubmit = (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const patch = {
      theme: form.theme.value,
      fontSize: clamp(Math.round(Number(form.fontSize.value)), 8, 40),
      codeFont: form.codeFont.value,
      fontFamily: form.fontFamily.value.trim().replace(/[;{}<>\\]/g, ''),
      lineHeight: clamp(Number(form.lineHeight.value), 1, 2.5),
      tabSize: Number(form.tabSize.value),
    };
    for (const key of SETTING_CHECKS) patch[key] = form[key].checked;
    close();
    void updateSettings(patch).then(() => flash('设置已保存'));
  };
  const onCancel = () => close();
  const onClose = () => close();
  form.addEventListener('submit', onSubmit);
  $('#settings-cancel').addEventListener('click', onCancel);
  dlg.addEventListener('close', onClose);
  dlg.showModal();
  form.theme.focus();
}

// ---- palette (quick open, commands, syntax, go to line) ----------------------------------------

function fuzzy(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, positions: [] };
  const t = text.toLowerCase();
  const slash = t.lastIndexOf('/');
  const positions = [];
  let from = 0;
  let prev = -2;
  let score = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i === -1) return null;
    positions.push(i);
    score += i === prev + 1 ? 6 : 1;
    if (i === 0 || '/_-. '.includes(t[i - 1])) score += 4;
    if (i > slash) score += 2;
    prev = i;
    from = i + 1;
  }
  return { score: score - t.length / 100, positions };
}

function rank(list, query, textOf, limit = 80) {
  if (!query.trim()) return list.slice(0, 300).map((item) => ({ item, positions: [] }));
  const out = [];
  for (const item of list) {
    const m = fuzzy(query, textOf(item));
    if (m) out.push({ item, positions: m.positions, score: m.score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

const palette = {
  mode: 'files',
  items: [],
  selected: 0,
  indexing: false,
  open(mode = 'files', initial = '') {
    hideMenu();
    this.mode = mode;
    paletteInput.value = initial;
    paletteInput.placeholder = {
      files: '按名称查找文件（输入 : 跳转到行，> 执行命令）',
      commands: '输入命令名称',
      syntax: '选择语法',
    }[mode];
    paletteInput.setAttribute('aria-label', paletteInput.placeholder);
    if (!paletteEl.open) {
      this.restore = document.activeElement;
      paletteEl.showModal();
    }
    paletteInput.focus();
    this.update();
    if (mode === 'files') void this.loadIndex();
  },
  close(restore = true) {
    if (paletteEl.open) paletteEl.close();
    if (restore) this.restore?.focus?.({ preventScroll: true });
  },
  async loadIndex() {
    const stale = app.folders.filter((f) => {
      const entry = app.index.get(f.path);
      return !entry || Date.now() - entry.at > 30_000;
    });
    if (!stale.length) return;
    this.indexing = true;
    this.update();
    await Promise.all(
      stale.map(async (f) => {
        try {
          const res = await get('/api/quick-open', { folder: f.path });
          app.index.set(f.path, { at: Date.now(), truncated: res.truncated, files: res.files.map((rel) => ({ path: joinPath(f.path, rel), rel, folder: f.name })) });
        } catch (error) {
          app.index.set(f.path, { at: Date.now(), files: [], error: error.message });
        }
      }),
    );
    this.indexing = false;
    if (paletteEl.open) this.update();
  },
  update() {
    const raw = paletteInput.value;
    let mode = this.mode;
    let q = raw;
    if (mode === 'files' && raw.startsWith('>')) {
      mode = 'commands';
      q = raw.slice(1);
    } else if (mode === 'files' && raw.startsWith(':')) {
      mode = 'line';
      q = raw.slice(1);
    }
    let hint = '';
    if (mode === 'commands') {
      this.items = rank(COMMANDS, q, (c) => c.title).map(({ item, positions }) => ({
        title: item.title, positions, keys: keyLabel(item.keys), run: () => runCommand(item.id),
      }));
    } else if (mode === 'syntax') {
      this.items = rank(LANGUAGES, q, (l) => l.label).map(({ item, positions }) => ({
        title: item.label, positions, detail: current?.langId === item.id ? '当前' : '', run: () => setLanguage(item.id),
      }));
    } else if (mode === 'line') {
      const n = Number.parseInt(q, 10);
      const total = current ? view.state.doc.lines : 0;
      this.items = current
        ? [{ title: Number.isFinite(n) ? `跳转到第 ${clamp(n, 1, total)} 行` : `输入行号（1–${total}）`, positions: [], run: Number.isFinite(n) ? () => gotoLine(n) : null }]
        : [{ title: '没有打开的文件', positions: [], run: null }];
    } else {
      const files = [];
      let truncated = false;
      for (const f of app.folders) {
        const entry = app.index.get(f.path);
        if (entry) {
          files.push(...entry.files);
          truncated ||= entry.truncated;
        }
      }
      if (!q.trim()) {
        this.items = app.tabs
          .filter((p) => p !== current?.path)
          .map((p) => ({ title: baseName(p), positions: [], detail: displayPath(dirName(p)), run: () => activate(p) }));
        hint = this.items.length ? '最近打开的标签' : '';
      } else {
        this.items = rank(files, q, (f) => f.rel, 60).map(({ item, positions }) => ({
          title: item.rel, positions, detail: item.folder, run: () => activate(item.path),
        }));
      }
      if (this.indexing) hint = '正在建立文件索引…';
      else if (truncated) hint = '文件较多，只索引了一部分';
      else if (q.trim() && !this.items.length) hint = '没有匹配的文件';
      hint = [hint, '输入 : 跳转到行，> 执行命令'].filter(Boolean).join(' · ');
    }
    $('#palette-hint').textContent = hint;
    this.selected = 0;
    this.render();
  },
  render() {
    const frag = document.createDocumentFragment();
    this.items.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = 'palette-item';
      li.id = `palette-item-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === this.selected));
      const main = document.createElement('div');
      main.className = 'palette-main';
      const title = document.createElement('span');
      title.className = 'palette-title';
      const marks = new Set(entry.positions);
      let run = '';
      let bold = false;
      const flush = () => {
        if (!run) return;
        if (bold) {
          const b = document.createElement('b');
          b.textContent = run;
          title.append(b);
        } else title.append(run);
        run = '';
      };
      [...entry.title].forEach((ch, index) => {
        const isMark = marks.has(index);
        if (isMark !== bold) {
          flush();
          bold = isMark;
        }
        run += ch;
      });
      flush();
      main.append(title);
      if (entry.detail) {
        const detail = document.createElement('span');
        detail.className = 'palette-detail';
        detail.textContent = entry.detail;
        main.append(detail);
      }
      li.append(main);
      if (entry.keys) {
        const keys = document.createElement('span');
        keys.className = 'palette-keys';
        keys.textContent = entry.keys;
        li.append(keys);
      }
      li.addEventListener('mousedown', (event) => event.preventDefault());
      li.addEventListener('click', () => this.accept(i));
      frag.append(li);
    });
    paletteList.replaceChildren(frag);
    this.syncSelection();
  },
  syncSelection() {
    const items = paletteList.children;
    for (let i = 0; i < items.length; i++) items[i].setAttribute('aria-selected', String(i === this.selected));
    const active = items[this.selected];
    if (active) {
      paletteInput.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else paletteInput.removeAttribute('aria-activedescendant');
  },
  move(delta) {
    if (!this.items.length) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.syncSelection();
  },
  accept(index = this.selected) {
    const entry = this.items[index];
    if (!entry?.run) return;
    this.close(false);
    void entry.run();
  },
};

paletteInput.addEventListener('input', () => palette.update());
paletteInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') palette.move(1);
  else if (event.key === 'ArrowUp') palette.move(-1);
  else if (event.key === 'Enter') palette.accept();
  else return;
  event.preventDefault();
});
paletteEl.addEventListener('cancel', (event) => {
  event.preventDefault();
  palette.close();
});
paletteEl.addEventListener('click', (event) => {
  if (event.target === paletteEl) palette.close();
});

// ---- commands and keyboard ---------------------------------------------------------------------

const withView = (fn) => () => {
  if (!current) return;
  fn(view);
  view.focus();
};

const COMMANDS = [
  { id: 'file.new', title: '新建文件', keys: 'Mod-n', run: () => newEntry('file') },
  { id: 'file.newFolder', title: '新建文件夹', run: () => newEntry('dir') },
  { id: 'file.save', title: '保存', keys: 'Mod-s', run: () => current && saveDoc(current.path) },
  { id: 'file.saveAll', title: '全部保存', keys: 'Mod-Alt-s', run: saveAll },
  { id: 'file.revert', title: '从磁盘重新加载（放弃更改）', run: () => current && revertDoc(current.path) },
  { id: 'tab.close', title: '关闭标签', keys: 'Mod-w', run: () => current && closeTab(current.path) },
  { id: 'tab.next', title: '下一个标签', keys: isMac ? 'Mod-Alt-ArrowRight' : 'Mod-Tab', run: () => cycleTab(1) },
  { id: 'tab.prev', title: '上一个标签', keys: isMac ? 'Mod-Alt-ArrowLeft' : 'Mod-Shift-Tab', run: () => cycleTab(-1) },
  { id: 'goto.file', title: '快速打开文件', keys: 'Mod-p', run: () => palette.open('files') },
  { id: 'goto.line', title: '跳转到行', keys: isMac ? 'Ctrl-g' : 'Mod-g', run: () => palette.open('files', ':') },
  { id: 'palette.commands', title: '命令面板', keys: 'Mod-Shift-p', run: () => palette.open('commands') },
  { id: 'find', title: '查找', keys: 'Mod-f', run: withView(Q.openSearchPanel) },
  { id: 'replace', title: '查找和替换', keys: 'Mod-Alt-f', run: withView(Q.openSearchPanel) },
  { id: 'select.next', title: '选择下一个匹配项（多光标）', keys: 'Mod-d', run: withView(Q.selectNextOccurrence) },
  { id: 'select.all', title: '选择全部匹配项', keys: isMac ? 'Ctrl-Mod-g' : 'Alt-F3', run: withView(Q.selectSelectionMatches) },
  { id: 'select.splitLines', title: '把选区拆分成多行光标', keys: 'Mod-Shift-l', run: withView(splitSelectionByLine) },
  { id: 'select.line', title: '选择整行', keys: 'Mod-l', run: withView(C.selectLine) },
  { id: 'edit.comment', title: '切换注释', keys: 'Mod-/', run: withView(C.toggleComment) },
  { id: 'edit.deleteLine', title: '删除行', keys: 'Mod-Shift-k', run: withView(C.deleteLine) },
  { id: 'edit.duplicateLine', title: '复制当前行', keys: 'Mod-Shift-d', run: withView(C.copyLineDown) },
  { id: 'fold.code', title: '折叠当前块', keys: isMac ? 'Mod-Alt-[' : 'Ctrl-Shift-[', run: withView(L.foldCode) },
  { id: 'fold.unfold', title: '展开当前块', keys: isMac ? 'Mod-Alt-]' : 'Ctrl-Shift-]', run: withView(L.unfoldCode) },
  { id: 'fold.all', title: '全部折叠', keys: 'Mod-k Mod-1', run: withView(L.foldAll) },
  { id: 'fold.unfoldAll', title: '全部展开', keys: 'Mod-k Mod-0', run: withView(L.unfoldAll) },
  { id: 'view.syntax', title: '设置语法…', run: () => palette.open('syntax') },
  { id: 'view.sidebar', title: '显示或隐藏侧边栏', keys: 'Mod-k Mod-b', run: () => toggleSetting('sidebarVisible') },
  { id: 'view.wrap', title: '切换自动换行', run: () => toggleSetting('wordWrap') },
  { id: 'view.minimap', title: '切换小地图', run: () => toggleSetting('minimap') },
  { id: 'view.guides', title: '切换缩进参考线', run: () => toggleSetting('indentGuides') },
  { id: 'view.whitespace', title: '显示或隐藏空白字符', run: () => toggleSetting('showWhitespace') },
  { id: 'view.lineNumbers', title: '显示或隐藏行号', run: () => toggleSetting('lineNumbers') },
  { id: 'view.fontUp', title: '增大字号', keys: 'Mod-=', run: () => changeFont(1) },
  { id: 'view.fontDown', title: '减小字号', keys: 'Mod--', run: () => changeFont(-1) },
  { id: 'view.fontReset', title: '恢复默认字号', keys: 'Mod-0', run: () => updateSettings({ fontSize: 14 }) },
  { id: 'view.theme', title: '切换主题（跟随系统 / 深色 / 浅色）', run: () => updateSettings({ theme: { system: 'dark', dark: 'light', light: 'system' }[app.settings.theme] }) },
  { id: 'folder.add', title: '添加文件夹到侧边栏…', run: addFolderPrompt },
  { id: 'tree.refresh', title: '刷新文件列表', run: refreshTree },
  { id: 'highlight.next', title: '下一个 Agent 高亮', keys: 'F8', run: () => jumpHighlight(1) },
  { id: 'highlight.prev', title: '上一个 Agent 高亮', keys: 'Shift-F8', run: () => jumpHighlight(-1) },
  { id: 'highlight.toggle', title: '显示或隐藏 Agent 高亮', run: () => toggleHighlightSetting('highlightsVisible') },
  { id: 'highlight.keep', title: '切换 Agent 高亮的保留方式（自动消失 / 保留到手动清除）', run: () => toggleHighlightSetting('highlightsPersist') },
  { id: 'highlight.clearFile', title: '清除此文件的 Agent 高亮', run: () => current && removeHighlights({ path: current.path }) },
  { id: 'highlight.clearAll', title: '清除全部 Agent 高亮', run: () => removeHighlights({ all: true }) },
  { id: 'prefs', title: '设置…', keys: 'Mod-,', run: openSettings },
];
const commandById = new Map(COMMANDS.map((c) => [c.id, c]));

function runCommand(id) {
  const command = commandById.get(id);
  if (command) void command.run();
}

const MAC_KEYS = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '↩', Tab: '⇥' };
const PC_KEYS = { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

function keyLabel(keys) {
  if (!keys) return '';
  return keys
    .split(' ')
    .map((combo) => combo.split(/-(?=.)/).map((part) => (isMac ? MAC_KEYS : PC_KEYS)[part] ?? part.toUpperCase()).join(isMac ? '' : '+'))
    .join(' ');
}

const CODE_KEYS = { Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', BracketLeft: '[', BracketRight: ']', Backquote: '`' };

function keyId(event) {
  const parts = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push('Mod');
  if (isMac && event.ctrlKey) parts.push('Ctrl');
  if (!isMac && event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  let key = event.key;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (CODE_KEYS[event.code]) key = CODE_KEYS[event.code];
  else if (key.length === 1) key = key.toLowerCase();
  parts.push(key);
  return parts.join('-');
}

const GLOBAL_KEYS = {
  'Mod-s': 'file.save',
  'Mod-Alt-s': 'file.saveAll',
  'Mod-p': 'goto.file',
  'Mod-Shift-p': 'palette.commands',
  'Mod-n': 'file.new',
  'Mod-w': 'tab.close',
  'Mod-=': 'view.fontUp',
  'Mod-Shift-=': 'view.fontUp',
  'Mod--': 'view.fontDown',
  'Mod-0': 'view.fontReset',
  'Mod-,': 'prefs',
  F8: 'highlight.next',
  'Shift-F8': 'highlight.prev',
  [isMac ? 'Ctrl-g' : 'Mod-g']: 'goto.line',
  [isMac ? 'Mod-Alt-ArrowRight' : 'Mod-Tab']: 'tab.next',
  [isMac ? 'Mod-Alt-ArrowLeft' : 'Mod-Shift-Tab']: 'tab.prev',
  [isMac ? 'Ctrl-Tab' : 'Mod-PageDown']: 'tab.next',
  [isMac ? 'Ctrl-Shift-Tab' : 'Mod-PageUp']: 'tab.prev',
};
const CHORDS = { 'Mod-k Mod-b': 'view.sidebar', 'Mod-k Mod-0': 'fold.unfoldAll', 'Mod-k Mod-1': 'fold.all' };

function clearChord() {
  clearTimeout(app.chordTimer);
  app.chord = null;
}

window.addEventListener(
  'keydown',
  (event) => {
    if (event.isComposing || document.querySelector('dialog[open]')) return;
    const id = keyId(event);
    if (['Mod', 'Shift', 'Alt', 'Ctrl', 'Meta'].includes(event.key) || /-(Meta|Control|Shift|Alt)$/.test(id)) return;
    if (app.chord) {
      const combo = `${app.chord} ${id}`;
      clearChord();
      if (CHORDS[combo]) {
        event.preventDefault();
        event.stopPropagation();
        runCommand(CHORDS[combo]);
        return;
      }
    }
    if (id === 'Mod-k') {
      event.preventDefault();
      event.stopPropagation();
      app.chord = 'Mod-k';
      app.chordTimer = setTimeout(clearChord, 1500);
      return;
    }
    const command = GLOBAL_KEYS[id];
    if (command) {
      event.preventDefault();
      event.stopPropagation();
      runCommand(command);
      return;
    }
    const digit = /^Mod-([1-9])$/.exec(id);
    if (digit && app.tabs.length) {
      event.preventDefault();
      event.stopPropagation();
      const n = Number(digit[1]);
      void activate(app.tabs[n === 9 ? app.tabs.length - 1 : Math.min(n, app.tabs.length) - 1]);
    }
  },
  true,
);

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-cmd]');
  if (button) runCommand(button.dataset.cmd);
});

$('#st-lang').addEventListener('click', () => palette.open('syntax'));
$('#st-highlights').addEventListener('click', (event) => {
  const here = current && !editorEl.hidden ? highlightsOf(view.state).length : 0;
  const rect = event.currentTarget.getBoundingClientRect();
  showMenu(
    [
      { label: '显示 Agent 高亮', checked: app.settings.highlightsVisible !== false, run: () => toggleHighlightSetting('highlightsVisible') },
      { label: '保留高亮，直到手动清除', checked: !!app.settings.highlightsPersist, run: () => toggleHighlightSetting('highlightsPersist') },
      { sep: true },
      ...(here
        ? [
          { label: `下一个高亮　${keyLabel('F8')}`, run: () => jumpHighlight(1) },
          { label: `上一个高亮　${keyLabel('Shift-F8')}`, run: () => jumpHighlight(-1) },
          { label: `清除此文件的高亮（${here}）`, run: () => removeHighlights({ path: current.path }) },
        ]
        : []),
      { label: `清除全部高亮（${app.highlightTotal}）`, run: () => removeHighlights({ all: true }) },
    ],
    rect.left,
    rect.top - 4,
  );
});
$('#st-indent').addEventListener('click', (event) => {
  if (!current) return;
  const { insertSpaces, size } = indentFor(current);
  const rect = event.currentTarget.getBoundingClientRect();
  showMenu(
    [
      { label: '使用空格缩进', checked: insertSpaces, run: () => setDocIndent({ insertSpaces: true, size }) },
      { label: '使用 Tab 缩进', checked: !insertSpaces, run: () => setDocIndent({ insertSpaces: false, size }) },
      { sep: true },
      ...[2, 4, 8].map((n) => ({ label: `缩进宽度：${n}`, checked: size === n, run: () => setDocIndent({ insertSpaces, size: n }) })),
      { sep: true },
      {
        label: '根据内容重新识别',
        run: () => {
          app.indentOverride.delete(current.path);
          current.detectedIndent = detectIndent(view.state.doc.sliceString(0, 200_000));
          reconfigureDoc(current, 'indent');
        },
      },
    ],
    rect.left,
    rect.top - 4,
  );
});

// ---- sidebar resizer ---------------------------------------------------------------------------

const resizer = $('#resizer');
resizer.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  resizer.setPointerCapture(event.pointerId);
  resizer.classList.add('dragging');
  const startX = event.clientX;
  const startWidth = app.settings.sidebarWidth;
  let width = startWidth;
  const move = (e) => {
    width = clamp(Math.round(startWidth + e.clientX - startX), 160, 640);
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  };
  const up = () => {
    resizer.removeEventListener('pointermove', move);
    resizer.removeEventListener('pointerup', up);
    resizer.removeEventListener('pointercancel', up);
    resizer.classList.remove('dragging');
    if (width !== startWidth) void updateSettings({ sidebarWidth: width });
  };
  resizer.addEventListener('pointermove', move);
  resizer.addEventListener('pointerup', up);
  resizer.addEventListener('pointercancel', up);
});
resizer.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  void updateSettings({ sidebarWidth: clamp(app.settings.sidebarWidth + (event.key === 'ArrowRight' ? 16 : -16), 160, 640) });
});

// ---- server events -----------------------------------------------------------------------------

function applyServerState(state) {
  const previousSettings = app.settings;
  app.settings = state.settings;
  app.folders = state.folders;
  app.tabs = state.tabs.map((t) => t.path);
  for (const t of state.tabs) app.tabStatus.set(t.path, { dirty: t.dirty, diskChanged: t.diskChanged, deleted: t.deleted });
  for (const path of [...app.tabStatus.keys()]) if (!app.tabs.includes(path)) app.tabStatus.delete(path);
  for (const [path, doc] of docs) {
    if (app.tabs.includes(path)) continue;
    doc.closed = true;
    docs.delete(path);
    if (current === doc) current = null;
  }
  app.active = state.active;
  app.highlightTotal = state.highlights ?? 0;
  if (!previousSettings || JSON.stringify(previousSettings) !== JSON.stringify(state.settings)) {
    applyChrome();
    reconfigureAll();
  }
  ensureRootNodes();
  renderTree();
  renderTabs();
  const pending = app.requestedActive && Date.now() - app.requestedAt < 5000;
  if (!pending && state.active && state.active !== current?.path) void activate(state.active, { report: false, focus: false });
  else if (!pending && !state.active) showWelcome();
  else if (current) renderBanner();
  renderHighlightStatus();
}

function onAgentActivity(event) {
  const name = baseName(event.path);
  if (event.action === 'folder') {
    app.tree.set(event.path, { ...(app.tree.get(event.path) ?? {}), expanded: true });
    void loadDir(event.path);
    toast(`Agent 已把 ${name} 设为主文件夹`);
    return;
  }
  if (event.action === 'open') {
    void activate(event.path, { report: false, focus: false, line: event.line });
    return;
  }
  if (event.action === 'reveal') {
    // Scroll to what the Agent highlighted without moving the user's cursor; never yank them away mid-typing.
    const show = async () => {
      if (current?.path !== event.path) await activate(event.path, { focus: false });
      if (current?.path !== event.path || !event.line) return;
      const line = view.state.doc.line(clamp(event.line, 1, view.state.doc.lines));
      view.dispatch({ effects: V.EditorView.scrollIntoView(line.from, { y: 'center' }) });
    };
    if (Date.now() - app.lastUserEdit < 3000) toast(`Agent 在 ${name} 中高亮了代码`, 'info', { label: '查看', run: () => void show() });
    else void show();
    return;
  }
  flash(`Agent ${event.action === 'create' ? '创建了' : '修改了'} ${name}`);
  if (current?.path === event.path) return;
  if (!current || Date.now() - app.lastUserEdit > 3000) void activate(event.path, { focus: false });
  else toast(`Agent 修改了 ${name}`, 'info', { label: '查看', run: () => activate(event.path) });
}

function handleEvent(event) {
  switch (event.type) {
    case 'hello':
      $('#offline-banner').hidden = true;
      if (app.everConnected) for (const doc of docs.values()) if (doc.state) void pullDoc(doc);
      app.everConnected = true;
      break;
    case 'state':
      applyServerState(event.state);
      break;
    case 'doc.updates': {
      setTabStatus(event.path, event);
      const doc = docs.get(event.path);
      if (doc?.state) applyRemote(doc, event.version, event.updates.map(fromWire));
      break;
    }
    case 'doc.status':
      setTabStatus(event.path, event);
      break;
    case 'highlights': {
      const doc = docs.get(event.path);
      if (doc) receiveHighlights(doc, event.version, event.items);
      break;
    }
    case 'fs.changed':
      app.index.clear();
      refreshDir(event.dir);
      break;
    case 'notice':
      toast(event.message, event.level === 'error' ? 'error' : event.level);
      break;
    case 'agent.activity':
      onAgentActivity(event);
      break;
    case 'workspace.follow':
      app.tree.set(event.path, { ...(app.tree.get(event.path) ?? {}), expanded: true });
      void loadDir(event.path);
      toast(`已切换到当前对话的项目：${baseName(event.path)}`);
      break;
    default:
      break;
  }
}

let offlineTimer = null;
function connectEvents() {
  const source = new EventSource('/api/events');
  source.addEventListener('message', (message) => {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    clearTimeout(offlineTimer);
    handleEvent(event);
  });
  source.addEventListener('error', () => {
    clearTimeout(offlineTimer);
    offlineTimer = setTimeout(() => {
      $('#offline-banner').hidden = false;
    }, 2500);
  });
}

window.addEventListener('focus', () => {
  if (app.settings) refreshTree();
});

// ---- boot --------------------------------------------------------------------------------------

function boot() {
  document.documentElement.dataset.theme = darkQuery.matches ? 'dark' : 'light';
  for (const button of document.querySelectorAll('.icon-btn[data-cmd]')) button.innerHTML = CMD_ICONS[button.dataset.cmd] ?? '';
  const shortcuts = [
    ['Mod-p', '快速打开文件'], ['Mod-Shift-p', '命令面板'], ['Mod-n', '新建文件'], ['Mod-s', '保存'],
    ['Mod-d', '选择下一个匹配项'], [isMac ? 'Mod-Alt-[' : 'Ctrl-Shift-[', '折叠代码块'], ['Mod-=', '放大字号'],
  ];
  $('#shortcuts').replaceChildren(
    ...shortcuts.flatMap(([keys, label]) => {
      const dt = document.createElement('dt');
      dt.textContent = keyLabel(keys);
      const dd = document.createElement('dd');
      dd.textContent = label;
      return [dt, dd];
    }),
  );
  editorEl.hidden = true;
  showWelcome({ title: '正在加载…', text: '正在连接编辑器服务。', actions: [] });
  const root = new URLSearchParams(location.search).get('root');
  const ready = root
    ? post('/api/folders/add', { path: root, top: true })
      .then((res) => app.tree.set(res.path, { ...(app.tree.get(res.path) ?? {}), expanded: true }))
      .catch(showError)
    : Promise.resolve();
  void ready.then(connectEvents);
}

boot();
