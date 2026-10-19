import { colorReplacementPatch } from './color-replace.js';
import { backgroundEraseMask } from './background-eraser.js';
import { floodRegion } from './flood-region.js';
import { filterPixels } from './filters.js';
import { canvas, cloneCanvas, active, begin, clipSelection, invalidateLayer } from './model.js';
import { tools } from './catalog.js';
export function installCanvasTools(state, ui) {
  const {
    $,
    requireDoc,
    editable,
    status,
    schedule,
    drawOverlay,
    refresh,
    crop,
    textDialog,
    changeZoom,
    safe,
  } = ui;
  const image = $('#image'),
    overlay = $('#overlay'),
    stage = $('#stage');
  function point(e) {
    const bounds = stage.getBoundingClientRect(),
      x = (e.clientX - bounds.left - state.pan.x) / state.zoom,
      y = (e.clientY - bounds.top - state.pan.y) / state.zoom,
      a = (-state.viewRotation * Math.PI) / 180;
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  }
  function rect(a, b) {
    return {
      kind: 'rect',
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
  }
  function contextFor(l) {
    return (state.maskEditing && l.mask ? l.mask : l.canvas).getContext('2d');
  }
  function stroke(p, last, pressure = 1) {
    const l = active(state.doc),
      ctx = contextFor(l),
      size = Math.max(1, Math.min(500, Number($('#size').value) || 1)),
      opacity = Number($('#flow').value) / 100;
    ctx.save();
    clipSelection(ctx, state.doc, l);
    ctx.globalAlpha = state.tool === 'pencil' ? 1 : opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = (state.tool === 'pencil' ? 1 : size) * Math.max(0.15, pressure);
    ctx.strokeStyle = state.maskEditing ? '#fff' : $('#color').value;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.globalCompositeOperation = state.tool === 'eraser' ? 'destination-out' : 'source-over';
    if (['backgroundEraser', 'colorReplace'].includes(state.tool)) {
      if (state.drag.backgroundSample) {
        const radius = (size * Math.max(0.15, pressure)) / 2;
        const from = { x: last.x - l.x, y: last.y - l.y },
          to = { x: p.x - l.x, y: p.y - l.y };
        const x = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius - 1));
        const y = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius - 1));
        const w = Math.min(l.canvas.width, Math.ceil(Math.max(from.x, to.x) + radius + 1)) - x;
        const h = Math.min(l.canvas.height, Math.ceil(Math.max(from.y, to.y) + radius + 1)) - y;
        if (w > 0 && h > 0) {
          const pixels = ctx.getImageData(x, y, w, h);
          const mask = backgroundEraseMask(
            state.tool === 'colorReplace'
              ? state.drag.source.getContext('2d').getImageData(x, y, w, h).data
              : pixels.data,
            w,
            h,
            x,
            y,
            from,
            to,
            radius,
            state.drag.backgroundSample,
            Math.max(0, Math.min(255, Number($('#tolerance').value) || 0)),
          );
          const patch = canvas(w, h);
          let content = mask;
          if (state.tool === 'colorReplace') {
            const hex = $('#color').value;
            const color = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
            content = colorReplacementPatch(pixels.data, mask, color);
          }
          patch.getContext('2d').putImageData(new ImageData(content, w, h), 0, 0);
          ctx.globalCompositeOperation =
            state.tool === 'colorReplace' ? 'source-atop' : 'destination-out';
          ctx.drawImage(patch, x, y);
        }
      }
    } else if (['clone', 'heal'].includes(state.tool)) {
      if (!state.cloneSource) {
        ctx.restore();
        return;
      }
      const offset = {
        x: state.cloneSource.x - state.drag.start.x,
        y: state.cloneSource.y - state.drag.start.y,
      };
      ctx.beginPath();
      ctx.arc(p.x - l.x, p.y - l.y, size / 2, 0, Math.PI * 2);
      ctx.clip();
      if (state.tool === 'heal') ctx.filter = 'blur(2px)';
      ctx.drawImage(state.drag.source, offset.x * -1, offset.y * -1);
    } else if (['blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge'].includes(state.tool)) {
      const x = Math.max(0, Math.round(p.x - l.x - size / 2)),
        y = Math.max(0, Math.round(p.y - l.y - size / 2)),
        w = Math.min(l.canvas.width - x, Math.round(size)),
        h = Math.min(l.canvas.height - y, Math.round(size));
      if (w > 0 && h > 0) {
        const patch = canvas(w, h),
          pc = patch.getContext('2d');
        pc.drawImage(l.canvas, x, y, w, h, 0, 0, w, h);
        ctx.beginPath();
        ctx.arc(p.x - l.x, p.y - l.y, size / 2, 0, Math.PI * 2);
        ctx.clip();
        if (state.tool === 'blur') ctx.filter = 'blur(2px)';
        if (state.tool === 'dodge') ctx.filter = 'brightness(1.12)';
        if (state.tool === 'burn') ctx.filter = 'brightness(.88)';
        if (state.tool === 'sponge') ctx.filter = 'saturate(.7)';
        if (state.tool === 'sharpen') {
          const pixels = pc.getImageData(0, 0, w, h);
          pc.putImageData(
            new ImageData(filterPixels(pixels.data, w, h, 'unsharp', 20), w, h),
            0,
            0,
          );
        }
        ctx.drawImage(
          patch,
          x + (state.tool === 'smudge' ? (p.x - last.x) * 0.7 : 0),
          y + (state.tool === 'smudge' ? (p.y - last.y) * 0.7 : 0),
        );
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(last.x - l.x, last.y - l.y);
      ctx.lineTo(p.x - l.x, p.y - l.y);
      ctx.stroke();
      if (last.x === p.x && last.y === p.y) {
        ctx.beginPath();
        ctx.arc(p.x - l.x, p.y - l.y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    invalidateLayer(l);
    schedule();
  }
  function shape(a, b) {
    const l = active(state.doc),
      ctx = contextFor(l),
      r = rect(a, b);
    ctx.save();
    clipSelection(ctx, state.doc, l);
    ctx.translate(-l.x, -l.y);
    ctx.fillStyle = $('#color').value;
    ctx.strokeStyle = $('#color').value;
    ctx.lineWidth = Math.max(1, Number($('#size').value));
    ctx.globalAlpha = Number($('#flow').value) / 100;
    ctx.beginPath();
    if (state.tool === 'rect') ctx.rect(r.x, r.y, r.w, r.h);
    if (state.tool === 'ellipse')
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    if (state.tool === 'line') {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    if (state.tool === 'star') {
      const cx = r.x + r.w / 2,
        cy = r.y + r.h / 2;
      for (let i = 0; i < 10; i++) {
        const theta = -Math.PI / 2 + (i * Math.PI) / 5,
          f = i % 2 ? 0.42 : 1,
          x = cx + ((Math.cos(theta) * r.w) / 2) * f,
          y = cy + ((Math.sin(theta) * r.h) / 2) * f;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    }
    if (state.tool === 'gradient') {
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, $('#color').value);
      g.addColorStop(1, $('#color').value + '00');
      ctx.fillStyle = g;
      ctx.fillRect(l.x, l.y, l.canvas.width, l.canvas.height);
    } else if ($('#fill-shape').checked && state.tool !== 'line') ctx.fill();
    else ctx.stroke();
    ctx.restore();
  }
  function flood(p, select = false, erase = false) {
    const l = editable(),
      w = l.canvas.width,
      h = l.canvas.height,
      x = Math.floor(p.x - l.x),
      y = Math.floor(p.y - l.y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const ctx = contextFor(l),
      data = ctx.getImageData(0, 0, w, h).data;
    const tolerance = Math.max(0, Math.min(255, Number($('#tolerance').value) || 0));
    const { mask: region, bounds } = floodRegion(data, w, h, x, y, tolerance);
    if (!bounds) return;
    const { minX, minY, maxX, maxY } = bounds;
    if (select) {
      const runs = [];
      for (let yy = minY; yy <= maxY; yy++) {
        let start = -1;
        for (let xx = minX; xx <= maxX + 1; xx++) {
          const hit = xx <= maxX && region[yy * w + xx] === 2;
          if (hit && start < 0) start = xx;
          if (!hit && start >= 0) {
            runs.push([start + l.x, yy + l.y, xx - start]);
            start = -1;
          }
        }
      }
      state.doc.selection = { kind: 'runs', runs };
      status('已选择相近颜色的连通区域');
      schedule();
      return;
    }
    const output = canvas(w, h),
      octx = output.getContext('2d'),
      mask = octx.createImageData(w, h);
    const color = $('#color')
      .value.match(/[a-f0-9]{2}/gi)
      .map((s) => parseInt(s, 16));
    for (let i = 0; i < region.length; i++)
      if (region[i] === 2) {
        mask.data[i * 4] = color[0];
        mask.data[i * 4 + 1] = color[1];
        mask.data[i * 4 + 2] = color[2];
        mask.data[i * 4 + 3] = 255;
      }
    octx.putImageData(mask, 0, 0);
    begin(state.doc, erase ? '魔术橡皮擦' : '油漆桶填充', [l.id]);
    const a = active(state.doc),
      c = contextFor(a);
    c.save();
    clipSelection(c, state.doc, a);
    c.globalAlpha = Number($('#flow').value) / 100;
    c.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    c.drawImage(output, 0, 0);
    c.restore();
    invalidateLayer(a);
    status(erase ? '已擦除相近颜色的连通区域' : '已填充连通区域');
    refresh();
  }
  function finishPolygon() {
    const draft = state.polygonDraft;
    if (!draft || draft.points.length < 3) {
      status('至少需要三个点才能闭合选区');
      return;
    }
    state.doc.selection = { kind: 'polygon', points: draft.points.map((p) => [p.x, p.y]) };
    state.polygonDraft = null;
    status('多边形选区已创建');
    schedule(false);
  }
  window.addEventListener(
    'keydown',
    safe((e) => {
      if (
        !state.polygonDraft ||
        state.tool !== 'polyLasso' ||
        document.querySelector('#dialog').open ||
        e.target.matches('input,textarea,select')
      )
        return;
      if (!['Enter', 'Escape', 'Backspace', 'Delete'].includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Enter') finishPolygon();
      else if (e.key === 'Escape') {
        state.polygonDraft = null;
        status('已取消绘制，保留原选区');
      } else {
        state.polygonDraft.points.pop();
        if (!state.polygonDraft.points.length) state.polygonDraft = null;
        status('已撤销最后一个点');
      }
      schedule(false);
    }),
    true,
  );
  overlay.addEventListener(
    'pointerdown',
    safe((e) => {
      requireDoc();
      if (e.button !== 0) return;
      const p = point(e);
      if (state.tool === 'polyLasso') {
        if (e.detail >= 2) return;
        const draft = state.polygonDraft;
        if (
          draft &&
          draft.points.length >= 3 &&
          Math.hypot(p.x - draft.points[0].x, p.y - draft.points[0].y) * state.zoom <= 7
        ) {
          finishPolygon();
          return;
        }
        if (!draft) state.polygonDraft = { points: [p], hover: p };
        else if (
          Math.hypot(p.x - draft.points.at(-1).x, p.y - draft.points.at(-1).y) * state.zoom >
          1
        )
          draft.points.push(p);
        status('点击添加顶点，Enter 闭合，Backspace 撤点，Esc 取消');
        schedule(false);
        return;
      }
      if (state.tool === 'zoom') {
        changeZoom(e.altKey ? 0.8 : 1.25);
        return;
      }
      if (state.tool === 'eyedropper') {
        const c = image
          .getContext('2d')
          .getImageData(
            Math.max(0, Math.min(state.doc.width - 1, p.x)),
            Math.max(0, Math.min(state.doc.height - 1, p.y)),
            1,
            1,
          ).data;
        $('#color').value =
          '#' + [...c.slice(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('');
        status('颜色 ' + $('#color').value);
        return;
      }
      if (state.tool === 'text') {
        textDialog(p);
        return;
      }
      if (['fill', 'wand', 'magicEraser'].includes(state.tool)) {
        flood(p, state.tool === 'wand', state.tool === 'magicEraser');
        return;
      }
      if (state.tool === 'pen') {
        state.penPoints.push(p);
        schedule();
        return;
      }
      if (['clone', 'heal'].includes(state.tool) && e.altKey) {
        state.cloneSource = p;
        status('已设置取样点');
        return;
      }
      if (['clone', 'heal'].includes(state.tool) && !state.cloneSource)
        throw Error('请先按住 Alt 点击设置取样点');
      if (state.tool === 'colorReplace' && state.maskEditing)
        throw Error('颜色替换用于图层像素，请先退出蒙版编辑');
      overlay.setPointerCapture(e.pointerId);
      state.drag = {
        start: p,
        last: p,
        client: { x: e.clientX, y: e.clientY },
        pan: { ...state.pan },
        rotation: state.viewRotation,
        selection: null,
        points: [[p.x, p.y]],
      };
      if (
        ['hand', 'rotateView', 'ruler', 'marquee', 'ellipseSelect', 'lasso', 'crop'].includes(
          state.tool,
        )
      )
        return;
      const l = editable();
      state.drag.original = { x: l.x, y: l.y };
      if (['backgroundEraser', 'colorReplace'].includes(state.tool)) {
        const x = Math.floor(p.x - l.x),
          y = Math.floor(p.y - l.y);
        if (x >= 0 && y >= 0 && x < l.canvas.width && y < l.canvas.height) {
          const sample = contextFor(l).getImageData(x, y, 1, 1).data;
          if (sample[3]) state.drag.backgroundSample = sample;
        }
        if (!state.drag.backgroundSample) status('请从有颜色的区域开始取样');
        if (state.tool === 'colorReplace') state.drag.source = cloneCanvas(l.canvas);
      } else if (state.tool !== 'move') state.drag.source = cloneCanvas(l.canvas);
      begin(
        state.doc,
        tools.find((t) => t[0] === state.tool)[1],
        state.tool === 'move' ? [] : [l.id],
      );
      if (!['move', 'rect', 'ellipse', 'line', 'star', 'gradient'].includes(state.tool))
        stroke(p, p, e.pointerType === 'pen' ? e.pressure : 1);
    }),
  );
  overlay.addEventListener(
    'pointermove',
    safe((e) => {
      if (state.doc && state.tool === 'polyLasso' && state.polygonDraft) {
        state.polygonDraft.hover = point(e);
        drawOverlay();
        return;
      }
      if (!state.drag || !state.doc) return;
      const p = point(e);
      if (state.tool === 'hand') {
        state.pan = {
          x: state.drag.pan.x + e.clientX - state.drag.client.x,
          y: state.drag.pan.y + e.clientY - state.drag.client.y,
        };
        schedule(false);
      } else if (state.tool === 'rotateView') {
        state.viewRotation = state.drag.rotation + (e.clientX - state.drag.client.x) / 2;
        schedule(false);
      } else if (state.tool === 'move') {
        const l = active(state.doc);
        l.x = Math.round(state.drag.original.x + p.x - state.drag.start.x);
        l.y = Math.round(state.drag.original.y + p.y - state.drag.start.y);
        schedule();
      } else if (['marquee', 'ellipseSelect', 'crop'].includes(state.tool)) {
        state.drag.selection = {
          ...rect(state.drag.start, p),
          kind: state.tool === 'ellipseSelect' ? 'ellipse' : 'rect',
        };
        drawOverlay();
      } else if (state.tool === 'lasso') {
        state.drag.points.push([p.x, p.y]);
        state.drag.selection = { kind: 'polygon', points: state.drag.points };
        drawOverlay();
      } else if (state.tool === 'ruler') {
        const dx = p.x - state.drag.start.x,
          dy = p.y - state.drag.start.y;
        status(
          `距离 ${Math.hypot(dx, dy).toFixed(1)} px · 角度 ${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)}°`,
        );
      } else if (['rect', 'ellipse', 'line', 'star', 'gradient'].includes(state.tool)) {
        const l = active(state.doc),
          ctx = l.canvas.getContext('2d');
        ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
        ctx.drawImage(state.drag.source, 0, 0);
        shape(state.drag.start, p);
        invalidateLayer(l);
        schedule();
      } else stroke(p, state.drag.last, e.pointerType === 'pen' ? e.pressure : 1);
      state.drag.last = p;
    }),
  );
  function finish(e) {
    if (!state.drag) return;
    const d = state.drag;
    state.drag = null;
    if (['marquee', 'ellipseSelect', 'lasso'].includes(state.tool)) {
      state.doc.selection = d.selection;
      status('选区已创建');
    }
    if (state.tool === 'crop' && d.selection && d.selection.w > 1 && d.selection.h > 1)
      crop(d.selection);
    if (['hand', 'rotateView', 'ruler', 'marquee', 'ellipseSelect', 'lasso'].includes(state.tool))
      schedule(false);
    else refresh();
    if (overlay.hasPointerCapture(e.pointerId)) overlay.releasePointerCapture(e.pointerId);
  }
  overlay.addEventListener('pointerup', safe(finish));
  overlay.addEventListener('pointercancel', safe(finish));
  overlay.addEventListener(
    'dblclick',
    safe(() => {
      if (state.tool === 'polyLasso') {
        if (state.polygonDraft) finishPolygon();
        return;
      }
      if (state.tool !== 'pen' || state.penPoints.length < 3) return;
      const l = editable();
      begin(state.doc, '绘制路径', [l.id]);
      const ctx = active(state.doc).canvas.getContext('2d');
      ctx.save();
      clipSelection(ctx, state.doc, active(state.doc));
      ctx.translate(-l.x, -l.y);
      ctx.fillStyle = $('#color').value;
      ctx.strokeStyle = $('#color').value;
      ctx.lineWidth = Number($('#size').value);
      ctx.beginPath();
      state.penPoints.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      $('#fill-shape').checked ? ctx.fill() : ctx.stroke();
      ctx.restore();
      state.doc.paths.push(state.penPoints.map((p) => ({ ...p })));
      state.penPoints = [];
      refresh();
    }),
  );
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!state.doc) return;
      e.preventDefault();
      changeZoom(e.deltaY < 0 ? 1.08 : 1 / 1.08);
    },
    { passive: false },
  );
}
