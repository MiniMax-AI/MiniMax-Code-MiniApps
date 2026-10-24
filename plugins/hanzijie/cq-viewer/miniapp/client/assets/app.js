// CadQuery Viewer — Client.
// STL/STEP viewer: parts pushed to ~/.cqview/scene plus files opened from registered folders.

import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { STLLoader } from './vendor/STLLoader.js';
import { createHostBridge } from './host-bridge.js';
import { createRenderPanel } from './render-panel.js';

const API_BASE = new URL('../api/', import.meta.url);
/** @param {string} path @param {Record<string,string>} [query] */
function apiUrl(path, query) {
  const u = new URL(path, API_BASE);
  if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const ROOT_ID_RE = /^[a-f0-9]{10}$/;

// ---------------------------------------------------------------- theme
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
document.documentElement.dataset.theme = darkQuery.matches ? 'dark' : 'light';
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888';

// ---------------------------------------------------------------- prefs (view-only)
// Opened models, hidden parts and the selected folder live only as long as the page: the Viewer
// opens with nothing shown. Only view preferences are kept in browser storage.
const prefs = loadPrefs();
function loadPrefs() {
  /** @type {Record<string, any>} */
  let raw = {};
  try {
    raw = JSON.parse(localStorage.getItem('cqv.prefs.v3') || '{}') || {};
  } catch {
    /* storage unavailable */
  }
  return {
    hidden: /** @type {Set<string>} */ (new Set()),
    opened: /** @type {string[]} */ ([]),
    root: /** @type {string|null} */ (null),
    edges: raw.edges !== false,
    grid: raw.grid !== false,
    // white-model render options
    renderStyle: typeof raw.renderStyle === 'string' ? raw.renderStyle : null,
    renderAspect: typeof raw.renderAspect === 'string' ? raw.renderAspect : 'auto',
    renderColors: raw.renderColors === true,
    // wheel / trackpad mapping
    navMode: raw.navMode === 'trackpad' || raw.navMode === 'mouse' ? raw.navMode : 'auto',
  };
}
function savePrefs() {
  try {
    localStorage.setItem(
      'cqv.prefs.v3',
      JSON.stringify({
        edges: prefs.edges,
        grid: prefs.grid,
        renderStyle: prefs.renderStyle,
        renderAspect: prefs.renderAspect,
        renderColors: prefs.renderColors,
        navMode: prefs.navMode,
      }),
    );
  } catch {
    /* storage unavailable: preferences stay in memory */
  }
}

// ---------------------------------------------------------------- DOM
const el = {
  canvas: /** @type {HTMLCanvasElement} */ ($('canvas')),
  viewport: $('viewport'),
  overlay: $('overlay'),
  overlayTitle: $('overlay-title'),
  overlayText: $('overlay-text'),
  overlayAction: /** @type {HTMLButtonElement} */ ($('overlay-action')),
  overlayHint: $('overlay-hint'),
  toast: $('toast'),
  rootName: $('root-name'),
  rootAddToggle: /** @type {HTMLButtonElement} */ ($('root-add-toggle')),
  rootAddForm: /** @type {HTMLFormElement} */ ($('root-add-form')),
  rootAddInput: /** @type {HTMLInputElement} */ ($('root-add-input')),
  rootAddCancel: $('root-add-cancel'),
  rootAddError: $('root-add-error'),
  fileFilter: /** @type {HTMLInputElement} */ ($('file-filter')),
  folders: $('folders'),
  filesStatus: $('files-status'),
  parts: $('parts'),
  partsEmpty: $('parts-empty'),
  partsBadge: $('parts-badge'),
  railButtons: /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('.rail-btn')]),
  panels: {
    files: $('panel-files'),
    parts: $('panel-parts'),
    info: $('panel-info'),
    render: $('panel-render'),
  },
  markers: $('markers'),
  hoverDot: $('hover-dot'),
  pivotDot: $('pivot-dot'),
  annot: $('annot'),
  annotCount: $('annot-count'),
  annotCollapse: $('annot-collapse'),
  annotFab: $('annot-fab'),
  annotFabCount: $('annot-fab-count'),
  pickList: $('pick-list'),
  pickEmpty: $('pick-empty'),
  composeText: /** @type {HTMLTextAreaElement} */ ($('compose-text')),
  composePreview: $('compose-preview'),
  clearPick: /** @type {HTMLButtonElement} */ ($('clear-pick')),
  sendBtn: /** @type {HTMLButtonElement} */ ($('send-btn')),
  sendLabel: $('send-label'),
  sendStatus: $('send-status'),
  pickToggle: /** @type {HTMLButtonElement} */ ($('pick-toggle')),
  confirmBar: $('confirm-bar'),
  confirmText: $('confirm-text'),
  pendingUndo: /** @type {HTMLButtonElement} */ ($('pending-undo')),
  pendingCancel: /** @type {HTMLButtonElement} */ ($('pending-cancel')),
  pendingConfirm: /** @type {HTMLButtonElement} */ ($('pending-confirm')),
  pickDone: /** @type {HTMLButtonElement} */ ($('pick-done')),
  infoSize: $('info-size'),
  infoCenter: $('info-center'),
  infoGrid: $('info-grid'),
  infoTris: $('info-tris'),
  infoUpdated: $('info-updated'),
  warning: $('scene-warning'),
  fit: $('fit'),
  optEdges: /** @type {HTMLButtonElement} */ ($('opt-edges')),
  optGrid: /** @type {HTMLButtonElement} */ ($('opt-grid')),
  clipToggle: /** @type {HTMLButtonElement} */ ($('clip-toggle')),
  clipPop: $('clip-pop'),
  clipButtons: /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-clip]')]),
  clipPos: /** @type {HTMLInputElement} */ ($('clip-pos')),
  clipVal: $('clip-val'),
  navToggle: /** @type {HTMLButtonElement} */ ($('nav-toggle')),
  navPop: $('nav-pop'),
  navButtons: /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-nav]')]),
  navDetected: $('nav-detected'),
  navKeys: $('nav-keys'),
  viewButtons: /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-view]')]),
};

/**
 * @param {'loading'|'empty'|'error'} kind
 * @param {string} title @param {string} text
 * @param {{action?: string, onAction?: () => void, hint?: string}} [opts]
 */
function showOverlay(kind, title, text, opts = {}) {
  el.overlay.hidden = false;
  el.overlay.dataset.kind = kind;
  el.overlayTitle.textContent = title;
  el.overlayText.textContent = text;
  el.overlayAction.hidden = !opts.action;
  el.overlayAction.textContent = opts.action || '';
  el.overlayAction.onclick = opts.onAction || null;
  el.overlayHint.hidden = !opts.hint;
  el.overlayHint.textContent = opts.hint || '';
}
function hideOverlay() {
  el.overlay.hidden = true;
}
let toastTimer = null;
/** Transient notice; `ms = 0` keeps it until replaced or cleared. */
function showToast(text, kind = 'info', ms = 2400) {
  if (toastTimer) clearTimeout(toastTimer);
  el.toast.hidden = false;
  el.toast.dataset.kind = kind;
  el.toast.textContent = text;
  toastTimer = ms ? setTimeout(hideToast, ms) : null;
}
function hideToast() {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  el.toast.hidden = true;
}

// ---------------------------------------------------------------- renderer
/** White-model render panel; created after everything it calls into exists. @type {ReturnType<typeof createRenderPanel> | null} */
let renderPanel = null;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true });
} catch (error) {
  showOverlay('error', '无法启动 3D 渲染', '当前环境不支持 WebGL。');
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
camera.up.set(0, 0, 1); // CadQuery convention: Z up (must precede OrbitControls)
camera.position.set(100, -100, 100);
scene.add(camera);

const controls = new OrbitControls(camera, el.canvas);
controls.enableDamping = false;
controls.screenSpacePanning = true;
controls.zoomToCursor = true;
// left: orbit (Shift/Ctrl/⌘ + left: pan), middle and right: pan; the wheel is routed in setupWheel()
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
controls.addEventListener('change', () => {
  updateDepthRange();
  requestRender();
  renderPanel?.viewChanged();
});
controls.addEventListener('start', () => setViewPressed(null));

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.4));
const headLight = new THREE.DirectionalLight(0xffffff, 1.8);
const headTarget = new THREE.Object3D();
headLight.position.set(0.6, 0.8, 1);
headTarget.position.set(0, 0, -1);
camera.add(headLight, headTarget);
headLight.target = headTarget;

const partsGroup = new THREE.Group();
const helpersGroup = new THREE.Group();
const pickGroup = new THREE.Group();
scene.add(partsGroup, helpersGroup, pickGroup);

const loader = new STLLoader();
const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
let clipAxis = 'off';
const clipList = () => (clipAxis === 'off' ? [] : [clipPlane]);

const edgeMaterial = new THREE.LineBasicMaterial({ color: css('--cqv-edge'), transparent: true, opacity: 0.6 });
const sectionMaterial = new THREE.MeshBasicMaterial({ color: css('--cqv-section'), side: THREE.BackSide });

// ---------------------------------------------------------------- axis gizmo
const gizmo = buildGizmo();
function buildGizmo() {
  const gScene = new THREE.Scene();
  const gCam = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.1, 10);
  gCam.up.set(0, 0, 1);
  const axes = [
    ['X', new THREE.Vector3(1, 0, 0), '--cqv-axis-x'],
    ['Y', new THREE.Vector3(0, 1, 0), '--cqv-axis-y'],
    ['Z', new THREE.Vector3(0, 0, 1), '--cqv-axis-z'],
  ];
  for (const [label, dir, token] of axes) {
    const color = css(token);
    gScene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 1, color, 0.28, 0.14));
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(label, color), depthTest: false }));
    sprite.position.copy(dir).multiplyScalar(1.38);
    sprite.scale.set(0.5, 0.5, 0.5);
    gScene.add(sprite);
  }
  return { scene: gScene, camera: gCam };
}
function textTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.font = '600 40px ui-sans-serif, -apple-system, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- selection overlay
// Numbered markers are HTML (crisp text, constant size); only the 2-point measuring line is WebGL.
const pickLine = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: css('--mcode-warning'), depthTest: false, transparent: true }),
);
pickLine.renderOrder = 999;
pickLine.frustumCulled = false;
pickLine.visible = false;
pickGroup.add(pickLine);
/** @type {HTMLDivElement[]} */
const markerEls = [];
/** @type {THREE.Vector3 | null} */
let hoverPoint = null;

// ---------------------------------------------------------------- render loop (on demand)
let frustumHalf = 100;
let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(renderNow);
}
function renderNow() {
  renderQueued = false;
  const w = el.viewport.clientWidth;
  const h = el.viewport.clientHeight;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.autoClear = true;
  renderer.render(scene, camera);

  const size = 84;
  const dir = camera.position.clone().sub(controls.target).normalize();
  gizmo.camera.position.copy(dir).multiplyScalar(4);
  gizmo.camera.quaternion.copy(camera.quaternion);
  gizmo.camera.updateMatrixWorld();
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setViewport(12, 12, size, size);
  renderer.setScissor(12, 12, size, size);
  renderer.clearDepth();
  renderer.render(gizmo.scene, gizmo.camera);
  renderer.setScissorTest(false);
  renderer.autoClear = true;
  positionOverlays(w, h);
}
/**
 * Centre of the window in camera space. Non-zero after the orbit centre moved to a point that is not
 * in the middle of the window (orbit around the point under the cursor): the camera then looks at
 * that point and the frustum is shifted so nothing on screen moves.
 */
const viewOffset = { x: 0, y: 0 };
/** Drawing buffer and camera frustum follow the window. Does not notify (the capture uses it to restore). */
function applySize() {
  const w = Math.max(1, el.viewport.clientWidth);
  const h = Math.max(1, el.viewport.clientHeight);
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.left = viewOffset.x - frustumHalf * aspect;
  camera.right = viewOffset.x + frustumHalf * aspect;
  camera.top = viewOffset.y + frustumHalf;
  camera.bottom = viewOffset.y - frustumHalf;
  camera.updateProjectionMatrix();
}
function resize() {
  applySize();
  requestRender();
  renderPanel?.viewChanged();
}
new ResizeObserver(resize).observe(el.viewport);

