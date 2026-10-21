import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export async function stripResources(releaseRoot) {
  const root = join(releaseRoot, 'miniapp');
  const manifestPath = join(root, 'node/resource-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const restorePath = join(root, 'node/restore-files.json');
  const restore = JSON.parse(await readFile(restorePath, 'utf8'));
  for (const [path, item] of Object.entries(manifest.files)) {
    if (!path.startsWith('/') || path.split('/').some(x => x === '..' || x === '.') || /[\\:]/.test(path)) throw new Error('Unsafe resource path');
    for (const [region, domain] of [['cn', 'filecdn.minimax.chat'], ['global', 'file.cdn.minimax.io']]) {
      const url = new URL(item.urls[region]);
      if (url.protocol !== 'https:' || url.hostname !== domain) throw new Error('Resource URL missing or invalid');
    }
    const file = join(root, 'client', path.slice(1));
    const bytes = await readFile(file);
    if (bytes.length !== item.size || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`资源已变更，请重新上传：${path}`);
    item.targets = restore.files.filter(x => x.source === `client${path}`).map(x => x.target);
    await rm(file);
  }
  restore.files = restore.files.filter(x => !Object.hasOwn(manifest.files, '/' + x.source.replace(/^client\//, '')));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(restorePath, JSON.stringify(restore, null, 2) + '\n');
  console.log(`Deferred ${Object.keys(manifest.files).length} public resources; restored on first use.`);
}
