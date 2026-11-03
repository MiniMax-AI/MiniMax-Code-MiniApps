// K 线渲染：蜡烛 + MA + 成交量 + 十字光标 OHLC 浮窗
// 颜色全部来自 CSS 变量，切换主题后重绘即跟随。

const cssVar = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

/** 单位 -> 小数位，与 Node 侧 metrics.mjs 的 UNITS 保持一致 */
const DEC = { pct: 1, load: 2, gib: 2, mib: 0, mbs: 2, kbs: 1, ps: 0, cnt: 0, hrs: 1 };
export const decimalsOf = (unit) => DEC[unit] ?? 1;

function palette(root) {
  return {
    up: cssVar(root, '--up'),
    down: cssVar(root, '--down'),
    accent: cssVar(root, '--accent'),
    line: cssVar(root, '--line'),
    mute: cssVar(root, '--mute'),
    dim: cssVar(root, '--dim'),
    fg: cssVar(root, '--fg'),
    sunk: cssVar(root, '--sunk'),
    panel: cssVar(root, '--panel'),
    memA: cssVar(root, '--mem-a'),
    memW: cssVar(root, '--mem-w'),
    memC: cssVar(root, '--mem-c'),
  };
}

function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, W: r.width, H: r.height };
}

/** 内存三段的兜底显示名。服务端按平台下发真实名称，这份只在首帧到达前顶一下 */
const DEFAULT_SEGS = [
  { name: '活动页', short: '活' },
  { name: '联动页', short: '联' },
  { name: '压缩页', short: '压' },
];

/** 一根柱子的已用内存（GiB）：三段之和 */
const memUsed = (m) => (m ? (m.a ?? 0) + (m.w ?? 0) + (m.c ?? 0) : 0);

/** 浮窗里的内存三段明细 */
const memText = (m) => {
  if (!m || memUsed(m) === 0) return '—';
  const f = (x) => (x ?? 0).toFixed(1);
  return `${f(m.a)}/${f(m.w)}/${f(m.c)}`;
};

const fmtTime = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
};

export class Chart {
  constructor(canvas, emptyEl) {
    this.cv = canvas;
    this.emptyEl = emptyEl;
    this.data = null;
    this.meta = null;
    this.cursorX = null;
    this.segs = () => (this.data?.memSegments?.length === 3 ? this.data.memSegments : DEFAULT_SEGS);
    this.onMove = (e) => {
      const r = this.cv.getBoundingClientRect();
      this.cursorX = e.clientX - r.left;
      this.paint();
    };
    this.onLeave = () => { this.cursorX = null; this.paint(); };
    canvas.addEventListener('mousemove', this.onMove);
    canvas.addEventListener('mouseleave', this.onLeave);
  }

  destroy() {
    this.cv.removeEventListener('mousemove', this.onMove);
    this.cv.removeEventListener('mouseleave', this.onLeave);
  }

  render(data, meta) {
    this.data = data;
    this.meta = meta ?? data?.meta ?? null;
    this.paint();
  }