// ---------------------------------------------------------------- camera helpers
const VIEWS = {
  iso: [1, -1, 1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, -1e-4, 1],
  bottom: [0, -1e-4, -1],
};
let sceneBox = new THREE.Box3();
let sceneRadius = 1;

function visibleBox() {
  const box = new THREE.Box3();
  for (const p of parts.values()) {
    if (p.mesh && p.mesh.visible && p.mesh.geometry.boundingBox) box.union(p.mesh.geometry.boundingBox);
  }
  return box;
}
function allBox() {
  const box = new THREE.Box3();
  for (const p of parts.values()) if (p.mesh && p.mesh.geometry.boundingBox) box.union(p.mesh.geometry.boundingBox);
  return box;
}
function fitTo(box, dirArray) {
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1e-3);
  const dir = dirArray
    ? new THREE.Vector3(...dirArray).normalize()
    : camera.position.clone().sub(controls.target).normalize();
  if (!Number.isFinite(dir.x) || dir.lengthSq() === 0) dir.set(1, -1, 1).normalize();
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, Math.max(radius, sceneRadius) * 4);
  camera.zoom = 1;
  frustumHalf = radius * 1.08;
  viewOffset.x = viewOffset.y = 0;
  resize();
  controls.update();
  updateDepthRange();
  requestRender();
}
// Orthographic: keep the whole scene between near/far without visibly moving anything.
function updateDepthRange() {
  if (sceneBox.isEmpty()) return;
  const center = sceneBox.getCenter(new THREE.Vector3());
  const viewDir = controls.target.clone().sub(camera.position).normalize();
  let depth = center.clone().sub(camera.position).dot(viewDir);
  const want = sceneRadius * 2.5;
  if (depth < want) {
    camera.position.addScaledVector(viewDir, depth - want);
    depth = want;
  }
  camera.near = Math.max(1e-3, depth - sceneRadius * 1.5);
  camera.far = depth + sceneRadius * 1.5;
  camera.updateProjectionMatrix();
}
function setViewPressed(name) {
  for (const b of el.viewButtons) b.setAttribute('aria-pressed', String(b.dataset.view === name));
}

/**
 * Make `point` the orbit centre without moving anything on screen: the camera keeps its direction
 * and distance but looks at `point`, and the frustum shifts by the same amount the other way.
 * @param {THREE.Vector3} point
 */
function setPivot(point) {
  camera.updateMatrixWorld();
  const p = point.clone().applyMatrix4(camera.matrixWorldInverse); // camera space
  const dist = camera.position.distanceTo(controls.target);
  const dir = controls.target.clone().sub(camera.position).normalize();
  controls.target.copy(point);
  camera.position.copy(point).addScaledVector(dir, -dist);
  viewOffset.x -= p.x;
  viewOffset.y -= p.y;
  applySize();
  controls.update();
}

// Orbit around the point under the cursor: pressing on the model moves the orbit centre there; on
// empty space the centre stays. A dot marks the centre while dragging.
/** @type {THREE.Vector3 | null} */
let pivotPoint = null;
let pivotDown = /** @type {{x: number, y: number} | null} */ (null);
el.canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || !controls.enabled) return;
  const hit = hitAt(e.clientX, e.clientY);
  if (!hit) return;
  setPivot(hit.point);
  pivotPoint = hit.point.clone();
  pivotDown = { x: e.clientX, y: e.clientY };
});
el.canvas.addEventListener('pointermove', (e) => {
  if (!pivotDown || !pivotPoint || !(e.buttons & 1)) return;
  if (Math.hypot(e.clientX - pivotDown.x, e.clientY - pivotDown.y) > 4 && el.pivotDot.hidden) {
    el.pivotDot.hidden = false;
    requestRender();
  }
});
const endPivot = () => {
  pivotDown = null;
  pivotPoint = null;
  if (!el.pivotDot.hidden) el.pivotDot.hidden = true;
};
window.addEventListener('pointerup', endPivot);
window.addEventListener('pointercancel', endPivot);
el.canvas.addEventListener('lostpointercapture', endPivot);

// ---- wheel: mouse wheel zooms; on a trackpad two fingers pan and a pinch zooms.
// 'auto' tells them apart per gesture; the 操作 popover can force either.
let wheelGesture = /** @type {{at: number, kind: 'pan'|'zoom'} | null} */ (null);
/** Last input device seen by 'auto', shown in the 操作 popover. */
let detectedDevice = /** @type {'trackpad'|'mouse'|null} */ (null);

/** @param {WheelEvent} e @returns {'trackpad'|'mouse'} */
function classifyWheel(e) {
  const legacy = /** @type {any} */ (e).wheelDeltaY;
  if (e.ctrlKey) return 'trackpad'; // pinch
  if (e.deltaMode !== 0) return 'mouse'; // lines / pages: a notched wheel
  if (e.deltaX !== 0) return 'trackpad'; // two fingers rarely move perfectly vertically
  if (!Number.isInteger(e.deltaY)) return 'trackpad';
  if (typeof legacy === 'number' && legacy !== 0) {
    if (Math.abs(legacy) % 120 === 0) return 'mouse'; // whole notches
    if (legacy === -3 * e.deltaY) return 'trackpad'; // Chromium's pixel-scroll signature
  }
  return Math.abs(e.deltaY) >= 50 ? 'mouse' : 'trackpad';
}

el.canvas.addEventListener(
  'wheel',
  (e) => {
    if (!controls.enabled) return;
    const now = performance.now();
    /** @type {'pan'|'zoom'} */
    let kind;
    if (e.ctrlKey) kind = 'zoom'; // pinch, or Ctrl + wheel
    else if (prefs.navMode === 'mouse') kind = 'zoom';
    else if (prefs.navMode === 'trackpad') kind = 'pan';
    else if (wheelGesture && now - wheelGesture.at < 180) kind = wheelGesture.kind; // same gesture
    else {
      const device = classifyWheel(e);
      if (device !== detectedDevice) {
        detectedDevice = device;
        renderNavHelp();
      }
      kind = device === 'trackpad' ? 'pan' : 'zoom';
    }
    wheelGesture = { at: now, kind };
    if (kind === 'zoom') return; // OrbitControls zooms towards the cursor
    // pan: the model follows the fingers
    e.preventDefault();
    e.stopImmediatePropagation();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    /** @type {any} */ (controls)._pan(-e.deltaX * scale, -e.deltaY * scale);
    controls.update();
  },
  { passive: false, capture: true },
);

// ---------------------------------------------------------------- parts (scene + files)
/**
 * @typedef {{size:number,mtime:number,color?:string,opacity?:number,edges?:boolean,kind?:'stl'|'step'}} PartInfo
 * @typedef {{source:'scene',name:string}|{source:'file',root:string,rel:string}} PartRef
 * @typedef {{key:string,ref:PartRef,label:string,title:string,info:PartInfo,loadedKey:string|null,pendingKey?:string,
 *   status:'loading'|'ready'|'error',error?:string,mesh:THREE.Mesh|null,back:THREE.Mesh|null,
 *   edges:THREE.LineSegments|null,tris:number}} PartEntry
 */
/** @type {Map<string, PartEntry>} */
const parts = new Map();
let hadContent = false;

const sceneKey = (name) => `scene:${name}`;
const fileKey = (root, rel) => `file:${root}:${rel}`;
function parseFileKey(key) {
  const m = /^file:([a-f0-9]{10}):(.+)$/.exec(key);
  return m ? { root: m[1], rel: m[2] } : null;
}
const baseName = (rel) => rel.split('/').pop() || rel;
const dirName = (rel) => rel.split('/').slice(0, -1).join('/');

const palette = () => [1, 2, 3, 4, 5, 6].map((i) => css(`--cqv-part-${i}`));
/** Palette slot per part, assigned on first sight to the least-used colour so open parts stay distinct. */
const colorSlots = new Map();
function slotFor(key) {
  let slot = colorSlots.get(key);
  if (slot === undefined) {
    const pal = palette().map((c) => c.toLowerCase());
    const used = new Array(6).fill(0);
    for (const [k, e] of parts) {
      if (k === key) continue;
      const explicit = e.info.color ? pal.indexOf(e.info.color.toLowerCase()) : -1;
      const s = explicit >= 0 ? explicit : colorSlots.get(k);
      if (s !== undefined && s >= 0) used[s] += 1;
    }
    slot = used.indexOf(Math.min(...used));
    colorSlots.set(key, slot);
  }
  return slot;
}
const partColor = (entry) => entry.info.color || palette()[slotFor(entry.key)];
const keyOf = (info) => `${info.mtime}:${info.size}`;
// STEP brings real CAD edges (always worth drawing); meshes fall back to an angle threshold
const edgesAllowed = (entry) => entry.info.edges ?? (entry.brepEdges ? true : entry.tris <= 150_000);
const CQVM_TYPE = 'application/x-cqview-mesh';

/** @param {string} key @param {PartRef} ref @param {PartInfo} info */
function makeEntry(key, ref, info) {
  const label = ref.source === 'scene' ? ref.name : baseName(ref.rel);
  const root = ref.source === 'file' ? roots.find((r) => r.id === ref.root) : null;
  const title = ref.source === 'scene' ? `~/.cqview/scene/${ref.name}` : `${root ? root.display : ''}/${ref.rel}`;
  /** @type {PartEntry} */
  const entry = { key, ref, label, title, info, loadedKey: null, status: 'loading', mesh: null, back: null, edges: null, tris: 0 };
  parts.set(key, entry);
  return entry;
}

function applyMaterial(entry) {
  if (!entry.mesh) return;
  const opacity = entry.info.opacity ?? 1;
  const transparent = opacity < 1;
  const m = /** @type {THREE.MeshStandardMaterial} */ (entry.mesh.material);
  const base = partColor(entry);
  if (entry.vertexColors) {
    // STEP colours live in the vertices; uncoloured bodies take the part colour
    m.vertexColors = true;
    m.color.set('#ffffff');
    fillUncolored(entry, base);
  } else {
    m.vertexColors = false;
    m.color.set(base);
  }
  m.opacity = opacity;
  m.transparent = transparent;
  m.depthWrite = !transparent;
  m.clippingPlanes = clipList();
  m.needsUpdate = true;
  const visible = !prefs.hidden.has(entry.key);
  entry.mesh.visible = visible;
  if (entry.back) entry.back.visible = visible && clipAxis !== 'off' && !transparent;
  syncEdges(entry);
}
function fillUncolored(entry, hex) {
  if (!entry.colorMask || entry.filledWith === hex || !entry.mesh) return;
  const attr = entry.mesh.geometry.getAttribute('color');
  if (!attr) return;
  const c = new THREE.Color(hex); // converted to the linear working space, like the STEP colours
  const mask = entry.colorMask;
  for (let i = 0; i < mask.length; i++) if (mask[i]) attr.setXYZ(i, c.r, c.g, c.b);
  attr.needsUpdate = true;
  entry.filledWith = hex;
}
function syncEdges(entry) {
  const want = prefs.edges && !!entry.mesh && edgesAllowed(entry);
  if (want && !entry.edges && entry.mesh) {
    let geometry;
    if (entry.brepEdges) {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(entry.brepEdges, 3));
    } else {
      geometry = new THREE.EdgesGeometry(entry.mesh.geometry, 20);
    }
    entry.edges = new THREE.LineSegments(geometry, edgeMaterial);
    partsGroup.add(entry.edges);
  }
  if (entry.edges) entry.edges.visible = want && !prefs.hidden.has(entry.key);
}
function disposeEntry(entry) {
  if (entry.edges) {
    partsGroup.remove(entry.edges);
    entry.edges.geometry.dispose();
    entry.edges = null;
  }
  if (entry.back) {
    partsGroup.remove(entry.back);
    entry.back = null;
  }
  if (entry.mesh) {
    partsGroup.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    /** @type {THREE.Material} */ (entry.mesh.material).dispose();
    entry.mesh = null;
  }
}
function removeEntry(key) {
  const entry = parts.get(key);
  if (!entry) return;
  disposeEntry(entry);
  parts.delete(key);
  colorSlots.delete(key);
}

