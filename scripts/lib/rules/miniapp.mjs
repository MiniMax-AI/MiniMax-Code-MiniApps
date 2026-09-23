import path from 'node:path';

import {
  ARTIFACT_FIELDS,
  CONNECTOR_PROVIDER,
  ENTRY_EXTENSION,
  EXCLUDED_DIRECTORY,
  HOST_CONNECTOR_ACCESS_FIELDS,
  MCP_ENDPOINT_FIELDS,
  MCP_SERVER_NAME,
  MINIAPP_FIELDS,
  PAYLOAD_DIRECTORY,
  RUNTIME_FIELDS,
  SURFACE_FIELDS,
} from '../contract.mjs';
import { isRecord, pathExists } from '../fs.mjs';
import { isCoveredBy, normalizePluginPath, normalizeRoutePath } from '../paths.mjs';

const FILE = 'miniapp/miniapp.json';

export async function checkMiniApp(report, { packageDir, manifest }) {
  const resolved = { nodeRoots: [], clientRoots: [] };
  if (!isRecord(manifest)) {
    report.error('MINIAPP_NOT_OBJECT', 'miniapp.json must be a JSON object', FILE);
    return resolved;
  }
  for (const key of Object.keys(manifest)) {
    if (!MINIAPP_FIELDS.has(key)) report.error('MINIAPP_UNKNOWN_FIELD', `unknown field "${key}"`, FILE);
  }
  if (manifest.schemaVersion !== 1) report.error('MINIAPP_SCHEMA_VERSION', 'schemaVersion must be 1', FILE);

  const artifacts = await checkArtifacts(report, packageDir, manifest.artifacts);
  resolved.clientRoots = artifacts.client;
  resolved.nodeRoots = artifacts.node;
  const entry = await checkRuntime(report, packageDir, manifest.runtime, artifacts.node);
  if (entry) resolved.entry = entry;
  checkSurface(report, manifest.surface);
  checkMcpEndpoints(report, manifest.mcpEndpoints);
  checkHostConnectorAccess(report, manifest.hostConnectorAccess);
  return resolved;
}

async function checkArtifacts(report, packageDir, value) {
  const roots = { client: [], node: [] };
  if (!isRecord(value) || Object.keys(value).some((k) => !ARTIFACT_FIELDS.has(k))) {
    report.error('MINIAPP_ARTIFACTS_INVALID', 'artifacts must be an object with only "client" and "node"', FILE);
    return roots;
  }
  for (const key of ARTIFACT_FIELDS) {
    const list = value[key];
    if (!Array.isArray(list) || list.length === 0 || list.some((item) => typeof item !== 'string')) {
      report.error('MINIAPP_ARTIFACTS_INVALID', `artifacts.${key} must be a non-empty string array`, FILE);
      continue;
    }
    const normalized = [];
    for (const item of list) {
      const result = normalizePluginPath(item);
      if (!result.ok) {
        report.error('MINIAPP_ARTIFACTS_INVALID', `artifacts.${key} entry "${item}" ${result.reason}`, FILE);
        continue;
      }
      if (!result.value.startsWith(`${PAYLOAD_DIRECTORY}/`)) {
        report.error('MINIAPP_ARTIFACTS_INVALID', `artifacts.${key} entry "${item}" must stay under ${PAYLOAD_DIRECTORY}/`, FILE);
        continue;
      }
      if (result.value.split('/').some((segment) => segment.toLowerCase() === EXCLUDED_DIRECTORY)) {
        report.error('MINIAPP_ARTIFACTS_INVALID', `artifacts.${key} entry "${item}" is excluded from runtime payloads`, FILE);
        continue;
      }
      if (!(await pathExists(path.join(packageDir, ...result.value.split('/'))))) {
        report.error('MINIAPP_ARTIFACT_MISSING', `artifacts.${key} entry "${item}" is not on disk (git does not keep empty directories; add at least one file)`, FILE);
        continue;
      }
      normalized.push(result.value);
    }
    if (new Set(normalized).size !== normalized.length) {
      report.error('MINIAPP_ARTIFACTS_INVALID', `artifacts.${key} contains a duplicate`, FILE);
    }
    roots[key] = [...new Set(normalized)];
  }
  return roots;
}

