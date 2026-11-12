// MiniMax Pet — build the vendored markdown parser. Not part of the runtime payload.
// Usage: npm run build:markdown
// Writes miniapp/client/vendor/markdown.mjs and miniapp/client/vendor/markdown.LICENSE.txt.
// The committed files are the distributable source of truth; rebuild only when the
// pinned versions in package.json change.

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const modules = join(root, 'node_modules');
const outdir = join(root, 'miniapp/client/vendor');
const outfile = join(outdir, 'markdown.mjs');
const licenseFile = join(outdir, 'markdown.LICENSE.txt');
const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'];

const version = async (name) => JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8')).version;
const versions = {
  remarkParse: await version('remark-parse'),
  remarkGfm: await version('remark-gfm'),
  unified: await version('unified'),
};

const entry = `
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

export const MARKDOWN_VERSIONS = ${JSON.stringify(versions)};

const parser = unified().use(remarkParse).use(remarkGfm);

/** Parse one markdown document into an mdast tree. Raw HTML stays an inert node; nothing is rendered here. */
export function parseMarkdown(text) {
  if (typeof text !== 'string' || !text) return { type: 'root', children: [] };
  return parser.parse(text);
}
`;

await mkdir(outdir, { recursive: true });
const result = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'markdown-entry.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'chrome120',
  minify: true,
  legalComments: 'none',
  write: false,
  metafile: true,
  logLevel: 'warning',
});

const header = await readFile(join(root, 'scripts/markdown-vendor-header.txt'), 'utf8');
const bundled = result.outputFiles[0].text;
await writeFile(outfile, header + bundled);

// Every bundled package keeps its own notice; a redistributed MIT or Apache bundle
// must carry them. Derived from the esbuild metafile so the list cannot drift.
const bundledNames = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const parts = input.split('/');
  const at = parts.lastIndexOf('node_modules');
  if (at === -1) continue;
  bundledNames.add(parts[at + 1].startsWith('@') ? `${parts[at + 1]}/${parts[at + 2]}` : parts[at + 1]);
}

const sections = [];
for (const name of [...bundledNames].sort()) {
  const dir = join(modules, name);
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const holder = (typeof manifest.author === 'string' ? manifest.author : manifest.author?.name) ?? '';
  const license = manifest.license ?? 'see notice';
  const noticePath = LICENSE_FILES.map((file) => join(dir, file)).find((path) => existsSync(path));
  const notice = noticePath ? (await readFile(noticePath, 'utf8')).trim() : '(no separate license file in the package)';
  sections.push(`### ${name}@${manifest.version} — ${license}${holder ? ` — ${holder}` : ''}\n\n${notice}`);
}

await writeFile(licenseFile, [
  '# Third-party notices: vendored markdown parser',
  '',
  'miniapp/client/vendor/markdown.mjs bundles the packages below into one module. Each is',
  'redistributed unmodified in bundled form; only these packages are included.',
  '',
  ...sections,
  '',
].join('\n'));

console.log(`${outfile} ${(bundled.length / 1024).toFixed(1)} KiB, ${bundledNames.size} packages attested in ${licenseFile}`);