function entryUrl(entry, info) {
  const v = keyOf(info);
  if (entry.ref.source === 'scene') {
    const file = typeof info.file === 'string' ? info.file : `${entry.ref.name}.stl`;
    return apiUrl(`part/${encodeURIComponent(file)}`, { v });
  }
  return apiUrl('file', { root: entry.ref.root, rel: entry.ref.rel, v });
}

async function errorMessage(res) {
  try {
    const body = await res.json();
    if (body && typeof body.message === 'string' && body.message) return body.message;
  } catch {
    /* not JSON */
  }
  return `请求失败（HTTP ${res.status}）`;
}

/**
 * Fetch a model: STL as-is, or the server's CQVM conversion of a STEP file
 * (assembly bodies with names and colours plus real B-rep edges).
 */
async function fetchModel(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(await errorMessage(res));
  const type = res.headers.get('content-type') || '';
  const buffer = await res.arrayBuffer();
  if (type.startsWith(CQVM_TYPE)) return parseCqvm(buffer);
  return { geometry: parseStl(buffer), edges: null, bodies: null, vertexColors: false, colorMask: null };
}

function parseStl(buffer) {
  if (buffer.byteLength < 84) throw new Error('不是有效的 STL 文件');
  const geometry = loader.parse(buffer);
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) throw new Error('文件里没有三角面');
  const normal = geometry.getAttribute('normal');
  let zeroNormals = !normal;
  if (normal) {
    let zeros = 0;
    const n = Math.min(normal.count, 300);
    for (let i = 0; i < n; i++) if (normal.getX(i) === 0 && normal.getY(i) === 0 && normal.getZ(i) === 0) zeros++;
    zeroNormals = zeros > n / 2;
  }
  if (zeroNormals) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** CQVM: "CQVM" | u32 version | u32 jsonLen | JSON header | 4-aligned typed arrays. */
function parseCqvm(buffer) {
  if (buffer.byteLength < 12) throw new Error('模型数据不完整');
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'CQVM') throw new Error('模型数据格式不对');
  if (dv.getUint32(4, true) !== 1) throw new Error('模型数据版本不支持，请刷新页面');
  const jsonLen = dv.getUint32(8, true);
  if (12 + jsonLen > buffer.byteLength) throw new Error('模型数据不完整');
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, jsonLen)));
  const base = 12 + jsonLen;
  const view = (d, Ctor) => {
    if (!d) return null;
    if (base + d.offset + d.length * 4 > buffer.byteLength) throw new Error('模型数据不完整');
    return new Ctor(buffer, base + d.offset, d.length);
  };
  const positions = view(header.positions, Float32Array);
  const indices = view(header.indices, Uint32Array);
  const colors = view(header.colors, Float32Array);
  const edges = view(header.edges, Float32Array);
  if (!positions || !indices || indices.length === 0) throw new Error('这个 STEP 里没有实体');

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  let colorMask = null;
  if (colors) {
    const col = new Float32Array(colors); // own copy: uncoloured vertices get filled with the part colour
    colorMask = new Uint8Array(col.length / 3);
    let uncolored = 0;
    for (let i = 0; i < colorMask.length; i++) {
      if (col[i * 3] < 0) {
        colorMask[i] = 1;
        uncolored++;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.5;
      }
    }
    if (!uncolored) colorMask = null;
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  geometry.computeVertexNormals(); // vertices are per face, so creases between faces stay sharp
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const bodies = Array.isArray(header.bodies)
    ? header.bodies.filter((b) => b && Array.isArray(b.tri) && b.tri.length === 2)
    : [];
  return { geometry, edges: edges && edges.length ? edges : null, bodies, vertexColors: !!colors, colorMask };
}

/** Body (part inside a STEP assembly) that owns a triangle, by binary search over tri ranges. */
function bodyAt(entry, faceIndex) {
  const bodies = entry?.bodies;
  if (!bodies || !bodies.length || typeof faceIndex !== 'number') return null;
  let lo = 0;
  let hi = bodies.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, count] = bodies[mid].tri;
    if (faceIndex < start) hi = mid - 1;
    else if (faceIndex >= start + count) lo = mid + 1;
    else return bodies[mid];
  }
  return null;
}

/** Load (or reload) an entry unless the same version is already loaded or in flight. */
function ensureLoaded(entry, info) {
  const key = keyOf(info);
  entry.info = { ...entry.info, ...info };
  if (entry.loadedKey === key) {
    applyMaterial(entry);
    return null;
  }
  if (entry.pendingKey === key && entry.status === 'loading') return null;
  return loadEntry(entry, info);
}

async function loadEntry(entry, info) {
  const key = keyOf(info);
  entry.status = 'loading';
  entry.pendingKey = key;
  renderParts();
  try {
    const model = await fetchModel(entryUrl(entry, info));
    const geometry = model.geometry;
    if (entry.pendingKey !== key || parts.get(entry.key) !== entry) {
      geometry.dispose(); // superseded by a newer version, or closed meanwhile
      return;
    }
    disposeEntry(entry);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.55,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    entry.mesh = new THREE.Mesh(geometry, material);
    entry.mesh.userData.key = entry.key;
    entry.back = new THREE.Mesh(geometry, sectionMaterial);
    entry.back.raycast = () => {};
    partsGroup.add(entry.mesh, entry.back);
    const index = geometry.getIndex();
    entry.tris = index ? index.count / 3 : geometry.getAttribute('position').count / 3;
    entry.vertexColors = model.vertexColors;
    entry.colorMask = model.colorMask;
    entry.filledWith = null;
    entry.brepEdges = model.edges;
    entry.bodies = model.bodies;
    entry.loadedKey = key;
    entry.status = 'ready';
    entry.error = undefined;
    applyMaterial(entry);
  } catch (error) {
    if (entry.pendingKey !== key) return;
    entry.status = 'error';
    entry.error = error instanceof Error ? error.message : String(error);
  } finally {
    renderParts();
  }
}

const closeIcon =
  '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

function orderedEntries() {
  const scene = [...parts.values()].filter((e) => e.ref.source === 'scene').sort((a, b) => a.label.localeCompare(b.label));
  const files = prefs.opened.map((k) => parts.get(k)).filter(Boolean);
  return [...scene, .../** @type {PartEntry[]} */ (files)];
}

