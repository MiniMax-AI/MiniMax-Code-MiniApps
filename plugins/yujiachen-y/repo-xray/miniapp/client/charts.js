// Hand-written SVG charts. Every function returns markup; tooltips use data-tip.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s, n) => {
  const d = parseYmd(s);
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
export const dayDiff = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86_400_000);
export const mondayOf = (s) => addDays(s, -((parseYmd(s).getDay() + 6) % 7));
export const WD = ['日', '一', '二', '三', '四', '五', '六'];
export const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('zh-CN'));

let uid = 0;
const nextId = (p) => `${p}${++uid}`;

export function memberColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  // Skip the violet/purple/magenta band (245°–335°): spread the rest of the wheel instead.
  let hue = h % 270;
  if (hue >= 245) hue += 90;
  return `hsl(${hue} 58% 52%)`;
}

function quantiles(values) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  const q = (p) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))] : 0);
  return [q(0.3), q(0.6), q(0.85)];
}
const levelOf = (t, v) => (!v ? 0 : v <= t[0] ? 1 : v <= t[1] ? 2 : v <= t[2] ? 3 : 4);

export function heatLegend() {
  return `<span class="heat-legend" aria-hidden="true">少 ${[0, 1, 2, 3, 4].map((l) => `<i style="background:var(--heat-${l})"></i>`).join('')} 多</span>`;
}

