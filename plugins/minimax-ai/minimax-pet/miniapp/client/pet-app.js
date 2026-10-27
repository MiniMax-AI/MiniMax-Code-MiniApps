// Desktop pet page: a three-tab inline panel and a compact desktop companion.
import { STATUS_ANIM, createActivitySource } from './activity.mjs';
import { DEFAULT_PREFERENCES, loadPreferences, preferenceRequest } from './preferences.mjs';
import { bindDraftEntry, createDraftController } from './chat-draft.mjs';
import { createSpeechInput } from './speech-input.mjs';
import { restoreWindowPosition, fitWindowToScreen } from './window-position.mjs';
import { aggregateText, notificationItems, notificationText, createAnimationGate } from './pet-presentation.mjs';
import { createReminderStore } from './activity-reminders.mjs';
import { createCompactPetView, taskStatus } from './compact-pet-view.mjs';
import { createWorkbenchWindow } from './workbench-window.mjs';
import { createNotificationPreviews } from './notification-previews.mjs';
import { createAskObserver } from './ask-observer.mjs';
import { createPanelNavigation } from './panel-navigation.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_TEXT = { idle: '', running: '正在工作…', error: '任务出现异常', aborted: '任务已停止', completed: '任务已完成' };
const STATUS_LABEL = { idle: '空闲', running: '工作中', error: '异常', aborted: '已停止', completed: '已完成' };
const DEMO_ORDER = ['idle', 'running', 'completed', 'error', 'aborted'];
const SCALES = [
  { value: 0.5, label: '小' },
  { value: 0.75, label: '中' },
  { value: 1, label: '大' },
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
const canAppend = typeof host?.message?.append === 'function';
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
  composerOpen: false,
  composerFocused: false,
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
  waveBtn: $('wave-btn'),
  jumpBtn: $('jump-btn'),
  activityNote: $('activity-note'),
  taskConnection: $('task-connection'),
  aggregateCounts: $('aggregate-counts'),
  clearCompleted: $('clear-completed'),
  speechSection: $('speech-section'),
  draftSpeech: $('draft-speech'),
  reminderList: $('reminder-list'),
  reminderNote: $('reminder-note'),
  mutedReminders: $('muted-reminders'),
  mutedList: $('muted-list'),
  workbench: $('workbench'),
  activityCard: $('activity-card'),
  detailCard: $('detail-card'),
  draftCard: $('draft-card'),
  demoControls: $('demo-controls'),
  demoStatus: $('demo-status'),
  sessionList: $('session-list'),
  sessionMsg: $('session-msg'),
  detailTitle: $('detail-title'),
  detailStatus: $('detail-status'),
  detailTime: $('detail-time'),
  detailError: $('detail-error'),
  detailReply: $('detail-reply'),
  detailNote: $('detail-note'),
  speechControls: $('speech-controls'),
  speechStart: $('speech-start'),
  speechStop: $('speech-stop'),
  speechCancel: $('speech-cancel'),
  speechMsg: $('speech-msg'),
  speechPartial: $('speech-partial'),
  activityRetry: $('activity-retry'),
  preferenceMsg: $('preference-msg'),
  talkForm: $('talk-form'),
  talkText: $('talk-text'),
  talkBtn: $('talk-btn'),
  talkMsg: $('talk-msg'),
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
  composer: $('composer'),
  composerInput: $('composer-input'),
  composerSend: $('composer-send'),
  composerClose: $('composer-close'),
  composerMsg: $('composer-msg'),
  draftOrigin: $('draft-origin'),
  composerOrigin: $('composer-origin'),
  menu: $('menu'),
};
const draftController = createDraftController({ message: host?.message, onChange: renderDraftControls });
let speechInput = null;
let speechState = 'idle';
let animationGate = null;
let workbenchView = null;
let workbenchWindow = null;
const reminders = createReminderStore();
const compactBubbleSize = { width: 300, height: 340 };
let notificationPreviews = null;
let askObserver = null;

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
  if (app.hovered && app.mode === 'window' && !app.menuOpen && !app.composerOpen && !app.workbenchOpen) return { state: 'jumping', key: 'hover' };
  return base;
}

function availabilityText() {
  if (app.availability === 'not_permitted') return '请先在插件详情中允许读取会话，再重试。';
  if (app.availability === 'connecting') return '正在连接本机任务…';
  return `暂时无法读取本机任务${app.sessionsError ? `（${app.sessionsError}）` : ''}。可重新连接。`;
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
      draftController.setOrigin(snapshot.originSession);
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
    setMsg(els.preferenceMsg, result.persisted ? '偏好已保存到本机。' : '调整后会保存到本机。');
  } catch (error) {
    console.warn('[pet] preferences_load_failed:', errCode(error), error);
    setMsg(els.preferenceMsg, `偏好读取失败（${errCode(error)}），当前使用临时设置。`, 'error');
  }
}

function savePreferences(patch) {
  const version = ++preferenceWriteVersion;
  setMsg(els.preferenceMsg, '正在保存偏好…');
  preferenceWrites = preferenceWrites.catch(() => {}).then(() => preferenceRequest(fetch, patch)).then((result) => {
    if (!result.persisted) throw new Error('preferences_not_persisted');
    if (version === preferenceWriteVersion && !disposed) setMsg(els.preferenceMsg, '偏好已保存到本机。', 'ok');
  }).catch((error) => {
    console.warn('[pet] preferences_save_failed:', errCode(error), error);
    if (disposed) return;
    const text = `偏好未保存（${errCode(error)}），本次调整仅临时生效。`;
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
    if (app.availability !== 'ready') report('任务信息暂不可用', 'error');
    else report('已切换任务详情；桌宠继续聚合全部任务。', 'ok');
  }, (error) => report(`无法关注此任务（${errCode(error)}）`, 'error'));
}