function renderParts() {
  const entries = orderedEntries();
  el.parts.replaceChildren();
  for (const entry of entries) {
    const li = document.createElement('li');
    li.dataset.loading = String(entry.status === 'loading');
    li.title = entry.title;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !prefs.hidden.has(entry.key);
    cb.setAttribute('aria-label', `显示 ${entry.label}`);
    cb.addEventListener('change', () => {
      if (cb.checked) prefs.hidden.delete(entry.key);
      else prefs.hidden.add(entry.key);
      savePrefs();
      applyMaterial(entry);
      afterSceneChange(false);
    });

    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = partColor(entry);
    if ((entry.info.opacity ?? 1) < 1) sw.style.opacity = String(Math.max(entry.info.opacity ?? 1, 0.35));
    sw.setAttribute('aria-hidden', 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'part-name';
    btn.textContent = entry.label;
    btn.setAttribute('aria-label', `适配视图到 ${entry.label}`);
    btn.addEventListener('click', () => {
      if (entry.mesh?.geometry.boundingBox) fitTo(entry.mesh.geometry.boundingBox);
    });

    const meta = document.createElement('span');
    if (entry.status === 'error') {
      meta.className = 'part-error';
      meta.textContent = entry.error || '打开失败';
      meta.title = entry.error || '打开失败';
    } else if (entry.status === 'loading' && !entry.mesh) {
      meta.className = 'part-meta';
      meta.textContent = '正在打开…';
    } else if (entry.bodies && entry.bodies.length > 1) {
      meta.className = 'part-meta';
      meta.textContent = `${entry.bodies.length} 个零件`;
      meta.title = [...new Set(entry.bodies.map((b) => b.name).filter(Boolean))].join('、');
    }
    li.append(cb, sw, btn, meta);

    if (entry.ref.source === 'file') {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'icon-btn';
      close.innerHTML = closeIcon;
      close.setAttribute('aria-label', `关闭 ${entry.label}`);
      close.title = '关闭';
      close.addEventListener('click', () => closeFile(entry.key));
      li.append(close);
    }
    el.parts.append(li);
  }
  el.partsEmpty.hidden = entries.length > 0;
  el.partsBadge.hidden = entries.length === 0;
  el.partsBadge.textContent = String(entries.length);
}

// ---------------------------------------------------------------- pushed scene sync
let refreshing = false;
let refreshAgain = false;
async function refreshScene() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      await syncScene();
    } while (refreshAgain);
  } catch (error) {
    showWarning(`~/.cqview/scene 读取失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    refreshing = false;
  }
}

/** Parts pushed to ~/.cqview/scene, listed in the files panel; only the ticked ones are loaded. */
let sceneParts = /** @type {(PartInfo & {name: string, file?: string})[]} */ ([]);
/** @type {Set<string>} */
const openScene = new Set();

async function syncScene() {
  const res = await fetch(apiUrl('scene'), { cache: 'no-store' });
  if (!res.ok) throw new Error(await errorMessage(res));
  const data = await res.json();
  if (!data || !Array.isArray(data.parts)) throw new Error('场景数据格式不正确');
  showWarning(Array.isArray(data.warnings) ? data.warnings.join('；') : '');

  const incoming = data.parts.filter((p) => p && typeof p.name === 'string');
  sceneParts = incoming;
  const available = new Map(incoming.map((p) => [p.name, p]));
  for (const name of [...openScene]) if (!available.has(name)) openScene.delete(name);
  for (const entry of [...parts.values()]) {
    if (entry.ref.source === 'scene' && !openScene.has(entry.ref.name)) removeEntry(entry.key);
  }
  const loads = [];
  for (const name of openScene) {
    const info = available.get(name);
    const key = sceneKey(name);
    const entry = parts.get(key) ?? makeEntry(key, { source: 'scene', name }, info);
    // scene.json may drop a colour: rebuild meta from the fresh record rather than merging
    entry.info = { size: entry.info.size, mtime: entry.info.mtime };
    const job = ensureLoaded(entry, info);
    if (job) loads.push(job);
  }
  renderParts();
  renderFileList();
  await Promise.all(loads);
  afterSceneChange(true);
}

async function openScenePart(name) {
  if (openScene.has(name)) return;
  openScene.add(name);
  prefs.hidden.delete(sceneKey(name));
  const refit = hadContent;
  await refreshScene();
  if (refit && parts.get(sceneKey(name))?.mesh) fitTo(visibleBox());
}
function closeScenePart(name) {
  openScene.delete(name);
  const key = sceneKey(name);
  prefs.hidden.delete(key);
  removeEntry(key);
  const kept = picks.filter((p) => !(p.ref && p.ref.source === 'scene' && p.ref.name === name));
  if (kept.length !== picks.length) setPicks(kept);
  renderParts();
  renderFileList();
  afterSceneChange(false);
}

// ---------------------------------------------------------------- folders & files
/**
 * The chat folder this page works in: from the Host (agent.session()), or from ?root= when the
 * Host cannot tell. null when the Viewer is not opened in a chat: then nothing is listed.
 * @type {{dir: string, source: 'session'|'param', since: number, folder: {id: string, label: string, display: string} | null} | null}
 */
let workspace = null;
/** The session folder first, then the extra folders added to it. @type {{id:string,label:string,display:string,kind?:string,missing?:boolean}[]} */
let roots = [];
/** @type {Map<string, {files:{rel:string,size:number,mtime:number,kind:'stl'|'step'}[], truncated:boolean, error:string, loading:boolean}>} */
const fileLists = new Map();
/** Folder groups the user folded in the files panel (page lifetime only). @type {Set<string>} */
const collapsedFolders = new Set();
/** The pushed-model folder (~/.cqview/scene) is listed as one more folder, under this id. */
const SCENE_FOLDER = 'scene';

/** @param {any} data */
function applyWorkspace(data) {
  if (!workspace || !data || !data.folder || !ROOT_ID_RE.test(data.folder.id)) throw new Error('会话文件夹数据格式不正确');
  workspace.folder = data.folder;
  const before = new Set(roots.map((r) => r.id));
  roots = [data.folder, ...(Array.isArray(data.extras) ? data.extras : [])].filter((r) => r && ROOT_ID_RE.test(r.id));
  if (typeof data.selectionFile === 'string') selectionFile = data.selectionFile;
  for (const id of [...fileLists.keys()]) if (!roots.some((r) => r.id === id)) fileLists.delete(id);
  for (const r of roots) if (!before.has(r.id) && !r.missing) void syncFiles(r.id);
  renderChip();
  renderFileList();
}
/** @param {string} path @param {Record<string, unknown>} body */
async function postWorkspace(path, body) {
  if (!workspace) throw new Error('不在对话中');
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir: workspace.dir, ...body }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}
async function loadWorkspace() {
  applyWorkspace(await postWorkspace('workspace', {}));
}
/** @param {string} path @returns {Promise<string>} id of the added folder */
async function addExtraFolder(path) {
  applyWorkspace(await postWorkspace('workspace/folders', { path }));
  return roots[roots.length - 1].id; // the server keeps the newest last
}
/** @param {string} id */
async function removeExtraFolder(id) {
  applyWorkspace(await postWorkspace('workspace/folders', { remove: id }));
  for (const key of [...prefs.opened]) if (parseFileKey(key)?.root === id) closeFile(key);
  collapsedFolders.delete(id);
  renderFileList();
}

/** Unfold a folder group, refresh its list, and bring it into view. */
function revealFolder(id) {
  collapsedFolders.delete(id);
  renderFileList();
  requestAnimationFrame(() => el.folders.querySelector(`[data-folder="${id}"]`)?.scrollIntoView({ block: 'nearest' }));
  return id === SCENE_FOLDER ? refreshScene() : syncFiles(id);
}

/** The title chip names the session folder. */
function renderChip() {
  el.rootAddToggle.disabled = !workspace;
  const cur = roots[0];
  el.rootName.textContent = cur ? cur.label : workspace ? '正在读取…' : '不在对话中';
  el.rootName.title = cur ? cur.display : '';
}

async function syncFiles(rootId) {
  const state = fileLists.get(rootId) ?? { files: [], truncated: false, error: '', loading: true };
  state.loading = true;
  fileLists.set(rootId, state);
  renderFileList();
  try {
    const res = await fetch(apiUrl('files', { root: rootId }), { cache: 'no-store' });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = await res.json();
    if (!data || !Array.isArray(data.files)) throw new Error('文件列表格式不正确');
    state.files = data.files.filter((f) => f && typeof f.rel === 'string');
    state.truncated = !!data.truncated;
    state.error = '';
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  state.loading = false;
  renderFileList();
  await reconcileOpened(rootId, state);
}

async function reconcileOpened(rootId, state) {
  if (state.error) return; // keep what is on screen; the list shows the error
  const byRel = new Map(state.files.map((f) => [f.rel, f]));
  const loads = [];
  for (const key of prefs.opened) {
    const fk = parseFileKey(key);
    if (!fk || fk.root !== rootId) continue;
    const file = byRel.get(fk.rel);
    let entry = parts.get(key);
    if (!file) {
      if (!entry) entry = makeEntry(key, { source: 'file', root: fk.root, rel: fk.rel }, { size: 0, mtime: 0 });
      entry.status = 'error';
      entry.error = '文件已不存在';
      continue;
    }
    if (!entry) entry = makeEntry(key, { source: 'file', root: fk.root, rel: fk.rel }, file);
    const job = ensureLoaded(entry, file);
    if (job) loads.push(job);
  }
  renderParts();
  if (loads.length) {
    await Promise.all(loads);
    afterSceneChange(true);
  }
}

async function openFile(rootId, file) {
  const key = fileKey(rootId, file.rel);
  if (prefs.opened.includes(key)) return;
  prefs.opened.push(key);
  prefs.hidden.delete(key);
  const entry = makeEntry(key, { source: 'file', root: rootId, rel: file.rel }, file);
  renderFileList();
  const refit = hadContent;
  await loadEntry(entry, file);
  afterSceneChange(true);
  if (refit && entry.mesh) fitTo(visibleBox());
}

function closeFile(key) {
  prefs.opened = prefs.opened.filter((k) => k !== key);
  prefs.hidden.delete(key);
  removeEntry(key);
  const kept = picks.filter((p) => !(p.ref && p.ref.source === 'file' && fileKey(p.ref.root, p.ref.rel) === key));
  if (kept.length !== picks.length) setPicks(kept);
  renderParts();
  renderFileList();
  afterSceneChange(false);
}

/**
 * @param {{checked: boolean, name: string, step: boolean, dir?: string, size: number, title: string,
 *   label: string, onChange: (checked: boolean) => void}} f
 */
function fileRow(f) {
  const li = document.createElement('li');
  const label = document.createElement('label');
  label.className = 'file-row';
  label.title = f.title;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = f.checked;
  cb.setAttribute('aria-label', f.label);
  cb.addEventListener('change', () => f.onChange(cb.checked));
  const main = document.createElement('span');
  main.className = 'file-main';
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = f.name;
  if (f.step) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'STEP';
    name.append(tag);
  }
  main.append(name);
  if (f.dir !== undefined) {
    const dir = document.createElement('span');
    dir.className = 'file-dir';
    dir.textContent = f.dir;
    main.append(dir);
  }
  const size = document.createElement('span');
  size.className = 'file-size';
  size.textContent = fmtSize(f.size);
  label.append(cb, main, size);
  li.append(label);
  return li;
}

const chevronIcon =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6l-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const minusIcon =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

/**
 * One group per folder: the session folder, its extra folders, and ~/.cqview/scene when it holds
 * pushed models. Each group folds; ticking a model opens it.
 * @param {{id: string, label: string, display: string, kind?: string, removable: boolean}} g
 * @param {HTMLLIElement[]} rows @param {string} status @param {boolean} [error]
 */
function folderGroup(g, rows, status, error = false) {
  const open = !collapsedFolders.has(g.id);
  const section = document.createElement('section');
  section.className = 'folder';
  section.dataset.folder = g.id;
  section.setAttribute('aria-label', g.label);
  const head = document.createElement('div');
  head.className = 'folder-head';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'folder-toggle';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-controls', `folder-${g.id}`);
  toggle.title = g.display;
  toggle.innerHTML = chevronIcon;
  const name = document.createElement('span');
  name.className = 'folder-name';
  name.textContent = g.label;
  toggle.append(name);
  if (g.kind === 'session') {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = '会话文件夹';
    toggle.append(tag);
  }
  const count = document.createElement('span');
  count.className = 'folder-count';
  count.textContent = String(rows.length);
  toggle.append(count);
  toggle.addEventListener('click', () => {
    if (collapsedFolders.has(g.id)) collapsedFolders.delete(g.id);
    else collapsedFolders.add(g.id);
    renderFileList();
  });
  head.append(toggle);
  if (g.removable) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.innerHTML = minusIcon;
    remove.title = '从这个对话的列表里移除';
    remove.setAttribute('aria-label', `从这个对话的列表里移除 ${g.label}`);
    remove.addEventListener('click', async () => {
      try {
        await removeExtraFolder(g.id);
        showToast(`已从这个对话移除「${g.label}」`, 'info', 2400);
      } catch (err) {
        showToast(`没有移除：${err instanceof Error ? err.message : String(err)}`, 'error', 4000);
      }
    });
    head.append(remove);
  }
  section.append(head);
  if (open) {
    const path = document.createElement('p');
    path.className = 'folder-path';
    path.textContent = g.display;
    path.title = g.display;
    const list = document.createElement('ul');
    list.className = 'files';
    list.id = `folder-${g.id}`;
    list.append(...rows);
    section.append(path, list);
    if (status) {
      const note = document.createElement('p');
      note.className = error ? 'folder-status error' : 'folder-status';
      note.textContent = status;
      section.append(note);
    }
  }
  return section;
}

function renderFileList() {
  el.folders.replaceChildren();
  el.filesStatus.classList.remove('error');
  if (!workspace) {
    el.filesStatus.textContent = '在对话里打开 CadQuery Viewer，这里会列出对话所在文件夹里的模型。';
    return;
  }
  if (!roots.length) {
    el.filesStatus.textContent = '正在读取会话文件夹…';
    return;
  }
  const filter = el.fileFilter.value.trim().toLowerCase();
  let total = 0;
  let found = 0;
  for (const r of roots) {
    const state = fileLists.get(r.id);
    const files = state?.files ?? [];
    const shown = filter ? files.filter((f) => f.rel.toLowerCase().includes(filter)) : files;
    total += files.length;
    found += shown.length;
    const rows = shown.map((f) => {
      const key = fileKey(r.id, f.rel);
      return fileRow({
        checked: prefs.opened.includes(key),
        name: baseName(f.rel),
        step: f.kind === 'step',
        dir: dirName(f.rel) || '（根目录）',
        size: f.size,
        title: f.rel,
        label: `打开 ${f.rel}`,
        onChange: (on) => (on ? void openFile(r.id, f) : closeFile(key)),
      });
    });
    let status = '';
    let error = false;
    if (r.missing) status = '文件夹已不存在';
    else if (!state || (state.loading && !files.length && !state.error)) status = '正在扫描…';
    else if (state.error) {
      status = state.error;
      error = true;
    } else if (!files.length) status = '没有 STL 或 STEP 文件';
    else if (filter && !shown.length) status = '没有匹配的模型';
    else if (state.truncated) status = '只列出前 1000 个';
    el.folders.append(
      folderGroup({ id: r.id, label: r.label, display: r.display, kind: r.kind, removable: r.kind !== 'session' }, rows, status, error),
    );
  }
  if (sceneParts.length) {
    const shown = filter ? sceneParts.filter((p) => p.name.toLowerCase().includes(filter)) : sceneParts;
    total += sceneParts.length;
    found += shown.length;
    const rows = shown.map((p) =>
      fileRow({
        checked: openScene.has(p.name),
        name: p.name,
        step: p.kind === 'step',
        size: p.size,
        title: `~/.cqview/scene/${p.file ?? p.name}`,
        label: `打开 ${p.name}`,
        onChange: (on) => (on ? void openScenePart(p.name) : closeScenePart(p.name)),
      }),
    );
    el.folders.append(
      folderGroup({ id: SCENE_FOLDER, label: 'scene', display: '~/.cqview/scene', removable: false }, rows, filter && !shown.length ? '没有匹配的模型' : ''),
    );
  }
  const folders = roots.length + (sceneParts.length ? 1 : 0);
  el.filesStatus.textContent = filter
    ? `${folders} 个文件夹，找到 ${found} / ${total} 个模型`
    : `${folders} 个文件夹，共 ${total} 个模型`;
}

// ---------------------------------------------------------------- after any change
function afterSceneChange(fromLoad) {
  sceneBox = allBox();
  sceneRadius = sceneBox.isEmpty() ? 1 : Math.max(sceneBox.getBoundingSphere(new THREE.Sphere()).radius, 1e-3);
  const vis = visibleBox();
  rebuildGrid(vis.isEmpty() ? sceneBox : vis);
  updateClipRange();
  updateInfo(vis);

  if (!workspace) {
    showOverlay(
      'empty',
      '在对话里打开 Viewer',
      '查看器只显示对话所在文件夹里的模型。从一个对话里打开 CadQuery Viewer，就能看到那个文件夹里的 STL 和 STEP。',
    );
    hadContent = false;
  } else if (parts.size === 0) {
    showOverlay('empty', '打开一个模型开始', '在左侧的模型文件里勾选会话文件夹中的 STL 或 STEP。', {
      action: '选择模型',
      onAction: () => openPanel('files'),
      hint: '让 AI 导出模型后用 add_model_file 打开，模型也会出现在这里。',
    });
    hadContent = false;
  } else {
    const anyReady = [...parts.values()].some((p) => p.mesh);
    if (anyReady) hideOverlay();
    else if ([...parts.values()].every((p) => p.status === 'error')) {
      showOverlay('error', '模型没有打开', '可以在「已打开」里查看原因，或换一个文件试试。', {
        action: '查看已打开',
        onAction: () => openPanel('parts'),
      });
    } else {
      showOverlay('loading', '正在打开模型', '大文件需要几秒钟…');
    }
    if (fromLoad && anyReady && !hadContent) {
      hadContent = true;
      fitTo(vis.isEmpty() ? sceneBox : vis, VIEWS.iso);
      setViewPressed('iso');
    }
  }
  updateDepthRange();
  requestRender();
  renderPanel?.viewChanged();
}

function showWarning(text) {
  el.warning.hidden = !text;
  el.warning.textContent = text;
}

// ---------------------------------------------------------------- grid
let grid = null;
let originAxes = null;
let gridStep = 0;
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
function rebuildGrid(box) {
  for (const o of [grid, originAxes]) {
    if (!o) continue;
    helpersGroup.remove(o);
    o.geometry.dispose();
    /** @type {THREE.Material} */ (o.material).dispose();
  }
  grid = null;
  originAxes = null;
  gridStep = 0;
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z * 0.5, 1e-2) * 1.6;
  gridStep = niceStep(span / 16);
  const div = Math.max(2, Math.ceil(span / gridStep / 2) * 2);
  grid = new THREE.GridHelper(gridStep * div, div, css('--cqv-grid-major'), css('--cqv-grid-minor'));
  grid.rotation.x = Math.PI / 2;
  grid.position.set(
    Math.round(center.x / gridStep) * gridStep,
    Math.round(center.y / gridStep) * gridStep,
    box.min.z - span * 0.002,
  );
  originAxes = new THREE.AxesHelper(gridStep * 2);
  originAxes.renderOrder = 1;
  grid.visible = originAxes.visible = prefs.grid;
  helpersGroup.add(grid, originAxes);
}

// ---------------------------------------------------------------- clipping
function axisIndex(axis) {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}
function updateClipRange() {
  const on = clipAxis !== 'off';
  el.clipPos.disabled = !on || sceneBox.isEmpty();
  if (!on || sceneBox.isEmpty()) {
    el.clipVal.textContent = '';
    return;
  }
  const i = axisIndex(clipAxis);
  const lo = sceneBox.min.getComponent(i);
  const hi = sceneBox.max.getComponent(i);
  const v = lo + (hi - lo) * (Number(el.clipPos.value) / 1000);
  const n = new THREE.Vector3();
  n.setComponent(i, -1);
  clipPlane.set(n, v);
  el.clipVal.textContent = `${clipAxis.toUpperCase()} ≤ ${fmt(v, 1)}`;
}
function applyClip() {
  updateClipRange();
  for (const entry of parts.values()) applyMaterial(entry);
  edgeMaterial.clippingPlanes = clipList();
  edgeMaterial.needsUpdate = true;
  sectionMaterial.clippingPlanes = clipList();
  sectionMaterial.needsUpdate = true;
  requestRender();
}

// ---------------------------------------------------------------- white-model capture (for rendering)
// One neutral clay material, a clean light background, no grid / axes / markers / gizmo: the picture
// the background render turns into a finished image.
const CLAY = { color: '#dededa', roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
const CAPTURE_BG = '#f1f2f4';

const hasVisibleModel = () => [...parts.values()].some((p) => p.mesh && p.mesh.visible);
const visibleModelNames = () => orderedEntries().filter((e) => e.mesh && e.mesh.visible).map((e) => e.label);
const FRAME_MARGIN = 0.1;
const FRAME_SAMPLES = 40_000;

/**
 * Where the visible models sit in camera space (x right, y up), clipped to what the window shows,
 * plus a margin: the camera keeps its direction, the picture is cropped to the model. Zoomed in on
 * a detail, the window itself is the limit, so the picture never shows more than the window does.
 * @returns {{cx: number, cy: number, hw: number, hh: number}}
 */
function contentFrame() {
  const va = Math.max(1, el.viewport.clientWidth) / Math.max(1, el.viewport.clientHeight);
  const viewHH = frustumHalf / camera.zoom;
  const viewHW = viewHH * va;
  camera.updateMatrixWorld();
  const toCam = camera.matrixWorldInverse;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const v = new THREE.Vector3();
  const meshes = [...parts.values()].filter((p) => p.mesh && p.mesh.visible).map((p) => /** @type {THREE.Mesh} */ (p.mesh));
  const total = meshes.reduce((s, m) => s + m.geometry.getAttribute('position').count, 0);
  const stride = Math.max(1, Math.ceil(total / FRAME_SAMPLES));
  for (const mesh of meshes) {
    mesh.updateMatrixWorld();
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(toCam);
      if (v.x < x0) x0 = v.x;
      if (v.x > x1) x1 = v.x;
      if (v.y < y0) y0 = v.y;
      if (v.y > y1) y1 = v.y;
    }
  }
  // the window spans viewOffset ± (viewHW, viewHH) in camera space
  x0 = Math.max(x0, viewOffset.x - viewHW);
  x1 = Math.min(x1, viewOffset.x + viewHW);
  y0 = Math.max(y0, viewOffset.y - viewHH);
  y1 = Math.min(y1, viewOffset.y + viewHH);
  if (!(x1 > x0 && y1 > y0)) return { cx: viewOffset.x, cy: viewOffset.y, hw: viewHW, hh: viewHH };
  const hw = ((x1 - x0) / 2) * (1 + 2 * FRAME_MARGIN);
  const hh = ((y1 - y0) / 2) * (1 + 2 * FRAME_MARGIN);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw, hh };
}
/** Width / height of the framed model, for the automatic aspect ratio. */
const frameAspect = () => {
  const f = contentFrame();
  return f.hw / f.hh;
};

/**
 * PNG data URL of the visible models at `aspect` (width / height): same camera direction, cropped
 * to the model (contentFrame). Synchronous, so the window is restored before the browser paints.
 * @param {{longSide: number, aspect: number, keepColors: boolean}} opts
 */
function captureView({ longSide, aspect, keepColors }) {
  const w = Math.round(aspect >= 1 ? longSide : longSide * aspect);
  const h = Math.round(aspect >= 1 ? longSide / aspect : longSide);
  const frame = contentFrame();
  // grow the frame to the requested aspect around its centre (never crop the model)
  const hh = Math.max(frame.hh, frame.hw / aspect);
  const hw = hh * aspect;
  const zoom = camera.zoom; // the projection divides the extent (not the centre) by zoom

  const ratio = renderer.getPixelRatio();
  const clear = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const helpersVisible = helpersGroup.visible;
  const pickVisible = pickGroup.visible;
  const edgeColor = edgeMaterial.color.clone();
  const edgeOpacity = edgeMaterial.opacity;
  const sectionColor = sectionMaterial.color.clone();
  /** @type {[THREE.Mesh, THREE.Material][]} */
  const swapped = [];
  try {
    camera.left = frame.cx - hw * zoom;
    camera.right = frame.cx + hw * zoom;
    camera.top = frame.cy + hh * zoom;
    camera.bottom = frame.cy - hh * zoom;
    camera.updateProjectionMatrix();
    helpersGroup.visible = false;
    pickGroup.visible = false;
    edgeMaterial.color.set('#3d4148');
    edgeMaterial.opacity = 0.4;
    if (!keepColors) {
      sectionMaterial.color.set('#c9c9c5');
      for (const p of parts.values()) {
        if (!p.mesh) continue;
        const old = /** @type {THREE.MeshStandardMaterial} */ (p.mesh.material);
        const opacity = old.opacity ?? 1;
        p.mesh.material = new THREE.MeshStandardMaterial({
          ...CLAY,
          transparent: opacity < 1,
          opacity,
          depthWrite: opacity >= 1,
          clippingPlanes: clipList(),
        });
        swapped.push([p.mesh, old]);
      }
    }
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.autoClear = true;
    renderer.setClearColor(CAPTURE_BG, 1);
    renderer.render(scene, camera);
    return el.canvas.toDataURL('image/png');
  } finally {
    for (const [mesh, old] of swapped) {
      /** @type {THREE.Material} */ (mesh.material).dispose();
      mesh.material = old;
    }
    helpersGroup.visible = helpersVisible;
    pickGroup.visible = pickVisible;
    edgeMaterial.color.copy(edgeColor);
    edgeMaterial.opacity = edgeOpacity;
    sectionMaterial.color.copy(sectionColor);
    renderer.setClearColor(clear, clearAlpha);
    renderer.setPixelRatio(ratio);
    applySize(); // drawing buffer and frustum back to the window
    renderNow();
  }
}

// ---------------------------------------------------------------- annotations (positions on parts)
/**
 * @typedef {{id:number,x:number,y:number,z:number,part:string|null,body?:string,ref?:PartRef,
 *   normal?:{x:number,y:number,z:number},note?:string}} Pick
 */
const MAX_PICKS = 50;
/** Confirmed annotations (persisted, sent to the AI). @type {Pick[]} */
let picks = [];
/** First points of a session, waiting for 确认 (only while there are no annotations yet). @type {Pick[]} */
let pending = [];
let pickMode = false;
/** Ids of the annotations added since pick mode was turned on, for 撤销上一个. @type {number[]} */
let sessionAdded = [];
/** In-page id, so undo can keep notes written after a point was added. Never persisted. */
let pickSeq = 0;
const nextPickId = () => ++pickSeq;
/** @type {Pick[][]} */
const undoStack = [];
let activePick = -1;
let instruction = '';
let annotOpen = true;
let selectionFile = '~/.cqview/selection.json';
let lastSelectionStamp = '';
const clientId = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.replace(/[^a-z0-9]/g, '').slice(0, 24);
const raycaster = new THREE.Raycaster();
let downAt = null;

const clonePicks = (list) => list.map((p) => ({ ...p, ...(p.normal ? { normal: { ...p.normal } } : {}) }));
const pointAt = (i) => (i < picks.length ? picks[i] : pending[i - picks.length]);

/** First visible surface hit under the cursor (respecting the section plane), or null. */
function hitAt(clientX, clientY) {
  const rect = el.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const targets = [...parts.values()].filter((p) => p.mesh && p.mesh.visible).map((p) => p.mesh);
  if (!targets.length) return null;
  return (
    raycaster
      .intersectObjects(targets, false)
      .find((h) => clipAxis === 'off' || clipPlane.distanceToPoint(h.point) >= -1e-6) ?? null
  );
}

/** @returns {Pick} */
function pickFromHit(hit) {
  const entry = parts.get(hit.object.userData.key);
  const body = entry ? bodyAt(entry, hit.faceIndex) : null;
  /** @type {Pick} */
  const p = {
    id: nextPickId(),
    x: round(hit.point.x),
    y: round(hit.point.y),
    z: round(hit.point.z),
    part: entry ? entry.label : null,
    ...(entry ? { ref: entry.ref } : {}),
    // only worth naming when the file is an assembly of several parts
    ...(body && entry.bodies.length > 1 && (body.path || body.name) ? { body: body.path || body.name } : {}),
  };
  if (hit.face) p.normal = { x: round(hit.face.normal.x, 4), y: round(hit.face.normal.y, 4), z: round(hit.face.normal.z, 4) };
  return p;
}
const bodyShort = (body) => (body ? body.split('/').filter(Boolean).pop() || body : '');

el.canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) downAt = { x: e.clientX, y: e.clientY };
  hideHover();
});
el.canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved <= 4 && pickMode) addPoint(e);
});

// ---- pick mode
// The first points of a session are collected as "pending" and confirmed together, so a first
// look around costs nothing. Once there are annotations, pick mode stays on and every click goes
// straight into the list with its note box focused: pick a point, write what you want there,
// pick the next one. The instruction box stays editable the whole time.
const inBatch = () => picks.length === 0 || pending.length > 0;

function addPoint(e) {
  const hit = hitAt(e.clientX, e.clientY);
  if (!hit) {
    showToast('请点在模型表面上', 'info', 1400);
    return;
  }
  if (picks.length + pending.length >= MAX_PICKS) {
    showToast(`最多标注 ${MAX_PICKS} 个位置`, 'warning');
    return;
  }
  const p = pickFromHit(hit);
  if (inBatch()) {
    pending = [...pending, p];
    renderPickBar();
    return;
  }
  sessionAdded.push(p.id);
  annotOpen = true;
  setPicks([...picks, p]);
  focusNote(picks.length - 1);
}

function setPickMode(on) {
  if (pickMode === on) return;
  pickMode = on;
  pending = [];
  sessionAdded = [];
  if (!on) hideHover();
  document.body.classList.toggle('picking', on);
  el.pickToggle.setAttribute('aria-pressed', String(on));
  el.confirmBar.hidden = !on;
  renderPickBar();
}

/** Add the pending points to the list and keep picking. */
function confirmPending() {
  if (!pending.length) return;
  const added = pending;
  const firstNew = picks.length;
  pending = [];
  sessionAdded.push(...added.map((p) => p.id));
  annotOpen = true;
  setPicks([...picks, ...added]);
  focusNote(firstNew);
}

function focusNote(i) {
  requestAnimationFrame(() => {
    const note = /** @type {HTMLInputElement | undefined} */ (el.pickList.querySelectorAll('.note')[i]);
    if (!note) return;
    note.focus({ preventScroll: true });
    note.closest('li')?.scrollIntoView({ block: 'nearest' });
  });
}

function removeLastPending() {
  if (!pending.length) return false;
  pending = pending.slice(0, -1);
  renderPickBar();
  return true;
}

/** Newest annotation added in this pick session that still exists. */
function lastSessionPickId() {
  for (let k = sessionAdded.length - 1; k >= 0; k--) {
    const id = sessionAdded[k];
    if (picks.some((p) => p.id === id)) return id;
  }
  return null;
}
function removeLastSessionPick() {
  const id = lastSessionPickId();
  if (id === null) return false;
  sessionAdded = sessionAdded.slice(0, sessionAdded.lastIndexOf(id));
  setPicks(picks.filter((p) => p.id !== id)); // recorded: ⌘Z brings it back
  return true;
}
/** 撤销上一个 / Backspace: the last pending point, else the last point added in this session. */
function removeLastPoint() {
  return removeLastPending() || removeLastSessionPick();
}

function renderPickBar() {
  const batch = inBatch();
  el.confirmBar.dataset.mode = batch ? 'batch' : 'continuous';
  const strong = (n) => Object.assign(document.createElement('strong'), { textContent: String(n) });
  if (batch) {
    const n = pending.length;
    if (n) el.confirmText.replaceChildren('已选择 ', strong(n), ' 个位置');
    else el.confirmText.textContent = '在模型上点击要标注的位置，可以连续选多个';
    el.pendingUndo.disabled = n === 0;
    el.pendingConfirm.disabled = n === 0;
    el.pendingConfirm.textContent = n ? `确认 ${n} 个位置` : '确认';
  } else {
    el.confirmText.replaceChildren('继续点击模型，新位置直接加入标注 · 共 ', strong(picks.length), ' 处');
    el.pendingUndo.disabled = lastSessionPickId() === null;
  }
  el.pendingCancel.hidden = !batch;
  el.pendingConfirm.hidden = !batch;
  el.pickDone.hidden = batch;
  syncMarkers();
}

// ---- confirmed annotations
/** Every structural change goes through here so it can be undone and is persisted. */
function setPicks(next, record = true) {
  if (record) {
    undoStack.push(clonePicks(picks));
    if (undoStack.length > 30) undoStack.shift();
  }
  picks = next;
  activePick = -1;
  renderPicks();
  void postSelection();
}
function undoPicks() {
  const prev = undoStack.pop();
  if (!prev) return false;
  // Undo reverts which points exist, not what was written since: a point that is still there
  // keeps its current note.
  const live = new Map(picks.map((p) => [p.id, p]));
  picks = prev.map((p) => {
    const cur = live.get(p.id);
    return cur && 'note' in cur ? { ...p, note: cur.note } : p;
  });
  activePick = -1;
  renderPicks();
  void postSelection();
  return true;
}

// hover preview (pick mode only): shows where a click would land
let hoverEvent = null;
let hoverTimer = null;
el.canvas.addEventListener('pointermove', (e) => {
  if (!pickMode || e.buttons !== 0) {
    hideHover();
    return;
  }
  hoverEvent = e;
  if (!hoverTimer) {
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (hoverEvent && pickMode) updateHover(hoverEvent);
    }, 40);
  }
});
el.canvas.addEventListener('pointerleave', () => {
  hoverEvent = null;
  hideHover();
});
function updateHover(e) {
  const hit = hitAt(e.clientX, e.clientY);
  hoverPoint = hit ? hit.point.clone() : null;
  requestRender();
}
function hideHover() {
  if (!hoverPoint && el.hoverDot.hidden) return;
  hoverPoint = null;
  el.hoverDot.hidden = true;
}

const projected = new THREE.Vector3();
function screenOf(x, y, z, w, h) {
  projected.set(x, y, z).project(camera);
  if (projected.z < -1 || projected.z > 1) return null;
  const sx = ((projected.x + 1) / 2) * w;
  const sy = ((1 - projected.y) / 2) * h;
  if (sx < -24 || sy < -24 || sx > w + 24 || sy > h + 24) return null;
  return [sx, sy];
}
/** Called after every WebGL frame so HTML markers track the camera. */
function positionOverlays(w, h) {
  markerEls.forEach((m, i) => {
    const p = pointAt(i);
    const s = p ? screenOf(p.x, p.y, p.z, w, h) : null;
    m.hidden = !s;
    if (s) m.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px)`;
    m.dataset.active = String(i === activePick);
  });
  const hs = hoverPoint ? screenOf(hoverPoint.x, hoverPoint.y, hoverPoint.z, w, h) : null;
  el.hoverDot.hidden = !hs;
  if (hs) el.hoverDot.style.transform = `translate(${hs[0].toFixed(1)}px, ${hs[1].toFixed(1)}px)`;
  if (!el.pivotDot.hidden && pivotPoint) {
    const ps = screenOf(pivotPoint.x, pivotPoint.y, pivotPoint.z, w, h);
    if (ps) el.pivotDot.style.transform = `translate(${ps[0].toFixed(1)}px, ${ps[1].toFixed(1)}px)`;
  }
}

