import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';
import test from 'node:test';

import { createPetAtlas } from '../scripts/generate-pet-art.mjs';
import { validatePetArt } from '../skills/minimax-pet/scripts/validate-art.mjs';

const run = promisify(execFile);
const script = new URL('../skills/minimax-pet/scripts/validate-art.mjs', import.meta.url);
const v1 = createPetAtlas({ version: 1 });
const v2 = createPetAtlas({ version: 2 });

async function fixture(t, { png = v1, metadata = {}, rawJson } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'minimax-pet-art-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const petJsonPath = path.join(dir, 'pet.json');
  const pet = { id: 'custom-pet', displayName: 'My Pet', description: 'Original test pet', spritesheetPath: 'spritesheet.png', ...metadata };
  await writeFile(petJsonPath, rawJson ?? JSON.stringify(pet));
  await writeFile(path.join(dir, 'spritesheet.png'), png);
  return { dir, petJsonPath, pet };
}

function chunks(png) {
  const result = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    result.push({ kind: png.toString('ascii', offset + 4, offset + 8), data: png.subarray(offset + 8, offset + 8 + size) });
    offset += size + 12;
  }
  return result;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(kind, 4, 4, 'ascii');
  data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, data.length + 8)), data.length + 8);
  return bytes;
}
function repack(parts) {
  return Buffer.concat([v1.subarray(0, 8), ...parts.map(({ kind, data }) => chunk(kind, data))]);
}
function rawPixels(png) {
  const parts = chunks(png);
  const header = parts.find(({ kind }) => kind === 'IHDR').data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const encoded = inflateSync(Buffer.concat(parts.filter(({ kind }) => kind === 'IDAT').map(({ data }) => data)));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const offset = y * (width * 4 + 1);
    assert.equal(encoded[offset], 0, 'original generator uses unfiltered scanlines');
    encoded.copy(pixels, y * width * 4, offset + 1, offset + 1 + width * 4);
  }
  return { width, height, pixels, header: Buffer.from(header) };
}
function encodePixels(image, { filterCycle = false } = {}) {
  const { width, height, pixels, header } = image;
  const stride = width * 4;
  const encoded = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filterCycle ? y % 5 : 0;
    encoded[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const a = x >= 4 ? pixels[index - 4] : 0;
      const b = y ? pixels[index - stride] : 0;
      const c = y && x >= 4 ? pixels[index - stride - 4] : 0;
      // Independent encoder: choose the nearest of a, b, c to the Paeth estimate.
      const p = a + b - c;
      const nearest = [[a, Math.abs(p - a)], [b, Math.abs(p - b)], [c, Math.abs(p - c)]]
        .reduce((best, entry) => entry[1] < best[1] ? entry : best)[0];
      const predictor = [0, a, b, Math.floor((a + b) / 2), nearest][filter];
      encoded[y * (stride + 1) + 1 + x] = (pixels[index] - predictor + 256) & 255;
    }
  }
  return repack([{ kind: 'IHDR', data: header }, { kind: 'IDAT', data: deflateSync(encoded) }, { kind: 'IEND', data: Buffer.alloc(0) }]);
}
function setCell(image, row, frame, alpha) {
  for (let y = 0; y < 208; y++) {
    for (let x = 0; x < 192; x++) image.pixels[((row * 208 + y) * image.width + frame * 192 + x) * 4 + 3] = alpha;
  }
}
function copyCell(image, fromRow, fromFrame, toRow, toFrame) {
  for (let y = 0; y < 208; y++) {
    const source = ((fromRow * 208 + y) * image.width + fromFrame * 192) * 4;
    const target = ((toRow * 208 + y) * image.width + toFrame * 192) * 4;
    image.pixels.copy(image.pixels, target, source, source + 192 * 4);
  }
}
function assertFailure(report, pattern) {
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => pattern.test(error)), JSON.stringify(report));
}