/** GitHub-style calendar, Monday-first rows. */
export function calendar({ daily, start, end, cell = 12, gap = 3, label = '活动热力图', unit = '条活动' }) {
  const startMon = mondayOf(start);
  const nWeeks = Math.floor(dayDiff(startMon, end) / 7) + 1;
  const t = quantiles(Object.values(daily));
  const left = 22;
  const top = 16;
  const cw = Math.min(cell * 3.2, Math.max(cell, Math.floor((53 * (cell + gap)) / nWeeks) - gap));
  const stepX = cw + gap;
  const step = cell + gap;
  const W = left + nWeeks * stepX;
  const H = top + 7 * step;
  let cells = '';
  let months = '';
  let lastMonth = -1;
  let lastLabelW = -9;
  for (let w = 0; w < nWeeks; w++) {
    const weekStart = addDays(startMon, w * 7);
    for (let d = 0; d < 7; d++) {
      const date = addDays(startMon, w * 7 + d);
      if (date > end) break;
      const inRange = date >= start;
      const v = daily[date] || 0;
      const lv = inRange ? levelOf(t, v) : 0;
      cells += `<rect class="heat-cell cell-in" style="--i:${w};fill:var(--heat-${lv})" x="${left + w * stepX}" y="${top + d * step}" width="${cw}" height="${cell}" rx="3"${inRange ? '' : ' opacity="0.3"'} data-tip="${date} 周${WD[parseYmd(date).getDay()]}&#10;${inRange ? `${fmt(v)} ${unit}` : '不在统计范围内'}"/>`;
    }
    const mDate = parseYmd(weekStart);
    if (mDate.getMonth() !== lastMonth && (w - lastLabelW) * stepX >= 3 * step) {
      months += `<text x="${left + w * stepX}" y="10">${mDate.getMonth() + 1}月</text>`;
      lastLabelW = w;
    }
    lastMonth = mDate.getMonth();
  }
  const days = [1, 3, 5].map((d) => `<text x="0" y="${top + (d - 1) * step + cell - 2}">${WD[d]}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="max-width:${Math.round(W * 1.5)}px" role="img" aria-label="${esc(label)}">${months}${days}${cells}</svg>`;
}

/** Monotone cubic interpolation (Fritsch–Carlson) for evenly or unevenly spaced x. */
function monotone(points) {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `L${points[0][0]},${points[0][1]}`;
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1][0] - points[i][0]);
    m.push((points[i + 1][1] - points[i][1]) / (dx[i] || 1));
  }
  const tan = [m[0]];
  for (let i = 1; i < n - 1; i++) tan.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  tan.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tan[i] = 0;
      tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / m[i];
    const b = tan[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tan[i] = k * a * m[i];
      tan[i + 1] = k * b * m[i];
    }
  }
  let d = '';
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    d += `C${(x0 + h).toFixed(1)},${(y0 + tan[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - tan[i + 1] * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

function niceMax(v) {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

/** Smooth stacked area by week. series[w][k]. */
export function stackedArea({ weeks, series, kinds, labels, colors, hidden, end, height = 230 }) {
  const W = 760;
  const H = height;
  const L = 40;
  const R = 10;
  const T = 10;
  const B = 24;
  const vis = kinds.map((k, i) => [k, i]).filter(([k]) => !hidden.has(k));
  const totals = series.map((row) => vis.reduce((s, [, i]) => s + row[i], 0));
  const max = niceMax(Math.max(1, ...totals));
  const n = weeks.length;
  const x = (i) => L + (n <= 1 ? 0 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const id = nextId('sa');
  let defs = '';
  let layers = '';
  const base = new Array(n).fill(0);
  for (const [k, i] of vis) {
    const lower = base.map((v, w) => [x(w), y(v)]);
    for (let w = 0; w < n; w++) base[w] += series[w][i];
    const upper = base.map((v, w) => [x(w), y(v)]);
    const gid = `${id}-${k}`;
    defs += `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${colors[k]};stop-opacity:0.95"/><stop offset="1" style="stop-color:${colors[k]};stop-opacity:0.6"/></linearGradient>`;
    const rev = [...lower].reverse();
    layers += `<path d="M${upper[0][0]},${upper[0][1]}${monotone(upper)}L${rev[0][0]},${rev[0][1]}${monotone(rev)}Z" fill="url(#${gid})"/>`;
  }
  const top = totals.map((v, w) => [x(w), y(v)]);
  const line = n ? `<path class="draw-in" d="M${top[0][0]},${top[0][1]}${monotone(top)}" fill="none" style="stroke:var(--mcode-text);stroke-opacity:0.55" stroke-width="1.3"/>` : '';
  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const v = (max * g) / 4;
    grid += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${fmt(Math.round(v))}</text>`;
  }
  let xl = '';
  let lastM = -1;
  let lastX = -99;
  weeks.forEach((wk, i) => {
    const m = parseYmd(wk).getMonth();
    if (m !== lastM && x(i) - lastX > 34) {
      xl += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${m + 1}月</text>`;
      lastX = x(i);
    }
    lastM = m;
  });
  const colW = n > 1 ? (W - L - R) / (n - 1) : W - L - R;
  const hits = weeks
    .map((wk, i) => {
      const wEnd = addDays(wk, 6) > end ? end : addDays(wk, 6);
      const lines = vis.filter(([, k]) => series[i][k] > 0).map(([k, ki]) => `${labels[k]} ${fmt(series[i][ki])}`);
      const tip = `${wk.slice(5)} – ${wEnd.slice(5)}  共 ${fmt(totals[i])}${lines.length ? '&#10;' + lines.join('&#10;') : ''}`;
      return `<rect class="hover-col" x="${x(i) - colW / 2}" y="${T}" width="${colW}" height="${H - T - B}" fill="transparent" data-tip="${esc(tip).replace(/&amp;#10;/g, '&#10;')}" data-hl="1"/>`;
    })
    .join('');
  const peak = totals.indexOf(Math.max(...totals));
  const peakMark = totals[peak] > 0 ? `<circle cx="${x(peak)}" cy="${y(totals[peak])}" r="3.5" style="fill:var(--mcode-surface);stroke:var(--mcode-text)" stroke-width="1.5"/><text x="${x(peak)}" y="${y(totals[peak]) - 8}" text-anchor="middle" style="font-weight:600;fill:var(--mcode-text)">峰值 ${fmt(totals[peak])}</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="每周活动趋势，峰值 ${fmt(totals[peak] || 0)}"><defs>${defs}</defs>${grid}${layers}${line}${peakMark}${xl}${hits}</svg>`;
}

