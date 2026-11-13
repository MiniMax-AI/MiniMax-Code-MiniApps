// Desktop pet page: a three-tab inline panel and a compact desktop companion.
import { STATUS_ANIM, createActivitySource } from './activity.mjs';
import { DEFAULT_PREFERENCES, MAX_NOTICE_TIMEOUT_SECONDS, loadPreferences, preferenceRequest } from './preferences.mjs';
import { restoreWindowPosition, fitWindowToScreen } from './window-position.mjs';
import { aggregateText, notificationItems, noticeRemaining, notificationText, visibleNotices, createAnimationGate } from './pet-presentation.mjs';
import { createReminderStore } from './activity-reminders.mjs';
import { createCompactPetView, taskStatus } from './compact-pet-view.mjs';
import { createNotificationPreviews } from './notification-previews.mjs';
import { createAskObserver } from './ask-observer.mjs';
import { createPanelNavigation } from './panel-navigation.mjs';
import { getLanguage, localeFor, onLanguageChange, resolveLanguage, setLanguage, t } from './i18n.mjs';
import { markdownToPlainText, renderMarkdown } from './markdown.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_KEYS = { idle: 'status.idle', running: 'status.running', error: 'status.error', aborted: 'status.aborted', completed: 'status.completed' };
const STATUS_TEXT_KEYS = { idle: '', running: 'status.runningText', error: 'status.errorText', aborted: 'status.abortedText', completed: 'status.completedText' };
const statusLabel = (status) => (STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : String(status ?? ''));
const statusText = (status) => (STATUS_TEXT_KEYS[status] ? t(STATUS_TEXT_KEYS[status]) : '');
const DEMO_ORDER = ['idle', 'running', 'completed', 'error', 'aborted'];
const LANGUAGE_OPTIONS = [
  { value: 'auto', key: 'settings.languageAuto' },
  { value: 'zh-Hans', key: 'settings.languageZh' },
  { value: 'en', key: 'settings.languageEn' },
];
const SCALES = [
  { value: 0.5, key: 'desk.scaleSmall' },
  { value: 0.75, key: 'desk.scaleMedium' },
  { value: 1, key: 'desk.scaleLarge' },
];
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const IMPORT_BODY_LIMIT = 12 * 1024 * 1024;
const THUMB_SCALE = 0.375;
const DRAG_THRESHOLD = 4;
const DIRECTION_HYSTERESIS = 12;
const LOOK_DEAD_ZONE = 1;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

function errCode(error) {
  if (error && typeof error === 'object') return error.code || error.message || 'unknown_error';
  return String(error ?? 'unknown_error');
}
function logError(tag) {
  return (error) => console.error(`[pet] ${tag}:`, errCode(error), error);
}
function setMsg(el, text, kind = 'info') {
  el.textContent = text || '';
  el.dataset.kind = kind;
}
function pointInRect(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}
function basename(path) {
  return String(path).split(/[\\/]/).pop();
}
function callBridge(fn) {
  // Bridge calls must start synchronously inside the gesture handler; this only normalizes throws.
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error);
  }
}

// ---------------------------------------------------------------------------
// Public Mini App bridge. Resource preview must be explicitly requested.
const params = new URLSearchParams(location.search);
const host = window.mcode?.miniapp ?? null;
const win = host?.window ?? null;
const agent = host?.agent ?? null;
const hostNavigation = host?.host?.navigation ?? null;
const canOpenSession = typeof hostNavigation?.open === 'function';
const explicitDemo = params.get('demo') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const prefs = { ...DEFAULT_PREFERENCES };
let preferenceWrites = Promise.resolve();
let preferenceWriteVersion = 0;
let activitySource = null;
let disposed = false;
let panelNavigation = null;
let panelDetailId = null;

const app = {
  mode: 'standalone', // 'standalone' | 'inline' | 'window'
  modeSwitching: false,
  pets: [],
  spriteUrls: new Map(),
  pet: null, // LoadedPet from the player module
  petSummary: null,
  loadError: null,
  selectToken: 0,
  source: explicitDemo ? 'demo' : 'real',
  availability: explicitDemo ? 'ready' : 'connecting',
  aggregate: null,
  hovered: false,
  workbenchOpen: false,
  workbenchView: 'tasks',
  workbenchRevision: 0,
  sessionsError: null,
  sessions: [],
  rawSessions: [],
  originSession: null,
  selectedSessionId: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  restoringPosition: false,
  awaitingPointer: false,
  positionRestoreToken: 0,
  positionTimer: null,
  demoStatus: 'idle',
  autoTimer: null,
  // window mode
  winPos: null,
  winBounds: null,
  compacting: false,
  clickThrough: null, // last value we believe the Host has; null = unknown
  ctRetryAt: 0,
  // Forwarded-mousemove watchdog: 'unknown' | 'verified' | 'broken'. Until a forwarded move is seen
  // with click-through applied, never stay click-through long enough to strand an unclickable pet.
  ctForwarding: 'unknown',
  ctAppliedAt: 0,
  ctWatchdog: null,
  ctSafeHold: false,
  ctRevertedAt: 0,
  ctRevertPointer: null,
  ctFailures: 0,
  pointer: null,
  drag: null,
  dragging: false,
  menuOpen: false,
  menuView: 'root',
  menuAnchor: { x: 0, y: 0 },
  menuCloseTimer: null,
  quickbarTimer: null,
  transient: null,
  transientTimer: null,
  bubbleSessionId: null,
  oneShot: false,
  oneShotToken: 0,
  looking: false,
};

const importState = {
  petJson: null,
  file: null,
  blobUrl: null,
  loaded: null,
  player: null,
  cycleTimer: null,
  errors: [],
  busy: false,
  generation: 0,
};

let scaleIntent = 0;
let scaleUpdates = Promise.resolve();

const disposers = [];
const menuItemByButton = new WeakMap();
function listen(target, type, listener, options) {
  target.addEventListener(type, listener, options);
  disposers.push(() => target.removeEventListener(type, listener, options));
}

const els = {
  panel: $('panel'),
  petName: $('pet-name'),
  petDesc: $('pet-desc'),
  versionBadge: $('version-badge'),
  sourceBadge: $('source-badge'),
  popoutBtn: $('popout-btn'),
  popoutMsg: $('popout-msg'),
  hostNote: $('host-note'),
  loadError: $('load-error'),
  panelStage: $('panel-stage'),
  sprite: $('pet-sprite'),
  panelStatus: $('panel-status'),
  activityNote: $('activity-note'),
  taskConnection: $('task-connection'),
  aggregateCounts: $('aggregate-counts'),
  clearCompleted: $('clear-completed'),
  reminderList: $('reminder-list'),
  reminderNote: $('reminder-note'),
  mutedReminders: $('muted-reminders'),
  mutedList: $('muted-list'),
  workbench: $('workbench'),
  activityCard: $('activity-card'),
  detailCard: $('detail-card'),
  demoControls: $('demo-controls'),
  demoStatus: $('demo-status'),
  sessionList: $('session-list'),
  sessionMsg: $('session-msg'),
  detailTitle: $('detail-title'),
  detailStatus: $('detail-status'),
  detailTime: $('detail-time'),
  detailActions: $('detail-actions'),
  detailOpen: $('detail-open'),
  detailOpenMsg: $('detail-open-msg'),
  detailError: $('detail-error'),
  detailReply: $('detail-reply'),
  detailNote: $('detail-note'),
  activityRetry: $('activity-retry'),
  preferenceMsg: $('preference-msg'),
  noticeInput: $('notice-timeout'),
  noticeMsg: $('notice-msg'),
  languageGroup: $('language-group'),
  languageMsg: $('language-msg'),
  scaleGroup: $('scale-group'),
  gallery: $('gallery'),
  galleryMsg: $('gallery-msg'),
  dropzone: $('dropzone'),
  importPick: $('import-pick'),
  importBack: $('import-back'),
  importInput: $('import-input'),
  importPreview: $('import-preview'),
  importSprite: $('import-sprite'),
  importName: $('import-name'),
  importMeta: $('import-meta'),
  importStateText: $('import-state'),
  importErrors: $('import-errors'),
  importCancel: $('import-cancel'),
  importConfirm: $('import-confirm'),
  importMsg: $('import-msg'),
  desk: $('desk'),
  deskPetSlot: $('desk-pet-slot'),
  bubble: $('bubble'),
  bubbleTitle: $('bubble-title'),
  bubbleText: $('bubble-text'),
  notificationStack: $('notification-stack'),
  quickbar: $('quickbar'),
  quickTasks: $('quick-tasks'),
  quickMenu: $('quick-menu'),
  menu: $('menu'),
};
let animationGate = null;
let workbenchView = null;
const reminders = createReminderStore();
// The desktop window is one fixed size that already fits the open card. Toggling the card
// by resizing the native window moves its origin and repaints the old layout at the new
// top-left, so the pet visibly jumped up (and left, while the card was wider). Keeping the
// geometry constant removes that class of flicker entirely; the area above the pet is
// transparent and forwards clicks.
const DESK_WIDTH = 280;
const deskHeight = (scale) => Math.max(380, Math.ceil(208 * scale) + 332);
// Saved positions are the top-left a 280x340 window would have had, so they keep working
// after the window grows: the bottom edge is what must stay fixed on screen.
const LEGACY_DESK_HEIGHT = 340;
const savedTopLeft = (position, height) => ({ x: position.x, y: position.y + LEGACY_DESK_HEIGHT - height });
let notificationPreviews = null;
let askObserver = null;
let detailOpenToken = 0;
let detailOpenSessionId = null;
// Notification cards hide on a timer; the reminder itself stays until dismissed.
const noticeShownAt = new Map();
let noticeTimer = null;
let noticePaused = false;
let noticePauseAt = 0;

// Player module is loaded dynamically so a missing/broken module surfaces in the UI instead of a blank page.
let STATES = [];
let SpritePlayer = null;
let loadPet = null;
let loadPetFromParts = null;
let player = null;

// ---------------------------------------------------------------------------
// Activity (REAL sessions bridge or DEMO)
// ---------------------------------------------------------------------------

function activity() {
  if (app.source === 'real') {
    if (app.availability !== 'ready') return { status: null, session: null, key: `unavailable:${app.availability}` };
    const notice = reminders.getState();
    return { status: notice.primary?.displayStatus ?? 'idle', session: notice.primary, key: notice.animationKey };
  }
  return { status: app.demoStatus, session: null, key: `demo:${app.demoStatus}` };
}

function activityAnim() {
  return activity().session?.needsAnswer ? 'waiting' : STATUS_ANIM[activity().status] ?? 'idle';
}

function desiredAnimation() {
  if (activity().session?.needsAnswer) return { state: 'waiting', key: activity().key };
  const base = { state: activityAnim(), key: activity().key };
  // Opening the card must not cut the hover animation short: switching rows restarts
  // the sprite at frame 0, which reads as a flicker on every click.
  if (app.hovered && app.mode === 'window' && !app.menuOpen) return { state: 'jumping', key: 'hover' };
  return base;
}

function availabilityText() {
  if (app.availability === 'not_permitted') return t('availability.notPermitted');
  if (app.availability === 'connecting') return t('availability.connecting');
  // The brackets belong to the copy: Chinese uses full-width, English ASCII.
  return t('availability.unavailable', { reason: app.sessionsError ? t('availability.reason', { code: app.sessionsError }) : '' });
}

function applyActivity() {
  renderActivityUI();
  renderBubble();
  renderMenuIfOpen();
  if (!app.pet || app.oneShot || app.dragging) return;
  const desired = desiredAnimation();
  if (!['idle', 'running', 'waving'].includes(desired.state)) stopLook();
  animationGate?.apply(desired.state, desired.key, { loop: app.source === 'demo' });
}