function syncMarkers() {
  const total = picks.length + pending.length;
  while (markerEls.length < total) {
    const m = document.createElement('div');
    m.className = 'marker';
    m.append(document.createElement('span'));
    el.markers.append(m);
    markerEls.push(m);
  }
  while (markerEls.length > total) markerEls.pop()?.remove();
  markerEls.forEach((m, i) => {
    m.classList.toggle('pending', i >= picks.length);
    /** @type {HTMLElement} */ (m.firstChild).textContent = String(i + 1);
  });
  pickLine.visible = picks.length === 2 && pending.length === 0;
  if (pickLine.visible) {
    const [a, b] = picks;
    pickLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z], 3));
  }
  requestRender();
}

function renderPicks() {
  renderPickBar(); // also redraws the markers
  el.pickList.replaceChildren(...picks.map((p, i) => pickItem(p, i)));
  el.pickEmpty.hidden = picks.length > 0;
  el.annotCount.textContent = picks.length ? String(picks.length) : '';
  el.annotFabCount.textContent = String(picks.length);
  el.clearPick.disabled = picks.length === 0;
  updateAnnotVisibility();
  updateCompose();
}

function updateAnnotVisibility() {
  const has = picks.length > 0;
  el.annot.hidden = !(has && annotOpen);
  el.annotFab.hidden = !(has && !annotOpen);
}

