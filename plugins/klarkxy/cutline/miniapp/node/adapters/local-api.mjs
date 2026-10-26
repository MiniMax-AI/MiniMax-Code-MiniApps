// @ts-check
// The editor's REST API, called in-process.
//
// The upstream MCP tools reach the editor over HTTP on 127.0.0.1:7777. In this
// Mini App the editor and the tools live in the same process, on the one port
// the Host assigns — a port the Host guards with a per-run credential. So the
// tools must not talk to that port over a socket: they call the editor's own
// request handler directly, with a synthetic request and response.
//
// Nothing here changes what an endpoint does: the same handler answers the
// same JSON for the browser and for a tool.

import { Readable, Writable } from 'node:stream';

/**
 * Marks a request that came from this transport rather than from the network.
 *
 * A header would not do: the page is same-origin, so it can set any header it
 * likes. A well-known symbol cannot be forged from outside the process, so the
 * editor can tell "the local MCP transport" from "the page asked nicely".
 */
export const LOCAL_REQUEST = Symbol.for('fablecut.localRequest');

/** How long a handler may take to end its response. */
const RESPONSE_GRACE_MS = 2000;

/**
 * The response the editor's handler writes into. It is a real Writable, so a
 * route that pipes a file into it (the media and library routes) still works.
 */
class CapturedResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    /** @type {Record<string, string>} */
    this.headers = {};
    /** @type {Buffer[]} */
    this.chunks = [];
    this.headersSent = false;
  }

  /**
   * @param {number} status
   * @param {Record<string, string | number>} [headers]
   */
  writeHead(status, headers) {
    this.statusCode = status;
    this.headersSent = true;
    for (const [key, value] of Object.entries(headers ?? {})) {
      this.headers[key.toLowerCase()] = String(value);
    }
    return this;
  }

  /** @param {string} name @param {string | number} value */
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }

  /** @param {string} name */
  getHeader(name) {
    return this.headers[name.toLowerCase()];
  }

  /** @param {string} name */
  removeHeader(name) {
    delete this.headers[name.toLowerCase()];
  }

  /**
   * @param {Buffer | string} chunk
   * @param {BufferEncoding} _encoding
   * @param {(error?: Error | null) => void} callback
   */
  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }
}

/**
 * @param {string} method
 * @param {string} urlPath
 * @param {unknown} payload
 * @param {Record<string, string>} headers
 * @param {string} authority
 */
function makeRequest(method, urlPath, payload, headers, authority) {
  const body =
    payload === undefined || payload === null
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(payload), 'utf8');
  const request = new Readable({
    read() {
      if (body.length) this.push(body);
      this.push(null);
    },
  });
  request.method = method;
  request.url = urlPath;
  request.headers = {
    host: authority,
    'content-type': 'application/json',
    'content-length': String(body.length),
    ...headers,
  };
  // Not a header: the page cannot set a symbol on a request it never sees.
  request[LOCAL_REQUEST] = true;
  return request;
}

/**
 * @param {string} url
 * @returns {string}
 */
function pathOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The transport the upstream MCP tools use. It replaces their HTTP client with
 * a call into the editor's request handler.
 *
 * @param {{
 *   handleRequest: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<void>,
 *   authority: string,
 * }} options
 */
export function createLocalApi({ handleRequest, authority }) {
  /**
   * @param {string} method
   * @param {string} urlPath
   * @param {unknown} payload
   * @param {Record<string, string>} [headers]
   */
  async function dispatch(method, urlPath, payload, headers) {
    const request = makeRequest(method, urlPath, payload, headers ?? {}, authority);
    const response = new CapturedResponse();

    // Attach before the handler runs: a handler that pipes a file, or waits on
    // a child process, can end its response after it has returned.
    const finished = new Promise((resolve) => {
      response.once('finish', () => resolve(true));
      response.once('error', () => resolve(false));
    });

    await handleRequest(request, /** @type {any} */ (response));

    // Give a handler that scheduled its ending a bounded moment to land it.
    await Promise.race([finished, delay(RESPONSE_GRACE_MS)]);

    return {
      status: response.statusCode,
      headers: response.headers,
      body: Buffer.concat(response.chunks),
    };
  }

  return {
    /**
     * @param {string} method
     * @param {string} urlPath
     * @param {unknown} [payload]
     * @param {Record<string, string>} [headers]
     */
    async json(method, urlPath, payload, headers) {
      const { status, body: buffer } = await dispatch(method, urlPath, payload, headers);
      const text = buffer.toString('utf8');
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { error: text };
      }
      return { status, body };
    },
    /**
     * A binary answer — the frame route answers with a JPEG.
     *
     * @param {string} urlPath
     */
    async bytes(urlPath) {
      const { status, headers, body } = await dispatch('GET', urlPath, undefined, {
        'x-fablecut-client': 'mcp',
      });
      return { status, headers, body };
    },
    /** @param {string} url */
    async ok(url) {
      const { status } = await dispatch('GET', pathOf(url), undefined, undefined);
      return status < 500;
    },
  };
}
