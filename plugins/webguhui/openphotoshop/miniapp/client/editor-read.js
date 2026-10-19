import { canvas, composite } from './model.js';
export function readEditorImage(d, options = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((k) => !['layerId', 'region', 'maxEdge', 'points'].includes(k))
  )
    throw Error('读图参数无效');
  let layers = d.layers;
  if (options.layerId !== undefined) {
    const l = layers.find((l) => l.id === options.layerId);
    if (!l || l.adjustment) throw Error('请选择普通图层，调整层请读取合并图像');
    layers = [l];
  }
  const full = composite({ ...d, layers });
  let region = options.region || { x: 0, y: 0, width: d.width, height: d.height };
  if (
    Object.keys(region).some((k) => !['x', 'y', 'width', 'height'].includes(k)) ||
    !['x', 'y', 'width', 'height'].every((k) => Number.isInteger(region[k])) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    region.x + region.width > d.width ||
    region.y + region.height > d.height
  )
    throw Error('读取区域必须在画布范围内');
  const maxEdge = options.maxEdge ?? 1280;
  if (!Number.isInteger(maxEdge) || maxEdge < 64 || maxEdge > 4096)
    throw Error('maxEdge 范围为 64–4096');
  const scale = Math.min(1, maxEdge / Math.max(region.width, region.height));
  const preview = canvas(
    Math.max(1, Math.round(region.width * scale)),
    Math.max(1, Math.round(region.height * scale)),
  );
  preview
    .getContext('2d')
    .drawImage(
      full,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      preview.width,
      preview.height,
    );
  const points = options.points ?? [];
  if (!Array.isArray(points) || points.length > 256) throw Error('最多取样 256 个像素');
  const pixels = points.map((p) => {
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      !p.every(Number.isInteger) ||
      p[0] < 0 ||
      p[1] < 0 ||
      p[0] >= d.width ||
      p[1] >= d.height
    )
      throw Error('取样点必须在画布范围内');
    return { point: p, rgba: [...full.getContext('2d').getImageData(...p, 1, 1).data] };
  });
  return { preview, full, scale, region, pixels };
}
