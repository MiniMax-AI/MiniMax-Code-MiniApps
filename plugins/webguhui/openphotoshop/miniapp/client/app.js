import { installEditorBridge } from './editor-bridge.js';
import { installAgentResults } from './agent-results.js';
import { mountActions, mountTools, mountAgentPanel } from './workbench-ui.js';
import { createAgentRequest } from './agent-dialog.js';
import { runOutline } from './selection-outline.js';
import { createDialogs, field, note } from './dialogs.js';
import { showCurvesDialog } from './curves-dialog.js';
import { showFilterDialog } from './filter-dialog.js';
import { showStylesDialog } from './styles-dialog.js';
import { clippingBase } from './adjustment-layers.js';
import { toggleRecording } from './recording.js';
import { tools, adjustments, filters } from './catalog.js';
import { installCanvasTools } from './canvas-tools.js';
import { createFileActions } from './files.js';
import {
  canvas,
  cloneCanvas,
  layer,
  documentModel,
  active,
  begin,
  undo,
  redo,
  composite,
  clipSelection,
  selectionPath,
  serialize,
  deserialize,
  imageFrom,
  download,
  blends,
  blendNames,
} from './model.js';
import { readPSD, writePSD, exportPDF } from './codecs.js';
mountActions();
const $ = (s) => document.querySelector(s),
  image = $('#image'),
  overlay = $('#overlay'),
  stage = $('#stage'),
  wrap = $('#canvas-wrap'),
  dialog = $('#dialog');