function pickItem(p, i) {
  const n = i + 1;
  const li = document.createElement('li');
  li.className = 'pick-item';
  li.dataset.active = String(i === activePick);

  const head = document.createElement('div');
  head.className = 'pick-head';

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'pick-badge';
  badge.textContent = String(n);
  badge.title = '以这个位置为旋转中心';
  badge.setAttribute('aria-label', `定位到第 ${n} 个位置`);
  badge.addEventListener('click', () => focusPick(i));

  const main = document.createElement('div');
  main.className = 'pick-main';
  const part = document.createElement('div');
  part.className = 'pick-part';
  part.textContent = (p.part ?? '未知零件') + (p.body ? ` › ${bodyShort(p.body)}` : '');
  part.title = [p.part, p.body].filter(Boolean).join(' › ');
  const xyz = document.createElement('div');
  xyz.className = 'mono';
  xyz.textContent = `${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}`;
  const sub = document.createElement('div');
  sub.className = 'pick-sub mono';
  if (i > 0) {
    const a = picks[i - 1];
    sub.textContent = `距 #${i} ${fmt(Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z))} mm`;
  }
  main.append(part, xyz, sub);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'icon-btn';
  del.innerHTML = closeIcon;
  del.title = '删除';
  del.setAttribute('aria-label', `删除第 ${n} 个位置`);
  del.addEventListener('click', () => setPicks(picks.filter((_, j) => j !== i)));

  head.append(badge, main, del);

  const note = document.createElement('input');
  note.type = 'text';
  note.className = 'input note';
  note.maxLength = 500;
  note.value = p.note ?? '';
  note.placeholder = '这里要做什么，如：加 R2 圆角';
  note.setAttribute('aria-label', `第 ${n} 个位置的备注`);
  note.addEventListener('input', () => {
    p.note = note.value;
    scheduleSave();
    updateCompose();
  });
  note.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') note.blur();
  });

  li.append(head, note);
  li.addEventListener('mouseenter', () => setActivePick(i));
  li.addEventListener('mouseleave', () => setActivePick(-1));
  li.addEventListener('focusin', () => setActivePick(i));
  li.addEventListener('focusout', () => setActivePick(-1));
  return li;
}

function setActivePick(i) {
  if (activePick === i) return;
  activePick = i;
  el.pickList.querySelectorAll('.pick-item').forEach((li, j) => {
    /** @type {HTMLElement} */ (li).dataset.active = String(j === i);
  });
  requestRender();
}

function focusPick(i) {
  const p = picks[i];
  if (!p) return;
  const target = new THREE.Vector3(p.x, p.y, p.z);
  camera.position.add(target.clone().sub(controls.target));
  controls.target.copy(target);
  viewOffset.x = viewOffset.y = 0; // the point goes to the middle of the window
  applySize();
  controls.update();
  updateDepthRange();
  requestRender();
}

// ---- compose & send
function displayFileOf(p) {
  if (!p.ref) return null;
  if (p.ref.source === 'scene') {
    const entry = parts.get(sceneKey(p.ref.name));
    const file = typeof entry?.info?.file === 'string' ? entry.info.file : `${p.ref.name}.stl`;
    return `~/.cqview/scene/${file}`;
  }
  const root = roots.find((r) => r.id === p.ref.root);
  return root ? `${root.display}/${p.ref.rel}` : p.ref.rel;
}

/** The exact text that goes to the conversation. */
function buildMessage() {
  const ask = instruction.trim();
  const lines = [ask || '请看我在 CadQuery Viewer 里标注的位置。'];
  if (picks.length) {
    lines.push('', `标注位置（${picks.length} 处，单位 mm，Z 轴向上）：`);
    picks.forEach((p, i) => {
      const normal = p.normal ? `，法向 (${fmt(p.normal.x)}, ${fmt(p.normal.y)}, ${fmt(p.normal.z)})` : '';
      const where = (p.part ?? '未知零件') + (p.body ? ` › ${p.body}` : '');
      lines.push(`#${i + 1} ${where}：(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})${normal}`);
      if (p.note && p.note.trim()) lines.push(`    备注：${p.note.trim()}`);
      const file = displayFileOf(p);
      if (file) lines.push(`    文件：${file}`);
    });
    if (picks.length >= 2) {
      const segs = picks.slice(1).map((b, i) => {
        const a = picks[i];
        return `#${i + 1}→#${i + 2} ${fmt(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z))} mm`;
      });
      lines.push('', `相邻距离：${segs.join('，')}`);
    }
  }
  lines.push('', `（来自 CadQuery Viewer；完整数据：${selectionFile}）`);
  return lines.join('\n');
}