function playOneShot(state) {
  if (!app.pet) return;
  stopLook();
  const token = ++app.oneShotToken;
  app.oneShot = true;
  player.playTransient(state, { then: activityAnim(), repeat: 3 }).then(() => {
    if (disposed || token !== app.oneShotToken) return;
    app.oneShot = false;
    animationGate?.invalidate();
    applyActivity();
  }, logError('play_one_shot'));
}

async function initActivitySource() {
  if (explicitDemo) return;
  askObserver = createAskObserver({ agent, maxSubscriptions: 3, onChange: () => {
    if (disposed) return;
    syncObservedAsks();
    applyActivity();
  } });
  disposers.push(() => askObserver.dispose());
  activitySource = createActivitySource({
    agent,
    onChange(snapshot) {
      Object.assign(app, {
        availability: snapshot.availability, sessionsError: snapshot.error,
        rawSessions: snapshot.sessions, originSession: snapshot.originSession, aggregate: snapshot.aggregate,
        selectedSessionId: snapshot.selectedSessionId, detail: snapshot.detail,
        detailLoading: snapshot.detailLoading, detailError: snapshot.detailError,
      });
      askObserver.update({ availability: snapshot.availability, sessions: snapshot.sessions, selectedSessionId: snapshot.selectedSessionId });
      syncObservedAsks();
      renderHeader();
      applyActivity();
    },
  });
  disposers.push(() => activitySource.dispose());
  void activitySource.start();
}

function syncObservedAsks() {
  const ids = new Set(askObserver?.getState().needsAnswerIds ?? []);
  app.sessions = app.rawSessions.map((row) => ({ ...row, needsAnswer: row.status === 'running' && ids.has(row.sessionId) }));
  reminders.update(app.sessions);
}

function setDemoStatus(status) {
  if (!Object.hasOwn(STATUS_ANIM, status)) return;
  app.demoStatus = status;
  applyActivity();
}

async function initPreferences() {
  try {
    let storage = null;
    try { storage = localStorage; } catch { /* The stable API still works without browser storage. */ }
    const result = await loadPreferences(fetch, storage);
    Object.assign(prefs, result.preferences);
    setMsg(els.preferenceMsg, result.persisted ? t('settings.remembered') : t('settings.adjustHint'));
  } catch (error) {
    console.warn('[pet] preferences_load_failed:', errCode(error), error);
    setMsg(els.preferenceMsg, t('settings.loadFailed', { code: errCode(error) }), 'error');
  } finally {
    preferencesReady = true;
  }
}

function savePreferences(patch) {
  const version = ++preferenceWriteVersion;
  setMsg(els.preferenceMsg, t('settings.saving'));
  preferenceWrites = preferenceWrites.catch(() => {}).then(() => preferenceRequest(fetch, patch)).then((result) => {
    if (!result.persisted) throw new Error('preferences_not_persisted');
    if (version === preferenceWriteVersion && !disposed) setMsg(els.preferenceMsg, t('settings.remembered'), 'ok');
  }).catch((error) => {
    console.warn('[pet] preferences_save_failed:', errCode(error), error);
    if (disposed) return;
    const text = t('settings.saveFailed', { code: errCode(error) });
    setMsg(els.preferenceMsg, text, 'error');
    if (app.mode === 'window') showTransient(text, 'error');
  });
  return preferenceWrites;
}

function selectSession(sessionId, report = (text, kind) => setMsg(els.sessionMsg, text, kind)) {
  if (app.mode === 'window') { openTaskPreview(sessionId); return; }
  if (!activitySource || app.availability !== 'ready') return;
  panelNavigation?.showTaskDetail();
  callBridge(() => activitySource.selectSession(sessionId)).then(() => {
    if (app.availability !== 'ready') report(t('tasks.unavailable'), 'error');
    else report(t('tasks.selectDone'), 'ok');
  }, (error) => report(t('tasks.selectFailed', { code: errCode(error) }), 'error'));
}

// Host navigation and display preferences
// ---------------------------------------------------------------------------

function describeOpenError(code) {
  switch (code) {
    case 'target_unavailable':
      return t('tasks.openTargetUnavailable');
    case 'unsupported_source':
      return t('tasks.openUnsupportedSource');
    case 'not_permitted':
      return t('tasks.openNotPermitted');
    case 'host_unavailable':
      return t('tasks.openHostUnavailable');
    case 'result_unknown':
      return t('tasks.openUnknown');
    default:
      return t('tasks.openFailed', { code });
  }
}

/** Must be called synchronously from a click or key handler: the Host checks user activation. */
function openSessionInHost(sessionId) {
  if (!canOpenSession) return Promise.resolve({ kind: 'error', text: t('tasks.openNoApi') });
  return callBridge(() => hostNavigation.open({ id: 'session', sessionId, source: 'local' })).then(
    (result) => {
      if (result?.status === 'opened') return { kind: 'ok', text: t('tasks.openOpened') };
      if (result?.reason === 'user_cancelled') return { kind: 'info', text: t('tasks.openCancelled') };
      return { kind: 'info', text: t('tasks.openSuperseded') };
    },
    (error) => {
      const code = errCode(error);
      console.warn('[pet] open_session_failed:', code, error);
      return { kind: 'error', text: describeOpenError(code) };
    },
  );
}

function openSelectedSession() {
  const sessionId = app.selectedSessionId;
  if (!sessionId) return;
  const token = ++detailOpenToken;
  els.detailOpen.disabled = true;
  setMsg(els.detailOpenMsg, t('tasks.opening'));
  void openSessionInHost(sessionId).then((result) => {
    if (disposed || token !== detailOpenToken) return;
    els.detailOpen.disabled = false;
    setMsg(els.detailOpenMsg, result.text, result.kind);
  });
}

// The Host reports the resolved theme and interface language (MiniMax Code 3.1.11+).
// Language changes only after a client restart, so one subscription is enough.
// The stored preference decides the language, so the first paint waits for it; a Host
// state that arrives before then is only recorded.
let preferencesReady = false;

function applyLanguage(tag) {
  const next = setLanguage(tag ?? hostTag() ?? navigator.language, prefs.language);
  root.lang = next;
  applyStaticText();
  document.title = t('app.title');
  renderAll();
  renderNoticeTimeout();
  return next;
}

/** Rewrites the static copy in index.html; the HTML keeps the Chinese source text. */
function applyStaticText() {
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':').map((part) => part.trim());
      if (attr && key) node.setAttribute(attr, t(key));
    }
  }
  refreshSegmentedLabels();
}

/** The tag MiniMax Code reported, or null before its first state. */
function hostTag() {
  return root.dataset.hostLanguage ?? null;
}

function rememberHostLanguage(tag) {
  if (typeof tag !== 'string' || !tag || tag === hostTag()) return false;
  root.dataset.hostLanguage = tag;
  return true;
}

function initHostUi() {
  const ui = host?.host?.ui;
  if (typeof ui?.subscribe !== 'function') return;
  try {
    const subscription = ui.subscribe(({ theme, language }) => {
      if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
      if (rememberHostLanguage(language) && preferencesReady && prefs.language === 'auto') applyLanguage();
    }, { onError: (error) => console.warn('[pet] host_ui_unavailable:', errCode(error), error) });
    disposers.push(() => subscription?.dispose?.());
  } catch (error) {
    console.warn('[pet] host_ui_unavailable:', errCode(error), error);
  }
}

function setLanguagePreference(value) {
  if (!['auto', 'zh-Hans', 'en'].includes(value) || value === prefs.language) return;
  prefs.language = value;
  savePreferences({ language: value });
  applyLanguage();
  setMsg(els.languageMsg, value === 'auto'
    ? t('settings.languageFollows', { language: hostTag() ?? navigator.language })
    : t('settings.languageSet', { language: value }), 'ok');
}

// ---------------------------------------------------------------------------
// Window mode switching
// ---------------------------------------------------------------------------

function describeModeError(code, target) {
  const where = target === 'window' ? t('mode.whereWindow') : t('mode.wherePanel');
  switch (code) {
    case 'not_permitted':
      return t('mode.notPermitted');
    case 'busy':
      return t('mode.busy');
    case 'result_unknown':
      return t('mode.unknown', { where });
    default:
      return t('mode.failed', { code });
  }
}

async function initMode() {
  if (!host) {
    applyMode('standalone');
    return;
  }
  if (!win) {
    applyMode('inline');
    return;
  }
  try {
    const sub = win.onDidChangeState(onWindowState);
    disposers.push(() => sub?.dispose?.());
    onWindowState(await win.getState());
  } catch (error) {
    const code = errCode(error);
    console.error('[pet] window_state_unavailable:', code, error);
    applyMode('inline');
    setMsg(els.popoutMsg, t('mode.windowStateUnavailable', { code }), 'error');
  }
}

function onWindowState(state) {
  if (!state || (state.mode !== 'inline' && state.mode !== 'window')) {
    console.warn('[pet] unexpected_window_state:', state);
    return;
  }
  if (state.mode === 'window' && state.window) {
    const entering = app.mode !== 'window';
    app.winPos = { x: state.window.x, y: state.window.y };
    app.winBounds = state.window;
    if (app.mode !== 'window') app.clickThrough = state.window.clickThrough ?? null;
    if (entering) {
      const saved = prefs.windowPosition && savedTopLeft(prefs.windowPosition, deskHeight(prefs.scale));
      const token = ++app.positionRestoreToken;
      app.restoringPosition = true;
      app.awaitingPointer = true;
      applyMode('window');
      const isCurrent = () => !disposed && token === app.positionRestoreToken && app.mode === 'window';
      void restoreWindowPosition(win, saved, { isCurrent }).then(async (result) => {
        if (disposed || token !== app.positionRestoreToken || app.mode !== 'window') return;
        let restoredState = result.state;
        const height = deskHeight(prefs.scale);
        if (result.interactive && restoredState?.window && (restoredState.window.width !== DESK_WIDTH || restoredState.window.height !== height)) {
          try { restoredState = await win.update({ width: DESK_WIDTH, height }); }
          catch (error) { if (!isCurrent()) return; result.error = errCode(error); }
          if (!isCurrent()) return;
        }
        if (restoredState) onWindowState(restoredState);
        if (!isCurrent()) return;
        app.clickThrough = result.interactive ? false : null;
        app.restoringPosition = false;
        if (result.error) showTransient(result.interactive
          ? t('mode.positionFailed', { code: result.error })
          : t('mode.interactionUnknown', { code: result.error }), 'error');
        rememberPosition();
      });
      return;
    }
    if (!app.restoringPosition) rememberPosition();
  }
  if (state.mode !== app.mode) applyMode(state.mode);
}

function rememberPosition() {
  if (!app.winPos || disposed || app.compacting || app.mode !== 'window') return;
  // Stored as the bottom-right anchor: the window keeps its bottom edge while its height
  // follows the pet scale, so the pet returns to the same screen spot.
  const bounds = app.winBounds;
  const position = bounds
    ? { x: Math.round(bounds.x + bounds.width - DESK_WIDTH), y: Math.round(bounds.y + bounds.height - LEGACY_DESK_HEIGHT) }
    : { x: Math.round(app.winPos.x), y: Math.round(app.winPos.y) };
  if (prefs.windowPosition?.x === position.x && prefs.windowPosition?.y === position.y) return;
  prefs.windowPosition = position;
  clearTimeout(app.positionTimer);
  app.positionTimer = setTimeout(() => { app.positionTimer = null; void savePreferences({ windowPosition: prefs.windowPosition }); }, 250);
}

