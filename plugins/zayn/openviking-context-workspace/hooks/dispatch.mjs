#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const EVENT_SCRIPTS = {
  Stop: {
    claude: join(ROOT, 'claude', 'auto-capture.mjs'),
    codex: join(ROOT, 'codex', 'auto-capture.mjs'),
  },
  PreCompact: {
    claude: join(ROOT, 'claude', 'pre-compact.mjs'),
    codex: join(ROOT, 'codex', 'pre-compact-capture.mjs'),
  },
  SessionEnd: {
    claude: join(ROOT, 'claude', 'session-end.mjs'),
    codex: join(ROOT, 'codex', 'session-end.mjs'),
  },
};

const eventName = process.argv[2] || '';
const scripts = EVENT_SCRIPTS[eventName];
if (!scripts) process.exit(0);

const input = await readStdin();
const payload = parseJson(input);
const flavor = await detectFlavor(payload);
const child = spawn(process.execPath, [scripts[flavor]], {
  env: {
    ...process.env,
    OPENVIKING_MEMORY_ENABLED: process.env.OPENVIKING_MEMORY_ENABLED || '1',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});
child.stdin.end(input);
child.stdout.pipe(process.stdout);
child.once('error', () => process.exit(0));
child.once('exit', (code) => process.exit(code ?? 0));

async function detectFlavor(payload) {
  const explicit = String(process.env.OPENVIKING_MINIMAX_HOOK_FLAVOR || '').toLowerCase();
  if (explicit === 'claude' || explicit === 'codex') return explicit;

  const surface = String(
    payload?.client
      || payload?.client_type
      || payload?.surface
      || payload?.runtime
      || '',
  ).toLowerCase();
  if (surface.includes('codex')) return 'codex';
  if (surface.includes('claude')) return 'claude';

  const transcriptPath = typeof payload?.transcript_path === 'string'
    ? payload.transcript_path
    : '';
  if (!transcriptPath) return 'claude';
  try {
    const transcript = await readFile(transcriptPath, 'utf8');
    for (const line of transcript.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const record = parseJson(Buffer.from(line));
      const type = String(record?.type || '');
      if (['session_meta', 'event_msg', 'response_item', 'turn_context', 'history_mutation', 'turn_item'].includes(type)) {
        return 'codex';
      }
      if (['user', 'assistant', 'system'].includes(type) || record?.message?.role) {
        return 'claude';
      }
    }
  } catch {
    // The hook runtime will handle a missing or unreadable transcript as a no-op.
  }
  return 'claude';
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return {};
  }
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', () => resolve(Buffer.from('{}')));
  });
}
