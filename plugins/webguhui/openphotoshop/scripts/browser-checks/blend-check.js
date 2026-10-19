import { blends } from './model.js';
import { blendPixel, pixelBlendModes } from './blending.js';
const colors = [
  [0, 0, 0],
  [255, 255, 255],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [128, 128, 128],
  [20, 80, 230],
  [240, 90, 10],
  [64, 1, 254],
  [1, 254, 64],
  [17, 188, 120],
  [230, 190, 51],
];
document.querySelector('#run').onclick = () => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }),
    modes = [];
  const computed = new Float64Array(3);
  for (const mode of blends.filter((mode) => !pixelBlendModes.includes(mode))) {
    let maxError = 0;
    for (let i = 0; i < colors.length; i++) {
      const b = colors[i],
        s = colors[(i * 5 + 3) % colors.length];
      ctx.globalCompositeOperation = 'copy';
      ctx.fillStyle = `rgb(${b})`;
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalCompositeOperation = mode;
      ctx.fillStyle = `rgb(${s})`;
      ctx.fillRect(0, 0, 1, 1);
      const expected = ctx.getImageData(0, 0, 1, 1).data;
      blendPixel(mode, b, s, 0, computed);
      for (let c = 0; c < 3; c++)
        maxError = Math.max(maxError, Math.abs(Math.round(computed[c]) - expected[c]));
    }
    modes.push({ mode, maxError, pass: maxError <= 2 });
  }
  document.querySelector('#result').textContent = JSON.stringify(
    {
      cases: modes.length * colors.length,
      allPassed: modes.every((m) => m.pass),
      modes,
      note: '不透明 RGB 混合与当前浏览器 Canvas 的对照，不是 Photoshop 或原站文件兼容性证明',
    },
    null,
    2,
  );
};
