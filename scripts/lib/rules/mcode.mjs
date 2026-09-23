import { MCODE_EXPECTED } from '../contract.mjs';
import { isRecord } from '../fs.mjs';

const MESSAGE = 'package.json#mcode must be exactly { "schemaVersion": 2, "miniApp": "./miniapp/miniapp.json" }';

export function checkMcode(report, { packageJson }) {
  const mcode = isRecord(packageJson) ? packageJson.mcode : undefined;
  const expectedKeys = Object.keys(MCODE_EXPECTED);
  const ok =
    isRecord(mcode) &&
    Object.keys(mcode).length === expectedKeys.length &&
    expectedKeys.every((key) => mcode[key] === MCODE_EXPECTED[key]);
  if (!ok) report.error('MCODE_INVALID', MESSAGE, 'package.json');
}
