#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackage } from './lib/package.mjs';
import { discoverPackages, validateRepository } from './lib/repo.mjs';
import { formatReport, hasErrors } from './lib/report.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(args) {
  let failed = false;
  let packages;
  if (args.length > 0) {
    const explicit = await explicitPackages(args);
    failed = explicit.failed;
    packages = explicit.packages;
  } else {
    packages = await discoverPackages(rootDir);
  }
  if (packages.length === 0) {
    console.error('No packages found under plugins/*/* or examples/*.');
    return 1;
  }
  for (const pkg of packages) {
    const diagnostics = await validatePackage(pkg.dir, { requireLowercaseAuthor: pkg.kind === 'plugin' });
    console.log(formatReport(pkg.label, diagnostics));
    if (hasErrors(diagnostics)) failed = true;
  }
  if (args.length === 0) {
    const diagnostics = await validateRepository(rootDir, packages);
    console.log(formatReport('repository', diagnostics));
    if (hasErrors(diagnostics)) failed = true;
  }
  return failed ? 1 : 0;
}

async function explicitPackages(args) {
  const packages = [];
  let failed = false;
  for (const arg of args) {
    const dir = path.resolve(arg);
    const info = await stat(dir).catch(() => undefined);
    if (!info || !info.isDirectory()) {
      console.error(`Not a directory: ${arg}`);
      failed = true;
      continue;
    }
    const relative = path.relative(rootDir, dir);
    const inside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    const label = inside ? relative.split(path.sep).join('/') : path.basename(dir);
    packages.push({ dir, kind: label.startsWith('examples/') ? 'example' : 'plugin', label });
  }
  return { packages, failed };
}

process.exitCode = await main(process.argv.slice(2));