test('generated v1 and v2 exports pass with the exact playable frame count', async (t) => {
  const first = await fixture(t);
  const second = await fixture(t, { png: v2, metadata: { spriteVersionNumber: 2 } });
  assert.deepEqual(await validatePetArt(first.petJsonPath), { ok: true, version: 1, width: 1536, height: 1872, frames: 57, warnings: [] });
  assert.deepEqual(await validatePetArt(second.petJsonPath), { ok: true, version: 2, width: 1536, height: 2288, frames: 73, warnings: [] });
});

test('the standalone CLI returns machine-readable success and failure with exit status', async (t) => {
  const { petJsonPath } = await fixture(t);
  const success = await run(process.execPath, [script.pathname, petJsonPath]);
  assert.equal(JSON.parse(success.stdout).ok, true);
  assert.equal(success.stderr, '');
  await writeFile(petJsonPath, '{');
  await assert.rejects(run(process.execPath, [script.pathname, petJsonPath]), (error) => {
    assert.equal(error.code, 1);
    assertFailure(JSON.parse(error.stdout), /valid UTF-8 JSON/);
    assert.equal(error.stderr, '');
    return true;
  });
});

test('metadata errors are actionable without echoing private values or following unsafe names', async (t) => {
  for (const metadata of [
    { id: '../private-value' }, { id: 'minimax-original' }, { displayName: '   ' },
    { displayName: '😀'.repeat(41) }, { description: '😀'.repeat(151) },
    { spriteVersionNumber: '2' }, { spritesheetPath: '../private-value.png' },
    { spritesheetPath: 'https://private-value/pet.png' }, { spritesheetPath: '私有.png' },
    { spritesheetPath: 'pet.webp' },
  ]) {
    const { petJsonPath } = await fixture(t, { metadata });
    const result = await validatePetArt(petJsonPath);
    assert.equal(result.ok, false, JSON.stringify(metadata));
    assert.equal(JSON.stringify(result).includes('private-value'), false);
  }
  const { petJsonPath } = await fixture(t, { metadata: { displayName: '😀'.repeat(40), description: '😀'.repeat(150) } });
  assert.equal((await validatePetArt(petJsonPath)).ok, true, 'UTF-16 boundary values also pass page import validation');
});

test('malformed JSON, arrays and invalid UTF-8 are rejected before loading an image', async (t) => {
  for (const rawJson of ['null', '[]', '{', Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x3a, 0x31, 0x7d])]) {
    const { petJsonPath } = await fixture(t, { rawJson });
    assert.equal((await validatePetArt(petJsonPath)).ok, false);
  }
});

test('declared atlas version and decoded dimensions must agree', async (t) => {
  for (const options of [
    { png: v2 }, { png: v1, metadata: { spriteVersionNumber: 2 } },
  ]) {
    const { petJsonPath } = await fixture(t, options);
    assertFailure(await validatePetArt(petJsonPath), /requires exactly/);
  }
});

test('PNG signature, CRC, complete stream and static RGBA encoding are checked', async (t) => {
  const brokenCrc = Buffer.from(v1);
  brokenCrc[45] ^= 1;
  const animated = chunks(v1);
  animated.splice(1, 0, { kind: 'acTL', data: Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]) });
  const interlaced = chunks(v1).map(({ kind, data }) => ({ kind, data: Buffer.from(data) }));
  interlaced[0].data[12] = 1;
  const invalidStream = chunks(v1).map((part) => part.kind === 'IDAT' ? { ...part, data: Buffer.from('not zlib') } : part);
  const trailingStream = chunks(v1).map((part) => part.kind === 'IDAT' ? { ...part, data: Buffer.concat([part.data, Buffer.from('extra')]) } : part);
  for (const [png, pattern] of [
    [Buffer.from('not a PNG'), /must be a PNG/], [brokenCrc, /CRC/], [v1.subarray(0, v1.length - 1), /truncated/],
    [Buffer.concat([v1, Buffer.from('extra')]), /final bytes/], [repack(animated), /static PNG/],
    [repack(interlaced), /non-interlaced/], [repack(invalidStream), /image data is invalid/],
    [repack(trailingStream), /trailing compressed bytes/],
  ]) {
    const { petJsonPath } = await fixture(t, { png });
    assertFailure(await validatePetArt(petJsonPath), pattern);
  }
});

