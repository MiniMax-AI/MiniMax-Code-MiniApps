/**
 * Outbound WebSocket link to the relay.
 *
 * The bridge dials out, exactly like MiniMax's own Remote Control producer: a Mini App
 * can only listen on loopback, so the desktop must be the one to open the connection.
 * Reconnection uses the same escalating backoff, and every attempt presents the same
 * credential because the relay's bridge token is long-lived.
 */

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_QUEUE = 200;

/**
 * The relay address, in the form each transport needs.
 *
 * The pairing request is an HTTP POST and the frame channel is a WebSocket, but the
 * operator is given a single address and the scheme they type must not decide which
 * one works: a `wss://` address cannot be fetched — `fetch` refuses a scheme that is
 * not HTTP — and an `http://` address is not a WebSocket URL. The two are translated
 * into each other instead.
 *
 * The translations are string operations on purpose: the same rule has to hold in a
 * browser, where `URL` is not a real URL parser.
 */

const TO_HTTP = {
  'http:': 'http:',
  'https:': 'https:',
  'ws:': 'http:',
  'wss:': 'https:',
};

const TO_WS = {
  'http:': 'ws:',
  'https:': 'wss:',
  'ws:': 'ws:',
  'wss:': 'wss:',
};

/**
 * @param {string} url
 * @param {Record<string, string>} schemes
 * @returns {string}
 */
function translate(url, schemes) {
  const trimmed = String(url).trim().replace(/\/+$/, '');
  const match = /^([a-z][a-z0-9+.-]*:)/i.exec(trimmed);
  if (!match) return trimmed;
  const scheme = match[1].toLowerCase();
  const target = schemes[scheme];
  if (!target) return trimmed;
  return target + trimmed.slice(scheme.length);
}

/**
 * @typedef {object} RelayLogger
 * @property {(message: string, meta?: unknown) => void} info
 * @property {(message: string, meta?: unknown) => void} warn
 * @property {(message: string, meta?: unknown) => void} error
 * @property {(message: string, meta?: unknown) => void} debug
 */

/**
 * @typedef {object} RelayClientOptions
 * @property {string} [url] Public base URL of the relay.
 * @property {string} [accountId] Room the bridge and its phones share.
 * @property {string} [bridgeId] Stable id of this desktop.
 * @property {string} [token] HMAC token the relay accepts for this bridge.
 * @property {string} [name] Display name shown on the phone.
 * @property {RelayLogger} [logger]
 * @property {(frame: any) => void} [onFrame]
 * @property {(connected: boolean) => void} [onStatus]
 */

export class RelayClient {
  /**
   * @param {RelayClientOptions} [options]
   */
  constructor({ url, accountId, bridgeId, token, name, logger, onFrame, onStatus } = {}) {
    this.url = url;
    this.accountId = accountId;
    this.bridgeId = bridgeId;
    this.token = token;
    this.name = name ?? 'Desktop';
    this.logger = logger ?? { info() {}, warn() {}, error() {}, debug() {} };
    this.onFrame = onFrame ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.socket = null;
    this.closed = false;
    this.attempt = 0;
    /**
     * Whether a ticket was refused and the token was used instead.
     *
     * A relay whose room predates the ticket does not know what one is, so the
     * connection is tried once more with the token.
     */
    this.usedTokenFallback = false;
    this.queue = [];
    this.timer = null;
    // Lifecycle identity, not a comparison of settings: A -> B -> A is still new work.
    this.epoch = 0;
  }

  get connected() {
    return this.socket !== null && this.socket.readyState === 1;
  }

  get configured() {
    return Boolean(this.url && this.accountId && this.bridgeId && this.token);
  }

  /** The relay address as an HTTP origin, for the REST calls. */
  httpUrl() {
    return translate(this.url ?? '', TO_HTTP);
  }

  /** The relay address as a WebSocket origin, for the frame channel. */
  wsUrl() {
    return translate(this.url ?? '', TO_WS);
  }

  endpoint(ticket) {
    const base = this.wsUrl();
    const params = new URLSearchParams({
      role: 'bridge',
      subject: this.bridgeId,
      name: this.name,
    });
    // A ticket stands in for the token for one connection. Without one the token
    // rides in the URL, which is the part of a request that proxies and log
    // pipelines keep.
    if (ticket) params.set('ticket', ticket);
    else params.set('token', this.token);
    return `${base}/r/${encodeURIComponent(this.accountId)}/ws?${params.toString()}`;
  }

