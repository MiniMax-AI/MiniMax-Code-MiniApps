import { FEATURE_MIN_HOST_VERSION } from './contract.mjs';

// Compares "MAJOR.MINOR.PATCH" strings numerically.
export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

// The oldest MiniMax Code that installs the package: the highest minimum among its declared
// features and its engines.mcode bound. Undefined when nothing raises it.
export function requiredHostVersion(features, engines) {
  const versions = features.map((feature) => FEATURE_MIN_HOST_VERSION[feature]);
  if (engines) versions.push(engines);
  return versions.reduce((max, version) => (max === undefined || compareVersions(version, max) > 0 ? version : max), undefined);
}
