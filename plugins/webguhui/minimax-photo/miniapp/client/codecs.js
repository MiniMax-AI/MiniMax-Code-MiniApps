import { readBlendKey, writeBlendKey } from './psd-blends.js';
import { canvas, documentModel, layer, composite, renderedLayer } from './model.js';
// Minimal PSD v1 codec: 8-bit RGB, raw/RLE pixels. Unsupported modes fail explicitly.
class Reader {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.p = 0;
  }
  u16() {
    const n = this.view.getUint16(this.p);
    this.p += 2;
    return n;
  }
  i16() {
    const n = this.view.getInt16(this.p);
    this.p += 2;
    return n;
  }
  u32() {
    const n = this.view.getUint32(this.p);
    this.p += 4;
    return n;
  }
  i32() {
    const n = this.view.getInt32(this.p);
    this.p += 4;
    return n;
  }
  str(n) {
    const s = String.fromCharCode(...this.bytes.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  skip(n) {
    if (n < 0 || this.p + n > this.bytes.length) throw Error('PSD 文件不完整');
    this.p += n;
  }
}
function channel(r, w, h) {
  const compression = r.u16(),
    out = new Uint8Array(w * h);
  if (compression === 0) {
    out.set(r.bytes.subarray(r.p, r.p + w * h));
    r.skip(w * h);
    return out;
  }
  if (compression !== 1) throw Error('暂不支持 ZIP 压缩 PSD，请另存为 RLE 或 PNG');
  const lengths = Array.from({ length: h }, () => r.u16());
  for (let y = 0; y < h; y++) {
    const end = r.p + lengths[y];
    let x = 0;
    while (r.p < end) {
      let n = r.bytes[r.p++];
      if (n > 127) n -= 256;
      if (n >= 0) {
        for (let i = 0; i <= n; i++) {
          if (x < w) out[y * w + x] = r.bytes[r.p];
          x++;
          r.p++;
        }
      } else if (n !== -128) {
        const v = r.bytes[r.p++];
        for (let i = 0; i < 1 - n; i++) {
          if (x < w) out[y * w + x] = v;
          x++;
        }
      }
    }
    if (x !== w) throw Error('PSD 行数据无效');
  }
  return out;
}
export function readPSD(buffer, name) {
  const r = new Reader(buffer);
  if (r.str(4) !== '8BPS' || r.u16() !== 1) throw Error('仅支持 PSD v1，PSB 尚未支持');
  r.skip(6);
  const channels = r.u16(),
    h = r.u32(),
    w = r.u32(),
    depth = r.u16(),
    mode = r.u16();
  if (depth !== 8 || mode !== 3) throw Error('仅支持 8-bit RGB PSD，请先转换颜色模式');
  canvas(w, h);
  r.skip(r.u32());
  r.skip(r.u32());
  const section = r.u32(),
    sectionEnd = r.p + section;
  const d = documentModel(w, h, name);
  if (section) {
    const length = r.u32(),
      end = r.p + length;
    if (length) {
      const count = Math.abs(r.i16());
      if (count > 100) throw Error('PSD 图层超过 100 层');
      const records = [];
      let pixels = 0;
      for (let i = 0; i < count; i++) {
        const top = r.i32(),
          left = r.i32(),
          bottom = r.i32(),
          right = r.i32(),
          n = r.u16(),
          ch = [];
        const lw = right - left,
          lh = bottom - top;
        if (lw < 0 || lh < 0 || (pixels += lw * lh) > 128e6) throw Error('PSD 图层尺寸过大');
        for (let k = 0; k < n; k++) ch.push({ id: r.i16(), length: r.u32() });
        if (r.str(4) !== '8BIM') throw Error('PSD 图层格式无效');
        const blend = r.str(4),
          opacity = r.bytes[r.p++] / 255;
        r.p++;
        const flags = r.bytes[r.p++];
        r.p++;
        const extra = r.u32(),
          extraEnd = r.p + extra;
        r.skip(r.u32());
        r.skip(r.u32());
        const namelen = r.bytes[r.p++];
        let layerName = r.str(namelen);
        r.skip((4 - ((namelen + 1) % 4)) % 4);
        while (r.p + 12 <= extraEnd) {
          const signature = r.str(4),
            key = r.str(4),
            size = r.u32(),
            end = r.p + size;
          if (signature !== '8BIM' || end > extraEnd) break;
          if (key === 'luni') {
            const count = r.u32();
            if (count * 2 > end - r.p || count > 10000) throw Error('PSD 图层名称无效');
            layerName = new TextDecoder('utf-16be').decode(r.bytes.subarray(r.p, r.p + count * 2));
          }
          r.p = end + (size % 2);
        }
        r.p = extraEnd;
        records.push({
          top,
          left,
          w: lw,
          h: lh,
          ch,
          blend,
          opacity,
          visible: !(flags & 2),
          name: layerName,
        });
      }
      const layers = [];
      for (const rec of records) {
        const maps = {};
        for (const c of rec.ch) {
          const stop = r.p + c.length;
          if (c.id >= -1 && c.id <= 2 && rec.w && rec.h) maps[c.id] = channel(r, rec.w, rec.h);
          r.p = stop;
        }
        if (!rec.w || !rec.h) continue;
        const l = layer(rec.w, rec.h, rec.name || '图层');
        l.x = rec.left;
        l.y = rec.top;
        l.opacity = rec.opacity;
        l.visible = rec.visible;
        l.blend = readBlendKey(rec.blend);
        const ctx = l.canvas.getContext('2d'),
          img = ctx.createImageData(rec.w, rec.h);
        for (let i = 0; i < rec.w * rec.h; i++) {
          for (let c = 0; c < 3; c++) img.data[i * 4 + c] = maps[c]?.[i] ?? 0;
          img.data[i * 4 + 3] = maps[-1]?.[i] ?? 255;
        }
        ctx.putImageData(img, 0, 0);
        layers.unshift(l);
      }
      if (layers.length) {
        d.layers = layers;
        d.activeId = layers.at(-1).id;
        d.dirty = true;
        return d;
      }
      r.p = end;
    }
    r.p = sectionEnd;
  }
  const compression = r.u16(),
    maps = [];
  if (compression === 0)
    for (let c = 0; c < channels; c++) {
      maps.push(r.bytes.slice(r.p, r.p + w * h));
      r.skip(w * h);
    }
  else if (compression === 1) {
    const lengths = Array.from({ length: channels * h }, () => r.u16());
    for (let c = 0; c < channels; c++) {
      const arr = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const end = r.p + lengths[c * h + y];
        let x = 0;
        while (r.p < end) {
          let n = r.bytes[r.p++];
          if (n > 127) n -= 256;
          if (n >= 0) {
            for (let j = 0; j <= n; j++) arr[y * w + x++] = r.bytes[r.p++];
          } else if (n !== -128) {
            const v = r.bytes[r.p++];
            for (let j = 0; j < 1 - n; j++) arr[y * w + x++] = v;
          }
        }
      }
      maps.push(arr);
    }
  } else throw Error('PSD 压缩方式不支持');
  const ctx = d.layers[0].canvas.getContext('2d'),
    img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) img.data[i * 4 + c] = maps[c]?.[i] ?? 0;
    img.data[i * 4 + 3] = maps[3]?.[i] ?? 255;
  }
  ctx.putImageData(img, 0, 0);
  d.dirty = true;
  return d;
}
class Writer {
  constructor() {
    this.parts = [];
    this.length = 0;
  }
  bytes(a) {
    const b = a instanceof Uint8Array ? a : new Uint8Array(a);
    this.parts.push(b);
    this.length += b.length;
  }
  n(v, size, signed = false) {
    const a = new Uint8Array(size),
      view = new DataView(a.buffer);
    if (size === 2) signed ? view.setInt16(0, v) : view.setUint16(0, v);
    else signed ? view.setInt32(0, v) : view.setUint32(0, v);
    this.bytes(a);
  }
  str(s) {
    this.bytes(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  }
  finish() {
    const out = new Uint8Array(this.length);
    let p = 0;
    for (const a of this.parts) {
      out.set(a, p);
      p += a.length;
    }
    return out;
  }
}
export function writePSD(d) {
  const out = new Writer();
  out.str('8BPS');
  out.n(1, 2);
  out.bytes(new Uint8Array(6));
  out.n(4, 2);
  out.n(d.height, 4);
  out.n(d.width, 4);
  out.n(8, 2);
  out.n(3, 2);
  out.n(0, 4);
  out.n(0, 4);
  const records = new Writer(),
    pixels = new Writer();
  records.n(d.layers.length, 2, true);
  for (const l of [...d.layers].reverse()) {
    const rendered = renderedLayer(l);
    const w = rendered.image.width,
      h = rendered.image.height;
    records.n(Math.round(l.y + rendered.offset), 4, true);
    records.n(Math.round(l.x + rendered.offset), 4, true);
    records.n(Math.round(l.y + rendered.offset) + h, 4, true);
    records.n(Math.round(l.x + rendered.offset) + w, 4, true);
    records.n(4, 2);
    for (const id of [0, 1, 2, -1]) {
      records.n(id, 2, true);
      records.n(w * h + 2, 4);
    }
    records.str('8BIM');
    records.str(writeBlendKey(l.blend));
    records.bytes([Math.round(l.opacity * 255), 0, l.visible ? 0 : 2, 0]);
    const extra = new Writer();
    extra.n(0, 4);
    extra.n(0, 4);
    const name = String(l.name)
      .replace(/[^\x20-\x7e]/g, '_')
      .slice(0, 255);
    extra.bytes([name.length]);
    extra.str(name);
    extra.bytes(new Uint8Array((4 - ((name.length + 1) % 4)) % 4));
    const unicode = String(l.name).slice(0, 200);
    extra.str('8BIM');
    extra.str('luni');
    extra.n(4 + unicode.length * 2, 4);
    extra.n(unicode.length, 4);
    for (let i = 0; i < unicode.length; i++) extra.n(unicode.charCodeAt(i), 2);
    records.n(extra.length, 4);
    records.bytes(extra.finish());
    const ctx = rendered.image.getContext('2d'),
      data = ctx.getImageData(0, 0, w, h).data;
    for (const c of [0, 1, 2, 3]) {
      pixels.n(0, 2);
      const p = new Uint8Array(w * h);
      for (let i = 0; i < p.length; i++) p[i] = data[i * 4 + c];
      pixels.bytes(p);
    }
  }
  const layerInfo = new Writer();
  layerInfo.bytes(records.finish());
  layerInfo.bytes(pixels.finish());
  if (layerInfo.length % 2) layerInfo.bytes([0]);
  const section = new Writer();
  section.n(layerInfo.length, 4);
  section.bytes(layerInfo.finish());
  section.n(0, 4);
  out.n(section.length, 4);
  out.bytes(section.finish());
  out.n(0, 2);
  const merged = composite(d).getContext('2d').getImageData(0, 0, d.width, d.height).data;
  for (let c = 0; c < 4; c++) {
    const p = new Uint8Array(d.width * d.height);
    for (let i = 0; i < p.length; i++) p[i] = merged[i * 4 + c];
    out.bytes(p);
  }
  return new Blob([out.finish()], { type: 'image/vnd.adobe.photoshop' });
}
export async function exportPDF(c) {
  const jpeg = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.95));
  const image = new Uint8Array(await jpeg.arrayBuffer()),
    enc = new TextEncoder(),
    parts = [],
    offsets = [0];
  let length = 0;
  const add = (s) => {
    const b = typeof s === 'string' ? enc.encode(s) : s;
    parts.push(b);
    length += b.length;
  };
  add('%PDF-1.4\n');
  const obj = (n, s) => {
    offsets[n] = length;
    add(n + ' 0 obj\n' + s + '\nendobj\n');
  };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${c.width} ${c.height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  offsets[4] = length;
  add(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
  );
  add(image);
  add('\nendstream\nendobj\n');
  const content = `q ${c.width} 0 0 ${c.height} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  add('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) add(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}
