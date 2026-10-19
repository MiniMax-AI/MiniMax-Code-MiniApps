// Both Agent transactions and UI can use these model-level operations.
// No eval, DOM events, network access or arbitrary code in a submitted plan.
import {
  canvas,
  cloneCanvas,
  layer,
  active,
  blends,
  composite,
  clipSelection,
  imageFrom,
  begin,
  undo,
  redo,
} from './model.js';
import { adjustments, filters } from './catalog.js';
import { normalizeAdjustment } from './adjustment-layers.js';
import { normalizeStyles } from './layer-styles.js';

const number = (v, min, max, name) => {
  if (!Number.isFinite(v) || v < min || v > max) throw Error(`${name} 必须在 ${min}–${max} 之间`);
  return v;
};
const text = (v, name, max = 200) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw Error(`${name} 无效`);
  return v;
};
const color = (v) => {
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v))
    throw Error('颜色须为 #RRGGBB 或 #RRGGBBAA');
  return v;
};
const integer = (v, min, max, name) => {
  number(v, min, max, name);
  if (!Number.isInteger(v)) throw Error(`${name} 必须是整数`);
  return v;
};
const point = (v) => {
  if (!Array.isArray(v) || v.length !== 2) throw Error('坐标必须为 [x,y]');
  return v.map((n) => number(n, -32000, 32000, '坐标'));
};
const fields = (op, allowed) => {
  if (Object.keys(op).some((k) => !['op', 'as', ...allowed].includes(k)))
    throw Error(`操作 ${op.op} 包含未知参数`);
};
export function describeDocument(d) {
  return {
    id: d.id,
    name: d.name,
    width: d.width,
    height: d.height,
    savedRevision: d.revision,
    activeLayerId: d.activeId,
    dirty: d.dirty,
    undoCount: d.history.length,
    redoCount: d.future.length,
    selection: d.selection,
    layers: d.layers.map((l, index) => ({
      id: l.id,
      index,
      name: l.name,
      width: l.canvas.width,
      height: l.canvas.height,
      x: l.x,
      y: l.y,
      opacity: l.opacity,
      blend: l.blend,
      visible: l.visible,
      locked: l.locked,
      hasMask: !!l.mask,
      text: l.text,
      adjustment: l.adjustment,
      styles: l.styles,
      clipToBelow: !!l.clipToBelow,
    })),
  };
}
export const editorCapabilities = {
  coordinates: '画布像素坐标，原点左上；图层顺序从底到顶；颜色为 #RRGGBB 或 #RRGGBBAA。',
  composition:
    'operations 按顺序运行，最多 64 步。创建或选择图层的步骤可用 as 命名，后续 layerId:"$名字" 引用；省略 layerId 使用当前图层。整批成功后成为一次撤销；任一步失败则不修改工程。',
  operations: {
    select_layer: { layerId: '已有图层 ID 或 $引用' },
    add_layer: { name: '名称' },
    duplicate_layer: { layerId: '可选', name: '可选名称' },
    update_layer: {
      layerId: '可选',
      name: '可选',
      x: '可选坐标',
      y: '可选坐标',
      opacity: '0–1',
      blend: '混合模式 ID',
      visible: '布尔',
      locked: '布尔',
    },
    reorder_layer: { layerId: '可选', index: '从底部开始的目标索引' },
    delete_layer: { layerId: '可选；保留至少一层' },
    selection: {
      kind: 'none / rect / ellipse / polygon',
      x: '矩形位置',
      y: '矩形位置',
      width: '正整数',
      height: '正整数',
      points: 'polygon 的 [x,y] 数组',
    },
    fill: { layerId: '可选', color: '#RRGGBB', opacity: '可选 0–1' },
    stroke: {
      layerId: '可选',
      points: '最多 4096 个 [x,y]',
      color: '#RRGGBB',
      size: '1–1000',
      opacity: '可选 0–1',
      erase: '可选布尔',
    },
    shape: {
      layerId: '可选',
      kind: 'rect / ellipse / line',
      x: '坐标',
      y: '坐标',
      width: '1–32000',
      height: '1–32000',
      color: '#RRGGBB',
      fill: '布尔，默认 true',
      size: '描边宽度',
    },
    text: {
      value: '文字，最多 2000 字',
      x: '坐标',
      y: '基线坐标',
      size: '1–1000',
      color: '#RRGGBB',
      font: 'sans-serif / serif / monospace',
      name: '新图层名称',
    },
    filter: { layerId: '可选', type: 'filters 或 adjustments 中的 ID', value: '对应数值范围' },
    adjustment: {
      type: 'adjustments 中的 ID',
      value: '对应数值范围',
      name: '可选',
      clipToBelow: '可选布尔',
    },
    styles: { layerId: '可选', styles: '与工程中 styles 相同的参数；从 inspect 获取' },
    mask_selection: { layerId: '可选；当前选区作为蒙版' },
    remove_mask: { layerId: '可选' },
    image_result: {
      requestId: '已完成生图任务编号',
      name: '可选图层名',
      x: '可选坐标',
      y: '可选坐标',
    },
    transform_layer: {
      layerId: '可选',
      scale: '0.01–10',
      angle: '-360–360 度',
      flipX: '可选布尔',
      flipY: '可选布尔',
    },
    crop: { x: '裁剪左上角', y: '裁剪左上角', width: '正整数', height: '正整数' },
    flatten: { name: '可选合并图层名' },
    undo: { note: '必须单独作为一个 batch' },
    redo: { note: '必须单独作为一个 batch' },
  },
  adjustments: adjustments.map(([id, name, defaultValue, min, max]) => ({
    id,
    name,
    defaultValue,
    min,
    max,
  })),
  filters: filters.map(([id, name, defaultValue, min, max]) => ({
    id,
    name,
    defaultValue,
    min,
    max,
  })),
  blends,
};

