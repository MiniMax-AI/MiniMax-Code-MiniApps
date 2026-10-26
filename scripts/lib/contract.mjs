// Constants shared by every rule. Values mirror the MiniMax Code package reader.

export const HOST_VERSION = '3.1.6';

// Clients older than the listed version reject the whole package when it declares the feature.
// Keys are the names diagnostics and docs use for each feature.
export const FEATURE_MIN_HOST_VERSION = Object.freeze({
  agents: '3.1.2',
  agentAccess: '3.1.2',
  // Released 3.1.4 still rejects "session.read"; only 3.1.4 preview builds accepted it.
  'agentAccess.session.read': '3.1.5',
  agentConcurrency: '3.1.2',
  deviceAccess: '3.1.5',
  engines: '3.1.5',
  'surface.window': '3.1.2',
  toolAccess: '3.1.5',
});

// From this version the Host denies Mini App pages every browser permission the manifest does
// not grant (the microphone included); earlier clients granted them silently.
export const BROWSER_PERMISSION_GATE_VERSION = '3.1.5';

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
  'agents',
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
export const AGENT_PATH = /^agents\/[a-z][a-z0-9_-]*\.md$/u;

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
  'agentAccess',
  'agentConcurrency',
  'engines',
  'toolAccess',
  'deviceAccess',
]);
export const ARTIFACT_FIELDS = new Set(['client', 'node']);
export const RUNTIME_FIELDS = new Set(['kind', 'entry', 'lifecycle']);
export const SURFACE_FIELDS = new Set(['path', 'window']);
export const SURFACE_WINDOW_DIMENSION_FIELDS = ['width', 'height', 'minWidth', 'minHeight'];
export const SURFACE_WINDOW_BOOLEAN_FIELDS = ['resizable', 'frame', 'transparent', 'alwaysOnTop', 'skipTaskbar', 'clickThrough'];
export const SURFACE_WINDOW_DIMENSION_MIN = 200;
export const SURFACE_WINDOW_DIMENSION_MAX = 10_000;
export const AGENT_ACCESS_CAPABILITIES = new Set(['session.run', 'session.read']);
export const AGENT_CONCURRENCY_MAX = 32;
export const TOOL_ACCESS_CAPABILITIES = new Set(['call']);
// Released clients accept only the microphone; later items get their own FEATURE_MIN_HOST_VERSION key.
export const DEVICE_ACCESS_ITEMS = new Set(['microphone']);
export const ENGINES_FIELDS = new Set(['mcode']);
export const ENGINES_REQUIREMENT = /^>=\s*(\d+)\.(\d+)\.(\d+)$/u;
// The Host answers requests under this prefix itself; plugin routes there never work.
export const RESERVED_ROUTE_PREFIX = '/__mavis';
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
// The Host's loopback guard patches node:http only; servers from these modules never pass readiness.
const UNGUARDED_MODULE = String.raw`['"](?:node:)?(?:https|http2|net|tls)['"]`;
export const UNGUARDED_SERVER = new RegExp(
  [
    String.raw`\b(?:https|http2|net|tls)\s*\.\s*create(?:Secure)?Server\s*\(`,
    String.raw`\bimport\s*\{[^}]*\bcreate(?:Secure)?Server\b[^}]*\}\s*from\s*${UNGUARDED_MODULE}`,
    String.raw`\{[^}]*\bcreate(?:Secure)?Server\b[^}]*\}\s*=\s*require\(\s*${UNGUARDED_MODULE}\s*\)`,
  ].join('|'),
  'u',
);
export const RESERVED_ROUTE_LITERAL = /\/__mavis(?:\/|['"`])/u;
