/**
 * Who is allowed to talk to the bridge's loopback surface.
 *
 * The surface binds loopback, so every process on the machine — and every page in
 * the user's browser — can reach the port. Two headers narrow that down to the
 * desktop surface:
 *
 * - `Host` is set by the browser from the address the page was loaded from, and
 *   the desktop surface is loaded from the bridge's own address. A hostile page
 *   that resolves its own name to the loopback address — DNS rebinding — sends
 *   its own hostname instead, and is refused.
 * - `Origin` is set by the browser from the page that made the request, and a
 *   cross-site request never carries the surface's own origin.
 *
 * Neither header is a secret, so neither is enough on its own: a local process
 * can send either one. They are what makes the per-process secret hard to get
 * hold of in the first place. Without them, a page could read `GET /api/session`
 * and then do anything the surface can do.
 */

/**
 * @typedef {object} Surface
 * @property {string} host The address the Host assigned to the bridge.
 * @property {number} port The port the Host assigned to the bridge.
 */

/**
 * @typedef {{ok: true} | {ok: false, message: string}} Verdict
 */

/**
 * Decides whether a request may be answered.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {Surface} surface
 * @returns {Verdict}
 */
export function checkCaller(request, surface) {
  const headers = request.headers ?? {};

  const host = headers['host'];
  const address = typeof host === 'string' ? parseHost(host) : null;
  if (!address) {
    return { ok: false, message: 'The request did not name the bridge.' };
  }
  if (!isAssignedHost(address.hostname, surface.host)) {
    return { ok: false, message: 'This request was not addressed to this bridge.' };
  }
  if (address.port !== surface.port) {
    return { ok: false, message: 'This request was not addressed to this bridge.' };
  }

  const origin = headers['origin'];
  if (typeof origin === 'string' && origin.length > 0) {
    // The origin has to be the origin the request was sent to. A page on
    // another origin is another page, whatever it calls itself.
    let from = null;
    try {
      from = new URL(origin);
    } catch {
      return { ok: false, message: 'This request came from somewhere else.' };
    }
    if (from.protocol !== 'http:' && from.protocol !== 'https:') {
      // `null` - an opaque origin, which is what a sandboxed page sends - and
      // `file:` are not origins a page on this surface can have.
      return { ok: false, message: 'This request came from somewhere else.' };
    }
    if (Number(from.port) !== surface.port) {
      return { ok: false, message: 'This request came from somewhere else.' };
    }
    if (normalise(from.hostname) !== normalise(address.hostname)) {
      return { ok: false, message: 'This request came from somewhere else.' };
    }
  }

  // The browser says where the request came from, and a cross-site request is
  // exactly what the two checks above are about. A repeated header is joined
  // with a comma, so the value is read as a list.
  const fetchSite = headers['sec-fetch-site'];
  if (typeof fetchSite === 'string') {
    const sites = fetchSite.split(',').map((site) => site.trim().toLowerCase());
    if (sites.includes('cross-site')) {
      return { ok: false, message: 'This request came from somewhere else.' };
    }
  }

  return { ok: true };
}

/**
 * The host and port a `Host` header names.
 *
 * @param {string} value
 * @returns {{hostname: string, port: number | null} | null}
 */
function parseHost(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;

  // An IPv6 literal: `[::1]:53378`.
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(trimmed);
  if (bracketed) {
    return {
      hostname: bracketed[1],
      port: bracketed[2] === undefined ? null : Number(bracketed[2]),
    };
  }

  const index = trimmed.lastIndexOf(':');
  if (index === -1) return { hostname: trimmed, port: null };
  const port = trimmed.slice(index + 1);
  if (!/^\d+$/.test(port)) return null;
  return { hostname: trimmed.slice(0, index), port: Number(port) };
}

/**
 * Whether a hostname names the address the Host assigned to the bridge.
 *
 * The surface is served from that address, so it is the only hostname a
 * legitimate request carries. `localhost` is accepted as well when the assigned
 * address is a loopback one, because it names the same machine.
 *
 * A name that merely *contains* a loopback address — `127.0.0.1.example.com` —
 * names somewhere else, and so does another loopback address: the bridge is
 * reachable on the one the Host assigned, not on every one.
 *
 * @param {string} hostname
 * @param {string} assigned
 * @returns {boolean}
 */
function isAssignedHost(hostname, assigned) {
  const host = normalise(hostname);
  const want = normalise(assigned);
  if (host === want) return true;
  return want !== 'localhost' && isLoopbackHost(want) && host === 'localhost';
}

/**
 * Whether a hostname names this machine.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackHost(hostname) {
  const host = normalise(hostname).replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost') return true;
  if (host === '::1') return true;
  // 127.0.0.0/8 is loopback.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * A hostname as a name, without the case.
 *
 * @param {string} hostname
 * @returns {string}
 */
function normalise(hostname) {
  return String(hostname ?? '')
    .trim()
    .toLowerCase();
}
