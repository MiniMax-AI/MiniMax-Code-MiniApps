// 图片格式分发：harness 只认"给我一个 buffer，还我 {width,height,channels,data}"。
// PNG 走 png.mjs，JPEG 走 jpeg.mjs；WebP/HEIC 明确不支持，调用方按需跳过。
import { decodePng, readPngHeader } from './png.mjs';
import { decodeJpeg, isJpeg } from './jpeg.mjs';

export function sniffFormat(buffer) {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG') return 'png';
  if (isJpeg(buffer)) return 'jpeg';
  if (buffer.length > 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.length > 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'heif';
  return 'unknown';
}

// 按实际字节给扩展名。接口回的不一定是 PNG，而落盘一律叫 .png 会让文件名说谎：
// 下载下来用错扩展名打开会出问题，分享页和 curl -OJ 也会拿到错的类型。
// 认不出来的格式仍回 .png——调用方已经决定要存它，扩展名只影响下游怎么打开，
// 真正的把关交给 undecodableReason 和程序校验的 P-decode。
export function extensionFor(buffer) {
  const format = sniffFormat(buffer);
  if (format === 'jpeg') return '.jpg';
  if (format === 'webp') return '.webp';
  if (format === 'heif') return '.heic';
  return '.png';
}

export function decodeImage(buffer) {
  const format = sniffFormat(buffer);
  if (format === 'png') return decodePng(buffer);
  if (format === 'jpeg') return decodeJpeg(buffer);
  throw new Error('unsupported_image_format:' + format);
}

// 只看头部判断能不能解码，不做实际解码：4K 图纯 JS 解码要一两秒，
// 而下载环节只想知道"这张图后面能不能用"，不值得为此付解码的代价。
// 返回空字符串表示可用，否则返回不能用的原因。
export function undecodableReason(buffer) {
  const format = sniffFormat(buffer);
  if (format === 'png') {
    let header;
    try {
      header = readPngHeader(buffer);
    } catch {
      return 'PNG 头损坏';
    }
    if (header.interlace !== 0) return '隔行 PNG 不支持';
    if (header.colorType === 3) return header.bitDepth <= 8 ? '' : '调色板位深 ' + header.bitDepth + ' 不支持';
    if (header.bitDepth !== 8) return '位深 ' + header.bitDepth + ' 不支持';
    if (![0, 2, 4, 6].includes(header.colorType)) return '颜色类型 ' + header.colorType + ' 不支持';
    return '';
  }
  if (format === 'jpeg') return imageSize(buffer) ? '' : 'JPEG 头损坏';
  return '格式不支持（' + format + '）';
}

// 只要尺寸不解码全图，用于快速判断参考图能不能用。
export function imageSize(buffer) {
  const format = sniffFormat(buffer);
  if (format === 'png') return readPngHeader(buffer);
  if (format === 'jpeg') {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  return null;
}
