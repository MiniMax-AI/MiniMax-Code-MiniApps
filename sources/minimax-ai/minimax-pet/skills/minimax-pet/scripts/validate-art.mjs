// Copyright MiniMax. SPDX-License-Identifier: MIT
// Standalone generation check: static 8-bit RGBA PNG only. No app install or dependencies needed.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const JSON_LIMIT = 1024 * 1024;
// A generation budget, not the UI's exact PNG limit. The UI limits the complete JSON request.
const PNG_LIMIT = 8 * 1024 * 1024;
const IMPORT_BODY_LIMIT = 12 * 1024 * 1024;
const CELL_W = 192;
const CELL_H = 208;
const FRAME_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
const STATE_NAMES = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'];
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

class InvalidArt extends Error {}
function requireArt(condition, message) {
  if (!condition) throw new InvalidArt(message);
}

async function readRegularFile(filePath, limit, label) {
  let handle;
  try {
    const metadata = await lstat(filePath);
    requireArt(metadata.isFile() && !metadata.isSymbolicLink(), `${label} must be a regular file, not a symlink.`);
    requireArt(metadata.size <= limit, `${label} exceeds the ${limit / 1024 / 1024} MiB generation budget.`);
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    requireArt((await handle.stat()).isFile(), `${label} must be a regular file, not a symlink.`);
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    requireArt(length <= limit, `${label} exceeds the ${limit / 1024 / 1024} MiB generation budget.`);
    return bytes.subarray(0, length);
  } catch (error) {
    if (error instanceof InvalidArt) throw error;
    throw new InvalidArt(`Cannot read ${label} as a regular file.`);
  } finally {
    await handle?.close();
  }
}