export async function executeEditorBatch(original, operations, { runFilter }) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 64)
    throw Error('每批需要 1–64 个操作');
  // Copy-on-write: unchanged canvases are shared; edited pixels are cloned once.
  const d = {
    ...original,
    layers: original.layers.map((l) => ({ ...l })),
    history: [...original.history],
    future: [...original.future],
    selection: structuredClone(original.selection),
    paths: structuredClone(original.paths),
  };
  if (operations.length === 1 && ['undo', 'redo'].includes(operations[0]?.op)) {
    fields(operations[0], []);
    if (!(operations[0].op === 'undo' ? undo(d) : redo(d))) throw Error('没有可撤销或重做的操作');
    return { document: d, results: [{ op: operations[0].op }], description: describeDocument(d) };
  }
  if (operations.some((op) => ['undo', 'redo'].includes(op?.op)))
    throw Error('撤销与重做必须独立执行');
  begin(d, 'Agent 批量编辑');
  const refs = new Map(),
    copied = new Set(),
    results = [];
  function target(op, pixels = false) {
    let id = op.layerId;
    if (typeof id === 'string' && id.startsWith('$')) {
      if (!refs.has(id.slice(1))) throw Error('未定义的图层引用');
      id = refs.get(id.slice(1));
    }
    const l = id === undefined ? active(d) : d.layers.find((l) => l.id === id);
    if (!l) throw Error('图层不存在');
    if (l.locked && op.op !== 'select_layer' && !(op.op === 'update_layer' && op.locked === false))
      throw Error('图层已锁定');
    if (pixels && l.adjustment) throw Error('调整图层不能直接绘制像素');
    if (pixels && !copied.has(l.id)) {
      l.canvas = cloneCanvas(l.canvas);
      copied.add(l.id);
    }
    return l;
  }
  function add(l) {
    if (d.layers.length >= 100) throw Error('最多 100 个图层');
    if (
      d.layers.reduce((sum, l) => sum + l.canvas.width * l.canvas.height, 0) +
        l.canvas.width * l.canvas.height >
      128e6
    )
      throw Error('图层总像素超过限制');
    d.layers.splice(d.layers.findIndex((x) => x.id === d.activeId) + 1, 0, l);
    d.activeId = l.id;
    return l;
  }
  function draw(l, fn) {
    const ctx = l.canvas.getContext('2d');
    ctx.save();
    try {
      clipSelection(ctx, d, l);
      ctx.translate(-l.x, -l.y);
      fn(ctx);
    } finally {
      ctx.restore();
    }
    l.text = null;
  }
  for (let index = 0; index < operations.length; index++) {
    const op = operations[index];
    if (
      !op ||
      typeof op !== 'object' ||
      Array.isArray(op) ||
      !Object.hasOwn(editorCapabilities.operations, op.op)
    )
      throw Error(`第 ${index + 1} 步操作无效`);
    if (
      op.as !== undefined &&
      (typeof op.as !== 'string' || !/^[a-zA-Z][\w-]{0,39}$/.test(op.as) || refs.has(op.as))
    )
      throw Error('引用名称无效或重复');
    let l;
    switch (op.op) {
      case 'select_layer':
        fields(op, ['layerId']);
        l = target(op);
        d.activeId = l.id;
        break;
      case 'add_layer':
        fields(op, ['name']);
        l = add(layer(d.width, d.height, text(op.name || 'Agent 图层', '图层名')));
        break;
      case 'duplicate_layer':
        fields(op, ['layerId', 'name']);
        l = target(op);
        l = add({
          ...l,
          id: crypto.randomUUID(),
          name: text(op.name || l.name + ' 副本', '图层名'),
          canvas: cloneCanvas(l.canvas),
          mask: l.mask ? cloneCanvas(l.mask) : null,
        });
        break;
      case 'update_layer':
        fields(op, ['layerId', 'name', 'x', 'y', 'opacity', 'blend', 'visible', 'locked']);
        l = target(op);
        for (const key of ['visible', 'locked'])
          if (op[key] !== undefined) {
            if (typeof op[key] !== 'boolean') throw Error(`${key} 必须是布尔值`);
            l[key] = op[key];
          }
        if (op.name !== undefined) l.name = text(op.name, '图层名');
        for (const key of ['x', 'y'])
          if (op[key] !== undefined) l[key] = number(op[key], -32000, 32000, key);
        if (op.opacity !== undefined) l.opacity = number(op.opacity, 0, 1, '不透明度');
        if (op.blend !== undefined) {
          if (!blends.includes(op.blend)) throw Error('未知混合模式');
          l.blend = op.blend;
        }
        break;
      case 'reorder_layer':
        fields(op, ['layerId', 'index']);
        l = target(op);
        integer(op.index, 0, d.layers.length - 1, '图层索引');
        d.layers.splice(d.layers.indexOf(l), 1);
        d.layers.splice(op.index, 0, l);
        break;
      case 'delete_layer':
        fields(op, ['layerId']);
        l = target(op);
        if (d.layers.length === 1) throw Error('至少保留一个图层');
        d.layers = d.layers.filter((x) => x.id !== l.id);
        if (d.activeId === l.id) d.activeId = d.layers.at(-1).id;
        break;
      case 'selection':
        fields(op, ['kind', 'x', 'y', 'width', 'height', 'points']);
        if (op.kind === 'none') d.selection = null;
        else if (['rect', 'ellipse'].includes(op.kind))
          d.selection = {
            kind: op.kind,
            x: number(op.x, -32000, 32000, 'x'),
            y: number(op.y, -32000, 32000, 'y'),
            w: integer(op.width, 1, 32000, '宽'),
            h: integer(op.height, 1, 32000, '高'),
          };
        else if (
          op.kind === 'polygon' &&
          Array.isArray(op.points) &&
          op.points.length >= 3 &&
          op.points.length <= 4096
        )
          d.selection = { kind: 'polygon', points: op.points.map(point) };
        else throw Error('选区无效');
        break;
      case 'fill':
        fields(op, ['layerId', 'color', 'opacity']);
        l = target(op, true);
        color(op.color);
        number(op.opacity ?? 1, 0, 1, '不透明度');
        draw(l, (c) => {
          c.fillStyle = op.color;
          c.globalAlpha = op.opacity ?? 1;
          c.fillRect(l.x, l.y, l.canvas.width, l.canvas.height);
        });
        break;
      case 'stroke':
        fields(op, ['layerId', 'points', 'color', 'size', 'opacity', 'erase']);
        l = target(op, true);
        if (!Array.isArray(op.points) || op.points.length < 1 || op.points.length > 4096)
          throw Error('笔划需要 1–4096 个点');
        {
          const points = op.points.map(point),
            size = number(op.size ?? 16, 1, 1000, '笔刷大小');
          color(op.color ?? '#000000');
          number(op.opacity ?? 1, 0, 1, '不透明度');
          if (op.erase !== undefined && typeof op.erase !== 'boolean')
            throw Error('erase 必须是布尔值');
          draw(l, (c) => {
            c.strokeStyle = c.fillStyle = op.color ?? '#000000';
            c.lineWidth = size;
            c.lineCap = c.lineJoin = 'round';
            c.globalAlpha = op.opacity ?? 1;
            c.globalCompositeOperation = op.erase ? 'destination-out' : 'source-over';
            c.beginPath();
            if (points.length === 1) {
              c.arc(...points[0], size / 2, 0, Math.PI * 2);
              c.fill();
            } else {
              c.moveTo(...points[0]);
              for (const p of points.slice(1)) c.lineTo(...p);
              c.stroke();
            }
          });
        }
        break;
      case 'shape':
        fields(op, ['layerId', 'kind', 'x', 'y', 'width', 'height', 'color', 'fill', 'size']);
        l = target(op, true);
        {
          const x = number(op.x, -32000, 32000, 'x'),
            y = number(op.y, -32000, 32000, 'y'),
            w = number(op.width, 1, 32000, '宽'),
            h = number(op.height, 1, 32000, '高');
          color(op.color);
          number(op.size ?? 2, 1, 1000, '线宽');
          if (!['rect', 'ellipse', 'line'].includes(op.kind)) throw Error('形状无效');
          if (op.fill !== undefined && typeof op.fill !== 'boolean')
            throw Error('fill 必须是布尔值');
          draw(l, (c) => {
            c.fillStyle = c.strokeStyle = op.color;
            c.lineWidth = op.size ?? 2;
            c.beginPath();
            if (op.kind === 'rect') c.rect(x, y, w, h);
            else if (op.kind === 'ellipse')
              c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
            else {
              c.moveTo(x, y);
              c.lineTo(x + w, y + h);
            }
            if (op.fill !== false && op.kind !== 'line') c.fill();
            else c.stroke();
          });
        }
        break;
      case 'text':
        fields(op, ['value', 'x', 'y', 'size', 'color', 'font', 'name']);
        text(op.value, '文字', 2000);
        number(op.x, -32000, 32000, 'x');
        number(op.y, -32000, 32000, 'y');
        number(op.size ?? 48, 1, 1000, '字号');
        color(op.color ?? '#000000');
        if (!['sans-serif', 'serif', 'monospace'].includes(op.font ?? 'sans-serif'))
          throw Error('字体无效');
        l = add(layer(d.width, d.height, text(op.name || op.value.slice(0, 40), '图层名')));
        draw(l, (c) => {
          c.font = `${op.size ?? 48}px ${op.font ?? 'sans-serif'}`;
          c.fillStyle = op.color ?? '#000000';
          op.value
            .split('\n')
            .forEach((line, i) => c.fillText(line, op.x, op.y + i * (op.size ?? 48) * 1.3));
        });
        l.text = {
          value: op.value,
          x: op.x,
          y: op.y,
          size: op.size ?? 48,
          color: op.color ?? '#000000',
          font: op.font ?? 'sans-serif',
        };
        break;
      case 'image_result':
        fields(op, ['requestId', 'name', 'x', 'y']);
        if (typeof op.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(op.requestId))
          throw Error('图片任务编号无效');
        {
          const img = await imageFrom('/api/agent/requests/' + op.requestId + '/result');
          l = add(layer(img.width, img.height, text(op.name || 'Agent 图片', '图层名')));
          l.canvas.getContext('2d').drawImage(img, 0, 0);
          l.x = number(op.x ?? 0, -32000, 32000, 'x');
          l.y = number(op.y ?? 0, -32000, 32000, 'y');
        }
        break;
      case 'transform_layer':
        fields(op, ['layerId', 'scale', 'angle', 'flipX', 'flipY']);
        l = target(op, true);
        {
          const scale = number(op.scale ?? 1, 0.01, 10, '缩放'),
            angle = (number(op.angle ?? 0, -360, 360, '角度') * Math.PI) / 180;
          for (const key of ['flipX', 'flipY'])
            if (op[key] !== undefined && typeof op[key] !== 'boolean')
              throw Error('翻转参数必须为布尔值');
          const w = l.canvas.width,
            h = l.canvas.height,
            nw = Math.max(
              1,
              Math.ceil((Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle))) * scale),
            ),
            nh = Math.max(
              1,
              Math.ceil((Math.abs(w * Math.sin(angle)) + Math.abs(h * Math.cos(angle))) * scale),
            );
          const transform = (source) => {
            const result = canvas(nw, nh),
              c = result.getContext('2d');
            c.translate(nw / 2, nh / 2);
            c.rotate(angle);
            c.scale(scale * (op.flipX ? -1 : 1), scale * (op.flipY ? -1 : 1));
            c.drawImage(source, -w / 2, -h / 2);
            return result;
          };
          l.canvas = transform(l.canvas);
          if (l.mask) l.mask = transform(l.mask);
          l.x += (w - nw) / 2;
          l.y += (h - nh) / 2;
          l.text = null;
        }
        break;
      case 'crop':
        fields(op, ['x', 'y', 'width', 'height']);
        {
          const x = integer(op.x, 0, d.width - 1, 'x'),
            y = integer(op.y, 0, d.height - 1, 'y'),
            w = integer(op.width, 1, d.width - x, '宽'),
            h = integer(op.height, 1, d.height - y, '高');
          if (d.layers.some((l) => l.locked)) throw Error('包含锁定图层，不能裁剪');
          d.width = w;
          d.height = h;
          for (const item of d.layers) {
            item.x -= x;
            item.y -= y;
          }
          d.selection = null;
        }
        break;
      case 'filter':
      case 'adjustment':
        fields(
          op,
          op.op === 'filter'
            ? ['layerId', 'type', 'value']
            : ['type', 'value', 'name', 'clipToBelow'],
        );
        {
          const spec = (op.op === 'filter' ? [...adjustments, ...filters] : adjustments).find(
            (a) => a[0] === op.type,
          );
          if (!spec) throw Error('未知滤镜或调整');
          const value = number(op.value ?? spec[2], spec[3], spec[4], '参数');
          if (op.op === 'adjustment') {
            if (op.clipToBelow !== undefined && typeof op.clipToBelow !== 'boolean')
              throw Error('clipToBelow 必须是布尔值');
            l = add(layer(d.width, d.height, text(op.name || spec[1], '图层名')));
            l.adjustment = normalizeAdjustment({ type: op.type, value });
            l.clipToBelow = !!op.clipToBelow;
          } else {
            l = target(op, true);
            const c = l.canvas,
              ctx = c.getContext('2d'),
              data = ctx.getImageData(0, 0, c.width, c.height);
            const out = await runFilter(data.data, c.width, c.height, op.type, value);
            const result = canvas(c.width, c.height);
            result.getContext('2d').putImageData(new ImageData(out, c.width, c.height), 0, 0);
            draw(l, (ctx) => {
              ctx.clearRect(l.x, l.y, c.width, c.height);
              ctx.drawImage(result, l.x, l.y);
            });
          }
        }
        break;
      case 'styles':
        fields(op, ['layerId', 'styles']);
        l = target(op);
        if (!op.styles || typeof op.styles !== 'object' || Array.isArray(op.styles))
          throw Error('样式无效');
        l.styles = normalizeStyles(op.styles);
        break;
      case 'mask_selection':
        fields(op, ['layerId']);
        l = target(op);
        if (!d.selection) throw Error('请先建立选区');
        l.mask = canvas(l.canvas.width, l.canvas.height);
        {
          const c = l.mask.getContext('2d');
          clipSelection(c, d, l);
          c.fillStyle = '#ffffff';
          c.fillRect(0, 0, l.mask.width, l.mask.height);
        }
        break;
      case 'remove_mask':
        fields(op, ['layerId']);
        l = target(op);
        l.mask = null;
        break;
      case 'flatten':
        fields(op, ['name']);
        if (d.layers.some((l) => l.locked)) throw Error('包含锁定图层，不能拼合');
        {
          const image = composite(d);
          l = layer(d.width, d.height, text(op.name || '合并图像', '图层名'));
          l.canvas = image;
          d.layers = [l];
          d.activeId = l.id;
        }
        break;
    }
    if (op.as) {
      if (!l || op.op === 'delete_layer') throw Error('该操作不能命名图层引用');
      refs.set(op.as, l.id);
    }
    results.push({ index, op: op.op, ...(l ? { layerId: l.id } : {}) });
  }
  return { document: d, results, description: describeDocument(d) };
}
