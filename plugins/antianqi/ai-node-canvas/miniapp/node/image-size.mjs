// The size of a picture, read from its own header.
//
// The provider's image tools have size limits of their own, and a picture
// that breaks one is refused. So the canvas has to know how big a picture is
// before it asks for that picture to be changed.
//
// The headers are read here rather than with a library or with ffmpeg: these
// tools have to work on a machine that has no ffmpeg at all, and a PNG is a
// fixed chunk, a JPEG says its size in a start-of-frame marker, and a WebP
// says it in one of three shapes. That is all it takes.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(buffer) {
  if (buffer.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (buffer[i] !== PNG_SIGNATURE[i]) return null;
  }
  // The first chunk is the header, and it holds the width and the height.
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // The start-of-frame markers carry the size. The ones that do not (the
    // huffman and arithmetic tables) are skipped by their own length.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    // A marker with no length of its own.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webpSize(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const shape = buffer.toString('ascii', 12, 16);
  // The extended shape: the canvas size, one pixel short of what it is.
  if (shape === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  // The lossy shape: the size is in the frame header, in pixels.
  if (shape === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  // The lossless shape: fourteen bits each, in one word.
  if (shape === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

/**
 * The size of a picture, in pixels.
 *
 * A picture this cannot read has no size here: the answer is null, and the
 * caller asks the provider instead of guessing.
 */
export function imageSize(buffer) {
  if (!buffer || buffer.length < 8) return null;
  return pngSize(buffer) ?? jpegSize(buffer) ?? webpSize(buffer);
}
