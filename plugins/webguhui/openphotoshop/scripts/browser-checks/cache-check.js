import {
  layer,
  renderedLayer,
  layerRenderCache,
  invalidateLayer,
  documentModel,
  begin,
  undo,
  redo,
} from './model.js';
import { normalizeStyles } from './layer-styles.js';
const button = document.querySelector('#run'),
  result = document.querySelector('#result');
button.onclick = async () => {
  button.disabled = true;
  result.textContent = '检查中…';
  await new Promise(requestAnimationFrame);
  try {
    const l = layer(1280, 800, 'benchmark'),
      ctx = l.canvas.getContext('2d');
    ctx.fillStyle = '#227fa8';
    ctx.font = 'bold 140px sans-serif';
    ctx.fillText('RETOUCH', 100, 400);
    l.styles = normalizeStyles({
      stroke: { enabled: true },
      bevel: { enabled: true },
      shadow: { enabled: true },
    });
    const cold = [],
      warm = [];
    let baseline;
    for (let i = 0; i < 5; i++) {
      layerRenderCache.clear();
      const start = performance.now();
      baseline = renderedLayer(l);
      cold.push(performance.now() - start);
      await new Promise(requestAnimationFrame);
    }
    const pixels = (r) =>
      r.image.getContext('2d').getImageData(0, 0, r.image.width, r.image.height).data;
    const original = pixels(baseline);
    let hit;
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      hit = renderedLayer(l);
      warm.push(performance.now() - start);
    }
    const cached = pixels(hit);
    const same = original.length === cached.length && original.every((v, i) => v === cached[i]);
    const d = documentModel(1280, 800);
    d.layers = [l];
    d.activeId = l.id;
    begin(d, '测试绘制', [l.id]);
    const edited = d.layers[0];
    edited.canvas.getContext('2d').fillRect(200, 500, 100, 50);
    invalidateLayer(edited);
    const changed = pixels(renderedLayer(edited));
    const editVisible = original.some((v, i) => v !== changed[i]);
    undo(d);
    const undone = pixels(renderedLayer(d.layers[0]));
    const undoRestored = original.every((v, i) => v === undone[i]);
    redo(d);
    const redone = pixels(renderedLayer(d.layers[0]));
    const redoRestored = changed.every((v, i) => v === redone[i]);
    const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
    result.textContent = JSON.stringify(
      {
        size: [1280, 800],
        coldMs: cold,
        warmMs: warm,
        coldMedianMs: median(cold),
        warmMedianMs: median(warm),
        cachedPixelsEqual: same,
        editVisible,
        undoRestored,
        redoRestored,
        cache: layerRenderCache.stats(),
        note: '仅本实现缓存前后；不代表原站对比、首帧或完整交互帧率',
      },
      null,
      2,
    );
    document.querySelector('#image').replaceChildren(hit.image);
  } catch (e) {
    result.textContent = 'FAIL ' + e.stack;
  } finally {
    button.disabled = false;
  }
};
