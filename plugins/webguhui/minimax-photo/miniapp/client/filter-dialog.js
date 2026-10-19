import { canvas } from './model.js';
import { field, note } from './dialogs.js';

export function showFilterDialog(source, item, { modal, runFilter, applyFilter, description }) {
  const [type, label, initial, min, max] = item;
  const [row, input] = field(label, initial, 'range', { min, max, step: 1 });
  row.hidden = min === 0 && max === 1;
  const output = document.createElement('output');
  output.textContent = initial;
  row.append(output);
  const ratio = Math.min(1, 400 / source.width, 240 / source.height);
  const preview = canvas(
    Math.max(1, Math.round(source.width * ratio)),
    Math.max(1, Math.round(source.height * ratio)),
  );
  preview.setAttribute('aria-label', `${label}效果预览`);
  preview.style.maxWidth = '100%';
  preview.style.margin = 'auto';
  preview.style.background = 'var(--mcode-bg-secondary)';
  const ctx = preview.getContext('2d');
  ctx.drawImage(source, 0, 0, preview.width, preview.height);
  const original = ctx.getImageData(0, 0, preview.width, preview.height);
  const feedback = document.createElement('p');
  feedback.setAttribute('role', 'status');
  const compareLabel = document.createElement('label');
  const compare = document.createElement('input');
  compare.type = 'checkbox';
  compareLabel.append(compare, '显示原图');
  let requested = 0,
    running = false,
    result = original;
  function paint() {
    ctx.putImageData(compare.checked ? original : result, 0, 0);
  }
  async function update() {
    requested++;
    if (running) return;
    running = true;
    try {
      while (preview.isConnected) {
        const version = requested;
        feedback.textContent = '正在更新预览…';
        let value = Number(input.value);
        // Blur radii are measured in source pixels; account for the smaller preview.
        if (['blur', 'gaussian', 'halftone', 'diffuse', 'oilPaint'].includes(type)) value *= ratio;
        const pixels = await runFilter(
          original.data.slice(),
          original.width,
          original.height,
          type,
          value,
        );
        if (!preview.isConnected) break;
        if (version !== requested) continue;
        result = new ImageData(pixels, original.width, original.height);
        paint();
        feedback.textContent = '预览已更新';
        break;
      }
    } catch (error) {
      if (preview.isConnected) feedback.textContent = `预览失败：${error.message}`;
    } finally {
      running = false;
    }
  }
  input.oninput = () => {
    output.textContent = input.value;
    void update();
  };
  compare.onchange = paint;
  modal(
    label,
    [
      row,
      compareLabel,
      preview,
      feedback,
      note(
        description || '缩略图仅预览当前图层，细节以应用结果为准。应用时仅修改选区内像素，可撤销。',
      ),
    ],
    () => applyFilter(type, Number(input.value), label),
    '应用',
  );
  void update();
}
