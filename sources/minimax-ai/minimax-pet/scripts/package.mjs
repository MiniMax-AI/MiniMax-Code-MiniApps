import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const stage = join(root, 'dist/package');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const name of ['.minimax-plugin', 'miniapp', 'skills', 'icon.png', 'README.md', 'README.zh-CN.md', 'LICENSE', 'PROVENANCE.md', 'ARTWORK.md']) {
  await cp(join(root, name), join(stage, name), { recursive: true });
}
await writeFile(join(stage, 'package.json'), JSON.stringify({
  mcode: { schemaVersion: 2, miniApp: './miniapp/miniapp.json' },
}, null, 2) + '\n');
// Stage a self-contained package; development dependencies stay outside it.
console.log(stage);