function applyMode(mode) {
  const leavingWindow = app.mode === 'window' && mode !== 'window';
  if (leavingWindow) { app.hovered = false; animationGate?.invalidate(); }
  app.mode = mode;
  app.workbenchOpen = false;
  app.compacting = false;
  app.workbenchRevision++;
  workbenchView?.close();
  root.classList.remove('workbench-open');
  if (mode !== 'window') { app.positionRestoreToken++; app.restoringPosition = false; app.awaitingPointer = false; }
  root.classList.toggle('mode-window', mode === 'window');
  root.classList.toggle('mode-inline', mode !== 'window');
  root.dataset.mode = mode;
  els.panel.hidden = mode === 'window';
  els.desk.hidden = mode !== 'window';

  closeMenu();
  hideQuickbar();
  cancelDrag();
  stopLook();
  app.pointer = null;
  clearForwardingWatchdog();
  app.ctSafeHold = false;
  if (leavingWindow) app.clickThrough = null;

  if (mode === 'window') {
    els.deskPetSlot.append(els.sprite);
    els.sprite.tabIndex = 0;
    els.sprite.setAttribute('role', 'button');
    player?.setScale(prefs.scale);
    // The manifest opens the window click-through. Until forwarded moves are proven to reach this
    // page, start interactive so the pet can never come up unclickable and undraggable.
    if (!app.restoringPosition && app.ctForwarding !== 'verified') setClickThrough(false);
  } else {
    els.panelStage.append(els.sprite);
    els.sprite.removeAttribute('tabindex');
    els.sprite.setAttribute('role', 'img');
    player?.setScale(1);
  }
  renderAll();
}

function popOut() {
  if (!win) return;
  els.popoutBtn.disabled = true;
  setMsg(els.popoutMsg, t('app.popOutBusy'));
  app.modeSwitching = true;
  // Synchronous inside the click handler: mode changes need a user gesture.
  callBridge(() => win.update({ mode: 'window', width: DESK_WIDTH, height: deskHeight(prefs.scale) }))
    .then(
      (state) => {
        setMsg(els.popoutMsg, '');
        onWindowState(state);
      },
      (error) => {
        const code = errCode(error);
        console.warn('[pet] pop_out_failed:', code, error);
        setMsg(els.popoutMsg, describeModeError(code, 'window'), 'error');
      },
    )
    .finally(() => {
      app.modeSwitching = false;
      els.popoutBtn.disabled = false;
    });
}

function returnToPanel() {
  if (!win) return Promise.resolve(false);
  app.modeSwitching = true;
  return callBridge(() => win.update({ mode: 'inline' }))
    .then((state) => { onWindowState(state); return state?.mode === 'inline'; }, (error) => {
      const code = errCode(error);
      console.warn('[pet] return_to_panel_failed:', code, error);
      showTransient(describeModeError(code, 'inline'), 'error');
      return false;
    })
    .finally(() => {
      app.modeSwitching = false;
      refreshInteractivity();
    });
}

// ---------------------------------------------------------------------------
// Click-through + pointer tracking (window mode)
// ---------------------------------------------------------------------------

let opaqueFallbackLogged = false;
function isOverPet(x, y) {
  if (!app.pet) return false;
  try {
    return player.isOpaqueAt(x, y);
  } catch (error) {
    if (!opaqueFallbackLogged) {
      opaqueFallbackLogged = true;
      console.warn('[pet] is_opaque_failed (falling back to bounding box):', errCode(error), error);
    }
    return pointInRect(els.sprite.getBoundingClientRect(), x, y);
  }
}

function isOverOverlay(x, y) {
  return [els.bubble, els.notificationStack, els.quickbar, els.menu, els.workbench].some(
    (el) => !el.hidden && pointInRect(el.getBoundingClientRect(), x, y),
  );
}

function refreshInteractivity() {
  if (app.mode !== 'window' || !win || app.modeSwitching || app.restoringPosition || app.awaitingPointer) return;
  const p = app.pointer;
  // An open card owns only the pixels it covers, not the whole expanded window:
  // the transparent margin around it must keep forwarding clicks to what is below.
  // With no pointer sample (opened from the keyboard) the card must stay clickable.
  const interactive =
    app.dragging ||
    app.menuOpen ||
    (p ? isOverPet(p.x, p.y) || isOverOverlay(p.x, p.y) : app.workbenchOpen);
  setClickThrough(!interactive);
}

function setClickThrough(value) {
  if (value && (app.ctForwarding === 'broken' || app.ctSafeHold)) value = false;
  if (value === app.clickThrough) return;
  if (app.clickThrough === null && Date.now() < app.ctRetryAt) return;
  app.clickThrough = value;
  clearForwardingWatchdog();
  app.ctAppliedAt = 0;
  callBridge(() => win.update({ clickThrough: value })).then(
    () => {
      if (!value || app.clickThrough !== true || app.mode !== 'window') return;
      app.ctAppliedAt = performance.now();
      if (app.ctForwarding === 'unknown') armForwardingWatchdog();
    },
    (error) => {
      const code = errCode(error);
      console.warn('[pet] click_through_update_failed:', code, error);
      if (app.mode === 'window') {
        app.clickThrough = null;
        app.ctRetryAt = Date.now() + 1000;
      }
    },
  );
}

function armForwardingWatchdog() {
  const armPointer = app.pointer;
  app.ctWatchdog = setTimeout(() => {
    app.ctWatchdog = null;
    if (app.mode !== 'window' || app.clickThrough !== true) return;
    console.warn('[pet] click_through_unverified_reverted');
    app.ctSafeHold = true;
    app.ctRevertedAt = performance.now();
    app.ctRevertPointer = armPointer;
    setClickThrough(false);
  }, 1500);
}

function clearForwardingWatchdog() {
  if (app.ctWatchdog) clearTimeout(app.ctWatchdog);
  app.ctWatchdog = null;
}

/** Called for every document mousemove in window mode, before interactivity is recomputed. */
function noteForwardedMove(e) {
  if (
    app.ctForwarding === 'unknown' &&
    app.clickThrough === true &&
    app.ctAppliedAt > 0 &&
    e.timeStamp > app.ctAppliedAt
  ) {
    app.ctForwarding = 'verified';
    clearForwardingWatchdog();
    console.info('[pet] click_through_forwarding_verified');
  }
  if (!app.ctSafeHold) return;
  // First move after a watchdog revert. A quick move far from where the pointer was when
  // click-through turned on means the user kept moving and we saw none of it: forwarding failed.
  const p = app.ctRevertPointer;
  const quick = performance.now() - app.ctRevertedAt < 150;
  const far = p ? Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8 : true;
  app.ctSafeHold = false;
  if (!(quick && far)) return;
  app.ctFailures += 1;
  if (app.ctFailures >= 3) {
    app.ctForwarding = 'broken';
    console.warn('[pet] click_through_forwarding_unavailable');
    showTransient(t('desk.transientTimeout'), 'error');
  }
}

function insideDesk(x, y) {
  return pointInRect(els.desk.getBoundingClientRect(), x, y);
}

function onDocumentMouseMove(e) {
  if (app.mode !== 'window') return;
  if (app.restoringPosition) return;
  app.awaitingPointer = false;
  noteForwardedMove(e);
  if (!app.dragging && !insideDesk(e.clientX, e.clientY)) {
    onPointerLeave();
    return;
  }
  app.pointer = { x: e.clientX, y: e.clientY };
  refreshInteractivity();
  trackMenuHover(e.clientX, e.clientY);
  updateLook(e.clientX, e.clientY);
}

function onPointerLeave() {
  if (app.mode !== 'window') return;
  app.pointer = null;
  stopLook();
  refreshInteractivity(); // stays interactive while menu/drag force it
  if (app.menuOpen) armMenuClose();
}

// ---------------------------------------------------------------------------
// Look direction (v2) + idle liveliness
// ---------------------------------------------------------------------------

function updateLook(x, y) {
  if (!app.pet || !player.supportsLook) return;
  if (
    app.mode !== 'window' ||
    app.hovered ||
    app.dragging ||
    app.menuOpen ||
    app.oneShot ||
    app.workbenchOpen ||
    reducedMotion.matches ||
    !['idle', 'running', 'waving'].includes(activityAnim())
  ) {
    stopLook();
    return;
  }
  const r = els.sprite.getBoundingClientRect();
  const dx = x - (r.left + r.width / 2);
  const dy = y - (r.top + r.height / 2);
  if (Math.hypot(dx, dy) <= LOOK_DEAD_ZONE) {
    stopLook();
    return;
  }
  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0° = up, clockwise
  if (angle < 0) angle += 360;
  player.look(angle);
  app.looking = true;
}

function stopLook() {
  if (!app.looking) return;
  app.looking = false;
  player?.look(null);
}

function noteInteraction() {
  // Deliberate interactions own transient animations; no random idle interruptions.
}

// ---------------------------------------------------------------------------
// Dragging
// ---------------------------------------------------------------------------

function onSpritePointerDown(e) {
  if (app.mode !== 'window' || e.button !== 0 || !app.pet) return;
  noteInteraction();
  if (app.menuOpen) closeMenu();
  e.preventDefault();
  try {
    els.sprite.setPointerCapture(e.pointerId);
  } catch (error) {
    console.warn('[pet] pointer_capture_failed:', errCode(error), error);
  }
  const origin = app.winPos ? { ...app.winPos } : null;
  app.drag = {
    pointerId: e.pointerId,
    // The pointer is measured inside the window, so the window goes where the
    // pointer is, minus the offset it was grabbed at.
    grabX: e.clientX,
    grabY: e.clientY,
    // Window origin at grab time; null when the Host reported no position.
    base: origin,
    // Window origin the Host confirmed, and the target of the request in
    // flight. The Host can move the window before it answers the request.
    origin: origin ? { ...origin } : null,
    inflight: null,
    // Pointer position on screen, tracked across events.
    pointer: origin ? { x: origin.x + e.clientX, y: origin.y + e.clientY } : null,
    // Latest target not sent yet, and whether an update is already in flight.
    pending: null,
    sending: false,
    // Reference for the run direction: the window origin when it is known,
    // otherwise the pointer position inside the window.
    ref: origin ? origin.x : e.clientX,
    active: false,
    dir: null,
    extreme: origin ? origin.x : e.clientX,
  };
}

function onSpritePointerMove(e) {
  const d = app.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  const dx = e.clientX - d.grabX;
  const dy = e.clientY - d.grabY;
  const target = d.origin ? dragTarget(d, e) : null;
  if (!d.active) {
    // How far the pointer travelled on screen, not inside the window.
    const travel = target ? { x: target.x - d.base.x, y: target.y - d.base.y } : { x: dx, y: dy };
    if (Math.hypot(travel.x, travel.y) <= DRAG_THRESHOLD) return;
    d.active = true;
    app.dragging = true;
    app.oneShotToken++;
    app.oneShot = false;
    stopLook();
    hideQuickbar();
    els.sprite.classList.add('is-dragging');
    refreshInteractivity();
    if (!d.origin) console.warn('[pet] drag_without_window_position: no window position yet, animation only');
  }
  if (!target) {
    // No window position: the pet still runs, but nothing can move.
    updateDragDirection(d, e.clientX);
    return;
  }
  // Keep only the latest target; one update is in flight at a time.
  d.pending = target;
  flushDrag(d);
}

