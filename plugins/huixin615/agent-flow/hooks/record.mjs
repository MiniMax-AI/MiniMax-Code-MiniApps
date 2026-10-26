import { appendFile, mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeHookEvent } from './normalize.mjs';

const MAX_INPUT = 256 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function appendLocked(dir, line) {
  const lockPath = join(dir, 'agent-flow-events.lock');
  let lock;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      lock = await open(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - (await stat(lockPath)).mtimeMs > 10_000) await unlink(lockPath);
      } catch (staleError) {
        if (staleError?.code !== 'ENOENT') throw staleError;
      }
      await pause(25);
    }
  }
  if (!lock) return;
  try {
    const path = join(dir, 'agent-flow-events.jsonl');
    const size = await stat(path).then((info) => info.size, () => 0);
    if (size + Buffer.byteLength(line) > MAX_FILE) {
      await rename(path, join(dir, `agent-flow-events-${Date.now()}.jsonl`));
    }
    await appendFile(path, line, { mode: 0o600 });
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > MAX_INPUT) throw new Error('hook payload too large');
  }
  const row = normalizeHookEvent(JSON.parse(input));
  if (row && process.env.PLUGIN_DATA) {
    await mkdir(process.env.PLUGIN_DATA, { recursive: true });
    await appendLocked(process.env.PLUGIN_DATA, `${JSON.stringify(row)}\n`);
  }
} catch {
  // Observation must never block or change the Agent's tool call.
}