let sending = false;
let bridgeReady = false;
function updateCompose() {
  el.composePreview.textContent = buildMessage();
  const fallback = bridgeReady && !hostBridge.canDeliver();
  el.sendLabel.textContent = sending ? '正在发送…' : fallback ? '复制内容' : '发送到对话';
  el.sendBtn.disabled = sending || (picks.length === 0 && !instruction.trim());
}
function setSendStatus(text, kind = 'info') {
  el.sendStatus.textContent = text;
  el.sendStatus.dataset.kind = kind;
}

async function sendToConversation() {
  if (sending) return;
  const text = buildMessage();
  sending = true;
  updateCompose();
  setSendStatus('');
  try {
    flushSave();
    await postSelection();
    if (!bridgeReady) await detectHostBridge();
    if (!hostBridge.canDeliver()) {
      const ok = await copyText(text);
      setSendStatus(
        ok ? '这个窗口没有连接到对话，内容已复制，可以直接粘贴发送' : '这个窗口没有连接到对话，请在 MiniMax Code 里打开 Viewer',
        ok ? 'info' : 'error',
      );
      return;
    }
    const result = await hostBridge.deliver(text);
    setSendStatus(result.mode === 'sent' ? '已发送到对话' : '已放进对话输入框，按回车即可发送', 'ok');
  } catch (error) {
    setSendStatus(`没有发送成功：${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    sending = false;
    updateCompose();
  }
}

// ---- persistence: one write at a time, coalescing bursts (typing notes, rapid clicks)
let posting = false;
let postDirty = false;
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void postSelection();
  }, 400);
}
function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}
async function postSelection() {
  if (posting) {
    postDirty = true;
    return;
  }
  posting = true;
  try {
    do {
      postDirty = false;
      await writeSelectionOnce();
    } while (postDirty);
  } finally {
    posting = false;
  }
}
async function writeSelectionOnce() {
  if (!workspace?.folder) return; // not in a chat: nothing to annotate
  try {
    const points = picks.map(({ x, y, z, part, body, ref, normal, note }) => ({ x, y, z, part, body, ref, normal, note }));
    const res = await fetch(apiUrl('selection'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: clientId, folder: workspace.folder.id, instruction, points }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const doc = await res.json();
    lastSelectionStamp = typeof doc.updated === 'string' ? doc.updated : '';
  } catch (error) {
    showToast(`标注没有保存：${error instanceof Error ? error.message : String(error)}`, 'error', 4000);
  }
}
async function loadSelection() {
  if (!workspace?.folder) return;
  try {
    const res = await fetch(apiUrl('selection', { folder: workspace.folder.id }), { cache: 'no-store' });
    if (!res.ok) return;
    const doc = await res.json();
    if (!doc || !Array.isArray(doc.points)) return;
    if (doc.updated && doc.updated === lastSelectionStamp) return;
    lastSelectionStamp = doc.updated || '';
    picks = doc.points
      .filter((p) => p && [p.x, p.y, p.z].every((v) => typeof v === 'number' && Number.isFinite(v)))
      .slice(0, MAX_PICKS)
      .map((p) => ({
        id: nextPickId(),
        x: p.x,
        y: p.y,
        z: p.z,
        part: p.part ?? null,
        ...(typeof p.body === 'string' ? { body: p.body } : {}),
        ...(p.ref ? { ref: p.ref } : {}),
        ...(p.normal ? { normal: p.normal } : {}),
        ...(typeof p.note === 'string' ? { note: p.note } : {}),
      }));
    if (document.activeElement !== el.composeText) {
      instruction = typeof doc.instruction === 'string' ? doc.instruction : '';
      el.composeText.value = instruction;
    }
    activePick = -1;
    renderPicks();
  } catch {
    /* annotations are optional */
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ---------------------------------------------------------------- info & formatting
function updateInfo(box) {
  if (box.isEmpty()) {
    el.infoSize.textContent = el.infoCenter.textContent = el.infoTris.textContent = '—';
  } else {
    const s = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    el.infoSize.textContent = `${fmt(s.x, 1)} × ${fmt(s.y, 1)} × ${fmt(s.z, 1)} mm`;
    el.infoCenter.textContent = `${fmt(c.x, 1)}, ${fmt(c.y, 1)}, ${fmt(c.z, 1)}`;
    let tris = 0;
    for (const p of parts.values()) if (p.mesh && p.mesh.visible) tris += p.tris;
    el.infoTris.textContent = fmtCount(tris);
  }
  el.infoGrid.textContent = gridStep ? `${trimNum(gridStep)} mm / 格` : '—';
  let latest = 0;
  for (const p of parts.values()) if (p.mesh) latest = Math.max(latest, p.info.mtime || 0);
  el.infoUpdated.textContent = latest ? new Date(latest).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
}
function round(v, d = 3) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
function fmt(v, d = 2) {
  return (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);
}
function trimNum(v) {
  return Number(v.toPrecision(6)).toString();
}
function fmtCount(n) {
  if (!n) return '0';
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}万`;
  return n.toLocaleString('zh-CN');
}
function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------------------------------------------------------------- UI wiring
// left panels (one at a time)
let openPanelName = /** @type {string|null} */ (null);
function openPanel(name) {
  openPanelName = name;
  for (const [key, panel] of Object.entries(el.panels)) panel.hidden = key !== name;
  for (const b of el.railButtons) b.setAttribute('aria-pressed', String(b.dataset.panel === name));
  renderPanel?.panelToggled(name === 'render');
}
for (const b of el.railButtons) {
  b.addEventListener('click', () => openPanel(openPanelName === b.dataset.panel ? null : b.dataset.panel || null));
}
for (const b of document.querySelectorAll('[data-close-panel]')) b.addEventListener('click', () => openPanel(null));
el.rootName.addEventListener('click', () => openPanel('files'));

// toolbar
el.pickToggle.addEventListener('click', () => setPickMode(!pickMode));
el.pendingUndo.addEventListener('click', () => removeLastPoint());
el.pendingCancel.addEventListener('click', () => setPickMode(false));
el.pendingConfirm.addEventListener('click', () => confirmPending());
el.pickDone.addEventListener('click', () => setPickMode(false));

el.fit.addEventListener('click', () => fitTo(visibleBox()));
for (const b of el.viewButtons) {
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => {
    const name = /** @type {keyof typeof VIEWS} */ (b.dataset.view);
    const box = visibleBox();
    fitTo(box.isEmpty() ? sceneBox : box, VIEWS[name]);
    setViewPressed(name);
  });
}
el.optEdges.setAttribute('aria-pressed', String(prefs.edges));
el.optGrid.setAttribute('aria-pressed', String(prefs.grid));
el.optEdges.addEventListener('click', () => {
  prefs.edges = !prefs.edges;
  el.optEdges.setAttribute('aria-pressed', String(prefs.edges));
  savePrefs();
  for (const entry of parts.values()) syncEdges(entry);
  requestRender();
});
el.optGrid.addEventListener('click', () => {
  prefs.grid = !prefs.grid;
  el.optGrid.setAttribute('aria-pressed', String(prefs.grid));
  savePrefs();
  if (grid) grid.visible = prefs.grid;
  if (originAxes) originAxes.visible = prefs.grid;
  requestRender();
});

function setClipPopover(open) {
  el.clipPop.hidden = !open;
  el.clipToggle.setAttribute('aria-expanded', String(open));
  if (open) setNavPopover(false);
}
el.clipToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  setClipPopover(el.clipPop.hidden);
});
el.clipPop.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => {
  if (!el.clipPop.hidden) setClipPopover(false);
  if (!el.navPop.hidden) setNavPopover(false);
});

// 操作方式: which gestures pan and zoom, and what everything does
const NAV_HELP = {
  trackpad: [
    ['按下拖动', '旋转，绕按下的点'],
    ['双指滑动', '平移'],
    ['双指捏合', '缩放，朝向指针'],
    ['Shift + 拖动', '平移'],
    ['F', '适配视图'],
  ],
  mouse: [
    ['左键拖动', '旋转，绕按下的点'],
    ['右键 / 中键拖动', '平移'],
    ['滚轮', '缩放，朝向光标'],
    ['Shift + 左键拖动', '平移'],
    ['F', '适配视图'],
  ],
};
function setNavPopover(open) {
  el.navPop.hidden = !open;
  el.navToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    setClipPopover(false);
    renderNavHelp();
  }
}
function renderNavHelp() {
  const mode = prefs.navMode;
  for (const b of el.navButtons) b.setAttribute('aria-pressed', String(b.dataset.nav === mode));
  const device = mode !== 'auto' ? mode : detectedDevice ?? (/Mac/i.test(navigator.platform) ? 'trackpad' : 'mouse');
  el.navDetected.textContent =
    mode !== 'auto'
      ? ''
      : detectedDevice
        ? `当前识别为${detectedDevice === 'trackpad' ? '触控板' : '鼠标'}，每次滚动重新判断`
        : '滚动一下，就会识别是触控板还是鼠标';
  el.navKeys.replaceChildren(
    ...NAV_HELP[device].flatMap(([k, v]) => [
      Object.assign(document.createElement('dt'), { textContent: k }),
      Object.assign(document.createElement('dd'), { textContent: v }),
    ]),
  );
}
el.navToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  setNavPopover(el.navPop.hidden);
});
el.navPop.addEventListener('click', (e) => e.stopPropagation());
for (const b of el.navButtons) {
  b.addEventListener('click', () => {
    prefs.navMode = /** @type {'auto'|'trackpad'|'mouse'} */ (b.dataset.nav);
    savePrefs();
    renderNavHelp();
  });
}
for (const b of el.clipButtons) {
  b.addEventListener('click', () => {
    clipAxis = b.dataset.clip || 'off';
    for (const o of el.clipButtons) o.setAttribute('aria-pressed', String(o === b));
    el.clipToggle.classList.toggle('active', clipAxis !== 'off');
    applyClip();
  });
}
el.clipPos.addEventListener('input', () => {
  updateClipRange();
  requestRender();
});

// annotations panel
el.annotCollapse.addEventListener('click', () => {
  annotOpen = false;
  updateAnnotVisibility();
});
el.annotFab.addEventListener('click', () => {
  annotOpen = true;
  updateAnnotVisibility();
});
el.composeText.addEventListener('input', () => {
  instruction = el.composeText.value;
  scheduleSave();
  updateCompose();
});
el.composeText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void sendToConversation();
  }
});
el.sendBtn.addEventListener('click', () => void sendToConversation());
el.clearPick.addEventListener('click', () => {
  if (picks.length) {
    setPicks([]);
    setSendStatus('标注已清空，⌘Z 可以恢复');
  }
});

// files panel
el.fileFilter.addEventListener('input', () => renderFileList());

function setAddFormOpen(open) {
  el.rootAddForm.hidden = !open;
  el.rootAddToggle.setAttribute('aria-expanded', String(open));
  el.rootAddError.hidden = true;
  if (open) el.rootAddInput.focus();
}
el.rootAddToggle.addEventListener('click', () => setAddFormOpen(el.rootAddForm.hidden));
el.rootAddCancel.addEventListener('click', () => setAddFormOpen(false));
el.rootAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = el.rootAddInput.value.trim();
  if (!value) {
    el.rootAddError.hidden = false;
    el.rootAddError.textContent = '请输入文件夹路径';
    return;
  }
  try {
    const id = await addExtraFolder(value);
    el.rootAddInput.value = '';
    setAddFormOpen(false);
    void revealFolder(id);
  } catch (error) {
    el.rootAddError.hidden = false;
    el.rootAddError.textContent = error instanceof Error ? error.message : String(error);
  }
});