// Where the window belongs: the pointer position minus the grab offset. The
// pointer is measured inside the window, so its position needs the origin of
// the frame it was measured in: the origin the Host confirmed, or the target
// the Host already moved to while the answer is still pending. The pointer
// moves a few pixels between events, a window move is bigger than that, so
// the pointer itself tells which frame the event used.
function dragTarget(d, e) {
  const frames = d.inflight ? [d.origin, d.inflight] : [d.origin];
  let pointer = null;
  let nearest = Infinity;
  for (const frame of frames) {
    const p = { x: frame.x + e.clientX, y: frame.y + e.clientY };
    const moved = d.pointer ? Math.hypot(p.x - d.pointer.x, p.y - d.pointer.y) : 0;
    if (moved < nearest) {
      nearest = moved;
      pointer = p;
    }
  }
  d.pointer = pointer;
  return { x: Math.round(pointer.x - d.grabX), y: Math.round(pointer.y - d.grabY) };
}

// One window update at a time. The Host answers with the position it holds,
// so the next target is measured against a confirmed position, and a refused
// update can never roll the window back past a later accepted one.
function flushDrag(d) {
  if (d.sending || !d.pending) return;
  const target = d.pending;
  d.pending = null;
  if (target.x === d.origin.x && target.y === d.origin.y) return;
  d.sending = true;
  d.inflight = target;
  updateDragDirection(d, target.x);
  callBridge(() => win.update({ x: target.x, y: target.y })).then((state) => {
    d.sending = false;
    d.inflight = null;
    const moved = state?.window;
    if (moved) {
      d.origin = { x: moved.x, y: moved.y };
      app.winPos = { x: moved.x, y: moved.y };
    } else if (app.winPos) d.origin = { ...app.winPos };
    flushDrag(d);
  }, (error) => {
    d.sending = false;
    d.inflight = null;
    // The Host refused the move and kept the window where it was.
    if (app.winPos) d.origin = { ...app.winPos };
    const code = errCode(error);
    if (code === 'not_permitted') console.debug('[pet] drag_move_rejected: not_permitted (target is off every display)');
    else console.warn('[pet] drag_move_failed:', code, error);
    flushDrag(d);
  });
}

function updateDragDirection(d, sx) {
  const before = d.dir;
  if (d.dir === 'right') {
    if (sx > d.extreme) d.extreme = sx;
    else if (d.extreme - sx > DIRECTION_HYSTERESIS) {
      d.dir = 'left';
      d.extreme = sx;
    }
  } else if (d.dir === 'left') {
    if (sx < d.extreme) d.extreme = sx;
    else if (sx - d.extreme > DIRECTION_HYSTERESIS) {
      d.dir = 'right';
      d.extreme = sx;
    }
  } else if (Math.abs(sx - d.ref) > DIRECTION_HYSTERESIS / 2) {
    d.dir = sx > d.ref ? 'right' : 'left';
    d.extreme = sx;
  }
  if (d.dir !== before) {
    player.play(d.dir === 'right' ? 'running-right' : 'running-left').catch(logError('play_drag'));
  }
}

function finishDrag(e, cancelled) {
  const d = app.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  app.drag = null;
  // The last pointer position is where the pet belongs: send it.
  if (!cancelled) flushDrag(d);
  try {
    if (els.sprite.hasPointerCapture(e.pointerId)) els.sprite.releasePointerCapture(e.pointerId);
  } catch (error) {
    console.warn('[pet] pointer_release_failed:', errCode(error), error);
  }
  els.sprite.classList.remove('is-dragging');
  if (d.active) {
    app.dragging = false;
    if (cancelled || desiredAnimation().state === 'jumping') {
      // Hover already owns the same three-cycle jump; release must not queue it twice.
      animationGate?.invalidate(); applyActivity();
    } else playOneShot('jumping');
    callBridge(() => win.getState()).then(onWindowState, logError('get_state_after_drag'));
  } else if (!cancelled) {
    void openWorkbench('tasks');
  }
  refreshInteractivity();
}

function cancelDrag() {
  if (!app.drag && !app.dragging) return;
  app.drag = null;
  app.dragging = false;
  els.sprite.classList.remove('is-dragging');
}

// ---------------------------------------------------------------------------
// Bubble / quick bar (window mode)
// ---------------------------------------------------------------------------

function showTransient(text, kind = 'info', sticky = false) {
  clearTimeout(app.transientTimer);
  app.transient = text ? { text, kind } : null;
  if (text && !sticky) {
    app.transientTimer = setTimeout(() => {
      app.transient = null;
      renderBubble();
    }, 4000);
  }
  renderBubble();
}

function renderBubble() {
  renderNotificationStack();
  if (app.workbenchOpen) {
    els.bubble.hidden = true;
    app.bubbleSessionId = null;
    refreshInteractivity();
    return;
  }
  const a = activity();
  let title = '';
  let text = '';
  let kind = 'info';
  let clickable = false;
  if (app.transient) {
    ({ text, kind } = app.transient);
  } else if (!app.pet && app.loadError) {
    text = app.loadError;
    kind = 'error';
  } else if (app.source === 'real' && app.availability !== 'ready') {
    text = availabilityText();
    kind = app.availability === 'connecting' ? 'info' : 'error';
  } else {
    if (a.session) {
      text = a.session.needsAnswer ? t('status.needsAnswer') : a.status === 'running' ? '' : statusText(a.status);
      title = a.session.title;
      clickable = !!text;
    }

  }
  if (app.source === 'demo') {
    title = t('tasks.demoTitle');
    text = statusText(app.demoStatus) ? t('tasks.demoStatus', { status: statusText(app.demoStatus) }) : '';
    clickable = false;
  }
  els.bubbleTitle.textContent = title;
  els.bubbleTitle.hidden = !title;
  els.bubbleText.textContent = text;
  els.bubble.dataset.kind = kind;
  els.bubble.classList.toggle('is-clickable', clickable);
  els.bubble.tabIndex = text ? 0 : -1;
  els.bubble.setAttribute('aria-label', text
    ? (title ? t('desk.bubbleAriaTitle', { title, text }) : t('desk.bubbleAria', { text }))
    : t('desk.bubbleIdle'));
  els.bubble.hidden = !text || (!app.transient && !els.notificationStack.hidden);
  app.bubbleSessionId = clickable && a.session ? a.session.sessionId : null;
  refreshInteractivity();
}

function stopNoticeTimer() {
  clearTimeout(noticeTimer);
  noticeTimer = null;
}

function armNoticeTimer(shown) {
  stopNoticeTimer();
  if (!(prefs.noticeTimeout > 0) || noticePaused || !shown.length) return;
  let next = Infinity;
  for (const item of shown) {
    const remaining = noticeRemaining(item, { shownAt: noticeShownAt, now: Date.now(), timeoutSeconds: prefs.noticeTimeout });
    if (remaining !== null) next = Math.min(next, remaining);
  }
  if (!Number.isFinite(next)) return;
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    renderBubble();
  }, Math.max(250, next + 50));
}

function pauseNotices(paused) {
  if (paused === noticePaused) return;
  const now = Date.now();
  noticePaused = paused;
  if (paused) { noticePauseAt = now; return; }
  // Shift every card's start by the paused span so the remaining time is exact.
  const pausedMs = now - noticePauseAt;
  noticePauseAt = 0;
  if (pausedMs > 0) for (const [id, since] of noticeShownAt) noticeShownAt.set(id, since + pausedMs);
  renderBubble();
}

function renderNotificationStack() {
  const container = els.notificationStack;
  const all = notificationItems(reminders.getState().items);
  const now = Date.now();
  // Records the moment a card first appeared; a card that stays hidden by the
  // workbench keeps its original start instead of restarting on every paint.
  for (const item of all) if (!noticeShownAt.has(item.sessionId)) noticeShownAt.set(item.sessionId, now);
  for (const id of [...noticeShownAt.keys()]) if (!all.some((item) => item.sessionId === id)) noticeShownAt.delete(id);
  const items = visibleNotices(all, { shownAt: noticeShownAt, now, timeoutSeconds: prefs.noticeTimeout });
  const visible = app.mode === 'window' && app.availability === 'ready' && items.length
    && !app.workbenchOpen && !app.transient;
  container.hidden = !visible;
  // Keep a timer running only while cards can actually expire on screen.
  if (visible) armNoticeTimer(items); else stopNoticeTimer();
  if (!visible) return;
  const previews = notificationPreviews?.getState().previews ?? {};
  const existing = new Map([...container.children].map((node) => [node.dataset.sessionId, node]));
  const nodes = items.map((item) => {
    let node = existing.get(item.sessionId);
    if (!node) {
      node = document.createElement('div'); node.className = 'pet-notice'; node.dataset.sessionId = item.sessionId;
      const open = document.createElement('button'); open.type = 'button'; open.className = 'pet-notice-open';
      const title = document.createElement('strong'), preview = document.createElement('span'); preview.className = 'pet-notice-preview';
      open.append(title, preview);
      open.addEventListener('click', () => { openTaskPreview(node.dataset.sessionId); });
      const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'pet-notice-dismiss'; dismiss.textContent = '×';
      dismiss.addEventListener('click', () => { reminders.dismiss(node.dataset.sessionId); applyActivity(); });
      node.append(open, dismiss);
    }
    const open = node.children[0];
    open.children[0].textContent = item.title;
    // A notification shows a five-line preview, so markdown is flattened, not rendered.
    open.children[1].textContent = markdownToPlainText(notificationText(item, previews));
    open.setAttribute('aria-label', t('desk.noticeView', { title: item.title }));
    node.children[1].setAttribute('aria-label', t('desk.noticeClose', { title: item.title }));
    return node;
  });
  if (nodes.length !== container.children.length || nodes.some((node, i) => node !== container.children[i])) container.replaceChildren(...nodes);
}

function toggleQuickbar() {
  if (els.quickbar.hidden) showQuickbar();
  else hideQuickbar();
}
function showQuickbar() {
  if (app.mode !== 'window') return;
  els.quickbar.hidden = false;
  armQuickbarHide();
  refreshInteractivity();
}
function hideQuickbar() {
  clearTimeout(app.quickbarTimer);
  if (els.quickbar.hidden) return;
  els.quickbar.hidden = true;
  refreshInteractivity();
}
function armQuickbarHide() {
  clearTimeout(app.quickbarTimer);
  app.quickbarTimer = setTimeout(() => {
    const p = app.pointer;
    if (p && pointInRect(els.quickbar.getBoundingClientRect(), p.x, p.y)) armQuickbarHide();
    else hideQuickbar();
  }, 6000);
}

// ---------------------------------------------------------------------------
// Context menu (window mode)
// ---------------------------------------------------------------------------

const MENU_TITLES = {
  root: 'desk.menu',
  demo: 'desk.menuDemoTitle',
  sessions: 'desk.menuAllTasks',
  pets: 'desk.menuPets',
  scale: 'desk.menuScale',
};

function menuModel(view) {
  if (view === 'demo') {
    return [
      ...DEMO_ORDER.map((s) => ({
        label: statusLabel(s),
        role: 'menuitemradio',
        checked: app.demoStatus === s,
        run: () => setDemoStatus(s),
      })),
    ];
  }
  if (view === 'sessions') {
    if (!app.sessions.length) return [{ label: t('desk.menuEmptySessions'), disabled: true }];
    return app.sessions.map((s) => ({
      label: s.title,
      detail: statusLabel(s.status),
      disabled: false,
      run: () => selectSession(s.sessionId, showTransient),
    }));
  }
  if (view === 'pets') {
    if (!app.pets.length) return [{ label: t('desk.menuEmptyPets'), disabled: true }];
    return app.pets.map((p) => ({
      label: p.displayName,
      detail: `v${p.version}`,
      role: 'menuitemradio',
      checked: app.pet?.id === p.id,
      run: () => selectPet(p.id),
    }));
  }
  if (view === 'scale') {
    return SCALES.map((s) => ({
      label: t(s.key),
      role: 'menuitemradio',
      checked: prefs.scale === s.value,
      run: () => setScale(s.value),
    }));
  }
  return [
    app.source === 'demo' && { label: t('desk.menuDemo'), submenu: 'demo' },
    app.source === 'real' && app.availability === 'ready' && { label: t('desk.menuAllTasks'), run: () => { void openWorkbench('tasks'); } },
    app.source === 'real' && app.availability !== 'ready' && { label: t('desk.menuReconnect'), run: () => { void activitySource?.refresh(); } },
    { label: t('desk.menuPets'), submenu: 'pets' },
    { label: t('desk.menuScale'), submenu: 'scale' },
    win && { label: t('desk.menuCollapse'), run: returnToPanel },
  ].filter(Boolean);
}

