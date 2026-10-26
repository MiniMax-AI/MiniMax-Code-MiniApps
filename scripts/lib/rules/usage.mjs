import path from 'node:path';

import { BROWSER_PERMISSION_GATE_VERSION } from '../contract.mjs';
import { collectPayloadFiles, readText } from '../fs.mjs';
import { compareVersions } from '../version.mjs';

// Files that run in the page or in Node. Declaration files (.ts) never run and are skipped.
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.htm']);

// Mini App APIs that never work without their declaration, on any client.
const API_RULES = [
  {
    pattern: /\b(?:context|miniapp)\??\.agent\??\.(?:run|answer|reply|cancel|open|models|agents|create|observe|sessions|session)\s*\(/u,
    granted: (access) => access.agent.length > 0,
    message: 'calls the Agent API but miniapp.json declares no agentAccess; context.agent is absent and page calls reject with not_permitted',
  },
  {
    pattern: /\bagent\??\.sessions\s*\(|\bagent\??\.observe\s*\(\s*\{\s*all\s*:\s*(?:true|!0)|\bagent\??\.session\s*\(\s*\)/u,
    granted: (access) => access.agent.includes('session.read'),
    message: 'lists sessions, observes every session, or reads the chat the page is open in, which needs agentAccess "session.read"; without it the call rejects with not_permitted',
  },
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
    for (const rule of API_RULES) {
      if (!rule.granted(access) && rule.pattern.test(source)) report.error('ACCESS_UNDECLARED', rule.message, relativePath);
    }
    if (!access.microphone && GET_USER_MEDIA.test(source)) reportGetUserMedia(report, relativePath, gated);
  }
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