export function donut({ items, center, sub }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const R = 62;
  const r = 44;
  let a0 = -Math.PI / 2;
  let paths = '';
  for (const it of items) {
    if (!it.value) continue;
    const frac = it.value / total;
    const a1 = a0 + frac * Math.PI * 2 - (frac < 1 ? 0.012 : 0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, rad) => `${(75 + rad * Math.cos(a)).toFixed(2)},${(75 + rad * Math.sin(a)).toFixed(2)}`;
    paths +=
      frac >= 0.999
        ? `<circle cx="75" cy="75" r="${(R + r) / 2}" fill="none" style="stroke:${it.color}" stroke-width="${R - r}" data-tip="${esc(it.label)} ${fmt(it.value)}（100%）"/>`
        : `<path d="M${p(a0, R)}A${R},${R} 0 ${large} 1 ${p(a1, R)}L${p(a1, r)}A${r},${r} 0 ${large} 0 ${p(a0, r)}Z" style="fill:${it.color}" data-tip="${esc(it.label)} ${fmt(it.value)}（${Math.round(frac * 100)}%）"/>`;
    a0 += frac * Math.PI * 2;
  }
  if (!total) paths = `<circle cx="75" cy="75" r="${(R + r) / 2}" fill="none" style="stroke:var(--heat-0)" stroke-width="${R - r}"/>`;
  return `<svg viewBox="0 0 150 150" role="img" aria-label="活动构成">${paths}<text class="donut-center" x="75" y="78" text-anchor="middle">${esc(center)}</text><text x="75" y="96" text-anchor="middle">${esc(sub)}</text></svg>`;
}

/** Members × weeks matrix. rows: [{ username, label, weekly }] */
export function swimlane({ rows, weeks, end }) {
  const labelW = 96;
  const ch = 11;
  const gap = 2;
  const rowH = 16;
  const n = weeks.length;
  const cell = Math.min(40, Math.max(ch, Math.floor((53 * (ch + gap)) / n) - gap));
  const W = labelW + n * (cell + gap);
  const H = 16 + rows.length * rowH;
  const t = quantiles(rows.flatMap((r) => r.weekly));
  let out = '';
  let lastM = -1;
  let lastX = -99;
  weeks.forEach((wk, i) => {
    const m = parseYmd(wk).getMonth();
    const xx = labelW + i * (cell + gap);
    if (m !== lastM && xx - lastX > 30) {
      out += `<text x="${xx}" y="10">${m + 1}月</text>`;
      lastX = xx;
    }
    lastM = m;
  });
  rows.forEach((r, ri) => {
    const yy = 16 + ri * rowH;
    out += `<g class="lane" data-member="${esc(r.username)}" style="cursor:pointer"><text x="${labelW - 8}" y="${yy + ch - 1}" text-anchor="end" style="font-size:11px;fill:var(--mcode-text)">${esc(r.label.length > 9 ? r.label.slice(0, 8) + '…' : r.label)}</text>`;
    r.weekly.forEach((v, i) => {
      const wEnd = addDays(weeks[i], 6) > end ? end : addDays(weeks[i], 6);
      out += `<rect class="cell-in" style="--i:${i};fill:var(--heat-${levelOf(t, v)})" x="${labelW + i * (cell + gap)}" y="${yy}" width="${cell}" height="${ch}" rx="2.5" data-tip="${esc(r.label)}&#10;${weeks[i].slice(5)} – ${wEnd.slice(5)}：${fmt(v)} 条"/>`;
    });
    out += '</g>';
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W, 640)}px;max-width:${Math.round(W * 1.25)}px" role="img" aria-label="成员每周活动矩阵，共 ${rows.length} 人">${out}</svg>`;
}

