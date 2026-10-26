import path from 'node:path';

import {
  AGENT_ACCESS_CAPABILITIES,
  AGENT_CONCURRENCY_MAX,
  ARTIFACT_FIELDS,
  CONNECTOR_PROVIDER,
  DEVICE_ACCESS_ITEMS,
  ENGINES_FIELDS,
  ENGINES_REQUIREMENT,
  ENTRY_EXTENSION,
  EXCLUDED_DIRECTORY,
  HOST_CONNECTOR_ACCESS_FIELDS,
  MCP_ENDPOINT_FIELDS,
  MCP_SERVER_NAME,
  MINIAPP_FIELDS,
  PAYLOAD_DIRECTORY,
  RESERVED_ROUTE_PREFIX,
  RUNTIME_FIELDS,
  SURFACE_FIELDS,
  SURFACE_WINDOW_BOOLEAN_FIELDS,
  SURFACE_WINDOW_DIMENSION_FIELDS,
  SURFACE_WINDOW_DIMENSION_MAX,
  SURFACE_WINDOW_DIMENSION_MIN,
  TOOL_ACCESS_CAPABILITIES,
} from '../contract.mjs';
import { isRecord, pathExists } from '../fs.mjs';
import { isCoveredBy, normalizePluginPath, normalizeRoutePath } from '../paths.mjs';

const FILE = 'miniapp/miniapp.json';

export async function checkMiniApp(report, { packageDir, manifest }) {
  const resolved = { nodeRoots: [], clientRoots: [], features: [], access: { agent: [], tool: false, microphone: false } };
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
  const agent = checkAccessList(report, manifest.agentAccess, 'agentAccess', AGENT_ACCESS_CAPABILITIES, 'MINIAPP_AGENT_ACCESS_INVALID');
  checkAgentConcurrency(report, manifest.agentConcurrency);
  const tool = checkAccessList(report, manifest.toolAccess, 'toolAccess', TOOL_ACCESS_CAPABILITIES, 'MINIAPP_TOOL_ACCESS_INVALID');
  const device = checkAccessList(report, manifest.deviceAccess, 'deviceAccess', DEVICE_ACCESS_ITEMS, 'MINIAPP_DEVICE_ACCESS_INVALID');
  const engines = checkEngines(report, manifest.engines);
  if (engines) resolved.engines = engines;
  resolved.access = { agent, tool: tool.includes('call'), microphone: device.includes('microphone') };

  if (manifest.agentAccess !== undefined) resolved.features.push('agentAccess');
  if (Array.isArray(manifest.agentAccess) && manifest.agentAccess.includes('session.read')) resolved.features.push('agentAccess.session.read');
  if (manifest.agentConcurrency !== undefined) resolved.features.push('agentConcurrency');
  if (isRecord(manifest.surface) && manifest.surface.window !== undefined) resolved.features.push('surface.window');
  for (const field of ['engines', 'toolAccess', 'deviceAccess']) {
    if (manifest[field] !== undefined) resolved.features.push(field);
  }
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
    report.error('MINIAPP_SURFACE_INVALID', 'surface must be an object with only "path" and "window"', FILE);
    return;
  }
  const route = normalizeRoutePath(value.path);
  if (!route.ok) report.error('MINIAPP_SURFACE_INVALID', `surface.path ${route.reason}`, FILE);
  else checkRouteNotReserved(report, route.value, 'surface.path');
  if (value.window !== undefined) checkSurfaceWindow(report, value.window);
}

// Same rule set as the Host's validateMiniAppSurfaceWindow.
function checkSurfaceWindow(report, value) {
  if (!isRecord(value)) {
    report.error('MINIAPP_SURFACE_INVALID', 'surface.window must be an object', FILE);
    return;
  }
  const known = new Set([...SURFACE_WINDOW_DIMENSION_FIELDS, ...SURFACE_WINDOW_BOOLEAN_FIELDS]);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) report.error('MINIAPP_SURFACE_INVALID', `surface.window has unknown field "${key}"`, FILE);
  }
  const dimensions = {};
  for (const key of SURFACE_WINDOW_DIMENSION_FIELDS) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (!Number.isInteger(entry) || entry < SURFACE_WINDOW_DIMENSION_MIN || entry > SURFACE_WINDOW_DIMENSION_MAX) {
      report.error('MINIAPP_SURFACE_INVALID', `surface.window.${key} must be an integer from ${SURFACE_WINDOW_DIMENSION_MIN} to ${SURFACE_WINDOW_DIMENSION_MAX}`, FILE);
      continue;
    }
    dimensions[key] = entry;
  }
  for (const [minKey, key] of [['minWidth', 'width'], ['minHeight', 'height']]) {
    if (dimensions[minKey] !== undefined && dimensions[key] !== undefined && dimensions[minKey] > dimensions[key]) {
      report.error('MINIAPP_SURFACE_INVALID', `surface.window.${minKey} must not exceed surface.window.${key}`, FILE);
    }
  }
  for (const key of SURFACE_WINDOW_BOOLEAN_FIELDS) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      report.error('MINIAPP_SURFACE_INVALID', `surface.window.${key} must be a boolean`, FILE);
    }
  }
  if (value.transparent === true && value.frame !== false) {
    report.error('MINIAPP_SURFACE_INVALID', 'surface.window.transparent requires surface.window.frame to be false', FILE);
  }
}

function checkRouteNotReserved(report, route, label) {
  if (route === RESERVED_ROUTE_PREFIX || route.startsWith(`${RESERVED_ROUTE_PREFIX}/`)) {
    report.error('MINIAPP_ROUTE_RESERVED', `${label} "${route}" is under ${RESERVED_ROUTE_PREFIX}/, which the Host reserves`, FILE);
  }
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
    checkRouteNotReserved(report, route.value, 'MCP endpoint path');
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

// Returns the declared values when the list is valid, otherwise [] (nothing is granted).
function checkAccessList(report, value, label, allowed, code) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !allowed.has(item))) {
    report.error(code, `${label} must be an array containing only ${[...allowed].map((c) => `"${c}"`).join(', ')}`, FILE);
    return [];
  }
  return [...new Set(value)].sort();
}

function checkAgentConcurrency(report, value) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1 || value > AGENT_CONCURRENCY_MAX) {
    report.error('MINIAPP_AGENT_CONCURRENCY_INVALID', `agentConcurrency must be an integer from 1 to ${AGENT_CONCURRENCY_MAX}`, FILE);
  }
}

// Returns the bound as "MAJOR.MINOR.PATCH".
function checkEngines(report, value) {
  if (value === undefined) return undefined;
  const match =
    isRecord(value) && Object.keys(value).every((k) => ENGINES_FIELDS.has(k)) && typeof value.mcode === 'string'
      ? ENGINES_REQUIREMENT.exec(value.mcode.trim())
      : null;
  if (!match) {
    report.error('MINIAPP_ENGINES_INVALID', 'engines must be { "mcode": ">=MAJOR.MINOR.PATCH" }', FILE);
    return undefined;
  }
  return match.slice(1, 4).map(Number).join('.');
}