// keyboard
window.addEventListener('keydown', (e) => {
  if (renderPanel?.isDialogOpen()) return; // the result viewer is modal and handles Esc itself
  const t = /** @type {HTMLElement} */ (e.target);
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  if (e.key === 'Escape') {
    if (typing) {
      t.blur();
      return;
    }
    if (!el.clipPop.hidden) setClipPopover(false);
    else if (!el.navPop.hidden) setNavPopover(false);
    else if (pickMode) setPickMode(false);
    else if (openPanelName) openPanel(null);
    return;
  }
  if (typing) return;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (pickMode && removeLastPending()) return;
    if (undoPicks()) showToast('已撤销', 'info', 1200);
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'p' || e.key === 'P') setPickMode(!pickMode);
  else if (e.key === 'f' || e.key === 'F') fitTo(visibleBox());
  else if (e.key === 'Enter' && pickMode && pending.length) {
    e.preventDefault();
    confirmPending();
  } else if ((e.key === 'Backspace' || e.key === 'Delete') && pickMode && (pending.length || lastSessionPickId() !== null)) {
    e.preventDefault();
    removeLastPoint();
  }
});

// theme: follow the host when it tells us, otherwise the system
let hostTheme = /** @type {string|null} */ (null);
function refreshThemeColors() {
  renderer.setClearColor(css('--cqv-canvas'), 1);
  edgeMaterial.color.set(css('--cqv-edge'));
  sectionMaterial.color.set(css('--cqv-section'));
  /** @type {THREE.LineBasicMaterial} */ (pickLine.material).color.set(css('--mcode-warning'));
  for (const entry of parts.values()) applyMaterial(entry);
  rebuildGrid(visibleBox().isEmpty() ? sceneBox : visibleBox());
  renderParts();
  requestRender();
}
darkQuery.addEventListener('change', () => {
  if (hostTheme) return;
  document.documentElement.dataset.theme = darkQuery.matches ? 'dark' : 'light';
  refreshThemeColors();
});
function applyHostContext(ctx) {
  const theme = ctx && (ctx.theme === 'dark' || ctx.theme === 'light') ? ctx.theme : null;
  if (!theme) return;
  hostTheme = theme; // the host owns the theme from now on, even if it matches the system today
  if (theme === document.documentElement.dataset.theme) return;
  document.documentElement.dataset.theme = theme;
  refreshThemeColors();
}

// ---------------------------------------------------------------- requests from the AI (MCP tools)
// The Node side keeps the last requests in dataDir and hands each workspace only its own, pointed at
// its folders. Progress is remembered per session folder; the first time, only requests made since
// the chat started (or the last ten minutes, without Host session info) are carried out.
let requestChain = Promise.resolve();
function applyRequests() {
  if (!workspace?.folder) return requestChain;
  requestChain = requestChain.then(applyRequestsNow, applyRequestsNow).catch(() => {});
  return requestChain;
}
const reqKey = () => `cqv.req.v3.${workspace?.folder?.id ?? ''}`;
function loadReqState() {
  try {
    const s = JSON.parse(localStorage.getItem(reqKey()) || 'null');
    return s && typeof s.epoch === 'string' && Number.isInteger(s.seq) ? s : null;
  } catch {
    return null;
  }
}
function saveReqState(epoch, seq) {
  try {
    localStorage.setItem(reqKey(), JSON.stringify({ epoch, seq }));
  } catch {
    /* storage unavailable */
  }
}
async function applyRequestsNow() {
  if (!workspace) return;
  const res = await fetch(apiUrl('requests', { dir: workspace.dir }), { cache: 'no-store' });
  if (!res.ok) return;
  const data = await res.json();
  if (!data || !Array.isArray(data.items) || typeof data.epoch !== 'string') return;
  const state = loadReqState();
  // a new epoch means the request log was recreated: everything in it is new to us
  const fresh = !state || state.epoch !== data.epoch;
  const after = fresh ? 0 : state.seq;
  const todo = data.items
    .filter((it) => it && Number.isInteger(it.seq) && it.seq > after)
    .filter((it) => !fresh || Date.parse(it.at) >= workspace.since)
    .sort((a, b) => a.seq - b.seq);
  for (const item of todo) {
    try {
      await applyRequest(item);
    } catch (error) {
      showToast(`AI 请求的内容没有打开：${error instanceof Error ? error.message : String(error)}`, 'error', 5000);
    }
    saveReqState(data.epoch, item.seq);
  }
  if (fresh || !todo.length) saveReqState(data.epoch, Number.isInteger(data.seq) ? data.seq : 0);
}

async function applyRequest(item) {
  if (item.type === 'scene' && typeof item.name === 'string') {
    prefs.hidden.delete(sceneKey(item.name));
    openScene.add(item.name);
    await refreshScene();
    const entry = await settled(sceneKey(item.name));
    if (entry) applyMaterial(entry);
    revealAll();
    showToast(`AI 打开了 ${item.name}`, 'info', 3000);
    return;
  }
  if ((item.type !== 'folder' && item.type !== 'file') || !ROOT_ID_RE.test(item.root)) return;
  if (!roots.some((r) => r.id === item.root)) await loadWorkspace(); // the AI may just have added it
  const root = roots.find((r) => r.id === item.root);
  if (!root) throw new Error('文件夹已不在列表里');
  await revealFolder(item.root);
  if (item.type === 'folder') {
    openPanel('files');
    showToast(`AI 添加了文件夹「${root.label}」`, 'info', 3000);
    return;
  }
  const state = fileLists.get(item.root);
  if (state?.error) throw new Error(state.error);
  const file = state?.files.find((f) => f.rel === item.rel);
  if (!file) throw new Error(`在「${root.label}」里找不到 ${item.rel}`);
  const key = fileKey(item.root, item.rel);
  if (prefs.opened.includes(key)) {
    // already open: make sure it is shown
    prefs.hidden.delete(key);
    const entry = parts.get(key);
    if (entry) applyMaterial(entry);
    renderParts();
  } else {
    await openFile(item.root, file);
  }
  revealAll();
  showToast(`AI 打开了 ${baseName(item.rel)}`, 'info', 3000);
}

/** Wait briefly for a part to finish its first load (STEP conversion may take longer; it still shows up). */
async function settled(key, ms = 5000) {
  for (let t = 0; t < ms; t += 100) {
    const entry = parts.get(key);
    if (entry && entry.status !== 'loading') return entry;
    await new Promise((r) => setTimeout(r, 100));
  }
  return parts.get(key) ?? null;
}

function revealAll() {
  afterSceneChange(false);
  const box = visibleBox();
  if (!box.isEmpty()) fitTo(box);
}

// ---------------------------------------------------------------- live connection
let events = null;
let offlineTimer = null;
let wasOffline = false;
function rootsInUse() {
  return new Set(roots.map((r) => r.id));
}
function connect() {
  events = new EventSource(apiUrl('events', workspace ? { dir: workspace.dir } : undefined));
  events.onopen = () => {
    if (offlineTimer) clearTimeout(offlineTimer);
    offlineTimer = null;
    if (wasOffline) {
      wasOffline = false;
      showToast('已重新连接', 'info', 1500);
    }
  };
  events.onerror = () => {
    // only surface a problem that lasts; brief reconnects stay invisible
    if (offlineTimer) return;
    offlineTimer = setTimeout(() => {
      offlineTimer = null;
      if (events && events.readyState !== EventSource.OPEN) {
        wasOffline = true;
        showToast('连接中断，正在重新连接…', 'warning', 0);
      }
    }, 3000);
  };
  events.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      void refreshScene();
      for (const id of rootsInUse()) void syncFiles(id);
      void applyRequests(); // the server may have restarted while we were away
      void renderPanel?.refresh();
    } else if (msg.type === 'scene') void refreshScene();
    else if (msg.type === 'renders') void renderPanel?.refresh();
    else if (msg.type === 'files' && typeof msg.root === 'string' && rootsInUse().has(msg.root)) void syncFiles(msg.root);
    else if (msg.type === 'workspace' && msg.folder === workspace?.folder?.id) {
      // extra folders changed (added here, in another page of this folder, or by the AI)
      void loadWorkspace().then(() => renderFileList(), () => {});
    } else if (msg.type === 'request') void applyRequests();
    else if (msg.type === 'selection' && msg.client !== clientId && msg.folder === workspace?.folder?.id) void loadSelection(); // ignore our own echo
    else if (msg.type === 'watch-lost') {
      events?.close();
      setTimeout(connect, 2000);
    }
  };
}
// Close the live connection when the page goes away, so the Node side knows no viewer is
// listening (the AI is told to ask the user to open it). Reconnect if the page comes back.
window.addEventListener('pagehide', () => {
  events?.close();
  events = null;
});
window.addEventListener('pageshow', (ev) => {
  if (ev.persisted && !events) connect();
});

// ---------------------------------------------------------------- boot
const hostBridge = createHostBridge();
hostBridge.onContextChanged(applyHostContext);
let bridgeDetection = null;
/** Handshake with MiniMax Code once; decides which delivery path this window has. */
function detectHostBridge() {
  bridgeDetection ??= (async () => {
    const s = await hostBridge.connect(1500);
    bridgeReady = true;
    applyHostContext(s.hostContext);
    updateCompose();
  })();
  return bridgeDetection;
}

/**
 * Which chat folder this page works in. MiniMax Code tells the page the chat it is open in
 * (agent.session(), granted by agentAccess "session.read"); a Host that cannot, or a page opened
 * outside a chat, falls back to ?root=<folder> (the AI can open the Viewer with it), else null.
 */
async function resolveWorkspace() {
  const agent = /** @type {any} */ (window).mcode?.miniapp?.agent;
  if (typeof agent?.session === 'function') {
    try {
      const s = await Promise.race([agent.session(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))]);
      if (s && typeof s.workspaceDir === 'string' && s.workspaceDir) {
        return {
          dir: s.workspaceDir,
          source: /** @type {const} */ ('session'),
          since: typeof s.createdAtMs === 'number' ? s.createdAtMs : Date.now() - 10 * 60_000,
          folder: null,
        };
      }
    } catch {
      /* not opened in a chat, or this Host has no session info: try ?root= */
    }
  }
  const root = new URLSearchParams(location.search).get('root');
  if (root) return { dir: root, source: /** @type {const} */ ('param'), since: Date.now() - 10 * 60_000, folder: null };
  return null;
}

async function boot() {
  void detectHostBridge();
  renderer.setClearColor(css('--cqv-canvas'), 1);
  resize();
  renderPicks(); // includes the pick bar
  renderParts();

  renderPanel = createRenderPanel({
    apiUrl,
    errorMessage,
    capture: captureView,
    hasModel: hasVisibleModel,
    modelNames: visibleModelNames,
    frameAspect,
    folder: () => workspace?.folder?.id ?? null,
    isOpen: () => openPanelName === 'render',
    open: () => openPanel(openPanelName === 'render' ? null : 'render'),
    showToast,
    prefs,
    savePrefs,
  });
  renderPanel.init();

  showOverlay('loading', '正在读取会话文件夹', '请稍候…');
  workspace = await resolveWorkspace();
  if (workspace) {
    try {
      await loadWorkspace();
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      workspace = null;
      renderChip();
      renderFileList();
      showOverlay('error', '会话文件夹打不开', why);
      return;
    }
  }
  renderChip();
  if (!workspace) {
    renderFileList();
    afterSceneChange(false); // "open the Viewer from a chat"
    void renderPanel.refresh();
    return;
  }

  // ?root= next to Host session info: the AI asked for that folder, add it to this chat's list
  const requested = new URLSearchParams(location.search).get('root');
  if (workspace.source === 'session' && requested) {
    try {
      void revealFolder(await addExtraFolder(requested));
    } catch (error) {
      showToast(`无法打开这个文件夹：${error instanceof Error ? error.message : String(error)}`, 'error', 5000);
    }
  }

  await refreshScene();
  afterSceneChange(false);
  await loadSelection();
  void renderPanel.refresh();
  connect();
  await applyRequests(); // models the AI asked for while the viewer was closed
}
void boot();