// Host message.append
// ---------------------------------------------------------------------------

function describeAppendError(code) {
  switch (code) {
    case 'user_cancelled':
      return '已取消';
    case 'target_unavailable':
      return '打开桌宠的原属对话不可用，文字已保留。请从可用的聊天重新打开桌宠。';
    case 'not_permitted':
      return '无法追加到原属对话。请直接点击重试；文字已保留。';
    case 'unsupported':
      return '当前环境不能加到对话输入框。';
    case 'empty':
      return '先写点什么吧';
    case 'busy':
      return '正在等待上一次确认，文字已保留。';
    case 'result_unknown':
      return '请先检查输入框，文本可能已经加进去了';
    default:
      return `没能加到输入框（${code}），请检查对话后再试`;
  }
}

function draftResultText(result) {
  if (!result.ok) return describeAppendError(result.code);
  return `已加到「${result.submission.title}」的输入框，仍需你在对话里按发送。${result.clear ? '' : '新编辑的草稿已保留。'}`;
}

function renderDraftControls() {
  const state = draftController.getState();
  els.talkBtn.disabled = !canAppend || state.pending;
  els.composerSend.disabled = !canAppend || state.pending;
  const target = state.origin ? `原属对话：${state.origin.title}` : '投递到打开桌宠的原属对话，由 Host 确认。';
  els.draftOrigin.textContent = target;
  els.composerOrigin.textContent = target;
  els.composerOrigin.title = target;
}

function bindDraftForms() {
  disposers.push(() => draftController.dispose());
  for (const [entry, form, input, message] of [
    ['panel', els.talkForm, els.talkText, els.talkMsg],
    ['desktop', els.composer, els.composerInput, els.composerMsg],
  ]) {
    disposers.push(bindDraftEntry({
      controller: draftController, entry, form, input,
      onPending(submission) { setMsg(message, `请在 Host 确认框核对「${submission.title}」及文字…`); },
      onResult(result) {
        const text = draftResultText(result);
        setMsg(message, text, result.ok ? 'ok' : result.code === 'user_cancelled' || result.code === 'empty' ? 'info' : 'error');
        if (result.ok) playOneShot('waving');
        if (entry === 'desktop' && result.ok && result.clear) { closeComposer(); showTransient(text, 'ok'); }
      },
    }));
  }
}

// ---------------------------------------------------------------------------
// Window mode switching
// ---------------------------------------------------------------------------