async function checkRuntime(report, packageDir, value, nodeRoots) {
  if (!isRecord(value) || value.kind !== 'process') {
    report.error('MINIAPP_RUNTIME_INVALID', 'runtime must be an object with kind "process"', FILE);
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!RUNTIME_FIELDS.has(key)) report.error('MINIAPP_RUNTIME_INVALID', `runtime has unknown field "${key}"`, FILE);
  }
  if (value.lifecycle !== undefined && value.lifecycle !== 'on-demand') {
    report.error('MINIAPP_RUNTIME_INVALID', 'runtime.lifecycle must be "on-demand" or omitted', FILE);
  }
  const entry = normalizePluginPath(value.entry);
  if (!entry.ok) {
    report.error('MINIAPP_RUNTIME_INVALID', `runtime.entry ${entry.reason}`, FILE);
    return undefined;
  }
  if (!ENTRY_EXTENSION.test(entry.value)) {
    report.error('MINIAPP_RUNTIME_INVALID', 'runtime.entry must end in .js, .mjs, or .cjs', FILE);
    return undefined;
  }
  if (!(await pathExists(path.join(packageDir, ...entry.value.split('/')), 'file'))) {
    report.error('MINIAPP_ENTRY_MISSING', `runtime.entry "${entry.value}" does not exist`, FILE);
    return undefined;
  }
  if (!isCoveredBy(entry.value, nodeRoots)) {
    report.error('MINIAPP_ENTRY_NOT_COVERED', `runtime.entry "${entry.value}" must be inside one of artifacts.node`, FILE);
  }
  return entry.value;
}

function checkSurface(report, value) {
  if (!isRecord(value) || Object.keys(value).some((k) => !SURFACE_FIELDS.has(k))) {
    report.error('MINIAPP_SURFACE_INVALID', 'surface must be an object with only "path"', FILE);
    return;
  }
  const route = normalizeRoutePath(value.path);
  if (!route.ok) report.error('MINIAPP_SURFACE_INVALID', `surface.path ${route.reason}`, FILE);
}

function checkMcpEndpoints(report, value) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    report.error('MINIAPP_MCP_ENDPOINT_INVALID', 'mcpEndpoints must be an array (use [] when empty)', FILE);
    return;
  }
  const servers = new Set();
  const paths = new Set();
  for (const item of value) {
    if (!isRecord(item) || Object.keys(item).some((k) => !MCP_ENDPOINT_FIELDS.has(k))) {
      report.error('MINIAPP_MCP_ENDPOINT_INVALID', 'each MCP endpoint must be an object with only "server" and "path"', FILE);
      continue;
    }
    if (typeof item.server !== 'string' || !MCP_SERVER_NAME.test(item.server)) {
      report.error('MINIAPP_MCP_ENDPOINT_INVALID', `MCP endpoint server must match ${MCP_SERVER_NAME.source}`, FILE);
      continue;
    }
    const route = normalizeRoutePath(item.path);
    if (!route.ok) {
      report.error('MINIAPP_MCP_ENDPOINT_INVALID', `MCP endpoint path ${route.reason}`, FILE);
      continue;
    }
    if (servers.has(item.server) || paths.has(route.value)) {
      report.error('MINIAPP_MCP_ENDPOINT_INVALID', 'MCP endpoint server and path must each be unique', FILE);
    }
    servers.add(item.server);
    paths.add(route.value);
  }
}

function checkHostConnectorAccess(report, value) {
  if (value === undefined) return;
  const providers = isRecord(value) && !Object.keys(value).some((k) => !HOST_CONNECTOR_ACCESS_FIELDS.has(k)) ? value.providers : undefined;
  if (!Array.isArray(providers) || providers.some((p) => typeof p !== 'string' || !CONNECTOR_PROVIDER.test(p)) || new Set(providers).size !== providers.length) {
    report.error('MINIAPP_HOST_CONNECTOR_INVALID', `hostConnectorAccess.providers must be unique strings matching ${CONNECTOR_PROVIDER.source}`, FILE);
    return;
  }
  report.warning('HOST_CONNECTOR_UNVERIFIED', 'declared providers are granted by the Host at install time and are not checked here', FILE);
}
