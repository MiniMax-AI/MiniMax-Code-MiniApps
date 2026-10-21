import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { ffmpegBin } from '../media-binaries';
import { spawnMediaProcess, ffmpegThreadArgs } from '../media-process';

// Only accepts rendered PCM, never a caller-provided path or URL. The Mini App
// host authentication and request-shape gate remain in front of this endpoint.
const MAX_BYTES = 512 * 1024 * 1024;
async function encode(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  if (req.headers['content-type']?.split(';')[0] !== 'audio/wav') {
    res.writeHead(415).end('需要 WAV 音频'); return;
  }
  if (Number(req.headers['content-length']) > MAX_BYTES) {
    res.writeHead(413).end('音轨超过 512 MiB，请分段导出'); return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort);
  res.once('close', abort);
  const timeout = setTimeout(abort, 5 * 60_000);
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'openchatcut-audio-')); 
    let bytes = 0;
    const input = join(directory, 'mix.wav');
    const output = join(directory, 'mix.mp3');
    await pipeline(req, new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      done(bytes > MAX_BYTES ? new Error('音轨超过 512 MiB，请分段导出') : null, chunk);
    } }), createWriteStream(input, { flags: 'wx' }), { signal: controller.signal });
    controller.signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child = spawnMediaProcess(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-nostdin',
        '-protocol_whitelist', 'file,pipe', '-f', 'wav', '-i', input, '-vn', ...ffmpegThreadArgs(),
        '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', output],
      { stdio: ['ignore', 'ignore', 'pipe'], signal: controller.signal });
      child.stderr?.resume();
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error('音频编码失败，请检查音轨后重试')));
    });
    controller.signal.throwIfAborted();
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': (await stat(output)).size });
    await pipeline(createReadStream(output), res, { signal: controller.signal });
  } catch (error) {
    if (!res.destroyed && !res.headersSent) {
      res.writeHead(422, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(controller.signal.aborted ? '导出已取消或超时' : error instanceof Error ? error.message : '音频编码失败');
    }
  } finally {
    clearTimeout(timeout);
    req.off('aborted', abort);
    res.off('close', abort);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
export function miniappAudioExportPlugin(): Plugin {
  return { name: 'miniapp-audio-export', configureServer(server) {
    server.middlewares.use('/export/audio-mp3', (req, res) => {
      void encode(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end('音频导出暂不可用'); });
    });
  } };
}
