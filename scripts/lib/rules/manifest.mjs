import path from 'node:path';

import {
  APP_PATH,
  CATEGORIES,
  HOOK_PATH,
  HOST_BINDING_PATH,
  ICON_PATH,
  MANIFEST_FIELDS,
  MCP_PATH,
  PLUGIN_NAME,
  PLUGIN_NAME_MAX_LENGTH,
  REFERENCE_MAX_LENGTH,
  SEMVER,
  SKILL_PATH,
  VERSION_MAX_LENGTH,
} from '../contract.mjs';
import { isRecord, pathExists } from '../fs.mjs';

const FILE = '.minimax-plugin/plugin.json';

export async function checkManifest(report, { packageDir, manifest }) {
  if (!isRecord(manifest)) {
    report.error('MANIFEST_NOT_OBJECT', 'plugin.json must be a JSON object', FILE);
    return {};
  }
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_FIELDS.has(key)) report.error('MANIFEST_UNKNOWN_FIELD', `unknown field "${key}"`, FILE);
  }
  if (manifest.$schema !== undefined && typeof manifest.$schema !== 'string') {
    report.error('MANIFEST_FIELD_INVALID', '$schema must be a string', FILE);
  }
  if (manifest.schemaVersion !== 1) report.error('MANIFEST_SCHEMA_VERSION', 'schemaVersion must be 1', FILE);

  const name = requiredString(report, manifest, 'name');
  if (name !== undefined && (name.length > PLUGIN_NAME_MAX_LENGTH || !PLUGIN_NAME.test(name))) {
    report.error('MANIFEST_FIELD_INVALID', `name "${name}" must match ${PLUGIN_NAME.source} and be at most ${PLUGIN_NAME_MAX_LENGTH} characters`, FILE);
  }
  const version = requiredString(report, manifest, 'version');
  if (version !== undefined && (version.length > VERSION_MAX_LENGTH || !SEMVER.test(version))) {
    report.error('MANIFEST_FIELD_INVALID', `version "${version}" must be SemVer`, FILE);
  }
  optionalString(report, manifest, 'displayName');
  requiredString(report, manifest, 'description');
  requiredString(report, manifest, 'author');

  const icon = imagePath(report, manifest.icon, 'icon', true);
  const darkIcon = imagePath(report, manifest.darkIcon, 'darkIcon', false);

  if (typeof manifest.category !== 'string' || !CATEGORIES.includes(manifest.category)) {
    report.error('MANIFEST_FIELD_INVALID', `category must be one of: ${CATEGORIES.join(', ')}`, FILE);
  }

  const queries = stringArray(report, manifest.exampleQueries, 'exampleQueries');
  if (queries) {
    if (queries.some((q) => !q.trim())) report.error('MANIFEST_FIELD_INVALID', 'exampleQueries entries must not be blank', FILE);
    else if (queries.length === 0) {
      report.warning('MANIFEST_EXAMPLE_QUERIES_EMPTY', 'exampleQueries is empty; add at least one so the Agent can open the Mini App by name', FILE);
    }
  }

  const apps = await references(report, packageDir, manifest.apps, 'apps', APP_PATH, { required: true, mustExist: false });
  if (apps && apps.length > 0) {
    report.warning('MANIFEST_APPS_IGNORED', 'apps entries are ignored for locally installed packages', FILE);
  }
  await references(report, packageDir, manifest.mcpServers, 'mcpServers', MCP_PATH, { required: true, mustExist: true });
  await references(report, packageDir, manifest.skills, 'skills', SKILL_PATH, { required: true, mustExist: true });
  await references(report, packageDir, manifest.hooks, 'hooks', HOOK_PATH, { required: false, mustExist: true });
  await references(report, packageDir, manifest.hostBindings, 'hostBindings', HOST_BINDING_PATH, { required: false, mustExist: true });

  const identity = {};
  if (name !== undefined) identity.name = name;
  if (icon !== undefined) identity.icon = icon;
  if (darkIcon !== undefined) identity.darkIcon = darkIcon;
  return identity;
}

function optionalString(report, manifest, key) {
  const value = manifest[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    report.error('MANIFEST_FIELD_INVALID', `${key} must be a non-empty string`, FILE);
    return undefined;
  }
  return value.trim();
}

function requiredString(report, manifest, key) {
  if (manifest[key] === undefined) {
    report.error('MANIFEST_FIELD_INVALID', `${key} is required`, FILE);
    return undefined;
  }
  return optionalString(report, manifest, key);
}

function imagePath(report, value, label, required) {
  if (value === undefined) {
    if (required) report.error('MANIFEST_FIELD_INVALID', `${label} is required`, FILE);
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    report.error('MANIFEST_FIELD_INVALID', `${label} must be a non-empty string`, FILE);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > REFERENCE_MAX_LENGTH || !ICON_PATH.test(trimmed)) {
    report.error('MANIFEST_FIELD_INVALID', `${label} must be a plugin-relative .png, .jpg, .jpeg, or .webp path`, FILE);
    return undefined;
  }
  return trimmed;
}

function stringArray(report, value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    report.error('MANIFEST_FIELD_INVALID', `${label} must be a string array`, FILE);
    return undefined;
  }
  return value;
}

async function references(report, packageDir, value, label, pattern, { required, mustExist }) {
  if (value === undefined) {
    if (required) report.error('MANIFEST_FIELD_INVALID', `${label} is required (use [] when empty)`, FILE);
    return undefined;
  }
  const items = stringArray(report, value, label);
  if (!items) return undefined;
  if (new Set(items).size !== items.length) {
    report.error('MANIFEST_REFERENCE_INVALID', `${label} contains a duplicate`, FILE);
    return items;
  }
  for (const item of items) {
    if (item.length > REFERENCE_MAX_LENGTH || !pattern.test(item)) {
      report.error('MANIFEST_REFERENCE_INVALID', `${label} entry "${item}" must match ${pattern.source}`, FILE);
      continue;
    }
    if (mustExist && !(await pathExists(path.join(packageDir, ...item.split('/')), 'file'))) {
      report.error('MANIFEST_REFERENCE_MISSING', `${label} entry "${item}" does not exist`, item);
    }
  }
  return items;
}