function menuButton(item) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'menu-item';
  b.tabIndex = -1;
  b.setAttribute('role', item.role ?? 'menuitem');
  if (item.role === 'menuitemradio' || item.role === 'menuitemcheckbox') {
    b.setAttribute('aria-checked', String(Boolean(item.checked)));
  }
  if (item.submenu) b.setAttribute('aria-haspopup', 'menu');
  if (item.disabled) b.setAttribute('aria-disabled', 'true');

  const mark = document.createElement('span');
  mark.className = 'mi-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = item.back ? '‹' : item.checked ? '✓' : '';
  const label = document.createElement('span');
  label.className = 'mi-label';
  label.textContent = item.label;
  b.append(mark, label);
  if (item.detail) {
    const detail = document.createElement('span');
    detail.className = 'mi-detail';
    detail.textContent = item.detail;
    b.append(detail);
  }
  if (item.submenu) {
    const arrow = document.createElement('span');
    arrow.className = 'mi-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';
    b.append(arrow);
  }
  b.addEventListener('click', () => activateMenuItem(item));
  menuItemByButton.set(b, item);
  return b;
}

function activateMenuItem(item) {
  if (item.disabled) return;
  if (item.back) {
    goMenu('root');
    return;
  }
  if (item.submenu) {
    goMenu(item.submenu);
    return;
  }
  // Runs synchronously inside the click/keydown, so gesture-gated bridge calls stay valid.
  // Run before closing: returnToPanel sets modeSwitching first, so closing does not queue a
  // clickThrough patch that would race the mode switch (inline_mode).
  item.run();
  closeMenu();
}

function goMenu(view) {
  app.menuView = view;
  renderMenu(0);
}

function renderMenu(focusIndex = 0) {
  const nodes = [];
  if (app.menuView !== 'root') nodes.push(menuButton({ label: t('desk.menuBack'), back: true }));
  for (const item of menuModel(app.menuView)) nodes.push(menuButton(item));
  els.menu.replaceChildren(...nodes);
  els.menu.setAttribute('aria-label', t(MENU_TITLES[app.menuView] ?? 'desk.menu'));
  els.menu.hidden = false;
  positionMenu();
  const buttons = menuButtons();
  buttons[clamp(focusIndex, 0, buttons.length - 1)]?.focus({ preventScroll: true });
  refreshInteractivity();
}

function renderMenuIfOpen() {
  if (!app.menuOpen) return;
  const buttons = menuButtons();
  const index = Math.max(0, buttons.indexOf(document.activeElement));
  if (app.menuView === 'demo' && app.source !== 'demo') app.menuView = 'root';
  if (app.menuView === 'sessions' && app.source !== 'real') app.menuView = 'root';
  renderMenu(index);
}

function menuButtons() {
  return [...els.menu.querySelectorAll('.menu-item')];
}

function positionMenu() {
  const desk = els.desk.getBoundingClientRect();
  els.menu.style.left = '0px';
  els.menu.style.top = '0px';
  const m = els.menu.getBoundingClientRect();
  const left = clamp(app.menuAnchor.x - desk.left - 8, 4, Math.max(4, desk.width - m.width - 4));
  const top = clamp(app.menuAnchor.y - desk.top - 8, 4, Math.max(4, desk.height - m.height - 4));
  els.menu.style.left = `${Math.round(left)}px`;
  els.menu.style.top = `${Math.round(top)}px`;
}

function openMenu(x, y) {
  if (app.mode !== 'window') return;
  noteInteraction();
  hideQuickbar();
  stopLook();
  disarmMenuClose();
  app.menuOpen = true;
  app.menuView = 'root';
  app.menuAnchor = { x, y };
  renderMenu(0);
}

function closeMenu({ restoreFocus = false } = {}) {
  if (!app.menuOpen) return;
  app.menuOpen = false;
  disarmMenuClose();
  els.menu.hidden = true;
  els.menu.replaceChildren();
  if (restoreFocus) els.sprite.focus({ preventScroll: true });
  refreshInteractivity();
}

function trackMenuHover(x, y) {
  if (!app.menuOpen) return;
  if (pointInRect(els.menu.getBoundingClientRect(), x, y)) disarmMenuClose();
  else armMenuClose();
}
function armMenuClose() {
  if (!app.menuCloseTimer) app.menuCloseTimer = setTimeout(() => closeMenu(), 1500);
}
function disarmMenuClose() {
  clearTimeout(app.menuCloseTimer);
  app.menuCloseTimer = null;
}

function onMenuKeyDown(e) {
  const buttons = menuButtons();
  const i = buttons.indexOf(document.activeElement);
  const focusAt = (n) => buttons[(n + buttons.length) % buttons.length]?.focus({ preventScroll: false });
  const item = menuItemByButton.get(document.activeElement);
  switch (e.key) {
    case 'ArrowDown':
      focusAt(i + 1);
      break;
    case 'ArrowUp':
      focusAt(i < 0 ? -1 : i - 1);
      break;
    case 'Home':
      focusAt(0);
      break;
    case 'End':
      focusAt(-1);
      break;
    case 'ArrowRight':
      if (item?.submenu) goMenu(item.submenu);
      break;
    case 'ArrowLeft':
    case 'Backspace':
      if (app.menuView !== 'root') goMenu('root');
      break;
    case 'Escape':
    case 'Tab':
      closeMenu({ restoreFocus: true });
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
}

// ---------------------------------------------------------------------------
// Pets: list, select, delete
// ---------------------------------------------------------------------------

async function readErrorBody(res) {
  try {
    const body = await res.json();
    return { code: body?.error || `http_${res.status}`, message: body?.message || '' };
  } catch (error) {
    console.warn('[pet] error_body_not_json:', res.status, error);
    return { code: `http_${res.status}`, message: '' };
  }
}

async function refreshPets() {
  let res;
  try {
    res = await fetch('/api/pets', { cache: 'no-store' });
  } catch (error) {
    throw Object.assign(new Error(t('appearance.readListFailed')), { code: 'pets_list_unreachable', cause: error });
  }
  if (!res.ok) {
    const { code, message } = await readErrorBody(res);
    throw Object.assign(new Error(message || t('appearance.readListFailed')), { code });
  }
  const body = await res.json();
  app.pets = Array.isArray(body?.pets) ? body.pets : [];
  app.spriteUrls.clear();
  renderGallery();
  renderMenuIfOpen();
  resolveThumbs();
}

async function resolveThumbs() {
  const results = await Promise.allSettled(
    app.pets.map(async (pet) => {
      const jsonUrl = new URL(pet.petJsonUrl, location.href);
      const res = await fetch(jsonUrl, { cache: 'no-store' });
      if (!res.ok) throw Object.assign(new Error(`pet.json HTTP ${res.status}`), { code: 'thumb_pet_json_unreadable' });
      const json = await res.json();
      app.spriteUrls.set(pet.id, new URL(json.spritesheetPath, jsonUrl).href);
    }),
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.warn('[pet] thumb_failed:', app.pets[i]?.id, errCode(r.reason), r.reason);
  });
  renderGallery();
}

async function selectPet(id) {
  const summary = app.pets.find((p) => p.id === id);
  if (!summary) {
    showLoadError({ code: 'pet_not_found', message: t('appearance.missingId', { id }) });
    return 'failed';
  }
  const token = ++app.selectToken;
  let result = 'selected';
  setMsg(els.galleryMsg, t('appearance.loadingPet', { name: summary.displayName }));
  try {
    const loaded = await loadPet(new URL(summary.petJsonUrl, location.href).href);
    if (token !== app.selectToken) return 'superseded';
    stopLook();
    app.pet = loaded;
    app.petSummary = summary;
    player.setPet(loaded);
    app.oneShot = false;
    app.oneShotToken++;
    animationGate?.invalidate(); applyActivity();
    prefs.petId = id;
    savePreferences({ petId: id });
    showLoadError(null);
    setMsg(els.galleryMsg, '');
  } catch (error) {
    if (token !== app.selectToken) return 'superseded';
    showLoadError(error, summary.displayName);
    setMsg(els.galleryMsg, '');
    result = 'failed';
  }
  renderAll();
  return result;
}

function showLoadError(error, name) {
  if (!error) {
    app.loadError = null;
    els.loadError.hidden = true;
    els.loadError.textContent = '';
    renderBubble();
    return;
  }
  const code = errCode(error);
  const detail = error.message && error.message !== code ? `：${error.message}` : '';
  const text = t('appearance.loadFailedDetail', { name: name ? `「${name}」` : '', code, detail });
  console.error('[pet] load_failed:', code, error);
  app.loadError = text;
  els.loadError.textContent = text;
  els.loadError.hidden = false;
  if (app.mode === 'window' && app.pet) showTransient(text, 'error');
  renderBubble();
}

async function deletePet(pet) {
  if (!window.confirm(t('appearance.confirmDelete', { name: pet.displayName }))) {
    setMsg(els.galleryMsg, t('appearance.deleteCancelled'));
    return;
  }
  setMsg(els.galleryMsg, t('appearance.deleting', { name: pet.displayName }));
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(pet.id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const { code, message } = await readErrorBody(res);
      setMsg(els.galleryMsg, t('appearance.deleteFailed', { code, detail: message ? `：${message}` : '' }), 'error');
      return;
    }
    await refreshPets();
    setMsg(els.galleryMsg, t('appearance.deleted', { name: pet.displayName }), 'ok');
    if (app.pet?.id === pet.id || prefs.petId === pet.id) {
      const next = app.pets[0];
      if (next) await selectPet(next.id);
    }
  } catch (error) {
    const code = errCode(error);
    console.error('[pet] delete_failed:', code, error);
    setMsg(els.galleryMsg, t('appearance.deleteFailed', { code, detail: '' }), 'error');
  }
}

