// @ts-check
/**
 * Regression harness for the path-traversal fix on the id-taking routes.
 *
 * Every id this store hands out is a server-generated UUID, so an id that does
 * not look like one is refused before it can name a file. The harness proves
 * that for the two routes that take an id from the query string
 * (`DELETE /api/assets` and `GET /api/package/download`), and it proves the
 * matching happy path still works.
 *
 * A canary file sits one level above the data directory, exactly where the
 * reported exploit reached. Every traversal attempt must leave it untouched.
 *
 * Run: node tests/path-traversal.mjs
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { start } from '../miniapp/node/server.mjs';
import { Store, InvalidIdError } from '../miniapp/node/lib/store.mjs';

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {boolean} condition
 * @param {string} [detail]
 */
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

/**
 * @returns {Promise<number>}
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Ids that must never reach the filesystem. Each one names the canary through
 * the asset (`.bin`) or the package (`.zip`) suffix.
 */
const TRAVERSAL_IDS = [
  '../../canary',
  '..\\..\\canary',
  '....//....//canary',
  '../assets/../../canary',
  '..%2F..%2Fcanary',
  '%2e%2e%2f%2e%2e%2fcanary',
  '../../canary/../canary',
  '/etc/passwd',
  'C:\\Windows\\System32\\config\\SAM',
  'not-a-uuid',
  '00000000-0000-4000-8000-000000000000/../../canary',
  '00000000-0000-4000-8000-000000000000.bin',
  `${randomUUID()}\x00../../canary`,
];

const root = await mkdtemp(join(tmpdir(), 'miniapp-traversal-'));
// The data directory is one level below the canary, so `../canary` from the
// assets directory is the canary itself.
const dataDir = join(root, 'data');
const canaryBin = join(root, 'canary.bin');
const canaryZip = join(root, 'canary.zip');
const canaryBytes = Buffer.from('canary-must-survive', 'utf8');

await mkdir(dataDir, { recursive: true });
await writeFile(canaryBin, canaryBytes);
await writeFile(canaryZip, canaryBytes);

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = await freePort();
const controller = new AbortController();

const lifecycle = await start({
  pluginId: 'test',
  pluginRoot,
  dataDir,
  listen: { host: '127.0.0.1', port },
  signal: controller.signal,
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  capabilities: { has: () => false },
});

const base = `http://127.0.0.1:${port}`;

/**
 * @param {string} file
 * @returns {Promise<boolean>}
 */
async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} file
 * @returns {Promise<boolean>}
 */
async function canaryIntact(file) {
  try {
    const bytes = await readFile(file);
    return bytes.equals(canaryBytes);
  } catch {
    return false;
  }
}

try {
  // ---- store level: the ids never reach the filesystem ----
  const store = new Store(dataDir);
  await store.init();

  for (const id of TRAVERSAL_IDS) {
    const label = JSON.stringify(id);

    let deleteError;
    try {
      await store.deleteAsset(id);
    } catch (error) {
      deleteError = error;
    }
    check(`deleteAsset refuses ${label}`, deleteError instanceof InvalidIdError, String(deleteError));
    check(`deleteAsset left the canary alone for ${label}`, await canaryIntact(canaryBin));

    let readError;
    try {
      await store.readPackageBytes(id);
    } catch (error) {
      readError = error;
    }
    check(`readPackageBytes refuses ${label}`, readError instanceof InvalidIdError, String(readError));
    check(`readPackageBytes left the canary alone for ${label}`, await canaryIntact(canaryZip));

    let assetReadError;
    try {
      await store.readAssetBytes(id);
    } catch (error) {
      assetReadError = error;
    }
    check(`readAssetBytes refuses ${label}`, assetReadError instanceof InvalidIdError, String(assetReadError));
    check(`readAssetBytes left the canary alone for ${label}`, await canaryIntact(canaryBin));

    let packageDeleteError;
    try {
      await store.deletePackage(id);
    } catch (error) {
      packageDeleteError = error;
    }
    check(`deletePackage refuses ${label}`, packageDeleteError instanceof InvalidIdError, String(packageDeleteError));
    check(`deletePackage left the canary alone for ${label}`, await canaryIntact(canaryZip));
  }

  // ---- HTTP level: the routes answer 400 and never serve the canary ----
  for (const id of TRAVERSAL_IDS) {
    const label = JSON.stringify(id);

    const deletion = await fetch(`${base}/api/assets?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    check(`DELETE /api/assets answers 400 for ${label}`, deletion.status === 400, `status=${deletion.status}`);
    check(`DELETE /api/assets left the canary alone for ${label}`, await canaryIntact(canaryBin));

    const download = await fetch(`${base}/api/package/download?id=${encodeURIComponent(id)}`);
    check(`GET /api/package/download answers 400 for ${label}`, download.status === 400, `status=${download.status}`);
    const body = Buffer.from(await download.arrayBuffer());
    check(
      `GET /api/package/download never served the canary for ${label}`,
      !body.equals(canaryBytes),
      body.toString('utf8').slice(0, 80),
    );
    check(`GET /api/package/download left the canary alone for ${label}`, await canaryIntact(canaryZip));
  }

  // ---- the happy path still works with a real server-generated id ----
  const assetId = randomUUID();
  await store.saveAsset(
    {
      id: assetId,
      name: 'icon.png',
      role: 'icon',
      size: 3,
      mime: 'image/png',
      createdAt: new Date().toISOString(),
    },
    Buffer.from('png', 'utf8'),
  );
  const assetFile = join(dataDir, 'assets', `${assetId}.bin`);
  check('the saved asset is on disk', await exists(assetFile));

  const validDelete = await fetch(`${base}/api/assets?id=${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
  });
  check('DELETE /api/assets accepts a real id', validDelete.status === 200, `status=${validDelete.status}`);
  check('DELETE /api/assets removed the file', (await exists(assetFile)) === false);

  const packageId = randomUUID();
  const packageBytes = Buffer.from('PK-not-really-a-zip', 'utf8');
  await store.savePackage(
    {
      id: packageId,
      fileName: 'listing-package.zip',
      createdAt: new Date().toISOString(),
      size: packageBytes.length,
      sha256: 'x',
      entries: [],
      manifest: null,
    },
    packageBytes,
  );

  const validDownload = await fetch(`${base}/api/package/download?id=${encodeURIComponent(packageId)}`);
  check('GET /api/package/download accepts a real id', validDownload.status === 200, `status=${validDownload.status}`);
  const downloaded = Buffer.from(await validDownload.arrayBuffer());
  check('the downloaded bytes are the stored bytes', downloaded.equals(packageBytes));

  // ---- an id that is well-formed but unknown is a 404, not a 400 ----
  const unknown = await fetch(`${base}/api/package/download?id=${randomUUID()}`);
  check('an unknown but valid id answers 404', unknown.status === 404, `status=${unknown.status}`);
} finally {
  await lifecycle.dispose();
  await rm(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
