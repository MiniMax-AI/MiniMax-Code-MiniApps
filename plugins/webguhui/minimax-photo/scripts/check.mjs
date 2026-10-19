import { createEditorService } from '../miniapp/node/editor-service.mjs';
import { EventEmitter } from 'node:events';
import { colorReplacementPatch } from '../miniapp/client/color-replace.js';
import { validatePNG } from '../miniapp/node/png-validation.mjs';
import { backgroundEraseMask } from '../miniapp/client/background-eraser.js';
import { runOutline } from '../miniapp/client/selection-outline.js';
import { floodRegion } from '../miniapp/client/flood-region.js';
import { unpackLZW } from '../miniapp/client/tiff-lzw.js';
import { readTIFF } from '../miniapp/client/tiff-reader.js';
import { writeTIFF } from '../miniapp/client/tiff.js';
import { compositePixels, blendPixel, pixelBlendModes } from '../miniapp/client/blending.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { start } from '../miniapp/node/server.mjs';
import { curveLUT } from '../miniapp/client/tone.js';
import { filterPixels } from '../miniapp/client/filters.js';
import { distanceMap, strokePixels, bevelPixels } from '../miniapp/client/style-pixels.js';
import { normalizeStyles } from '../miniapp/client/layer-styles.js';
import { createRenderCache } from '../miniapp/client/render-cache.js';
import {
  adjustedPixels,
  normalizeAdjustment,
  compositionGroups,
  clippingBase,
} from '../miniapp/client/adjustment-layers.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const results = [];
const check = async (name, fn) => {
  await fn();
  results.push({ name, status: 'PASS' });
  console.log('PASS', name);
};
await check('Artistic filters: alpha, identity colors, contours and stable diffusion', () => {
  const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 80, 255, 255, 255, 0]);
  assert.deepEqual(filterPixels(white, 3, 1, 'halftone', 3), white);
  const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 80, 0, 0, 0, 0]);
  assert.deepEqual(filterPixels(black, 3, 1, 'halftone', 3), black);
  const ramp = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 80, 200, 200, 200, 255]);
  const contour = filterPixels(ramp, 3, 1, 'traceContour', 128);
  assert.deepEqual([...contour], [255, 255, 255, 255, 0, 0, 0, 80, 0, 0, 0, 255]);
  for (const type of ['halftone', 'diffuse', 'traceContour', 'glowingEdges']) {
    const result = filterPixels(ramp, 3, 1, type, 3);
    assert.deepEqual([result[3], result[7], result[11]], [255, 80, 255]);
  }
  assert.deepEqual(filterPixels(ramp, 3, 1, 'diffuse', 2), filterPixels(ramp, 3, 1, 'diffuse', 2));
  assert.deepEqual([...ramp], [0, 0, 0, 255, 100, 100, 100, 80, 200, 200, 200, 255]);
  const flat = new Uint8ClampedArray(5 * 5 * 4).fill(255);
  assert.deepEqual(filterPixels(flat, 5, 5, 'oilPaint', 2), flat);
  const isolated = new Uint8ClampedArray(flat);
  isolated.set([255, 0, 0, 80], 48);
  const painted = filterPixels(isolated, 5, 5, 'oilPaint', 1);
  assert.deepEqual([...painted.slice(48, 52)], [255, 255, 255, 80]);
  assert.deepEqual([...isolated.slice(48, 52)], [255, 0, 0, 80]);
  const edges = filterPixels(flat, 5, 5, 'glowingEdges', 2);
  assert.equal(edges[0], 0);
  assert.equal(edges[3], 255);
});
await check('Agent 编辑事务：归属、并发、重复、持久化与中断', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retouch-editor-check-'));
  const service = await createEditorService(dir),
    request = new EventEmitter();
  const editorId = randomUUID(),
    documentId = randomUUID();
  const response = {
    writeHead() {},
    write() {},
    end() {
      request.emit('close');
    },
  };
  try {
    service.register({ editorId, version: 'v1', document: { id: documentId } });
    service.subscribe(editorId, request, response);
    assert.deepEqual(service.inspect(editorId).page, { visibility: 'unknown', focused: null });
    const input = { editorId, expectedVersion: 'v1', requestId: randomUUID(), kind: 'preview' };
    await assert.rejects(
      service.submit({ ...input, requestId: randomUUID(), expectedVersion: 'stale' }),
      /版本/,
    );
    // Invalid export options fail before creating a task or touching the canvas.
    for (const args of [{format: 'png', path: '/tmp/ignored.png'}, {outputPath: '/tmp/ignored.png'}, {format: 'invalid'}]) {
      const requestId = randomUUID();
      await assert.rejects(service.submit({...input, requestId, kind: 'craft', options: {method: 'export', args}}), /export|导出格式/);
      await assert.rejects(service.result(requestId), {code: 'ENOENT'});
    }
    const jobs = await Promise.all([service.submit(input), service.submit(input)]);
    assert.equal(jobs[0].jobId, jobs[1].jobId);
    await assert.rejects(
      service.submit({ ...input, kind: 'batch', operations: [{ op: 'undo' }] }),
      /不同请求/,
    );
    const claimed = await service.claim(editorId, input.requestId);
    service.register({ editorId, version: 'stale', document: null,
      page: { visibility: 'hidden', focused: false, sessionId: 'untrusted' } });
    assert.deepEqual(service.list()[0].page, { visibility: 'hidden', focused: false });
    assert.equal(service.inspect(editorId).version, 'v1');
    assert.deepEqual(service.inspect(editorId).document, { id: documentId });
    await assert.rejects(service.claim(editorId, input.requestId), /重复/);
    await assert.rejects(
      service.finish(editorId, input.requestId, { claim: randomUUID(), error: 'bad' }),
      /归属/,
    );
    const preview =
      'data:image/png;base64,' + (await readFile(join(root, 'icon.png'))).toString('base64');
    const prepared = await service.finish(editorId, input.requestId, {
      claim: claimed.claim,
      preview,
      result: { id: documentId },
    });
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.claim, undefined);
    await service.acknowledge(editorId, input.requestId, { claim: claimed.claim, version: 'v2' });
    assert.equal(service.inspect(editorId).version, 'v2');
    const restored = await createEditorService(dir);
    assert.equal((await restored.result(input.requestId)).status, 'succeeded');
    assert.deepEqual(
      await readFile((await restored.result(input.requestId)).previewPath),
      await readFile(join(root, 'icon.png')),
    );
    restored.close();
    const pending = await service.submit({
      ...input,
      requestId: randomUUID(),
      expectedVersion: 'v2',
    });
    request.emit('close');
    assert.equal((await service.result(pending.jobId)).status, 'interrupted');
    assert.equal(service.list().length, 0);
    const craftEditorId = randomUUID();
    service.register({editorId: craftEditorId, version: 'v3', engine: 'photocraft', document: {id: documentId}});
    service.subscribe(craftEditorId, request, response);
    const validExport = await service.submit({...input, editorId: craftEditorId, requestId: randomUUID(), expectedVersion: 'v3', kind: 'craft', options: {method: 'export', args: {format: 'png'}}});
    assert.equal(validExport.status, 'queued');
    assert.deepEqual(validExport.options.args, {format: 'png'});
    request.emit('close');

  } finally {
    service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
await check('Mini App manifest 与 payload 文件', async () => {
  const p = JSON.parse(await readFile(join(root, 'package.json'))),
    plugin = JSON.parse(await readFile(join(root, '.minimax-plugin/plugin.json'))),
    app = JSON.parse(await readFile(join(root, 'miniapp/miniapp.json')));
  assert.equal(p.mcode.schemaVersion, 2);
  assert.equal(plugin.name, 'minimax-photo');
  assert.equal(app.runtime.kind, 'process');
  for (const path of [
    ...app.artifacts.client,
    ...app.artifacts.node,
    app.runtime.entry,
    plugin.icon,
  ])
    assert((await stat(join(root, path))).isFile() || (await stat(join(root, path))).isDirectory());
});
await check('扩展混合模式：色值、透明覆盖、强度与零除边界', () => {
  const b = new Uint8ClampedArray([100, 150, 200, 255]);
  const s = new Uint8ClampedArray([50, 100, 200, 255]);
  const expected = [
    [50, 100, 200, 255],
    [0, 0, 145, 255],
    [150, 250, 255, 255],
    [50, 50, 0, 255],
    [255, 255, 255, 255],
    [0, 121, 255, 255],
    [0, 95, 255, 255],
    [100, 150, 200, 255],
    [0, 0, 255, 255],
    [50, 100, 200, 255],
    [100, 150, 200, 255],
  ];
  pixelBlendModes.forEach((mode, i) => {
    assert.deepEqual([...compositePixels(b, s, mode)], expected[i]);
    assert.deepEqual(compositePixels(b, s, mode, 0), b);
    assert.deepEqual(compositePixels(new Uint8ClampedArray(4), s, mode), s);
    assert.deepEqual(compositePixels(b, new Uint8ClampedArray(4), mode), b);
  });
  // A channel-wise darken operation would produce [10, 20, 20], which is incorrect here.
  assert.deepEqual(
    [
      ...compositePixels(
        new Uint8ClampedArray([10, 240, 10, 255]),
        new Uint8ClampedArray([200, 20, 20, 255]),
        'darker-color',
      ),
    ],
    [200, 20, 20, 255],
  );
  const half = compositePixels(
    new Uint8ClampedArray([100, 100, 100, 128]),
    new Uint8ClampedArray([50, 50, 50, 128]),
    'subtract',
  );
  assert.deepEqual([...half], [67, 67, 67, 192]);
  const out = new Float64Array(3);
  blendPixel('divide', [0, 0, 0], [0, 0, 0], 0, out);
  assert.deepEqual([...out], [255, 255, 255]);
});
await check('溶解：稳定颗粒、透明底、覆盖比例与调整层蒙版', () => {
  const source = new Uint8ClampedArray(64 * 64 * 4).fill(255);
  const empty = new Uint8ClampedArray(source.length);
  const full = compositePixels(empty, source, 'dissolve', 1, 64);
  assert.deepEqual(full, source);
  const half = compositePixels(empty, source, 'dissolve', 0.5, 64);
  assert.deepEqual(half, compositePixels(empty, source, 'dissolve', 0.5, 64));
  let count = 0;
  for (let i = 3; i < half.length; i += 4) {
    assert([0, 255].includes(half[i]));
    count += half[i] === 255;
  }
  assert(count > 1900 && count < 2200);
  const row = compositePixels(
    new Uint8ClampedArray(32 * 4),
    source.slice(0, 32 * 4),
    'dissolve',
    0.5,
    32,
    16,
    20,
  );
  assert.deepEqual(row, half.slice((20 * 64 + 16) * 4, (20 * 64 + 48) * 4));
  const mask = new Uint8ClampedArray(source.length);
  assert.deepEqual(
    adjustedPixels(source, 64, 64, { type: 'invert', value: 0 }, 0.5, mask, 'dissolve'),
    source,
  );
  const adjusted = adjustedPixels(
    source,
    64,
    64,
    { type: 'invert', value: 0 },
    0.5,
    null,
    'dissolve',
  );
  for (let i = 0; i < adjusted.length; i += 4) {
    assert.equal(adjusted[i + 3], 255);
    assert([0, 255].includes(adjusted[i]));
    assert.equal(adjusted[i], half[i + 3] ? 0 : 255);
  }
});
await check('TIFF 导入拒绝截断、超大尺寸与不支持的压缩', async () => {
  const fail = (message) => {
    throw Error(message);
  };
  assert.throws(() => unpackLZW(new Uint8Array(), 1, fail), /不完整/);
  assert.throws(() => unpackLZW(new Uint8Array([0, 0]), 1, fail), /起始标记/);
  const buffer = await writeTIFF({
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([20, 40, 80, 128, 1, 2, 3, 255]),
  }).arrayBuffer();
  assert.deepEqual([...readTIFF(buffer).data], [20, 40, 80, 128, 1, 2, 3, 255]);
  assert.throws(() => readTIFF(buffer.slice(0, 12)), /不完整/);
  assert.throws(() => readTIFF(buffer.slice(0, -1)), /不完整/);
  const large = buffer.slice(0);
  new DataView(large).setUint32(18, 0xffffffff, true);
  assert.throws(() => readTIFF(large), /尺寸/);
  const compressed = buffer.slice(0);
  new DataView(compressed).setUint16(54, 7, true);
  assert.throws(() => readTIFF(compressed), /PackBits/);
});
await check('连通颜色区域：分离区域、容差和透明度边界', () => {
  const edges = runOutline([
    [0, 0, 4],
    [0, 1, 4],
    [0, 2, 4],
  ]);
  assert.equal(
    edges.reduce((n, [x, y, xx, yy]) => n + Math.abs(xx - x) + Math.abs(yy - y), 0),
    14,
  );
  assert(edges.every(([x, y, xx, yy]) => x === xx || y === 0 || y === 3));
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 250, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 0,
  ]);
  const matched = (t) => [...floodRegion(pixels, 3, 2, 0, 0, t).mask].map((v) => v === 2);
  assert.deepEqual(matched(0), [true, false, false, false, false, false]);
  assert.deepEqual(matched(5), [true, false, false, true, false, false]);
  assert.equal(floodRegion(pixels, 3, 2, -1, 0, 5).bounds, null);
  assert.deepEqual(
    [...floodRegion(pixels, 3, 2, 2, 0, 5).mask].map((v) => v === 2),
    [false, false, true, false, false, false],
  );
});
await check('背景擦除覆盖：取样颜色、容差、透明像素与笔划范围', () => {
  const source = new Uint8ClampedArray([
    20, 40, 80, 255, 200, 20, 20, 255, 22, 40, 80, 255, 20, 40, 80, 0,
  ]);
  const mask = backgroundEraseMask(
    source,
    4,
    1,
    0,
    0,
    { x: 0.5, y: 0.5 },
    { x: 3.5, y: 0.5 },
    1,
    [20, 40, 80],
    2,
  );
  assert.deepEqual([mask[3], mask[7], mask[11], mask[15]], [255, 0, 255, 0]);
  const tight = backgroundEraseMask(
    source,
    4,
    1,
    0,
    0,
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    0.5,
    [20, 40, 80],
    2,
  );
  assert.equal(tight[11], 0);
  const recolored = colorReplacementPatch(source, mask, [0, 200, 0]);
  assert.deepEqual([recolored[3], recolored[7], recolored[11], recolored[15]], [255, 0, 255, 0]);
  const lum = (p, i) => 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
  assert(Math.abs(lum(recolored, 0) - lum(source, 0)) < 1);
  assert(recolored[1] > recolored[0] && recolored[1] > recolored[2]);
  assert.deepEqual([...source.slice(0, 4)], [20, 40, 80, 255]);
});
await check('滤镜保留 alpha，反相可逆，模糊保持纯色', () => {
  const input = new Uint8ClampedArray([20, 40, 80, 120, 200, 180, 160, 255]);
  assert.deepEqual(filterPixels(filterPixels(input, 2, 1, 'invert'), 2, 1, 'invert'), input);
  assert.equal(filterPixels(input, 2, 1, 'brightness', 20)[3], 120);
  const solid = new Uint8ClampedArray(16 * 16 * 4).fill(87);
  assert.deepEqual(filterPixels(solid, 16, 16, 'blur', 8), solid);
});
await check('调整图层不修改源像素，保留透明度并尊重蒙版和强度', () => {
  const source = new Uint8ClampedArray([20, 40, 80, 128, 100, 120, 140, 255]);
  const before = source.slice();
  const adjustment = { type: 'invert', value: 0 };
  const mask = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]);
  const output = adjustedPixels(source, 2, 1, adjustment, 1, mask);
  assert.deepEqual([...output], [235, 215, 175, 128, 100, 120, 140, 255]);
  assert.deepEqual(source, before);
  const multiplied = adjustedPixels(source, 2, 1, adjustment, 1, null, 'multiply');
  assert.deepEqual([...multiplied].slice(0, 4), [18, 34, 55, 128]);
  assert.deepEqual(adjustedPixels(source, 2, 1, adjustment, 0), source);
  assert.deepEqual(
    [...adjustedPixels(source, 2, 1, adjustment, 0.5)].slice(0, 4),
    [128, 128, 128, 128],
  );
  assert.throws(() => normalizeAdjustment({ type: 'unknown', value: 1 }));
  assert.throws(() => normalizeAdjustment({ type: 'brightness', value: NaN }));
  const curves = {
    red: [
      [0, 0],
      [128, 210],
      [255, 255],
    ],
  };
  const setting = normalizeAdjustment({ type: 'curves', value: { curves } });
  curves.red[1][1] = 0;
  assert.equal(setting.value.curves.red[1][1], 210);
  const toned = adjustedPixels(source, 2, 1, setting);
  assert(toned[0] > source[0]);
  assert.deepEqual(
    [...toned].filter((_, i) => i % 4 !== 0),
    [...source].filter((_, i) => i % 4 !== 0),
  );
  assert.throws(() =>
    normalizeAdjustment({
      type: 'curves',
      value: {
        curves: {
          red: [
            [0, 0],
            [0, 255],
          ],
        },
      },
    }),
  );
});
await check('剪贴调整只跟随相邻普通图层，失去目标不影响全图', () => {
  const adjustment = { type: 'invert', value: 0 };
  const background = { id: 'background' },
    text = { id: 'text' },
    a = { adjustment, clipToBelow: true },
    b = { adjustment, clipToBelow: true };
  const groups = compositionGroups([background, text, a, b]);
  assert.equal(groups.length, 2);
  assert.equal(groups[1].base, text);
  assert.deepEqual(groups[1].adjustments, [a, b]);
  assert.equal(clippingBase([background, text, a, b], 3), 1);
  assert.equal(compositionGroups([a, b]).length, 0);
  assert.equal(compositionGroups([background, { adjustment }, a]).length, 2);
});
await check('渲染缓存：命中、像素失效、样式替换与内存淘汰', () => {
  const cache = createRenderCache(80),
    source = { width: 2, height: 2 },
    styles = {};
  let calls = 0;
  const render = () => ({ image: { width: 2, height: 2 }, offset: 0, version: ++calls });
  const first = cache.get(source, null, styles, render);
  assert.equal(cache.get(source, null, styles, render), first);
  cache.invalidate(source);
  assert.notEqual(cache.get(source, null, styles, render), first);
  assert.equal(cache.get(source, null, {}, render).version, 3);
  const mask = { width: 2, height: 2 };
  assert.equal(cache.get(source, mask, styles, render).version, 4);
  cache.get({ width: 3, height: 3 }, null, styles, render);
  assert.equal(cache.stats().entries, 1);
  assert(cache.stats().bytes <= 80);
  cache.get({ width: 20, height: 20 }, null, styles, render);
  assert.equal(cache.stats().entries, 1);
});
await check('描边距离、透明区域、位置与浮雕平面不变', () => {
  const alpha = new Uint8Array(49);
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) alpha[y * 7 + x] = 255;
  const outside = distanceMap(alpha, 7, 7, true),
    inside = distanceMap(alpha, 7, 7, false);
  assert.equal(outside[0], 8);
  assert.equal(outside[1 * 7 + 1], 2);
  assert.equal(inside[3 * 7 + 3], 4);
  const defaults = normalizeStyles();
  const stroke = strokePixels(alpha, 7, 7, { ...defaults.stroke, size: 1 });
  assert.equal(stroke[(3 * 7 + 3) * 4 + 3], 0);
  assert(stroke[(3 * 7 + 1) * 4 + 3] > 0);
  assert.equal(stroke[3], 0);
  const inner = strokePixels(alpha, 7, 7, { ...defaults.stroke, size: 1, position: 'inside' });
  assert.equal(inner[(3 * 7 + 1) * 4 + 3], 0);
  assert(inner[(3 * 7 + 2) * 4 + 3] > 0);
  const bevel = bevelPixels(alpha, 7, 7, defaults.bevel);
  assert.equal(bevel[(3 * 7 + 3) * 4 + 3], 0);
  assert.equal(bevel[3], 0);
  assert(bevel.some((v, i) => i % 4 === 3 && v > 0));
  assert.equal(normalizeStyles({ stroke: { size: 999, position: 'invalid' } }).stroke.size, 60);
});
await check('曲线恒等、单通道调整、透明度与非法控制点', () => {
  const ramp = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) ramp.set([i, i, i, i], i * 4);
  assert.deepEqual(
    filterPixels(ramp, 256, 1, 'curves', {
      curves: {
        rgb: [
          [0, 0],
          [64, 64],
          [128, 128],
          [192, 192],
          [255, 255],
        ],
      },
    }),
    ramp,
  );
  const colored = filterPixels(new Uint8ClampedArray([80, 80, 80, 123]), 1, 1, 'curves', {
    curves: {
      red: [
        [0, 0],
        [128, 200],
        [255, 255],
      ],
    },
  });
  assert(colored[0] > 80);
  assert.deepEqual([...colored.slice(1)], [80, 80, 123]);
  const table = curveLUT([
    [0, 0],
    [64, 180],
    [128, 200],
    [255, 255],
  ]);
  for (let i = 1; i < table.length; i++) assert(table[i] >= table[i - 1]);
  assert.throws(() =>
    curveLUT([
      [0, 0],
      [0, 100],
      [255, 255],
    ]),
  );
});
await check('高斯模糊透明边缘不混入隐藏颜色，USM 保留 alpha', () => {
  const hiddenRed = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0]);
  const blurred = filterPixels(hiddenRed, 3, 1, 'gaussian', 1);
  assert(blurred[3] > 0 && blurred[3] < 255);
  assert.equal(blurred[0], 0);
  assert.equal(blurred[2], 255);
  assert.deepEqual([...blurred.slice(0, 4)], [...blurred.slice(8, 12)]);
  assert.deepEqual(filterPixels(hiddenRed, 3, 1, 'gaussian', 0), hiddenRed);
  const sharpened = filterPixels(hiddenRed, 3, 1, 'unsharp', 20);
  assert.deepEqual([sharpened[3], sharpened[7], sharpened[11]], [0, 255, 0]);
});
const data = await mkdtemp(join(tmpdir(), 'retouch-check-')),
  controller = new AbortController(),
  port = 43201,
  origin = `http://127.0.0.1:${port}`;