function setScale(value) {
  const intent = ++scaleIntent;
  const current = () => !disposed && intent === scaleIntent;
  scaleUpdates = scaleUpdates.then(async () => {
    if (!current()) return;
    if (app.workbenchOpen) await closeWorkbench();
    if (!current()) return;
    if (app.mode === 'window') {
      // The window height follows the pet size so the open card still fits. Anchor the
      // bottom-right corner, which is what the stored position and the pet's slot use.
      const height = deskHeight(value);
      const patch = { width: DESK_WIDTH, height };
      if (app.winBounds) {
        patch.x = Math.round(app.winBounds.x + app.winBounds.width - DESK_WIDTH);
        patch.y = Math.round(app.winBounds.y + app.winBounds.height - height);
      }
      let state = null;
      try { state = await win.update(patch); }
      catch (error) {
        if (!current()) return;
        showTransient(t('mode.resizeFailed', { code: errCode(error) }), 'error');
        return;
      }
      if (!current()) return;
      if (state) onWindowState(state);
      // The Host only requires the transparent window to overlap a display.
      // Fit its whole content area before shrinking so opaque pet pixels remain reachable.
      const result = await fitWindowToScreen(win, {
        screenRect: () => ({ x: screen.availLeft, y: screen.availTop, width: screen.availWidth, height: screen.availHeight }),
        isCurrent: () => current() && app.mode === 'window',
      });
      if (!current() || result.cancelled) return;
      if (result.error) { showTransient(t('mode.resizeFailed', { code: result.error }), 'error'); return; }
      if (result.state) onWindowState(result.state);
      player.setScale(value);
      if (app.menuOpen) positionMenu();
      refreshInteractivity();
    }
    prefs.scale = value;
    savePreferences({ scale: value });
    renderScale();
  }).catch(logError('scale_update'));
  return scaleUpdates;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function resetImport() {
  importState.generation++;
  clearInterval(importState.cycleTimer);
  importState.player?.destroy();
  if (importState.blobUrl) URL.revokeObjectURL(importState.blobUrl);
  Object.assign(importState, {
    petJson: null,
    file: null,
    blobUrl: null,
    loaded: null,
    player: null,
    cycleTimer: null,
    errors: [],
    busy: false,
  });
  els.importSprite.removeAttribute('style');
  els.importPreview.hidden = true;
  els.importErrors.replaceChildren();
  els.importStateText.textContent = '';
}

function renderImportErrors() {
  els.importErrors.replaceChildren(
    ...importState.errors.map(({ code, message }) => {
      const li = document.createElement('li');
      const c = document.createElement('code');
      c.textContent = code;
      li.append(c, ` ${message}`);
      return li;
    }),
  );
  els.importConfirm.disabled = importState.busy || importState.errors.length > 0 || !importState.loaded;
  els.importPick.disabled = importState.busy;
  els.importInput.disabled = importState.busy;
  els.importCancel.disabled = importState.busy;
  if (els.importBack) els.importBack.disabled = importState.busy;
}

function precheckImport(petJson, file) {
  const errs = [];
  if (typeof petJson.id !== 'string' || !ID_RE.test(petJson.id)) {
    errs.push({ code: 'invalid_id', message: t('import.invalidId') });
  } else if (app.pets.some((p) => p.id === petJson.id && p.source === 'bundled')) {
    errs.push({ code: 'bundled_conflict', message: t('import.bundledConflict') });
  }
  if (typeof petJson.displayName !== 'string' || petJson.displayName.length < 1 || petJson.displayName.length > 80) {
    errs.push({ code: 'invalid_pet_json', message: t('import.displayNameRange') });
  }
  if (petJson.description != null && (typeof petJson.description !== 'string' || petJson.description.length > 300)) {
    errs.push({ code: 'invalid_pet_json', message: t('import.descriptionRange') });
  }
  if (!/^[^/\\]+\.(webp|png)$/.test(petJson.spritesheetPath)) {
    errs.push({ code: 'invalid_sprite_name', message: t('import.spriteNameRule') });
  }
  if (Math.ceil(file.size / 3) * 4 + 4096 > IMPORT_BODY_LIMIT) {
    errs.push({ code: 'payload_too_large', message: t('import.tooLarge') });
  }
  return errs;
}

async function handleImportFiles(fileList) {
  if (importState.busy) return;
  resetImport();
  const generation = importState.generation;
  const current = () => !disposed && generation === importState.generation;
  setMsg(els.importMsg, '');
  const files = [...fileList];
  const jsons = files.filter((f) => /\.json$/i.test(f.name));
  if (jsons.length !== 1) {
    setMsg(
      els.importMsg,
      jsons.length === 0
        ? t('import.noJson')
        : t('import.tooManyJson'),
      'error',
    );
    return;
  }
  let petJson;
  try {
    petJson = JSON.parse(await jsons[0].text());
  } catch (error) {
    if (!current()) return;
    console.warn('[pet] import_pet_json_unreadable:', error);
    setMsg(els.importMsg, t('import.unreadableJson'), 'error');
    return;
  }
  if (!current()) return;
  if (!petJson || typeof petJson !== 'object' || Array.isArray(petJson) || typeof petJson.spritesheetPath !== 'string') {
    setMsg(els.importMsg, t('import.noSpritesheetPath'), 'error');
    return;
  }
  const spriteName = basename(petJson.spritesheetPath);
  const file = files.find((f) => f.name === spriteName);
  if (!file) {
    setMsg(els.importMsg, t('import.noSprite', { name: spriteName }), 'error');
    return;
  }

  importState.petJson = petJson;
  importState.file = file;
  importState.blobUrl = URL.createObjectURL(file);
  importState.errors = precheckImport(petJson, file);
  els.importName.textContent = petJson.displayName || petJson.id || t('import.unnamed');
  els.importMeta.textContent = t('import.meta', { id: petJson.id ?? '—', file: file.name, kb: Math.round(file.size / 1024) });
  els.importPreview.hidden = false;
  els.importStateText.textContent = t('import.checking');
  renderImportErrors();

  const blobUrl = importState.blobUrl;
  try {
    const loaded = await loadPetFromParts(petJson, blobUrl);
    if (!current() || importState.blobUrl !== blobUrl) return;
    importState.loaded = loaded;
    els.importMeta.textContent += t('import.metaVersion', { version: loaded.version, looks: loaded.version === 2 ? t('appearance.looks') : '' });
    startImportPreview(loaded);
  } catch (error) {
    if (!current() || importState.blobUrl !== blobUrl) return;
    const code = errCode(error);
    console.warn('[pet] import_preview_failed:', code, error);
    importState.errors.push({ code, message: error?.message && error.message !== code ? error.message : t('import.previewFailed') });
    els.importStateText.textContent = '';
  }
  renderImportErrors();
}

function startImportPreview(loaded) {
  const preview = new SpritePlayer(els.importSprite, { scale: 0.75 });
  preview.setReducedMotion(reducedMotion.matches);
  preview.setPet(loaded);
  importState.player = preview;
  let i = 0;
  const step = () => {
    const state = STATES[i % STATES.length];
    i++;
    preview.play(state, { loop: true }).catch(logError('import_preview_play'));
    els.importStateText.textContent = t('import.previewState', { state, index: ((i - 1) % STATES.length) + 1, total: STATES.length });
  };
  step();
  importState.cycleTimer = setInterval(step, 1200);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(Object.assign(new Error(t('import.spriteUnreadable')), { code: 'sprite_unreadable', cause: reader.error }));
    reader.readAsDataURL(file);
  });
}

async function postPet(body) {
  const res = await fetch('/api/pets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (error) {
    console.warn('[pet] import_response_not_json:', res.status, error);
  }
  return { res, data };
}

async function confirmImport() {
  const { petJson, file } = importState;
  if (!petJson || !file || !importState.loaded || importState.errors.length || importState.busy) return;
  let generation = importState.generation;
  let saved = false;
  const current = () => !disposed && generation === importState.generation;
  importState.busy = true;
  renderImportErrors();
  setMsg(els.importMsg, t('import.sessionBusy'));
  try {
    const base64 = await fileToBase64(file);
    if (!current()) return;
    const payload = { petJson, spritesheet: { fileName: file.name, base64 } };
    let { res, data } = await postPet(payload);
    if (!current()) return;
    if (res.status === 409 && data?.error === 'pet_exists') {
      if (!window.confirm(t('import.alreadyExists', { id: petJson.id }))) {
        setMsg(els.importMsg, t('import.cancelledKept'));
        return;
      }
      ({ res, data } = await postPet({ ...payload, replace: true }));
      if (!current()) return;
    }
    if (!res.ok) {
      const code = data?.error || `http_${res.status}`;
      setMsg(els.importMsg, t('import.failed', { code, detail: data?.message ? `：${data.message}` : '' }), 'error');
      return;
    }
    const newId = data?.pet?.id ?? petJson.id;
    saved = true;
    resetImport();
    generation = importState.generation;
    importState.busy = true;
    renderImportErrors();
    await refreshPets();
    if (!current()) return;
    const selection = await selectPet(newId);
    if (!current()) return;
    if (selection === 'failed') {
      const message = t('import.loadFailedAfterImport');
      setMsg(els.importMsg, message, 'error');
      setMsg(els.galleryMsg, message, 'error');
      return;
    }
    if (selection !== 'selected' || app.pet?.id !== newId) {
      setMsg(els.importMsg, t('import.keptSelection'), 'ok');
      return;
    }
    panelNavigation?.completeImport();
    const message = t('import.success', { name: data?.pet?.displayName ?? newId });
    setMsg(els.importMsg, message, 'ok');
    setMsg(els.galleryMsg, message, 'ok');
  } catch (error) {
    if (!current()) return;
    const code = errCode(error);
    console.error('[pet] import_failed:', code, error);
    setMsg(els.importMsg, saved
      ? t('import.listFailedAfterImport', { code })
      : t('import.failedCode', { code }), 'error');
  } finally {
    if (current()) { importState.busy = false; renderImportErrors(); }
  }
}

// ---------------------------------------------------------------------------
// Rendering (inline panel)
// ---------------------------------------------------------------------------

function renderAll() {
  renderHeader();
  renderActivityUI();
  renderScale();
  renderNoticeTimeout();
  renderLanguage();
  renderGallery();
  renderBubble();
}

function renderHeader() {
  const pet = app.pet;
  els.petName.textContent = pet?.displayName ?? (app.loadError ? t('appearance.loadFailed') : t('appearance.loading'));
  els.petDesc.textContent = pet?.description ?? '';
  els.versionBadge.hidden = !pet;
  els.versionBadge.textContent = pet?.version === 2 ? t('appearance.v2') : 'v1';
  const sourceLabel = app.source === 'demo' ? t('availability.demo') : app.availability === 'ready' ? t('availability.real') : app.availability === 'connecting' ? t('availability.connectingShort') : app.availability === 'not_permitted' ? t('availability.notPermittedShort') : t('availability.unavailableShort');
  els.sourceBadge.textContent = sourceLabel;
  els.sourceBadge.dataset.source = app.source;
  els.popoutBtn.hidden = !win || app.mode === 'window';

  let note = '';
  if (app.mode === 'standalone') {
    note = t('app.hostNote.browser');
  } else if (!win) {
    note = t('app.hostNote.noWindow');
  }
  els.hostNote.textContent = note;
  els.hostNote.hidden = !note;
}

function renderActivityUI() {
  const a = activity();
  const real = app.source === 'real';
  els.demoControls.hidden = real;
  const available = real && app.availability === 'ready';
  panelNavigation?.update({ reminderCount: reminders.getState().items.length, availability: app.availability });
  els.taskConnection.hidden = available || !real;
  if (!available && real) setMsg(els.taskConnection, t('availability.reconnectHint', { text: availabilityText() }), app.availability === 'connecting' ? 'info' : 'error');
  els.sessionList.hidden = !available;
  els.activityRetry.hidden = !real || available;
  if (available) {
    const coverage = askObserver?.getState();
    els.activityNote.textContent = t('tasks.coverage', { watching: coverage?.watchingIds.length ?? 0, running: coverage?.runningCount ?? 0 });
    renderSessionList(a.session);
  } else if (real) {
    els.activityNote.textContent = availabilityText();
    els.sessionList.replaceChildren();
  } else {
    els.activityNote.textContent = t('tasks.demoHint');
    syncSegmented(els.demoStatus, app.demoStatus);
  }
  els.aggregateCounts.textContent = available ? aggregateText(app.aggregate?.counts, localeFor()) : '';
  els.clearCompleted.hidden = !available || !app.aggregate?.counts.completed;
  renderReminders();
  const text = real && !available ? availabilityText() : a.session?.needsAnswer ? t('status.needsAnswer') : a.session || !real ? statusText(a.status) || t('status.idleNow') : t('tasks.noCurrent');
  els.panelStatus.textContent = a.session?.needsAnswer ? t('status.needsAnswerFor', { title: a.session.title }) : a.session && statusText(a.status) ? `「${a.session.title}」${text}` : text;
  renderDetail();
  const name = app.pet?.displayName ?? t('desk.pet');
  const stateLabel = a.session?.needsAnswer ? t('status.needsAnswer') : statusLabel(a.status) || sourceLabelForActivity();
  els.sprite.setAttribute('aria-label', app.mode === 'window'
    ? t('desk.petAriaWindow', { name, state: stateLabel }) : t('desk.petAria', { name, state: stateLabel }));

}

