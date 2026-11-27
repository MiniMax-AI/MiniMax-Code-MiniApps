// @ts-check
//
// Regression tests for the paths handed to a publish interface.
//
// An interface that uploads images is given file paths on this machine, so a
// path may only name a file the app wrote under `assets/`. The state file is
// editable and a draft body can already carry `file:///...` lines, so both
// are probed here with records that try to climb out of the directory.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assetFilePath,
  collectAssetPaths,
  isInside,
  localImagePath,
  normalizePath,
} from '../miniapp/node/paths.mjs';

const assetsDir = '/data/assets';
const uuid = '6f1c2a44-1b0e-4c6a-9d3f-1a2b3c4d5e6f';

test('an asset id becomes a file inside the assets directory', () => {
  assert.equal(normalizePath(assetFilePath(assetsDir, { assetId: uuid, ext: '.jpg' })), `/data/assets/${uuid}.jpg`);
  assert.equal(normalizePath(assetFilePath(assetsDir, { assetId: uuid, ext: '.PNG' })), `/data/assets/${uuid}.png`);
});

test('a record that climbs out of the assets directory names no file', () => {
  // The probe from the review: `../secret` lands inside dataDir but outside
  // assets, and `../../outside` lands outside dataDir entirely.
  assert.equal(assetFilePath(assetsDir, { assetId: '../secret', ext: '.jpg' }), '');
  assert.equal(assetFilePath(assetsDir, { assetId: '../../outside', ext: '.jpg' }), '');
  assert.equal(assetFilePath(assetsDir, { assetId: '..\\..\\outside', ext: '.jpg' }), '');
  assert.equal(assetFilePath(assetsDir, { assetId: '/etc/passwd', ext: '' }), '');
  assert.equal(assetFilePath(assetsDir, { assetId: 'C:\\Windows\\win', ext: '.ini' }), '');
});

test('an extension the renderer never writes names no file', () => {
  assert.equal(assetFilePath(assetsDir, { assetId: uuid, ext: '.exe' }), '');
  assert.equal(assetFilePath(assetsDir, { assetId: uuid, ext: '.jpg.exe' }), '');
});

test('only a file inside the root counts, not a sibling with the same prefix', () => {
  assert.equal(isInside('/data/assets', '/data/assets/one.jpg'), true);
  assert.equal(isInside('/data/assets', '/data/assets-other/one.jpg'), false);
  assert.equal(isInside('/data/assets', '/data/assets'), false);
  assert.equal(isInside('/data/assets', '/data/secret.jpg'), false);
  assert.equal(isInside('C:\\data\\assets', 'C:\\data\\assets\\one.jpg'), true);
  assert.equal(isInside('C:\\data\\assets', 'c:\\data\\assets\\one.jpg'), true);
  assert.equal(isInside('C:\\data\\assets', 'C:\\data\\secret.jpg'), false);
});

test('a path that climbs out is collapsed before it is compared', () => {
  assert.equal(normalizePath('/data/assets/../secret'), '/data/secret');
  assert.equal(isInside('/data/assets', '/data/assets/../../outside'), false);
  assert.equal(isInside('/data/assets', '/data/assets/../assets2/one.jpg'), false);
});

test('a draft reports every asset record that names no file', () => {
  const paths = collectAssetPaths(assetsDir, {
    assets: {
      cover: { assetId: '../../outside', ext: '.jpg' },
      illustrations: {
        'illustration-1': { assetId: uuid, ext: '.jpg' },
        'illustration-2': { assetId: '../secret', ext: '.jpg' },
      },
    },
  });
  assert.equal(paths.cover, '');
  assert.deepEqual(
    Object.fromEntries(Object.entries(paths.illustrations).map(([slot, path]) => [slot, normalizePath(path)])),
    { 'illustration-1': `/data/assets/${uuid}.jpg` },
  );
  assert.deepEqual(paths.rejected.sort(), ['cover', 'illustration-2']);
});

test('an image reference in the body yields the file it names, or nothing', () => {
  assert.equal(localImagePath('C:\\data\\assets\\one.jpg'), 'C:\\data\\assets\\one.jpg');
  assert.equal(localImagePath('file:///C:/data/assets/one.jpg'), 'C:/data/assets/one.jpg');
  assert.equal(localImagePath('/data/assets/one.jpg'), '/data/assets/one.jpg');
  assert.equal(localImagePath('https://example.com/one.jpg'), '');
  assert.equal(localImagePath('data:image/png;base64,AAAA'), '');
  assert.equal(localImagePath('one.jpg'), '');
  assert.equal(localImagePath(''), '');
});