function validateMetadata(pet) {
  const errors = [];
  if (!pet || typeof pet !== 'object' || Array.isArray(pet)) return ['pet.json must contain a JSON object.'];
  if (typeof pet.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(pet.id)) {
    errors.push('id must match ^[a-z0-9][a-z0-9._-]{0,79}$.');
  } else if (pet.id === 'minimax-original') {
    errors.push('The id minimax-original is reserved for the bundled pet; choose a unique custom id.');
  }
  // The Node importer counts Unicode code points, but the page currently counts UTF-16 units.
  // Use the stricter page limit so generated metadata also passes the import preview.
  if (typeof pet.displayName !== 'string' || pet.displayName.trim().length < 1 || pet.displayName.length > 80) {
    errors.push('displayName must be non-blank and at most 80 UTF-16 code units.');
  }
  if (pet.description !== undefined && (typeof pet.description !== 'string' || pet.description.length > 300)) {
    errors.push('description must be a string of at most 300 UTF-16 code units.');
  }
  if (pet.spriteVersionNumber !== undefined && pet.spriteVersionNumber !== 1 && pet.spriteVersionNumber !== 2) {
    errors.push('spriteVersionNumber must be omitted, 1 or 2.');
  }
  if (typeof pet.spritesheetPath !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.png$/.test(pet.spritesheetPath)) {
    errors.push('spritesheetPath must be a plain ASCII *.png filename, without a directory or URL.');
  }
  return errors;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function paeth(left, above, upperLeft) {
  const predictor = left + above - upperLeft;
  const a = Math.abs(predictor - left);
  const b = Math.abs(predictor - above);
  const c = Math.abs(predictor - upperLeft);
  return a <= b && a <= c ? left : b <= c ? above : upperLeft;
}

function decodePng(bytes, version) {
  requireArt(bytes.subarray(0, 8).equals(SIGNATURE), 'The spritesheet must be a PNG image; WebP is not decoded by this generation checker.');
  const width = 1536;
  const height = version === 2 ? 2288 : 1872;
  const compressedChunks = [];
  let seenHeader = false;
  let seenEnd = false;
  let dataEnded = false;
  let seenPalette = false;
  for (let offset = 8; offset < bytes.length;) {
    requireArt(offset + 12 <= bytes.length, 'PNG contains a truncated chunk.');
    const size = bytes.readUInt32BE(offset);
    const end = offset + 12 + size;
    requireArt(end <= bytes.length, 'PNG contains a truncated chunk.');
    const kind = bytes.toString('latin1', offset + 4, offset + 8);
    requireArt(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(kind), 'PNG contains an invalid chunk type.');
    requireArt(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'PNG chunk CRC does not match.');
    requireArt(seenHeader || kind === 'IHDR', 'PNG must start with IHDR.');
    const data = bytes.subarray(offset + 8, end - 4);
    if (kind === 'IHDR') {
      requireArt(!seenHeader && offset === 8 && size === 13, 'PNG must have exactly one 13-byte IHDR at the start.');
      seenHeader = true;
      requireArt(data.readUInt32BE(0) === width && data.readUInt32BE(4) === height, `Version ${version} requires exactly ${width}×${height} pixels.`);
      requireArt(data[8] === 8 && data[9] === 6 && data[10] === 0 && data[11] === 0 && data[12] === 0,
        'Export a non-interlaced, 8-bit RGBA PNG (color type 6, standard compression and filters).');
    } else if (kind === 'IDAT') {
      requireArt(!dataEnded, 'PNG IDAT chunks must be consecutive.');
      compressedChunks.push(data);
    } else {
      if (compressedChunks.length) dataEnded = true;
      requireArt(!['acTL', 'fcTL', 'fdAT'].includes(kind), 'Export a static PNG atlas, not an animated PNG.');
      if (kind === 'IEND') {
        requireArt(size === 0 && end === bytes.length, 'PNG IEND must be empty and the final bytes of the file.');
        seenEnd = true;
      } else if (kind === 'PLTE') {
        requireArt(!seenPalette && !compressedChunks.length && size > 0 && size <= 768 && size % 3 === 0, 'PNG contains an invalid or misplaced PLTE chunk.');
        seenPalette = true;
      } else {
        requireArt(kind[0] === kind[0].toLowerCase(), 'PNG contains an unsupported critical chunk.');
        requireArt(kind !== 'tRNS', 'RGBA PNG must encode transparency in its alpha channel, without tRNS.');
      }
    }
    offset = end;
  }
  requireArt(seenHeader && seenEnd && compressedChunks.length > 0, 'PNG must contain IHDR, IDAT and IEND.');
  const compressed = Buffer.concat(compressedChunks);
  const stride = width * 4;
  const expectedLength = (stride + 1) * height;
  let scanlines;
  try {
    const inflated = inflateSync(compressed, { maxOutputLength: expectedLength + 1, info: true });
    requireArt(inflated.engine.bytesWritten === compressed.length, 'PNG image data contains trailing compressed bytes.');
    scanlines = inflated.buffer;
  } catch (error) {
    if (error instanceof InvalidArt) throw error;
    throw new InvalidArt('PNG image data is invalid, incomplete or exceeds its declared dimensions.');
  }
  requireArt(scanlines.length === expectedLength, 'PNG decoded image data does not match its dimensions.');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const encodedOffset = y * (stride + 1);
    const filter = scanlines[encodedOffset];
    requireArt(filter <= 4, 'PNG contains an unsupported scanline filter.');
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= 4 ? pixels[index - 4] : 0;
      const above = y ? pixels[index - stride] : 0;
      const upperLeft = y && x >= 4 ? pixels[index - stride - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      pixels[index] = (scanlines[encodedOffset + x + 1] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

function inspectFrames({ width, pixels }, version) {
  const errors = [];
  const warnings = [];
  const lookDigests = [];
  let frames = 0;
  for (let row = 0; row < (version === 2 ? 11 : 9); row++) {
    const digests = [];
    for (let frame = 0; frame < FRAME_COUNTS[row]; frame++) {
      let visible = false;
      let transparent = false;
      let touchesEdge = false;
      const normalized = Buffer.alloc(CELL_W * CELL_H * 4);
      for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) {
          const source = ((row * CELL_H + y) * width + frame * CELL_W + x) * 4;
          const alpha = pixels[source + 3];
          if (alpha === 0) transparent = true;
          if (alpha > 24) {
            visible = true;
            pixels.copy(normalized, (y * CELL_W + x) * 4, source, source + 4);
            if (x === 0 || x === CELL_W - 1 || y === 0 || y === CELL_H - 1) touchesEdge = true;
          }
        }
      }
      const position = `row ${row}, column ${frame}`;
      if (!visible) errors.push(`${position} is empty: add visible pixels with alpha greater than 24.`);
      if (!transparent) errors.push(`${position} has no fully transparent background pixel.`);
      if (touchesEdge) warnings.push(`${position} touches the cell edge; check for clipping during playback.`);
      const digest = createHash('sha256').update(normalized).digest('hex');
      digests.push(digest);
      if (row >= 9) lookDigests.push(digest);
      frames++;
    }
    if (row < 9 && new Set(digests).size === 1) {
      warnings.push(`The ${STATE_NAMES[row]} animation has identical visible content in every frame.`);
    }
  }
  if (version === 2 && new Set(lookDigests).size < 16) warnings.push('Some of the sixteen look directions have identical visible content; check the direction order and gaze.');
  return { errors, warnings, frames };
}

/**
 * Check generated pet.json and its sibling PNG without importing or modifying either file.
 * The report contains only format information and diagnostic text, never image data or metadata values.
 * @param {string} petJsonPath
 * @returns {Promise<{ok: true, version: number, width: number, height: number, frames: number, warnings: string[]} | {ok: false, errors: string[]}>}
 */
export async function validatePetArt(petJsonPath) {
  try {
    requireArt(typeof petJsonPath === 'string' && petJsonPath.length > 0, 'Supply the path to pet.json.');
    const jsonBytes = await readRegularFile(petJsonPath, JSON_LIMIT, 'pet.json');
    let pet;
    try {
      pet = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes));
    } catch {
      throw new InvalidArt('pet.json must contain valid UTF-8 JSON.');
    }
    const metadataErrors = validateMetadata(pet);
    if (metadataErrors.length) return { ok: false, errors: metadataErrors };
    const bytes = await readRegularFile(path.join(path.dirname(petJsonPath), pet.spritesheetPath), PNG_LIMIT, 'spritesheet PNG');
    // Base64 has no JSON escape overhead. Include the replacement flag so both import requests fit.
    const requestBytes = Buffer.byteLength(JSON.stringify({ petJson: pet, spritesheet: { fileName: pet.spritesheetPath, base64: '' }, replace: true })) + 4 * Math.ceil(bytes.length / 3);
    requireArt(requestBytes <= IMPORT_BODY_LIMIT, 'The base64 import request exceeds the 12 MiB JSON body limit; reduce the PNG or metadata.');
    const version = pet.spriteVersionNumber === 2 ? 2 : 1;
    const image = decodePng(bytes, version);
    const { errors, warnings, frames } = inspectFrames(image, version);
    if (errors.length) return { ok: false, errors };
    return { ok: true, version, width: image.width, height: image.height, frames, warnings };
  } catch (error) {
    return { ok: false, errors: [error instanceof InvalidArt ? error.message : 'Unable to validate the generated pet files.'] };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = process.argv.length === 3
    ? await validatePetArt(process.argv[2])
    : { ok: false, errors: ['Usage: node validate-art.mjs <export-directory>/pet.json'] };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