function sourceLabelForActivity() { return app.availability === 'connecting' ? t('availability.connectingShort') : app.availability === 'not_permitted' ? t('availability.readNotPermitted') : t('availability.sessionUnavailable'); }

function renderSessionList(current) {
  const focusedId = els.sessionList.contains(document.activeElement) ? document.activeElement?.dataset?.sessionId : null;
  const scrollTop = els.sessionList.scrollTop;
  const items = app.sessions.map((s) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'session-row';
    btn.dataset.sessionId = s.sessionId;
    btn.disabled = false;
    const title = document.createElement('span');
    title.className = 'session-title';
    title.textContent = s.title;
    title.title = s.title;
    const pill = document.createElement('span');
    pill.className = 'pill';
    const displayStatus = taskStatus(s);
    pill.dataset.status = displayStatus === 'needs_answer' ? 'needs_input' : displayStatus;
    pill.textContent = s.needsAnswer ? t('status.needsAnswer') : statusLabel(displayStatus);
    btn.append(title);
    if (current?.sessionId === s.sessionId) {
      const tag = document.createElement('span');
      tag.className = 'session-current';
      tag.textContent = t('status.currentHint');
      btn.append(tag);
    }
    btn.append(pill);
    if (app.selectedSessionId === s.sessionId) btn.setAttribute('aria-current', 'true');
    btn.setAttribute('aria-label', t('tasks.sessionRow', { title: s.title, status: pill.textContent }));
    btn.addEventListener('click', () => selectSession(s.sessionId, (t, k) => setMsg(els.sessionMsg, t, k)));
    li.append(btn);
    return li;
  });
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = t('tasks.noSessions');
    items.push(li);
  }
  els.sessionList.replaceChildren(...items);
  els.sessionList.scrollTop = scrollTop;
  if (focusedId) els.sessionList.querySelector(`[data-session-id="${CSS.escape(focusedId)}"]`)?.focus();
}

function renderDetail() {
  const detail = app.detail;
  const session = app.sessions.find((row) => row.sessionId === app.selectedSessionId);
  const needsAnswer = session?.needsAnswer;
  els.detailTitle.textContent = detail?.title || t('tasks.summary');
  const status = taskStatus(session) || taskStatus(detail);
  els.detailStatus.textContent = needsAnswer ? t('status.needsAnswer') : detail ? statusLabel(status) : '—';
  els.detailTime.textContent = detail ? new Date(detail.updatedAtMs).toLocaleString(localeFor()) : '—';
  els.detailError.textContent = detail?.error || app.detailError || '';
  els.detailError.hidden = !els.detailError.textContent;
  const reply = needsAnswer ? t('status.needsAnswer') : detail?.lastAssistantText || '';
  // The reply is markdown; renderMarkdown keeps the DOM when the text is unchanged,
  // so a background refresh cannot disturb the reading position.
  renderMarkdown(els.detailReply, reply);
  if (panelDetailId !== app.selectedSessionId) { els.detailReply.scrollTop = 0; panelDetailId = app.selectedSessionId; }
  renderDetailOpen(needsAnswer);
  els.detailNote.textContent = app.source === 'demo' ? t('tasks.demoNote')
    : app.availability !== 'ready' ? availabilityText()
      : app.detailLoading ? (detail ? t('tasks.replyUpdating') : t('tasks.replyLoading')) : !detail ? t('tasks.selectHint')
        : needsAnswer ? (canOpenSession ? t('tasks.answerNextOpen') : t('tasks.answerNextChat'))
          : detail.lastAssistantText ? t('tasks.replyNote', { next: canOpenSession ? t('tasks.replyNextOpen') : t('tasks.replyNextChat') }) : t('tasks.replyEmpty');
}

function renderDetailOpen(needsAnswer) {
  // Only a different task resets a pending open; a brief disconnect just hides the button.
  if (detailOpenSessionId !== app.selectedSessionId) {
    detailOpenSessionId = app.selectedSessionId;
    detailOpenToken++;
    els.detailOpen.disabled = false;
    setMsg(els.detailOpenMsg, '');
  }
  els.detailActions.hidden = !canOpenSession || !app.selectedSessionId || app.source !== 'real' || app.availability !== 'ready';
  els.detailOpen.textContent = needsAnswer ? t('tasks.goAnswer') : t('tasks.open');
}

function initWorkbench() {
  workbenchView = createCompactPetView({ container: els.workbench,
    onClose: () => { void closeWorkbench(); },
    onSelectTask: openTaskPreview,
    onOpenSession: canOpenSession ? openSessionInHost : null,
  });
  notificationPreviews = createNotificationPreviews({ agent, onChange: () => { renderBubble(); renderCompactView(); } });
  disposers.push(() => { notificationPreviews.dispose(); workbenchView.dispose(); });
}

function renderCompactView() {
  const notice = reminders.getState();
  notificationPreviews?.update({ availability: app.availability, items: notificationItems(notice.items) });
  const previews = notificationPreviews?.getState().previews ?? {};
  workbenchView?.update({ reminders: { ...notice, items: notice.items.map((item) => ({ ...item, previewText: item.needsAnswer ? t('status.needsAnswer') : markdownToPlainText(previews[item.sessionId] || '') })) }, allSessions: app.sessions,
    taskSelection: { availability: app.availability, selectedSessionId: app.selectedSessionId, session: app.sessions.find((row) => row.sessionId === app.selectedSessionId), detail: app.detail, detailLoading: app.detailLoading, detailError: app.detailError } });
}

function openTaskPreview(sessionId) {
  if (!activitySource || app.availability !== 'ready') { showTransient(availabilityText(), 'error'); return; }
  try { void activitySource.selectSession(sessionId).catch((error) => showTransient(t('desk.replyFailed', { code: errCode(error) }), 'error')); }
  catch (error) { showTransient(t('desk.replyFailed', { code: errCode(error) }), 'error'); return; }
  void openWorkbench('detail');
}

function focusFullPanel(view) {
  if (view === 'detail') panelNavigation?.showTaskDetail();
  else { panelNavigation?.showTab('tasks'); panelNavigation?.showTaskList(); }
}

async function openWorkbench(view = 'tasks') {
  if (disposed) return;
  app.workbenchView = view;
  if (app.mode !== 'window') {
    focusFullPanel(view);
    return;
  }
  const token = ++app.workbenchRevision;
  app.compacting = false;
  app.workbenchOpen = true;
  closeMenu(); hideQuickbar(); stopLook();
  setClickThrough(false);
  const waitingAt = Date.now();
  while (app.restoringPosition && token === app.workbenchRevision && !disposed && Date.now() - waitingAt < 3000) await new Promise((resolve) => setTimeout(resolve, 20));
  if (disposed || token !== app.workbenchRevision || app.mode !== 'window' || !app.workbenchOpen) return;
  workbenchView.open(view);
  root.classList.add('workbench-open');
  applyActivity();
}

async function closeWorkbench() {
  const token = ++app.workbenchRevision;
  app.compacting = true;
  app.workbenchOpen = false;
  workbenchView.close();
  root.classList.remove('workbench-open');
  applyActivity();
  app.compacting = false;
  if (!disposed && token === app.workbenchRevision && app.mode === 'window' && !app.workbenchOpen) refreshInteractivity();
}

function renderReminders() {
  const state = reminders.getState();
  renderCompactView();
  els.reminderNote.textContent = state.items.length ? t('tasks.reminderNote.active') : t('tasks.reminderNote.idle');
  const existing = new Map([...els.reminderList.children].map((node) => [node.dataset.sessionId, node]));
  const nodes = state.items.slice(0, 10).map((item) => {
    let li = existing.get(item.sessionId);
    if (!li) {
      li = document.createElement('li'); li.className = 'reminder-item'; li.dataset.sessionId = item.sessionId;
      const title = document.createElement('button'); title.type = 'button'; title.className = 'reminder-title';
      title.addEventListener('click', () => { selectSession(item.sessionId); });
      const status = document.createElement('span'); status.className = 'pill';
      const actions = document.createElement('div'); actions.className = 'row';
      const mute = document.createElement('button'); mute.type = 'button'; mute.className = 'btn small'; mute.textContent = t('tasks.mute');
      mute.addEventListener('click', () => { reminders.mute(item.sessionId); applyActivity(); });
      actions.append(mute); li.append(title, status, actions);
    }
    li.children[0].textContent = item.title;
    li.children[0].setAttribute('aria-label', t('tasks.viewReminder', { title: item.title }));
    li.children[1].textContent = item.needsAnswer ? t('status.needsAnswer') : statusLabel(item.displayStatus); li.children[1].dataset.status = item.needsAnswer ? 'needs_input' : item.displayStatus;
    li.children[2].children[0].setAttribute('aria-label', t('tasks.muteTitle', { title: item.title }));
    return li;
  });
  if (!nodes.length) { const empty = document.createElement('li'); empty.className = 'muted'; empty.textContent = t('tasks.noReminder'); nodes.push(empty); }
  const focused = document.activeElement;
  if (nodes.length !== els.reminderList.children.length || nodes.some((node, i) => node !== els.reminderList.children[i])) els.reminderList.replaceChildren(...nodes);
  if (focused?.isConnected && els.reminderList.contains(focused)) focused.focus({ preventScroll: true });
  els.mutedReminders.hidden = !state.mutedIds.length;
  const mutedButtons = new Map([...els.mutedList.children].map((button) => [button.dataset.sessionId, button]));
  const mutedFocus = document.activeElement;
  const mutedNodes = state.mutedIds.map((id) => {
    let button = mutedButtons.get(id);
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.className = 'btn small'; button.dataset.sessionId = id;
      button.addEventListener('click', () => { reminders.unmute(id); applyActivity(); });
    }
    button.textContent = t('settings.restoreReminder', { title: app.sessions.find((row) => row.sessionId === id)?.title || t('settings.restoreFallback') });
    return button;
  });
  if (mutedNodes.length !== els.mutedList.children.length || mutedNodes.some((node, i) => node !== els.mutedList.children[i])) els.mutedList.replaceChildren(...mutedNodes);
  if (mutedFocus?.isConnected && els.mutedList.contains(mutedFocus)) mutedFocus.focus({ preventScroll: true });
}

function renderLanguage() {
  syncSegmented(els.languageGroup, prefs.language);
}

function renderNoticeTimeout() {
  if (document.activeElement !== els.noticeInput) els.noticeInput.value = String(prefs.noticeTimeout);
  els.noticeInput.setAttribute('aria-describedby', 'notice-msg');
}

function setNoticeTimeout(raw) {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? Math.round(parsed) : prefs.noticeTimeout;
  const next = Math.min(Math.max(value, 0), MAX_NOTICE_TIMEOUT_SECONDS);
  els.noticeInput.value = String(next);
  if (next === prefs.noticeTimeout) { setMsg(els.noticeMsg, ''); return; }
  prefs.noticeTimeout = next;
  // Restart every card's clock so the new duration applies from now.
  const at = Date.now();
  for (const id of noticeShownAt.keys()) noticeShownAt.set(id, at);
  // Keep counting from now if the input is focused while the pointer stays on a card.
  noticePauseAt = noticePaused ? at : 0;
  setMsg(els.noticeMsg, next === 0 ? t('settings.noticeNever') : t('settings.noticeSaved', { seconds: next }), 'ok');
  savePreferences({ noticeTimeout: next });
  renderBubble();
}