function describeModeError(code, target) {
  const where = target === 'window' ? '桌面上是否已经出现宠物' : '宠物是否已经回到面板';
  switch (code) {
    case 'not_permitted':
      return '需要直接点击才能切换窗口（not_permitted）';
    case 'busy':
      return '窗口正在切换，请稍候再试（busy）';
    case 'result_unknown':
      return `没收到切换结果，请看看${where}（result_unknown）`;
    default:
      return `切换失败（${code}）`;
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
    setMsg(els.popoutMsg, `读不到窗口状态（${code}）`, 'error');
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
      const saved = prefs.windowPosition;
      const token = ++app.positionRestoreToken;
      app.restoringPosition = true;
      app.awaitingPointer = true;
      applyMode('window');
      const isCurrent = () => !disposed && token === app.positionRestoreToken && app.mode === 'window';
      void restoreWindowPosition(win, saved, { isCurrent }).then(async (result) => {
        if (disposed || token !== app.positionRestoreToken || app.mode !== 'window') return;
        let restoredState = result.state;
        if (result.interactive && restoredState?.window && (restoredState.window.width !== 280 || restoredState.window.height !== 340)) {
          try { restoredState = await win.update({ width: 280, height: 340 }); }
          catch (error) { if (!isCurrent()) return; result.error = errCode(error); }
          if (!isCurrent()) return;
        }
        if (restoredState) onWindowState(restoredState);
        if (!isCurrent()) return;
        app.clickThrough = result.interactive ? false : null;
        app.restoringPosition = false;
        if (result.error) showTransient(result.interactive
          ? `位置未恢复（${result.error}），当前窗口仍可交互。`
          : `窗口交互状态未确认（${result.error}），请收回面板重试。`, 'error');
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
  const bounds = app.winBounds;
  const position = app.workbenchOpen && bounds
    ? { x: Math.round(bounds.x + bounds.width - 280), y: Math.round(bounds.y + bounds.height - 340) }
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
  if (mode === 'window' && !['idle', 'error'].includes(speechState)) {
    speechInput?.cancel();
    showTransient('已取消面板录音。请回到面板重新录制。');
  }
  root.classList.toggle('mode-window', mode === 'window');
  root.classList.toggle('mode-inline', mode !== 'window');
  root.dataset.mode = mode;
  els.panel.hidden = mode === 'window';
  els.desk.hidden = mode !== 'window';

  closeMenu();
  closeComposer();
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
  if (!['idle', 'error'].includes(speechState)) { setMsg(els.popoutMsg, '请先停止录音并等待转写完成。'); return; }
  els.popoutBtn.disabled = true;
  setMsg(els.popoutMsg, '正在弹出…');
  app.modeSwitching = true;
  // Synchronous inside the click handler: mode changes need a user gesture.
  callBridge(() => win.update({ mode: 'window', width: 280, height: 340 }))
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
  return [els.bubble, els.notificationStack, els.quickbar, els.composer, els.menu, els.workbench].some(
    (el) => !el.hidden && pointInRect(el.getBoundingClientRect(), x, y),
  );
}

function refreshInteractivity() {
  if (app.mode !== 'window' || !win || app.modeSwitching || app.restoringPosition || app.awaitingPointer) return;
  const p = app.pointer;
  const interactive =
    app.workbenchOpen ||
    app.dragging ||
    app.menuOpen ||
    app.composerFocused ||
    (p ? isOverPet(p.x, p.y) || isOverOverlay(p.x, p.y) : false);
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
    showTransient('这里收不到穿透时的鼠标移动，透明区域会挡住下面的点击', 'error');
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
  refreshInteractivity(); // stays interactive while menu/composer/drag force it
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
    app.composerOpen ||
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
  app.drag = {
    pointerId: e.pointerId,
    startX: e.screenX,
    startY: e.screenY,
    win: app.winPos ? { ...app.winPos } : null,
    active: false,
    dir: null,
    extreme: e.screenX,
  };
}

function onSpritePointerMove(e) {
  const d = app.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  const dx = e.screenX - d.startX;
  const dy = e.screenY - d.startY;
  if (!d.active) {
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    d.active = true;
    app.dragging = true;
    app.oneShotToken++;
    app.oneShot = false;
    stopLook();
    hideQuickbar();
    els.sprite.classList.add('is-dragging');
    refreshInteractivity();
    if (!d.win) console.warn('[pet] drag_without_window_position: 还没拿到窗口位置，只播放动画');
  }
  updateDragDirection(d, e.screenX);
  if (!d.win) return;
  callBridge(() => win.update({ x: Math.round(d.win.x + dx), y: Math.round(d.win.y + dy) })).catch((error) => {
    const code = errCode(error);
    if (code === 'not_permitted') console.debug('[pet] drag_move_rejected: not_permitted（目标位置不在任何屏幕上）');
    else console.warn('[pet] drag_move_failed:', code, error);
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
  } else if (Math.abs(sx - d.startX) > DIRECTION_HYSTERESIS / 2) {
    d.dir = sx > d.startX ? 'right' : 'left';
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
// Bubble / quick bar / composer (window mode)
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
  if (app.composerOpen || app.workbenchOpen) {
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
      text = a.session.needsAnswer ? '需要你回答' : a.status === 'running' ? '' : STATUS_TEXT[a.status];
      title = a.session.title;
      clickable = !!text;
    }

  }
  if (app.source === 'demo') {
    title = '状态演示';
    text = STATUS_TEXT[app.demoStatus] ? `演示：${STATUS_TEXT[app.demoStatus]}` : '';
    clickable = false;
  }
  els.bubbleTitle.textContent = title;
  els.bubbleTitle.hidden = !title;
  els.bubbleText.textContent = text;
  els.bubble.dataset.kind = kind;
  els.bubble.classList.toggle('is-clickable', clickable);
  els.bubble.tabIndex = text ? 0 : -1;
  els.bubble.setAttribute('aria-label', text ? `${title ? `${title}，` : ''}${text}，打开桌宠工作面板` : '任务提示');
  els.bubble.hidden = !text || (!app.transient && !els.notificationStack.hidden);
  app.bubbleSessionId = clickable && a.session ? a.session.sessionId : null;
  refreshInteractivity();
}

function renderNotificationStack() {
  const container = els.notificationStack;
  const items = notificationItems(reminders.getState().items);
  const visible = app.mode === 'window' && app.availability === 'ready' && items.length
    && !app.workbenchOpen && !app.composerOpen && !app.transient;
  container.hidden = !visible;
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
    open.children[1].textContent = notificationText(item, previews);
    open.setAttribute('aria-label', `查看通知：${item.title}`);
    node.children[1].setAttribute('aria-label', `关闭通知：${item.title}`);
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

function openComposer() {
  if (!canAppend) {
    showTransient('当前环境不能加到对话输入框', 'error');
    return;
  }
  hideQuickbar();
  closeMenu();
  stopLook();
  app.composerOpen = true;
  els.composer.hidden = false;
  // Called from a click/keyboard handler: focus() needs a user gesture. Lets the pet window take keyboard input.
  if (typeof win?.focus === 'function') {
    callBridge(() => win.focus()).catch((error) => console.warn('[pet] window_focus_failed:', errCode(error), error));
  }
  els.composerInput.focus();
  renderBubble();
  refreshInteractivity();
}

function closeComposer({ restoreFocus = false } = {}) {
  if (!app.composerOpen) return;
  app.composerOpen = false;
  app.composerFocused = false;
  els.composer.hidden = true;
  if (restoreFocus) els.sprite.focus({ preventScroll: true });
  renderBubble();
  refreshInteractivity();
}

// ---------------------------------------------------------------------------
// Context menu (window mode)
// ---------------------------------------------------------------------------

const MENU_TITLES = {
  root: '宠物菜单',
  demo: '动作预览（演示）',
  sessions: '全部任务',
  pets: '换宠物',
  scale: '大小',
};

function menuModel(view) {
  if (view === 'demo') {
    return [
      ...DEMO_ORDER.map((s) => ({
        label: STATUS_LABEL[s],
        role: 'menuitemradio',
        checked: app.demoStatus === s,
        run: () => setDemoStatus(s),
      })),
    ];
  }
  if (view === 'sessions') {
    if (!app.sessions.length) return [{ label: '还没有会话', disabled: true }];
    return app.sessions.map((s) => ({
      label: s.title,
      detail: STATUS_LABEL[s.status] ?? s.status,
      disabled: false,
      run: () => selectSession(s.sessionId, showTransient),
    }));
  }
  if (view === 'pets') {
    if (!app.pets.length) return [{ label: '没有可用的宠物', disabled: true }];
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
      label: s.label,
      role: 'menuitemradio',
      checked: prefs.scale === s.value,
      run: () => setScale(s.value),
    }));
  }
  return [
    app.source === 'demo' && { label: '动作预览', submenu: 'demo' },
    app.source === 'real' && app.availability === 'ready' && { label: '全部任务', run: () => { void openWorkbench('tasks'); } },
    app.source === 'real' && app.availability !== 'ready' && { label: '重新连接会话', run: () => { void activitySource?.refresh(); } },
    { label: '打招呼', run: () => playOneShot('waving') },
    { label: '跳一下', run: () => playOneShot('jumping') },
    canAppend && { label: '追加到原属聊天草稿…', run: () => { void openWorkbench('draft'); } },
    { label: '换宠物', submenu: 'pets' },
    { label: '大小', submenu: 'scale' },
    win && { label: '收回到面板', run: returnToPanel },
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
  if (app.menuView !== 'root') nodes.push(menuButton({ label: '返回', back: true }));
  for (const item of menuModel(app.menuView)) nodes.push(menuButton(item));
  els.menu.replaceChildren(...nodes);
  els.menu.setAttribute('aria-label', MENU_TITLES[app.menuView] ?? '菜单');
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
  closeComposer();
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
    throw Object.assign(new Error('读不到宠物列表'), { code: 'pets_list_unreachable', cause: error });
  }
  if (!res.ok) {
    const { code, message } = await readErrorBody(res);
    throw Object.assign(new Error(message || '读不到宠物列表'), { code });
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
    showLoadError({ code: 'pet_not_found', message: `没有 id 为 ${id} 的宠物` });
    return 'failed';
  }
  const token = ++app.selectToken;
  let result = 'selected';
  setMsg(els.galleryMsg, `正在加载「${summary.displayName}」…`);
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
  const text = `${name ? `「${name}」` : ''}加载失败（${code}）${detail}`;
  console.error('[pet] load_failed:', code, error);
  app.loadError = text;
  els.loadError.textContent = text;
  els.loadError.hidden = false;
  if (app.mode === 'window' && app.pet) showTransient(text, 'error');
  renderBubble();
}

async function deletePet(pet) {
  if (!window.confirm(`删除导入的宠物「${pet.displayName}」？删除后不能恢复。`)) {
    setMsg(els.galleryMsg, '已取消删除');
    return;
  }
  setMsg(els.galleryMsg, `正在删除「${pet.displayName}」…`);
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(pet.id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const { code, message } = await readErrorBody(res);
      setMsg(els.galleryMsg, `删除失败（${code}）${message ? `：${message}` : ''}`, 'error');
      return;
    }
    await refreshPets();
    setMsg(els.galleryMsg, `已删除「${pet.displayName}」`, 'ok');
    if (app.pet?.id === pet.id || prefs.petId === pet.id) {
      const next = app.pets[0];
      if (next) await selectPet(next.id);
    }
  } catch (error) {
    const code = errCode(error);
    console.error('[pet] delete_failed:', code, error);
    setMsg(els.galleryMsg, `删除失败（${code}）`, 'error');
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
      // The Host only requires the transparent window to overlap a display.
      // Fit its whole content area before shrinking so opaque pet pixels remain reachable.
      const result = await fitWindowToScreen(win, {
        screenRect: () => ({ x: screen.availLeft, y: screen.availTop, width: screen.availWidth, height: screen.availHeight }),
        isCurrent: () => current() && app.mode === 'window',
      });
      if (!current() || result.cancelled) return;
      if (result.error) { showTransient(`尺寸未调整（${result.error}），请稍后重试。`, 'error'); return; }
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
    errs.push({ code: 'invalid_id', message: 'id 只能用小写字母、数字、点、下划线、连字符，最长 80 个字符' });
  } else if (app.pets.some((p) => p.id === petJson.id && p.source === 'bundled')) {
    errs.push({ code: 'bundled_conflict', message: '和内置宠物的 id 重复了' });
  }
  if (typeof petJson.displayName !== 'string' || petJson.displayName.length < 1 || petJson.displayName.length > 80) {
    errs.push({ code: 'invalid_pet_json', message: 'displayName 需要 1–80 个字符' });
  }
  if (petJson.description != null && (typeof petJson.description !== 'string' || petJson.description.length > 300)) {
    errs.push({ code: 'invalid_pet_json', message: 'description 最多 300 个字符' });
  }
  if (!/^[^/\\]+\.(webp|png)$/.test(petJson.spritesheetPath)) {
    errs.push({ code: 'invalid_sprite_name', message: 'spritesheetPath 只能是同目录下的 .webp 或 .png 文件名' });
  }
  if (Math.ceil(file.size / 3) * 4 + 4096 > IMPORT_BODY_LIMIT) {
    errs.push({ code: 'payload_too_large', message: '图集太大，上传内容会超过 12 MB' });
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
        ? '缺少 pet.json，请和图集一起选择（import_pet_json_missing）'
        : '一次只能导入一个宠物，选了多个 .json（import_pet_json_ambiguous）',
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
    setMsg(els.importMsg, `pet.json 不是有效的 JSON（pet_json_unreadable）`, 'error');
    return;
  }
  if (!current()) return;
  if (!petJson || typeof petJson !== 'object' || Array.isArray(petJson) || typeof petJson.spritesheetPath !== 'string') {
    setMsg(els.importMsg, 'pet.json 缺少 spritesheetPath（pet_json_invalid）', 'error');
    return;
  }
  const spriteName = basename(petJson.spritesheetPath);
  const file = files.find((f) => f.name === spriteName);
  if (!file) {
    setMsg(els.importMsg, `没找到 ${spriteName}，请和 pet.json 一起选择（import_sprite_missing）`, 'error');
    return;
  }

  importState.petJson = petJson;
  importState.file = file;
  importState.blobUrl = URL.createObjectURL(file);
  importState.errors = precheckImport(petJson, file);
  els.importName.textContent = petJson.displayName || petJson.id || '未命名宠物';
  els.importMeta.textContent = `id：${petJson.id ?? '—'} · 图集：${file.name}（${Math.round(file.size / 1024)} KB）`;
  els.importPreview.hidden = false;
  els.importStateText.textContent = '正在检查图集…';
  renderImportErrors();

  const blobUrl = importState.blobUrl;
  try {
    const loaded = await loadPetFromParts(petJson, blobUrl);
    if (!current() || importState.blobUrl !== blobUrl) return;
    importState.loaded = loaded;
    els.importMeta.textContent += ` · v${loaded.version}${loaded.version === 2 ? '（支持看向鼠标）' : ''}`;
    startImportPreview(loaded);
  } catch (error) {
    if (!current() || importState.blobUrl !== blobUrl) return;
    const code = errCode(error);
    console.warn('[pet] import_preview_failed:', code, error);
    importState.errors.push({ code, message: error?.message && error.message !== code ? error.message : '图集无法预览' });
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
    els.importStateText.textContent = `预览动作：${state}（${((i - 1) % STATES.length) + 1}/${STATES.length}）`;
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
    reader.onerror = () => reject(Object.assign(new Error('读不到图集文件'), { code: 'sprite_unreadable', cause: reader.error }));
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
  setMsg(els.importMsg, '正在导入…');
  try {
    const base64 = await fileToBase64(file);
    if (!current()) return;
    const payload = { petJson, spritesheet: { fileName: file.name, base64 } };
    let { res, data } = await postPet(payload);
    if (!current()) return;
    if (res.status === 409 && data?.error === 'pet_exists') {
      if (!window.confirm(`已经导入过 id 为「${petJson.id}」的宠物，要用这次的文件替换它吗？`)) {
        setMsg(els.importMsg, '已取消导入，原来的宠物没有变化');
        return;
      }
      ({ res, data } = await postPet({ ...payload, replace: true }));
      if (!current()) return;
    }
    if (!res.ok) {
      const code = data?.error || `http_${res.status}`;
      setMsg(els.importMsg, `导入失败（${code}）${data?.message ? `：${data.message}` : ''}`, 'error');
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
      const message = '文件已导入，但宠物加载失败；请返回外观重新选择';
      setMsg(els.importMsg, message, 'error');
      setMsg(els.galleryMsg, message, 'error');
      return;
    }
    if (selection !== 'selected' || app.pet?.id !== newId) {
      setMsg(els.importMsg, '文件已导入，已保留你当前的宠物选择', 'ok');
      return;
    }
    panelNavigation?.completeImport();
    const message = `导入成功，已切换到「${data?.pet?.displayName ?? newId}」`;
    setMsg(els.importMsg, message, 'ok');
    setMsg(els.galleryMsg, message, 'ok');
  } catch (error) {
    if (!current()) return;
    const code = errCode(error);
    console.error('[pet] import_failed:', code, error);
    setMsg(els.importMsg, saved
      ? `文件已导入，但暂时无法加载列表；请返回外观重试（${code}）`
      : `导入失败（${code}）`, 'error');
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
  renderTalk();
  renderScale();
  renderGallery();
  renderBubble();
}

function renderHeader() {
  const pet = app.pet;
  els.petName.textContent = pet?.displayName ?? (app.loadError ? '宠物没加载出来' : '正在加载宠物…');
  els.petDesc.textContent = pet?.description ?? '';
  els.versionBadge.hidden = !pet;
  els.versionBadge.textContent = pet?.version === 2 ? 'v2·可看向鼠标' : 'v1';
  const sourceLabel = app.source === 'demo' ? '资源预览' : app.availability === 'ready' ? '真实会话' : app.availability === 'connecting' ? '连接中' : app.availability === 'not_permitted' ? '未授权' : '不可用';
  els.sourceBadge.textContent = sourceLabel;
  els.sourceBadge.dataset.source = app.source;
  els.popoutBtn.hidden = !win || app.mode === 'window';

  let note = '';
  if (app.mode === 'standalone') {
    note = '普通浏览器没有任务和窗口能力；可用 ?demo=1 手动预览资源动作。';
  } else if (!win) {
    note = '当前 MiniMax Code 版本不支持弹出窗口，只能在面板里使用。';
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
  if (!available && real) setMsg(els.taskConnection, `${availabilityText()} 可在设置中重新连接。`, app.availability === 'connecting' ? 'info' : 'error');
  els.sessionList.hidden = !available;
  els.activityRetry.hidden = !real || available;
  if (available) {
    const coverage = askObserver?.getState();
    els.activityNote.textContent = `聚合最近 50 个用户主会话及本次可见活动。新出现的 ask 实时跟随 ${coverage?.watchingIds.length ?? 0}/${coverage?.runningCount ?? 0} 个运行任务；订阅前的问题无法恢复。选择条目只查看详情。`;
    renderSessionList(a.session);
  } else if (real) {
    els.activityNote.textContent = availabilityText();
    els.sessionList.replaceChildren();
  } else {
    els.activityNote.textContent = '手动资源动作预览（演示），不代表真实任务。';
    syncSegmented(els.demoStatus, app.demoStatus);
  }
  els.aggregateCounts.textContent = available ? aggregateText(app.aggregate?.counts) : '';
  els.clearCompleted.hidden = !available || !app.aggregate?.counts.completed;
  renderReminders();
  const text = real && !available ? availabilityText() : a.session?.needsAnswer ? '需要你回答' : a.session || !real ? STATUS_TEXT[a.status] || '空闲中' : '暂无当前提醒';
  els.panelStatus.textContent = a.session?.needsAnswer ? `「${a.session.title}」需要你回答` : a.session && STATUS_TEXT[a.status] ? `「${a.session.title}」${text}` : text;
  renderDetail();
  const name = app.pet?.displayName ?? '宠物';
  const stateLabel = a.session?.needsAnswer ? '需要你回答' : STATUS_LABEL[a.status] || sourceLabelForActivity();
  els.sprite.setAttribute('aria-label', app.mode === 'window'
    ? `${name}，${stateLabel}。点击或回车查看任务，可拖动` : `${name}，${stateLabel}`);

}

function sourceLabelForActivity() { return app.availability === 'connecting' ? '连接中' : app.availability === 'not_permitted' ? '未授权读取会话' : '会话状态不可用'; }

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
    pill.textContent = s.needsAnswer ? '需要你回答' : STATUS_LABEL[displayStatus] ?? displayStatus;
    btn.append(title);
    if (current?.sessionId === s.sessionId) {
      const tag = document.createElement('span');
      tag.className = 'session-current';
      tag.textContent = '当前提示';
      btn.append(tag);
    }
    btn.append(pill);
    if (app.selectedSessionId === s.sessionId) btn.setAttribute('aria-current', 'true');
    btn.setAttribute('aria-label', `${s.title}，${pill.textContent}，查看详情`);
    btn.addEventListener('click', () => selectSession(s.sessionId, (t, k) => setMsg(els.sessionMsg, t, k)));
    li.append(btn);
    return li;
  });
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '还没有会话';
    items.push(li);
  }
  els.sessionList.replaceChildren(...items);
  els.sessionList.scrollTop = scrollTop;
  if (focusedId) els.sessionList.querySelector(`[data-session-id="${CSS.escape(focusedId)}"]`)?.focus();
}

