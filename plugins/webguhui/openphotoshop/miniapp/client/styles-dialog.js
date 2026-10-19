import { canvas, layerImage, LIMIT_PIXELS } from './model.js';
import { field, note } from './dialogs.js';
import { normalizeStyles, renderStyles, stylePadding, styleNames } from './layer-styles.js';

export function showStylesDialog(layer, { modal, apply }) {
  const styles = normalizeStyles(layer.styles);
  const source = layerImage(layer);
  const scale = Math.min(1, 360 / source.width, 200 / source.height);
  const thumb = canvas(
    Math.max(1, Math.round(source.width * scale)),
    Math.max(1, Math.round(source.height * scale)),
  );
  thumb.getContext('2d').drawImage(source, 0, 0, thumb.width, thumb.height);
  const preview = canvas(420, 260);
  preview.setAttribute('aria-label', '图层样式预览');
  preview.style.maxWidth = '100%';
  preview.style.background = '#3c4148';
  const tabs = document.createElement('select');
  tabs.setAttribute('aria-label', '样式类型');
  for (const [value, label] of Object.entries(styleNames)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    tabs.append(option);
  }
  const controls = document.createElement('div');
  let raf = 0;
  function draw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const small = structuredClone(styles);
      for (const key of Object.keys(small))
        for (const prop of ['blur', 'x', 'y', 'size', 'distance'])
          if (prop in small[key]) small[key][prop] *= scale;
      const result = renderStyles(thumb, small, canvas);
      const ctx = preview.getContext('2d');
      ctx.clearRect(0, 0, preview.width, preview.height);
      const fit = Math.min(
        1,
        preview.width / result.image.width,
        preview.height / result.image.height,
      );
      ctx.drawImage(
        result.image,
        (preview.width - result.image.width * fit) / 2,
        (preview.height - result.image.height * fit) / 2,
        result.image.width * fit,
        result.image.height * fit,
      );
    });
  }
  function fields() {
    const effect = styles[tabs.value];
    const enabledLabel = document.createElement('label'),
      enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = effect.enabled;
    enabledLabel.append(enabled, '启用此样式');
    enabled.onchange = () => {
      effect.enabled = enabled.checked;
      draw();
    };
    controls.replaceChildren(enabledLabel);
    for (const [prop, label, type, attrs] of [
      ['color', '颜色', 'color', {}],
      ['endColor', '结束颜色', 'color', {}],
      ['opacity', '样式不透明度', 'range', { min: 0, max: 1, step: 0.01 }],
      ['blur', '模糊半径', 'range', { min: 0, max: 60, step: 1 }],
      ['x', '水平偏移', 'range', { min: -100, max: 100, step: 1 }],
      ['y', '垂直偏移', 'range', { min: -100, max: 100, step: 1 }],
      ['angle', '角度', 'range', { min: -180, max: 180, step: 1 }],
      ['size', '大小', 'range', { min: 1, max: 60, step: 1 }],
      ['depth', '深度', 'range', { min: 0.1, max: 10, step: 0.1 }],
      ['elevation', '光源高度', 'range', { min: 1, max: 89, step: 1 }],
      ['distance', '距离', 'range', { min: 0, max: 100, step: 1 }],
    ]) {
      if (!(prop in effect)) continue;
      const [row, input] = field(label, effect[prop], type, attrs);
      const output = document.createElement('output');
      output.textContent = effect[prop];
      row.append(output);
      input.oninput = () => {
        effect[prop] = type === 'color' ? input.value : Number(input.value);
        output.textContent = input.value;
        draw();
      };
      controls.append(row);
    }
    for (const [prop, label, options] of [
      [
        'position',
        '描边位置',
        [
          ['outside', '外侧'],
          ['inside', '内侧'],
          ['center', '居中'],
        ],
      ],
      [
        'pattern',
        '图案',
        [
          ['checker', '棋盘'],
          ['dots', '圆点'],
          ['stripes', '条纹'],
        ],
      ],
    ]) {
      if (!(prop in effect)) continue;
      const row = document.createElement('label');
      row.textContent = label;
      const select = document.createElement('select');
      for (const [value, text] of options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.append(option);
      }
      select.value = effect[prop];
      select.onchange = () => {
        effect[prop] = select.value;
        draw();
      };
      row.append(select);
      controls.append(row);
    }
    draw();
  }
  tabs.onchange = fields;
  modal(
    '图层样式',
    [
      tabs,
      controls,
      preview,
      note('样式不改变原始像素，可随时重新编辑。工程保留参数；导出 PSD 时转换为像素。'),
    ],
    () => {
      const normalized = normalizeStyles(styles),
        padding = stylePadding(normalized);
      if ((source.width + 2 * padding) * (source.height + 2 * padding) > LIMIT_PIXELS)
        throw Error('样式扩展后的图层超过 3200 万像素，请缩小图片或减小投影、发光范围');
      return apply(normalized);
    },
    '应用',
  );
  fields();
}
