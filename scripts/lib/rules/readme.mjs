import path from 'node:path';

import { README_HEADINGS } from '../contract.mjs';
import { readText } from '../fs.mjs';

export async function checkReadme(report, { packageDir }) {
  const text = await readText(path.join(packageDir, 'README.md'));
  if (text === undefined) return;
  const headings = new Set(text.split(/\r?\n/u).map((line) => line.trim()));
  for (const heading of README_HEADINGS) {
    if (!headings.has(heading)) {
      report.warning('README_HEADING_MISSING', `README.md should contain the heading "${heading}"`, 'README.md');
    }
  }
}
