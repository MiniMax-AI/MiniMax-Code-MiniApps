import { documentModel, layer, blends, composite } from './model.js';
import { readPSD, writePSD } from './codecs.js';
document.querySelector('#run').onclick = async () => {
  const results = [];
  for (const mode of blends) {
    try {
      const d = documentModel(8, 8, '混合测试');
      const base = layer(8, 8, '背景'),
        top = layer(4, 4, '中文前景');
      base.canvas.getContext('2d').fillStyle = '#6496c8';
      base.canvas.getContext('2d').fillRect(0, 0, 8, 8);
      const ctx = top.canvas.getContext('2d');
      ctx.fillStyle = '#3264c8';
      ctx.fillRect(0, 0, 4, 4);
      ctx.clearRect(0, 0, 1, 1);
      top.x = 2;
      top.y = 3;
      top.opacity = 0.6;
      top.blend = mode;
      d.layers = [base, top];
      const restored = readPSD(await writePSD(d).arrayBuffer(), '往返');
      const pixels = (doc) => composite(doc).getContext('2d').getImageData(0, 0, 8, 8).data;
      const a = pixels(d),
        b = pixels(restored);
      let maxError = 0;
      for (let i = 0; i < a.length; i++) maxError = Math.max(maxError, Math.abs(a[i] - b[i]));
      const l = restored.layers[1];
      const pass =
        restored.layers.length === 2 &&
        l.blend === mode &&
        l.x === 2 &&
        l.y === 3 &&
        l.name === '中文前景' &&
        l.opacity === 0.6 &&
        maxError === 0;
      results.push({ mode, pass, maxError, layers: restored.layers.length });
    } catch (error) {
      results.push({ mode, pass: false, error: error.message });
    }
  }
  document.querySelector('#result').textContent = JSON.stringify(
    { allPassed: results.every((r) => r.pass), results },
    null,
    2,
  );
};