let service;
try {
  service = await start({
    pluginRoot: root,
    dataDir: data,
    listen: { host: '127.0.0.1', port },
    signal: controller.signal,
    logger: { info() {}, error() {} },
  });
  await check('静态资源、缓存和安全响应头', async () => {
    const r = await fetch(origin);
    assert.equal(r.status, 200);
    assert((await r.text()).includes('MiniMax Photo'));
    assert(r.headers.get('content-security-policy').includes("connect-src 'self'"));
    const cached = await fetch(origin, { headers: { 'If-None-Match': r.headers.get('etag') } });
    assert.equal(cached.status, 304);
    assert.equal((await fetch(origin + '/missing.js')).status, 404);
  });
  const id = randomUUID(),
    payload = {
      format: 'retouch-lab',
      version: 1,
      id,
      name: '验收工程',
      width: 64,
      height: 64,
      layers: [
        {
          name: '图层',
          image:
            'data:image/png;base64,' + (await readFile(join(root, 'icon.png'))).toString('base64'),
        },
      ],
      revision: 0,
    };
  const put = (value, extra = {}) =>
    fetch(origin + '/api/projects/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...extra },
      body: JSON.stringify(value),
    });
  await check('保存、读取、并发版本冲突', async () => {
    const saved = await put(payload);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).revision, 1);
    const recovered = await (await fetch(origin + '/api/projects/' + id)).json();
    assert.equal(recovered.name, payload.name);
    assert.equal(recovered.layers[0].image, payload.layers[0].image);
    assert.equal((await put(payload)).status, 409);
    const list = await (await fetch(origin + '/api/projects')).json();
    assert.equal(list.projects.length, 1);
  });
  await check('阻止跨站写入与无效工程', async () => {
    assert.equal((await put(payload, { Origin: 'https://example.org' })).status, 403);
    assert.equal((await put({ ...payload, width: -1 })).status, 400);
    assert.equal((await fetch(origin + '/api/no-such-route')).status, 404);
  });
  let agentId;
  await check(
    'Agent MCP transport, reference, result, idempotency and origin boundaries',
    async () => {
      const rpc = async (method, params = {}, headers = {}) => {
        const response = await fetch(origin + '/mcp/retouch-images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...headers,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        return { status: response.status, body: await response.json() };
      };
      const png = await readFile(join(root, 'icon.png'));
      await assert.rejects(validatePNG(png.subarray(0, 33)));
      const damaged = Buffer.from(png);
      damaged[damaged.length - 1] ^= 1;
      await assert.rejects(validatePNG(damaged));
      // Fixture chunk CRC generated independently with Python zlib.crc32.
      const unknownCritical = Buffer.concat([
        png.subarray(0, 33),
        Buffer.from('0000000446414b4574657374641be648', 'hex'),
        png.subarray(33),
      ]);
      await assert.rejects(validatePNG(unknownCritical), /PNG/);
      const initialized = (await rpc('initialize')).body.result;
      assert.equal(initialized.protocolVersion, '2025-03-26');
      const manifest = JSON.parse(await readFile(join(root, '.minimax-plugin/plugin.json'), 'utf8'));
      assert.deepEqual(initialized.serverInfo, { name: manifest.name, version: manifest.version });
      assert.deepEqual(
        (await rpc('tools/list')).body.result.tools.map((t) => t.name).sort(),
        [
          'get_image_request',
          'submit_image_result',
          'editor_capabilities',
          'photo_call',
          'editor_list',
          'editor_inspect',
          'editor_preview',
          'editor_batch',
          'editor_job',
          'editor_run_code',
          'editor_code_result',
          'editor_export',
          'editor_create',
        ].sort(),
      );
      assert.equal((await rpc('tools/list', {}, { Origin: 'https://example.org' })).status, 403);
      assert.equal((await fetch(origin + '/mcp/retouch-images')).status, 405);
      const created = await fetch(origin + '/api/agent/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({
          mode: 'edit',
          prompt: 'test edit',
          name: 'test',
          reference: payload.layers[0].image,
        }),
      });
      assert.equal(created.status, 201);
      agentId = (await created.json()).id;
      const reference = await rpc('tools/call', {
        name: 'get_image_request',
        arguments: { requestId: agentId },
      });
      const ref = JSON.parse(reference.body.result.content[0].text);
      assert.deepEqual(await readFile(ref.path), await readFile(join(root, 'icon.png')));
      const submit = () =>
        rpc('tools/call', {
          name: 'submit_image_result',
          arguments: { requestId: agentId, imagePath: join(root, 'icon.png') },
        });
      for (const response of await Promise.all([submit(), submit()]))
        assert.equal(response.body.result.isError, undefined);
      const replacement = await rpc('tools/call', {
        name: 'submit_image_result',
        arguments: { requestId: agentId, imagePath: join(root, 'evidence/ui-light.png') },
      });
      assert.equal(replacement.body.result.isError, true);
      const result = await fetch(origin + '/api/agent/requests/' + agentId + '/result');
      assert.deepEqual(
        Buffer.from(await result.arrayBuffer()),
        await readFile(join(root, 'icon.png')),
      );
      const invalid = await rpc('tools/call', {
        name: 'submit_image_result',
        arguments: { requestId: agentId, imagePath: join(root, 'package.json') },
      });
      assert.equal(invalid.body.result.isError, true);
      const traversal = await rpc('tools/call', {
        name: 'get_image_request',
        arguments: { requestId: '../../package' },
      });
      assert.equal(traversal.body.result.isError, true);
      const denied = await fetch(origin + '/api/agent/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://example.org' },
        body: '{}',
      });
      assert.equal(denied.status, 403);
    },
  );
  await service.dispose();
  service = null;
  await check('停止服务后重新启动，工程仍存在', async () => {
    service = await start({
      pluginRoot: root,
      dataDir: data,
      listen: { host: '127.0.0.1', port },
      signal: controller.signal,
      logger: { info() {}, error() {} },
    });
    assert.equal((await (await fetch(origin + '/api/projects/' + id)).json()).revision, 1);
    assert.equal(
      (await (await fetch(origin + '/api/agent/requests')).json()).requests.find(
        (r) => r.id === agentId,
      ).status,
      'ready',
    );
  });
  const pixels = new Uint8ClampedArray(1920 * 1080 * 4).fill(128),
    times = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    filterPixels(pixels, 1920, 1080, 'blur', 12);
    times.push(performance.now() - start);
  }
  results.push({ name: '1920×1080 方框模糊（Node 算法计时，非浏览器帧率）', milliseconds: times });
  await mkdir(join(root, 'evidence'), { recursive: true });
  await writeFile(
    join(root, 'evidence/check-results.json'),
    JSON.stringify({ time: Date.now(), results }, null, 2),
  );
  console.log('timing', times.map((t) => t.toFixed(1)).join(', '), 'ms');
} finally {
  await service?.dispose();
  await rm(data, { recursive: true, force: true });
}
