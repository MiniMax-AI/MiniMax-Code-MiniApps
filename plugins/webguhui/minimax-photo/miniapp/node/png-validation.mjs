import { inflate } from 'node:zlib';
import { promisify } from 'node:util';
const unzip = promisify(inflate);
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes) {
  let n = 0xffffffff;
  for (const byte of bytes) n = table[(n ^ byte) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
export async function validatePNG(buffer) {
  if (
    buffer.length < 45 ||
    buffer.length > 16 * 1024 * 1024 ||
    buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
  )
    throw Error('需要不超过 16 MB 的 PNG 图片');
  let offset = 8,
    width,
    height,
    channels,
    ended = false,
    palette = false,
    indexed = false,
    dataEnded = false;
  const compressed = [];
  while (offset + 12 <= buffer.length) {
    const size = buffer.readUInt32BE(offset),
      end = offset + 12 + size;
    if (end > buffer.length) throw Error('PNG 文件不完整');
    const type = buffer.toString('ascii', offset + 4, offset + 8),
      data = buffer.subarray(offset + 8, offset + 8 + size);
    if (
      crc(buffer.subarray(offset + 4, offset + 8 + size)) !== buffer.readUInt32BE(offset + 8 + size)
    )
      throw Error('PNG 校验失败');
    if (!/^[A-Za-z]{4}$/.test(type)) throw Error('PNG 数据块名称无效');
    if (!['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type) && !(buffer[offset + 4] & 32))
      throw Error('PNG 包含无法识别的关键数据');
    if (compressed.length && type !== 'IDAT') dataEnded = true;
    if (offset === 8 && type !== 'IHDR') throw Error('PNG 文件头无效');
    if (type === 'IHDR') {
      if (offset !== 8 || size !== 13) throw Error('PNG 文件头无效');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[data[9]];
      if (!width || !height || width * height > 32e6) throw Error('图片尺寸超过限制');
      indexed = data[9] === 3;
      if (data[8] !== 8 || !channels || data[10] !== 0 || data[11] !== 0 || data[12] !== 0)
        throw Error('请返回 8 位非交错 PNG');
    } else if (type === 'PLTE') {
      if (palette || compressed.length || !size || size > 768 || size % 3)
        throw Error('PNG 调色板无效');
      palette = true;
    } else if (type === 'IDAT') {
      if (dataEnded || (indexed && !palette)) throw Error('PNG 数据块顺序无效');
      compressed.push(data);
    } else if (type === 'IEND') {
      if (size !== 0 || end !== buffer.length) throw Error('PNG 结尾无效');
      ended = true;
      break;
    }
    offset = end;
  }
  if ((indexed && !palette) || !ended || !compressed.length) throw Error('PNG 缺少图像数据');
  const stride = width * channels + 1,
    expected = stride * height;
  let pixels;
  try {
    pixels = await unzip(Buffer.concat(compressed), { maxOutputLength: expected });
  } catch {
    throw Error('PNG 图像数据无效');
  }
  if (pixels.length !== expected) throw Error('PNG 图像数据长度无效');
  for (let y = 0; y < height; y++) if (pixels[y * stride] > 4) throw Error('PNG 行过滤无效');
  return { width, height };
}
