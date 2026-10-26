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
    granted: (access) => access.microphone,
    message: 'calls speech.transcribe but miniapp.json does not declare deviceAccess ["microphone"]; every call rejects with not_permitted',
  },
];

const GET_USER_MEDIA = /\bgetUserMedia\s*\(/u;

export async function checkAccessUsage(report, { packageDir, roots, access, minimum }) {
  const gated = minimum !== undefined && compareVersions(minimum, BROWSER_PERMISSION_GATE_VERSION) >= 0;
  for (const relativePath of await collectPayloadFiles(packageDir, roots, SCANNED_EXTENSIONS)) {
    const source = await readText(path.join(packageDir, ...relativePath.split('/')));
    if (source === undefined) continue;
    checkAgentUsage(report, source, access.agent, relativePath);
    for (const rule of API_RULES) {
      if (!rule.granted(access) && rule.pattern.test(source)) report.error('ACCESS_UNDECLARED', rule.message, relativePath);
    }
    if (!access.microphone && GET_USER_MEDIA.test(source)) reportGetUserMedia(report, relativePath, gated);
  }
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

// Clients before the gate granted the microphone silently, so the call fails on every client
// that installs the package only when the package already needs a gated client.
function reportGetUserMedia(report, relativePath, gated) {
  const base = `calls getUserMedia but miniapp.json does not declare deviceAccess ["microphone"]; MiniMax Code ${BROWSER_PERMISSION_GATE_VERSION} and later deny it with NotAllowedError`;
  if (gated) {
    report.error('ACCESS_UNDECLARED', `${base}, and this package needs ${BROWSER_PERMISSION_GATE_VERSION} or later`, relativePath);
  } else {
    report.warning(
      'ACCESS_UNDECLARED',
      `${base}; it works only on clients before ${BROWSER_PERMISSION_GATE_VERSION}. Declaring deviceAccess makes the package need ${BROWSER_PERMISSION_GATE_VERSION} or later`,
      relativePath,
    );
  }
}
