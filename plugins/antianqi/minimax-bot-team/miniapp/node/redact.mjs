// @ts-check

/**
 * The shapes a secret takes, in one place.
 *
 * Two tiers, because the two callers want different things:
 *   - SECRET_PATTERNS are shapes no honest message carries. A value that matches one is
 *     masked wherever it is written, and refused in a memory.
 *   - STRICT_PATTERNS are shapes a message may well carry - a 32 character hex digest, a
 *     long base64 blob, an ID number. Masking those would corrupt real content, so a
 *     memory refuses them outright and a message leaves them alone.
 */

/** What a masked value looks like in a file. */
export const REDACTED = '[REDACTED]';

/**
 * One shape of a secret: the pattern, the flags it needs, and whether it names the key
 * it belongs to - a shape that does keeps the key readable while the value goes.
 */
const SHAPES = [
  {
    source: '(password|passwd|密码|口令|api[_ -]?key|secret|token|私钥)(\\s*[:：=是为]\\s*)(\\S+)',
    flags: 'i',
    keepKey: true,
  },
  { source: '\\b(sk|pk|rk|ak)-[A-Za-z0-9_-]{12,}', flags: '' },
  { source: '\\bgh[pousr]_[A-Za-z0-9]{20,}', flags: '' },
  { source: '\\bAKIA[0-9A-Z]{16}\\b', flags: '' },
  { source: '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}', flags: '' },
];

/**
 * The high-confidence shapes, without the global flag: "test" on a global pattern carries
 * a position from the last call and would answer differently the second time.
 */
export const SECRET_PATTERNS = SHAPES.map((shape) => new RegExp(shape.source, shape.flags));

/** The shapes a message may carry, so a memory refuses them and a message leaves them. */
export const STRICT_PATTERNS = [
  /\b[A-Fa-f0-9]{32,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}/,
  /\b\d{17}[\dXx]\b/,
];

/**
 * The text with every secret value masked. The name of a key stays readable; the value
 * does not.
 * @param {string} text
 * @returns {string}
 */
export function redactText(text) {
  let out = String(text ?? '');
  for (const shape of SHAPES) {
    const pattern = new RegExp(shape.source, shape.flags + 'g');
    out = out.replace(pattern, (all, first, second) => {
      if (!shape.keepKey) return REDACTED;
      return first + second + REDACTED;
    });
  }
  return out;
}

/**
 * Every string in the value, masked. The object is changed where it stands, so the copy
 * the caller keeps and the copy that is written are one and the same.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function redactInPlace(value) {
  if (typeof value === 'string') return /** @type {any} */ (redactText(value));
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = redactInPlace(value[index]);
    }
    return value;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') value[key] = redactText(item);
      else redactInPlace(item);
    }
    return value;
  }
  return value;
}
