/**
 * The derived artifacts must land under the runtime's own data dir, and nowhere else.
 *
 * The plugin package installs onto every reader's machine. The search segments are derived state:
 * they belong to the runtime's data dir, and the runtime's data dir is not the package. Nothing
 * stopped a caller from handing `context.dataDir` the package itself, and when one did, the
 * segments landed in a directory that was published to every reader.
 *
 * So the refusal is the rule, and it is checked from three sides here:
 *
 *  1. a data dir that IS the package is refused, and the refusal names the path it refused;
 *  2. a data dir UNDER the package is refused too — the root is only the obvious case;
 *  3. a data dir OUTSIDE the package is accepted, and so is a sibling whose name merely starts with
 *     the package's name. A refusal that is too broad is its own kind of broken: it would stop the
 *     runtime from starting at all.
 *
 * Two more owners carry the other half of the rule. The package ignores the directory its artifacts
 * would land in, so that a caller who got through leaves nothing that is tracked. And no shipped
 * harness hands the package to the runtime as its data dir, because that is how the segments got
 * there in the first place.
 *
 * `tests/mutate-artifact-root.py` puts each of those back and requires this guard to report it by
 * name. Nothing here needs a network or a particular machine's paths.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The package root without its trailing separator, so a sibling can be spelled next to it. */
const PKG = resolve(PLUGIN_ROOT);
const SERVER = fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url));
const GITIGNORE = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

let pass = 0;
const failures = [];
function assert(name, cond, detail) {
  if (cond) pass += 1;
  else failures.push(detail ? `${name} -- ${detail}` : name);
}

const REFUSAL = 'the data dir must not be inside the plugin package';

const noop = () => {};
const controller = new AbortController();
const previousRoot = process.env.MMC_TRAJECTORY_ROOT;

/**
 * Start the runtime against a data dir and report what happened.
 *
 * The refusal is told apart from any other failure by its message, because a port that was already
 * taken is not an answer about the data dir and must not be read as one.
 *
 * @param {string} dataDir
 * @returns {Promise<{ accepted: boolean, refused: boolean, message: string }>}
 */
async function startWith(dataDir) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const port = 21500 + Math.floor(Math.random() * 400) + attempt;
    try {
      const instance = await start({
        pluginId: 'mmc-trajectory',
        pluginRoot: PLUGIN_ROOT,
        dataDir,
        generationId: 'guard',
        listen: { host: '127.0.0.1', port },
        signal: controller.signal,
        logger: { debug: noop, info: noop, warn: noop, error: noop }
      });
      await instance.dispose();
      return { accepted: true, refused: false, message: '' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(REFUSAL)) return { accepted: false, refused: true, message };
      if (/EADDRINUSE|address already in use/i.test(message)) continue;
      return { accepted: false, refused: false, message };
    }
  }
  return { accepted: false, refused: false, message: 'could not bind a port for the runtime' };
}

/** Every `.mjs` in this directory is a harness that may start the runtime. */
const harnesses = readdirSync(fileURLToPath(new URL('.', import.meta.url)))
  .filter((name) => name.endsWith('.mjs'));

const sessionsHome = mkdtempSync(join(tmpdir(), 'mmc-trajectory-artifact-home-'));
const outsideDir = mkdtempSync(join(tmpdir(), 'mmc-trajectory-artifact-out-'));
mkdirSync(join(sessionsHome, 'v2', 'sessions'), { recursive: true });
process.env.MMC_TRAJECTORY_ROOT = sessionsHome;

const { start } = await import(pathToFileURL(SERVER).href);

try {
  // --- 1. the package itself is refused, and the refusal says which path -----------------
  const atRoot = await startWith(PKG);
  assert('the runtime refuses a data dir that is the plugin package', atRoot.refused, atRoot.message);
  assert('the refusal names the path it refused',
    atRoot.message.includes(PKG), atRoot.message);

  // --- 2. so is a directory under it -----------------------------------------------------
  const underRoot = join(PKG, 'tests');
  const under = await startWith(underRoot);
  assert('the runtime refuses a data dir under the plugin package', under.refused, under.message);
  assert('the refusal names the path it refused',
    under.message.includes(resolve(underRoot)), under.message);

  // --- 3. a data dir outside the package is accepted -------------------------------------
  const outside = await startWith(outsideDir);
  assert('the runtime accepts a data dir outside the plugin package', outside.accepted, outside.message);

  // A sibling whose name starts with the package's name is outside it. A refusal that matched on
  // the string rather than on the path would turn this into a refusal of everything.
  const sibling = `${PKG}-sibling`;
  const beside = await startWith(sibling);
  assert('the runtime accepts a sibling of the plugin package whose name starts with its name',
    beside.accepted, beside.message);

  // --- 4. the package holds none of them -------------------------------------------------
  assert('the package holds no derived artifacts',
    !existsSync(join(PKG, 'trajectory-artifacts')));

  // --- 5. and it ignores the directory they would land in --------------------------------
  const ignored = GITIGNORE.split(/\r?\n/).map((line) => line.trim());
  assert('the package ignores the directory its artifacts would land in',
    ignored.includes('trajectory-artifacts/') || ignored.includes('trajectory-artifacts'),
    ignored.join(' | '));

  // --- 6. and no shipped harness hands the package over as the data dir ------------------
  const offenders = [];
  for (const name of harnesses) {
    const text = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), name), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (/dataDir\s*[:=]\s*PLUGIN_ROOT/.test(line)) offenders.push(`${name}: ${line.trim()}`);
    }
  }
  assert('no shipped harness hands the package to the runtime as its data dir',
    offenders.length === 0, offenders.join(' | '));
} finally {
  controller.abort();
  rmSync(sessionsHome, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
  if (previousRoot === undefined) delete process.env.MMC_TRAJECTORY_ROOT;
  else process.env.MMC_TRAJECTORY_ROOT = previousRoot;
}

if (failures.length) {
  console.log(`\n  [artifact-root] ${failures.length} failure(s):`);
  for (const line of failures) console.log(`    - ${line}`);
  console.log('');
  process.exitCode = 1;
} else {
  console.log(`[artifact-root] ${pass} assertions passed`);
}
