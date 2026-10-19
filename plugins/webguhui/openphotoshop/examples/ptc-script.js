// Submit this file's text as editor_run_code.code. Top-level return is supported.
const before = await editor.inspect();
await editor.create({ name: 'PTC · 读图后决定怎么画', width: 960, height: 640 });
await editor.edit([{ op: 'fill', color: '#142033' }]);
const sample = await editor.preview({ points: [[10, 10]] });
const [r, g, b] = sample.result.pixels[0].rgba;
const dark = (r + g + b) / 3 < 128;
const foreground = dark ? '#ffffff' : '#142033';
for (let i = 0; i < 3; i++) {
  await editor.edit([
    { op: 'add_layer', name: `步骤 ${i + 1}`, as: 'card' },
    {
      op: 'shape',
      layerId: '$card',
      kind: 'rect',
      x: 60 + i * 290,
      y: 250,
      width: 260,
      height: 190,
      color: ['#246b8e', '#306e66', '#735387'][i],
    },
    {
      op: 'text',
      value: ['读取像素', '判断明暗', '循环绘制'][i],
      x: 80 + i * 290,
      y: 330,
      size: 32,
      color: foreground,
    },
  ]);
}
await editor.edit([
  { op: 'text', value: 'AI 用代码完成编辑', x: 60, y: 115, size: 52, color: foreground },
  {
    op: 'text',
    value: '一次提交，读取真实结果，再决定下一步。',
    x: 60,
    y: 175,
    size: 26,
    color: '#a7bacd',
  },
  {
    op: 'text',
    value: `检测到${dark ? '深色' : '浅色'}背景，自动选择${dark ? '白色' : '深色'}文字`,
    x: 60,
    y: 535,
    size: 25,
    color: '#a7bacd',
  },
]);
const output = await editor.export();
return {
  sampledRGBA: sample.result.pixels[0].rgba,
  dark,
  layers: output.result.layers.length,
  exportPath: output.exportPath,
  originalDocumentId: before.document?.id,
};
