import { t } from './photo-i18n.js';
const NS = 'http://www.w3.org/2000/svg';
const finitePoint = (p) =>
  Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite);

// These are command footprints, not a claim about precisely changed pixels.
export function operationPaths(method, args) {
  const steps =
    method === 'batch' && Array.isArray(args) ? args : method === 'execute' ? [args] : [];
  // Mixed batches may transform coordinates after a stroke; show only a canvas highlight.
  if (steps.some((step) => !/^paint\.(stroke|pencil|mixerBrush)$/.test(step?.command))) return [];
  return steps
    .slice(0, 64)
    .flatMap((step) => {
      const p = step?.params;
      if (!/^paint\.(stroke|pencil|mixerBrush)$/.test(step?.command) || !Array.isArray(p?.points))
        return [];
      if (!p.points.length || !p.points.every(finitePoint)) return [];
      const stride = Math.max(1, Math.ceil(p.points.length / 512));
      const points = p.points
        .filter((_, i) => i % stride === 0 || i === p.points.length - 1)
        .map(([x, y]) => [x, y]);
      const bounds = p.points.reduce(
        (b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
        [Infinity, Infinity, -Infinity, -Infinity],
      );
      return [
        {
          points,
          bounds,
          radius: Math.min(4096, Math.max(1, Number(p.size) || 1)) / 2,
        },
      ];
    })
    .slice(-8);
}
export function projectPoint([x, y], view) {
  return [
    view.origin[0] + x * view.xAxis[0] + y * view.yAxis[0],
    view.origin[1] + x * view.xAxis[1] + y * view.yAxis[1],
  ];
}
export function validViewport(v) {
  return (
    v &&
    [v.origin, v.xAxis, v.yAxis, v.size].every(finitePoint) &&
    v.size.every((x) => x > 0) &&
    Array.isArray(v.clip) &&
    v.clip.length === 4 &&
    v.clip.every(Number.isFinite) &&
    v.clip[2] > 0 &&
    v.clip[3] > 0
  );
}
export function createActivity({ frame, call }) {
  const host = document.createElement('div');
  host.className = 'photo-activity';
  host.hidden = true;
  host.setAttribute('aria-hidden', 'true');
  frame.parentElement.append(host);
  let generation = 0,
    timer,
    enabled = true;
  try {
    enabled = localStorage.getItem('minimax-photo.activity') !== 'off';
  } catch {}
  const toggle = document.querySelector('#photo-show-activity');
  toggle.checked = enabled;
  toggle.onchange = () => {
    enabled = toggle.checked;
    try {
      localStorage.setItem('minimax-photo.activity', enabled ? 'on' : 'off');
    } catch {}
    clear();
  };
  function clear() {
    generation++;
    clearTimeout(timer);
    host.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    host.replaceChildren();
    host.hidden = true;
  }
  const svgNode = (name, attrs) => {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  async function completed(method, args, before) {
    if (!enabled || !['execute', 'batch'].includes(method) || !before?.document) return;
    const ticket = generation;
    try {
      const after = await call('inspect');
      if (
        ticket !== generation ||
        after.version?.split(':')[0] !== before.version?.split(':')[0] ||
        after.version === before.version
      )
        return;
      // A geometry-changing command has no safe before/after footprint in the old coordinate system.
      if (
        after.document.width !== before.document.width ||
        after.document.height !== before.document.height
      )
        return;
      const view = await call('viewport');
      if (ticket !== generation || !validViewport(view) || document.hidden) return;
      const svg = svgNode('svg', {
        viewBox: `0 0 ${view.size.join(' ')}`,
        preserveAspectRatio: 'none',
      });
      const defs = svgNode('defs', {}),
        clip = svgNode('clipPath', { id: `activity-${ticket}` });
      clip.append(
        svgNode('rect', {
          x: view.clip[0],
          y: view.clip[1],
          width: view.clip[2],
          height: view.clip[3],
        }),
      );
      defs.append(clip);
      svg.append(defs);
      const g = svgNode('g', { 'clip-path': `url(#activity-${ticket})` });
      svg.append(g);
      const paths = operationPaths(method, args);
      const width = before.document.width,
        height = before.document.height;
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      // Limit all highlights to the canvas; no overlay may cover editor controls.
      const corners = [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ].map((p) => projectPoint(p, view));
      const docClip = svgNode('clipPath', {
        id: `activity-document-${ticket}`,
      });
      docClip.append(
        svgNode('polygon', {
          points: corners.map((p) => p.join(',')).join(' '),
        }),
      );
      defs.append(docClip);
      const content = svgNode('g', {
        'clip-path': `url(#activity-document-${ticket})`,
      });
      g.append(content);
      if (paths.length) {
        for (const { points, bounds, radius } of paths) {
          const screen = points.map((p) => projectPoint(p, view));
          const d = screen.map((p, i) => `${i ? 'L' : 'M'} ${p.join(' ')}`).join(' ');
          const path = svgNode('path', {
            d,
            class: 'photo-activity-trail',
            fill: 'none',
          });
          content.append(path);
          const length = path.getTotalLength();
          const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (!reduced && length > 0)
            path.animate(
              [
                { strokeDasharray: `${length}`, strokeDashoffset: length },
                { strokeDasharray: `${length}`, strokeDashoffset: 0 },
              ],
              { duration: 700, fill: 'forwards' },
            );
          const l = bounds[0] - radius,
            r = bounds[2] + radius,
            top = bounds[1] - radius,
            bottom = bounds[3] + radius;
          content.append(
            svgNode('polygon', {
              class: 'photo-activity-area',
              points: [
                [l, top],
                [r, top],
                [r, bottom],
                [l, bottom],
              ]
                .map((p) => projectPoint(p, view).join(','))
                .join(' '),
            }),
          );
          const end = screen.at(-1);
          content.append(
            svgNode('circle', {
              cx: end[0],
              cy: end[1],
              r: 5,
              class: 'photo-activity-tip',
            }),
          );
        }
      } else
        content.append(
          svgNode('polygon', {
            class: 'photo-activity-area',
            points: corners.map((p) => p.join(',')).join(' '),
          }),
        );
      const label = document.createElement('span');
      label.className = 'photo-activity-label';
      label.textContent = t(paths.length ? '已完成 · 画笔轨迹回放' : '已完成 · 画布已更新');
      host.replaceChildren(svg, label);
      host.hidden = false;
      timer = setTimeout(clear, 1800);
    } catch {
      /* Visualization must never change the edit result or its acknowledgement. */
    }
  }
  const resize = new ResizeObserver(clear);
  resize.observe(frame);
  frame.addEventListener('pointerdown', clear);
  // Wheel/keyboard events occur inside the iframe and may change its viewport.
  frame.addEventListener('load', () => {
    try {
      frame.contentWindow.addEventListener('wheel', clear, { passive: true });
      frame.contentWindow.addEventListener('pointerdown', clear);
      frame.contentWindow.addEventListener('keydown', clear);
    } catch {}
  });
  document.addEventListener('visibilitychange', clear);
  window.addEventListener(
    'pagehide',
    () => {
      clear();
      resize.disconnect();
    },
    { once: true },
  );
  return { clear, completed };
}