test('all five standard PNG row filters decode to the same valid animation', async (t) => {
  const { petJsonPath } = await fixture(t, { png: encodePixels(rawPixels(v1), { filterCycle: true }) });
  assert.deepEqual(await validatePetArt(petJsonPath), { ok: true, version: 1, width: 1536, height: 1872, frames: 57, warnings: [] });
});

test('empty artwork and a fully opaque background fail per frame, including the last v2 look', async (t) => {
  const empty = rawPixels(v1);
  empty.pixels.fill(0);
  const opaqueCell = rawPixels(v1);
  setCell(opaqueCell, 0, 0, 255);
  const missingLastLook = rawPixels(v2);
  setCell(missingLastLook, 10, 7, 0);
  for (const [image, metadata, pattern] of [
    [empty, {}, /row 0, column 0 is empty/], [opaqueCell, {}, /row 0, column 0 has no fully transparent/],
    [missingLastLook, { spriteVersionNumber: 2 }, /row 10, column 7 is empty/],
  ]) {
    const { petJsonPath } = await fixture(t, { png: encodePixels(image), metadata });
    assertFailure(await validatePetArt(petJsonPath), pattern);
  }
});

test('clipping, frozen animation and repeated look artwork are warnings rather than format failures', async (t) => {
  const image = rawPixels(v2);
  for (let frame = 1; frame < 6; frame++) copyCell(image, 0, 0, 0, frame);
  for (let index = 1; index < 16; index++) copyCell(image, 9, 0, 9 + Math.floor(index / 8), index % 8);
  image.pixels[3] = 255;
  const { petJsonPath } = await fixture(t, { png: encodePixels(image), metadata: { spriteVersionNumber: 2 } });
  const result = await validatePetArt(petJsonPath);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => /cell edge/.test(warning)));
  assert.ok(result.warnings.some((warning) => /sixteen look directions/.test(warning)));
  // The deliberate edge pixel makes the first frame differ; freeze another row as well.
  for (let frame = 1; frame < 4; frame++) copyCell(image, 3, 0, 3, frame);
  await writeFile(path.join(path.dirname(petJsonPath), 'spritesheet.png'), encodePixels(image));
  assert.ok((await validatePetArt(petJsonPath)).warnings.some((warning) => /waving.*identical/.test(warning)));
});

test('oversized inputs, symlinks and directories are refused without reading arbitrary targets', async (t) => {
  const { dir, petJsonPath } = await fixture(t);
  await writeFile(petJsonPath, Buffer.alloc(1024 * 1024 + 1));
  assertFailure(await validatePetArt(petJsonPath), /pet.json exceeds/);
  const safe = await fixture(t);
  await writeFile(path.join(safe.dir, 'spritesheet.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
  assertFailure(await validatePetArt(safe.petJsonPath), /spritesheet PNG exceeds.*generation budget/);
  const linked = await fixture(t);
  await rm(path.join(linked.dir, 'spritesheet.png'));
  await symlink(path.join(dir, 'spritesheet.png'), path.join(linked.dir, 'spritesheet.png'));
  assertFailure(await validatePetArt(linked.petJsonPath), /regular file, not a symlink/);
  const jsonLink = path.join(linked.dir, 'linked.json');
  await symlink(safe.petJsonPath, jsonLink);
  assertFailure(await validatePetArt(jsonLink), /regular file, not a symlink/);
  assertFailure(await validatePetArt(linked.dir), /regular file, not a symlink/);
});

test('inflated scanlines are bounded and must exactly match the atlas size', async (t) => {
  const header = chunks(v1)[0];
  const excessiveScanlines = Buffer.alloc((1536 * 4 + 1) * 1872 + 2);
  const png = repack([header, { kind: 'IDAT', data: deflateSync(excessiveScanlines) }, { kind: 'IEND', data: Buffer.alloc(0) }]);
  const { petJsonPath } = await fixture(t, { png });
  assertFailure(await validatePetArt(petJsonPath), /image data is invalid.*exceeds/);
});
