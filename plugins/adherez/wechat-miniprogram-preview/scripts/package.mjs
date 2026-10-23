import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Usage: node scripts/package.mjs /absolute/path/to/output.zip');
const metadata = JSON.parse(await readFile(path.join(root, '.minimax-plugin/plugin.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (packageJson.name !== metadata.name || packageJson.version !== metadata.version) throw new Error('Plugin and package identity/version must match');
const manifest = JSON.parse(await readFile(path.join(root, 'miniapp/miniapp.json'), 'utf8'));
if (!Array.isArray(metadata.skills) || !metadata.skills.length) throw new Error('Preview workflow Skill must be registered');
for (const name of metadata.skills) {
  if (typeof name !== 'string' || !/^skills\/[^/]+\/SKILL\.md$/.test(name)) throw new Error('Invalid workflow Skill path');
  const content = await readFile(path.join(root, name), 'utf8');
  if (!/^---\nname: [\w-]+\ndescription: .+\n---\n/.test(content)) throw new Error('Workflow Skill frontmatter is invalid');
}
await readFile(path.join(root, 'miniapp/node/vendor/js-transform.mjs'));
await readFile(path.join(root, 'miniapp/node/vendor/THIRD-PARTY-NOTICES.txt'));
await readFile(path.join(root, 'miniapp/client/vendor/component-runtime.js'));
await readFile(path.join(root, 'miniapp/client/vendor/THIRD-PARTY-NOTICES.txt'));
await readFile(path.join(root, 'miniapp/client/game-runtime.js'));
await readFile(path.join(root, 'miniapp/client/game-runtime.css'));
await readFile(path.join(root, 'miniapp/client/preview-chrome.css'));
const staging = await mkdtemp(path.join(os.tmpdir(), 'wechat-preview-package-'));
try {
  for (const file of ['.minimax-plugin', 'icon.png', 'miniapp', 'skills', 'package.json', 'servers.mcp.json', 'README.md', 'README.zh-CN.md', 'LICENSE', 'docs']) {
    await cp(path.join(root, file), path.join(staging, file), { recursive: true, dereference: false });
  }
  const check = async (directory) => {
    for (const entry of await readdir(directory)) {
      const file = path.join(directory, entry);
      const info = await lstat(file);
      if (info.isSymbolicLink() || entry === 'node_modules') throw new Error('Package must not contain links or node_modules');
      if (info.isDirectory()) await check(file);
    }
  };
  await check(staging);
  // Import the staged payload outside the checkout: no workspace dependency fallback.
  const { compileProject } = await import(pathToFileURL(path.join(staging, 'miniapp/node/compiler.mjs')));
  const probe = await compileProject(path.join(staging, 'miniapp/node/demo'));
  if (probe.errors.length) throw new Error(`Staged demo failed: ${JSON.stringify(probe.errors)}`);
  const stagedGames = [];
  for (const name of ['demo-game-2d', 'demo-game-webgl']) {
    const game = await compileProject(path.join(staging, 'miniapp/node', name));
    if (game.errors.length || game.payload?.projectKind !== 'minigame' || !game.payload.modules[game.payload.entryModule]
      || game.manifest.pages.length !== 0 || !game.assets.some((asset) => asset.path.endsWith('.png'))) throw new Error(`Staged game failed (${name}): ${JSON.stringify(game.errors)}`);
    stagedGames.push({ name, buildId: game.buildId, orientation: game.payload.game.deviceOrientation });
  }
  await import(pathToFileURL(path.join(staging, manifest.runtime.entry)));
  // This catches missing browser bundles without claiming Chromium/Host acceptance.
  const virtualConsole = new VirtualConsole();
  const browserErrors = [];
  virtualConsole.on('jsdomError', (error) => browserErrors.push(error.message));
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="wx-viewport"></div><div id="wx-overlay"></div><div id="wx-nav"></div><div id="wx-status"></div><div id="wx-title"></div><div id="wx-back"></div><div id="wx-tabbar"></div></body></html>', {
    url: 'http://preview.invalid/sim/123456789abc/staging/index.html?instance=staging', runScripts: 'outside-only', virtualConsole,
  });
  try {
    dom.window.__WX_BUILD__ = probe.payload;
    const messages = [];
    dom.window.postMessage = (message) => messages.push(message);
    for (const file of ['device-config.js', 'vendor/component-runtime.js', 'sim-runtime.js']) dom.window.eval(await readFile(path.join(staging, 'miniapp/client', file), 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (browserErrors.length || !dom.window.document.querySelector('wx-page') || !messages.some((message) => message.type === 'started')
      || messages.some((message) => message.type === 'preview-status' && message.status === 'error')) throw new Error(`Staged browser runtime failed: ${browserErrors.join('; ')}`);
  } finally { dom.window.close(); }
  await mkdir(path.dirname(output), { recursive: true });
  const { default: yazl } = await import('yazl');
  const { createWriteStream } = await import('node:fs');
  const archive = new yazl.ZipFile();
  const add = async (directory) => {
    for (const entry of (await readdir(directory)).sort()) {
      const file = path.join(directory, entry);
      const info = await lstat(file);
      if (info.isDirectory()) await add(file);
      else archive.addFile(file, path.relative(staging, file).split(path.sep).join('/'));
    }
  };
  const destination = createWriteStream(output, { flags: 'wx' });
  const finished = new Promise((resolve, reject) => {
    destination.on('close', resolve); destination.on('error', reject); archive.outputStream.on('error', reject);
  });
  archive.outputStream.pipe(destination);
  await add(staging);
  archive.end();
  await finished;
  console.log(JSON.stringify({ name: metadata.name, version: metadata.version, output,
    sha256: createHash('sha256').update(await readFile(output)).digest('hex'), stagedDemo: 'passed', stagedGames,
    stagedBrowserRuntime: 'passed (program jsdom only; game graphics require Electron evidence)', workflowSkills: metadata.skills, runtimeDependencies: 'bundled' }));
} finally {
  await rm(staging, { recursive: true, force: true });
}