function renderTalk() {
  renderDraftControls();
  const entry = $('open-draft');
  if (entry) { entry.hidden = !canAppend; if (entry.closest('section')) entry.closest('section').hidden = !canAppend; }
  els.talkText.disabled = !canAppend;
  if (!canAppend && !els.talkMsg.textContent) setMsg(els.talkMsg, '当前环境不能加到对话输入框。');
}

function renderDetail() {
  const detail = app.detail;
  const session = app.sessions.find((row) => row.sessionId === app.selectedSessionId);
  const needsAnswer = session?.needsAnswer;
  els.detailTitle.textContent = detail?.title || '任务概览';
  const status = taskStatus(session) || taskStatus(detail);
  els.detailStatus.textContent = needsAnswer ? '需要你回答' : detail ? STATUS_LABEL[status] || status : '—';
  els.detailTime.textContent = detail ? new Date(detail.updatedAtMs).toLocaleString('zh-CN') : '—';
  els.detailError.textContent = detail?.error || app.detailError || '';
  els.detailError.hidden = !els.detailError.textContent;
  const reply = needsAnswer ? '需要你回答' : detail?.lastAssistantText || '';
  if (els.detailReply.textContent !== reply) els.detailReply.textContent = reply;
  if (panelDetailId !== app.selectedSessionId) { els.detailReply.scrollTop = 0; panelDetailId = app.selectedSessionId; }
  els.detailNote.textContent = app.source === 'demo' ? '资源动作预览，不提供真实任务概览。'
    : app.availability !== 'ready' ? availabilityText()
      : app.detailLoading ? (detail ? '正在更新…' : '正在读取任务…') : !detail ? '选择任务后查看最近回复。'
        : needsAnswer ? '请回到 MiniMax Code 的对应聊天回答。'
          : detail.lastAssistantText ? '显示任务的最近回复。后续处理请回到对应聊天。' : '这项任务暂时没有可查看的回复。';
}

