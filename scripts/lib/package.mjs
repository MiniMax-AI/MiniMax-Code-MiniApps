import path from 'node:path';

import { readJsonFile } from './fs.mjs';
import { createReport } from './report.mjs';
import { checkFiles } from './rules/files.mjs';
import { checkImageFile, checkLayout, checkNameMatchesDirectory } from './rules/layout.mjs';
import { checkManifest } from './rules/manifest.mjs';
import { checkMcode } from './rules/mcode.mjs';
import { checkMiniApp, emptyMiniApp } from './rules/miniapp.mjs';
import { checkNode } from './rules/node.mjs';
import { checkReadme } from './rules/readme.mjs';
import { checkAccessUsage } from './rules/usage.mjs';
import { requiredHostVersion } from './version.mjs';

export async function validatePackage(packageDir, { requireLowercaseAuthor = true } = {}) {
  const dir = path.resolve(packageDir);
  const report = createReport();

  await checkLayout(report, { packageDir: dir, requireLowercaseAuthor });

  const manifest = await readJson(report, dir, '.minimax-plugin/plugin.json', 'MANIFEST_UNREADABLE');
  const features = [];
  if (manifest.present) {
    const identity = await checkManifest(report, { packageDir: dir, manifest: manifest.value });
    features.push(...(identity.features ?? []));
    await checkNameMatchesDirectory(report, { packageDir: dir, name: identity.name });
    if (identity.icon) await checkImageFile(report, { packageDir: dir, relativePath: identity.icon, label: 'icon' });
    if (identity.darkIcon) await checkImageFile(report, { packageDir: dir, relativePath: identity.darkIcon, label: 'darkIcon' });
  }

  const packageJson = await readJson(report, dir, 'package.json', 'MCODE_UNREADABLE');
  if (packageJson.present) checkMcode(report, { packageJson: packageJson.value });

  const miniapp = await readJson(report, dir, 'miniapp/miniapp.json', 'MINIAPP_UNREADABLE');
  let resolved = emptyMiniApp();
  if (miniapp.present) resolved = await checkMiniApp(report, { packageDir: dir, manifest: miniapp.value });
  features.push(...resolved.features);

  await checkFiles(report, { packageDir: dir });
  await checkReadme(report, { packageDir: dir, features, engines: resolved.engines });
  await checkNode(report, { packageDir: dir, entry: resolved.entry, nodeRoots: resolved.nodeRoots });
  await checkAccessUsage(report, {
    packageDir: dir,
    roots: [...resolved.clientRoots, ...resolved.nodeRoots],
    access: resolved.access,
    minimum: requiredHostVersion(features, resolved.engines),
  });

  return report.diagnostics;
}

export async function readPackageName(packageDir) {
  const result = await readJsonFile(path.join(packageDir, '.minimax-plugin', 'plugin.json'));
  return result.ok && result.value !== null && typeof result.value === 'object' && typeof result.value.name === 'string'
    ? result.value.name
    : undefined;
}

async function readJson(report, dir, relativePath, code) {
  const result = await readJsonFile(path.join(dir, ...relativePath.split('/')));
  if (result.ok) return { present: true, value: result.value };
  if (result.reason !== 'missing') report.error(code, `${relativePath} ${result.detail}`, relativePath);
  return { present: false };
}
