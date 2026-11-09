// @ts-check

import { QuotaError } from './errors.mjs';

/**
 * Fetch an account or quota endpoint without ever following a credentialed
 * request to another URL. Every request has its own bounded timeout.
 * @param {string} url
 * @param {RequestInit & { headers?: Record<string, string> }} init
 * @param {AbortSignal} [signal]
 * @param {number} [timeoutMs]
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchWithoutRedirect(url, init, signal, timeoutMs = 20_000, fetchImpl = globalThis.fetch) {
  if (signal?.aborted) throw new QuotaError('timeout');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
  } catch (error) {
    const aborted = signal?.aborted || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
    throw new QuotaError(aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}