function initWorkbench() {
  workbenchView = createCompactPetView({ container: els.workbench,
    onClose: () => { void closeWorkbench(); },
    onSelectTask: openTaskPreview,
  });
  notificationPreviews = createNotificationPreviews({ agent, onChange: () => { renderBubble(); renderCompactView(); } });
  if (win) workbenchWindow = createWorkbenchWindow({ windowAPI: win,
    screenRect: () => ({ x: screen.availLeft, y: screen.availTop, width: screen.availWidth, height: screen.availHeight }),
    isCurrent: () => !disposed && app.mode === 'window', expandedSize: compactBubbleSize,
  });
  disposers.push(() => { notificationPreviews.dispose(); workbenchWindow?.dispose(); workbenchView.dispose(); });
}

function renderCompactView() {
  const notice = reminders.getState();
  notificationPreviews?.update({ availability: app.availability, items: notificationItems(notice.items) });
  const previews = notificationPreviews?.getState().previews ?? {};
  workbenchView?.update({ reminders: { ...notice, items: notice.items.map((item) => ({ ...item, previewText: item.needsAnswer ? '需要你回答' : previews[item.sessionId] || '' })) }, allSessions: app.sessions,
    taskSelection: { availability: app.availability, selectedSessionId: app.selectedSessionId, session: app.sessions.find((row) => row.sessionId === app.selectedSessionId), detail: app.detail, detailLoading: app.detailLoading, detailError: app.detailError } });
}

