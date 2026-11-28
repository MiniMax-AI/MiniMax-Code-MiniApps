/**
 * Path vocabulary guard.
 *
 *   node check-paths.mjs      → the manual check, with an exit code
 *   import { checkPaths }     → the runtime's startup self-check
 *
 * It fails when a module keeps its own copy of a workspace path, or when the
 * declared layout no longer matches what the app builds. Importing this module
 * has no side effect, so the server can run it without taking the app down.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { artifactPaths, rulesPath, workbenchPaths } from './policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = new Set(['policy.mjs', 'check-paths.mjs']);
const forbidden = [/\.workbench/, /lessons\//, /notes\//, /reference\//, /learning-records\//, /assets\//, /teach\.md/];

export function checkPaths() {
  const failures = [];
  for (const file of fs.readdirSync(here).filter((name) => name.endsWith('.mjs') && !skip.has(name))) {
    const lines = fs.readFileSync(path.join(here, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (forbidden.some((pattern) => pattern.test(line))) {
        failures.push(`${file}:${index + 1} ${line.trim()}`);
      }
    });
  }

  const expected = {
    lesson: 'lessons',
    notes: 'notes',
    reference: 'reference',
    records: 'learning-records',
    assets: 'assets',
  };
  for (const [id, dir] of Object.entries(expected)) {
    const actual = artifactPaths(id)[0];
    if (actual !== dir) failures.push(`artifactPaths(${id}) = ${actual}, expected ${dir}`);
  }

  const root = path.resolve('/tmp/workspace-check');
  const paths = workbenchPaths(root);
  if (paths.rules !== rulesPath(root)) failures.push('rules path mismatch');
  if (!paths.curriculum.endsWith('curriculum.json')) failures.push('curriculum path mismatch');

  return { ok: failures.length === 0, failures };
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) {
  const { ok, failures } = checkPaths();
  if (!ok) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  process.stderr.write('path vocabulary OK\n');
}