const state = {
  docs: [],
  doc: null,
  tool: 'move',
  zoom: 1,
  pan: { x: 0, y: 0 },
  drag: null,
  raf: 0,
  needsRender: false,
  clipboard: null,
  cloneSource: null,
  filterJob: 0,
  busy: false,
  maskEditing: false,
  grid: false,
  viewRotation: 0,
  penPoints: [],
};
const worker = new Worker('/filter-worker.js', { type: 'module' }),
  pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  data.error ? p.reject(Error(data.error)) : p.resolve(new Uint8ClampedArray(data.buffer));
};
worker.onerror = () => {
  for (const p of pending.values()) p.reject(Error('图像处理进程异常，请刷新后重试'));
  pending.clear();
  state.busy = false;
};
function status(text, error = false) {
  $('#status').textContent = text;
  $('#status').classList.toggle('error', error);
}
function safe(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      status(e.message || '操作失败', true);
      console.error(e);
    }
  };
}
function requireDoc() {
  if (!state.doc) throw Error('请先打开图片或新建画布');
  if (state.busy) throw Error('正在处理图像，请稍候');
  return state.doc;
}
function editable() {
  requireDoc();
  const l = active(state.doc);
  if (l.locked) throw Error('当前图层已锁定');
  return l;
}
function pixelEditable(allowMask = false) {
  const l = editable();
  if (l.adjustment && !(allowMask && state.maskEditing && l.mask))
    throw Error('调整图层没有可绘制像素，请编辑调整参数或选择普通图层');
  return l;
}
function button(text, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', safe(fn));
  return b;
}
const { modal } = createDialogs(dialog, status);
function setDoc(d) {
  state.polygonDraft = null;
  state.doc = d;
  state.maskEditing = false;
  state.viewRotation = 0;
  $('#welcome').hidden = true;
  refresh();
  fit();
}
function addDoc(d) {
  state.docs.push(d);
  setDoc(d);
}
let editorChanged = () => {};
let agentPanel;
function refresh() {
  editorChanged();
  agentPanel?.refresh();
  if (!state.doc) return;
  $('#tabs').replaceChildren(
    ...state.docs.map((d) => {
      const b = button(d.name + (d.dirty ? ' •' : ''), () => setDoc(d));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(d === state.doc));
      return b;
    }),
  );
  renderLayers();
  $('#dimensions').textContent =
    `${state.doc.width} × ${state.doc.height} · ${state.doc.layers.length} 图层`;
  $('#undo').disabled = !state.doc.history.length;
  $('#redo').disabled = !state.doc.future.length;
  $('#history').replaceChildren(
    ...state.doc.history.slice(-12).map((e) => {
      const li = document.createElement('li');
      li.textContent = e.label;
      return li;
    }),
  );
  schedule();
}
function schedule(renderContent = true) {
  state.needsRender ||= renderContent;
  if (state.raf) return;
  state.raf = requestAnimationFrame(() => {
    state.raf = 0;
    const render = state.needsRender;
    state.needsRender = false;
    if (render) draw();
    else if (state.doc) {
      drawOverlay();
      position();
    }
  });
}
function draw() {
  if (!state.doc) return;
  composite(state.doc, image);
  if (overlay.width !== state.doc.width) overlay.width = state.doc.width;
  if (overlay.height !== state.doc.height) overlay.height = state.doc.height;
  drawOverlay();
  position();
}
function drawOverlay() {
  if (!state.doc) return;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.save();
  ctx.lineWidth = 1 / state.zoom;
  ctx.strokeStyle = '#ffffff';
  ctx.setLineDash([5 / state.zoom, 4 / state.zoom]);
  const s = state.drag?.selection || state.doc.selection;
  if (s) {
    let outline = selectionPath(s);
    if (s.kind === 'runs') {
      outline = new Path2D();
      for (const [x1, y1, x2, y2] of runOutline(s.runs)) {
        outline.moveTo(x1, y1);
        outline.lineTo(x2, y2);
      }
    }
    ctx.stroke(outline);
    ctx.strokeStyle = '#101010';
    ctx.lineDashOffset = 5 / state.zoom;
    ctx.stroke(outline);
  }
  ctx.setLineDash([]);
  if (state.grid) {
    ctx.strokeStyle = '#8885';
    for (let x = 0; x < state.doc.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, state.doc.height);
      ctx.stroke();
    }
    for (let y = 0; y < state.doc.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(state.doc.width, y);
      ctx.stroke();
    }
  }
  if (state.polygonDraft) {
    const { points, hover } = state.polygonDraft;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / state.zoom;
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (hover) ctx.lineTo(hover.x, hover.y);
    ctx.stroke();
    ctx.fillStyle = '#227fa8';
    for (const p of points) {
      ctx.fillRect(p.x - 3 / state.zoom, p.y - 3 / state.zoom, 6 / state.zoom, 6 / state.zoom);
      ctx.strokeRect(p.x - 3 / state.zoom, p.y - 3 / state.zoom, 6 / state.zoom, 6 / state.zoom);
    }
  }
  if (state.penPoints.length) {
    ctx.strokeStyle = $('#color').value;
    ctx.lineWidth = 2 / state.zoom;
    ctx.beginPath();
    state.penPoints.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    for (const p of state.penPoints) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(p.x - 3 / state.zoom, p.y - 3 / state.zoom, 6 / state.zoom, 6 / state.zoom);
    }
  }
  ctx.restore();
}
function position() {
  wrap.style.width = state.doc.width + 'px';
  wrap.style.height = state.doc.height + 'px';
  wrap.style.transform = `translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom}) rotate(${state.viewRotation}deg)`;
  $('#zoom-value').textContent = Math.round(state.zoom * 100) + '%';
}
function fit() {
  if (!state.doc) return;
  state.viewRotation = 0;
  state.zoom = Math.min(
    1,
    (stage.clientWidth - 70) / state.doc.width,
    (stage.clientHeight - 70) / state.doc.height,
  );
  state.zoom = Math.max(0.02, state.zoom);
  state.pan = {
    x: (stage.clientWidth - state.doc.width * state.zoom) / 2,
    y: (stage.clientHeight - state.doc.height * state.zoom) / 2,
  };
  schedule(false);
}
function changeZoom(factor) {
  if (!state.doc) return;
  const old = state.zoom;
  state.zoom = Math.max(0.02, Math.min(16, state.zoom * factor));
  state.pan.x = stage.clientWidth / 2 - ((stage.clientWidth / 2 - state.pan.x) * state.zoom) / old;
  state.pan.y =
    stage.clientHeight / 2 - ((stage.clientHeight / 2 - state.pan.y) * state.zoom) / old;
  schedule(false);
}
function renderLayers() {
  const current = active(state.doc);
  $('#blend').value = current.blend;
  $('#blend').disabled = false;
  $('#layer-opacity').value = Math.round(current.opacity * 100);
  $('#layers').replaceChildren(
    ...[...state.doc.layers].reverse().map((l) => {
      const row = document.createElement('div');
      row.className = 'layer' + (l.id === state.doc.activeId ? ' selected' : '');
      row.onclick = () => {
        state.doc.activeId = l.id;
        state.maskEditing = false;
        refresh();
      };
      const eye = document.createElement('input');
      eye.type = 'checkbox';
      eye.checked = l.visible;
      eye.setAttribute('aria-label', '可见 ' + l.name);
      eye.onclick = (e) => e.stopPropagation();
      eye.onchange = safe(() => {
        requireDoc();
        begin(state.doc, '图层可见性');
        state.doc.layers.find((x) => x.id === l.id).visible = eye.checked;
        refresh();
      });
      const thumb = canvas(32, 26);
      thumb.getContext('2d').drawImage(l.canvas, 0, 0, 32, 26);
      const name = document.createElement('input');
      name.type = 'text';
      name.value = l.name;
      name.setAttribute('aria-label', '图层名称');
      name.onclick = (e) => {
        e.stopPropagation();
        state.doc.activeId = l.id;
        state.maskEditing = false;
        for (const other of $('#layers').children)
          other.classList.toggle('selected', other === row);
        $('#blend').value = l.blend;
        $('#blend').disabled = false;
        $('#layer-opacity').value = Math.round(l.opacity * 100);
      };
      name.onchange = safe(() => {
        requireDoc();
        begin(state.doc, '重命名图层');
        state.doc.layers.find((x) => x.id === l.id).name = name.value.slice(0, 200) || '图层';
        refresh();
      });
      const lock = button(l.locked ? '已锁' : '锁定', (e) => {
        e.stopPropagation();
        requireDoc();
        begin(state.doc, '图层锁定');
        state.doc.layers.find((x) => x.id === l.id).locked = !l.locked;
        refresh();
      });
      lock.setAttribute('aria-label', (l.locked ? '解锁 ' : '锁定 ') + l.name);
      row.append(eye, thumb, name, lock);
      if (l.adjustment) {
        const edit = button(l.clipToBelow ? '↳ 调整' : '调整', (e) => {
          e.stopPropagation();
          editAdjustment(l);
        });
        edit.className = 'adjustment-thumb';
        edit.setAttribute('aria-label', '编辑 ' + l.name);
        edit.title = l.clipToBelow ? '只调整下方图层' : '调整下方所有图层';
        row.replaceChild(edit, thumb);
      }
      if (l.mask) {
        const m = button(state.maskEditing && current.id === l.id ? '绘制蒙版' : '蒙版', (e) => {
          e.stopPropagation();
          state.doc.activeId = l.id;
          state.maskEditing = !state.maskEditing;
          setTool('brush');
          refresh();
          status(state.maskEditing ? '正在绘制蒙版：橡皮擦隐藏，画笔恢复' : '正在绘制图层');
        });
        row.append(m);
      }
      return row;
    }),
  );
}
function setTool(id) {
  state.polygonDraft = null;
  state.tool = id;
  $('#tolerance-option').hidden = ![
    'fill',
    'wand',
    'magicEraser',
    'backgroundEraser',
    'colorReplace',
  ].includes(id);
  const t = tools.find((t) => t[0] === id);
  $('#tool-name').textContent = t[1];
  $('#hint').textContent = t[3];
  $('#tool-help').textContent = t[3];
  for (const b of $('#tools').querySelectorAll('[data-tool]'))
    b.setAttribute('aria-pressed', String(b.dataset.tool === id));
  overlay.style.cursor = ['hand', 'move'].includes(id)
    ? 'grab'
    : id === 'text'
      ? 'text'
      : 'crosshair';
  state.penPoints = [];
  schedule(false);
}
mountTools($('#tools'), tools, setTool);
blends.forEach((v, i) => {
  const o = document.createElement('option');
  o.value = v;
  o.textContent = blendNames[i];
  $('#blend').append(o);
});
function mutate(label, fn, ids = []) {
  requireDoc();
  begin(state.doc, label, ids);
  fn();
  refresh();
  status(label + '完成');
}
function newLayer() {
  requireDoc();
  if (state.doc.layers.length >= 100) throw Error('最多 100 个图层');
  mutate('新建图层', () => {
    const l = layer(state.doc.width, state.doc.height, '图层 ' + (state.doc.layers.length + 1));
    state.doc.layers.push(l);
    state.doc.activeId = l.id;
  });
}
function newAdjustment() {
  requireDoc();
  if (state.doc.layers.length >= 100) throw Error('最多 100 个图层');
  const select = document.createElement('select');
  select.setAttribute('aria-label', '调整类型');
  for (const item of [...adjustments, ['curves', '曲线']]) {
    const option = document.createElement('option');
    option.value = item[0];
    option.textContent = item[1];
    select.append(option);
  }
  modal(
    '新建调整图层',
    [select, note('调整图层影响它下方的所有可见图层，原始像素保持不变。')],
    () => configureAdjustment(select.value),
    '下一步',
  );
}
function editAdjustment(l) {
  requireDoc();
  if (!l?.adjustment) throw Error('请选择调整图层');
  if (l.locked) throw Error('当前图层已锁定');
  configureAdjustment(l.adjustment.type, l);
}
function configureAdjustment(type, existing = null) {
  const d = requireDoc(),
    item = type === 'curves' ? ['curves', '曲线'] : [...adjustments.find((a) => a[0] === type)];
  const index = existing
    ? d.layers.indexOf(existing)
    : d.layers.findIndex((l) => l.id === d.activeId) + 1;
  const clippedBase = existing?.clipToBelow ? clippingBase(d.layers, index) : -1;
  const source =
    existing?.clipToBelow && clippedBase < 0
      ? canvas(d.width, d.height)
      : composite({ ...d, layers: d.layers.slice(clippedBase >= 0 ? clippedBase : 0, index) });
  if (existing) item[2] = existing.adjustment.value;
  const options = {
    modal,
    runFilter,
    description: existing?.clipToBelow
      ? '只调整下方普通图层。预览显示该图层；已有蒙版、强度和混合模式在应用后生效。'
      : '预览显示下方图层的合成图。调整参数可再次编辑；已有蒙版、不透明度和混合模式在应用后生效。',
    applyFilter: (type, value) =>
      mutate(existing ? '编辑调整图层' : '新建调整图层', () => {
        let target = existing ? d.layers.find((l) => l.id === existing.id) : null;
        if (!target) {
          target = layer(d.width, d.height, item[1] + ' · 调整');
          if (d.selection) {
            target.mask = canvas(d.width, d.height);
            const ctx = target.mask.getContext('2d');
            ctx.save();
            clipSelection(ctx, d, target);
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, d.width, d.height);
            ctx.restore();
          }
          d.layers.splice(index, 0, target);
        }
        target.adjustment = { type, value };
        d.activeId = target.id;
        state.maskEditing = false;
      }),
  };
  if (type === 'curves')
    showCurvesDialog(source, { ...options, initialCurves: existing?.adjustment.value.curves });
  else showFilterDialog(source, item, options);
}
function toggleAdjustmentClipping() {
  const l = editable();
  if (!l.adjustment) throw Error('请选择调整图层');
  const index = state.doc.layers.indexOf(l);
  if (!l.clipToBelow && clippingBase(state.doc.layers, index) < 0)
    throw Error('下方需要普通图层，或已剪贴到同一图层的调整层');
  mutate(l.clipToBelow ? '调整下方所有图层' : '只调整下方图层', () => {
    active(state.doc).clipToBelow = !l.clipToBelow;
  });
}
function duplicate() {
  const l = editable();
  mutate('复制图层', () => {
    const n = {
      ...l,
      id: crypto.randomUUID(),
      name: l.name + ' 副本',
      canvas: cloneCanvas(l.canvas),
      mask: l.mask ? cloneCanvas(l.mask) : null,
    };
    state.doc.layers.splice(state.doc.layers.indexOf(active(state.doc)) + 1, 0, n);
    state.doc.activeId = n.id;
  });
}
function deleteLayer() {
  editable();
  if (state.doc.layers.length === 1) throw Error('至少保留一个图层');
  mutate('删除图层', () => {
    state.doc.layers = state.doc.layers.filter((l) => l.id !== state.doc.activeId);
    state.doc.activeId = state.doc.layers.at(-1).id;
  });
}
function moveLayer(delta) {
  editable();
  const i = state.doc.layers.findIndex((l) => l.id === state.doc.activeId),
    j = i + delta;
  if (j < 0 || j >= state.doc.layers.length) return;
  mutate('调整图层顺序', () => {
    [state.doc.layers[i], state.doc.layers[j]] = [state.doc.layers[j], state.doc.layers[i]];
  });
}
function mergeDown() {
  const l = editable(),
    i = state.doc.layers.indexOf(l);
  if (i < 1) throw Error('没有下方图层');
  if (l.adjustment || state.doc.layers[i - 1].adjustment)
    throw Error('调整图层作用于下方合成图像，请使用“拼合图像”保留完整效果');
  if (state.doc.layers[i - 1].locked) throw Error('下方图层已锁定');
  const merged = composite({ ...state.doc, layers: state.doc.layers.slice(i - 1, i + 1) });
  mutate('向下合并', () => {
    const n = layer(state.doc.width, state.doc.height, state.doc.layers[i - 1].name);
    n.canvas = merged;
    state.doc.layers.splice(i - 1, 2, n);
    state.doc.activeId = n.id;
  });
}
function flatten() {
  requireDoc();
  const c = composite(state.doc);
  mutate('拼合图像', () => {
    const l = layer(state.doc.width, state.doc.height, '合并图层');
    l.canvas = c;
    state.doc.layers = [l];
    state.doc.activeId = l.id;
  });
}
function addMask() {
  const l = editable();
  mutate('添加选区蒙版', () => {
    const a = active(state.doc);
    a.mask = canvas(a.canvas.width, a.canvas.height);
    const ctx = a.mask.getContext('2d');
    ctx.save();
    clipSelection(ctx, state.doc, a);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, a.mask.width, a.mask.height);
    ctx.restore();
    state.maskEditing = true;
  });
  status('蒙版已添加，画笔恢复可见区域，橡皮擦隐藏区域');
}
function resizeDocument(w, h, resize = true) {
  requireDoc();
  canvas(w, h);
  const sx = w / state.doc.width,
    sy = h / state.doc.height;
  mutate(resize ? '调整图像大小' : '调整画布大小', () => {
    state.doc.layers = state.doc.layers.map((l) => {
      const c = canvas(w, h),
        ctx = c.getContext('2d');
      if (resize)
        ctx.drawImage(l.canvas, l.x * sx, l.y * sy, l.canvas.width * sx, l.canvas.height * sy);
      else ctx.drawImage(l.canvas, l.x, l.y);
      let mask = null;
      if (l.mask) {
        mask = canvas(w, h);
        const m = mask.getContext('2d');
        if (resize) m.drawImage(l.mask, l.x * sx, l.y * sy, l.mask.width * sx, l.mask.height * sy);
        else m.drawImage(l.mask, l.x, l.y);
      }
      return { ...l, canvas: c, mask, x: 0, y: 0, text: null };
    });
    state.doc.width = w;
    state.doc.height = h;
    state.doc.selection = null;
  });
  fit();
}
function sizeDialog(resize) {
  requireDoc();
  const [wr, w] = field('宽度', state.doc.width),
    [hr, h] = field('高度', state.doc.height);
  modal(
    resize ? '图像大小' : '画布大小',
    [wr, hr, note('最多 3200 万像素；图像大小会同步缩放全部图层。')],
    () => resizeDocument(Number(w.value), Number(h.value), resize),
  );
}
function crop(s = state.doc?.selection) {
  requireDoc();
  if (!s || !['rect', 'ellipse'].includes(s.kind)) throw Error('请先框选矩形裁剪范围');
  const x = Math.max(0, Math.floor(s.x)),
    y = Math.max(0, Math.floor(s.y)),
    w = Math.min(state.doc.width - x, Math.round(s.w)),
    h = Math.min(state.doc.height - y, Math.round(s.h));
  canvas(w, h);
  mutate('裁剪图像', () => {
    state.doc.layers = state.doc.layers.map((l) => {
      const c = canvas(w, h);
      c.getContext('2d').drawImage(l.canvas, l.x - x, l.y - y);
      let mask = null;
      if (l.mask) {
        mask = canvas(w, h);
        mask.getContext('2d').drawImage(l.mask, l.x - x, l.y - y);
      }
      return { ...l, canvas: c, mask, x: 0, y: 0, text: null };
    });
    state.doc.width = w;
    state.doc.height = h;
    state.doc.selection = null;
  });
  fit();
}
function transformDocument(kind) {
  requireDoc();
  const rotate = kind === 'cw' || kind === 'ccw',
    w = rotate ? state.doc.height : state.doc.width,
    h = rotate ? state.doc.width : state.doc.height;
  const apply = (src, x, y) => {
    const c = canvas(w, h),
      ctx = c.getContext('2d');
    if (kind === 'h') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    if (kind === 'v') {
      ctx.translate(0, h);
      ctx.scale(1, -1);
    }
    if (kind === 'cw') {
      ctx.translate(w, 0);
      ctx.rotate(Math.PI / 2);
    }
    if (kind === 'ccw') {
      ctx.translate(0, h);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(src, x, y);
    return c;
  };
  mutate('变换图像', () => {
    state.doc.layers = state.doc.layers.map((l) => ({
      ...l,
      canvas: apply(l.canvas, l.x, l.y),
      mask: l.mask ? apply(l.mask, l.x, l.y) : null,
      x: 0,
      y: 0,
      text: null,
    }));
    state.doc.width = w;
    state.doc.height = h;
    state.doc.selection = null;
  });
  fit();
}
async function newDocument() {
  const [nr, n] = field('名称', '未命名', 'text'),
    [wr, w] = field('宽度', 1280),
    [hr, h] = field('高度', 800);
  modal('新建画布', [nr, wr, hr], () =>
    addDoc(documentModel(Number(w.value), Number(h.value), n.value || '未命名')),
  );
}
function demo() {
  const d = documentModel(1280, 800, '海岸 · 示例');
  const bg = d.layers[0].canvas.getContext('2d'),
    g = bg.createLinearGradient(0, 0, 0, 800);
  g.addColorStop(0, '#b5d4dc');
  g.addColorStop(0.55, '#e7d5b8');
  g.addColorStop(0.551, '#417e8c');
  g.addColorStop(1, '#173f58');
  bg.fillStyle = g;
  bg.fillRect(0, 0, 1280, 800);
  bg.fillStyle = '#f9e3ab';
  bg.beginPath();
  bg.arc(890, 240, 70, 0, Math.PI * 2);
  bg.fill();
  bg.fillStyle = '#224c59';
  bg.beginPath();
  bg.moveTo(0, 800);
  bg.lineTo(0, 580);
  bg.bezierCurveTo(220, 400, 350, 720, 580, 800);
  bg.fill();
  const l = layer(1280, 800, '文字 · COAST');
  l.text = { value: 'COAST', size: 128, color: '#ffffff', x: 90, y: 290 };
  const ctx = l.canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.font = '500 128px sans-serif';
  ctx.fillText('COAST', 90, 290);
  ctx.font = '22px sans-serif';
  ctx.fillText('A quiet place, a little closer.', 98, 340);
  d.layers.push(l);
  d.activeId = l.id;
  addDoc(d);
  status('示例已打开：试试图层移动、调色和导出');
}
const { importFiles, save, exportProject, projects, exportImage } = createFileActions(state, {
  requireDoc,
  addDoc,
  setDoc,
  refresh,
  status,
  button,
  modal,
  note,
});
function runFilter(data, w, h, type, value) {
  const id = ++state.filterJob;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, buffer: data.buffer, width: w, height: h, type, value }, [
      data.buffer,
    ]);
  });
}
async function applyFilter(type, value, label) {
  const l = pixelEditable(),
    d = state.doc;
  state.busy = true;
  status('正在处理 ' + label + '…');
  try {
    const data = l.canvas.getContext('2d').getImageData(0, 0, l.canvas.width, l.canvas.height);
    const out = await runFilter(data.data, data.width, data.height, type, value);
    begin(d, label, [l.id]);
    const target = d.layers.find((x) => x.id === l.id),
      c = canvas(data.width, data.height);
    c.getContext('2d').putImageData(new ImageData(out, data.width, data.height), 0, 0);
    const ctx = target.canvas.getContext('2d');
    ctx.save();
    clipSelection(ctx, d, target);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(c, 0, 0);
    ctx.restore();
    refresh();
    status(label + '完成');
  } finally {
    state.busy = false;
  }
}
function filterDialog(item) {
  const source = pixelEditable().canvas;
  const [type, label, value, min, max] = item;
  if (min === max || max === 1) return applyFilter(type, value, label);
  showFilterDialog(source, item, { modal, runFilter, applyFilter });
}
for (const key of ['enhance', 'brightness', 'contrast', 'saturation', 'warmth', 'grayscale']) {
  const item = adjustments.find((a) => a[0] === key);
  $('#quick').append(button(item[1], () => filterDialog(item)));
}
function fillAll(clear = false) {
  const l = pixelEditable(true);
  mutate(
    clear ? '清除选区' : '填充选区',
    () => {
      const a = active(state.doc),
        ctx = (state.maskEditing && a.mask ? a.mask : a.canvas).getContext('2d');
      ctx.save();
      clipSelection(ctx, state.doc, a);
      if (clear) ctx.clearRect(0, 0, a.canvas.width, a.canvas.height);
      else {
        ctx.fillStyle = $('#color').value;
        ctx.fillRect(0, 0, a.canvas.width, a.canvas.height);
      }
      ctx.restore();
    },
    [l.id],
  );
}
function copy(merged = false, cut = false) {
  const l = merged ? editable() : pixelEditable(),
    src = merged ? composite(state.doc) : l.canvas,
    c = canvas(state.doc.width, state.doc.height),
    ctx = c.getContext('2d');
  ctx.save();
  clipSelection(ctx, state.doc, { x: 0, y: 0 });
  ctx.drawImage(src, merged ? 0 : l.x, merged ? 0 : l.y);
  ctx.restore();
  state.clipboard = c;
  if (cut) fillAll(true);
  status('已复制到工作台剪贴板');
}
function paste() {
  requireDoc();
  if (!state.clipboard) throw Error('请先复制图像区域');
  mutate('粘贴图层', () => {
    const l = layer(state.clipboard.width, state.clipboard.height, '粘贴');
    l.canvas = cloneCanvas(state.clipboard);
    state.doc.layers.push(l);
    state.doc.activeId = l.id;
  });
}
function transformLayer() {
  const l = pixelEditable(),
    [xr, x] = field('X', l.x),
    [yr, y] = field('Y', l.y),
    [sr, s] = field('缩放 %', 100),
    [rr, r] = field('旋转角度', 0);
  modal('变换图层', [xr, yr, sr, rr, note('以图层中心旋转；转换后文字成为像素。')], () => {
    const scale = Number(s.value) / 100,
      angle = (Number(r.value) * Math.PI) / 180;
    if (!(scale > 0 && scale <= 10)) throw Error('缩放范围为 1% 到 1000%');
    mutate('变换图层', () => {
      const a = active(state.doc),
        c = canvas(state.doc.width, state.doc.height),
        ctx = c.getContext('2d');
      ctx.translate(Number(x.value) + a.canvas.width / 2, Number(y.value) + a.canvas.height / 2);
      ctx.rotate(angle);
      ctx.scale(scale, scale);
      ctx.drawImage(a.canvas, -a.canvas.width / 2, -a.canvas.height / 2);
      a.canvas = c;
      a.x = 0;
      a.y = 0;
      a.mask = null;
      a.text = null;
    });
  });
}
function textDialog(point, edit = false) {
  const l = pixelEditable(),
    previous = edit ? l.text : null;
  if (edit && !previous) throw Error('当前图层不是可编辑文字');
  const input = document.createElement('textarea');
  input.setAttribute('aria-label', '文字内容');
  input.value = previous?.value || '新的文字';
  const [sr, size] = field('字号', previous?.size || 64),
    [cr, color] = field('颜色', previous?.color || $('#color').value, 'color');
  modal(edit ? '编辑文字' : '添加文字', [input, sr, cr], () => {
    const value = input.value,
      n = Number(size.value);
    if (!value.trim() || n < 1 || n > 1000) throw Error('请输入文字，字号范围为 1–1000');
    mutate(edit ? '编辑文字' : '新建文字图层', () => {
      const a = edit
        ? active(state.doc)
        : layer(state.doc.width, state.doc.height, '文字 · ' + value.slice(0, 12));
      a.canvas = canvas(state.doc.width, state.doc.height);
      a.text = {
        value,
        size: n,
        color: color.value,
        x: previous?.x ?? point.x,
        y: previous?.y ?? point.y,
      };
      const ctx = a.canvas.getContext('2d');
      ctx.fillStyle = a.text.color;
      ctx.font = `${n}px sans-serif`;
      value.split('\n').forEach((line, i) => ctx.fillText(line, a.text.x, a.text.y + i * n * 1.3));
      if (!edit) {
        state.doc.layers.push(a);
        state.doc.activeId = a.id;
      }
    });
  });
}
const menuData = {
  文件: [
    ['新建画布', newDocument],
    ['打开图片 / PSD / TIFF / 工程', () => $('#file-input').click()],
    ['本地工程', projects],
    ['保存工程', save],
    ['导出工程文件', exportProject],
    null,
    ...['png', 'jpeg', 'webp', 'tiff', 'psd', 'pdf', 'svg'].map((t) => [
      '导出 ' + t.toUpperCase(),
      () => exportImage(t),
    ]),
  ],
  编辑: [
    [
      '撤销',
      () => {
        requireDoc();
        undo(state.doc);
        refresh();
      },
    ],
    [
      '重做',
      () => {
        requireDoc();
        redo(state.doc);
        refresh();
      },
    ],
    null,
    ['剪切', () => copy(false, true)],
    ['复制', () => copy()],
    ['合并复制', () => copy(true)],
    ['粘贴', paste],
    ['清除', () => fillAll(true)],
    ['填充', () => fillAll()],
    ['变换图层', transformLayer],
  ],
  图像: [
    ['图像大小', () => sizeDialog(true)],
    ['画布大小', () => sizeDialog(false)],
    ['按选区裁剪', () => crop()],
    ['水平翻转', () => transformDocument('h')],
    ['垂直翻转', () => transformDocument('v')],
    ['顺时针旋转 90°', () => transformDocument('cw')],
    ['逆时针旋转 90°', () => transformDocument('ccw')],
    ['拼合图像', flatten],
  ],
  图层: [
    ['新建图层', newLayer],
    ['新建调整图层', newAdjustment],
    ['编辑调整图层', () => editAdjustment(active(requireDoc()))],
    ['切换只调整下方图层', toggleAdjustmentClipping],
    [
      '图层样式',
      () => {
        const l = pixelEditable();
        showStylesDialog(l, {
          modal,
          apply: (styles) =>
            mutate('图层样式', () => {
              active(state.doc).styles = styles;
            }),
        });
      },
    ],
    [
      '清除图层样式',
      () => {
        editable();
        mutate('清除图层样式', () => {
          active(state.doc).styles = null;
        });
      },
    ],
    ['复制图层', duplicate],
    ['删除图层', deleteLayer],
    ['向下合并', mergeDown],
    ['上移一层', () => moveLayer(1)],
    ['下移一层', () => moveLayer(-1)],
    ['添加选区蒙版', addMask],
    [
      '移除蒙版',
      () =>
        mutate('移除蒙版', () => {
          active(state.doc).mask = null;
          state.maskEditing = false;
        }),
    ],
    ['编辑文字', () => textDialog(null, true)],
  ],
  选择: [
    [
      '全选',
      () => {
        requireDoc();
        state.doc.selection = { kind: 'rect', x: 0, y: 0, w: state.doc.width, h: state.doc.height };
        schedule();
      },
    ],
    [
      '取消选择',
      () => {
        requireDoc();
        state.doc.selection = null;
        schedule();
      },
    ],
    [
      '反选',
      () => {
        requireDoc();
        if (state.doc.selection)
          state.doc.selection = { ...state.doc.selection, invert: !state.doc.selection.invert };
        schedule();
      },
    ],
  ],
  调整: [
    [
      '曲线',
      () => {
        const layer = pixelEditable();
        showCurvesDialog(layer.canvas, { modal, applyFilter });
      },
    ],
    ...adjustments.map((a) => [a[1], () => filterDialog(a)]),
  ],
  滤镜: filters.map((a) => [a[1], () => filterDialog(a)]),
  视图: [
    ['适合窗口', fit],
    ['实际大小', () => changeZoom(1 / state.zoom)],
    ['放大', () => changeZoom(1.25)],
    ['缩小', () => changeZoom(0.8)],
    [
      '显示 / 隐藏网格',
      () => {
        state.grid = !state.grid;
        schedule();
      },
    ],
    [
      '重置视图旋转',
      () => {
        state.viewRotation = 0;
        schedule();
      },
    ],
  ],
  帮助: [
    ['录制 / 停止录屏', () => toggleRecording(status)],
    ['使用说明', manual],
    ['功能范围', capabilities],
  ],
};
for (const [title, items] of Object.entries(menuData)) {
  const details = document.createElement('details'),
    summary = document.createElement('summary'),
    menu = document.createElement('div');
  summary.textContent = title;
  menu.className = 'menu';
  for (const item of items) {
    if (!item) {
      menu.append(document.createElement('hr'));
      continue;
    }
    menu.append(
      button(item[0], () => {
        details.open = false;
        return item[1]();
      }),
    );
  }
  details.append(summary, menu);
  details.addEventListener('toggle', () => {
    if (details.open)
      for (const other of $('#menus').children) if (other !== details) other.open = false;
  });
  $('#menus').append(details);
}
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('details')) for (const d of $('#menus').children) d.open = false;
});
function manual() {
  modal(
    '使用说明',
    [
      note('1. 打开图片或点击试用示例。左侧选择工具，顶部调整颜色、大小与不透明度。'),
      note('2. 图层在右侧。点击选择图层，勾选显示，点击锁定防止误改。'),
      note('3. 先框选再调色，可只修改局部。Ctrl/⌘ Z 撤销，Shift Ctrl/⌘ Z 重做。'),
      note(
        '4. 保存工程会保存到本机 Mini App 数据目录；导出工程文件可以迁移。PNG 保留透明，JPEG 使用白底。',
      ),
      note('5. 仿制图章先 Alt 点击取样。文字点击添加，已有文字从图层菜单编辑。'),
      note('6. PSD 仅支持 8-bit RGB 普通像素图层；不支持 PSB、智能对象、调整层和专业色彩管理。'),
      note(
        '7. 图层菜单可创建调整图层、编辑图层样式。调整图层可剪贴到下方单层，并设置混合模式；保存工程保留参数。含调整层的 PSD 会合并为像素图像。',
      ),
    ],
    () => {},
    '知道了',
  );
}
function capabilities() {
  modal(
    '当前功能范围',
    [
      note(
        `已实现：多文档、图层、${blends.length} 种混合模式、蒙版、${adjustments.length + 1} 种可编辑调整层（含曲线）、剪贴调整、10 种基础图层样式、选区、绘制、文字、局部修图、${filters.length} 种滤镜、本地工程、PNG/JPEG/WebP/TIFF/PSD/PDF/SVG 导出。`,
      ),
      note(
        '尚未实现：原站全部 52 种工具、图层组、样式高级参数、完整 PSD、RAW/HEIF、完整 TIFF、内容识别、AI 生图、Google Drive。当前属于独立重写版本，并非原站完整复制。',
      ),
      note('参考：RetouchPi 公开界面。本包不包含原站代码或模型。'),
    ],
    () => {},
    '关闭',
  );
}
function bind(id, fn) {
  $(id).addEventListener('click', safe(fn));
}
bind('#save', save);
bind('#export', () => exportImage());
bind('#ask-agent', () => agentPanel?.open());
bind('#agent-results', installAgentResults({ modal, button, importFiles, status }));
bind('#open-start', () => $('#file-input').click());
bind('#new-start', newDocument);
bind('#demo', demo);
bind('#undo', () => {
  requireDoc();
  undo(state.doc);
  refresh();
});
bind('#redo', () => {
  requireDoc();
  redo(state.doc);
  refresh();
});
bind('#add-layer', newLayer);
bind('#duplicate-layer', duplicate);
bind('#delete-layer', deleteLayer);
bind('#layer-up', () => moveLayer(1));
bind('#layer-down', () => moveLayer(-1));
bind('#projects', projects);
bind('#manual', manual);
bind('#fit', fit);
bind('#actual', () => changeZoom(1 / state.zoom));
bind('#zoom-in', () => changeZoom(1.25));
bind('#zoom-out', () => changeZoom(0.8));
$('#blend').onchange = safe((e) => {
  editable();
  mutate('混合模式', () => (active(state.doc).blend = e.target.value));
});
$('#layer-opacity').onchange = safe((e) => {
  editable();
  mutate('图层不透明度', () => (active(state.doc).opacity = Number(e.target.value) / 100));
});
$('#file-input').onchange = safe(async (e) => {
  await importFiles([...e.target.files]);
  e.target.value = '';
});
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener(
  'drop',
  safe(async (e) => {
    e.preventDefault();
    await importFiles([...e.dataTransfer.files]);
  }),
);
installCanvasTools(state, {
  $,
  requireDoc,
  editable: () => pixelEditable(true),
  status,
  schedule,
  drawOverlay,
  refresh,
  crop,
  textDialog,
  changeZoom,
  safe,
});
window.addEventListener(
  'keydown',
  safe((e) => {
    if (state.busy || dialog.open || e.target.matches('input,textarea,select')) return;
    const key = e.key.toLowerCase(),
      mod = e.ctrlKey || e.metaKey;
    if (mod) {
      if (['z', 's', 'o', 'n', 'a', 'd', 'c', 'v', 'x', 'j', '0', '1'].includes(key))
        e.preventDefault();
      if (key === 'o') return $('#file-input').click();
      if (key === 'n') return newDocument();
      if (!state.doc) return;
      if (key === 'z') {
        e.shiftKey ? redo(state.doc) : undo(state.doc);
        refresh();
      }
      if (key === 's') return save();
      if (key === 'a') {
        state.doc.selection = { kind: 'rect', x: 0, y: 0, w: state.doc.width, h: state.doc.height };
        schedule();
      }
      if (key === 'd') {
        state.doc.selection = null;
        schedule();
      }
      if (key === 'c') copy(e.shiftKey);
      if (key === 'x') copy(false, true);
      if (key === 'v') paste();
      if (key === 'j') duplicate();
      if (key === '0') fit();
      if (key === '1') changeZoom(1 / state.zoom);
      return;
    }
    if (key === 'escape') {
      state.penPoints = [];
      if (state.doc) state.doc.selection = null;
      schedule();
      return;
    }
    if ((key === 'delete' || key === 'backspace') && state.doc) {
      e.preventDefault();
      return fillAll(true);
    }
    const found = tools.find((t) => t[2].toLowerCase() === key);
    if (found) setTool(found[0]);
    if (state.doc && state.tool === 'move' && key.startsWith('arrow')) {
      e.preventDefault();
      editable();
      begin(state.doc, '移动图层');
      const l = active(state.doc),
        delta = e.shiftKey ? 10 : 1;
      if (key === 'arrowleft') l.x -= delta;
      if (key === 'arrowright') l.x += delta;
      if (key === 'arrowup') l.y -= delta;
      if (key === 'arrowdown') l.y += delta;
      refresh();
    }
  }),
);
window.addEventListener('beforeunload', (e) => {
  if (state.docs.some((d) => d.dirty)) {
    e.preventDefault();
    e.returnValue = '';
  }
});
new ResizeObserver(() => {
  if (state.doc) schedule();
}).observe(stage);
setTool('move');

editorChanged = installEditorBridge(state, { refresh, status, runFilter, addDoc });
agentPanel = mountAgentPanel({
  context: () => ({ name: state.doc?.name, supported: typeof window.mcode?.miniapp?.message?.append === 'function' }),
  submit: createAgentRequest(state, () => editorChanged.context?.()),
});
