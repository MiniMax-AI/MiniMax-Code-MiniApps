// @ts-check
// 持久化：只写 context.dataDir。每个文件带版本号，先写临时文件再改名。
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { yieldNow } from './util.mjs';

/**
 * @param {{ fs: any, dataDir: string, logger: { warn(m: string, f?: any): void } }} o
 */
export function createStore(o) {
  const { fs, dataDir, logger } = o;
  /** @type {Map<string, Promise<void>>} */
  const chains = new Map();
  const full = (/** @type {string} */ name) => path.join(dataDir, name);

  /** @param {string} name @param {Buffer | string} data */
  async function writeAtomic(name, data) {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = full(`${name}.tmp`);
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, full(name));
  }

  /** 同一个文件的写入排队执行，数据在轮到它时再生成，保证写的是最新状态。 @param {string} name @param {() => Promise<void>} fn */
  function queue(name, fn) {
    const prev = chains.get(name) || Promise.resolve();
    const next = prev.then(fn).catch((e) => {
      logger.warn('persist.write_failed', { code: (e && e.code) || 'error' });
    });
    chains.set(name, next);
    return next;
  }

  return {
    /** @param {string} name @param {number} version */
    async readJSON(name, version) {
      try {
        const obj = JSON.parse(await fs.readFile(full(name), 'utf8'));
        return obj && obj.version === version ? obj : null;
      } catch (e) {
        if (/** @type {any} */ (e).code !== 'ENOENT') logger.warn('persist.read_failed', { code: /** @type {any} */ (e).code || 'parse' });
        return null;
      }
    },
    /** @param {string} name @param {() => any} build */
    writeJSON(name, build) {
      return queue(name, () => writeAtomic(name, JSON.stringify(build())));
    },
    /**
     * 流式写入 gzip 压缩的 NDJSON：逐行写、遵守背压、每隔几行让出事件循环。
     * @param {string} name @param {() => Iterable<string>} lines
     */
    writeLines(name, lines) {
      return queue(name, async () => {
        await fs.mkdir(dataDir, { recursive: true });
        const tmp = full(`${name}.tmp`);
        await new Promise((resolve, reject) => {
          const out = createWriteStream(tmp);
          const gz = zlib.createGzip({ level: 6 });
          gz.on('error', reject);
          out.on('error', reject);
          out.on('finish', () => resolve(undefined));
          gz.pipe(out);
          (async () => {
            let n = 0;
            for (const line of lines()) {
              if (!gz.write(`${line}\n`)) await once(gz, 'drain');
              n += 1;
              if (n % 20 === 0) await yieldNow();
            }
            gz.end();
          })().catch((e) => {
            gz.destroy();
            reject(e);
          });
        });
        await fs.rename(tmp, full(name));
      });
    },
    /**
     * 逐行读取 gzip 压缩的 NDJSON。文件不存在时返回 null。
     * @template T @param {string} name @param {(lines: AsyncIterable<string>) => Promise<T>} consume
     * @returns {Promise<T | null>}
     */
    async readLines(name, consume) {
      try {
        await fs.access(full(name));
      } catch {
        return null;
      }
      const input = createReadStream(full(name));
      const gunzipStream = zlib.createGunzip();
      const rl = readline.createInterface({ input: input.pipe(gunzipStream), crlfDelay: Infinity });
      try {
        return await consume(rl);
      } catch (e) {
        logger.warn('persist.read_failed', { code: /** @type {any} */ (e).code || 'parse' });
        return null;
      } finally {
        rl.close();
        input.destroy();
        gunzipStream.destroy();
      }
    },
    async flush() {
      await Promise.all([...chains.values()]);
    },
  };
}