  /**
   * Asks the relay for a ticket for the next connection.
   *
   * The request carries the token in a header, which is the one place a
   * credential can be kept out of a URL. A relay that does not offer tickets
   * leaves the token where it was.
   *
   * @returns {Promise<string | null>}
   */
  async fetchTicket() {
    if (!this.configured) return null;
    const base = this.httpUrl();
    try {
      const response = await fetch(`${base}/r/${encodeURIComponent(this.accountId)}/ws-ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}` },
      });
      if (!response.ok) return null;
      const body = /** @type {{ticket?: string}} */ (await response.json());
      return typeof body?.ticket === 'string' ? body.ticket : null;
    } catch {
      return null;
    }
  }

  start() {
    this.resetConnection();
    this.closed = false;
    if (!this.configured) {
      this.logger.warn('relay is not configured yet');
      return;
    }
    this.connect();
  }

  /** Invalidates pending HTTP work, socket events and retry callbacks together. */
  resetConnection() {
    this.epoch += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.closeSocket();
  }

  /**
   * Replaces the connection settings and connects again.
   *
   * The socket that was open against the old address is closed on purpose. Its close
   * event belongs to a socket this client has already let go of, and the guard in the
   * close handler makes it a no-op, so it cannot clear the socket that replaced it.
   *
   * @param {{url: string, accountId: string, bridgeId: string, token: string, name: string}} settings
   */
  reconfigure(settings) {
    // A token refresh keeps offline frames; a different destination/subject does not.
    if (this.identity() !== this.identity(settings)) this.queue = [];
    this.url = settings.url;
    this.accountId = settings.accountId;
    this.bridgeId = settings.bridgeId;
    this.token = settings.token;
    this.name = settings.name ?? this.name;
    // The new relay may be a different relay, and it may well know what a ticket is.
    this.usedTokenFallback = false;
    this.attempt = 0;
    this.start();
  }

  /** @param {{url?: string, accountId?: string, bridgeId?: string}} [settings] */
  identity(settings = this) {
    let base = translate(settings.url ?? '', TO_HTTP);
    try { base = new URL(base).href.replace(/\/+$/, ''); } catch { /* unconfigured */ }
    return JSON.stringify([base, settings.accountId, settings.bridgeId]);
  }

  /**
   * Closes the socket that is open, if there is one.
   *
   * The reference is taken before the socket is closed, so the close event that
   * follows finds a client that has already let this socket go.
   */
  closeSocket() {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      /* already gone */
    }
  }

  stop() {
    this.closed = true;
    this.resetConnection();
    this.onStatus(false);
  }

  connect() {
    if (this.closed) return;
    const WebSocketImpl = globalThis.WebSocket;
    if (!WebSocketImpl) {
      this.logger.error('this runtime has no WebSocket client');
      return;
    }
    // The socket is opened with a ticket when the relay offers one, so the
    // long-lived token does not travel in the URL.
    void this.open(WebSocketImpl);
  }

  /**
   * Opens the socket, with a ticket for the connection when there is one.
   *
   * @param {typeof WebSocket} WebSocketImpl
   */
  async open(WebSocketImpl) {
    const epoch = this.epoch;
    const ticket = await this.fetchTicket();
    if (this.closed || epoch !== this.epoch) return;
    this.openSocket(WebSocketImpl, ticket, epoch);
  }

  /**
   * Opens the socket, with a ticket for the connection when there is one.
   *
   * @param {typeof WebSocket} WebSocketImpl
   * @param {string | null} ticket
   * @param {number} [epoch]
   */
  openSocket(WebSocketImpl, ticket, epoch = this.epoch) {
    if (this.closed || epoch !== this.epoch) return;
    let socket;
    try {
      socket = new WebSocketImpl(this.endpoint(ticket));
    } catch (error) {
      // WebSocket errors can include their URL, which may carry a token or ticket.
      this.logger.error('relay connection failed');
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    let opened = false;
    const current = () => !this.closed && epoch === this.epoch && this.socket === socket;

    socket.addEventListener('open', () => {
      if (!current()) return;
      opened = true;
      this.attempt = 0;
      this.onStatus(true);
      if (current()) this.flush();
    });

    socket.addEventListener('message', (event) => {
      if (!current()) return;
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      try {
        this.onFrame(JSON.parse(raw));
      } catch {
        this.logger.warn('relay sent a frame that is not valid JSON');
      }
    });

    socket.addEventListener('close', () => {
      // A close event belongs to the socket it came from. If this client has already
      // let that socket go - because the relay configuration changed and the socket
      // was closed on purpose - the event is about a connection that is no longer
      // this client's, and it must not clear the socket that replaced it.
      if (!current()) return;
      this.socket = null;
      this.onStatus(false);
      if (this.closed || epoch !== this.epoch) return;
      // A connection that was refused before it opened, and that carried a
      // ticket, is tried once more with the token: a relay whose room predates
      // the ticket does not know what one is.
      if (!opened && ticket && !this.usedTokenFallback) {
        this.usedTokenFallback = true;
        this.logger.info('the relay refused the ticket; trying the token');
        this.openSocket(WebSocketImpl, null, epoch);
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // `close` always follows, so the reconnect is scheduled there.
    });
  }

  scheduleReconnect() {
    if (this.closed || this.timer) return;
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    const jitter = Math.floor(Math.random() * 400);
    this.attempt += 1;
    const delay = base + jitter;
    this.logger.info(`reconnecting to the relay in ${delay} ms`);
    const epoch = this.epoch;
    const timer = setTimeout(() => {
      if (this.closed || epoch !== this.epoch || this.timer !== timer) return;
      this.timer = null;
      this.connect();
    }, delay);
    this.timer = timer;
    if (typeof this.timer?.unref === 'function') this.timer.unref();
  }

  /** Sends a frame. Frames queued while offline are flushed on reconnect. */
  send(frame) {
    const raw = JSON.stringify(frame);
    if (this.connected) {
      try {
        this.socket.send(raw);
        return true;
      } catch {
        /* fall through to the queue */
      }
    }
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
    }
    this.queue.push(raw);
    return false;
  }

  flush() {
    const pending = this.queue;
    this.queue = [];
    for (const raw of pending) {
      try {
        this.socket?.send(raw);
      } catch {
        this.queue.push(raw);
      }
    }
  }

  /**
   * Asks the relay for a pairing code.
   *
   * The code is shown on the desktop and typed into the phone. It is single use and
   * short-lived, so it is never persisted by the bridge.
   *
   * @returns {Promise<{ code: string, expiresAt: number }>}
   */
  async createPairingCode() {
    if (!this.configured) {
      throw new Error('The relay is not configured yet.');
    }
    const base = this.httpUrl();
    const response = await fetch(`${base}/r/${encodeURIComponent(this.accountId)}/pair/code`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ bridgeId: this.bridgeId, bridgeName: this.name }),
    });
    if (!response.ok) {
      throw new Error(`The relay refused the pairing request (${response.status}).`);
    }
    const body = /** @type {{ code: string, expiresAt: number }} */ (await response.json());
    return body;
  }

  /** Lists the devices paired with this bridge. */
  async listDevices() {
    if (!this.configured) return [];
    const base = this.httpUrl();
    const response = await fetch(`${base}/r/${encodeURIComponent(this.accountId)}/devices`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) return [];
    const body = /** @type {{devices?: unknown}} */ (await response.json());
    return Array.isArray(body.devices) ? body.devices : [];
  }

  /** Revokes a paired device. */
  async revokeDevice(deviceId) {
    if (!this.configured) return false;
    const base = this.httpUrl();
    const response = await fetch(
      `${base}/r/${encodeURIComponent(this.accountId)}/devices/revoke`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      },
    );
    return response.ok;
  }

  /**
   * Asks the relay for a fresh token.
   *
   * The relay signs it — it holds the shared secret — and every older bridge token
   * for this account stops working at the same moment. That is what makes a leaked
   * token revocable: it is not enough to change the token, the old one has to die.
   *
   * @param {{commit?: boolean}} [options] Bridge defers installation until persistence commits.
   * @returns {Promise<string>} the new token
   */
  async rotateToken({ commit = true } = {}) {
    if (!this.configured) throw new Error('the relay is not configured');
    const epoch = this.epoch;
    const token = this.token;
    const assertCurrent = () => {
      if (epoch !== this.epoch || token !== this.token) {
        throw new Error('The relay configuration changed during token rotation.');
      }
    };
    const base = this.httpUrl();
    let response;
    try {
      response = await fetch(
        `${base}/r/${encodeURIComponent(this.accountId)}/bridge/token`,
        { method: 'POST', headers: { authorization: `Bearer ${token}` } },
      );
    } catch {
      assertCurrent();
      throw new Error('The relay token rotation request failed.');
    }
    assertCurrent();
    if (!response.ok) {
      throw new Error(`The relay refused the token rotation (${response.status}).`);
    }
    let body;
    try {
      body = /** @type {{token?: string}} */ (await response.json());
    } catch {
      assertCurrent();
      // JSON parser errors may quote the response, including its credential.
      throw new Error('The relay did not return a valid token.');
    }
    assertCurrent();
    if (typeof body?.token !== 'string' || !body.token) throw new Error('The relay did not return a token.');
    if (commit) this.token = body.token;
    return body.token;
  }

  /**
   * When the current token expires, epoch ms — or null when that cannot be read.
   *
   * The token is signed, not encrypted: its payload is readable, so the bridge can
   * tell that the token is about to run out without asking anyone.
   *
   * @returns {number | null}
   */
  tokenExpiresAt() {
    if (!this.token) return null;
    const [body] = this.token.split('.');
    if (!body) return null;
    try {
      const padded = body.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
      return typeof payload.exp === 'number' ? payload.exp : null;
    } catch {
      return null;
    }
  }
}
