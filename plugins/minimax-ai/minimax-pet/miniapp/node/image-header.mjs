// @ts-check
// MiniMax Pet — magic-byte format detection and width/height parsing from image file headers.
// Pure functions over a Buffer; no I/O.

/** Bytes needed to parse any supported header. */
export const HEADER_BYTES = 32;

export const ATLAS_SIZES = Object.freeze({
  1: Object.freeze({ width: 1536, height: 1872 }),
  2: Object.freeze({ width: 1536, height: 2288 }),
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @param {Buffer} buf
 * @returns {'png' | 'webp' | null}
 */
export function detectImageFormat(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * @param {Buffer} buf
 * @returns {{ format: 'png' | 'webp', width: number, height: number, variant?: string } | null}
 */
export function readImageHeader(buf) {
  const format = detectImageFormat(buf);
  if (format === 'png') return readPngHeader(buf);
  if (format === 'webp') return readWebpHeader(buf);
  return null;
}

/** @param {Buffer} buf */
function readPngHeader(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(8) !== 13 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { format: /** @type {const} */ ('png'), width, height };
}

/** @param {Buffer} buf */
function readWebpHeader(buf) {
  if (buf.length < 20) return null;
  const fourcc = buf.toString('latin1', 12, 16);
  if (fourcc === 'VP8 ') {
    if (buf.length < 30) return null;
    // Keyframe bit (bit 0 of frame tag) must be 0, followed by start code 9d 01 2a.
    if ((buf[20] & 0x01) !== 0) return null;
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    if (width === 0 || height === 0) return null;
    return { format: /** @type {const} */ ('webp'), variant: 'VP8', width, height };
  }
  if (fourcc === 'VP8L') {
    if (buf.length < 25) return null;
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    if (bits >>> 29 !== 0) return null; // version must be 0
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return { format: /** @type {const} */ ('webp'), variant: 'VP8L', width, height };
  }
  if (fourcc === 'VP8X') {
    if (buf.length < 30) return null;
    const width = buf.readUIntLE(24, 3) + 1;
    const height = buf.readUIntLE(27, 3) + 1;
    return { format: /** @type {const} */ ('webp'), variant: 'VP8X', width, height };
  }
  return null;
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {1 | 2 | null}
 */
export function atlasVersionFromSize(width, height) {
  if (width === ATLAS_SIZES[1].width && height === ATLAS_SIZES[1].height) return 1;
  if (width === ATLAS_SIZES[2].width && height === ATLAS_SIZES[2].height) return 2;
  return null;
}
