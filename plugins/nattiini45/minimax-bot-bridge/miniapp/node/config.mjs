import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writePrivateFile } from './private-file.mjs';

const CONFIG_FILE = 'bridge-config.json';

/**
 * The file the bridge token lives in.
 *
 * The token is a credential for the account's room and it is not revocable on
 * its own, so it does not share a file with the relay address: a file that is
 * copied around - into a backup, into a support bundle - carries the address
 * and not the credential.
 */
const TOKEN_FILE = 'bridge-token';

/**
 * @typedef {object} BridgeConfig
 * @property {string} relayUrl Public base URL of the relay, e.g. `wss://relay.example.workers.dev`.
 * @property {string} accountId Room the bridge and its phones share.
 * @property {string} bridgeId Stable id of this desktop.
 * @property {string} bridgeToken HMAC token the relay accepts for this bridge.
 * @property {string} bridgeName Display name shown on the phone.
 * @property {Record<string, 'team' | 'hosted'>} [botModes] Where each Bot's turns run.
 */

/**
 * Loads the bridge configuration.
 *
 * The bridge id is generated once and persisted, because the relay pairs a phone against
 * a specific desktop and the phone must be able to find it again after a restart.
 *
 * @param {string} dataDir
 * @param {Partial<BridgeConfig>} [overrides]
 * @returns {Promise<BridgeConfig>}
 */
export async function loadConfig(dataDir, overrides = {}) {
  await mkdir(dataDir, { recursive: true });
  const file = join(dataDir, CONFIG_FILE);

  let stored = {};
  try {
    stored = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    stored = {};
  }

  // The token used to share the configuration file. It has a file of its own now,
  // written for its owner only, and a configuration that still carries it is
  // moved.
  const hadLegacyToken = Object.hasOwn(stored, 'bridgeToken');
  const legacyToken = typeof stored.bridgeToken === 'string' ? stored.bridgeToken : '';
  delete stored.bridgeToken;

  let fileToken = '';
  try {
    fileToken = (await readFile(join(dataDir, TOKEN_FILE), 'utf8')).trim();
  } catch {
    fileToken = '';
  }
  const movedToken = !fileToken && Boolean(legacyToken);
  if (movedToken) {
    fileToken = legacyToken;
    await writePrivateFile(join(dataDir, TOKEN_FILE), fileToken);
  }

  const config = {
    relayUrl: overrides.relayUrl ?? stored.relayUrl ?? '',
    accountId: overrides.accountId ?? stored.accountId ?? 'default',
    bridgeId: overrides.bridgeId ?? stored.bridgeId ?? '',
    bridgeToken: overrides.bridgeToken ?? fileToken,
    bridgeName: overrides.bridgeName ?? stored.bridgeName ?? 'Desktop',
    botModes: { ...(stored.botModes ?? {}) },
  };

  // A relay address that is not one the bridge may use is not used at all. The
  // bridge holds the long-lived token, so it never presents it to an address it
  // cannot vouch for; the desktop is left unconfigured instead, which is the
  // state a fresh install is in anyway.
  if (config.relayUrl && !isAllowedRelayUrl(config.relayUrl)) {
    config.relayUrl = '';
  }

  if (!config.bridgeId) {
    config.bridgeId = `bridge_${randomId()}`;
    await saveConfig(dataDir, config);
  } else if (hadLegacyToken) {
    // Cleanup must also recover an interrupted migration where bridge-token was
    // already written. Never replace that authoritative file with the residue.
    const { bridgeToken, ...publicConfig } = config;
    await writePrivateFile(file, `${JSON.stringify(publicConfig, null, 2)}\n`);
  }

  return config;
}

/**
 * @param {string} dataDir
 * @param {BridgeConfig} config
 * @returns {Promise<void>}
 */
export async function saveConfig(dataDir, config) {
  await mkdir(dataDir, { recursive: true });
  const { bridgeToken, ...rest } = config;
  await writePrivateFile(join(dataDir, CONFIG_FILE), `${JSON.stringify(rest, null, 2)}\n`);
  if (bridgeToken) {
    await writePrivateFile(join(dataDir, TOKEN_FILE), bridgeToken);
  }
}

/**
 * The scheme each transport uses, so that one relay address names one relay.
 *
 * The frame channel is a WebSocket and the pairing request is an HTTP POST, and the
 * operator is given a single address. `wss://` and `https://` therefore name the
 * same relay, and the token it carries must not be able to travel from one to the
 * other unnoticed.
 */
const TO_HTTP = {
  'http:': 'http:',
  'https:': 'https:',
  'ws:': 'http:',
  'wss:': 'https:',
};

/**
 * The origin of a relay address, in its HTTP form, or `''` when the address is
 * not a relay address.
 *
 * Two addresses with the same origin are the same relay, so a token minted for one
 * of them is a token for the other.
 *
 * @param {string} value
 * @returns {string}
 */
export function relayOrigin(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  const match = /^([a-z][a-z0-9+.-]*:)/i.exec(trimmed);
  if (!match) return '';
  const scheme = match[1].toLowerCase();
  const target = TO_HTTP[scheme];
  if (!target) return '';
  try {
    return new URL(target + trimmed.slice(scheme.length)).origin;
  } catch {
    return '';
  }
}

/**
 * Whether the bridge may talk to this relay address.
 *
 * The bridge holds the long-lived bridge token, so it is strict about where that
 * token goes. A secure relay is fine wherever it is; a cleartext one is only the
 * relay on this machine, because anything else on the network would read the token
 * off the wire. A LAN address, a link-local address and a metadata address are all
 * refused: they are the addresses that are reachable but not meant to be trusted.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isAllowedRelayUrl(value) {
  const trimmed = String(value ?? '').trim();
  const match = /^([a-z][a-z0-9+.-]*:)/i.exec(trimmed);
  if (!match) return false;
  const scheme = match[1].toLowerCase();

  if (scheme === 'https:' || scheme === 'wss:') {
    try {
      new URL(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  if (scheme !== 'http:' && scheme !== 'ws:') return false;

  // Cleartext is the local relay and nothing else.
  try {
    return isLoopbackHost(new URL(trimmed).hostname);
  } catch {
    return false;
  }
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost') return true;
  if (host === '::1') return true;
  // 127.0.0.0/8 is loopback.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function randomId() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return Math.floor(Math.random() * 0xffffffffffff).toString(16);
}
