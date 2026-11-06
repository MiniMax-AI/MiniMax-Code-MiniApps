import path from 'node:path';

import { README_HEADINGS } from '../contract.mjs';
import { readText } from '../fs.mjs';
import { compareVersions, requiredHostVersion } from '../version.mjs';

const TESTED_ENVIRONMENT = '## Tested environment';
// A pre-release suffix (`3.1.11-preview.4900`) ranks below its release, as in SemVer.
// The suffix starts with a letter so that a range such as `3.1.6-3.1.11` is not read as one.
const HOST_VERSION_MENTION = /MiniMax Code\D{0,16}?(\d+)\.(\d+)\.(\d+)(-[A-Za-z][0-9A-Za-z.-]*)?/gu;

export async function checkReadme(report, { packageDir, features = [], engines }) {
  const text = await readText(path.join(packageDir, 'README.md'));
  if (text === undefined) return;
  const lines = text.split(/\r?\n/u);
  const headings = new Set(lines.map((line) => line.trim()));
  for (const heading of README_HEADINGS) {
    if (!headings.has(heading)) {
      report.warning('README_HEADING_MISSING', `README.md should contain the heading "${heading}"`, 'README.md');
    }
  }
  checkMinimumVersion(report, lines, features, engines);
}

function checkMinimumVersion(report, lines, features, engines) {
  const required = requiredHostVersion(features, engines);
  if (required === undefined) return;
  const tested = testedEnvironmentSection(lines);
  const satisfied = [...tested.matchAll(HOST_VERSION_MENTION)].some((match) => {
    const order = compareVersions(match.slice(1, 4).join('.'), required);
    return order > 0 || (order === 0 && match[4] === undefined);
  });
  if (!satisfied) {
    report.warning(
      'README_MIN_VERSION_MISSING',
      `declares ${features.join(', ')}, which need MiniMax Code ${required} or later; name that version under "${TESTED_ENVIRONMENT}"`,
      'README.md',
    );
  }
}

function testedEnvironmentSection(lines) {
  const start = lines.findIndex((line) => line.trim() === TESTED_ENVIRONMENT);
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/u.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}