  paint() {
    const cv = this.cv;
    const root = document.documentElement;
    const pal = palette(root);
    const fit = fitCanvas(cv);
    if (!fit) return;
    const { g, W, H } = fit;
    g.clearRect(0, 0, W, H);

    const bars = this.data?.bars ?? [];
    if (bars.length < 2) {
      if (this.emptyEl) this.emptyEl.hidden = false;
      return;
    }
    if (this.emptyEl) this.emptyEl.hidden = true;

    const ma5 = this.data.ma5 ?? [];
    const ma10 = this.data.ma10 ?? [];
    const ma20 = this.data.ma20 ?? [];
    const dec = this.meta?.decimals ?? decimalsOf(this.meta?.unit);

    const PL = 8, PR = 56, PT = 10, PB = 20;
    const memH = Math.max(30, H * 0.17);
    const priceH = H - PT - memH - PB - 8;
    const plotW = W - PL - PR;
    if (plotW < 40 || priceH < 40) return;

    let lo = Infinity, hi = -Infinity, memPeak = 0;
    for (const b of bars) {
      if (b.l < lo) lo = b.l;
      if (b.h > hi) hi = b.h;
      const u = memUsed(b.mem);
      if (u > memPeak) memPeak = u;
    }
    // 柱高按总内存归一化，柱子高度直接就是内存水位；拿不到总量时退回历史峰值
    const memTotal = Number(this.data.memTotalGiB) || 0;
    const memCap = memTotal > 0 ? memTotal : memPeak;
    for (const arr of [ma5, ma10, ma20]) {
      for (const v of arr) {
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;

    const Y = (v) => PT + priceH - ((v - lo) / (hi - lo)) * priceH;
    const bw = plotW / bars.length;
    const cw = Math.max(1.5, Math.min(10, bw * 0.66));

    // 网格与价格轴
    g.strokeStyle = pal.line;
    g.lineWidth = 1;
    g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    for (let i = 0; i <= 4; i += 1) {
      const y = Math.round(PT + (priceH / 4) * i) + 0.5;
      g.beginPath(); g.moveTo(PL, y); g.lineTo(PL + plotW, y); g.stroke();
      g.fillStyle = pal.mute;
      g.fillText((hi - ((hi - lo) / 4) * i).toFixed(dec), PL + plotW + 7, y);
    }

    const memTop = PT + priceH + 8;
    g.beginPath();
    g.moveTo(PL, Math.round(memTop) + 0.5);
    g.lineTo(PL + plotW, Math.round(memTop) + 0.5);
    g.stroke();

    // 蜡烛与事件带
    for (let i = 0; i < bars.length; i += 1) {
      const b = bars[i];
      const cx = PL + bw * i + bw / 2;
      const rise = b.c >= b.o;
      const col = rise ? pal.up : pal.down;
      g.strokeStyle = col;
      g.fillStyle = col;
      g.lineWidth = 1;
      const px = Math.round(cx) + 0.5;
      g.beginPath(); g.moveTo(px, Y(b.h)); g.lineTo(px, Y(b.l)); g.stroke();
      const yo = Y(b.o), yc = Y(b.c);
      const top = Math.min(yo, yc);
      const hgt = Math.max(1.1, Math.abs(yc - yo));
      g.fillRect(cx - cw / 2, top, cw, hgt);
      // 内存构成：三段自下而上堆叠，与 K 线共用 x 轴。段名由服务端按平台下发
      if (memCap > 0 && b.mem) {
        let base = memTop + memH;
        g.globalAlpha = 0.82;
        for (const [n, col] of [[b.mem.a, pal.memA], [b.mem.w, pal.memW], [b.mem.c, pal.memC]]) {
          if (!n) continue;
          const h = Math.min(memH, (n / memCap) * memH);
          g.fillStyle = col;
          g.fillRect(cx - cw / 2, base - h, cw, h);
          base -= h;
        }
        g.globalAlpha = 1;
      }
    }

    // 副图标签与图例：柱子从底部往上长，左上角这一带通常是空的
    g.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillStyle = pal.mute;
    g.fillText('内存构成', PL + 2, memTop + 3);
    const lastMem = memUsed(bars[bars.length - 1]?.mem);
    let lx = PL + 2 + g.measureText('内存构成').width + 9;
    const segs = this.segs();
    const segCols = [pal.memA, pal.memW, pal.memC];
    for (let i = 0; i < segs.length; i += 1) {
      const label = segs[i].short;
      g.fillStyle = segCols[i];
      g.fillRect(lx, memTop + 5, 5, 5);
      g.fillStyle = pal.mute;
      g.fillText(label, lx + 7, memTop + 3);
      lx += 7 + g.measureText(label).width + 8;
    }
    if (memCap > 0) {
      g.textAlign = 'right';
      g.fillStyle = pal.dim;
      const cap = memTotal > 0 ? ` / ${memTotal.toFixed(0)}G` : '';
      g.fillText(lastMem.toFixed(1) + 'G' + cap, PL + plotW - 2, memTop + 3);
      g.textAlign = 'left';
    }

    // 均线
    const strokeMA = (arr, col) => {
      g.strokeStyle = col;
      g.lineWidth = 1.3;
      g.lineJoin = 'round';
      g.beginPath();
      let started = false;
      for (let i = 0; i < arr.length; i += 1) {
        const v = arr[i];
        if (v == null) { started = false; continue; }
        const x = PL + bw * i + bw / 2;
        const y = Y(v);
        if (started) g.lineTo(x, y); else { g.moveTo(x, y); started = true; }
      }
      g.stroke();
    };
    strokeMA(ma5, '#ffb020');
    strokeMA(ma10, '#4d9fff');
    strokeMA(ma20, '#b07cff');

    // 最新价横线
    const last = bars[bars.length - 1];
    const ly = Y(last.c);
    const lc = last.c >= last.o ? pal.up : pal.down;
    g.save();
    g.setLineDash([3, 3]);
    g.strokeStyle = lc;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(PL, Math.round(ly) + 0.5); g.lineTo(PL + plotW, Math.round(ly) + 0.5); g.stroke();
    g.restore();
    g.fillStyle = lc;
    g.fillRect(PL + plotW + 3, ly - 8, PR - 6, 16);
    g.fillStyle = '#fff';
    g.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillText(last.c.toFixed(dec), PL + plotW + 8, ly);

    // 时间轴
    g.fillStyle = pal.mute;
    g.font = '9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textBaseline = 'top';
    // 标签数跟着柱子数走：固定 4 个会在柱子少于 4 根时把同一个 idx 画两遍，文字错位叠在一起
    const ticks = Math.min(4, bars.length);
    for (let i = 0; i < ticks; i += 1) {
      const idx = ticks === 1 ? 0 : Math.round((bars.length - 1) * (i / (ticks - 1)));
      const x = PL + bw * idx + bw / 2;
      g.textAlign = i === 0 ? 'left' : i === ticks - 1 ? 'right' : 'center';
      g.fillText(fmtTime(bars[idx].t).slice(0, 5), Math.min(Math.max(x, PL), PL + plotW), memTop + memH + 5);
    }
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';

    // 十字光标
    if (this.cursorX != null && this.cursorX > PL && this.cursorX < PL + plotW) {
      let idx = Math.floor((this.cursorX - PL) / bw);
      idx = Math.max(0, Math.min(bars.length - 1, idx));
      const b = bars[idx];
      const cx = PL + bw * idx + bw / 2;
      g.save();
      g.setLineDash([2, 3]);
      g.strokeStyle = pal.mute;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(cx) + 0.5, PT); g.lineTo(Math.round(cx) + 0.5, memTop + memH); g.stroke();
      const cy = Y(b.c);
      g.beginPath(); g.moveTo(PL, Math.round(cy) + 0.5); g.lineTo(PL + plotW, Math.round(cy) + 0.5); g.stroke();
      g.restore();
      this.drawTip(g, b, idx, cx, cy, pal, PL, PT, plotW, W, H, dec, ma5);
    }
  }

  drawTip(g, b, idx, cx, cy, pal, PL, PT, plotW, W, H, dec, ma5) {
    const prev = idx > 0 ? this.barsPrev(idx) : b.o;
    const chg = b.c - prev;
    const rise = chg >= 0;
    const rows = [
      ['时间', fmtTime(b.t), null],
      ['开', b.o.toFixed(dec), null],
      ['高', b.h.toFixed(dec), null],
      ['低', b.l.toFixed(dec), null],
      ['收', b.c.toFixed(dec), null],
      ['涨跌', (chg >= 0 ? '+' : '') + chg.toFixed(dec), rise ? pal.up : pal.down],
      ['MA5', ma5[idx] == null ? '—' : ma5[idx].toFixed(dec), null],
      ['内存', memUsed(b.mem) > 0 ? memUsed(b.mem).toFixed(1) + 'G' : '—', null],
      [this.segs().map((s) => s.short).join('/'), memText(b.mem), null],
    ];
    const bw = 138;
    const bh = rows.length * 15 + 12;
    let bx = cx + 13;
    if (bx + bw > PL + plotW) bx = cx - bw - 13;
    bx = Math.max(PL + 2, Math.min(bx, W - bw - 2));
    const by = Math.max(PT + 2, Math.min(cy - 46, H - bh - 6));

    g.fillStyle = pal.sunk;
    g.globalAlpha = 0.97;
    g.beginPath(); g.roundRect(bx, by, bw, bh, 7); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = pal.line;
    g.lineWidth = 1;
    g.stroke();

    g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textBaseline = 'middle';
    rows.forEach((r, k) => {
      const y = by + 12 + k * 15;
      g.fillStyle = pal.mute;
      g.textAlign = 'left';
      g.fillText(r[0], bx + 9, y);
      g.fillStyle = r[2] ?? pal.fg;
      g.textAlign = 'right';
      g.fillText(r[1], bx + bw - 9, y);
    });
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
  }

  barsPrev(idx) {
    const bars = this.data?.bars ?? [];
    return idx > 0 ? bars[idx - 1].c : bars[0].o;
  }
}

/** 迷你走势线：指数条与进程行共用 */
export function drawSpark(canvas, values, up) {
  const root = document.documentElement;
  const pal = palette(root);
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { g, W, H } = fit;
  g.clearRect(0, 0, W, H);
  if (!values || values.length < 2) return;

  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return;
  if (hi === lo) { hi += 1; lo -= 1; }

  const P = 2;
  const col = up ? pal.up : pal.down;
  const x = (i) => P + (W - P * 2) * (i / (values.length - 1));
  const y = (v) => P + (H - P * 2) * (1 - (v - lo) / (hi - lo));

  g.strokeStyle = col;
  g.lineWidth = 1.3;
  g.lineJoin = 'round';
  g.beginPath();
  let started = false;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) { started = false; continue; }
    if (started) g.lineTo(x(i), y(v)); else { g.moveTo(x(i), y(v)); started = true; }
  }
  g.stroke();

  if (started) {
    g.lineTo(W - P, H);
    g.lineTo(P, H);
    g.closePath();
    g.globalAlpha = 0.13;
    g.fillStyle = col;
    g.fill();
    g.globalAlpha = 1;
  }
}
