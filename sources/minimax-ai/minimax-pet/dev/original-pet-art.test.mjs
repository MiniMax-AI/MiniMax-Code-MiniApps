import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import test from 'node:test';

import { createPetAtlas } from '../scripts/generate-pet-art.mjs';
import { ANIMATIONS, CELL } from '../miniapp/client/pet-player.js';
import { atlasVersionFromSize, readImageHeader } from '../miniapp/node/image-header.mjs';

// Decode the actual generated image instead of trusting its dimensions or generator metadata.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
  const value = a + b - c;
  const [da, db, dc] = [Math.abs(value - a), Math.abs(value - b), Math.abs(value - c)];
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}
function decodeRgbaPng(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const chunks = [];
  let width, height, ended = false;
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + size)), bytes.readUInt32BE(offset + 8 + size), `${type} checksum`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0], '8-bit, non-interlaced RGBA image');
    } else if (type === 'IDAT') chunks.push(data);
    else if (type === 'IEND') ended = true;
    offset += size + 12;
    if (ended) assert.equal(offset, bytes.length);
  }
  assert.ok(ended && width > 0 && height > 0);
  const encoded = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  assert.equal(encoded.length, (stride + 1) * height);
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = encoded[start];
    assert.ok(filter <= 4, 'recognized PNG row filter');
    for (let x = 0; x < stride; x += 1) {
      const index = y * stride + x;
      const left = x >= 4 ? pixels[index - 4] : 0;
      const above = y > 0 ? pixels[index - stride] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[index - stride - 4] : 0;
      const predictor = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)][filter];
      pixels[index] = (encoded[start + x + 1] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}
function cellPixels(atlas, row, col) {
  const pixels = Buffer.alloc(CELL.width * CELL.height * 4);
  for (let y = 0; y < CELL.height; y += 1) {
    const from = ((row * CELL.height + y) * atlas.width + col * CELL.width) * 4;
    atlas.pixels.copy(pixels, y * CELL.width * 4, from, from + CELL.width * 4);
  }
  return pixels;
}
function assertVisibleTransparentFrame(pixels, message) {
  let visible = 0, transparent = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 24) visible += 1;
    if (pixels[index] === 0) transparent += 1;
  }
  assert.ok(visible > 0, `${message} contains artwork`);
  assert.ok(transparent > 0, `${message} preserves a transparent background`);
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const v1 = createPetAtlas({ version: 1 });
const v2 = createPetAtlas({ version: 2 });
const atlases = [decodeRgbaPng(v1), decodeRgbaPng(v2)];

test('original PNG v1 and v2 fully decode and contain all playable animation frames', () => {
  for (const [index, atlas] of atlases.entries()) {
    const version = index + 1;
    assert.equal(atlasVersionFromSize(atlas.width, atlas.height), version);
    assert.deepEqual(readImageHeader(index === 0 ? v1 : v2), { format: 'png', width: atlas.width, height: atlas.height });
    for (const [state, animation] of Object.entries(ANIMATIONS)) {
      const frames = animation.durations.map((_, col) => cellPixels(atlas, animation.row, col));
      for (const [col, frame] of frames.entries()) assertVisibleTransparentFrame(frame, `v${version} ${state} frame ${col}`);
      assert.ok(new Set(frames.map(digest)).size > 1, `v${version} ${state} has actual animation`);
    }
  }
});

test('original v2 atlas contains sixteen distinct visible look directions', () => {
  const frames = Array.from({ length: 16 }, (_, direction) => cellPixels(atlases[1], 9 + Math.floor(direction / 8), direction % 8));
  for (const [direction, frame] of frames.entries()) assertVisibleTransparentFrame(frame, `look direction ${direction}`);
  assert.equal(new Set(frames.map(digest)).size, 16);
});

test('original gaze frames follow the player pointer convention: up, then clockwise', () => {
  const eyeHighlight = (direction) => {
    const pixels = cellPixels(atlases[1], 9 + Math.floor(direction / 8), direction % 8);
    let count = 0, x = 0, y = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] === 255 && pixels[index + 1] === 255 && pixels[index + 2] === 255 && pixels[index + 3] === 255) {
        count += 1; x += (index / 4) % CELL.width; y += Math.floor(index / 4 / CELL.width);
      }
    }
    assert.ok(count > 0, 'the original robot has visible eye highlights');
    return { x: x / count, y: y / count };
  };
  const [up, right, down, left] = [0, 4, 8, 12].map(eyeHighlight);
  assert.equal(up.x, down.x);
  assert.equal(left.y, right.y);
  assert.ok(up.y < right.y && down.y > right.y);
  assert.ok(left.x < up.x && right.x > up.x);
});

test('bundled artwork has a reproducible v2 atlas and a valid transparent icon', async () => {
  assert.deepEqual(createPetAtlas({ version: 1 }), v1);
  assert.deepEqual(createPetAtlas({ version: 2 }), v2);
  const bundled = new URL('../miniapp/client/pets/minimax-original/', import.meta.url);
  const pet = JSON.parse(await readFile(new URL('pet.json', bundled), 'utf8'));
  assert.equal(pet.id, 'minimax-original');
  assert.equal(pet.displayName, 'MiniMax Pet');
  assert.equal(pet.spriteVersionNumber, 2);
  assert.equal(pet.spritesheetPath, 'spritesheet.png');
  assert.deepEqual(decodeRgbaPng(await readFile(new URL(pet.spritesheetPath, bundled))), atlases[1]);
  const iconBytes = await readFile(new URL('../icon.png', import.meta.url));
  const icon = decodeRgbaPng(iconBytes);
  assert.equal(icon.width, icon.height, 'plugin icon is square');
  assertVisibleTransparentFrame(icon.pixels, 'first-party plugin icon');
});
