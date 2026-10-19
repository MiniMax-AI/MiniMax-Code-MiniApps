import { adjustments } from './catalog.js';
import { filterPixels } from './filters.js';
import { curveLUT } from './tone.js';
import { blendPixel, dissolveCoverage } from './blending.js';

export function clippingBase(layers, index) {
  let base = index - 1;
  while (base >= 0 && layers[base].adjustment && layers[base].clipToBelow) base--;
  return base >= 0 && !layers[base].adjustment ? base : -1;
}

// Consecutive clipped adjustments belong to the ordinary layer immediately below.
// Orphan clipped adjustments are inert, never silently applied to the whole document.
export function compositionGroups(layers) {
  const groups = [];
  for (let i = 0; i < layers.length; i++) {
    const base = layers[i];
    if (base.adjustment) {
      if (!base.clipToBelow) groups.push({ base, adjustments: [] });
      continue;
    }
    const adjustments = [];
    while (layers[i + 1]?.adjustment && layers[i + 1].clipToBelow) adjustments.push(layers[++i]);
    groups.push({ base, adjustments });
  }
  return groups;
}

export function normalizeAdjustment(value) {
  if (value?.type === 'curves') {
    if (!value.value?.curves || typeof value.value.curves !== 'object')
      throw Error('曲线调整参数无效');
    const curves = {};
    for (const channel of ['rgb', 'red', 'green', 'blue']) {
      const points = value.value.curves[channel] || [
        [0, 0],
        [64, 64],
        [128, 128],
        [192, 192],
        [255, 255],
      ];
      curveLUT(points);
      curves[channel] = points.map(([x, y]) => [x, y]);
    }
    return { type: 'curves', value: { curves } };
  }
  const item = adjustments.find((a) => a[0] === value?.type);
  if (!item || !Number.isFinite(value.value)) throw Error('调整图层参数无效');
  return { type: item[0], value: Math.max(item[3], Math.min(item[4], value.value)) };
}

// Adjustment layers transform the already-composited layers below them.
// Interpolate color instead of source-over, which would incorrectly increase alpha.
export function adjustedPixels(
  source,
  width,
  height,
  adjustment,
  opacity = 1,
  mask = null,
  blend = 'source-over',
  originX = 0,
  originY = 0,
) {
  const setting = normalizeAdjustment(adjustment);
  const changed = filterPixels(source, width, height, setting.type, setting.value);
  const output = new Uint8ClampedArray(source);
  const mixed = new Float64Array(3);
  for (let i = 0; i < source.length; i += 4) {
    let weight = opacity * (mask ? mask[i + 3] / 255 : 1);
    if (blend === 'dissolve')
      weight = dissolveCoverage(
        weight,
        originX + ((i / 4) % width),
        originY + Math.floor(i / 4 / width),
      );
    if (blend !== 'source-over') blendPixel(blend, source, changed, i, mixed);
    for (let channel = 0; channel < 3; channel++)
      output[i + channel] =
        source[i + channel] +
        ((blend === 'source-over' ? changed[i + channel] : mixed[channel]) - source[i + channel]) *
          weight;
  }
  return output;
}