function openTaskPreview(sessionId) {
  if (!activitySource || app.availability !== 'ready') { showTransient(availabilityText(), 'error'); return; }
  try { void activitySource.selectSession(sessionId).catch((error) => showTransient(`无法读取任务（${errCode(error)}）。`, 'error')); }
  catch (error) { showTransient(`无法读取任务（${errCode(error)}）。`, 'error'); return; }
  void openWorkbench('detail');
}

function focusFullPanel(view) {
  if (view === 'draft') { if (canAppend) panelNavigation?.showDraft(); }
  else if (view === 'detail') panelNavigation?.showTaskDetail();
  else { panelNavigation?.showTab('tasks'); panelNavigation?.showTaskList(); }
}

function openFullPanel(view = 'tasks') {
  const result = app.mode === 'window' ? returnToPanel() : Promise.resolve(true);
  return result.then((ok) => { if (ok && !disposed && app.mode !== 'window') focusFullPanel(view); });
}

async function openWorkbench(view = 'tasks') {
  if (disposed) return;
  app.workbenchView = view;
  if (app.mode !== 'window') {
    focusFullPanel(view);
    return;
  }
  if (view === 'draft') return openFullPanel('draft');
  const token = ++app.workbenchRevision;
  app.compacting = false;
  const alreadyOpen = workbenchView.opened;
  app.workbenchOpen = true;
  closeComposer(); closeMenu(); hideQuickbar(); stopLook();
  setClickThrough(false);
  const waitingAt = Date.now();
  while (app.restoringPosition && token === app.workbenchRevision && !disposed && Date.now() - waitingAt < 3000) await new Promise((resolve) => setTimeout(resolve, 20));
  if (disposed || token !== app.workbenchRevision || app.mode !== 'window' || !app.workbenchOpen) return;
  const result = app.restoringPosition ? { ok: false, code: 'window_restoring' } : alreadyOpen ? { ok: true } : await workbenchWindow.setExpanded(true);
  if (disposed || token !== app.workbenchRevision || app.mode !== 'window' || !app.workbenchOpen) return;
  if (!result.ok) {
    app.workbenchOpen = false;
    showTransient(`暂时无法展开（${result.code}），可收回面板继续使用。`, 'error');
    refreshInteractivity(); return;
  }
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
  const result = await workbenchWindow?.setExpanded(false);
  if (token === app.workbenchRevision) app.compacting = false;
  if (!disposed && token === app.workbenchRevision && app.mode === 'window' && !app.workbenchOpen) {
    if (result && !result.ok && !['stale', 'superseded', 'cancelled'].includes(result.code)) showTransient(`窗口大小暂未恢复（${result.code}），仍可继续操作。`, 'error');
    const current = () => !disposed && token === app.workbenchRevision && app.mode === 'window' && !app.workbenchOpen;
    callBridge(() => win.getState()).then((state) => { if (current()) onWindowState(state); }, (error) => { if (current()) logError('get_state_after_collapse')(error); });
    refreshInteractivity();
  }
}

