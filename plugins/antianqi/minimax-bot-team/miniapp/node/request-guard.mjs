// @ts-check

/**
 * The cross-site gate of the Mini App server.
 *
 * The server listens on the loopback interface, so every process on the machine can reach
 * it - and so can a web page in the user's browser. A script on another origin may send a
 * "simple" request: the browser will not let the page read the answer, but the server
 * still carries the request out. Writing a Bot's AGENTS.md is a lasting change to what
 * that Bot believes, so a page that can do it can plant an instruction in the user's team.
 *
 * The Host guards this surface on its own: it issues a token per launch, adds it to the
 * requests of the Mini App's own tab, and refuses every request that arrives without it
 * before the plugin sees it. The Host strips that token before the request reaches plugin
 * code, so a plugin cannot check it - and does not have to. This gate is the second line:
 * it holds when the server runs without the Host's guard, on an older Host, or in a test
 * harness.
 *
 * Two signals are read, because neither alone is enough:
 *   - "Sec-Fetch-Site" names the relation between the page and the request.
 *   - "Origin" carries the origin a state-changing request came from.
 *
 * A request with neither header did not come from a browser - the Host's own MCP client
 * and any local script - and passes.
 */

/** The host names that mean "this machine". */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

/** The fetch metadata a browser sends for a request it made itself. */
const SAME_SITE = new Set(['same-origin', 'none']);

/**
 * One header value.
 * @param {import('node:http').IncomingMessage} request
 * @param {string} name
 * @returns {string | undefined}
 */
function header(request, name) {
  const value = request.headers?.[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

/**
 * A host name without its port.
 * @param {string | undefined} value
 * @returns {string}
 */
export function hostName(value) {
  const host = String(value ?? '').trim().toLowerCase();
  if (!host) return '';
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.replace(/:\d+$/, '');
}

/**
 * Why the request must be refused because it came from another site, or null.
 * @param {import('node:http').IncomingMessage} request
 * @returns {string | null}
 */
export function crossSiteReason(request) {
  const site = header(request, 'sec-fetch-site')?.trim().toLowerCase();
  if (site && !SAME_SITE.has(site)) return 'sec-fetch-site: ' + site;
  const origin = header(request, 'origin');
  if (!origin || origin === 'null') return null;
  let host = '';
  try {
    host = hostName(new URL(origin).host);
  } catch {
    return 'origin: unreadable';
  }
  if (!host) return 'origin: unreadable';
  if (LOOPBACK_HOSTS.has(host)) return null;
  return 'origin: ' + host;
}

/**
 * Why the request must be refused because it addressed the server under a name that does
 * not belong to this machine, or null.
 *
 * A page on another origin whose DNS points at 127.0.0.1 is same-origin with itself, so
 * it sends no "Origin" header and reports "Sec-Fetch-Site: same-origin". The host name in
 * the request is the one thing left that tells the two apart, and the Host's own guard
 * refuses every request whose "Host" is not the loopback address it listens on.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {{ allowedHosts?: string[] }} [options]
 * @returns {string | null}
 */
export function foreignHostReason(request, options = {}) {
  const allowed = new Set([...LOOPBACK_HOSTS, ...(options.allowedHosts ?? []).map(hostName).filter(Boolean)]);
  const host = hostName(header(request, 'host'));
  if (!host) return null;
  if (allowed.has(host)) return null;
  return 'host: ' + host;
}

/**
 * The one reason a request may not be carried out, or null when it may.
 * @param {import('node:http').IncomingMessage} request
 * @param {{ allowedHosts?: string[] }} [options]
 * @returns {string | null}
 */
export function guardReason(request, options = {}) {
  return crossSiteReason(request) ?? foreignHostReason(request, options);
}
