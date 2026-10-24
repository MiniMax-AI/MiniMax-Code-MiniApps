// @ts-check
// 紧凑的 64 位哈希集合（开放寻址，两个 Uint32Array），用于去重：
//   目录：同一 dev + ino 从两条路径到达时只算一次；
//   硬链接：同一 dev + ino 的文件只算一次；
//   APFS 克隆（仅 macOS）：dev + 逻辑大小 + 纳秒级 mtime + 纳秒级 birthtime 相同的文件只算一次。
// 每个槽 8 字节，比 Map/Set 存数字省一个数量级的内存。64 位哈希在千万级条目下误判概率约百万分之几。

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** @param {number} h @param {number} x */
function mix(h, x) {
  let k = Math.imul(x, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  let r = h ^ k;
  r = (r << 13) | (r >>> 19);
  return (Math.imul(r, 5) + 0xe6546b64) | 0;
}

/** @param {number} h */
function fmix(h) {
  let r = h ^ (h >>> 16);
  r = Math.imul(r, 0x85ebca6b);
  r ^= r >>> 13;
  r = Math.imul(r, 0xc2b2ae35);
  r ^= r >>> 16;
  return r >>> 0;
}

/** @param {number} [initialBits] */
export function createKeySet(initialBits = 16) {
  let bits = initialBits;
  let cap = 1 << bits;
  let mask = cap - 1;
  let a = new Uint32Array(cap);
  let b = new Uint32Array(cap);
  let count = 0;
  let h1 = 0;
  let h2 = 0;

  /** @param {number} v */
  function feed(v) {
    f64[0] = v;
    h1 = mix(h1, u32[0]);
    h1 = mix(h1, u32[1]);
    h2 = mix(h2, u32[1] ^ 0x9e3779b9);
    h2 = mix(h2, u32[0] ^ 0x7f4a7c15);
  }

  /** 固定 4 个参数，避免每次调用分配数组。 @param {number} v0 @param {number} v1 @param {number} v2 @param {number} v3 */
  function hash(v0, v1, v2, v3) {
    h1 = 0x9747b28c;
    h2 = 0x5bd1e995;
    feed(v0);
    feed(v1);
    feed(v2);
    feed(v3);
    h1 = (fmix(h1) | 1) >>> 0; // 0 表示空槽；>>> 0 保持无符号，和 Uint32Array 里读出的值可比
    h2 = fmix(h2);
  }

  function grow() {
    const oa = a;
    const ob = b;
    bits += 1;
    cap = 1 << bits;
    mask = cap - 1;
    a = new Uint32Array(cap);
    b = new Uint32Array(cap);
    for (let i = 0; i < oa.length; i += 1) {
      if (oa[i] === 0) continue;
      let j = ob[i] & mask;
      while (a[j] !== 0) j = (j + 1) & mask;
      a[j] = oa[i];
      b[j] = ob[i];
    }
  }

  return {
    /**
     * 加入一个键（最多 4 个数字，不用的传 0）。第一次见到返回 true，已经存在返回 false。
     * @param {number} v0 @param {number} v1 @param {number} [v2] @param {number} [v3]
     */
    add(v0, v1, v2 = 0, v3 = 0) {
      hash(v0, v1, v2, v3);
      let i = h2 & mask;
      while (a[i] !== 0) {
        if (a[i] === h1 && b[i] === h2) return false;
        i = (i + 1) & mask;
      }
      a[i] = h1;
      b[i] = h2;
      count += 1;
      if (count > cap * 0.6) grow();
      return true;
    },
    get size() {
      return count;
    },
    get bytes() {
      return cap * 8;
    },
  };
}

/** @typedef {ReturnType<typeof createKeySet>} KeySet */
