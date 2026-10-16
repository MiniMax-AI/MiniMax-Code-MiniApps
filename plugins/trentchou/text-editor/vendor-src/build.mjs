// Rebuild the vendored CodeMirror bundles for the text-editor Mini App.
// Usage (from this directory): npm ci && node build.mjs <path-to-miniapp-dir>
import { build } from 'esbuild';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const miniappDir = resolve(process.argv[2] ?? '../miniapp');
const banner = '/*! Vendored CodeMirror 6 bundle (MIT). See THIRD_PARTY_LICENSES.txt. */';

await build({
  entryPoints: ['client-entry.js'],
  outfile: join(miniappDir, 'client/vendor/codemirror.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2022',
  legalComments: 'none',
  banner: { js: banner },
});

await build({
  entryPoints: ['node-entry.js'],
  outfile: join(miniappDir, 'node/vendor/cm-state.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  minify: true,
  target: 'node20',
  legalComments: 'none',
  banner: { js: banner },
});

// Collect license texts of every bundled runtime package (build tools excluded).
const skip = new Set(['esbuild', '@fontsource-variable/jetbrains-mono']);
const packages = [];
for (const entry of await readdir('node_modules')) {
  if (entry.startsWith('.')) continue;
  const scoped = entry.startsWith('@');
  const names = scoped ? (await readdir(join('node_modules', entry))).map((n) => `${entry}/${n}`) : [entry];
  for (const name of names) {
    if (skip.has(name) || name.startsWith('@esbuild/')) continue;
    packages.push(name);
  }
}
packages.sort();
let out = 'Third-party software bundled in vendor/codemirror.js and vendor/cm-state.mjs\n\n';
for (const name of packages) {
  const dir = join('node_modules', name);
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const files = (await readdir(dir)).filter((f) => /^(license|licence|copying)/i.test(f));
  const text = files.length ? await readFile(join(dir, files[0]), 'utf8') : `License: ${pkg.license ?? 'unknown'}\n`;
  out += `==== ${name}@${pkg.version} (${pkg.license ?? 'unknown'})\n${text.trim()}\n\n`;
}
await writeFile(join(miniappDir, 'client/vendor/THIRD_PARTY_LICENSES.txt'), out);
await writeFile(join(miniappDir, 'node/vendor/THIRD_PARTY_LICENSES.txt'), out);
console.log(`bundled ${packages.length} packages`);

// JetBrains Mono (OFL-1.1), the font MiniMax Code bundles as its "JetBrains Mono" code font option.
// Served from the Mini App itself so it renders the same on machines without the font installed.
const fontPkg = 'node_modules/@fontsource-variable/jetbrains-mono';
const fontDir = join(miniappDir, 'client/fonts');
await mkdir(join(fontDir, 'jetbrains-mono'), { recursive: true });
for (const file of await readdir(join(fontPkg, 'files'))) {
  if (file.endsWith('.woff2')) await copyFile(join(fontPkg, 'files', file), join(fontDir, 'jetbrains-mono', file));
}
let fontCss = '/* JetBrains Mono variable font via @fontsource-variable/jetbrains-mono (OFL-1.1, see OFL.txt). */\n';
for (const sheet of ['wght.css', 'wght-italic.css']) {
  fontCss += (await readFile(join(fontPkg, sheet), 'utf8')).replaceAll('url(./files/', 'url(./jetbrains-mono/');
}
await writeFile(join(fontDir, 'jetbrains-mono.css'), fontCss);
await copyFile(join(fontPkg, 'LICENSE'), join(fontDir, 'OFL.txt'));
console.log('copied JetBrains Mono font files');