function renderReminders() {
  const state = reminders.getState();
  renderCompactView();
  els.reminderNote.textContent = state.items.length ? '按最新活动显示；静音只影响桌宠本次提示。' : '当前没有需要提示的活动。历史状态仍在全部会话中。';
  const existing = new Map([...els.reminderList.children].map((node) => [node.dataset.sessionId, node]));
  const nodes = state.items.slice(0, 10).map((item) => {
    let li = existing.get(item.sessionId);
    if (!li) {
      li = document.createElement('li'); li.className = 'reminder-item'; li.dataset.sessionId = item.sessionId;
      const title = document.createElement('button'); title.type = 'button'; title.className = 'reminder-title';
      title.addEventListener('click', () => { selectSession(item.sessionId); });
      const status = document.createElement('span'); status.className = 'pill';
      const actions = document.createElement('div'); actions.className = 'row';
      const mute = document.createElement('button'); mute.type = 'button'; mute.className = 'btn small'; mute.textContent = '本次静音';
      mute.addEventListener('click', () => { reminders.mute(item.sessionId); applyActivity(); });
      actions.append(mute); li.append(title, status, actions);
    }
    li.children[0].textContent = item.title;
    li.children[0].setAttribute('aria-label', `查看提醒：${item.title}`);
    li.children[1].textContent = item.needsAnswer ? '需要你回答' : STATUS_LABEL[item.displayStatus]; li.children[1].dataset.status = item.needsAnswer ? 'needs_input' : item.displayStatus;
    li.children[2].children[0].setAttribute('aria-label', `本次静音：${item.title}`);
    return li;
  });
  if (!nodes.length) { const empty = document.createElement('li'); empty.className = 'muted'; empty.textContent = '暂无当前提醒'; nodes.push(empty); }
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
    button.textContent = `恢复提醒：${app.sessions.find((row) => row.sessionId === id)?.title || '该会话'}`;
    return button;
  });
  if (mutedNodes.length !== els.mutedList.children.length || mutedNodes.some((node, i) => node !== els.mutedList.children[i])) els.mutedList.replaceChildren(...mutedNodes);
  if (mutedFocus?.isConnected && els.mutedList.contains(mutedFocus)) mutedFocus.focus({ preventScroll: true });
}

