// @ts-check

import { configFromRaw, getConfigPath, parseConfigFile, readRawConfig } from './config.mjs';
import { credentialsPath, readCredentials, saveCredentials } from './credentials.mjs';

/**
 * Resolve the credential and host list from one read of each store.
 *
 * The plugin's own login wins. A credential already present in the CLI config
 * is a fallback and stays read-only: it is never rewritten or refreshed, so a
 * rotation here cannot invalidate the CLI's own session.
 * @param {string} dataDir
 * @returns {Promise<{ ok: true, config: ReturnType<typeof configFromRaw>, credentials: Record<string, unknown> | null, apiKey: string | undefined } | { ok: false, code: string }>}
 */
export async function loadQuotaConfig(dataDir) {
  const stored = await readCredentials(dataDir);
  // A damaged credential file is only this package's login cache. Ignore it
  // and let the panel login replace it, rather than blocking a CLI credential.
  const plugin = stored.ok ? stored : { oauth: null, region: null };
  const cli = await readRawConfig();
  if (!cli.ok && !plugin.oauth) return cli;
  const raw = cli.ok ? cli.raw : {};
  const file = parseConfigFile(raw);
  /** @type {Record<string, unknown> | null} */
  let credentials = null;
  if (plugin.oauth) {
    credentials = {
      ...plugin.oauth,
      storePath: credentialsPath(dataDir),
      persist: (/** @type {Record<string, unknown>} */ updated) => saveCredentials(dataDir, updated),
    };
  } else if (file.oauth) {
    credentials = { ...file.oauth, configPath: getConfigPath() };
  }
  return {
    ok: true,
    config: configFromRaw(raw, process.env, plugin.region),
    credentials,
    apiKey: typeof file.api_key === 'string' ? file.api_key : undefined,
  };
}

/**
 * Read the region the current credential asks for, so a login can start
 * against the right account service instead of whichever one the panel picked.
 * @param {string} dataDir
 * @returns {Promise<'cn' | 'global' | null>}
 */
export async function readConfiguredRegion(dataDir) {
  const snapshot = await loadQuotaConfig(dataDir);
  return snapshot.ok ? snapshot.config.region : null;
}
