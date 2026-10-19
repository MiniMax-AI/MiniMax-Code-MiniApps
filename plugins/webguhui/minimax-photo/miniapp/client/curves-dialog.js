import { canvas } from './model.js';
import { curveLUT, applyCurves } from './tone.js';
const inputs = [0, 64, 128, 192, 255];
const identity = () => inputs.map((x) => [x, x]);
export function showCurvesDialog(source, { modal, applyFilter, initialCurves, description }) {
  const curves = Object.fromEntries(
    ['rgb', 'red', 'green', 'blue'].map((key) => [
      key,
      structuredClone(initialCurves?.[key] || identity()),
    ]),
  );
  const channel = document.createElement('select');
  channel.setAttribute('aria-label', '曲线通道');
  for (const [value, label] of [
    ['rgb', 'RGB 总通道'],
    ['red', '红色'],
    ['green', '绿色'],
    ['blue', '蓝色'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    channel.append(option);
  }
  const graph = canvas(320, 200);
  graph.setAttribute('aria-label', '曲线图：横轴输入亮度，纵轴输出亮度');
  graph.style.width = '100%';
  graph.style.height = '160px';
  const preview = canvas(
    Math.max(1, Math.round(source.width * Math.min(1, 360 / source.width, 220 / source.height))),
    Math.max(1, Math.round(source.height * Math.min(1, 360 / source.width, 220 / source.height))),
  );
  preview.style.maxWidth = '100%';
  preview.style.margin = 'auto';
  preview.style.background = '#aaa';
  preview.setAttribute('aria-label', '当前图层曲线预览');
  const ctx = preview.getContext('2d');
  ctx.drawImage(source, 0, 0, preview.width, preview.height);
  const original = ctx.getImageData(0, 0, preview.width, preview.height);
  const rows = document.createElement('div');
  rows.className = 'curve-controls';
  function redraw() {
    const lut = curveLUT(curves[channel.value]),
      g = graph.getContext('2d'),
      width = graph.width,
      height = graph.height;
    g.fillStyle = '#191b1e';
    g.fillRect(0, 0, width, height);
    g.strokeStyle = '#42464d';
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      g.beginPath();
      g.moveTo((i * width) / 4, 0);
      g.lineTo((i * width) / 4, height);
      g.moveTo(0, (i * height) / 4);
      g.lineTo(width, (i * height) / 4);
      g.stroke();
    }
    g.strokeStyle = '#767c86';
    g.beginPath();
    g.moveTo(0, height);
    g.lineTo(width, 0);
    g.stroke();
    g.strokeStyle = { rgb: '#dce7ef', red: '#ef9292', green: '#8dce9b', blue: '#8daef0' }[
      channel.value
    ];
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * width,
        y = height - (lut[i] / 255) * height;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    for (const [x, y] of curves[channel.value]) {
      g.fillStyle = g.strokeStyle;
      g.beginPath();
      g.arc((x / 255) * width, height - (y / 255) * height, 4, 0, Math.PI * 2);
      g.fill();
    }
    ctx.putImageData(
      new ImageData(applyCurves(original.data, curves), original.width, original.height),
      0,
      0,
    );
  }
  function controls() {
    rows.replaceChildren();
    curves[channel.value].forEach(([x, y], i) => {
      const label = document.createElement('label');
      label.textContent = `输入 ${x} → 输出`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '255';
      input.value = y;
      input.setAttribute('aria-label', `输入 ${x} 的输出`);
      const output = document.createElement('output');
      output.textContent = y;
      input.oninput = () => {
        curves[channel.value][i][1] = Number(input.value);
        output.textContent = input.value;
        redraw();
      };
      label.append(input, output);
      rows.append(label);
    });
    redraw();
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '重置当前通道';
  reset.onclick = () => {
    curves[channel.value] = identity();
    controls();
  };
  channel.onchange = controls;
  const note = document.createElement('p');
  note.textContent = description || '预览只显示当前图层。应用时尊重选区；可撤销。';
  modal(
    '曲线',
    [channel, graph, rows, reset, preview, note],
    () => applyFilter('curves', { curves }, '曲线'),
    '应用',
  );
  controls();
}