function initSpeech() {
  const labels = { requesting: '正在请求麦克风…', recording: '正在录音，请点击停止。', transcribing: '正在转写…' };
  speechInput = createSpeechInput({
    getMiniApp: () => window.mcode?.miniapp,
    onState(value) {
      speechState = value.state;
      const busy = !['idle', 'error'].includes(value.state);
      els.speechStart.disabled = busy;
      els.speechStop.disabled = value.state !== 'recording';
      els.speechCancel.disabled = !busy;
      els.draftSpeech.disabled = busy || !speechInput?.isAvailable();
      els.popoutBtn.disabled = busy || app.modeSwitching;
      setMsg(els.speechMsg, value.state === 'error' ? `语音未完成（${value.errorCode || 'unknown'}），已有文字保持不变。` : labels[value.state] || '转写只填入原属草稿区，不会自动追加或发送。', value.state === 'error' ? 'error' : 'info');
      if (value.state !== 'transcribing') els.speechPartial.textContent = '';
    },
    onPartial(text) { els.speechPartial.textContent = `转写处理中：${text}`; },
    onText(text) {
      if (disposed || !text) return;
      draftController.syncText('panel', els.talkText.value);
      els.talkText.value = draftController.appendText('panel', `${els.talkText.value ? '\n' : ''}${text}`);
      setMsg(els.talkMsg, '转写已填入原聊天草稿区。确认后可添加到原聊天输入框。', 'ok');
    },
  });
  const available = speechInput.isAvailable();
  els.speechControls.hidden = !available;
  els.draftSpeech.hidden = !available;
  setMsg(els.speechMsg, available ? '转写只填入原属草稿区，不会自动追加或发送。' : '当前环境不支持语音转写，可直接输入文字。');
  listen(els.speechStart, 'click', () => { startSpeech(); });
  listen(els.draftSpeech, 'click', () => startSpeech());
  listen(els.speechStop, 'click', () => { void speechInput.stop(); });
  listen(els.speechCancel, 'click', () => { speechInput.cancel(); });
  disposers.push(() => speechInput.dispose());
}

function startSpeech() {
  if (!['idle', 'error'].includes(speechState)) return;
  void speechInput.start();
}

function renderScale() {
  root.style.setProperty('--minimax-pet-height', `${208 * prefs.scale}px`);
  compactBubbleSize.height = Math.max(340, Math.ceil(208 * prefs.scale) + 232);
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
    pick.setAttribute('aria-label', `使用 ${pet.displayName}`);
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
    src.textContent = pet.source === 'imported' ? '导入' : '内置';
    meta.append(ver, src);
    if (selected) {
      const on = document.createElement('span');
      on.className = 'badge is-selected';
      on.textContent = '使用中';
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
      del.textContent = '删除';
      del.setAttribute('aria-label', `删除 ${pet.displayName}`);
      del.addEventListener('click', () => deletePet(pet));
      li.append(del);
    }
    return li;
  });
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '还没有可用的宠物';
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
    span.textContent = opt.label;
    label.append(input, span);
    fieldset.append(label);
  }
}

function syncSegmented(fieldset, value) {
  for (const input of fieldset.querySelectorAll('input')) input.checked = input.value === String(value);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function bindPanel() {
  buildSegmented(
    els.demoStatus,
    'demo-status',
    DEMO_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
    setDemoStatus,
  );
  buildSegmented(els.scaleGroup, 'scale', SCALES, setScale);
  listen(els.activityRetry, 'click', () => { void activitySource?.refresh(); });
  listen(els.clearCompleted, 'click', () => { activitySource?.clearCompleted(); });
  listen(els.popoutBtn, 'click', popOut);
  listen(els.waveBtn, 'click', () => playOneShot('waving'));
  listen(els.jumpBtn, 'click', () => playOneShot('jumping'));

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
    else if (app.composerOpen) closeComposer({ restoreFocus: true });
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

  listen(els.composerClose, 'click', () => closeComposer({ restoreFocus: true }));
  listen(els.composer, 'focusin', () => {
    app.composerFocused = true;
    refreshInteractivity();
  });
  listen(els.composer, 'focusout', (e) => {
    if (els.composer.contains(e.relatedTarget)) return;
    app.composerFocused = false;
    refreshInteractivity();
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
      resetImport(); setMsg(els.importMsg, '已取消导入'); return true;
    },
    onLeaveDraft() {
      if (!['idle', 'error'].includes(speechState)) speechInput?.cancel();
    },
  });
  disposers.push(() => panelNavigation.dispose());
  listen(reducedMotion, 'change', (e) => {
    player.setReducedMotion(e.matches);
    importState.player?.setReducedMotion(e.matches);
    if (e.matches) stopLook();
  });

  bindPanel();
  initWorkbench();
  bindDesk();
  bindDraftForms();
  initSpeech();
  listen(window, 'pagehide', disposeApp);
  await initPreferences();
  if (disposed) return;
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
  else if (!app.loadError) showLoadError({ code: 'no_pets', message: '没有可用的宠物' });
  renderAll();
  noteInteraction();

}

function disposeApp() {
  if (disposed) return;
  disposed = true;
  for (const dispose of disposers.splice(0).reverse()) {
    try { dispose(); } catch (error) { console.warn('[pet] dispose_failed:', errCode(error), error); }
  }
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
    throw Object.assign(new Error('pet-player.js 缺少约定的导出'), { code: 'player_module_invalid' });
  }
} catch (error) {
  console.error('[pet] player_module_unavailable:', errCode(error), error);
  SpritePlayer = null;
  showFatal(`播放器加载失败（${error?.code ?? 'player_module_unavailable'}）`);
}

if (SpritePlayer) {
  boot().catch((error) => {
    console.error('[pet] boot_failed:', errCode(error), error);
    showFatal(`启动失败（${errCode(error)}）`);
  });
}
