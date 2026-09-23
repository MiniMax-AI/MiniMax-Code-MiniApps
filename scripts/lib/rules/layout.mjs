import { open } from 'node:fs/promises';
import path from 'node:path';

import { REQUIRED_FILES } from '../contract.mjs';
import { pathExists } from '../fs.mjs';

export async function checkLayout(report, { packageDir, requireLowercaseAuthor }) {
  if (requireLowercaseAuthor) {
    const author = path.basename(path.dirname(packageDir));
    if (author !== author.toLowerCase()) {
      report.error('LAYOUT_AUTHOR_NOT_LOWERCASE', `author directory "${author}" must be lowercase`);
    }
  }
  for (const relativePath of REQUIRED_FILES) {
    if (!(await pathExists(path.join(packageDir, ...relativePath.split('/')), 'file'))) {
      report.error('LAYOUT_FILE_MISSING', 'required file is missing', relativePath);
    }
  }
}

export async function checkNameMatchesDirectory(report, { packageDir, name }) {
  const dirName = path.basename(packageDir);
  if (name !== undefined && name !== dirName) {
    report.error(
      'LAYOUT_NAME_MISMATCH',
      `directory is "${dirName}" but plugin.json name is "${name}"; they must be identical`,
      '.minimax-plugin/plugin.json',
    );
  }
}

const SIGNATURES = [
  { kind: 'PNG', test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { kind: 'JPEG', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: 'WebP', test: (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

export async function checkImageFile(report, { packageDir, relativePath, label }) {
  const absolute = path.join(packageDir, ...relativePath.split('/'));
  if (!(await pathExists(absolute, 'file'))) {
    report.error('LAYOUT_IMAGE_INVALID', `${label} file does not exist`, relativePath);
    return;
  }
  const handle = await open(absolute, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    const head = buffer.subarray(0, bytesRead);
    if (!SIGNATURES.some((s) => s.test(head))) {
      report.error('LAYOUT_IMAGE_INVALID', `${label} must be a PNG, JPEG, or WebP image`, relativePath);
    }
  } finally {
    await handle.close();
  }
}