/** 7 × 24 punch card, Monday-first rows. */
export function punchcard({ punch, color = 'var(--k-code)', label = '作息打卡图' }) {
  const L = 22;
  const T = 6;
  const step = 26;
  const rowH = 22;
  const W = L + 24 * step;
  const H = T + 7 * rowH + 16;
  const max = Math.max(1, ...punch);
  let out = '';
  for (let d = 0; d < 7; d++) {
    const yy = T + d * rowH + rowH / 2;
    out += `<text x="0" y="${yy + 3}">${WD[(d + 1) % 7]}</text>`;
    for (let h = 0; h < 24; h++) {
      const v = punch[d * 24 + h] || 0;
      const r = v ? 2 + Math.sqrt(v / max) * 8.5 : 1.2;
      const night = h >= 22 || h < 6;
      out += `<circle cx="${L + h * step + step / 2}" cy="${yy}" r="${r.toFixed(1)}" style="fill:${v ? (night ? 'var(--k-mr)' : color) : 'var(--heat-0)'};fill-opacity:${v ? (0.35 + 0.65 * (v / max)).toFixed(2) : 1}" data-tip="周${WD[(d + 1) % 7]} ${h}:00–${h + 1}:00&#10;${fmt(v)} 条"/>`;
    }
  }
  for (let h = 0; h < 24; h += 3) out += `<text x="${L + h * step + step / 2}" y="${H - 2}" text-anchor="middle">${h}时</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${out}</svg>`;
}

