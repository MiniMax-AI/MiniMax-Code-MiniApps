import path from 'node:path';

import { BROWSER_PERMISSION_GATE_VERSION } from '../contract.mjs';
import { collectPayloadFiles, readText } from '../fs.mjs';
import { compareVersions } from '../version.mjs';

// Files that run in the page or in Node. Declaration files (.ts) never run and are skipped.
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.htm']);

// Mini App APIs that never work without their declaration, on any client.
const AGENT_PREFIX = String.raw`\b(?:context|miniapp)\??\.agent\??\.`;
const AGENT_RUN_CALL = new RegExp(String.raw`${AGENT_PREFIX}(?:run|answer|reply|cancel|open|models|agents|create)\s*\(`, 'u');
const AGENT_OWN_SESSION_CALL = new RegExp(String.raw`${AGENT_PREFIX}(?:observe|session)\s*\(`, 'u');
const USER_SESSION_CALL = /\bagent\??\.sessions\s*\(|\bagent\??\.observe\s*\(\s*\{\s*all\s*:\s*(?:true|!0)|\bagent\??\.session\s*\(\s*\)/u;

const API_RULES = [
  {
    pattern: /\b(?:context|miniapp)\??\.tool\??\.(?:call|list|request)\s*\(/u,
    granted: (access) => access.tool,
    message: 'calls the tool API but miniapp.json does not declare toolAccess ["call"]; context.tool is absent and page tool.request rejects',
  },
  {
    pattern: /\bspeech\??\.transcribe\s*\(/u,
    granted: (access) => access.device.includes('microphone'),
    message: 'calls speech.transcribe but miniapp.json does not declare deviceAccess ["microphone"]; every call rejects with not_permitted',
  },
  {
    // Any identifier ending in host/Host, such as `miniAppHost`; a bare `navigation` is a router's.
    pattern: /\b\w*[Hh]ost\??\.navigation\??\.(?:getState|subscribe)\s*(?:\?\.)?\s*\(/u,
    granted: (access) => access.host.includes('navigation.read'),
    message: 'reads Host navigation but miniapp.json does not declare hostAccess ["navigation.read"]; the calls reject with not_permitted',
  },
];

const GET_USER_MEDIA = /\bgetUserMedia\s*\(/gu;
const NOTIFICATION = /\bnew\s+(?:window\.)?Notification\s*\(|\bNotification\s*\.\s*requestPermission\s*\(/u;
const DEVICE_ORDER = ['microphone', 'camera', 'notifications'];
const FALSE_LIKE = new Set(['false', '!1', '0', 'null', 'undefined']);
const EITHER_MEDIA_DEVICE = '"microphone" or "camera"';

export async function checkAccessUsage(report, { packageDir, roots, access, minimum }) {
  const gated = minimum !== undefined && compareVersions(minimum, BROWSER_PERMISSION_GATE_VERSION) >= 0;
  for (const relativePath of await collectPayloadFiles(packageDir, roots, SCANNED_EXTENSIONS)) {
    const source = await readText(path.join(packageDir, ...relativePath.split('/')));
    if (source === undefined) continue;
    checkAgentUsage(report, source, access.agent, relativePath);
    for (const rule of API_RULES) {
      if (!rule.granted(access) && rule.pattern.test(source)) report.error('ACCESS_UNDECLARED', rule.message, relativePath);
    }
    checkBrowserPermissions(report, source, access.device, relativePath, gated);
  }
}

// The devices each getUserMedia call asks for: its literal constraints when it has them, or
// undefined when the request cannot be read (not an object literal, or one naming neither key).
function requestedMediaDevices(source) {
  const requests = [];
  for (const match of source.matchAll(GET_USER_MEDIA)) {
    const literal = objectLiteralAt(source, match.index + match[0].length);
    const audio = literal === undefined ? undefined : keyRequest(literal, 'audio');
    const video = literal === undefined ? undefined : keyRequest(literal, 'video');
    if (audio === undefined && video === undefined) requests.push(undefined);
    else requests.push([audio && 'microphone', video && 'camera'].filter(Boolean));
  }
  return requests;
}

// The `{ ... }` starting at `start`, skipping braces inside string and template literals.
function objectLiteralAt(source, start) {
  let index = start;
  while (/\s/u.test(source[index] ?? '')) index += 1;
  if (source[index] !== '{') return undefined;
  let depth = 0;
  for (let end = index; end < source.length; end += 1) {
    const char = source[end];
    if (char === '"' || char === "'" || char === '`') {
      end = stringEnd(source, end);
      if (end === -1) return undefined;
    } else if (char === '{') depth += 1;
    else if (char === '}' && (depth -= 1) === 0) return source.slice(index, end + 1);
  }
  return undefined;
}

function stringEnd(source, start) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') index += 1;
    else if (source[index] === source[start]) return index;
  }
  return -1;
}

// `{ audio: true }`, `{ "audio": !0 }`, and shorthand `{ audio }` ask for the device; false-like
// values do not. Undefined when the literal does not name the key.
function keyRequest(literal, key) {
  const value = new RegExp(String.raw`(?:^|[{,\s])["']?${key}["']?\s*:\s*([^,}\s]+)`, 'u').exec(literal);
  if (value) return !FALSE_LIKE.has(value[1]);
  return new RegExp(String.raw`[{,]\s*${key}\s*[,}]`, 'u').test(literal) ? true : undefined;
}

// One diagnostic per file for every device its browser-permission calls need and lack. Clients
// before the gate granted these silently, so the calls fail on every client that installs the
// package only when the package already needs a gated client.
function checkBrowserPermissions(report, source, granted, relativePath, gated) {
  const needed = new Set();
  let unknownMedia = false;
  for (const request of requestedMediaDevices(source)) {
    if (request === undefined) unknownMedia = true;
    else for (const device of request) needed.add(device);
  }
  if (NOTIFICATION.test(source)) needed.add('notifications');
  const missing = DEVICE_ORDER.filter((device) => needed.has(device) && !granted.includes(device)).map((device) => `"${device}"`);
  if (unknownMedia && !granted.includes('microphone') && !granted.includes('camera') && !needed.has('microphone') && !needed.has('camera')) {
    missing.push(EITHER_MEDIA_DEVICE);
  }
  if (missing.length === 0) return;
  const base = `uses browser permissions that need deviceAccess ${listOf(missing)}; MiniMax Code ${BROWSER_PERMISSION_GATE_VERSION} and later deny them`;
  if (gated) {
    report.error('ACCESS_UNDECLARED', `${base}, and this package needs ${BROWSER_PERMISSION_GATE_VERSION} or later`, relativePath);
  } else {
    report.warning(
      'ACCESS_UNDECLARED',
      `${base}; they work only on clients before ${BROWSER_PERMISSION_GATE_VERSION}. Declaring deviceAccess raises the package's minimum client version (docs/package-contract.md)`,
      relativePath,
    );
  }
}

function listOf(items) {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

// One diagnostic per file, naming every agentAccess value the file's calls need and lack.
function checkAgentUsage(report, source, granted, relativePath) {
  const missing = [];
  if (!granted.includes('session.run') && AGENT_RUN_CALL.test(source)) missing.push('"session.run"');
  if (!granted.includes('session.read') && USER_SESSION_CALL.test(source)) missing.push('"session.read"');
  // Reading or observing the Mini App's own sessions works with either value.
  if (missing.length === 0 && granted.length === 0 && AGENT_OWN_SESSION_CALL.test(source)) {
    missing.push('"session.run" or "session.read"');
  }
  if (missing.length === 0) return;
  report.error(
    'ACCESS_UNDECLARED',
    `calls Agent APIs that need agentAccess ${missing.join(' and ')}; without it context.agent is absent or the calls reject with not_permitted`,
    relativePath,
  );
}