function renderScale() {
  root.style.setProperty('--minimax-pet-height', `${208 * prefs.scale}px`);
  syncSegmented(els.scaleGroup, prefs.scale);
}

function renderGallery() {
  const focusedPetId = document.activeElement?.dataset?.petId;
  const items = app.pets.map((pet) => {
    const selected = app.pet?.id === pet.id;
    const li = document.createElement('li');
    li.className = 'pet-card';
    li.dataset.selected = String(selected);

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'pet-pick';
    pick.dataset.petId = pet.id;
    pick.setAttribute('aria-pressed', String(selected));
    pick.setAttribute('aria-label', t('appearance.use', { name: pet.displayName }));
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    thumb.setAttribute('aria-hidden', 'true');
    const url = app.spriteUrls.get(pet.id);
    if (url) {
      thumb.style.backgroundImage = `url(${JSON.stringify(url)})`;
      thumb.style.backgroundSize = `${1536 * THUMB_SCALE}px auto`;
    }
    const info = document.createElement('span');
    info.className = 'pet-info';
    const name = document.createElement('span');
    name.className = 'pet-card-name';
    name.textContent = pet.displayName;
    name.title = pet.description || pet.displayName;
    const meta = document.createElement('span');
    meta.className = 'pet-card-meta';
    const ver = document.createElement('span');
    ver.className = 'badge';
    ver.textContent = `v${pet.version}`;
    const src = document.createElement('span');
    src.className = 'badge';
    src.textContent = pet.source === 'imported' ? t('appearance.imported') : t('appearance.bundled');
    meta.append(ver, src);
    if (selected) {
      const on = document.createElement('span');
      on.className = 'badge is-selected';
      on.textContent = t('appearance.inUse');
      meta.append(on);
    }
    info.append(name, meta);
    pick.append(thumb, info);
    pick.addEventListener('click', () => selectPet(pet.id));
    li.append(pick);

    if (pet.source === 'imported') {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn small danger';
      del.textContent = t('appearance.delete');
      del.setAttribute('aria-label', t('appearance.deletePet', { name: pet.displayName }));
      del.addEventListener('click', () => deletePet(pet));
      li.append(del);
    }
    return li;
  });
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = t('appearance.noPets');
    items.push(li);
  }
  els.gallery.replaceChildren(...items);
  if (focusedPetId) els.gallery.querySelector(`[data-pet-id="${CSS.escape(focusedPetId)}"]`)?.focus();
}

function buildSegmented(fieldset, name, options, onChange) {
  for (const opt of options) {
    const label = document.createElement('label');
    label.className = 'seg-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(opt.value);
    input.addEventListener('change', () => {
      if (input.checked) onChange(opt.value);
    });
    const span = document.createElement('span');
    // Options name a key when their label follows the interface language.
    if (opt.key) span.dataset.labelKey = opt.key;
    span.textContent = opt.label ?? t(opt.key);
    label.append(input, span);
    fieldset.append(label);
  }
}

function syncSegmented(fieldset, value) {
  for (const input of fieldset.querySelectorAll('input')) input.checked = input.value === String(value);
}

/** Rewrites option labels after a language change; the radios and their state stay put. */
function refreshSegmentedLabels() {
  for (const span of document.querySelectorAll('.seg-option [data-label-key]')) {
    span.textContent = t(span.dataset.labelKey);
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function bindPanel() {
  buildSegmented(
    els.demoStatus,
    'demo-status',
    DEMO_ORDER.map((s) => ({ value: s, label: statusLabel(s) })),
    setDemoStatus,
  );
  buildSegmented(els.scaleGroup, 'scale', SCALES, setScale);
  buildSegmented(els.languageGroup, 'language', LANGUAGE_OPTIONS, setLanguagePreference);
  listen(els.activityRetry, 'click', () => { void activitySource?.refresh(); });
  listen(els.clearCompleted, 'click', () => { activitySource?.clearCompleted(); });
  listen(els.popoutBtn, 'click', popOut);
  listen(els.detailOpen, 'click', openSelectedSession);
  listen(els.noticeInput, 'change', () => setNoticeTimeout(els.noticeInput.value));
  listen(els.noticeInput, 'blur', () => setNoticeTimeout(els.noticeInput.value));
  listen(window, 'languagechange', () => { if (prefs.language === 'auto' && !hostTag()) applyLanguage(); });

  listen(els.importPick, 'click', () => els.importInput.click());
  listen(els.importInput, 'change', () => {
    const files = els.importInput.files;
    if (files?.length) handleImportFiles(files).catch(logError('import_files'));
    els.importInput.value = '';
  });
  listen(els.dropzone, 'dragover', (e) => {
    e.preventDefault();
    els.dropzone.classList.add('is-over');
  });
  listen(els.dropzone, 'dragleave', (e) => {
    if (!els.dropzone.contains(e.relatedTarget)) els.dropzone.classList.remove('is-over');
  });
  listen(els.dropzone, 'drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('is-over');
    const files = e.dataTransfer?.files;
    if (files?.length) handleImportFiles(files).catch(logError('import_drop'));
  });
  // A stray drop elsewhere must not navigate the managed page to the file.
  listen(document, 'dragover', (e) => e.preventDefault());
  listen(document, 'drop', (e) => e.preventDefault());
  listen(els.importCancel, 'click', () => {
    panelNavigation?.closeImport();
  });
  listen(els.importConfirm, 'click', () => confirmImport());
}

function bindDesk() {
  listen(document, 'mousemove', onDocumentMouseMove);
  listen(document, 'mouseout', (e) => {
    if (!e.relatedTarget) onPointerLeave();
  });
  listen(root, 'mouseleave', onPointerLeave);
  listen(window, 'blur', () => {
    if (app.mode === 'window') closeMenu();
  });

  listen(els.sprite, 'pointerenter', () => { if (app.mode !== 'window') return; app.hovered = true; applyActivity(); });
  listen(els.sprite, 'pointerleave', () => { app.hovered = false; applyActivity(); });
  listen(els.sprite, 'pointerdown', onSpritePointerDown);
  listen(els.sprite, 'pointermove', onSpritePointerMove);
  listen(els.sprite, 'pointerup', (e) => finishDrag(e, false));
  listen(els.sprite, 'pointercancel', (e) => finishDrag(e, true));
  listen(els.sprite, 'keydown', (e) => {
    if (app.mode !== 'window') return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      noteInteraction();
      void openWorkbench('tasks');
    } else if (e.key === 'F10' && e.shiftKey) {
      e.preventDefault();
      const r = els.sprite.getBoundingClientRect();
      openMenu(r.left + r.width / 2, r.top + r.height / 2);
    }
  });

  listen(document, 'contextmenu', (e) => {
    if (app.mode !== 'window') return;
    if (els.workbench.contains(e.target)) return;
    e.preventDefault();
    if (!els.desk.contains(e.target) || els.menu.contains(e.target)) return;
    let { clientX: x, clientY: y } = e;
    if (x === 0 && y === 0) {
      // Keyboard ContextMenu key: anchor to the sprite.
      const r = els.sprite.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    openMenu(x, y);
  });

  listen(document, 'pointerdown', (e) => {
    if (app.mode !== 'window') return;
    noteInteraction();
    if (app.menuOpen && !els.menu.contains(e.target)) closeMenu();
  });

  listen(document, 'keydown', (e) => {
    if (app.mode !== 'window' || e.key !== 'Escape') return;
    if (app.workbenchOpen) { void closeWorkbench(); }
    else hideQuickbar();
  });

  listen(els.menu, 'keydown', onMenuKeyDown);

  listen(els.quickTasks, 'click', () => { void openWorkbench('tasks'); });
  listen(els.bubble, 'click', () => { void openWorkbench('tasks'); });
  listen(els.bubble, 'keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openWorkbench('tasks'); }
  });
  listen(els.quickMenu, 'click', () => {
    const r = els.quickMenu.getBoundingClientRect();
    openMenu(r.left + r.width / 2, r.bottom);
  });
  listen(els.quickbar, 'pointerenter', armQuickbarHide);

  // Reading a card, with a pointer or a keyboard, must outlast the timeout.
  listen(els.notificationStack, 'pointerenter', () => pauseNotices(true));
  listen(els.notificationStack, 'pointerleave', () => pauseNotices(false));
  listen(els.notificationStack, 'focusin', () => pauseNotices(true));
  listen(els.notificationStack, 'focusout', (e) => {
    if (!els.notificationStack.contains(e.relatedTarget)) pauseNotices(false);
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function showFatal(text) {
  root.classList.remove('booting');
  els.loadError.textContent = text;
  els.loadError.hidden = false;
}

async function boot() {
  player = new SpritePlayer(els.sprite, { scale: 1 });
  animationGate = createAnimationGate(player, logError('play_activity'));
  player.setReducedMotion(reducedMotion.matches);
  panelNavigation = createPanelNavigation({
    panel: els.panel,
    beforeCloseImport() {
      if (importState.busy) return false;
      resetImport(); setMsg(els.importMsg, t('import.cancelled')); return true;
    },
  });
  disposers.push(() => panelNavigation.dispose());
  listen(reducedMotion, 'change', (e) => {
    player.setReducedMotion(e.matches);
    importState.player?.setReducedMotion(e.matches);
    if (e.matches) stopLook();
  });

  initHostUi();
  bindPanel();
  initWorkbench();
  bindDesk();
  listen(window, 'pagehide', disposeApp);
  await initPreferences();
  if (disposed) return;
  applyLanguage();
  await initMode();
  if (disposed) return;
  root.classList.remove('booting');
  await initActivitySource();
  renderAll();

  try {
    await refreshPets();
  } catch (error) {
    showLoadError(error);
  }
  const initial = app.pets.find((p) => p.id === prefs.petId) ?? app.pets[0];
  if (initial) await selectPet(initial.id);
  else if (!app.loadError) showLoadError({ code: 'no_pets', message: t('appearance.noPetsReason') });
  renderAll();
  noteInteraction();

}

function disposeApp() {
  if (disposed) return;
  disposed = true;
  for (const dispose of disposers.splice(0).reverse()) {
    try { dispose(); } catch (error) { console.warn('[pet] dispose_failed:', errCode(error), error); }
  }
  stopNoticeTimer();
  noticeShownAt.clear();
  for (const key of ['positionTimer', 'ctWatchdog', 'menuCloseTimer', 'quickbarTimer', 'transientTimer']) {
    clearTimeout(app[key]);
    clearInterval(app[key]);
    app[key] = null;
  }
  clearInterval(importState.cycleTimer);
  importState.player?.destroy();
  if (importState.blobUrl) URL.revokeObjectURL(importState.blobUrl);
  player?.destroy();
}

try {
  const mod = await import('/assets/pet-player.js');
  ({ STATES, SpritePlayer, loadPet, loadPetFromParts } = mod);
  if (typeof SpritePlayer !== 'function' || typeof loadPet !== 'function' || typeof loadPetFromParts !== 'function') {
    throw Object.assign(new Error('player_module_invalid: missing exports'), { code: 'player_module_invalid' });
  }
} catch (error) {
  console.error('[pet] player_module_unavailable:', errCode(error), error);
  SpritePlayer = null;
  showFatal(t('app.fatal.player', { code: error?.code ?? 'player_module_unavailable' }));
}

if (SpritePlayer) {
  boot().catch((error) => {
    console.error('[pet] boot_failed:', errCode(error), error);
    showFatal(t('app.fatal.boot', { code: errCode(error) }));
  });
}
