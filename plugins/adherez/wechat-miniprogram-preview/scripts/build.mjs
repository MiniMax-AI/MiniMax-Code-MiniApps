import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function bundle({ entry, output, filename, platform, format, globalName, target }) {
 await mkdir(output, { recursive: true });
 const result = await build({
   absWorkingDir: root,
   entryPoints: [entry],
   outfile: path.join(output, filename),
   bundle: true, platform, format, globalName, target,
   legalComments: 'eof', metafile: true,
 });
 if (platform === 'browser' && Object.values(result.metafile.outputs).some((file) => file.imports.some((item) => item.external))) {
   throw new Error('Client runtime must not depend on external modules');
 }
 const licenses = new Map();
 for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let directory = path.dirname(path.resolve(root, input));
  while (directory !== path.dirname(directory)) {
    try {
      const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (!metadata.name) break;
      if (!licenses.has(metadata.name)) {
        let license;
        for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']) {
          try { license = await readFile(path.join(directory, name), 'utf8'); break; } catch {}
        }
        if (!license) throw new Error(`Missing license for bundled dependency ${metadata.name}`);
        licenses.set(metadata.name, `${metadata.name}@${metadata.version}\n${license}`);
      }
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      directory = path.dirname(directory);
    }
  }
 }
 await writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), [...licenses].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n\n---\n\n'));
 return [...licenses.keys()].sort();
}

const nodePackages = await bundle({ entry: 'src/js-transform.mjs', output: path.join(root, 'miniapp/node/vendor'), filename: 'js-transform.mjs', platform: 'node', format: 'esm', target: 'node18' });
const clientPackages = await bundle({ entry: 'src/component-runtime.mjs', output: path.join(root, 'miniapp/client/vendor'), filename: 'component-runtime.js', platform: 'browser', format: 'iife', globalName: 'WxComponentRuntime', target: 'es2020' });

// A published payload must resolve without candidate-local node_modules.
const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile(path.join(root, '.minimax-plugin/plugin.json'), 'utf8'));
console.log(JSON.stringify({ plugin: manifest.name, version: manifest.version, bundledPackages: { node: nodePackages, client: clientPackages }, compiler: require('sucrase/package.json').version }));
