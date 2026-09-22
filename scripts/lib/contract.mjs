// Constants shared by every rule. Values mirror the MiniMax Code package reader.

export const HOST_VERSION = '3.0.73';

export const MANIFEST_FIELDS = new Set([
  '$schema',
  'schemaVersion',
  'name',
  'displayName',
  'version',
  'description',
  'author',
  'icon',
  'darkIcon',
  'category',
  'exampleQueries',
  'apps',
  'mcpServers',
  'skills',
  'hooks',
  'hostBindings',
]);

export const PLUGIN_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
export const PLUGIN_NAME_MAX_LENGTH = 80;
export const VERSION_MAX_LENGTH = 128;
export const REFERENCE_MAX_LENGTH = 512;

export const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

export const ICON_PATH = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/u;
export const APP_PATH = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.app\.json$/u;
export const MCP_PATH = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.mcp\.json$/u;
export const SKILL_PATH = /^skills\/[A-Za-z0-9._-]+\/SKILL\.md$/u;
export const HOOK_PATH = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.json$/u;
export const HOST_BINDING_PATH = /^bindings\/[A-Za-z0-9._-]+\.binding\.json$/u;

export const CATEGORIES = [
  'Office',
  'Studio',
  'Design & Sites',
  'Code',
  'Business',
  'Sales',
  'Productivity',
  'Science & Healthcare',
  'Education',
  'Other',
];

export const MCODE_EXPECTED = Object.freeze({
  schemaVersion: 2,
  miniApp: './miniapp/miniapp.json',
});

export const MINIAPP_FIELDS = new Set([
  'schemaVersion',
  'artifacts',
  'runtime',
  'surface',
  'mcpEndpoints',
  'hostConnectorAccess',
]);
export const ARTIFACT_FIELDS = new Set(['client', 'node']);
export const RUNTIME_FIELDS = new Set(['kind', 'entry', 'lifecycle']);
export const SURFACE_FIELDS = new Set(['path']);
export const MCP_ENDPOINT_FIELDS = new Set(['server', 'path']);
export const HOST_CONNECTOR_ACCESS_FIELDS = new Set(['providers']);
export const MCP_SERVER_NAME = /^[a-zA-Z0-9_-]{1,128}$/u;
export const CONNECTOR_PROVIDER = /^[a-z0-9_-]{1,64}$/u;
export const PAYLOAD_DIRECTORY = 'miniapp';
export const ENTRY_EXTENSION = /\.(?:[cm]?js)$/u;
export const EXCLUDED_DIRECTORY = 'node_modules';

export const PORTABLE_SEGMENT = /^[A-Za-z0-9._-]+$/u;
export const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_v, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_v, i) => `lpt${i + 1}`),
]);

export const LIMITS = Object.freeze({
  maxFiles: 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxPathBytes: 512,
  maxSegmentBytes: 128,
  maxPathSegments: 16,
});

export const REQUIRED_FILES = [
  '.minimax-plugin/plugin.json',
  'package.json',
  'miniapp/miniapp.json',
  'README.md',
  'LICENSE',
];

export const README_HEADINGS = ['## Tested environment', '## Data & access'];

export const STDOUT_CALL = /\b(?:console\.(?:log|info|debug|dir|table)|process\.stdout\.write)\s*\(/u;
export const START_EXPORT =
  /^\s*export\s+(?:async\s+function\s+start\b|function\s+start\b|const\s+start\b|let\s+start\b|\{[^}]*\bstart\b[^}]*\})/mu;
