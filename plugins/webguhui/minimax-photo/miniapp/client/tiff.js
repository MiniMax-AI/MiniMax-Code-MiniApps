// TIFF 6.0: little-endian, one uncompressed chunky RGBA strip, straight alpha.
// https://www.itu.int/itudoc/itu-t/com16/tiff-fx/docs/tiff6.pdf
export function writeTIFF({ width, height, data }) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 32e6 ||
    !(data instanceof Uint8ClampedArray || data instanceof Uint8Array) ||
    data.length !== width * height * 4
  )
    throw Error('TIFF 像素数据无效');
  const count = 15;
  const bits = 8 + 2 + count * 12 + 4;
  const xResolution = bits + 8,
    yResolution = xResolution + 8,
    pixels = yResolution + 8;
  const bytes = new Uint8Array(pixels),
    view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, count, true);
  let offset = 10;
  function field(tag, type, length, value) {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, length, true);
    if (type === 3 && length === 1) view.setUint16(offset + 8, value, true);
    else view.setUint32(offset + 8, value, true);
    offset += 12;
  }
  field(256, 4, 1, width);
  field(257, 4, 1, height);
  field(258, 3, 4, bits);
  field(259, 3, 1, 1); // No compression.
  field(262, 3, 1, 2); // RGB.
  field(273, 4, 1, pixels);
  field(274, 3, 1, 1); // Top-left origin.
  field(277, 3, 1, 4);
  field(278, 4, 1, height);
  field(279, 4, 1, data.length);
  field(282, 5, 1, xResolution);
  field(283, 5, 1, yResolution);
  field(284, 3, 1, 1); // Interleaved samples.
  field(296, 3, 1, 2); // Inches; metadata only, no resampling.
  field(338, 3, 1, 2); // Unassociated alpha, matching Canvas ImageData.
  for (let c = 0; c < 4; c++) view.setUint16(bits + c * 2, 8, true);
  for (const p of [xResolution, yResolution]) {
    view.setUint32(p, 72, true);
    view.setUint32(p + 4, 1, true);
  }
  return new Blob([bytes, data], { type: 'image/tiff' });
}
