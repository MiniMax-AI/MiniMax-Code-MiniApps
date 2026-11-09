// @ts-check

/**
 * A small TTL cache with a caller-owned version key. A force refresh starts a
 * new generation, so its result cannot be satisfied by a request started under
 * the old credentials or the previous month.
 * @template T
 */
export class ValueCache {
  /** @param {number} ttlMs @param {() => number} [now] */
  constructor(ttlMs, now = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.generation = 0;
    /** @type {{ key: string, at: number, value: T } | null} */
    this.cached = null;
    /** @type {{ key: string, promise: Promise<T> } | null} */
    this.inFlight = null;
  }

  /**
   * @param {boolean} fresh
   * @param {() => Promise<T>} load
   * @param {string} [version]
   */
  async get(fresh, load, version = '') {
    if (fresh) {
      this.generation += 1;
      this.cached = null;
    }
    const generation = this.generation;
    const key = `${generation}:${version}`;
    if (this.cached?.key === key && this.now() - this.cached.at < this.ttlMs) return this.cached.value;
    if (this.inFlight?.key === key) return this.inFlight.promise;
    const promise = load().then((value) => {
      if (this.generation === generation) this.cached = { key, at: this.now(), value };
      return value;
    }).finally(() => {
      if (this.inFlight?.key === key) this.inFlight = null;
    });
    this.inFlight = { key, promise };
    return promise;
  }

  clear() {
    this.generation += 1;
    this.cached = null;
  }
}