/** Build vs collaborate scatter with median quadrants and collision-aware labels. */
export function scatter({ points }) {
  const W = 580;
  const H = 340;
  const L = 34;
  const R = 14;
  const T = 26;
  const B = 34;
  if (!points.length) return '';
  const sx = Math.sqrt(Math.max(1, ...points.map((p) => p.x)));
  const sy = Math.sqrt(Math.max(1, ...points.map((p) => p.y)));
  const X = (v) => L + (W - L - R) * (Math.sqrt(v) / sx);
  const Y = (v) => T + (H - T - B) * (1 - Math.sqrt(v) / sy);
  const med = (a) => {
    const v = [...a].sort((p, q) => p - q);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  const mx = med(points.map((p) => p.x));
  const my = med(points.map((p) => p.y));
  const maxR = Math.max(1, ...points.map((p) => p.r));
  const qx = X(mx);
  const qy = Y(my);
  let out = `<rect x="${qx}" y="${T}" width="${W - R - qx}" height="${qy - T}" style="fill:var(--glow)" rx="6"/>`;
  out += `<line class="grid-line" x1="${qx}" x2="${qx}" y1="${T}" y2="${H - B}" stroke-dasharray="4 4"/><line class="grid-line" x1="${L}" x2="${W - R}" y1="${qy}" y2="${qy}" stroke-dasharray="4 4"/>`;
  const q = (x, y, anchor, t) => `<text x="${x}" y="${y}" text-anchor="${anchor}" style="font-size:11px;font-weight:600;fill:var(--mcode-text-subtle)">${t}</text>`;
  out += q(W - R, T - 10, 'end', '全能型 ↗') + q(L, T - 10, 'start', '协作型') + q(W - R, H - 4, 'end', '产出型') + q(L, H - 4, 'start', '轻量参与');
  out += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">产出（推送 + 发起 + 合入）→</text><text x="10" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 10 ${(T + H - B) / 2})">协作（Review + 评论）→</text>`;
  const placed = [];
  const nodes = [...points].sort((a, b) => b.r - a.r).map((p) => ({ ...p, cx: X(p.x), cy: Y(p.y), rad: 4 + 12 * Math.sqrt(p.r / maxR) }));
  let circles = '';
  for (const p of nodes) {
    circles += `<g data-member="${esc(p.username)}" style="cursor:pointer"><circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${p.rad.toFixed(1)}" style="fill:${p.color};fill-opacity:0.55;stroke:${p.color}" stroke-width="1.2" data-tip="${esc(p.label)}&#10;产出 ${fmt(p.x)} · 协作 ${fmt(p.y)}&#10;活跃 ${fmt(p.r)} 天"/></g>`;
  }
  let labels = '';
  const byImportance = [...nodes].sort((a, b) => b.x + b.y - (a.x + a.y));
  for (const p of byImportance) {
    const text = p.label.length > 6 ? p.label.slice(0, 6) : p.label;
    const w = [...text].reduce((s, c) => s + (/[\x00-\x7f]/.test(c) ? 5.6 : 10), 0);
    const h = 11;
    const cands = [
      [p.cx, p.cy - p.rad - 3, 'middle'],
      [p.cx + p.rad + 3, p.cy + 3.5, 'start'],
      [p.cx - p.rad - 3, p.cy + 3.5, 'end'],
      [p.cx, p.cy + p.rad + 10, 'middle'],
    ];
    for (const [x, y, anchor] of cands) {
      const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      const box = [x0 - 1, y - h + 1, x0 + w + 1, y + 2];
      if (box[0] < L || box[2] > W - R || box[1] < T - 4 || box[3] > H - B) continue;
      if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      placed.push(box);
      labels += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" style="font-size:10.5px;fill:var(--mcode-text);pointer-events:none">${esc(text)}</text>`;
      break;
    }
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="工作风格散点图">${out}${circles}${labels}</svg>`;
}

export function sparkline(values, { w = 96, h = 26, color = 'var(--k-code)', stretch = false } = {}) {
  if (!values.length) return '';
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => [n <= 1 ? 0 : (i * w) / (n - 1), h - 2 - ((h - 4) * v) / max]);
  const id = nextId('sp');
  const d = `M${pts[0][0]},${pts[0][1]}${monotone(pts)}`;
  const size = stretch ? 'preserveAspectRatio="none" class="spark-fill"' : `width="${w}" height="${h}"`;
  return `<svg viewBox="0 0 ${w} ${h}" ${size} aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:0.35"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs><path d="${d}L${w},${h}L0,${h}Z" fill="url(#${id})"/><path d="${d}" fill="none" style="stroke:${color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Monthly bars with optional averaged bands. months: [{m:'YYYY-MM', n}] */
export function monthBars({ months, partial, bands = [], height = 220, color = 'var(--k-code)' }) {
  const W = 760;
  const H = height;
  const L = 40;
  const R = 8;
  const T = 18;
  const B = 24;
  const n = months.length;
  if (!n) return '';
  const peak = Math.max(1, ...months.map((x) => x.n));
  const raw = peak / 4;
  const p10 = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((k) => k * p10).find((k) => k >= raw));
  const ticks = Math.ceil(peak / step);
  const max = step * ticks;
  const bw = (W - L - R) / n;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const gid = nextId('mb');
  let out = `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:1"/><stop offset="1" style="stop-color:${color};stop-opacity:0.55"/></linearGradient></defs>`;
  for (let g = 0; g <= ticks; g++) {
    const v = step * g;
    out += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${fmt(Math.round(v))}</text>`;
  }
  months.forEach((x, i) => {
    const h = y(0) - y(x.n);
    const isPartial = x.m === partial;
    const gap = Math.min(3, bw * 0.25);
    out += `<rect class="grow-y mb" x="${(L + i * bw + gap / 2).toFixed(1)}" y="${y(x.n).toFixed(1)}" width="${Math.max(1, bw - gap).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="${Math.min(3, bw / 4).toFixed(1)}" style="fill:url(#${gid});fill-opacity:${isPartial ? 0.35 : 1}" data-tip="${x.m}${isPartial ? '（当月未结束）' : ''}&#10;${fmt(x.n)} 个 commit"/>`;
  });
  const placed = [];
  for (const b of bands) {
    const i0 = months.findIndex((x) => x.m === b.from);
    const i1 = months.findIndex((x) => x.m === b.to);
    if (i0 < 0 || i1 < 0) continue;
    const yy = y(b.value);
    // Label sits above its line; if it would collide with an earlier label, drop it below the line.
    let ly = yy - 6;
    if (placed.some((p) => Math.abs(p - ly) < 13)) ly = yy + 14;
    if (ly < T + 9) ly = yy + 14;
    placed.push(ly);
    out += `<line x1="${L + i0 * bw}" x2="${L + (i1 + 1) * bw}" y1="${yy}" y2="${yy}" style="stroke:${b.color};stroke-width:2;stroke-dasharray:5 3"/><text class="band-label" x="${L + (i1 + 1) * bw - 2}" y="${ly}" text-anchor="end" style="fill:${b.color}">${esc(b.label)}</text>`;
  }
  const every = Math.ceil(n / 12);
  months.forEach((x, i) => {
    if (i % every && i !== n - 1) return;
    const [yy, mm] = x.m.split('-');
    out += `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${mm === '01' || i === 0 ? `${yy.slice(2)}/` : ''}${Number(mm)}月</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="按月提交数">${out}</svg>`;
}

export function niceMaxPublic(v) {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

/** Stacked horizontal share bar. items: [{label, value, color}] */
export function shareBar(items, { height = 14, label = '占比' } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return `<div class="share-bar" style="height:${height}px" role="img" aria-label="${esc(label)}">${items
    .filter((i) => i.value > 0)
    .map((i) => `<span style="width:${((100 * i.value) / total).toFixed(2)}%;background:${i.color}" data-tip="${esc(i.label)}&#10;${fmt(i.value)}（${((100 * i.value) / total).toFixed(1)}%）"></span>`)
    .join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Code map (nested squarified treemap) and KPI instruments
// ---------------------------------------------------------------------------
export const fmtK = (n) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const textW = (s, px = 11) => [...s].reduce((w, c) => w + (/[\x00-\x7f]/.test(c) ? px * 0.62 : px), 0);
/** First candidate that fits; otherwise the last one shortened at the end, or '' when too little would survive. */
export function fitLabel(cands, maxW, px = 11) {
  for (const c of cands) if (textW(c, px) <= maxW) return c;
  const out = clip(cands[cands.length - 1], maxW, px);
  return [...out].length >= 4 ? out : '';
}
function clip(s, maxW, px = 11) {
  if (textW(s, px) <= maxW) return s;
  const chars = [...s];
  while (chars.length > 1 && textW(`${chars.join('')}…`, px) > maxW) chars.pop();
  return `${chars.join('')}…`;
}
const GENERIC_DIRS = new Set(['src', 'lib', 'test', 'tests', 'unit', 'e2e', 'spec', '__tests__', 'app', 'pkg', 'internal', 'components', 'utils', 'assets', 'docs', 'scripts', 'source', 'main', 'resources', 'public', 'static']);
/** Directory label candidates, most to least specific; the last one is the fallback. */
export function dirLabels(rel) {
  const segs = rel.split('/');
  const last = segs.at(-1);
  const key = segs.length >= 2 && GENERIC_DIRS.has(last.toLowerCase()) ? segs[0] : last;
  const out = [`${rel}/`];
  if (segs.length >= 3) out.push(`${segs[0]}/…/${last}/`);
  out.push(`${key}/`, key);
  return out;
}

/** Squarified layout (Bruls, Huizing & van Wijk). items: [{ value > 0 }] sorted descending. */
export function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  let rest = items.map((item) => ({ item, area: item.value * scale }));
  const worst = (row, side) => {
    let sum = 0;
    let mx = 0;
    let mn = Infinity;
    for (const r of row) {
      sum += r.area;
      mx = Math.max(mx, r.area);
      mn = Math.min(mn, r.area);
    }
    const s2 = side * side;
    return Math.max((s2 * mx) / (sum * sum), (sum * sum) / (s2 * mn));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest[0]];
    let cur = worst(row, side);
    for (let i = 1; i < rest.length; i++) {
      const next = worst([...row, rest[i]], side);
      if (next > cur) break;
      row.push(rest[i]);
      cur = next;
    }
    const sum = row.reduce((s, r) => s + r.area, 0);
    if (w >= h) {
      const sw = sum / h;
      let cy = y;
      for (const r of row) {
        out.push({ item: r.item, x, y: cy, w: sw, h: r.area / sw });
        cy += r.area / sw;
      }
      x += sw;
      w -= sw;
    } else {
      const sh = sum / w;
      let cx = x;
      for (const r of row) {
        out.push({ item: r.item, x: cx, y, w: r.area / sh, h: sh });
        cx += r.area / sh;
      }
      y += sh;
      h -= sh;
    }
    rest = rest.slice(row.length);
  }
  return out;
}

const RISK_BINS = [0.1, 0.2, 0.3, 0.4];
const RISK_LABELS = ['<10%', '10–20%', '20–30%', '30–40%', '≥40%'];
export const riskLevel = (ratio) => RISK_BINS.filter((b) => ratio >= b).length;
export function riskLegend() {
  return `<span class="heat-legend" aria-hidden="true">修 bug 占比 <span class="mono">${RISK_LABELS[0]}</span>${RISK_LABELS.map((l, i) => `<i style="background:var(--risk-${i})" title="${l}"></i>`).join('')}<span class="mono">${RISK_LABELS[4]}</span></span>`;
}

/**
 * Nested layout: blocks grouped by `group` (the focus' direct child that holds them), groups
 * squarified by total value, blocks squarified inside each group frame.
 * @returns {{ width: number, height: number, groups: any[], cells: { i: number, x: number, y: number, w: number, h: number }[] }}
 */
export function mapLayout(blocks, { width, height, value }) {
  const groups = new Map();
  blocks.forEach((b, i) => {
    const v = value(b);
    if (!(v > 0)) return;
    const g = groups.get(b.group) || { key: b.group, value: 0, items: [] };
    g.value += v;
    g.items.push({ i, value: v });
    groups.set(b.group, g);
  });
  const PAD = 3;
  const HEAD = 19;
  const out = { width, height, groups: [], cells: [] };
  for (const g of squarify([...groups.values()].sort((a, b) => b.value - a.value), 0, 0, width, height)) {
    const G = g.item;
    const head = g.w > 64 && g.h > 52;
    out.groups.push({ key: G.key, x: g.x, y: g.y, w: g.w, h: g.h, head, value: G.value });
    const top = head ? HEAD : PAD;
    for (const c of squarify(G.items.sort((a, b) => b.value - a.value), g.x + PAD, g.y + top, g.w - 2 * PAD, g.h - top - PAD)) {
      out.cells.push({ i: c.item.i, x: c.x + 1, y: c.y + 1, w: Math.max(0, c.w - 2), h: Math.max(0, c.h - 2) });
    }
  }
  return out;
}

/** Structure only (frames, tiles, labels); colours, values and tooltips are painted by the caller. */
export function mapSvg(layout, { blocks, groupLabel, groupValue = fmtK, nameOf, action = 'map-cell', label = '代码地图' }) {
  const id = nextId('mp');
  let frames = '';
  const heads = new Set();
  for (const g of layout.groups) {
    frames += `<rect class="tm-frame" x="${(g.x + 0.5).toFixed(1)}" y="${(g.y + 0.5).toFixed(1)}" width="${Math.max(0, g.w - 1).toFixed(1)}" height="${Math.max(0, g.h - 1).toFixed(1)}" rx="6"/>`;
    if (!g.head) continue;
    heads.add(g.key);
    const name = groupLabel(g.key);
    // The header carries the area measure with its unit, so it never reads as the tiles' lens value.
    const val = groupValue(g.value);
    const both = textW(name, 10.5) + textW(val, 10.5) + 24 <= g.w;
    frames += `<text class="tm-group" x="${(g.x + 8).toFixed(1)}" y="${(g.y + 13).toFixed(1)}">${esc(both ? name : clip(name, g.w - 16, 10.5))}${both ? `<tspan class="tm-gval" dx="7">${esc(val)}</tspan>` : ''}</text>`;
  }
  let cells = '';
  for (const c of layout.cells) {
    const b = blocks[c.i];
    const { x, y, w, h } = c;
    const whole = b.kind === 'dir' && b.path === b.group && heads.has(b.group); // the frame header already names it
    const px = w >= 130 ? 11 : 10;
    const name = !whole && w >= 40 && h >= 20 ? fitLabel(nameOf(b), w - (b.risk ? 22 : 12), px) : '';
    const showVal = whole ? w >= 54 && h >= 20 : w >= 54 && h >= 36;
    cells +=
      `<g class="tm-cell${b.kind === 'other' ? ' is-other' : ''}" role="button" tabindex="${cells ? -1 : 0}" data-action="${action}" data-i="${c.i}">` +
      `<rect class="tm-r" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4"/>` +
      (b.kind === 'other' ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="url(#${id}-h)" pointer-events="none"/>` : '') +
      (name ? `<text class="tm-name" x="${(x + 6).toFixed(1)}" y="${(y + 14).toFixed(1)}"${px === 11 ? '' : ' style="font-size:10px"'}>${esc(name)}</text>` : '') +
      (showVal ? `<text class="tm-val" x="${(x + 6).toFixed(1)}" y="${(whole ? y + 14 : y + 27).toFixed(1)}" data-w="${Math.max(0, w - (b.risk ? 22 : 12)).toFixed(0)}"></text>` : '') +
      '<g class="tm-mix" pointer-events="none"></g>' +
      (b.risk && w >= 16 && h >= 14 ? `<circle class="tm-risk" cx="${(x + w - 7).toFixed(1)}" cy="${(y + 7).toFixed(1)}" r="3.4"/>` : '') +
      '</g>';
  }
  return `<svg class="chart treemap" viewBox="0 0 ${layout.width} ${layout.height}" role="group" aria-label="${esc(label)}"><defs><pattern id="${id}-h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="tm-hatch" stroke-width="2"/></pattern></defs>${frames}<g class="tm-cells">${cells}</g><g class="tm-lines" aria-hidden="true"></g></svg>`;
}

/** Horizontal instrument: filled share with an optional threshold tick. */
export function meter({ value, max = 1, threshold = null, tick = '', color = 'var(--k-code)' }) {
  const p = Math.max(0, Math.min(1, max ? value / max : 0));
  const t = threshold == null ? null : Math.max(0, Math.min(1, threshold / max));
  return `<div class="meter" aria-hidden="true"><span class="meter-fill" style="width:${(p * 100).toFixed(1)}%;background:${color}"></span>${t == null ? '' : `<span class="meter-tick" style="left:${(t * 100).toFixed(1)}%"><b>${esc(tick)}</b></span>`}</div>`;
}

/** Segmented share bar with a marker (e.g. the 50% line). items: [{ value, color }] as fractions of 1. */
export function stackMeter(items, { mark = 0.5, tick = '' } = {}) {
  return `<div class="meter" aria-hidden="true"><div class="meter-segs">${items.map((it) => `<span style="width:${(it.value * 100).toFixed(2)}%;background:${it.color}"></span>`).join('')}</div><span class="meter-tick" style="left:${(mark * 100).toFixed(1)}%"><b>${esc(tick)}</b></span></div>`;
}

/** One cell per slot (e.g. Top-N hotspot ranks), lit where the predicate holds. */
export function dots(n, lit) {
  return `<div class="dots" style="--cols:${n > 20 ? Math.ceil(n / 2) : n}" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i${lit.has(i + 1) ? ' class="on"' : ''}></i>`).join('')}</div>`;
}

/** Tiny bars, last `hi` of them emphasised. */
export function miniBars(values, { hi = 3, color = 'var(--k-review)' } = {}) {
  const max = Math.max(1, ...values);
  return `<div class="mini-bars" aria-hidden="true">${values.map((v, i) => `<i style="height:${Math.max(6, (100 * v) / max).toFixed(0)}%;${i >= values.length - hi ? `background:${color}` : ''}"></i>`).join('')}</div>`;
}
